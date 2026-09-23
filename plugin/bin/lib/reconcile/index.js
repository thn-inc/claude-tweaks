// bin/lib/reconcile/index.js — the reconciler's one exported entry point.
// Converges local state toward origin under the pr-first integration model:
// idempotent, safe from any session at any time. Never breaks a session —
// every error path degrades to a reported skip, never a thrown exception.
// Concurrency posture: two racing reconciles converge rather than conflict —
// the ff is a strict `--ff-only` (git itself refuses a non-ff), claim
// release rides the claim blob's own conditional-write semantics, and every
// check re-verifies state immediately before writing. Safe by these
// per-check properties, not by a global lock.
'use strict';
const { mainCheckoutRoot } = require('../hooks/worktree-detect');
const { findNonCanonicalRunDirs } = require('../hooks/context');
const { resolveIntegrationBranch, bareIntegrationName, reapWorktrees: legacyReapWorktrees } = require('../hooks/worktree-reap');
const { resolveIntegrationModel } = require('../policy-schema');
const { mirrorFastForward } = require('./mirror-ff');
const { redTipCheck } = require('./red-tip');
const { reapMerged } = require('./reap-merged');
const { releaseMerged } = require('./release-merged');
const { archiveMerged } = require('./archive-merged');
const { archiveBranches } = require('./archive-branches');
const { pruneRemote } = require('./prune-remote');
const { consoleExecuteDetect } = require('./console-execute');
const { sharedFetch, sharedFetchAsync } = require('./shared-fetch');
const { createIssueListCache } = require('./issue-list-cache');
const {
  readCache, writeCache, isFresh, SHARED_HEALTH_TTL_MS,
} = require('./cache');
const { formatReconcileSummary, archivedCountFromRunsResult } = require('./residue-summary');

// Execution order (mirror, red-tip, console, release, archive,
// archive-branches, remote-prune, reap) is significant — see the ordering
// comment above the release/archive/archive-branches/reap dispatch below.
// red-tip runs immediately after mirror specifically so it reads the ref the
// shared fetch (shared-fetch.js, #820 D2 — formerly mirror-ff.js's own
// fetch) just refreshed, rather than fetching a second time (#561). This
// array is the requested-subset default only; it is never iterated to
// determine dispatch order.
const ALL_CHECKS = ['mirror', 'red-tip', 'reap', 'release', 'archive', 'archive-branches', 'remote-prune', 'console'];

// opts: { dryRun?: boolean, checks?: string[], cwd?: string, sessionId?: string }
// -> { mirror, worktrees, claims, runs, branches, console, skipped }
// `sessionId`, when the caller has one, threads through to archiveMerged's
// own `isAbandonedInterrupted` ownership check (archive-merged.js) — omitted
// (undefined), archiveMerged falls back to its own
// `process.env.CLAUDE_CODE_SESSION_ID` default, unchanged from before this
// option existed.
// This module is gh-CLI-only by design (a Node subprocess cannot reach an
// agent session's MCP tools), so a gh-absent environment reports that reason
// per-check rather than attempting an MCP fallback (see
// `_shared/integration-model.md`).
async function reconcile(opts = {}) {
  const dryRun = !!opts.dryRun;
  let checks = Array.isArray(opts.checks) && opts.checks.length ? opts.checks : ALL_CHECKS;
  const cwd = opts.cwd || process.cwd();
  const result = { mirror: null, redTip: null, worktrees: null, claims: null, runs: null, branches: null, remoteBranches: null, console: null, skipped: [] };

  // Declined-learning store prune (#1399) — local, gitignored bookkeeping unrelated to git/
  // GitHub reachability, so it runs unconditionally on every reconcile pass regardless of
  // `checks`, the integration model, or whether this even resolves to a repo — the store's own
  // path is process.cwd()-relative (no root param on this module today, matching every existing
  // caller: /feedback and /reflect never pass one either), so this deliberately does not thread
  // `root` through. Best-effort: a prune failure never blocks the rest of the pass.
  try {
    require('../declined-learning/store').pruneDeclines();
  } catch {
    /* best-effort — never break reconcile over declined-learning maintenance */
  }

  const root = mainCheckoutRoot(cwd);
  if (!root) {
    result.skipped.push({ check: 'all', reason: 'no-repo' });
    return result;
  }

  // #848: a non-canonical (dash-less) run-dir name is invisible to
  // iterRunDirsWithState's RUN_ID_RE filter, so every check below silently
  // omits it forever — surface it once, unconditionally, ahead of every
  // other gate (skipIfFresh, no-remote, local-merge, gh preflight, budget),
  // since it's a pure fs read and every one of those gates can otherwise
  // return before a check that would have found it ever runs. Report-only:
  // never renamed, never adopted as a run.
  const nonCanonical = findNonCanonicalRunDirs(root);
  if (nonCanonical.length) {
    result.skipped.push({ check: 'all', reason: 'non-canonical-run-dir', names: nonCanonical });
  }

  // Whole-pass freshness short-circuit (#820, D7) — opt-in only (default
  // false), so every existing direct caller of reconcile() (including the
  // standalone `reconcile` CLI subcommand and every test written before this
  // task) keeps today's always-runs semantics. Distinct from the GitHub-
  // health preflight below: that answers "is GitHub reachable right now,"
  // this answers "did any session already do this very recently." Checked
  // before resolveIntegrationBranch/resolveIntegrationModel so a fresh cache
  // costs zero I/O, not just zero network calls.
  if (opts.skipIfFresh) {
    const cache = readCache(root);
    if (isFresh(cache, Date.now(), opts.ttlMs)) {
      result.skipped.push({ check: 'all', reason: 'fresh-cache' });
      return result;
    }
  }

  // #1688: resolveIntegrationBranch's policy-configured path can now return
  // an `origin/{name}` remote-tracking ref (preferRemoteTrackingRef,
  // worktree-reap.js). Every downstream consumer of `integration` in this
  // module (classify.js, mirror-ff.js, red-tip.js, shared-fetch.js) builds
  // its own `origin/${integration}` ref or issues `git fetch origin
  // {integration}` on the assumption that `integration` is bare — normalize
  // once here so the whole module keeps that contract.
  const integration = bareIntegrationName(resolveIntegrationBranch(root, opts.cache));
  if (!integration) {
    result.skipped.push({ check: 'all', reason: 'no-remote' });
    return result;
  }

  // #1558: forwards the caller's own already-confirmed MCP-reachability
  // verdict into detectIntegrationModel's mcpReachable override (the same
  // deps-seam bin/resolve-policy.js's --mcp-reachable flag already uses),
  // so a gh-absent-but-GitHub-MCP-reachable sandbox doesn't silently
  // downgrade to local-merge. Undefined/false by default — every internal,
  // hook-context caller of reconcile() (session-start.js, pre-compact) has
  // no agent turn to probe from and is unaffected, matching the same
  // permanent, structural gap pre-tool-use.js's own PR-stamp branch already
  // documents (IL-63) rather than working around it there.
  const resolveModel = opts.resolveIntegrationModel || resolveIntegrationModel;
  const model = resolveModel(root, { mcpReachable: opts.mcpReachable === true });
  if (model !== 'pr-first') {
    // local-merge / no-forge: only `reap` has a defined fallback here — the
    // long-standing content-identical ancestry check worktree-reap.js has
    // always run (#407's Non-Goals: no local-merge behavior change). mirror
    // (nothing to fast-forward toward — there is no PR-lifecycle mirror
    // under this model), release, and archive have no local-merge
    // equivalent and stay skipped.
    if (checks.includes('reap')) {
      const legacy = legacyReapWorktrees({ cwd: root, integration, dryRun, now: opts.now });
      result.worktrees = legacy.reaped.map((p) => ({ path: p, action: 'reaped' }))
        .concat(legacy.skipped.map((s) => ({ path: s.path, action: 'skipped', reason: s.reason })));
      // MAX_EXAMINED_PER_RUN candidates the legacy reaper never got to this
      // pass — never drop this silently (CLAUDE.md: no silent caps). No
      // per-worktree path to attach it to, so it lands as its own skipped
      // entry with a count rather than one of the per-path ones above.
      if (legacy.deferred) {
        result.skipped.push({ check: 'reap', reason: 'deferred', count: legacy.deferred });
      }
    }
    result.skipped.push({ check: 'mirror,release,archive,archive-branches,remote-prune,console', reason: 'local-merge-model' });
    return result;
  }

  // GitHub-health preflight — every check EXCEPT mirror is network-dependent
  // under pr-first (red-tip/console/release/remote-prune hit GitHub
  // directly; archive/archive-branches/reap all call resolvePrState, also a
  // gh call) — so a single upfront failure/timeout (~2s) skips the whole
  // gh-dependent subset in one entry, instead of each check separately
  // accumulating its own 5-10s timeout (#820). `mirror` is pure git
  // (mirror-ff.js never shells to `gh`) and is deliberately excluded from
  // this gate: a rate-limited/degraded GitHub REST API must not also block a
  // local fast-forward that git alone can still complete (review finding —
  // this gate previously skipped mirror too, a regression from before this
  // check existed). Narrowing `checks` (rather than an extra `&& ghOk` guard
  // on every dispatch line below) means every existing `checks.includes(...)`
  // check downstream stays correct with no further changes. Called via
  // require(...).ghHealthCheck() rather than a module-load-time destructure
  // so a test's `require('./preflight').ghHealthCheck = fn` monkeypatch
  // actually reaches this call site.
  const ghDependentChecks = checks.filter((c) => c !== 'mirror');
  // #872: the FAST_CHECKS shape (mirror requested, remote-prune not — the
  // same "mirror only" shape shared-fetch.js's own header names) runs this
  // preflight and the shared git fetch below concurrently via Promise.all,
  // instead of paying for both serially — sibling code in the same diff
  // (pr-state.js's resolvePrStateAsync) already established the async
  // execFile pattern this reuses (ghHealthCheckAsync, sharedFetchAsync).
  // Computed from `checks` BEFORE the narrowing below, so a request that
  // ever included remote-prune stays on the sequential path even if a
  // preflight failure later narrows `checks` down to mirror-only —
  // ALL_CHECKS/mixed and BACKGROUND_CHECKS are explicitly out of scope for
  // this concurrency and must not gain it incidentally through narrowing.
  const fastChecksShape = checks.includes('mirror') && !checks.includes('remote-prune');
  // #873: session-start.js's inline FAST_CHECKS call and the detached
  // reconcile-background child it spawns moments later (same SessionStart
  // firing) are separate process invocations of this function, each
  // independently paying for a `gh api rate_limit` reachability probe —
  // even though GitHub's reachability a few seconds old, as just confirmed
  // by a sibling process, is still a valid answer. Reuse it instead of
  // re-probing.
  //
  // Deliberately does NOT extend to the shared git fetch below:
  // shared-fetch.js's own header documents the fetch SHAPE as a strict
  // partition by caller — mirror-only's single-ref fetch is narrower than
  // remote-prune's full `--prune` fetch, never the reverse — and
  // session-start.js's inline pass only ever requests the narrow shape
  // while the background pass that follows it only ever requests the wide
  // one. The inline pass's fetch can therefore never safely stand in for
  // the background pass's: reusing it would silently starve remote-prune
  // of the ref data and stale-branch pruning only the wide fetch performs.
  // Scoped to the preflight probe alone — not a general fetch-dedup.
  const now = Date.now();
  const healthFresh = ghDependentChecks.length > 0
    && isFresh(readCache(root), now, SHARED_HEALTH_TTL_MS, 'lastHealthCheckOkAt');
  let health = null;
  // Set only by the concurrent branch below — the sequential fetch dispatch
  // further down reuses it instead of fetching a second time.
  let concurrentFetch = null;
  if (healthFresh) {
    health = { ok: true };
  } else if (ghDependentChecks.length) {
    if (fastChecksShape) {
      [health, concurrentFetch] = await Promise.all([
        require('./preflight').ghHealthCheckAsync(),
        sharedFetchAsync(root, { integration }),
      ]);
    } else {
      health = require('./preflight').ghHealthCheck();
    }
  }
  // Deliberately NOT written here — mirror's own dispatch (further below)
  // determines dirty/clean via a live `git status --porcelain`, and a cache
  // write landing in `.claude-tweaks/` BEFORE that check runs can flip its
  // classification in a checkout whose `.gitignore` doesn't yet cover this
  // file (observed live: a from-scratch fixture repo with no `.gitignore`
  // read mirror as 'dirty' purely because this write created an untracked
  // file first). `healthJustSucceeded` carries the fact forward to the one
  // combined cache write at the end of this function, alongside `lastRunAt`
  // — after every dispatch, mirror included, has already read the tree.
  const healthJustSucceeded = !!(health && health.ok && !healthFresh);
  if (health && !health.ok) {
    result.skipped.push({ check: ghDependentChecks.join(','), reason: `preflight-${health.reason}` });
    checks = checks.filter((c) => c === 'mirror');
    if (!checks.length) return result;
  }

  // Overall wall-clock ceiling for the rest of this pass (#820, D4) — bounds
  // the SUM of every dispatched check's time, not any single check's own
  // timeout. Created once here via require(...).createBudget() rather than a
  // module-load-time destructure, so a test's
  // `require('./budget').createBudget = fn` monkeypatch reaches this call
  // site. Checked before each of the 8 dispatch blocks below, in dispatch
  // order; each guard's slice is "every requested check from here on",
  // so a budget exhausted mid-pass reports the whole remainder in one
  // `skipped` entry and returns immediately rather than running a partial
  // remainder.
  const budget = require('./budget').createBudget();
  // #2505 — one shared per-pass memo for the `gh issue list` fetch
  // escalateResidue/resolveResidue's own findResidueDuplicate issues,
  // reused across every stuck dir/path archive+reap escalate or resolve in
  // THIS pass — created fresh every reconcile() call (never a module-level
  // singleton), so nothing here survives across passes or processes.
  const issueListCache = createIssueListCache();
  const DISPATCH_ORDER = ['mirror', 'red-tip', 'console', 'release', 'archive', 'archive-branches', 'remote-prune', 'reap'];
  function overBudget(remainingFromHere) {
    if (!budget.exceeded()) return false;
    const notYetRun = remainingFromHere.filter((c) => checks.includes(c));
    if (notYetRun.length) result.skipped.push({ check: notYetRun.join(','), reason: 'budget-exceeded' });
    return true;
  }

  if (overBudget(DISPATCH_ORDER.slice(0))) return result;
  // One shared `git fetch` for whichever of mirror/red-tip/remote-prune are
  // requested — mirror (via classify.js) and remote-prune previously each
  // ran their own separate fetch, two full round trips to the same remote
  // per pass (#820, D2). Its SHAPE is scoped to what was actually requested
  // (narrow single-ref + a tight hot-path cap for a mirror-only pass, full
  // `--prune` all-refs on git-exec's own env-overridable budget once
  // remote-prune is in the set) — see shared-fetch.js's header for why each
  // shape is what it is. `sharedFetchOk` gates all three dispatch blocks
  // below: red-tip is included even though it triggers no fetch itself,
  // because it reads the ref this fetch (formerly mirror's own) just
  // refreshed — see the ordering comment on red-tip's dispatch below. A
  // failed fetch is recorded once here rather than once per check. For the
  // FAST_CHECKS shape (#872), `concurrentFetch` already carries this
  // fetch's result — it ran above, concurrently with the preflight, rather
  // than being dispatched here a second time.
  let sharedFetchOk = true;
  const wantsMirror = checks.includes('mirror');
  const wantsRemotePrune = checks.includes('remote-prune');
  // Whether the fetch actually ran this pass, not just whether it ran
  // without error — sharedFetchOk alone defaults to `true` even when the
  // block below never executes at all (neither mirror nor remote-prune
  // requested), which would let red-tip's gate below silently read a
  // never-refreshed local ref if a future `checks` subset ever requests
  // red-tip without either (#820 review — currently unreachable, since
  // every caller's FAST_CHECKS/ALL_CHECKS pairs red-tip with mirror, but the
  // gate should say so rather than rely on that pairing holding forever).
  const fetchRan = wantsMirror || wantsRemotePrune;
  if (fetchRan) {
    const fetched = concurrentFetch || sharedFetch(root, { integration, mirror: wantsMirror, remotePrune: wantsRemotePrune });
    if (fetched.failure) {
      sharedFetchOk = false;
      const affected = ['mirror', 'red-tip', 'remote-prune'].filter((c) => checks.includes(c));
      if (affected.length) result.skipped.push({ check: affected.join(','), reason: 'fetch-failed' });
    }
  } else if (checks.includes('red-tip')) {
    result.skipped.push({ check: 'red-tip', reason: 'no-fetch-this-pass' });
  }
  if (checks.includes('mirror') && sharedFetchOk) {
    result.mirror = mirrorFastForward(root, integration, { skipFetch: true });
  }

  // Detection only — never mutates repo/run state. Reads origin/{integration}
  // via the shared fetch above (formerly mirror-ff.js's own fetch) —
  // deliberately no fetch of its own (#561). Placed immediately after mirror
  // for that reason; unconditional under pr-first, no local-merge equivalent
  // (the model !== 'pr-first' early-return above already exits before this
  // line). Gated on `sharedFetchOk` too: a failed shared fetch leaves
  // origin/{integration} exactly as stale as a failed mirror fetch used to,
  // so red-tip has nothing fresh to read either. Also gated on `fetchRan`
  // (see above) — `sharedFetchOk` alone can't distinguish "fetch ran and
  // succeeded" from "fetch never ran," and only the former actually
  // refreshed the ref red-tip reads.
  if (overBudget(DISPATCH_ORDER.slice(1))) return result;
  if (checks.includes('red-tip') && sharedFetchOk && fetchRan) {
    result.redTip = redTipCheck(root, integration, {
      onSkip: (reason) => result.skipped.push({ check: 'red-tip', reason }),
    });
  }

  // Detection only — never mutates repo/run state, so its position relative
  // to release/archive/reap's own ordering constraints (below) is
  // unconstrained. Placed here, right after mirror, since it needs neither a
  // worktree-list join nor merged-PR evidence, unlike the three that follow.
  if (overBudget(DISPATCH_ORDER.slice(2))) return result;
  if (checks.includes('console')) {
    result.console = await consoleExecuteDetect({ cwd: root });
  }

  // Ordering is load-bearing, not incidental: release, archive, and
  // archive-branches all derive a run's branch from a live `git worktree
  // list` (matched by the worktree path run-state.json recorded, or, for
  // archive-branches, by branch attachment directly). `reap` PHYSICALLY
  // REMOVES worktrees — running it first would make every subsequent
  // check's branch derivation fail for exactly the runs `reap` just
  // finished with, silently starving `release`/`archive`/`archive-branches`
  // of the runs most likely to qualify (a just-reaped worktree's PR is, by
  // construction, merged — the same evidence those checks are looking
  // for). `reap` runs LAST among the five for this reason — the same class
  // of hazard `bin/lib/hooks/session-start.js` already documents for its
  // own stale-run-scan-before-reap ordering.
  if (overBudget(DISPATCH_ORDER.slice(3))) return result;
  if (checks.includes('release')) {
    // Release performs one write kind (a conditional-overwrite of the claim
    // blob) with no meaningful "preview" — unlike ff/reap/archive, there is
    // no local state to diff against. dry-run skips it outright rather than
    // half-implementing a preview for a network write.
    if (dryRun) {
      result.skipped.push({ check: 'release', reason: 'dry-run-not-supported' });
    } else {
      const r = await releaseMerged({ cwd: root });
      if (r.failure) {
        result.skipped.push({ check: 'release', reason: r.failure });
      } else {
        result.claims = r.released.map((c) => ({ ...c, action: 'released' }))
          .concat(r.skipped.map((s) => ({ ...s, action: 'skipped' })));
      }
    }
  }

  if (overBudget(DISPATCH_ORDER.slice(4))) return result;
  if (checks.includes('archive')) {
    const r = archiveMerged({
      cwd: root, dryRun, sessionId: opts.sessionId, runner: issueListCache.runner, integration,
    });
    result.runs = r.archived.map((d) => ({ runDir: d, action: 'archived' }))
      .concat(r.skipped.map((s) => ({ runDir: s.runDir, action: 'skipped', reason: s.reason })));
  }

  // Same live-ref dependency as release/archive: derives branch state from
  // refs reap may remove. Runs after archive (run-dir archival may release
  // branch attachments), before reap (which stays last — see above).
  if (overBudget(DISPATCH_ORDER.slice(5))) return result;
  if (checks.includes('archive-branches')) {
    const r = archiveBranches({ cwd: root, integration, dryRun });
    if (r.failure) {
      result.skipped.push({ check: 'archive-branches', reason: r.failure });
    } else {
      result.branches = r.entries;
    }
  }

  // The family's one pushed mutation (see prune-remote.js's header for the
  // two-signal evidence bar). Same live-ref dependency as archive-branches:
  // the worktree-attachment guard must read worktrees reap has not yet
  // removed, so this too runs before reap (which stays last — see above).
  if (overBudget(DISPATCH_ORDER.slice(6))) return result;
  if (checks.includes('remote-prune') && sharedFetchOk) {
    const r = pruneRemote({ cwd: root, integration, dryRun, skipFetch: true });
    if (r.failure) {
      result.skipped.push({ check: 'remote-prune', reason: r.failure });
    } else {
      result.remoteBranches = r.entries;
    }
  }

  if (overBudget(DISPATCH_ORDER.slice(7))) return result;
  if (checks.includes('reap')) {
    // #644 review fix: pass the caller's actual `cwd`, not the already-
    // resolved `root` every other dispatch line above uses. reapMerged's own
    // `isOwnCwd` guard (#644 Deliverable 1) exists specifically to detect
    // "the calling session is standing inside this candidate worktree right
    // now" — that's only knowable from the real caller cwd. reapMerged
    // re-derives `root` from `cwd` internally the same way this function
    // did above, so passing `cwd` costs nothing for every other candidate's
    // git-worktree-list-driven logic; passing `root` here instead made the
    // own-cwd guard permanently unreachable through this entry point (`here`
    // was always the main checkout, never inside any worktree), even though
    // reap-merged.test.js's isolated calls (which pass a worktree path
    // directly) still exercised and passed.
    const r = reapMerged({ cwd, dryRun, runner: issueListCache.runner });
    if (r.failure) {
      result.skipped.push({ check: 'reap', reason: r.failure });
    } else {
      result.worktrees = r.reaped.map((p) => ({ path: p, action: 'reaped' }))
        .concat(r.skipped.map((s) => ({ path: s.path, action: 'skipped', reason: s.reason, prNumber: s.prNumber })));
    }
  }

  // Stamp freshness only on a fully-completed pr-first pass — every earlier
  // return in this function (no-repo, no-remote, local-merge fallback,
  // preflight failure, budget-exceeded, and the skipIfFresh short-circuit
  // itself) exits above this line and never reaches it, so a failed or
  // partial pass never gets recorded as "fresh" for a future skipIfFresh
  // check (#820, D7). `opts.skipCacheStamp` (#644 review fix) is the one
  // exception: `bin/hooks.js reconcile-summary`'s own internal
  // `checks: ['mirror']` call sets it, since this stamp is keyed on
  // `lastRunAt` alone — it cannot distinguish "the FULL requested subset
  // just finished" from "a narrow mirror-only probe just finished" — and
  // `session-start.js`'s FAST_CHECKS call reads the exact same key via its
  // own `skipIfFresh` gate. Without this opt-out, every `/claude-tweaks:flow`
  // closing report would silently stamp the shared cache as fresh, and the
  // next SessionStart within `DEFAULT_TTL_MS` would skip its own
  // mirror/red-tip/console pass believing it already ran — silently
  // suppressing red-tip's CI-failure surfacing for up to 7 minutes after
  // every successful flow completion. No other caller sets this option, so
  // every existing stamp-dependent behavior (including session-start.js's
  // own FAST_CHECKS call, which both stamps and reads this key by design)
  // is unchanged.
  // #873: `lastHealthCheckOkAt` (set above as `healthJustSucceeded`, never
  // written until now — see that comment for why) rides along in the same
  // write rather than a separate one, whether or not `skipCacheStamp`
  // suppresses `lastRunAt` this pass: it answers a different, narrower
  // question ("is GitHub reachable") that stays valid regardless of which
  // checks subset just ran, so `bin/hooks.js reconcile-summary`'s own
  // mirror-only skipCacheStamp caller still benefits a sibling process —
  // though in practice that caller's checks are mirror-only, so
  // `healthJustSucceeded` is always false for it anyway.
  if (!opts.skipCacheStamp || healthJustSucceeded) {
    const cache = readCache(root);
    const update = { ...cache };
    if (!opts.skipCacheStamp) update.lastRunAt = Date.now();
    if (healthJustSucceeded) update.lastHealthCheckOkAt = now;
    writeCache(root, update);
  }

  // #644 Deliverable 3 — the one-line residue summary /claude-tweaks:flow's
  // closing report renders, attached to the same JSON this function already
  // returns (never a second data source): archived count from this pass's
  // own `runs`, stuck count/age from the residue cache `archive`/`reap`
  // (Deliverable 2) just finished updating, mirror ff outcome from this
  // pass's own `mirror` when `mirror` was among the requested checks.
  result.residueSummary = formatReconcileSummary(root, {
    archivedCount: archivedCountFromRunsResult(result),
    mirror: result.mirror,
  });
  return result;
}

module.exports = { reconcile, ALL_CHECKS, formatReconcileSummary };
