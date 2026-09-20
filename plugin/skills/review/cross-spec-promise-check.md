# Cross-Spec Promise Check — /claude-tweaks:review Step 1.6

Skip entirely under `ceremony-profile: fast-lane` (roster tag `review-step-1.6`, `_shared/ceremony-profile.md`).
Otherwise, skip silently when this record has no resolvable parent, or its parent has no
`## Cross-Spec Promises` section (`_shared/work-record.md`) — most records. This step never blocks
the review; it only updates the parent record and, when relevant, notes something in the Step 7
summary.

**Resolve the parent**, per `work-backend`: `local-files` — `facets.parent` (kept for
completeness; per `specify/SKILL.md`'s seeding step, only `work-backend: github-issues`
decompositions ever get a `## Cross-Spec Promises` section, so a `local-files` parent's promises
section is always absent);
`github-issues` — per `work-links`: `native` — query the sub-issue relationship from this record's
own side; `body-text` — read the `Parent: #N` line from this record's own body, written at
decomposition time (`spec-template.md`). No parent resolvable (a record human-filed or
`/claude-tweaks:capture`d directly, or one produced by a `/claude-tweaks:specify` decomposition
whose Step 2.6 collapse decision created no parent — `specify/decomposition-mode.md`) → skip this
step entirely.

**If the parent has a `## Cross-Spec Promises` section:**

1. **Check whether an `open` row names this record as Owner.** If so, this review's own diff
   (Step 2, once available — or the same change scope Step 1 already used for the deliverables
   check) is exactly the evidence needed: judge whether it satisfies the stated promise.
   - Satisfied → update the row's Status to `SATISFIED (commit {short-sha})` via `gh issue edit
     $PARENT_NUM --body-file`, and post a comment: `gh issue comment $PARENT_NUM --body "F{n}
     satisfied by #{this-record}: {one-line why}."`
   - Not yet satisfied → leave the row `open`, post a comment explaining what's still missing.
     Never edit another sub-issue's body from here — only the parent's promises section and comments.
2. **Check whether this record's own work reveals a new forward assumption on another sibling**
   not yet tracked (the same kind of gap the spec 13-23 build's whole-branch review caught
   mid-flight, not anticipated at decomposition time). If so: add a row to the parent's table, post
   a seeding comment, and — when the assumption concerns a still-open sibling — add the
   corresponding `Blocked by #N: {assumption}` line to this record's own body (a normal body edit,
   same as any other review-driven change to the record under review).
   - **Exception — the sibling that owns the assumption is downstream of this record.** When that
     sibling is itself already blocked by the record under review, adding the `Blocked by` line
     closes a mutual pair, and `plugin/bin/resolve-blockers.js` carries no cycle detection: both
     records then read as permanently blocked and neither is ever dispatchable. Write the parent
     row and the seeding comment only, withhold the `Blocked by` line, and say in the row why it
     was withheld. Observed on #1922, whose forward assumption's owner (#1923) was already blocked
     by #1922.

Both writes are additive to the parent's body/comments only — never touch a sibling sub-issue's body
from this step, and never block the review's own PASS/BLOCKED verdict on anything found here — the
register is deliberately not a hard gate anywhere.
