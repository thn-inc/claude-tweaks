'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync: realExecFileSync } = require('node:child_process');
const { renderVerifyTable, runVerify, registerCheck, resolvePrNumber, resolveArchivedRunDir } = require('../../../plugin/bin/lib/wrap-up/engine-verify');
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
// runVerify() with a real run-dir and assert on the literal exitCode, so
// they are placed HERE -- immediately after the structural test above, and
// deliberately BEFORE 'runVerify sets exitCode 3 ... (forced-fail probe)'
// below -- rather than at the file's tail near __test-null-guard-probe__.
// That forced-fail probe permanently registers a check (via the module-level
// CHECKS array, which persists for this file's whole process) that always
// returns 'fail' with no input-dependent guard, so every runVerify() call
// with a non-null runDir anywhere later in this file's execution order would
// unconditionally report exitCode 3 -- these fixtures need a real,
// input-driven exitCode 0 for their "fixing it passes" / "no fail rows"
// assertions, so they must run before that contamination exists. Helper fns
// writeSpecFile/writeExpectations (defined further down this file) are
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

test('AC2: gh absent renders acceptance-labeling unknown, exit code reflects only checks that ran', () => {
  const runId = 'test-ac2-fixture-900';
  const originalPath = path.join(process.cwd(), '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(originalPath, { recursive: true });
  writeSpecFile(originalPath, '900', 900);
  writeExpectations(originalPath, { version: 1, memory: [], upstream: [], deferred: ['run-dir-archival'] });
  const repoRoot = makeCleanRepoRoot();
  try {
    const throwingGh = () => { throw new Error('command not found: gh'); };
    const cleanGit = (args) => (args[0] === 'log' ? 'abc1234 fix\n' : '');
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
// a real 'fail'). Placed here, before the forced-fail probe test below
// permanently registers a fail-producing check into the shared CHECKS
// registry, so this is the last point in the file where an exitCode === 0
// assertion is still meaningful (mirrors the AC2 fixture immediately above).
test('acceptance-labeling check renders unknown -- not fail -- when a parent-resolution gh call throws', () => {
  const runDir = makeTmpDir('verify-acceptance-parenterr-');
  const repoRoot = makeCleanRepoRoot();
  writeSpecFile(runDir, '900', 900);
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], deferred: ['run-dir-archival'] });
  const cleanGit = (args) => {
    if (args[0] === 'remote') return 'https://github.com/org/repo.git';
    if (args[0] === 'log' && args.some((a) => typeof a === 'string' && a.includes('Fixes #900'))) return 'abc1234 fix\n';
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
// (immediately before the AC1/AC2 fixtures) re-derives its expected exitCode
// from the same rows array runVerify just returned, so it can't distinguish
// a bug in the exitCode derivation from correct behavior. This test pins the
// literal value: force
// one check to fail and assert exitCode === 3 as a hardcoded constant, proving
// the derivation actually produces 3 for a real fail case.
test('runVerify sets exitCode 3 when any check fails (forced-fail probe)', () => {
  registerCheck('__test-exitcode-probe__', () => ({ result: 'fail', detail: 'forced' }));
  const runDir = makeTmpDir('verify-exitcode-probe-');
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
  assert.strictEqual(result.exitCode, 3);
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
    if (args[0] === 'status') return '?? docs/superpowers/plans/2099-01-01-some-topic.md\n';
    return '';
  };
  try {
    const result = runVerify({ runDir, base: 'main', repoRoot, cwd: repoRoot, deps: { git: fakeGit, gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'plans-ledger');
    assert.strictEqual(row.result, 'fail');
    assert.match(row.detail, /2099-01-01-some-topic\.md/);
    const statusCall = calls.find((c) => c.args[0] === 'status');
    // '-uall' (not the default '-uno'): a wholly-untracked directory must
    // report each file individually, never collapse to one '?? {dir}/' line
    // the suffix/name filters could never match (record #900 whole-branch
    // re-review, finding #2).
    assert.deepStrictEqual(statusCall.args, ['status', '--porcelain=v1', '-uall', '--', 'docs/superpowers/plans', 'docs/plans']);
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
    if (args[0] === 'status') return '?? docs/plans/some-topic-audit.json\n';
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
  const fakeGit = (args) => (args[0] === 'status' ? '' : '');
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
    if (args[0] === 'status' && dir === repoRoot) return '?? docs/superpowers/plans/leftover-at-reporoot.md\n';
    return '';
  };
  try {
    const result = runVerify({ runDir: '/tmp/verify-cwd-scoping-does-not-matter', base: 'main', repoRoot, cwd, deps: { git: fakeGit, gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'plans-ledger');
    assert.strictEqual(row.result, 'pass', row.detail);
    const statusCall = calls.find((c) => c.args[0] === 'status');
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
    if (args[0] === 'status' && dir === cwd) return '?? docs/plans/some-topic-audit.json\n';
    return '';
  };
  try {
    const result = runVerify({ runDir: '/tmp/verify-cwd-scoping-does-not-matter', base: 'main', repoRoot, cwd, deps: { git: fakeGit, gh: () => '' } });
    const row = result.rows.find((r) => r.check === 'design-caches');
    assert.strictEqual(row.result, 'fail', row.detail);
    assert.match(row.detail, /some-topic-audit\.json/);
    // plans-ledger (registered before design-caches) also issues a `status`
    // call in this same runVerify(), so a bare args[0] === 'status' find()
    // would silently grab its call instead -- design-caches's own status
    // call has a single `docs/plans` pathspec (5 args); plans-ledger's has
    // two pathspecs (6 args). Match on length to target design-caches alone.
    const statusCall = calls.find((c) => c.args[0] === 'status' && c.args.length === 5);
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
    fs.mkdirSync(path.join(wt, 'docs', 'superpowers', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'docs', 'superpowers', 'plans', '2026-09-02-leftover-plan.md'), '# leftover\n');
    const realGit = (args, cwd) => realExecFileSync('git', args, { cwd, encoding: 'utf8' });
    const runDir = makeTmpDir('verify-ac1-livewt-');

    // Sanity check first: the main checkout's own git status must not see
    // the worktree-local leftover at all -- proving the pre-fix repoRoot-only
    // scan really was structurally blind to it, not just untested.
    const mainStatus = realExecFileSync(
      'git', ['status', '--porcelain=v1', '-uall', '--', 'docs/superpowers/plans', 'docs/plans'],
      { cwd: main, encoding: 'utf8' },
    );
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
  const fakeGit = (args) => {
    if (args[0] === 'log' && args.some((a) => a.includes('Fixes #900'))) return 'abc1234 Fix wrap-up verify verb\n';
    return '';
  };
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
// review-console.md's step 10 now populates `issues` in this case; these tests pin the
// read side (resolvedIssueNumbers) actually consuming it, no longer dead code.

test('carrier-commit check resolves issue numbers from verify-expectations.json issues key when no materialized header exists', () => {
  const runDir = makeTmpDir('verify-carrier-expissues-pass-');
  writeExpectations(runDir, { version: 1, memory: [], upstream: [], issues: [900] });
  const fakeGit = (args) => (args.some((a) => a.includes('Fixes #900')) ? 'abc1234 Fix wrap-up verify verb\n' : '');
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
  const fakeGit = (args) => (args.some((a) => a.includes('Fixes #901')) ? 'abc1234 Fix wrap-up verify verb\n' : '');
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'carrier-commit');
  assert.strictEqual(row.result, 'pass', row.detail);
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
  const fakeGit = (args) => (args.some((a) => a === '--grep=Fixes #900') ? 'abc1234 Fix wrap-up verify verb\n' : '');
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
    if (args[0] === 'diff-tree' && args.includes('--name-only')) return 'docs/a.md\ndocs/b.md\n';
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: () => '' } });
  const row = result.rows.find((r) => r.check === 'reference-repairs');
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /docs\/b\.md/);
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
    if (args.includes('labels')) return JSON.stringify({ labels: [{ name: 'demo:pending' }] });
    if (args.includes('comments')) return JSON.stringify({ comments: [{ body: '## Verification Brief\n### Confirmed\n' }] });
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
    if (args.includes('labels')) return JSON.stringify({ labels: [] });
    return JSON.stringify({ comments: [] });
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeOriginGit(), gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'fail');
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
    if (args.includes('labels')) return JSON.stringify({ labels: [{ name: 'demo:pending' }] });
    if (args.includes('comments')) return JSON.stringify({ comments: [{ body: '## Verification Brief\n### Confirmed\n' }] });
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
    if (args.includes('labels')) return JSON.stringify({ labels: [{ name: 'demo:pending' }] });
    if (args.includes('comments')) return JSON.stringify({ comments: [{ body: '## Verification Brief\n### Confirmed\n' }] });
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeOriginGit(), gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'pass');
  const labelCalls = calls.filter((a) => a.includes('labels'));
  assert.strictEqual(labelCalls.length, 1);
  assert.strictEqual(labelCalls[0][2], '898', 'the labels check must target the parent #898, not the sub-issue #900');
  const commentCalls = calls.filter((a) => a[0] === 'issue' && a.includes('comments'));
  assert.strictEqual(commentCalls[0][2], '898', 'the comments check must target the parent #898, not the sub-issue #900');
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
    if (args.includes('labels')) return JSON.stringify({ labels: [{ name: 'demo:pending' }] });
    if (args.includes('comments')) return JSON.stringify({ comments: [{ body: '## Verification Brief\n### Confirmed\n' }] });
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeOriginGit(), gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'pass');
  const labelCalls = calls.filter((a) => a.includes('labels'));
  assert.strictEqual(labelCalls.length, 1, 'parent #898 must only be checked once despite two sub-issues resolving to it');
  const commentCalls = calls.filter((a) => a[0] === 'issue' && a.includes('comments'));
  assert.strictEqual(commentCalls.length, 1, 'parent #898 comments must only be fetched once');
  assert.strictEqual(row.detail, '');
});

test('acceptance-labeling check passes via the pr-first pointer+brief form (full brief on the PR, pointer on the issue)', () => {
  const runDir = makeTmpDir('verify-acceptance-prpointer-pass-');
  writeSpecFile(runDir, '900', 900);
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ pr: { number: 1199 } }));
  const fakeGh = (args) => {
    if (args[0] === '--version') return 'gh version 2.0.0';
    if (isGraphqlCall(args)) return parentGraphqlResponse(parentQueryNumber(args), null);
    if (args.includes('labels')) return JSON.stringify({ labels: [{ name: 'demo:pending' }] });
    if (args[0] === 'pr' && args[1] === 'view') {
      return JSON.stringify({ comments: [{ body: '<!-- run-comment: brief -->\n\n## Verification Brief\n### Confirmed\n' }] });
    }
    if (args.includes('comments')) {
      return JSON.stringify({ comments: [{ body: 'Verification Brief posted to PR #1199: https://github.com/org/repo/pull/1199' }] });
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
    if (args.includes('labels')) return JSON.stringify({ labels: [{ name: 'demo:pending' }] });
    if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ comments: [] });
    if (args.includes('comments')) {
      return JSON.stringify({ comments: [{ body: 'Verification Brief posted to PR #1199: https://github.com/org/repo/pull/1199' }] });
    }
    return '';
  };
  const result = runVerify({ runDir, base: 'main', deps: { git: fakeOriginGit(), gh: fakeGh } });
  const row = result.rows.find((r) => r.check === 'acceptance-labeling');
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /PR #1199/);
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
  registerCheck('__test-throwing-check__', () => { throw new Error('boom'); });
  const runDir = makeTmpDir('verify-throwing-check-');
  const result = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
  const row = result.rows.find((r) => r.check === '__test-throwing-check__');
  assert.strictEqual(row.result, 'fail');
  assert.match(row.detail, /check threw: boom/);
  assert.strictEqual(result.exitCode, 3);
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
  // reaching any registered check function. This registration is cumulative
  // within this process for the remainder of the file's test run (module-
  // level CHECKS array), so this test is placed LAST among the tests that
  // call runVerify directly with a non-null runDir in this file — anything
  // after it would otherwise hit this permanently-throwing probe.
  registerCheck('__test-null-guard-probe__', () => {
    throw new Error('check fn must not be called when runDir is null');
  });

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
// This test spawns a fresh subprocess, so it is immune to the null-guard
// probe registered above (module state does not cross process boundaries).
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
    const call = calls.find((c) => c.args[0] === 'log' && c.args.some((a) => a.includes('Fixes #900')));
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
    if (args[0] === 'diff-tree' && args.includes('--name-only')) return 'docs/a.md\n';
    return '';
  };
  try {
    runVerify({ runDir, base: 'main', repoRoot, cwd, deps: { git: fakeGit, gh: () => '' } });
    const logCall = calls.find((c) => c.args[0] === 'log' && c.args.includes('--grep=Initiative-Fix:'));
    const diffCall = calls.find((c) => c.args[0] === 'diff-tree');
    assert.ok(logCall, 'expected a git log call');
    assert.ok(diffCall, 'expected a git diff-tree call');
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
    if (args.includes('labels')) return JSON.stringify({ labels: [{ name: 'demo:pending' }] });
    if (args.includes('comments')) return JSON.stringify({ comments: [{ body: '## Verification Brief\n### Confirmed' }] });
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
