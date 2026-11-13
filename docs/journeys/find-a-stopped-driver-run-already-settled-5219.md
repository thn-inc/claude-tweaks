---
files:
  - plugin/bin/lib/driver/settle.js
  - plugin/bin/lib/driver/run.js
  - plugin/bin/lib/driver/admission.js
  - plugin/bin/drive.js
  - docs/driver.md
---

# Find a Stopped Driver Run Already Settled

**Persona:** a maintainer who left `drive.js` running on a few records and comes back to read the results. They don't want to hunt for a stale claim, a locked worktree, or an escalated record that silently drops back into the queue. They also have no time to clean up by hand after every stop.
**Goal:** each record that stopped is already in a settled, explainable state when they look: a comment on the record says what happened, the claim is released when the driver held one, escalated work is cleared away, and blocked work is kept for a human.
**Entry point:** the final event line `drive.js` printed for a stopped record (`outcome` other than `pending-review`), then the record on GitHub.
**Success state:**
- The final line's `settle` reads `done` and `settleFailed` is empty.
- The record carries exactly one driver comment.
- An escalated record has no worktree or local branch left behind and will not be driven again.
- A blocked record keeps its draft PR, branch and worktree under `bot:blocked`.

## Steps

### 1. Read the final line, the settle summary
- **URL:** the `settle-*` step lines, then the final line's `outcome`, `settle`, `settleRow`, `settleFailed` and `settleNote` fields
- **Action:** read `settleRow` to learn which row of the settle table ran. Read `settleFailed` to see whether any call failed.
- **Should feel:** like a receipt. Every settle call was its own named step line, and the final line sums them up.
- **Should understand:**
  - `settle: done` means the row had calls and they ran.
  - `none` means the row has nothing to do: a refusal, a claim held by another run, or a `pending-review` PR waiting for a human.
  - A failed call is never retried, and the calls after it still run.
  - `outcome` is the class the settle actually used. For example, a failed escalate reads `blocked`, because no escalation line landed.
- **Red flags:**
  - A failed settle call that appears nowhere in `settleFailed`.
  - `settle: done` beside a row with no calls.
  - A settle call retried.

### 2. Open the record, the driver's comment
- **URL:** the record's issue page on GitHub (and, for a stop after the push, the draft PR)
- **Action:** read the driver's comment. It names the step that stopped, the outcome or reason, and a short detail.
- **Should feel:** plain and safe to leave public.
  - The detail is reduced, so it shows no home-directory paths, `@` mentions, tokens or links.
  - The comment tells you what the driver did and what it kept.
- **Should understand:**
  - A `blocked` stop gets `bot:blocked` and one comment on the record, plus one on the PR when a PR exists. The draft PR, branch and worktree stay for a human, and clearing `bot:blocked` lets the record be driven again.
  - A claim failure gets the comment and `bot:blocked` but no release. In that case `settleNote` says any claim that may have been written lapses by its TTL.
- **Red flags:**
  - A raw path or `@name` in a comment.
  - Two driver comments for one stop.
  - `bot:blocked` added to a record another run holds (`claim-targets.js` exit 3).

### 3. Trust an escalation, a pre-push stop
- **URL:** the `settle-escalate`, `settle-release`, `settle-remove-worktree` and `settle-delete-branch` lines; `git worktree list`; the record's escalation comment
- **Action:** check that the worktree and the local `drive-record-{n}` branch that the run created are gone, and that the run directory still holds the escalation line.
- **Should feel:** final and reversible in the right places.
  - The partial work is discarded on purpose, and the escalation stays on record.
  - The record returns to the standard path as if it had never been driven.
- **Should understand:**
  - The escalation comment ends with `<!-- express-driver: escalated -->`. While that comment, from a trusted author, is on the record, admission refuses the record (`already escalated by the driver`).
  - To let the driver take the record again, delete that comment.
  - If the escalate call itself fails, nothing is removed and the stop is settled as `blocked`.
- **Red flags:**
  - A worktree or branch removed with no escalation line on record.
  - An escalated record driven again on the next run.
  - A worktree or branch that this run did not create being removed.

### 4. Leave settling to a calling skill, `--no-settle`
- **URL:** `node plugin/bin/drive.js --no-settle #N`, then the final line's `settle`, `settleRow` and `stop` fields
- **Action:** a calling skill passes `--no-settle` and settles the stop itself from the final line.
- **Should feel:** complete. The caller never has to re-derive the classification.
- **Should understand:**
  - No settle call runs.
  - `settle` reads `left-to-caller` only when the stop's row has calls, and `none` otherwise.
  - `settleRow` and `outcome` name what the driver would have done.
  - `stop` carries the class, step, `pushed`, `created`, a closed-set `reason` and `checkLogged`.
- **Red flags:**
  - Any `settle-*` line under `--no-settle`.
  - `left-to-caller` for a row with nothing to do.
  - `outcome` disagreeing with `settleRow`.

### 5. Interrupt a run, settle skipped
- **URL:** Ctrl-C (SIGINT) or SIGTERM, then a final line with `settle: interrupted`
- **Action:** stop the run, then do the manual cleanup `docs/driver.md` lists if you want it: release the claim with `release-claim.js … --reason interrupted`, remove the worktree, and delete the branch.
- **Should feel:** prompt. The driver exits without touching a worktree a worker may still be writing to.
- **Should understand:**
  - A signal that lands mid-settle stops before the next call, and `settleFailed` names any call that already failed.
  - The `outcome` word names the stop's class, not what landed.
  - The claim lapses by its TTL if you do nothing.
- **Red flags:**
  - A worktree removed after the signal.
  - A settle call that started after the interrupt.

## Origin
- Created during the build of #5219 (run `2026-11-13T000400-spec-5219`), the pipeline driver's settle unit. It continues `drive-a-named-record-to-a-draft-pr-5218`, picking up where that journey's final line hands the `stop` object to the settle.
- Step 5 follows the plan-review decision that an interrupt settles nothing.
- Step 4's `none` versus `left-to-caller` follows the plan-review decision that a row with no calls settles `none` even under `--no-settle`.
