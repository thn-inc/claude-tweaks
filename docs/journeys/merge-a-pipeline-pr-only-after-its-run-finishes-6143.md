---
files:
  - plugin/bin/lib/hooks/inflight-pr-gate.js
  - plugin/bin/lib/hooks/named-run.js
  - plugin/bin/lib/hooks/git-command.js
  - plugin/bin/lib/hooks/pre-tool-use.js
  - plugin/bin/lib/flow/inflight-run.js
  - plugin/bin/lib/phase-exit/exit-record.js
  - plugin/bin/lib/reconcile/post-merge.js
  - plugin/bin/lib/reconcile/index.js
  - plugin/bin/lib/reconcile/format-summary.js
  - plugin/bin/lib/hooks/session-start.js
---

# Merge a Pipeline PR Only After Its Run Finishes

**Persona:** A developer, or an agent session working for them, that is clearing a batch of open PRs (`gh pr ready N`, `gh pr merge N`). Some of those PRs are `pr-first` draft PRs that another session's pipeline run is still building.
**Goal:** Merge what is actually finished, and never ship a half-built draft or have reconcile treat its record as shipped.
**Entry point:** A Bash call `gh pr ready N` or `gh pr merge N …`. PR N's body starts with a `claude-tweaks-run: {run-id}` marker, and that run's build or test phase is still unfinished.
**Success state:** The call is denied with a reason naming the run, its unfinished phase and its owning session. The run's own wrap-up merges the PR later. If a merge lands mid-run anyway, reconcile keeps the record's claim, its `auto:build` grant and the run directory. It posts one comment on the record and reports the merge as a hollow merge.

## Steps

### 1. Try to ready or merge the draft — Bash
- **URL:** `gh pr merge N --squash` (or `gh pr ready N`)
- **Action:** Run the command from a session that does not own the run.
- **Should feel:** Like a guard rail that names who to wait for. It should not feel like a mysterious failure.
- **Should understand:**
  - The PreToolUse gate reads PR N with `gh pr view` from the call's own cwd. It applies the call's own `GH_REPO=`/`GH_HOST=` prefix, passing a carried `GH_REPO` as `--repo`.
  - The deny reads `PR #N is the draft PR of pipeline run {id}, which is still in flight ({phase} phase not finished) and is owned by session {sid}` and says to leave it to that run's wrap-up.
  - "In flight" means the run-state is not `clean`, and the build or test phase is unfinished. A phase counts as finished when its checklist row is checked or absent. An unchecked row also counts as finished when `decisions.md`, or any `spec-{N}/decisions.md`, records `Phase exit: {phase} phase exited at {sha}`.
- **Red flags:** A merge that goes through while the build is running. A deny that names no run or owner. A deny on a PR with no marker.

### 2. The owning run merges its own PR — background
- **URL:** the run's wrap-up (`_shared/pr-first-merge.md`)
- **Action:** Nothing to do. The owning session merges after its build and test phase exits.
- **Should feel:** Invisible. The owner is never blocked.
- **Should understand:**
  - The caller whose `session_id` equals the run-state's `sessionId` is always allowed. When the run-state has no `sessionId`, every caller is allowed.
  - These calls are always allowed:
    - a cancel (`gh pr ready --undo`, or `gh pr merge --disable-auto`, bare or `=true`);
    - an unreadable PR or run;
    - a call behind `env -i`, `sudo` or similar while the hook env carries `GH_REPO`/`GH_HOST`;
    - a lost cwd.
- **Red flags:** The owner's own wrap-up denied. A cancel call denied.

### 3. Abandoned run — settle it first
- **URL:** `/claude-tweaks:dispatch resume`, or `/claude-tweaks:wrap-up {target} cleanup-only`
- **Action:** When the owning run is dead, settle it with the command the deny names, then retry the merge.
- **Should feel:** One clear way out.
- **Should understand:** Once the run is closed (`clean`) or its phases have exited, the gate allows the merge.
- **Red flags:** A deny with no way out. The recovery is to hand-edit `run-state.json`.

### 4. A merge that slipped through — reconcile
- **URL:** the reconcile summary (SessionStart line, `/claude-tweaks:dispatch` or `/claude-tweaks:tidy` pre-step)
- **Action:** Read the summary line `held as hollow merges (run unfinished…)`, or the separate check-failed line.
- **Should feel:** Like a clear alarm. The record should not look shipped.
- **Should understand:**
  - Known gaps let some merges reach this step: a `gh pr merge` inside `$(…)` or `sh -c`, or one whose PR number is a variable (the usual loop shape), is not seen by the gate.
  - Reconcile's `detectHollowMerges` holds such a run through release, post-merge and archive. It posts one comment on the record, claimed so that two racing passes post only one.
  - A check that fails is held and reported as `hollow-check-failed` and retried next pass. A whole-pass failure holds everything as `hollow-merge-check-failed`.
  - A project where the check cannot apply (`not-github-issues`, `no-remote`, `unknown-host`) settles as before.
- **Red flags:** "Shipped in vX" posted on a record whose build never landed. The claim or `auto:build` stripped from a hollow merge. Two comments for one merge.

## Origin

Built for record #6143, after PR #6061 was readied and merged mid-build by a batch-merging session on 2026-11-23. #6064 and #6065 were merged the same way.
