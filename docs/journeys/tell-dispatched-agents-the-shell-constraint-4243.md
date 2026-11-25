---
files:
  - plugin/skills/build/dispatch.md
  - plugin/skills/_shared/subagent-dispatch-core.md
  - plugin/skills/_shared/scratch-worktree.md
  - tests/build-dispatch-shell-constraint-prose.test.js
---

# Tell Dispatched Agents the Shell Constraint

**Persona:** A maintainer of a claude-tweaks repo who lets `/claude-tweaks:flow` or `/claude-tweaks:dispatch` build a record in a linked worktree. The harness refuses Bash calls it cannot verify stay inside the worktree, such as heredocs, `for`/`while` loops, `cd … &&` chains and `git` inside `$(...)`. In #4149's run, 131 such refusals hit the session and its dispatched agents, 90 of them in one hour of fix and re-review rounds.
**Goal:** Every agent a build dispatches knows the shell constraint before its first Bash call, so it writes plain commands instead of hitting a refusal and retrying.
**Entry point:** Any `/claude-tweaks:build` subagent run: `/claude-tweaks:flow #N`, a dispatched `build,test` call, or a standalone `/claude-tweaks:build #N`.
**Success state:** The run's `wd-guard-refusal` events fall to the odd one-off. Agents run multi-step probes as a scratchpad script. The maintainer should feel that refusals are rare surprises, not a running cost of every worktree build.

## Steps

### 1. /build forwards the constraint to every dispatch — `build/dispatch.md`
- **URL:** —
- **Action:** In the same invocation instruction that carries the no-stash rule, `/build` tells `/superpowers:subagent-driven-development` to include the shell-constraint paragraph in every dispatch it composes. That covers implementers, fix rounds (a resumed or a fresh implementer), NEEDS_CONTEXT/BLOCKED re-dispatches, task reviews and re-reviews. It also covers the final-review, fix-wave and whole-branch-fix dispatches that SDD composes outside its per-task loop.
- **Should feel:** Like a house rule stated up front rather than learned from a refusal.
- **Should understand:** The paragraph cites `_shared/subagent-dispatch-core.md`'s "One plain command per Bash call" and `_shared/scratch-worktree.md` §7 rather than copying the refusal table. So when #3822 settles the wording, the prompt follows without a second edit.
- **Red flags:** A reviewer or final-review prompt with no shell-constraint paragraph; a third, drifting copy of the §7 table in `dispatch.md`.

### 2. An agent runs a multi-step probe as a script — scratchpad + `node <script>`
- **URL:** —
- **Action:** **The agent** needs several dependent shell steps, such as a bash differential or a revert-and-rerun check. It writes the steps to a scratchpad script with the Write tool and runs `node <script>` as one plain call. It does not chain them in a heredoc or a loop.
- **Should feel:** Routine: the workaround is named in the prompt, so the agent never has to work it out.
- **Should understand:** One plain command per Bash call is the general pattern, with literal paths and `git -C "<worktree>"`, and a double-quoted path rather than a backslash-escaped space.
- **Red flags:** A fix round that repeats the same refused shape after a refusal.

### 3. A conformance test keeps the instruction in place — `tests/build-dispatch-shell-constraint-prose.test.js`
- **URL:** —
- **Action:** `npm test` reads `build/dispatch.md`'s shell-constraint paragraph, bounded at the next bold lead. It checks that the paragraph names each dispatch kind, both citations and the scratchpad-script workaround.
- **Should feel:** Safe to edit around: removing or hollowing out the paragraph turns the suite red.
- **Should understand:** The test pins the prose, not byte counts. `dispatch.md` also stays under the `RAIL_BYTES` read rail.
- **Red flags:** A test that still passes with the paragraph removed.

## Origin
- Created during build of #4243 (found by `/claude-tweaks:reflect full`'s Friction lens at wrap-up of #4149); absorbs #5335's roster and naming requirements
- Steps 1-3 built in this session
- Related: `keep-the-shared-stash-through-a-dispatched-build-4559.md` (the same forward-through-the-invocation-instruction shape for the no-stash rule)
