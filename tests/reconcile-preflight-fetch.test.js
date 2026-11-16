// tests/reconcile-preflight-fetch.test.js
// Split out of tests/reconcile.test.js; shared fixtures live in tests/helpers/reconcile-fixtures.js.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { reconcile } = require('../plugin/bin/lib/reconcile');
const { readText } = require('./helpers/read-skill');
const { STUB_SKIP, installStub } = require('./helpers/path-stub');
const {
  HOOKS,
  git,
  pairedFixture,
  freshCloneWithoutOriginHead,
  noRemoteFixture,
  writePolicyViaSeedAndPull,
  withFetchArgvLog,
} = require('./helpers/reconcile-fixtures');

// Every non-dry reconcile() pass prunes the declined-learning store (#1399), and that store resolves
// from process.cwd() to the main checkout (#4360). The in-process passes below pass `cwd: <fixture>`,
// which does not move process.cwd(), so left real they would lock and rewrite the maintainer's own
// store whenever the suite runs from a linked worktree. Stub the prune for the whole file; node --test
// gives each file its own process, and the #4180 prune test (tests/reconcile-archive-residue.test.js) installs its own counting stub on top.
require('../plugin/bin/lib/declined-learning/store').pruneDeclines = () => 0;

test('reconcile: fresh clone with no origin/HEAD repairs it and resolves the integration branch (#3132)', async () => {
  const { mainDir } = freshCloneWithoutOriginHead();
  assert.throws(() => git(['symbolic-ref', 'refs/remotes/origin/HEAD'], mainDir), 'fixture must start without origin/HEAD');

  const r = await reconcile({ cwd: mainDir, checks: ['mirror'] });

  assert.ok(!r.skipped.some((s) => s.reason === 'no-remote'), `expected no no-remote skip, got ${JSON.stringify(r.skipped)}`);
  assert.deepStrictEqual(r.skipped, [{ check: 'mirror,release,post-merge,archive,archive-branches,remote-prune,ledger-residue,console', reason: 'local-merge-model' }]);
  assert.deepStrictEqual(r.originHeadRepair, { outcome: 'repaired', branch: 'main' });
  assert.strictEqual(git(['symbolic-ref', 'refs/remotes/origin/HEAD'], mainDir).trim(), 'refs/remotes/origin/main');
});

test('reconcile: origin/HEAD repair discards a cached null for the root before re-resolving (#3132)', async () => {
  const { mainDir } = freshCloneWithoutOriginHead();
  const { mainCheckoutRoot } = require('../plugin/bin/lib/hooks/worktree-detect');
  const cache = { worktreeList: new Map(), integrationBranch: new Map([[mainCheckoutRoot(mainDir), null]]) };

  const r = await reconcile({ cwd: mainDir, checks: ['mirror'], cache });

  assert.deepStrictEqual(r.originHeadRepair, { outcome: 'repaired', branch: 'main' });
  assert.strictEqual(cache.integrationBranch.get(mainCheckoutRoot(mainDir)), 'main');
});

test('reconcile: origin configured but unreachable degrades to no-remote with a failed repair, never throws (#3132)', async () => {
  const { mainDir } = freshCloneWithoutOriginHead();
  git(['remote', 'set-url', 'origin', path.join(os.tmpdir(), 'ct-recon-missing-origin-does-not-exist')], mainDir);

  const r = await reconcile({ cwd: mainDir, checks: ['mirror'] });

  assert.deepStrictEqual(r.skipped, [{ check: 'all', reason: 'no-remote' }]);
  assert.strictEqual(r.originHeadRepair.outcome, 'failed');
  // git's own first stderr line, not just git-exec's coarse `git-error` class.
  assert.match(r.originHeadRepair.reason, /^fatal: /);
});

test('repairOriginHead: a thrown failure is remembered the same as a classified one (#3132)', () => {
  const { repairOriginHead } = require('../plugin/bin/lib/reconcile/origin-head');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-oh-throw-'));
  let setHeadCalls = 0;
  const runGit = (args) => {
    if (args[1] === 'get-url') return { stdout: 'https://example.invalid/r.git', failure: null, stderr: null };
    setHeadCalls += 1;
    throw new Error('simulated throw');
  };

  const first = repairOriginHead(root, { runGit, now: 1000 });
  assert.deepStrictEqual(first, { outcome: 'failed', reason: 'simulated throw' });
  const second = repairOriginHead(root, { runGit, now: 2000 });
  assert.deepStrictEqual(second, { outcome: 'skipped', reason: 'recent-failure' });
  assert.strictEqual(setHeadCalls, 1, 'a thrown set-head must not be retried within the TTL');
});

test('reconcile: an unreachable origin remembers the failure and skips retrying on the next pass (#3132)', async () => {
  const { mainDir } = freshCloneWithoutOriginHead();
  git(['remote', 'set-url', 'origin', path.join(os.tmpdir(), 'ct-recon-missing-origin-does-not-exist-retry')], mainDir);
  const { readCache } = require('../plugin/bin/lib/reconcile/cache');
  const { mainCheckoutRoot } = require('../plugin/bin/lib/hooks/worktree-detect');
  const root = mainCheckoutRoot(mainDir);

  const first = await reconcile({ cwd: mainDir, checks: ['mirror'] });
  assert.strictEqual(first.originHeadRepair.outcome, 'failed');
  assert.strictEqual(typeof readCache(root).lastOriginHeadRepairFailedAt, 'number');

  const second = await reconcile({ cwd: mainDir, checks: ['mirror'] });
  assert.deepStrictEqual(second.originHeadRepair, { outcome: 'skipped', reason: 'recent-failure' });
  assert.deepStrictEqual(second.skipped, [{ check: 'all', reason: 'no-remote' }]);
});

test('reconcile: the failure stamp survives an unrelated cache write (#3132)', async () => {
  const { mainDir } = freshCloneWithoutOriginHead();
  git(['remote', 'set-url', 'origin', path.join(os.tmpdir(), 'ct-recon-missing-origin-does-not-exist-survive')], mainDir);
  const { readCache, writeCache } = require('../plugin/bin/lib/reconcile/cache');
  const { mainCheckoutRoot } = require('../plugin/bin/lib/hooks/worktree-detect');
  const root = mainCheckoutRoot(mainDir);

  const r = await reconcile({ cwd: mainDir, checks: ['mirror'] });
  assert.strictEqual(r.originHeadRepair.outcome, 'failed');
  assert.strictEqual(typeof readCache(root).lastOriginHeadRepairFailedAt, 'number');

  writeCache(root, { ...readCache(root), claimShas: { 1: 'x' } });

  assert.strictEqual(typeof readCache(root).lastOriginHeadRepairFailedAt, 'number');
});

test('reconcile: a concurrent-winner origin/HEAD still resolves even under a recent-failure skip (#3132)', async () => {
  const { mainDir } = freshCloneWithoutOriginHead();
  const { writeCache } = require('../plugin/bin/lib/reconcile/cache');
  const { mainCheckoutRoot } = require('../plugin/bin/lib/hooks/worktree-detect');
  const root = mainCheckoutRoot(mainDir);
  writeCache(root, { lastOriginHeadRepairFailedAt: Date.now() });
  // Simulate the caller's resolver cache still holding this root's null
  // from an earlier call in the same process — the gap a real concurrent
  // winner fills between that earlier resolve and this one's repair.
  const cache = { worktreeList: new Map(), integrationBranch: new Map([[root, null]]) };
  git(['remote', 'set-head', 'origin', 'main'], mainDir);

  const r = await reconcile({ cwd: mainDir, checks: ['mirror'], cache });

  assert.deepStrictEqual(r.originHeadRepair, { outcome: 'skipped', reason: 'recent-failure', branch: 'main' });
  assert.deepStrictEqual(r.skipped, [{ check: 'mirror,release,post-merge,archive,archive-branches,remote-prune,ledger-residue,console', reason: 'local-merge-model' }]);
});

test('reconcile: no origin remote keeps the no-remote skip unchanged and attempts no repair (#3132)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-noorigin-'));
  git(['init', '-q'], dir);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');

  const r = await reconcile({ cwd: dir });

  assert.deepStrictEqual(r.skipped, [{ check: 'all', reason: 'no-remote' }]);
  assert.ok(!('originHeadRepair' in r), 'no origin remote must not attempt (or report) a repair');
});

test('reconcile: a policy-configured integration branch never triggers the origin/HEAD repair (#3132)', async () => {
  const { mainDir } = freshCloneWithoutOriginHead();
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: local-merge\nintegration-branch: main\n');

  const r = await reconcile({ cwd: mainDir, checks: ['mirror'] });

  assert.ok(!('originHeadRepair' in r));
  assert.throws(() => git(['symbolic-ref', 'refs/remotes/origin/HEAD'], mainDir), 'repair must not run when policy already resolves the branch');
});

test('resolveIntegrationBranch stays offline: no fetch, ls-remote, or remote set-head in worktree-reap.js (#3132)', () => {
  const src = readText(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'worktree-reap.js'));
  const start = src.indexOf('function resolveIntegrationBranch(');
  assert.ok(start >= 0, 'resolveIntegrationBranch not found');
  const end = src.indexOf('\n}\n', start);
  const body = src.slice(start, end);
  for (const verb of ["'fetch'", "'ls-remote'", "'set-head'"]) {
    assert.ok(!body.includes(verb), `resolveIntegrationBranch must stay offline — found ${verb}`);
  }
});

test('reconcile(): returns a thenable (async contract) even when every check stays synchronous internally', async () => {
  const { originDir, mainDir } = pairedFixture();
  git(['remote', 'set-url', 'origin', 'https://example.invalid/nope.git'], mainDir); // no gh reachable, exercised as local-merge below is enough
  const p = reconcile({ cwd: mainDir, checks: ['mirror'] });
  assert.equal(typeof p.then, 'function', 'reconcile() must return a Promise');
  const r = await p;
  assert.equal(typeof r, 'object');
  void originDir;
});

// --- preflight (#820): one upfront gh-health check gates the whole set ---

// #1558: reconcile() must forward its own `mcpReachable` option into
// integration-model resolution (the same deps-seam bin/resolve-policy.js's
// --mcp-reachable flag already threads into detectIntegrationModel), rather
// than resolving bare and silently downgrading to local-merge in a
// gh-absent-but-MCP-reachable sandbox. Uses the injectable
// `opts.resolveIntegrationModel` seam (test-only, mirrors the pattern
// pre-tool-use.js's own `deps.resolveIntegrationModel` override already
// uses) rather than a real gh-absent fixture, which would be fragile and
// environment-dependent.
test('reconcile(): forwards opts.mcpReachable into resolveIntegrationModel (#1558)', async () => {
  const { mainDir } = pairedFixture();
  const calls = [];
  const fakeResolveIntegrationModel = (root, opts) => {
    calls.push(opts);
    return opts && opts.mcpReachable ? 'pr-first' : 'local-merge';
  };
  await reconcile({ cwd: mainDir, resolveIntegrationModel: fakeResolveIntegrationModel, mcpReachable: true });
  await reconcile({ cwd: mainDir, resolveIntegrationModel: fakeResolveIntegrationModel });
  assert.deepStrictEqual(calls, [{ mcpReachable: true }, { mcpReachable: false }]);
});

// #4578 Decision Q1: a hook-context caller (SessionStart) passes
// `forgeProbeTimeoutMs`; reconcile() forwards it as `timeoutMs` ONLY when set,
// so the callers that never set it (the CLI verb, the background pass) keep
// the exact `{ mcpReachable }` shape the #1558 test above pins.
test('reconcile(): forwards opts.forgeProbeTimeoutMs into resolveIntegrationModel as timeoutMs, and only when set (#4578 AC11.1)', async () => {
  const { mainDir } = pairedFixture();
  const calls = [];
  const fakeResolveIntegrationModel = (root, opts) => {
    calls.push(opts);
    return 'local-merge';
  };
  await reconcile({ cwd: mainDir, resolveIntegrationModel: fakeResolveIntegrationModel, forgeProbeTimeoutMs: 5000 });
  await reconcile({ cwd: mainDir, resolveIntegrationModel: fakeResolveIntegrationModel });
  assert.deepStrictEqual(calls, [{ mcpReachable: false, timeoutMs: 5000 }, { mcpReachable: false }]);
  assert.ok(!('timeoutMs' in calls[1]), 'an unset forgeProbeTimeoutMs must add no timeoutMs key at all');
});

test('reconcile(): a failing GitHub-health preflight skips every requested check in one entry, never per-check timeouts (D1)', async () => {
  const { seedDir, mainDir } = pairedFixture();
  // pairedFixture()'s origin is a bare local repo, not a GitHub remote, so
  // resolveIntegrationModel's forge-detection fallback would otherwise land
  // on local-merge (no gh-backed repo to detect) — force pr-first explicitly
  // so this test actually reaches the preflight, per the same pattern used
  // above at policy.yml: 'integration-model: pr-first\n'.
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n');

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const original = preflight.ghHealthCheck;
  const originalAsync = preflight.ghHealthCheckAsync;
  preflight.ghHealthCheck = () => ({ ok: false, reason: 'github-unreachable' });
  // checks: ['mirror', 'release'] is the FAST_CHECKS shape (mirror,
  // remote-prune not requested, #872) — reconcile() runs the preflight via
  // ghHealthCheckAsync (concurrently with the shared fetch), not the sync
  // ghHealthCheck above, so both must be stubbed or the async twin would
  // reach a real `gh` call.
  preflight.ghHealthCheckAsync = async () => ({ ok: false, reason: 'github-unreachable' });
  try {
    const r = await reconcile({ cwd: mainDir, checks: ['mirror', 'release'] });
    // mirror is pure git (mirror-ff.js never shells to `gh`) and is
    // deliberately excluded from the preflight gate — it still runs despite
    // a failing GitHub-health check, and pairedFixture()'s mainDir is a
    // fresh clone already current with origin (review finding: this gate
    // previously skipped mirror too).
    assert.deepEqual(r.mirror, { state: 'current', action: 'none' });
    assert.equal(r.claims, null);
    assert.deepEqual(r.skipped, [{ check: 'release', reason: 'preflight-github-unreachable' }]);
  } finally {
    preflight.ghHealthCheck = original;
    preflight.ghHealthCheckAsync = originalAsync;
  }
});

test('reconcile(): checks: ["mirror"] alone never calls the GitHub-health preflight at all', async () => {
  const { seedDir, mainDir } = pairedFixture();
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n');

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const original = preflight.ghHealthCheck;
  let called = false;
  preflight.ghHealthCheck = () => { called = true; return { ok: false, reason: 'github-unreachable' }; };
  try {
    const r = await reconcile({ cwd: mainDir, checks: ['mirror'] });
    assert.deepEqual(r.mirror, { state: 'current', action: 'none' });
    assert.deepEqual(r.skipped, []);
    assert.equal(called, false, 'a mirror-only request has no gh-dependent check, so preflight must never run');
  } finally {
    preflight.ghHealthCheck = original;
  }
});

// #873: session-start.js's inline FAST_CHECKS call and the detached
// reconcile-background child it spawns moments later each independently ran
// their own GitHub-health preflight. A recent sibling success should let a
// second reconcile() call skip re-probing.
test('reconcile(): reuses a very-recent successful health-check stamp instead of re-probing GitHub (#873)', async () => {
  const { seedDir, mainDir } = pairedFixture();
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n');

  const { writeCache } = require('../plugin/bin/lib/reconcile/cache');
  const root = require('../plugin/bin/lib/hooks/worktree-detect').mainCheckoutRoot(mainDir);
  // Simulate a sibling process's health check having just succeeded.
  writeCache(root, { lastHealthCheckOkAt: Date.now() });

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  const originalHealthAsync = preflight.ghHealthCheckAsync;
  let called = false;
  preflight.ghHealthCheck = () => { called = true; return { ok: false, reason: 'github-unreachable' }; };
  preflight.ghHealthCheckAsync = async () => { called = true; return { ok: false, reason: 'github-unreachable' }; };
  try {
    // 'release' alone (no mirror/remote-prune) is gh-dependent but not the
    // FAST_CHECKS shape — exercises the sequential (non-Promise.all) branch.
    // releaseMerged() itself still attempts a real `gh` call downstream (this
    // fixture has no network/gh reachable), so `r.skipped` may legitimately
    // carry its own unrelated failure — only the preflight-specific skip
    // reason must never appear.
    const r = await reconcile({ cwd: mainDir, checks: ['release'] });
    assert.equal(called, false, 'a fresh health-check stamp must skip both the sync and async preflight calls');
    assert.ok(
      !r.skipped.some((s) => typeof s.reason === 'string' && s.reason.startsWith('preflight-')),
      `the reused-fresh preflight must not itself appear as a skip reason: ${JSON.stringify(r.skipped)}`,
    );
  } finally {
    preflight.ghHealthCheck = originalHealth;
    preflight.ghHealthCheckAsync = originalHealthAsync;
  }
});

test('reconcile(): a real successful preflight stamps lastHealthCheckOkAt for a sibling process to reuse', async () => {
  const { seedDir, mainDir } = pairedFixture();
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n');

  const { readCache } = require('../plugin/bin/lib/reconcile/cache');
  const root = require('../plugin/bin/lib/hooks/worktree-detect').mainCheckoutRoot(mainDir);
  assert.equal(readCache(root).lastHealthCheckOkAt, null, 'precondition: no prior stamp');

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  const before = Date.now();
  try {
    await reconcile({ cwd: mainDir, checks: ['release'] });
  } finally {
    preflight.ghHealthCheck = originalHealth;
  }
  const stamped = readCache(root).lastHealthCheckOkAt;
  assert.equal(typeof stamped, 'number');
  assert.ok(stamped >= before, 'stamp must be set at (or after) this pass, not stale');
});

// #2505 — reconcile()'s own archive+reap dispatch must share ONE issue-list
// cache instance across both checks in the same pass. Exercised at the
// module-wiring level (a spy on issue-list-cache.js's own
// createIssueListCache, confirming it is called exactly once per
// reconcile() invocation, and that the SAME returned runner reaches both
// archiveMerged and reapMerged) rather than by re-deriving N-stuck-dir
// git/gh fixtures here — Task 3/4's own tests already prove the runner,
// once received, is forwarded correctly through every call site in each
// module; this test's only job is proving index.js creates and shares
// exactly one instance.
test('reconcile(): creates exactly one issue-list cache per pass and passes its runner to both archiveMerged and reapMerged', async () => {
  const issueListCache = require('../plugin/bin/lib/reconcile/issue-list-cache');
  const archiveMergedModule = require('../plugin/bin/lib/reconcile/archive-merged');
  const reapMergedModule = require('../plugin/bin/lib/reconcile/reap-merged');
  const preflight = require('../plugin/bin/lib/reconcile/preflight');

  const originalCreate = issueListCache.createIssueListCache;
  const originalArchive = archiveMergedModule.archiveMerged;
  const originalReap = reapMergedModule.reapMerged;
  const originalHealth = preflight.ghHealthCheck;
  const originalHealthAsync = preflight.ghHealthCheckAsync;

  let createCalls = 0;
  const fakeRunner = () => '[]';
  issueListCache.createIssueListCache = (...args) => {
    createCalls += 1;
    return { runner: fakeRunner };
  };
  let archiveRunnerSeen;
  let reapRunnerSeen;
  archiveMergedModule.archiveMerged = (opts) => {
    archiveRunnerSeen = opts.runner;
    return { archived: [], skipped: [] };
  };
  reapMergedModule.reapMerged = (opts) => {
    reapRunnerSeen = opts.runner;
    return { reaped: [], skipped: [], portsRelease: [] };
  };
  // 'archive'/'reap' are both gh-dependent checks, so reconcile()'s own
  // GitHub-health preflight would otherwise run a real `gh api rate_limit`
  // call here (expandChecks turns ['archive', 'reap'] into ['mirror',
  // 'archive', 'reap'] (#3630), so the concurrent fastChecksShape path runs
  // the async ghHealthCheckAsync). Stub both the sync and async forms — mirroring the existing
  // preflight-stub idiom elsewhere in this file (e.g. the red-tip/
  // FAST_CHECKS tests above) — so this test stays hermetic and never
  // depends on live gh auth/network; an unstubbed preflight failure would
  // filter `checks` down to nothing and skip the archive/reap dispatch
  // entirely, failing this test for the wrong reason.
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  preflight.ghHealthCheckAsync = async () => ({ ok: true, reason: null });

  try {
    // Rebuild index.js's own top-level requires against the monkeypatched
    // modules by clearing its module cache entry first — index.js
    // destructures archiveMerged/reapMerged/createIssueListCache at
    // require-time, so a patch applied AFTER index.js has already been
    // required elsewhere in this suite would not be seen without this.
    delete require.cache[require.resolve('../plugin/bin/lib/reconcile/index')];
    const { reconcile: reconcileFresh } = require('../plugin/bin/lib/reconcile/index');
    // A real origin + clone (pairedFixture), not a bare `git init` — before
    // reconcile() ever reaches the archive/reap dispatch (or the
    // cache-creation line just above it), it resolves `integration` from
    // `origin/HEAD`; a repo with no remote at all trips the earlier
    // 'no-remote' skip instead (see the 'checks filter excludes reap' test
    // above for the same fixture-shape requirement).
    const { mainDir } = pairedFixture();

    await reconcileFresh({
      cwd: mainDir,
      checks: ['archive', 'reap'],
      resolveIntegrationModel: () => 'pr-first',
      mcpReachable: true,
    });

    assert.equal(createCalls, 1, 'exactly one cache must be created per reconcile() pass');
    assert.equal(archiveRunnerSeen, fakeRunner, 'archiveMerged must receive the shared cache runner');
    assert.equal(reapRunnerSeen, fakeRunner, 'reapMerged must receive the same shared cache runner');
  } finally {
    issueListCache.createIssueListCache = originalCreate;
    archiveMergedModule.archiveMerged = originalArchive;
    reapMergedModule.reapMerged = originalReap;
    preflight.ghHealthCheck = originalHealth;
    preflight.ghHealthCheckAsync = originalHealthAsync;
    delete require.cache[require.resolve('../plugin/bin/lib/reconcile/index')];
  }
});

// #4032 — reconcile() hands archiveMerged one run-integrity cache per pass (the
// caller's own when it passed one, as session-start does), so the archive loop
// and its per-dir checkRunIntegrity calls list worktrees once. Same module-wiring
// level as the issue-list-cache test above; the spawn count itself is proven in
// bin-lib/reconcile/archive-merged-record-guards.test.js. reapMerged must NOT get it: reap removes worktrees.
test('reconcile(): passes one run-integrity cache per pass to archiveMerged — the caller\'s own when given, never to reapMerged (#4032)', async () => {
  const archiveMergedModule = require('../plugin/bin/lib/reconcile/archive-merged');
  const reapMergedModule = require('../plugin/bin/lib/reconcile/reap-merged');
  const preflight = require('../plugin/bin/lib/reconcile/preflight');

  const originalArchive = archiveMergedModule.archiveMerged;
  const originalReap = reapMergedModule.reapMerged;
  const originalHealth = preflight.ghHealthCheck;
  const originalHealthAsync = preflight.ghHealthCheckAsync;

  const archiveCaches = [];
  let reapOpts;
  archiveMergedModule.archiveMerged = (opts) => {
    archiveCaches.push(opts.cache);
    return { archived: [], skipped: [] };
  };
  reapMergedModule.reapMerged = (opts) => {
    reapOpts = opts;
    return { reaped: [], skipped: [], portsRelease: [] };
  };
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  preflight.ghHealthCheckAsync = async () => ({ ok: true, reason: null });

  try {
    delete require.cache[require.resolve('../plugin/bin/lib/reconcile/index')];
    const { reconcile: reconcileFresh } = require('../plugin/bin/lib/reconcile/index');
    const { mainDir } = pairedFixture();
    const run = (extra = {}) => reconcileFresh({
      cwd: mainDir, checks: ['archive', 'reap'], resolveIntegrationModel: () => 'pr-first', mcpReachable: true, ...extra,
    });

    await run();
    await run();
    const [first, second] = archiveCaches;
    for (const c of [first, second]) {
      assert.ok(c && c.worktreeList instanceof Map && c.integrationBranch instanceof Map, 'archiveMerged must receive a run-integrity-shaped cache');
    }
    assert.notEqual(first, second, 'each pass gets its own cache — nothing survives across passes');

    const callerCache = { worktreeList: new Map(), integrationBranch: new Map() };
    await run({ cache: callerCache });
    assert.equal(archiveCaches[2], callerCache, 'a caller-supplied cache is used, not replaced');
    assert.ok(!('cache' in reapOpts), 'reapMerged must not share the worktree-list cache');
  } finally {
    archiveMergedModule.archiveMerged = originalArchive;
    reapMergedModule.reapMerged = originalReap;
    preflight.ghHealthCheck = originalHealth;
    preflight.ghHealthCheckAsync = originalHealthAsync;
    delete require.cache[require.resolve('../plugin/bin/lib/reconcile/index')];
  }
});

// #820 Task 10's exact regression shape, re-applied to this new mechanism: a
// `lastRunAt` stamp from an unrelated pass must never be misread as preflight
// freshness — the two fields are deliberately independent (cache.js's own
// `isFresh(cache, now, ttl, field)` generalization), so a stamp that only
// proves "some pass finished" can never silently starve a real health check.
test('reconcile(): a lastRunAt stamp alone (no lastHealthCheckOkAt) never substitutes for preflight freshness', async () => {
  const { seedDir, mainDir } = pairedFixture();
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n');

  const { writeCache } = require('../plugin/bin/lib/reconcile/cache');
  const root = require('../plugin/bin/lib/hooks/worktree-detect').mainCheckoutRoot(mainDir);
  writeCache(root, { lastRunAt: Date.now() }); // no lastHealthCheckOkAt

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  let called = false;
  preflight.ghHealthCheck = () => { called = true; return { ok: true, reason: null }; };
  try {
    await reconcile({ cwd: mainDir, checks: ['release'] });
    assert.equal(called, true, 'a lastRunAt-only stamp must never be read as health-check freshness');
  } finally {
    preflight.ghHealthCheck = originalHealth;
  }
});

// --- wall-clock budget (#820): an exhausted budget skips the remainder ---

test('reconcile(): an exhausted wall-clock budget skips every remaining check in one entry (D4)', async () => {
  const { mainDir } = pairedFixture();
  // Same forcing as the preflight test above: pairedFixture()'s origin is a
  // bare local repo, not a real GitHub remote, so resolveIntegrationModel's
  // detectIntegrationModel fallback resolves to local-merge and short-
  // circuits before the budget is ever created. Force pr-first explicitly so
  // this test actually reaches the budget guards.
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');

  // Must clear the preflight gate before the budget guard is even reached —
  // stub it to succeed rather than depending on a real `gh` call reaching
  // GitHub, which the test environment cannot guarantee.
  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  const originalHealthAsync = preflight.ghHealthCheckAsync;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  // checks: ['mirror', 'red-tip'] is the FAST_CHECKS shape (#872) —
  // reconcile() runs the preflight via ghHealthCheckAsync (concurrently
  // with the shared fetch) for this shape, not the sync ghHealthCheck
  // stubbed above, so both must be stubbed to avoid a real `gh` call.
  preflight.ghHealthCheckAsync = async () => ({ ok: true, reason: null });

  const budgetMod = require('../plugin/bin/lib/reconcile/budget');
  const original = budgetMod.createBudget;
  budgetMod.createBudget = () => ({ exceeded: () => true, remainingMs: () => 0 });
  try {
    const r = await reconcile({ cwd: mainDir, checks: ['mirror', 'red-tip'] });
    assert.deepEqual(r.skipped, [{ check: 'mirror,red-tip', reason: 'budget-exceeded' }]);
  } finally {
    budgetMod.createBudget = original;
    preflight.ghHealthCheck = originalHealth;
    preflight.ghHealthCheckAsync = originalHealthAsync;
  }
});

// --- opts.budgetMs override (#3026): an explicit --checks subset runs unbounded ---

// Shared forcing for the budgetMs tests: same pr-first policy + preflight
// stubs as the D4 test above, plus a createBudget stub that records its
// argument and reports "exceeded" for any finite ceiling.
async function withRecordedBudget(fn) {
  const { mainDir } = pairedFixture();
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  const originalHealthAsync = preflight.ghHealthCheckAsync;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  preflight.ghHealthCheckAsync = async () => ({ ok: true, reason: null });
  const budgetMod = require('../plugin/bin/lib/reconcile/budget');
  const original = budgetMod.createBudget;
  const seen = [];
  budgetMod.createBudget = (ms) => {
    seen.push(ms);
    return { exceeded: () => ms !== Infinity, remainingMs: () => 0 };
  };
  try {
    await fn({ mainDir, seen });
  } finally {
    budgetMod.createBudget = original;
    preflight.ghHealthCheck = originalHealth;
    preflight.ghHealthCheckAsync = originalHealthAsync;
  }
}

test('AC1.1: reconcile(): opts.budgetMs reaches createBudget, so an unbounded explicit subset is never budget-skipped', async () => {
  await withRecordedBudget(async ({ mainDir, seen }) => {
    const r = await reconcile({ cwd: mainDir, checks: ['mirror', 'red-tip'], budgetMs: Infinity });
    assert.deepEqual(seen, [Infinity]);
    assert.equal(
      (r.skipped || []).some((s) => s.reason === 'budget-exceeded'),
      false,
      'an Infinity budget must never skip a check as budget-exceeded',
    );
  });
});

test('AC2.1: reconcile(): no opts.budgetMs passes undefined to createBudget, so the 18 s default applies', async () => {
  await withRecordedBudget(async ({ mainDir, seen }) => {
    const r = await reconcile({ cwd: mainDir, checks: ['mirror', 'red-tip'] });
    assert.deepEqual(seen, [undefined]);
    assert.deepEqual(r.skipped, [{ check: 'mirror,red-tip', reason: 'budget-exceeded' }]);
    assert.equal(require('../plugin/bin/lib/reconcile/budget').DEFAULT_BUDGET_MS, 18000);
  });
});

test('an over-budget early return still persists the PR answers the pass learned (#4032)', async () => {
  await withRecordedBudget(async ({ mainDir }) => {
    const prStateCache = require('../plugin/bin/lib/reconcile/pr-state-cache');
    const original = prStateCache.createPrStateResolver;
    let persisted = 0;
    prStateCache.createPrStateResolver = () => ({ persist: () => { persisted += 1; } });
    try {
      const r = await reconcile({ cwd: mainDir, checks: ['mirror', 'red-tip'] });
      assert.deepEqual(r.skipped, [{ check: 'mirror,red-tip', reason: 'budget-exceeded' }], 'the pass returned early, before finalize');
      assert.equal(persisted, 1, 'the early return persisted the resolver instead of dropping its answers');
    } finally {
      prStateCache.createPrStateResolver = original;
    }
  });
});

// --- shared fetch (#820 D2): mirror and remote-prune merge into one fetch ---

test('reconcile(): mirror and remote-prune share one fetch, not two (D2)', { skip: STUB_SKIP }, async () => {
  const { mainDir } = pairedFixture();
  // Same forcing as the preflight/budget tests above: pairedFixture()'s
  // origin is a bare local repo, not a real GitHub remote. Committed (not
  // left as an untracked file) — unlike the preflight/budget tests, THIS
  // test needs classifyMirror to actually reach its fetch call (not bail
  // out early on `state: 'dirty'`), so `git status --porcelain` in mainDir
  // must read clean.
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  git(['add', '.claude-tweaks/policy.yml'], mainDir);
  git(['commit', '-q', '-m', 'policy'], mainDir);

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });

  // NOT counted via a `gitExec.runGit = stub` swap: classify.js,
  // prune-remote.js, and shared-fetch.js each do
  // `const { runGit } = require('../hooks/git-exec')` once at module load,
  // which copies the function VALUE into a local const at that instant.
  // Reassigning `gitExec.runGit` afterward only changes what a fresh
  // `require('../hooks/git-exec').runGit` property lookup returns — every
  // already-bound local `runGit` inside those three modules keeps pointing
  // at the original function, so a stub swap silently never fires and the
  // count would read 0 (or pass by accident), not discriminate the merge.
  // (Verified empirically with a throwaway destructure/mutate/call repro:
  // the destructured binding never observed the module.exports reassignment.)
  // Counting at the process-spawn boundary instead — a `git` executable
  // placed first on PATH — needs no assumption about any module's import
  // style and observes every real `git fetch` invocation.
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-gitwrap-'));
  const logFile = path.join(logDir, 'fetch-calls.log');
  fs.writeFileSync(logFile, '');
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  // git-exec.js always calls execFileSync('git', ['-C', cwd, ...args]) — the
  // real subcommand (fetch, status, rev-list, ...) is always positional $3.
  const restore = installStub(
    'git',
    `#!/bin/sh\nif [ "$3" = "fetch" ]; then\n  echo x >> "${logFile}"\nfi\nexec "${realGit}" "$@"\n`,
  );
  let r;
  try {
    r = await reconcile({ cwd: mainDir, checks: ['mirror', 'remote-prune'] });
  } finally {
    restore();
    preflight.ghHealthCheck = originalHealth;
  }

  assert.deepEqual(r.skipped, [], `expected no skipped entries, saw ${JSON.stringify(r.skipped)}`);
  const fetchCalls = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length;
  assert.equal(fetchCalls, 1, `expected exactly one fetch, saw ${fetchCalls}`);
});

// --- shared fetch: shape scoped to the requested checks (#820 final review) ---
//
// FAST_CHECKS (mirror) and BACKGROUND_CHECKS (remote-prune) are provably
// disjoint, so each process must pay only for the fetch its own checks need:
// a narrow single-ref fetch under mirror's tight hot-path cap, or the broad
// `--prune` all-refs fetch on git-exec's own env-overridable budget.

test('sharedFetch: a mirror-only pass fetches the single integration ref, never --prune all-refs', { skip: STUB_SKIP }, async () => {
  const { mainDir } = pairedFixture();
  const { sharedFetch } = require('../plugin/bin/lib/reconcile/shared-fetch');
  const calls = await withFetchArgvLog(() => {
    const r = sharedFetch(mainDir, { integration: 'main', mirror: true, remotePrune: false });
    assert.equal(r.failure, null, 'the narrow fetch must succeed against the local bare origin');
  });
  assert.equal(calls.length, 1, `expected exactly one fetch, saw ${JSON.stringify(calls)}`);
  assert.match(calls[0], /fetch origin main$/, `mirror-only must fetch a single ref, saw: ${calls[0]}`);
  assert.doesNotMatch(calls[0], /--prune/, 'mirror-only must not pay for a --prune all-refs fetch');
});

// sharedFetchAsync (#872) — the mirror-only async twin dispatched
// concurrently with ghHealthCheckAsync in reconcile/index.js's FAST_CHECKS
// shape. Same fetch shape as sharedFetch's mirror-only branch above, just
// non-blocking.

test('sharedFetchAsync: fetches the single integration ref, never --prune all-refs', { skip: STUB_SKIP }, async () => {
  const { mainDir } = pairedFixture();
  const { sharedFetchAsync } = require('../plugin/bin/lib/reconcile/shared-fetch');
  let r;
  const calls = await withFetchArgvLog(async () => {
    r = await sharedFetchAsync(mainDir, { integration: 'main' });
    assert.equal(r.failure, null, 'the narrow fetch must succeed against the local bare origin');
  });
  assert.equal(calls.length, 1, `expected exactly one fetch, saw ${JSON.stringify(calls)}`);
  assert.match(calls[0], /fetch origin main$/, `mirror-only must fetch a single ref, saw: ${calls[0]}`);
  assert.doesNotMatch(calls[0], /--prune/, 'mirror-only must not pay for a --prune all-refs fetch');
});

test('sharedFetchAsync: pins its own tight hot-path timeout — CT_HOOKS_GIT_TIMEOUT_MS cannot shrink it', async () => {
  const { mainDir } = pairedFixture();
  const { sharedFetchAsync } = require('../plugin/bin/lib/reconcile/shared-fetch');
  const original = process.env.CT_HOOKS_GIT_TIMEOUT_MS;
  process.env.CT_HOOKS_GIT_TIMEOUT_MS = '1';
  try {
    const r = await sharedFetchAsync(mainDir, { integration: 'main' });
    assert.equal(r.failure, null, 'the mirror shape must carry an explicit timeoutMs, which git-exec resolves ahead of the env override');
  } finally {
    if (original === undefined) delete process.env.CT_HOOKS_GIT_TIMEOUT_MS;
    else process.env.CT_HOOKS_GIT_TIMEOUT_MS = original;
  }
});

test('sharedFetch: a remote-prune pass still fetches --prune all-refs', { skip: STUB_SKIP }, async () => {
  const { mainDir } = pairedFixture();
  const { sharedFetch } = require('../plugin/bin/lib/reconcile/shared-fetch');
  const calls = await withFetchArgvLog(() => {
    sharedFetch(mainDir, { integration: 'main', mirror: false, remotePrune: true });
  });
  assert.equal(calls.length, 1, `expected exactly one fetch, saw ${JSON.stringify(calls)}`);
  assert.match(calls[0], /fetch --prune origin$/, `remote-prune must keep the --prune all-refs shape, saw: ${calls[0]}`);
});

test('sharedFetch: mirror + remote-prune together fall back to the broader --prune shape (superset serves both)', { skip: STUB_SKIP }, async () => {
  const { mainDir } = pairedFixture();
  const { sharedFetch } = require('../plugin/bin/lib/reconcile/shared-fetch');
  const calls = await withFetchArgvLog(() => {
    sharedFetch(mainDir, { integration: 'main', mirror: true, remotePrune: true });
  });
  assert.equal(calls.length, 1, `expected exactly one fetch, saw ${JSON.stringify(calls)}`);
  assert.match(calls[0], /fetch --prune origin$/, `both-requested must widen, never narrow, saw: ${calls[0]}`);
});

// The two timeout halves of the same fix, proven by the one observable
// difference between "explicit timeoutMs" and "git-exec's own resolveTimeout":
// only the latter honors CT_HOOKS_GIT_TIMEOUT_MS (see git-exec.js's
// resolveTimeout — an explicit opts.timeoutMs short-circuits the env var).
// A 1ms budget cannot survive even a process spawn, so an honored override
// resolves to `timeout` and an ignored one resolves to a real fetch.
function withGitTimeoutOverride(ms, fn) {
  const original = process.env.CT_HOOKS_GIT_TIMEOUT_MS;
  process.env.CT_HOOKS_GIT_TIMEOUT_MS = String(ms);
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.CT_HOOKS_GIT_TIMEOUT_MS;
    else process.env.CT_HOOKS_GIT_TIMEOUT_MS = original;
  }
}

test('sharedFetch: the remote-prune shape passes no explicit timeout — CT_HOOKS_GIT_TIMEOUT_MS still applies (Task 4\'s ruling, now pinned)', () => {
  const { mainDir } = pairedFixture();
  const { sharedFetch } = require('../plugin/bin/lib/reconcile/shared-fetch');
  const r = withGitTimeoutOverride(1, () => sharedFetch(mainDir, { integration: 'main', mirror: false, remotePrune: true }));
  assert.equal(r.failure, 'timeout', 'a hardcoded timeoutMs on this shape would ignore the env override and let the fetch succeed');
});

test('sharedFetch: the mirror-only shape pins its own tight hot-path budget — CT_HOOKS_GIT_TIMEOUT_MS cannot shrink it', () => {
  const { mainDir } = pairedFixture();
  const { sharedFetch } = require('../plugin/bin/lib/reconcile/shared-fetch');
  const r = withGitTimeoutOverride(1, () => sharedFetch(mainDir, { integration: 'main', mirror: true, remotePrune: false }));
  assert.equal(r.failure, null, 'the mirror shape must carry an explicit timeoutMs, which git-exec resolves ahead of the env override');
});

// The finding this fix answers is about the PRODUCTION wiring, not just
// sharedFetch's own signature: session-start.js's inline pass is what was
// paying for a --prune all-refs fetch it had no use for. Pin the whole path.
test('reconcile(): a FAST_CHECKS pass (session-start\'s inline hot path) issues only the narrow single-ref fetch', { skip: STUB_SKIP }, async () => {
  const { mainDir } = pairedFixture();
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  git(['add', '.claude-tweaks/policy.yml'], mainDir);
  git(['commit', '-q', '-m', 'policy'], mainDir);

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  const originalHealthAsync = preflight.ghHealthCheckAsync;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  // FAST_CHECKS is exactly the shape (#872) that runs the preflight via
  // ghHealthCheckAsync, concurrently with the shared fetch — stub both or
  // the async twin reaches a real `gh` call.
  preflight.ghHealthCheckAsync = async () => ({ ok: true, reason: null });

  const { FAST_CHECKS } = require('../plugin/bin/lib/hooks/session-start');
  let calls;
  try {
    calls = await withFetchArgvLog(() => reconcile({ cwd: mainDir, checks: FAST_CHECKS }));
  } finally {
    preflight.ghHealthCheck = originalHealth;
    preflight.ghHealthCheckAsync = originalHealthAsync;
  }
  assert.equal(calls.length, 1, `expected exactly one fetch on the fast path, saw ${JSON.stringify(calls)}`);
  assert.match(calls[0], /fetch origin main$/, `the inline hot path must not pay for --prune, saw: ${calls[0]}`);
});

// AC (#872): FAST_CHECKS runs ghHealthCheckAsync and the shared fetch
// concurrently via Promise.all, not serially. Proven by an artificially
// slow preflight: a real (fast, local) git fetch running concurrently with
// it makes total elapsed time track the SLOWER of the two (the preflight
// delay), not their sum — a regression back to the old serial order would
// add the fetch's own time on top.
test('reconcile(): FAST_CHECKS runs the preflight and the shared fetch concurrently, not serially (#872)', async () => {
  // #2499: this used to assert `elapsed < HEALTH_DELAY_MS * 2` (400ms) after
  // racing a real local `git fetch` (sharedFetchAsync) against a mocked,
  // artificially-delayed preflight — a wall-clock margin that flaked once
  // under full-suite machine load (measured 463ms) despite the isolated run
  // completing correctly. Widening the margin trades away the very
  // regression-detection power the test exists for (see the design note this
  // replaced), so instead assert overlap directly: record each call's own
  // [start, end] window and check they overlap. Concurrent dispatch always
  // overlaps; serial dispatch never does, regardless of host speed.
  const { mainDir } = pairedFixture();
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  git(['add', '.claude-tweaks/policy.yml'], mainDir);
  git(['commit', '-q', '-m', 'policy'], mainDir);

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  const originalHealthAsync = preflight.ghHealthCheckAsync;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  const HEALTH_DELAY_MS = 200;
  let healthStart = null;
  let healthEnd = null;
  preflight.ghHealthCheckAsync = () => {
    healthStart = Date.now();
    return new Promise((resolve) => {
      setTimeout(() => {
        healthEnd = Date.now();
        resolve({ ok: true, reason: null });
      }, HEALTH_DELAY_MS);
    });
  };

  // sharedFetchAsync (reconcile/shared-fetch.js) calls runGitAsync
  // (bin/lib/hooks/git-exec.js), which resolves `promisify(cp.execFile)`
  // fresh at call time — the same call-time-resolved property runGitAsync's
  // own timeout test already mocks — so wrapping `cp.execFile` here observes
  // the real fetch subprocess's actual start/end without faking its result.
  // The wrapper delegates to Node's real custom promisify implementation
  // (`execFile[promisify.custom]`) so the {stdout, stderr} shape runGitAsync
  // depends on is preserved exactly; only the timing is instrumented.
  const cp = require('child_process');
  const { promisify } = require('util');
  const originalExecFile = cp.execFile;
  const originalCustomPromisify = originalExecFile[promisify.custom];
  let fetchStart = null;
  let fetchEnd = null;
  function execFileWrapper(...args) {
    return originalExecFile(...args);
  }
  execFileWrapper[promisify.custom] = (...args) => {
    fetchStart = Date.now();
    return originalCustomPromisify(...args).finally(() => {
      fetchEnd = Date.now();
    });
  };
  cp.execFile = execFileWrapper;

  const { FAST_CHECKS } = require('../plugin/bin/lib/hooks/session-start');
  try {
    await reconcile({ cwd: mainDir, checks: FAST_CHECKS });
  } finally {
    preflight.ghHealthCheck = originalHealth;
    preflight.ghHealthCheckAsync = originalHealthAsync;
    cp.execFile = originalExecFile;
  }
  assert.ok(healthStart !== null && healthEnd !== null, 'the preflight health check must have run');
  assert.ok(fetchStart !== null && fetchEnd !== null, 'the shared fetch must have run');
  assert.ok(
    healthStart < fetchEnd && fetchStart < healthEnd,
    `expected the preflight window [${healthStart}, ${healthEnd}] to overlap the fetch window [${fetchStart}, ${fetchEnd}] — a serial regression would not overlap`,
  );
});

// --- session-level freshness TTL short-circuit (#820, D7) ---

test('reconcile(): skipIfFresh=true short-circuits entirely when the cache is within TTL (D7)', async () => {
  const { mainDir } = pairedFixture();
  const cache = require('../plugin/bin/lib/reconcile/cache');
  cache.writeCache(mainDir, { lastRunAt: Date.now(), claimShas: {} });
  const r = await reconcile({ cwd: mainDir, checks: ['mirror'], skipIfFresh: true });
  assert.deepEqual(r.skipped, [{ check: 'all', reason: 'fresh-cache' }]);
  assert.equal(r.mirror, null);
});

test('reconcile(): skipIfFresh=true runs normally when the cache is stale (past TTL)', async () => {
  const { mainDir } = pairedFixture();
  const cache = require('../plugin/bin/lib/reconcile/cache');
  cache.writeCache(mainDir, { lastRunAt: Date.now() - (60 * 60 * 1000), claimShas: {} });
  const r = await reconcile({ cwd: mainDir, checks: ['mirror'], skipIfFresh: true });
  assert.notDeepEqual(r.skipped, [{ check: 'all', reason: 'fresh-cache' }]);
});

test('reconcile(): skipIfFresh defaults to false — omitting it always runs, cache or not (back-compat for every existing caller)', async () => {
  const { mainDir } = pairedFixture();
  const cache = require('../plugin/bin/lib/reconcile/cache');
  cache.writeCache(mainDir, { lastRunAt: Date.now(), claimShas: {} });
  const r = await reconcile({ cwd: mainDir, checks: ['mirror'] });
  assert.notDeepEqual(r.skipped, [{ check: 'all', reason: 'fresh-cache' }]);
});

test('reconcile(): a real (non-short-circuited) pass stamps lastRunAt for the next skipIfFresh check', async () => {
  const { mainDir } = pairedFixture();
  // Same forcing as the preflight/budget/D2 tests above: pairedFixture()'s
  // origin is a bare local repo, not a real GitHub remote, so
  // resolveIntegrationModel's forge-detection fallback would otherwise land
  // on local-merge — whose early return (index.js's model !== 'pr-first'
  // branch) exits before the end-of-function stamp this test is checking.
  // Force pr-first explicitly, and commit policy.yml so `git status
  // --porcelain` reads clean (classifyMirror bails out early on a dirty
  // tree, before ever reaching the stamp).
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  git(['add', '.claude-tweaks/policy.yml'], mainDir);
  git(['commit', '-q', '-m', 'policy'], mainDir);

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });

  const cache = require('../plugin/bin/lib/reconcile/cache');
  const before = Date.now();
  let r;
  try {
    r = await reconcile({ cwd: mainDir, checks: ['mirror'] });
  } finally {
    preflight.ghHealthCheck = originalHealth;
  }
  assert.deepEqual(r.skipped, [], `expected a fully-completed pass, saw ${JSON.stringify(r.skipped)}`);
  const after = cache.readCache(mainDir);
  assert.ok(after.lastRunAt >= before, 'lastRunAt must be stamped after a real pass');
});

// #644 review fix: `opts.skipCacheStamp` — `bin/hooks.js reconcile-summary`'s
// own internal `checks: ['mirror']` probe must NOT stamp the same
// `lastRunAt` key session-start.js's FAST_CHECKS call gates its
// `skipIfFresh` short-circuit on (D7, tested above) — otherwise every
// successful `/claude-tweaks:flow` closing report would make the next
// SessionStart within DEFAULT_TTL_MS believe its own mirror/red-tip/console
// pass already ran and skip it for real, silently suppressing red-tip's
// CI-failure surfacing.
test('reconcile(): skipCacheStamp=true completes a real pass without stamping lastRunAt', async () => {
  const { mainDir } = pairedFixture();
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  git(['add', '.claude-tweaks/policy.yml'], mainDir);
  git(['commit', '-q', '-m', 'policy'], mainDir);

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });

  const cache = require('../plugin/bin/lib/reconcile/cache');
  let r;
  try {
    r = await reconcile({ cwd: mainDir, checks: ['mirror'], skipCacheStamp: true });
  } finally {
    preflight.ghHealthCheck = originalHealth;
  }
  assert.deepEqual(r.skipped, [], `expected a fully-completed pass, saw ${JSON.stringify(r.skipped)}`);
  assert.equal(typeof r.mirror, 'object', 'the mirror check itself must still have run');
  const after = cache.readCache(mainDir);
  assert.equal(after.lastRunAt, null, 'lastRunAt must stay unstamped when skipCacheStamp is set');
});

test('reconcile(): skipCacheStamp=true does not disturb a real pass\'s residueSummary field', async () => {
  const { mainDir } = pairedFixture();
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  git(['add', '.claude-tweaks/policy.yml'], mainDir);
  git(['commit', '-q', '-m', 'policy'], mainDir);

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });

  let r;
  try {
    r = await reconcile({ cwd: mainDir, checks: ['mirror'], skipCacheStamp: true });
  } finally {
    preflight.ghHealthCheck = originalHealth;
  }
  assert.equal(typeof r.residueSummary, 'string', `expected a residueSummary string even with skipCacheStamp, got: ${JSON.stringify(r)}`);
  assert.match(r.residueSummary, /^reconcile: \d+ archived, \d+ stuck.*mirror ff /);
});

// AC1: reconcile() degrades within ~2s via the preflight when GitHub is
// unreachable, instead of accumulating every check's own 5-10s timeout.
test('AC1: a preflight failure skips the gh-dependent checks and still runs the mirror check', async () => {
  const { seedDir, mainDir } = pairedFixture();
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n');
  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const original = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: false, reason: 'github-unreachable' });
  let r;
  try {
    r = await reconcile({ cwd: mainDir, checks: ['mirror', 'release', 'remote-prune', 'console'] });
  } finally {
    preflight.ghHealthCheck = original;
  }
  // Functional assertion: preflight gate produces exactly the expected skip
  // entry — mirror is excluded (pure git, no `gh` dependency) and still runs.
  // The timing bound lives in perf/reconcile-time-bounds.test.js.
  assert.deepEqual(r.skipped, [{ check: 'release,remote-prune,console', reason: 'preflight-github-unreachable' }]);
  assert.deepEqual(r.mirror, { state: 'current', action: 'none' });
});

// AC2: total wall-clock time is bounded by the explicit budget regardless
// of how much stale state exists.
test('AC2: an exhausted budget skips every remaining check as budget-exceeded', async () => {
  const { mainDir } = pairedFixture();
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');

  // Must clear the preflight gate before the budget guard is even reached
  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });

  const budgetMod = require('../plugin/bin/lib/reconcile/budget');
  const original = budgetMod.createBudget;
  budgetMod.createBudget = () => ({ exceeded: () => true, remainingMs: () => 0 });
  let r;
  try {
    r = await reconcile({ cwd: mainDir, checks: require('../plugin/bin/lib/reconcile').ALL_CHECKS });
  } finally {
    budgetMod.createBudget = original;
    preflight.ghHealthCheck = originalHealth;
  }
  // The near-instant bound lives in perf/reconcile-time-bounds.test.js; here, the budget skip it guards.
  assert.deepEqual(r.skipped, [{ check: 'mirror,red-tip,console,release,post-merge,archive,archive-branches,remote-prune,ledger-residue,reap', reason: 'budget-exceeded' }]);
});

// --- per-check timings (#4032) ---

test('AC2.1: reconcile() attaches timings on an early no-remote return', async () => {
  const dir = noRemoteFixture('ct-recon-timings-early-');
  const r = await reconcile({ cwd: dir, dryRun: true });
  assert.deepStrictEqual(r.skipped, [{ check: 'all', reason: 'no-remote' }]);
  assert.equal(typeof r.timings.totalMs, 'number');
  assert.ok(r.timings.totalMs >= 0);
  assert.ok(r.timings.phases.setup, 'the early return still reports its setup phase');
});

test('reconcile() reports timings: null when the summarizer throws, not a rejected pass (#4032)', async () => {
  const dir = noRemoteFixture('ct-recon-timings-fault-');
  const timingMod = require('../plugin/bin/lib/reconcile/timing');
  const original = timingMod.summarizeTimings;
  timingMod.summarizeTimings = () => {
    throw new Error('summarizer fault');
  };
  let r;
  try {
    r = await reconcile({ cwd: dir, dryRun: true });
  } finally {
    timingMod.summarizeTimings = original;
  }
  assert.deepStrictEqual(r.skipped, [{ check: 'all', reason: 'no-remote' }], 'the pass result is intact');
  assert.equal(r.timings, null);
});

test('AC2.1: reconcile() times each dispatched check', async () => {
  const { mainDir } = pairedFixture();
  // Same forcing as the D2 shared-fetch test: committed pr-first policy keeps
  // mirror's `git status` clean so it reaches its dispatch.
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  git(['add', '.claude-tweaks/policy.yml'], mainDir);
  git(['commit', '-q', '-m', 'policy'], mainDir);

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  const originalHealthAsync = preflight.ghHealthCheckAsync;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  preflight.ghHealthCheckAsync = async () => ({ ok: true, reason: null });
  let r;
  try {
    r = await reconcile({ cwd: mainDir, checks: ['mirror'], dryRun: true });
  } finally {
    preflight.ghHealthCheck = originalHealth;
    preflight.ghHealthCheckAsync = originalHealthAsync;
  }
  const names = Object.keys(r.timings.phases);
  for (const want of ['setup', 'mirror', 'finalize']) assert.ok(names.includes(want), `${want} in ${names}`);
  assert.equal(typeof r.timings.phases.mirror.ms, 'number');
  assert.ok(
    Object.values(r.timings.phases).some((p) => Object.keys(p.subprocesses).some((k) => k.startsWith('git '))),
    JSON.stringify(r.timings),
  );
});

test('reconcile verb: the reconcile-threw fallback carries timings: null (#4032)', () => {
  const src = readText(HOOKS);
  assert.match(src, /reason: 'reconcile-threw' \}\], timings: null \}/);
});

// The fallback is a hand-maintained twin of reconcile()'s result literal (docs/reconcile-checks.md,
// "Adding a new check" step 4); post-merge's result key must be in both, or a throw under-reports it.
test('reconcile verb: the reconcile-threw fallback and reconcile()\'s result literal both carry postMerge: null (#4599)', () => {
  const fallback = readText(HOOKS).split('\n').find((l) => l.includes("reason: 'reconcile-threw'") && l.includes('out = {'));
  assert.ok(fallback, 'the reconcile-threw fallback literal was found');
  assert.match(fallback, /\bclaims: null, postMerge: null, runs: null\b/);
  const index = readText(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'reconcile', 'index.js'));
  assert.match(index, /const result = \{[^\n]*\bclaims: null, postMerge: null, runs: null\b/);
});
