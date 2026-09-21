---
files:
  - plugin/bin/lib/hooks/pre-tool-use.js
  - plugin/skills/build/worktree-setup.md
  - plugin/skills/_shared/pr-early-run-lifecycle.md
  - plugin/bin/hooks.js
  - plugin/bin/log-decision.js
  - plugin/bin/check-pr-bookkeeping.js
  - plugin/bin/lib/pr-bookkeeping/precondition.js
  - plugin/skills/test/SKILL.md
---

# Recover from a Bookkeeping-Stamp Deny

**Persona:** a build agent (human or automated) working inside a claude-tweaks pipeline worktree, mid-way through `/claude-tweaks:build`'s Spec Step 1 — having just materialized a spec and judged (correctly or not) that no further implementation is needed.
**Goal:** when a covered Edit/Write/commit/push is denied because the run's `record-worktree` or (under `integration-model: pr-first`) PR-early stamp never landed, recover in one step — without following a remediation command that could corrupt a live sibling session's state.
**Entry point:** any covered tool call (`Edit`, `Write`, `NotebookEdit`, `git commit`, `git push`) issued inside a linked worktree after this run's materialize commit has landed, while `run-state.json`'s `worktree` or `pr` field is still unset — with two carve-outs: one on the `pr` branch (#989): a Bash `git push` whose every target is establishing that branch's upstream tracking ref for the first time **is** `_shared/pr-early-run-lifecycle.md` Step 2 itself, so it is exempt from the PR-stamp deny and simply succeeds. The exemption is one-shot and never memoized as `prExempt`, so a later push of an already-tracked branch with still no recorded PR is denied normally; and it never covers the worktree stamp — a missing `record-worktree` still denies that same push. And one on the file-tool branch (#1678): a covered `Edit`/`Write`/`NotebookEdit` whose own target resolves definitively outside this run's repository (absolute path required; leaf symlink resolved first) never reaches the gate at all.
**Success state:** the missing stamp is recorded (or, for the PR branch, the degrade is logged to `decisions.md`) from the owning session, and the identical tool call now succeeds — or, for a genuinely foreign-owned run, the agent heeds the warning and never runs a stamp-writing command against state it doesn't own.

## Steps

### 1. Attempt the call that trips the gate — worktree session
- **URL:** any `Edit`/`Write`/`NotebookEdit`/`git commit`/`git push` call issued from inside the worktree
- **Action:** proceed with implementation (or a "nothing further to implement" judgment) exactly as before — the gate is invisible until it actually has something to catch.
- **Should feel:** unchanged from before this record — the fast path (`plugin/bin/lib/hooks/pre-tool-use.js`'s I5 early return) means a run with both stamps already recorded pays no extra cost and sees no new behavior.
- **Should understand:** the gate only engages once THIS run's own materialize commit has landed — Common Step 1 running normally is never mistaken for a skip.
- **Red flags:** a deny on a run whose materialize commit has not landed yet (Common Step 1 legitimately still in progress) — that would be the gate itself misfiring, not a real gap. Since #989, a **PR-stamp** deny on the run's initial publish push (the branch has no upstream tracking ref yet) is the same misfire class — that push is exempt by design (`hasNoUpstreamYet`); a PR-stamp deny on a *later* push of an already-tracked branch, or a **worktree-stamp** deny on any push, is correct behavior and belongs in Step 2. Since #1678, a deny on an `Edit`/`Write`/`NotebookEdit` whose target resolves definitively outside this run's own repo entirely (a session scratchpad, or an unrelated repository) is also a misfire — that write is no longer gated at all, and simply succeeds like any ordinary tool call, with nothing to recover from; only a target genuinely inside this run's own worktree/main-checkout still reaches the deny this journey documents. This exemption requires a definitive, provable answer — a relative `file_path` (resolves against the hook process's own cwd, not the calling session's) or a target whose main-checkout root can't be resolved is unprovable, not exempt, and still denies exactly as before; in practice Claude Code's file tools always pass absolute paths, so the relative-path case is not one you should expect to observe.

### 2. Read the deny — same terminal
- **URL:** the tool call's own denial message (`hookSpecificOutput.permissionDecisionReason`)
- **Action:** read which stamp is missing and the exact remediation command the message names — `record-worktree --run "{run-dir}" "{worktree}"` for the worktree stamp, or a pointer to log the PR-early degrade line via `bin/log-decision.js` for the PR stamp.
- **Should feel:** diagnosed, not stonewalled — the message names the specific non-skippable step (`build/worktree-setup.md` Step 4.5 or the PR-early lifecycle) and cites `[IL-131]`, not a generic "denied."
- **Should understand:** this is the same incident the bolded prose in `build/SKILL.md` already warned about — the message exists precisely because that prose alone had already been silently skipped twice.
- **Red flags:** a deny with no remediation command; a remediation command that doesn't match either sanctioned stamp-writing path.

### 3. Check whether this is genuinely your own run — same terminal
- **URL:** the deny (or, on a foreign-owned run, a warning instead) itself
- **Action:** if the message reads as a *warning* ("allowing this call because it comes from a different session") rather than a deny, stop — do not run the remediation command anyway. A provable ownership mismatch downgrades the gate to a warning specifically so this command is never handed out against a run you don't own.
- **Should feel:** protective, not permissive — a warning here is the gate declining to give risky advice, not the gate stepping aside.
- **Should understand:** `docs/hooks.md`'s own rule (omitting `--run` on `record-worktree` can silently corrupt a different live session's `run-state.json`) is exactly the hazard this check exists to prevent.
- **Red flags:** running `record-worktree`/logging a degrade against a run you did not start, on the strength of a warning message alone.

### 4. Run the remediation, from the owning session — worktree session
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{run-dir}" "{worktree}"`, or `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --status AUTO --text "PR-early run lifecycle: ... FAILED" --section "/build"` for a genuine push/PR-create failure
- **Action:** run exactly the command the deny named, from the session that actually owns this run.
- **Should feel:** a one-line unblock, not a debugging session — the command is paste-ready and idempotent (`record-worktree` is documented as a safe restamp).
- **Should understand:** the PR-stamp path is a graceful degrade, not a second enforcement layer — a genuinely failed push/PR-create is meant to be logged and moved past, never forced into existing anyway.
- **Red flags:** inventing a different command; retrying the original call without running either remediation first.

### 5. Retry the original call — same terminal
- **URL:** the exact same `Edit`/`Write`/`git commit`/`git push` call from Step 1
- **Action:** re-issue it.
- **Should feel:** ordinary — identical to a call that never hit the gate.
- **Should understand:** the gate re-checks `run-state.json` fresh on every call, so the fix from Step 4 is picked up immediately, no restart needed.
- **Red flags:** the retry still denying after the remediation genuinely ran from the owning session (a real gap, not documented behavior — worth its own report).

## A second, independent entry point (#2472)

Since #2472, the identical missing-stamp story can also surface at `/claude-tweaks:test`'s own entry (a new "Step 0: PR-Bookkeeping Precondition Check", `plugin/skills/test/SKILL.md`) rather than at an arbitrary covered tool call — a defense-in-depth companion to the gate above, for the case where this run's `ctx.runDir` never resolved during build (so the PreToolUse gate above never armed at all) but `/test` still runs with a known `$PIPELINE_RUN_DIR`. The recovery mechanics are the same commands as Step 4 above (`record-worktree`, or `log-decision.js`'s PR-early degrade line) — only the entry point and the failure shape differ:

- **Entry point:** running `/claude-tweaks:test` (standalone, or via `/claude-tweaks:flow`) against a run whose materialize commit landed with a missing worktree stamp, or (under `integration-model: pr-first`) a missing PR stamp with no logged degrade — checked via `node "${CLAUDE_PLUGIN_ROOT}/bin/check-pr-bookkeeping.js" --run "$PIPELINE_RUN_DIR"`.
- **Failure shape:** the CLI exits 4 and the pipeline renders a HARD-GATE failure card (not a tool-call permission denial) — the failure surfaces once, at the phase boundary, rather than on every subsequent covered call.
- **One documented exception the tool-call gate does not share:** a `git-strategy: current-branch` run legitimately never records a worktree stamp at all (`record-worktree` is skipped entirely in that mode) — the CLI fails open on that shape (`isLinkedWorktree` false) rather than denying, so a `current-branch` run never hits this check on the worktree-stamp path; only the PR-stamp path (independent of git-strategy) can still deny it.

## Origin
- Created during build of #991 — the mechanical backstop for IL-131's recurring gap (a build agent's own "already satisfied by prior work" judgment silently skipping the `record-worktree` and PR-early stamps despite existing bolded prose in `build/SKILL.md`).
- Updated during build of #1678 — the gate's file-tool branch previously denied a covered Write/Edit/NotebookEdit whose own target was entirely outside this run's repo (e.g. a session scratchpad), since it scoped only on the calling session's cwd, never on the write's own target path. Narrowed to mirror the gate's existing Bash-branch "Foreign repos" scoping rule; Step 1's Red Flags updated accordingly.
- Related records: #991, #118, #893, #778 (a related-but-distinct fix for a structural dispatch-created-worktree skip path, not the same trigger as this journey), #1678.
- Updated during build of #2472 — added the second, independent phase-boundary entry point at `/claude-tweaks:test`'s Step 0 (a HARD-GATE CLI check, `plugin/bin/check-pr-bookkeeping.js`), for the case where this run's `ctx.runDir` never resolved during build and the PreToolUse gate above never armed at all. Also fixed a false-positive the new check initially had on `current-branch` git-strategy runs, where a missing worktree stamp is correct by design, not a gap.
