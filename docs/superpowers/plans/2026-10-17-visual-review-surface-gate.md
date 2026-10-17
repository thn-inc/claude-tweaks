# Visual-Review Recommendation Surface Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visual-review recommendation mode (Step 0.5) counts a journey as affected only when the run carries a frontend-surface signal, as well as a `files:` overlap, so a change to non-UI code no longer recommends a browser walk.

**Architecture:** This is a prose change to `plugin/skills/visual-review/SKILL.md` Step 0.5.
- A new step 3 gates "affected" on `design-wrapper/frontend-detection.md`'s Layer 2 → Layer 3 precedence. Layer 2 is the run's materialized `surface:` header; Layer 3 is the UI trigger-file sniff.
- A new no-surface return line names the suppressed journeys.
- A conformance test pins the gate, the line order, and the unchanged recommendation output.

**Tech Stack:** Markdown skill prose; `node --test` with `tests/helpers/read-skill.js`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T061704-spec-2927/work/2927-spec.md`

**Scope keywords:** mode=recommendation, Recommended follow-up, Visual review not recommended

## Global Constraints

- Cite `frontend-detection.md`'s precedence; do not restate its trigger rules. The deliverable's own `Surface: web|mobile|desktop` value list may appear.
- When the overlap exists but no surface signal does, never render the `Recommended follow-up` line.
- Do not prune `palette.js` (or any entry) from a journey's `files:`. That entry is traceability, and journey hygiene belongs to `/journey-health`.
- `npm test` passes in full.

## Plumbing decision (deliverable: "say which in the PR")

Step 0.5 reads `surface:` itself, from the run's materialized header. Review Step 6 does not pass a new argument.
- No new plumbing is needed. `/claude-tweaks:review`'s Step 6 code-mode line (`plugin/skills/review/code-mode-steps.md:289`) already hands off with only `--mode=recommendation`. The value already sits in the materialized header that review Step 6.5 reads for its own design-wrapper pre-check (`code-mode-steps.md:308`: "`--surface` from this record's materialized `surface:` header field").
- Passing `--surface` instead would add a new argument to visual-review's grammar, plus its mirror surfaces such as `help/reference-card.md:30`'s argument hint.
- **Location fact, checked at authoring time:** `work/{n}-spec.md` lives in the worktree, not under `$RUN_ROOT`. `_shared/pipeline-run-dir.md`:66-68 says: "`work/{n}-spec.md` is the first of two exceptions and stays inside the worktree … it reaches the main checkout by merge". So the prose must point at the checkout under review, not at the bare `$PIPELINE_RUN_DIR`. That variable is anchored to the main checkout, where the file does not yet exist.
- `plugin/bin/design-detect.js` is **not** reused. It applies the Layer 1 design-integration kill-switch first, so it would suppress every visual-review recommendation on a project without Impeccable configured. This repo is one such project.

## Gotchas

- **Consumer web app check (deliverable 3).** The gate keys on the *run's* declared surface, not on each changed file's extension:
  - **Web record, backend file.** A typical consumer web-app record carries `Surface: web`. An API or service change that a journey's `files:` lists still meets Layer 2, so its recommendation renders exactly as today. That covers the "API change behind a visible page" case.
  - **Declared non-UI surface.** Suppression fires only when the record itself says `backend`/`infra`/`terminal`. That is a statement by the author that there is nothing to render.
  - **Legacy record, no `Surface:`.** These predate `/specify` writing the field. On such a record, a backend-only diff with no UI trigger file is the one real risk: Layer 3 says "not frontend".
  - **Mitigations for that case.** The suppressed line still names every overlapping journey, so a human sees which pages depend on the change. The review summary records it as `Skipped — no UI changes`. `wrap-up/verification-brief.md`:188 already treats that status as `Recommended` and re-runs visual-review's own detection, because "a backend-only change can still land here". The acceptance safety net downstream is unchanged.
  - **Conclusion:** the heuristic generalizes. This record does not add a per-file widening.
- **Suppressed-line consumer.** `review-summary-template.md:90`'s Status vocabulary already has `Skipped — no UI changes`, so no new status value is needed. The test pins that this value still exists.
- **#3009** edits `docs/journeys/` content only. There is no overlap with Step 0.5's logic.

## Review Focus

1. **Declared `terminal` surface plus a `files:` overlap.** Expect no recommendation: a terminal surface has nothing for a browser to open. Frontend-detection's Layer 2 routes `terminal` to its own track, not to "continue". The test pins `terminal` among the non-signals.
2. **Standalone run (no `$PIPELINE_RUN_DIR`) with a `.tsx` change overlapping a journey.** Expect the recommendation to render via Layer 3. The test pins the standalone fallback wording.
3. **Header present but no `surface:` field (a pre-v4.5 record).** Expect Layer 3 to run rather than suppression. The test pins "carries no `surface:`".
4. **Projects with design integration disabled.** Expect recommendations to stay possible: Layer 1 must not gate. The test pins the Layer 1 exclusion sentence.
5. **Ordering.** The gate must sit before the recommendation table is returned. A gate after the return would be unreachable in linear prose (the build skill's Reachability check). The test asserts the step order by index.

---

### Task 1: Gate Step 0.5's affected-journey verdict on a frontend surface

**Files:**
- Modify: `plugin/skills/visual-review/SKILL.md:83-107` (Step 0.5's Procedure list)
- Test: `tests/visual-review-recommendation-surface-gate.test.js`

**Interfaces:**
- Consumes: `tests/helpers/read-skill.js` `readText(absPath) → string`
- Produces: none

- [ ] **Step 1: Write the failing test**

Create `tests/visual-review-recommendation-surface-gate.test.js`:

```js
'use strict';
// #2927: visual-review recommendation mode (SKILL.md Step 0.5) counts a journey
// as affected only when the run carries a frontend-surface signal, not on a
// files: overlap alone — #2769's review recommended a browser walk of a journey
// whose only overlapping file was a CLI-only module.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILL = readText(path.join(__dirname, '../plugin/skills/visual-review/SKILL.md'));
const SUMMARY = readText(path.join(__dirname, '../plugin/skills/review/review-summary-template.md'));

function step05() {
  const from = SKILL.indexOf('## Step 0.5: Mode — `recommendation`');
  assert.ok(from >= 0, 'SKILL.md must keep its Step 0.5 recommendation-mode heading');
  const to = SKILL.indexOf('\n## Step 1:', from);
  assert.ok(to > from, 'Step 0.5 must end at the "## Step 1:" heading');
  return SKILL.slice(from, to);
}

test('AC1.1: a files: overlap alone no longer makes a journey affected', () => {
  const s = step05();
  assert.doesNotMatch(s, /A journey is \*\*affected\*\* when at least one of its `files:` entries appears/);
  assert.match(s, /A journey \*\*overlaps\*\* the diff when at least one of its `files:` entries appears/);
  assert.match(s, /an overlapping journey is \*\*affected\*\* only when this run carries a frontend-surface signal/);
});

test('AC1.1: the gate cites frontend-detection.md Layer 2 then Layer 3', () => {
  const s = step05();
  assert.match(s, /`design-wrapper\/frontend-detection\.md`'s Layer 2 → Layer 3 order/);
  assert.match(s, /`web`, `mobile`, or `desktop` is a signal/);
  assert.match(s, /any other declared value \(`backend`, `infra`, `terminal`\) is not, and Layer 3 does not run/);
});

test('AC1.1: no surface signal returns the suppressed-journeys line, never the follow-up', () => {
  const s = step05();
  assert.match(s, /If journeys overlap but step 3 found no frontend-surface signal, return this line instead of the table and the `Recommended follow-up` line/);
  assert.match(s, /No frontend surface in this run \(\{Surface: \{value\} \| no UI trigger file in the diff\}\) — visual review not recommended\. Journeys whose files: overlap the diff: \{journey-name\}, \{journey-name\}\./);
});

test('AC1.1: the suppressed line maps to an existing review summary status', () => {
  const s = step05();
  assert.match(s, /The parent's summary records it as `Skipped — no UI changes`/);
  assert.match(SUMMARY, /\| Skipped — no UI changes \|/);
});

test('AC2.1: a run with a surface signal still renders the table and follow-up line', () => {
  const s = step05();
  assert.match(s, /\| Journey \| Severity \| Changed files in journey \|/);
  assert.match(s, /> Recommended follow-up: `\/claude-tweaks:visual-review journey:\{top-severity-journey-name\}`/);
  assert.match(s, /If no journeys overlap, return: `No documented journeys affected by the diff\. Visual review not recommended\.`/);
});

test('Layer 2 reads the materialized header from the checkout under review', () => {
  const s = step05();
  assert.match(s, /`work\/\{n\}-spec\.md` at `\$PIPELINE_RUN_DIR`'s path in the checkout under review/);
  assert.match(s, /`_shared\/pipeline-run-dir\.md`'s Anchoring section keeps `work\/` out of `\$RUN_ROOT`/);
});

test('Layer 3 runs standalone or when the header has no surface: field', () => {
  const s = step05();
  assert.match(s, /when no header resolves \(a standalone run\) or it carries no `surface:`, the signal is a UI trigger file among step 1's changed files/);
});

test('Layer 1, the design-integration flag, does not gate a recommendation', () => {
  assert.match(step05(), /Layer 1, the design-integration flag, does not apply/);
});

test('the surface gate sits after the journey match and before the recommendation is returned', () => {
  const s = step05();
  const match = s.indexOf('2. **Cross-reference with journeys**');
  const gate = s.indexOf('3. **Require a frontend surface**');
  const score = s.indexOf('4. **Score severity**');
  const ret = s.indexOf('5. **Return structured recommendation:**');
  const ctl = s.indexOf('6. **Return control**');
  assert.ok(match >= 0 && gate > match && score > gate && ret > score && ctl > ret,
    `expected steps 2-6 in order, got ${[match, gate, score, ret, ctl].join(', ')}`);
});
```

Waived AC3.1: `npm test` passing in full is the build's Common Step 5 verification, not a test assertion.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/visual-review-recommendation-surface-gate.test.js`
Expected: FAIL, 0/9 pass. This was confirmed at authoring time by running this exact test against the current `SKILL.md`, and it went 9/9 green against a scratch copy patched with Step 3's blocks. The "files: overlap alone" test fails because the old "affected when at least one" sentence is still present. The AC2.1 test fails because the no-overlap sentence still reads "If no journeys are affected".

- [ ] **Step 3: Rewrite Step 0.5's Procedure list**

In `plugin/skills/visual-review/SKILL.md`, replace this exact block, from the "2. **Cross-reference with journeys**" line through the "5. **Return control**" line:

```markdown
2. **Cross-reference with journeys** — read `docs/journeys/*.md` and match the changed files against each journey's `files:` frontmatter. A journey is **affected** when at least one of its `files:` entries appears in the changed-file set.
3. **Score severity** — for each affected journey:
```

with:

```markdown
2. **Cross-reference with journeys** — read `docs/journeys/*.md` and match the changed files against each journey's `files:` frontmatter. A journey **overlaps** the diff when at least one of its `files:` entries appears in the changed-file set.
3. **Require a frontend surface** — an overlapping journey is **affected** only when this run carries a frontend-surface signal, resolved in `design-wrapper/frontend-detection.md`'s Layer 2 → Layer 3 order (that file owns the trigger rules; this step does not restate them):
   - **Layer 2** — read the `surface:` field of this run's materialized header: `work/{n}-spec.md` at `$PIPELINE_RUN_DIR`'s path in the checkout under review (the worktree's copy — `_shared/pipeline-run-dir.md`'s Anchoring section keeps `work/` out of `$RUN_ROOT`), the same field `/claude-tweaks:review` Step 6.5 passes as `--surface`. `web`, `mobile`, or `desktop` is a signal; any other declared value (`backend`, `infra`, `terminal`) is not, and Layer 3 does not run.
   - **Layer 3** — when no header resolves (a standalone run) or it carries no `surface:`, the signal is a UI trigger file among step 1's changed files.

   Layer 1, the design-integration flag, does not apply: a browser walk does not depend on Impeccable being configured.
4. **Score severity** — for each affected journey:
```

Then renumber the next two steps: `4. **Return structured recommendation:**` becomes `5. **Return structured recommendation:**`, and `5. **Return control**` becomes `6. **Return control**`. Their text is otherwise unchanged.

Then replace the no-match sentence after the fenced recommendation template:

```markdown
If no journeys are affected, return: `No documented journeys affected by the diff. Visual review not recommended.`
```

with:

```markdown
If no journeys overlap, return: `No documented journeys affected by the diff. Visual review not recommended.`

If journeys overlap but step 3 found no frontend-surface signal, return this line instead of the table and the `Recommended follow-up` line: `No frontend surface in this run ({Surface: {value} | no UI trigger file in the diff}) — visual review not recommended. Journeys whose files: overlap the diff: {journey-name}, {journey-name}.` The parent's summary records it as `Skipped — no UI changes`.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/visual-review-recommendation-surface-gate.test.js`
Expected: PASS, 9/9.

Then run the suites that read this file: `node --test tests/ai-design-tells-lens-rows.test.js tests/dev-url-detection-lease-conformance.test.js tests/bin-lib/skill-audit/anti-patterns.test.js tests/ux-heuristics-lens-rows.test.js`
Expected: PASS. None of them pins Step 0.5's text (checked with `grep -rln "No documented journeys affected\|Recommended follow-up\|mode=recommendation" tests/` at authoring time, which found no hits).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/visual-review/SKILL.md tests/visual-review-recommendation-surface-gate.test.js
git commit -m "Gate visual-review recommendation on a frontend surface — files: overlap alone no longer recommends a walk

refs #2927

Claude-Session: https://claude.ai/code/session_011ZYKWYizjVE2LRbdQhzmBy"
```

## Byte budget

`plugin/skills/visual-review/SKILL.md` is 22,379 B now and grows by about 1.1 KB. That is well under the 51,200 B shared ceiling. Grepping `tests/` for `visual-review` next to `byteLength`/`wc -c`/`ceiling` found no file-specific pin.
