'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync: realExecFileSync } = require('node:child_process');
const { renderVerifyTable, runVerify, registerCheck, resolvePrNumber, resolveArchivedRunDir, resolvedIssueNumbers } = require('../../../plugin/bin/lib/wrap-up/engine-verify');
const { resolveRecords } = require('../../../plugin/bin/lib/wrap-up/pack');
const { gitRepo, linkedWorktreeOf } = require('../../helpers/git-fixtures');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// plans-ledger's sdd-leftover check reads `cwd`'s own filesystem directly
// (not via deps.git), so any test whose assertions depend on an exact
// failing-row set or a specific exitCode -- but isn't itself exercising
// plans-ledger/design-caches -- must pass an isolated `cwd` (record #1222:
// plans-ledger/design-caches read `cwd`, distinct from `repoRoot`, which
// stays reserved for run-dir-archived's main-checkout lookups) rather than
// let it default to process.cwd(). This worktree's own working tree
// legitimately has real leftover docs/superpowers/plans and .superpowers/sdd
// entries at any given time (that's the exact vacuous-check bug the original
// #900 fix round closed for the main checkout, and #1222 closes for a
// worktree), so relying on the default would make those tests depend on live
// worktree state. Tests below that need only isolation (not a real
// cwd-vs-repoRoot divergence) pass this same tmp dir as both `repoRoot` and
// `cwd` -- the two params diverge only in the dedicated "scans `cwd`, not
// `repoRoot`" tests above, which prove the switch itself.
function makeCleanRepoRoot() {
  return makeTmpDir('verify-clean-reporoot-');
}

// plans-ledger's "found, not owned" scoping (#2552) orders residue against
// the run dir's own creation time via filesystem timestamps -- a plain
// back-to-back mkdirSync sequence is ordered correctly in practice (this
// filesystem's statSync reports sub-millisecond birthtime/mtime, as probed
// directly), but a real, measurable gap removes any dependency on a given
// CI runner's filesystem clock resolution.
function busyWaitMs(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* spin */ }
}

// resolveParent (#1841) resolves a record's native GraphQL parent instead of
// the invalid-on-gh<2.96 `gh issue view --json parent` REST call these
// acceptance-labeling fixtures used to fake by matching `args.includes('parent')`
// on that call's argv. The new call shape is
// `['api', 'graphql', '-f', 'query=...', '-f', 'owner=...', '-f', 'repo=...']`;
// these three helpers replace that old matcher across every fixture below.
function isGraphqlCall(args) {
  return args[0] === 'api' && args[1] === 'graphql';
}
function parentQueryNumber(args) {
  const queryArg = args.find((a) => typeof a === 'string' && a.startsWith('query='));
  const m = queryArg && queryArg.match(/issue\(number:(\d+)\)/);
  return m ? Number(m[1]) : null;
}
function parentGraphqlResponse(n, parentNumber) {
  return JSON.stringify({
    data: { repository: { [`i${n}`]: { number: n, parent: parentNumber ? { number: parentNumber, title: '', state: 'OPEN' } : null } } },
  });
}
// resolveParent resolves owner/repo via `deps.git(['remote', 'get-url', 'origin'], cwd)`
// before ever calling `deps.gh` -- every fixture that exercises acceptance-labeling
// past the gh-availability probe needs a `deps.git` that answers this call, or
// parseRepo(remote) fails closed and the check renders 'unknown' for the wrong
// reason. `extra` still drives that fixture's own git behavior for every other call.
function fakeOriginGit(extra) {
  return (args, cwd) => {
    if (args[0] === 'remote') return 'https://github.com/org/repo.git';
    return extra ? extra(args, cwd) : '';
  };
}

// #3222: acceptance-labeling enumerates a resolved parent's sub-issues via
// `gh api --paginate repos/{o}/{r}/issues/{n}/sub_issues --jq ...`, one JSON
// object per output line (the shape the live probe against #3374 printed).
function subIssuesGh(subs) {
  return subs.map((s) => JSON.stringify({ number: s.number, state: s.state, labels: s.labels })).join('\n');
}
function isSubIssuesCall(args) {
  return args[0] === 'api' && args.includes('--paginate') && /issues\/\d+\/sub_issues$/.test(args[2]);
}

test('renderVerifyTable renders pass/fail bare and skip/unknown with folded detail', () => {
  const md = renderVerifyTable([
    { check: 'plans-ledger', result: 'pass', detail: '' },
    { check: 'worktree-removed', result: 'fail', detail: 'worktree still listed' },
    { check: 'memory-updates', result: 'skip', detail: 'nothing recorded' },
    { check: 'acceptance-labeling', result: 'unknown', detail: 'gh absent' },
  ]);
  assert.match(md, /\| plans-ledger \| pass \|/);
  assert.match(md, /\| worktree-removed \| fail \| worktree still listed \|/);
  assert.match(md, /\| memory-updates \| skip \(nothing recorded\) \|/);
  assert.match(md, /\| acceptance-labeling \| unknown \(gh absent\) \|/);
});

// #3358: a pass row can carry `ignored: skipped marker comment ...` notes --
// they must reach the rendered table, or the skip notice never reaches a human.
test('renderVerifyTable shows a pass row\'s non-empty detail in the Detail cell and leaves an empty one bare', () => {
  const note = 'ignored: skipped marker comment https://x/c1 by eve (NONE) — not an owner, member, or collaborator';
  const md = renderVerifyTable([
    { check: 'acceptance-labeling', result: 'pass', detail: note },
    { check: 'plans-ledger', result: 'pass', detail: '' },
  ]);
  const lines = md.split('\n');
  assert.strictEqual(lines.length, 4);
  assert.strictEqual(lines[2], `| acceptance-labeling | pass | ${note} |`);
  assert.strictEqual(lines[3], '| plans-ledger | pass |  |');
});

// A multi-line/pipe-containing detail (e.g. a raw multi-line git fatal
// error) is inserted verbatim into the wrap-up report per the spec -- an
// un-sanitized cell would corrupt the markdown table (record #900 fix
// round, I4).
test('renderVerifyTable sanitizes a multi-line/pipe-containing detail into a single safe cell', () => {
  const md = renderVerifyTable([
    { check: 'run-dir-archived', result: 'fail', detail: "git ls-files failed:\nfatal: not a | git repository\n(or any parent up to mount point /)" },
    { check: 'plans-ledger', result: 'unknown', detail: 'git status failed:\nfatal: some multi-line | error' },
  ]);
  const lines = md.split('\n');
  // header + separator + one line per row -- no extra lines from an embedded newline
  assert.strictEqual(lines.length, 4, `expected exactly 4 lines, got ${lines.length}:\n${md}`);
  for (const line of lines.slice(2)) {
    // every actual table row is exactly 3 pipe-delimited cells (4 pipe
    // characters: leading, two separators, trailing) once escaped
    // pipes are excluded -- an unescaped embedded '|' would add a
    // spurious 5th field.
    const unescaped = line.replace(/\\\|/g, '');
    assert.strictEqual((unescaped.match(/\|/g) || []).length, 4, `row has an unescaped '|' breaking its cell count: ${line}`);
  }
  assert.match(md, /git ls-files failed: fatal: not a \\\| git repository \(or any parent up to mount point \/\)/);
});

// Task 1's original version of this test asserted `rows` deepStrictEqual []
// on the premise that CHECKS was still empty at that point in the plan.
// Task 2 permanently registers real checks at module load (and Tasks 3-6
// register more), so "zero registered checks" is no longer a reachable state
// for this module in any test run — the assertion is rewritten to the
// structural invariant that survives every future check registration: one
// row per registered check, each with a valid result, and exitCode derived
// consistently from whether any row failed.
test('runVerify returns one row per registered check, each with a valid result', () => {
  const result = runVerify({ runDir: '/tmp/does-not-matter', base: 'main', deps: { git: () => '', gh: () => '' } });
  assert.ok(Array.isArray(result.rows));
  // At least the four checks Task 2 registers: plans-ledger, design-caches,
  // run-dir-archived, worktree-removed.
  assert.ok(result.rows.length >= 4);
  for (const row of result.rows) {
    assert.strictEqual(typeof row.check, 'string');
    assert.ok(['pass', 'fail', 'skip', 'unknown'].includes(row.result));
  }
  const expectedExit = result.rows.some((r) => r.result === 'fail') ? 3 : 0;
  assert.strictEqual(result.exitCode, expectedExit);
});

// AC1/AC2 fixture-level integration tests (record #900, Task 7). These call
// runVerify() with a real run-dir and assert on the literal exitCode. Helper
// fns writeSpecFile/writeExpectations (defined further down this file) are
// ordinary function declarations, hence hoisted, and are callable here.
//
// The brief's own transcribed AC1/AC2 code (task-7-brief.md) writes
// verify-expectations.json without deferring run-dir-archival, using
// originalPath (under .claude-tweaks/pipelines/{runId}) directly as runDir.
// Read against the real, current 'run-dir-archived' check (Task 2, unchanged
// since): that check independently re-derives originalPath from
// path.basename(runDir) and fails whenever it still exists on disk -- which
// it does here, since these fixtures create it and never archive it. Left
// as transcribed, that would make 'run-dir-archived' ALSO fail in both
// fixtures, alongside 'worktree-removed' in AC1 and contradicting AC2's "no
// fail rows" premise. Both fixtures below add `deferred: ['run-dir-archival']`
// to verify-expectations.json (the same real deferred-set mechanism
// 'design-caches'/'worktree-removed' already use, per Task 5) so
// 'run-dir-archived' skips instead of failing -- letting each fixture
// isolate exactly the one check under test, per AC1/AC2's literal wording.
test('AC1: fixture run-dir with one unexecuted approved action exits 3 naming that check; fixing it exits 0', () => {
  const runId = 'test-ac1-fixture-900';
  const originalPath = path.join(process.cwd(), '.claude-tweaks', 'pipelines', runId);
  // Simulate: everything else clean (run-dir-archival deferred to the parent
  // console, so that check doesn't also fail here), but the worktree row was
  // never removed.
  fs.mkdirSync(originalPath, { recursive: true });
  writeExpectations(originalPath, { version: 1, memory: [], upstream: [], deferred: ['run-dir-archival'] });
  const repoRoot = makeCleanRepoRoot();
  try {
    const fakeGitDirty = (args) => {
      if (args[0] === 'worktree') return `worktree /repo/.claude/worktrees/flow-${runId}\nbranch refs/heads/worktree-flow-${runId}\n\n`;
      return '';
    };
    const dirtyResult = runVerify({ runDir: originalPath, base: 'main', repoRoot, cwd: repoRoot, deps: { git: fakeGitDirty, gh: () => 'gh version 2.0.0' } });
    assert.strictEqual(dirtyResult.exitCode, 3);
    const failingRows = dirtyResult.rows.filter((r) => r.result === 'fail');
    assert.strictEqual(failingRows.length, 1, `expected exactly one failing check, got: ${failingRows.map((r) => r.check).join(', ')}`);
    assert.strictEqual(failingRows[0].check, 'worktree-removed');

    const fakeGitClean = () => '';
    const cleanResult = runVerify({ runDir: originalPath, base: 'main', repoRoot, cwd: repoRoot, deps: { git: fakeGitClean, gh: () => 'gh version 2.0.0' } });
    assert.strictEqual(cleanResult.exitCode, 0);
  } finally {
    fs.rmSync(originalPath, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

// #3373: a console that resolved the merge as `leave-open` leaves the PR open
// for a human, so the run dir and worktree legitimately remain -- both teardown
// checks render the pending-review skip instead of a fail.
const PENDING_REVIEW_DETAIL = 'pending-review — teardown follows the human merge';

function writeConsole(runDir, resolution) {
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true, merge: { resolution, reason: 'test' } }));
}

// Shared setup for the "teardown missing" cases: run dir present and the
// worktree still listed, with `prepare` deciding what console.json holds.
function verifyWithTeardownMissing(prepare) {
  const repoRoot = makeCleanRepoRoot();
  const runDir = path.join(repoRoot, '.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-3373');
  fs.mkdirSync(runDir, { recursive: true });
  prepare(runDir);
  const fakeGit = (args) => {
    if (args[0] === 'worktree') {
      return 'worktree /repo/.claude/worktrees/flow-spec-3373\nbranch refs/heads/worktree-flow-spec-3373\n\n';
    }
    return '';
  };
  try {
    return runVerify({ runDir, base: 'main', repoRoot, cwd: makeCleanRepoRoot(), deps: { git: fakeGit, gh: () => '' } });
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test('#3373: run-dir-archived skips with the pending-review reason when console.json records leave-open and the original path is still present', () => {
  const result = verifyWithTeardownMissing((runDir) => writeConsole(runDir, 'leave-open'));
  const row = result.rows.find((r) => r.check === 'run-dir-archived');
  assert.strictEqual(row.result, 'skip');
  assert.strictEqual(row.detail, PENDING_REVIEW_DETAIL);
});

test('#3373: worktree-removed skips with the pending-review reason when console.json records leave-open and the worktree is still listed', () => {
  const result = verifyWithTeardownMissing((runDir) => writeConsole(runDir, 'leave-open'));
  const row = result.rows.find((r) => r.check === 'worktree-removed');
  assert.strictEqual(row.result, 'skip');
  assert.strictEqual(row.detail, PENDING_REVIEW_DETAIL);
});

test('#3373: leave-open still passes when teardown already happened', () => {
  const repoRoot = makeCleanRepoRoot();
  const runId = '2026-01-01T000000-spec-3373';
  const originalPath = path.join(repoRoot, '.claude-tweaks', 'pipelines', runId);
  const archivePath = path.join(repoRoot, '.claude-tweaks', 'pipelines', 'archive', runId);
  fs.mkdirSync(archivePath, { recursive: true });
  writeConsole(archivePath, 'leave-open');
  try {
    const result = runVerify({ runDir: archivePath, originalRunDir: originalPath, base: 'main', repoRoot, cwd: makeCleanRepoRoot(), deps: { git: () => '', gh: () => '' } });
    assert.strictEqual(result.rows.find((r) => r.check === 'run-dir-archived').result, 'pass');
    assert.strictEqual(result.rows.find((r) => r.check === 'worktree-removed').result, 'pass');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('#3373: merge resolution keeps run-dir-archived and worktree-removed failing when teardown is missing', () => {
  const result = verifyWithTeardownMissing((runDir) => writeConsole(runDir, 'merge'));
  assert.strictEqual(result.rows.find((r) => r.check === 'run-dir-archived').result, 'fail');
  assert.strictEqual(result.rows.find((r) => r.check === 'worktree-removed').result, 'fail');
  assert.strictEqual(result.exitCode, 3);
});

test('#3373: no console.json keeps both checks failing when teardown is missing', () => {
  const result = verifyWithTeardownMissing(() => {});
  assert.strictEqual(result.rows.find((r) => r.check === 'run-dir-archived').result, 'fail');
  assert.strictEqual(result.rows.find((r) => r.check === 'worktree-removed').result, 'fail');
});

test('#3373: malformed console.json keeps both checks failing', () => {
  const result = verifyWithTeardownMissing((runDir) => fs.writeFileSync(path.join(runDir, 'console.json'), '{not json'));
  assert.strictEqual(result.rows.find((r) => r.check === 'run-dir-archived').result, 'fail');
  assert.strictEqual(result.rows.find((r) => r.check === 'worktree-removed').result, 'fail');
});

test('#3373: a multi-spec parent run dir with a leave-open console.json keeps both checks failing', () => {
  const result = verifyWithTeardownMissing((runDir) => {
    writeConsole(runDir, 'leave-open');
    fs.writeFileSync(path.join(runDir, 'manifest.yml'), 'multispec:\n  specs: []\n');
  });
  assert.strictEqual(result.rows.find((r) => r.check === 'run-dir-archived').result, 'fail');
  assert.strictEqual(result.rows.find((r) => r.check === 'worktree-removed').result, 'fail');
});

test('#3373: leave-open does not excuse a missing archive path', () => {
  const repoRoot = makeCleanRepoRoot();
  const runId = '2026-01-01T000000-spec-3373';
  const originalPath = path.join(repoRoot, '.claude-tweaks', 'pipelines', runId);
  const consoleDir = makeTmpDir('verify-leave-open-archive-missing-');
  writeConsole(consoleDir, 'leave-open');
  try {
    const result = runVerify({ runDir: consoleDir, originalRunDir: originalPath, base: 'main', repoRoot, cwd: makeCleanRepoRoot(), deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'run-dir-archived');
    assert.strictEqual(row.result, 'fail');
    assert.match(row.detail, /archive path missing/);
  } finally {
    fs.rmSync(consoleDir, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('#3373: leave-open does not excuse an archived work/ dir that is not git-tracked', () => {
  const repoRoot = makeCleanRepoRoot();
  const runId = '2026-01-01T000000-spec-3373';
  const originalPath = path.join(repoRoot, '.claude-tweaks', 'pipelines', runId);
  const archivePath = path.join(repoRoot, '.claude-tweaks', 'pipelines', 'archive', runId);
  fs.mkdirSync(path.join(archivePath, 'work'), { recursive: true });
  writeConsole(archivePath, 'leave-open');
  try {
    const result = runVerify({ runDir: archivePath, originalRunDir: originalPath, base: 'main', repoRoot, cwd: makeCleanRepoRoot(), deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'run-dir-archived');
    assert.strictEqual(row.result, 'fail');
    assert.match(row.detail, /is not git-tracked/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('#3373 AC1: leave-open run exits 0 when every other check passes', () => {
  const runId = 'test-ac1-leave-open-3373';
  const repoRoot = makeCleanRepoRoot();
  const originalPath = path.join(repoRoot, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(originalPath, { recursive: true });
  writeExpectations(originalPath, { version: 1, memory: [], upstream: [] });
  writeConsole(originalPath, 'leave-open');
  try {
    const fakeGitDirty = (args) => {
      if (args[0] === 'worktree') return `worktree /repo/.claude/worktrees/flow-${runId}\nbranch refs/heads/worktree-flow-${runId}\n\n`;
      return '';
    };
    const result = runVerify({ runDir: originalPath, base: 'main', repoRoot, cwd: repoRoot, deps: { git: fakeGitDirty, gh: () => 'gh version 2.0.0' } });
    assert.strictEqual(result.exitCode, 0, `failing rows: ${result.rows.filter((r) => r.result === 'fail').map((r) => r.check).join(', ')}`);
    assert.strictEqual(result.rows.filter((r) => r.result === 'fail').length, 0);
    assert.strictEqual(result.rows.find((r) => r.check === 'run-dir-archived').result, 'skip');
    assert.strictEqual(result.rows.find((r) => r.check === 'worktree-removed').result, 'skip');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('AC2: gh absent renders acceptance-labeling unknown, exit code reflects only checks that ran', () => {
  const runId = 'test-ac2-fixture-900';
  const originalPath = path.join(process.cwd(), '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(originalPath, { recursive: true });
  writeSpecFile(originalPath, '900', 900);
  writeExpectations(originalPath, { version: 1, memory: [], upstream: [], deferred: ['run-dir-archival'] });
  const repoRoot = makeCleanRepoRoot();
  try {
    const throwingGh = () => { throw new Error('command not found: gh'); };
    // carrier-commit's own textual match must pass via the branch log alone
    // here -- gh is entirely absent in this fixture, so carrier-commit's
    // ground-truth fallback (which also calls gh) would otherwise degrade
    // to a 'fail' row this test isn't exercising.
    const cleanGit = (args) => (args[0] === 'log' ? 'Fix wrap-up verify verb\n\nFixes #900\n' : '');
    const result = runVerify({ runDir: originalPath, base: 'main', repoRoot, cwd: repoRoot, deps: { git: cleanGit, gh: throwingGh } });
    const acceptanceRow = result.rows.find((r) => r.check === 'acceptance-labeling');
    assert.strictEqual(acceptanceRow.result, 'unknown');
    assert.match(acceptanceRow.detail, /gh absent/);
    // No 'fail' rows in this fixture -- exitCode reflects only what ran (0), unknown never blocks.
    const failingRows = result.rows.filter((r) => r.result === 'fail');
    assert.deepStrictEqual(failingRows, []);
    assert.strictEqual(result.exitCode, 0);
  } finally {
    fs.rmSync(originalPath, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

// #1841: a parent-resolution gather failure (GraphQL error, unresolvable
// owner/repo, an unparseable response) is a tooling gap, not a labeling
// mismatch -- it must render 'unknown', matching this file's other
// could-not-gather rows, and must never trip the overall exit-3 gate on its
// own (execution-and-verification.md's exit-3 rule only withholds closure on
// a real 'fail').
test('acceptance-labeling check renders unknown -- not fail -- when a parent-resolution gh call throws', () => {
  const runDir = makeTmpDir('verify-acceptance-parenterr-');
  const repoRoot = makeCleanRepoRoot();
  writeSpecFile(runDir, '900', 900);
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], deferred: ['run-dir-archival'] });
  const cleanGit = (args) => {
    if (args[0] === 'remote') return 'https://github.com/org/repo.git';
    // carrier-commit's own textual match must pass here so this fixture's
    // GraphQL-throwing gh fake (below) exercises acceptance-labeling's own
    // parent-resolution failure in isolation, never carrier-commit's
    // ground-truth fallback (which also calls gh api graphql).
    if (args[0] === 'log') return 'Fix wrap-up verify verb\n\nFixes #900\n';
    return '';
  };
  const fakeGh = (args) => {
    if (args[0] === '--version') return 'gh version 2.0.0';
    if (isGraphqlCall(args)) throw new Error('gh: rate limited');
    return '';
  };
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd: repoRoot, deps: { git: cleanGit, gh: fakeGh } });
    const row = result.rows.find((r) => r.check === 'acceptance-labeling');
    assert.strictEqual(row.result, 'unknown');
    assert.match(row.detail, /#900.*gh api graphql \(parent\) failed/);
    const failingRows = result.rows.filter((r) => r.result === 'fail');
    assert.deepStrictEqual(failingRows, [], `expected no fail rows, got: ${JSON.stringify(failingRows)}`);
    assert.strictEqual(result.exitCode, 0, 'a gather failure alone must not trip exit code 3');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

// The 'runVerify returns one row per registered check' test further above
// re-derives its expected exitCode
// from the same rows array runVerify just returned, so it can't distinguish
// a bug in the exitCode derivation from correct behavior. This test pins the
// literal value: force
// one check to fail and assert exitCode === 3 as a hardcoded constant, proving
// the derivation actually produces 3 for a real fail case.
test('runVerify sets exitCode 3 when any check fails (forced-fail probe)', () => {
  const unregister = registerCheck('__test-exitcode-probe__', () => ({ result: 'fail', detail: 'forced' }));
  try {
    const runDir = makeTmpDir('verify-exitcode-probe-');
    const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
    assert.strictEqual(result.exitCode, 3);
  } finally {
    unregister();
  }
});

// plans-ledger/design-caches now scan `git status --porcelain` for untracked
// entries (record #900 fix round, C3) rather than slug-matching filenames --
// topic-slugged plan files (superpowers:writing-plans) essentially never
// share the run's own spec-identity slug, which made the old check vacuous.
// Every test below passes its own isolated repoRoot fixture, and asserts on
// the exact args/cwd `deps.git` was called with, to prove the check
// genuinely calls out to git status rather than falling back to some other
// (still-vacuous) heuristic.

test('plans-ledger check passes when git status reports no untracked entries and no sdd leftovers', () => {
  const runDir = makeTmpDir('verify-plans-ledger-clean-');
  const repoRoot = makeCleanRepoRoot();
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd: repoRoot, deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'plans-ledger');
    assert.strictEqual(row.result, 'pass');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('plans-ledger check fails when git status reports an untracked plan file, naming it', () => {
  const runDir = makeTmpDir('verify-plans-ledger-dirty-');
  const repoRoot = makeCleanRepoRoot();
  const calls = [];
  const fakeGit = (args, cwd) => {
    calls.push({ args, cwd });
    if (args[1] === 'status') return '?? docs/superpowers/plans/2099-01-01-some-topic.md\0';
    return '';
  };
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd: repoRoot, deps: { git: fakeGit, gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'plans-ledger');
    assert.strictEqual(row.result, 'fail');
    assert.match(row.detail, /2099-01-01-some-topic\.md/);
    const statusCall = calls.find((c) => c.args[1] === 'status');
    // '-uall' (not the default '-uno'): a wholly-untracked directory must
    // report each file individually, never collapse to one '?? {dir}/' line
    // the suffix/name filters could never match (record #900 whole-branch
    // re-review, finding #2).
    assert.deepStrictEqual(statusCall.args, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '-uall', '--', 'docs/superpowers/plans', 'docs/plans']);
    assert.strictEqual(statusCall.cwd, repoRoot, 'git status must run against cwd (the isolated fixture), not process.cwd()');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('plans-ledger check fails when a .superpowers/sdd/ leftover directory is present, naming it', () => {
  const runDir = makeTmpDir('verify-plans-ledger-sdd-');
  const repoRoot = makeCleanRepoRoot();
  const sddDir = path.join(repoRoot, '.superpowers', 'sdd', '2026-08-21-some-topic');
  fs.mkdirSync(sddDir, { recursive: true });
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd: repoRoot, deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'plans-ledger');
    assert.strictEqual(row.result, 'fail');
    assert.match(row.detail, /2026-08-21-some-topic/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

// ---- plans-ledger: "found, not owned" scoping (#2552 AC4) ----
//
// A gitignored .superpowers/sdd/*-archive leftover (or an untracked plan
// file) that predates this run's own run-dir creation was left by an
// earlier/concurrent session, never referenced by this run -- it is
// reported as informational ('skip'), not attributed to this run as a
// 'fail'.

test('plans-ledger check reports "found, not owned" (skip) for a .superpowers/sdd/ leftover that predates this run\'s own run dir', () => {
  const repoRoot = makeCleanRepoRoot();
  const oldSddDir = path.join(repoRoot, '.superpowers', 'sdd', '2020-01-01-ancient-topic');
  fs.mkdirSync(oldSddDir, { recursive: true });
  busyWaitMs(10);
  const runDir = makeTmpDir('verify-plans-ledger-not-owned-');
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd: repoRoot, deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'plans-ledger');
    assert.strictEqual(row.result, 'skip');
    assert.match(row.detail, /found, not owned/);
    assert.match(row.detail, /2020-01-01-ancient-topic/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('plans-ledger check fails on a leftover newer than the run dir, naming it, without letting an older not-owned leftover mask it', () => {
  const repoRoot = makeCleanRepoRoot();
  const oldSddDir = path.join(repoRoot, '.superpowers', 'sdd', '2020-01-01-ancient-topic');
  fs.mkdirSync(oldSddDir, { recursive: true });
  busyWaitMs(10);
  const runDir = makeTmpDir('verify-plans-ledger-mixed-');
  busyWaitMs(10);
  const newSddDir = path.join(repoRoot, '.superpowers', 'sdd', '2026-08-21-fresh-topic');
  fs.mkdirSync(newSddDir, { recursive: true });
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd: repoRoot, deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'plans-ledger');
    assert.strictEqual(row.result, 'fail');
    assert.match(row.detail, /2026-08-21-fresh-topic/);
    assert.doesNotMatch(row.detail, /2020-01-01-ancient-topic/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('design-caches check passes when cache dir does not exist', () => {
  const runDir = makeTmpDir('verify-design-caches-clean-');
  const repoRoot = makeCleanRepoRoot();
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd: repoRoot, deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'design-caches');
    assert.strictEqual(row.result, 'pass');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('design-caches check fails when an untracked *-audit.json cache file remains', () => {
  const runDir = makeTmpDir('verify-design-caches-dirty-');
  const repoRoot = makeCleanRepoRoot();
  fs.mkdirSync(path.join(repoRoot, 'docs', 'plans'), { recursive: true });
  const fakeGit = (args) => {
    if (args[1] === 'status') return '?? docs/plans/some-topic-audit.json\0';
    return '';
  };
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd: repoRoot, deps: { git: fakeGit, gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'design-caches');
    assert.strictEqual(row.result, 'fail');
    assert.match(row.detail, /some-topic-audit\.json/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('design-caches check does not fail on a TRACKED file matching a cache suffix (only untracked counts)', () => {
  const runDir = makeTmpDir('verify-design-caches-tracked-');
  const repoRoot = makeCleanRepoRoot();
  fs.mkdirSync(path.join(repoRoot, 'docs', 'plans'), { recursive: true });
  // git status --porcelain never reports a clean, committed file at all --
  // so an empty status output (no '??' line) is exactly what a tracked
  // cache-suffixed file looks like to this check.
  const fakeGit = (args) => (args[1] === 'status' ? '' : '');
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd: repoRoot, deps: { git: fakeGit, gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'design-caches');
    assert.strictEqual(row.result, 'pass');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('run-dir-archived check fails when original path still exists', () => {
  const pipelinesDir = path.join(process.cwd(), '.claude-tweaks', 'pipelines');
  const runId = 'test-verify-archived-fail-900';
  const originalPath = path.join(pipelinesDir, runId);
  fs.mkdirSync(originalPath, { recursive: true });
  try {
    const result = runVerify({ runDir: originalPath, base: 'main', deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'run-dir-archived');
    assert.strictEqual(row.result, 'fail');
  } finally {
    fs.rmSync(originalPath, { recursive: true, force: true });
  }
});

test('run-dir-archived check passes when original gone and archive exists with no work/ dir', () => {
  const runId = 'test-verify-archived-pass-900';
  const archivePath = path.join(process.cwd(), '.claude-tweaks', 'pipelines', 'archive', runId);
  fs.mkdirSync(archivePath, { recursive: true });
  try {
    const result = runVerify({
      runDir: path.join(process.cwd(), '.claude-tweaks', 'pipelines', runId),
      base: 'main', deps: { git: () => '', gh: () => '' },
    });
    const row = result.rows.find((r) => r.check === 'run-dir-archived');
    assert.strictEqual(row.result, 'pass');
  } finally {
    fs.rmSync(archivePath, { recursive: true, force: true });
  }
});

test('worktree-removed check fails when a matching worktree is still listed', () => {
  const fakeGit = (args) => {
    if (args[0] === 'worktree') {
      return 'worktree /repo/.claude/worktrees/flow-spec-900\nbranch refs/heads/worktree-flow-spec-900\n\n';
    }
    return '';
  };
  const result = runVerify({ runDir: '/tmp/2026-01-01T000000-spec-900', base: 'main', deps: { git: fakeGit, gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'worktree-removed');
  assert.strictEqual(row.result, 'fail');
});

test('worktree-removed check passes when no matching worktree is listed', () => {
  const fakeGit = (args) => (args[0] === 'worktree' ? '' : '');
  const result = runVerify({ runDir: '/tmp/2026-01-01T000000-spec-900', base: 'main', deps: { git: fakeGit, gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'worktree-removed');
  assert.strictEqual(row.result, 'pass');
});

test('#3023: worktree-removed fails when the run\'s worktree is unlisted but its directory still exists on disk', () => {
  const runDir = path.join(makeTmpDir('verify-wt-'), '2026-01-01T000000-spec-901');
  const wtDir = makeTmpDir('verify-wt-dir-');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'closed', worktree: wtDir }));
  const result = runVerify({ runDir, base: 'main', repoRoot: makeCleanRepoRoot(), cwd: makeCleanRepoRoot(), deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'worktree-removed');
  assert.strictEqual(row.result, 'fail');
  assert.ok(row.detail.includes(wtDir), `detail must name the path, got: ${row.detail}`);
});

test('#3023: worktree-removed passes when the worktree is unlisted and its directory is gone', () => {
  const runDir = path.join(makeTmpDir('verify-wt-'), '2026-01-01T000000-spec-902');
  const wtDir = path.join(makeTmpDir('verify-wt-gone-'), 'never-created');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'closed', worktree: wtDir }));
  const result = runVerify({ runDir, base: 'main', repoRoot: makeCleanRepoRoot(), cwd: makeCleanRepoRoot(), deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'worktree-removed');
  assert.strictEqual(row.result, 'pass');
});

test('#3023: worktree-removed keeps list-only behavior when run-state.json records no worktree', () => {
  const runDir = path.join(makeTmpDir('verify-wt-'), '2026-01-01T000000-spec-903');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'closed' }));
  const result = runVerify({ runDir, base: 'main', repoRoot: makeCleanRepoRoot(), cwd: makeCleanRepoRoot(), deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'worktree-removed');
  assert.strictEqual(row.result, 'pass');
});

test('#3023: worktree-removed reads a multi-spec run\'s worktree path from the parent run-state.json', () => {
  const parent = path.join(makeTmpDir('verify-wt-'), '2026-01-01T000000-spec-904-905');
  const specDir = path.join(parent, 'spec-904');
  const wtDir = makeTmpDir('verify-wt-dir-');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(parent, 'run-state.json'), JSON.stringify({ status: 'closed', worktree: wtDir }));
  fs.writeFileSync(path.join(specDir, 'run-state.json'), JSON.stringify({ status: 'closed' }));
  const result = runVerify({ runDir: specDir, base: 'main', repoRoot: makeCleanRepoRoot(), cwd: makeCleanRepoRoot(), deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'worktree-removed');
  assert.strictEqual(row.result, 'fail');
  assert.ok(row.detail.includes(wtDir));
});

// #3023 (final review F1): every sanctioned removal path closes the run
// first, and the close nulls `worktree` -- so the on-disk check must still
// see the path after a REAL closeRunState, not only a hand-written state.
test('#3023: worktree-removed still fails after a real closeRunState nulled run-state.json\'s worktree, and passes once the directory is gone', () => {
  const { closeRunState } = require('../../../plugin/bin/lib/hooks/close-run-state');
  const runDir = path.join(makeTmpDir('verify-wt-'), '2026-01-01T000000-spec-906');
  const wtDir = makeTmpDir('verify-wt-dir-');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: wtDir, sessionId: 's-3023' }));
  const closed = closeRunState(runDir, { explicit: true, callerIdentity: { sessionId: 's-3023' }, checkLiveWorktree: false });
  assert.strictEqual(closed.status, 'closed');
  assert.strictEqual(closed.writeOk, true);
  const after = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  assert.strictEqual(after.worktree, null);
  const verify = () => runVerify({ runDir, base: 'main', repoRoot: makeCleanRepoRoot(), cwd: makeCleanRepoRoot(), deps: { git: () => '', gh: () => '' } })
    .rows.find((r) => r.check === 'worktree-removed');
  const present = verify();
  assert.strictEqual(present.result, 'fail');
  assert.ok(present.detail.includes(wtDir), `detail must name the path, got: ${present.detail}`);
  fs.rmSync(wtDir, { recursive: true, force: true });
  assert.strictEqual(verify().result, 'pass');
});

test('#3023: worktree-removed reads a closed multi-spec parent\'s worktreeAtClose when neither side still carries worktree', () => {
  const parent = path.join(makeTmpDir('verify-wt-'), '2026-01-01T000000-spec-907-908');
  const specDir = path.join(parent, 'spec-907');
  const wtDir = makeTmpDir('verify-wt-dir-');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(parent, 'run-state.json'), JSON.stringify({ status: 'clean', worktree: null, worktreeAtClose: wtDir }));
  fs.writeFileSync(path.join(specDir, 'run-state.json'), JSON.stringify({ status: 'clean', worktree: null }));
  const result = runVerify({ runDir: specDir, base: 'main', repoRoot: makeCleanRepoRoot(), cwd: makeCleanRepoRoot(), deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'worktree-removed');
  assert.strictEqual(row.result, 'fail');
  assert.ok(row.detail.includes(wtDir));
});

// ---- multi-spec spec-{N}/ subdirectory resolution (record #900 fix round, C2/I2) ----
//
// A multi-spec `/flow` run exports the per-spec `spec-{N}/` subdirectory as
// `$PIPELINE_RUN_DIR`, while the worktree/branch and the archived layout are
// both named from the PARENT run's id, never the bare 'spec-{N}' leaf. The
// tests below prove the corrected resolution against that shape, and
// (worktree-removed) prove the OLD (pre-fix) logic would have wrongly
// reported 'pass' by asserting the failure directly against the same
// fixture shape the live whole-branch review hit.

test('worktree-removed check fails when the worktree/branch are named from the PARENT run id (multi-spec spec-{N}/ subdirectory)', () => {
  const parentId = '2026-08-21T075329-spec-343-900';
  const runDir = path.join(os.tmpdir(), parentId, 'spec-900');
  const fakeGit = (args) => {
    if (args[0] === 'worktree') {
      return 'worktree /repo/.claude/worktrees/flow-spec-343-900\nbranch refs/heads/worktree-flow-spec-343-900\n\n';
    }
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'worktree-removed');
  // Old (pre-fix) behavior: specSlugFromRunDir('spec-900') === 'spec-900',
  // which is not a substring of the worktree path/branch
  // ('flow-spec-343-900'/'worktree-flow-spec-343-900') -- match() would
  // find nothing and this row would wrongly report 'pass' even though the
  // worktree is still live. The fix derives the slug from the PARENT run id
  // ('spec-343-900') instead, which IS a substring, so this must fail.
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /flow-spec-343-900/);
});

test('run-dir-archived check passes when the archived copy is nested at archive/{parent}/spec-{N}/work/, tracked', () => {
  const parentId = 'test-archived-parent-900';
  const repoRoot = makeCleanRepoRoot();
  const runDir = path.join(repoRoot, '.claude-tweaks', 'pipelines', parentId, 'spec-900');
  const archiveSpecDir = path.join(repoRoot, '.claude-tweaks', 'pipelines', 'archive', parentId, 'spec-900');
  const archivedWork = path.join(archiveSpecDir, 'work');
  fs.mkdirSync(archivedWork, { recursive: true });
  const fakeGit = (args) => (args[0] === 'ls-files' ? `${path.join(archivedWork, '900-spec.md')}\n` : '');
  try {
    const result = runVerify({ runDir, originalRunDir: runDir, base: 'main', repoRoot, deps: { git: fakeGit, gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'run-dir-archived');
    assert.strictEqual(row.result, 'pass');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('run-dir-archived check fails naming the original path when it is still present (multi-spec subdirectory)', () => {
  const parentId = 'test-archived-parent-901';
  const repoRoot = makeCleanRepoRoot();
  const runDir = path.join(repoRoot, '.claude-tweaks', 'pipelines', parentId, 'spec-900');
  fs.mkdirSync(runDir, { recursive: true });
  try {
    const result = runVerify({ runDir, originalRunDir: runDir, base: 'main', repoRoot, deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'run-dir-archived');
    assert.strictEqual(row.result, 'fail');
    assert.match(row.detail, /original path still present/);
    assert.match(row.detail, /spec-900/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('run-dir-archived check fails naming the correct NESTED archive path when it is missing (multi-spec subdirectory)', () => {
  const parentId = 'test-archived-parent-902';
  const repoRoot = makeCleanRepoRoot();
  // Original path does not exist (already "moved") but nothing was placed at
  // the correctly-nested archive path -- this must name the nested path
  // (archive/{parent}/spec-900), not a flattened archive/spec-900.
  const runDir = path.join(repoRoot, '.claude-tweaks', 'pipelines', parentId, 'spec-900');
  try {
    const result = runVerify({ runDir, originalRunDir: runDir, base: 'main', repoRoot, deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'run-dir-archived');
    assert.strictEqual(row.result, 'fail');
    assert.match(row.detail, /archive path missing/);
    const expectedArchivePath = path.join(repoRoot, '.claude-tweaks', 'pipelines', 'archive', parentId, 'spec-900');
    assert.match(row.detail, new RegExp(expectedArchivePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('run-dir-archived check still behaves as before for a single-spec (non-subdirectory) run dir (regression)', () => {
  const runId = 'test-archived-singlespec-900';
  const repoRoot = makeCleanRepoRoot();
  const archivePath = path.join(repoRoot, '.claude-tweaks', 'pipelines', 'archive', runId);
  fs.mkdirSync(archivePath, { recursive: true });
  try {
    const result = runVerify({
      runDir: path.join(repoRoot, '.claude-tweaks', 'pipelines', runId),
      base: 'main', repoRoot, deps: { git: () => '', gh: () => '' },
    });
    const row = result.rows.find((r) => r.check === 'run-dir-archived');
    assert.strictEqual(row.result, 'pass');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

// ---- resolveArchivedRunDir: real (ISO-timestamped) run ids (record #900
// whole-branch re-review, finding #1 -- Critical regression) ----
//
// archive-merged.js's archiveRunDir() archives to
// `archive/{path.basename(runDir)}` -- the FULL basename, ISO timestamp
// included. The fix-round's first pass built archiveRelativeId on top of
// runIdFromRunDir, which STRIPS that timestamp (correct for
// specSlugFromRunDir's worktree/branch substring matching, wrong here) --
// every real run id is timestamped, so that version could never locate any
// real archived run. Every prior archive-path test in this file used a
// timestamp-free parentId ('test-archived-parent-900', etc.), which never
// exercises the strip regex at all and masked the bug completely -- these
// tests use realistic timestamped ids specifically to close that gap.
test('resolveArchivedRunDir finds a real (ISO-timestamped) single-spec archived run', () => {
  const runId = '2026-01-01T000000-spec-18';
  const repoRoot = makeCleanRepoRoot();
  const archivePath = path.join(repoRoot, '.claude-tweaks', 'pipelines', 'archive', runId);
  fs.mkdirSync(archivePath, { recursive: true });
  try {
    const runDir = path.join(repoRoot, '.claude-tweaks', 'pipelines', runId);
    const resolved = resolveArchivedRunDir(runDir, repoRoot);
    assert.strictEqual(resolved, archivePath, `expected the timestamped archive path, got: ${resolved}`);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('resolveArchivedRunDir finds a real (ISO-timestamped) multi-spec spec-{N}/ archived run, nested under the parent id', () => {
  const parentId = '2026-01-01T000000-spec-1-2';
  const repoRoot = makeCleanRepoRoot();
  const archiveSpecDir = path.join(repoRoot, '.claude-tweaks', 'pipelines', 'archive', parentId, 'spec-2');
  fs.mkdirSync(archiveSpecDir, { recursive: true });
  try {
    const runDir = path.join(repoRoot, '.claude-tweaks', 'pipelines', parentId, 'spec-2');
    const resolved = resolveArchivedRunDir(runDir, repoRoot);
    assert.strictEqual(resolved, archiveSpecDir, `expected the nested timestamped archive path, got: ${resolved}`);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('run-dir-archived check passes for a real (ISO-timestamped) single-spec run once correctly archived', () => {
  const runId = '2026-01-01T000000-spec-19';
  const repoRoot = makeCleanRepoRoot();
  const archivePath = path.join(repoRoot, '.claude-tweaks', 'pipelines', 'archive', runId);
  fs.mkdirSync(archivePath, { recursive: true });
  try {
    const runDir = path.join(repoRoot, '.claude-tweaks', 'pipelines', runId);
    const result = runVerify({ runDir: archivePath, originalRunDir: runDir, base: 'main', repoRoot, deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'run-dir-archived');
    assert.strictEqual(row.result, 'pass', row.detail);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

// ---- run-dir-archived: invoked already pointed at the archive path (#2552
// AC1) ----
//
// Before the fix, this invocation shape had no way to pass: `originalRunDir`
// (the raw --run-dir CLI arg, never auto-substituted by resolveArchivedRunDir)
// equaled the archive path itself, so `fs.existsSync(originalPath)` was true
// and the check reported "original path still present" -- misreading the
// archive copy as the not-yet-archived original.

test('run-dir-archived check passes when --run-dir is pointed directly at the already-archived path (#2552 AC1)', () => {
  const runId = '2026-01-01T000000-spec-20';
  const repoRoot = makeCleanRepoRoot();
  const archivePath = path.join(repoRoot, '.claude-tweaks', 'pipelines', 'archive', runId);
  fs.mkdirSync(archivePath, { recursive: true });
  try {
    // Both runDir and originalRunDir are the archive path itself -- the
    // shape wrap-up-engine.js verify's CLI entry produces when --run-dir
    // names the post-archival path directly (resolveArchivedRunDir is a
    // no-op there, since the given path already exists).
    const result = runVerify({ runDir: archivePath, originalRunDir: archivePath, base: 'main', repoRoot, deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'run-dir-archived');
    assert.strictEqual(row.result, 'pass', row.detail);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('run-dir-archived check passes when --run-dir is pointed at the archived path for a multi-spec spec-{N}/ subdirectory (#2552 AC1, nested shape)', () => {
  const parentId = 'test-archived-parent-903';
  const repoRoot = makeCleanRepoRoot();
  const archiveSpecDir = path.join(repoRoot, '.claude-tweaks', 'pipelines', 'archive', parentId, 'spec-900');
  fs.mkdirSync(archiveSpecDir, { recursive: true });
  try {
    const result = runVerify({ runDir: archiveSpecDir, originalRunDir: archiveSpecDir, base: 'main', repoRoot, deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'run-dir-archived');
    assert.strictEqual(row.result, 'pass', row.detail);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

// ---- plans-ledger / design-caches: '-uall' collapsed-directory fix and
// dotfile exclusion (record #900 whole-branch re-review, findings #2/#4) ----

test('design-caches check catches an untracked *-audit.json inside a WHOLLY-untracked docs/plans/ directory (real git, no fake)', () => {
  // A real git repo, not a fake `deps.git`: the default `-uno` porcelain
  // mode collapses an entirely-untracked directory to one '?? docs/plans/'
  // line, which the suffix filter can never match -- '-uall' must be what
  // actually prevents that collapse, so this proves it against real git
  // output rather than a hand-written fixture that could just as easily
  // encode the wrong (collapsed) shape.
  const repo = gitRepo();
  try {
    fs.mkdirSync(path.join(repo, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs', 'plans', 'some-topic-audit.json'), '{}');
    const realGit = (args, cwd) => realExecFileSync('git', args, { cwd, encoding: 'utf8' });
    const runDir = makeTmpDir('verify-design-caches-realgit-');
    const result = runVerify({ runDir, base: 'main', repoRoot: repo, cwd: repo, deps: { git: realGit, gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'design-caches');
    assert.strictEqual(row.result, 'fail', row.detail);
    assert.match(row.detail, /some-topic-audit\.json/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ---- #3651 AC1.1: non-ASCII leftover names are read raw from `status -z` ----
//
// Without `-z` git C-quotes a non-ASCII name ("caf\303\251-ledger.md"), so the
// detail named a path no file has and the design-caches suffix filter saw a
// quote-terminated string. `core.quotepath true` is set explicitly in the
// fixture so a machine whose global config says `false` cannot make these
// pass vacuously.
function nonAsciiRepo() {
  const repo = gitRepo();
  realExecFileSync('git', ['config', 'core.quotepath', 'true'], { cwd: repo });
  return repo;
}

test('AC1.1: plans-ledger names an untracked docs/plans/café.md raw', () => {
  const repo = nonAsciiRepo();
  const runDir = makeTmpDir('verify-plans-ledger-nonascii-');
  busyWaitMs(10);
  try {
    fs.mkdirSync(path.join(repo, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs', 'plans', 'café-ledger.md'), 'x');
    const realGit = (args, cwd) => realExecFileSync('git', args, { cwd, encoding: 'utf8' });
    const result = runVerify({ runDir, base: 'main', repoRoot: repo, cwd: repo, deps: { git: realGit, gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'plans-ledger');
    assert.strictEqual(row.result, 'fail', row.detail);
    assert.ok(row.detail.includes('docs/plans/café-ledger.md'), row.detail);
    assert.ok(!row.detail.includes('\\303'), `C-quoted form leaked: ${row.detail}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('AC1.1: design-caches flags an untracked docs/plans/café-audit.json', () => {
  const repo = nonAsciiRepo();
  const runDir = makeTmpDir('verify-design-caches-nonascii-');
  try {
    fs.mkdirSync(path.join(repo, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs', 'plans', 'café-audit.json'), '{}');
    const realGit = (args, cwd) => realExecFileSync('git', args, { cwd, encoding: 'utf8' });
    const result = runVerify({ runDir, base: 'main', repoRoot: repo, cwd: repo, deps: { git: realGit, gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'design-caches');
    assert.strictEqual(row.result, 'fail', row.detail);
    assert.ok(row.detail.includes('café-audit.json'), row.detail);
    assert.ok(!row.detail.includes('\\303'), `C-quoted form leaked: ${row.detail}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('plans-ledger / design-caches ignore tracked-modification and rename records in -z status output (only ?? counts)', () => {
  const runDir = makeTmpDir('verify-status-z-nonuntracked-');
  const repoRoot = makeCleanRepoRoot();
  fs.mkdirSync(path.join(repoRoot, 'docs', 'plans'), { recursive: true });
  // " M" modified, "R " rename (new path first, original as its own NUL token),
  // then one real untracked cache file after them: the rename's trailing
  // original-path token must not be misread as a record of its own.
  const fakeGit = (args) => (args[1] === 'status'
    ? ' M docs/plans/tracked-audit.json\0R  docs/plans/new-audit.json\0docs/plans/old-audit.json\0?? docs/plans/fresh-audit.json\0'
    : '');
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd: repoRoot, deps: { git: fakeGit, gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'design-caches');
    assert.strictEqual(row.result, 'fail');
    assert.match(row.detail, /1 cache file\(s\) remain: docs\/plans\/fresh-audit\.json$/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('plans-ledger check does not count .superpowers/sdd/.gitignore itself as a leftover', () => {
  const runDir = makeTmpDir('verify-plans-ledger-sdd-gitignore-only-');
  const repoRoot = makeCleanRepoRoot();
  const sddDir = path.join(repoRoot, '.superpowers', 'sdd');
  fs.mkdirSync(sddDir, { recursive: true });
  fs.writeFileSync(path.join(sddDir, '.gitignore'), '*\n');
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd: repoRoot, deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'plans-ledger');
    assert.strictEqual(row.result, 'pass', row.detail);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('plans-ledger check scans `cwd`, not `repoRoot`, for untracked plan-file leftovers', () => {
  const cwd = makeTmpDir('verify-plans-ledger-cwd-clean-');
  const repoRoot = makeTmpDir('verify-plans-ledger-cwd-reporoot-dirty-');
  const calls = [];
  const fakeGit = (args, dir) => {
    calls.push({ args, dir });
    if (args[1] === 'status' && dir === repoRoot) return '?? docs/superpowers/plans/leftover-at-reporoot.md\0';
    return '';
  };
  try {
    const result = runVerify({ runDir: '/tmp/verify-cwd-scoping-does-not-matter', base: 'main', repoRoot, cwd, deps: { git: fakeGit, gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'plans-ledger');
    assert.strictEqual(row.result, 'pass', row.detail);
    const statusCall = calls.find((c) => c.args[1] === 'status');
    assert.strictEqual(statusCall.dir, cwd, 'plans-ledger must scan cwd, not repoRoot');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('design-caches check scans `cwd`, not `repoRoot`, for untracked cache-file leftovers', () => {
  const cwd = makeTmpDir('verify-design-caches-cwd-dirty-');
  const repoRoot = makeTmpDir('verify-design-caches-cwd-reporoot-clean-');
  fs.mkdirSync(path.join(cwd, 'docs', 'plans'), { recursive: true });
  const calls = [];
  const fakeGit = (args, dir) => {
    calls.push({ args, dir });
    if (args[1] === 'status' && dir === cwd) return '?? docs/plans/some-topic-audit.json\0';
    return '';
  };
  try {
    const result = runVerify({ runDir: '/tmp/verify-cwd-scoping-does-not-matter', base: 'main', repoRoot, cwd, deps: { git: fakeGit, gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'design-caches');
    assert.strictEqual(row.result, 'fail', row.detail);
    assert.match(row.detail, /some-topic-audit\.json/);
    // plans-ledger (registered before design-caches) also issues a `status`
    // call in this same runVerify(), so a bare args[1] === 'status' find()
    // would silently grab its call instead -- design-caches's own status
    // call has a single `docs/plans` pathspec (7 args); plans-ledger's has
    // two pathspecs (8 args). Match on length to target design-caches alone.
    const statusCall = calls.find((c) => c.args[1] === 'status' && c.args.length === 7);
    assert.strictEqual(statusCall.dir, cwd, 'design-caches must scan cwd, not repoRoot');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('AC1 (live git): a plans-ledger leftover created in a worktree is caught by a verify run invoked from that same worktree, and is invisible from the main checkout', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  try {
    const realGit = (args, cwd) => realExecFileSync('git', args, { cwd, encoding: 'utf8' });
    // #3168: create the run dir before the leftover, with a real mtime margin
    // -- the plans-ledger check treats an artifact older than the run dir as
    // not owned ('skip'), and APFS's nanosecond mtimes make the reverse order
    // fail deterministically on macOS.
    const runDir = makeTmpDir('verify-ac1-livewt-');
    busyWaitMs(10);
    const plansDir = path.join(wt, 'docs', 'superpowers', 'plans');
    fs.mkdirSync(plansDir, { recursive: true });
    fs.writeFileSync(path.join(plansDir, '2026-09-02-leftover-plan.md'), '# leftover\n');

    // Sanity check first: the main checkout's own git status must not see
    // the worktree-local leftover at all -- proving the pre-fix repoRoot-only
    // scan really was structurally blind to it, not just untested.
    const mainStatus = realGit(['status', '--porcelain=v1', '-uall', '--', 'docs/superpowers/plans', 'docs/plans'], main);
    assert.strictEqual(mainStatus.trim(), '', 'sanity: the main checkout must not see the worktree-local leftover');

    const result = runVerify({ runDir, base: 'main', repoRoot: main, cwd: wt, deps: { git: realGit, gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'plans-ledger');
    assert.strictEqual(row.result, 'fail', row.detail);
    assert.match(row.detail, /2026-09-02-leftover-plan\.md/);
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
    fs.rmSync(main, { recursive: true, force: true });
  }
});

function writeSpecFile(runDir, specId, record) {
  const workDir = path.join(runDir, 'work');
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, `${specId}-spec.md`), `---\nrecord: ${record}\n---\n# ${specId}: title\n`);
}

test('carrier-commit check passes when a Fixes #{n} commit exists in range for every resolved issue', () => {
  const runDir = makeTmpDir('verify-carrier-pass-');
  writeSpecFile(runDir, '900', 900);
  const fakeGit = (args) => (args[0] === 'log' ? 'Fix wrap-up verify verb\n\nFixes #900\n' : '');
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'pass');
});

test('carrier-commit check fails when no matching commit exists for a resolved issue', () => {
  const runDir = makeTmpDir('verify-carrier-fail-');
  writeSpecFile(runDir, '900', 900);
  const fakeGit = () => '';
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /900/);
});

test('carrier-commit check skips when no resolved issues found (conversation-based work)', () => {
  const runDir = makeTmpDir('verify-carrier-skip-');
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'skip');
});

// ---- resolvedIssueNumbers' verify-expectations.json `issues` fallback (#1223) ----
//
// No materialized header under work/ -- a current-branch (non-materialized) record run.
// review-console.md's step 11 now populates `issues` in this case; these tests pin the
// read side (resolvedIssueNumbers) actually consuming it, no longer dead code.

test('carrier-commit check resolves issue numbers from verify-expectations.json issues key when no materialized header exists', () => {
  const runDir = makeTmpDir('verify-carrier-expissues-pass-');
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], issues: [900] });
  const fakeGit = (args) => (args[0] === 'log' ? 'Fix wrap-up verify verb\n\nFixes #900\n' : '');
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'pass');
});

test('carrier-commit check fails naming the issue when resolved via expectations issues key and no carrier commit exists', () => {
  const runDir = makeTmpDir('verify-carrier-expissues-fail-');
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], issues: [900] });
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /900/);
});

test('carrier-commit check prefers a materialized header over expectations issues when both are present', () => {
  const runDir = makeTmpDir('verify-carrier-header-priority-');
  writeSpecFile(runDir, '901', 901);
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], issues: [900] });
  const fakeGit = (args) => (args[0] === 'log' ? 'Fix wrap-up verify verb\n\nFixes #901\n' : '');
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'pass', row.detail);
});

// ---- #3365: resolvedIssueNumbers reads the worktree mirror ----
//
// The materialized header is committed in the worktree only, so a
// main-checkout run dir has no work/ before merge. These fixtures put the run
// dir under a real `.claude-tweaks/pipelines/{run-id}` path (worktreeMirror
// keys on that segment) and the header only under the worktree's mirror.

const mirrorRoots = [];
test.after(() => {
  for (const root of mirrorRoots) fs.rmSync(root, { recursive: true, force: true });
});

function mirrorFixture({ runId = '2026-10-17T075913-spec-3337', specSubdir = null, record = 3337, state }) {
  const root = makeTmpDir('verify-mirror-');
  mirrorRoots.push(root);
  const parentDir = path.join(root, 'main', '.claude-tweaks', 'pipelines', runId);
  const runDir = specSubdir ? path.join(parentDir, specSubdir) : parentDir;
  fs.mkdirSync(runDir, { recursive: true });
  const wtDir = path.join(root, 'wt');
  const mirrorWork = specSubdir
    ? path.join(wtDir, '.claude-tweaks', 'pipelines', runId, specSubdir, 'work')
    : path.join(wtDir, '.claude-tweaks', 'pipelines', runId, 'work');
  fs.mkdirSync(mirrorWork, { recursive: true });
  if (record !== null) {
    fs.writeFileSync(path.join(mirrorWork, `${record}-spec.md`), `---\nrecord: ${record}\n---\n# ${record}: title\n`);
  }
  fs.writeFileSync(path.join(parentDir, 'run-state.json'), JSON.stringify(state(wtDir)));
  if (specSubdir) fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  return { root, runDir, wtDir };
}

test('#3365: resolvedIssueNumbers resolves a record from the worktree mirror when the run dir has no work/', () => {
  const { runDir } = mirrorFixture({ state: (wt) => ({ status: 'active', worktree: wt }) });
  assert.deepStrictEqual(resolvedIssueNumbers(runDir), [3337]);
});

test('#3365: resolvedIssueNumbers still falls back to expectations issues when neither location has a header', () => {
  const { runDir } = mirrorFixture({ record: null, state: (wt) => ({ status: 'active', worktree: wt }) });
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], issues: [900] });
  assert.deepStrictEqual(resolvedIssueNumbers(runDir), [900]);
});

test('#3365: resolvedIssueNumbers reads worktreeAtClose when a closed run nulled worktree', () => {
  const { runDir } = mirrorFixture({ state: (wt) => ({ status: 'closed', worktree: null, worktreeAtClose: wt }) });
  assert.deepStrictEqual(resolvedIssueNumbers(runDir), [3337]);
});

test('#3365: a multi-spec spec-{N}/ run dir inherits the parent run-state worktree for the mirror read', () => {
  const { runDir } = mirrorFixture({ specSubdir: 'spec-3337', state: (wt) => ({ status: 'active', worktree: wt }) });
  assert.deepStrictEqual(resolvedIssueNumbers(runDir), [3337]);
});

test('#3365: a closed multi-spec spec-{N}/ dir reads the parent worktreeAtClose for the mirror read', () => {
  const { runDir } = mirrorFixture({ specSubdir: 'spec-3337', state: (wt) => ({ status: 'closed', worktree: null, worktreeAtClose: wt }) });
  assert.deepStrictEqual(resolvedIssueNumbers(runDir), [3337]);
});

test('#3365: a parent run dir with only a manifest does not treat manifest ids as resolved records (Ruling R1)', () => {
  const { runDir, wtDir } = mirrorFixture({ record: null, state: (wt) => ({ status: 'active', worktree: wt }) });
  fs.writeFileSync(path.join(runDir, 'manifest.yml'), 'multispec:\n  parent: 3300\n  specs:\n    - id: 3337\n      status: not-run\n      subdir: spec-3337/\n');
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], issues: [900] });
  // Precondition: this fixture must actually reach the manifest rung of
  // resolveRecords — otherwise the assertion below would pass regardless of
  // whether resolvedIssueNumbers' closingRecords call is even present
  // (a manifest with no `parent:` line fails to parse and resolveRecords
  // never gets past 'unavailable', making the whole test non-discriminating).
  const precondition = resolveRecords(
    { readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } }, readFile: (p) => fs.readFileSync(p, 'utf8') },
    runDir,
    wtDir,
  );
  assert.strictEqual(precondition.source, 'manifest', 'fixture does not reach the manifest rung — test would be non-discriminating');
  assert.deepStrictEqual(resolvedIssueNumbers(runDir), [900]);
});

test('#3365: carrier-commit fails, not skips, for a mirror-resolved record with no closing keyword on branch or PR', () => {
  const { runDir } = mirrorFixture({ state: (wt) => ({ status: 'active', worktree: wt }) });
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'fail', row.detail);
  assert.match(row.detail, /3337/);
});

// ---- carrier-commit PR-body fallback (record #900 fix round, C1) ----
//
// Under `worktree` mode + `integration-model: pr-first`, there is
// deliberately no `Fixes #{n}` commit on the branch -- the run's draft PR
// body carries that line instead. The four tests below pin the fallback:
// PR body has it -> pass; neither has it -> fail; gh unavailable when the
// fallback is actually needed -> unknown; branch log already has it -> pass
// without ever touching gh (proving no wasted call).

test('carrier-commit check passes via the PR body when the branch log has no carrier commit (pr-first)', () => {
  const runDir = makeTmpDir('verify-carrier-prbody-pass-');
  writeSpecFile(runDir, '900', 900);
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ pr: { number: 1199 } }));
  const fakeGit = () => ''; // branch log: nothing found for any issue
  const prBodyCalls = [];
  const fakeGh = (args) => {
    if (args[0] === 'pr' && args[1] === 'view') {
      prBodyCalls.push(args);
      return JSON.stringify({ body: 'Some description.\n\nFixes #900\n' });
    }
    return ''; // other checks (e.g. acceptance-labeling) also call gh in this same runVerify pass
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'pass');
  assert.strictEqual(prBodyCalls.length, 1, 'PR body must be fetched exactly once');
  assert.deepStrictEqual(prBodyCalls[0], ['pr', 'view', '1199', '--json', 'body']);
});

test('carrier-commit check fails naming the issue when neither the branch log nor the PR body carries it', () => {
  const runDir = makeTmpDir('verify-carrier-prbody-fail-');
  writeSpecFile(runDir, '900', 900);
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ pr: { number: 1199 } }));
  const fakeGit = () => '';
  const fakeGh = () => JSON.stringify({ body: 'Unrelated PR description, no closing keyword.' });
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /900/);
});

test('carrier-commit check renders unknown when the PR-body fallback is needed but gh is unavailable', () => {
  const runDir = makeTmpDir('verify-carrier-prbody-ghabsent-');
  writeSpecFile(runDir, '900', 900);
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ pr: { number: 1199 } }));
  const fakeGit = () => '';
  const throwingGh = () => { throw new Error('command not found: gh'); };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: throwingGh } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'unknown');
  assert.match(row.detail, /1199/);
});

test('carrier-commit check passes from the branch log alone without ever calling gh for a PR body', () => {
  const runDir = makeTmpDir('verify-carrier-branchlog-nogh-');
  writeSpecFile(runDir, '900', 900);
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ pr: { number: 1199 } }));
  const fakeGit = (args) => (args[0] === 'log' ? 'Fix wrap-up verify verb\n\nFixes #900\n' : '');
  const prBodyCalls = [];
  const fakeGh = (args) => {
    if (args[0] === 'pr' && args[1] === 'view') prBodyCalls.push(args);
    return ''; // other checks (e.g. acceptance-labeling) also call gh in this same runVerify pass
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'pass');
  assert.deepStrictEqual(prBodyCalls, [], 'carrier-commit must never fetch a PR body when the branch log already carries the commit');
});

// ---- carrier-commit widened closing-keyword set + ground-truth fallback (#2676) ----

test('carrier-commit check passes on a "Closes #N" commit (previously only "Fixes #N" matched)', () => {
  const runDir = makeTmpDir('verify-carrier-closes-');
  writeSpecFile(runDir, '900', 900);
  const fakeGit = (args) => (args[0] === 'log' ? 'Widen carrier-commit keywords\n\nCloses #900\n' : '');
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'pass', row.detail);
});

test('carrier-commit check passes on a "Resolves #N" commit', () => {
  const runDir = makeTmpDir('verify-carrier-resolves-');
  writeSpecFile(runDir, '900', 900);
  const fakeGit = (args) => (args[0] === 'log' ? 'Widen carrier-commit keywords\n\nResolves #900\n' : '');
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'pass', row.detail);
});

test('carrier-commit check matches case-insensitively ("FIXES #N")', () => {
  const runDir = makeTmpDir('verify-carrier-case-');
  writeSpecFile(runDir, '900', 900);
  const fakeGit = (args) => (args[0] === 'log' ? 'Widen carrier-commit keywords\n\nFIXES #900\n' : '');
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'pass', row.detail);
});

test('carrier-commit check matches an owner/repo#N-qualified closing keyword', () => {
  const runDir = makeTmpDir('verify-carrier-ownerrepo-');
  writeSpecFile(runDir, '900', 900);
  const fakeGit = (args) => (args[0] === 'log' ? 'Widen carrier-commit keywords\n\nFixes org/repo#900\n' : '');
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'pass', row.detail);
});

test('carrier-commit check never matches #N as a substring of a larger issue number', () => {
  const runDir = makeTmpDir('verify-carrier-substring-');
  writeSpecFile(runDir, '12', 12);
  const fakeGit = (args) => (args[0] === 'log' ? 'Closes #123, unrelated to #12\n' : '');
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'fail', 'Closes #123 must never satisfy issue #12');
});

test('carrier-commit check passes via the ground-truth fallback: a CLOSED issue with a real closing-PR reference, even with no textual match anywhere', () => {
  const runDir = makeTmpDir('verify-carrier-groundtruth-pass-');
  writeSpecFile(runDir, '900', 900);
  const fakeGit = fakeOriginGit(); // 'remote' resolves; 'log' (and everything else) returns '' -- no textual match at all
  const calls = [];
  const fakeGh = (args) => {
    calls.push(args);
    if (isGraphqlCall(args)) {
      return JSON.stringify({
        data: { repository: { i900: { number: 900, state: 'CLOSED', closedByPullRequestsReferences: { nodes: [{ number: 2000, state: 'MERGED' }] } } } },
      });
    }
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'pass', row.detail);
  assert.ok(calls.some((a) => isGraphqlCall(a)), 'expected the ground-truth fallback to have run a linked-PR GraphQL call');
});

test('carrier-commit check still fails via the ground-truth fallback when the issue is CLOSED but has no closing-PR reference', () => {
  const runDir = makeTmpDir('verify-carrier-groundtruth-noref-');
  writeSpecFile(runDir, '900', 900);
  const fakeGit = fakeOriginGit();
  const fakeGh = (args) => {
    if (isGraphqlCall(args)) {
      return JSON.stringify({ data: { repository: { i900: { number: 900, state: 'CLOSED', closedByPullRequestsReferences: { nodes: [] } } } } });
    }
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'fail', 'a manually-closed issue with no closing-PR reference must still be a genuine fail');
  assert.match(row.detail, /900/);
});

test('carrier-commit check still fails via the ground-truth fallback when a closing-PR reference exists but the issue is still OPEN', () => {
  const runDir = makeTmpDir('verify-carrier-groundtruth-open-');
  writeSpecFile(runDir, '900', 900);
  const fakeGit = fakeOriginGit();
  const fakeGh = (args) => {
    if (isGraphqlCall(args)) {
      return JSON.stringify({
        data: { repository: { i900: { number: 900, state: 'OPEN', closedByPullRequestsReferences: { nodes: [{ number: 2000, state: 'OPEN' }] } } } },
      });
    }
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'fail', 'an open issue must still fail even with an (unmerged) closing-PR reference');
});

test('carrier-commit check never runs the ground-truth fallback when the textual match already succeeded (no gh call at all)', () => {
  const runDir = makeTmpDir('verify-carrier-groundtruth-skip-');
  writeSpecFile(runDir, '900', 900);
  const fakeGit = (args) => (args[0] === 'log' ? 'Closes #900\n' : '');
  const calls = [];
  const fakeGh = (args) => { calls.push(args); return ''; };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'pass');
  // Other checks in this same runVerify pass (e.g. acceptance-labeling) also
  // probe `gh --version` -- scope this assertion to carrier-commit's own
  // ground-truth calls (a linked-PR GraphQL call or an `issue view`), never
  // all gh calls in the pass.
  assert.ok(!calls.some((a) => isGraphqlCall(a) || (a[0] === 'issue' && a[1] === 'view')),
    `the ground-truth fallback must never fire when the textual match already succeeded, got: ${JSON.stringify(calls)}`);
});

test('carrier-commit check: a genuinely missing carrier commit (no text match, no closing-PR reference, no CLOSED state) still fails -- the existing coverage is not weakened', () => {
  const runDir = makeTmpDir('verify-carrier-groundtruth-genuine-fail-');
  writeSpecFile(runDir, '900', 900);
  const fakeGit = fakeOriginGit();
  const fakeGh = (args) => {
    if (isGraphqlCall(args)) return JSON.stringify({ data: { repository: { i900: { number: 900, state: 'OPEN', closedByPullRequestsReferences: { nodes: [] } } } } });
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /900/);
});

test('carrier-commit check still fails when the batched response carries no issue state at all (older shape) and there is a closing-PR reference', () => {
  // #2934 Gotcha: a fake GraphQL response that predates this change (no
  // `state` on the issue node) must degrade to not-closed, never be
  // misread as CLOSED.
  const runDir = makeTmpDir('verify-carrier-groundtruth-nostate-');
  writeSpecFile(runDir, '900', 900);
  const fakeGit = fakeOriginGit();
  const fakeGh = (args) => {
    if (isGraphqlCall(args)) {
      return JSON.stringify({ data: { repository: { i900: { number: 900, closedByPullRequestsReferences: { nodes: [{ number: 2000, state: 'MERGED' }] } } } } });
    }
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'fail', 'a missing batched issueState must never be treated as CLOSED');
});

test('#2934: the carrier-commit ground-truth fallback issues exactly one gh call for N missing issues (no per-issue issue-view loop)', () => {
  const runDir = makeTmpDir('verify-carrier-groundtruth-onecall-');
  writeSpecFile(runDir, '900', 900);
  writeSpecFile(runDir, '901', 901);
  const fakeGit = fakeOriginGit();
  const calls = [];
  const fakeGh = (args) => {
    calls.push(args);
    if (isGraphqlCall(args)) {
      return JSON.stringify({
        data: {
          repository: {
            i900: { number: 900, state: 'CLOSED', closedByPullRequestsReferences: { nodes: [{ number: 2000, state: 'MERGED' }] } },
            i901: { number: 901, state: 'CLOSED', closedByPullRequestsReferences: { nodes: [{ number: 2001, state: 'MERGED' }] } },
          },
        },
      });
    }
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'pass', row.detail);
  // Scope to carrier-commit's own ground-truth calls -- other checks in this
  // same runVerify pass (acceptance-labeling's parent resolution, a
  // labels/comments issue view) also call gh, so a bare isGraphqlCall/
  // issue-view filter would count those too (same scoping note test 53
  // above already makes for its own assertion).
  const linkedPrQueryCalls = calls.filter((a) => isGraphqlCall(a) && a.some((v) => typeof v === 'string' && v.includes('closedByPullRequestsReferences')));
  const issueViewCalls = calls.filter((a) => a[0] === 'issue' && a[1] === 'view' && (a[2] === '900' || a[2] === '901') && a.includes('state'));
  assert.strictEqual(linkedPrQueryCalls.length, 1, `expected exactly one linked-PR GraphQL call for 2 missing issues, got: ${JSON.stringify(calls)}`);
  assert.strictEqual(issueViewCalls.length, 0, `expected zero per-issue "gh issue view {n}" calls, got: ${JSON.stringify(issueViewCalls)}`);
});

test('reference-repairs check skips when engine-state.json has no applied references findings', () => {
  const runDir = makeTmpDir('verify-refrepair-skip-');
  fs.writeFileSync(path.join(runDir, 'engine-state.json'), JSON.stringify({ version: 1, results: {} }));
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'reference-repairs');
  assert.strictEqual(row.result, 'skip');
});

test('reference-repairs check fails when Initiative-Fix commit diff touches a file not in the applied set', () => {
  const runDir = makeTmpDir('verify-refrepair-fail-');
  fs.writeFileSync(path.join(runDir, 'engine-state.json'), JSON.stringify({
    version: 1,
    results: { references: { findings: [{ action: 'applied', kind: 'broken-link', summary: 'fix', targetPath: 'docs/a.md' }] } },
  }));
  const fakeGit = (args) => {
    if (args[0] === 'log' && args.includes('--grep=Initiative-Fix:')) return 'def5678 Initiative-Fix: repair refs\n';
    if (args[0] === 'diff-tree' && args.includes('--name-only')) return 'docs/a.md\0docs/b.md\0';
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'reference-repairs');
  assert.strictEqual(row.result, 'fail');
  // Exact: a '\n'-split parse would fold both NUL-separated paths into one token.
  assert.strictEqual(row.detail, 'Initiative-Fix: commit touches unrelated file(s): docs/b.md');
});

// ---- reference-repairs: pr-first verification via the PR's own (pre-squash)
// commit list (#2552 AC3/AC6) ----

test('reference-repairs check verifies via the PR\'s own commit list under pr-first, ignoring an unrelated file a squash commit on main would also show', () => {
  const runDir = makeTmpDir('verify-refrepair-prfirst-pass-');
  fs.writeFileSync(path.join(runDir, 'engine-state.json'), JSON.stringify({
    version: 1,
    results: { references: { findings: [{ action: 'applied', kind: 'broken-link', summary: 'fix', targetPath: 'docs/a.md' }] } },
  }));
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ pr: { number: 1200 } }));
  const gitCalls = [];
  const fakeGit = (args) => {
    gitCalls.push(args);
    if (args[0] === 'remote') return 'https://github.com/org/repo.git';
    throw new Error(`unexpected git call in pr-first path: ${args.join(' ')}`);
  };
  const fakeGh = (args) => {
    if (args[0] === 'pr' && args[1] === 'view') {
      return JSON.stringify({
        commits: [
          { oid: 'aaa1111', messageHeadline: 'Initiative-Fix: repair refs', messageBody: '' },
          { oid: 'bbb2222', messageHeadline: 'Unrelated feature change', messageBody: '' },
        ],
      });
    }
    if (args[0] === 'api' && args[1] === 'repos/org/repo/commits/aaa1111') return '["docs/a.md"]';
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'reference-repairs');
  assert.strictEqual(row.result, 'pass', row.detail);
  // Never diffs the squash commit on main -- only the PR's own (pre-squash)
  // commit list, which is what lets this scenario tell the unrelated
  // bundled-in file apart from the actual repair.
  assert.ok(!gitCalls.some((a) => a[0] === 'log' || a[0] === 'diff-tree'), 'must not fall back to the local squash-commit diff under pr-first');
});

test('reference-repairs check still fails under pr-first when a repair genuinely did not land (no Initiative-Fix: commit on the PR)', () => {
  const runDir = makeTmpDir('verify-refrepair-prfirst-fail-');
  fs.writeFileSync(path.join(runDir, 'engine-state.json'), JSON.stringify({
    version: 1,
    results: { references: { findings: [{ action: 'applied', kind: 'broken-link', summary: 'fix', targetPath: 'docs/a.md' }] } },
  }));
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ pr: { number: 1201 } }));
  const fakeGit = (args) => (args[0] === 'remote' ? 'https://github.com/org/repo.git' : '');
  const fakeGh = (args) => {
    if (args[0] === 'pr' && args[1] === 'view') {
      return JSON.stringify({ commits: [{ oid: 'ccc3333', messageHeadline: 'Unrelated feature change', messageBody: '' }] });
    }
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'reference-repairs');
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /no Initiative-Fix: commit found on PR #1201/);
});

test('acceptance-labeling check renders unknown (gh absent) when gh probe throws', () => {
  const runDir = makeTmpDir('verify-acceptance-ghabsent-');
  writeSpecFile(runDir, '900', 900);
  const throwingGh = () => { throw new Error('gh: command not found'); };
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: throwingGh } });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'unknown');
  assert.match(row.detail, /gh absent/);
});

test('acceptance-labeling check passes when demo:pending label and a brief comment both present', () => {
  const runDir = makeTmpDir('verify-acceptance-pass-');
  writeSpecFile(runDir, '900', 900);
  const fakeGh = (args) => {
    if (args[0] === '--version') return 'gh version 2.0.0';
    if (isGraphqlCall(args)) return parentGraphqlResponse(parentQueryNumber(args), null);
    if (args.includes('labels,comments')) {
      return JSON.stringify({ labels: [{ name: 'demo:pending' }], comments: [{ body: '## Verification Brief\n### Confirmed\n', authorAssociation: 'MEMBER' }] });
    }
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeOriginGit(), gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'pass');
});

test('acceptance-labeling check fails when demo:pending label missing', () => {
  const runDir = makeTmpDir('verify-acceptance-fail-');
  writeSpecFile(runDir, '900', 900);
  const fakeGh = (args) => {
    if (args[0] === '--version') return 'gh version 2.0.0';
    if (isGraphqlCall(args)) return parentGraphqlResponse(parentQueryNumber(args), null);
    if (args.includes('labels,comments')) return JSON.stringify({ labels: [], comments: [] });
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeOriginGit(), gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'fail');
});

// #2383: verification-brief.md's Oversight-floor gate legitimately skips
// demo:pending bootstrap for a non-parent record whose risk/size facets
// don't clear the configured floor -- it records that outcome into
// verify-expectations.json's `oversightExempt` array, and this check must
// render 'skip' for that record instead of the false-positive 'fail' it
// rendered before this fix (record #1841's own wrap-up, cited in #2383).
test('acceptance-labeling check skips (never fails) an issue listed in verify-expectations.json oversightExempt, even with no demo:pending label', () => {
  const runDir = makeTmpDir('verify-acceptance-oversightexempt-');
  writeSpecFile(runDir, '900', 900);
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], oversightExempt: [900] });
  const calls = [];
  const fakeGh = (args) => {
    calls.push(args);
    if (args[0] === '--version') return 'gh version 2.0.0';
    // Any other call -- parent resolution, labels, comments -- is a bug: an
    // exempted issue must never reach gh at all.
    throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
  };
  // carrier-commit's own textual match must pass via the branch log alone --
  // this fixture's assertion below is about acceptance-labeling never
  // calling gh beyond the probe, and carrier-commit's ground-truth fallback
  // (triggered only when its own textual match fails) also calls gh.
  const result = runVerify({
    runDir, base: 'main', deps: { git: fakeOriginGit((args) => (args[0] === 'log' ? 'Fix wrap-up verify verb\n\nFixes #900\n' : '')), gh: fakeGh },
  });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'skip', row.detail);
  assert.match(row.detail, /oversight floor/);
  assert.strictEqual(calls.filter((a) => a[0] !== '--version').length, 0, 'an exempted issue must never call gh beyond the availability probe');
});

// A mixed run (one exempted record, one that genuinely needs checking) must
// only narrow the checked population -- the non-exempt issue's own
// pass/fail verdict is unaffected by its sibling's exemption.
test('acceptance-labeling check still fails a non-exempt issue when a sibling issue is oversight-exempt', () => {
  const runDir = makeTmpDir('verify-acceptance-oversightexempt-mixed-');
  writeSpecFile(runDir, '900', 900);
  writeSpecFile(runDir, '901', 901);
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], oversightExempt: [900] });
  const fakeGh = (args) => {
    if (args[0] === '--version') return 'gh version 2.0.0';
    if (isGraphqlCall(args)) return parentGraphqlResponse(parentQueryNumber(args), null);
    if (args.includes('labels,comments')) return JSON.stringify({ labels: [], comments: [] });
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeOriginGit(), gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /#901/);
  assert.doesNotMatch(row.detail, /#900/);
});

test('acceptance-labeling check skips when no resolved issues found', () => {
  const runDir = makeTmpDir('verify-acceptance-skip-');
  const fakeGh = (args) => (args[0] === '--version' ? 'gh version 2.0.0' : '');
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'skip');
});

test('acceptance-labeling check resolves issue numbers from verify-expectations.json issues key when no materialized header exists', () => {
  const runDir = makeTmpDir('verify-acceptance-expissues-');
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], issues: [900] });
  const fakeGh = (args) => {
    if (args[0] === '--version') return 'gh version 2.0.0';
    if (isGraphqlCall(args)) return parentGraphqlResponse(parentQueryNumber(args), null);
    if (args.includes('labels,comments')) {
      return JSON.stringify({ labels: [{ name: 'demo:pending' }], comments: [{ body: '## Verification Brief\n### Confirmed\n', authorAssociation: 'MEMBER' }] });
    }
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeOriginGit(), gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'pass', row.detail);
});

test('acceptance-labeling check redirects to a resolvable parent, never checking the sub-issue itself', () => {
  const runDir = makeTmpDir('verify-acceptance-parent-');
  writeSpecFile(runDir, '900', 900);
  const calls = [];
  const fakeGh = (args) => {
    calls.push(args);
    if (args[0] === '--version') return 'gh version 2.0.0';
    if (isGraphqlCall(args)) return parentGraphqlResponse(parentQueryNumber(args), 898);
    if (isSubIssuesCall(args)) return subIssuesGh([{ number: 900, state: 'closed', labels: ['risk:high'] }]);
    if (args.includes('labels,comments')) {
      return JSON.stringify({ labels: [{ name: 'demo:pending' }], comments: [{ body: '## Verification Brief\n### Confirmed\n', authorAssociation: 'MEMBER' }] });
    }
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeOriginGit(), gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'pass');
  const issueCalls = calls.filter((a) => a[0] === 'issue' && a.includes('labels,comments'));
  assert.strictEqual(issueCalls.length, 1);
  assert.strictEqual(issueCalls[0][2], '898', 'the labels/comments check must target the parent #898, not the sub-issue #900');
});

test('acceptance-labeling check queries a shared parent exactly once for two sub-issues', () => {
  const runDir = makeTmpDir('verify-acceptance-dedup-');
  writeSpecFile(runDir, '900', 900);
  writeSpecFile(runDir, '901', 901);
  const calls = [];
  const fakeGh = (args) => {
    calls.push(args);
    if (args[0] === '--version') return 'gh version 2.0.0';
    if (isGraphqlCall(args)) return parentGraphqlResponse(parentQueryNumber(args), 898);
    if (isSubIssuesCall(args)) {
      return subIssuesGh([{ number: 900, state: 'closed', labels: ['risk:high'] }, { number: 901, state: 'open', labels: ['risk:high'] }]);
    }
    if (args.includes('labels,comments')) {
      return JSON.stringify({ labels: [{ name: 'demo:pending' }], comments: [{ body: '## Verification Brief\n### Confirmed\n', authorAssociation: 'MEMBER' }] });
    }
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeOriginGit(), gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'pass');
  const issueCalls = calls.filter((a) => a[0] === 'issue' && a.includes('labels,comments'));
  assert.strictEqual(issueCalls.length, 1, 'parent #898 must only be checked once despite two sub-issues resolving to it');
  assert.strictEqual(row.detail, '');
});

// #3222: a resolvable-parent record's gate is read from the parent's sub-issues
// (parentGateState) and the oversight floor, not from the parent's demo:pending
// label alone. Every case resolves its parent to #898.
function parentGateRow({ records, subIssues, parentLabels = [], subIssuesReply, policyRaw }) {
  const runDir = makeTmpDir('verify-acceptance-parentgate-');
  const repoRoot = makeCleanRepoRoot();
  if (policyRaw !== undefined) {
    fs.mkdirSync(path.join(repoRoot, '.claude-tweaks'));
    fs.writeFileSync(path.join(repoRoot, '.claude-tweaks', 'policy.yml'), policyRaw);
  }
  for (const n of records) writeSpecFile(runDir, String(n), n);
  const calls = [];
  const fakeGh = (args) => {
    calls.push(args);
    if (args[0] === '--version') return 'gh version 2.0.0';
    if (isGraphqlCall(args)) return parentGraphqlResponse(parentQueryNumber(args), 898);
    if (isSubIssuesCall(args)) return subIssuesReply ? subIssuesReply() : subIssuesGh(subIssues);
    if (args.includes('labels,comments')) return JSON.stringify({ labels: parentLabels.map((name) => ({ name })), comments: [] });
    return '';
  };
  const result = runVerify({ runDir, base: 'main', repoRoot, deps: { git: fakeOriginGit(), gh: fakeGh } });
  return { row: result.rows.find((r) => r.check === 'acceptance-labeling'), calls };
}

test('AC1.1/AC1.2: acceptance-labeling skips (never fails) a sub-issue whose parent gate is incomplete', () => {
  const { row } = parentGateRow({
    records: [900],
    subIssues: [
      { number: 900, state: 'open', labels: ['risk:high'] },
      { number: 901, state: 'closed', labels: ['risk:high'] },
      { number: 902, state: 'open', labels: ['risk:high'] },
      { number: 903, state: 'open', labels: ['risk:high'] },
    ],
  });
  assert.strictEqual(row.result, 'skip', row.detail);
  assert.match(row.detail, /parent gate #898 not due — 2 sibling sub-issue\(s\) open/);
});

test('AC2.1: acceptance-labeling still fails a due, above-floor parent missing demo:pending', () => {
  const { row } = parentGateRow({
    records: [900],
    subIssues: [
      { number: 900, state: 'open', labels: ['risk:high'] },
      { number: 901, state: 'closed', labels: ['risk:high'] },
    ],
  });
  assert.strictEqual(row.result, 'fail', row.detail);
  assert.match(row.detail, /#898: missing demo:pending label/);
});

test('AC3.1: acceptance-labeling skips a due parent below the oversight floor', () => {
  const { row } = parentGateRow({
    records: [900],
    subIssues: [
      { number: 900, state: 'open', labels: ['risk:medium'] },
      { number: 901, state: 'closed', labels: ['risk:medium'] },
    ],
  });
  assert.strictEqual(row.result, 'skip', row.detail);
  assert.match(row.detail, /parent #898 below oversight floor/);
});

test('AC4.1: acceptance-labeling renders unknown when sub-issue enumeration throws, never reading the parent labels', () => {
  const { row, calls } = parentGateRow({
    records: [900],
    subIssuesReply: () => { throw new Error('gh: HTTP 502'); },
  });
  assert.strictEqual(row.result, 'unknown', row.detail);
  assert.match(row.detail, /#900: gh api sub_issues failed for parent #898/);
  assert.strictEqual(calls.filter((a) => a[0] === 'issue' && a.includes('labels,comments')).length, 0);
});

test('acceptance-labeling renders unknown when sub-issue enumeration returns nothing', () => {
  const { row } = parentGateRow({ records: [900], subIssuesReply: () => '' });
  assert.strictEqual(row.result, 'unknown', row.detail);
  assert.match(row.detail, /no sub-issues enumerated for parent #898/);
});

test('acceptance-labeling counts every run sub-issue of a shared parent as closed, enumerating that parent once', () => {
  const { row, calls } = parentGateRow({
    records: [900, 901],
    subIssues: [
      { number: 900, state: 'open', labels: ['risk:high'] },
      { number: 901, state: 'open', labels: ['risk:high'] },
      { number: 902, state: 'closed', labels: ['risk:high'] },
    ],
  });
  assert.strictEqual(row.result, 'fail', row.detail);
  assert.match(row.detail, /#898: missing demo:pending label/);
  assert.strictEqual(calls.filter((a) => isSubIssuesCall(a)).length, 1, 'parent #898 must be enumerated once for two run sub-issues');
});

test('acceptance-labeling fails closed on an unscored sibling when the parent gate is due', () => {
  const { row } = parentGateRow({
    records: [900],
    subIssues: [
      { number: 900, state: 'open', labels: ['risk:low'] },
      { number: 901, state: 'closed', labels: [] },
    ],
  });
  assert.strictEqual(row.result, 'fail', row.detail);
  assert.match(row.detail, /#898: missing demo:pending label/);
});

test('acceptance-labeling reads the parent floor as the highest sub-issue risk tier, not the first or last valid one', () => {
  const { row } = parentGateRow({
    records: [900],
    subIssues: [
      { number: 900, state: 'open', labels: ['risk:low'] },
      { number: 901, state: 'closed', labels: ['risk:high'] },
      { number: 902, state: 'closed', labels: ['risk:low'] },
    ],
  });
  assert.strictEqual(row.result, 'fail', row.detail);
  assert.match(row.detail, /#898: missing demo:pending label/);
});

test('acceptance-labeling takes the oversight floor from policy.yml: risk-floor medium requires a due risk:medium parent to carry demo:pending', () => {
  const { row } = parentGateRow({
    records: [900],
    policyRaw: 'risk-floor: medium\n',
    subIssues: [
      { number: 900, state: 'open', labels: ['risk:medium'] },
      { number: 901, state: 'closed', labels: ['risk:medium'] },
    ],
  });
  assert.strictEqual(row.result, 'fail', row.detail);
  assert.match(row.detail, /#898: missing demo:pending label/);
});

test('acceptance-labeling falls back to the default high floor when policy.yml sets an invalid risk-floor', () => {
  const { row } = parentGateRow({
    records: [900],
    policyRaw: 'risk-floor: bogus\n',
    subIssues: [
      { number: 900, state: 'open', labels: ['risk:medium'] },
      { number: 901, state: 'closed', labels: ['risk:medium'] },
    ],
  });
  assert.strictEqual(row.result, 'skip', row.detail);
  assert.match(row.detail, /parent #898 below oversight floor/);
});

// Two run records under different parents: #898 stays incomplete (open
// sibling #901) while #899 is due, so each row's detail must carry the not-due
// skip reason alongside the due parent's outcome.
function twoParentRow({ dueParentLabels, dueParentComments }) {
  const runDir = makeTmpDir('verify-acceptance-twoparents-');
  writeSpecFile(runDir, '900', 900);
  writeSpecFile(runDir, '910', 910);
  const parentOf = { 900: 898, 910: 899 };
  const subsOf = {
    898: [
      { number: 900, state: 'open', labels: ['risk:high'] },
      { number: 901, state: 'open', labels: ['risk:high'] },
    ],
    899: [
      { number: 910, state: 'open', labels: ['risk:high'] },
      { number: 911, state: 'closed', labels: ['risk:high'] },
    ],
  };
  const fakeGh = (args) => {
    if (args[0] === '--version') return 'gh version 2.0.0';
    if (isGraphqlCall(args)) {
      const n = parentQueryNumber(args);
      return parentGraphqlResponse(n, parentOf[n]);
    }
    if (isSubIssuesCall(args)) return subIssuesGh(subsOf[Number(args[2].match(/issues\/(\d+)\/sub_issues$/)[1])]);
    if (args.includes('labels,comments')) {
      if (args[2] === '899') return JSON.stringify({ labels: dueParentLabels.map((name) => ({ name })), comments: dueParentComments });
      return JSON.stringify({ labels: [], comments: [] });
    }
    return '';
  };
  const result = runVerify({ runDir, base: 'main', repoRoot: makeCleanRepoRoot(), deps: { git: fakeOriginGit(), gh: fakeGh } });
  return result.rows.find((r) => r.check === 'acceptance-labeling');
}

test('acceptance-labeling pass detail carries the not-due skip reason of a sibling parent', () => {
  const row = twoParentRow({
    dueParentLabels: ['demo:pending'],
    dueParentComments: [{ body: '## Verification Brief\n### Confirmed\n', authorAssociation: 'MEMBER' }],
  });
  assert.strictEqual(row.result, 'pass', row.detail);
  assert.match(row.detail, /parent gate #898 not due — 1 sibling sub-issue\(s\) open/);
});

test('acceptance-labeling fail detail carries the not-due skip reason alongside the missing demo:pending line', () => {
  const row = twoParentRow({ dueParentLabels: [], dueParentComments: [] });
  assert.strictEqual(row.result, 'fail', row.detail);
  assert.match(row.detail, /#899: missing demo:pending label/);
  assert.match(row.detail, /parent gate #898 not due — 1 sibling sub-issue\(s\) open/);
});

test('acceptance-labeling renders unknown when a sub-issue line carries no string state', () => {
  const { row } = parentGateRow({
    records: [900],
    subIssuesReply: () => JSON.stringify({ number: 900, labels: ['risk:high'] }),
  });
  assert.strictEqual(row.result, 'unknown', row.detail);
  assert.match(row.detail, /could not parse sub_issues output for parent #898/);
});

test('acceptance-labeling check passes via the pr-first pointer+brief form (full brief on the PR, pointer on the issue)', () => {
  const runDir = makeTmpDir('verify-acceptance-prpointer-pass-');
  writeSpecFile(runDir, '900', 900);
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ pr: { number: 1199 } }));
  const fakeGh = (args) => {
    if (args[0] === '--version') return 'gh version 2.0.0';
    if (isGraphqlCall(args)) return parentGraphqlResponse(parentQueryNumber(args), null);
    if (args[0] === 'pr' && args[1] === 'view') {
      return JSON.stringify({ comments: [{ body: '<!-- run-comment: brief -->\n\n## Verification Brief\n### Confirmed\n', authorAssociation: 'MEMBER' }] });
    }
    if (args.includes('labels,comments')) {
      return JSON.stringify({
        labels: [{ name: 'demo:pending' }],
        comments: [{ body: 'Verification Brief posted to PR #1199: https://github.com/org/repo/pull/1199', authorAssociation: 'MEMBER' }],
      });
    }
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeOriginGit(), gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'pass');
});

test('acceptance-labeling check fails when the pr-first pointer is present but the PR carries no confirmed brief', () => {
  const runDir = makeTmpDir('verify-acceptance-prpointer-fail-');
  writeSpecFile(runDir, '900', 900);
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ pr: { number: 1199 } }));
  const fakeGh = (args) => {
    if (args[0] === '--version') return 'gh version 2.0.0';
    if (isGraphqlCall(args)) return parentGraphqlResponse(parentQueryNumber(args), null);
    if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ comments: [] });
    if (args.includes('labels,comments')) {
      return JSON.stringify({
        labels: [{ name: 'demo:pending' }],
        comments: [{ body: 'Verification Brief posted to PR #1199: https://github.com/org/repo/pull/1199', authorAssociation: 'MEMBER' }],
      });
    }
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeOriginGit(), gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /PR #1199/);
});

// #3358: a Verification Brief marker only counts when GitHub attests its
// author is an owner, member, or collaborator (comment-trust.js). An untrusted
// marker comment takes the same path as "no such comment" and is named in the
// row's detail as `ignored: ...`.
function acceptanceTrustRow({ issueComments, prComments, withPr }) {
  const runDir = makeTmpDir('verify-acceptance-trust-');
  writeSpecFile(runDir, '900', 900);
  if (withPr) fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ pr: { number: 1199 } }));
  const prViews = [];
  const fakeGh = (args) => {
    if (args[0] === '--version') return 'gh version 2.0.0';
    if (isGraphqlCall(args)) return parentGraphqlResponse(parentQueryNumber(args), null);
    if (args[0] === 'pr' && args[1] === 'view') {
      // Other checks in this pass also run gh pr view (--json body / commits);
      // only the acceptance-labeling comments read is tracked.
      if (args.includes('comments')) prViews.push(args);
      return JSON.stringify({ comments: prComments || [] });
    }
    if (args.includes('labels,comments')) return JSON.stringify({ labels: [{ name: 'demo:pending' }], comments: issueComments });
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeOriginGit(), gh: fakeGh } });
  return { row: result.rows.find((r) => r.check === 'acceptance-labeling'), prViews };
}

const TRUST_BRIEF_BODY = '## Verification Brief\n### Confirmed\n';
const TRUST_POINTER_BODY = 'Verification Brief posted to PR #1199: https://github.com/org/repo/pull/1199';
const TRUST_PR_BRIEF_BODY = '<!-- run-comment: brief -->\n\n## Verification Brief\n### Confirmed\n';

test('AC2.1: an issue brief authored NONE fails acceptance-labeling and names the ignored comment', () => {
  const { row } = acceptanceTrustRow({
    issueComments: [{ body: TRUST_BRIEF_BODY, url: 'https://x/c1', author: { login: 'eve' }, authorAssociation: 'NONE' }],
  });
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /no comment carries a confirmed Verification Brief/);
  assert.match(row.detail, /ignored: skipped marker comment https:\/\/x\/c1 by eve \(NONE\)/);
});

test('AC2.1: an issue brief with no association at all fails closed and says "no association"', () => {
  const { row } = acceptanceTrustRow({
    issueComments: [{ body: TRUST_BRIEF_BODY, url: 'https://x/c1', author: { login: 'eve' } }],
  });
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /ignored: skipped marker comment https:\/\/x\/c1 by eve \(no association\)/);
});

test('AC2.1: an untrusted pointer is not followed', () => {
  const { row, prViews } = acceptanceTrustRow({
    withPr: true,
    issueComments: [{ body: TRUST_POINTER_BODY, url: 'https://x/p1', author: { login: 'eve' }, authorAssociation: 'NONE' }],
    prComments: [{ body: TRUST_PR_BRIEF_BODY, url: 'https://x/pr1', author: { login: 'eve' }, authorAssociation: 'MEMBER' }],
  });
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /ignored: skipped marker comment https:\/\/x\/p1 by eve \(NONE\)/);
  assert.deepStrictEqual(prViews, [], 'gh pr view must not run for an untrusted pointer');
});

test('AC2.1: an untrusted PR brief does not satisfy a trusted pointer', () => {
  const { row } = acceptanceTrustRow({
    withPr: true,
    issueComments: [{ body: TRUST_POINTER_BODY, url: 'https://x/p1', author: { login: 'bot' }, authorAssociation: 'MEMBER' }],
    prComments: [{ body: TRUST_PR_BRIEF_BODY, url: 'https://x/pr1', author: { login: 'eve' }, authorAssociation: 'NONE' }],
  });
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /pointer to PR #1199 found but no confirmed Verification Brief on PR #1199/);
  assert.match(row.detail, /ignored: skipped marker comment https:\/\/x\/pr1 by eve \(NONE\)/);
});

test('AC2.2: the same issue brief authored MEMBER passes', () => {
  const { row } = acceptanceTrustRow({
    issueComments: [{ body: TRUST_BRIEF_BODY, url: 'https://x/c1', author: { login: 'eve' }, authorAssociation: 'MEMBER' }],
  });
  assert.strictEqual(row.result, 'pass');
  assert.strictEqual(row.detail, '');
});

test('AC2.2: the same pointer authored MEMBER is followed and passes', () => {
  const { row, prViews } = acceptanceTrustRow({
    withPr: true,
    issueComments: [{ body: TRUST_POINTER_BODY, url: 'https://x/p1', author: { login: 'eve' }, authorAssociation: 'MEMBER' }],
    prComments: [{ body: TRUST_PR_BRIEF_BODY, url: 'https://x/pr1', author: { login: 'eve' }, authorAssociation: 'MEMBER' }],
  });
  assert.strictEqual(row.result, 'pass');
  assert.strictEqual(row.detail, '');
  assert.strictEqual(prViews.length, 1);
});

test('AC2.2: the same PR brief authored COLLABORATOR satisfies a trusted pointer', () => {
  const { row } = acceptanceTrustRow({
    withPr: true,
    issueComments: [{ body: TRUST_POINTER_BODY, url: 'https://x/p1', author: { login: 'bot' }, authorAssociation: 'OWNER' }],
    prComments: [{ body: TRUST_PR_BRIEF_BODY, url: 'https://x/pr1', author: { login: 'eve' }, authorAssociation: 'COLLABORATOR' }],
  });
  assert.strictEqual(row.result, 'pass');
});

// #3333: in a multi-spec run the Verification Brief lands on the shared PR as
// `<!-- run-comment: brief:{n} -->`; acceptance-labeling reads that marker
// first and falls back to the plain `brief` marker (single-spec / pre-change).
const QUALIFIED_BRIEF = (n) => `<!-- run-comment: brief:${n} -->\n\n## Verification Brief\n### Confirmed\n`;
const MEMBER_POINTER = [{ body: TRUST_POINTER_BODY, url: 'https://x/p1', author: { login: 'bot' }, authorAssociation: 'MEMBER' }];
const memberPrComment = (body, url) => ({ body, url, author: { login: 'bot' }, authorAssociation: 'MEMBER' });

test('AC4.1: acceptance-labeling passes via a spec-qualified brief:{n} PR comment', () => {
  const { row } = acceptanceTrustRow({ withPr: true, issueComments: MEMBER_POINTER,
    prComments: [memberPrComment(QUALIFIED_BRIEF(900), 'https://x/pr1')] });
  assert.strictEqual(row.result, 'pass', row.detail);
});

test("AC1.1: a sibling spec's brief:{m} does not satisfy #n", () => {
  const { row } = acceptanceTrustRow({ withPr: true, issueComments: MEMBER_POINTER,
    prComments: [901, 9000].map((m) => memberPrComment(QUALIFIED_BRIEF(m), `https://x/pr${m}`)) });
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /pointer to PR #1199 found but no confirmed Verification Brief on PR #1199/);
  assert.match(row.detail, /looked for brief:900, then brief/);
});

test('AC3.1: acceptance-labeling falls back to the plain brief marker (single-spec / pre-change brief)', () => {
  const { row } = acceptanceTrustRow({ withPr: true, issueComments: MEMBER_POINTER,
    prComments: [memberPrComment(TRUST_PR_BRIEF_BODY, 'https://x/pr1')] });
  assert.strictEqual(row.result, 'pass', row.detail);
});

test('AC4.1: an untrusted brief:{n} falls back to a trusted plain brief and names the skipped comment', () => {
  const { row } = acceptanceTrustRow({ withPr: true, issueComments: MEMBER_POINTER, prComments: [
    { body: QUALIFIED_BRIEF(900), url: 'https://x/q1', author: { login: 'eve' }, authorAssociation: 'NONE' },
    memberPrComment(TRUST_PR_BRIEF_BODY, 'https://x/pr1'),
  ] });
  assert.strictEqual(row.result, 'pass', row.detail);
  assert.match(row.detail, /ignored: skipped marker comment https:\/\/x\/q1 by eve \(NONE\)/);
});

test('a trusted brief after an untrusted one passes and still names the skipped one', () => {
  const { row } = acceptanceTrustRow({
    issueComments: [
      { body: TRUST_BRIEF_BODY, url: 'https://x/c1', author: { login: 'eve' }, authorAssociation: 'NONE' },
      { body: TRUST_BRIEF_BODY, url: 'https://x/c2', author: { login: 'tom' }, authorAssociation: 'MEMBER' },
    ],
  });
  assert.strictEqual(row.result, 'pass');
  assert.match(row.detail, /^ignored: skipped marker comment https:\/\/x\/c1 by eve \(NONE\)/);
});

test('a failing row still names the comments a passing target skipped', () => {
  const runDir = makeTmpDir('verify-acceptance-trust-mixed-');
  writeSpecFile(runDir, '900', 900);
  writeSpecFile(runDir, '901', 901);
  const fakeGh = (args) => {
    if (args[0] === '--version') return 'gh version 2.0.0';
    if (isGraphqlCall(args)) return parentGraphqlResponse(parentQueryNumber(args), null);
    if (args.includes('labels,comments')) {
      // #900 passes via a trusted brief after an untrusted one; #901 has no brief at all.
      if (args.includes('900')) {
        return JSON.stringify({
          labels: [{ name: 'demo:pending' }],
          comments: [
            { body: TRUST_BRIEF_BODY, url: 'https://x/c900', author: { login: 'eve' }, authorAssociation: 'NONE' },
            { body: TRUST_BRIEF_BODY, url: 'https://x/c900b', author: { login: 'tom' }, authorAssociation: 'MEMBER' },
          ],
        });
      }
      return JSON.stringify({ labels: [{ name: 'demo:pending' }], comments: [] });
    }
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeOriginGit(), gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /#901: no comment carries a confirmed Verification Brief/);
  assert.match(row.detail, /; ignored \(#900\): skipped marker comment https:\/\/x\/c900 by eve \(NONE\)/);
  assert.ok(
    row.detail.indexOf('#901:') < row.detail.indexOf('ignored (#900)'),
    'passing-target notes follow the failing lines'
  );
});

test('an untrusted comment that carries no brief marker is not named as ignored', () => {
  const { row } = acceptanceTrustRow({
    issueComments: [{ body: 'looks good to me', url: 'https://x/c1', author: { login: 'eve' }, authorAssociation: 'NONE' }],
  });
  assert.strictEqual(row.result, 'fail');
  assert.doesNotMatch(row.detail, /ignored/);
});

// A parent gather failure caused by an unresolvable owner/repo (git remote
// missing/unparseable) is the same tooling-gap class as a GraphQL throw --
// it must also render 'unknown', never 'fail', since resolveParent never
// even reaches `deps.gh` on this path.
test('acceptance-labeling check renders unknown when owner/repo cannot be resolved from the git remote', () => {
  const runDir = makeTmpDir('verify-acceptance-noremote-');
  writeSpecFile(runDir, '900', 900);
  const fakeGh = (args) => (args[0] === '--version' ? 'gh version 2.0.0' : '');
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'unknown');
  assert.match(row.detail, /#900.*could not resolve owner\/repo/);
});

test('resolvePrNumber falls back to run-state.json one level up when absent at runDir itself (multi-spec subdir case)', () => {
  const parentDir = makeTmpDir('verify-prnum-parent-');
  fs.writeFileSync(path.join(parentDir, 'run-state.json'), JSON.stringify({ pr: { number: 1199 } }));
  const subDir = path.join(parentDir, 'spec-900');
  fs.mkdirSync(subDir);
  assert.strictEqual(resolvePrNumber(subDir), 1199);
});

test('resolvePrNumber returns null when neither runDir nor its parent has run-state.json', () => {
  const runDir = makeTmpDir('verify-prnum-none-');
  assert.strictEqual(resolvePrNumber(runDir), null);
});

test('resolvePrNumber returns null when run-state.json exists directly at runDir but carries no pr field', () => {
  const runDir = makeTmpDir('verify-prnum-nopr-');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'ok' }));
  assert.strictEqual(resolvePrNumber(runDir), null);
});

test('resolvePrNumber (#2858): a per-spec run-state.json carrying only status still finds the parent PR', () => {
  const parentDir = makeTmpDir('verify-prnum-statusonly-');
  fs.writeFileSync(path.join(parentDir, 'run-state.json'), JSON.stringify({ pr: { number: 1199 } }));
  const subDir = path.join(parentDir, 'spec-900');
  fs.mkdirSync(subDir);
  fs.writeFileSync(path.join(subDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  assert.strictEqual(resolvePrNumber(subDir), 1199);
});

test('resolvePrNumber (#2858): a per-spec pr wins over the parent pr; a null per-spec pr falls back to it', () => {
  const parentDir = makeTmpDir('verify-prnum-precedence-');
  fs.writeFileSync(path.join(parentDir, 'run-state.json'), JSON.stringify({ pr: { number: 1199 } }));
  const subDir = path.join(parentDir, 'spec-900');
  fs.mkdirSync(subDir);
  fs.writeFileSync(path.join(subDir, 'run-state.json'), JSON.stringify({ pr: { number: 42 } }));
  assert.strictEqual(resolvePrNumber(subDir), 42);
  fs.writeFileSync(path.join(subDir, 'run-state.json'), JSON.stringify({ status: 'active', pr: null }));
  assert.strictEqual(resolvePrNumber(subDir), 1199);
});

test('resolvePrNumber (#2858): a non-spec run dir with no run-state.json does not read a parent directory that happens to hold one', () => {
  const parentDir = makeTmpDir('verify-prnum-gate-');
  fs.writeFileSync(path.join(parentDir, 'run-state.json'), JSON.stringify({ pr: { number: 1199 } }));
  const subDir = path.join(parentDir, '2026-10-04T000000-record-1');
  fs.mkdirSync(subDir);
  assert.strictEqual(resolvePrNumber(subDir), null);
});

test('resolvePrNumber (#2858): a parent carrying only prExempt resolves no PR', () => {
  const parentDir = makeTmpDir('verify-prnum-exempt-');
  fs.writeFileSync(path.join(parentDir, 'run-state.json'), JSON.stringify({ prExempt: 'initial-publish' }));
  const subDir = path.join(parentDir, 'spec-900');
  fs.mkdirSync(subDir);
  fs.writeFileSync(path.join(subDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  assert.strictEqual(resolvePrNumber(subDir), null);
});

function writeExpectations(runDir, data) {
  fs.writeFileSync(path.join(runDir, 'verify-expectations.json'), JSON.stringify(data));
}

test('memory-updates check renders unknown when expectations file is absent', () => {
  const runDir = makeTmpDir('verify-memory-noexp-');
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'memory-updates');
  assert.strictEqual(row.result, 'unknown');
  assert.match(row.detail, /expectations file missing/);
});

test('memory-updates check does not throw on a verify-expectations.json containing literal null, treating it as missing', () => {
  const runDir = makeTmpDir('verify-memory-nullexp-');
  fs.writeFileSync(path.join(runDir, 'verify-expectations.json'), 'null');
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'memory-updates');
  assert.strictEqual(row.result, 'unknown');
  assert.match(row.detail, /expectations file missing/);
});

test('memory-updates check skips when expectations.memory is present but empty', () => {
  const runDir = makeTmpDir('verify-memory-empty-');
  writeExpectations(runDir, { version: 1, memory: [], upstream: [] });
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'memory-updates');
  assert.strictEqual(row.result, 'skip');
  assert.match(row.detail, /nothing recorded/);
});

test('memory-updates check passes when every recorded file and index line exist on disk', () => {
  const runDir = makeTmpDir('verify-memory-pass-');
  const memDir = makeTmpDir('verify-memory-target-');
  const memFile = path.join(memDir, 'insight.md');
  const indexFile = path.join(memDir, 'MEMORY.md');
  fs.writeFileSync(memFile, '# insight');
  fs.writeFileSync(indexFile, '- [insight](insight.md)');
  writeExpectations(runDir, { version: 1, memory: [{ file: memFile, indexFile }], upstream: [] });
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'memory-updates');
  assert.strictEqual(row.result, 'pass');
});

test('memory-updates check fails when recorded file is missing on disk', () => {
  const runDir = makeTmpDir('verify-memory-fail-');
  writeExpectations(runDir, { version: 1, memory: [{ file: '/tmp/does-not-exist-verify-900.md', indexFile: '/tmp/also-missing-900.md' }], upstream: [] });
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'memory-updates');
  assert.strictEqual(row.result, 'fail');
});

// TOCTOU hardening (record #900 whole-branch re-review, Step 3 lens 3c — both
// reproduction-pair agents independently found the same existsSync-then-read
// races). A directory in place of the expected file deterministically
// triggers the same EISDIR failure a delete-mid-read race would, without
// needing to actually race the filesystem.
test('memory-updates check fails (not throws) when the index file is a directory, not a file', () => {
  const runDir = makeTmpDir('verify-memory-toctou-');
  const memDir = makeTmpDir('verify-memory-toctou-target-');
  const memFile = path.join(memDir, 'insight.md');
  fs.writeFileSync(memFile, '# insight');
  const indexFile = path.join(memDir, 'MEMORY.md');
  fs.mkdirSync(indexFile); // a directory where readFileSync expects a file -- EISDIR
  writeExpectations(runDir, { version: 1, memory: [{ file: memFile, indexFile }], upstream: [] });
  assert.doesNotThrow(() => {
    const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'memory-updates');
    assert.strictEqual(row.result, 'fail');
    assert.match(row.detail, /index file missing/);
  });
});

test('carrier-commit resolves no issue numbers (not throws) when work/ contains an unreadable entry', () => {
  const runDir = makeTmpDir('verify-toctou-workdir-');
  const workDir = path.join(runDir, 'work');
  fs.mkdirSync(workDir, { recursive: true });
  // A directory named like a spec file -- readFileSync throws EISDIR, the
  // same failure class a mid-read prune/archive race would produce.
  fs.mkdirSync(path.join(workDir, '900-spec.md'));
  writeExpectations(runDir, { version: 1, memory: [], upstream: [] }); // no `issues` fallback either
  assert.doesNotThrow(() => {
    const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'carrier-commit');
    assert.strictEqual(row.result, 'skip', row.detail);
  });
});

test('runVerify contains a check function that throws as a fail row, never an uncaught exception', () => {
  const unregister = registerCheck('__test-throwing-check__', () => { throw new Error('boom'); });
  try {
    const runDir = makeTmpDir('verify-throwing-check-');
    const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === '__test-throwing-check__');
    assert.strictEqual(row.result, 'fail');
    assert.match(row.detail, /check threw: boom/);
    assert.strictEqual(result.exitCode, 3);
  } finally {
    unregister();
  }
});

test('expectations checks render unknown-unsupported-version for a bad version field', () => {
  const runDir = makeTmpDir('verify-badversion-');
  writeExpectations(runDir, { version: 99, memory: [], upstream: [] });
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'memory-updates');
  assert.strictEqual(row.result, 'unknown');
  assert.match(row.detail, /version 99 unsupported/);
});

test('upstream-feedback check passes via gh issue view when recorded url resolves', () => {
  const runDir = makeTmpDir('verify-upstream-pass-');
  writeExpectations(runDir, { version: 1, memory: [], upstream: [{ url: 'https://github.com/org/repo/issues/42' }] });
  const fakeGh = (args) => (args[0] === '--version' ? 'gh version 2.0.0' : JSON.stringify({ number: 42 }));
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'upstream-feedback');
  assert.strictEqual(row.result, 'pass');
});

test('worktree-removed check skips when deferred set includes worktree', () => {
  const runDir = makeTmpDir('verify-deferred-worktree-');
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], deferred: ['worktree'] });
  const fakeGit = () => { throw new Error('should not be called'); };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'worktree-removed');
  assert.strictEqual(row.result, 'skip');
  assert.match(row.detail, /deferred to parent console/);
});

test('design-caches check skips when deferred set includes design-caches', () => {
  const runDir = makeTmpDir('verify-deferred-designcaches-');
  const cacheDir = path.join(process.cwd(), 'docs', 'plans');
  fs.mkdirSync(cacheDir, { recursive: true });
  const slug = path.basename(runDir);
  const strayCache = path.join(cacheDir, `${slug}-audit.json`);
  fs.writeFileSync(strayCache, '{}');
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], deferred: ['design-caches'] });
  try {
    const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'design-caches');
    assert.strictEqual(row.result, 'skip');
    assert.match(row.detail, /deferred to parent console/);
  } finally {
    fs.rmSync(strayCache, { force: true });
  }
});

test('runVerify short-circuits to an all-unknown row set when runDir is null, never invoking check fns', () => {
  // Throwaway check scoped to this one test — name chosen so it can't collide
  // with a real check name Tasks 2-6 register ('plans-ledger', etc). Its fn
  // throws if called, proving the null-runDir guard short-circuits before
  // reaching any registered check function.
  const unregister = registerCheck('__test-null-guard-probe__', () => {
    throw new Error('check fn must not be called when runDir is null');
  });
  try {
    const result = runVerify({ runDir: null, base: 'main', deps: {} });
    // A run that could not be located at all is not a clean pass -- exit 3,
    // same as any other failing check (record #900 fix round, I3).
    assert.strictEqual(result.exitCode, 3);
    const probeRow = result.rows.find((r) => r.check === '__test-null-guard-probe__');
    assert.deepStrictEqual(probeRow, {
      check: '__test-null-guard-probe__',
      result: 'unknown',
      detail: 'run dir not found at original or archive path',
    });
  } finally {
    unregister();
  }
});

// #790/[IL-127]: wrap-up-engine.js's main() rejects any --run-dir that doesn't
// resolve under the main checkout (bin/lib/hooks/worktree-detect.js's
// isAnchoredUnderRoot) for EVERY verb, including this new `verify` one — a
// bare os.tmpdir() path like /tmp/anything never anchors, so this test uses a
// real git-fixture repo (same builder as tests/wrap-up-engine-run-dir-anchoring.test.js)
// as both cwd and the --run-dir's ancestor, matching engine-cli.test.js's
// makeRunDir() convention, so the CLI actually reaches runVerifyVerb rather
// than failing the anchoring gate first.
//
// It only asserts the CLI's plumbing (table header renders); it does not
// assert exitCode 0, because real checks run here against a synthetic,
// non-pipeline run dir — e.g. 'run-dir-archived' legitimately fails (the
// fixture dir isn't under .claude-tweaks/pipelines/), which is exitCode 3 by
// design, not a bug. realExecFileSync throws on a non-zero exit, so the
// invocation is wrapped to recover stdout from the thrown error either way.
test('wrap-up-engine.js verify prints a check table for a real, anchored run dir', () => {
  const cliPath = path.join(__dirname, '../../../plugin/bin/wrap-up-engine.js');
  const repo = gitRepo();
  const runDir = fs.mkdtempSync(path.join(repo, 'verify-rundir-'));
  let out;
  try {
    out = realExecFileSync('node', [cliPath, 'verify', '--run-dir', runDir, '--base', 'main'], {
      encoding: 'utf8', cwd: repo,
    });
  } catch (err) {
    out = err.stdout;
  }
  assert.match(out, /\| Check \| Result \| Detail \|/);
});

// #1230: defaultGit spawned execFileSync with no `timeout` option, unlike
// the adjacent defaultGh -- a hung/slow `git` invocation could block the
// wrap-up verify step indefinitely. Reload the module with a spied
// child_process.execFileSync (a fresh require.cache entry so the spy is
// captured by the module's own top-level destructure) to inspect the real
// options object each function passes, rather than asserting on source text.
test('#1230: defaultGit\'s execFileSync call carries a timeout matching defaultGh\'s', () => {
  const cp = require('node:child_process');
  const originalExecFileSync = cp.execFileSync;
  const calls = [];
  cp.execFileSync = (...args) => {
    calls.push(args);
    return '';
  };
  const modPath = require.resolve('../../../plugin/bin/lib/wrap-up/engine-verify');
  delete require.cache[modPath];
  let fresh;
  try {
    // eslint-disable-next-line global-require
    fresh = require('../../../plugin/bin/lib/wrap-up/engine-verify');
    fresh.defaultGit(['status'], '/tmp/does-not-matter');
    fresh.defaultGh(['--version'], '/tmp/does-not-matter');
  } finally {
    cp.execFileSync = originalExecFileSync;
    delete require.cache[modPath];
  }
  assert.strictEqual(calls.length, 2);
  const [gitCall, ghCall] = calls;
  assert.strictEqual(gitCall[0], 'git');
  assert.strictEqual(ghCall[0], 'gh');
  assert.notStrictEqual(gitCall[2].timeout, undefined, 'defaultGit must set a timeout option');
  assert.strictEqual(gitCall[2].timeout, ghCall[2].timeout, "defaultGit's timeout must match defaultGh's");
  assert.strictEqual(gitCall[2].timeout, 5000);
});

// ---- #1477: the eleven remaining process.cwd() sites now thread the injected
// `cwd`, not the live process.cwd() -- each test below passes a distinct
// `repoRoot` and `cwd` fixture dir and asserts the captured deps.git/deps.gh
// call carries `cwd`, mirroring plans-ledger/design-caches' own
// `statusCall.cwd, repoRoot` assertion pattern (record #1222).

test('worktree-removed check runs git worktree list against the injected cwd, not repoRoot', () => {
  const runDir = makeTmpDir('verify-cwd-worktree-removed-');
  const repoRoot = makeCleanRepoRoot();
  const cwd = makeCleanRepoRoot();
  const calls = [];
  const fakeGit = (args, callCwd) => { calls.push({ args, cwd: callCwd }); return ''; };
  try {
    runVerify({ runDir, base: 'main', repoRoot, cwd, deps: { git: fakeGit, gh: () => '' } });
    const call = calls.find((c) => c.args[0] === 'worktree');
    assert.ok(call, 'expected a git worktree list call');
    assert.strictEqual(call.cwd, cwd);
    assert.notStrictEqual(call.cwd, repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('carrier-commit check runs git log against the injected cwd, not repoRoot', () => {
  const runDir = makeTmpDir('verify-cwd-carrier-log-');
  const repoRoot = makeCleanRepoRoot();
  const cwd = makeCleanRepoRoot();
  writeSpecFile(runDir, '900', 900);
  const calls = [];
  const fakeGit = (args, callCwd) => { calls.push({ args, cwd: callCwd }); return ''; };
  try {
    runVerify({ runDir, base: 'main', repoRoot, cwd, deps: { git: fakeGit, gh: () => '' } });
    const call = calls.find((c) => c.args[0] === 'log' && c.args.includes('--format=%B'));
    assert.ok(call, 'expected a git log call for the resolved issue');
    assert.strictEqual(call.cwd, cwd);
    assert.notStrictEqual(call.cwd, repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('carrier-commit check runs gh pr view (PR-body fallback) against the injected cwd, not repoRoot', () => {
  const runDir = makeTmpDir('verify-cwd-carrier-prbody-');
  const repoRoot = makeCleanRepoRoot();
  const cwd = makeCleanRepoRoot();
  writeSpecFile(runDir, '900', 900);
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ pr: { number: 1199 } }));
  const calls = [];
  const fakeGh = (args, callCwd) => {
    calls.push({ args, cwd: callCwd });
    return JSON.stringify({ body: 'Fixes #900' });
  };
  try {
    runVerify({ runDir, base: 'main', repoRoot, cwd, deps: { git: () => '', gh: fakeGh } });
    const call = calls.find((c) => c.args[0] === 'pr' && c.args[1] === 'view');
    assert.ok(call, 'expected a gh pr view call');
    assert.strictEqual(call.cwd, cwd);
    assert.notStrictEqual(call.cwd, repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('reference-repairs check runs git log and git diff-tree against the injected cwd, not repoRoot', () => {
  const runDir = makeTmpDir('verify-cwd-refrepairs-');
  const repoRoot = makeCleanRepoRoot();
  const cwd = makeCleanRepoRoot();
  fs.writeFileSync(path.join(runDir, 'engine-state.json'), JSON.stringify({
    version: 1,
    results: { references: { findings: [{ action: 'applied', kind: 'broken-link', summary: 'fix', targetPath: 'docs/a.md' }] } },
  }));
  const calls = [];
  const fakeGit = (args, callCwd) => {
    calls.push({ args, cwd: callCwd });
    if (args[0] === 'log' && args.includes('--grep=Initiative-Fix:')) return 'def5678 Initiative-Fix: repair refs\n';
    if (args[0] === 'diff-tree' && args.includes('--name-only')) return 'docs/a.md\0';
    return '';
  };
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd, deps: { git: fakeGit, gh: () => '' } });
    // The fake returns only the applied file, NUL-terminated: a pass proves the NUL parse (splitNul), not a '\n' split.
    const row = result.rows.find((r) => r.check === 'reference-repairs');
    assert.strictEqual(row.result, 'pass');
    const logCall = calls.find((c) => c.args[0] === 'log' && c.args.includes('--grep=Initiative-Fix:'));
    const diffCall = calls.find((c) => c.args[0] === 'diff-tree');
    assert.ok(logCall, 'expected a git log call');
    assert.ok(diffCall, 'expected a git diff-tree call');
    // -z so a non-ASCII path is read raw (not C-quoted); the sha is the fake log's one line.
    assert.deepStrictEqual(diffCall.args, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--end-of-options', 'def5678 Initiative-Fix: repair refs']);
    assert.strictEqual(logCall.cwd, cwd);
    assert.strictEqual(diffCall.cwd, cwd);
    assert.notStrictEqual(logCall.cwd, repoRoot);
    assert.notStrictEqual(diffCall.cwd, repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('acceptance-labeling check runs its gh probe, issue view, and comments calls (via ghAvailable and resolveParent) against the injected cwd, not repoRoot', () => {
  const runDir = makeTmpDir('verify-cwd-acceptance-');
  const repoRoot = makeCleanRepoRoot();
  const cwd = makeCleanRepoRoot();
  writeSpecFile(runDir, '900', 900);
  const calls = [];
  const gitCalls = [];
  const fakeGit = (args, callCwd) => {
    gitCalls.push({ args, cwd: callCwd });
    return args[0] === 'remote' ? 'https://github.com/org/repo.git' : '';
  };
  const fakeGh = (args, callCwd) => {
    calls.push({ args, cwd: callCwd });
    if (args[0] === '--version') return 'gh version 2.0.0';
    if (isGraphqlCall(args)) return parentGraphqlResponse(parentQueryNumber(args), null);
    if (args.includes('labels,comments')) {
      return JSON.stringify({ labels: [{ name: 'demo:pending' }], comments: [{ body: '## Verification Brief\n### Confirmed', authorAssociation: 'MEMBER' }] });
    }
    return '{}';
  };
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd, deps: { git: fakeGit, gh: fakeGh } });
    const row = result.rows.find((r) => r.check === 'acceptance-labeling');
    assert.strictEqual(row.result, 'pass', row.detail);
    assert.ok(calls.length > 0, 'expected at least one gh call');
    for (const call of calls) {
      assert.strictEqual(call.cwd, cwd, `gh ${call.args.join(' ')} must run against the injected cwd`);
      assert.notStrictEqual(call.cwd, repoRoot);
    }
    const remoteCall = gitCalls.find((c) => c.args[0] === 'remote');
    assert.ok(remoteCall, 'expected resolveParent to resolve owner/repo via a git remote call');
    assert.strictEqual(remoteCall.cwd, cwd, 'git remote get-url must run against the injected cwd');
    assert.notStrictEqual(remoteCall.cwd, repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('upstream-feedback check runs its gh probe and issue view (via ghAvailable) against the injected cwd, not repoRoot', () => {
  const runDir = makeTmpDir('verify-cwd-upstream-');
  const repoRoot = makeCleanRepoRoot();
  const cwd = makeCleanRepoRoot();
  writeExpectations(runDir, { version: 1, memory: [], upstream: [{ url: 'https://github.com/org/repo/issues/42' }] });
  const calls = [];
  const fakeGh = (args, callCwd) => {
    calls.push({ args, cwd: callCwd });
    return args[0] === '--version' ? 'gh version 2.0.0' : JSON.stringify({ number: 42 });
  };
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd, deps: { git: () => '', gh: fakeGh } });
    const row = result.rows.find((r) => r.check === 'upstream-feedback');
    assert.strictEqual(row.result, 'pass');
    assert.ok(calls.length >= 2, 'expected the gh probe and the issue view call');
    for (const call of calls) {
      assert.strictEqual(call.cwd, cwd, `gh ${call.args.join(' ')} must run against the injected cwd`);
      assert.notStrictEqual(call.cwd, repoRoot);
    }
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('#3388: probe checks registered by earlier tests do not leak -- a clean fixture at the end of the file exits 0', () => {
  const registeredNames = () => runVerify({ runDir: null, base: 'main', deps: {} }).rows.map((r) => r.check);
  const names = registeredNames();
  for (const probe of ['__test-exitcode-probe__', '__test-throwing-check__', '__test-null-guard-probe__']) {
    assert.ok(!names.includes(probe), `${probe} leaked into later runVerify calls`);
  }
  // unregister is identity-scoped and idempotent
  const before = registeredNames();
  const unregA = registerCheck('__test-dup__', () => ({ result: 'pass', detail: 'a' }));
  const unregB = registerCheck('__test-dup__', () => ({ result: 'pass', detail: 'b' }));
  try {
    unregA();
    unregA();
    const mid = registeredNames();
    assert.deepStrictEqual(mid, [...before, '__test-dup__']);
  } finally {
    unregA();
    unregB();
  }
  assert.deepStrictEqual(registeredNames(), before);

  const runId = 'test-3388-clean-tail';
  const repoRoot = makeCleanRepoRoot();
  const runDir = path.join(repoRoot, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], deferred: ['run-dir-archival'] });
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd: repoRoot, deps: { git: () => '', gh: () => 'gh version 2.0.0' } });
    assert.deepStrictEqual(result.rows.filter((r) => r.result === 'fail'), []);
    assert.strictEqual(result.exitCode, 0);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
