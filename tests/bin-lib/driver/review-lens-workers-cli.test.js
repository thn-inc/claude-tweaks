'use strict';
// plugin/bin/review-lens-workers.js (#6000): the CLI over lib/driver/lens-workers.js. In-process
// through runCli with a fake runner; every exit-0 case builds an anchored fixture (a real repo with
// `<repo>/.claude-tweaks/pipelines/<run-id>` as --run) and reviews a separate worktree or checkout.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runCli, spawnCli } = require('../../helpers/run-cli');
const { readText } = require('../../helpers/read-skill');
const { committedRepo, linkedWorktreeOf, fixtureGit, cleanGitEnv } = require('../../helpers/git-fixtures');
const { WORKER_DISPATCHES_FILE } = require('../../../plugin/bin/lib/driver/lens-workers');
const { lensAdmittedFormsNote } = require('../../../plugin/bin/lib/driver/roles');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'review-lens-workers.js');
const RUN_ID = '2026-11-23T120000-record-6000';
const lens = (name, reviewers = 2) => ({ lens: name, brief: `brief for ${name}`, model: 'haiku', reviewers });
const resultOut = (text, extra = {}) => ({ code: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0, usage: {}, permission_denials: [], session_id: 's', structured_output: { text }, ...extra }) });

// The anchoring checkout with its run dir, plus the lens and bundle files (inside the run dir's
// sibling `inputs`, outside every reviewed tree).
function fixture(t, { lenses = [lens('3a'), lens('3b')], bundle = 'BUNDLE TEXT\n' } = {}) {
  const main = committedRepo({ prefix: 'ct-lens-main-' });
  t.after(() => fs.rmSync(main.dir, { recursive: true, force: true }));
  const mainDir = fs.realpathSync(main.dir);
  const runDir = path.join(mainDir, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  const inputs = path.join(mainDir, '.claude-tweaks', 'inputs');
  fs.mkdirSync(inputs, { recursive: true });
  fs.writeFileSync(path.join(inputs, 'lenses.json'), JSON.stringify({ lenses }));
  fs.writeFileSync(path.join(inputs, 'bundle.md'), bundle);
  return { main: mainDir, runDir, lensesFile: path.join(inputs, 'lenses.json'), bundle: path.join(inputs, 'bundle.md'), bundleText: bundle };
}
// A plain checkout of its own, outside the anchoring one.
function plainCheckout(t) {
  const repo = committedRepo({ prefix: 'ct-lens-plain-' });
  t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
  return fs.realpathSync(repo.dir);
}
function linkedWorktree(t, main) {
  const wt = linkedWorktreeOf(main);
  t.after(() => fs.rmSync(path.dirname(wt), { recursive: true, force: true }));
  return wt;
}

// A fake runner: records each call, its settings text and appended prompt; `answer(call, n)`.
function fakeRunner(answer = (call, n) => resultOut(`reply ${n}`)) {
  const calls = [];
  const runner = (call) => {
    const record = { ...call, files: {}, kills: [] };
    for (const flag of ['--settings', '--append-system-prompt-file']) {
      const i = call.args.indexOf(flag);
      if (i !== -1) record.files[flag] = readText(call.args[i + 1]);
    }
    calls.push(record);
    const outcome = answer(call, calls.length, record);
    const exited = Promise.resolve(outcome).then((o) => ({ signal: null, stderr: '', ...o }));
    return { pid: 5000 + calls.length, kill(signal) { record.kills.push(signal); if (record.die) record.die(signal); }, exited };
  };
  return { runner, calls };
}

const ENV = cleanGitEnv();
function deps(fx, extra = {}) {
  return {
    platform: 'darwin',
    gitHonoursAttrSource: () => true,
    resolvePolicy: () => ({}),
    onSignal: () => () => {},
    locateTranscripts: () => [], // hermetic: never read the real ~/.claude/projects
    ...extra,
  };
}
const argv = (fx, cwd, over = {}) => {
  const o = { '--run': fx.runDir, '--lenses-file': fx.lensesFile, '--cwd': cwd, '--bundle': fx.bundle, ...over };
  return Object.entries(o).filter(([, v]) => v !== undefined).flat();
};
const call = (fx, args, extraDeps, cwd = fx.main) => runCli(CLI, args, { env: ENV, cwd, deps: deps(fx, extraDeps) });
const logLines = (runDir) => {
  let text = '';
  try { text = fs.readFileSync(path.join(runDir, WORKER_DISPATCHES_FILE), 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
};

test('realDeps carries the runner, signal and git seams', () => {
  const { realDeps } = require(CLI);
  for (const key of ['runner', 'onSignal', 'git', 'gitHonoursAttrSource', 'resolvePolicy', 'launchWorker', 'resolveTarget']) assert.strictEqual(typeof realDeps[key], 'function', key);
});

test('exit 0 prints the reply; one stderr line per failed side', async (t) => {
  const fx = fixture(t, { lenses: [lens('3a'), lens('3f', 1)] });
  const cwd = plainCheckout(t);
  const { runner } = fakeRunner((c, n) => (n === 2 ? resultOut('  ') : resultOut('No findings.')));
  const res = await call(fx, argv(fx, cwd), { runner });
  assert.strictEqual(res.code, 0, res.stderr);
  assert.deepStrictEqual(JSON.parse(res.stdout), {
    started: true,
    lenses: [{ lens: '3a', reviewers: 2 }, { lens: '3f', reviewers: 1 }],
    reviewers: [
      { lens: '3a', side: 'A', text: 'No findings.', failed: false },
      { lens: '3a', side: 'B', text: null, failed: true },
      { lens: '3f', side: 'A', text: null, failed: true },
    ],
  });
  assert.strictEqual(res.stdout.split('\n').length, 2);
  assert.strictEqual(res.stderr, 'review-lens-workers: lens 3a B failed: blank\nreview-lens-workers: lens 3f A failed: excluded\n');
  assert.strictEqual(logLines(fx.runDir).length, 3);
});

test('readPaths carries the git common dir for a linked worktree', async (t) => {
  const fx = fixture(t);
  const wt = linkedWorktree(t, fx.main);
  const { runner, calls } = fakeRunner();
  const res = await call(fx, argv(fx, wt), { runner });
  assert.strictEqual(res.code, 0, res.stderr);
  const common = fs.realpathSync(path.join(fx.main, '.git'));
  for (const c of calls) assert.deepStrictEqual(JSON.parse(c.files['--settings']).sandbox.filesystem.allowRead, [common]);
  // A plain checkout's common dir is inside it: no read paths.
  const fx2 = fixture(t);
  const plain = plainCheckout(t);
  const second = fakeRunner();
  assert.strictEqual((await call(fx2, argv(fx2, plain), { runner: second.runner })).code, 0);
  for (const c of second.calls) assert.deepStrictEqual(JSON.parse(c.files['--settings']).sandbox.filesystem.allowRead, []);
});

test('AC8.1/AC8.2/AC8.3 (Q1): the worker runs in the reviewed worktree with the bundle inlined and writes nothing there', async (t) => {
  const fx = fixture(t, { bundle: 'DIFF AND CONTEXT\nline two\n' });
  const wt = linkedWorktree(t, fx.main);
  const listing = (root) => {
    const out = {};
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir).sort()) {
        const p = path.join(dir, name);
        const st = fs.lstatSync(p);
        out[path.relative(root, p)] = [st.isDirectory() ? 'dir' : st.size, st.mtimeMs];
        if (st.isDirectory()) walk(p);
      }
    };
    walk(root);
    return out;
  };
  const before = listing(wt);
  const { runner, calls } = fakeRunner();
  const res = await call(fx, argv(fx, wt), { runner });
  assert.strictEqual(res.code, 0, res.stderr);
  assert.strictEqual(calls.length, 4);
  for (const c of calls) {
    assert.strictEqual(c.options.cwd, wt);
    assert.ok(c.input.startsWith('<review-context>\n' + fx.bundleText), c.input);
    assert.ok(/\n\nbrief for 3[ab]$/.test(c.input), c.input);
  }
  assert.deepStrictEqual(listing(wt), before);
  assert.strictEqual(fixtureGit(['-C', wt, 'status', '--porcelain'], { encoding: 'utf8', env: ENV }), '');
});

test('Q2 note: every worker launches with the admitted-forms note', async (t) => {
  const fx = fixture(t);
  const { runner, calls } = fakeRunner();
  assert.strictEqual((await call(fx, argv(fx, plainCheckout(t)), { runner })).code, 0);
  assert.strictEqual(calls.length, 4);
  for (const c of calls) assert.strictEqual(c.files['--append-system-prompt-file'], lensAdmittedFormsNote());
});

test('the worker env carries the pinned git attr source: the reviewed repository\'s empty tree', async (t) => {
  const fx = fixture(t);
  const { runner, calls } = fakeRunner();
  assert.strictEqual((await call(fx, argv(fx, plainCheckout(t)), { runner })).code, 0);
  const emptyTree = fixtureGit(['-C', fx.main, 'hash-object', '-t', 'tree', '--stdin'], { encoding: 'utf8', env: ENV, input: '' }).trim();
  for (const c of calls) assert.strictEqual(c.options.env.GIT_ATTR_SOURCE, emptyTree);
});

test('a git that does not honour GIT_ATTR_SOURCE: every side fails with reason platform, no worker starts, and stderr says why', async (t) => {
  const fx = fixture(t);
  const { runner, calls } = fakeRunner();
  const res = await call(fx, argv(fx, plainCheckout(t)), { runner, gitHonoursAttrSource: () => false });
  assert.strictEqual(res.code, 0, res.stderr);
  assert.strictEqual(calls.length, 0);
  assert.ok(JSON.parse(res.stdout).reviewers.every((r) => r.failed));
  assert.match(res.stderr, /does not honour GIT_ATTR_SOURCE/);
  assert.strictEqual(res.stderr.split('\n').filter((l) => l.endsWith('failed: platform')).length, 4);
});

test('a failed log append still prints the reply', async (t) => {
  const fx = fixture(t, { lenses: [lens('3b', 1)] });
  const { runner } = fakeRunner();
  const res = await call(fx, argv(fx, plainCheckout(t)), { runner, appendRecord: () => { throw new Error('could not acquire lock'); } });
  assert.strictEqual(res.code, 0);
  assert.deepStrictEqual(JSON.parse(res.stdout).reviewers, [{ lens: '3b', side: 'A', text: 'reply 1', failed: false }]);
  assert.strictEqual(res.stderr, 'review-lens-workers: log append failed for lens 3b A: could not acquire lock\n');
});

test('a worker result containing a control sequence reaches stderr neutralized', async (t) => {
  const fx = fixture(t, { lenses: [lens('3b', 1)] });
  const evil = 'boom \u001b]52;c;ZXZpbA==\u0007 \u001b[2J closes #12 @someone';
  const { runner } = fakeRunner(() => ({ code: 1, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: evil }) }));
  const res = await call(fx, argv(fx, plainCheckout(t)), { runner });
  assert.strictEqual(res.code, 0);
  assert.ok(!/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(res.stderr), JSON.stringify(res.stderr));
  assert.ok(res.stderr.startsWith('review-lens-workers: lens 3b A failed: launch ('), res.stderr);
  assert.ok(!res.stderr.includes('#12') && !res.stderr.includes('@someone'), res.stderr);
  assert.ok(!res.stdout.includes('boom'));
});

test('relative --run, --lenses-file and --bundle resolve against the injected cwd', async (t) => {
  const fx = fixture(t, { lenses: [lens('3b', 1)] });
  const { runner } = fakeRunner();
  const rel = (p) => path.relative(fx.main, p);
  const res = await call(fx, argv(fx, plainCheckout(t), { '--run': rel(fx.runDir), '--lenses-file': rel(fx.lensesFile), '--bundle': rel(fx.bundle) }), { runner });
  assert.strictEqual(res.code, 0, res.stderr);
  assert.strictEqual(logLines(fx.runDir).length, 1);
});

for (const [name, signal, code] of [['SIGTERM', 'SIGTERM', 143], ['SIGINT', 'SIGINT', 130]]) {
  test(`forwards termination to every running worker (${name} -> ${code})`, async (t) => {
    const fx = fixture(t);
    const handlers = {};
    const removed = [];
    const onSignal = (sig, fn) => { handlers[sig] = fn; return () => removed.push(sig); };
    // Children that never exit on their own; a kill ends them.
    const { runner, calls } = fakeRunner((c, n, record) => new Promise((resolve) => { record.die = (sig) => resolve({ code: null, signal: sig, stdout: '', stderr: '' }); }));
    // A failed assertion must not leave the never-exiting children (and their ceiling timers) running.
    t.after(() => { for (const c of calls) if (c.die) c.die('SIGKILL'); });
    const pending = call(fx, argv(fx, plainCheckout(t)), { runner, onSignal });
    for (let i = 0; i < 2000 && calls.length < 4; i += 1) await new Promise((r) => setTimeout(r, 1));
    assert.strictEqual(calls.length, 4);
    handlers[signal]();
    const res = await pending;
    assert.strictEqual(res.code, code);
    assert.strictEqual(res.stdout, '');
    for (const c of calls) assert.deepStrictEqual(c.kills, ['SIGTERM']);
    assert.deepStrictEqual(removed.sort(), ['SIGINT', 'SIGTERM']);
    // Each killed side still logged its record.
    const lines = logLines(fx.runDir);
    assert.strictEqual(lines.length, 4);
    assert.ok(lines.every((l) => l.launched && l.failed));
  });
}

test('exit 2 on a malformed call', async (t) => {
  const fx = fixture(t);
  const plain = plainCheckout(t);
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ct-lens-outside-')));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const write = (name, text) => { const p = path.join(path.dirname(fx.lensesFile), name); fs.writeFileSync(p, text); return p; };
  const cases = [
    ['no --run', argv(fx, plain, { '--run': undefined }), /--run is required/],
    ['no --cwd', argv(fx, plain, { '--cwd': undefined }), /--cwd is required/],
    ['no --bundle', argv(fx, plain, { '--bundle': undefined }), /--bundle is required/],
    ['no --lenses-file', argv(fx, plain, { '--lenses-file': undefined }), /--lenses-file is required/],
    ['an unknown flag', [...argv(fx, plain), '--bogus', 'x'], /unknown argument: --bogus/],
    ['a trailing bare flag', [...argv(fx, plain, { '--bundle': undefined }), '--bundle'], /--bundle needs a value/],
    ['an inherited key as a flag', [...argv(fx, plain), 'constructor', 'x'], /unknown argument: constructor/],
    ['a lens file that is not JSON', argv(fx, plain, { '--lenses-file': write('bad.json', '{nope') }), /not JSON/],
    ['an unreadable lens file', argv(fx, plain, { '--lenses-file': path.join(outside, 'missing.json') }), /--lenses-file unreadable/],
    ['an unreadable bundle', argv(fx, plain, { '--bundle': path.join(outside, 'missing.md') }), /--bundle unreadable/],
    ['an inputRefusal', argv(fx, plain, { '--lenses-file': write('dup.json', JSON.stringify({ lenses: [lens('3b'), lens('3b')] })) }), /lens 3b is named twice/],
    ['a relative --cwd', argv(fx, 'relative/dir'), /--cwd must be an absolute path/],
    ['a --cwd that does not exist', argv(fx, path.join(outside, 'gone')), /--cwd is not an existing directory/],
    ['a --cwd outside any git work tree', argv(fx, outside), /--cwd is not inside a git work tree/],
    ['a --run inside --cwd', argv(fx, fx.main), /lies inside --cwd/],
    ['a --run outside pipelines/', argv(fx, plain, { '--run': path.dirname(fx.lensesFile) }), /not anchored/],
    ['a --run that does not exist', argv(fx, plain, { '--run': path.join(fx.runDir, 'nope') }), /does not exist/],
    ['a --run in a sibling-prefix dir', argv(fx, plain, { '--run': (() => { const p = path.join(fx.main, '.claude-tweaks', 'pipelines-copy', RUN_ID); fs.mkdirSync(p, { recursive: true }); return p; })() }), /not anchored/],
  ];
  for (const [name, args, pattern] of cases) {
    const { runner, calls } = fakeRunner();
    const res = await call(fx, args, { runner });
    assert.strictEqual(res.code, 2, `${name}: ${res.stderr}`);
    assert.match(res.stderr, pattern, name);
    assert.strictEqual(res.stdout, '', name);
    assert.strictEqual(calls.length, 0, name);
  }
  assert.strictEqual(logLines(fx.runDir).length, 0);
});

test('a failed git derivation is exit 2', async (t) => {
  const fx = fixture(t);
  const git = (args) => { if (args.includes('hash-object')) throw new Error('git hash-object exited 128: fatal'); return args.includes('--is-inside-work-tree') ? 'true\n' : path.join(fx.main, '.git') + '\n'; };
  const { runner, calls } = fakeRunner();
  const res = await call(fx, argv(fx, plainCheckout(t)), { runner, git });
  assert.strictEqual(res.code, 2);
  assert.match(res.stderr, /git derivation failed/);
  assert.strictEqual(calls.length, 0);
});

test('script entry: --help exits 0 and a call with no flags exits 2', () => {
  const help = spawnCli(CLI, ['--help']);
  assert.strictEqual(help.code, 0);
  assert.match(help.stdout, /^Usage: review-lens-workers\.js --run/);
  const bare = spawnCli(CLI, []);
  assert.strictEqual(bare.code, 2);
  assert.match(bare.stderr, /--run is required/);
});

// Fix round 1 (#6000 task review).
test('a policy that cannot be read is exit 2 with a stderr line, no worker started', async (t) => {
  const fx = fixture(t);
  const { runner, calls } = fakeRunner();
  const res = await call(fx, argv(fx, plainCheckout(t)), { runner, resolvePolicy: () => { throw new Error('policy.yml: bad yaml'); } });
  assert.strictEqual(res.code, 2);
  assert.strictEqual(res.stdout, '');
  assert.strictEqual(res.stderr, 'review-lens-workers: policy unreadable: policy.yml: bad yaml\n');
  assert.strictEqual(calls.length, 0);
});

test('a worker that ignores SIGTERM is sent SIGKILL after the kill grace', async (t) => {
  const fx = fixture(t, { lenses: [lens('3b', 1)] });
  const handlers = {};
  const onSignal = (sig, fn) => { handlers[sig] = fn; return () => {}; };
  // SIGTERM is ignored; only SIGKILL ends the child.
  const { runner, calls } = fakeRunner((c, n, record) => new Promise((resolve) => { record.die = (sig) => { if (sig === 'SIGKILL') resolve({ code: null, signal: sig, stdout: '', stderr: '' }); }; }));
  t.after(() => { for (const c of calls) if (c.die) c.die('SIGKILL'); });
  const pending = call(fx, argv(fx, plainCheckout(t)), { runner, onSignal, killGraceMs: 20 });
  for (let i = 0; i < 2000 && calls.length < 1; i += 1) await new Promise((r) => setTimeout(r, 1));
  handlers.SIGTERM();
  const res = await pending;
  assert.strictEqual(res.code, 143);
  assert.strictEqual(res.stdout, '');
  assert.deepStrictEqual(calls[0].kills, ['SIGTERM', 'SIGKILL']);
});

test('a worker-written stderr detail is cut to STDERR_DETAIL_MAX characters', async (t) => {
  const fx = fixture(t, { lenses: [lens('3b', 1)] });
  const { runner } = fakeRunner(() => ({ code: 1, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'x'.repeat(500) }) }));
  const res = await call(fx, argv(fx, plainCheckout(t)), { runner });
  assert.strictEqual(res.code, 0);
  assert.strictEqual(res.stderr, `review-lens-workers: lens 3b A failed: launch (${'x'.repeat(200)}…)\n`);
});

test('when every lens is excluded, the GIT_ATTR_SOURCE probe and its line are skipped', async (t) => {
  const fx = fixture(t, { lenses: [lens('3f')] });
  let probes = 0;
  const { runner, calls } = fakeRunner();
  const res = await call(fx, argv(fx, plainCheckout(t)), { runner, gitHonoursAttrSource: () => { probes += 1; return false; } });
  assert.strictEqual(res.code, 0);
  assert.strictEqual(probes, 0);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(res.stderr, 'review-lens-workers: lens 3f A failed: excluded\nreview-lens-workers: lens 3f B failed: excluded\n');
});

// Re-review of fix round 1 (#6000).
test('an unreadable policy exits 2 before any derivation git call or probe, its message neutralized', async (t) => {
  const fx = fixture(t);
  const gitCalls = [];
  const realGit = require(CLI).realDeps.git;
  const git = (args, opts) => { gitCalls.push(args); return realGit(args, opts); };
  let probes = 0;
  const { runner, calls } = fakeRunner();
  const res = await call(fx, argv(fx, plainCheckout(t)), {
    runner, git, gitHonoursAttrSource: () => { probes += 1; return true; },
    resolvePolicy: () => { throw new Error('bad \u001b[31mred'); },
  });
  assert.strictEqual(res.code, 2);
  assert.doesNotMatch(res.stderr, /\u001b/);
  assert.match(res.stderr, /^review-lens-workers: policy unreadable: bad .*red\n$/);
  assert.strictEqual(probes, 0);
  assert.strictEqual(calls.length, 0);
  assert.ok(!gitCalls.some((a) => a.includes('hash-object') || a.includes('--git-common-dir')), JSON.stringify(gitCalls));
});

test('a stderr detail is cut by code point, never inside a surrogate pair', async (t) => {
  const fx = fixture(t, { lenses: [lens('3b', 1)] });
  const text = 'x'.repeat(199) + '\u{1F600}' + 'y'.repeat(300);
  const { runner } = fakeRunner(() => ({ code: 1, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: text }) }));
  const res = await call(fx, argv(fx, plainCheckout(t)), { runner });
  assert.strictEqual(res.stderr, `review-lens-workers: lens 3b A failed: launch (${'x'.repeat(199)}\u{1F600}…)\n`);
});
