---
files:
  - plugin/bin/lib/reconcile/pr-state.js
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/lib/reconcile/escalate-residue.js
  - plugin/bin/lib/reconcile/release-merged.js
---

# Recover a Run Stranded by a Stale Stamped PR Number

**Persona:** Maintainer of a `pr-first` claude-tweaks repo whose run directory's `run-state.json` carries a `pr.number` that names no PR on GitHub — mistyped by a hand edit, or left behind after the PR was deleted or recreated under a new number.
**Goal:** The reconciler names the real problem (a stamp that points at no PR) instead of reporting a transient outage forever, and tells the maintainer how to unstick the run.
**Entry point:** Any reconcile pass over the run dir: session start's `node plugin/bin/hooks.js reconcile-background` in any session, or a `/claude-tweaks:tidy` sweep.
**Success state:** The reconcile report lists the run under skipped with reason `pr-not-found`; once the run dir has sat untouched past the 7-day structurally-stuck TTL, the consolidated `reconcile: structurally-stuck run directories` issue names the dir, lists `pr-not-found` among its reasons, and says to correct or clear the stamp. After the maintainer fixes `pr.number`, the next pass resolves the run's real PR and archives or keeps it on that evidence. The maintainer should feel the reconciler told them exactly what was wrong.

## Steps

### 1. A reconcile pass probes the stamped number — `node plugin/bin/hooks.js reconcile-background`
- **URL:** —
- **Action:** `resolvePrStateByNumber` runs `gh pr view {pr.number}`, which exits non-zero. Before reporting an outage it runs one `gh api graphql` probe (`repository(owner,name){ pullRequest(number) }`, owner/name/number as typed variables); GitHub answers with a non-null repository, a null pullRequest and a `NOT_FOUND` error at `["repository","pullRequest"]`, so the result is `pr-not-found`. `archiveMerged` skips the run with that reason and `releaseMerged` skips its branch-resolved claim with the same reason — neither falls back to the branch's PR.
- **Should feel:** Invisible on a healthy run — the extra probe only fires after a failed `gh pr view`.
- **Should understand:** `pr-not-found` comes from GitHub's structured GraphQL error, never gh's stderr text; a real outage (the probe itself failing, a FORBIDDEN, a null repository) still reads `network-failure` and never escalates.
- **Red flags:** The run archived or its claim released off the branch's older MERGED PR; a stamped-number failure reported as `network-failure` on every pass while `gh` itself is healthy.

### 2. The stale stamp escalates once the run dir is stuck — same sweep, past the 7-day TTL
- **URL:** `https://github.com/{owner}/{repo}/issues?q=label%3Abug+%22structurally-stuck+run+directories%22`
- **Action:** `trackStuckSkip` counts the `pr-not-found` skip toward the `structurally-stuck` residue streak (reconcile-cache.json `residueFailures`, `lastError: stuck at pr-not-found`); at the escalation threshold the reconciler files or updates the consolidated `reconcile: structurally-stuck run directories` issue, whose body lists the stuck run dir and the `pr-not-found` remedy. The remedy is written when the issue is filed or reopened; an issue that is already open is edited only inside its stuck-paths block, so a body a maintainer has shaped keeps their text (#2724).
- **Should feel:** Like a precise bug report — the issue names the dir and the fix, not a generic "stuck" state.
- **Should understand:** A fresh typo stays quiet for 7 days (the existing stuck TTL, no second clock); a dir whose branch is also gone gets the same `pr-not-found` reason through the no-branch by-number path.
- **Red flags:** A newly filed or reopened issue that only says no-worktree/no-branch/no-pr for a dir whose real problem is the stamp; a second issue filed per dir instead of one consolidated record.

### 3. Fix the stamp — edit or clear `run-state.json`'s `pr.number`
- **URL:** —
- **Action:** The maintainer corrects `pr.number` to the run's real PR (or clears it so the branch lookup applies) and lets the next reconcile pass run.
- **Should feel:** Finished — one edit unsticks the run.
- **Should understand:** The next pass resolves the corrected PR by number; archival then follows the ordinary merged-PR rules, and a successful archive clears the run's stuck tracking.
- **Red flags:** The run still skipping `pr-not-found` after the stamp names a real PR.

## Origin
- Created during build of #3543 (Reconcile: a stale or mistyped stamped pr.number strands the run silently)
- Steps 1-3 built in this session
- Related specs: #3416 (stamped `pr.number` is the run's PR identity — `keep-a-live-run-whose-reused-branch-backed-a-merged-pr-3416.md`), #1613/#1811 (structurally-stuck escalation)
