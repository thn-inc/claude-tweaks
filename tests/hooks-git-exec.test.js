// tests/hooks-git-exec.test.js — the shared git spawn wrapper behind every
// hooks/ module. It had no suite of its own before #134, which is part of why
// the timeout branch went unexamined for so long: nothing ever exercised it.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runGit, runGitAsync, isIndeterminate, FAILURE, DEFAULT_TIMEOUT_MS } = require('../plugin/bin/lib/hooks/git-exec');
const { gitRepo } = require('./helpers/git-fixtures');

test('runGit: success returns trimmed stdout and a null failure', () => {
  const dir = gitRepo();
  const { stdout, failure } = runGit(['rev-parse', '--show-toplevel'], dir);
  assert.strictEqual(failure, null);
  assert.strictEqual(stdout, fs.realpathSync(dir));
  assert.ok(!stdout.endsWith('\n'), 'stdout must be trimmed');
});

test('runGit: a non-git directory is git-error — git ANSWERED, in the negative', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ct-ge-nongit-'));
  const { stdout, failure } = runGit(['rev-parse', '--show-toplevel'], dir);
  assert.strictEqual(stdout, null);
  assert.strictEqual(failure, FAILURE.GIT_ERROR);
  assert.strictEqual(isIndeterminate(failure), false,
    'git exiting non-zero is a real answer — a caller may act on it');
});

// #1341 — runGit used to discard stderr entirely (`stdio: [..., 'ignore']`),
// so a residue-escalation issue's "Last error" line could only ever read the
// bare category name (`git-error`), never git's actual message. This pins
// the fix: real stderr text comes back, and the four FAILURE.* category
// values a caller switches on are untouched by adding it.
test('runGit: a failing invocation returns git\'s real stderr text alongside the existing failure category', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ct-ge-stderr-'));
  const { stdout, failure, stderr } = runGit(['rev-parse', '--show-toplevel'], dir);
  assert.strictEqual(stdout, null);
  assert.strictEqual(failure, FAILURE.GIT_ERROR);
  assert.ok(typeof stderr === 'string' && stderr.length > 0, 'stderr must be a non-empty captured string');
  assert.match(stderr, /not a git repository/,
    'stderr must carry git\'s actual message, not just a coarse category');
});

test('runGit: adding stderr capture leaves the four FAILURE.* category values unchanged', () => {
  assert.deepStrictEqual(
    { TIMEOUT: FAILURE.TIMEOUT, SPAWN: FAILURE.SPAWN, NO_GIT: FAILURE.NO_GIT, GIT_ERROR: FAILURE.GIT_ERROR },
    { TIMEOUT: 'timeout', SPAWN: 'spawn', NO_GIT: 'no-git', GIT_ERROR: 'git-error' },
  );
});

test('runGit: success returns a null stderr, matching the null-on-failure stdout convention', () => {
  const dir = gitRepo();
  const { failure, stderr } = runGit(['rev-parse', '--show-toplevel'], dir);
  assert.strictEqual(failure, null);
  assert.strictEqual(stderr, null);
});

test('runGit: a blown budget is timeout, and timeout is indeterminate (#134)', () => {
  const dir = gitRepo();
  // 1ms cannot complete any real git invocation, so this deterministically
  // exercises the branch that fired non-deterministically under load.
  const { stdout, failure } = runGit(['rev-parse', '--show-toplevel'], dir, { timeoutMs: 1 });
  assert.strictEqual(stdout, null);
  assert.strictEqual(failure, FAILURE.TIMEOUT);
  assert.strictEqual(isIndeterminate(failure), true,
    'a timeout means the question went unanswered — a caller must NOT read it as a negative');
});

test('runGit: the timeout and non-git cases are distinguishable from each other', () => {
  // The single assertion that would have prevented #134. Before this change
  // both of these produced an identical `null`, so no caller could tell a
  // transient load spike from a permanent fact about the filesystem.
  const repo = gitRepo();
  const nonGit = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ct-ge-cmp-'));

  const timedOut = runGit(['rev-parse', '--show-toplevel'], repo, { timeoutMs: 1 });
  const notARepo = runGit(['rev-parse', '--show-toplevel'], nonGit);

  assert.strictEqual(timedOut.stdout, notARepo.stdout, 'both still yield no stdout');
  assert.notStrictEqual(timedOut.failure, notARepo.failure,
    'but the FAILURE KIND must differ — that difference is the entire fix');
  assert.notStrictEqual(isIndeterminate(timedOut.failure), isIndeterminate(notARepo.failure));
});

test('runGit: always returns an object, never null, on every path', () => {
  // The old contract returned `string | null`. Callers testing `if (!out)` were
  // correct then and would be silently WRONG now, so the rename to runGit is
  // load-bearing. This pins the new contract so a future revert to a nullable
  // return has to fail a test rather than fail a gate in production.
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ct-ge-shape-'));
  for (const result of [
    runGit(['rev-parse', '--show-toplevel'], gitRepo()),
    runGit(['rev-parse', '--show-toplevel'], dir),
    runGit(['rev-parse', '--show-toplevel'], dir, { timeoutMs: 1 }),
    runGit(['definitely-not-a-git-subcommand'], dir),
  ]) {
    assert.strictEqual(typeof result, 'object');
    assert.ok(result !== null);
    assert.ok('stdout' in result && 'failure' in result);
  }
});

test('isIndeterminate: success (null failure) is not indeterminate', () => {
  assert.strictEqual(isIndeterminate(null), false);
});

// runGitAsync (#872) — the non-blocking twin runGit's own header describes,
// added for reconcile/index.js's FAST_CHECKS Promise.all. Same contract,
// same classify(), just awaited — mirrored against a subset of runGit's own
// scenarios above rather than the full suite, since the classification
// logic (classify()) is shared code, not reimplemented.

test('runGitAsync: success returns trimmed stdout and a null failure', async () => {
  const dir = gitRepo();
  const { stdout, failure, stderr } = await runGitAsync(['rev-parse', '--show-toplevel'], dir);
  assert.strictEqual(failure, null);
  assert.strictEqual(stdout, fs.realpathSync(dir));
  assert.strictEqual(stderr, null, 'runGitAsync must match runGit\'s success shape: stderr is null, not omitted');
});

test('runGitAsync: a non-git directory is git-error — git ANSWERED, in the negative', async () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ct-ge-async-nongit-'));
  const { stdout, failure, stderr } = await runGitAsync(['rev-parse', '--show-toplevel'], dir);
  assert.strictEqual(stdout, null);
  assert.strictEqual(failure, FAILURE.GIT_ERROR);
  // whole-branch review finding (pre-v6.110.0): runGitAsync previously
  // omitted `stderr` entirely despite the header comment's "identical return
  // shape" claim — a caller destructuring it (the pattern runGit's own
  // callers already use) got `undefined` instead of git's real error text.
  assert.strictEqual(typeof stderr, 'string', 'runGitAsync must surface stderr as a string, matching runGit\'s failure shape');
});

test('runGitAsync: a blown budget is timeout, and timeout is indeterminate (#134)', async () => {
  // Unlike runGit's own version of this test above, a real `timeoutMs: 1`
  // race against a real `git rev-parse` is NOT reliable here: on a fast,
  // cache-warm CI runner the async child can complete before the 1ms JS
  // timer callback is serviced, so the real command sometimes "wins" the
  // race and this test observed a genuine (not one of the pre-authorized)
  // flake on GitHub Actions. Mock a hung child instead, so the assertion
  // exercises the TIMEOUT classification branch deterministically,
  // regardless of host speed.
  const cp = require('child_process');
  const { promisify } = require('util');
  const original = cp.execFile;
  // git-exec.js resolves `cp.execFile` at call time (promisify(cp.execFile)
  // inside runGitAsync, not hoisted to module scope) specifically so this
  // plain property reassignment is observed without needing a require.cache
  // eviction — same call-time-resolution contract runGit's own
  // `cp.execFileSync` already relies on.
  const stub = () => {};
  stub[promisify.custom] = () => new Promise((_resolve, reject) => {
    const err = new Error('Command failed: git');
    err.killed = true;
    err.signal = 'SIGTERM';
    setImmediate(() => reject(err));
  });
  cp.execFile = stub;
  try {
    const dir = gitRepo();
    const { stdout, failure } = await runGitAsync(['rev-parse', '--show-toplevel'], dir, { timeoutMs: 1 });
    assert.strictEqual(stdout, null);
    assert.strictEqual(failure, FAILURE.TIMEOUT);
    assert.strictEqual(isIndeterminate(failure), true);
  } finally {
    cp.execFile = original;
  }
});

test('runGitAsync: always returns an object, never null, on every path', async () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ct-ge-async-shape-'));
  // #2500 review: this third call races a real subprocess against a real
  // `timeoutMs: 1`, the same shape as the two CT_HOOKS_GIT_TIMEOUT_MS tests
  // above that needed a mock-based rewrite — but unlike those, it does NOT
  // share their flake: `dir` is a non-git tempdir, so the call resolves to
  // either FAILURE.TIMEOUT or a git-error failure depending on load, and the
  // loop below only asserts result *shape* (stdout/failure/stderr keys
  // present), never which failure kind won the race. No rewrite needed.
  for (const result of await Promise.all([
    runGitAsync(['rev-parse', '--show-toplevel'], gitRepo()),
    runGitAsync(['rev-parse', '--show-toplevel'], dir),
    runGitAsync(['rev-parse', '--show-toplevel'], dir, { timeoutMs: 1 }),
  ])) {
    assert.strictEqual(typeof result, 'object');
    assert.ok(result !== null);
    // 'stderr' is asserted alongside the other two (whole-branch review
    // finding, pre-v6.110.0) so a future field drift between runGit and its
    // async twin fails here, not just in the two shape-specific tests above.
    assert.ok('stdout' in result && 'failure' in result && 'stderr' in result);
  }
});

test('runGit: CT_HOOKS_GIT_TIMEOUT_MS env override raises the budget when opts.timeoutMs is not given (#104)', (t) => {
  // #2500: this used to race a real `timeoutMs: 1` override against a real
  // `git rev-parse` subprocess, which flaked under contended machine load
  // (the subprocess occasionally completed inside 1ms). git-exec.js's own
  // header comment names the fix: `cp.execFileSync` is resolved at call
  // time specifically so a test can intercept it — mock it to throw a
  // synthetic timeout error, and assert on the `timeout` option the mock
  // actually observed, so the env-var-vs-opts precedence logic under test
  // still runs for real, just without any wall-clock dependence.
  const cp = require('child_process');
  const dir = gitRepo();
  const prior = process.env.CT_HOOKS_GIT_TIMEOUT_MS;
  process.env.CT_HOOKS_GIT_TIMEOUT_MS = '1';
  const mock = t.mock.method(cp, 'execFileSync', () => {
    const e = new Error('mock timeout');
    e.killed = true;
    e.signal = 'SIGTERM';
    throw e;
  });
  try {
    const { failure } = runGit(['rev-parse', '--show-toplevel'], dir);
    assert.strictEqual(failure, FAILURE.TIMEOUT);
    assert.strictEqual(mock.mock.calls.length, 1);
    assert.strictEqual(mock.mock.calls[0].arguments[2].timeout, 1,
      'the env override must reach execFileSync\'s own timeout option');
  } finally {
    if (prior === undefined) delete process.env.CT_HOOKS_GIT_TIMEOUT_MS;
    else process.env.CT_HOOKS_GIT_TIMEOUT_MS = prior;
  }
});

test('runGit: an explicit opts.timeoutMs still wins over CT_HOOKS_GIT_TIMEOUT_MS', (t) => {
  // Tests that force the timeout branch deterministically via opts.timeoutMs
  // (e.g. the #134 tests above) must not be silently overridden by whatever
  // this env var happens to be set to in the running test process. Same
  // mock-based rewrite as the test above (#2500) — see its comment.
  const cp = require('child_process');
  const dir = gitRepo();
  const prior = process.env.CT_HOOKS_GIT_TIMEOUT_MS;
  process.env.CT_HOOKS_GIT_TIMEOUT_MS = '60000';
  const mock = t.mock.method(cp, 'execFileSync', () => {
    const e = new Error('mock timeout');
    e.killed = true;
    e.signal = 'SIGTERM';
    throw e;
  });
  try {
    const { failure } = runGit(['rev-parse', '--show-toplevel'], dir, { timeoutMs: 1 });
    assert.strictEqual(failure, FAILURE.TIMEOUT, 'explicit opts.timeoutMs must still apply');
    assert.strictEqual(mock.mock.calls.length, 1);
    assert.strictEqual(mock.mock.calls[0].arguments[2].timeout, 1,
      'explicit opts.timeoutMs must reach execFileSync\'s own timeout option, not the env var value');
  } finally {
    if (prior === undefined) delete process.env.CT_HOOKS_GIT_TIMEOUT_MS;
    else process.env.CT_HOOKS_GIT_TIMEOUT_MS = prior;
  }
});

test('runGit: a non-numeric or non-positive CT_HOOKS_GIT_TIMEOUT_MS falls back to DEFAULT_TIMEOUT_MS', () => {
  const dir = gitRepo();
  const prior = process.env.CT_HOOKS_GIT_TIMEOUT_MS;
  for (const bad of ['not-a-number', '0', '-5', '']) {
    process.env.CT_HOOKS_GIT_TIMEOUT_MS = bad;
    try {
      const { stdout, failure } = runGit(['rev-parse', '--show-toplevel'], dir);
      assert.strictEqual(failure, null, `bad override ${JSON.stringify(bad)} must not break a normal call`);
      assert.strictEqual(stdout, fs.realpathSync(dir));
    } finally {
      if (prior === undefined) delete process.env.CT_HOOKS_GIT_TIMEOUT_MS;
      else process.env.CT_HOOKS_GIT_TIMEOUT_MS = prior;
    }
  }
});

test('the default budget has real headroom over the peak measured under load', () => {
  // #134 measured the enforcement-critical rev-parse at 2492ms maximum under 24
  // concurrent workers plus two full test suites. The previous 3000ms budget
  // left 20% headroom and demonstrably fired. This asserts the replacement is
  // not merely different but has margin over the evidence that motivated it.
  const PEAK_MEASURED_MS = 2492;
  assert.ok(DEFAULT_TIMEOUT_MS >= PEAK_MEASURED_MS * 3,
    `budget ${DEFAULT_TIMEOUT_MS}ms must be >=3x the ${PEAK_MEASURED_MS}ms peak measured under load`);
});

// Windows console-window storm. Node's `windowsHide` defaults to FALSE, so a
// child console process is given a console of its own whenever the parent has
// no console for it to inherit. session-start.js spawns `reconcile-background`
// with `detached: true`, which is exactly that case — so on Windows every git
// invocation the background pass made appeared as its own visible console
// window. Measured on a real Windows 11 machine: one black window every 1-2s
// for the entire pass (a `PseudoConsoleWindow` with `visible=True`, caught
// owning `git push origin --delete <branch>`), reading to the user as a
// runaway loop. runGit is the single funnel every reconcile/hooks git query
// passes through, so pinning the flag here covers all of its call sites at
// once rather than one spawn site at a time.
test('runGit: passes windowsHide, so a console-less parent spawns no visible console window', () => {
  const cp = require('child_process');
  const original = cp.execFileSync;
  // git-exec.js destructures execFileSync at require time, so the stub has to
  // be installed BEFORE a fresh copy of the module is loaded — hence the
  // require.cache eviction rather than a plain property assignment. The
  // second eviction in `finally` makes sure no later test (or test file
  // sharing this process) inherits the stubbed instance.
  const modPath = require.resolve('../plugin/bin/lib/hooks/git-exec');
  let seenOpts = null;
  cp.execFileSync = (_file, _args, opts) => { seenOpts = opts; return ''; };
  try {
    delete require.cache[modPath];
    require(modPath).runGit(['rev-parse', '--show-toplevel'], process.cwd());
  } finally {
    cp.execFileSync = original;
    delete require.cache[modPath];
  }
  assert.ok(seenOpts, 'the stub must have observed the spawn at all');
  assert.strictEqual(seenOpts.windowsHide, true,
    'without windowsHide:true every git child of a console-less parent allocates its own visible console window on Windows');
});
