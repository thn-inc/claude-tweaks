---
files:
  - plugin/bin/lib/accept/target.js
  - plugin/bin/lib/accept/park.js
  - plugin/bin/lib/accept/park-grammar.js
  - plugin/bin/lib/accept/reentry.js
  - plugin/bin/accept-park.js
  - plugin/bin/lib/issues/record-acceptance-target.js
  - plugin/bin/lib/driver/merge.js
  - plugin/skills/_shared/local-acceptance-park.md
  - plugin/skills/_shared/pr-first-merge.md
  - plugin/skills/_shared/github-pr-scan.md
  - plugin/skills/accept/SKILL.md
  - plugin/skills/tidy/actions-github-issues.md
---

# Accept a Locally Parked PR

**Persona:** A maintainer running claude-tweaks with `control-mode: on`. They want to try risky or self-flagged work on their own machine before it merges, and they won't be at the keyboard when the pipeline finishes.
**Goal:** Let the run end without merging, come back later, try the built app from the PR branch, and give one verdict that merges or hands the PR back.
**Entry point:** A `/claude-tweaks:flow` or `/claude-tweaks:dispatch` run on a record whose acceptance target resolves to `local`. That happens when there is a kept risk flag, an `Acceptance-target: local` line on the record, or `acceptance-target: local` in policy (the default).
**Success state:** One of three outcomes:
- The PR merges through Step 3's pinned `--match-head-commit` merge.
- The human merges it themselves.
- The PR goes to the verdict handler as broken.

In every case the recreated `accept-{N}` worktree has been removed, and the record no longer carries `accept:pending`.

## Steps

### 1. The run stops before merge and parks
- **URL:** `node plugin/bin/accept-park.js decide --run {run-dir} --record {n} --head {sha}` then `accept-park.js park --run {run-dir} --record {n} --pr {pr} --head {sha}`
- **Action:** Nothing. Just before `gh pr merge` (`pr-first-merge.md` Step 2.9), the pipeline resolves the target; the diff tripwire can make it `local` when the branch crosses a risk category nobody flagged (or could not run), and then the packet's Deploy status carries its `tripwire…` lines. On `local` it does the following, in this order:
  1. Posts the acceptance packet and applies `accept:pending`.
  2. Writes `target: local`, `reason: awaiting-local-acceptance`, `park-head:` and `park-base:` into the packet's Deploy status section.
  3. Archives the run directory.
  4. Releases the claim.
  5. Removes the worktree.
- **Should feel:** Finished, not stalled. The run reports `pending-review` with reason `awaiting-local-acceptance`, and nothing keeps running and waiting for a human.
- **Should understand:**
  - The label and the packet are the durable state. The archived run directory is not.
  - A failure at archive, release or worktree removal is reported, and the PR stays identifiable as parked.
  - With control mode off, nothing here runs and the merge behaves exactly as before.
- **Red flags:**
  - The PR merges.
  - A live worktree or claim remains after the run.
  - A packet with no `park-head:` line.

### 2. Nothing closes, merges or nags the parked PR
- **URL:** `/claude-tweaks:tidy`, `/claude-tweaks:dispatch close-out`, `/claude-tweaks:help`'s PR scan
- **Action:** Run the usual hygiene. Each of these checks `accept-park.js parked --record {n}` before it arms, merges or recommends closing. Exit 0 (parked) and exit 6 (unknown) both count as parked.
- **Should feel:** Safe to leave. A parked PR older than four weeks is listed as yours with `/claude-tweaks:accept #{n}`, never as "Close".
- **Should understand:** Tidy's record-linked arm also runs `decide` without `--run`. A record whose target is local but was never parked is therefore held: `Held (not armed): PR #{n} — local acceptance target, never parked; recommend /claude-tweaks:accept #{record}`, followed by the decision's `tripwire…` lines when the tripwire made the target local (tidy posts no packet, so the report is where those lines are read).
- **Red flags:**
  - Auto-merge armed on a parked PR.
  - A "Close (GitHub)" recommendation for it.
  - A stale pending-review row naming it.

### 3. Re-enter with `/claude-tweaks:accept #N`
- **URL:** `/claude-tweaks:accept #N`, which runs `accept-park.js reenter --record {n} --pr {pr}`
- **Action:** Run the command. It does the following:
  1. Fetches the PR branch.
  2. Creates `.claude/worktrees/accept-{N}` from `origin/{headRefName}`, never reusing a stale directory.
  3. Starts the app through the dev-url-detection contract's recreated-worktree case.
  4. Opens the packet's links.
- **Should feel:** Like picking work up where the pipeline left it, with one command.
- **Should understand:**
  - The re-entry reports `moved:true` in three cases: the PR head differs from `park-head:`, the base differs from `park-base:` (or `park-base:` is missing), or a push landed between the PR read and the fetch.
  - When the app cannot start (no start command, `Surface: infra`), `/accept` says so and offers only "Accept (agent checks only)" and "Broken: here's what I saw".
- **Red flags:**
  - The app started from a different checkout.
  - The branch HEAD or tracked files changed by re-entry: `reenter-check` must exit 0.

### 4. Give the verdict
- **URL:** The three-option question: `Accept and merge (Recommended)`, `Accept, I'll merge`, `Broken: here's what I saw`
- **Action:** Choose one.
  - `Accept and merge` first records the approval, which removes `accept:pending`.
  - It then re-checks at merge time. The PR head must equal re-entry's head, and `reenter-check --worktree {worktree} --expect-head {head}` must exit 0.
  - It then runs `pr-first-merge.md` Step 3 with `{expected-head}`, followed by Step 4.
- **Should feel:** In control. The merge lands only on the exact head you tried.
- **Should understand:**
  - On a moved head or base, or any non-zero `reenter-check`, `Accept and merge` is withheld this round.
  - The checks are re-run only by Step 2.5 on a later merge.
  - `reenter-remove` deletes the `accept-{N}` worktree only after the chosen option's actions finish.
- **Red flags:**
  - A merge of a head you did not see.
  - `Accept and merge` offered after a moved head.
  - The worktree removed before the merge-time check.

## Origin
- Created during the build of #4615 (acceptance target resolution and the local-acceptance park)
- Related specs: #4615, #4613, #4614, #4609
