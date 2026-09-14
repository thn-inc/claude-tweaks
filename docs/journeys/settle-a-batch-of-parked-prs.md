---
files:
  - plugin/skills/dispatch/SKILL.md
  - plugin/skills/dispatch/settle-parked.md
  - plugin/skills/dispatch/resume-confirmation.md
---

# Settle a Batch of Parked PRs

**Persona:** claude-tweaks user with several open PRs parked `bot:parked` (dispatch's merge-verification gate took the Red path on each) who wants to review and resume the ones worth resuming in one pass, instead of looping `resume-confirmation.md`'s per-PR confirm one PR at a time.
**Goal:** See every parked PR's fresh state (CI status, park reason, files changed) in one table, pick a subset with a single multi-select decision, and have the agent resume only that subset — sequentially, never in parallel — while leaving unselected PRs untouched.
**Entry point:** The user runs `/claude-tweaks:dispatch --settle-parked` directly — human-present only, never fired by a scheduled Routine.
**Success state:** The user sees a batch table of eligible parked PRs (with any still-live PR reported separately, not silently dropped), makes one multi-select choice, and each selected PR resumes in turn through its own Review Console — unselected PRs keep their `bot:parked` label and worktree exactly as they were.

## Steps

### 1. Invoke the batch review — CLI
- **URL:** `/claude-tweaks:dispatch --settle-parked`
- **Action:** The user types the standalone form directly — never combined with a ref (`#N`) or `--budget`.
- **Should feel:** A single deliberate command that replaces a whole afternoon of per-PR resume loops.
- **Should understand:** Combining `--settle-parked` with `#N`/`#N,#M,...` or `--budget` is rejected outright with a one-line notice and no fetch — the two forms don't mix.
- **Red flags:** The agent silently ignores a combined ref/`--budget` instead of reporting the conflict; the agent runs this form from a scheduled Routine context.

### 2. Read the batch table
- **URL:** no page — a markdown table rendered per `plugin/skills/dispatch/settle-parked.md` Step 3, one row per eligible `bot:parked` PR (Target, PR #, park reason, CI status, files changed), preceded by a fetch of every open `bot:parked` PR and a per-PR freshness probe (`check-resume-freshness`) plus a fresh `gh pr view` CI/mergeability read.
- **Action:** The user reviews each row's park reason and current CI status before deciding which PRs to resume.
- **Should feel:** Grounded in fresh evidence — the same live-sourcing discipline `resume-confirmation.md`'s single-PR confirm already uses, just batched.
- **Should understand:** A PR whose freshness probe comes back `BLOCKED` (its worktree is still live, or it was committed to recently) never appears as a selectable row — it's named on its own `excluded — still live` line instead, so nothing is silently dropped from view.
- **Red flags:** A `BLOCKED` PR appearing as a selectable row; a `BLOCKED` PR vanishing from the output entirely with no `excluded` line naming it.

### 3. Pick a subset — `AskUserQuestion` (multi-select)
- **URL:** no page — one `AskUserQuestion` call, header `Settle parked PRs`, `multiSelect: true`, one option per eligible row.
- **Action:** The user selects zero or more PRs to resume.
- **Should feel:** One decision, not N — distinct from `resume-confirmation.md`'s own per-PR single-select question, which this batch step deliberately skips for every selected PR.
- **Should understand:** Every unselected row is left exactly as it is — `bot:parked` label and worktree untouched, nothing written for it.
- **Red flags:** The question rendering as single-select; an unselected PR's label or worktree changing anyway.

### 4. Watch each selected PR resume, one at a time
- **URL:** no page — for each selected PR in order, a re-run freshness probe followed by `PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow "{target}" wrap-up`, re-entering that PR's own Review Console (same mechanics as `resume-parked-dispatch-run.md`'s Step 3).
- **Action:** The user watches each selected PR's Review Console render in turn — never two at once.
- **Should feel:** Continuous with Step 3's choice — each PR resumes into its own already-assigned worktree and run directory, never a freshly minted one.
- **Should understand:** If a selected PR's second, closer-to-the-write freshness probe comes back `BLOCKED` (state drifted between the batch confirm and this PR's turn), that one PR is reported and left parked — the batch continues to the next selected PR rather than aborting.
- **Red flags:** Two Review Consoles rendering concurrently; one selected PR's `BLOCKED` result stopping the whole batch instead of just that PR; a resume minting a fresh run directory instead of reusing the PR's own.

## Origin
- Created during build of #2428 ("dispatch: no policy lever to relax merge-check's needs-human verdict, and no batch-settle command for parked PRs") — added the `--settle-parked` entry point, batching `resume-confirmation.md`'s per-PR confirm into one multi-select decision over every open `bot:parked` PR.
- Related specs: #2428
