# Windows regression: 2 test file(s) newly failing after 456134058 (#4385) Implementation Plan

**Goal:** Make the four #3900 AC1.1 tests in `tests/hooks-policy-exemption.test.js` run the same `git -C` command shape on every OS by single-quoting the native repo path, and pin the delete-only allowlist's backslash rule with two Linux-visible rows.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T115908-record-4385/spec-4385/work/4385-spec.md` (materialized from GitHub issue #4385)

---

### Task 1: Single-quote the #3900 AC1.1 `-C` path splices and add the Windows-path allowlist rows

**Files:**
- Test: `tests/hooks-policy-exemption.test.js`
- Waived `tests/helpers/shell-quote.js`: reference only (`shellQuote`)
- Waived `plugin/bin/lib/hooks/pre-tool-use.js`: reference only (`CQ_SINGLE`/`CQ_DOUBLE`, `DELETE_ONLY_PUSH_ALLOWLIST`)

- [ ] **Step 1: Failing test** — in the `DELETE_ONLY_PUSH_ALLOWLIST matches exactly the admitted shapes` test, add `"git -C 'D:\\a\\_temp\\wt' push origin --delete feature-x"` to `shouldMatch` and `'git -C "D:\\a\\_temp\\wt" push origin --delete feature-x'` to `shouldNotMatch`.
- [ ] **Step 2: Implement** — replace the five `git -C "${repo}"` splices in the #3900 AC1.1 tests with `git -C ${shellQuote(repo)}`; update the titles' `"<repo>"` wording to say the path is single-quoted. Leave `pre-tool-use.js` untouched.
- [ ] **Step 3: Run** `node --test tests/hooks-policy-exemption.test.js` — PASS, test count unchanged. Discrimination probes (scratch, reverted): `isDeleteOnlyPush` forced `false` fails `:188` and the allowed half of `:209`; `CQ_DOUBLE` widened to admit a backslash fails the new `shouldNotMatch` row.
- [ ] **Step 4: Commit** — one commit, `refs #4385`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (five splices) and Deliverable 2 (two rows) are Task 1 Steps 2 and 1; ACs 1-2 are Step 3; AC 3 (windows-regression dispatch) and AC 4 (`npm test`) run after the last code change, at the test phase.
- **Placeholders:** none.
