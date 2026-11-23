'use strict';
// plugin/bin/lib/driver/lens-workers.js (#6000): runs review lens briefs as headless lens-reviewer
// workers through worker.js's launchWorker with a fake runner, and builds the reply shape
// review-coordination.js settle-lens-replies reads.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const lw = require(path.join(LIB, 'driver', 'lens-workers.js'));
const { runLensWorkers, classifyFailure, composeLensPrompt, appendWorkerRecord, LENS_WORKER_CONCURRENCY, LENS_WORKER_TIMEOUT_MS, EXCLUDED_LENSES, FAILURE_REASONS, WORKER_DISPATCHES_FILE } = lw;
const { ENV_ALLOW } = require(path.join(LIB, 'driver', 'worker.js'));
const { lensAdmittedFormsNote, lensGitEnv } = require(path.join(LIB, 'driver', 'roles.js'));
const { runCliSync } = require('../../helpers/run-cli');

const COORDINATION = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'review-coordination.js');
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const HERMETIC_PATH = '/nonexistent-lens-workers-test-path';
const REPLY = '| Severity | Path:Line | Finding | Evidence |\n|---|---|---|---|\n| high | src/a.js:10 | missing expiry check on token | evidence |\n\nSTATUS: DONE';
// The result object Step 1's capture printed (CLI 2.1.325, empty CLAUDE_CONFIG_DIR), exit 1, empty stderr.
const AUTH_FAILURE_STDOUT = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 }, permission_denials: [], terminal_reason: 'api_error', result: 'Not logged in · Please run /login', session_id: 'f8d6e559-e883-4c89-8960-2ef9462b896e' });

const tmp = (t, prefix = 'lens-workers-') => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const lens = (name, model = 'haiku', reviewers = 2) => ({ lens: name, brief: `brief for ${name}`, model, reviewers });
const resultOut = (text, extra = {}) => ({ code: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 }, permission_denials: [], session_id: 's', structured_output: { text }, ...extra }) });

// The lens a call belongs to, read from its prompt (each brief names its lens), and its side: the
// launcher starts a lens's side A before its side B, so the n-th call for a lens is its n-th side.
function sideOf(calls, call) {
  const owner = /brief for (\S+)$/.exec(call.input)[1];
  const before = calls.filter((c) => c.lens === owner).length;
  return { lens: owner, side: before === 0 ? 'A' : 'B' };
}

// A fake runner: `answer({ lens, side, call })` returns the child's outcome (an object) or a
// Promise of one; every call is recorded with the settings and appended-prompt files it named.
function fakeRunner(answer = ({ lens: l, side }) => resultOut(`reply ${l} ${side}`)) {
  const calls = [];
  const runner = (call) => {
    const id = sideOf(calls, call);
    const record = { ...call, ...id, files: {}, kills: [] };
    for (const flag of ['--settings', '--append-system-prompt-file']) {
      const i = call.args.indexOf(flag);
      if (i !== -1) record.files[flag] = fs.readFileSync(call.args[i + 1], 'utf8');
    }
    calls.push(record);
    const exited = Promise.resolve(answer({ ...id, call })).then((o) => ({ signal: null, stderr: '', ...o }));
    return { pid: 4000 + calls.length, kill(signal) { record.kills.push(signal); }, exited };
  };
  return { runner, calls };
}

function baseInput(t, extra = {}) {
  return {
    lenses: [lens('3a'), lens('3b')],
    runDir: tmp(t, 'lens-run-'),
    cwd: tmp(t, 'lens-cwd-'),
    bundleText: 'BUNDLE TEXT',
    readPaths: [],
    attrSource: EMPTY_TREE,
    settingsDir: tmp(t, 'lens-settings-'),
    platform: 'darwin',
    policy: {},
    env: { PATH: HERMETIC_PATH, HOME: '/h', USER: 'u' },
    gitHonoursAttrSource: true,
    ...extra,
  };
}
const logLines = (runDir) => {
  let text = '';
  try { text = fs.readFileSync(path.join(runDir, WORKER_DISPATCHES_FILE), 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
};
async function waitFor(cond, what) {
  for (let i = 0; i < 2000; i += 1) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error('timed out waiting for ' + what);
}

test('the module constants are pinned', () => {
  assert.strictEqual(LENS_WORKER_CONCURRENCY, 4);
  assert.strictEqual(LENS_WORKER_TIMEOUT_MS, 900000);
  assert.deepStrictEqual(EXCLUDED_LENSES, ['3f']);
  assert.deepStrictEqual(FAILURE_REASONS, ['launch', 'auth', 'timeout', 'blank', 'platform', 'excluded', 'denied']);
  assert.strictEqual(WORKER_DISPATCHES_FILE, 'worker-dispatches.jsonl');
});

test('composeLensPrompt inlines the bundle ahead of the verbatim brief', () => {
  assert.strictEqual(composeLensPrompt('B\nX', '  brief\n'), '<review-context>\nB\nX\n</review-context>\n\n  brief\n');
});

test('AC5.1: two lenses, four workers — the reply is byte-equal in shape to what settle-lens-replies accepts', async (t) => {
  const { runner, calls } = fakeRunner(() => resultOut(REPLY));
  const out = await runLensWorkers(baseInput(t), { runner });
  assert.strictEqual(calls.length, 4);
  assert.deepStrictEqual(out.reply, {
    started: true,
    lenses: [{ lens: '3a', reviewers: 2 }, { lens: '3b', reviewers: 2 }],
    reviewers: ['3a', '3b'].flatMap((l) => ['A', 'B'].map((side) => ({ lens: l, side, text: REPLY, failed: false }))),
  });
  assert.deepStrictEqual(out.failures, []);
  const dir = tmp(t, 'lens-settle-');
  const file = path.join(dir, 'reply.json');
  fs.writeFileSync(file, JSON.stringify(out.reply));
  const res = runCliSync(COORDINATION, ['settle-lens-replies', file, '--ctx-id', 't6000'], { env: { CLAUDE_CODE_SESSION_ID: 't6000-session', TMPDIR: dir, TMP: dir, TEMP: dir }, cwd: dir });
  assert.strictEqual(res.code, 0, res.stderr);
  assert.deepStrictEqual(JSON.parse(res.stdout).settled.map((s) => s.lens), ['3a', '3b']);
});

test('AC5.2: a worker that exits non-zero fails only its own side', async (t) => {
  const { runner } = fakeRunner(({ lens: l, side }) => (l === '3a' && side === 'B' ? { code: 1, stdout: '', stderr: 'boom' } : resultOut(`reply ${l} ${side}`)));
  const out = await runLensWorkers(baseInput(t), { runner });
  assert.deepStrictEqual(out.reply.reviewers, [
    { lens: '3a', side: 'A', text: 'reply 3a A', failed: false },
    { lens: '3a', side: 'B', text: null, failed: true },
    { lens: '3b', side: 'A', text: 'reply 3b A', failed: false },
    { lens: '3b', side: 'B', text: 'reply 3b B', failed: false },
  ]);
  assert.deepStrictEqual(out.failures.map(({ lens: l, side, reason }) => [l, side, reason]), [['3a', 'B', 'launch']]);
});

test('AC2.1: an auth-failure fake yields failed: true, never text: ""', async (t) => {
  const { runner } = fakeRunner(() => ({ code: 1, stdout: AUTH_FAILURE_STDOUT, stderr: '' }));
  const out = await runLensWorkers(baseInput(t, { lenses: [lens('3b', 'haiku', 1)] }), { runner });
  assert.deepStrictEqual(out.reply.reviewers, [{ lens: '3b', side: 'A', text: null, failed: true }]);
  assert.deepStrictEqual(out.failures.map((f) => f.reason), ['auth']);
});

test('classifyFailure: timeout, auth, launch, denied, blank and a reply', () => {
  const ok = (text, denials = []) => ({ status: 'ok', result: { text }, denials, detail: null });
  assert.strictEqual(classifyFailure({ status: 'timeout', detail: 'Not logged in' }), 'timeout');
  assert.strictEqual(classifyFailure({ status: 'fail', reason: 'exit', detail: 'Not logged in · Please run /login' }), 'auth');
  assert.strictEqual(classifyFailure({ status: 'fail', reason: 'exit', detail: 'exit 1: boom' }), 'launch');
  assert.strictEqual(classifyFailure({ status: 'fail', reason: 'schema', detail: null }), 'launch');
  assert.strictEqual(classifyFailure(ok('No findings.', [{ tool_name: 'Bash', tool_input: { command: '  git log -1' } }])), 'denied');
  assert.strictEqual(classifyFailure(ok('No findings.', [{ tool_name: 'Bash', tool_input: { command: 'git' } }])), 'denied');
  assert.strictEqual(classifyFailure(ok('No findings.', [{ tool_name: 'Bash', tool_input: { command: 'gitk' } }])), null);
  assert.strictEqual(classifyFailure(ok('No findings.', [{ tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } }])), null);
  assert.strictEqual(classifyFailure(ok(' \n\t')), 'blank');
  assert.strictEqual(classifyFailure({ status: 'ok', result: {}, denials: [] }), 'blank');
  assert.strictEqual(classifyFailure(ok('No findings.')), null);
});

test('AC2.2: off SANDBOX_PROBED_PLATFORMS every side fails with reason platform and no worker starts', async (t) => {
  const { runner, calls } = fakeRunner();
  const out = await runLensWorkers(baseInput(t, { platform: 'linux' }), { runner });
  assert.strictEqual(calls.length, 0);
  assert.ok(out.reply.reviewers.every((r) => r.failed === true && r.text === null));
  assert.deepStrictEqual(out.failures.map((f) => f.reason), ['platform', 'platform', 'platform', 'platform']);
});

test('a git that does not honour GIT_ATTR_SOURCE fails every side with reason platform before any worker starts', async (t) => {
  const { runner, calls } = fakeRunner();
  const out = await runLensWorkers(baseInput(t, { gitHonoursAttrSource: false }), { runner });
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(out.failures.map((f) => f.reason), ['platform', 'platform', 'platform', 'platform']);
  // Without an injected boolean the deps hook decides, called once with the reviewed worktree.
  const seen = [];
  const input = baseInput(t);
  delete input.gitHonoursAttrSource;
  const again = await runLensWorkers(input, { runner, gitHonoursAttrSource: (o) => { seen.push(o.cwd); return false; } });
  assert.deepStrictEqual(seen, [input.cwd]);
  assert.strictEqual(calls.length, 0);
  assert.ok(again.failures.every((f) => f.reason === 'platform'));
});

test('3f is excluded before any worker starts', async (t) => {
  const { runner, calls } = fakeRunner();
  const out = await runLensWorkers(baseInput(t, { lenses: [lens('3b'), lens('3f')] }), { runner });
  assert.deepStrictEqual(calls.map((c) => c.lens), ['3b', '3b']);
  assert.deepStrictEqual(out.reply.reviewers.slice(2), [{ lens: '3f', side: 'A', text: null, failed: true }, { lens: '3f', side: 'B', text: null, failed: true }]);
  assert.deepStrictEqual(out.failures.map((f) => [f.lens, f.side, f.reason]), [['3f', 'A', 'excluded'], ['3f', 'B', 'excluded']]);
  assert.deepStrictEqual(out.reply.lenses, [{ lens: '3b', reviewers: 2 }, { lens: '3f', reviewers: 2 }]);
});

test('blank: whitespace text is blank; "No findings." is a reply', async (t) => {
  const { runner } = fakeRunner(({ side }) => resultOut(side === 'A' ? '  \n ' : 'No findings.'));
  const out = await runLensWorkers(baseInput(t, { lenses: [lens('3b')] }), { runner });
  assert.deepStrictEqual(out.reply.reviewers, [
    { lens: '3b', side: 'A', text: null, failed: true },
    { lens: '3b', side: 'B', text: 'No findings.', failed: false },
  ]);
  assert.deepStrictEqual(out.failures.map((f) => f.reason), ['blank']);
});

test('AC9.1/AC9.2: a git permission denial fails the side with reason denied even when the text is "No findings."', async (t) => {
  const gitDenial = [{ tool_name: 'Bash', tool_use_id: 'x', tool_input: { command: 'git diff HEAD~1 HEAD' } }];
  const readDenial = [{ tool_name: 'Read', tool_use_id: 'y', tool_input: { file_path: '/etc/hosts' } }];
  const { runner } = fakeRunner(({ lens: l, side }) => {
    if (l === '3a' && side === 'A') return resultOut('No findings.', { permission_denials: gitDenial });
    if (l === '3b' && side === 'A') return resultOut('No findings.', { permission_denials: readDenial });
    return resultOut(`reply ${l} ${side}`);
  });
  const out = await runLensWorkers(baseInput(t, { lenses: [lens('3a'), lens('3b', 'haiku', 1)] }), { runner });
  assert.deepStrictEqual(out.reply.reviewers, [
    { lens: '3a', side: 'A', text: null, failed: true },
    { lens: '3a', side: 'B', text: 'reply 3a B', failed: false },
    { lens: '3b', side: 'A', text: 'No findings.', failed: false },
  ]);
  assert.deepStrictEqual(out.failures.map((f) => [f.lens, f.side, f.reason]), [['3a', 'A', 'denied']]);
});

test("one side's launchWorker throw fails only that side", async (t) => {
  const { runner } = fakeRunner();
  const real = require(path.join(LIB, 'driver', 'worker.js')).launchWorker;
  const launchWorker = (opts, d) => {
    if (opts.prompt.endsWith('brief for 3b') && (launchWorker.seen3b = (launchWorker.seen3b || 0) + 1) === 2) throw new RangeError('settings write failed');
    return real(opts, d);
  };
  const out = await runLensWorkers(baseInput(t), { runner, launchWorker });
  assert.deepStrictEqual(out.reply.reviewers.map((r) => [r.lens, r.side, r.failed, r.text]), [
    ['3a', 'A', false, 'reply 3a A'], ['3a', 'B', false, 'reply 3a B'], ['3b', 'A', false, 'reply 3b A'], ['3b', 'B', true, null],
  ]);
  assert.deepStrictEqual(out.failures.map((f) => [f.lens, f.side, f.reason]), [['3b', 'B', 'launch']]);
  const line = out.records.find((r) => r.lens === '3b' && r.side === 'B');
  assert.strictEqual(line.launched, false);
});

test('a roleLaunch throw fails every non-excluded side with reason launch, no worker started', async (t) => {
  const { runner, calls } = fakeRunner();
  const out = await runLensWorkers(baseInput(t, { lenses: [lens('3a'), lens('3f', 'haiku', 1)], policy: { 'model-effort': { value: 'x', invalid: true } } }), { runner });
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(out.failures.map((f) => [f.lens, f.side, f.reason]), [['3a', 'A', 'launch'], ['3a', 'B', 'launch'], ['3f', 'A', 'excluded']]);
  assert.ok(out.records.every((r) => r.launched === false && r.startTs === r.endTs && r.wallClockMs === 0));
});

test("the launcher's log carries every failed side", async (t) => {
  const { runner } = fakeRunner();
  const input = baseInput(t, { lenses: [lens('3b'), lens('3f')] });
  let clock = Date.UTC(2026, 10, 23, 12, 0, 0);
  const now = () => (clock += 1000);
  await runLensWorkers({ ...input, now }, { runner });
  await runLensWorkers({ ...input, platform: 'linux', now }, { runner });
  const lines = logLines(input.runDir);
  assert.strictEqual(lines.length, 8);
  const keyed = lines.map((l) => [l.lens, l.side, l.launched, l.failed, l.reason]);
  assert.deepStrictEqual(keyed.slice(0, 2), [['3f', 'A', false, true, 'excluded'], ['3f', 'B', false, true, 'excluded']]);
  assert.deepStrictEqual(keyed.slice(2, 4).sort(), [['3b', 'A', true, false, null], ['3b', 'B', true, false, null]]);
  assert.deepStrictEqual(keyed.slice(4), [['3f', 'A', false, true, 'excluded'], ['3f', 'B', false, true, 'excluded'], ['3b', 'A', false, true, 'platform'], ['3b', 'B', false, true, 'platform']]);
  const launched = lines.find((l) => l.launched);
  assert.deepStrictEqual(Object.keys(launched), ['kind', 'launched', 'lens', 'side', 'description', 'agentType', 'metaModel', 'startTs', 'endTs', 'wallClockMs', 'failed', 'reason']);
  assert.strictEqual(launched.kind, 'worker');
  assert.strictEqual(launched.agentType, 'lens-reviewer');
  assert.strictEqual(launched.metaModel, 'haiku');
  assert.strictEqual(launched.description, `lens ${launched.lens} ${launched.side}`);
  assert.ok(launched.wallClockMs > 0 && Date.parse(launched.endTs) - Date.parse(launched.startTs) === launched.wallClockMs);
  for (const l of lines.filter((x) => !x.launched)) assert.ok(l.startTs === l.endTs && l.wallClockMs === 0, JSON.stringify(l));
});

test('records append as each side settles', async (t) => {
  let release;
  const held = new Promise((r) => { release = r; });
  // A failed assertion must not leave the held worker (and its 15-minute ceiling timer) running.
  t.after(() => release());
  const { runner } = fakeRunner(({ side }) => (side === 'A' ? resultOut('first') : held.then(() => resultOut('second'))));
  const input = baseInput(t, { lenses: [lens('3b')] });
  let done = false;
  const run = runLensWorkers(input, { runner }).then((o) => { done = true; return o; });
  await waitFor(() => logLines(input.runDir).length === 1, 'the first record');
  assert.strictEqual(done, false);
  assert.deepStrictEqual(logLines(input.runDir).map((l) => l.side), ['A']);
  release();
  await run;
  assert.deepStrictEqual(logLines(input.runDir).map((l) => l.side), ['A', 'B']);
});

test('two concurrent runs on one run dir append whole lines', async (t) => {
  const a = baseInput(t, { lenses: [lens('3a'), lens('3b'), lens('3c')] });
  const b = { ...baseInput(t, { lenses: [lens('3d'), lens('3e', 'haiku', 1)] }), runDir: a.runDir };
  await Promise.all([runLensWorkers(a, { runner: fakeRunner().runner }), runLensWorkers(b, { runner: fakeRunner().runner })]);
  const text = fs.readFileSync(path.join(a.runDir, WORKER_DISPATCHES_FILE), 'utf8');
  const lines = text.split('\n');
  assert.strictEqual(lines.pop(), '');
  assert.strictEqual(lines.length, 9);
  for (const line of lines) assert.strictEqual(JSON.parse(line).kind, 'worker');
});

// The append runs inside the lock: a second append attempted between the first's acquisition and
// its write is refused with LOCK_TIMEOUT (lock-race-test-seam), and the file holds the first line only.
test("a record append holds the run dir's lock across its write", (t) => {
  const runDir = tmp(t, 'lens-lock-');
  const env = { CLAUDE_TWEAKS_LOCK_WAIT_MS: '0' };
  let inner;
  appendWorkerRecord(runDir, { n: 1 }, {
    env,
    appendFile: (file, text) => {
      try { appendWorkerRecord(runDir, { n: 2 }, { env }); } catch (err) { inner = err; }
      fs.appendFileSync(file, text);
    },
  });
  assert.strictEqual(inner && inner.code, 'LOCK_TIMEOUT');
  assert.deepStrictEqual(logLines(runDir), [{ n: 1 }]);
  appendWorkerRecord(runDir, { n: 3 }, { env });
  assert.deepStrictEqual(logLines(runDir), [{ n: 1 }, { n: 3 }]);
});

test('a failed append never changes the reply and is returned in logFailures', async (t) => {
  const out = await runLensWorkers(baseInput(t, { lenses: [lens('3b', 'haiku', 1)] }), { runner: fakeRunner().runner, appendRecord: () => { throw new Error('disk full'); } });
  assert.deepStrictEqual(out.reply.reviewers, [{ lens: '3b', side: 'A', text: 'reply 3b A', failed: false }]);
  assert.deepStrictEqual(out.logFailures, [{ lens: '3b', side: 'A', reason: 'disk full' }]);
});

test('Q2 note: every worker launches with the admitted-forms note', async (t) => {
  const { runner, calls } = fakeRunner();
  await runLensWorkers(baseInput(t), { runner });
  assert.strictEqual(calls.length, 4);
  for (const c of calls) assert.strictEqual(c.files['--append-system-prompt-file'], lensAdmittedFormsNote());
});

test("AC3.2 (Q3): the launch effort is the role's, the model the lens's", async (t) => {
  const argOf = (args, flag) => { const i = args.indexOf(flag); return i === -1 ? undefined : args[i + 1]; };
  const lenses = [lens('3a', 'haiku', 1), lens('3b', 'sonnet', 1)];
  const { runner, calls } = fakeRunner();
  await runLensWorkers(baseInput(t, { lenses, policy: { 'model-effort': { value: 'profile', source: 'policy' } } }), { runner });
  assert.deepStrictEqual(calls.map((c) => [argOf(c.args, '--model'), argOf(c.args, '--effort')]), [['haiku', undefined], ['sonnet', undefined]]);
  const stub = fakeRunner();
  await runLensWorkers(baseInput(t, { lenses }), { runner: stub.runner, roleLaunch: (role) => { assert.strictEqual(role, 'lens-reviewer'); return { model: 'haiku', effort: 'high' }; } });
  assert.deepStrictEqual(stub.calls.map((c) => [argOf(c.args, '--model'), argOf(c.args, '--effort')]), [['haiku', 'high'], ['sonnet', 'high']]);
});

test('timeout: a worker past LENS_WORKER_TIMEOUT_MS fails with reason timeout', async (t) => {
  // Fake timers: the wall-clock ceiling fires at once; no other timer (the kill grace) ever fires.
  const timers = { setTimeout: (fn, ms) => { if (ms === LENS_WORKER_TIMEOUT_MS) setImmediate(fn); return { ms }; }, clearTimeout: () => {} };
  const calls = [];
  const runner = (call) => {
    let die;
    const exited = new Promise((r) => { die = r; });
    const record = { call, kills: [] };
    calls.push(record);
    return { pid: 7, kill(signal) { record.kills.push(signal); die({ code: null, signal, stdout: '', stderr: '' }); }, exited };
  };
  const out = await runLensWorkers(baseInput(t, { lenses: [lens('3b', 'haiku', 1)] }), { runner, timers });
  assert.deepStrictEqual(calls.map((c) => c.kills), [['SIGTERM']]);
  assert.deepStrictEqual(out.reply.reviewers, [{ lens: '3b', side: 'A', text: null, failed: true }]);
  assert.deepStrictEqual(out.failures.map((f) => f.reason), ['timeout']);
});

test('concurrency: never more than LENS_WORKER_CONCURRENCY workers run at once', async (t) => {
  let live = 0;
  let peak = 0;
  const { runner, calls } = fakeRunner(({ lens: l, side }) => {
    live += 1;
    peak = Math.max(peak, live);
    return new Promise((r) => setTimeout(r, 5)).then(() => { live -= 1; return resultOut(`reply ${l} ${side}`); });
  });
  const out = await runLensWorkers(baseInput(t, { lenses: [lens('3a'), lens('3b'), lens('3c')] }), { runner });
  assert.strictEqual(calls.length, 6);
  assert.strictEqual(peak, LENS_WORKER_CONCURRENCY);
  assert.ok(out.reply.reviewers.every((r) => r.failed === false));
});

test('Proof(auth) launcher: the worker env holds only ENV_ALLOW names', async (t) => {
  const { runner, calls } = fakeRunner();
  const env = { PATH: HERMETIC_PATH, HOME: '/h', USER: 'u', GH_TOKEN: 'gh-secret', GITHUB_TOKEN: 'github-secret', ANTHROPIC_API_KEY: 'sk-secret', SSH_AUTH_SOCK: '/s' };
  await runLensWorkers(baseInput(t, { env }), { runner });
  const allowed = new Set([...ENV_ALLOW, ...Object.keys(lensGitEnv({ attrSource: EMPTY_TREE }))]);
  assert.strictEqual(calls.length, 4);
  for (const c of calls) {
    for (const key of Object.keys(c.options.env)) assert.ok(allowed.has(key), key);
    for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY']) assert.ok(!(key in c.options.env), key);
    assert.strictEqual(c.options.env.GIT_ATTR_SOURCE, EMPTY_TREE);
  }
});

test('an aborted run starts no further side, and a running worker sits in deps.active until it settles', async (t) => {
  let release;
  const held = new Promise((r) => { release = r; });
  // A failed assertion must not leave the held worker (and its 15-minute ceiling timer) running.
  t.after(() => release());
  let abort = false;
  const active = new Set();
  const { runner, calls } = fakeRunner(() => held.then(() => resultOut('late')));
  const input = baseInput(t, { lenses: [lens('3a'), lens('3b'), lens('3c')] });
  const run = runLensWorkers(input, { runner, active, aborted: () => abort });
  await waitFor(() => calls.length === 4, 'four running workers');
  assert.strictEqual(active.size, 4);
  abort = true;
  release();
  const out = await run;
  assert.strictEqual(calls.length, 4);
  assert.strictEqual(active.size, 0);
  assert.strictEqual(logLines(input.runDir).length, 4);
  assert.deepStrictEqual(out.reply.reviewers.slice(4).map((r) => r.failed), [true, true]);
});

test('a missing deps.runner is refused once, up front, with a TypeError', async (t) => {
  const input = baseInput(t);
  await assert.rejects(runLensWorkers(input, {}), { name: 'TypeError', message: 'deps.runner is required' });
  assert.deepStrictEqual(logLines(input.runDir), []);
});
