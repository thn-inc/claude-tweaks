---
files:
  - plugin/skills/_shared/github-pr-scan.md
  - plugin/bin/pr-checks.js
---

# See a Partly Reported CI Run as Pending

**Persona:** a maintainer of a GitHub-backed project who checks `/claude-tweaks:help`'s Current PR section or `/claude-tweaks:tidy`'s PR findings right after pushing, while some of the head commit's workflow runs have started but not yet registered in the PR's check rollup.
**Goal:** read the PR's CI as pending until every head-sha run has reported — never as passing on the strength of the checks that happened to register first.
**Entry point:** `/claude-tweaks:help` (Stage 4.5, `_shared/github-pr-scan.md` `current-pr` scope) or `/claude-tweaks:tidy` (Step 4.8, `repo-wide` scope).
**Success state:** /help's `CI checks` row reads `0 failing, N pending` while a head run is still in progress; /tidy lists that PR under the `CI failing/pending or changes requested` finding with `CI pending`, not under `awaiting review` with `CI passing`; once every run completes green, both read passing.

## Steps

### 1. /help reads the current PR's CI
- **URL:** `plugin/skills/_shared/github-pr-scan.md` `current-pr` item 3
- **Action:** Run `/claude-tweaks:help` on the PR's branch. The scan runs `node "${CLAUDE_PLUGIN_ROOT}/bin/pr-checks.js" --pr {number}` and counts from its `state`: `red`/`inherited-red` → failing, `pending` → pending, `green`/`no-ci` → passing, `read-failed`/`gh-absent` → `CI unavailable`.
- **Should feel:** Trustworthy at a glance — the row only says nothing is pending once nothing is.
- **Should understand:** `pr-checks.js` lists the head sha's workflow runs alongside the rollup, so a run the rollup has not registered yet still counts as pending. A failed read says `CI unavailable` and makes no claim either way.
- **Red flags:** `0 failing, 0 pending` while `gh run list --commit {head-sha}` still lists an in-progress run; a `read-failed` read rendered as passing.

### 2. /tidy classifies every open PR's CI
- **URL:** `plugin/skills/_shared/github-pr-scan.md` `repo-wide` item 1
- **Action:** Run `/claude-tweaks:tidy`. Item 1 lists open PRs with `statusCheckRollup` and prints `#{n} CI {status}` per PR. Only PRs whose rollup already reads green get a `pr-checks.js --pr` call. A PR whose rollup already shows a failing or in-progress entry is classified from the rollup with no extra call.
- **Should feel:** Bounded. The extra calls go only to the PRs whose verdict could still change.
- **Should understand:** A rollup-green PR with a head run still in progress reads `CI pending`, so it lands in the `CI failing/pending or changes requested` finding instead of `awaiting review`. `CI unavailable` lands in neither finding.
- **Red flags:** An `awaiting review` row whose CI is still running; a `pr-checks.js` call for a PR whose rollup is already red; a failed read counted as passing.

## Origin
- Created during `/claude-tweaks:build` of record #3658 (2026-10-21): `current-pr` item 3 and `repo-wide` item 1 now read CI through `bin/pr-checks.js --pr` instead of `gh pr checks`, so a partly reported run reads pending in both.
- Related: `docs/journeys/stop-a-run-on-its-own-red-pr-check-3013.md` (the same reader on a run's own PR); `docs/journeys/settle-a-batch-of-parked-prs.md` (the #3469 display reader).
