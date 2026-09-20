---
files:
  - plugin/skills/_shared/pr-first-merge.md
  - plugin/skills/dispatch/SKILL.md
  - plugin/skills/backlog/refine-mode.md
  - plugin/skills/_shared/github-pr-scan.md
---

# Recover a Run the Merge-Verification Gate Parked

**Persona:** Maintainer of a `pr-first` project who finds a work record carrying `bot:parked` while its `auto:build`/`auto:merge` grants are still intact, and a ready (non-draft) PR that never merged.
**Goal:** Understand that the run was *parked, not failed* — the merge gate saw a red or still-pending check on the PR — and get it moving again without re-authorizing a build or bypassing the checks.
**Entry point:** The `bot:parked` label on the record, the gate's park comment on the issue (`Parked by merge-verification ({value}): {failing checks} on PR #{n}. Resume once green.`), or `/claude-tweaks:tidy`'s Shape 5.6 row.
**Success state:** The maintainer knows which check parked the run and why (`check-failed:{names}` or `checks-pending-timeout`), fixes or re-runs the check, and resumes the run through the confirmation gate — which merges only when the checks are green (or arms `--auto` only where the forge itself holds the merge).

## Steps

### 1. Read the park — GitHub issue
- **URL:** the work-record issue (`gh issue view {n}`) and its linked PR (`gh pr view {pr}`)
- **Action:** Read the gate's comment and the label set: `bot:parked` present, `auto:*` grants still present.
- **Should feel:** Informative, not alarming — a CI outcome, not a broken build.
- **Should understand:** `bot:parked` = parked by `plugin/skills/_shared/pr-first-merge.md`'s Step 2.5 red path. It is a distinct label from the retry ceiling's `bot:blocked` precisely so the two states never have to be told apart by whether grants survived — this path leaves `auto:*` intact. No Settle classification ran, no retry was counted, no attempt comment was posted — this run did not "fail". `/claude-tweaks:tidy`'s Shape 5.6 row says the same: re-triage means checking the PR's checks, not re-authorizing a build.
- **Red flags:** `bot:blocked` on the record instead of `bot:parked` (that is the retry ceiling — a different recovery, and `auto:*` will be gone alongside it); a park comment naming no check and no reason.

### 2. Fix or re-run the check — GitHub / the branch
- **URL:** the failing check's run URL from `gh pr checks {pr}`
- **Action:** Fix the cause on the run's branch (a new push), or re-run a flaky job.
- **Should feel:** Ordinary CI hygiene.
- **Should understand:** Nothing merges on its own while `bot:parked` is present — `_shared/github-pr-scan.md`'s `[pr-unarmed]` sweep skips records carrying it (as it does `bot:blocked`), so a check that goes green later does not silently un-park the run.
- **Red flags:** The PR merging by itself after the check turns green while the label is still on the record.

### 3. Resume through the confirmation — `AskUserQuestion`
- **URL:** `/claude-tweaks:dispatch`'s "Confirm before resuming" (`Resume {target} toward merge? PR #{n} …, CI: {status} …`) — reached by asking the agent to resume the run
- **Action:** Read the CI status in the question and confirm.
- **Should feel:** Decided on evidence — the same status shown is the status acted on.
- **Should understand:** One-shot per Step 2.5's resume rule: green → the run re-enters its Review Console and merges; red → the confirmation says so and the run stays parked; pending → `--auto` is armed only when `mergeStateStatus` is `BLOCKED` (the forge holds it), otherwise the confirmation carries the choice, because on an unprotected repository arming is an immediate merge. Remove `bot:parked` as part of that resume, not before.
- **Red flags:** A resume merging a PR whose checks the question showed as pending or red; the agent running a 15-minute watch inside the confirmation.

## Origin
- Created during build of #560 (merge-verification: merge-site consumers gate on CI) — the gate's red path introduced the "parked with grants intact" state and its recovery.
- Updated during build of #605 (distinct `bot:parked` label for merge-verification parks) — the state this journey covers now carries its own label instead of sharing `bot:blocked` with the retry ceiling, so it is legible at a glance rather than inferred from grant presence; `/claude-tweaks:tidy`'s Shape 5.6 replaces `/claude-tweaks:backlog refine`'s re-triage row as the surfacing lane.
- Related specs: #558 (parent), #559, #560, #531 (the resume confirmation)
