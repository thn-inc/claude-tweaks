# Windows regression: 1 test file(s) newly failing after 32377b60a (#3886) Implementation Plan

**Goal:** The two `renderProject` file:// URL tests in `tests/statusline.test.js` derive their expected link from `pathToFileURL(dir).href` (the same builder production uses) instead of hard-coded POSIX `file:///Users/...` literals, so they pass on Windows where the URL correctly carries a drive letter.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T220207-record-3857/spec-3886/work/3886-spec.md` (materialized from GitHub issue #3886)

---

### Task 1: Derive the two renderProject URL expectations from `pathToFileURL`

**Files:**
- Modify: `tests/statusline.test.js`
- Read-only: `plugin/bin/claude-tweaks-statusline.js` (builds the link via `pathToFileURL`; no production change)

- [ ] **Step 1: Failing test** — this is a test-only fix whose failure shows on win32 only. Before editing, prove the current tests are platform-coupled: show (e.g. with a scratch `node -e` using `path.win32`/`url.pathToFileURL` semantics, or by reasoning from `pathToFileURL('/Users/x/Code Workspaces/my-proj').href` on win32 yielding `file:///D:/Users/...`) that the hard-coded literals at lines ~259-263 and ~265-268 cannot match on win32. Record the evidence in the report; no committed win32-simulation test is required by the spec.
- [ ] **Step 2: Implement** — in "renderProject: percent-encodes spaces in the file:// link" (~line 259) and "renderProject: the file:// link ends with a trailing slash" (~line 265), compute the expected URL from `pathToFileURL(dir).href` (directly, or via the existing `linkedName(dir)` helper at ~line 25) instead of the `file:///Users/...` literals. Keep each test's own point explicit: the percent-encoding test still asserts the link contains `Code%20Workspaces` (a raw space never appears in the URL); the trailing-slash test still asserts the URL ends with `/` immediately before `\x07`. Do not add a `process.platform` branch with two literals (spec Gotchas).
- [ ] **Step 3: Run** `node --test tests/statusline.test.js` — PASS. Confirm `grep -n "file:///Users" tests/statusline.test.js` finds no literal in either renderProject URL test.
- [ ] **Step 4: Commit** — one commit, `Derive statusline file:// URL expectations from pathToFileURL — Windows adds a drive letter, refs #3886`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 2. AC1 (no `file:///Users/...` literal; computed from pathToFileURL) → Steps 2-3; AC2 (`Code%20Workspaces` and trailing `/` before `\x07` still asserted) → Step 2; AC3 (green on Linux/macOS) → Step 3; AC4 (next post-merge Windows check) is post-merge evidence, not buildable here.
- **Placeholders:** none.
