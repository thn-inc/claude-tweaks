---
files:
  - plugin/skills/_shared/pr-check-gate.md
  - plugin/bin/pr-checks.js
  - plugin/bin/lib/pr-checks/classify.js
  - plugin/skills/test/SKILL.md
  - plugin/skills/review/code-mode-steps.md
---

# Stop a Run on Its Own Red PR Check

**Persona:** a maintainer of a `pr-first` project running `/claude-tweaks:flow #N` or `/claude-tweaks:dispatch`, whose run's draft PR has CI that can go red on the runner while local verification passes (a timing race, a Linux-only failure).
**Goal:** learn that the run's own PR is red at the commit `/test` just blessed — before review, polish, and wrap-up are spent on top of it — and know which check, where, and what to do.
**Entry point:** `/claude-tweaks:test`'s pipeline gate (Step 2 Report, before `TEST_PASSED` is set) or `/claude-tweaks:review` Step 1.5's Test Gate, both running `node "${CLAUDE_PLUGIN_ROOT}/bin/pr-checks.js" --run "$PIPELINE_RUN_DIR"` per `plugin/skills/_shared/pr-check-gate.md`.
**Success state:** a red check at HEAD stops the gate with each failing check's name and run URL; a pending or not-yet-pushed HEAD passes with a logged caveat; a run with no PR (`local-merge`, pre-PR) behaves exactly as before, with one `SKIP` line explaining why the read did not apply.

## Steps

### 1. Local verification passes; the gate reads the PR
- **URL:** `plugin/skills/test/SKILL.md` Step 2 Report; `plugin/skills/_shared/pr-check-gate.md` "When it runs"
- **Action:** After the full suite passes, `/test` runs `bin/pr-checks.js --run "$PIPELINE_RUN_DIR"`. It reads `run-state.json`'s `pr.number`, fetches the PR's `statusCheckRollup` and `headRefOid` and the head sha's workflow runs (`gh run list --commit`), and prints one JSON line with a `state`.
- **Should feel:** Automatic — one extra line in the run, no prompt.
- **Should understand:** The read only concludes anything when the PR's `headRefOid` is local HEAD; otherwise it is `stale` (the newest commit is not pushed or not yet checked). The classification rules are the merge gate's own (`_shared/pr-first-merge.md` Step 2.5, applied by `bin/lib/pr-checks/classify.js`) with one deliberate divergence: a failed commit-status (StatusContext) entry reads `red` here, while the merge gate's literal rule holds that same entry `pending` — so a red here can show as a pending wait at merge time, and the merge gate's read stays the final authority.
- **Red flags:** `TEST_PASSED` set before the read ran; a `stale` result treated as green evidence; a skip path setting `TEST_PASSED` with no read — the gate applies before every `/test` pipeline bullet that sets it, including the QA pass stamp skip (`QA: skipped — stories already passed at {short-sha}`, #3003), not only after a full-suite run.

### 2. Red at HEAD stops the run
- **URL:** `plugin/skills/_shared/pr-check-gate.md` `red` bullet; `plugin/skills/review/code-mode-steps.md` Step 1.5 Gate table
- **Action:** `state: red` → `/test` does not set `TEST_PASSED` and renders "PR #{pr} check `{name}` is failing at {sha} ({url})" for each failing check; at review, the Gate table's `pr-checks.js` reports `red` row is **STOP**.
- **Should feel:** Like a local test failure — the same class of stop, with the evidence attached.
- **Should understand:** A green local run is not evidence against a red CI check — fix forward on the branch, push, and re-run `/claude-tweaks:test`. If the same check is also red on `origin/{integration-branch}`'s tip, the failure is inherited: catch the branch up with the integration branch instead of debugging the diff. Under `merge-verification: off` red is a logged caveat, not a stop, matching the merge gate's own `off` behaviour.
- **Red flags:** A red check reported without its name or URL; review proceeding to Step 2 on a red read; a stop under `merge-verification: off`.

### 3. Pending, stale, or no PR at all
- **URL:** `plugin/skills/_shared/pr-check-gate.md` `pending`/`stale` and fail-open bullets
- **Action:** `pending`/`stale` → the gate passes with an `AUTO` decision line naming the pending checks (or the unpushed HEAD); `no-pr`, `gh-absent`, `no-ci`, `read-failed` → the gate passes on the local result with one `SKIP` decision line naming the condition.
- **Should feel:** Quiet — nothing changes for a `local-merge` run except one audit line.
- **Should understand:** `read-failed` means the gate could not tell, never that CI is green; the merge gate's own read stays the final authority before anything merges. A rollup that is all green while a head-sha workflow run is still in progress — a sibling workflow not yet registered in the rollup — reads `pending`, not `green` (#3405). A failed head-run read (`gh run list`) is `read-failed` too — unless the rollup is already red, which is conclusive on its own and stops the run as in step 2.
- **Red flags:** A `local-merge` run stopping on this gate; a `read-failed` result logged as a pass with no `SKIP` line; `green` reported while `gh run list --commit {headRefOid}` still lists a run that has not completed; a red rollup reported as `read-failed` because the head-run read failed.

## Origin
- Created during `/claude-tweaks:build` of record #3013 (2026-10-16): `/test`'s pipeline gate and `/review` Step 1.5 read the run PR's checks at HEAD through `bin/pr-checks.js`; red fails the gate.
- Updated during `/claude-tweaks:build` of record #3405 (2026-10-17): the reader also lists the head sha's workflow runs, so a partial rollup reads `pending`; a stale head skips that read.
- Related: `docs/journeys/recover-a-ci-parked-run.md` (the merge gate's own red path, after review)
