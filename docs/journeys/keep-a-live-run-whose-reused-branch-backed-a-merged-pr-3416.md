---
files:
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/lib/reconcile/release-merged.js
  - plugin/bin/lib/reconcile/pr-state.js
---

# Keep a Live Run Whose Reused Branch Once Backed a Merged PR

**Persona:** Maintainer of a `pr-first` claude-tweaks repo running several `/claude-tweaks:flow` sessions in parallel, where a worktree (and its branch name, e.g. `worktree-record-3229`) is reused for the next run after the previous run's PR merged (the 2026-10-17 run `2026-10-17T144508-spec-3375-3380` shape: old PR #3391 MERGED, the live run's own PR #3406 OPEN on the same head branch).
**Goal:** Sibling sessions' background reconcile passes leave the live run alone — its run directory stays in `.claude-tweaks/pipelines/`, its issue claims stay held — until the run's *own* PR merges, and a multi-spec run whose pending proposals sit under `spec-{N}/staged/` is never archived out from under its console.
**Entry point:** Any reconcile pass while the run is mid-build or mid-wrap-up: session start's `node plugin/bin/hooks.js reconcile-background` in a sibling session, or a `/claude-tweaks:tidy` sweep.
**Success state:** The reconcile report lists the live run under skipped with reason `pr-open` (archive sweep) and each of its claims under skipped with reason `pr-open` (claim release); the run directory and `claims/issue-{n}.json` blobs are untouched, and the owning session never has to restore anything by hand. The maintainer should feel that reusing a worktree is safe.

## Steps

### 1. Reuse a worktree for the next run — `/claude-tweaks:dispatch` or `/claude-tweaks:flow #{n}` in a session whose worktree branch already backed a merged PR
- **URL:** `https://github.com/{owner}/{repo}/pull/{new-pr}`
- **Action:** The run's PR-early lifecycle opens a fresh draft PR on the reused branch and `hooks.js record-pr` stamps its number into the run's `run-state.json` (`pr.number`). `gh pr list --head {branch}` now returns two PRs for that branch: the old MERGED one and the new OPEN one.
- **Should feel:** Unremarkable — nothing about the branch name has to be changed to keep the new run safe.
- **Should understand:** The stamped `pr.number` is the run's PR identity; the branch name is only a reusable label.
- **Red flags:** Having to rename the branch or delete the old PR's head ref before the reconciler will leave the new run alone.

### 2. A sibling session's reconcile pass resolves the run's PR — `node plugin/bin/hooks.js reconcile-background`
- **URL:** —
- **Action:** `archiveMerged` (both its main loop and its clean-status sweep, through the shared `archiveMergedRun` → `resolveRunPrState`) probes `gh pr view {pr.number}` first and gets OPEN, so `decideArchiveCore` skips with `pr-open`. `releaseMerged` Phase 1.5 probes the same stamped number for each live claim and `decideRelease` skips with `pr-open`. Only a run with no stamped `pr.number` falls back to `gh pr list --head {branch}`.
- **Should feel:** Invisible — one `gh pr view` per stamped run, no extra prompts.
- **Should understand:** A by-number probe that fails (`network-failure`, `gh-absent`, `invalid-arguments`, `pr-not-found`) skips the run for this pass; it never falls back to the branch lookup, because that lookup is exactly what returns the old MERGED PR. (Claim release for a candidate with no resolvable branch at all is the one exception: it keeps the #3249 issue-closed path, since there is no branch lookup to misattribute.)
- **Red flags:** The run directory moved to `.claude-tweaks/pipelines/archive/` or a claim tombstoned with reason `merged: reconciled from PR #{old-pr}` while `#{new-pr}` is still open.

### 3. A multi-spec run with pending per-spec proposals and no console yet — same sweep, after the run's own PR merged
- **URL:** —
- **Action:** `hasStagedItems` checks the run's top-level `staged/` and every `spec-{N}/staged/`; a non-dotfile item anywhere (or an unreadable `staged` entry) counts as pending, so a MERGED PR with no `console.json` skips with `console-never-rendered-staged-pending`. When every `staged/` is empty or absent, the #3249 fast path archives as before.
- **Should feel:** Safe — staged decisions wait for the console that surfaces them.
- **Should understand:** The console reader (`console/resolve.js`) still reads only the top-level `staged/`; the archive check deliberately reads more, failing toward not archiving.
- **Red flags:** A run archived while `spec-{N}/staged/` still holds `review-*.patch` or `reflect-*.md` items nobody approved.

### 4. Read the reconcile report — next session start's "background reconcile" summary, or the tidy report's converge section
- **URL:** —
- **Action:** The maintainer sees the live run under skipped (`pr-open`), its claims under skipped (`pr-open`), and, once the run's own PR merges and its console resolves, the run archived and its claims released with `merged: reconciled from PR #{new-pr}`.
- **Should feel:** Reassuring — the skip reason names the run's own open PR, not some earlier PR on the same branch.
- **Should understand:** A run whose stamped number no longer resolves keeps skipping (and keeps its claim until the claim TTL) rather than being archived on the branch's old evidence; the skip reason is `pr-not-found`, and once the run dir sits untouched past the structurally-stuck TTL the reconciler escalates it like any other stuck run (#3543).
- **Red flags:** A skip or release reason citing the old PR number; the run missing from both archived and skipped.

## Origin
- Created during build of #3416 (Reconcile archives a live run when an earlier PR from the same branch name has merged)
- Steps 1-4 built in this session
- Related specs: #3412 (claim release closes-this-issue gate — `keep-an-unfinished-records-claim-when-its-bundle-pr-merges-early-3412.md`), #3249 (no-console fast path, preserved), #3503 (manifest-closure archive check, same archive paths)
- Updated during build of #3543: Steps 2 and 4 now name the `pr-not-found` stale-stamp classification and its escalation (full flow: `recover-a-run-stranded-by-a-stale-pr-number-3543.md`)
- Updated during build of #3297: Step 3's pending-staged skip now reports `console-never-rendered-staged-pending` (full flow: `learn-a-merged-run-needs-you-3297.md`)
