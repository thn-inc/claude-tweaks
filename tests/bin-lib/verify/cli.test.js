'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const { readText } = require('../../helpers/read-skill');
const { CLI, tmpDir, runCli, tmpGitRepo, nodeCmd, scopedRepo, stampOf, commitFile, flakyRepo, anchoredRunDir } = require('./cli-helpers');

test('recorded exitCode is the check command own exit code (AC4)', async () => {
  const logDir = tmpDir();
  const { code } = await runCli([
    '--log-dir', logDir, '--cmd', 'tests=node -e "process.exit(7)"']);
  assert.notStrictEqual(code, 0);
  const report = JSON.parse(fs.readFileSync(path.join(logDir, 'report.json'), 'utf8'));
  assert.strictEqual(report.checks.tests.exitCode, 7);
  assert.strictEqual(report.pass, false);
  assert.strictEqual(report.effectivePass, false, 'an unadjudicated failure is not an effective pass either (#3316)');
});

test('overall exit is 0 and report carries AC3 top-level fields on pass (AC3, AC7)', async () => {
  const logDir = tmpDir();
  const { code } = await runCli([
    '--log-dir', logDir, '--cmd', 'tests=node -e "console.log(String(1))"']);
  assert.strictEqual(code, 0);
  const report = JSON.parse(fs.readFileSync(path.join(logDir, 'report.json'), 'utf8'));
  assert.strictEqual(report.pass, true);
  assert.strictEqual(report.effectivePass, true, 'a plain pass records effectivePass: true (#3316)');
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
  ], { stdio: ['ignore', outFd, 'ignore'], cwd: tmpDir(), env: { ...process.env, CT_TEST_SUITE_SLOT_HELD: '1' } });
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

test('an unparseable tests check under --count-stamp prints the CAVEAT line and sets countsUnparsed (#1837 AC4, spec-deliverable coverage gap found by review)', async () => {
  const logDir = tmpDir();
  const countStamp = path.join(tmpDir(), 'count.json');
  const { code, stdout } = await runCli([
    '--log-dir', logDir, '--count-stamp', countStamp,
    // A generic-family "tests" output with no parseable summary line at all.
    '--cmd', 'tests=node -e "console.log(\'nothing parseable here\')"']);
  assert.strictEqual(code, 0, 'unparseable counts must not fail an otherwise-passing tests check');
  assert.match(stdout, /^CAVEAT: tests counts unparsed \(family generic\) — count-stamp comparison skipped; see .*\.log$/ms);
  const report = JSON.parse(fs.readFileSync(path.join(logDir, 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.checks.tests.countsUnparsed, { family: 'generic' });
  assert.ok(!('testCountRegression' in report), 'no regression key when there is nothing to compare (omitted, per composeReport, not null)');
});

test('an unparseable tests check with NO --count-stamp in play prints no CAVEAT line and sets no countsUnparsed field (never surfaced when there is no comparison to have skipped)', async () => {
  const { code, stdout } = await runCli([
    '--log-dir', tmpDir(), '--cmd', 'tests=node -e "console.log(\'nothing parseable here\')"']);
  assert.strictEqual(code, 0);
  assert.ok(!stdout.includes('CAVEAT'));
});

test('an unreadable tests log under --count-stamp prints the CAVEAT line too, distinct root cause from an unparseable-but-readable log (#1837 review finding: enrich()\'s unreadable-log path silently skipped this mechanism)', async () => {
  const logDir = tmpDir();
  const countStamp = path.join(tmpDir(), 'count.json');
  const logPath = path.join(logDir, 'tests.log');
  // The child writes real output (so the runner's own createWriteStream has
  // something to flush) and then unlinks its OWN log file before exiting --
  // the write stream stays open (POSIX unlink semantics), but a later
  // readFileSync by verify.js's own enrich() step gets ENOENT, exercising
  // the unreadable-log catch path deterministically.
  // Ledger row 26: run.js's createWriteStream(logPath) opens the file
  // asynchronously, while spawn() starts this child right after -- under
  // load the child can reach unlinkSync before the stream's open has
  // created the file, so unlinkSync throws ENOENT and the child exits 1
  // instead of 0. Poll for the file's existence first (bounded, pure JS,
  // no external `sleep` binary) so the unlink always targets a real file.
  const unlinkOwnLog = nodeCmd("console.log('will vanish'); const fs=require('fs'); const p=process.argv[1]; const deadline=Date.now()+5000; while(!fs.existsSync(p)){ if(Date.now()>deadline){ console.error('log file never appeared: '+p); process.exit(1); } Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50); } fs.unlinkSync(p)", logPath);
  const { code, stdout } = await runCli([
    '--log-dir', logDir, '--count-stamp', countStamp, '--cmd', `tests=${unlinkOwnLog}`]);
  assert.strictEqual(code, 0, 'an unreadable log must not fail an otherwise-passing tests check (exitCode still decides pass/fail)');
  assert.match(stdout, /^CAVEAT: tests counts unparsed \(family unreadable\) — count-stamp comparison skipped/ms);
  const report = JSON.parse(fs.readFileSync(path.join(logDir, 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.checks.tests.countsUnparsed, { family: 'unreadable' });
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

test('#3063 AC1: a check that sleeps past its --cmd-timeout ends the run with exit 1, a timedOut report entry, and no stamp', async () => {
  const { repo, gitDir } = tmpGitRepo();
  const { code, stdout } = await runCli([
    '--cmd', 'tests=node -e "setInterval(() => {}, 1000)"', '--cmd-timeout', 'tests=300',
  ], { cwd: repo });
  assert.strictEqual(code, 1);
  const report = JSON.parse(fs.readFileSync(path.join(gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.pass, false);
  assert.strictEqual(report.checks.tests.exitCode, null);
  assert.strictEqual(report.checks.tests.timedOut, true);
  assert.match(stdout, /\| tests \| fail \| .* \| timed out after [\d.]+s \|/);
  assert.ok(!fs.existsSync(path.join(gitDir, 'claude-tweaks-verify-pass.json')), 'no stamp for a timed-out run');
  assert.ok(!fs.existsSync(path.join(gitDir, 'claude-tweaks-verify-pass')), 'no legacy stamp either');
});

test('#3063: a check that finishes well inside its --cmd-timeout is unaffected', async () => {
  const { repo, gitDir } = tmpGitRepo();
  const { code } = await runCli(['--cmd', 'tests=node -e 0', '--cmd-timeout', 'tests=5000'], { cwd: repo });
  assert.strictEqual(code, 0);
  assert.ok(fs.existsSync(path.join(gitDir, 'claude-tweaks-verify-pass.json')));
});

// #2341: only one --cmd name ("types") gets the fail-fast-before-tests
// tier — the documented workaround for N independent typecheck commands is
// a compound `--cmd types="a && b && c"`, proven working here: each half
// writes its own marker, and a failure in either half fails the combined
// check and skips tests, exactly as a single typecheck command would.
test('#2341 documented workaround: a compound --cmd types="a && b" runs both halves and fails the combined check like a single typecheck command', async () => {
  const { repo, gitDir } = tmpGitRepo();
  const markerA = path.join(repo, 'a.marker');
  const markerB = path.join(repo, 'b.marker');
  const compound = `${nodeCmd("require('fs').writeFileSync(process.argv[1], 'ran')", markerA)} && ${nodeCmd("require('fs').writeFileSync(process.argv[1], 'ran'); process.exit(1)", markerB)}`;
  const { code, stdout } = await runCli(['--cmd', `types=${compound}`, '--cmd', 'tests=node -e 0'], { cwd: repo });
  assert.strictEqual(code, 1);
  assert.ok(fs.existsSync(markerA), 'first half of the compound command must run');
  assert.ok(fs.existsSync(markerB), 'second half of the compound command must run');
  assert.match(stdout, /\| types \| fail \|/);
  assert.match(stdout, /\| tests \| skipped: fail-fast \|/);
  assert.ok(!fs.existsSync(path.join(gitDir, 'claude-tweaks-verify-pass.json')));
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

// #3757: the stamp names the HEAD the checks ran against, never the HEAD they
// finished on — a commit landing mid-run withholds the pass instead of
// crediting the new commit with checks it never ran.
test('#3757: a commit landing mid-run writes no pass stamp, --stamp-status stays unverified, and stdout names the moved tree', async () => {
  const { repo, git, gitDir } = tmpGitRepo();
  const startHead = git('rev-parse', 'HEAD').trim();
  const { code, stdout } = await runCli(['--cmd', 'tests=git commit -q --allow-empty -m mid-run && node -e 0'], { cwd: repo });
  const endHead = git('rev-parse', 'HEAD').trim();
  assert.notStrictEqual(endHead, startHead, 'the check must have committed mid-run');
  assert.strictEqual(code, 0, 'the verdict is unchanged: every check passed');
  const report = JSON.parse(fs.readFileSync(path.join(gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.sha, startHead, 'report.json names the HEAD the checks started on, not the one they finished on');
  assert.ok(!fs.existsSync(path.join(gitDir, 'claude-tweaks-verify-pass.json')), 'no JSON stamp for a moved tree');
  assert.ok(!fs.existsSync(path.join(gitDir, 'claude-tweaks-verify-pass')), 'no legacy twin for a moved tree');
  assert.match(stdout, new RegExp(`tree moved during the run \\(HEAD ${startHead.slice(0, 9)} -> ${endHead.slice(0, 9)}\\); no pass stamp written`));
  const s = JSON.parse((await runCli(['--stamp-status'], { cwd: repo })).stdout);
  assert.strictEqual(s.present, false);
  assert.strictEqual(s.match, false);
  assert.strictEqual(s.verifiedHead, false);
});

test('#3757: a commit landing mid-run on a failing run also prints the moved-tree line', async () => {
  const { repo } = tmpGitRepo();
  const { code, stdout } = await runCli(['--cmd', 'tests=git commit -q --allow-empty -m mid-run && exit 1'], { cwd: repo });
  assert.notStrictEqual(code, 0);
  assert.match(stdout, /tree moved during the run \(HEAD \w{9} -> \w{9}\); no pass stamp written/);
});

// #3757: dirty alone is not a moved tree — a check that leaves an untracked
// artifact still stamps, recording dirty:true; --stamp-status never verifies it.
test('#3757: a check that leaves an untracked artifact mid-run still writes the stamp with dirty:true, never verified', async () => {
  const { repo, gitDir } = tmpGitRepo();
  const write = `node -e "require('fs').writeFileSync('artifact.txt', 'x')"`;
  const { code, stdout } = await runCli(['--cmd', `tests=${write}`], { cwd: repo });
  assert.strictEqual(code, 0);
  assert.ok(!/tree moved during the run/.test(stdout), 'an untracked artifact is not a moved tree');
  const stamp = JSON.parse(fs.readFileSync(path.join(gitDir, 'claude-tweaks-verify-pass.json'), 'utf8'));
  assert.strictEqual(stamp.dirty, true);
  const status = JSON.parse((await runCli(['--stamp-status'], { cwd: repo })).stdout);
  assert.strictEqual(status.present, true);
  assert.strictEqual(status.dirty, true);
  assert.strictEqual(status.match, false);
  assert.strictEqual(status.verifiedHead, false);
});

// #3757: dirty is start OR end — edits that were present when the run began and
// reverted mid-run (HEAD unmoved) must not let the stamp claim a clean tree.
test('#3757: a run that starts dirty and reverts the edit mid-run stamps dirty:true, never verified', async () => {
  const { repo, git, gitDir } = tmpGitRepo();
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one\n');
  git('add', 'tracked.txt');
  git('commit', '-q', '-m', 'track');
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'two\n');
  const { code, stdout } = await runCli(['--cmd', 'tests=git checkout -- tracked.txt && node -e 0'], { cwd: repo });
  assert.strictEqual(code, 0);
  assert.strictEqual(git('status', '--porcelain').trim(), '', 'the check reverted the edit, so the tree is clean at the end');
  assert.ok(!/tree moved during the run/.test(stdout), 'HEAD did not move');
  const stamp = JSON.parse(fs.readFileSync(path.join(gitDir, 'claude-tweaks-verify-pass.json'), 'utf8'));
  assert.strictEqual(stamp.dirty, true, 'the checks ran against the dirty tree');
  const status = JSON.parse((await runCli(['--stamp-status'], { cwd: repo })).stdout);
  assert.strictEqual(status.present, true);
  assert.strictEqual(status.verifiedHead, false);
});

// #3757: a status read that fails at the end (HEAD still readable) must not be
// vouched for by a clean start read — the stamp records dirty:null, never false.
test('#3757: a clean start with an unreadable end-of-run status stamps dirty:null, never dirty:false', async () => {
  const { repo, gitDir } = tmpGitRepo();
  const corrupt = `node -e "require('fs').writeFileSync(require('path').join('${gitDir.replace(/\\/g, '/')}', 'index'), 'garbage')"`;
  const { code } = await runCli(['--cmd', `tests=${corrupt}`], { cwd: repo });
  assert.strictEqual(code, 0);
  const stamp = JSON.parse(fs.readFileSync(path.join(gitDir, 'claude-tweaks-verify-pass.json'), 'utf8'));
  assert.strictEqual(stamp.dirty, null, 'an end-of-run status that could not be read is unknown, not clean');
});

// #3799: --cwd moves only the check spawns; the stamp and report belong to
// the invoking checkout, so a --cwd in another checkout is refused up front.
test('#3799: a --cwd in another checkout exits 2 before any check runs and writes nothing under the invoking checkout', async () => {
  const a = tmpGitRepo();
  const b = tmpGitRepo();
  const mark = `node -e "require('fs').writeFileSync('ran.marker', 'x')"`;
  const { code, stderr } = await runCli(['--cmd', `tests=${mark}`, '--cwd', b.repo], { cwd: a.repo });
  assert.strictEqual(code, 2);
  assert.ok(stderr.includes(fs.realpathSync(b.gitDir)), 'names the --cwd checkout git dir');
  assert.ok(stderr.includes(fs.realpathSync(a.gitDir)), 'names the invoking checkout git dir');
  assert.ok(!fs.existsSync(path.join(b.repo, 'ran.marker')), 'no check spawned');
  assert.ok(!fs.existsSync(path.join(a.gitDir, 'claude-tweaks-verify-pass.json')), 'no stamp for the invoking checkout');
  assert.ok(!fs.existsSync(path.join(a.gitDir, 'claude-tweaks-verify', 'report.json')), 'no report for the invoking checkout');
  assert.ok(!fs.existsSync(path.join(a.gitDir, 'claude-tweaks-test-count.json')), 'no count stamp for the invoking checkout');
});

test('#3799: a --cwd in a sibling worktree of the same repository exits 2 — each worktree owns its own stamp', async () => {
  const a = tmpGitRepo();
  const sibling = path.join(tmpDir(), 'sibling');
  a.git('worktree', 'add', '-q', '-b', 'sibling', sibling);
  const { code, stderr } = await runCli(['--cmd', 'tests=node -e 0', '--cwd', sibling], { cwd: a.repo });
  assert.strictEqual(code, 2);
  assert.ok(stderr.includes(fs.realpathSync(path.join(a.gitDir, 'worktrees', 'sibling'))), 'names the sibling worktree git dir');
  assert.ok(!fs.existsSync(path.join(a.gitDir, 'claude-tweaks-verify-pass.json')), 'no stamp for the invoking checkout');
});

test('#3799: a case-variant --cwd naming the invoking checkout still runs and stamps on a case-insensitive filesystem', async (t) => {
  const a = tmpGitRepo();
  const variant = path.join(path.dirname(a.repo), path.basename(a.repo).toUpperCase());
  if (variant === a.repo || !fs.existsSync(variant)) {
    t.skip('case-sensitive filesystem — a case variant is a different directory');
    return;
  }
  const { code, stderr } = await runCli(['--cmd', 'tests=node -e 0', '--cwd', variant], { cwd: a.repo });
  assert.strictEqual(code, 0, stderr);
  assert.ok(fs.existsSync(path.join(a.gitDir, 'claude-tweaks-verify-pass.json')));
});

test('#3799: a symlinked --cwd resolving to the invoking checkout still runs and stamps', async () => {
  const a = tmpGitRepo();
  const link = path.join(tmpDir(), 'link');
  fs.symlinkSync(a.repo, link, process.platform === 'win32' ? 'junction' : 'dir');
  const { code, stderr } = await runCli(['--cmd', 'tests=node -e 0', '--cwd', link], { cwd: a.repo });
  assert.strictEqual(code, 0, stderr);
  assert.ok(fs.existsSync(path.join(a.gitDir, 'claude-tweaks-verify-pass.json')));
});

test('#3799: a --cwd outside any git checkout exits 2 and says so', async () => {
  const a = tmpGitRepo();
  const { code, stderr } = await runCli(['--cmd', 'tests=node -e 0', '--cwd', tmpDir()], { cwd: a.repo });
  assert.strictEqual(code, 2);
  assert.match(stderr, /not inside a git checkout/);
});

test('#3799: a --cwd subdirectory of the invoking checkout still runs and stamps', async () => {
  const a = tmpGitRepo();
  fs.mkdirSync(path.join(a.repo, 'packages', 'app'), { recursive: true });
  // The probe writes its own process.cwd(), so a --cwd that is silently ignored
  // leaves it at the checkout root and fails the location assertions below.
  const probe = nodeCmd("require('fs').writeFileSync('cwd-probe.txt', process.cwd())");
  const { code } = await runCli(['--cmd', `tests=${probe}`, '--cwd', 'packages/app'], { cwd: a.repo });
  assert.strictEqual(code, 0);
  assert.ok(fs.existsSync(path.join(a.gitDir, 'claude-tweaks-verify-pass.json')));
  const appProbe = path.join(a.repo, 'packages', 'app', 'cwd-probe.txt');
  assert.ok(fs.existsSync(appProbe), 'the check ran in packages/app');
  assert.ok(!fs.existsSync(path.join(a.repo, 'cwd-probe.txt')), 'the check did not run at the checkout root');
  // Realpath on both sides: macOS temp dirs resolve through /private.
  const ran = fs.realpathSync(fs.readFileSync(appProbe, 'utf8'));
  const want = fs.realpathSync(path.join(a.repo, 'packages', 'app'));
  assert.strictEqual(ran, want, "the check's process.cwd() is packages/app");
});

test('#3799: the usage text says --cwd must stay inside the checkout verify.js runs from', async () => {
  const { code, stderr } = await runCli(['--help']);
  assert.strictEqual(code, 2);
  assert.match(stderr, /--cwd must stay inside the checkout verify\.js runs from/);
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

test('--scope: a none run anchored on a baseline-adjudicated full stamp carries its baseline marker forward (#3043)', async () => {
  const r = scopedRepo([
    { match: 'src/**', suites: ['unit'], static: true },
    { match: 'docs/**', suites: [], static: false },
  ]);
  const head = r.git('rev-parse', 'HEAD').trim();
  const marker = { base: 'origin/main', baseSha: 'b'.repeat(40), baselineFailing: ['tests/env.test.js'], flakyPassed: [] };
  fs.writeFileSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json'), JSON.stringify({
    sha: head, dirty: false, scope: 'full', fullSha: head, base: null, changedFiles: [], suitesRun: ['unit', 'other'],
    flakyRetried: [], reportPath: path.join(r.gitDir, 'report.json'), at: new Date().toISOString(), baseline: marker,
  }));
  commitFile(r, 'docs/a.md', 'docs');
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: none/m);
  const s = stampOf(r.gitDir);
  assert.strictEqual(s.scope, 'none');
  assert.strictEqual(s.fullSha, head);
  assert.deepStrictEqual(s.baseline, marker);
  const status = JSON.parse((await runCli(['--stamp-status'], { cwd: r.repo })).stdout);
  assert.strictEqual(status.baselineAdjudicated, true);
  assert.strictEqual(status.verifiedHead, true);
});

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

test('--scope with no declaration file is a usage error naming the resolved path, never a silent full run (#3017, supersedes #1922\'s fallback)', async () => {
  // #1922 originally made a missing declaration behave as a silent full
  // run. #3017 reverses that: today's "no declaration" fallback is exactly
  // how a cwd/typo mismatch went unnoticed until an unscoped run had
  // already run — a missing --scope file is now a hard usage error.
  const r = tmpGitRepo();
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const run = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--cmd', 'tests=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 2, run.stderr);
  assert.match(run.stderr, /--scope: no declaration at/);
  assert.match(run.stderr, new RegExp(path.join(r.repo, '.claude-tweaks', 'verify-scope.json').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.strictEqual(fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')), false, 'a usage error must never write a pass stamp');
});

test('--scope: an explicit path that does not exist exits 2 naming the resolved (not the literal) path (AC, #3017)', async () => {
  const r = tmpGitRepo();
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const run = await runCli(['--scope', 'does-not-exist.json', '--integration-branch', branch, '--cmd', 'tests=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 2, run.stderr);
  assert.match(run.stderr, /--scope: no declaration at/);
  assert.match(run.stderr, new RegExp(path.join(r.repo, 'does-not-exist.json').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('--scope: a relative path resolves against --cwd, not process.cwd(), so a subdirectory invocation still finds the declaration (#3017)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  const sub = path.join(r.repo, 'sub');
  fs.mkdirSync(sub);
  // Process cwd is the subdirectory; --cwd (not the process cwd) names the
  // real checkout root — the same shape verify.js's own check-command
  // spawning already uses --cwd for.
  const run = await runCli(
    ['--scope', r.declPath, '--cwd', r.repo, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'],
    { cwd: sub },
  );
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: full/m, 'the declaration must be found and read, not silently missed');
  assert.ok(fs.existsSync(r.marker), 'the declared unit command actually ran');
});

test('--scope: an absolute path is used as-is, --cwd-resolution is for relative paths only (#3017)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  const absDeclPath = path.join(r.repo, '.claude-tweaks', 'verify-scope.json');
  const run = await runCli(
    ['--scope', absDeclPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'],
    { cwd: r.repo },
  );
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: full/m);
});

test('--scope tool-scoped: {base} is substituted into the single tests command and fullSha never advances (#1922 Gotchas)', async () => {
  const r = tmpGitRepo();
  const out = path.join(r.repo, 'base-seen.txt');
  // Built with nodeCmd (see scopedRepo's unitCmd): the path and the {base}
  // placeholder both ride in argv, so neither is quoted inside the script text.
  const decl = {
    checks: { tests: nodeCmd("require('fs').writeFileSync(process.argv[1], process.argv[2])", out, '{base}') },
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

test('--scope with no --cmd and nothing declared for a static check is not required at all — unchanged (#1922)', async () => {
  // Unchanged by #3022: types/lint are only ever "required" when the
  // declaration itself declares a command for them. This repo's decl
  // declares neither, so a static:true rule's selection needs nothing for
  // them — and #3022 lets its map-form unit/other suites run from the
  // declaration with no --cmd at all.
  const r = tmpGitRepo();
  const unitMarker = path.join(r.repo, 'unit.marker');
  const otherMarker = path.join(r.repo, 'other.marker');
  fs.writeFileSync(path.join(r.repo, 'dummy.js'), '1;\n');
  r.git('add', 'dummy.js');
  r.git('commit', '-q', '-m', 'dummy');
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify({
    checks: {
      tests: {
        unit: nodeCmd("require('fs').writeFileSync(process.argv[1], 'ran')", unitMarker),
        other: nodeCmd("require('fs').writeFileSync(process.argv[1], 'ran')", otherMarker),
      },
    },
    rules: [{ match: 'src/**', suites: ['unit'], static: true }],
  }));
  r.git('add', '.claude-tweaks/verify-scope.json');
  r.git('commit', '-q', '-m', 'declare map-form scope, no types/lint');
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const run = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.ok(fs.existsSync(unitMarker), 'unit\'s declared command ran with no --cmd at all');
  assert.ok(fs.existsSync(otherMarker), 'other\'s declared command ran too — full mode selects every declared suite');
});

test('--scope: a plain string-form tests declaration still requires an explicit --cmd — #3022\'s auto-run is map-form only (AC)', async () => {
  const r = tmpGitRepo();
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify({
    checks: { tests: 'npm test' }, rules: [{ match: 'src/**', suites: ['tests'], static: false }],
  }));
  r.git('add', '.claude-tweaks/verify-scope.json');
  r.git('commit', '-q', '-m', 'declare string-form scope');
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const run = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch], { cwd: r.repo });
  assert.strictEqual(run.code, 2, run.stderr);
  assert.match(run.stderr, /--scope: mode full requires --cmd for: tests/);
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

// Review fix H2, superseded by #3022: a filtered check set used to leave a
// required suite out of --cmd as a usage error. A map-form declared suite
// (scopedRepo's 'other') can no longer be "missing" that way — the
// declaration itself is always a valid command source once it's required —
// so H2 cannot fire here any more; this is now a regression guard that it
// doesn't, plus proof the declared command actually ran (and failed, since
// scopedRepo's 'placeholder' stand-in is not a real command). A baseline
// full pass establishes a real anchor first so the second run is genuinely
// 'scoped' (only 'other' selected) rather than the always-full first run.
test('--scope: a scoped suite with no --cmd runs its own declared command — never a usage error for a map-form suite (#1922 review H2, superseded by #3022)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['other'], static: false }]);
  const baselineArgs = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'];
  const base = await runCli(baselineArgs, { cwd: r.repo });
  assert.strictEqual(base.code, 0, base.stderr);
  const baseline = stampOf(r.gitDir);
  fs.unlinkSync(r.marker); // the marker is untracked; left behind it would pollute the next diff.

  commitFile(r, 'src/a.js', '1');
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`], { cwd: r.repo });
  assert.strictEqual(run.code, 1, run.stderr);
  assert.doesNotMatch(run.stderr, /requires --cmd for/, 'a map-form suite always has a command source now — H2 must not fire');
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.checks.other.command, 'placeholder', 'the declared (unoverridden) command actually ran');
  assert.deepStrictEqual(stampOf(r.gitDir), baseline, 'a failing check must never touch the existing stamp');
});

test('--scope: a --cmd override wins over a declared command for that suite, and report.json names the command that actually ran (#3022 AC)', async () => {
  const r = tmpGitRepo();
  const declaredMarker = path.join(r.repo, 'declared.marker');
  const overrideMarker = path.join(r.repo, 'override.marker');
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  const decl = {
    checks: { tests: { unit: nodeCmd("require('fs').writeFileSync(process.argv[1], 'ran')", declaredMarker) } },
    rules: [{ match: 'src/**', suites: ['unit'], static: false }],
  };
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.claude-tweaks/verify-scope.json');
  r.git('commit', '-q', '-m', 'declare');
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const overrideCmd = nodeCmd("require('fs').writeFileSync(process.argv[1], 'ran')", overrideMarker);
  const run = await runCli(
    ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--cmd', `unit=${overrideCmd}`],
    { cwd: r.repo },
  );
  assert.strictEqual(run.code, 0, run.stderr);
  assert.ok(fs.existsSync(overrideMarker), 'the --cmd override must run instead of the declared command');
  assert.ok(!fs.existsSync(declaredMarker), 'the declared command must not run once overridden');
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.checks.unit.command, overrideCmd, 'report.json names the command that actually ran — the override, not the declared one');
});

test('--scope: --cmd-env attaches to a declared-only suite with no matching --cmd (#3022 AC)', async () => {
  const r = tmpGitRepo();
  const marker = path.join(r.repo, 'env.marker');
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  const decl = {
    checks: { tests: { unit: nodeCmd("require('fs').writeFileSync(process.argv[1], process.env.FOO || '')", marker) } },
    rules: [{ match: 'src/**', suites: ['unit'], static: false }],
  };
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.claude-tweaks/verify-scope.json');
  r.git('commit', '-q', '-m', 'declare');
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const run = await runCli(
    ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--cmd-env', 'unit=FOO=bar'],
    { cwd: r.repo },
  );
  assert.strictEqual(run.code, 0, run.stderr);
  assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'bar', '--cmd-env must bind even though no --cmd named "unit"');
});

test('--scope: --cmd-env naming neither a --cmd nor a declared suite is still a usage error (#3022)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: false }]);
  const run = await runCli(
    ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0', '--cmd-env', 'nonexistent=FOO=1'],
    { cwd: r.repo },
  );
  assert.strictEqual(run.code, 2, run.stderr);
  assert.match(run.stderr, /--cmd-env "nonexistent" names no check/);
});

test('--scope: a scoped (non-full) selection runs only the selected suite\'s declared command, not every declared suite (#3022)', async () => {
  const r = tmpGitRepo();
  const unitMarker = path.join(r.repo, 'unit.marker');
  const otherMarker = path.join(r.repo, 'other.marker');
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  const decl = {
    checks: {
      tests: {
        unit: nodeCmd("require('fs').writeFileSync(process.argv[1], 'ran')", unitMarker),
        other: nodeCmd("require('fs').writeFileSync(process.argv[1], 'ran')", otherMarker),
      },
    },
    rules: [
      { match: 'src/**', suites: ['unit'], static: false },
      { match: 'lib/**', suites: ['other'], static: false },
    ],
  };
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.claude-tweaks/verify-scope.json');
  r.git('commit', '-q', '-m', 'declare map-form scope');
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  // Run 1: full (first run, no prior stamp) establishes the anchor.
  const full = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch], { cwd: r.repo });
  assert.strictEqual(full.code, 0, full.stderr);
  fs.unlinkSync(unitMarker);
  fs.unlinkSync(otherMarker);
  // Run 2: only touch src/**, so only 'unit' is selected this time.
  commitFile(r, 'src/a.js', 'content');
  const scoped = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch], { cwd: r.repo });
  assert.strictEqual(scoped.code, 0, scoped.stderr);
  assert.match(scoped.stdout, /^Scope: scoped/m);
  assert.ok(fs.existsSync(unitMarker), 'the selected suite\'s declared command must run');
  assert.ok(!fs.existsSync(otherMarker), 'an unselected declared suite must not run');
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
  assert.doesNotMatch(run.stderr, /pass --integration-branch instead/, '#3072 AC5: the refusal must not imply --integration-branch overrides the anchor');
  assert.match(run.stderr, /after an integration-branch merge, --integration-branch narrows the scoped set to this branch's own delta/);
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
  const declTests = nodeCmd("console.log(process.argv[1]); console.log('# tests 3'); console.log('# pass 3'); console.log('# fail 0')", '{base}');
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
  const run1Cmd = nodeCmd("console.log('# tests 500'); console.log('# pass 500'); console.log('# fail 0')");
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

// #2987
test('a dirty path matching a declared `generated` glob never disqualifies the pass stamp — dirty:false, generatedExempt lists it, verifiedHead:true (#2987 AC1)', async () => {
  const r = scopedRepo(
    [{ match: 'src/**', suites: ['unit'], static: true }],
    { generated: ['dist/**'] },
  );
  commitFile(r, 'dist/bundle.js', 'v1');
  // Simulate a check that regenerates a tracked, declared file in place —
  // dirty at stamp time, matching the declared glob exactly.
  fs.writeFileSync(path.join(r.repo, 'dist', 'bundle.js'), 'v2-regenerated');
  const args = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'];
  const run = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const stamp = stampOf(r.gitDir);
  assert.strictEqual(stamp.dirty, false, 'the stamp itself reads clean despite the dirty generated path');
  assert.deepStrictEqual(stamp.generatedExempt, ['dist/bundle.js']);
  // Bare --stamp-status (no --scope) discovers the default declaration
  // (#4006, inverting this pin's pre-#4006 "never re-derives" posture) and
  // re-derives the SAME generated exemption against the live tree, so every
  // gate that reads bare status sees match/verifiedHead true here too.
  const bare = JSON.parse((await runCli(['--stamp-status'], { cwd: r.repo })).stdout);
  assert.strictEqual(bare.dirty, true, 'the LIVE tree is still genuinely dirty — only the verdict is exempted');
  assert.deepStrictEqual(bare.liveGeneratedExempt, ['dist/bundle.js']);
  assert.strictEqual(bare.match, true, 'the discovered declaration makes dist/** a declared generated path');
  assert.strictEqual(bare.verifiedHead, true);
  // --stamp-status --scope re-derives the SAME exemption against the live
  // tree, so match/verifiedHead stay true for as long as the only dirty
  // path is the declared-generated one (#2987's whole point: a build that
  // regenerates the same file every run must not stay permanently unverified).
  const status = JSON.parse((await runCli(['--stamp-status', '--scope', r.declPath], { cwd: r.repo })).stdout);
  assert.strictEqual(status.dirty, true, 'the LIVE tree is still genuinely dirty — only the stamp is exempted');
  assert.deepStrictEqual(status.liveGeneratedExempt, ['dist/bundle.js']);
  assert.strictEqual(status.match, true);
  assert.strictEqual(status.verifiedHead, true);
});

// The stamp's dirty gate was never on the WRITE side (it always writes for a
// passing full run, dirty or not — "dirty never gates the write"); the
// exemption only changes what the stamp's own `dirty`/`generatedExempt`
// fields record, which then decides the READ side's match/verifiedHead.
test('a dirty path NOT matching any declared `generated` glob still disqualifies the stamp exactly as before (#2987 AC2)', async () => {
  const r = scopedRepo(
    [{ match: 'src/**', suites: ['unit'], static: true }],
    { generated: ['dist/**'] },
  );
  commitFile(r, 'dist/bundle.js', 'v1');
  fs.writeFileSync(path.join(r.repo, 'dist', 'bundle.js'), 'v2-regenerated'); // would be exempt alone
  fs.writeFileSync(path.join(r.repo, 'notes.txt'), 'uncommitted'); // NOT exempt — disqualifies the whole run
  const args = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'];
  const run = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const stamp = stampOf(r.gitDir);
  assert.strictEqual(stamp.dirty, true, 'one non-generated dirty path means the stamp stays dirty:true');
  assert.strictEqual('generatedExempt' in stamp, false);
  const status = JSON.parse((await runCli(['--stamp-status', '--scope', r.declPath], { cwd: r.repo })).stdout);
  assert.strictEqual(status.present, true);
  assert.strictEqual(status.match, false);
  assert.strictEqual(status.liveGeneratedExempt, null, 'the live dirty set is not entirely covered by generated globs either');
});

test('a scope file with no `generated` key behaves exactly as today — any dirty path disqualifies (#2987 AC3)', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  fs.writeFileSync(path.join(r.repo, 'notes.txt'), 'uncommitted');
  const args = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'];
  const run = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const stamp = stampOf(r.gitDir);
  assert.strictEqual(stamp.dirty, true);
  assert.strictEqual('generatedExempt' in stamp, false);
  const status = JSON.parse((await runCli(['--stamp-status', '--scope', r.declPath], { cwd: r.repo })).stdout);
  assert.strictEqual(status.match, false);
});

// #3757's dirty is start OR end: a non-generated path dirty when the run
// starts still disqualifies, even if a check removes it before the end read.
test('a non-generated path dirty at the run\'s start disqualifies the exemption even when gone by the end (#2987 + #3757)', async () => {
  const r = scopedRepo(
    [{ match: 'src/**', suites: ['unit'], static: true }],
    { generated: ['dist/**'] },
  );
  commitFile(r, 'dist/bundle.js', 'v1');
  fs.writeFileSync(path.join(r.repo, 'notes.txt'), 'uncommitted'); // NOT generated, dirty at start only
  const regen = 'other=node -e "require(\'fs\').unlinkSync(\'notes.txt\');require(\'fs\').writeFileSync(\'dist/bundle.js\',\'v2\')"';
  const args = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', regen];
  const run = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.ok(!fs.existsSync(path.join(r.repo, 'notes.txt')), 'the check really removed the start-dirty file');
  const stamp = stampOf(r.gitDir);
  assert.strictEqual(stamp.dirty, true);
  assert.strictEqual('generatedExempt' in stamp, false);
});

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

// #2779: the variable name is unique to this file so an inherited value in
// the test runner's own environment can never make these pass by accident.
// The child reads it from its real process environment; the command strings
// carry no shell-syntax assignment, so the same invocation holds under
// cmd.exe and POSIX shells alike.
const ENV_VAR = 'VERIFY_CLI_TEST_2779';

test('#2779: --cmd-env sets the variable in the named check process only, and report.json records no env', async () => {
  assert.strictEqual(process.env[ENV_VAR], undefined, 'precondition: the variable is not inherited');
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'print-env.js'), `console.log('seen=' + String(process.env.${ENV_VAR}));\n`);
  const logDir = tmpDir();
  const { code, stderr } = await runCli([
    '--log-dir', logDir,
    '--cmd', 'foo=node print-env.js',
    '--cmd', 'bar=node print-env.js',
    '--cmd-env', `foo=${ENV_VAR}=1`,
  ], { cwd: dir });
  assert.strictEqual(code, 0, stderr);
  assert.strictEqual(fs.readFileSync(path.join(logDir, 'foo.log'), 'utf8').trim(), 'seen=1');
  assert.strictEqual(fs.readFileSync(path.join(logDir, 'bar.log'), 'utf8').trim(), 'seen=undefined');
  const report = JSON.parse(fs.readFileSync(path.join(logDir, 'report.json'), 'utf8'));
  assert.strictEqual(report.checks.foo.command, 'node print-env.js');
  assert.ok(!('env' in report.checks.foo));
});

test('#2779: a --cmd-env naming an undeclared check exits 2 naming it, with usage, and spawns nothing', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'mark.js'), "require('fs').writeFileSync('ran.marker', 'ran');\n");
  const { code, stderr } = await runCli([
    '--cmd', 'foo=node mark.js', '--cmd-env', `baz=${ENV_VAR}=1`,
  ], { cwd: dir });
  assert.strictEqual(code, 2);
  assert.ok(stderr.includes('--cmd-env "baz" names no declared --cmd (declared: foo)'), stderr);
  assert.ok(stderr.includes('usage:'));
  assert.ok(!fs.existsSync(path.join(dir, 'ran.marker')), 'no check may spawn on a usage error');
});

test('#2779: omitting --cmd-env leaves a --cmd-only run with the inherited environment and nothing else', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'print-env.js'), `console.log('seen=' + String(process.env.${ENV_VAR}));\n`);
  const logDir = tmpDir();
  const { code, stderr } = await runCli(['--log-dir', logDir, '--cmd', 'foo=node print-env.js'], { cwd: dir });
  assert.strictEqual(code, 0, stderr);
  assert.strictEqual(fs.readFileSync(path.join(logDir, 'foo.log'), 'utf8').trim(), 'seen=undefined');
});

test('#2779: a flaky retry of a check runs with that check\'s --cmd-env', async () => {
  const r = flakyRepo();
  fs.writeFileSync(path.join(r.repo, 'retry.js'), `require('fs').writeFileSync('retry.marker', String(process.env.${ENV_VAR}));\n`);
  const { code, stderr } = await runCli([...r.args, '--cmd-env', `tests=${ENV_VAR}=on`], { cwd: r.repo });
  assert.strictEqual(code, 0, stderr);
  assert.strictEqual(fs.readFileSync(r.marker, 'utf8'), 'on');
});

test('#2779: tool-scoped mode\'s synthesized tests command runs with the tests check\'s --cmd-env', async () => {
  const r = tmpGitRepo();
  const out = path.join(r.repo, 'env-seen.txt');
  // The {base} placeholder is what makes a string-form tests check
  // tool-scoped; it rides as an unused trailing argv value since this test
  // reads the env.
  const decl = {
    checks: { tests: nodeCmd(`require('fs').writeFileSync(process.argv[1], String(process.env.${ENV_VAR}))`, out, '{base}') },
    rules: [{ match: 'src/**', suites: [], static: true }, { match: 'docs/**', suites: [], static: false }],
  };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.claude-tweaks/verify-scope.json');
  r.git('commit', '-q', '-m', 'declare');
  const args = [
    '--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.git('symbolic-ref', '--short', 'HEAD').trim(),
    '--cmd', 'tests=node -e 0', '--cmd-env', `tests=${ENV_VAR}=on`,
  ];
  const run1 = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run1.code, 0, run1.stderr);
  commitFile(r, 'src/a.js', '1');
  const run2 = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run2.code, 0, run2.stderr);
  assert.match(run2.stdout, /^Scope: tool-scoped/m);
  assert.strictEqual(fs.readFileSync(out, 'utf8'), 'on');
});

test('#4177 AC1/AC3: no fixture command uses the POSIX-only single-quoted node -e form — cmd.exe gives \' no meaning', () => {
  // Whole-text scan, so a run of spaces or a line break between the tokens
  // still counts; offenders are reported as file:line. The scan covers every
  // file of this split suite (cli.test.js, its cli-*.test.js siblings and
  // cli-helpers.js), since its fixtures were one file before the CI shard split.
  const files = fs.readdirSync(__dirname).filter((n) => /^cli(-[\w-]+)?\.js$/.test(n) || /^cli(-[\w-]+)?\.test\.js$/.test(n));
  const offenders = files.flatMap((n) => {
    const src = readText(path.join(__dirname, n));
    return [...src.matchAll(/node\s+-e\s+\\?'/g)].map((m) => `${n}:${src.slice(0, m.index).split('\n').length}`);
  });
  assert.deepStrictEqual(offenders, [], 'build the command with nodeCmd(script, ...args) instead');
});

test('#4177 AC4: nodeCmd refuses a script or argument whose meaning differs between /bin/sh and cmd.exe', () => {
  assert.strictEqual(nodeCmd("console.log(process.argv[1])", 'C:\\x\\y.txt'), 'node -e "console.log(process.argv[1])" "C:\\x\\y.txt"');
  for (const [bad, ch] of [['a"b', '"'], ['a$b', '$'], ['a`b', '`'], ['a\\b', '\\'], ['a%b', '%']]) {
    assert.throws(() => nodeCmd(bad), (e) => e.message.startsWith(`nodeCmd: script contains ${JSON.stringify(ch)},`), `script ${bad} names ${ch}`);
  }
  for (const [bad, ch] of [['a"b', '"'], ['a$b', '$'], ['a`b', '`'], ['a%b', '%'], ['C:\\a\\\\b', '\\\\']]) {
    assert.throws(() => nodeCmd('0', bad), (e) => e.message.endsWith(`contains ${JSON.stringify(ch)}, which /bin/sh or cmd.exe interprets`), `argument ${bad} names ${ch}`);
  }
  assert.throws(() => nodeCmd('0', 'C:\\dir\\'), (e) => e.message.endsWith('contains a trailing backslash, which /bin/sh or cmd.exe interprets'));
});
