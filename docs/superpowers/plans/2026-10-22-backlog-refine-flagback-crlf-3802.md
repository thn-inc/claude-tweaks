# Windows regression: 1 test file(s) newly failing after 8039e9166 (#3802) Implementation Plan

**Goal:** Make `tests/backlog-refine-flagback-divergence.test.js` CRLF-safe by reading both markdown files through the shared EOL-normalizing `readText`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T234336-record-3797/spec-3802/work/3802-spec.md` (materialized from GitHub issue #3802)

---

### Task 1: Read `refine-mode.md` and `refine-closing-summary.md` through `readText` from `./helpers/read-skill`

**Files:**
- Modify: `tests/backlog-refine-flagback-divergence.test.js`
- Read-only: `tests/helpers/read-skill.js` (`readText` reused, unchanged)

- [ ] **Step 1: Failing test** — run the file under a CRLF simulation (a scratch `--require` preload that makes `fs.readFileSync(..., 'utf8')` of a `.md` file return `\r\n` text) and confirm 7 of the file's 9 tests fail before the fix. The preload stays scratch (session scratchpad), not committed.
- [ ] **Step 2: Implement** — lines 16-17 read through `readText(path.join(DIR, ...))`, with `readText` imported from `./helpers/read-skill`; no raw `fs.readFileSync` of a markdown file remains in the file. The `'\n\n'` paragraph split and every assertion stay unchanged. Remove the `fs` import only if it is left unused.
- [ ] **Step 3: Run** — `node --test tests/backlog-refine-flagback-divergence.test.js` is green, and the same run under the CRLF preload is green (all 9 tests pass).
- [ ] **Step 4: Commit** — one commit, `Route backlog refine flag-back test reads through readText — CRLF-safe on Windows checkouts (refs #3802)`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 2. AC1 → Step 2. AC2 → Steps 1 and 3 (CRLF simulation before/after, all 9 tests). AC3 → Step 3. AC4 is post-merge Windows CI only — not verifiable in-run.
- **Placeholders:** none.
