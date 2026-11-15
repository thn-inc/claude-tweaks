---
files:
  - plugin/skills/_shared/rendered-ui-units.md
  - plugin/skills/_shared/subagent-dispatch-core.md
  - plugin/skills/visual-review/page-mode.md
  - plugin/skills/visual-review/discover-mode.md
  - plugin/skills/design-wrapper/modes/review.md
  - plugin/skills/release/disposition.md
---

# Route a Late Rendered-UI Review Result

**Persona:** a maintainer whose `/claude-tweaks:review` of a web-facing record runs visual-review (Step 6) or design-wrapper review (Step 6.5) as a nested agent, and that agent is still browsing when the dispatching agent's 60 x `sleep 20` wait bound (20 minutes) expires.
**Goal:** real rendered-UI findings are never silently dropped. A visual review that is still taking screenshots gets time to finish, one that ran out of time never counts as a passed visual check, and whatever it finds late still reaches a human.
**Entry point:** a review whose visual-review page or journey agent (or design-wrapper Step 3.7/3.8 critic) is outstanding at the first 20-minute bound.
**Success state:** a still-progressing visual review finishes within up to 3 windows (60 minutes) and reports normally. A unit that had to be self-judged is shown as an explicit decline of the rendered-UI check, and its late findings appear either as `staged/visual-review-late-{n}.md` under Pending review at the Wrap-Up Review Console, or as `LATE_FINDING:` lines in the agent's reply when the run is no longer active.

## Steps

### 1. Name the unit and its screenshot directory at launch
- **URL:** the dispatching turn in `visual-review/page-mode.md`, `visual-review/discover-mode.md`, or design-wrapper review's Step 3.7/3.8
- **Action:** the launch site names each child a rendered-UI unit and gives its artifact directory as an absolute path: `.claude-tweaks/artifacts/screenshots/browse/{session}/` under the child's checkout for a page or journey agent, `.claude-tweaks/artifacts/screenshots/browse/` for a whole visual-review unit, and `.impeccable/review/` for a whole design-wrapper review unit. The design-wrapper Step 3.7/3.8 critics are named as rendered-UI units with no artifact directory. The dispatching agent takes a read-only launch probe of the directory (`ls -lR` piped to `git hash-object --stdin`).
- **Should feel:** invisible. Nothing in the screenshot directory changes because it was looked at.
- **Should understand:** lenses, single reads and judges are not rendered-UI units; they keep the old first-bound self-judge and their late results are still ignored.
- **Red flags:**
  - a relative artifact path in the child's prompt (the probe reads it from another cwd and sees it as missing);
  - a design-wrapper Step 3.7/3.8 critic given an extra window it has no directory to justify.

### 2. Keep waiting while screenshots keep arriving
- **URL:** the same turn, when the 60-wait bound expires with the unit still outstanding
- **Action:** the agent re-probes the directory and compares with the previous probe. A change grants one more 60-wait window, logged like a write-capable child's extension. A window with no change, or the third window's bound, ends the wait, naming which fired.
- **Should feel:** like ordinary progress. The visual review's report arrives a few minutes later instead of the review moving on without it.
- **Should understand:** a missing directory or a failed probe counts as no change and is never retried in another form. The ceiling is 3 windows (60 minutes) per wave.
- **Red flags:**
  - a self-judge at the first bound while new screenshots are still landing;
  - a fourth window;
  - a comparison against the launch probe at every bound instead of the previous one.

### 3. See a self-judged unit as a decline, not a pass
- **URL:** the review summary and `decisions.md`, after the wait ended without a result
- **Action:** the dispatching agent self-judges the unit as any read-only unit, logs the downgrade line under its own section of `decisions.md` as not satisfying the rendered-UI check, and states it in the review summary's Visual Review or Design Quality section.
- **Should feel:** honest. The maintainer sees that the visual check did not complete, and the pre-merge rendered-UI precondition still needs a real check or an explicit decline.
- **Should understand:** earlier QA screenshots never stand in for the unit's own verdict.
- **Red flags:**
  - a review summary that reports Visual Review as passed from a self-judged unit;
  - a merge offered on the strength of it with no decline surfaced.

### 4. Find the late result at the Review Console
- **URL:** the Wrap-Up Review Console's Pending review section, or the dispatched agent's reply
- **Action:** when the abandoned unit finishes after all and the run is still active (`run-state.json` `status: active`, no `console.json`), the agent writes the findings to a session temp file, stages them with `stage-item.js --id visual-review-late-1 --allocate`, and logs one `STAGED` line naming `staged/visual-review-late-{n}.md`. When the run has closed, the console already rendered, there is no run directory or no `run-state.json`, or `stage-item.js` exits non-zero (3 for an archived or unanchored run, or any other code), it writes nothing under the run dir and puts one `LATE_FINDING: {severity} — {one-line finding}` line per finding immediately before its reply's trailing `STATUS:` line. When the stage succeeds but `log-decision.js` exits non-zero, the staged file has no console row, so the agent puts the same `LATE_FINDING:` lines in its reply too.
- **Should feel:** like a finding that arrived late but was not lost: one more row to approve or drop, not a surprise in a merged branch.
- **Should understand:** a late result never changes a verdict already reached. `/claude-tweaks:release` routes `visual-review-late-` files as proposals, not skip notes. A dispatching session does not yet relay `LATE_FINDING:` lines to the human from a fixed-format dispatched reply; that relay is a follow-up.
- **Red flags:**
  - a late result written into a closed or archived run directory;
  - a staged file with no matching `STAGED` line in `decisions.md` and no `LATE_FINDING:` lines in the reply;
  - a late result that flips the review's verdict.

## Origin
- Created during the build of #5280. A review's visual-review or design-wrapper unit that outlived the 20-minute keep-alive bound was self-judged and its late result ignored, so real rendered-UI findings were dropped. The rule lives in `_shared/rendered-ui-units.md`; `_shared/subagent-dispatch-core.md` and its six inlined copies carry a one-sentence exception pointing at it.
- Related journeys: `keep-waiting-on-a-progressing-implementer-4557.md` (the same progress windows for write-capable children), `keep-a-second-reader-in-a-dispatched-review-3078.md` (the 60-wait bound for read-only lens children, unchanged here), `get-a-visual-review-recommendation-only-for-a-ui-surface-2927.md` (when visual review is recommended at all).
