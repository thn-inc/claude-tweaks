---
files:
  - plugin/bin/lib/hooks/session-end.js
  - plugin/bin/lib/hooks/context.js
  - plugin/bin/hooks.js
---

# Run a Nested Claude Session Inside a Pipeline Run

**Persona:** a build agent (or the human driving it) partway through a claude-tweaks pipeline run in its own worktree. It shells out to a short nested `claude -p "…"` from the session's Bash tool, for example `claude -p "/doctor prompt-audit"` during an audit record.
**Goal:** run the nested session and read its output, without the nested session's exit marking the still-running parent pipeline run as `interrupted`.
**Entry point:** a Bash tool call that starts `claude -p` from inside a session whose run's `run-state.json` was stamped by `record-worktree`. That stamp records `sessionId` and, since #3845, `ownerPid` (the owning Claude Code process's `CLAUDE_PID`).
**Success state:** the nested session prints its result and exits. The parent run's `run-state.json` still reads `status: active`, its `events.jsonl` has no `session-end` line from the nested process, and the pipeline continues with nothing to restamp.

## Steps

### 1. Start the nested session — pipeline worktree session
- **URL:** the session's Bash tool: `claude -p "{prompt}" [flags]`, run from the pipeline worktree
- **Action:** run the nested command exactly as any other shell command. No env scrubbing, `--bare`, or `CLAUDE_CODE_SESSION_ID` clearing is needed.
- **Should feel:** like an ordinary subprocess call. The nested session is a tool the agent uses; it is not a second owner of the run.
- **Should understand:** the nested process gets its own `CLAUDE_PID`. Claude Code sets it per process, for both its Bash tool and its hooks. That is what tells the nested session apart from the run's owner, even when it resolves the same run (an inherited session id, or an inherited `PIPELINE_RUN_DIR`).
- **Red flags:** being told to clear `CLAUDE_CODE_SESSION_ID` or pass `--bare` before a nested run. The fix does not rely on that, and an instruction to do so suggests the guard has regressed.

### 2. The nested session ends — same terminal
- **URL:** the nested session's own SessionEnd hook (`hooks.js session-end`)
- **Action:** nothing to do. The hook compares the run's `ownerPid` with its own `CLAUDE_PID`, sees a different process while the owner is still alive, and writes nothing.
- **Should feel:** invisible. The command returns and the agent reads the output.
- **Should understand:** the guard writes nothing at all, neither the `interrupted` stamp nor an event breadcrumb, because another process ending is not this run's event. It applies only while the owner process is alive. A genuine owner session ending, or a crash followed by a resume in a new process, still stamps `interrupted` as before.
- **Red flags:** after a nested `claude -p` returns, the parent's `run-state.json` reads `status: interrupted` with `lastEvent: session-end`, or the next nested SessionStart banner lists the live run as interrupted. That is the #3845 defect reappearing. Check whether `run-state.json` carries an `ownerPid` at all; a run stamped before #3845, or without `CLAUDE_PID` in the environment, falls back to the old behaviour by design.

### 3. Continue the pipeline — pipeline worktree session
- **URL:** the next pipeline step (a commit, a push, `/claude-tweaks:test`)
- **Action:** carry on. There is no `record-worktree` restamp to run.
- **Should feel:** uninterrupted. Nothing about the run needed repair.
- **Should understand:** resume freshness checks (`check-resume-freshness`) and the reconciler read `status`. Leaving it `active` keeps them from treating a live run as abandoned.
- **Red flags:** having to rerun `record-worktree` after every nested `claude -p` to clear a false `interrupted`. That was the pre-#3845 workaround and should no longer be needed.

## Origin
- Created during build of #3845. Run `2026-10-21T001740-record-3056` (#3056's /prompt-audit comparison) had its status flipped to `interrupted` three times by nested `claude -p "/doctor prompt-audit"` sessions, and recovered only because the agent noticed and restamped.
- Related records: #3845, #3056, #62 (the bystander and guessed-run attribution rules this guard sits beside).
