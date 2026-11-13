// tests/reconcile-dispatch.test.js
// Split out of tests/reconcile.test.js; shared fixtures live in tests/helpers/reconcile-fixtures.js.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { formatSummary } = require('../plugin/bin/lib/reconcile/format-summary');
const { reconcile, PREREQUISITES } = require('../plugin/bin/lib/reconcile');
const { readText } = require('./helpers/read-skill');
const { STUB_SKIP } = require('./helpers/path-stub');
const { requireOption } = require('../tools/test-impact/node-options');
const {
  HOOKS,
  git,
  pairedFixture,
  reconcileWithAsyncMerge,
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

// #1130: never let an omitted cwd fall through to the spawned subprocess's
// own process.cwd() — that is the test runner's real working directory, and
// when npm test runs from a real checkout, hooks that walk
// .claude-tweaks/pipelines/ from there write fixture events into REAL run
// dirs (the #657 pollution incident). Calls that don't care about cwd get an
// isolated, non-git sandbox instead.
const HOOK_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-sandbox-'));

function runHook(args, { input = '', cwd = HOOK_SANDBOX, env = {} } = {}) {
  try {
    const stdout = execFileSync('node', [HOOKS, ...args], {
      // #1130: `PIPELINE_RUN_DIR: ''` neutralizes any ambient run-dir env var
      // so a call that doesn't explicitly pass one can't resolve against
      // whatever real run happens to be ambient in this test runner's own
      // process.env (e.g. when npm test itself runs inside a /flow-dispatched
      // shell). A caller that needs a run dir still passes it explicitly via
      // `env`, which wins because it spreads last.
      input, cwd, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', ...env },
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '' };
  }
}

test('reconcile: reap dispatches strictly after release and archive in source order (load-bearing, not incidental — #408)', () => {
  // release and archive both derive a run's branch from a live `git
  // worktree list`; reap physically removes worktrees. Running reap first
  // would starve release/archive of exactly the runs most likely to
  // qualify (a just-reaped worktree's PR is, by construction, merged).
  // Pinned structurally, the same way tests/hooks-gate-coverage.test.js
  // pins prose to code — a real ordering regression here has no other test
  // that would catch it without fabricating live PR/claim state.
  const src = readText(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'reconcile', 'index.js'));
  const releaseIdx = src.indexOf("checks.includes('release')");
  const archiveIdx = src.indexOf("checks.includes('archive')");
  const reapIdx = src.lastIndexOf("checks.includes('reap')"); // the pr-first dispatch, not the local-merge fallback above it
  assert.ok(releaseIdx > 0 && archiveIdx > 0 && reapIdx > 0);
  assert.ok(releaseIdx < reapIdx, 'release must dispatch before reap');
  assert.ok(archiveIdx < reapIdx, 'archive must dispatch before reap');
});

test('reconcile: ALL_CHECKS includes red-tip immediately after mirror', () => {
  const { ALL_CHECKS } = require('../plugin/bin/lib/reconcile');
  const mirrorIdx = ALL_CHECKS.indexOf('mirror');
  assert.strictEqual(ALL_CHECKS[mirrorIdx + 1], 'red-tip', 'red-tip must be the entry immediately after mirror');
});

// #4032: /tidy's Reconcile-first call names the checks explicitly, because the
// unscoped CLI defers three of them to the background pass. The list is a
// hand-copied twin of ALL_CHECKS, so a check added there but not here would
// silently never converge before /tidy audits.
test("tidy/scan-procedures.md's explicit reconcile --checks list names exactly ALL_CHECKS (#4032)", () => {
  const { ALL_CHECKS } = require('../plugin/bin/lib/reconcile');
  const prose = readText(path.join(__dirname, '..', 'plugin', 'skills', 'tidy', 'scan-procedures.md'));
  const m = /hooks\.js" reconcile --checks ([a-z,-]+) --json/.exec(prose);
  assert.ok(m, 'Reconcile-first call with an explicit --checks list found');
  assert.deepEqual([...m[1].split(',')].sort(), [...ALL_CHECKS].sort());
  // The count the prose states beside the list is the list's own (#4599 left it at "nine").
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  assert.ok(prose.includes(`(all ${words[ALL_CHECKS.length]}, \`ALL_CHECKS\` order)`), `the stated count is ${words[ALL_CHECKS.length]}`);
});

test('reconcile: red-tip dispatches immediately after mirror in source order (load-bearing — reads the ref mirror-ff just fetched)', () => {
  const src = readText(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'reconcile', 'index.js'));
  const mirrorIdx = src.indexOf("checks.includes('mirror')");
  const redTipIdx = src.indexOf("checks.includes('red-tip')");
  const consoleIdx = src.indexOf("checks.includes('console')");
  assert.ok(mirrorIdx > 0 && redTipIdx > 0 && consoleIdx > 0);
  assert.ok(mirrorIdx < redTipIdx, 'mirror must dispatch before red-tip');
  assert.ok(redTipIdx < consoleIdx, 'red-tip must dispatch before console');
});

// #820 review: sharedFetchOk alone can't distinguish "fetch ran and
// succeeded" from "fetch never ran" (it defaults to true) — red-tip reading
// a never-refreshed local ref is the hazard. #3630: expandChecks() now adds
// mirror ahead of a red-tip that names neither mirror nor remote-prune, so
// the `no-fetch-this-pass` gate is unreachable through reconcile() — a
// red-tip-alone request gets its fetch instead of a skip.
test('reconcile(): red-tip requested alone pulls in mirror\'s fetch rather than reading a stale ref (#3630)', { skip: STUB_SKIP }, async () => {
  const { seedDir, mainDir } = pairedFixture();
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n');

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  const originalHealthAsync = preflight.ghHealthCheckAsync;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  preflight.ghHealthCheckAsync = async () => ({ ok: true, reason: null });
  try {
    let r;
    const calls = await withFetchArgvLog(async () => { r = await reconcile({ cwd: mainDir, checks: ['red-tip'] }); });
    const fetches = calls.filter((c) => /fetch .*origin main$/.test(c));
    assert.equal(fetches.length, 1, `expected exactly one shared fetch, saw ${JSON.stringify(calls)}`);
    assert.equal(r.mirror && r.mirror.state, 'current', 'the added mirror prerequisite must have run on a clean tree');
    assert.ok(!r.skipped.some((s) => s.reason === 'no-fetch-this-pass'), JSON.stringify(r.skipped));
  } finally {
    preflight.ghHealthCheck = originalHealth;
    preflight.ghHealthCheckAsync = originalHealthAsync;
  }
});

// The `no-fetch-this-pass` gate is the backstop for a PREREQUISITES edit that
// drops red-tip's entry — expandChecks no longer reaches it, so reach it by
// making exactly that edit.
test('reconcile(): without a red-tip PREREQUISITES entry the no-fetch-this-pass backstop still skips red-tip (#3630)', async () => {
  const { seedDir, mainDir } = pairedFixture();
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n');

  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  const originalEntry = PREREQUISITES['red-tip'];
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  delete PREREQUISITES['red-tip'];
  try {
    const r = await reconcile({ cwd: mainDir, checks: ['red-tip'] });
    assert.equal(r.redTip, null, 'red-tip must never dispatch without a fetch this pass');
    assert.deepEqual(r.skipped, [{ check: 'red-tip', reason: 'no-fetch-this-pass' }]);
  } finally {
    PREREQUISITES['red-tip'] = originalEntry;
    preflight.ghHealthCheck = originalHealth;
  }
});

test('expandChecks (#3630): adds mirror ahead of archive and red-tip, post-merge ahead of archive, and widens nothing else', () => {
  const { expandChecks, ALL_CHECKS } = require('../plugin/bin/lib/reconcile');
  assert.deepEqual(expandChecks(['archive']), ['mirror', 'post-merge', 'archive']);
  assert.deepEqual(expandChecks(['red-tip']), ['mirror', 'red-tip']);
  assert.deepEqual(expandChecks(['reap']), ['reap']);
  assert.deepEqual(expandChecks(['release', 'archive', 'reap']), ['release', 'mirror', 'post-merge', 'archive', 'reap']);
  // remote-prune satisfies archive's mirror prerequisite, nothing satisfies its post-merge one (#4599).
  assert.deepEqual(expandChecks(['archive', 'remote-prune']), ['post-merge', 'archive', 'remote-prune']);
  assert.deepEqual(expandChecks(['archive', 'archive']), ['mirror', 'post-merge', 'archive']);
  // A caller that names post-merge itself, in any position, is not widened with a second one.
  assert.deepEqual(expandChecks(['post-merge', 'archive']), ['post-merge', 'mirror', 'archive']);
  assert.deepEqual(expandChecks(['archive', 'post-merge']), ['mirror', 'archive', 'post-merge']);
  // post-merge itself has no prerequisite.
  assert.deepEqual(expandChecks(['post-merge']), ['post-merge']);
  // Two checks sharing one prerequisite add it once; remote-prune satisfies it for both.
  assert.deepEqual(expandChecks(['archive', 'red-tip']), ['mirror', 'post-merge', 'archive', 'red-tip']);
  assert.deepEqual(expandChecks(['red-tip', 'remote-prune']), ['red-tip', 'remote-prune']);
  // Caller-typed names that collide with Object.prototype keys are unknown checks, not entries.
  for (const name of ['constructor', 'toString', '__proto__']) {
    assert.deepEqual(expandChecks([name]), [name]);
  }
  assert.deepEqual(expandChecks(ALL_CHECKS), ALL_CHECKS);
  const { FAST_CHECKS } = require('../plugin/bin/lib/hooks/session-start');
  const { BACKGROUND_CHECKS } = require('../plugin/bin/hooks');
  assert.deepEqual(expandChecks(FAST_CHECKS), FAST_CHECKS);
  assert.deepEqual(expandChecks(BACKGROUND_CHECKS), BACKGROUND_CHECKS);
  const input = ['archive'];
  expandChecks(input);
  assert.deepEqual(input, ['archive'], 'input must not be mutated');
});

// The doc table is a hand-kept restatement of PREREQUISITES that every editor of
// the table is told to follow, so it is pinned row for row to the exported object.
test('docs/reconcile-checks.md prerequisite table matches PREREQUISITES row for row (#3630)', () => {
  const doc = readText(path.join(__dirname, '..', 'docs', 'reconcile-checks.md'));
  // A check with several prerequisites (archive: mirror, post-merge — #4599) has one row each; an
  // empty "Satisfied by" cell is written as an em dash.
  const rows = doc.split('\n').map((line) => /^\s*\| `([^`]+)` \| `([^`]+)` \| ((?:`[^`]+`(?:, )?)+|—) \|/.exec(line)).filter(Boolean);
  const fromDoc = {};
  for (const [, check, prerequisite, satisfiedBy] of rows) {
    (fromDoc[check] = fromDoc[check] || []).push({
      check: prerequisite, satisfiedBy: satisfiedBy === '—' ? [] : satisfiedBy.split(', ').map((s) => s.replace(/`/g, '')),
    });
  }
  assert.ok(rows.length >= 3, 'the table rows were not found in docs/reconcile-checks.md');
  const fromCode = Object.fromEntries(Object.entries(PREREQUISITES).map(([check, entry]) => [check, [].concat(entry)]));
  assert.deepEqual(fromDoc, fromCode);
});

test('AC7.2: docs/reconcile-checks.md and docs/hooks.md state the legacy-route removal condition verbatim (#4421)', () => {
  const sentence = 'remove it when `ownerlessNonCleanZeroSince` is at least 7 days old in this repository\'s `reconcile-cache.json`, on a plugin build newer than v6.153.0.';
  for (const doc of ['reconcile-checks.md', 'hooks.md']) {
    const text = readText(path.join(__dirname, '..', 'docs', doc)).replace(/\s+/g, ' ');
    assert.ok(text.includes(sentence), `${doc} must carry the removal condition verbatim`);
  }
  const hooks = readText(path.join(__dirname, '..', 'docs', 'hooks.md'));
  assert.ok(!hooks.includes('The remaining consumers are #3977 and #4421.'), 'docs/hooks.md still lists #4421 as a future consumer');
});

test('AC1 (#4599): reconcile({ checks: [\'archive\'] }) runs post-merge between mirror and archive, handing it prStates and dryRun', async () => {
  const { r, order, postMergeOpts, archiveOpts } = await reconcileWithAsyncMerge(['archive']);
  assert.deepEqual(order, ['prefetch', 'post-merge', 'archive']);
  assert.ok(r.mirror && r.mirror.action === 'fast-forwarded', 'mirror still runs ahead of both');
  // #4549: after a PR merge Step 4.0b has no default-branch check, so post-merge takes no integration branch.
  assert.ok(!('integration' in postMergeOpts), 'post-merge is handed no integration branch');
  assert.equal(postMergeOpts.dryRun, false);
  assert.ok(postMergeOpts.prStates && typeof postMergeOpts.prStates.persist === 'function', 'the pass-shared PR-state resolver');
  assert.equal(postMergeOpts.prStates, archiveOpts.prStates, 'post-merge and archive share one resolver');
  assert.deepEqual(r.postMerge, [{ runDir: '/x', pr: 1, action: 'ran' }]);
  assert.deepEqual(archiveOpts.postMergeDeferred, []);
});

test('AC1 (#4599): the pass-shared PR-state resolver is warmed with the main checkout before post-merge runs, and a throwing warm-up never breaks the pass', async () => {
  const { prefetchArgs, postMergeOpts, mainDir } = await reconcileWithAsyncMerge(['post-merge']);
  assert.equal(prefetchArgs.root, fs.realpathSync(mainDir));
  assert.equal(prefetchArgs.prStates, postMergeOpts.prStates, 'the warm-up and the check share one resolver');

  const postMergeMod = require('../plugin/bin/lib/reconcile/post-merge');
  const original = postMergeMod.prefetchPostMergePrStates;
  const { r, order } = await reconcileWithAsyncMerge(['post-merge'], {
    afterStubs: () => { postMergeMod.prefetchPostMergePrStates = async () => { throw new Error('graphql down'); }; },
  });
  postMergeMod.prefetchPostMergePrStates = original;
  assert.deepEqual(order, ['post-merge'], 'post-merge still ran after the failed warm-up');
  assert.deepEqual(r.postMerge, [{ runDir: '/x', pr: 1, action: 'ran' }]);
});

test('AC1 (#4599): the dispatch order is release, post-merge, archive when all three are requested', async () => {
  const { order } = await reconcileWithAsyncMerge(['reap', 'archive', 'post-merge', 'release']);
  assert.deepEqual(order, ['release', 'prefetch', 'post-merge', 'archive']);
});

test('M4 (#4599): post-merge is handed a live predicate over the pass\'s own wall-clock budget', async () => {
  const budgetMod = require('../plugin/bin/lib/reconcile/budget');
  const original = budgetMod.createBudget;
  let tripped = false;
  let made = 0;
  const { postMergeOpts } = await reconcileWithAsyncMerge(['post-merge'], {
    afterStubs: () => { budgetMod.createBudget = () => { made += 1; return { exceeded: () => tripped, remainingMs: () => 1 }; }; },
  }).finally(() => { budgetMod.createBudget = original; });
  assert.equal(made, 1, 'one budget per pass');
  assert.equal(typeof postMergeOpts.budgetExceeded, 'function');
  assert.equal(postMergeOpts.budgetExceeded(), false);
  tripped = true;
  assert.equal(postMergeOpts.budgetExceeded(), true, 'it reads the pass budget when called, not a snapshot');
});

test('AC1 (#4599): post-merge\'s deferred set reaches archiveMerged as postMergeDeferred', async () => {
  const { archiveOpts } = await reconcileWithAsyncMerge(['archive'], { postMergeDeferred: ['/runs/a', '/runs/b'] });
  assert.deepEqual(archiveOpts.postMergeDeferred, ['/runs/a', '/runs/b']);
});

test('AC1 (#4599): a post-merge failure goes to skipped, leaves postMerge null and defers nothing', async () => {
  const { r, archiveOpts } = await reconcileWithAsyncMerge(['archive'], { postMergeFailure: 'not-github-issues', postMergeDeferred: ['/runs/ignored'] });
  assert.equal(r.postMerge, null);
  assert.ok(r.skipped.some((s) => s.check === 'post-merge' && s.reason === 'not-github-issues'), JSON.stringify(r.skipped));
  assert.deepEqual(archiveOpts.postMergeDeferred, [], 'a failed check holds no run back from archiving');
});

test('#4933: a post-merge unknown-host failure carries its refusal detail into skipped and the summary line', async () => {
  const detail = 'origin host git.corp.invalid is not a known GitHub host — if it is GitHub Enterprise, export GH_HOST=git.corp.invalid';
  const { r } = await reconcileWithAsyncMerge(['post-merge'], { postMergeFailure: 'unknown-host', postMergeDetail: detail });
  assert.deepEqual(r.skipped.filter((s) => s.check === 'post-merge'), [{ check: 'post-merge', reason: 'unknown-host', detail }]);
  const line = formatSummary(r).split('\n').find((l) => l.startsWith('skipped: post-merge'));
  assert.equal(line, `skipped: post-merge — unknown-host (${detail})`);
  assert.ok(line.includes('GH_HOST='), line);
  const { r: bare } = await reconcileWithAsyncMerge(['post-merge'], { postMergeFailure: 'not-github-issues' });
  assert.deepEqual(bare.skipped.filter((s) => s.check === 'post-merge'), [{ check: 'post-merge', reason: 'not-github-issues' }]);
});

test('#4794: a release unknown-host failure carries its refusal detail into skipped and the summary line', async () => {
  const detail = 'origin host git.corp.invalid is not a known GitHub host — if it is GitHub Enterprise, export GH_HOST=git.corp.invalid';
  const releaseMod = require('../plugin/bin/lib/reconcile/release-merged');
  const { r } = await reconcileWithAsyncMerge(['release'], {
    afterStubs: () => { releaseMod.releaseMerged = () => ({ released: [], skipped: [], failure: 'unknown-host', detail }); },
  });
  assert.deepEqual(r.skipped.filter((s) => s.check === 'release'), [{ check: 'release', reason: 'unknown-host', detail }]);
  const line = formatSummary(r).split('\n').find((l) => l.startsWith('skipped: release'));
  assert.equal(line, `skipped: release — unknown-host (${detail})`);
  const { r: bare } = await reconcileWithAsyncMerge(['release'], {
    afterStubs: () => { releaseMod.releaseMerged = () => ({ released: [], skipped: [], failure: 'no-repo-slug' }); },
  });
  assert.deepEqual(bare.skipped.filter((s) => s.check === 'release'), [{ check: 'release', reason: 'no-repo-slug' }]);
});

test('#4794: a remote-prune unknown-host failure carries its refusal detail into skipped', async () => {
  const detail = 'origin host git.corp.invalid is not a known GitHub host — if it is GitHub Enterprise, export GH_HOST=git.corp.invalid';
  const pruneMod = require('../plugin/bin/lib/reconcile/prune-remote');
  const originalPrune = pruneMod.pruneRemote;
  try {
    const { r } = await reconcileWithAsyncMerge(['remote-prune'], {
      afterStubs: () => { pruneMod.pruneRemote = () => ({ entries: [], failure: 'unknown-host', detail }); },
    });
    assert.deepEqual(r.skipped.filter((s) => s.check === 'remote-prune'), [{ check: 'remote-prune', reason: 'unknown-host', detail }]);
    assert.equal(formatSummary(r).split('\n').find((l) => l.startsWith('skipped: remote-prune')), `skipped: remote-prune — unknown-host (${detail})`);
    // The defensive string-screen path returns the reason with no detail: the entry stays { check, reason }.
    const { r: bare } = await reconcileWithAsyncMerge(['remote-prune'], {
      afterStubs: () => { pruneMod.pruneRemote = () => ({ entries: [], failure: 'unknown-host' }); },
    });
    assert.deepEqual(bare.skipped.filter((s) => s.check === 'remote-prune'), [{ check: 'remote-prune', reason: 'unknown-host' }]);
  } finally {
    pruneMod.pruneRemote = originalPrune;
  }
});

test('AC1 (#4599): a pass that does not request post-merge or archive leaves postMerge null and does not run it', async () => {
  const { r, order } = await reconcileWithAsyncMerge(['reap']);
  assert.deepEqual(order, []);
  assert.equal(r.postMerge, null);
});

test('AC1 (#3630): reconcile({ checks: [\'archive\'] }) runs mirror before archive', async () => {
  const { r, seenAtArchive, NEW } = await reconcileWithAsyncMerge(['archive']);
  assert.equal(seenAtArchive.localMain, NEW, 'mirror must have fast-forwarded local main before archive ran');
  assert.ok(r.mirror && r.mirror.action === 'fast-forwarded', JSON.stringify(r.mirror));
});

test('AC1 (#3630): reconcile({ checks: [\'reap\'] }) runs only reap — no fetch, no mirror', async () => {
  const { r, fetchCalls, archiveCalled, reapCalled } = await reconcileWithAsyncMerge(['reap']);
  assert.deepEqual(fetchCalls, []);
  assert.equal(r.mirror, null);
  assert.equal(archiveCalled, false);
  assert.equal(reapCalled, true);
});

test('(#3630): dryRun with an added mirror prerequisite moves nothing but archive still sees origin\'s merge', async () => {
  const { r, seenAtArchive, NEW, mainDir } = await reconcileWithAsyncMerge(['archive'], { dryRun: true });
  assert.deepEqual(r.mirror, { state: 'behind', action: 'skipped', reason: 'dry-run' });
  assert.notEqual(git(['rev-parse', 'main'], mainDir).trim(), NEW, 'a dry-run must not fast-forward local main');
  assert.equal(seenAtArchive.hasMerge, true, 'the shared fetch still refreshes origin/main for the preview');
});

test('(#3630): a gh preflight failure does not run a mirror the caller never named', async () => {
  const health = { ok: false, reason: 'rate-limited' };
  const { r, archiveCalled, NEW, mainDir } = await reconcileWithAsyncMerge(['archive'], { health });
  assert.equal(r.mirror, null, 'the added mirror must not run once its dependent check was skipped');
  assert.equal(archiveCalled, false);
  assert.notEqual(git(['rev-parse', 'main'], mainDir).trim(), NEW, 'local main must not move');
  assert.ok(r.skipped.some((s) => s.check.split(',').includes('archive') && s.reason === 'preflight-rate-limited'), JSON.stringify(r.skipped));
});

test('(#3630): a gh preflight failure still runs a mirror the caller did name', async () => {
  const health = { ok: false, reason: 'rate-limited' };
  const { r, archiveCalled } = await reconcileWithAsyncMerge(['mirror', 'archive'], { health });
  assert.ok(r.mirror && r.mirror.action === 'fast-forwarded', JSON.stringify(r.mirror));
  assert.equal(archiveCalled, false);
});

// --- hooks.js verb: garbage-stdin invariant + JSON shape (AC5) ---

test('reconcile verb: garbage stdin still exits 0 and prints valid JSON with --json', () => {
  // Always an isolated fixture cwd, never the ambient process cwd — a bare
  // `reconcile` with no cwd override would run for real against whatever
  // repo the test runner happens to be in (this project's own, under `npm
  // test`), including its real worktrees and claims-registry branch. The
  // module's own fail-safe design (isWorktreeLocked, no-PR skip) made that
  // safe when it happened once during authoring, but a test must not rely
  // on that — it must never reach live state in the first place.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-garbage-'));
  const r = runHook(['reconcile', '--json'], { input: '%%%not json%%%', cwd: dir });
  assert.strictEqual(r.code, 0);
  assert.doesNotThrow(() => JSON.parse(r.stdout));
  assert.deepStrictEqual(JSON.parse(r.stdout).skipped, [{ check: 'all', reason: 'no-repo' }]);
});

test('reconcile verb: --mcp-reachable is accepted (#1558) — a no-remote fixture skips before it can matter', () => {
  const dir = noRemoteFixture('ct-recon-mcp-reachable-');
  const r = runHook(['reconcile', '--dry-run', '--json', '--mcp-reachable'], { cwd: dir });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout).skipped, [{ check: 'all', reason: 'no-remote' }]);
});

test('reconcile verb: --checks is accepted (#1543) — a no-remote fixture skips before it can matter', () => {
  const dir = noRemoteFixture('ct-recon-checks-');
  const r = runHook(['reconcile', '--dry-run', '--json', '--checks', 'mirror,release,archive'], { cwd: dir });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout).skipped, [{ check: 'all', reason: 'no-remote' }]);
});

test('reconcile verb: a missing/empty --checks value falls back to the ALL_CHECKS default (#1543)', () => {
  const dir = noRemoteFixture('ct-recon-checks-empty-');
  const r = runHook(['reconcile', '--dry-run', '--json', '--checks', ''], { cwd: dir });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout).skipped, [{ check: 'all', reason: 'no-remote' }]);
});

test('reconcile verb: --dry-run --json is accepted and never mutates on a no-remote fixture', () => {
  const dir = noRemoteFixture('ct-recon-hook-');
  const r = runHook(['reconcile', '--dry-run', '--json'], { cwd: dir });
  assert.strictEqual(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.deepStrictEqual(parsed.skipped, [{ check: 'all', reason: 'no-remote' }]);
});

test('reconcile verb: --json output is byte-for-byte JSON.stringify(out) + "\\n" (#638)', () => {
  const dir = noRemoteFixture('ct-recon-json-shape-');
  const r = runHook(['reconcile', '--dry-run', '--json'], { cwd: dir });
  assert.strictEqual(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.strictEqual(r.stdout, JSON.stringify(parsed) + '\n');
});

test('reconcile verb: no --json (new default) prints a compact summary, not the raw JSON census (#638)', () => {
  const dir = noRemoteFixture('ct-recon-compact-default-');
  const r = runHook(['reconcile', '--dry-run'], { cwd: dir });
  assert.strictEqual(r.code, 0);
  assert.throws(() => JSON.parse(r.stdout), 'default output must not be a parseable JSON object');
  assert.match(r.stdout, /^skipped: all — no-remote\n$/);
});

test('reconcile verb: compact default on a fixture with actions taken + a mix of skip reasons matches the aggregated format (#638)', () => {
  const result = {
    mirror: { state: 'behind', action: 'fast-forwarded' },
    redTip: null,
    worktrees: null,
    claims: [{ issueNumber: 1, action: 'released' }, { issueNumber: 2, action: 'released' }],
    runs: [
      { runDir: 'r1', action: 'archived' },
      { runDir: 'x1', action: 'skipped', reason: 'no-worktree' },
      { runDir: 'x2', action: 'skipped', reason: 'no-worktree' },
      { runDir: 'y1', action: 'skipped', reason: 'move-failed' },
      { runDir: 'z1', action: 'skipped', reason: 'pr-open' },
    ],
    branches: null,
    remoteBranches: null,
    console: null,
    skipped: [{ check: 'red-tip', reason: 'no-integration-ref' }],
  };
  const summary = formatSummary(result);
  assert.strictEqual(summary, [
    'mirror: fast-forwarded',
    'released: 2 claims',
    'archived: 1 run dir',
    'skipped: 4 run dirs (no-worktree 2, move-failed 1, pr-open 1)',
    'skipped: red-tip — no-integration-ref',
  ].join('\n'));
});

test('formatSummary: a skipped entry carrying names (non-canonical-run-dir, #848) lists them, not just the reason', () => {
  const result = {
    mirror: null, redTip: null, worktrees: null, claims: null, runs: null,
    branches: null, remoteBranches: null, console: null,
    skipped: [{ check: 'all', reason: 'non-canonical-run-dir', names: ['20260817T173343-spec-764'] }],
  };
  const summary = formatSummary(result);
  assert.strictEqual(summary, 'skipped: all — non-canonical-run-dir: 20260817T173343-spec-764');
});

test('formatSummary: a skipped entry\'s detail renders in parentheses after the reason, ahead of any count/names suffix; no detail renders unchanged (#4933)', () => {
  const base = { mirror: null, redTip: null, worktrees: null, claims: null, runs: null, branches: null, remoteBranches: null, console: null };
  const detail = 'origin host git.corp.invalid is not a known GitHub host — export GH_HOST=git.corp.invalid';
  const line = formatSummary({ ...base, skipped: [{ check: 'post-merge', reason: 'unknown-host', detail }] });
  assert.strictEqual(line, `skipped: post-merge — unknown-host (${detail})`);
  assert.ok(line.includes('GH_HOST='), line);
  assert.strictEqual(formatSummary({ ...base, skipped: [{ check: 'reap', reason: 'deferred', count: 2, detail: 'd' }] }), 'skipped: reap — deferred (d) x2');
  assert.strictEqual(formatSummary({ ...base, skipped: [{ check: 'all', reason: 'non-canonical-run-dir', names: ['n1'], detail: 'd' }] }), 'skipped: all — non-canonical-run-dir (d): n1');
  assert.strictEqual(formatSummary({ ...base, skipped: [{ check: 'post-merge', reason: 'not-github-issues' }] }), 'skipped: post-merge — not-github-issues');
});

test('#4794: formatSummary renders an unknown-host detail whole — a real SSH-origin refusal is over 300 chars and keeps its Enterprise advice', () => {
  const { gateOriginRepo } = require('../plugin/bin/lib/repo-resolve');
  const base = { mirror: null, redTip: null, worktrees: null, claims: null, runs: null, branches: null, remoteBranches: null, console: null };
  const detail = gateOriginRepo('git@git.corp.invalid:o/r.git', { env: {}, readFile: () => { throw new Error('ENOENT'); } }).refusal;
  assert.ok(detail.length > 300, `the SSH refusal must exceed the 300-char bound, got ${detail.length}`);
  const oneLineDetail = detail.replace(/\s+/g, ' ').trim();
  for (const check of ['release', 'post-merge', 'remote-prune']) {
    const line = formatSummary({ ...base, skipped: [{ check, reason: 'unknown-host', detail }] });
    assert.strictEqual(line, `skipped: ${check} — unknown-host (${oneLineDetail})`);
    assert.ok(!line.includes('…'), line);
  }
});

test('#4794: formatSummary still truncates a long detail whose reason is not unknown-host', () => {
  const base = { mirror: null, redTip: null, worktrees: null, claims: null, runs: null, branches: null, remoteBranches: null, console: null };
  const detail = 'x'.repeat(400);
  const line = formatSummary({ ...base, skipped: [{ check: 'release', reason: 'gh-failure', detail }] });
  assert.ok(line.includes('…'), line);
  assert.ok(!line.includes(detail), line);
});

test('formatSummary: a skipped entry\'s multi-line detail renders flattened on one line (#4933)', () => {
  const base = { mirror: null, redTip: null, worktrees: null, claims: null, runs: null, branches: null, remoteBranches: null, console: null };
  const detail = 'origin host git.corp.invalid is not known\n  export GH_HOST=git.corp.invalid\r\nthen re-run';
  const line = formatSummary({ ...base, skipped: [{ check: 'post-merge', reason: 'unknown-host', detail }] });
  assert.strictEqual(line, 'skipped: post-merge — unknown-host (origin host git.corp.invalid is not known export GH_HOST=git.corp.invalid then re-run)');
  assert.ok(!/[\r\n]/.test(line), line);
});

test('formatSummary: post-merge entries render as "merged run" taken and skipped lines (#4599)', () => {
  const result = {
    mirror: null, redTip: null, worktrees: null, claims: null, runs: null,
    postMerge: [
      { runDir: 'r1', pr: 11, action: 'ran', closingLinks: 'nothing-closed' },
      { runDir: 'r2', pr: 12, action: 'skipped', reason: 'merge-grace' },
      { runDir: 'r3', pr: 13, action: 'skipped', reason: 'merge-grace' },
    ],
    branches: null, remoteBranches: null, console: null, skipped: null,
  };
  assert.strictEqual(formatSummary(result), [
    'post-merge steps run: 1 merged run',
    'skipped: 2 merged runs (merge-grace 2)',
  ].join('\n'));
  assert.strictEqual(formatSummary({ ...result, postMerge: [{ runDir: 'r1', pr: 11, action: 'ran', closingLinks: 'nothing-closed' }], skipped: null }), 'post-merge steps run: 1 merged run');
  assert.strictEqual(formatSummary({ ...result, postMerge: null }), 'reconcile: nothing to do');
});

test('formatSummary: a post-merge entry whose Step 4.0 failed is reported on its own line, never under "post-merge steps run" (#4599)', () => {
  const base = {
    mirror: null, redTip: null, worktrees: null, claims: null, runs: null, branches: null, remoteBranches: null, console: null, skipped: null,
  };
  const ran = { runDir: 'r1', pr: 11, action: 'ran', closingLinks: 'nothing-closed', parentsClosed: 0 };
  const failed = { runDir: 'r2', pr: 12, action: 'ran', closingLinks: 'exit 5', parentsClosed: 0, step40Failed: true };
  assert.strictEqual(formatSummary({ ...base, postMerge: [ran, failed, { ...failed, runDir: 'r3', pr: 13 }] }), [
    'post-merge steps run: 1 merged run',
    'post-merge steps failed: 2 merged runs',
  ].join('\n'));
  // Only failures: no "steps run" line at all.
  assert.strictEqual(formatSummary({ ...base, postMerge: [failed] }), 'post-merge steps failed: 1 merged run');
  // A failed entry never lands in the aggregated skip line.
  assert.strictEqual(
    formatSummary({ ...base, postMerge: [failed, { runDir: 'r4', pr: 14, action: 'skipped', reason: 'in-flight' }] }),
    ['post-merge steps failed: 1 merged run', 'skipped: 1 merged run (in-flight 1)'].join('\n'),
  );
});

test('AC8.1: a close-failed entry renders under post-merge steps failed, never steps run (#4897)', () => {
  const base = { mirror: null, redTip: null, worktrees: null, claims: null, runs: null, branches: null, remoteBranches: null, console: null, skipped: null };
  const entry = { runDir: 'r1', pr: 11, action: 'ran', closingLinks: 'close-failed', parentsClosed: 0 };
  assert.strictEqual(formatSummary({ ...base, postMerge: [entry] }), 'post-merge steps failed: 1 merged run');
});

test('formatSummary: the failed row names the records the failed runs left, sorted and unique (#4897)', () => {
  const base = { mirror: null, redTip: null, worktrees: null, claims: null, runs: null, branches: null, remoteBranches: null, console: null, skipped: null };
  const closeFailed = { runDir: 'r1', pr: 11, action: 'ran', closingLinks: 'close-failed', parentsClosed: 0, records: { failed: [], closeFailed: [102], pendingClose: [], unchecked: [] } };
  const reopenFailed = { runDir: 'r2', pr: 12, action: 'ran', closingLinks: 'reopen-failed', parentsClosed: 0, records: { failed: [101], closeFailed: [], pendingClose: [], unchecked: [] } };
  assert.strictEqual(
    formatSummary({ ...base, postMerge: [closeFailed, reopenFailed] }),
    'post-merge steps failed: 2 merged runs (records #101, #102)',
  );
  // A clean entry's records never join the list; a failed entry with no records keeps the bare row.
  const clean = { runDir: 'r3', pr: 13, action: 'ran', closingLinks: 'nothing-closed', parentsClosed: 0, records: { failed: [103] } };
  assert.strictEqual(
    formatSummary({ ...base, postMerge: [clean, { runDir: 'r4', pr: 14, action: 'ran', closingLinks: 'close-failed', parentsClosed: 0 }] }),
    ['post-merge steps run: 1 merged run', 'post-merge steps failed: 1 merged run'].join('\n'),
  );
});

test('formatSummary: parents left open and step skips render on their own lines, a marker-write-failed entry\'s included, never dropped (#4798)', () => {
  const base = { mirror: null, redTip: null, worktrees: null, claims: null, runs: null, branches: null, remoteBranches: null, console: null, skipped: null };
  const clean = { runDir: 'r1', pr: 12, action: 'ran', closingLinks: 'nothing-closed', parentsClosed: 0, stepSkips: [{ reason: 'unreadable-policy', detail: 'x' }] };
  const failed = { runDir: 'r2', pr: 13, action: 'ran', closingLinks: 'close-failed', parentsClosed: 0, stepSkips: [{ reason: 'internal-error' }] };
  const unmarked = { runDir: 'r3', pr: 14, action: 'skipped', reason: 'marker-write-failed', parentsClosed: 0, parentFailures: [{ parent: 200, reason: 'gh-failed' }] };
  const errored = { runDir: 'r5', pr: 16, action: 'skipped', reason: 'error', detail: 'boom', parentsClosed: 1, parentFailures: [{ issue: 300, reason: 'internal-error' }], stepSkips: [{ reason: 'invalid-risk-floor' }] };
  assert.strictEqual(formatSummary({ ...base, postMerge: [clean, failed, unmarked, errored] }), [
    'post-merge steps run: 1 merged run',
    'post-merge steps failed: 1 merged run',
    "post-merge Step 4.0b left parent record(s) open: #200 (gh-failed, PR #14), the parent of record #300 (internal-error, PR #16) — tidy's parent-gate backstop recovers them",
    'post-merge Step 4.0b skipped step-wide, leaving no parent open (nothing left to close): unreadable-policy (PR #12), internal-error (PR #13), invalid-risk-floor (PR #16)',
    'skipped: 2 merged runs (marker-write-failed 1, error 1)',
  ].join('\n'));
  assert.strictEqual(formatSummary({ ...base, postMerge: [{ runDir: 'r4', pr: 15, action: 'ran', closingLinks: 'nothing-closed', parentsClosed: 0 }] }), 'post-merge steps run: 1 merged run');
});

test('formatSummary: a taken-over holder\'s GitHub changes render on their own line; its run still folds into the in-flight skip (#4797)', () => {
  const { CLAIM_LOST_DETAIL } = require('../plugin/bin/lib/reconcile/post-merge');
  const base = { mirror: null, redTip: null, worktrees: null, claims: null, runs: null, branches: null, remoteBranches: null, console: null, skipped: null };
  const lost = { runDir: 'r1', pr: 12, action: 'skipped', reason: 'in-flight', detail: CLAIM_LOST_DETAIL, parentsClosed: 1, recordsClosed: [8] };
  assert.strictEqual(formatSummary({ ...base, postMerge: [lost] }), [
    'post-merge steps in run(s) whose claim another pass took over had already changed GitHub: PR #12 closed 1 parent record(s) below the oversight floor, closed #8',
    'skipped: 1 merged run (in-flight 1)',
  ].join('\n'));
  // The line sits after Step 4.0b's lines and before the aggregated skip line.
  const open = { runDir: 'r3', pr: 14, action: 'skipped', reason: 'marker-write-failed', parentsClosed: 0, parentFailures: [{ parent: 200, reason: 'gh-failed' }] };
  assert.strictEqual(formatSummary({ ...base, postMerge: [lost, open] }), [
    "post-merge Step 4.0b left parent record(s) open: #200 (gh-failed, PR #14) — tidy's parent-gate backstop recovers them",
    'post-merge steps in run(s) whose claim another pass took over had already changed GitHub: PR #12 closed 1 parent record(s) below the oversight floor, closed #8',
    'skipped: 2 merged runs (in-flight 1, marker-write-failed 1)',
  ].join('\n'));
  // A superseded holder that changed nothing keeps today's single skip line.
  assert.strictEqual(formatSummary({ ...base, postMerge: [{ runDir: 'r2', pr: 13, action: 'skipped', reason: 'in-flight', detail: CLAIM_LOST_DETAIL }] }), 'skipped: 1 merged run (in-flight 1)');
});

test('formatSummary: a repaired origin/HEAD renders inline (#3132)', () => {
  const result = {
    mirror: null, redTip: null, worktrees: null, claims: null, runs: null,
    branches: null, remoteBranches: null, console: null, skipped: null,
    originHeadRepair: { outcome: 'repaired', branch: 'main' },
  };
  assert.strictEqual(formatSummary(result), 'origin/HEAD repaired (main)');
});

test('formatSummary: a failed origin/HEAD repair renders its reason (#3132)', () => {
  const result = {
    mirror: null, redTip: null, worktrees: null, claims: null, runs: null,
    branches: null, remoteBranches: null, console: null, skipped: null,
    originHeadRepair: { outcome: 'failed', reason: 'git-error' },
  };
  assert.strictEqual(formatSummary(result), 'origin/HEAD repair: failed (git-error)');
});

test('formatSummary: no origin/HEAD repair attempted renders no origin/HEAD line (#3132)', () => {
  const result = {
    mirror: null, redTip: null, worktrees: null, claims: null, runs: null,
    branches: null, remoteBranches: null, console: null, skipped: null,
  };
  assert.ok(!formatSummary(result).includes('origin/HEAD'), formatSummary(result));
});

test('formatSummary: a dry-run residue plan renders one line, counting would-resolve with would-clear and omitting zero parts (#4180)', () => {
  const base = {
    mirror: null, redTip: null, worktrees: null, claims: null, runs: null,
    branches: null, remoteBranches: null, console: null, skipped: null,
  };
  const entry = (action) => ({ action, reason: 'structurally-stuck', path: `/x/${action}` });
  const plan = [entry('would-escalate'), entry('would-track'), entry('would-track'), entry('would-clear'), entry('would-resolve')];
  assert.equal(formatSummary({ ...base, residuePlan: plan }), 'residue (dry run): would escalate 1, would track 2, would clear 2');
  assert.equal(formatSummary({ ...base, residuePlan: [entry('would-track')] }), 'residue (dry run): would track 1');
  assert.equal(formatSummary({ ...base, residuePlan: [] }), 'reconcile: nothing to do');
  assert.equal(formatSummary({ ...base, residuePlan: null }), 'reconcile: nothing to do');
});

test('reconcile verb: compact default separates branch entries from archive-branches.js\'s interleaved tag-aging entries in result.branches (#638)', () => {
  // archive-branches.js pushes both kind:'branch' and kind:'tag' entries into
  // the same result.branches array — a tag's own 'aged-out' action must not
  // be dropped (it matches neither the branch row's takenActions nor
  // skipActions), and a 'delete-failed' skip reason shared by both kinds
  // must disambiguate by unit rather than merging into one branch-labeled
  // count.
  const result = {
    mirror: null,
    redTip: null,
    worktrees: null,
    claims: null,
    runs: null,
    branches: [
      { name: 'worktree-record-1', kind: 'branch', action: 'delete', reason: 'cherry-equivalent' },
      { name: 'worktree-record-2', kind: 'branch', action: 'skip', reason: 'too-young' },
      { name: 'worktree-record-3', kind: 'branch', action: 'skip', reason: 'delete-failed' },
      { name: 'archive/worktree-record-9', kind: 'tag', action: 'aged-out', reason: '> 90d' },
      { name: 'archive/worktree-record-10', kind: 'tag', action: 'skip', reason: 'delete-failed' },
    ],
    remoteBranches: null,
    console: null,
    skipped: null,
  };
  const summary = formatSummary(result);
  assert.strictEqual(summary, [
    'archived: 1 branch',
    'aged out: 1 tag',
    'skipped: 3 items (too-young 1, delete-failed (branch) 1, delete-failed (tag) 1)',
  ].join('\n'));
});

// Runs hooks.js's `main` in-process with `reconcile` and the background spawn
// stubbed (no GitHub, no real child), capturing the JSON stdout of each call.
async function runReconcileVerbStubbed(argvs, { reconcileResult = () => ({ skipped: [] }), spawnResult = { spawned: true, reason: 'spawned' } } = {}) {
  const { main } = require('../plugin/bin/hooks');
  const reconcileMod = require('../plugin/bin/lib/reconcile');
  const spawnMod = require('../plugin/bin/lib/reconcile/background-spawn');
  const originalReconcile = reconcileMod.reconcile;
  const originalSpawn = spawnMod.spawnBackgroundIfStale;
  const originalWrite = process.stdout.write;
  const calls = [];
  const spawnCalls = [];
  const outputs = [];
  reconcileMod.reconcile = async (opts) => { calls.push(opts); return reconcileResult(calls.length - 1); };
  spawnMod.spawnBackgroundIfStale = (args) => { spawnCalls.push(args); return spawnResult; };
  process.stdout.write = (chunk) => { outputs.push(String(chunk)); return true; };
  try {
    for (const argv of argvs) assert.equal(await main(['node', 'hooks.js', ...argv]), 0, `main(${argv.join(' ')}) exit code`);
  } finally {
    reconcileMod.reconcile = originalReconcile;
    spawnMod.spawnBackgroundIfStale = originalSpawn;
    process.stdout.write = originalWrite;
  }
  return { calls, spawnCalls, outputs: outputs.map((o) => JSON.parse(o)) };
}

const INLINE_UNSCOPED_CHECKS = ['mirror', 'red-tip', 'reap', 'release', 'post-merge', 'archive', 'console'];

const DEFERRED_CHECKS = ['archive-branches', 'remote-prune', 'ledger-residue'];

test('AC3.1/AC3.2: hooks.js reconcile: an explicit --checks subset runs unbounded; an unscoped pass keeps the default budget', async () => {
  const { calls } = await runReconcileVerbStubbed([
    ['reconcile', '--checks', 'reap', '--json'],
    ['reconcile', '--json'],
  ]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].budgetMs, Infinity);
  assert.deepEqual(calls[0].checks, ['reap']);
  assert.equal(calls[1].budgetMs, undefined);
  // The unscoped CLI names its inline set: ALL_CHECKS minus the three checks
  // deferred to the background pass (#4032).
  assert.deepEqual(calls[1].checks, INLINE_UNSCOPED_CHECKS);
  // An explicit subset never stamps the shared freshness key; an unscoped pass still does.
  assert.equal(calls[0].skipCacheStamp, true);
  assert.equal(calls[1].skipCacheStamp, undefined);
});

test('unscoped CLI defers three checks and spawns the background pass (#4032)', async () => {
  const { calls, spawnCalls, outputs } = await runReconcileVerbStubbed([['reconcile', '--json']]);
  assert.equal(spawnCalls.length, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(outputs[0].skipped, [{ check: 'archive-branches,remote-prune,ledger-residue', reason: 'deferred-to-background' }]);
  assert.deepEqual(outputs[0].background, { checks: DEFERRED_CHECKS, spawned: true, reason: 'spawned' });
});

test('unscoped CLI reports the helper reason when the background pass is fresh (#4032)', async () => {
  const { outputs } = await runReconcileVerbStubbed([['reconcile', '--json']], { spawnResult: { spawned: false, reason: 'fresh' } });
  assert.deepEqual(outputs[0].background, { checks: DEFERRED_CHECKS, spawned: false, reason: 'fresh' });
});

test('unscoped CLI never spawns under --dry-run or on a no-remote fixture (#4032)', async () => {
  const dir = noRemoteFixture('ct-recon-bg-noremote-');
  const r = runHook(['reconcile', '--dry-run', '--json'], { cwd: dir });
  assert.strictEqual(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.deepStrictEqual(parsed.background, { checks: DEFERRED_CHECKS, spawned: false, reason: 'not-converged' });
  assert.deepStrictEqual(parsed.skipped, [{ check: 'all', reason: 'no-remote' }]);

  const { spawnCalls, outputs } = await runReconcileVerbStubbed([['reconcile', '--dry-run', '--json']]);
  assert.equal(spawnCalls.length, 0);
  assert.equal(outputs[0].background.spawned, false);
  assert.equal(outputs[0].background.reason, 'dry-run');
  assert.deepEqual(outputs[0].skipped, [{ check: 'archive-branches,remote-prune,ledger-residue', reason: 'deferred-to-background' }]);
});

test('unscoped CLI treats a local-merge-model skip as not converged: no deferral entry, skipped untouched (#4032)', async () => {
  const lmSkip = { check: 'mirror,release,post-merge,archive,archive-branches,remote-prune,ledger-residue,console', reason: 'local-merge-model' };
  const { spawnCalls, outputs } = await runReconcileVerbStubbed([['reconcile', '--json']], {
    reconcileResult: () => ({ skipped: [lmSkip] }),
  });
  assert.equal(spawnCalls.length, 0);
  assert.deepEqual(outputs[0].skipped, [lmSkip]);
  assert.deepEqual(outputs[0].background, { checks: DEFERRED_CHECKS, spawned: false, reason: 'not-converged' });
});

test('unscoped CLI treats a gh-preflight skip as not converged and keeps the deferred checks accounted for (#4032)', async () => {
  // What the real reconcile() emits: the inline gh-dependent checks (every inline check but mirror).
  const pfSkip = { check: INLINE_UNSCOPED_CHECKS.filter((c) => c !== 'mirror').join(','), reason: 'preflight-gh-absent' };
  const { spawnCalls, outputs } = await runReconcileVerbStubbed([['reconcile', '--json']], {
    reconcileResult: () => ({ skipped: [pfSkip] }),
  });
  assert.equal(spawnCalls.length, 0);
  assert.deepEqual(outputs[0].skipped, [
    pfSkip,
    { check: 'archive-branches,remote-prune,ledger-residue', reason: 'preflight-gh-absent' },
  ]);
  assert.equal(outputs[0].background.reason, 'not-converged');
});

test('unscoped CLI: a module-load failure still prints the reconcile-threw JSON (#4032)', async () => {
  const reconcileMod = require('../plugin/bin/lib/reconcile');
  for (const prop of ['ALL_CHECKS', 'NOT_CONVERGED_REASONS']) {
    const desc = Object.getOwnPropertyDescriptor(reconcileMod, prop);
    Object.defineProperty(reconcileMod, prop, { configurable: true, enumerable: true, get() { throw new Error('load failed: ' + prop); } });
    try {
      const { outputs } = await runReconcileVerbStubbed([['reconcile', '--json']]);
      assert.deepEqual(outputs[0].skipped, [{ check: 'all', reason: 'reconcile-threw' }], prop);
      assert.deepEqual(outputs[0].background, { checks: DEFERRED_CHECKS, spawned: false, reason: 'not-converged' }, prop);
    } finally {
      Object.defineProperty(reconcileMod, prop, desc);
    }
  }
});

test('reconcile verb: a post-merge.js load fault still renders the reconcile-threw line in the compact output, not a silent exit 0 (#4897)', () => {
  // A child process, so the fault is planted in its module loader only: the child preloads a script that makes any
  // require resolving to reconcile/post-merge.js throw. format-summary.js is required outside hooks.js's try, so a
  // module-level require of post-merge.js there would throw past the fallback and main's catch would exit 0 silently.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-loadfault-'));
  const preload = path.join(scratch, 'fault.js');
  fs.writeFileSync(preload, [
    "const Module = require('module');",
    "const path = require('path');",
    'const load = Module._load;',
    'Module._load = function (request, parent, isMain) {',
    '  let file = null;',
    '  try { file = Module._resolveFilename(request, parent, isMain); } catch { /* the real loader reports it */ }',
    "  if (file && file.endsWith(path.join('reconcile', 'post-merge.js'))) throw new Error('planted load fault');",
    '  return load.apply(this, arguments);',
    '};',
    '',
  ].join('\n'));
  const dir = noRemoteFixture('ct-recon-loadfault-repo-');
  const r = runHook(['reconcile', '--dry-run'], { cwd: dir, env: { NODE_OPTIONS: requireOption(preload) } });
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /^skipped: all — reconcile-threw$/m);
});

test('unscoped CLI still defers and spawns when the pass carries a report-only non-canonical-run-dir skip (#4032)', async () => {
  const reportOnly = { check: 'all', reason: 'non-canonical-run-dir', names: ['20260911T101010-x'] };
  const { spawnCalls, outputs } = await runReconcileVerbStubbed([['reconcile', '--json']], {
    reconcileResult: () => ({ skipped: [reportOnly] }),
  });
  assert.equal(spawnCalls.length, 1);
  assert.deepEqual(outputs[0].skipped, [reportOnly, { check: 'archive-branches,remote-prune,ledger-residue', reason: 'deferred-to-background' }]);
  assert.deepEqual(outputs[0].background, { checks: DEFERRED_CHECKS, spawned: true, reason: 'spawned' });
});

test('NOT_CONVERGED_REASONS names every early-return skip reason reconcile() emits (#4032)', () => {
  const { NOT_CONVERGED_REASONS } = require('../plugin/bin/lib/reconcile');
  for (const r of ['no-repo', 'no-remote', 'fresh-cache', 'local-merge-model', 'reconcile-threw']) {
    assert.ok(NOT_CONVERGED_REASONS.has(r), r);
  }
  assert.equal(NOT_CONVERGED_REASONS.has('non-canonical-run-dir'), false);
  assert.equal(NOT_CONVERGED_REASONS.has('budget-exceeded'), false);
});

test('unscoped CLI never spawns when reconcile() throws (#4032)', async () => {
  const { spawnCalls, outputs } = await runReconcileVerbStubbed([['reconcile', '--json']], {
    reconcileResult: () => { throw new Error('boom'); },
  });
  assert.equal(spawnCalls.length, 0);
  assert.deepEqual(outputs[0].skipped, [{ check: 'all', reason: 'reconcile-threw' }]);
  assert.equal(outputs[0].timings, null);
  assert.deepEqual(outputs[0].background, { checks: DEFERRED_CHECKS, spawned: false, reason: 'not-converged' });
});

test('explicit --checks output has no background key (#4032)', async () => {
  const { spawnCalls, outputs } = await runReconcileVerbStubbed([['reconcile', '--checks', 'reap', '--json']]);
  assert.equal(spawnCalls.length, 0);
  assert.equal('background' in outputs[0], false);
  assert.deepEqual(outputs[0].skipped, []);
});

test('AC4.1: SessionStart passes no budgetMs (default budget); the background pass passes only its own BACKGROUND_BUDGET_MS (#4032)', () => {
  const sessionStart = readText(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'session-start.js'));
  assert.equal(sessionStart.includes('budgetMs'), false);
  const hooksSrc = readText(path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js'));
  assert.equal(hooksSrc.split('budgetMs').length - 1, 2, 'budgetMs occurs twice in hooks.js — the reconcile CLI branch and the background call site');
  const bgLine = hooksSrc.split('\n').find((l) => l.includes('checks: BACKGROUND_CHECKS'));
  assert.ok(bgLine, 'background reconcile call site found');
  assert.ok(bgLine.includes('budgetMs: BACKGROUND_BUDGET_MS'), 'the background pass runs under its own ceiling, not the 18 s hot-path default');
});
