# Resumed /build with a valid plan skips Common Steps 1.5-1.7 unconditionally (#3666) Implementation Plan

**Goal:** Make `/build`'s Spec Step 2 resume branch (and Design Step 2's) state what a resumed build does with Common Steps 1.5, 1.6 and 1.7, instead of jumping to Common Step 2 unconditionally.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T050547-record-3666/work/3666-spec.md` (materialized from GitHub issue #3666)

**Decisions (made at plan time, per the spec's first Deliverable):**

- **1.5 plan audit — re-run** under its own skip gate. It is a cheap, read-only re-check of the plan against today's repo. One consequence: Check C pre-runs each task's `Expected: FAIL` command, and a task the previous run already built now passes, so on a resume that pass is expected and must not be a stop (a finding on a task not yet built still stops).
- **1.6 plan review — conditional.** It is a once-per-plan gate. Skip it (with a `SKIP` entry) only when this run's `decisions.md` already records a completed review of this plan (an `AUTO` or `SCANNED` Common Step 1.6 entry) and neither the plan nor the worktree's `work/{n}-spec.md` changed after it; otherwise re-run it under its own skip gate (no recorded review, a review that was unavailable, a new run directory, or a spec re-materialized from an edited record).
- **1.7 design pre-build — re-run** under its own skip conditions: the references it loads live in implementer prompts, which a resumed session no longer holds.
- Design mode: 1.5 and 1.7 as above; 1.6 is Spec Mode only.

Size: `plugin/skills/build/SKILL.md` is 48,627 bytes against the 52,500-byte rail (`RAIL_BYTES`) — the additions below add under 1,200 bytes, keeping it under the rail with no other remedy needed.

---

### Task 1: Name what a resumed build does with Common Steps 1.5-1.7, and pin it

**Files:**
- Modify: `plugin/skills/build/SKILL.md`
- Modify: `plugin/skills/build/plan-review.md`
- Modify: `plugin/skills/build/plan-audit.md`
- Test: `tests/build-resume-common-steps.test.js`

- [ ] **Step 1: Failing test** — create `tests/build-resume-common-steps.test.js` (model it on `tests/build-plan-review-conformance.test.js`: `'use strict'`, `node:test`, `node:assert`, `readText` from `./helpers/read-skill`, live reads, a `problems(text)` function per pin set, and a go-red control). Pins:
  1. Spec Step 2's `#### If a plan exists:` section (text from that heading to `#### If no plan exists:`, first occurrence) does not match `/skip to Common Step 2/i`, and contains each of `**Common Step 1.5 (plan audit):**`, `**Common Step 1.6 (plan review):**`, `**Common Step 1.7 (design pre-build):**`, plus `decisions.md` and `changed after it`.
  2. Design Step 2's section (`### Design Step 2: Check for Existing Plan` to `### Design Step 3`) does not match `/skip to Common Step 2/i`, and contains `Common Steps 1.5 and 1.7` and `Spec Mode only`.
  3. `plugin/skills/build/plan-review.md` contains `resumed build: plan already reviewed this run` (whitespace-normalized).
  4. `plugin/skills/build/plan-audit.md` contains `Resumed build exception (#3666)` (whitespace-normalized).
  5. Go-red: for each pin set, removing any one anchor surfaces exactly that anchor; and replacing the whole Spec Step 2 section with the old line `- If the plan is still valid and work remains, skip to Common Step 2` makes pin set 1 report the unconditional skip (AC 2).

- [ ] **Step 2: Run** `node --test tests/build-resume-common-steps.test.js` — Expected: FAIL (the resume branches still say "skip to Common Step 2").

- [ ] **Step 3: Implement** — apply exactly these edits:

  a. `plugin/skills/build/SKILL.md`, Spec Step 2 — replace the line
  `- If the plan is still valid and work remains, skip to Common Step 2`
  with:

  ```
  - If the plan is still valid and work remains, resume at Common Step 1.5, not Common Step 2 (#3666) — each pre-execution step is re-decided, never jumped:
    - **Common Step 1.5 (plan audit):** re-run under its own skip gate — a cheap, read-only re-check of the plan against today's repo. A Check C finding on a task this step found already implemented is expected, not a stop (`plan-audit.md`).
    - **Common Step 1.6 (plan review):** skip, with a `SKIP` entry, only when this run's `decisions.md` already records a completed review of this plan (an `AUTO` or `SCANNED` Common Step 1.6 entry) and neither the plan nor the worktree's `work/{n}-spec.md` changed after it; otherwise re-run it under its own skip gate.
    - **Common Step 1.7 (design pre-build):** re-run under its own skip conditions — the references it loads live in implementer prompts a resumed session no longer holds.

    Then run Common Step 2 from the next incomplete task.
  ```

  b. `plugin/skills/build/SKILL.md`, Design Step 2 — replace the line
  `- If a plan exists and is still valid → skip to Common Step 2`
  with:
  `- If a plan exists and is still valid → resume at Common Step 1.5, running Common Steps 1.5 and 1.7 as Spec Step 2's resume branch states (1.6 is Spec Mode only), then Common Step 2`

  c. `plugin/skills/build/plan-review.md` — after the paragraph that begins `**Skip condition lives in \`build/SKILL.md\`'s Common Step 1.6 stub, not here**`, add one paragraph:

  ```
  **A resumed build** (a still-valid plan, `build/SKILL.md` Spec Step 2) re-runs this review unless this run already recorded a completed one and neither the spec nor the plan changed after it — the decision lives in that resume branch, for the same re-read-cut reason. A review is once per plan, not once per session: a resume that already passed it does not ask the same questions twice.
  ```

  and in the `## Skip logging` section, change the `--text` alternatives from
  `{ceremony-profile=fast-lane (roster tag plan-review) | trivial plan: fewer than 3 file references and no Scope keywords:}`
  to
  `{ceremony-profile=fast-lane (roster tag plan-review) | trivial plan: fewer than 3 file references and no Scope keywords: | resumed build: plan already reviewed this run, spec and plan unchanged since}`
  and the sentence before it from "When the `SKILL.md` stub's gate fires (`ceremony-profile=fast-lane` — roster tag `plan-review` — or a trivial plan), write one `SKIP` entry:" to "When the `SKILL.md` stub's gate fires (`ceremony-profile=fast-lane` — roster tag `plan-review` — or a trivial plan), or Spec Step 2's resume branch skips a plan already reviewed, write one `SKIP` entry:".

  d. `plugin/skills/build/plan-audit.md` — at the end of the bullet that begins `- **\`checkC.ok === false\`**`, append:
  ` **Resumed build exception (#3666):** on a resume with a still-valid plan (\`SKILL.md\` Spec Step 2), a finding on a task Spec Step 2 found already implemented is expected — its Step 2 command passes because the task is done — and is not a stop; a finding on any task not yet built still stops.`

- [ ] **Step 4: Run** `node --test tests/build-resume-common-steps.test.js tests/build-plan-review-conformance.test.js` — Expected: PASS. Then prove the new test discriminates: `git show HEAD:plugin/skills/build/SKILL.md` content must make pin sets 1 and 2 fail (the go-red control in the test covers this in-process; no tree mutation).

- [ ] **Step 5: Commit** — one commit, message `Name what a resumed /build does with Common Steps 1.5-1.7 — refs #3666`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (decide per step) — the Decisions block; Deliverable 2 (resume branch states run/skip/conditional) — Step 3a/3b/3c/3d; Deliverable 3 (pin in the build conformance suite) — Step 1. AC 1 — pin set 1; AC 2 — pin set 1 plus the go-red old-line control; AC 3 — `npm test` at Common Step 5.
- **Placeholders:** none.
