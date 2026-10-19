# Windows regression: 2 test file(s) newly failing after f6e30ca84 (#3518) Implementation Plan

**Goal:** Make the five dispatch/specify prose tests that fail only on Windows checkouts pass there — LF-normalize the near-duplicate suite's skill reads and splice a forward-slash plugin root into embedded node snippets — with no change under `plugin/`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T065906-record-3518/work/3518-spec.md` (materialized from GitHub issue #3518)

---

### Task 1: LF-normalize the near-duplicate suite's reads and splice a forward-slash plugin root in both suites

**Files:**
- Modify: `tests/specify-near-duplicate-prose.test.js`
- Modify: `tests/dispatch-per-record-groups-prose.test.js`
- Reference (read-only): `tests/helpers/read-skill.js` (`readText`), `tests/auto-merge-short-circuit-verdict-backstop.test.js:28` (`PLUGIN_DIR` precedent), `plugin/skills/specify/shaping-mode.md`, `plugin/skills/dispatch/queue-pull-script.md`

- [ ] **Step 1: Failing test** — in `tests/specify-near-duplicate-prose.test.js`, give `refusalFenceBody` an optional `text` parameter defaulting to `SHAPING_MODE`, and add one assertion (a new test) that `refusalFenceBody(SHAPING_MODE.replace(/\n/g, '\r\n')).fence` deep-equals `refusalFenceBody().fence`. Before normalization is added inside `refusalFenceBody`, this fails on Linux/macOS (the `node -e "\n` anchor is not found in CRLF text).
  Run: `node --test tests/specify-near-duplicate-prose.test.js`
  Expected: FAIL (the new CRLF case only)
- [ ] **Step 2: Implement** —
  1. `tests/specify-near-duplicate-prose.test.js`: route `read` (line 18) through `readText` from `./helpers/read-skill` (`read = (rel) => readText(path.join(ROOT, rel))`).
  2. Same file: `refusalFenceBody(text = SHAPING_MODE)` LF-normalizes `text` (`.replace(/\r\n/g, '\n')`) before searching for the anchors and slicing; the #3141 test (line 93) calls `refusalFenceBody()` instead of its inline copy of the open/close anchors (delete lines 96-101's duplicate anchor logic, keep the assertions and the `MIN_REFUSAL_SCORE` check against the spliced code).
  3. Both files: add one module-level `const PLUGIN_DIR = path.join(ROOT, 'plugin').split(path.sep).join('/');` (built exactly like `tests/auto-merge-short-circuit-verdict-backstop.test.js:28`) and splice `PLUGIN_DIR` instead of `path.join(ROOT, 'plugin')` at `tests/dispatch-per-record-groups-prose.test.js:134` (`neighbourHeredocCode`) and `tests/specify-near-duplicate-prose.test.js:101` and `:170`. In the dispatch suite `ROOT` is declared at line 80 — declare `PLUGIN_DIR` right after it (or move both up), never before `ROOT` exists.
  4. Grep both files again for any remaining `${CLAUDE_PLUGIN_ROOT}` substitution with a native path or raw `fs.readFileSync` of a skill file; fix any hit the same way (`fs.readFileSync(exclusionsPath, ...)` of a temp JSON file in the dispatch suite is not a skill read — leave it). Record the grep and its result for the PR body.
- [ ] **Step 3: Run** `node --test tests/specify-near-duplicate-prose.test.js tests/dispatch-per-record-groups-prose.test.js` — PASS, no test skipped, removed or weakened. Then prove discrimination: temporarily remove the `.replace(/\r\n/g, '\n')` inside `refusalFenceBody`, run the near-duplicate suite (the CRLF case must FAIL), and restore it in the same command.
- [ ] **Step 4: Commit** — one commit, `Fix Windows-only failures in dispatch/specify prose tests — refs #3518`.

---

## Self-review

- **Spec coverage:** Deliverables 1 (readText routing), 2 (refusalFenceBody reuse + text param + CRLF case), 3 (forward-slash PLUGIN_DIR in three places), and 4 (re-grep, result for the PR body) are Task 1 Step 2 items 1-4. AC1 (macOS/Linux pass) and AC3 (CRLF case red without normalization) are Step 3. AC4 (no `plugin/` change) holds by construction — only the two test files are modified. AC5 (`npm test`) runs at Common Step 5. AC2 (windows-latest run via `gh workflow run windows-regression.yml --ref {branch}`) is an operational action run after the commit is pushed, outside this task.
- **Placeholders:** none.
