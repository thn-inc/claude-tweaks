# wrap-up-engine render: resolve an archived run directory like verify does (#3856) Implementation Plan

**Goal:** Make `wrap-up-engine.js render` resolve an archived run directory via `resolveArchivedRunDir`, the way `verify` already does, so the original `$PIPELINE_RUN_DIR` path works before and after wrap-up's cleanup item 8 archives the run.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T094052-record-3856/work/3856-spec.md` (materialized from GitHub issue #3856)

---

### Task 1: Resolve an archived run dir in render, then drop the prose workaround and its pin

**Files:**
- Modify: `plugin/bin/wrap-up-engine.js`
- Modify: `plugin/skills/wrap-up/SKILL.md`
- Modify: `tests/wrap-up-phase4-report-order-conformance.test.js`
- Test: `tests/bin-lib/wrap-up/engine-cli.test.js`

- [ ] **Step 1: Failing test** — in `tests/bin-lib/wrap-up/engine-cli.test.js`, add a test that builds a run dir with a recorded `engine-state.json` under a temp repo's `.claude-tweaks/pipelines/{run-id}/`, captures `render --run-dir {original} --section trace --strict` output, moves the directory to `.claude-tweaks/pipelines/archive/{run-id}/`, re-runs the same command with the original path from inside the repo, and asserts identical stdout and exit 0. It must fail before the fix (render exits 2: could not read engine-state.json).
- [ ] **Step 2: Implement** — in `runRender`, resolve `args.runDir` through `resolveArchivedRunDir(args.runDir, resolveRepoRoot(process.cwd()))` before reading `engine-state.json` (fall back to the original path when it resolves to null, so the existing "could not read" error still names the given path). Then drop the archive-path workaround sentence from `plugin/skills/wrap-up/SKILL.md`'s phase-trace report step (keep the "Substitute the re-resolved run-dir path" clause), and remove `assertRenderArchivePath`, its AC1 test, and its go-red control from `tests/wrap-up-phase4-report-order-conformance.test.js`.
- [ ] **Step 3: Run** `node --test tests/bin-lib/wrap-up/engine-cli.test.js tests/wrap-up-phase4-report-order-conformance.test.js` — PASS. Revert the `runRender` change locally to confirm the new test goes red, then restore.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3856`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (render resolves archived run dir) and AC1 (same table before/after archival) — Steps 1-2; AC2 (test goes red without the fallback) — Steps 1 and 3; Deliverable 2 (drop the SKILL.md sentence and its pin) — Step 2.
- **Placeholders:** none.
