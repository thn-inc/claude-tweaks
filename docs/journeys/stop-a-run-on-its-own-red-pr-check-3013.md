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
**Entry point:** `/claude-tweaks:test`'s pipeline gate (Step 2 Report, before `TEST_PASSED` is set) or `/claude-tweaks:review` Step 1.5's Test Gate, both running `node "${CLAUDE_PLUGIN_ROOT}/bin/pr-checks.js" --run "$PIPELINE_RUN_DIR" --section "{/test|/review}"` per `plugin/skills/_shared/pr-check-gate.md`.
**Success state:** a red check this run caused stops the gate with that check's name and run URL; a PR red only on checks already failing on its base branch's tip passes with a logged caveat naming the base sha and those checks; a pending or not-yet-pushed HEAD passes with a logged caveat; a run with no PR (`local-merge`, pre-PR) behaves exactly as before, with one `SKIP` line explaining why the read did not apply.

## Steps

### 1. Local verification passes; the gate reads the PR
- **URL:** `plugin/skills/test/SKILL.md` Step 2 Report; `plugin/skills/_shared/pr-check-gate.md` "When it runs"
- **Action:** After the full suite passes, `/test` runs `bin/pr-checks.js --run "$PIPELINE_RUN_DIR" --section "/test"`. It reads `run-state.json`'s `pr.number`, fetches the PR's `statusCheckRollup` and `headRefOid` and the head sha's workflow runs (`gh run list --commit`), and prints one JSON line with a `state`. It also writes that state's decision line itself and reports `logged` (#4026).
- **Should feel:** Automatic — one extra line in the run, no prompt.
- **Should understand:** The read only concludes anything when the PR's `headRefOid` is local HEAD; otherwise it is `stale` (the newest commit is not pushed or not yet checked). The classification rules are the merge gate's own (`_shared/pr-first-merge.md` Step 2.5, applied by `bin/lib/pr-checks/classify.js`). That includes commit-status (StatusContext) entries, which both reads normalize by `state` first (#3257): `FAILURE`/`ERROR` read `red`, `PENDING`/`EXPECTED` read `pending`, and `SUCCESS` reads green. A red StatusContext here is also red at merge time, and the merge gate's read stays the final authority.
- **Red flags:** `TEST_PASSED` set before the read ran; a `stale` result treated as green evidence; a skip path setting `TEST_PASSED` with no read — the gate applies before every `/test` pipeline bullet that sets it, including the QA pass stamp skip (`QA: skipped — stories already passed at {short-sha}`, #3003), not only after a full-suite run.

### 2. Red at HEAD stops the run
- **URL:** `plugin/skills/_shared/pr-check-gate.md` `red` bullet; `plugin/skills/review/code-mode-steps.md` Step 1.5 Gate table
- **Action:** On a `red` verdict — a failing rollup check or a failing head-sha workflow run — the reader also reads the tip of the PR's own base branch (`baseRefName`, printed as `baseBranch`) — its check runs, commit statuses and workflow runs — and flags each failing check `inherited` or not. `state: red` (at least one attributable check) → `/test` does not set `TEST_PASSED` and renders "PR #{pr} check `{name}` is failing at {sha} ({url})" for each check **not** flagged `inherited`, listing any inherited ones after it as also failing on `{baseBranch}` at `{baseSha}`; at review, the Gate table's `pr-checks.js` reports `red` row is **STOP**.
- **Should feel:** Like a local test failure — the same class of stop, with the evidence attached, and only the checks this run caused named as the cause.
- **Should understand:** A green local run is not evidence against a red CI check — fix forward on the branch, push, and re-run `/claude-tweaks:test`. When the output carries `baseReason`, the base could not be read: every failing check is treated as attributable and the read stays `red`, never green. Under `merge-verification: off` red is a logged caveat, not a stop, matching the merge gate's own `off` behaviour.
- **Red flags:** A red check reported without its name or URL; an inherited check named as the cause; review proceeding to Step 2 on a red read; a failed base read turning the result green; a stop under `merge-verification: off`.

### 3. Every red check is inherited from the base branch
- **URL:** `plugin/skills/_shared/pr-check-gate.md` `inherited-red` bullet
- **Action:** `state: inherited-red` (every failing check also failing at the base tip) → `/test` sets `TEST_PASSED` with a caveat and logs one `AUTO` line naming the base sha and the inherited checks; `/review` Step 1.5 proceeds.
- **Should feel:** Unblocked but informed — the run continues instead of stopping for a failure its diff did not cause, and the audit trail says why.
- **Should understand:** Inherited means the same check name is failing on `{baseBranch}`'s tip — catch the branch up, or wait for the base to be fixed, rather than debugging this diff. The pass is the gate's only: the merge gate (`_shared/pr-first-merge.md` Step 2.5) keeps its own read and still sees these checks red, and this read does not report still-pending checks on an `inherited-red` result.
- **Red flags:** An `inherited-red` pass with no `AUTO` line naming the base sha; `inherited-red` concluded while the head-run read failed (that is `read-failed`); an `inherited-red` result treated as permission to merge.

### 4. Pending, stale, or no PR at all
- **URL:** `plugin/skills/_shared/pr-check-gate.md` `pending`/`stale` and fail-open bullets
- **Action:** `pending`/`stale` → the gate passes with an `AUTO` decision line naming the pending checks (or the unpushed HEAD); `no-pr`, `gh-absent`, `no-ci`, `read-failed` → the gate passes on the local result with one `SKIP` decision line naming the condition.
- **Should feel:** Quiet — nothing changes for a `local-merge` run except one audit line.
- **Should understand:** `read-failed` means the gate could not tell, never that CI is green; the merge gate's own read stays the final authority before anything merges. A rollup that is all green while a head-sha workflow run is still in progress — a sibling workflow not yet registered in the rollup — reads `pending`, not `green` (#3405). A failed head-run read (`gh run list`) is `read-failed` too — unless the verdict is still `red` after the base comparison, which is conclusive on its own and stops the run as in step 2; a partial read never concludes `inherited-red`.
- **Red flags:** A `local-merge` run stopping on this gate; a `read-failed` result logged as a pass with no `SKIP` line; `green` reported while `gh run list --commit {headRefOid}` still lists a run that has not completed; a red rollup reported as `read-failed` because the head-run read failed.

## Origin
- Created during `/claude-tweaks:build` of record #3013 (2026-10-16): `/test`'s pipeline gate and `/review` Step 1.5 read the run PR's checks at HEAD through `bin/pr-checks.js`; red fails the gate.
- Updated during `/claude-tweaks:build` of record #3405 (2026-10-17): the reader also lists the head sha's workflow runs, so a partial rollup reads `pending`; a stale head skips that read.
- Updated during `/claude-tweaks:build` of record #3257 (2026-10-19): the merge gate now normalizes StatusContext entries the same way this reader does, so the former red-here/pending-at-merge divergence is gone.
- Updated during `/claude-tweaks:build` of record #3258 (2026-10-19): on a red read the reader compares against the PR's base-branch tip; all-inherited red is `inherited-red` (a caveat pass), mixed red names only the attributable checks, an unreadable base stays `red`.
- Related: `docs/journeys/recover-a-ci-parked-run.md` (the merge gate's own red path, after review)
