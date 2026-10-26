---
files:
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/lib/reconcile/index.js
  - plugin/bin/lib/reconcile/escalate-residue.js
---

# Keep a Run Directory Until Every Record Its Merged PR Left Open Ships

**Persona:** A maintainer of a `pr-first` claude-tweaks repo. Partway through a multi-record `/claude-tweaks:flow` run, they merge the run's PR while the last record is still building in the run's worktree. This is the shape of PR #3348 on 2026-10-17: run `2026-10-17T062549-spec-3307-3308-3306-3309-3310-3311` closed #3306-#3310, while #3311 had `status: running` in `manifest.yml`.
**Goal:**
- The run directory stays in `.claude-tweaks/pipelines/`, and its `run-state.json` keeps its status and worktree, so the owning session can finish the unbuilt record and push it.
- Once every record has actually shipped, through any route, the run archives with no manual step.
**Entry point:** Any reconcile pass after the early merge:
- session start's `node plugin/bin/hooks.js reconcile-background` in this session or a sibling one
- the post-merge reconcile from `pr-first-merge-post-merge.md` Step 4.2
- a `/claude-tweaks:tidy` sweep
**Success state:**
- The reconcile report lists the run under skipped with reason `merged-partial` and `unclosed: [3311]`. The directory and `run-state.json` are untouched.
- After #3311 closes, by a later PR, at `/release`, or by hand, the next pass archives the run.
- The maintainer should feel that an early merge never strands unpushed work.

## Steps

### 1. Merge the run's PR early: `gh pr merge --squash` with `Fixes #{unfinished}` edited to `Refs #{unfinished}`
- **URL:** `https://github.com/{owner}/{repo}/pull/{n}`
- **Action:** GitHub merges the PR. Its `closingIssuesReferences` names only the finished records. The unfinished record keeps building in the run's locked worktree.
- **Should feel:** Deliberate and low-risk, the same as ordering any early merge.
- **Should understand:** The merge proves the finished records landed. It does not say the run is done. The run still owns #{unfinished}.
- **Red flags:** Having to move the run directory aside, or unstamp `pr.number`, to keep the reconciler away.

### 2. A reconcile pass reaches the run: `node plugin/bin/hooks.js reconcile-background`
- **URL:** —
- **Action:**
  - `archiveMerged` computes the run's required records once per run dir with `runRecordSet`. That is the manifest's specs minus any with status `failed`/`not-run` and any with a deferred-closure entry, or the ids in a `-record-{n}`/`-spec-{n}` slug when there is no manifest.
  - `decideArchiveCore` compares those records against the merged PR's `closingIssuesReferences` through `prClosesIssue`.
  - `settleMergedPartial` then probes each unclosed record's issue state.
  - #3311 is still OPEN, so the run skips with `merged-partial` on both the branch-joined path and the by-number fallback.
- **Should feel:** Invisible. There are no prompts, and each still-unclosed record costs one extra `gh issue view` per pass.
- **Should understand:** The check guards only the point where the run would otherwise archive. Every earlier skip reason keeps its precedence: `pr-open`, `console-unresolved`, `console-never-rendered`, and the transport failures.
- **Red flags:** The run directory moved to `.claude-tweaks/pipelines/archive/`, or `run-state.json` rewritten to `status: clean, worktree: null`, while #3311 is still open.

### 3. Read the skip in the reconcile report: the next session start's "background reconcile" summary, or the tidy report's converge section
- **URL:** —
- **Action:** The maintainer sees the run under skipped with `reason: merged-partial` and `unclosed: [3311]`. The reconcile dispatcher (`reconcile/index.js`) carries the `unclosed` list through to its `runs` entries. If the run is still waiting after the 7-day structurally-stuck TTL, it enters the residue counter and escalates, like any other stuck run. The consolidated `reconcile: structurally-stuck run directories` issue then lists the run dir, names `merged-partial` among its feeding reasons, and gives the remedy: the records the run's merged PR was meant to close are still open, so ship them in a later PR, or close/release them if they were abandoned (#3705). That reason list and remedy are written when the issue is filed or reopened; an issue that is already open is edited only inside its stuck-paths block, so a body a maintainer has shaped keeps their text (#2724).
- **Should feel:** Informative. The skip names the exact record that has not shipped yet, and the escalated issue says what clears it.
- **Should understand:** A run legitimately split across two PRs waits visibly; it never freezes silently. The same applies to a repo whose GitHub remote isn't named `origin`: it skips with the tracked reason `no-repo-slug`. That reason counts toward the stuck total but never reaches the escalated issue, because with no repo slug there is no repo to file it in.
- **Red flags:** A skip that names no record, or a waiting run that never shows up in either the archived list or the skipped list. Also, a newly filed or reopened stuck-runs issue whose reason list omits `merged-partial`.

### 4. Ship the last record by any route, and let the run archive itself
- **URL:** `https://github.com/{owner}/{repo}/issues/{unfinished}`
- **Action:**
  - The unfinished record closes. This can happen through a fresh run's PR (the documented mid-series recovery: #3311 closed via PR #3433), at `/claude-tweaks:release`, or by hand.
  - On the next pass, `settleMergedPartial`'s `resolveIssueStateByNumber` probe reads CLOSED, the record counts as satisfied, and the run archives through the ordinary path (`localHasMerge`, then `archiveRunDir`).
- **Should feel:** Hands-off. Cleanup converges without the maintainer touching the old run directory.
- **Should understand:** An issue-state probe that fails keeps the record unclosed for this pass, so the check fails closed and never archives on evidence it could not read. Since #3945 a settled run still passes the tiebreak coverage check before it archives: when its `review-findings.json` lists a finding with no tiebreak verdict line, or is present but malformed, the pass skips it with `tiebreak-coverage-missing` or `tiebreak-artifact-invalid` instead. A run dir kept in `pipelines/` under one of those reasons is not this step's red flag (`clear-an-archive-refusal-for-an-untiebroken-finding-3945.md`).
- **Red flags:** The old run directory still sitting in `pipelines/` after every one of its records is closed.

### 5. Projects where closing keywords never link: a `dev → main` integration branch, or `work-backend: local-files`
- **URL:** —
- **Action:**
  - When the merged PR's `closingIssuesReferences` is an empty array, GitHub linkage carries no information, because GitHub never links keywords on a PR into a non-default base. In that case only a record that `manifest.yml` still lists as `pending` or `running` (`inFlightRecords`) blocks archival.
  - When `CLAUDE.md` declares `work-backend: local-files`, the record check is off entirely.
- **Should feel:** Unremarkable. These projects archive on merge exactly as they did before #3503.
- **Should understand:** The fallback still catches the incident shape, because a manifest spec that is still `running` blocks even with empty linkage.
- **Red flags:** Every run in a `dev → main` repo stuck at `merged-partial` until `/release`, or escalating after 7 days.

## Origin
- Created during build of #3503 (Reconciler archives a run whose PR merged before all of its records were built)
- Steps 1-5 were built in this session.
- Updated during build of #3705: step 3's escalated issue now names `merged-partial` and its remedy, and explains why `no-repo-slug` never reaches it
- Related specs:
  - #3412, the claim half of the same incident: `keep-an-unfinished-records-claim-when-its-bundle-pr-merges-early-3412.md`
  - #3416, run PR identity by stamped number, on the same archive paths: `keep-a-live-run-whose-reused-branch-backed-a-merged-pr-3416.md`
  - #3249, the no-console fast path, which is preserved
