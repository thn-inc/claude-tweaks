'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const DRIVE = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'drive.js');
const {
  STEP_NAMES, FINAL_STEP, STEP, OUTCOMES, STOP_CLASSES,
  outcomeFor, neutralize, normalizeTitle, createEventSink,
} = require(path.join(LIB, 'driver', 'events'));
const { run, parseArgs, USAGE, driveRecord, newShared } = require(path.join(LIB, 'driver', 'run'));
const {
  STEPS, defineStep, TEST_COMMAND, CI_WAIT_BOUND_MS, CI_POLL_INTERVAL_MS, WIN32_CLAUDE_BIN,
} = require(path.join(LIB, 'driver', 'steps'));
const { openBlockerRefs } = require(path.join(LIB, 'issues', 'record-dependencies'));

test('AC14.3: neutralize strips closing refs, mentions, fences, newlines', () => {
  const s = neutralize('Fixes #12 and closes owner/repo#3\n@alice ```rm```');
  assert.doesNotMatch(s, /#\d|\bfixes\b|\bcloses\b|\n|`/i);
  assert.match(s, /@​alice/);
});

test('neutralize: non-string is empty, whitespace runs collapse, result is trimmed', () => {
  assert.equal(neutralize(undefined), '');
  assert.equal(neutralize(42), '');
  assert.equal(neutralize('  a\r\n\t b  '), 'a b');
  assert.equal(neutralize('a `b` c'), "a 'b' c");
  assert.equal(neutralize('x CLOSED y Resolved z'), 'x y z');
  assert.equal(neutralize('prefixes and fixture'), 'prefixes and fixture');
});

test('AC3.4: normalizeTitle keeps first line, drops period and keywords', () => {
  assert.equal(normalizeTitle('Add the loop. Resolves #9.\nsecond line'), 'Add the loop');
  assert.equal(normalizeTitle('Closes #4\n'), '');
  assert.equal(normalizeTitle(null), '');
});

test('AC7: outcomeFor maps every stop class', () => {
  assert.deepEqual(['refused', 'claim', 'pre-push', 'blocked', 'none'].map(outcomeFor),
    ['refused', 'blocked', 'express-escalated', 'blocked', 'pending-review']);
  assert.throws(() => outcomeFor('other'));
});

test('constants: step vocabulary, camelCase map and frozen shapes', () => {
  assert.equal(STEP_NAMES.length, 17);
  assert.equal(STEP_NAMES[0], 'policy');
  assert.equal(STEP_NAMES[STEP_NAMES.length - 1], 'ci');
  assert.equal(FINAL_STEP, 'final');
  assert.equal(STEP.runDir, 'run-dir');
  assert.equal(STEP.recordPr, 'record-pr');
  assert.equal(STEP.setConfig, 'set-config');
  assert.equal(STEP.policy, 'policy');
  assert.equal(Object.keys(STEP).length, STEP_NAMES.length);
  for (const o of [STEP_NAMES, STEP, OUTCOMES, STOP_CLASSES]) assert.ok(Object.isFrozen(o));
  assert.deepEqual(Object.values(OUTCOMES).sort(),
    ['blocked', 'express-escalated', 'pending-review', 'refused']);
});

test('AC5.2: sink holds pre-run-dir lines and flushes them first', () => {
  const out = []; const files = {};
  const sink = createEventSink({ stdout: (s) => out.push(s), appendFile: (p, s) => { files[p] = (files[p] || '') + s; } });
  sink.emit({ step: 'policy', run: null }); sink.emit({ step: 'claim', run: null });
  assert.deepEqual(files, {});
  sink.bindRunDir('/r'); sink.emit({ step: 'worktree', run: 'r' });
  assert.equal(files[path.join('/r', 'driver-events.jsonl')], out.join(''));
  assert.deepEqual(sink.events().map((e) => e.step), ['policy', 'claim', 'worktree']);
  assert.ok(out.every((l) => l.endsWith('\n') && !l.slice(0, -1).includes('\n')));
});

test('sink: a failed flush keeps the held lines and writes them, in order, at the next emit', () => {
  const out = []; const files = {};
  let failNext = true;
  const appendFile = (p, s) => {
    if (failNext) { failNext = false; throw new Error('EAGAIN: try again'); }
    files[p] = (files[p] || '') + s;
  };
  const sink = createEventSink({ stdout: (s) => out.push(s), appendFile });
  sink.emit({ step: 'policy' }); sink.emit({ step: 'claim' });
  assert.doesNotThrow(() => sink.bindRunDir('/r'));
  assert.equal(files[path.join('/r', 'driver-events.jsonl')], undefined);
  assert.equal(sink.fileError(), 'EAGAIN: try again');
  sink.emit({ step: 'run-dir' });
  assert.equal(out.length, 3);
  assert.equal(files[path.join('/r', 'driver-events.jsonl')], out.join(''));
  assert.equal(sink.fileError(), 'EAGAIN: try again', 'the first error is kept');
});

test('sink: an appendFile that always throws never aborts, stdout keeps every line, the first error is kept', () => {
  const out = [];
  let n = 0;
  const sink = createEventSink({ stdout: (s) => out.push(s), appendFile: () => { n += 1; throw new Error(`EACCES ${n}`); } });
  assert.equal(sink.fileError(), null);
  sink.emit({ step: 'policy' });
  assert.doesNotThrow(() => sink.bindRunDir('/r'));
  assert.doesNotThrow(() => sink.emit({ step: 'worktree' }));
  assert.equal(out.length, 2);
  assert.equal(sink.fileError(), 'EACCES 1');
});

// --- the shared fake-runner harness -------------------------------------------------
//
// harness(over) -> { deps, calls, out, err, files, lines(), writes(), probes, signals }.
// Every injected call is recorded in order in `calls` as { kind, args, cwd }:
//   gh (args), ghBatch (args: one aliased GraphQL batch under the batch bound), git (args,
//   cwd), node ([script, ...args], cwd), and the object-taking deps
//   with their arguments as `args`: policy (keys), eligibility ([issue, opts]),
//   native-deps ([opts]), linked-prs ([opts]), admission ([input]), worker ([opts, deps]),
//   resolveRunDir ([opts]), lstatType ([p]), readdir ([p]); plus the write seams
//   writeFile, appendFile, mkdirSync ([path, …]) and terminate ([signal]).
// A call is answered by the first `script` entry whose matcher accepts it. An entry is
// [matcher, reply]: reply is a value, an Error (thrown) or fn(call) -> value (may throw).
// `over.script` entries come before the defaults, so a test overrides by prepending. An
// unanswered call throws `unexpected {kind} {args}`.
// Shortcuts: over.policy (values merged over POLICY), over.eligibility / over.admission /
// over.nativeDeps / over.linkedPRs (an object, or fn(call) -> object, merged over the
// default answer), over.remoteUrl, over.ghAvailable, over.gitAvailable, and over.deps
// (merged over every fake last).
// Clock: deps.now advances 1 ms per read; deps.sleep resolves at once and advances it.

const FIXTURE_ROOTS = [];
test.after(() => { for (const root of FIXTURE_ROOTS) fs.rmSync(root, { recursive: true, force: true }); });
function tmpDir(prefix) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  FIXTURE_ROOTS.push(root);
  return root;
}
// A main checkout: a directory holding a `.git` directory (mainCheckoutRoot's anchor).
const MAIN = tmpDir('drive-run-main-');
fs.mkdirSync(path.join(MAIN, '.git'));

const NOW = Date.UTC(2026, 10, 12, 10, 0, 0);
const REMOTE = 'https://github.com/acme/widgets.git';
const POLICY = {
  'express-driver': 'on',
  'express-driver-wall-clock-minutes': 30,
  'express-driver-spend-ceiling-dollars': 5,
  'merge-sensitive-paths': [],
  'integration-model': 'pr-first',
  'integration-branch': null,
  'verify-suite-slots': 1,
};

function issueFor(n) {
  return { number: n, title: `record ${n}`, body: `Body of #${n}.`, labels: [{ name: 'risk:low' }], state: 'OPEN' };
}

function on(kind, ...prefix) {
  return (c) => c.kind === kind && prefix.every((p, i) => (p instanceof RegExp ? p.test(String(c.args[i])) : c.args[i] === p));
}

const pick = (v, c) => (typeof v === 'function' ? v(c) : v);

function defaultScript(over) {
  const policy = { ...POLICY, ...(over.policy || {}) };
  return [
    [on('policy'), (c) => Object.fromEntries(c.args.map((k) => [k, { value: policy[k], source: 'policy' }]))],
    [on('gh', 'issue', 'view'), (c) => JSON.stringify(issueFor(Number(c.args.at(-1))))],
    [on('git', 'symbolic-ref'), 'origin/main\n'],
    [on('eligibility'), (c) => ({ number: c.args[0].number, eligible: true, reasons: [], keyFiles: ['a.js'], ...pick(over.eligibility, c) })],
    [on('native-deps'), (c) => new Map(c.args[0].numbers.map((n) => [n, { blockedBy: [], openBlocker: false, openBlockerIds: [], ...pick(over.nativeDeps, c) }]))],
    [on('linked-prs'), (c) => new Map(c.args[0].numbers.map((n) => [n, { openPR: null, mentions: [], ...pick(over.linkedPRs, c) }]))],
    [on('admission'), (c) => ({ admitted: true, reasons: [], ...pick(over.admission, c) })],
  ];
}

function describeArgs(args) {
  return args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
}

function harness(over = {}) {
  const calls = [];
  const out = [];
  const err = [];
  const files = {};
  const signals = [];
  const state = { probes: 0, clock: NOW };
  const script = [...(over.script || []), ...defaultScript(over)];
  function dispatch(kind, args, cwd) {
    const call = { kind, args, cwd };
    calls.push(call);
    for (const [match, reply] of script) {
      if (!match(call)) continue;
      if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply(call) : reply;
    }
    throw new Error(`unexpected ${kind} ${describeArgs(args)}`);
  }
  const record = (kind, args) => { calls.push({ kind, args, cwd: undefined }); };
  const deps = {
    cwd: () => MAIN,
    gh: (args) => dispatch('gh', args),
    ghBatch: (args) => dispatch('ghBatch', args),
    git: (args, opts = {}) => dispatch('git', args, opts.cwd),
    node: (script_, args, opts = {}) => dispatch('node', [script_, ...args], opts.cwd),
    resolvePolicy: (keys) => dispatch('policy', keys),
    evaluateRecordEligibility: (issue, opts) => dispatch('eligibility', [issue, opts]),
    fetchNativeDependencies: (opts) => dispatch('native-deps', [opts]),
    fetchLinkedPRs: (opts) => dispatch('linked-prs', [opts]),
    evaluateAdmission: (input) => dispatch('admission', [input]),
    launchWorker: (opts, d) => dispatch('worker', [opts, d]),
    resolveRunDir: (opts) => dispatch('resolveRunDir', [opts]),
    lstatType: (p) => dispatch('lstatType', [p]),
    readdir: (p) => dispatch('readdir', [p]),
    writeFile: (p, s) => { record('writeFile', [p]); files[p] = s; },
    appendFile: (p, s) => { record('appendFile', [p]); files[p] = (files[p] || '') + s; },
    mkdirSync: (p, o) => { record('mkdirSync', [p, o]); },
    remoteUrl: () => (over.remoteUrl === undefined ? REMOTE : pick(over.remoteUrl)),
    ghAvailable: () => { state.probes += 1; return over.ghAvailable === undefined ? true : over.ghAvailable; },
    gitAvailable: () => { state.probes += 1; return over.gitAvailable === undefined ? true : over.gitAvailable; },
    platform: 'darwin',
    env: {},
    now: () => { state.clock += 1; return state.clock; },
    date: () => new Date(state.clock),
    sleep: async (ms) => { state.clock += ms; },
    onSignal: (handler) => { signals.push(handler); return () => { signals.splice(signals.indexOf(handler), 1); }; },
    terminate: (sig) => record('terminate', [sig]),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...(over.deps || {}),
  };
  const lines = () => out.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const writes = () => calls.filter((c) => ['writeFile', 'appendFile', 'mkdirSync', 'resolveRunDir'].includes(c.kind));
  return {
    deps, calls, out, err, files, signals, lines, writes,
    get probes() { return state.probes; },
  };
}

const finals = (h) => h.lines().filter((l) => l.step === FINAL_STEP);

// --- invocation -----------------------------------------------------------------------

test('AC10.1: malformed invocation exits 2 with usage', async () => {
  for (const argv of [[], ['#x'], ['0'], ['#'], ['#0'], ['-3'], ['1.5'], ['7a'], ['--bogus'], ['99999999999999999999']]) {
    const h = harness();
    assert.equal(await run(argv, h.deps), 2, JSON.stringify(argv));
    assert.match(h.err.join(''), /Usage: drive\.js #N/);
    assert.equal(h.calls.length, 0);
    assert.equal(h.probes, 0, 'no probe before the argument check');
    assert.deepEqual(h.out, []);
  }
});

test('AC10.2: --help exits 0 before any probe', async () => {
  for (const argv of [['--help'], ['-h'], ['#7', '--help']]) {
    const h = harness();
    assert.equal(await run(argv, h.deps), 0);
    assert.equal(h.calls.length, 0);
    assert.equal(h.probes, 0);
    assert.equal(h.out.join(''), USAGE);
  }
});

test('parseArgs: #N or N, positive integers, de-duplicated in given order', () => {
  assert.deepEqual(parseArgs(['#7', '8', '#7', '9', '8']), { records: [7, 8, 9] });
  assert.deepEqual(parseArgs(['--help']), { help: true });
  for (const argv of [[], ['#'], ['0'], ['#-1'], [''], [' 7'], ['#7x']]) {
    assert.equal(typeof parseArgs(argv).error, 'string', JSON.stringify(argv));
  }
});

test('AC10.3, AC10.5: absent gh or git exits 2', async () => {
  for (const [over, re] of [[{ ghAvailable: false }, /\bgh\b/], [{ gitAvailable: false }, /\bgit\b/]]) {
    const h = harness(over);
    assert.equal(await run(['#7'], h.deps), 2);
    assert.match(h.err.join(''), re);
    assert.equal(h.calls.length, 0, 'no gh, git or policy call');
    assert.deepEqual(h.out, []);
  }
});

test('AC10.6: header comment and USAGE state exit codes 0, 1 and 2', () => {
  const header = fs.readFileSync(DRIVE, 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n');
  for (const text of [USAGE, header]) {
    assert.match(text, /Usage: drive\.js #N \[#M…\]/);
    assert.match(text, /\b0\s+every named record reached its final event, whatever its outcome/);
    assert.match(text, /\b1\s+when the policy, or the run's repository or integration branch, cannot be resolved and no further record is attempted/);
    assert.match(text, /\b2\s+malformed invocation \(no record reference, a non-numeric one\) or gh or git absent, or an internal error/);
    assert.match(text, /drive\.js --help \| -h/);
  }
  assert.match(USAGE.split('\n')[0], /^Usage: drive\.js #N \[#M…\]$/);
});

test('drive.js main: a rejected run is exit 2 with the message on stderr, never an unhandled rejection', async () => {
  const { main } = require(DRIVE);
  const proc = (err) => ({ exitCode: undefined, stderr: { write: (s) => err.push(s) } });
  const err = [];
  const p = proc(err);
  const h = harness({ deps: { ghAvailable: () => { throw new Error('probe exploded'); } } });
  await main(['#7'], h.deps, p);
  assert.equal(p.exitCode, 2);
  assert.match(err.join(''), /^drive\.js: internal error: probe exploded\n$/);
  const ok = proc([]);
  await main(['--help'], harness().deps, ok);
  assert.equal(ok.exitCode, 0);
  const fatal = proc([]);
  await main(['#7'], harness({ script: [[on('policy'), { 'express-driver': { error: 'unknown-key' } }]] }).deps, fatal);
  assert.equal(fatal.exitCode, 1);
});

test('drive.js is a thin entry: it exports run, and its async guard sets the exit code', () => {
  assert.equal(require(DRIVE).run, run);
  const help = spawnSync(process.execPath, [DRIVE, '--help'], { encoding: 'utf8', windowsHide: true });
  assert.equal(help.status, 0);
  assert.equal(help.stdout, USAGE);
  const bad = spawnSync(process.execPath, [DRIVE, '#x'], { encoding: 'utf8', windowsHide: true });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Usage: drive\.js #N/);
});

// --- refusals before the claim -----------------------------------------------------------

test('AC1.1, AC5.4: express-driver off refuses, writes nothing, one refusal event', async () => {
  const h = harness({ policy: { 'express-driver': 'off' }, admission: { admitted: false, reasons: ['express-driver off'] } });
  assert.equal(await run(['#7'], h.deps), 0);
  const lines = h.lines();
  const final = lines.at(-1);
  assert.equal(final.step, FINAL_STEP);
  assert.equal(final.outcome, 'refused');
  assert.equal(final.stop.step, 'admission');
  assert.equal(final.stop.class, 'refused');
  assert.match(final.stop.detail, /express-driver off/);
  assert.equal(h.calls.find((c) => c.kind === 'admission').args[0].routing, 'off');
  assert.deepEqual(h.writes(), []);
  assert.equal(h.calls.filter((c) => c.kind === 'node').length, 0);
  assert.equal(h.calls.filter((c) => c.kind === 'git' && c.args[0] !== 'symbolic-ref').length, 0);
  assert.deepEqual(lines.filter((l) => l.status !== 'ok' && l.step !== FINAL_STEP).map((l) => l.step), ['admission']);
  assert.ok(lines.every((l) => l.run === null && l.record === 7));
});

test('AC1.2: ineligible record names every reason', async () => {
  const h = harness({ eligibility: { eligible: false, reasons: ['risk is not low', 'size is not low'] } });
  assert.equal(await run(['#7'], h.deps), 0);
  const final = h.lines().at(-1);
  assert.equal(final.outcome, 'refused');
  assert.equal(final.stop.step, 'eligibility');
  assert.equal(final.status, 'stop');
  assert.equal(final.stop.detail, 'risk is not low; size is not low');
  assert.equal(h.calls.filter((c) => c.kind === 'admission').length, 0);
  assert.deepEqual(h.writes(), []);
});

test('eligibility runs with the relaxed ceremony gate and the policy values', async () => {
  const h = harness({ policy: { 'merge-sensitive-paths': ['plugin/bin/**', 'docs/**'], 'integration-model': 'local-merge' } });
  await run(['#7'], h.deps);
  const [issue, opts] = h.calls.find((c) => c.kind === 'eligibility').args;
  assert.deepEqual(issue, issueFor(7));
  assert.deepEqual(opts, { enabled: true, allowAbsentCeremony: true, integrationModel: 'local-merge', sensitivePaths: ['plugin/bin/**', 'docs/**'] });
});

test('AC1.3: failed fetch refuses with the fetch error', async () => {
  const thrown = Object.assign(new Error('Command failed: gh issue view'), { stderr: 'HTTP 404: Not Found\n' });
  for (const reply of [new Error('HTTP 404'), thrown]) {
    const h = harness({ script: [[on('gh', 'issue', 'view'), reply]] });
    assert.equal(await run(['#7'], h.deps), 0);
    const final = h.lines().at(-1);
    assert.equal(final.outcome, 'refused');
    assert.equal(final.stop.step, 'fetch');
    assert.equal(final.status, 'fail');
    assert.match(final.stop.detail, /HTTP 404/);
    assert.deepEqual(h.writes(), []);
  }
});

test('a fetch that returns something other than the record refuses at fetch', async () => {
  for (const reply of ['not json', JSON.stringify(issueFor(8)), 'null']) {
    const h = harness({ script: [[on('gh', 'issue', 'view'), reply]] });
    await run(['#7'], h.deps);
    const final = h.lines().at(-1);
    assert.equal(final.stop.step, 'fetch', reply);
    assert.equal(final.outcome, 'refused');
  }
});

test('AC2.2: one record fetch per record', async () => {
  const h = harness();
  assert.equal(await run(['#7'], h.deps), 0);
  const fetches = h.calls.filter((c) => c.kind === 'gh' && c.args[0] === 'issue' && c.args[1] === 'view');
  assert.equal(fetches.length, 1);
  assert.deepEqual(fetches[0].args, ['issue', 'view', '--json', 'number,title,body,labels,state', '--', '7']);
});

test('admission reads blockers and linked PRs from the shared repo and passes them on', async () => {
  const crossRepoBlockers = [{ number: 4, repository: 'other/repo', state: 'OPEN' }];
  const entry = { openBlockerIds: [3], crossRepoBlockers };
  const h = harness({
    remoteUrl: 'git@acme.ghe.com:acme/widgets.git',
    nativeDeps: entry,
    linkedPRs: { openPR: 12 },
    script: [
      [on('native-deps'), (c) => { c.args[0].runner(['api', 'graphql', '-f', 'query=blockers']); return new Map([[7, entry]]); }],
      [on('linked-prs'), (c) => { c.args[0].runner(['api', 'graphql', '-f', 'query=linked']); return new Map([[7, { openPR: 12, mentions: [] }]]); }],
      [on('ghBatch', 'api', 'graphql'), '{}'],
    ],
  });
  assert.equal(await run(['#7'], h.deps), 0);
  for (const kind of ['native-deps', 'linked-prs']) {
    const opts = h.calls.find((c) => c.kind === kind).args[0];
    assert.deepEqual({ ...opts, runner: typeof opts.runner }, { numbers: [7], owner: 'acme', repo: 'widgets', host: 'acme.ghe.com', runner: 'function' });
  }
  // Both GraphQL reads run under the batch bound (deps.ghBatch), never the single-call gh.
  assert.deepEqual(h.calls.filter((c) => c.kind === 'ghBatch').map((c) => c.args.at(-1)), ['query=blockers', 'query=linked']);
  assert.equal(h.calls.filter((c) => c.kind === 'gh' && c.args[0] === 'api').length, 0);
  assert.deepEqual(h.calls.find((c) => c.kind === 'admission').args[0], {
    number: 7, state: 'OPEN', labels: [{ name: 'risk:low' }],
    openBlockerRefs: openBlockerRefs(entry), openLinkedPRs: [12], routing: 'on',
  });
  assert.equal(h.lines().at(-1).outcome, 'pending-review');
});

test('admission: no open linked PR passes an empty list; refusal names every reason', async () => {
  const h = harness({ admission: { admitted: false, reasons: ['state is CLOSED', 'open blocker #3'] } });
  await run(['#7'], h.deps);
  assert.deepEqual(h.calls.find((c) => c.kind === 'admission').args[0].openLinkedPRs, []);
  const final = h.lines().at(-1);
  assert.equal(final.outcome, 'refused');
  assert.equal(final.stop.step, 'admission');
  assert.equal(final.stop.detail, 'state is CLOSED; open blocker #3');
});

test('admission: a map with no entry for the record passes null, never "none"', async () => {
  for (const [kind, field, other] of [['native-deps', 'openBlockerRefs', 'openLinkedPRs'], ['linked-prs', 'openLinkedPRs', 'openBlockerRefs']]) {
    const h = harness({
      script: [[on(kind), new Map()]],
      admission: (c) => (c.args[0][field] === null ? { admitted: false, reasons: [`${field} unreadable`] } : {}),
    });
    await run(['#7'], h.deps);
    const input = h.calls.find((c) => c.kind === 'admission').args[0];
    assert.equal(input[field], null, kind);
    assert.deepEqual(input[other], [], `${kind}: the other read is still passed as read`);
    const final = h.lines().at(-1);
    assert.equal(final.outcome, 'refused');
    assert.equal(final.stop.detail, `${field} unreadable`);
  }
});

test('admission: a failed blocker or linked-PR read is a refused fail', async () => {
  for (const kind of ['native-deps', 'linked-prs']) {
    const h = harness({ script: [[on(kind), new Error('missing repository — no dependency data for #7')]] });
    assert.equal(await run(['#7'], h.deps), 0);
    const final = h.lines().at(-1);
    assert.equal(final.stop.step, 'admission', kind);
    assert.equal(final.status, 'fail');
    assert.equal(final.stop.class, 'refused');
    assert.equal(final.outcome, 'refused');
    assert.match(final.stop.detail, /missing repository/);
    assert.equal(h.calls.filter((c) => c.kind === 'admission').length, 0);
  }
});

// --- the policy step and the run's shared values ------------------------------------------

test('AC10.4: unreadable policy exits 1 and attempts no further record', async () => {
  for (const reply of [{ 'express-driver': { error: 'unknown-key' } }, new Error('policy.yml: bad indentation')]) {
    const h = harness({ script: [[on('policy'), reply]] });
    assert.equal(await run(['#7', '#8'], h.deps), 1);
    const lines = h.lines();
    assert.equal(lines.filter((l) => l.record === 8).length, 0);
    const final = lines.at(-1);
    assert.equal(final.outcome, 'refused');
    assert.equal(final.stop.step, 'policy');
    assert.equal(final.status, 'fail');
    assert.match(final.stop.detail, reply instanceof Error ? /bad indentation/ : /express-driver \(unknown-key\)/);
    assert.equal(h.calls.filter((c) => c.kind === 'gh').length, 0);
  }
});

test('the policy step reads every key once per run; a later record reuses it', async () => {
  const h = harness();
  assert.equal(await run(['#7', '#8'], h.deps), 0);
  const reads = h.calls.filter((c) => c.kind === 'policy');
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0].args, Object.keys(POLICY));
  const policyLines = h.lines().filter((l) => l.step === 'policy');
  assert.deepEqual(policyLines.map((l) => [l.record, l.status, l.detail]), [[7, 'ok', undefined], [8, 'ok', 'cached']]);
  assert.equal(h.calls.filter((c) => c.kind === 'git' && c.args[0] === 'symbolic-ref').length, 1);
});

test('the policy step resolves the main root, the origin repo and the integration ref', async () => {
  const h = harness();
  const shared = newShared();
  await driveRecord(7, shared, h.deps);
  assert.equal(shared.mainRoot, MAIN);
  assert.deepEqual(shared.repo, { host: 'github.com', owner: 'acme', repo: 'widgets' });
  assert.equal(shared.ref, 'main');
  const sym = h.calls.find((c) => c.kind === 'git');
  assert.deepEqual(sym.args, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  assert.equal(sym.cwd, MAIN);
  assert.equal(shared.fatal, false);

  const pinned = harness({ policy: { 'integration-branch': 'develop' } });
  const s2 = newShared();
  await driveRecord(7, s2, pinned.deps);
  assert.equal(s2.ref, 'develop');
  assert.equal(pinned.calls.filter((c) => c.kind === 'git').length, 0);

  const trunk = harness({ script: [[on('git', 'symbolic-ref'), 'origin/trunk\n']] });
  const s3 = newShared();
  await driveRecord(7, s3, trunk.deps);
  assert.equal(s3.ref, 'trunk');
});

test('an unresolvable main root, origin or integration ref is fatal: exit 1', async () => {
  const outside = tmpDir('drive-run-outside-');
  // No hosts.yml there, so git.corp.invalid is not a known GitHub host.
  const noGhConfig = { GH_CONFIG_DIR: tmpDir('drive-run-gh-config-') };
  const cases = [
    [{ deps: { cwd: () => outside } }, /main checkout root/],
    [{ remoteUrl: 'not a remote' }, /origin remote/],
    [{ remoteUrl: 'https://git.corp.invalid/acme/widgets.git', deps: { env: noGhConfig } }, /origin host git\.corp\.invalid is not a known GitHub host/],
    [{ remoteUrl: () => { throw new Error('No such remote'); } }, /No such remote/],
    [{ script: [[on('git', 'symbolic-ref'), new Error('ref refs/remotes/origin/HEAD is not a symbolic ref')]] }, /integration branch unresolvable/],
    [{ script: [[on('git', 'symbolic-ref'), '\n']] }, /integration branch unresolvable/],
    [{ policy: { 'integration-branch': '--upload-pack=x' } }, /integration branch unresolvable/],
  ];
  for (const [over, re] of cases) {
    const h = harness(over);
    assert.equal(await run(['#7', '#8'], h.deps), 1, String(re));
    const final = h.lines().at(-1);
    assert.equal(final.record, 7);
    assert.equal(final.stop.step, 'policy');
    assert.equal(final.outcome, 'refused');
    assert.match(final.stop.detail, re);
    assert.equal(h.calls.filter((c) => c.kind === 'gh').length, 0);
  }
});

// --- records in sequence ---------------------------------------------------------------------

test('AC9.1: a second record runs after the first is refused', async () => {
  const h = harness({ eligibility: (c) => (c.args[0].number === 7 ? { eligible: false, reasons: ['risk is not low'] } : {}) });
  assert.equal(await run(['#7', '#8'], h.deps), 0);
  assert.deepEqual(finals(h).map((f) => [f.record, f.outcome]), [[7, 'refused'], [8, 'pending-review']]);
  assert.equal(h.calls.filter((c) => c.kind === 'gh' && c.args[0] === 'issue').length, 2);
});

// --- the loop ------------------------------------------------------------------------------

test('every step emits one event line with the core fields; the final line carries the report', async () => {
  const h = harness();
  assert.equal(await run(['7'], h.deps), 0);
  const lines = h.lines();
  assert.deepEqual(lines.map((l) => l.step), [...STEPS.map((s) => s.name), FINAL_STEP]);
  for (const l of lines) {
    assert.deepEqual(Object.keys(l).slice(0, 6), ['ts', 'run', 'record', 'step', 'status', 'ms']);
    assert.ok(!Number.isNaN(Date.parse(l.ts)));
    assert.ok(Number.isInteger(l.ms) && l.ms >= 0);
  }
  const final = lines.at(-1);
  assert.equal(final.outcome, 'pending-review');
  assert.equal(final.status, 'ok');
  assert.equal(final.pr, null);
  assert.equal(final.ci, null);
  assert.equal(final.costUsd, null);
  assert.equal(final.turns, null);
  assert.equal(final.denialCount, null);
  assert.ok(Number.isInteger(final.msTotal) && final.msTotal > 0);
  assert.equal(final.msWithoutCi, final.msTotal);
  assert.deepEqual(final.stop, {
    step: null, class: 'none', pushed: false, created: { worktree: false, branch: false },
    reason: null, detail: null, checkLogged: null,
  });
  assert.equal('eventsFileError' in final, false);
});

test('STEPS is a frozen table whose names follow the event vocabulary in order', () => {
  assert.ok(Object.isFrozen(STEPS));
  assert.ok(STEPS.length >= 4);
  assert.deepEqual(STEPS.map((s) => s.name), STEP_NAMES.slice(0, STEPS.length));
  for (const s of STEPS) assert.equal(typeof s.run, 'function');
});

test('run.js names no step', () => {
  const src = fs.readFileSync(path.join(LIB, 'driver', 'run.js'), 'utf8');
  for (const name of STEP_NAMES) assert.doesNotMatch(src, new RegExp(`['"\`]${name}['"\`]`), name);
});

test('step constants', () => {
  assert.equal(TEST_COMMAND, 'npm test');
  assert.equal(CI_WAIT_BOUND_MS, 30 * 60 * 1000);
  assert.equal(CI_POLL_INTERVAL_MS, 30 * 1000);
  assert.equal(WIN32_CLAUDE_BIN, 'claude.cmd');
});

test('defineStep: a throw is a fail with the step class; the wrapper records the running step', async () => {
  const seen = [];
  const table = [
    defineStep('one', 'refused', async (ctx) => { seen.push([ctx.currentStep, ctx.currentStopClass]); return { status: 'ok' }; }),
    defineStep('two', 'pre-push', async (ctx) => { seen.push([ctx.currentStep, ctx.currentStopClass]); throw new Error('boom'); }),
    defineStep('three', 'none', async () => { throw new Error('never reached'); }),
  ];
  const h = harness();
  const final = await driveRecord(7, newShared(), h.deps, table);
  assert.deepEqual(seen, [['one', 'refused'], ['two', 'pre-push']]);
  assert.deepEqual(h.lines().map((l) => [l.step, l.status]), [['one', 'ok'], ['two', 'fail'], [FINAL_STEP, 'fail']]);
  assert.equal(final.outcome, 'express-escalated');
  assert.deepEqual([final.stop.step, final.stop.class, final.stop.reason, final.stop.detail], ['two', 'pre-push', 'fail', 'boom']);
});

test('defineStep: a result may override its class, carry extra fields and decline to halt', async () => {
  const table = [
    defineStep('soft', 'pre-push', async () => ({ status: 'fail', halt: false, detail: 'logged nothing', extra: { ciWaitMs: 5, step: 'forged', ms: -1 } })),
    defineStep('gate', 'pre-push', async () => ({ status: 'stop', stopClass: 'blocked', detail: 'no' })),
  ];
  const h = harness();
  const final = await driveRecord(7, newShared(), h.deps, table);
  const [soft, gate] = h.lines();
  assert.equal(soft.step, 'soft');
  assert.ok(soft.ms >= 0);
  assert.equal(soft.ciWaitMs, 5);
  assert.equal(soft.detail, 'logged nothing');
  assert.equal(gate.step, 'gate');
  assert.equal(final.outcome, 'blocked');
  assert.deepEqual([final.stop.step, final.stop.class, final.stop.reason], ['gate', 'blocked', 'stop']);
  assert.equal(final.msWithoutCi, final.msTotal - 5);
});

test('defineStep: a result with no valid status or stop class is a fail with the step class', async () => {
  for (const [result, re] of [[{ status: 'maybe' }, /invalid status/], [undefined, /invalid status/], [{ status: 'stop', stopClass: 'other' }, /invalid stop class/]]) {
    const h = harness();
    const final = await driveRecord(7, newShared(), h.deps, [defineStep('odd', 'refused', async () => result)]);
    assert.equal(final.stop.step, 'odd');
    assert.equal(final.stop.class, 'refused');
    assert.equal(h.lines()[0].status, 'fail');
    assert.match(final.stop.detail, re);
  }
  assert.throws(() => defineStep('bad', 'other', async () => ({ status: 'ok' })), /unknown stop class/);
});

test('the loop binds the sink when a step first sets ctx.runDir; earlier events go first', async () => {
  const table = [
    defineStep('before', 'refused', async () => ({ status: 'ok' })),
    defineStep('mint', 'claim', async (ctx) => { ctx.runId = 'rid-7'; ctx.runDir = '/runs/rid-7'; return { status: 'ok' }; }),
    defineStep('after', 'pre-push', async () => ({ status: 'ok' })),
  ];
  const h = harness();
  const final = await driveRecord(7, newShared(), h.deps, table);
  assert.deepEqual(h.lines().map((l) => l.run), [null, 'rid-7', 'rid-7', 'rid-7']);
  assert.equal(h.files[path.join('/runs/rid-7', 'driver-events.jsonl')], h.out.join(''));
  assert.equal(final.run, 'rid-7');
});

test('shared.current exposes the running record\'s ctx and sink, and is cleared after it', async () => {
  const seen = [];
  const table = [defineStep('look', 'refused', async (ctx) => {
    const { current } = ctx.shared;
    seen.push(current && current.ctx === ctx, current && typeof current.sink.emit === 'function');
    current.sink.emit({ step: 'probe' });
    return { status: 'ok' };
  })];
  const h = harness();
  const shared = newShared();
  assert.equal(shared.current, null);
  await driveRecord(7, shared, h.deps, table);
  assert.deepEqual(seen, [true, true]);
  assert.equal(shared.current, null);
  assert.deepEqual(h.lines().map((l) => l.step), ['probe', 'look', FINAL_STEP], 'the exposed sink is the record\'s own');
});

test('a failing events file never aborts the record; the final line names the error', async () => {
  const table = [
    defineStep('mint', 'claim', async (ctx) => { ctx.runId = 'rid-7'; ctx.runDir = '/runs/rid-7'; return { status: 'ok' }; }),
    defineStep('after', 'pre-push', async () => ({ status: 'ok' })),
  ];
  const h = harness({ deps: { appendFile: () => { throw new Error('EACCES: permission denied'); } } });
  const final = await driveRecord(7, newShared(), h.deps, table);
  assert.deepEqual(h.lines().map((l) => l.step), ['mint', 'after', FINAL_STEP]);
  assert.equal(final.outcome, 'pending-review');
  assert.equal(final.eventsFileError, 'EACCES: permission denied');
  assert.equal(h.lines().at(-1).eventsFileError, 'EACCES: permission denied');
});
