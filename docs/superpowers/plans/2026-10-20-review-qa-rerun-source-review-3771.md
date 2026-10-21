# /review Step 6.7's QA re-run omits --source review, so a standalone review gets a nested Next Actions block (#3771) Implementation Plan

**Goal:** `/review` Step 6.7 item 4 invokes `/claude-tweaks:test qa affected` with no parent signal, so a standalone `/review` renders `/test`'s own `## Next Actions` mid-review. Pass `--source review` there, as Step 1.5 already does.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T205632-record-3771/work/3771-spec.md` (materialized from GitHub issue #3771)

---

### Task 1: Pass `--source review` on every mid-review `/claude-tweaks:test` invocation in `code-mode-steps.md`

**Files:**
- Modify: `plugin/skills/review/code-mode-steps.md`
- Test: `tests/review-qa-rerun-after-fix-wave-conformance.test.js`

Scope note (AC 2): the bare `/claude-tweaks:test` mentions in actionable steps that run mid-review without a run dir are Step 6.7 item 4 (`qa affected` re-run, the Deliverable) and Step 4's "If the reflect skill produces "Change now" fixes, re-run `/claude-tweaks:test` before proceeding." Both get `--source review`. Mentions left bare: Step 1.5's `TEST_PASSED=true` (pipeline) rows (a run dir is set), the Gate table's two **STOP** rows (post-stop hand-back to the user, not a mid-review invocation), and descriptive prose (Step 1.5 intro, Step 6.x QA-data reference, Important Notes).

- [ ] **Step 1: Failing test** — in the conformance suite, change the AC1.1 pin to `` `/claude-tweaks:test qa affected --source review` `` and add a #3771 test asserting Step 4's re-run reads `` re-run `/claude-tweaks:test --source review` before proceeding ``. Run: `node --test tests/review-qa-rerun-after-fix-wave-conformance.test.js` — Expected: FAIL.
- [ ] **Step 2: Implement** — add `--source review` to both invocations in `code-mode-steps.md`.
- [ ] **Step 3: Run** the suite from Step 1 — PASS. Prove discrimination by reverting each edit and confirming red.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3771`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (Step 6.7 item 4 carries `--source review`) and Deliverable 2 (update the conformance pin, `tests/review-qa-rerun-after-fix-wave-conformance.test.js` AC1.1) are covered. AC 1 is covered by the AC1.1 pin. AC 2 is covered by the Step 4 edit and its new pin, with the left-bare mentions classified above.
- **Placeholders:** none.
