---
files:
  - plugin/skills/wrap-up/execution-and-verification.md
  - plugin/skills/_shared/git-discipline.md
  - plugin/bin/pr-merge-state.js
  - plugin/skills/wrap-up/summary-template.md
  - plugin/skills/wrap-up/SKILL.md
  - plugin/skills/flow/summary-template.md
---

# Trust a Parked PR to Stay Mergeable

**Persona:** a maintainer of a `pr-first` project who comes back to a PR a `/claude-tweaks:flow` or `/claude-tweaks:dispatch` run left open ("leave PR open", or an unattended console that resolved `leave-open` because the record lacks `auto:merge`), while sibling records kept merging into `main` during that run.
**Goal:** open the parked PR and find either a branch already caught up with `main` and CI running on it, or a summary that says plainly it conflicts and in which files — never a PR with no test run that looks like "checks still pending".
**Entry point:** wrap-up's last phase-exit push under `integration-model: pr-first` after the Review Console's merge half resolved leave-open — `plugin/skills/wrap-up/execution-and-verification.md`'s Leave-open mergeability re-check.
**Success state:**
- `decisions.md` carries exactly one `AUTO … Leave-open mergeability re-check: mergeability: {outcome}` line.
- A `DIRTY` PR that git can auto-merge has `origin/main` merged in and re-pushed, so GitHub runs its `pull_request` CI again.
- A `DIRTY` PR with a real content conflict is left un-merged, its conflicting files named in the log and the Verdict.
- A clean, blocked or undetermined read changes nothing beyond that one log line.

## Steps

### 1. Wrap-up reads the parked PR's merge state after its last push
- **URL:** `plugin/skills/wrap-up/execution-and-verification.md` "Leave-open mergeability re-check"
- **Action:** wrap-up reuses the state the Post-push merge-state check's `pr-merge-state.js --phase wrap-up` read just printed, carried as `mergeState` in the wrap-up `phase-exit.js` call's envelope. When that read printed `unknown`, exited 3 because cleanup item 8 had already archived the run dir, or never printed one (`mergeState.exit` is `null`), it takes one read of its own as the last call before Verify execution, against the live or archive run-dir path.
- **Should feel:** One extra read at most, never a poll — the run ends in seconds either way.
- **Should understand:**
  - The re-check only runs when the merge path never ran. A `merged`, `armed` or merge-path `pending-review` outcome skips it, because `_shared/pr-first-merge.md` Step 2.5 already read the state.
  - A late `unknown` is logged once and not read again.
- **Red flags:**
  - A second `gh pr view` or a polling loop.
  - The re-check running on a run whose merge path ran.
  - `pr-merge-state.js` pointed at a run dir that was already archived away (exit 3) with no fallback to the archive path.

### 2. A DIRTY PR is caught up, or its conflict is reported
- **URL:** `plugin/skills/_shared/git-discipline.md` "Post-push merge-state check" Catch-up steps 1-5
- **Action:** on `conflicting`, wrap-up runs the shared Catch-up steps in the run's worktree, in every mode. A clean merge is pushed and logged `DIRTY → merged main as {sha}`. On a conflicted merge it lists the conflicting paths (`git diff --name-only --diff-filter=U`), runs `merge --abort`, and logs `DIRTY — conflict in {files}`. A merge that brings in nothing logs `DIRTY → nothing to merge (forge state stale)`; a catch-up that could not run logs `DIRTY — not caught up ({reason})`.
- **Should feel:** Like the run tidied up behind itself on the way out — the maintainer never has to discover the conflict by opening the PR.
- **Should understand:**
  - Only git's own auto-merge runs. Unlike a mid-run catch-up, nothing here resolves a conflict, because no later phase would re-verify a hand-resolved tree.
  - The merge is a merge, never a rebase, and never a force push — the branch is already public behind its PR.
- **Red flags:**
  - A conflict "resolved" by the agent at wrap-up's exit.
  - The worktree left with `MERGE_HEAD` set or conflict markers.
  - A conflicting file list missing from the log line.

### 3. The summary says what happened
- **URL:** `plugin/skills/wrap-up/summary-template.md` "Leave-open mergeability (#3483)"; `plugin/skills/flow/summary-template.md` "Resume-to-merge row."
- **Action:** the wrap-up Verdict names a `DIRTY` outcome — `blocked — conflict with main in {files}` for a conflict, caught up for a clean merge. `/claude-tweaks:flow`'s resume-to-merge row reads `PR #{n} {is ready | is blocked} — mergeability: {outcome}` for a `DIRTY` outcome, read from the run's (possibly archived) `decisions.md`.
- **Should feel:** Honest — a PR GitHub runs no CI on is never reported as shipped.
- **Should understand:**
  - A `CLEAN`, `BLOCKED`, `UNKNOWN` or failed read stays in `decisions.md` only; the Verdict and the row add nothing for it.
  - The phase-trace report renders last in wrap-up's Phase 4, after Execute approved actions and its Verify execution (`plugin/skills/wrap-up/SKILL.md`'s **Order (#3672)** paragraph). The `mergeability:` line therefore already exists when the Verdict reads it. "mergeability not re-checked" means the re-check did not run.
- **Red flags:**
  - "Everything shipped" beside a `DIRTY — conflict in …` log line.
  - The resume row printing `mergeability: CLEAN` (or any non-DIRTY outcome).
  - A Verdict reading "mergeability not re-checked" while `decisions.md` carries a `mergeability:` line. That means the report rendered before the execution step.

## Origin
- Created during `/claude-tweaks:build` of record #3483 (2026-10-19). On #3298's run a sibling merge left the parked PR `DIRTY`, GitHub suppressed its `test` workflow, and nothing re-read the PR after wrap-up's push. Wrap-up now re-checks a leave-open PR's mergeability once after that push and merges `main` in when git can.
- Updated for #3672 (2026-10-21). Wrap-up's SKILL.md listed the phase-trace report before Execute approved actions. Read literally, that put the Verdict before the `mergeability:` line it names. Phase 4 now states one order, with the report rendering last, and the console hand-offs point at the execution step. Step 3 gained a line and a red flag for this.
- Related: `notice-a-run-pr-gone-conflicting-at-phase-exit-2986.md` (the mid-run phase-exit check this one extends to wrap-up's exit).
