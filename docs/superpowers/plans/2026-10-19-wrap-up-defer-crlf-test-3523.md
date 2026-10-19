# Windows regression: 1 test file(s) newly failing after 21ef3dc91 (#3523) Implementation Plan

**Goal:** Fix `tests/wrap-up-multispec-defer-still-live.test.js`'s CRLF test, which double-converts an already-CRLF live read into `\r\r\n` on a Windows `core.autocrlf=true` checkout.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T073940-record-3523/work/3523-spec.md` (materialized from GitHub issue #3523)

---

### Task 1: LF-normalize the live read before building the CRLF input

**Files:**
- Modify: `tests/wrap-up-multispec-defer-still-live.test.js`
- Read-only reference: `tests/helpers/read-skill.js` (`readText()`)
- Read-only reference: `plugin/skills/wrap-up/execution-and-verification.md`

- [ ] **Step 1: Failing test** — in the CRLF test, assert the constructed CRLF input contains `\r\n` and no `\r\r\n`. Against the current raw `live()` read fed CRLF text (scratch simulation: a CRLF copy of the skill file), this assertion and the paragraph count both fail.
- [ ] **Step 2: Implement** — route `live()` through `readText()` from `tests/helpers/read-skill.js` (the preferred move; no other test in the file depends on a raw read: `deferParagraph` already splits on `\r?\n`, `SENTENCE` is single-line, and `engineSource()` is untouched). Keep the CRLF test's `.replace(/\n/g, '\r\n')` and add the genuinely-CRLF assertion.
- [ ] **Step 3: Run** — `node --test tests/wrap-up-multispec-defer-still-live.test.js` passes with no test skipped or removed; a scratch CRLF-checkout simulation (skill text converted to `\r\n`, read through `readText()`) finds exactly one paragraph, and the pre-fix raw transform finds zero; renaming the `**MULTISPEC_REVIEW_DEFER branch:**` lead-in turns the CRLF test red (restore in the same command). Re-run the repo-wide grep of `tests/` for `.replace(/\n/g, '\r\n')`, `split('\n\n')`, and `indexOf('\n\n'` on a raw live read; fix any new hit with the same move.
- [ ] **Step 4: Commit** — one commit, `Fix wrap-up defer CRLF test double-converting a CRLF read — refs #3523`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (Step 2), Deliverable 2 (Steps 1-2), Deliverable 3 (Step 3 grep). AC macOS/Linux pass, CRLF simulation, discrimination, no `plugin/` change, and `npm test` are covered by Step 3 and Common Step 5; the `windows-latest` workflow-dispatch AC is a pre-merge proof run at the test/review stage against the pushed branch.
- **Placeholders:** none.
