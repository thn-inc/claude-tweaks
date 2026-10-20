# Windows CRLF read in the cross-lens corroboration conformance test (#3698) Implementation Plan

**Goal:** `tests/review-cross-lens-corroboration-conformance.test.js` reads `step3-lens-dispatch.md` raw, so on a CRLF checkout its two `.*$` go-red mutations never match and the suite fails with `mutation did not change the text`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T124821-spec-3599-3602-3695-3696-3698-3699-3595/spec-3698/work/3698-spec.md` (materialized from GitHub issue #3698)

---

### Task 1: Read the skill files through `readText`, and pin the CRLF go-red mutations (AC1.1, AC2.1, AC3.1)

**Files:**
- Modify: `tests/review-cross-lens-corroboration-conformance.test.js:11` (the read seam), `:101-123` (the two share-anchor go-red tests)
- Test: `tests/review-cross-lens-corroboration-conformance.test.js`

Waived tests/helpers/read-skill.js: read only — `readText` and `crlfCheckoutRead` are used as they are.

Seam shape (so AC2.1 is provable on a POSIX host, where a CRLF case built only from `crlfCheckoutRead(...).text` would stay green with line 11 reverted):

- `const readAt = (abs) => readText(abs);` — the one normalized read; `readText` imported from `./helpers/read-skill`.
- `const read = (...p) => readAt(path.join(SKILLS, ...p));` — every existing call site unchanged.
- `function stripAtMedium(dispatch, prefix)` — the existing `.split('\n').map(... l.replace(/ At \`medium\`.*$/, '') ...).join('\n')` mutation, shared by both existing go-red tests (lines 101 and 115) and the new case.

- [ ] **Step 1: Failing test** — append to `tests/review-cross-lens-corroboration-conformance.test.js` a test `'#3698 AC1.1: on a CRLF checkout both go-red mutations still change the text'` that: takes `const { raw } = crlfCheckoutRead(path.join(SKILLS, 'review', 'step3-lens-dispatch.md'))`; asserts `raw.includes('\r\n')`; writes `raw` to a file in an `fs.mkdtempSync(path.join(os.tmpdir(), 'ct-3698-'))` dir (removed in `t.after`); reads it back with `readAt(tmp)`; then for each of `ONLY_ONE_BULLET` and `SHARE_LOC_BULLET` asserts `stripAtMedium(text, prefix) !== text` (message names the bullet).
- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/review-cross-lens-corroboration-conformance.test.js`
Expected: FAIL — the new test throws `ReferenceError` (`readAt`/`stripAtMedium`/`crlfCheckoutRead` not defined yet); the existing tests still pass.
- [ ] **Step 3: Implement** — introduce `readAt`/`read` and `stripAtMedium` as above; route the two existing go-red tests through `stripAtMedium`; import `os` and `{ readText, crlfCheckoutRead }`. No assertion text changes.
- [ ] **Step 4: Run to verify it passes (AC3.1)** — Run: `node --test tests/review-cross-lens-corroboration-conformance.test.js` — Expected: PASS, 0 failures.
- [ ] **Step 5: Verify the CRLF test discriminates (AC2.1)** — in a scratch `git worktree add <scratch> HEAD` after the commit (never edit-and-restore in the shared worktree), change `readAt` to `(abs) => fs.readFileSync(abs, 'utf8')` and run the file there. Expected: FAIL on the `#3698 AC1.1` test only (`mutation did not change the text` for the bullet). Remove the scratch worktree.
- [ ] **Step 6: Commit** — one commit, stage the test file by name:

```
Read the cross-lens conformance skills through readText — CRLF go-red mutations stop no-oping on Windows

refs #3698

Claude-Session: https://claude.ai/code/session_01YVBrdUJUP7EjvTUw6e89s9
```

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 3 (`readAt` uses `readText`); Deliverable 2 → Step 1 (CRLF case via `crlfCheckoutRead`, both mutations). AC1 → Steps 1/4, AC2 → Step 5, AC3 → Step 4 plus the build's central `npm test`.
- **Placeholders:** none.
