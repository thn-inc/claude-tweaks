---
files:
  - plugin/skills/dispatch/resume.md
  - plugin/bin/dispatch-resume.js
  - plugin/bin/lib/dispatch/resume-eligibility.js
  - plugin/bin/lib/claim-targets/claim-targets.js
  - plugin/skills/dispatch/open-pr-exclusion-report.md
  - plugin/skills/flow/SKILL.md
  - plugin/skills/dispatch/task-prompt.md
---

# Resume a Stalled Dispatched Build

**Persona:** Maintainer of a `pr-first` claude-tweaks repo whose dispatched build stopped before its test gate — a BLOCKED first call, a plan-review question, a crashed or rate-limited child. That is the #4589 shape: the run left draft PR #4604, a kept worktree and an archived run, and `/claude-tweaks:dispatch #4589` then refused the record as `open-pr`.
**Goal:** Restart that build on its own draft PR and kept worktree with one command, without hand-running claim, archive or worktree plumbing.
**Entry point:** `/claude-tweaks:dispatch resume #N`, typed by a human — usually after `/claude-tweaks:dispatch #N` refused with `#N already has an open PR (#pr) — not re-dispatch-eligible until that PR merges or closes; it is #N's own stalled build — run /claude-tweaks:dispatch resume #N`.
**Success state:** The record is re-claimed, the prior run directory is archived if a dead owner left it behind, the new run binds the existing worktree and reuses the open PR, and the normal two-call sequence runs with a resume-context block naming the prior run, its last logged phase and its open defects. The maintainer should feel the stall cost one command, not an afternoon of plumbing.

## Steps

### 1. Learn the record is resumable — `dispatch/open-pr-exclusion-report.md`
- **URL:** —
- **Action:** `/claude-tweaks:dispatch #N` still refuses an `open-pr` record with the unchanged base line. When `bin/dispatch-resume.js --issue N` exits 0 for it, the line gains the suffix `; it is #N's own stalled build — run /claude-tweaks:dispatch resume #N`.
- **Should feel:** Pointed: the refusal names the exact next command instead of leaving the maintainer to guess.
- **Should understand:** The suffix appears only for the record's own stalled draft PR. A foreign PR, a live sibling, or any other refusal renders the base line unchanged.
- **Red flags:** The suffix on a PR another run or a human owns; the `dispatch #N` "already claimed" refusal for a `bot:in-progress` record changing wording.

### 2. Run the eligibility check before the stalled run is bound or archived — `dispatch/resume.md` Step 2, `bin/dispatch-resume.js`
- **URL:** `https://github.com/{owner}/{repo}/pull/{pr}`
- **Action:** `dispatch resume #N` runs `node bin/dispatch-resume.js --issue N`. It reads the open PRs that close the record through its closing-reference connection (`closedByPullRequestsReferences`, so any head name resolves) and derives the stalled worktree from the chosen PR's head, then reads labels, issue state, open blockers, the claim blob, the prior run directory (archive first), the prior owner's process, sibling sessions, other run dirs bound to the worktree, and the stalled worktree's `git status`. Exit 3 prints the verdict's `line` verbatim, or its `remedy` when the disposition is `close`, and stops.
- **Should feel:** Safe: every refusal names the state it found and the manual remedy, and nothing has been bound, archived or resumed yet (Step 1 may already have minted this firing's own standalone run dir, which the exit closes).
- **Should understand:** Refusals include `bot:blocked` or no `auto:build` (→ `/claude-tweaks:backlog refine #N`), a dirty stalled worktree (every dirty path listed), a prior owner on another host, a live or unprovable prior owner, a `pr-opened:` tombstone (→ close-out), a PR closing more than one record (`multi-record-pr`) or one from a fork or another repository (`cross-repo-pr`, which names the PR rather than reading as `no-pr`), a live claim, a claim run id that differs from the PR marker's run (`run-mismatch`), and a dead leftover run bound to the worktree (`stale-bound-run`, naming `hooks.js close-run`). Any state the eligible list does not name is refused under the Closed rule.
- **Red flags:** The prior run bound or archived before an exit-3 refusal; a refusal that prints the close-and-redispatch steps for a run whose owner is provably live (`liveRun: true`); a refusal line with no remedy; a resume that proceeds with uncommitted edits in the stalled worktree.

### 3. Archive the prior run and bind the worktree — `dispatch/resume.md` Steps 3-6a
- **URL:** —
- **Action:** When the CLI reports `archivePriorRun: true`, resume runs `hooks.js close-run` (if the prior run is still open) and `hooks.js archive-run`, then verifies `archive/{priorRunId}` exists. It mints the new run dir, enters the existing worktree by path (or re-adds it from the PR head when it was reaped), binds it with `record-worktree --dispatch`, and re-runs the CLI with `--bound-run` to catch a concurrent resume.
- **Should feel:** Like the stalled build's own workspace coming back, not a fresh one.
- **Should understand:** A stranded `archiving` marker does not count as archived — the prior owner is still probed. Another session's ad-hoc run dir never reads as a concurrent resume. A Step 6a stop closes the new run dir, leaves the worktree kept, and logs a `SKIP` line, so a retry is not refused by the leftover. A run this same session left bound — a resume that crashed between Step 6's bind and Step 6a — is never proven dead, since the owner probe cannot tell it from a second resume sharing the session id: it refuses `concurrent-resume` with a line naming both readings, stop the other resume and re-run, or close the crashed leftover with `hooks.js close-run --run "{dir}"` and re-run.
- **Red flags:** Two resumes both reaching Step 7; a Step 6a refusal that leaves the new run dir `active`; a resume refused by the original dispatcher's leftover ad-hoc dir; a same-session retry told to wait for "that run" to end with no `close-run` command named.

### 4. Re-claim the stale claim through the PR it resumes — `flow/SKILL.md` Step 2.8, `claim-targets.js --resume-pr`
- **URL:** —
- **Action:** The first call's line carries `RESUME_PR="{pr-url}" ` before `/claude-tweaks:flow`, and Step 2.8 forwards `--resume-pr "$RESUME_PR"`. A `'stale'` claim whose in-flight link is exactly that URL re-claims by the ordinary conditional write; a `failed:`, `abandoned:` or `swept: stale claim` tombstone re-claims normally. The claim log line reads `claimed #N (bin/claim-targets.js, transport: {t}, resume-pr: {url})`.
- **Should feel:** Invisible: the call does not stop at "Claim in-flight".
- **Should understand:** Without `RESUME_PR`, `/flow` keeps today's in-flight stop. A `pr-opened:` tombstone or a mismatched link still stops even with the flag. The second call carries no `RESUME_PR`.
- **Red flags:** `Claim in-flight` on a resume whose PR matches; a resumed claim on a link that differs from the flag.

### 5. Continue the build with the prior run's context — `dispatch/task-prompt.md`
- **URL:** `https://github.com/{owner}/{repo}/pull/{pr}`
- **Action:** The first call's prompt carries `Resuming stalled run {priorRunId} on PR {prUrl}; last logged phase: {section} {step}; open defects: {each}` (or `none recorded`). `/flow` adopts the run, `pr-early-open.js` rebinds the reused PR body to the new run, and the two-call sequence proceeds as for `#N`.
- **Should feel:** Continuous: the new call starts knowing where the last one stopped.
- **Should understand:** Resume never adds or removes a grant label and never commits, stashes, discards or pushes the stalled worktree's state on its own.
- **Red flags:** A second PR opened for the branch; a `DISPATCH_HEADLESS=1` prefix on a resume call.

## Origin
- Created during build of #4588 (Add a dispatch resume form for a build that stalled with its PR still open)
- Steps 1-5 built in this session
- Updated during build of #4729 (dispatch resume: name close-run when the conflicting bound run belongs to this session) — Step 3's same-session leftover line
- Updated during build of #4849 (a stale open PR on any head resumes) — Step 2's PR read through the closing-reference connection
- Related: `learn-why-a-named-record-wont-dispatch-3084.md` (the refusal that now names the remedy), `resume-a-run-on-a-pr-an-earlier-run-opened-4580.md` (the PR-body rebind step 5 relies on), `act-on-a-contested-claim.md` (the in-flight stop step 4 narrows)
