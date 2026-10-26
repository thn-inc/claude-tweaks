---
files:
  - plugin/bin/pr-checklist.js
  - plugin/bin/lib/flow/pr-checklist.js
  - plugin/bin/lib/flow/pr-body.js
  - plugin/skills/_shared/pr-checklist-refresh.md
  - plugin/bin/lib/phase-exit/phase-exit.js
---

# Flip a PR Checklist Row at a Phase Exit

**Persona:** the orchestrating agent of a `pr-first` `/claude-tweaks:flow` run, standing at the exit of its build phase with the branch already pushed. It has done the same six-step read/repair/flip/verify/write dance at every earlier exit and, in #3059's run, hand-wrote a scratch script to stop recomposing it. Later in the journey a **maintainer** opens the draft PR to see which phases have actually run.
**Goal:** mark this phase done on the run's PR, or drop a skipped phase's row, with one command that cannot write the wrong body to the wrong PR.
**Entry point:** `_shared/pr-checklist-refresh.md`'s Phase-checklist update, reached from any phase's own exit (`build`, `test`, `review`, `polish`, `wrap-up`) with `run-state.json` carrying `pr`. Since #4026, `bin/phase-exit.js` runs this CLI in-process after its push and carries the result as `checklist` in its envelope, forwarding `--fixes`, `--remove` and `--summary-file` (`docs/journeys/exit-a-phase-in-one-call-4026.md`). The direct call in step 1 is still how the pre-merge refresh re-flips a row.
**Success state:** the PR body shows `- [x] {phase}` for this phase (or no row at all for a skipped one), every other byte unchanged, and the agent moved on after one call whose JSON line said `written` or `no-op`.

## Steps

### 1. One call does the whole update
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/pr-checklist.js" --run "{run-dir}" --phase {phase} --fixes {n}[,{m}...]`
- **Action:** The agent runs the one command the Phase-checklist update names, passing the bundle's parent run dir (or this run's own) and the run's record numbers. The CLI reads the PR number from `run-state.json`, fetches the body, repairs any missing marker (and logs what it restored to `decisions.md`), flips the one row inside the phases span, runs the Spec-summary check, verifies the body's first line names this run, and writes the body back through `gh pr edit --body-file -`.
- **Should feel:** Like flipping a switch — no temp file to name, no span to hunt for, no first-line re-read to remember.
- **Should understand:** The edit is line-exact: a CRLF body keeps its `\r`, a hand-added `- [ ] test-smoke` row is not mistaken for `test`, and rows outside the phases span are never touched. A body last written through MCP (plain-text markers only) still works, because the plain-text pair is used when the HTML-comment pair is gone.
- **Red flags:** Any byte outside the row changing. A second `gh pr edit` when nothing in the row or summary changed (the call should report `no-op` and write nothing).

### 2. A wrong body is refused, never overwritten
- **URL:** `plugin/bin/pr-checklist.js` exit 4; `_shared/pr-checklist-refresh.md` exit-code list
- **Action:** When the body's first line names a different run id (a PR reused or edited by another run), the CLI exits 4, prints `run marker mismatch on PR #{n}: body names run {found}, expected {runId} — nothing written`, and logs the refusal to `decisions.md` itself (`refused on PR #{n} — run marker mismatch (…)`). The agent hand-logs it only on a `could not append` stderr line, and never fixes the body by hand.
- **Should feel:** Safe — the check runs before the "already checked" shortcut, so a foreign PR that happens to show `- [x] build` is still refused rather than read as done.
- **Should understand:** Exit 4 is distinct from exit 5 (`gh` failed) because the two need different handling: 4 is an integrity stop, 5 is a best-effort warning the pre-merge refresh catches up on.
- **Red flags:** Any `gh pr edit` after a mismatch. Exit 4 treated as a transient retry.

### 3. A skipped phase drops its row, a checked row survives
- **URL:** `--phase polish --remove`; `_shared/pr-checklist-refresh.md` Pre-merge title/description refresh step 1
- **Action:** At polish's would-be exit on a non-frontend single-record run, the agent passes `--remove` and the `- [ ] polish` row disappears. At the pre-merge refresh the agent re-runs the CLI once per phase this run exited (`--remove` for a skipped one), so a row whose own phase-exit write failed gets checked late; a row that already landed reports `no-op`.
- **Should feel:** Self-healing — a missed flip is caught before the merge, without anyone tracking which writes failed.
- **Should understand:** `--remove` only removes an unchecked row. A checked `- [x] polish` reports `already-checked` and stays — in a bundle where one spec skipped polish and another ran it, the run's real polish row is never erased.
- **Red flags:** A checked row vanishing under `--remove`. A row left unchecked at merge after its phase's exit-5 warning.

### 4. The maintainer reads an honest checklist
- **URL:** the draft PR's `### Phases` section on GitHub
- **Action:** **Maintainer** opens the PR before approving the merge and reads which phases are checked.
- **Should feel:** Trustworthy — checked means the phase ran and its exit landed; a missing polish row means polish was skipped, not forgotten.
- **Should understand:** A flip that found no row (`row-absent`) or no phases span (`no-phases-span`) exits 0 but checked nothing — the refresh doc tells the agent to warn on it, so a silent gap is named in `decisions.md`.
- **Red flags:** A checked row for a phase whose `decisions.md` trail shows it never ran. An unchecked row with no warning anywhere in the run's audit trail.

## Origin
- Created during `/claude-tweaks:build` of record #3263 (2026-10-19): `plugin/bin/pr-checklist.js` replaces the hand-composed six-step Phase-checklist update on the `gh`-present path; the MCP path stays documented in `_shared/pr-checklist-refresh.md`.
- Updated during `/claude-tweaks:build` of record #4026 (2026-10-25): `bin/phase-exit.js` now runs this flip as one sub-step of the single phase-exit call.
- Related: `docs/journeys/read-an-accurate-spec-summary-after-a-premise-reversal-3050.md` (the Spec-summary refresh this CLI now runs in the same call)
