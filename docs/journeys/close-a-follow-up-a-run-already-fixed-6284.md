---
files:
  - plugin/bin/recheck-followups.js
  - plugin/bin/lib/console/recheck.js
  - plugin/bin/lib/console/resolve.js
  - plugin/bin/lib/console/residue.js
  - plugin/bin/lib/reconcile/console-execute.js
  - plugin/bin/lib/reconcile/archive-merged.js
  - plugin/bin/console-resolve.js
  - plugin/skills/wrap-up/followup-recheck.md
  - plugin/skills/wrap-up/review-console.md
  - plugin/skills/wrap-up/merge-mode.md
  - plugin/skills/_shared/console-execution.md
  - plugin/skills/_shared/pr-first-merge-post-merge.md
  - plugin/skills/_shared/local-merge-auto-finish.md
  - plugin/skills/flow/worktree-merge.md
  - plugin/skills/flow/multispec-review-console.md
---

# Close a Follow-up a Run Already Fixed

**Persona:** A claude-tweaks maintainer finishing a run whose changes touched the same files as some open follow-up records. Last time a second run fixed an `html lang` attribute and half-fixed a border contrast, and both records stayed open until they noticed by hand.
**Goal:** Have wrap-up point out which open follow-ups this run's diff appears to satisfy, with the evidence quoted. They approve a close or a narrowing comment with one decision, and nothing closes until the run's merge has landed.
**Entry point:** `/claude-tweaks:wrap-up`'s Review Console, or `/claude-tweaks:flow`'s consolidated multi-spec console. The run is one whose diff touches a path some open record lists under `### Key Files`.
**Success state:** The console's Queue writes section shows a `Q#` row titled `Close #{n}: …` or `Narrow #{n}: …`. Its staged file shows each deliverable's full text next to its verdict, and each `satisfied` item next to the verbatim diff quote that backs it. After approval and the merge, the record is closed with that comment, or carries the narrowing comment, and `decisions.md` holds one `AUTO` line naming the record and the action. An approval whose merge never landed is listed by `console-residue.js --run` with a paste-ready `execute` command.

## Steps

### 1. Let wrap-up find the candidates
- **URL:** the run's `decisions.md` (a `SCANNED` line under `/wrap-up`, step `Follow-up re-check`), and `{run}/recheck/candidates.json`
- **Action:** Reach the console as usual. After the last fix wave, and before proposal bundling and rendering, the console runs `bin/recheck-followups.js candidates --run {run} --records-json {snapshot} --base {integration branch} --own {this run's records}` once (in a multi-spec run, once at the parent, over the union diff).
- **Should feel:** Invisible. There is no question and no new stop.
- **Should understand:** A record is a candidate only when one of its Key Files appears in the run's diff, renames and deletions included. These records are never candidates: hub paths, `parent-issue` records, `bot:in-progress` records, `digest` records, this run's own records, and records with no parseable Deliverables or Acceptance Criteria. At most 5 candidates are judged. Every record over that cap, and every excluded record, is named in the `SCANNED` line. A fresh but empty records snapshot is an error, never "no candidates".
- **Red flags:** A `SCANNED` line that drops an over-cap number. The run's own record shows up as a candidate.

### 2. Let the judges check each deliverable against the diff
- **URL:** `staged/followup-recheck-{n}.md`
- **Action:** One Standard-profile agent per candidate reads only that record's deliverables and the diff hunks for its intersecting files, then returns `satisfied` (with a verbatim quote), `not-satisfied`, or `cant-tell` for each item. `recheck-followups.js stage --verdicts {file}` checks each quote against the hunks and stages the outcome.
- **Should feel:** Trustworthy. Every "satisfied" points at a real line of the diff.
- **Should understand:** A quote that cannot be found inside one hunk counts as `cant-tell`. A deliverable that no hunk touches is `cant-tell`, never `not-satisfied`. Staging follows the verdicts:

  | Verdicts | Staged proposal |
  |---|---|
  | Every item `satisfied` | Close |
  | Some `satisfied`, the rest anything else | Narrow |
  | No `satisfied` | Nothing |

  A judge that fails, goes silent, or returns no verdicts stages nothing and is logged `judge-failed`. That result is never read as `not-satisfied`.
- **Red flags:** A close proposal for a record that has a `cant-tell` item. A satisfied quote that is not in the diff.

### 3. Approve, or leave it for a human at `unattended`
- **URL:** the console's Queue writes section, or the PR-posted console, or `console-residue.js --run {run}`
- **Action:** Approve the row like any `Q#`. The console runs `recheck-followups.js approve --run {run} --id followup-recheck-{n}.md`, adding `--item q-{k}` on a PR-posted console. It never runs `gh issue create`. At `unattended` the item stays `pending`, and the residue prints the paste-ready `approve` line, then the `execute` line.
- **Should feel:** Like any other queue write. The decision is one click, or one pasted line.
- **Should understand:** The approval records the run's own PR (or `local`), the staged file's hash, and the run head. Under control mode the row resolves `carried` into the acceptance packet and is never executed. A proposal edited or re-staged after approval holds as `proposal-changed`.
- **Red flags:** An `unattended` residue line with no `approve` command. A PR-posted console that reports an approved re-check row as `declined`.

### 4. Know when it actually closes
- **URL:** `decisions.md` (an `AUTO` or `SKIP` line from step `Follow-up re-check execute`), the record on GitHub
- **Action:** Nothing. pr-first's post-merge Step 4.0c, local-merge's auto-finish step 7, worktree-merge step 6, or merge-mode's Already-merged path runs `recheck-followups.js execute --run {run}` after the merge.
- **Should feel:** Safe. A close never lands before the change that justified it.
- **Should understand:** Execution re-reads the PR state and the record first. It holds, with one `SKIP` line, on any of these:
  - a failed read
  - an open PR
  - a closed or claimed record
  - a changed body
  - a malformed proposal

  A PR closed without merging drops the approval with one logged line and makes no close and no comment. Under local-merge, the merge is proven by checking that the approved run head is an ancestor of the integration branch. If the comment posts but the close fails, a re-run only retries the close. A merge that lands after the session ended is never picked up by a later pass. It stays residue, with the paste-ready `execute` command.
- **Red flags:** A record closed while its run's PR is still open. A second identical comment on a re-run.

## Origin

Record #6284 (re-check open follow-ups whose Key Files a run changed), built 2026-11-25.
