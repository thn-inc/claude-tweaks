'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { runCli, tmpGitRepo, nodeCmd, scopedRepo, stampOf, commitFile, baselineRepo, SUITE } = require('./cli-helpers');

// #3511: --scope + --baseline. baselineRepo() on a feature branch carrying a
// map-form declaration (unit = the failing-at-base suite) plus src/a.js.
// The failing suite is declared AHEAD of `other` (the realistic ordering, and
// the #3401 incident's), so every test here depends on run.js's
// continueSuitesAfterFailure keeping the later suite running.
function scopedBaselineRepo(opts = {}) {
  // `'retry' in opts`, not a destructuring default: `{ retry: undefined }` must
  // mean "no retry key" (JSON.stringify drops it), not fall back to the default.
  const retry = 'retry' in opts ? opts.retry : { unit: 'node --test --test-reporter=tap {file}' };
  const r = baselineRepo();
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  // `envProbe`: the failing file reports the PROBE_ENV it ran under, committed
  // on the base so base and HEAD both fail with the same test and the run's
  // per-file logs show which --cmd-env each spawn carried.
  if (opts.envProbe) commitFile(r, 'tests/env.test.js', "require('node:test')('env', () => { throw new Error('PROBE_ENV=' + process.env.PROBE_ENV); });\n");
  r.git('checkout', '-q', '-b', 'feature');
  commitFile(r, '.claude-tweaks/verify-scope.json', JSON.stringify({
    checks: { tests: { unit: SUITE.slice('tests='.length), other: 'node -e 0' } },
    retry,
    rules: [
      { match: 'src/**', suites: ['unit'], static: false },
      { match: '.claude-tweaks/**', suites: [], static: false },
    ],
  }));
  commitFile(r, 'src/a.js', 'module.exports = 1;\n');
  return { ...r, branch, scoped: ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--baseline', branch, '--no-stamp'] };
}

test('AC1.1: --scope + --baseline with no --baseline-cmd adjudicates via the declaration retry template — exit 0, never 2, report carries scope and baselineAdjudicated (#3511)', async () => {
  const r = scopedBaselineRepo();
  const { code, stdout, stderr } = await runCli(r.scoped, r.opts);
  assert.notStrictEqual(code, 2, stderr);
  assert.strictEqual(code, 0, stdout + stderr);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  // No prior stamp anchor → selectScope forces mode full (scope.js), exactly #3401's incident shape.
  assert.strictEqual(report.scope.mode, 'full');
  assert.deepStrictEqual(report.scope.suites, ['unit', 'other']);
  assert.strictEqual(report.baselineAdjudicated.verdict, 'pass');
  assert.deepStrictEqual(report.baselineAdjudicated.baselineFailing, ['tests/env.test.js']);
});

test('--scope + --baseline adjudicates when the failing suite is declared before a passing one — the later suite still runs (#3511)', async () => {
  const r = scopedBaselineRepo();
  const { code, stdout, stderr } = await runCli(r.scoped, r.opts);
  assert.strictEqual(code, 0, stdout + stderr);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.checks.other.skipped, undefined);
  assert.strictEqual(report.checks.other.exitCode, 0);
  assert.strictEqual(report.baselineAdjudicated.verdict, 'pass');
});

test('AC1.1: --scope + --baseline-cmd naming a declared suite with no --cmd is accepted and wins over the retry template (#3511)', async () => {
  const r = scopedBaselineRepo({ retry: { unit: 'node -e "process.exit(9)" {file}' } });
  const { code, stdout, stderr } = await runCli([...r.scoped, '--baseline-cmd', 'unit=node --test --test-reporter=tap {file}'], r.opts);
  assert.strictEqual(code, 0, stdout + stderr);
});

test('--scope: a --baseline-cmd naming neither a --cmd nor a declared suite is a usage error (exit 2) before any check runs (#3511)', async () => {
  const r = scopedBaselineRepo();
  const { code, stderr } = await runCli([...r.scoped, '--baseline-cmd', 'web=node --test {file}'], r.opts);
  assert.strictEqual(code, 2);
  assert.match(stderr, /--baseline-cmd "web" names no --cmd or declared suite \(--cmd: none; suites: unit, other\)/);
  // Before any check runs: no log of any kind was written, not just no unit.log.
  const logDir = path.join(r.gitDir, 'claude-tweaks-verify');
  assert.deepStrictEqual(fs.existsSync(logDir) ? fs.readdirSync(logDir) : [], []);
});

test('--scope: --baseline with no --baseline-cmd and no declared retry template is a usage error (exit 2) (#3511)', async () => {
  const r = scopedBaselineRepo({ retry: undefined });
  const { code, stderr } = await runCli(r.scoped, r.opts);
  assert.strictEqual(code, 2);
  assert.match(stderr, /--baseline: no --baseline-cmd and the declaration has no retry template/);
});

test('--scope + --baseline: a --cmd-env bound to a declared-only suite reaches the per-file base and isolated runs (#3511)', async () => {
  const r = scopedBaselineRepo({ envProbe: true });
  const { code, stdout, stderr } = await runCli([...r.scoped, '--cmd-env', 'unit=PROBE_ENV=set'], r.opts);
  assert.strictEqual(code, 0, stdout + stderr);
  const logDir = path.join(r.gitDir, 'claude-tweaks-verify');
  const logs = fs.readdirSync(logDir);
  for (const kind of ['baseline', 'isolated']) {
    const names = logs.filter((f) => f.startsWith(`unit-${kind}-`));
    assert.ok(names.length > 0, `a unit-${kind}-* log exists: ${logs.join(', ')}`);
    for (const f of names) {
      const body = fs.readFileSync(path.join(logDir, f), 'utf8');
      assert.match(body, /PROBE_ENV=set/, `${f} ran under the declared-only suite's --cmd-env`);
    }
  }
});

// #3072: scopedRepo on its init branch (the integration branch), a feature
// branch cut from it carrying the full-pass anchor, then a --no-ff merge of the
// integration branch bringing in N `ui/**` files plus one own-work `src/**` commit.
function mergedScopedRepo() {
  const r = scopedRepo([
    { match: 'src/**', suites: ['unit'], static: true },
    { match: 'ui/**', suites: ['other'], static: true },
  ]);
  const trunk = r.branch;
  r.git('checkout', '-q', '-b', 'feat');
  return { ...r, trunk };
}

async function anchorFullPass(r, extraArgs = []) {
  const args = ['--scope', r.declPath, '--integration-branch', r.trunk, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0', ...extraArgs];
  const run = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: full/m);
  if (fs.existsSync(r.marker)) fs.unlinkSync(r.marker);
  return stampOf(r.gitDir).fullSha;
}

function mergeTrunk(r, rels) {
  r.git('checkout', '-q', r.trunk);
  for (const rel of rels) commitFile(r, rel, rel);
  r.git('checkout', '-q', 'feat');
  r.git('merge', '-q', '--no-ff', '--no-edit', r.trunk);
}

test('--scope --integration-branch: after an integration-branch merge, only the own-work path selects suites and report.json counts the merge-identical ones (#3072 AC1)', async () => {
  const r = mergedScopedRepo();
  const anchor = await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js', 'ui/b.js', 'ui/c.js']);
  commitFile(r, 'src/own.js', 'own');
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.trunk, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: scoped — 1 changed file\(s\) since/m);
  assert.match(run.stdout, /^merge-narrowed: 3 merge-identical path\(s\) excluded \(identical to /m);
  const s = stampOf(r.gitDir);
  assert.strictEqual(s.fullSha, anchor, 'the anchor is untouched — narrowing filters, it never re-bases');
  assert.deepStrictEqual(s.changedFiles, ['src/own.js']);
  assert.deepStrictEqual(s.suitesRun, ['unit']);
  const report = JSON.parse(fs.readFileSync(s.reportPath, 'utf8'));
  assert.strictEqual(report.scope.base, anchor);
  assert.deepStrictEqual(report.scope.changedFiles, ['src/own.js']);
  assert.deepStrictEqual(report.scope.mergeNarrowing, { ref: r.trunk, excluded: 3, excludedFiles: ['ui/a.js', 'ui/b.js', 'ui/c.js'] });
});

test('--scope: without --integration-branch the same merged fixture selects every anchor..HEAD path, unnarrowed (#3072 AC4)', async () => {
  const r = mergedScopedRepo();
  await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js', 'ui/b.js']);
  commitFile(r, 'src/own.js', 'own');
  const run = await runCli(['--scope', r.declPath, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /merge-narrowed/);
  const report = JSON.parse(fs.readFileSync(stampOf(r.gitDir).reportPath, 'utf8'));
  assert.deepStrictEqual(report.scope.changedFiles, ['src/own.js', 'ui/a.js', 'ui/b.js']);
  assert.strictEqual(report.scope.mergeNarrowing, null);
});

test('--scope --integration-branch: with no integration-branch merge after the anchor, the set equals anchor..HEAD (#3072 AC2)', async () => {
  const r = mergedScopedRepo();
  await anchorFullPass(r);
  commitFile(r, 'src/own.js', 'own');
  commitFile(r, 'ui/a.js', 'a');
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.trunk, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const report = JSON.parse(fs.readFileSync(stampOf(r.gitDir).reportPath, 'utf8'));
  assert.deepStrictEqual(report.scope.changedFiles, ['src/own.js', 'ui/a.js']);
  assert.strictEqual(report.scope.mergeNarrowing, null);
});

test('--scope --integration-branch: a merged-in file the branch then edited stays selected (#3072 AC3)', async () => {
  const r = mergedScopedRepo();
  await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js', 'ui/b.js']);
  commitFile(r, 'ui/a.js', 'edited on the branch');
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.trunk, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const report = JSON.parse(fs.readFileSync(stampOf(r.gitDir).reportPath, 'utf8'));
  assert.deepStrictEqual(report.scope.changedFiles, ['ui/a.js']);
  assert.deepStrictEqual(report.scope.mergeNarrowing, { ref: r.trunk, excluded: 1, excludedFiles: ['ui/b.js'] });
});

// #4638: mergedScopedRepo's rules plus a bookkeeping path (no suite, no static)
// and a static-only path (no suite, static).
function zeroSuiteRepo() {
  const r = scopedRepo([
    { match: 'src/**', suites: ['unit'], static: true },
    { match: 'ui/**', suites: ['other'], static: true },
    { match: 'docs/**', suites: [], static: false },
    { match: 'cfg/**', suites: [], static: true },
  ]);
  const trunk = r.branch;
  r.git('checkout', '-q', '-b', 'feat');
  return { ...r, trunk };
}

async function runScoped(r) {
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.trunk, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0', '--cmd', 'types=node -e 0', '--cmd', 'lint=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const stamp = stampOf(r.gitDir);
  return { run, stamp, report: JSON.parse(fs.readFileSync(stamp.reportPath, 'utf8')) };
}

test('--scope --integration-branch: AC1.1: at the integration tip the changed paths run their suites, never a zero-suite stamp (#4638)', async () => {
  const r = zeroSuiteRepo();
  await anchorFullPass(r);
  r.git('checkout', '-q', r.trunk);
  r.git('checkout', '-q', '-b', 'side');
  commitFile(r, 'src/merged.js', 'merged');
  r.git('checkout', '-q', r.trunk);
  r.git('merge', '-q', '--no-ff', '--no-edit', 'side');
  r.git('checkout', '-q', 'feat');
  r.git('merge', '-q', '--ff-only', r.trunk);
  const { run, stamp, report } = await runScoped(r);
  assert.doesNotMatch(run.stdout, /merge-narrowed/);
  assert.doesNotMatch(run.stdout, /still-verified/);
  assert.match(run.stdout, /^Scope: scoped — 1 changed file\(s\) since/m);
  assert.ok(fs.existsSync(r.marker), 'the unit suite must actually have run');
  assert.deepStrictEqual(stamp.suitesRun, ['unit']);
  assert.strictEqual(report.scope.mergeNarrowing, null);
  assert.deepStrictEqual(report.scope.changedFiles, ['src/merged.js']);
});

test('--scope --integration-branch: AC1.2 (Reading A): a pre-anchor own commit plus a merge never stamps from zero suites (#4638)', async () => {
  const r = zeroSuiteRepo();
  commitFile(r, 'src/pre.js', 'pre');
  await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js']);
  const { run, stamp, report } = await runScoped(r);
  assert.doesNotMatch(run.stdout, /still-verified/);
  assert.deepStrictEqual(stamp.suitesRun, ['other']);
  assert.strictEqual(report.scope.mergeNarrowing, null);
  assert.deepStrictEqual(report.scope.changedFiles, ['ui/a.js']);
});

test('--scope --integration-branch: AC1.2 (Reading A): a merge with nothing of its own never stamps from zero suites (#4638)', async () => {
  const r = zeroSuiteRepo();
  await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js']);
  const { stamp, report } = await runScoped(r);
  assert.deepStrictEqual(stamp.suitesRun, ['other']);
  assert.strictEqual(report.scope.mergeNarrowing, null);
});

test('--scope --integration-branch: AC1.2 (Reading A): a bookkeeping commit past a merge does not hide the merged-in paths (#4638)', async () => {
  const r = zeroSuiteRepo();
  await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js']);
  commitFile(r, 'docs/a.md', 'docs');
  const { run, stamp, report } = await runScoped(r);
  assert.doesNotMatch(run.stdout, /still-verified/);
  assert.deepStrictEqual(stamp.suitesRun, ['other']);
  assert.strictEqual(report.scope.mergeNarrowing, null);
  assert.deepStrictEqual(report.scope.changedFiles, ['docs/a.md', 'ui/a.js']);
});

test('--scope --integration-branch: AC1.2 (Reading A): a static-only narrowed set also declines (#4638)', async () => {
  const r = zeroSuiteRepo();
  await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js']);
  commitFile(r, 'cfg/a.json', '{}');
  const { stamp, report } = await runScoped(r);
  assert.deepStrictEqual(stamp.suitesRun, ['other']);
  assert.strictEqual(report.scope.mergeNarrowing, null);
});

test('--scope --integration-branch: AC1.2 (Reading B): a bookkeeping-only delta still stamps none, unnarrowed (#4638)', async () => {
  const r = zeroSuiteRepo();
  await anchorFullPass(r);
  mergeTrunk(r, ['docs/b.md']);
  commitFile(r, 'docs/a.md', 'docs');
  const { run, stamp, report } = await runScoped(r);
  assert.match(run.stdout, /^Scope: none — 2 changed file\(s\) since/m);
  assert.match(run.stdout, /still-verified: bookkeeping-only delta \(docs\/a\.md, docs\/b\.md\)/);
  assert.strictEqual(stamp.scope, 'none');
  assert.deepStrictEqual(stamp.suitesRun, []);
  assert.strictEqual(report.scope.mergeNarrowing, null);
});

test('--scope --integration-branch: AC1.2 (Reading B): a static-checked bookkeeping-only delta still stamps static-only, unnarrowed (#4638)', async () => {
  const r = zeroSuiteRepo();
  await anchorFullPass(r);
  mergeTrunk(r, ['cfg/b.json']);
  commitFile(r, 'docs/a.md', 'docs');
  const { run, stamp, report } = await runScoped(r);
  assert.strictEqual(report.scope.mode, 'static-only');
  assert.strictEqual(stamp.scope, 'static-only');
  assert.deepStrictEqual(stamp.suitesRun, []);
  assert.strictEqual(report.scope.mergeNarrowing, null);
  assert.deepStrictEqual(report.scope.changedFiles, ['cfg/b.json', 'docs/a.md']);
  assert.doesNotMatch(run.stdout, /merge-narrowed/);
});

test('--scope --integration-branch: a tool-scoped declaration whose merge-narrowed set went empty re-selects tool-scoped over the full set (#4638)', async () => {
  const r = tmpGitRepo();
  const out = path.join(r.gitDir, 'base-seen.marker');
  const decl = {
    checks: { tests: nodeCmd("require('fs').writeFileSync(process.argv[1], process.argv[2])", out, '{base}') },
    rules: [{ match: 'src/**', suites: [], static: true }, { match: 'docs/**', suites: [], static: false }],
  };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.claude-tweaks/verify-scope.json');
  r.git('commit', '-q', '-m', 'declare');
  const trunk = r.git('symbolic-ref', '--short', 'HEAD').trim();
  r.git('checkout', '-q', '-b', 'feat');
  // A pre-anchor bookkeeping commit: the tree differs from trunk's, yet the
  // merge below leaves no changed path of the branch's own since the anchor.
  commitFile(r, 'docs/pre.md', 'pre');
  const args = ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', trunk, '--cmd', 'tests=node -e 0'];
  const run1 = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run1.code, 0, run1.stderr);
  const anchor = stampOf(r.gitDir).fullSha;
  assert.ok(!fs.existsSync(out), 'the anchoring full run uses --cmd, so the {base} command has not run yet');
  mergeTrunk({ ...r, trunk }, ['ui/a.js']);
  const run2 = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run2.code, 0, run2.stderr);
  assert.match(run2.stdout, /^Scope: tool-scoped/m);
  assert.doesNotMatch(run2.stdout, /merge-narrowed/);
  assert.ok(fs.existsSync(out), 'the tool-scoped tests command must actually have run');
  assert.strictEqual(fs.readFileSync(out, 'utf8'), anchor, 'the resolved base replaced {base}');
  const s2 = stampOf(r.gitDir);
  assert.strictEqual(s2.scope, 'tool-scoped');
  assert.deepStrictEqual(s2.suitesRun, ['tests']);
  const report = JSON.parse(fs.readFileSync(s2.reportPath, 'utf8'));
  assert.strictEqual(report.scope.mergeNarrowing, null);
  assert.deepStrictEqual(report.scope.changedFiles, ['ui/a.js']);
});

test('--scope --integration-branch: AC1.2 (Reading A): narrowing that leaves a suite still narrows (#3072 stays) (#4638)', async () => {
  const r = zeroSuiteRepo();
  await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js']);
  commitFile(r, 'src/own.js', 'own');
  const { run, stamp, report } = await runScoped(r);
  assert.match(run.stdout, /^merge-narrowed: 1 merge-identical path\(s\) excluded/m);
  assert.deepStrictEqual(stamp.suitesRun, ['unit']);
  assert.deepStrictEqual(report.scope.mergeNarrowing.excludedFiles, ['ui/a.js']);
});

test('--scope --integration-branch: round-4 Reading B: a no-own-commit merge of the ref declines like the tip, even with a dirty mapped path (#4638)', async () => {
  const r = zeroSuiteRepo();
  await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js']);
  fs.mkdirSync(path.join(r.repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, 'src', 'dirty.js'), 'dirty');
  const { run, stamp, report } = await runScoped(r);
  assert.doesNotMatch(run.stdout, /merge-narrowed/);
  assert.match(run.stdout, /^Scope: full/m);
  assert.ok(fs.existsSync(r.marker), 'the unit suite must actually have run');
  assert.deepStrictEqual([...stamp.suitesRun].sort(), ['other', 'unit']);
  assert.strictEqual(report.scope.mergeNarrowing, null);
  assert.deepStrictEqual(report.scope.changedFiles, ['src/dirty.js', 'ui/a.js']);
});
