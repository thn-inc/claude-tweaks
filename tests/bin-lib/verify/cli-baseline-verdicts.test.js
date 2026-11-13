'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { tmpDir, runCli, anchoredRunDir, baselineRepo, SUITE, PER_FILE, nestedRunEnv, headCommit } = require('./cli-helpers');

// #3810: HEAD forks from the base; the integration branch then moves on
// (fixing env.test.js). --baseline <integ> must adjudicate against the
// merge-base of HEAD and integ, not against the moved integration tip.
function forkedBaselineRepo() {
  const r = baselineRepo();
  const integ = r.git('symbolic-ref', '--short', 'HEAD').trim();
  r.git('checkout', '-q', '-b', 'feature');
  headCommit(r);
  r.git('checkout', '-q', integ);
  fs.writeFileSync(path.join(r.repo, 'tests', 'env.test.js'), "require('node:test')('env', () => {});\n");
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'fix env');
  r.git('checkout', '-q', 'feature');
  return { ...r, integ };
}

test('--baseline <branch>: a failure inherited from the merge-base and fixed on the integration tip is baseline, not attributable (#3810 AC1, AC3)', async () => {
  const r = forkedBaselineRepo();
  const { code, stdout } = await runCli(['--cmd', SUITE, '--baseline', r.integ, '--baseline-cmd', PER_FILE], r.opts);
  assert.strictEqual(code, 0, stdout);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.baselineAdjudicated.verdict, 'pass');
  assert.deepStrictEqual(report.baselineAdjudicated.baselineFailing, ['tests/env.test.js']);
  assert.deepStrictEqual(report.baselineAdjudicated.attributable, []);
  assert.strictEqual(report.baselineAdjudicated.base, r.baseSha);
  assert.strictEqual(report.baselineAdjudicated.baseSha, r.baseSha);
  assert.strictEqual(report.baselineAdjudicated.baseRef, r.integ);
  const stamp = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json'), 'utf8'));
  assert.strictEqual(stamp.baseline.base, r.baseSha);
  assert.match(stdout, new RegExp(`Baseline: adjudicated against ${r.baseSha.slice(0, 9)} \\(merge-base of HEAD and ${r.integ}\\)`));
  // The table's Status cell names the ref as passed, not the merge-base sha (the two differ on this fixture).
  assert.ok(stdout.includes(`pass (baseline-adjudicated vs ${r.integ}: `), stdout);
});

test('--baseline <branch>: a file passing at the merge-base and failing on the branch stays attributable while the integration tip has moved (#3810 AC2)', async () => {
  const r = baselineRepo();
  const integ = r.git('symbolic-ref', '--short', 'HEAD').trim();
  r.git('checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(r.repo, 'tests', 'ok.test.js'), "require('node:test')('ok', () => { throw new Error('regressed'); });\n");
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'regress ok');
  r.git('checkout', '-q', integ);
  fs.writeFileSync(path.join(r.repo, 'README.md'), 'unrelated\n');
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'integration moves');
  r.git('checkout', '-q', 'feature');
  const { code, stdout } = await runCli(['--cmd', SUITE, '--baseline', integ, '--baseline-cmd', PER_FILE], r.opts);
  assert.strictEqual(code, 1, stdout);
  assert.match(stdout, /ATTRIBUTABLE: tests\/ok\.test\.js/);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.baselineAdjudicated.base, r.baseSha);
});

test('--baseline: a ref sharing no merge-base with HEAD is not adjudicated and exits 1, never 2 (#3810)', async () => {
  const r = baselineRepo();
  headCommit(r);
  const integ = r.git('symbolic-ref', '--short', 'HEAD').trim();
  r.git('checkout', '-q', '--orphan', 'other');
  r.git('commit', '-q', '--allow-empty', '-m', 'orphan');
  r.git('checkout', '-q', integ);
  const { code, stdout } = await runCli(['--cmd', SUITE, '--baseline', 'other', '--baseline-cmd', PER_FILE], r.opts);
  assert.strictEqual(code, 1, stdout);
  assert.ok(stdout.includes('Baseline: not adjudicated — no merge-base between HEAD and other'), stdout);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.baselineAdjudicated.eligible, false);
  assert.strictEqual(report.baselineAdjudicated.baseRef, 'other');
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')), 'no stamp');
});

test('--baseline: a shallow clone whose fork point is not fetched names the shallow cause, fails closed with exit 1 (#3810)', async () => {
  const src = forkedBaselineRepo();
  const clone = path.join(tmpDir(), 'clone');
  // file:// is required: a plain local path ignores --depth and clones in full.
  execFileSync('git', ['clone', '-q', '--depth', '1', '--no-single-branch', `file://${src.repo}`, clone], { stdio: 'ignore' });
  const cloneGit = (...a) => execFileSync('git', a, { cwd: clone, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  assert.strictEqual(cloneGit('rev-parse', '--is-shallow-repository'), 'true');
  assert.throws(() => cloneGit('cat-file', '-e', `${src.baseSha}^{commit}`), 'the fork point must be genuinely absent from the clone');
  const { code, stdout } = await runCli(['--cmd', SUITE, '--baseline', `origin/${src.integ}`, '--baseline-cmd', PER_FILE], { cwd: clone, env: nestedRunEnv() });
  assert.strictEqual(code, 1, stdout);
  assert.ok(stdout.includes(`Baseline: not adjudicated — no merge-base between HEAD and origin/${src.integ} — shallow clone, fork point not fetched (deepen or unshallow the fetch)`), stdout);
  const gitDir = path.join(clone, '.git');
  const report = JSON.parse(fs.readFileSync(path.join(gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.baselineAdjudicated.eligible, false);
  assert.strictEqual(report.baselineAdjudicated.baseRef, `origin/${src.integ}`);
  assert.ok(!fs.existsSync(path.join(gitDir, 'claude-tweaks-verify-pass.json')), 'no stamp');
});

test('--baseline: a file failing only in the full run is flaky — exit 0 with a CAVEAT line naming its isolated log (#3043 I3)', async () => {
  const r = baselineRepo();
  // Fails once (the full run consumes the marker), then passes at base and in isolation.
  const marker = path.join(tmpDir(), 'flake-once');
  fs.writeFileSync(path.join(r.repo, 'tests', 'flaky.test.js'), `const fs = require('fs');\nrequire('node:test')('flaky', () => { if (fs.existsSync(${JSON.stringify(marker)})) { fs.unlinkSync(${JSON.stringify(marker)}); throw new Error('flake'); } });\n`);
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'add flaky');
  const baseSha = r.git('rev-parse', 'HEAD').trim();
  headCommit(r);
  fs.writeFileSync(marker, '');
  const { code, stdout } = await runCli(['--cmd', 'tests=node --test --test-reporter=tap tests/env.test.js tests/flaky.test.js', '--baseline', baseSha, '--baseline-cmd', PER_FILE], r.opts);
  assert.strictEqual(code, 0, stdout);
  assert.ok(stdout.includes(`| tests | pass (baseline-adjudicated vs ${baseSha}: 1 baseline, 1 flaky) |`), stdout);
  assert.match(stdout, /^CAVEAT: baseline-flaky: tests\/flaky\.test\.js — failed in the full run, passed in isolation at HEAD; see .*tests-isolated-tests\+flaky\.test\.js\.log$/m);
});

test('--baseline: a repeatedly baseline-flaky file not on flaky.files accumulates flakyHits across runs and, at the escalation threshold, stages a flaky-allowlist proposal rather than applying one (#3062)', async () => {
  const r = baselineRepo();
  const marker = path.join(tmpDir(), 'flake-repeat-3062');
  fs.writeFileSync(path.join(r.repo, 'tests', 'flaky.test.js'), `const fs = require('fs');\nrequire('node:test')('flaky', () => { if (fs.existsSync(${JSON.stringify(marker)})) { fs.unlinkSync(${JSON.stringify(marker)}); throw new Error('flake'); } });\n`);
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'add flaky');
  const baseSha = r.git('rev-parse', 'HEAD').trim();
  headCommit(r);
  const runDir = anchoredRunDir(r.repo);
  // Only the flaky file is in this --cmd (unlike the #3043 fixtures above,
  // which pair it with the always-failing tests/env.test.js) -- this run's
  // sole concern is the flaky-escalation counting path, so the only failing
  // file must be the one that is flaky: attributable.length === 0 makes
  // the adjudication a clean pass on its own, with nothing else to classify.
  const args = ['--run', runDir, '--cmd', 'tests=node --test --test-reporter=tap tests/flaky.test.js', '--baseline', baseSha, '--baseline-cmd', PER_FILE];
  const countStampPath = path.join(r.gitDir, 'claude-tweaks-test-count.json');

  // No `flaky.files` declaration exists for this file at all (no --scope
  // passed) -- the hit count must still accumulate run over run (#3062
  // AC1), not reset to 1 every time the way a pruned-to-the-allowlist
  // counter would.
  for (let i = 1; i <= 4; i++) {
    fs.writeFileSync(marker, '');
    const { code, stdout } = await runCli(args, r.opts);
    assert.strictEqual(code, 0, stdout);
    assert.doesNotMatch(stdout, /flaky-allowlist/, `run ${i} of 4 must not escalate yet`);
  }
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(countStampPath, 'utf8')).flakyHits, { 'tests/flaky.test.js': 4 });

  fs.writeFileSync(marker, '');
  const fifth = await runCli(args, r.opts);
  assert.strictEqual(fifth.code, 0, fifth.stdout);
  assert.match(
    fifth.stdout,
    /^CAVEAT: flaky-allowlist: tests\/flaky\.test\.js baseline-flaky 5 times — not on flaky\.files; a staged proposal to add it is pending review$/m,
  );
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.flakyEscalation, [{ file: 'tests/flaky.test.js', hits: 5, onAllowlist: false }]);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(countStampPath, 'utf8')).flakyHits, { 'tests/flaky.test.js': 5 });

  // AC2: a staged proposal names the file and its hit count, and
  // verify-scope.json itself is never touched -- the add is never applied
  // silently.
  const stagedPath = path.join(runDir, 'staged', 'flaky-allowlist-tests-flaky.test.js.md');
  assert.ok(fs.existsSync(stagedPath), 'a staged proposal file is written at the escalation threshold');
  const staged = fs.readFileSync(stagedPath, 'utf8');
  assert.match(staged, /tests\/flaky\.test\.js/);
  assert.match(staged, /5 time/);
  assert.match(staged, /flaky\.files/);

  const decisions = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(decisions, /STAGED/);
  assert.match(decisions, /Flaky-allowlist proposal: tests\/flaky\.test\.js baseline-flaky 5 times/);

  assert.ok(!fs.existsSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json')), 'verify-scope.json is never written by the runner');
});

test('--baseline: a repeatedly baseline-flaky file already on flaky.files escalates onAllowlist:true with the fix-or-remove wording even with no --scope (review fix, #3062)', async () => {
  // Review finding: onAllowlist classification was reading `decl`, which is
  // only populated by a --scope invocation -- the canonical no-scope
  // `--baseline` invocation (test/verification.md) always classified every
  // escalated file onAllowlist:false, including one genuinely declared in
  // flaky.files, since a declaration never existed without --scope. A
  // declaration on disk (no --scope passed) must still be read for this
  // classification alone.
  const r = baselineRepo();
  const marker = path.join(tmpDir(), 'flake-repeat-3062-declared');
  fs.writeFileSync(path.join(r.repo, 'tests', 'flaky.test.js'), `const fs = require('fs');\nrequire('node:test')('flaky', () => { if (fs.existsSync(${JSON.stringify(marker)})) { fs.unlinkSync(${JSON.stringify(marker)}); throw new Error('flake'); } });\n`);
  const decl = { checks: { tests: 'x' }, rules: [], flaky: { files: ['tests/flaky.test.js'] } };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'));
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'add flaky + declare it on flaky.files');
  const baseSha = r.git('rev-parse', 'HEAD').trim();
  headCommit(r);
  const runDir = anchoredRunDir(r.repo);
  // No --scope anywhere in these args -- this is the canonical invocation
  // shape (test/verification.md), yet .claude-tweaks/verify-scope.json
  // exists on disk declaring the file.
  const args = ['--run', runDir, '--cmd', 'tests=node --test --test-reporter=tap tests/flaky.test.js', '--baseline', baseSha, '--baseline-cmd', PER_FILE];

  for (let i = 1; i <= 4; i++) {
    fs.writeFileSync(marker, '');
    const { code, stdout } = await runCli(args, r.opts);
    assert.strictEqual(code, 0, stdout);
    assert.doesNotMatch(stdout, /flaky-allowlist/, `run ${i} of 4 must not escalate yet`);
  }

  fs.writeFileSync(marker, '');
  const fifth = await runCli(args, r.opts);
  assert.strictEqual(fifth.code, 0, fifth.stdout);
  assert.match(
    fifth.stdout,
    /^CAVEAT: flaky-allowlist: tests\/flaky\.test\.js retried 5 times — file a fix or remove it from the allowlist$/m,
  );
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.flakyEscalation, [{ file: 'tests/flaky.test.js', hits: 5, onAllowlist: true }]);

  // A genuinely-declared file never gets the "not on flaky.files" staged
  // proposal -- it is already on the allowlist, there is nothing to stage,
  // and nothing is logged to decisions.md (which may not even exist yet).
  assert.ok(!fs.existsSync(path.join(runDir, 'staged', 'flaky-allowlist-tests-flaky.test.js.md')));
  const decisionsPath = path.join(runDir, 'decisions.md');
  if (fs.existsSync(decisionsPath)) {
    assert.doesNotMatch(fs.readFileSync(decisionsPath, 'utf8'), /Flaky-allowlist proposal/);
  }
});

test('--baseline: a repeatedly baseline-flaky, non-allowlisted file with no --run never claims a pending staged proposal that was never written (review fix, #3062)', async () => {
  // Review finding: the caveat line was unconditional on onAllowlist alone --
  // verify.js only ever stages a proposal inside its --run-anchored block,
  // so a run with no --run (or one whose run dir fails anchoring) renders
  // "a staged proposal ... is pending review" while nothing was staged.
  const r = baselineRepo();
  const marker = path.join(tmpDir(), 'flake-repeat-3062-norun');
  fs.writeFileSync(path.join(r.repo, 'tests', 'flaky.test.js'), `const fs = require('fs');\nrequire('node:test')('flaky', () => { if (fs.existsSync(${JSON.stringify(marker)})) { fs.unlinkSync(${JSON.stringify(marker)}); throw new Error('flake'); } });\n`);
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'add flaky');
  const baseSha = r.git('rev-parse', 'HEAD').trim();
  headCommit(r);
  // No --run at all.
  const args = ['--cmd', 'tests=node --test --test-reporter=tap tests/flaky.test.js', '--baseline', baseSha, '--baseline-cmd', PER_FILE];

  for (let i = 1; i <= 4; i++) {
    fs.writeFileSync(marker, '');
    const { code, stdout } = await runCli(args, r.opts);
    assert.strictEqual(code, 0, stdout);
    assert.doesNotMatch(stdout, /flaky-allowlist/, `run ${i} of 4 must not escalate yet`);
  }

  fs.writeFileSync(marker, '');
  const fifth = await runCli(args, r.opts);
  assert.strictEqual(fifth.code, 0, fifth.stdout);
  assert.match(
    fifth.stdout,
    /^CAVEAT: flaky-allowlist: tests\/flaky\.test\.js baseline-flaky 5 times — not on flaky\.files; re-run under an anchored pipeline run directory to stage a proposal, or add it to flaky\.files by hand$/m,
  );
  assert.doesNotMatch(fifth.stdout, /a staged proposal to add it is pending review/);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.flakyEscalation, [{ file: 'tests/flaky.test.js', hits: 5, onAllowlist: false }]);
  assert.ok(!fs.existsSync(path.join(r.repo, '.claude-tweaks')), 'no staged/ or run-dir artifact is created without --run');
});

test('--baseline: a file failing beyond its base tests only in the full run is baseline — exit 0 with a baseline-in-isolation CAVEAT (#3043)', async () => {
  const r = baselineRepo();
  // `old` fails everywhere; `once` fails only in the full run (it consumes the marker).
  const marker = path.join(tmpDir(), 'fail-once');
  fs.writeFileSync(path.join(r.repo, 'tests', 'mixed.test.js'), `const fs = require('fs');\nconst test = require('node:test');\ntest('old', () => { throw new Error('env'); });\ntest('once', () => { if (fs.existsSync(${JSON.stringify(marker)})) { fs.unlinkSync(${JSON.stringify(marker)}); throw new Error('load'); } });\n`);
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'add mixed');
  const baseSha = r.git('rev-parse', 'HEAD').trim();
  headCommit(r);
  fs.writeFileSync(marker, '');
  const { code, stdout } = await runCli(['--cmd', 'tests=node --test --test-reporter=tap tests/mixed.test.js', '--baseline', baseSha, '--baseline-cmd', PER_FILE], r.opts);
  assert.strictEqual(code, 0, stdout);
  assert.ok(stdout.includes(`| tests | pass (baseline-adjudicated vs ${baseSha}: 1 baseline, 0 flaky) |`), stdout);
  assert.match(stdout, /^CAVEAT: baseline-in-isolation: tests\/mixed\.test\.js — in isolation at HEAD it failed only tests that also fail at base; passed there, waived from the full run: once; see .*tests-isolated-tests\+mixed\.test\.js\.log$/m);
});

test('--baseline: the verify event carries the adjudication verdict (#3043)', async () => {
  const r = baselineRepo();
  headCommit(r);
  const runDir = anchoredRunDir(r.repo);
  const { code, stdout } = await runCli(['--run', runDir, '--cmd', SUITE, '--baseline', r.baseSha, '--baseline-cmd', PER_FILE], r.opts);
  assert.strictEqual(code, 0, stdout);
  const ev = JSON.parse(fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').pop());
  assert.strictEqual(ev.baselineAdjudicated, 'pass');
  assert.strictEqual(ev.pass, false, 'the event, like report.json, keeps the raw pass');
});

test('--baseline: an adjudicator that throws (the scratch worktree cannot be created) is "adjudication error", exits 1, writes the report (#3043)', async () => {
  const r = baselineRepo();
  headCommit(r);
  // A plain file where git keeps its worktree registry: `git worktree add` fails.
  fs.writeFileSync(path.join(r.gitDir, 'worktrees'), 'not a directory\n');
  const runDir = anchoredRunDir(r.repo);
  const { code, stdout } = await runCli(['--run', runDir, '--cmd', SUITE, '--baseline', r.baseSha, '--baseline-cmd', PER_FILE], r.opts);
  assert.strictEqual(code, 1, stdout);
  assert.match(stdout, /^Baseline: not adjudicated — adjudication error: /m);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.baselineAdjudicated.eligible, false);
  assert.match(report.baselineAdjudicated.reason, /^adjudication error: /);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')), 'no stamp');
  const ev = JSON.parse(fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').pop());
  assert.strictEqual(ev.baselineAdjudicated, 'ineligible');
});

test('--baseline: the scratch worktree is gone after the run (#3043)', async () => {
  const r = baselineRepo();
  headCommit(r);
  const { stdout } = await runCli(['--cmd', SUITE, '--baseline', r.baseSha, '--baseline-cmd', PER_FILE], r.opts);
  assert.match(stdout, /Baseline: adjudicated against/, 'a scratch worktree was actually created');
  const list = r.git('worktree', 'list', '--porcelain');
  assert.strictEqual((list.match(/^worktree /gm) || []).length, 1, list);
});

test('AC2.1 --baseline: a base-failing file that passes at HEAD reports as fixed (#3313)', async () => {
  const r = baselineRepo();
  fs.writeFileSync(path.join(r.repo, 'tests', 'fixme.test.js'), "require('node:test')('fixme', () => { throw new Error('broken at base'); });\n");
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'add failing fixme');
  const baseSha = r.git('rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(r.repo, 'tests', 'fixme.test.js'), "require('node:test')('fixme', () => {});\n");
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'fix fixme');
  const { code, stdout } = await runCli(['--cmd', 'tests=node --test --test-reporter=tap tests/env.test.js tests/fixme.test.js tests/ok.test.js', '--baseline', baseSha, '--baseline-cmd', PER_FILE], r.opts);
  assert.strictEqual(code, 0, stdout);
  assert.match(stdout, /^Baseline: 0 new, 1 fixed$/m);
  assert.match(stdout, /^FIXED: tests\/fixme\.test\.js — fails at base, passes at HEAD$/m);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.baselineAdjudicated.fixed, ['tests/fixme.test.js']);
  assert.deepStrictEqual(report.baselineAdjudicated.new, []);
});

test('--baseline: an attributable-only run skips the base full run and names why on stdout (#3313)', async () => {
  const r = baselineRepo();
  fs.writeFileSync(path.join(r.repo, 'tests', 'ok.test.js'), "require('node:test')('ok', () => { throw new Error('regressed'); });\n");
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'break ok');
  const { code, stdout } = await runCli(['--cmd', 'tests=node --test --test-reporter=tap tests/ok.test.js', '--baseline', r.baseSha, '--baseline-cmd', PER_FILE], r.opts);
  assert.strictEqual(code, 1, stdout);
  assert.match(stdout, /^Baseline: 1 new, fixed not computed — no failing file classified baseline — base full run skipped$/m);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.baselineAdjudicated.fixed, null);
  assert.strictEqual(report.baselineAdjudicated.fixedReason, 'no failing file classified baseline — base full run skipped');
});

test('--baseline --no-baseline-fixed: skips the base full run even with a base failure, verdict unchanged (#3313)', async () => {
  const r = baselineRepo();
  headCommit(r);
  const { code, stdout } = await runCli(['--cmd', SUITE, '--baseline', r.baseSha, '--baseline-cmd', PER_FILE, '--no-baseline-fixed'], r.opts);
  assert.strictEqual(code, 0, stdout);
  assert.match(stdout, /^Baseline: 0 new, fixed not computed — base full run disabled \(--no-baseline-fixed\)$/m);
  assert.doesNotMatch(stdout, /^FIXED:/m);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.baselineAdjudicated.verdict, 'pass');
  assert.deepStrictEqual(report.baselineAdjudicated.baselineFailing, ['tests/env.test.js']);
  assert.strictEqual(report.baselineAdjudicated.fixed, null);
  assert.ok(!fs.readdirSync(path.join(r.gitDir, 'claude-tweaks-verify')).some((f) => f.includes('base-full')), 'no base full run log');
});

test('--no-baseline-fixed without --baseline exits 2 before any check runs (#3313)', async () => {
  const r = baselineRepo();
  const { code, stderr } = await runCli(['--cmd', SUITE, '--no-baseline-fixed'], r.opts);
  assert.strictEqual(code, 2);
  assert.match(stderr, /--no-baseline-fixed requires --baseline/);
});
