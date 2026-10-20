---
files:
  - plugin/skills/review/code-mode-steps.md
  - plugin/skills/review/review-summary-template.md
  - plugin/skills/test/SKILL.md
---

# Trust the QA Line After a Review Fix Wave

**Persona:** A claude-tweaks user running a hands-off `/claude-tweaks:flow #N` on a web UI record with `review-auto-apply-ceiling: medium`. `/test`'s QA stories passed, and then `/review`'s design pass auto-applied a wave of fixes that moved tooltips, focus, and a pending state. The user reads the review summary and the PR verdict comment to decide whether the UI they are about to merge was actually checked.
**Goal:** Read a QA line that describes the UI as it is now, not as it was before the review's own fixes landed. Failing that, read a line that says plainly that it predates them.
**Entry point:** `/claude-tweaks:review` applies at least one fix after `/test`'s QA ran. The fix can land in Step 3 Routing (code review findings) or in Step 6.7 (Late Findings Routing: design, visual, or security findings), as AUTO under the ceiling or "Fix now" interactively.
**Success state:** One of four outcomes:
- The re-run QA result reflects the post-wave UI, recomputed over all stories, and a failing re-run turns the verdict BLOCKED.
- The QA line carries the stale qualifier, naming the commit count and the touched stories.
- With no pre-wave QA results (Skipped or Not run), the line shows the re-run's own result with a "post-wave re-run only" suffix, or the unchanged pre-wave status with no qualifier.
- For a wave that touched no story file, nothing changes and nothing extra ran.

## Steps

### 1. Let the review apply its fix wave
- **URL:** `{run-dir}/decisions.md`, under `## /review`, and the branch's commits since `WAVE_BASE`.
- **Action:** The review captures `WAVE_BASE` once, before its first fix. That is before Step 3 Routing's first fix (and before any parallel fix dispatch) when Step 3 applies one, otherwise before Step 6.7's item 1. The capture runs `git stash create`. On a tree already dirty before the wave, that prints a commit holding the pre-wave state, writes no stash entry, and leaves the tree alone. On a clean tree it prints nothing, and `git rev-parse HEAD` is used instead. The routing steps then apply the findings. AUTO fixes commit. Interactive "Fix now" edits may stay uncommitted.
- **Should feel:** Like the same Step 3 Routing and Step 6.7 as before. No new prompt, no new stop.
- **Should understand:** The wave's file set is `git diff --name-only {WAVE_BASE}`, measured against the working tree, plus the untracked files `git ls-files --others --exclude-standard` lists. Fix-now edits that are not yet committed still count, and so do new files they create. Step 6.7 keeps a base Step 3 already captured, so one diff covers both waves. A Step 5 simplification edit after the capture counts too.
- **Red flags:** `WAVE_BASE` captured after the fixes landed, which leaves an empty wave and a silent skip. Step 6.7 recapturing a base after Step 3's fixes, which drops them from the diff. A Fix-now-only wave treated as "no fixes applied". Pre-wave edits on a dirty tree counted as wave edits. An empty `WAVE_BASE` from `git stash create || git rev-parse HEAD`.

### 2. See whether the wave touched a story
- **URL:** `stories/*.yaml` (or `STORIES_DIR`), specifically each story's `source_files`.
- **Action:** Step 6.7 item 4 intersects the wave's file set with every story's `source_files`. When Step 3 Routing applied a fix but Step 6.7 does not run, item 4 runs on its own, right before Step 7.
- **Should feel:** Free on a non-UI wave. No intersection, no stories, or no applied fix means no QA re-run and no added cost.
- **Should understand:** A story with an empty or missing `source_files` never counts toward this intersection. That matches `/test qa affected`'s explicit-argument rule. `qa affected` selects by the wider `verify.js --changed-files` set. The re-run can include stories the wave did not touch, which costs extra runs but never misses a touched story. On a dirty-before-wave tree, pre-wave untracked files also count, which only ever adds a re-run.
- **Red flags:** A browser QA run triggered by a backend-only or docs-only fix wave. A Step-3-only UI fix wave that reaches Step 7 with no re-run and no qualifier.

### 3. Read the re-run's result on the QA line
- **URL:** The review summary's `### QA Validation (from /test)` status, and the PR's `<!-- run-comment: verdict -->` comment.
- **Action:** When the intersection is non-empty, `/claude-tweaks:test qa affected` re-runs the stories. Re-run stories take their new result, the rest keep their pre-wave result, and the status is recomputed over all stories.
- **Should feel:** Current. The line describes the UI being merged.
- **Should understand:** A re-run reporting PARTIAL FAILURE or ALL FAILED makes the verdict BLOCKED, as Step 1.5's test gate would. The verdict comment copies the summary's QA line word for word, with no separate wording.
- **Red flags:** Verdict PASS beside a failing QA line. A status computed only over the re-run subset, which hides a pre-wave failure. A verdict comment whose QA wording differs from the summary's.

### 4. Read the stale qualifier when the re-run cannot happen
- **URL:** The same QA Validation status line and verdict comment.
- **Action:** In a headless run with no dev server or browser, the re-run self-skips, or it errors. It can also stop without running (`No QA stories affected by current changes.`, an unresolved base), or run but report an intersected story SKIPPED. The status then reads `{status} — ran before the review's fix wave ({N} commits since); stories touching changed files: {ids}`. When uncommitted edits remain, it reads `({N} commits since, plus uncommitted edits)`.
- **Should feel:** Honest. The user knows the evidence is older than the code, and which stories to re-check by hand.
- **Should understand:** The qualifier renders only when an applied wave touched a story's `source_files` and the re-run did not happen or left such a story unexecuted. It never renders for a wave that touched no story file.
- **Red flags:** A bare "QA: ALL PASSED" after a wave that touched story files and was never re-run, or whose re-run reported a touched story SKIPPED. "0 commits since" with no mention of uncommitted Fix-now edits.

### 5. Read the QA line when no QA ran before the wave
- **URL:** The same QA Validation status line and verdict comment.
- **Action:** The pre-wave status was `Skipped — no stories`, `Skipped — no dev server`, or `Not run`, so there are no pre-wave per-story results to merge into. If the post-wave re-run executed stories, the line shows their status followed by ` — post-wave re-run only ({ids}); no pre-wave QA results`. If it executed none, the line keeps the pre-wave status, unqualified.
- **Should feel:** Consistent. The line never claims an earlier pass existed.
- **Should understand:** The stale qualifier attaches only to a status built from stories that actually ran. A never-run status has no earlier pass to call stale.
- **Red flags:** `Not run — ran before the review's fix wave (…)`. An unsuffixed `ALL PASSED` covering only the few stories the re-run executed while the rest never ran.

## Origin
- Created during build of #3047, which added the review Step 6.7 post-fix-wave QA re-run and the stale-QA qualifier.
- Extended during build of #3598. Step 3 Routing fix waves joined the same single re-run under one review-wide `WAVE_BASE`. The capture became dirty-tree-safe (`git stash create`, falling back to HEAD). Untracked files joined the touched set. The wider `qa affected` selection was accepted. Step 5's never-run rule was added.
- Related: #3048. Out of scope here: running `design-wrapper review` before `/test`'s QA.
