# specify: require a Closed rule for specs whose deliverable classifies states (#4727) Implementation Plan

**Goal:** Neither /specify's spec template nor plan review names a closed rule for a state-classification deliverable; add that guidance to the spec template and pin it with a conformance test.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T155422-record-4727/work/4727-spec.md` (materialized from GitHub issue #4727)

---

### Task 1: Add Closed-rule guidance for state-classification deliverables to the spec template, pinned by a conformance test

**Files:**
- Modify: `plugin/skills/specify/spec-template.md`
- Test: `tests/specify-closed-rule.test.js`
- Waived `plugin/skills/build/plan-review.md`: reference only — the needs-human classification (`needs-human — whenever settling it would alter or loosen an existing Acceptance Criterion or an observable contract, or it has two defensible readings.`) the rule pre-empts; no change.

- [ ] **Step 1: Failing test** — create `tests/specify-closed-rule.test.js`, styled like `tests/specify-count-relative-ac.test.js` (`node:test`, `node:assert/strict`, `readText` from `./helpers/read-skill`). It reads `plugin/skills/specify/spec-template.md`, slices the `## State-Classification Deliverables` section (from that heading to the next `\n## ` heading; assert the heading exists), and asserts:
  1. the section names the deliverable shapes it applies to — an eligibility verdict, a refusal ladder, a status classifier;
  2. it requires a **Closed rule** bullet beside the state list;
  3. part one — the listed states are exhaustive (`/exhaustive/`);
  4. part two — an unlisted state is refused with a line naming the state and its remedy (`/refused/` and `/remedy/`);
  5. part three — plan review applies the rule as a plan amendment, never as a `needs-human` gap (`/amendment/` and `/needs-human/`);
  6. it cites the incident (`/#4588/`).
  Add one go-red self-test: the same section-slicing function, run against `TEMPLATE` with the whole section removed, must throw/fail (proves the suite fails when the guidance is deleted — AC 2).
  Run: `node --test tests/specify-closed-rule.test.js` — Expected: FAIL (heading absent).
- [ ] **Step 2: Implement** — in `plugin/skills/specify/spec-template.md`, insert a new `## State-Classification Deliverables` section immediately after `## Gate-Authoring Deliverables` (before `## Why Each Section Matters for /superpowers:writing-plans`). Content (inline, no new sibling file — the guidance is short, like `## Delete + Tombstone Acceptance Criteria`):

  > When a deliverable classifies inputs into named states — an eligibility verdict, a refusal ladder, a status classifier — write a **Closed rule** bullet beside the state list. It states three parts:
  >
  > - **Exhaustive** — the listed states are the complete set; no state outside the list is eligible or classified by implication.
  > - **Refused with a named remedy** — an unlisted state is refused with one line naming the state and its remedy.
  > - **Amendment, not escalation** — a plan review that finds another unlisted state applies this rule as a plan amendment (it adds that state's refusal line), never as a `needs-human` gap.
  >
  > Without it, every state the list leaves out is a gap whose settlement alters an observable contract, which `build/plan-review.md` classifies `needs-human` — so each review pass finds new ones and stops the build. #4588's eligibility verdict stopped four times on the `plan-review-needs-human` HARD-GATE until its spec added this rule; the next pass applied it to a newly found state and the build proceeded.
- [ ] **Step 3: Run** `node --test tests/specify-closed-rule.test.js` — PASS. Also run the other suites that read `spec-template.md` (`node --test tests/spec-template-generator-grep.test.js tests/specify-count-relative-ac.test.js tests/specify-consumer-facing-ac.test.js tests/specify-premise-verification-prose.test.js tests/review-risk-marker-verification.test.js tests/absence-grep-control-check-prose.test.js`) — PASS.
- [ ] **Step 4: Commit** — one commit staging only the two files above, message `Add Closed-rule guidance for state-classifying specs — exhaustive, refused with remedy, amendment not escalation`, body `refs #4727`.

---

## Self-review

- **Spec coverage:** Deliverable 1 / AC 1 (guidance with all three parts in the spec template) → Step 2; Deliverable 2 / AC 2 (conformance test that fails when the guidance is deleted) → Step 1 incl. its go-red self-test; AC 3 (`npm test` passes) → Common Step 5 verification.
- **Placeholders:** none.
