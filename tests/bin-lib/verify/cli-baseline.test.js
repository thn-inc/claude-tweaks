'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const { slotEnv } = require('../../helpers/suite-slot-env');
const { CLI, tmpDir, runCli, tmpGitRepo, commitFile, baselineRepo, SUITE, PER_FILE, nestedRunEnv, headCommit } = require('./cli-helpers');

test('--baseline: failures that also fail at base exit 0, stamp a baseline pass, and --stamp-status says verifiedHead (#3043 AC1)', async () => {
  const r = baselineRepo();
  fs.writeFileSync(path.join(r.repo, 'README.md'), 'change\n');
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'head');
  const { code, stdout } = await runCli(['--cmd', SUITE, '--baseline', r.baseSha, '--baseline-cmd', PER_FILE], r.opts);
  assert.strictEqual(code, 0, stdout);
  assert.match(stdout, /Baseline: adjudicated against .* 1 also fail at base, 0 flaky \(passed in isolation\), 0 attributable/);
  assert.ok(stdout.includes(`| tests | pass (baseline-adjudicated vs ${r.baseSha}: 1 baseline, 0 flaky) |`), stdout);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.pass, false);
  assert.strictEqual(report.effectivePass, true, 'the adjudicated verdict is recorded in the report itself, so consumers never re-derive it (#3316)');
  assert.strictEqual(report.checks.tests.exitCode, 1, 'report.json keeps the raw exit code');
  assert.strictEqual(report.baselineAdjudicated.verdict, 'pass');
  assert.deepStrictEqual(report.baselineAdjudicated.attributable, []);
  const status = JSON.parse((await runCli(['--stamp-status'], r.opts)).stdout);
  assert.strictEqual(status.verifiedHead, true);
  assert.strictEqual(status.match, false);
  assert.strictEqual(status.baselineAdjudicated, true);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass')), 'no legacy twin for an adjudicated pass');
});

// #3757: adjudication re-runs failing files at HEAD, so a commit landing during
// it is a moved tree even though the first checks pass finished before it.
test('#3757: --baseline: a commit landing during adjudication names the moved tree and writes no stamp', async () => {
  const r = baselineRepo();
  fs.writeFileSync(path.join(r.repo, 'README.md'), 'change\n');
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'head');
  const startHead = r.git('rev-parse', 'HEAD').trim();
  const { stdout } = await runCli(['--cmd', SUITE, '--baseline', r.baseSha, '--baseline-cmd', `tests=git commit -q --allow-empty -m adjudicating && ${PER_FILE.slice('tests='.length)}`], r.opts);
  assert.notStrictEqual(r.git('rev-parse', 'HEAD').trim(), startHead, 'the isolated HEAD re-run must have committed');
  assert.match(stdout, new RegExp(`tree moved during the run \\(HEAD ${startHead.slice(0, 9)} -> \\w{9}\\); no pass stamp written`));
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')), 'no JSON stamp for a moved tree');
});

// #3156: the /flow and /dispatch session shape — a linked worktree under the
// main checkout's own tree, on a checkout path containing a space (#3155's
// truncation). An unchanged failing file must classify baseline, never fall
// through to attributable.
test('--baseline: run from a linked worktree nested in a space-containing checkout path, an unchanged failing file classifies baseline (#3156)', async () => {
  const repo = path.join(tmpDir(), 'Code Workspaces', 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'verify-test@example.invalid');
  git(repo, 'config', 'user.name', 'verify test');
  fs.mkdirSync(path.join(repo, 'tests'));
  fs.writeFileSync(path.join(repo, 'tests', 'env.test.js'), "require('node:test')('env', () => { throw new Error('env-specific'); });\n");
  fs.writeFileSync(path.join(repo, 'tests', 'ok.test.js'), "require('node:test')('ok', () => {});\n");
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const baseSha = git(repo, 'rev-parse', 'HEAD').trim();
  const wt = path.join(repo, '.claude', 'worktrees', 'dispatch-record-1');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature', wt);
  fs.writeFileSync(path.join(wt, 'README.md'), 'change\n');
  git(wt, 'add', '.');
  git(wt, 'commit', '-q', '-m', 'head');
  const { code, stdout } = await runCli(['--cmd', SUITE, '--baseline', baseSha, '--baseline-cmd', PER_FILE], { cwd: wt, env: nestedRunEnv() });
  assert.strictEqual(code, 0, stdout);
  const gitDir = git(wt, 'rev-parse', '--absolute-git-dir').trim();
  const report = JSON.parse(fs.readFileSync(path.join(gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.baselineAdjudicated.verdict, 'pass', JSON.stringify(report.baselineAdjudicated));
  assert.deepStrictEqual(report.baselineAdjudicated.baselineFailing, ['tests/env.test.js']);
  assert.deepStrictEqual(report.baselineAdjudicated.attributable, []);
});

test('--baseline: a file that passes at base but fails at HEAD exits 1 naming it, and writes no stamp (#3043 AC2)', async () => {
  const r = baselineRepo();
  fs.writeFileSync(path.join(r.repo, 'tests', 'ok.test.js'), "require('node:test')('ok', () => { throw new Error('regressed'); });\n");
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'break ok');
  const { code, stdout } = await runCli(['--cmd', SUITE, '--baseline', r.baseSha, '--baseline-cmd', PER_FILE], r.opts);
  assert.strictEqual(code, 1);
  assert.match(stdout, /ATTRIBUTABLE: tests\/ok\.test\.js/);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));
});

test('--baseline: an unresolvable ref exits 2 before any check runs (#3043)', async () => {
  const r = baselineRepo();
  const { code, stderr } = await runCli(['--cmd', SUITE, '--baseline', 'no-such-ref', '--baseline-cmd', PER_FILE], r.opts);
  assert.strictEqual(code, 2);
  assert.match(stderr, /--baseline: no-such-ref does not resolve to a commit/);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify', 'tests.log')));
});

test('--baseline: a passing run never adjudicates and stamps exactly as before (#3043)', async () => {
  const r = baselineRepo();
  const { code, stdout } = await runCli(['--cmd', 'tests=node --test tests/ok.test.js', '--baseline', r.baseSha, '--baseline-cmd', PER_FILE], r.opts);
  assert.strictEqual(code, 0);
  assert.doesNotMatch(stdout, /Baseline:/);
  const status = JSON.parse((await runCli(['--stamp-status'], r.opts)).stdout);
  assert.strictEqual(status.match, true);
  assert.strictEqual(status.baselineAdjudicated, false);
});

test('--baseline: a base that already contains HEAD is not adjudicated and exits 1 (#3043 I1)', async () => {
  const r = baselineRepo();
  const { code, stdout } = await runCli(['--cmd', SUITE, '--baseline', 'HEAD', '--baseline-cmd', PER_FILE], r.opts);
  assert.strictEqual(code, 1, stdout);
  assert.ok(stdout.includes(`Baseline: not adjudicated — base HEAD (${r.baseSha.slice(0, 9)}) already contains HEAD — nothing to compare against`), stdout);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')), 'no stamp');
});

test('--baseline: a failing check with no extractable file is not adjudicated and exits 1 (#3043)', async () => {
  const r = baselineRepo();
  headCommit(r);
  const { code, stdout } = await runCli(['--cmd', 'tests=node -e "process.exit(3)"', '--baseline', r.baseSha, '--baseline-cmd', PER_FILE], r.opts);
  assert.strictEqual(code, 1);
  assert.match(stdout, /Baseline: not adjudicated — no-parse/);
});

// #5150: the default declaration's concurrency block reaches adjudication. The declaration is
// written uncommitted; the fixture's one failing file fails identically at base, so no retry spawns.
function writeConcurrencyDecl(r, concurrency) {
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify({
    checks: { tests: 'npm test' }, rules: [{ match: '**', suites: '*', static: false }], ...(concurrency ? { concurrency } : {}),
  }));
}
const BASELINE_ARGS = (r) => ['--cmd', SUITE, '--baseline', r.baseSha, '--baseline-cmd', PER_FILE, '--no-stamp'];
const adjudicationReport = (r) => JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8')).baselineAdjudicated;
const BACKOFF_LINE = /^Baseline: reruns backed off/m;

test('AC1.1: with no declaration the adjudication reports default-serial and prints no back-off line (#5150)', async () => {
  const r = baselineRepo();
  headCommit(r);
  const res = await runCli(BASELINE_ARGS(r), r.opts);
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  assert.deepStrictEqual(adjudicationReport(r).concurrency, { declared: null, used: { baseline: 1, isolated: 1, retry: null }, reason: 'default-serial' });
  assert.doesNotMatch(res.stdout, BACKOFF_LINE);
  assert.doesNotMatch(res.stdout, /scratch\.moved/, 'no moved line while the scratch stayed at the base commit');
});

test('AC2.1: a declared concurrency.reruns reaches adjudicate() from the default declaration, nested run included (#5150)', async () => {
  const r = baselineRepo();
  headCommit(r);
  writeConcurrencyDecl(r, { reruns: 3 });
  const res = await runCli(BASELINE_ARGS(r), r.opts);
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  assert.deepStrictEqual(adjudicationReport(r).concurrency, { declared: 3, used: { baseline: 3, isolated: 3, retry: null }, reason: 'declared' });
  assert.doesNotMatch(res.stdout, BACKOFF_LINE);
});

test('AC3.1: a declared timeoutPatterns match forces serial reruns and prints one line (#5150)', async () => {
  const r = baselineRepo();
  headCommit(r);
  writeConcurrencyDecl(r, { reruns: 4, timeoutPatterns: ['env-specific'] });
  const res = await runCli(BASELINE_ARGS(r), r.opts);
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  assert.deepStrictEqual(adjudicationReport(r).concurrency, { declared: 4, used: { baseline: 1, isolated: 1, retry: null }, reason: 'timeout-evidence: tests' });
  const lines = res.stdout.split('\n').filter((l) => BACKOFF_LINE.test(l));
  assert.deepStrictEqual(lines, ['Baseline: reruns backed off to one at a time from declared reruns 4 — timeout-evidence: tests']);
});

test('a base rerun matching timeoutPatterns runs the later phases serially and prints one phase-timeout line (#5150)', async () => {
  const r = baselineRepo();
  // Only the base commit's env.test.js carries the declared wording, so only the base rerun's log matches.
  commitFile(r, 'tests/env.test.js', "require('node:test')('env', () => { throw new Error('env-at-head'); });\n");
  writeConcurrencyDecl(r, { reruns: 4, timeoutPatterns: ['env-specific'] });
  const res = await runCli(BASELINE_ARGS(r), r.opts);
  const adj = adjudicationReport(r);
  assert.strictEqual(adj.eligible, true, JSON.stringify(adj));
  assert.strictEqual(adj.concurrency.reason, 'phase-timeout: baseline', JSON.stringify(adj.concurrency));
  assert.strictEqual(adj.concurrency.used.baseline, 4);
  assert.strictEqual(adj.concurrency.used.isolated, 1);
  const lines = res.stdout.split('\n').filter((l) => BACKOFF_LINE.test(l));
  assert.deepStrictEqual(lines, ['Baseline: reruns backed off to one at a time from declared reruns 4 — phase-timeout: baseline']);
});

test('timeout evidence with every failing file absent at base spawns no rerun and prints no back-off line (#5150)', async () => {
  const r = baselineRepo();
  commitFile(r, 'tests/new.test.js', "require('node:test')('new', () => { throw new Error('env-specific'); });\n");
  writeConcurrencyDecl(r, { reruns: 4, timeoutPatterns: ['env-specific'] });
  const res = await runCli(['--cmd', 'tests=node --test --test-reporter=tap tests/new.test.js tests/ok.test.js', '--baseline', r.baseSha, '--baseline-cmd', PER_FILE, '--no-stamp'], r.opts);
  assert.strictEqual(res.code, 1, res.stdout + res.stderr);
  assert.deepStrictEqual(adjudicationReport(r).concurrency, { declared: 4, used: { baseline: null, isolated: null, retry: null }, reason: 'timeout-evidence: tests' });
  assert.match(res.stdout, /^ATTRIBUTABLE: tests\/new\.test\.js$/m);
  assert.doesNotMatch(res.stdout, BACKOFF_LINE);
});

test('a --scope run takes concurrency.reruns from the declaration it was given, not the default path (#5150)', async () => {
  const r = baselineRepo();
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  r.git('checkout', '-q', '-b', 'feature');
  commitFile(r, 'ci/verify-scope.json', JSON.stringify({
    checks: { tests: { unit: SUITE.slice('tests='.length) } },
    retry: { unit: PER_FILE.slice('tests='.length) },
    rules: [{ match: '**', suites: '*', static: false }],
    concurrency: { reruns: 3 },
  }));
  const res = await runCli(['--scope', 'ci/verify-scope.json', '--integration-branch', branch, '--baseline', branch, '--no-stamp'], r.opts);
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  assert.ok(!fs.existsSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json')), 'precondition: no default declaration');
  assert.deepStrictEqual(adjudicationReport(r).concurrency, { declared: 3, used: { baseline: 3, isolated: 3, retry: null }, reason: 'declared' });
});

test('a base-side run in a scratch moved off the base commit prints one scratch.moved line (#5150)', async () => {
  const r = baselineRepo();
  headCommit(r);
  // The commit lands in whichever checkout the rerun runs in — at base, the scratch.
  const res = await runCli(['--cmd', SUITE, '--baseline', r.baseSha, '--baseline-cmd', `tests=git commit -q --allow-empty -m adjudicating && ${PER_FILE.slice('tests='.length)}`, '--no-stamp'], r.opts);
  const adj = adjudicationReport(r);
  assert.strictEqual(adj.scratch.moved, true, JSON.stringify(adj.scratch));
  assert.deepStrictEqual(adj.attributable, ['tests/env.test.js']);
  const lines = res.stdout.split('\n').filter((l) => l.includes('scratch.moved'));
  assert.deepStrictEqual(lines, ['Baseline: the scratch checkout was not at the base commit for some base-side run(s) — those runs are no evidence (scratch.moved)']);
});

test('an invalid default declaration prints its concurrency ignored line once on a failing --baseline run (#5150)', async () => {
  const r = baselineRepo();
  headCommit(r);
  writeConcurrencyDecl(r, { reruns: 0 });
  const t = tmpDir();
  const res = await runCli(BASELINE_ARGS(r), { cwd: r.repo, env: slotEnv(tmpDir(), { TMPDIR: t, TMP: t, TEMP: t }) });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  const ignored = res.stderr.split('\n').filter((l) => l.startsWith('verify.js: concurrency ignored — '));
  assert.strictEqual(ignored.length, 1, res.stderr);
  assert.strictEqual(adjudicationReport(r).concurrency.reason, 'default-serial');
});

test('AC7.1: a nested run takes no slot, so its scratch stays a fresh ct-verify-base-* path (#5150)', async () => {
  const r = baselineRepo();
  headCommit(r);
  const res = await runCli(BASELINE_ARGS(r), r.opts);
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  const adj = adjudicationReport(r);
  assert.match(path.basename(path.dirname(adj.scratch.path)), /^ct-verify-base-/);
  assert.ok(!('slot' in adj), JSON.stringify(adj.slot));
  assert.ok(!('fallback' in adj.scratch), JSON.stringify(adj.scratch));
});

test('--baseline: a stale ct-verify-base-* scratch worktree from an earlier interrupted run is named on stderr, and left alone (#3064)', async () => {
  // Detection runs as soon as --baseline resolves to a commit — before any
  // check executes and before adjudication is even attempted — so a trivial
  // passing repo is enough; this test does not need a real baseline mismatch.
  const r = tmpGitRepo();
  const staleParent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-base-')));
  const staleWt = path.join(staleParent, 'wt');
  r.git('worktree', 'add', '--detach', staleWt, 'HEAD');
  // verify.js names the path git's porcelain listing prints, which Git for Windows
  // spells with forward slashes — so the expected path comes from that listing.
  const porcelain = r.git('worktree', 'list', '--porcelain');
  const staleSuffix = `/${path.basename(staleParent)}/wt`;
  const listedWt = porcelain.split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))
    .find((p) => p.replace(/\\/g, '/').endsWith(staleSuffix));
  assert.ok(listedWt, porcelain);
  const { stderr } = await runCli(['--cmd', 'tests=node -e "process.exit(0)"', '--baseline', 'HEAD', '--baseline-cmd', 'tests=node -e 0 {file}'], { cwd: r.repo });
  assert.ok(
    stderr.includes(`verify.js: a stale baseline scratch worktree is registered at ${listedWt} from an earlier interrupted run — remove it manually: git worktree remove --force ${listedWt}`),
    stderr,
  );
  assert.ok(fs.existsSync(staleWt), 'never swept automatically — a sibling session\'s own live scratch would look identical');
  const list = r.git('worktree', 'list', '--porcelain');
  // Nothing else ever creates a scratch worktree here (the run passes outright); the stale one is the only extra entry.
  assert.strictEqual((list.match(/^worktree /gm) || []).length, 2, list);
});

test('--baseline: a SIGINT mid-run removes the scratch worktree and exits 130, leaving nothing registered behind (#3064 AC1)', { skip: process.platform === 'win32' && 'POSIX signal delivery only' }, async () => {
  const r = baselineRepo();
  headCommit(r);
  // {file} is appended but unused by the sleeping script — just needs to
  // still be running when SIGINT arrives.
  const SLOW_PER_FILE = 'tests=node -e "setTimeout(() => {}, 8000)" {file}';
  const child = spawn(process.execPath, [CLI, '--cmd', SUITE, '--baseline', r.baseSha, '--baseline-cmd', SLOW_PER_FILE], {
    cwd: r.repo, env: r.opts.env, stdio: ['ignore', 'ignore', 'ignore'],
  });
  const deadline = Date.now() + 10000;
  let worktreeCount = 1;
  while (Date.now() < deadline) {
    const list = r.git('worktree', 'list', '--porcelain');
    worktreeCount = (list.match(/^worktree /gm) || []).length;
    if (worktreeCount >= 2) break;
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
  assert.strictEqual(worktreeCount, 2, 'the scratch worktree must exist before sending SIGINT');
  child.kill('SIGINT');
  const [code, signal] = await new Promise((resolve) => { child.on('exit', (c, s) => resolve([c, s])); });
  assert.strictEqual(signal, null, 'the process exits via process.exit() itself, never killed outright by the signal');
  assert.strictEqual(code, 130);
  const list = r.git('worktree', 'list', '--porcelain');
  assert.strictEqual((list.match(/^worktree /gm) || []).length, 1, 'no registered scratch worktree afterwards');
});
