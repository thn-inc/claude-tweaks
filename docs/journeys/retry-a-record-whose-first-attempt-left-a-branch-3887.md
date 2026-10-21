---
files:
  - plugin/bin/lib/worktree/remote-branch-collision.js
  - plugin/skills/build/adopted-branch-collision-check.md
  - plugin/skills/build/already-shipped-assessment.md
  - plugin/skills/_shared/pr-early-run-lifecycle.md
  - plugin/skills/dispatch/settle-and-merge.md
---

# Retry a Record Whose First Attempt Left a Branch on Origin

**Persona:** Maintainer of a `pr-first` claude-tweaks repo whose overnight `/claude-tweaks:dispatch` fleet retries failed records unattended — the 2026-10-20/21 shape where #3630, #3315 and #3488 each failed attempt 1 after pushing (`worktree-dispatch-record-{N}` left on origin, PR closed as a tombstone) and every retry stopped on `adopted-branch-collision` until someone deleted the branch by hand.
**Goal:** The next dispatch of that record picks up where attempt 1 left off — its committed plan and any pushed work — on the same PR thread, with no branch surgery.
**Entry point:** A `dispatch next` firing (or `/claude-tweaks:dispatch #{n}`) re-selects the record after Settle released its claim and kept `auto:build`.
**Success state:** The retry's `decisions.md` carries `Adopted-branch collision check: adopted prior attempt {sha} from closed PR #{pr} for worktree-dispatch-record-{n}`, the old PR is reopened and its body names the new run, and the build proceeds to plan/implement. The maintainer should feel the fleet heals its own retries.

## Steps

### 1. Attempt 1 fails after pushing — `dispatch/settle-and-merge.md` Step 6
- **URL:** `https://github.com/{owner}/{repo}/issues/{n}`
- **Action:** Settle posts "Attempt 1 failed: …" on the issue (the reason may say a plan commit is kept for the retry), points the PR at it, closes the PR, and leaves the branch on origin.
- **Should feel:** Like a pause, not a dead end — the failure comment's promise about the kept plan is one the retry actually keeps.
- **Should understand:** The kept branch and the closed PR are the retry's resume point, not litter.
- **Red flags:** A failure comment promising "plan committed for the retry" when the retry then stops on that very branch.

### 2. The retry's collision check recognizes its own prior attempt — `build/adopted-branch-collision-check.md` item 5
- **URL:** —
- **Action:** The fresh `worktree-dispatch-record-{n}` branch's tip is not an ancestor of origin's, so `classifyRemoteBranch` says `foreign`; `findPriorAttemptPr` then finds a CLOSED, same-repo PR on that branch whose body opens with the `claude-tweaks-run:` marker, closes #{n} in this repo, and whose head is an ancestor of origin's tip → state `prior-attempt`. The build runs `git merge --no-edit {remoteSha}` and logs the adoption; a merge conflict it cannot resolve confidently is aborted and the branch stops as `foreign` instead.
- **Should feel:** Hands-off — no stop card, no question.
- **Should understand:** Only this record's own closed claude-tweaks PR qualifies. Another record's PR, a human's branch, an open or merged PR, a fork PR, or a failed lookup still stops as `foreign`; with `gh` absent there is no lookup, so it stops too (#3915 tracks the MCP path).
- **Red flags:** A `## Build: Adopted branch collides with an unrelated branch on origin` card naming the record's own closed PR; or, conversely, a different record's branch being adopted.

### 3. The push fast-forwards and the old PR is reopened and rebound — `_shared/pr-early-run-lifecycle.md` Step 1
- **URL:** `https://github.com/{owner}/{repo}/pull/{pr}`
- **Action:** Step 1 finds the CLOSED PR for the branch and reopens it (`reopened PR #{pr} for {branch} (retry)`); because this run adopted a prior attempt, it recomposes the body for the new run and writes it with `gh pr edit {pr} --body-file` (`rebound reopened PR #{pr} to run {run-id}`), then pushes.
- **Should feel:** Continuous — attempt 2's progress and comments land in the same thread as attempt 1's failure.
- **Should understand:** The rebind is what lets `bin/pr-checklist.js` flip this run's phase rows; a body still naming the old run is refused (exit 4).
- **Red flags:** Phase-exit checklist updates failing with "run marker mismatch" (a failed rebind is logged as a `SKIP` degrade, not a stop); a second PR opened for the same branch.

### 4. The build resumes instead of re-closing — `build/SKILL.md` Spec Step 2
- **URL:** —
- **Action:** The already-shipped assessment judges against `origin/{integration-branch}`, not the adopted worktree, so attempt 1's unmerged commits never read as "shipped"; the plan search finds attempt 1's committed plan and resumes from it.
- **Should feel:** Like resuming a paused build, not starting over or wrongly closing out.
- **Should understand:** Adopted commits are this run's own unmerged work.
- **Red flags:** `OUTCOME: already-shipped` on a record whose work never merged; the reopened PR closed again with a staged Close proposal.

## Origin
- Created during build of #3887 (Dispatch retry collides with the remote branch its own failed first attempt left behind)
- Steps 1-4 built in this session
- Related: #2844 (adopted-branch collision check, `foreign`/`mine`), #3093 (unknown-relation card), #3915 (MCP-fed lookup for gh-absent firings), `keep-a-live-run-whose-reused-branch-backed-a-merged-pr-3416.md` (reused branch names, reconcile side)
