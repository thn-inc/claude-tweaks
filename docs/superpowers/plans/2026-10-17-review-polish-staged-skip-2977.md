# review Step 6.7 + design-wrapper polish Step 5: staged audit finding double-apply (#2977) Implementation Plan

**Goal:** Confirm the reported double path (a STAGED Design-Quality audit finding later re-applied by polish's `harden` dispatch) is already closed by PR #2389 (v6.130.0), and pin the specific STAGED-then-skipped pairing in the conformance suite.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T200218-record-2977/spec-2977/work/2977-spec.md` (materialized from GitHub issue #2977)

---

### Task 1: Pin the STAGED-then-skipped pairing in the review/polish disposition conformance suite

**Files:**
- Test: `tests/review-polish-disposition-conformance.test.js`
- Verify only (no edit unless a real gap is found): `plugin/skills/review/code-mode-steps.md`, `plugin/skills/design-wrapper/modes/polish.md`

- [ ] **Step 1: Verify the prose** — confirm `code-mode-steps.md` Step 6.7 item 3 maps `STAGED → \`staged\`` and writes `dispositionByReview` by `id` onto `source: audit` entries, and `polish.md`'s Four-way consumption table checks `dispositionByReview` first and marks any such entry **Skipped entirely** ahead of the suggestion-driven Command row, and that its rationale names the staged-for-a-human case. Run `node --test tests/review-polish-disposition-conformance.test.js` — it passes on the current branch.
- [ ] **Step 2: Add one test** — in the existing file's style (`test(...)` + `assert.ok(...includes/regex...)` against the already-loaded `reviewSteps`/`polish` strings), add a single test titled for the STAGED-then-skipped pairing that asserts, together: (a) review's Step 6.7 maps a STAGED routing outcome to `dispositionByReview` status `staged` (`STAGED → \`staged\``); (b) polish's table row for `source: "audit"` with a `dispositionByReview` field "(any value)" is consumed as **Skipped entirely** (presence-only, so a `staged` value is skipped); (c) polish's rationale names the hazard this guards — its own dispatch "could auto-apply what review had just staged for a human". No prose change to either skill file.
- [ ] **Step 3: Prove the new test discriminates** — in a scratch copy (never in place in the shared worktree: e.g. a `node -e` that loads the test's assertions against a modified string, or a scratch `git worktree add`), show the new assertion fails when the `(any value)` skip row or the `STAGED → \`staged\`` mapping is removed; then run `node --test tests/review-polish-disposition-conformance.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, `Pin STAGED-then-skipped pairing in review/polish disposition conformance suite — refs #2977`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (confirm coverage against the two prose sites + suite) → Step 1. Deliverable 2 (add the STAGED-then-skipped assertion since the suite only covers field and check-order generically) → Steps 2-3. Deliverable 3 (close the record with a comment citing #2389 / v6.130.0) is a record-closure action, carried as an `ops` ledger row for wrap-up, not a code task. AC "no prose change" → Step 2's explicit no-edit rule. AC "`npm test` passes in full" → `/build` Common Step 5.
- **Placeholders:** none.
