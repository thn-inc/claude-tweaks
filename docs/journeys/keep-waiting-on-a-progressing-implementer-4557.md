---
files:
  - plugin/skills/_shared/subagent-dispatch-core.md
  - plugin/skills/dispatch/task-prompt.md
  - plugin/skills/dispatch/express-prompt.md
  - plugin/skills/flow/context-handoff.md
---

# Keep Waiting on a Progressing Implementer

**Persona:** a maintainer whose `/claude-tweaks:dispatch` Task call (or a `/claude-tweaks:flow` context-handoff child) is building a multi-file record, where the dispatched agent waits on a nested implementer that edits files in a worktree.
**Goal:** the wait does not end the run while the implementer is visibly working. A slow but live implementer finishes its task; only a stalled one stops the run.
**Entry point:** a dispatched build whose `superpowers:subagent-driven-development` implementer is still running when the dispatched agent's 60 x `sleep 20` wait bound (20 minutes) expires.
**Success state:** a progressing implementer gets more 60-wait windows (up to 3 per wave, 60 minutes) and reports normally. A stalled one stops the run with `STATUS: BLOCKED`, naming `no progress for one window` or `ceiling reached while progressing` and every child that showed no change.

## Steps

### 1. Take the launch probe
- **URL:** the dispatched agent's turn, right after it launches a wave of write-capable children
- **Action:** the agent probes each child's worktree, read-only: `git -C {child-worktree} rev-parse HEAD`, `git -C {child-worktree} --no-optional-locks status --porcelain`, and `git -C {child-worktree} --no-optional-locks diff HEAD` piped to `git hash-object --stdin`. `{child-worktree}` is the path the child's own prompt names. It then waits with foreground `sleep 20` calls as before, logging one line per wait.
- **Should feel:** invisible. The probe is three plain read-only commands; nothing in the child's worktree changes because it was looked at.
- **Should understand:** the probe never reads the child's `output_file` and never writes. A child whose prompt names no worktree has nothing to probe and counts as unchanged.
- **Red flags:**
  - a probe that writes (an index refresh without `--no-optional-locks`, `hash-object -w`);
  - a read or tail of the child's `output_file`;
  - a probe against `{worktree}` (the handing-off agent's own checkout) instead of the child's.

### 2. Grant another window while the child changes
- **URL:** the same turn, when the 60-wait bound expires with the child still outstanding
- **Action:** the agent probes again and compares with the previous probe. If any child in the wave shows a change in HEAD, the porcelain status, or the diff hash, it logs one wait line and grants one more 60-wait window. A wait call that fails ends its window early, and the probe runs as at any bound. An agent with no launch probe (for example, a handoff child continuing mid-wave) lets this first bound's probe set the baseline and grants one window.
- **Should feel:** like ordinary progress. The wait lines continue, a short line records the extra window, and the implementer's commit arrives a few minutes later.
- **Should understand:** progress is judged per wave, so one changing child keeps the whole wave waiting. Children that share a worktree progress together, because the probe cannot tell them apart. A failed probe command counts as no change and is never retried in another form.
- **Red flags:**
  - a `STATUS: BLOCKED` stop at the first bound while the child's HEAD or diff moved;
  - a comparison against the launch probe at every bound, which lets a child that edited once and then stalled run to the ceiling;
  - a longer or backgrounded sleep in place of a failed wait call.

### 3. Stop a stalled or overlong wave
- **URL:** the same turn, when a whole window passes with no change in any child, or at the third window's bound
- **Action:** the agent stops and ends with `STATUS: BLOCKED`, naming which condition fired (`no progress for one window` or `ceiling reached while progressing`) and every child that showed no change. It never redoes a write-capable child's unit in-session.
- **Should feel:** diagnosable. The report says whether the child was stuck or just slow, and which children were still.
- **Should understand:** an abandoned child keeps running and may still write, so redoing its unit in-session is still forbidden. Read-only units (a lens, a single read, a judge) are unchanged: still self-judged at the first bound. A child that only re-edits an already-created untracked file for a whole window shows no change and stops as before — an accepted blind spot.
- **Red flags:**
  - a BLOCKED report that does not name the condition or the unchanged children;
  - a fourth window;
  - an in-session redo of the stopped child's task.

## Origin
- Created during the build of #4557. A `/flow #N build,test,review,polish auto` run's handoff child stopped `BLOCKED` at the fixed 20-minute bound while its implementer was healthy and committed seconds later, costing a fresh-agent resume and the run's last context handoff. The progress check is stated once in `_shared/subagent-dispatch-core.md`'s Foreground Execution Discipline and restated word-for-word in `dispatch/task-prompt.md` (item 7 and both call templates), `dispatch/express-prompt.md` (both templates) and `flow/context-handoff.md`'s handoff template.
- Related journeys: `keep-a-second-reader-in-a-dispatched-review-3078.md` (the same 60-wait bound for read-only lens children), `hand-a-phase-to-a-fresh-agent-at-the-context-cap-4027.md` (the handoff child that inherits this bound), `resume-a-stalled-dispatched-build-4588.md` (the recovery path a false stop used to force).
