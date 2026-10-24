---
files:
  - plugin/skills/tidy/actions-github-issues.md
  - plugin/skills/tidy/step-6-auto.md
  - plugin/skills/tidy/SKILL.md
  - plugin/skills/_shared/pr-first-merge.md
  - plugin/skills/_shared/acceptance-labeling-landed.md
  - tests/tidy-arm-ready-pr-acceptance-guard.test.js
---

# Tidy Holds a PR Whose Acceptance Labeling Never Landed

**Persona:** a maintainer running a `/claude-tweaks:tidy` sweep (or approving its staged rows with `tidy --approve`). The sweep surfaced a green, `auto:merge`-granted, plugin-created PR whose `--auto` was never armed.

**Goal:** the sweep never arms a PR whose merge would close its record with no `demo:pending` label and no Try it walkthrough. The maintainer learns exactly why it didn't arm and what to run next.

**Entry point:** an approved record-linked **Arm ready PR** row from Step 6. That flavor always stages, at every tier.

**Success state:** either the PR is armed because labeling demonstrably landed, or it is held with a named reason and a paste-ready next command, with a `SKIP` line in the run's `decisions.md`. Labeling is never run from the sweep, and nothing is silently skipped.

## Steps

### 1. Approve the record-linked Arm ready PR row
- **URL:** `tidy/step-6-auto.md`'s record-linked **Arm ready PR** row → Step 7 → `tidy/actions-github-issues.md`'s `## Arm ready PR`
- **Action:** approve the staged row.
- **Should feel:** approving is safe, because the action re-checks everything before it writes.
- **Should understand:** execution matches the housekeeping flavor except for one extra step, the record-linked acceptance-labeling guard. The fresh re-verify (draft, rollup, head runs, threads, grant) still runs first. A gate that no longer holds is still a silent no-op.
- **Red flags:** the action arming straight from the scan snapshot; the row claiming execution is identical to the housekeeping flavor.

### 2. Let the guard decide whether labeling landed
- **URL:** `## Arm ready PR`'s **Acceptance labeling — record-linked flavor only, before Step 3** paragraph
- **Action:** the action resolves the run dir from the PR body's `claude-tweaks-run:` marker (`pipelines/{run-id}/`, then `archive/{run-id}/`) and reads `verify.json`. A multi-spec parent reads every `spec-*/verify.json`.
- **Should feel:** checked against evidence, not assumed from a green rollup.
- **Should understand:**
  - Landed means every file's `acceptance-labeling` row is `pass`/`skip`.
  - If it isn't landed, or no run dir resolves, the action falls back to the contract's live-state tier (`_shared/acceptance-labeling-landed.md`; an unreadable `verify.json` is not rescued by it). If every `Fixes` record carries `demo:pending`, or a trusted `brief`/`try-it` run comment exists, labeling still counts as landed.
  - On the no-run-dir branch tidy deliberately departs from close-out. Close-out stops that candidate; tidy needs no run dir, because it never runs labeling itself.
  - A marker whose run-id fails `flow/claim-targets.md`'s validation counts as no marker. The `demo:pending` check needs at least one `Fixes` record and a successful label read for each. A failed `verify.json` read holds the PR and never passes it. An empty `Fixes` set, or a failed label or run-comment read, never passes it on its own: the PR is held unless the other live check lands.
- **Red flags:** an untrusted comment counted as landed; a housekeeping-marker PR put through this check (it links no record).

### 3. Read the held outcome
- **URL:** Step 7.5's verification checklist, plus the run's `decisions.md`
- **Action:** read why the PR wasn't armed.
- **Should feel:** told what is missing and what to run next, never left with a silent skip.
- **Should understand:**
  - The checklist shows `Held (not armed): PR #{n} — acceptance labeling not landed ({reason})`, where `{reason}` is one of `verify.json missing`, `acceptance-labeling: {result}` (or `unparseable` / `row absent` for a malformed file), `no run dir`, or `unreadable: {verify.json | labels | comments}`.
  - The recommendation is `/claude-tweaks:dispatch close-out #{record}`, which runs `_shared/pr-first-merge.md` Step 1 before it merges.
  - For `no run dir`, the recommendation is to run close-out from the checkout that holds the run a validated marker names. If no validated marker names one, run `/claude-tweaks:demo #{record}` and merge by hand.
  - When the tidy run has a run dir, its own `decisions.md` (not the PR's run) gains a `SKIP` line for `Step 7 Arm ready PR (skipped)`, naming the reason and the recommended command.
- **Red flags:** an armed PR with no labeling evidence (no `pass`/`skip` row, no `demo:pending` on every `Fixes` record, no trusted `brief`/`try-it` run comment); a PR armed after a failed `verify.json` read, or on an empty `Fixes` set or a failed label or run-comment read with no other live check landing; a bare `close-out` with no target; a no-run-dir hold that recommends close-out from the same environment (close-out stops there too); a report or `SKIP` line that echoes an unvalidated marker value or a `verify.json` string that is not a bare word.

### 4. Expect the row again until labeling lands
- **URL:** the next tidy sweep
- **Action:** run tidy again before labeling has landed.
- **Should feel:** a known limitation, not a regression.
- **Should understand:** until #3963 lands its scan-time routing, item 9 re-stages the same row, and the guard holds it again.
- **Red flags:** a hold that ever turns into an arm with no labeling evidence.

## Origin
- Created during build of #3877, which guards tidy's Arm ready PR on acceptance labeling. It is the third caller of the landed rule that began in `pr-first-merge.md` Step 1 and `dispatch/close-out.md` step 3 (#3783), now the `_shared/acceptance-labeling-landed.md` contract.
- Updated during build of #4045: the landed rule now lives in _shared/acceptance-labeling-landed.md, cited by pr-first-merge Step 1, close-out step 3 and tidy.
