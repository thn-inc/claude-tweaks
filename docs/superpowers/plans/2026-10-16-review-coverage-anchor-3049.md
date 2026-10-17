# review: reproduction pairs anchor the same coverage gap at the test vs the code, so neither reproduces (#3049) Implementation Plan

**Goal:** Tell `/claude-tweaks:review` Step 3's lens agents where to anchor a coverage finding, so two reproduction-pair agents that find the same coverage gap report the same `Path:Line` and confirm each other.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T180248-spec-3049/work/3049-spec.md` (materialized from GitHub issue #3049)

---

### Task 1: Add the coverage-finding anchor rule to the lens dispatch prompt and the 3f checklist

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md`
- Test: `tests/review-coverage-anchor-conformance.test.js`

- [ ] **Step 1: Failing test** — create `tests/review-coverage-anchor-conformance.test.js` (shaped like `tests/review-lens-no-suites-conformance.test.js`; slice regions with a helper that asserts both anchors resolve). Assert:
  1. A `> **Coverage findings anchor at the code under test.**` note exists in `step3-lens-dispatch.md`, positioned after the `> **\`Path:Line\` must be file-native` note and before the Calibration block (`CALIBRATION (required):`). The note states both halves: a missing-or-weak-test (coverage gap) finding is anchored at the production line the test should pin, never at the test file; a finding about a test's own defect (refactor-coupled, non-discriminating, polluting) stays anchored at the test line. It says the rule goes in the dispatch prompt outside the byte-identical Calibration/Output-template block.
  2. The `### 3f: Test Quality` section, sliced up to `### 3g:`, carries exactly one bullet restating the rule with both halves.
  3. The Calibration block (`CALIBRATION (required):` up to `Self-check before sending`) does not contain the rule's text.
- [ ] **Step 2: Implement** — add the note directly after the file-native `Path:Line` note (current line 76). Phrase it so a lens agent can apply it from the prompt alone, without seeing sibling files. Add one 3f checklist bullet, placed next to "Edge cases and error paths tested?", restating the rule. Leave `categoriseReproduction` (`plugin/bin/lib/coordination.js`) unchanged. Do not touch the Calibration/Output-template block.
- [ ] **Step 3: Run** `node --test tests/review-coverage-anchor-conformance.test.js` — PASS. Then run the existing suites that pin this file: `node --test tests/review-lens-no-suites-conformance.test.js`, plus every `tests/*.test.js` that reads `step3-lens-dispatch.md` or `criteria-review-quality.md` (find them with `grep -l`) — all PASS.
- [ ] **Step 4: Commit** — one commit, message `Add coverage-finding anchor rule to review lens dispatch — refs #3049`.

---

## Self-review

- **Spec coverage:** Deliverable 1 is the note in Step 2, checked by assertion 1. Deliverable 2 is the 3f bullet, checked by assertion 2. Deliverable 3 (matcher unchanged) is the explicit no-touch in Step 2. The "Calibration block unchanged" acceptance criterion is checked by assertion 3 and by the existing byte-identity tests in Step 3. The `npm test` acceptance criterion is covered by Common Step 5's full-suite run.
- **Placeholders:** none.
