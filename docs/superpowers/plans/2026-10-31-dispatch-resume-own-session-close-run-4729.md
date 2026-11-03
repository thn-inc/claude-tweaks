# dispatch resume: name close-run when the conflicting bound run belongs to this session (#4729) Implementation Plan

**Goal:** `plugin/bin/dispatch-resume.js`'s bound-run scan gives a conflicting bound run owned by this same session its own `concurrent-resume` line naming both readings and their remedies, including `close-run --run "{dir}"`, instead of the generic "once that run ends" line.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T165424-record-4729/work/4729-spec.md` (materialized from GitHub issue #4729)

---

### Task 1: Give an own-session conflicting bound run its own concurrent-resume line naming close-run

**Files:**
- Modify: `plugin/bin/dispatch-resume.js`
- Test: `tests/bin-lib/dispatch/dispatch-resume-cli.test.js`
- Waived `docs/journeys/resume-a-stalled-dispatched-build-4588.md`: Deliverable 3 is conditional, and neither this file nor `plugin/skills/dispatch/resume.md` quotes the concurrent-resume line (checked with grep for `once that run ends` / `another dispatch resume may be running`)

- [ ] **Step 1: Failing test** — in `tests/bin-lib/dispatch/dispatch-resume-cli.test.js`, add an `ownSessionLine(dir)` helper beside `concurrentLine`, and change the existing `a bound run owned by this same session id is never proven dead` test (#965) to expect `ownSessionLine(LEFTOVER)` in both `--bound-run` and verdict mode, still with reason `concurrent-resume`; assert the line contains `close-run --run "${LEFTOVER}"`. The `live` row of `a bound run whose owner is live, unknown or on another host` keeps `concurrentLine` (a different, provably live session — unchanged).
- [ ] **Step 2: Implement** — in `boundRunConflict`, after the `dead-owner && !ownSession` branch, return `{reason: 'concurrent-resume', line}` for `ownSession`, where `line` names both readings: another resume in this session may still be running (stop it, then re-run `/claude-tweaks:dispatch resume #N`), or a crashed earlier resume left the run open (close it with `node "{HOOKS_JS}" close-run --run "{dir}"`, then re-run). Never return `stale-bound-run` for it. Update the file-header and `boundRunConflict` comments to match.
- [ ] **Step 3: Run** `node --test tests/bin-lib/dispatch/dispatch-resume-cli.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4729`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 2; Deliverable 2 → Step 1; Deliverable 3 → waived (no quote present). AC 1 → Step 1's own-session assertions; AC 2 → the unchanged `live` row; AC 3 → Common Step 5's full suite.
- **Placeholders:** none.
