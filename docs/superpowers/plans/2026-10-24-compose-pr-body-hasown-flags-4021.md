# compose-pr-body.js: parseArgs accepts inherited object keys such as constructor as known flags (#4021) Implementation Plan

**Goal:** `plugin/bin/compose-pr-body.js` `parseArgs` tests `if (!(a in FLAGS))`, and `in` walks the prototype chain, so a bare token such as `constructor` or `toString` passes as a known flag. Look flags up with `Object.hasOwn(FLAGS, a)` instead.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T193715-record-4021/work/4021-spec.md` (materialized from GitHub issue #4021)

---

### Task 1: Look flags up with Object.hasOwn in compose-pr-body.js parseArgs

**Files:**
- Modify: `plugin/bin/compose-pr-body.js`
- Test: `tests/compose-pr-body-cli.test.js`

- [ ] **Step 1: Failing test** — add a case to `tests/compose-pr-body-cli.test.js` that passes `constructor` and `toString` as bare tokens and expects exit 2 with `unknown argument` (and specifically `unknown argument: constructor` / `unknown argument: toString` on stderr).
- [ ] **Step 2: Implement** — change `parseArgs`'s `if (!(a in FLAGS))` to `if (!Object.hasOwn(FLAGS, a))` in `plugin/bin/compose-pr-body.js`.
- [ ] **Step 3: Run** `node --test tests/compose-pr-body-cli.test.js` — PASS; and confirm `node plugin/bin/compose-pr-body.js constructor x` exits 2 printing `unknown argument: constructor`.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4021`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item (the `Object.hasOwn` lookup; the new test case for `constructor` and `toString`) and every `## Acceptance Criteria` item (CLI exits 2 with `unknown argument: constructor`; the test fails when reverted to `a in FLAGS`; `npm test` passes — run at Common Step 5) is covered by Task 1's Files/Steps above.
- **Placeholders:** none.
