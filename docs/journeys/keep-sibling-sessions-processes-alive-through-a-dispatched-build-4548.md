---
files:
  - plugin/skills/_shared/subagent-dispatch-core.md
  - plugin/skills/build/dispatch.md
  - plugin/skills/dispatch/task-prompt.md
  - plugin/skills/dispatch/express-prompt.md
  - plugin/skills/flow/multispec-parallel-waves.md
  - plugin/bin/lib/hooks/git-command.js
  - plugin/bin/lib/hooks/bash-prefilter.js
  - plugin/bin/lib/hooks/pre-tool-use.js
  - plugin/skills/_shared/dev-url-detection.md
  - plugin/skills/journey-health/deep-tier.md
  - plugin/skills/wrap-up/cleanup-procedures-execution.md
---

# Keep Sibling Sessions' Processes Alive Through a Dispatched Build

**Persona:** A maintainer running several Claude sessions at once in sibling worktrees of one repo, each with its own dev server or tooling, while `/claude-tweaks:flow` or `/claude-tweaks:dispatch` builds a record in one of them. In #4548's incident, an implementer stopped a stray background build with `taskkill /F /IM node.exe` and killed every node process on the machine, including the other sessions' servers.
**Goal:** A dispatched agent stops only the processes it started. A name-based kill never takes down a sibling session's server, and a dev-server teardown never kills the browser that was talking to it.
**Entry point:** Any dispatched build or runtime check that starts and stops a process: `/claude-tweaks:flow #N`, a dispatched `build,test` call, a Task-0-style runtime verification task, or `/claude-tweaks:visual-review` and `/claude-tweaks:stories` against a dev server.
**Success state:** After the build, every sibling session's dev servers and tooling are still running. The agent's own process is gone, killed by its PID or its port's listener. If an agent reached for a name-based kill anyway, it saw a warning naming the PID-scoped alternative before the command ran. The maintainer should feel the process table is shared ground the agents respect, not one careless command away from a machine-wide outage.

## Steps

### 1. Every dispatched agent is told not to kill by name — `_shared/subagent-dispatch-core.md`, `build/dispatch.md`, `dispatch/task-prompt.md`, `dispatch/express-prompt.md`, `flow/multispec-parallel-waves.md`
- **URL:** —
- **Action:** Next to the no-`git stash` rule, every dispatch prompt that can run commands carries one more rule: never kill a process by image or name (`taskkill /IM`, `pkill`, `killall`, `Stop-Process -Name`, a `pgrep`-fed `kill`), because the process table is shared machine-wide with sibling sessions. Kill only a PID you started or your own port's listener (`lsof -nP -iTCP:{port} -sTCP:LISTEN -t`; win32: `taskkill /PID {pid} /T /F`). If neither can be found, leave the process running and report it. `build/dispatch.md` cites the canonical paragraph; `/dispatch`'s two Task calls, the express call, and the parallel-wave member prompt inline it, since agents see only their prompt.
- **Should feel:** Concrete: the agent is told what to do instead, not only what not to do.
- **Should understand:** "Leave it running and report it" is the sanctioned fallback. A stray process left alive costs a report line; a broad kill costs every sibling session's work.
- **Red flags:** A dispatch prompt with the no-stash rule but no process-kill rule beside it; a rule that forbids `pkill` but offers no PID-scoped alternative.

### 2. The hook warns an agent that reaches for a name-based kill — `plugin/bin/lib/hooks/pre-tool-use.js`, `git-command.js`, `bash-prefilter.js`
- **URL:** —
- **Action:** **The agent** issues `pkill node`, `killall node`, `taskkill /F /IM node.exe`, `TASKKILL /im node.exe /f`, `taskkill /FI "IMAGENAME eq node.exe"`, `Stop-Process -Name node`, `Get-Process node | Stop-Process`, `kill $(pgrep node)`, `pgrep -f vite | xargs kill`, `ps aux | grep node | awk '{print $2}' | xargs kill`, or one of these wrapped in `sh -c`, `bash -c`, `cmd /c` or `powershell`/`pwsh -Command`. The PreToolUse hook adds a `claude-tweaks: killing a process by image or name …` warning. It names the shared process table and the PID-scoped alternative.
- **Should feel:** Like a tap on the shoulder, not a wall: the command still runs (warn, never deny), wherever the session is and whether or not a pipeline run is active.
- **Should understand:** PID-scoped kills stay silent: `kill 12345`, `kill -- -12345` (the process group this pipeline started), `taskkill /PID 12345 /T /F`, `taskkill /FI "PID eq 12345"`, `lsof -nP -iTCP:3000 -sTCP:LISTEN -t | xargs kill`, and a PID lookup such as `ps -p 123 -o pid= | grep 123 | xargs kill`. Command names match case-insensitively, since Windows treats them that way. The hook header records the narrow misses it accepts, such as PowerShell aliases and a positional `powershell "…"` with no `-Command`.
- **Red flags:** No warning on `pkill node` (the prefilter skipped the command before the gate loaded); a warning on `kill 12345`; a deny where the gate should only warn; a session broken by a parse error instead of falling silent.

### 3. Dev-server teardowns kill only the listener — `_shared/dev-url-detection.md`, `journey-health/deep-tier.md`, `wrap-up/cleanup-procedures-execution.md`
- **URL:** —
- **Action:** When the plugin tears down an ephemeral dev server by port, it runs `lsof -nP -iTCP:{port} -sTCP:LISTEN -t | xargs kill` (or kills the recorded PID where one exists). It no longer runs `lsof -ti tcp:{port} | xargs kill`, which also matched every client connected to that port.
- **Should feel:** Invisible: the server stops, and the Playwright browser or another session's tab that was connected to it keeps running.
- **Should understand:** The win32 branches were already PID-scoped (`taskkill /PID {pid} /T /F`) and are unchanged. A test fails if the unscoped `lsof -ti tcp:` form returns anywhere under `plugin/skills`.
- **Red flags:** A teardown that closes the maintainer's browser; an unscoped `lsof -ti tcp:` reintroduced in a skill file.

## Origin
- Created during build of #4548 (build: dispatch rules forbid git stash but not image-name process kills — a subagent killed every node process on the machine)
- Steps 1-3 built in this session
- Related: `keep-the-shared-stash-through-a-dispatched-build-4559.md` (the no-stash rule and warn gate this record mirrors), `run-shell-loops-without-a-hook-storm-3074.md` (the Bash prefilter that routes kill commands to the gate)
