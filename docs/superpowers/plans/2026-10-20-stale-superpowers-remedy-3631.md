# Stale-superpowers notice names no remedy for a record whose worktree directory was deleted (#3631) Implementation Plan

**Goal:** When the effective superpowers install is a project or local record whose `projectPath` no longer exists, the SessionStart notice names the probed remedy instead of none.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T071346-spec-3631/work/3631-spec.md` (materialized from GitHub issue #3631)

---

### Task 1: Name the probed remedy in superpowersNotice's missing-path suffix

**Files:**
- Modify: `plugin/bin/lib/superpowers-version.js`
- Test: `tests/bin-lib/superpowers-version.test.js`

- [ ] **Step 1: Failing test** — in `tests/bin-lib/superpowers-version.test.js`, extend the existing test "a project record whose projectPath no longer exists says so instead of naming it as the place to run from" (around line 130) and add a `scope: 'local'` sibling. For each scope assert that the notice:
  - still contains the existing wording ` (this install is recorded for ${gone}, which no longer exists; it applies here because that path belongs to the same git checkout`
  - contains `claude plugin update superpowers@${MK} --scope ${scope}` (update command, scope-correct)
  - contains `mkdir -p "${gone}"` (path quoted; the temp paths can contain spaces in this repo's checkout)
  - contains `claude plugin uninstall superpowers@${MK} --scope ${scope}`
  - contains a warning that running that uninstall from this checkout removes this checkout's own record (assert a stable phrase, e.g. `removes this checkout's own record`)
  - does not contain `run from`
  Also tighten "a local record for an existing, different directory gets the "run from" suffix" (around line 141) to assert the notice contains neither `mkdir` nor `uninstall`. Leave "notice copy is exact" (user scope) untouched — it must still pass byte-for-byte.
  Run: `node --test tests/bin-lib/superpowers-version.test.js` — Expected: FAIL (the mkdir/uninstall/warning assertions).
- [ ] **Step 2: Implement** — in `superpowersNotice`, change only the `lstatType(...).type === 'missing'` branch's suffix: keep the current recorded-for clause, then state that the update command above, run from this checkout, updates that record (the first applicable one); that removing it instead means `mkdir -p "{projectPath}"`, running `claude plugin uninstall superpowers@{marketplace} --scope {scope}` from inside that directory, then deleting the directory; and that running that uninstall from this checkout removes this checkout's own record, not the stale one. Keep the notice one line and keep the trailing "never run the update yourself" instruction unchanged. Add to the module header comment, next to the existing pointer to installed-plugins.js's 2026-10-19 probe, a short paragraph recording the 2026-10-20 probe on Claude Code 2.1.302: `update` (explicit `--scope project`/`local`, or auto scope) from the main checkout updates the first applicable record in file order; `uninstall --scope project`/`local` from the main checkout removes the main checkout's own record (exact `projectPath` match); after `mkdir -p` of the deleted path, `uninstall` run from inside it removes the stale record; `uninstall --scope local` against project records fails with "installed in project scope, not local".
- [ ] **Step 3: Run** `node --test tests/bin-lib/superpowers-version.test.js tests/hooks-session-start.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, `Name the probed remedy in the stale-superpowers missing-path notice — refs #3631`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (suffix states the remedy + warning) → Step 2; Deliverable 2 (header probe note) → Step 2; Deliverable 3 (tests pin project and local) → Step 1. AC1 (project: mkdir + uninstall + existing wording) and AC2 (local scope in both commands) → Step 1's two missing-path tests; AC3 (warning asserted) → Step 1; AC4 (existing-different-dir keeps "run from", no mkdir/uninstall) → Step 1's tightened test; AC5 (user-scope byte-identical) → "notice copy is exact" untouched; AC6 (header names the probe and 2.1.302) → Step 2; AC7 (the two suites pass) → Step 3.
- **Placeholders:** none.
