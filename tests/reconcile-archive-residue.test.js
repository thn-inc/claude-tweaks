// tests/reconcile-archive-residue.test.js
// Split out of tests/reconcile.test.js; shared fixtures live in tests/helpers/reconcile-fixtures.js.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { STRUCTURALLY_STUCK_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
const { formatSummary } = require('../plugin/bin/lib/reconcile/format-summary');
const { recordResidueFailure, recordResidueError, listResidueFailures, RESIDUE_ESCALATE_THRESHOLD, cachePath } = require('../plugin/bin/lib/reconcile/cache');
const { structurallyStuckBody } = require('../plugin/bin/lib/reconcile/escalate-residue');
const { reconcile } = require('../plugin/bin/lib/reconcile');
const { STUB_SKIP, installStub } = require('./helpers/path-stub');
const {
  git,
  pairedFixture,
  bareRepoRoot,
  mintEmptyRunDir,
  freshCloneWithoutOriginHead,
  reconcileWithAsyncMerge,
  writePolicyViaSeedAndPull,
} = require('./helpers/reconcile-fixtures');

// Every non-dry reconcile() pass prunes the declined-learning store (#1399), and that store resolves
// from process.cwd() to the main checkout (#4360). The in-process passes below pass `cwd: <fixture>`,
// which does not move process.cwd(), so left real they would lock and rewrite the maintainer's own
// store whenever the suite runs from a linked worktree. Stub the prune for the whole file; node --test
// gives each file its own process, and the #4180 prune test (tests/reconcile-archive-residue.test.js) installs its own counting stub on top.
require('../plugin/bin/lib/declined-learning/store').pruneDeclines = () => 0;

test('AC2 (#3630): dispatch-style checks release,archive,reap sees the asynchronously merged commit at archive time', async () => {
  const { r, seenAtArchive } = await reconcileWithAsyncMerge(['release', 'archive', 'reap']);
  assert.equal(seenAtArchive.hasMerge, true, 'localHasMerge must see the merge — no local-behind-merge from a missing fetch');
  assert.ok(r.mirror && r.mirror.action === 'fast-forwarded', JSON.stringify(r.mirror));
});

// AC2 end to end: the real archiveMerged (no stub) over a PR GitHub merged
// asynchronously — origin's main holds the merge commit, the clone's local main
// does not. Without the added mirror, the run skips as local-behind-merge.
// extra: { dryRun?, stuck? } — stuck seeds an escalated structurally-stuck entry for the run dir
// and serves a consolidated stuck-paths record naming it; out.ghIssueCalls logs every `gh issue` argv.
async function archiveAsyncMergedRun(checks, extra = {}) {
  const { seedDir, mainDir } = pairedFixture();
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\nintegration-branch: main\n');
  fs.writeFileSync(path.join(seedDir, 'merged.txt'), 'merged\n');
  git(['add', 'merged.txt'], seedDir);
  // extra.closedRun (#3721): seed the run already closed (status clean, no worktree), so the clean-status sweep archives it.
  // extra.trackedWork / extra.trackedStray (#3721): git-track a work/ spec / a stray file under the run dir, so mainDir receives them through the fast-forward.
  const trackedRel = '.claude-tweaks/pipelines/2026-10-17T062549-spec-3630';
  for (const [flag, rel] of [[extra.trackedWork, 'work/3630-spec.md'], [extra.trackedStray, 'tracked-stray.md']]) {
    if (!flag) continue;
    fs.mkdirSync(path.dirname(path.join(seedDir, trackedRel, rel)), { recursive: true });
    fs.writeFileSync(path.join(seedDir, trackedRel, rel), '# 3630\n');
    git(['add', '-f', `${trackedRel}/${rel}`], seedDir);
  }
  git(['commit', '-q', '-m', 'async merge'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);
  const NEW = git(['rev-parse', 'HEAD'], seedDir).trim();
  git(['branch', 'feat-async'], mainDir);
  // Real checkouts gitignore run dirs; without this the untracked run dir makes mirror read the tree as dirty.
  // The reconcile cache is gitignored too (.gitignore); without it the stuck-residue fixture dirties the tree and mirror refuses to fast-forward.
  fs.appendFileSync(path.join(mainDir, '.git', 'info', 'exclude'), '.claude-tweaks/pipelines/\n.claude-tweaks/reconcile-cache.json\n');
  const runDir = path.join(mainDir, '.claude-tweaks', 'pipelines', '2026-10-17T062549-spec-3630');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true }));
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: extra.closedRun ? 'clean' : 'active',
    worktree: extra.closedRun ? null : path.join(mainDir, '.claude', 'worktrees', 'gone'),
    pr: { number: 3630100, branch: 'feat-async' },
  }));
  const pr = {
    number: 3630100, state: 'MERGED', mergedAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z',
    mergeCommit: { oid: NEW }, closingIssuesReferences: [],
  };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-async-gh-'));
  const issueLog = path.join(dataDir, 'issue-calls.log');
  const listing = path.join(dataDir, 'stuck-listing.json');
  if (extra.stuck) {
    const stuckDir = fs.realpathSync(runDir);
    recordResidueFailure(mainDir, 'structurally-stuck', stuckDir, { lastError: 'stuck at no-pr', threshold: 1 });
    fs.writeFileSync(listing, JSON.stringify([{ number: 2724, title: 't', body: structurallyStuckBody([stuckDir]), createdAt: '2024-01-01T00:00:00Z', state: 'OPEN' }]));
  }
  const ghScript = [
    '#!/bin/sh',
    `if [ "$1" = "issue" ]; then echo "$*" >> '${issueLog}'; fi`,
    `if [ "$1" = "issue" ] && [ "$2" = "list" ] && [ -f '${listing}' ]; then cat '${listing}'; exit 0; fi`,
    'if [ "$1" = "issue" ]; then echo \'{"state":"CLOSED"}\'; exit 0; fi',
    `cat <<'EOF'\n${JSON.stringify(pr)}\nEOF`,
    '',
  ].join('\n');
  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const original = { health: preflight.ghHealthCheck, healthAsync: preflight.ghHealthCheckAsync };
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  preflight.ghHealthCheckAsync = async () => ({ ok: true, reason: null });
  const restore = installStub('gh', ghScript);
  // extra.deferRun (#4599): stub the post-merge check, deferring this run dir (true) or nothing (false).
  const postMergeMod = require('../plugin/bin/lib/reconcile/post-merge');
  const indexPath = require.resolve('../plugin/bin/lib/reconcile/index');
  const originalPostMerge = postMergeMod.postMerge;
  let reconcileFn = reconcile;
  if (extra.deferRun !== undefined) {
    postMergeMod.postMerge = async () => ({ entries: [], deferred: extra.deferRun ? [fs.realpathSync(runDir)] : [] });
    delete require.cache[indexPath];
    reconcileFn = require(indexPath).reconcile;
  }
  let r;
  try {
    r = await reconcileFn({ cwd: mainDir, checks, dryRun: extra.dryRun });
  } finally {
    restore();
    postMergeMod.postMerge = originalPostMerge;
    delete require.cache[indexPath];
    preflight.ghHealthCheck = original.health;
    preflight.ghHealthCheckAsync = original.healthAsync;
  }
  const ghIssueCalls = fs.existsSync(issueLog) ? fs.readFileSync(issueLog, 'utf8').trim().split('\n') : [];
  return { r, runDir, mainDir, NEW, ghIssueCalls };
}

test('AC2 end to end (#3630): reconcile checks archive archives a PR GitHub merged asynchronously', { skip: STUB_SKIP }, async () => {
  const { r, runDir } = await archiveAsyncMergedRun(['archive']);
  assert.ok(r.mirror && r.mirror.action === 'fast-forwarded', JSON.stringify(r.mirror));
  assert.ok(!(r.runs || []).some((x) => x.reason === 'local-behind-merge'), JSON.stringify(r.runs));
  // basename, not the path: reconcile reports the realpath of the temp dir (/private/var on macOS).
  assert.deepEqual((r.runs || []).map((x) => ({ run: path.basename(x.runDir), action: x.action })), [{ run: path.basename(runDir), action: 'archived' }]);
});

test('#3721 AC4.1: a reconcile run entry for an archived tracked-work run includes the commit', { skip: STUB_SKIP }, async () => {
  const { r, mainDir } = await archiveAsyncMergedRun(['archive'], { trackedWork: true });
  const [entry] = r.runs;
  assert.strictEqual(entry.action, 'archived');
  assert.deepStrictEqual(entry.commit, { sha: git(['rev-parse', '--short', 'HEAD'], mainDir).trim(), branch: 'main' });
});

test('#3721 AC4.1 clean-status sweep: an archived closed run\'s entry includes the commit', { skip: STUB_SKIP }, async () => {
  const { r, mainDir } = await archiveAsyncMergedRun(['archive'], { trackedWork: true, closedRun: true });
  const [entry] = r.runs;
  assert.strictEqual(entry.action, 'archived');
  assert.deepStrictEqual(entry.commit, { sha: git(['rev-parse', '--short', 'HEAD'], mainDir).trim(), branch: 'main' });
});

test('#3721 an archived run with nothing tracked has no commit in its reconcile entry', { skip: STUB_SKIP }, async () => {
  const { r } = await archiveAsyncMergedRun(['archive']);
  assert.strictEqual(r.runs[0].action, 'archived');
  assert.ok(!('commit' in r.runs[0]));
});

test('#3721 a skipped reconcile entry carries the commit its refused attempt made', { skip: STUB_SKIP }, async () => {
  const { r, mainDir } = await archiveAsyncMergedRun(['archive'], { trackedWork: true, trackedStray: true });
  const [entry] = r.runs;
  assert.strictEqual(entry.action, 'skipped');
  assert.strictEqual(entry.reason, 'tracked-entry');
  assert.deepStrictEqual(entry.commit, { sha: git(['rev-parse', '--short', 'HEAD'], mainDir).trim(), branch: 'main' });
});

test('#3721 a mixed pass names only the tracked run', () => {
  const { archiveMerged, ORPHAN_MINT_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const trackedId = '2026-08-01T120000-record-3721-tracked';
  const trackedDir = mintEmptyRunDir(root, trackedId);
  fs.mkdirSync(path.join(trackedDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(trackedDir, 'work', '3721-spec.md'), '# 3721\n');
  git(['add', '-f', `.claude-tweaks/pipelines/${trackedId}/work/3721-spec.md`], root);
  git(['commit', '-q', '-m', 'track spec'], root);
  const bareDir = mintEmptyRunDir(root, '2026-08-01T120100-record-3721-bare');
  const old = new Date(Date.now() - ORPHAN_MINT_TTL_MS * 2);
  for (const d of [trackedDir, bareDir]) fs.utimesSync(d, old, old);

  const result = archiveMerged({ cwd: root });

  assert.strictEqual(result.archived.length, 2, JSON.stringify(result));
  assert.deepStrictEqual(Object.keys(result.archiveCommits), [trackedDir]);
  const picked = result.archiveCommits[trackedDir];
  assert.match(picked.sha, /^[0-9a-f]{7,}$/);
  assert.strictEqual(picked.branch, 'main');
});

test('#4599 end to end: a run post-merge deferred in the same pass is not archived — it is skipped post-merge-pending and stays at its top-level path', { skip: STUB_SKIP }, async () => {
  const { r, runDir } = await archiveAsyncMergedRun(['archive'], { deferRun: true });
  assert.deepEqual((r.runs || []).map((x) => ({ run: path.basename(x.runDir), action: x.action, reason: x.reason })), [
    { run: path.basename(runDir), action: 'skipped', reason: 'post-merge-pending' },
  ]);
  assert.equal(fs.existsSync(runDir), true, 'the run dir still exists at its top-level path');
  assert.equal(fs.existsSync(path.join(path.dirname(runDir), 'archive', path.basename(runDir))), false, 'nothing was moved to archive/');
});

test('#4599 end to end: with an empty deferred set the same merged run is archived', { skip: STUB_SKIP }, async () => {
  const { r, runDir } = await archiveAsyncMergedRun(['archive'], { deferRun: false });
  assert.deepEqual((r.runs || []).map((x) => ({ run: path.basename(x.runDir), action: x.action })), [{ run: path.basename(runDir), action: 'archived' }]);
  assert.equal(fs.existsSync(runDir), false);
});

test('#4202 end to end: archiving an escalated stuck run dir edits the consolidated record and clears its entry', { skip: STUB_SKIP }, async () => {
  const { r, mainDir, ghIssueCalls } = await archiveAsyncMergedRun(['archive'], { stuck: true });
  assert.deepEqual((r.runs || []).map((x) => x.action), ['archived'], JSON.stringify(r.runs));
  assert.ok(ghIssueCalls.some((c) => c.startsWith('issue edit 2724')), ghIssueCalls.join('\n'));
  assert.deepEqual(listResidueFailures(mainDir), []);
});

test('#4202 end to end: a dry-run pass over the same run neither edits the record nor clears the entry', { skip: STUB_SKIP }, async () => {
  const { r, mainDir, ghIssueCalls } = await archiveAsyncMergedRun(['archive'], { stuck: true, dryRun: true });
  assert.deepEqual((r.runs || []).map((x) => x.action), ['archived'], JSON.stringify(r.runs));
  assert.ok(!ghIssueCalls.some((c) => /^issue (edit|comment|close) /.test(c)), ghIssueCalls.join('\n'));
  assert.deepEqual(listResidueFailures(mainDir).map((e) => e.reason), ['structurally-stuck']);
});

// #4032: one PR-state resolver per pass, shared by release, archive and reap,
// persisted in `finalize`; a prefetch that throws must never break the pass.
//
// `full: true` runs a NON-dry-run pass (release is skipped under dryRun) on a
// fixture where each check reaches the resolver: a live claim for issue 11
// whose run stamps pr.number 42 (release Phase 1.5 and archive), whose
// worktree sits in the harness domain on branch `run-num-branch` (reap). A
// `gh` stub on PATH serves only the claim listing/read; every PR lookup would
// fail, so the resolver's OPEN-PR deps are the only PR answers, and OPEN means
// nothing is released, archived or reaped. `events` logs, in order, each
// DIRECT call a check makes on the resolver (prefetch's internal lookups use
// the unwrapped closures, so they never appear as byNumberAsync/byBranch) and
// each prefetch's arguments.
async function reconcileWithRecordedResolver({ wrap, full = false } = {}) {
  const { mainDir } = pairedFixture();
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  git(['add', '.claude-tweaks/policy.yml'], mainDir);
  git(['commit', '-q', '-m', 'policy'], mainDir);

  let restorePath = () => {};
  if (full) {
    const wtPath = path.join(mainDir, '.claude', 'worktrees', 'wt-run-num');
    git(['worktree', 'add', '-q', '-b', 'run-num-branch', wtPath], mainDir);
    const runId = '2026-01-01T000000-run-num'; // archive's run-dir scan only yields timestamped ids
    const runDir = path.join(mainDir, '.claude-tweaks', 'pipelines', runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: wtPath, pr: { number: 42 } }));
    const claim = JSON.stringify({ runId, sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h' });
    restorePath = installStub(
      'gh',
      '#!/bin/sh\ncase "$*" in\n'
      + `  *"git/trees/claims-registry"*) cat <<'EOF'\n${JSON.stringify({ truncated: false, entries: [{ name: 'issue-11.json', sha: 's11' }] })}\nEOF\n    ;;\n`
      + `  *"contents/claims/issue-11.json"*) cat <<'EOF'\n${JSON.stringify({ content: claim, sha: 's11' })}\nEOF\n    ;;\n`
      + '  *) exit 1 ;;\nesac\n',
    );
  }

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const cacheMod = require('../plugin/bin/lib/reconcile/pr-state-cache');
  const originalHealth = preflight.ghHealthCheck;
  const originalHealthAsync = preflight.ghHealthCheckAsync;
  const originalCreate = cacheMod.createPrStateResolver;
  const instances = [];
  const events = [];
  const open = (n) => ({ number: n || 7, state: 'OPEN', mergedAt: null, updatedAt: '2026-01-01T00:00:00Z', mergeCommit: null });
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  preflight.ghHealthCheckAsync = async () => ({ ok: true, reason: null });
  cacheMod.createPrStateResolver = (opts) => {
    const deps = full ? {
      byNumber: (n) => open(n), byNumberAsync: async (n) => open(n), byBranch: () => open(), byBranchAsync: async () => open(),
    } : undefined;
    const inst = originalCreate({ ...opts, ...(deps ? { deps } : {}) });
    const calls = { persist: 0, prefetch: 0 };
    const persist = inst.persist;
    const prefetch = inst.prefetch;
    inst.persist = (...a) => { calls.persist += 1; return persist(...a); };
    inst.prefetch = (...a) => {
      calls.prefetch += 1;
      events.push(['prefetch', a[0]]);
      return wrap ? wrap(prefetch, ...a) : prefetch(...a);
    };
    for (const m of ['byNumber', 'byBranch', 'byNumberAsync', 'byBranchAsync']) {
      const orig = inst[m];
      inst[m] = (id) => { events.push([m, id]); return orig(id); };
    }
    instances.push({ inst, calls });
    return inst;
  };
  let r;
  try {
    r = await reconcile({ cwd: mainDir, checks: ['release', 'archive', 'reap'], dryRun: !full });
  } finally {
    preflight.ghHealthCheck = originalHealth;
    preflight.ghHealthCheckAsync = originalHealthAsync;
    cacheMod.createPrStateResolver = originalCreate;
    restorePath();
  }
  return { r, instances, events };
}

test('reconcile(): one resolver per pass is created and persisted once, with archive and reap phases timed (#4032)', async () => {
  const { r, instances } = await reconcileWithRecordedResolver({ full: true });
  assert.equal(instances.length, 1, 'exactly one resolver for the pass');
  assert.equal(instances[0].calls.persist, 1, 'persisted once, in finalize');
  assert.ok(r.timings.phases.archive && r.timings.phases.reap && r.timings.phases.finalize);
});

// #4180: a dry run writes nothing, so the pass's PR answers are not persisted either (this pass
// used to persist them under "dry-run included: it records reads"; that wrote the cache).
test('reconcile(): a dry run still creates one resolver per pass but never persists it (#4180)', async () => {
  const { r, instances } = await reconcileWithRecordedResolver();
  assert.equal(instances.length, 1, 'exactly one resolver for the pass');
  assert.equal(instances[0].calls.persist, 0, 'a dry run persists nothing');
  assert.ok(r.timings.phases.archive && r.timings.phases.reap && r.timings.phases.finalize);
});

test('reconcile(): release, archive and reap all use the pass\'s one resolver (#4032)', { skip: STUB_SKIP }, async () => {
  const { r, instances, events } = await reconcileWithRecordedResolver({ full: true });
  assert.equal(instances.length, 1);
  assert.ok(!r.skipped.some((s) => s.check === 'release'), `release must have run, got ${JSON.stringify(r.skipped)}`);
  // release runs first: it warms the stamped number in one prefetch (#4032), then its
  // direct by-number lookup follows. archive's own prefetch comes after both.
  const releaseCall = events.findIndex(([m, id]) => m === 'byNumberAsync' && id === 42);
  const isNumberPrefetch = ([m, a]) => m === 'prefetch' && a.numbers && a.numbers.includes(42);
  const releasePrefetch = events.findIndex(isNumberPrefetch);
  assert.ok(releasePrefetch !== -1 && releasePrefetch < releaseCall, `release Phase 1.5 must warm the resolver before its lookup, events: ${JSON.stringify(events)}`);
  assert.ok(releaseCall !== -1 && events.findIndex((e, i) => i > releaseCall && isNumberPrefetch(e)) !== -1, `release Phase 1.5 must call the resolver before archive's prefetch, events: ${JSON.stringify(events)}`);
  // archive's prefetch warms the stamped number; a branch is only asked of unanswered dirs, so this one is reap's.
  const prefetched = events.filter(([m]) => m === 'prefetch').map(([, a]) => a);
  assert.ok(prefetched.some((a) => a.numbers && a.numbers.includes(42)), `archive must prefetch the stamped number, got ${JSON.stringify(prefetched)}`);
  assert.ok(prefetched.some((a) => a.branches && a.branches.includes('run-num-branch')), `reap must prefetch its worktree branch, got ${JSON.stringify(prefetched)}`);
  assert.ok(events.some(([m, id]) => m === 'byBranch' && id === 'run-num-branch'), `reapMerged must look the branch up through the resolver, events: ${JSON.stringify(events)}`);
});

test('reconcile(): a throwing prefetch never breaks the pass (#4032)', async () => {
  const { r, instances } = await reconcileWithRecordedResolver({ wrap: async () => { throw new Error('prefetch boom'); }, full: true });
  assert.equal(instances.length, 1);
  assert.ok(Array.isArray(r.runs) && Array.isArray(r.worktrees), `archive and reap must still have run, got ${JSON.stringify(r)}`);
  assert.equal(instances[0].calls.persist, 1);
});

// #4032 — the residue marker index crosses passes through the reconcile cache:
// index.js loads `residueIssueIndex` into the per-pass issue-list cache and
// finalize writes the pass's index back. Module-wiring level (archiveMerged is
// stubbed to issue the lookups), with a fake `gh` as the cache's `base` — no
// live GitHub.
async function residueIndexPass(extraOpts, seedCache = {}) {
  const issueListCache = require('../plugin/bin/lib/reconcile/issue-list-cache');
  const archiveMergedModule = require('../plugin/bin/lib/reconcile/archive-merged');
  const reapMergedModule = require('../plugin/bin/lib/reconcile/reap-merged');
  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const { readCache, writeCache } = require('../plugin/bin/lib/reconcile/cache');

  const seeded = '<!-- fingerprint: reconcile-residue-aaaa1111 -->';
  const learned = '<!-- fingerprint: reconcile-residue-bbbb2222 -->';
  const ghCalls = [];
  const fakeGh = (argv) => {
    ghCalls.push(argv);
    if (argv[1] === 'view') {
      return JSON.stringify({ number: 42, title: 't', body: `x\n${seeded}`, createdAt: '2026-01-01T00:00:00Z', state: 'OPEN' });
    }
    if (argv[1] === 'list') {
      return JSON.stringify([{ number: 9, title: 't', body: `y\n${learned}`, createdAt: '2026-01-01T00:00:00Z', state: 'OPEN' }]);
    }
    return '';
  };

  const originalCreate = issueListCache.createIssueListCache;
  const originalArchive = archiveMergedModule.archiveMerged;
  const originalReap = reapMergedModule.reapMerged;
  const originalHealth = preflight.ghHealthCheck;
  const originalHealthAsync = preflight.ghHealthCheckAsync;

  issueListCache.createIssueListCache = (opts) => originalCreate({ ...opts, base: fakeGh });
  let seededHit;
  let callsAfterLookup;
  archiveMergedModule.archiveMerged = (opts) => {
    seededHit = opts.runner.findIssueByMarker('o/r', seeded);
    callsAfterLookup = ghCalls.map((c) => c.slice(0, 2).join(' '));
    opts.runner(['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'number,title,body,createdAt,state', '--limit', '10000']);
    return { archived: [], skipped: [] };
  };
  reapMergedModule.reapMerged = () => ({ reaped: [], skipped: [], portsRelease: [] });
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  preflight.ghHealthCheckAsync = async () => ({ ok: true, reason: null });

  try {
    delete require.cache[require.resolve('../plugin/bin/lib/reconcile/index')];
    const { reconcile: reconcileFresh } = require('../plugin/bin/lib/reconcile/index');
    const { mainDir } = pairedFixture();
    writeCache(mainDir, { ...readCache(mainDir), residueIssueIndex: { [`o/r\n${seeded}`]: 42 }, ...seedCache });

    await reconcileFresh({
      cwd: mainDir, checks: ['archive', 'reap'], resolveIntegrationModel: () => 'pr-first', mcpReachable: true, ...extraOpts,
    });
    return { seeded, learned, seededHit, callsAfterLookup, cache: readCache(mainDir) };
  } finally {
    issueListCache.createIssueListCache = originalCreate;
    archiveMergedModule.archiveMerged = originalArchive;
    reapMergedModule.reapMerged = originalReap;
    preflight.ghHealthCheck = originalHealth;
    preflight.ghHealthCheckAsync = originalHealthAsync;
    delete require.cache[require.resolve('../plugin/bin/lib/reconcile/index')];
  }
}

test('reconcile(): loads residueIssueIndex into the pass and writes the learned index back (#4032)', async () => {
  const { seeded, learned, seededHit, callsAfterLookup, cache } = await residueIndexPass({});
  // (a) the cached entry reached the pass: one view, no list, before the list read.
  assert.equal(seededHit && seededHit.number, 42, 'the seeded index entry must answer the lookup');
  assert.deepEqual(callsAfterLookup, ['issue view'], 'the lookup must cost one issue view and no issue list');
  // (b) the learned index was written back, with the loaded entry preserved.
  assert.deepEqual(cache.residueIssueIndex, { [`o/r\n${seeded}`]: 42, [`o/r\n${learned}`]: 9 });
});

test('reconcile(): a scoped skipCacheStamp pass still persists the index entries it learned, without stamping freshness (#4032)', async () => {
  // A (future-dated) fresh health stamp keeps healthJustSucceeded false, so the write under test
  // cannot ride on the health-stamp gate.
  const { seeded, learned, cache } = await residueIndexPass({ skipCacheStamp: true }, { lastHealthCheckOkAt: Date.now() + 60000 });
  assert.deepEqual(cache.residueIssueIndex, { [`o/r\n${seeded}`]: 42, [`o/r\n${learned}`]: 9 });
  assert.ok(!cache.lastRunAt, 'a scoped pass must not stamp the shared freshness key');
});

// #4180: a local git fixture shaped like the #3503 archive test, with a PATH `gh` shim that logs
// every invocation's argv and exits 1, and the gh preflight stubbed healthy (the shim would fail
// the real one). `checks: ['archive']` expands with mirror, so the fast shape calls the async
// preflight; both are patched. `run(opts)` returns reconcile()'s result with the env restored.
function dryRunFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-4180-')));
  git(['init', '-q', '--initial-branch=main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);
  git(['remote', 'add', 'origin', 'git@github.com:acme/w.git'], root);
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'integration-branch: main\n');
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-4180-gh-'));
  const ghLog = path.join(logDir, 'gh-calls.log');
  const ghScript = `#!/bin/sh\necho "$@" >> '${ghLog}'\nexit 1\n`;
  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  async function run(opts) {
    const original = {
      health: preflight.ghHealthCheck, healthAsync: preflight.ghHealthCheckAsync, ssh: process.env.GIT_SSH_COMMAND,
    };
    preflight.ghHealthCheck = () => ({ ok: true });
    preflight.ghHealthCheckAsync = async () => ({ ok: true });
    const restore = installStub('gh', ghScript);
    // mirror's shared fetch targets a real-looking SSH origin; `false` makes it fail fast.
    process.env.GIT_SSH_COMMAND = 'false';
    try {
      return await reconcile({ cwd: root, checks: ['archive'], resolveIntegrationModel: () => 'pr-first', ...opts });
    } finally {
      preflight.ghHealthCheck = original.health;
      preflight.ghHealthCheckAsync = original.healthAsync;
      restore();
      if (original.ssh === undefined) delete process.env.GIT_SSH_COMMAND;
      else process.env.GIT_SSH_COMMAND = original.ssh;
    }
  }
  return { root, run, ghCalls: () => (fs.existsSync(ghLog) ? fs.readFileSync(ghLog, 'utf8') : '') };
}

test('#4180 AC1.1: reconcile --dry-run over a past-threshold stuck run dir makes zero gh calls and leaves reconcile-cache.json byte-identical', async () => {
  const { root, run, ghCalls } = dryRunFixture();
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-4180');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active', worktree: path.join(root, '.claude', 'worktrees', 'gone'),
  }));
  const old = new Date(Date.now() - 2 * STRUCTURALLY_STUCK_TTL_MS);
  fs.utimesSync(runDir, old, old); // the DIR's mtime, set after its files are written
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD - 1; i++) {
    recordResidueFailure(root, 'structurally-stuck', runDir, { lastError: 'stuck at no-worktree' });
  }
  const before = fs.readFileSync(cachePath(root));
  const r = await run({ dryRun: true });
  assert.ok(
    (r.runs || []).some((x) => x.runDir === runDir && x.action === 'skipped' && ['no-worktree', 'no-branch', 'no-pr'].includes(x.reason)),
    `the fixture dir must skip for a structurally-stuck reason, got ${JSON.stringify(r.runs)}`,
  );
  assert.equal(ghCalls(), '', 'a dry run makes no gh call');
  assert.deepEqual(fs.readFileSync(cachePath(root)), before, 'a dry run leaves the cache byte-identical');
  assert.deepEqual(r.residuePlan, [{ action: 'would-escalate', reason: 'structurally-stuck', path: runDir, count: RESIDUE_ESCALATE_THRESHOLD }]);
});

test('#4180 AC2.1: a recorded resolve failure appears in reconcile JSON residueErrors', async () => {
  const { root, run } = dryRunFixture();
  const p = path.join(root, 'a.txt'); // an existing path: the prune leaves the entry alone
  recordResidueFailure(root, 'structurally-stuck', p, { lastError: 'stuck at no-pr', threshold: 1 });
  recordResidueError(root, 'structurally-stuck', p, { op: 'resolve', error: 'HTTP 502' });
  const r = await run({});
  assert.deepEqual(r.residueErrors.map(({ at, ...e }) => e), [{ reason: 'structurally-stuck', path: p, op: 'resolve', error: 'HTTP 502' }]);
  assert.equal(typeof r.residueErrors[0].at, 'number');
  assert.match(r.residueSummary, /1 residue error\(s\) \(last: resolve — HTTP 502\)/);
  assert.equal(r.residuePlan, null);
});

test('#4180 reconcile: a dry run with nothing stuck reports residuePlan [] and a real run reports null', async () => {
  const { run } = dryRunFixture();
  const dry = await run({ dryRun: true });
  assert.deepEqual(dry.residuePlan, []);
  assert.deepEqual(dry.residueErrors, []);
  const real = await run({});
  assert.equal(real.residuePlan, null);
  assert.deepEqual(real.residueErrors, []);
});

test('#4180 reconcile: a dry run writes no cache file at all; a real run stamps it', async () => {
  const { root, run } = dryRunFixture();
  await run({ dryRun: true });
  assert.equal(fs.existsSync(cachePath(root)), false, 'a dry run writes no cache file');
  await run({});
  assert.equal(fs.existsSync(cachePath(root)), true, 'a real run stamps the cache');
});

// #4180: the #3132 origin/HEAD repair writes a git ref (set-head) and, on failure, the cache, so a
// dry run reports it as skipped and never attempts it.
test('#4180 reconcile: a dry run does not repair origin/HEAD, writes no cache, and reports the dry-run skip', async () => {
  const { mainDir } = freshCloneWithoutOriginHead();
  const { mainCheckoutRoot } = require('../plugin/bin/lib/hooks/worktree-detect');
  const cacheFile = cachePath(mainCheckoutRoot(mainDir));

  const r = await reconcile({ cwd: mainDir, checks: ['mirror'], dryRun: true });

  assert.deepStrictEqual(r.originHeadRepair, { outcome: 'skipped', reason: 'dry-run' });
  assert.deepStrictEqual(r.skipped, [{ check: 'all', reason: 'no-remote' }]);
  assert.throws(() => git(['symbolic-ref', 'refs/remotes/origin/HEAD'], mainDir), 'a dry run must not write origin/HEAD');
  assert.equal(fs.existsSync(cacheFile), false, 'a dry run writes no cache file');
});

test('#4180 reconcile: a dry run over a pre-seeded cache leaves it byte-identical when origin/HEAD is missing', async () => {
  const { mainDir } = freshCloneWithoutOriginHead();
  const { mainCheckoutRoot } = require('../plugin/bin/lib/hooks/worktree-detect');
  const root = mainCheckoutRoot(mainDir);
  recordResidueFailure(root, 'move-failed', path.join(root, 'x'), { lastError: 'e' });
  const before = fs.readFileSync(cachePath(root));

  const r = await reconcile({ cwd: mainDir, checks: ['mirror'], dryRun: true });

  assert.deepStrictEqual(r.originHeadRepair, { outcome: 'skipped', reason: 'dry-run' });
  assert.deepEqual(fs.readFileSync(cachePath(root)), before);
});

test('#4180 repairOriginHead: dryRun never runs set-head or stamps a failure, and a missing origin still reports null', () => {
  const { repairOriginHead } = require('../plugin/bin/lib/reconcile/origin-head');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-oh-dry-'));
  const calls = [];
  const withOrigin = (args) => { calls.push(args.join(' ')); return { stdout: 'https://example.invalid/r.git', failure: null, stderr: null }; };
  assert.deepStrictEqual(repairOriginHead(root, { runGit: withOrigin, dryRun: true }), { outcome: 'skipped', reason: 'dry-run' });
  assert.deepStrictEqual(calls, ['remote get-url origin']);
  assert.equal(fs.existsSync(cachePath(root)), false);
  const noOrigin = () => ({ stdout: '', failure: 'git-error', stderr: 'fatal: No such remote' });
  assert.strictEqual(repairOriginHead(root, { runGit: noOrigin, dryRun: true }), null);
});

// #4180: `residueErrors` is computed on every return path with a root, not only finalize. A budget
// that trips once the archive check's prune has dropped the gone path's entry returns before
// finalize; the prune failure (its entry is gone, so only this pass's memory holds it) must still
// reach the result, with `at: null`.
test('#4180 reconcile: an over-budget return after archive still reports a prune resolve failure in residueErrors', async () => {
  const { root, run } = dryRunFixture();
  const gone = path.join(root, '.claude-tweaks', 'pipelines', 'gone-4180');
  recordResidueFailure(root, 'move-failed', gone, { lastError: 'EBUSY', threshold: 1 }); // escalated, path absent
  const budgetMod = require('../plugin/bin/lib/reconcile/budget');
  const originalBudget = budgetMod.createBudget;
  budgetMod.createBudget = () => ({
    exceeded: () => !listResidueFailures(root).some((e) => e.path === gone),
    remainingMs: () => 0,
  });
  let r;
  try {
    r = await run({});
  } finally {
    budgetMod.createBudget = originalBudget;
  }
  assert.equal(listResidueFailures(root).some((e) => e.path === gone), false, 'the prune dropped the entry');
  assert.equal(r.residueSummary, undefined, 'the pass returned before finalize');
  assert.equal(r.residueErrors.length, 1);
  assert.deepEqual(
    { reason: r.residueErrors[0].reason, path: r.residueErrors[0].path, op: r.residueErrors[0].op, at: r.residueErrors[0].at },
    { reason: 'move-failed', path: gone, op: 'resolve', at: null },
  );
  assert.equal(typeof r.residueErrors[0].error, 'string');
});

test('#4180 reconcile: residueErrors is null when there is no repo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-4180-norepo-'));
  const r = await reconcile({ cwd: dir, checks: ['mirror'] });
  assert.deepEqual(r.skipped, [{ check: 'all', reason: 'no-repo' }]);
  assert.equal(r.residueErrors, null);
});

// #4180: the declined-learning prune rewrites its store (and takes a lock directory), so a dry
// run skips it; a real pass still runs it exactly once.
test('#4180 reconcile: a dry run skips the declined-learning prune; a real run still runs it', async () => {
  const { run } = dryRunFixture();
  const store = require('../plugin/bin/lib/declined-learning/store');
  const original = store.pruneDeclines;
  let calls = 0;
  store.pruneDeclines = () => { calls += 1; return 0; };
  try {
    await run({ dryRun: true });
    assert.equal(calls, 0, 'a dry run must not prune the declined-learning store');
    await run({});
    assert.equal(calls, 1, 'a real pass prunes once');
  } finally {
    store.pruneDeclines = original;
  }
});

// #4421: archiveMerged's `ownerlessNonClean` count rides reconcile()'s result, the summary line and
// the cache — with `ownerlessNonCleanZeroSince` stamping when the count first reads 0.
function ownerlessFixture() {
  const fx = dryRunFixture();
  const pipelines = path.join(fx.root, '.claude-tweaks', 'pipelines');
  const mk = (name, state) => {
    const dir = path.join(pipelines, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.yml'), 'x: 1\n');
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify(state));
  };
  const owned = (n) => {
    for (let i = 1; i <= n; i++) mk(`2026-10-26T10000${i}-record-${i}`, { status: 'active', owner: { sessionId: `s${i}`, host: 'h', pid: i } });
  };
  const cacheJson = () => JSON.parse(fs.readFileSync(cachePath(fx.root), 'utf8'));
  return { ...fx, mk, owned, cacheJson };
}

test('#4421 AC6.2 AC7.1: a pass over only owner-block runs reports 0 on the result, the summary line and the cache, and stamps ownerlessNonCleanZeroSince', async () => {
  const { run, owned, cacheJson } = ownerlessFixture();
  owned(2);
  const r = await run({});
  assert.equal(r.ownerlessNonClean, 0);
  assert.match(formatSummary(r), /^ownerless non-clean: 0 run dirs$/m);
  assert.equal(cacheJson().ownerlessNonClean, 0);
  const stamp = cacheJson().ownerlessNonCleanZeroSince;
  assert.equal(typeof stamp, 'string');
  assert.ok(Number.isFinite(Date.parse(stamp)));

  await new Promise((resolve) => setTimeout(resolve, 15)); // a later pass must not move the stamp
  const again = await run({});
  assert.equal(again.ownerlessNonClean, 0);
  assert.equal(cacheJson().ownerlessNonCleanZeroSince, stamp, 'the zero-since stamp is kept byte-equal');
});

test('#4421 AC6.3: a later pass with a count above 0 clears ownerlessNonCleanZeroSince', async () => {
  const { run, owned, mk, cacheJson } = ownerlessFixture();
  owned(2);
  await run({});
  assert.equal(typeof cacheJson().ownerlessNonCleanZeroSince, 'string');
  mk('2026-10-26T100009-record-9', { status: 'active' }); // owner-less, non-clean
  const r = await run({});
  assert.equal(r.ownerlessNonClean, 1);
  assert.match(formatSummary(r), /^ownerless non-clean: 1 run dir$/m);
  assert.equal(cacheJson().ownerlessNonClean, 1);
  assert.equal('ownerlessNonCleanZeroSince' in cacheJson(), false);
});

test('#4421 AC6.4: a skipped pass leaves both fields absent', async () => {
  const { root, run, owned, mk } = ownerlessFixture();
  owned(1);
  mk('2026-10-26T100009-record-9', { status: 'active' });
  const scoped = await run({ checks: ['console'] });
  assert.equal('ownerlessNonClean' in scoped, false);
  const dry = await run({ dryRun: true });
  assert.equal('ownerlessNonClean' in dry, false);
  // The summary line is dropped with the count (format-summary's absent-count branch).
  assert.doesNotMatch(formatSummary(scoped), /ownerless non-clean/);
  assert.doesNotMatch(formatSummary(dry), /ownerless non-clean/);
  // The scoped pass is not skipCacheStamp, so finalize writes the cache (lastRunAt) — but never the ownerless keys.
  assert.ok(fs.existsSync(cachePath(root)), 'the scoped pass writes the cache');
  const cache = JSON.parse(fs.readFileSync(cachePath(root), 'utf8'));
  assert.equal('ownerlessNonClean' in cache, false);
  assert.equal('ownerlessNonCleanZeroSince' in cache, false);
});

// #4421: an over-budget early return skips `finalize`, so it persists the ownerless count itself —
// otherwise a pass that read a count above 0 would leave an older ownerlessNonCleanZeroSince standing,
// and the stamp would stop dating the current unbroken run of zero readings.
// The stub budget reports "exceeded" from its Nth check on; each overBudget() call asks once.
async function withBudgetExceededFrom(nth, fn) {
  const budgetMod = require('../plugin/bin/lib/reconcile/budget');
  const original = budgetMod.createBudget;
  let asked = 0;
  budgetMod.createBudget = () => ({ exceeded: () => { asked += 1; return asked >= nth; }, remainingMs: () => 0 });
  try {
    return await fn();
  } finally {
    budgetMod.createBudget = original;
  }
}

function seedOwnerlessCache(root) {
  fs.mkdirSync(path.dirname(cachePath(root)), { recursive: true });
  fs.writeFileSync(cachePath(root), JSON.stringify({ ownerlessNonClean: 0, ownerlessNonCleanZeroSince: '2026-10-01T00:00:00.000Z' }));
}

test('#4421: an over-budget return after archive ran persists ownerlessNonClean and clears a standing ownerlessNonCleanZeroSince', async () => {
  const { root, run, mk, cacheJson } = ownerlessFixture();
  for (let i = 1; i <= 3; i++) mk(`2026-10-26T10000${i}-record-${i}`, { status: 'active' }); // owner-less, non-clean
  seedOwnerlessCache(root);
  // Calls 1-6 are the checks up to and including archive's own (post-merge adds one, #4599); the 7th (after archive) trips.
  const r = await withBudgetExceededFrom(7, () => run({ checks: ['archive', 'archive-branches'] }));
  assert.equal(r.ownerlessNonClean, 3, 'archive ran before the budget tripped');
  assert.ok(r.skipped.some((s) => s.check === 'archive-branches' && s.reason === 'budget-exceeded'), 'the pass returned early, before finalize');
  assert.equal(cacheJson().ownerlessNonClean, 3);
  assert.equal('ownerlessNonCleanZeroSince' in cacheJson(), false);
  assert.equal(cacheJson().lastRunAt ?? null, null, 'finalize still owns the freshness stamp');
});

test('#4421: an over-budget return that never ran archive leaves a persisted ownerlessNonClean and its zero-since stamp untouched', async () => {
  for (const [label, nth, checks] of [
    ['budget exceeded before archive', 1, ['archive']],
    ['a pass without archive', 2, ['console']],
  ]) {
    const { root, run, cacheJson } = ownerlessFixture();
    seedOwnerlessCache(root);
    const before = cacheJson();
    const r = await withBudgetExceededFrom(nth, () => run({ checks }));
    assert.equal('ownerlessNonClean' in r, false, label);
    assert.ok(r.skipped.some((s) => s.reason === 'budget-exceeded'), `${label}: the pass returned early`);
    assert.deepEqual(cacheJson(), before, label);
  }
});
