---
files:
  - plugin/bin/lib/hooks/session-start.js
  - plugin/bin/lib/reconcile/index.js
  - plugin/bin/lib/reconcile/preflight.js
  - plugin/bin/lib/reconcile/cache.js
  - plugin/bin/lib/reconcile/budget.js
  - plugin/bin/lib/reconcile/shared-fetch.js
  - plugin/bin/lib/reconcile/gh-pool.js
  - plugin/bin/lib/reconcile/release-merged.js
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/lib/reconcile/pr-state.js
  - plugin/bin/lib/reconcile/origin-head.js
  - plugin/bin/lib/reconcile/ledger-residue.js
  - plugin/bin/hooks.js
---

# Session Start: Fast Advisory Pass With a Background Reconcile

**Persona:** Developer starting a Claude Code session in a `pr-first` claude-tweaks repo that has accumulated stale state — old worktrees, merged-but-unclosed branches, stale issue claims — sometimes with GitHub itself degraded or unreachable.
**Goal:** The first message arrives quickly and carries the checks that matter immediately (mirror position, red-tip, ready consoles); the slower janitorial cleanup (release, archive, archive-branches, remote-prune, ledger-residue, reap) happens without blocking, and its result shows up the next time a session starts.
**Entry point:** Starting any Claude Code session in the repo — `SessionStart` hook fires automatically.
**Success state:** The session's first message is not delayed by network-dependent janitorial work; on a healthy repo it completes in low single digits of seconds instead of scaling with however much stale branch/claim/console state exists; when GitHub is unreachable or degraded, the fast pass still returns promptly instead of accumulating per-call timeouts; the previous background pass's outcome (what it did, what it skipped and why) appears as plain, readable context on the next session start rather than being silently lost.

## Steps

### 1. Session starts — the fast pass runs inline
- **Action:** `SessionStart` fires `session-start.js`'s `run(ctx)`, which calls `reconcile()` inline for only `mirror`, `red-tip`, and `console` — a short-TTL freshness cache (`cache.js`) short-circuits the whole call first if another session already reconciled this repo within the last few minutes, then a GitHub-health preflight (`preflight.js`, ~2s — up to ~4s when its single retry-on-timeout fires, #2567) runs and skips the rest of the pass on failure, and an overall wall-clock pass budget (`budget.js`) bounds the sum of whatever checks do run so a slow network can't turn the fast pass into a stall — `shared-fetch.js` keeps the mirror/red-tip pair to one fetch round trip. On a fresh clone with no local `origin/HEAD` (common in a cloud/Routine sandbox), the pass first repairs it once via `git remote set-head origin --auto` (`origin-head.js`, bounded by the same fetch timeout) and re-resolves the integration branch, instead of skipping every check as `no-remote`; a failed repair is remembered for the cache TTL so an offline session start does not pay the round trip again (#3132).
- **Should feel:** Fast and unobtrusive — the session's first message shows up without a noticeable stall, on both a healthy repo and a degraded-GitHub one.
- **Should understand:** The mirror/branch summary and red-tip warning they see are current as of this session start (or, on a cache hit, as of the very recent prior one) — not stale.
- **Red flags:** A visible multi-second-to-minutes stall before the first message; a mirror/red-tip summary that silently omits a real problem because a network call timed out with no explanation; every check skipped as `no-remote` in a checkout that plainly has a working `origin`.

### 2. The background pass is dispatched, detached
- **Action:** After the fast pass returns, `session-start.js` checks its own background-status file's freshness and, if stale enough, spawns `node bin/hooks.js reconcile-background` as a genuinely detached child process (`spawn(..., {detached: true, stdio: 'ignore'}).unref()`) — this process runs `release`, `archive`, `archive-branches`, `remote-prune`, `ledger-residue`, and `reap` (in that fixed order — `reap` last, since it physically removes worktrees the other checks derive branches from) and writes its outcome to a status file, unrelated to the session's own process lifetime.
- **Should feel:** Invisible — nothing about this step is part of the user's interaction; the session is already usable.
- **Should understand:** Nothing yet — this step has no immediate output. Its result surfaces at the *next* session start (Step 3).
- **Red flags:** The spawn silently failing to fire (no background reconcile ever runs, stale state accumulates indefinitely); the spawn blocking the parent process despite being "detached."

### 3. The next session start surfaces what the background pass did
- **Action:** The following `SessionStart` reads the background-status file once and, if it holds a result not yet shown, renders a "background reconcile (from a prior session)" summary in `additionalContext` — what was released/archived/pruned/reaped, whether a residue-ledger removal PR was opened, and what was skipped and why (e.g. a locked worktree with a live owner, or a residue ledger left on the integration branch because it still has open rows or its removal PR is still open).
- **Should feel:** Trustworthy — the user can see that janitorial cleanup is actually happening, even though they never watched it run.
- **Should understand:** Any skip they weren't expecting (a worktree that didn't reap, a branch that wasn't pruned) came with a stated reason, not a silent gap. A fast-lane pr-first singleton whose merge auto-closed via `gh pr merge` converges in this background pass too — its claim releases, grants/`bot:in-progress` strip, and its run directory archives — even once the worktree and branch that merge tore down are both gone (#3249's by-PR-number fallback), and even when no Review Console was ever rendered for it (#3249's narrowly-scoped archive exception), as long as nothing was left pending in that run's `staged/`. A merged PR releases a record's claim only when it actually closes that record — its `closingIssuesReferences` name the issue, or its merge commit carries a line-anchored closing keyword for it (#3412); a multi-record run's PR merged early, with one record still building, shows that record as skipped with reason `pr-merged-not-closing` (or `pr-merged-closing-unknown` when the PR state carried no references list at all), keeps its claim and its `bot:in-progress`/`auto:build` labels, and releases later on the ordinary `issue-closed` or TTL path.
- **Red flags:** A background outcome that never surfaces anywhere (silently dropped diagnostic signal); the same outcome shown twice across two different sessions. A record released with reason `merged: reconciled from PR #{n}` while its owning session is still building it — the PR closed its siblings, not it (the #3348/#3311 incident #3412 closed). Before #3249, a merged fast-lane run with nothing pending could show `console-never-rendered` here forever — a skip reason that read as "a stated reason" but was never actually going to resolve on its own; that specific permanent-skip shape is what #3249 closed. A run whose `staged/` genuinely still holds unapproved items is the one case that still shows this skip indefinitely, by design (tracked separately, #3297).

## Origin
- Created during build of #820 (Reduce SessionStart reconcile() latency — GitHub-health preflight, batching, parallelism, async split)
- All steps built in this session
- Updated during build of #3132 (fresh-clone `origin/HEAD` repair in Step 1)
- Related specs: #847 (follow-up — restore session/run attribution on the three worktree-reap audit-trail events under this split, filed as a deliberate scope boundary during #820's build)
- Updated during build of #3249 (fast-lane pr-first merges never release their claim or archive their run — console-never-rendered) — Step 3's release/archive convergence promise now holds for a torn-down worktree/branch and a never-rendered console with nothing staged; the residual pending-staged-items gap is tracked as #3297
- Updated during build of #3412 (reconciler released a run's unfinished record when the run's PR merged without closing it) — Step 3's release promise now requires the merged PR to close the record; a merged-but-not-closing PR keeps the claim (`pr-merged-not-closing` / `pr-merged-closing-unknown`)
- Updated during build of #3812 (residue ledgers reaching main through PRs merged outside a run's teardown) — the background pass gains `ledger-residue`, and Step 3 surfaces its removal PRs and notable kept ledgers
