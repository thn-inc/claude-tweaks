# Windows regression: 1 test file(s) newly failing after 12c39e008 (#3797) Implementation Plan

**Goal:** Make `tests/review-console-header-conformance.test.js` CRLF-safe by routing its `readConsole` helper through the shared EOL-normalizing `readText`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T234336-record-3797/spec-3797/work/3797-spec.md` (materialized from GitHub issue #3797)

---

### Task 1: Route `readConsole` through `readText` from `./helpers/read-skill`

**Files:**
- Modify: `tests/review-console-header-conformance.test.js`
- Read-only: `tests/helpers/read-skill.js` (`readText` reused, unchanged)

- [ ] **Step 1: Failing test** — run the file under a CRLF simulation (a scratch `--require` preload that makes `fs.readFileSync(..., 'utf8')` of a `.md` file return `\r\n` text) and confirm both #3712 tests (single-spec and multi-spec) fail before the fix. The preload stays scratch (session scratchpad), not committed.
- [ ] **Step 2: Implement** — `readConsole` (line 36) returns `readText(path.join(__dirname, '..', file))`, with `readText` imported from `./helpers/read-skill`; no raw `fs.readFileSync` of a markdown file remains in the file. No assertion text changes.
- [ ] **Step 3: Run** — `node --test tests/review-console-header-conformance.test.js` is green, and the same run under the CRLF preload is green (both #3712 tests pass).
- [ ] **Step 4: Commit** — one commit, `Route review-console header conformance reads through readText — CRLF-safe on Windows checkouts (refs #3797)`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 2. AC1 → Step 2. AC2 → Steps 1 and 3 (CRLF simulation before/after). AC3 → Step 3. AC4 is post-merge Windows CI only — not verifiable in-run.
- **Placeholders:** none.
