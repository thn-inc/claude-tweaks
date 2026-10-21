# Windows regression: diff-facts conformance plugin path (#3599) Implementation Plan

**Goal:** `tests/diff-facts-parse-numstat-conformance.test.js` splices a native `PLUGIN` path into a JS single-quoted literal, so on win32 its backslashes are eaten as escapes — build that path with forward slashes and pin it on Linux.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T124821-spec-3599-3602-3695-3696-3698-3699-3595/spec-3599/work/3599-spec.md` (materialized from GitHub issue #3599)

---

### Task 1: Forward-slash the spliced plugin root and pin it with a win32-shaped root

**Files:**
- Modify: `tests/diff-facts-parse-numstat-conformance.test.js`
- Read: `plugin/bin/lib/shared-primitives.js` (`toPosix(p, sep = path.sep)` — read only)
- Read: `plugin/skills/wrap-up/ceremony-derivation.md` (the extracted composition — read only, unchanged)

- [ ] **Step 1: Failing test** (covers AC1.1) — add a Linux-runnable case: build the plugin root from `path.win32.join('D:\\a\\repo', 'plugin')` through the same helper line 13 uses, splice it into the extracted `node -e` command exactly as the existing test does, and assert the resulting command contains no `\` character. Route line 13's `PLUGIN` through a small helper taking the path implementation as a parameter (default `path`), so the pin exercises the same code the real test uses. Keep `ROOT` native for the `readText` calls (line 14).
- [ ] **Step 2: Implement** — the helper returns `toPosix(pathImpl.join(root, 'plugin'), pathImpl.sep)`; `PLUGIN` is that helper applied to `ROOT`.
- [ ] **Step 3: Run the test** (covers AC2.1, AC3.1) `node --test tests/diff-facts-parse-numstat-conformance.test.js` — PASS. Then temporarily revert the helper body to the native `pathImpl.join(root, 'plugin')`, re-run, confirm the new case FAILS, and restore.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3599`.

Do not edit `plugin/skills/wrap-up/ceremony-derivation.md` (spec Gotcha: 100+ shipped `require('${CLAUDE_PLUGIN_ROOT}/...')` sites share its shape — a separate question).

---

## Self-review

- **Spec coverage:** D1 (forward-slash `PLUGIN` via `toPosix`) → Steps 1-2; D2 (Linux-runnable win32-shaped pin) → Step 1. AC1 (no `\` for a `path.win32.join('D:\\a\\repo','plugin')` root) → Step 1; AC2 (fails on revert) → Step 3; AC3 (file passes, `npm test` passes) → Step 3 + Common Step 5.
- **Placeholders:** none.
