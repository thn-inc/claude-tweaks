---
files:
  - plugin/bin/lib/hooks/session-start.js
  - plugin/bin/lib/reconcile/index.js
  - plugin/bin/lib/reconcile/preflight.js
  - plugin/bin/lib/reconcile/cache.js
  - plugin/bin/lib/reconcile/budget.js
  - plugin/bin/lib/reconcile/shared-fetch.js
  - plugin/bin/lib/reconcile/gh-pool.js
  - plugin/bin/hooks.js
---

# Session Start: Fast Advisory Pass With a Background Reconcile

**Persona:** Developer starting a Claude Code session in a `pr-first` claude-tweaks repo that has accumulated stale state — old worktrees, merged-but-unclosed branches, stale issue claims — sometimes with GitHub itself degraded or unreachable.
**Goal:** The first message arrives quickly and carries the checks that matter immediately (mirror position, red-tip, ready consoles); the slower janitorial cleanup (release, archive, archive-branches, remote-prune, reap) happens without blocking, and its result shows up the next time a session starts.
**Entry point:** Starting any Claude Code session in the repo — `SessionStart` hook fires automatically.
**Success state:** The session's first message is not delayed by network-dependent janitorial work; on a healthy repo it completes in low single digits of seconds instead of scaling with however much stale branch/claim/console state exists; when GitHub is unreachable or degraded, the fast pass still returns promptly instead of accumulating per-call timeouts; the previous background pass's outcome (what it did, what it skipped and why) appears as plain, readable context on the next session start rather than being silently lost.

## Steps

### 1. Session starts — the fast pass runs inline
- **Action:** `SessionStart` fires `session-start.js`'s `run(ctx)`, which calls `reconcile()` inline for only `mirror`, `red-tip`, and `console` — a short-TTL freshness cache (`cache.js`) short-circuits the whole call first if another session already reconciled this repo within the last few minutes, then a GitHub-health preflight (`preflight.js`, ~2s — up to ~4s when its single retry-on-timeout fires, #2567) runs and skips the rest of the pass on failure, and an overall wall-clock pass budget (`budget.js`) bounds the sum of whatever checks do run so a slow network can't turn the fast pass into a stall — `shared-fetch.js` keeps the mirror/red-tip pair to one fetch round trip.
- **Should feel:** Fast and unobtrusive — the session's first message shows up without a noticeable stall, on both a healthy repo and a degraded-GitHub one.
- **Should understand:** The mirror/branch summary and red-tip warning they see are current as of this session start (or, on a cache hit, as of the very recent prior one) — not stale.
- **Red flags:** A visible multi-second-to-minutes stall before the first message; a mirror/red-tip summary that silently omits a real problem because a network call timed out with no explanation.

### 2. The background pass is dispatched, detached
- **Action:** After the fast pass returns, `session-start.js` checks its own background-status file's freshness and, if stale enough, spawns `node bin/hooks.js reconcile-background` as a genuinely detached child process (`spawn(..., {detached: true, stdio: 'ignore'}).unref()`) — this process runs `release`, `archive`, `archive-branches`, `remote-prune`, and `reap` (in that fixed order — `reap` last, since it physically removes worktrees the other checks derive branches from) and writes its outcome to a status file, unrelated to the session's own process lifetime.
- **Should feel:** Invisible — nothing about this step is part of the user's interaction; the session is already usable.
- **Should understand:** Nothing yet — this step has no immediate output. Its result surfaces at the *next* session start (Step 3).
- **Red flags:** The spawn silently failing to fire (no background reconcile ever runs, stale state accumulates indefinitely); the spawn blocking the parent process despite being "detached."

### 3. The next session start surfaces what the background pass did
- **Action:** The following `SessionStart` reads the background-status file once and, if it holds a result not yet shown, renders a "background reconcile (from a prior session)" summary in `additionalContext` — what was released/archived/pruned/reaped, and what was skipped and why (e.g. a locked worktree with a live owner).
- **Should feel:** Trustworthy — the user can see that janitorial cleanup is actually happening, even though they never watched it run.
- **Should understand:** Any skip they weren't expecting (a worktree that didn't reap, a branch that wasn't pruned) came with a stated reason, not a silent gap.
- **Red flags:** A background outcome that never surfaces anywhere (silently dropped diagnostic signal); the same outcome shown twice across two different sessions.

## Origin
- Created during build of #820 (Reduce SessionStart reconcile() latency — GitHub-health preflight, batching, parallelism, async split)
- All steps built in this session
- Related specs: #847 (follow-up — restore session/run attribution on the three worktree-reap audit-trail events under this split, filed as a deliberate scope boundary during #820's build)
