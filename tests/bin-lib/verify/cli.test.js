'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile, spawnSync, execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'verify.js');

// Every invocation runs from a fresh temp dir — never from this repo — so the
// runner's git-dir-relative defaults (#1921) can never write into the real
// checkout's .git (a stamp or count written by a test would poison the next
// real run's skip/caveat decisions).
function tmpDir() {
  // realpathSync: on macOS, os.tmpdir() is a symlink (/var -> /private/var)
  // that a spawned child's own process.cwd() reports already resolved — an
  // unresolved mkdtemp path compared against a path the CLI derives from its
  // own cwd would spuriously mismatch on this platform alone.
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-cli-test-')));
}

function runCli(args, opts = {}) {
  const cwd = opts.cwd || tmpDir();
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { maxBuffer: 10 * 1024 * 1024, cwd },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr, cwd }));
  });
}

// A throwaway git repo with one commit: git-dir === {repo}/.git.
function tmpGitRepo() {
  const repo = tmpDir();
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q');
  git('config', 'user.email', 'verify-test@example.invalid');
  git('config', 'user.name', 'verify test');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  return { repo, git, gitDir: path.join(repo, '.git') };
}

test('recorded exitCode is the check command own exit code (AC4)', async () => {
  const logDir = tmpDir();
  const { code } = await runCli([
    '--log-dir', logDir, '--cmd', 'tests=node -e "process.exit(7)"']);
  assert.notStrictEqual(code, 0);
  const report = JSON.parse(fs.readFileSync(path.join(logDir, 'report.json'), 'utf8'));
  assert.strictEqual(report.checks.tests.exitCode, 7);
  assert.strictEqual(report.pass, false);
});

test('overall exit is 0 and report carries AC3 top-level fields on pass (AC3, AC7)', async () => {
  const logDir = tmpDir();
  const { code } = await runCli([
    '--log-dir', logDir, '--cmd', 'tests=node -e "console.log(String(1))"']);
  assert.strictEqual(code, 0);
  const report = JSON.parse(fs.readFileSync(path.join(logDir, 'report.json'), 'utf8'));
  assert.strictEqual(report.pass, true);
  for (const key of ['sha', 'dirty', 'startedAt', 'durationMs', 'checks']) {
    assert.ok(key in report, `report missing ${key}`);
  }
  const entry = report.checks.tests;
  for (const key of ['command', 'exitCode', 'durationMs', 'logPath', 'summary', 'failingRegion']) {
    assert.ok(key in entry, `check entry missing ${key}`);
  }
});

test('a metacharacter-bearing --cmd value executes intact in the child shell (AC10)', async () => {
  const logDir = tmpDir();
  const { code } = await runCli([
    '--log-dir', logDir,
    '--cmd', 'tests=node -e "console.log(String(11))" && node -e "console.log(String(22))"']);
  assert.strictEqual(code, 0);
  const log = fs.readFileSync(path.join(logDir, 'tests.log'), 'utf8');
  assert.ok(log.includes('11'));
  assert.ok(log.includes('22'));
});

test('a >1MB emitter leaves runner stdout <= 64KB while the log holds everything (AC2)', () => {
  // execFile's pipe-captured stdout would only ever measure the OS pipe
  // buffer's own capacity (65536 bytes on this platform), not the runner's
  // real output size — a >64KB write truncated by that buffer looks
  // identical to a genuinely-bounded one. Redirect to a real file instead so
  // the assertion measures what the runner actually wrote.
  const logDir = tmpDir();
  const outFile = path.join(tmpDir(), 'stdout.txt');
  const outFd = fs.openSync(outFile, 'w');
  const result = spawnSync(process.execPath, [CLI,
    '--log-dir', logDir,
    '--cmd', 'tests=node -e "process.stdout.write(Buffer.alloc(1500000, 120), () => process.exit(1))"',
  ], { stdio: ['ignore', outFd, 'ignore'], cwd: tmpDir() });
  fs.closeSync(outFd);
  assert.notStrictEqual(result.status, 0);
  const stdoutSize = fs.statSync(outFile).size;
  assert.ok(stdoutSize <= 64 * 1024, `runner stdout was ${stdoutSize} bytes`);
  assert.ok(fs.statSync(path.join(logDir, 'tests.log')).size >= 1500000);
});

test('an unresolvable shell command is a failed check via shell exit code (not the spawnError seam — see run.test.js for that path) (AC6 partial)', async () => {
  // spawn(cmd, {shell: true}) means the shell itself always spawns
  // successfully, then reports "command not found" via its own exit code
  // (127) — this exercises that shell exit-code path, not the runner's
  // own spawnError capture (a spawnImpl that throws synchronously, or
  // emits a child 'error' event), which is only exercised end-to-end via
  // the injected fake in run.test.js.
  const logDir = tmpDir();
  const { code } = await runCli([
    '--log-dir', logDir, '--cmd', 'tests=definitely-not-a-real-command-892']);
  assert.notStrictEqual(code, 0);
  const report = JSON.parse(fs.readFileSync(path.join(logDir, 'report.json'), 'utf8'));
  assert.strictEqual(report.pass, false);
  assert.notStrictEqual(report.checks.tests.exitCode, 0);
});

test('malformed argv exits non-zero with usage on stderr (AC6)', async () => {
  for (const args of [['--cmd', 'noequals'], ['--cmd', '=x'], ['--bogus'], []]) {
    const { code, stderr } = await runCli(args);
    assert.notStrictEqual(code, 0, `args ${JSON.stringify(args)} should fail`);
    assert.ok(stderr.includes('usage:'), `stderr missing usage for ${JSON.stringify(args)}`);
  }
});

test('a fail-fast skip appears in the report and in stdout as skipped (AC1 reporting half)', async () => {
  const logDir = tmpDir();
  const { code, stdout } = await runCli([
    '--log-dir', logDir,
    '--cmd', 'lint=node -e "process.exit(1)"',
    '--cmd', 'tests=node -e "console.log(String(1))"']);
  assert.notStrictEqual(code, 0);
  const report = JSON.parse(fs.readFileSync(path.join(logDir, 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.checks.tests,
    { command: 'node -e "console.log(String(1))"', skipped: 'fail-fast' });
  assert.ok(stdout.includes('skipped'));
});

// IL-84's exact shape end-to-end (#881): an enumerated-glob npm test config
// silently excluded a whole test directory while still exiting 0 -- a drop
// invisible to exit-code-only reporting. Reproduce it via two verify.js runs
// sharing one --count-stamp: the first "sees" a wider glob (10 tests), the
// second simulates the exclusion (7 tests) with the same exit code (0).
test('a suite-count drop between two runs sharing --count-stamp fires the caveat (#881, IL-84 shape)', async () => {
  const logDir1 = tmpDir();
  const logDir2 = tmpDir();
  const countStamp = path.join(tmpDir(), 'count.json');
  const tapOutput = (n) => `node -e "console.log('# tests ${n}'); console.log('# pass ${n}'); console.log('# fail 0')"`;

  const first = await runCli([
    '--log-dir', logDir1, '--count-stamp', countStamp, '--cmd', `tests=${tapOutput(10)}`]);
  assert.strictEqual(first.code, 0);
  assert.ok(!first.stdout.includes('CAVEAT'), 'first run has no baseline to regress against');
  assert.ok(fs.existsSync(countStamp), 'first run must persist a baseline stamp');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(countStamp, 'utf8')).tests, 10);

  const second = await runCli([
    '--log-dir', logDir2, '--count-stamp', countStamp, '--cmd', `tests=${tapOutput(7)}`]);
  assert.strictEqual(second.code, 0, 'the tests check itself still passes -- this is a caveat, not a gate');
  assert.match(second.stdout, /^CAVEAT:.*from 10 to 7/ms);
  const report2 = JSON.parse(fs.readFileSync(path.join(logDir2, 'report.json'), 'utf8'));
  assert.deepStrictEqual(report2.testCountRegression, { previousTests: 10, currentTests: 7, droppedBy: 3 });
  assert.strictEqual(report2.pass, true, 'a count drop must not flip the report to failing');
  assert.strictEqual(JSON.parse(fs.readFileSync(countStamp, 'utf8')).tests, 7, 'stamp advances to the new count');
});

test('a steady or higher count between runs never fires the caveat', async () => {
  const countStamp = path.join(tmpDir(), 'count.json');
  const tapOutput = (n) => `node -e "console.log('# tests ${n}'); console.log('# pass ${n}'); console.log('# fail 0')"`;

  await runCli(['--log-dir', tmpDir(), '--count-stamp', countStamp, '--cmd', `tests=${tapOutput(10)}`]);
  const same = await runCli(['--log-dir', tmpDir(), '--count-stamp', countStamp, '--cmd', `tests=${tapOutput(10)}`]);
  assert.ok(!same.stdout.includes('CAVEAT'));
  const higher = await runCli(['--log-dir', tmpDir(), '--count-stamp', countStamp, '--cmd', `tests=${tapOutput(15)}`]);
  assert.ok(!higher.stdout.includes('CAVEAT'));
});

test('a --count-stamp write failure never crashes the run or discards report.json (review fix: fail-toward-absence, write side)', async () => {
  const logDir = tmpDir();
  const blockerFile = path.join(tmpDir(), 'blocker'); // a FILE, not a directory
  fs.writeFileSync(blockerFile, 'not a directory');
  // A path component of the stamp is a file, not a directory -- mkdirSync's
  // recursive create throws ENOTDIR, and (pre-fix) the stamp write's own
  // writeFileSync would too. Both must be swallowed, never propagated to
  // main()'s top-level catch, which would otherwise skip report.json
  // entirely even though the "tests" check itself passed.
  const countStamp = path.join(blockerFile, 'nested', 'count.json');
  // Must be a TAP-shaped "tests" command (parseCounts-parseable), not a bare
  // console.log — a non-parseable count leaves currentCount null, which
  // skips the stamp write entirely and would make this test pass
  // vacuously even against the unguarded pre-fix code (verified against
  // 57ed3752d before landing this test).
  const { code, stdout } = await runCli([
    '--log-dir', logDir, '--count-stamp', countStamp,
    '--cmd', 'tests=node -e "console.log(\'# tests 1\'); console.log(\'# pass 1\'); console.log(\'# fail 0\')"']);
  assert.strictEqual(code, 0, 'a stamp-write failure must not fail an otherwise-passing run');
  assert.ok(fs.existsSync(path.join(logDir, 'report.json')), 'report.json must still be written despite the stamp-write failure');
  const report = JSON.parse(fs.readFileSync(path.join(logDir, 'report.json'), 'utf8'));
  assert.strictEqual(report.pass, true);
  assert.ok(stdout.includes('report:'), 'stdout must still print the normal report line, not just an uncaught-error message');
});

test('outside a checkout, omitting --count-stamp disables persistence and comparison entirely', async () => {
  const { code, stdout } = await runCli([
    '--log-dir', tmpDir(), '--cmd', 'tests=node -e "console.log(String(1))"']);
  assert.strictEqual(code, 0);
  assert.ok(!stdout.includes('CAVEAT'));
});

test('outside a checkout, --log-dir defaults to a fresh tmpdir and --json defaults inside it (#1921 AC4)', async () => {
  const { code, stdout } = await runCli(['--cmd', 'tests=node -e "console.log(String(1))"']);
  assert.strictEqual(code, 0);
  const m = stdout.match(/report: (\S+)/);
  assert.ok(m, 'stdout must name the report path');
  assert.ok(fs.existsSync(m[1]));
  assert.ok(path.basename(m[1]) === 'report.json');
  assert.ok(m[1].includes('claude-tweaks-verify-'), 'mkdtemp fallback dir');
});

test('a passing full-set run writes the JSON stamp and the legacy bare-SHA twin (#1921 AC1)', async () => {
  const { repo, git, gitDir } = tmpGitRepo();
  const { code, stdout } = await runCli(['--cmd', 'tests=node -e 0'], { cwd: repo });
  assert.strictEqual(code, 0);
  const stamp = JSON.parse(fs.readFileSync(path.join(gitDir, 'claude-tweaks-verify-pass.json'), 'utf8'));
  const head = git('rev-parse', 'HEAD').trim();
  assert.strictEqual(stamp.scope, 'full');
  assert.strictEqual(stamp.sha, head);
  assert.strictEqual(stamp.fullSha, head);
  assert.strictEqual(stamp.dirty, false);
  assert.strictEqual(stamp.base, null);
  assert.deepStrictEqual(stamp.changedFiles, []);
  assert.deepStrictEqual(stamp.suitesRun, ['tests']);
  assert.deepStrictEqual(stamp.flakyRetried, []);
  assert.ok(fs.existsSync(stamp.reportPath), 'reportPath must exist');
  assert.strictEqual(fs.readFileSync(path.join(gitDir, 'claude-tweaks-verify-pass'), 'utf8'), `${head}\n`);
  assert.ok(stdout.includes('report:'));
});

test('a failing run, a fail-fast skip, and --no-stamp write neither stamp file (#1921 AC2, #1784)', async () => {
  for (const args of [
    ['--cmd', 'tests=node -e "process.exit(1)"'],
    ['--cmd', 'types=node -e "process.exit(1)"', '--cmd', 'tests=node -e 0'],
    ['--cmd', 'tests=node -e 0', '--no-stamp'],
  ]) {
    const { repo, gitDir } = tmpGitRepo();
    await runCli(args, { cwd: repo });
    assert.ok(!fs.existsSync(path.join(gitDir, 'claude-tweaks-verify-pass.json')), `json stamp written for ${JSON.stringify(args)}`);
    assert.ok(!fs.existsSync(path.join(gitDir, 'claude-tweaks-verify-pass')), `bare stamp written for ${JSON.stringify(args)}`);
  }
});

test('--stamp-status reports match/mismatch/absent as data with exit 0 (#1921 AC3)', async () => {
  const { repo, git, gitDir } = tmpGitRepo();
  const absent = await runCli(['--stamp-status'], { cwd: repo });
  assert.strictEqual(absent.code, 0);
  const a = JSON.parse(absent.stdout);
  assert.strictEqual(a.present, false);
  assert.strictEqual(a.match, false);
  assert.strictEqual(a.verifiedHead, false);

  await runCli(['--cmd', 'tests=node -e 0'], { cwd: repo });
  const matched = await runCli(['--stamp-status'], { cwd: repo });
  assert.strictEqual(matched.code, 0);
  const m = JSON.parse(matched.stdout);
  assert.strictEqual(m.present, true);
  assert.strictEqual(m.match, true);
  assert.strictEqual(m.verifiedHead, true, '#1923: a full pass answers verifiedHead true, same as match');
  assert.strictEqual(m.sha, git('rev-parse', 'HEAD').trim());
  assert.strictEqual(m.head, m.sha);
  assert.strictEqual(m.dirty, false);
  assert.strictEqual(m.scope, 'full');
  assert.strictEqual(m.legacy, false);
  assert.ok(fs.existsSync(m.reportPath));

  git('commit', '-q', '--allow-empty', '-m', 'move head');
  const moved = await runCli(['--stamp-status'], { cwd: repo });
  assert.strictEqual(moved.code, 0);
  const v = JSON.parse(moved.stdout);
  assert.strictEqual(v.present, true);
  assert.strictEqual(v.match, false);
  assert.strictEqual(v.verifiedHead, false, '#1923: a moved HEAD is never verified, even for a full-scope stamp');
  assert.notStrictEqual(v.head, v.sha);
  assert.ok(fs.existsSync(path.join(gitDir, 'claude-tweaks-verify-pass.json')));
});

test('--stamp-status recomputes dirty from the live tree — a dirty edit with no new commit is match:false (#1921 Gotchas)', async () => {
  const { repo } = tmpGitRepo();
  await runCli(['--cmd', 'tests=node -e 0'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'scratch.txt'), 'dirty');
  const { code, stdout } = await runCli(['--stamp-status'], { cwd: repo });
  assert.strictEqual(code, 0);
  const s = JSON.parse(stdout);
  assert.strictEqual(s.present, true);
  assert.strictEqual(s.dirty, true);
  assert.strictEqual(s.match, false);
  assert.strictEqual(s.verifiedHead, false, '#1923: a dirty tree is never verified');
});

test('--stamp-status honors --git-dir and reads a legacy bare-SHA stamp as scope full but never matches (#1921)', async () => {
  const { repo, git, gitDir } = tmpGitRepo();
  fs.writeFileSync(path.join(gitDir, 'claude-tweaks-verify-pass'), `${git('rev-parse', 'HEAD').trim()}\n`);
  const { code, stdout } = await runCli(['--stamp-status', '--git-dir', gitDir], { cwd: repo });
  assert.strictEqual(code, 0);
  const s = JSON.parse(stdout);
  assert.strictEqual(s.present, true);
  assert.strictEqual(s.legacy, true);
  assert.strictEqual(s.scope, 'full');
  // A legacy bare-SHA stamp carries no `dirty` field, so it can never prove
  // the tree was clean when it was recorded -- match/verifiedHead are false
  // even though sha/head/scope all otherwise line up (#1921 review fix).
  assert.strictEqual(s.match, false);
  assert.strictEqual(s.verifiedHead, false);
  assert.strictEqual(s.reportPath, null);
});

// Review finding, refs #1921: a stamp written against a dirty tree
// (stamp.dirty === true) read match:true (and verifiedHead:true) from
// --stamp-status once the uncommitted edit was discarded -- stampStatus()
// recomputed dirty live but never consulted the stamp's OWN stored dirty. A
// HEAD state never verified pristine must never be trusted this way.
test('--stamp-status never matches a stamp that was recorded on a dirty tree, even once the tree is clean again (#1921 review fix)', async () => {
  const { repo, gitDir } = tmpGitRepo();
  const untracked = path.join(repo, 'untracked.txt');
  fs.writeFileSync(untracked, 'dirty');
  const { code: passCode } = await runCli(['--cmd', 'tests=node -e 0'], { cwd: repo });
  assert.strictEqual(passCode, 0);
  const stamp = JSON.parse(fs.readFileSync(path.join(gitDir, 'claude-tweaks-verify-pass.json'), 'utf8'));
  assert.strictEqual(stamp.dirty, true, 'setup: the stamp must record the dirty tree it was written against');
  fs.unlinkSync(untracked);
  const { code, stdout } = await runCli(['--stamp-status'], { cwd: repo });
  assert.strictEqual(code, 0);
  const s = JSON.parse(stdout);
  assert.strictEqual(s.present, true);
  assert.strictEqual(s.dirty, false, 'the live tree is clean now');
  assert.strictEqual(s.match, false, 'the stamp itself was never recorded on a clean tree');
  assert.strictEqual(s.verifiedHead, false, 'the stamp itself was never recorded on a clean tree');
});

test('--stamp-status: a hand-written stamp with no scope is present but never verified (re-review N1)', async () => {
  const { repo, git, gitDir } = tmpGitRepo();
  const head = git('rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(gitDir, 'claude-tweaks-verify-pass.json'), JSON.stringify({ sha: head, dirty: false }));
  const { code, stdout } = await runCli(['--stamp-status'], { cwd: repo });
  assert.strictEqual(code, 0);
  const s = JSON.parse(stdout);
  assert.strictEqual(s.present, true);
  assert.strictEqual(s.scope, null);
  assert.strictEqual(s.match, false);
  assert.strictEqual(s.verifiedHead, false, 'a stamp with no scope is unknown coverage, never verified');
});

// Review fix round 2, finding A: --stamp-status --git-dir <dir> read the
// stamp from <dir> but computed head/dirty from the invoking cwd's own
// git dir via gitInfo() -- a sibling checkout sitting at the same commit
// could read match:true for a verification it never ran. B is a distinct
// repo from A; A's stamp is read from B's cwd and must never match.
test('--stamp-status --git-dir pointing at a foreign checkout never matches (#1921 review fix)', async () => {
  const a = tmpGitRepo();
  const b = tmpGitRepo();
  const { code: passCode } = await runCli(['--cmd', 'tests=node -e 0'], { cwd: a.repo });
  assert.strictEqual(passCode, 0);
  const { code, stdout } = await runCli(['--stamp-status', '--git-dir', a.gitDir], { cwd: b.repo });
  assert.strictEqual(code, 0);
  const s = JSON.parse(stdout);
  assert.strictEqual(s.present, true);
  assert.strictEqual(s.match, false);
  assert.strictEqual(s.verifiedHead, false, '#1923: a foreign --git-dir is never verifiedHead either');
});

test('--stamp-status outside any checkout prints present:false and exits 0 (#1921 Gotchas)', async () => {
  const { code, stdout } = await runCli(['--stamp-status']);
  assert.strictEqual(code, 0);
  const s = JSON.parse(stdout);
  assert.strictEqual(s.present, false);
  assert.strictEqual(s.match, false);
  assert.strictEqual(s.verifiedHead, false, '#1923: verifiedHead exists (false) even absent a checkout');
  assert.strictEqual(s.head, null);
});

test('inside a checkout, --log-dir defaults under the git dir and --count-stamp is persisted there (#1921 AC4)', async () => {
  const { repo, gitDir } = tmpGitRepo();
  const tap = 'node -e "console.log(\'# tests 3\'); console.log(\'# pass 3\'); console.log(\'# fail 0\')"';
  const { code, stdout } = await runCli(['--cmd', `tests=${tap}`], { cwd: repo });
  assert.strictEqual(code, 0);
  const m = stdout.match(/report: (\S+)/);
  assert.strictEqual(m[1], path.join(gitDir, 'claude-tweaks-verify', 'report.json'));
  assert.ok(fs.existsSync(m[1]));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(gitDir, 'claude-tweaks-test-count.json'), 'utf8')).tests, 3);
});

test('an explicit --log-dir still wins inside a checkout (#1921)', async () => {
  const { repo } = tmpGitRepo();
  const logDir = tmpDir();
  const { code, stdout } = await runCli(['--log-dir', logDir, '--cmd', 'tests=node -e 0'], { cwd: repo });
  assert.strictEqual(code, 0);
  assert.ok(stdout.includes(`report: ${path.join(logDir, 'report.json')}`));
});

// Review fix round 1, finding 1: every write-path test up to this point ran
// from a freshly-committed CLEAN tmpGitRepo() — none proved the spec's
// explicit "dirty never gates the write" invariant, so a regression that
// reintroduced a `git.dirty === false` term into the write gate would pass
// the whole suite undetected.
test('a passing full-set run on a DIRTY tree still writes both stamp files, and --stamp-status reflects dirty:true, match:false (#1921 Gotchas)', async () => {
  const { repo, git, gitDir } = tmpGitRepo();
  fs.writeFileSync(path.join(repo, 'untracked.txt'), 'dirty');
  const { code } = await runCli(['--cmd', 'tests=node -e 0'], { cwd: repo });
  assert.strictEqual(code, 0);
  const head = git('rev-parse', 'HEAD').trim();
  const stamp = JSON.parse(fs.readFileSync(path.join(gitDir, 'claude-tweaks-verify-pass.json'), 'utf8'));
  assert.strictEqual(stamp.dirty, true);
  assert.strictEqual(stamp.scope, 'full');
  assert.strictEqual(stamp.sha, head);
  assert.ok(fs.existsSync(path.join(gitDir, 'claude-tweaks-verify-pass')), 'legacy bare-SHA stamp must also be written on a dirty tree');

  const status = await runCli(['--stamp-status'], { cwd: repo });
  assert.strictEqual(status.code, 0);
  const s = JSON.parse(status.stdout);
  assert.strictEqual(s.present, true);
  assert.strictEqual(s.dirty, true);
  assert.strictEqual(s.match, false);
  assert.strictEqual(s.verifiedHead, false, '#1923: a dirty tree is never verified even for a full-scope stamp');
});

// Review fix round 1, finding 2 (superseded by the #1921 final review, finding
// 4): --git-dir routing for a normal --cmd run (as opposed to --stamp-status
// --git-dir, already covered above) had no dedicated test. The original
// version of this test ran from a non-git cwd, so gitInfo()'s sha:null
// already blocked the stamp write for an unrelated reason and never proved
// the actual invariant. gitInfo() still reads HEAD/dirty from the process's
// own cwd (report.js's gitInfo has no --git-dir-aware overload), so an
// explicit --git-dir must never let a run stamp a repo with a HEAD that
// isn't the invoking cwd's own — the write gate now short-circuits on
// `parsed.gitDir` explicitly, rather than relying on cwd happening to be
// non-git. This test runs from a cwd that IS a git checkout (a second
// tmpGitRepo()) so the old "sha:null blocks it" path can't mask a
// regression.
test('--git-dir on a normal run redirects report/count paths to that git dir and never writes the pass stamp (#1921)', async () => {
  const { gitDir: otherGitDir } = tmpGitRepo();
  const { repo: cwdRepo, gitDir: cwdGitDir } = tmpGitRepo();
  const { code, stdout } = await runCli(['--cmd', 'tests=node -e 0', '--git-dir', otherGitDir], { cwd: cwdRepo });
  assert.strictEqual(code, 0);
  assert.ok(
    stdout.includes(`report: ${path.join(otherGitDir, 'claude-tweaks-verify', 'report.json')}`),
    'report.json must land under the --git-dir-routed default log dir',
  );
  assert.ok(fs.existsSync(path.join(otherGitDir, 'claude-tweaks-verify', 'report.json')));
  assert.ok(
    !fs.existsSync(path.join(otherGitDir, 'claude-tweaks-verify-pass.json')),
    'an explicit --git-dir must never write the pass stamp into the redirected repo',
  );
  assert.ok(!fs.existsSync(path.join(otherGitDir, 'claude-tweaks-verify-pass')));
  assert.ok(
    !fs.existsSync(path.join(cwdGitDir, 'claude-tweaks-verify-pass.json')),
    'nor into the invoking cwd\'s own repo — a --git-dir run never stamps at all',
  );
  assert.ok(!fs.existsSync(path.join(cwdGitDir, 'claude-tweaks-verify-pass')));
});

// A declaration file inside a temp repo, plus a marker-touching "unit" command
// so a test can prove a suite was or was not spawned. Two suites are declared
// so "every declared suite selected" (which collapses to mode full) is not
// trivially true whenever the one suite's rule matches.
function scopedRepo(rules, extra = {}) {
  const r = tmpGitRepo();
  // Inside .git/, not the working tree: git status --porcelain never sees it,
  // so a passing run's own "unit ran" side-effect can't make the stamp read
  // dirty:true at write time -- these tests are about scope/verifiedHead
  // semantics, not about deliberately dirtying the tree (that is its own
  // dedicated scenario elsewhere in this file, refs #1921 review fix).
  const marker = path.join(r.gitDir, 'unit-ran.marker');
  const decl = { checks: { tests: { unit: 'placeholder', other: 'placeholder' } }, rules, ...extra };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.claude-tweaks/verify-scope.json');
  r.git('commit', '-q', '-m', 'declare verify scope');
  // Shell-quoted with an outer single-quoted -e script: JSON.stringify's
  // double-quoted path literal must never sit inside an outer double-quoted
  // -e script (spawn's shell:true runs this through /bin/sh -c) — nesting
  // "..." inside "..." closes the shell's quoting early and corrupts the
  // path into a bareword the JS parser then misreads as a regex literal.
  const unitCmd = `node -e 'require("fs").writeFileSync(${JSON.stringify(marker)}, "ran")'`;
  // The temp repo has no origin, so --integration-branch names its own local
  // branch — whatever init.defaultBranch made it (master on this machine).
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  return { ...r, marker, unitCmd, branch, declPath: '.claude-tweaks/verify-scope.json' };
}

function stampOf(gitDir) {
  return JSON.parse(fs.readFileSync(path.join(gitDir, 'claude-tweaks-verify-pass.json'), 'utf8'));
}

function commitFile(r, rel, content) {
  fs.mkdirSync(path.dirname(path.join(r.repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(r.repo, rel), content);
  r.git('add', rel);
  r.git('commit', '-q', '-m', `add ${rel}`);
}

test('--scope: full → none → scoped across three commits, anchored to the first full pass (#1922 AC4)', async () => {
  const r = scopedRepo([
    { match: 'src/**', suites: ['unit'], static: true },
    { match: 'docs/**', suites: [], static: false },
  ]);
  // run 1 is mode 'full' (no prior stamp — the very first run is always the
  // anchor), so review fix H2 requires --cmd for every declared suite, not
  // just the one `src/**`'s rule happens to select.
  const args = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'];

  const run1 = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run1.code, 0, run1.stderr);
  assert.match(run1.stdout, /^Scope: full/m);
  const s1 = stampOf(r.gitDir);
  const bareSha1 = fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify-pass'), 'utf8');
  assert.strictEqual(s1.scope, 'full');
  assert.strictEqual(s1.fullSha, r.git('rev-parse', 'HEAD').trim());
  assert.strictEqual(bareSha1, `${s1.fullSha}\n`, 'a full run writes the legacy bare-SHA twin (#1922 review H1)');
  assert.ok(fs.existsSync(r.marker), 'run 1 must spawn unit');
  fs.unlinkSync(r.marker);

  commitFile(r, 'docs/a.md', 'docs');
  const run2 = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run2.code, 0, run2.stderr);
  assert.match(run2.stdout, /^Scope: none — 1 changed file\(s\) since/m);
  assert.match(run2.stdout, /still-verified: bookkeeping-only delta \(docs\/a\.md\)/);
  const s2 = stampOf(r.gitDir);
  assert.strictEqual(s2.scope, 'none');
  assert.strictEqual(s2.fullSha, s1.fullSha);
  assert.strictEqual(s2.base, s1.fullSha);
  assert.deepStrictEqual(s2.suitesRun, []);
  assert.deepStrictEqual(s2.changedFiles, ['docs/a.md']);
  assert.ok(!fs.existsSync(r.marker), 'run 2 must not spawn unit');
  const report2 = JSON.parse(fs.readFileSync(s2.reportPath, 'utf8'));
  assert.strictEqual(report2.scope.mode, 'none');
  assert.strictEqual(report2.pass, true);
  assert.strictEqual(
    fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify-pass'), 'utf8'), bareSha1,
    'a non-full run must never rewrite the legacy bare-SHA twin (#1922 review H1)',
  );

  commitFile(r, 'src/a.js', 'module.exports = 1;');
  const run3 = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run3.code, 0, run3.stderr);
  assert.match(run3.stdout, /^Scope: scoped — 2 changed file\(s\) since/m);
  const s3 = stampOf(r.gitDir);
  assert.strictEqual(s3.scope, 'scoped');
  assert.deepStrictEqual(s3.suitesRun, ['unit']);
  assert.strictEqual(s3.base, s1.fullSha);
  assert.strictEqual(s3.fullSha, s1.fullSha);
  assert.deepStrictEqual(s3.changedFiles, ['docs/a.md', 'src/a.js']);
  const report3 = JSON.parse(fs.readFileSync(s3.reportPath, 'utf8'));
  assert.deepStrictEqual(
    report3.scope.matched, [{ file: 'docs/a.md', rule: 1 }, { file: 'src/a.js', rule: 0 }],
    'report.json.scope.matched threads each changed file to the declaration rule index that matched it (F1)',
  );
  assert.ok(fs.existsSync(r.marker), 'run 3 must spawn unit');
  assert.strictEqual(
    fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify-pass'), 'utf8'), bareSha1,
    'a scoped run must also never rewrite the legacy bare-SHA twin (#1922 review H1)',
  );
});

test('--scope: an unmatched path fails closed to a full run and is listed as unmatched (#1922)', async () => {
  const r = scopedRepo([{ match: 'docs/**', suites: [], static: false }]);
  // Both declared suites are required: the very first run is always mode
  // 'full' (no prior stamp), and the unmatched-path run below fails closed
  // to 'full' too — H2 requires --cmd for every declared suite in that mode.
  const args = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'];
  await runCli(args, { cwd: r.repo });
  fs.unlinkSync(r.marker);
  commitFile(r, 'mystery/x.txt', 'x');
  const run = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: full — 1 changed file\(s\) since .*unmatched: 1/m);
  assert.ok(fs.existsSync(r.marker));
  const s = stampOf(r.gitDir);
  assert.strictEqual(s.scope, 'full');
  assert.strictEqual(s.fullSha, r.git('rev-parse', 'HEAD').trim(), 'a full run advances fullSha');
  const report = JSON.parse(fs.readFileSync(s.reportPath, 'utf8'));
  assert.deepStrictEqual(report.scope.unmatched, ['mystery/x.txt']);
});

test('--scope: a --cmd name that is neither types/lint nor a declared suite exits 2 naming it, and writes no stamp (#1922 AC5)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', 'smoke=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 2);
  assert.match(run.stderr, /smoke/);
  assert.match(run.stderr, /usage:/);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));
});

test('--scope: a declaration with an unknown suite in a rule exits 2 naming the rule index and suite, and writes no stamp (#1922 AC6)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['nope'], static: true }]);
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`], { cwd: r.repo });
  assert.strictEqual(run.code, 2);
  assert.match(run.stderr, /rules\[0\].*nope/);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));
  assert.ok(!fs.existsSync(r.marker));
});

test('--scope with no declaration file behaves as a full run and stamps full (#1922)', async () => {
  const r = tmpGitRepo();
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const run = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--cmd', 'tests=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: full/m);
  assert.match(run.stdout, /no declaration at/, '#1922 review L10: the message names the missing declaration path');
  assert.strictEqual(stampOf(r.gitDir).scope, 'full');
});

test('--scope tool-scoped: {base} is substituted into the single tests command and fullSha never advances (#1922 Gotchas)', async () => {
  const r = tmpGitRepo();
  const out = path.join(r.repo, 'base-seen.txt');
  // Same outer-single-quote shape as scopedRepo's unitCmd above: a
  // JSON.stringify'd double-quoted path must never sit inside a
  // double-quoted -e script.
  const decl = {
    checks: { tests: `node -e 'require("fs").writeFileSync(${JSON.stringify(out)}, "{base}")'` },
    rules: [{ match: 'src/**', suites: [], static: true }, { match: 'docs/**', suites: [], static: false }],
  };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.claude-tweaks/verify-scope.json');
  r.git('commit', '-q', '-m', 'declare');
  const args = ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.git('symbolic-ref', '--short', 'HEAD').trim(), '--cmd', 'tests=node -e 0'];
  const run1 = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run1.code, 0, run1.stderr);
  const s1 = stampOf(r.gitDir);
  assert.strictEqual(s1.scope, 'full');
  commitFile(r, 'src/a.js', '1');
  const run2 = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run2.code, 0, run2.stderr);
  assert.match(run2.stdout, /^Scope: tool-scoped/m);
  assert.strictEqual(fs.readFileSync(out, 'utf8'), s1.fullSha, 'the resolved base replaced {base}');
  const s2 = stampOf(r.gitDir);
  assert.strictEqual(s2.scope, 'tool-scoped');
  assert.strictEqual(s2.fullSha, s1.fullSha);
  assert.strictEqual(s2.base, s1.fullSha);
  assert.deepStrictEqual(s2.suitesRun, ['tests']);
});

test('--scope with no --cmd is a usage error even when a declaration exists — an empty check set must never stamp (#1922)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.branch], { cwd: r.repo });
  assert.strictEqual(run.code, 2);
  assert.match(run.stderr, /at least one --cmd/);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));
});

test('--scope: an unresolvable base exits 2 with a ChangedFilesError message, never an empty diff (#1922 AC3 posture)', async () => {
  const r = tmpGitRepo();
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify({ checks: { tests: 'x' }, rules: [] }));
  const run = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', 'no-such-branch', '--cmd', 'tests=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 2);
  assert.match(run.stderr, /could not resolve a base/);
});

// Review fix H2: a filtered check set that leaves a required suite out of
// --cmd is a usage error, not a silently-partial run. A baseline full pass
// establishes a real anchor first so the second run is genuinely 'scoped'
// (only 'other' selected) rather than the always-full first run.
test('--scope: a filtered check set missing a required suite is a usage error naming it, and writes no stamp (#1922 review H2)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['other'], static: false }]);
  const baselineArgs = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'];
  const base = await runCli(baselineArgs, { cwd: r.repo });
  assert.strictEqual(base.code, 0, base.stderr);
  const baseline = stampOf(r.gitDir);
  fs.unlinkSync(r.marker); // the marker is untracked; left behind it would pollute the next diff.

  commitFile(r, 'src/a.js', '1');
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`], { cwd: r.repo });
  assert.strictEqual(run.code, 2);
  assert.match(run.stderr, /--scope: mode scoped requires --cmd for: other/);
  assert.match(run.stderr, /usage:/);
  assert.deepStrictEqual(stampOf(r.gitDir), baseline, 'the failed run must not touch the existing stamp');
});

// Review fix H4: an explicit --base that resolves to a different commit than
// the stamp's own anchor is rejected rather than silently overriding it.
test('--scope: --base that contradicts the stamp anchor is a usage error, and writes no stamp (#1922 review H4)', async () => {
  const r = scopedRepo([
    { match: 'src/**', suites: ['unit'], static: true },
    { match: 'docs/**', suites: [], static: false },
  ]);
  const args = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'];
  const run0 = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run0.code, 0, run0.stderr);
  const baseline = stampOf(r.gitDir);
  fs.unlinkSync(r.marker); // the marker is untracked; left behind it would pollute the next diff.

  commitFile(r, 'src/a.js', 'module.exports = 1;');
  const c1 = r.git('rev-parse', 'HEAD').trim();
  commitFile(r, 'docs/a.md', 'docs');

  const run = await runCli(['--scope', r.declPath, '--base', c1, '--cmd', `unit=${r.unitCmd}`], { cwd: r.repo });
  assert.strictEqual(run.code, 2);
  assert.match(run.stderr, /--scope: --base .* conflicts with the stamp anchor/);
  assert.deepStrictEqual(stampOf(r.gitDir), baseline, 'a rejected --base must never touch the existing stamp');
});

// Review fix M5: the --scope anchor always reads THIS checkout's OWN git
// dir, never an explicit --git-dir. A forged stamp in a foreign git dir,
// anchored at B's own current HEAD (so it would resolve as a real ancestor
// if the bug used it), must not leak into B's scope selection — B's own git
// dir has no stamp of its own, so the run must still be 'full'.
test('--scope resolves the anchor from the OWN git dir, never an explicit --git-dir (#1922 review M5)', async () => {
  const b = scopedRepo([{ match: 'docs/**', suites: [], static: false }]);
  const headBeforeDocsChange = b.git('rev-parse', 'HEAD').trim();

  const foreignGitDir = tmpDir();
  fs.writeFileSync(path.join(foreignGitDir, 'claude-tweaks-verify-pass.json'), JSON.stringify({
    sha: headBeforeDocsChange, dirty: false, scope: 'full', fullSha: headBeforeDocsChange,
    base: null, changedFiles: [], suitesRun: ['unit', 'other'], flakyRetried: [],
    reportPath: null, at: new Date().toISOString(),
  }));

  commitFile(b, 'docs/x.md', 'docs');
  const run = await runCli(
    ['--scope', b.declPath, '--integration-branch', b.branch, '--git-dir', foreignGitDir, '--cmd', `unit=${b.unitCmd}`, '--cmd', 'other=node -e 0'],
    { cwd: b.repo },
  );
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(
    run.stdout, /^Scope: full/m,
    'a foreign --git-dir\'s stamp must never supply the anchor — B\'s own git dir has none, so this must be full, not none',
  );
});

// Review fix M6: a --scope run at an unchanged HEAD (clean tree, same sha as
// the prior full stamp) must never downgrade that stamp to 'none'.
test('a --scope run at an unchanged HEAD never downgrades the prior full stamp (#1922 review M6)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  const args = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'];
  const run1 = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run1.code, 0, run1.stderr);
  assert.strictEqual(stampOf(r.gitDir).scope, 'full');
  fs.unlinkSync(r.marker); // untracked; must not linger as an uncommitted change for run 2's "clean tree" to hold.

  const run2 = await runCli(args, { cwd: r.repo }); // same HEAD, clean tree, no new commits
  assert.strictEqual(run2.code, 0, run2.stderr);
  assert.strictEqual(stampOf(r.gitDir).scope, 'full', 'the prior full stamp must stand, never downgraded to none');
  assert.match(
    run2.stdout, /^still-verified: no changes since/m,
    'a zero-file "none" run must not print an empty "bookkeeping-only delta ()" (#1922 re-review nit iii)',
  );

  const status = await runCli(['--stamp-status'], { cwd: r.repo });
  const s = JSON.parse(status.stdout);
  assert.strictEqual(s.match, true);
  assert.strictEqual(s.verifiedHead, true);
});

// Review finding (pre-v6.119.0 whole-branch review): --stamp-status must
// derive `fullSha` via stamp.js's shared anchorOf(), not a narrower inline
// `undefined`-only check — a stamp with `fullSha: null` (a value readStamp
// treats as valid, distinct from absent) must still report the legacy `sha`
// as the anchor, matching changed-files.js/scope.js's own anchor resolution
// for the identical stamp file.
test('--stamp-status: fullSha falls back to sha when the stamp has fullSha: null, matching anchorOf', async () => {
  const r = tmpGitRepo();
  const head = r.git('rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json'), JSON.stringify({
    sha: head, dirty: false, scope: 'full', fullSha: null,
    base: null, changedFiles: [], suitesRun: [], flakyRetried: [],
    reportPath: null, at: new Date().toISOString(),
  }));
  const status = await runCli(['--stamp-status'], { cwd: r.repo });
  const s = JSON.parse(status.stdout);
  assert.strictEqual(s.sha, head);
  assert.strictEqual(s.fullSha, head, 'fullSha must fall back to sha, not surface the stored null');
});

// #1923 A1: --stamp-status's own "is HEAD verified" answer for a passing
// scoped run — match stays strictly full-pass (false here), but
// verifiedHead is true because the scoped run's fullSha anchor is still an
// ancestor of HEAD. A repeat of the identical scoped invocation must not
// loop: it still exits 0 and verifiedHead stays true.
test('--stamp-status: verifiedHead is true after a passing scoped run, and a repeat scoped invocation does not loop (#1923)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  const fullArgs = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'];
  const run1 = await runCli(fullArgs, { cwd: r.repo });
  assert.strictEqual(run1.code, 0, run1.stderr);
  fs.unlinkSync(r.marker); // untracked; must not linger as an uncommitted change.

  commitFile(r, 'src/a.js', 'module.exports = 1;');
  const scopedArgs = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`];
  const run2 = await runCli(scopedArgs, { cwd: r.repo });
  assert.strictEqual(run2.code, 0, run2.stderr);
  assert.match(run2.stdout, /^Scope: scoped/m);
  fs.unlinkSync(r.marker); // untracked; must not linger for the next diff.

  const status1 = await runCli(['--stamp-status'], { cwd: r.repo });
  assert.strictEqual(status1.code, 0);
  const s1 = JSON.parse(status1.stdout);
  assert.strictEqual(s1.scope, 'scoped');
  assert.strictEqual(s1.match, false);
  assert.strictEqual(s1.verifiedHead, true);

  // Re-running the identical scoped invocation must not loop: HEAD hasn't
  // moved since run2, so this exits 0 and verifiedHead is still true
  // afterward (whether this second pass itself lands as 'scoped' or 'none').
  const run3 = await runCli(scopedArgs, { cwd: r.repo });
  assert.strictEqual(run3.code, 0, run3.stderr);
  if (fs.existsSync(r.marker)) fs.unlinkSync(r.marker); // untracked; a leftover marker would read as a dirty tree.
  const status2 = await runCli(['--stamp-status'], { cwd: r.repo });
  assert.strictEqual(status2.code, 0);
  assert.strictEqual(JSON.parse(status2.stdout).verifiedHead, true);
});

// #1923 A1: a history rewrite on top of a scoped stamp moves HEAD out from
// under the stamp's own sha, so the runner can no longer call HEAD verified
// — mirrors the full-run history-rewrite coverage above (#1922 re-review),
// but for a stamp whose scope is 'scoped' rather than 'full'.
test('--stamp-status: an amend on top of a scoped stamp makes verifiedHead false (#1923)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  const fullArgs = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'];
  const run1 = await runCli(fullArgs, { cwd: r.repo });
  assert.strictEqual(run1.code, 0, run1.stderr);
  fs.unlinkSync(r.marker); // untracked; must not linger as an uncommitted change.

  commitFile(r, 'src/a.js', 'module.exports = 1;');
  const scopedArgs = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`];
  const run2 = await runCli(scopedArgs, { cwd: r.repo });
  assert.strictEqual(run2.code, 0, run2.stderr);
  fs.unlinkSync(r.marker); // untracked; must not linger for the next diff.

  const before = await runCli(['--stamp-status'], { cwd: r.repo });
  assert.strictEqual(JSON.parse(before.stdout).verifiedHead, true);

  r.git('commit', '--amend', '--allow-empty', '-q', '-m', 'rewritten');
  const after = await runCli(['--stamp-status'], { cwd: r.repo });
  assert.strictEqual(after.code, 0);
  const s = JSON.parse(after.stdout);
  assert.strictEqual(s.match, false);
  assert.strictEqual(s.verifiedHead, false, 'the anchor is no longer an ancestor of the rewritten HEAD');
});

// Review fix H3: a tool-scoped run's "tests" count is not comparable to a
// full run's baseline — comparing or persisting it would fire a false
// CAVEAT or silently corrupt the baseline the next full run reads. Note:
// parseCounts (extract.js) requires all three of `# tests`/`# pass`/`# fail`
// to be present before it returns a count at all (tap family) — a two-line
// "# tests N\n# pass N" shape alone parses to null, so a `# fail 0` line is
// included here even though the dispatch's example only named two lines.
// Neither command here writes any file, so there is no marker to remove
// between runs.
test('--scope: a tool-scoped run neither caveats nor rewrites the count stamp — only a full run updates it (#1922 review H3)', async () => {
  const r = tmpGitRepo();
  // checks.tests must literally contain "{base}" for declaration.js to mark
  // this tool-scoped; embedding it inside a console.log argument is a
  // harmless extra output line once {base} is substituted with the
  // resolved anchor sha.
  const declTests = 'node -e \'console.log("{base}"); console.log("# tests 3"); console.log("# pass 3"); console.log("# fail 0")\'';
  const decl = {
    checks: { tests: declTests },
    rules: [{ match: 'src/**', suites: [], static: false }],
  };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.claude-tweaks/verify-scope.json');
  r.git('commit', '-q', '-m', 'declare verify scope');
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const declPath = '.claude-tweaks/verify-scope.json';
  const countStampPath = path.join(r.gitDir, 'claude-tweaks-test-count.json');

  // run 1 has no prior stamp, so it is mode 'full' regardless of the
  // tool-scoped declaration — its own --cmd runs verbatim and establishes
  // the count-stamp baseline at 500.
  const run1Cmd = 'node -e \'console.log("# tests 500"); console.log("# pass 500"); console.log("# fail 0")\'';
  const run1 = await runCli(['--scope', declPath, '--integration-branch', branch, '--cmd', `tests=${run1Cmd}`], { cwd: r.repo });
  assert.strictEqual(run1.code, 0, run1.stderr);
  assert.match(run1.stdout, /^Scope: full/m);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(countStampPath, 'utf8')).tests, 500);

  // run 2 is genuinely tool-scoped: a real prior stamp exists, and src/a.js
  // matches the one rule. Its --cmd is discarded and replaced by decl's own
  // {base}-substituted command (printing 3), which is deliberately far below
  // 500 to prove a real drop would have fired the caveat absent the fix.
  commitFile(r, 'src/a.js', '1');
  const run2 = await runCli(['--scope', declPath, '--integration-branch', branch, '--cmd', `tests=${run1Cmd}`], { cwd: r.repo });
  assert.strictEqual(run2.code, 0, run2.stderr);
  assert.match(run2.stdout, /^Scope: tool-scoped/m);
  assert.ok(!run2.stdout.includes('CAVEAT'), 'a tool-scoped run must never fire the count-drop caveat');
  assert.ok(!/dropped/i.test(run2.stdout), 'a tool-scoped run must never mention a count drop');
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(countStampPath, 'utf8')).tests, 500,
    'the count stamp must still record the last FULL run\'s count, untouched by the tool-scoped run',
  );
});

// Re-review NEW-1: H4's --base-vs-anchor check previously used a bare
// rev-parse with no ancestor test, so a stamp anchor that still resolves to
// a real (but now-orphaned) commit after a history rewrite could reject a
// --base that is legitimately correct for the rewritten history.
test('--scope --base after a history rewrite is accepted when the old anchor is no longer an ancestor (#1922 re-review)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  const args = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'];
  const run1 = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run1.code, 0, run1.stderr);
  fs.unlinkSync(r.marker); // untracked; must not linger as an uncommitted change.

  // Rewrite history: the old stamp anchor (run1's HEAD) still resolves to a
  // real commit object, but is no longer an ancestor of the new HEAD.
  r.git('commit', '--amend', '--allow-empty', '-q', '-m', 'rewritten');
  const newHead = r.git('rev-parse', 'HEAD').trim();

  const run = await runCli(
    ['--scope', r.declPath, '--base', newHead, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'],
    { cwd: r.repo },
  );
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope:/m);
});

// #1922 review fix 3: a stale stamp anchor (not an ancestor of HEAD after a
// history rewrite) must force a full run even with no --base at all —
// selectScope must never see the stale priorStamp as still valid, or a
// non-full run would stamp fullSha at the old anchor while base points at
// today's merge-base, breaking the base === fullSha invariant a full run
// relies on.
test('--scope after a history rewrite (no --base) forces mode full and stamps fullSha at the new HEAD (#1922 review fix 3)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  const args = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'];
  const run1 = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run1.code, 0, run1.stderr);
  fs.unlinkSync(r.marker); // untracked; must not linger as an uncommitted change.

  // Rewrite history: the old stamp anchor (run1's HEAD) still resolves to a
  // real commit object, but is no longer an ancestor of the new HEAD. The
  // integration branch moves with the amend, so no --base is needed to
  // exercise the fallback-to-merge-base path.
  r.git('commit', '--amend', '--allow-empty', '-q', '-m', 'rewritten');
  const newHead = r.git('rev-parse', 'HEAD').trim();

  const run2 = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run2.code, 0, run2.stderr);
  assert.match(run2.stdout, /^Scope: full/m);
  const stamp = stampOf(r.gitDir);
  assert.strictEqual(stamp.scope, 'full');
  assert.strictEqual(stamp.fullSha, newHead);
});

test('--changed-files prints {base, files} = committed-since-anchor ∪ working tree, anchored on the stamp fullSha (#1923 AC2)', async () => {
  const r = tmpGitRepo();
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const full = await runCli(['--cmd', 'tests=node -e 0'], { cwd: r.repo });
  assert.strictEqual(full.code, 0, full.stderr);
  const anchor = stampOf(r.gitDir).fullSha;
  commitFile(r, 'src/a.js', '1');
  fs.writeFileSync(path.join(r.repo, 'notes.txt'), 'uncommitted');
  const run = await runCli(['--changed-files', '--integration-branch', branch], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim());
  assert.strictEqual(out.base, anchor);
  // files is sorted by contract (changed-files.js returns [...set].sort()), so the order is asserted deliberately.
  assert.deepStrictEqual(out.files, ['notes.txt', 'src/a.js']);
});

test('--changed-files includes staged and modified-tracked files alongside committed and untracked ones (#1923 review)', async () => {
  const r = tmpGitRepo();
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const full = await runCli(['--cmd', 'tests=node -e 0'], { cwd: r.repo });
  assert.strictEqual(full.code, 0, full.stderr);
  commitFile(r, 'src/a.js', '1');
  fs.writeFileSync(path.join(r.repo, 'staged.js'), 'staged');
  r.git('add', 'staged.js');
  fs.writeFileSync(path.join(r.repo, 'src', 'a.js'), '2');
  fs.writeFileSync(path.join(r.repo, 'notes.txt'), 'uncommitted');
  const run = await runCli(['--changed-files', '--integration-branch', branch], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim());
  assert.deepStrictEqual(out.files, ['notes.txt', 'src/a.js', 'staged.js']);
});

test('--changed-files with no stamp and no resolvable integration branch exits 1 with a message — never an empty list (#1923 AC2)', async () => {
  const r = tmpGitRepo();
  const run = await runCli(['--changed-files'], { cwd: r.repo });
  assert.strictEqual(run.code, 1);
  assert.match(run.stderr, /could not resolve a base/);
  assert.strictEqual(run.stdout.trim(), '');
});

test('--changed-files honors --base and never writes a stamp or report (#1923)', async () => {
  const r = tmpGitRepo();
  const first = r.git('rev-parse', 'HEAD').trim();
  commitFile(r, 'docs/a.md', 'x');
  const run = await runCli(['--changed-files', '--base', first], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.deepStrictEqual(JSON.parse(run.stdout.trim()), { base: first, files: ['docs/a.md'] });
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json')));
});

test('#1801 shape: a ledger-row commit after a full pass resolves to none — still-verified line, no tests spawned (#1923 AC5)', async () => {
  const r = tmpGitRepo();
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const marker = path.join(r.repo, 'tests-ran.marker');
  const decl = {
    checks: { tests: 'placeholder' },
    rules: [
      { match: 'docs/plans/*-ledger.md', suites: [], static: false },
      { match: 'src/**', suites: ['tests'], static: true },
    ],
  };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.claude-tweaks/verify-scope.json');
  r.git('commit', '-q', '-m', 'declare verify scope');
  // Single-quoted -e with a double-quoted JSON.stringify path inside (per
  // the scopedRepo() unitCmd comment above): spawn's shell:true runs this
  // through /bin/sh -c, and the brief's original double-quoted -e nested
  // JSON.stringify's own double quotes, which the shell closed early —
  // corrupting the path into a bareword node then misread as a regex
  // literal ("Invalid regular expression flags").
  const testsCmd = `node -e 'require("fs").writeFileSync(${JSON.stringify(marker)}, "ran")'`;
  const args = ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--cmd', `tests=${testsCmd}`];
  const full = await runCli(args, { cwd: r.repo });
  assert.strictEqual(full.code, 0, full.stderr);
  assert.ok(fs.existsSync(marker));
  fs.unlinkSync(marker);
  commitFile(r, 'docs/plans/2026-09-06-spec-1-ledger.md', '| 1 | test | row | open | — |\n');
  const run = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: none/m);
  assert.ok(run.stdout.includes('still-verified: bookkeeping-only delta (docs/plans/2026-09-06-spec-1-ledger.md)'));
  assert.ok(!fs.existsSync(marker), 'no tests check may spawn on a bookkeeping-only delta');
  assert.strictEqual(stampOf(r.gitDir).scope, 'none');
});

// A repo whose string-form tests command prints a TAP failure naming
// `failingFile` and exits 1, plus a retry template whose command writes a
// marker with the retried file and exits `retryExit`. `flaky` overrides
// the declaration's flaky section (default: tests/flaky.test.js listed).
function flakyRepo({ failingFile = 'tests/flaky.test.js', retryExit = 0, flaky = { files: ['tests/flaky.test.js'] }, extraDecl = {} } = {}) {
  const r = tmpGitRepo();
  const tap = ['not ok 1 - a flaky one', '  ---', '  stack: |-', `    at TestContext.<anonymous> (${failingFile}:12:5)`, '  ...', '# tests 1', '# pass 0', '# fail 1'].join('\n');
  fs.writeFileSync(path.join(r.repo, 'fail.js'), `process.stdout.write(${JSON.stringify(tap)} + '\\n'); process.exit(1);\n`);
  fs.writeFileSync(path.join(r.repo, 'retry.js'), `require('fs').writeFileSync('retry.marker', process.argv[2]); process.exit(${retryExit});\n`);
  const decl = {
    checks: { tests: 'node fail.js' },
    retry: { tests: 'node retry.js {file}' },
    rules: [{ match: 'src/**', suites: ['tests'], static: true }],
    flaky,
    ...extraDecl,
  };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'flaky fixture');
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const args = ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--cmd', 'tests=node fail.js'];
  return { ...r, branch, args, marker: path.join(r.repo, 'retry.marker'), retryLog: (i) => path.join(r.gitDir, 'claude-tweaks-verify', `tests-retry-tests+flaky.test.js-${i}.log`) };
}

test('flaky retry: an allowlisted failing file is re-run through the template and the run passes with flakyRetried on row, report, and stamp (#1925 AC3)', async () => {
  const r = flakyRepo();
  const { code, stdout, stderr } = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(code, 0, stderr);
  assert.match(stdout, /\| tests \| pass \(flaky-retried: tests\/flaky\.test\.js\) \|/);
  assert.match(stdout, /^CAVEAT: flaky-retried: tests\/flaky\.test\.js — passed on isolated rerun; see .*tests-retry-tests\+flaky\.test\.js-1\.log$/m);
  assert.strictEqual(fs.readFileSync(r.marker, 'utf8'), 'tests/flaky.test.js');
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.pass, true);
  assert.deepStrictEqual(report.checks.tests.flakyRetried, ['tests/flaky.test.js']);
  assert.deepStrictEqual(report.checks.tests.retryDecision, { retry: true, files: ['tests/flaky.test.js'] });
  assert.strictEqual(report.checks.tests.retryAttempts.length, 1);
  assert.strictEqual(report.checks.tests.exitCode, 0);
  const stamp = stampOf(r.gitDir);
  assert.deepStrictEqual(stamp.flakyRetried, ['tests/flaky.test.js']);
  assert.strictEqual(stamp.scope, 'full');
});

test('flaky retry: an unlisted failing file is an ordinary failure — no retry spawned, no stamp, the decision names it (#1925 AC4)', async () => {
  const r = flakyRepo({ failingFile: 'tests/real.test.js' });
  const { code, stdout } = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.match(stdout, /\| tests \| fail \|/);
  assert.doesNotMatch(stdout, /flaky-retried/);
  assert.ok(!fs.existsSync(r.marker), 'no retry command may run for an unlisted file');
  assert.ok(!fs.existsSync(r.retryLog(1)));
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.checks.tests.retryDecision, { retry: false, reason: 'unlisted: [tests/real.test.js]' });
  assert.strictEqual('flakyRetried' in report.checks.tests, false);
});

// Shared by the no-parse test below: writes a verify-scope.json declaring
// `testsCmd` (with a flaky allowlist that never matches this fixture) and
// commits it, returning the --scope args to run it under.
function noParseArgs(r, testsCmd) {
  const decl = {
    checks: { tests: testsCmd },
    retry: { tests: 'node retry.js {file}' },
    rules: [{ match: 'src/**', suites: ['tests'], static: true }],
    flaky: { files: ['tests/flaky.test.js'] },
  };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'no-parse fixture');
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  return ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--cmd', `tests=${testsCmd}`];
}

test('flaky retry: a generic-family failing fixture (no extractable file) gets the no-parse clause on stdout; a passing check gets no clause (#2026)', async () => {
  const r = tmpGitRepo();
  // No TAP/mocha markers at all — sniffFamily classifies this as 'generic'
  // and extractFailingFiles finds nothing to name.
  fs.writeFileSync(path.join(r.repo, 'fail.js'), "process.stdout.write('Something went wrong\\n'); process.exit(1);\n");
  const args = noParseArgs(r, 'node fail.js');
  const { code, stdout } = await runCli(args, { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.match(stdout, /\| tests \| fail \| .*\(retry: no-parse — whole-suite re-run applies\) \|/);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.checks.tests.retryDecision, { retry: false, reason: 'no-parse' });

  // A passing check never carries the clause, even with flaky declared.
  const passRepo = tmpGitRepo();
  fs.writeFileSync(path.join(passRepo.repo, 'ok.js'), "process.exit(0);\n");
  const passArgs = noParseArgs(passRepo, 'node ok.js');
  const passRun = await runCli(passArgs, { cwd: passRepo.repo });
  assert.strictEqual(passRun.code, 0, passRun.stderr);
  assert.doesNotMatch(passRun.stdout, /no-parse/);
});

test('flaky retry: maxRetries 2 performs at most two attempts and an exhausted file fails the run with retryFailed; maxRetries 3 is rejected by the declaration (#1925 AC6)', async () => {
  const r = flakyRepo({ retryExit: 1, flaky: { files: ['tests/flaky.test.js'], maxRetries: 2 } });
  const { code, stdout } = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.match(stdout, /\| tests \| fail \|/);
  assert.ok(fs.existsSync(r.retryLog(1)) && fs.existsSync(r.retryLog(2)), 'two attempts logged');
  assert.ok(!fs.existsSync(r.retryLog(3)));
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.checks.tests.retryFailed, ['tests/flaky.test.js']);
  assert.strictEqual(report.checks.tests.retryAttempts.length, 2);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));

  const r3 = flakyRepo({ flaky: { files: ['tests/flaky.test.js'], maxRetries: 3 } });
  const three = await runCli(r3.args, { cwd: r3.repo });
  assert.strictEqual(three.code, 2);
  assert.match(three.stderr, /flaky\.maxRetries: must be an integer from 0 to 2/);
});

test('flaky retry: a failing lint check never triggers a retry and still fail-fasts tests (#1925 AC7)', async () => {
  const r = flakyRepo();
  const { code } = await runCli([...r.args, '--cmd', 'lint=node fail.js'], { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.ok(!fs.existsSync(r.marker));
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.checks.tests.skipped, 'fail-fast');
  assert.strictEqual('retryDecision' in report.checks.lint, false);
});

test('flaky retry: without --scope (no declaration) a failing tests check is never retried, byte-for-byte today\'s behavior (#1925)', async () => {
  const r = flakyRepo();
  const countStampPath = path.join(r.gitDir, 'claude-tweaks-test-count.json');
  fs.writeFileSync(countStampPath, JSON.stringify({ tests: 1, sha: 'seed', recordedAt: 't', flakyHits: { 'tests/flaky.test.js': 3 } }));
  const { code, stdout } = await runCli(['--cmd', 'tests=node fail.js'], { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.doesNotMatch(stdout, /flaky-retried/);
  assert.ok(!fs.existsSync(r.marker));
  // I1 (#1925 review): a run with no declaration at all must not be read as
  // "the allowlist is empty" — the prior flakyHits map must survive untouched.
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(countStampPath, 'utf8')).flakyHits, { 'tests/flaky.test.js': 3 });
});

test('flaky retry: a check whose log vanished before the hook could read it is an ordinary failure with retryDecision.reason unreadable-log — no retry, no stamp, no crash (#1925 review 3f)', async () => {
  const r = flakyRepo();
  const logDir = tmpDir();
  // The check prints its TAP failure, then removes its own log file (runOne's
  // stream keeps writing to the unlinked inode), so the hook's read sees ENOENT.
  const tap = ['not ok 1 - vanished', '    at TestContext.<anonymous> (tests/flaky.test.js:1:1)', '# tests 1', '# pass 0', '# fail 1'].join('\n');
  fs.writeFileSync(path.join(r.repo, 'fail-unlink.js'), `process.stdout.write(${JSON.stringify(tap)} + '\\n'); require('fs').unlinkSync(process.argv[2]); process.exit(1);\n`);
  const logPath = path.join(logDir, 'tests.log');
  const { code, stdout, stderr } = await runCli([...r.args.slice(0, 4), '--log-dir', logDir, '--cmd', `tests=node fail-unlink.js ${logPath}`], { cwd: r.repo });
  assert.strictEqual(code, 1, stderr);
  assert.doesNotMatch(stdout, /flaky-retried/);
  assert.ok(!fs.existsSync(r.marker), 'no retry may run when the log could not be read');
  const report = JSON.parse(fs.readFileSync(path.join(logDir, 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.checks.tests.retryDecision, { retry: false, reason: 'unreadable-log' });
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));
});

test('flaky retry: a retried-to-pass suite does not fail-fast-skip the suites behind it, so the full set stamps (#1925 design)', async () => {
  const r = tmpGitRepo();
  const tap = ['not ok 1 - flaky', '    at TestContext.<anonymous> (tests/flaky.test.js:1:1)', '# tests 1', '# pass 0', '# fail 1'].join('\n');
  fs.writeFileSync(path.join(r.repo, 'fail.js'), `process.stdout.write(${JSON.stringify(tap)} + '\\n'); process.exit(1);\n`);
  fs.writeFileSync(path.join(r.repo, 'retry.js'), 'process.exit(0);\n');
  fs.writeFileSync(path.join(r.repo, 'other.js'), "require('fs').writeFileSync('other.marker', 'ran');\n");
  const decl = {
    checks: { tests: { unit: 'node fail.js', other: 'node other.js' } },
    retry: { unit: 'node retry.js {file}' },
    rules: [{ match: 'src/**', suites: ['unit'], static: true }],
    flaky: { files: ['tests/flaky.test.js'] },
  };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'two suites');
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const { code, stdout, stderr } = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--cmd', 'unit=node fail.js', '--cmd', 'other=node other.js'], { cwd: r.repo });
  assert.strictEqual(code, 0, stderr);
  assert.match(stdout, /\| unit \| pass \(flaky-retried: tests\/flaky\.test\.js\) \|/);
  assert.match(stdout, /\| other \| pass \|/);
  assert.ok(fs.existsSync(path.join(r.repo, 'other.marker')), 'other ran after unit was retried to a pass');
  assert.deepStrictEqual(stampOf(r.gitDir).flakyRetried, ['tests/flaky.test.js']);
});

test('flaky retry: a pre-seeded flakyHits of 4 escalates on the fifth retry — both caveats render, report.flakyEscalation has one entry, the count stamp records 5 (#1925 AC5)', async () => {
  const r = flakyRepo();
  const countStampPath = path.join(r.gitDir, 'claude-tweaks-test-count.json');
  fs.writeFileSync(countStampPath, JSON.stringify({ tests: 1, sha: 'seed', recordedAt: 't', flakyHits: { 'tests/flaky.test.js': 4 } }));
  const { code, stdout, stderr } = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(code, 0, stderr);
  assert.match(stdout, /^CAVEAT: flaky-retried: tests\/flaky\.test\.js — passed on isolated rerun/m);
  assert.match(stdout, /^CAVEAT: flaky-allowlist: tests\/flaky\.test\.js retried 5 times — file a fix or remove it from the allowlist$/m);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.flakyEscalation, [{ file: 'tests/flaky.test.js', hits: 5 }]);
  const stamp = JSON.parse(fs.readFileSync(countStampPath, 'utf8'));
  assert.deepStrictEqual(stamp.flakyHits, { 'tests/flaky.test.js': 5 });
  assert.strictEqual(stamp.tests, 1);
});

test('flaky retry: hits accumulate across two runs and a file removed from the allowlist is pruned from the map (#1925)', async () => {
  const r = flakyRepo({ flaky: { files: ['tests/flaky.test.js', 'tests/other.test.js'] } });
  const countStampPath = path.join(r.gitDir, 'claude-tweaks-test-count.json');
  fs.writeFileSync(countStampPath, JSON.stringify({ tests: 1, sha: 'seed', recordedAt: 't', flakyHits: { 'tests/other.test.js': 2, 'tests/removed.test.js': 9 } }));
  const first = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(first.code, 0, first.stderr);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(countStampPath, 'utf8')).flakyHits, { 'tests/flaky.test.js': 1, 'tests/other.test.js': 2 });
  assert.doesNotMatch(first.stdout, /flaky-allowlist/);
  // Second run at the same HEAD: the prior stamp is full at this sha, so the
  // scope run is mode none and nothing spawns — the map must be untouched.
  // run 1's retry marker is fixture scaffolding — an untracked file is a real change to the runner, so clear it before proving the unchanged-HEAD run is mode none
  fs.unlinkSync(r.marker);
  const second = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(second.code, 0, second.stderr);
  assert.match(second.stdout, /^Scope: none/m);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(countStampPath, 'utf8')).flakyHits, { 'tests/flaky.test.js': 1, 'tests/other.test.js': 2 });
});

// #1928 AC1: the runner is the mechanical source of the verify event.
function anchoredRunDir(repo) {
  const dir = path.join(repo, '.claude-tweaks', 'pipelines', '2026-09-06T100000-record-7');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('#1928 AC1: --run appends exactly one verify event with the report fields', async () => {
  const { repo } = tmpGitRepo();
  const runDir = anchoredRunDir(repo);
  const { code, stderr } = await runCli(['--run', runDir, '--no-stamp', '--cmd', 'tests=node -e 0'], { cwd: repo });
  assert.strictEqual(code, 0, stderr);
  const lines = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 1);
  const ev = JSON.parse(lines[0]);
  assert.strictEqual(ev.type, 'verify');
  assert.strictEqual(ev.pass, true);
  assert.strictEqual(typeof ev.durationMs, 'number');
  assert.strictEqual(ev.mode, 'full');
  assert.deepStrictEqual(ev.suitesRun, ['tests']);
  assert.match(ev.sha, /^[0-9a-f]{40}$/);
  assert.deepStrictEqual(ev.flakyRetried, []);
  assert.ok(ev.reportPath.endsWith('report.json'));
  assert.strictEqual(typeof ev.ts, 'string');
  assert.strictEqual('attribution' in ev, false);
});

test('#1928 AC1: without --run (or with --run "") the events file is untouched', async () => {
  const { repo } = tmpGitRepo();
  const runDir = anchoredRunDir(repo);
  await runCli(['--no-stamp', '--cmd', 'tests=node -e 0'], { cwd: repo });
  await runCli(['--run', '', '--no-stamp', '--cmd', 'tests=node -e 0'], { cwd: repo });
  assert.strictEqual(fs.existsSync(path.join(runDir, 'events.jsonl')), false);
});

test('#1928 AC1: a run dir outside the main checkout is refused on stderr and nothing is appended', async () => {
  const { repo } = tmpGitRepo();
  const foreign = tmpDir(); // no git root above it → not anchored
  const { code, stderr } = await runCli(['--run', foreign, '--no-stamp', '--cmd', 'tests=node -e 0'], { cwd: repo });
  assert.strictEqual(code, 0, 'a refused --run never fails the verification run itself');
  assert.match(stderr, /--run .* refused/);
  assert.strictEqual(fs.existsSync(path.join(foreign, 'events.jsonl')), false);
});

test('#1928 fix round 1: a fail-fast-skipped check is excluded from the verify event suitesRun', async () => {
  const { repo } = tmpGitRepo();
  const runDir = anchoredRunDir(repo);
  const { code } = await runCli([
    '--run', runDir, '--no-stamp',
    '--cmd', 'lint=node -e "process.exit(1)"',
    '--cmd', 'tests=node -e "console.log(String(1))"',
  ], { cwd: repo });
  assert.notStrictEqual(code, 0);
  const lines = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 1);
  const ev = JSON.parse(lines[0]);
  assert.strictEqual(ev.pass, false);
  assert.ok(!ev.suitesRun.includes('tests'), `suitesRun should not include the fail-fast-skipped 'tests' check: ${JSON.stringify(ev.suitesRun)}`);
  assert.deepStrictEqual(ev.suitesRun, ['lint']);
});
