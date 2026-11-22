---
files:
  - plugin/bin/lib/hooks/worktree-hold.js
  - plugin/bin/lib/hooks/worktree-reap.js
  - plugin/bin/lib/reconcile/reap-merged.js
  - plugin/bin/lib/hooks/post-tool-use.js
  - plugin/bin/lib/hooks/session-start.js
  - plugin/bin/lib/hooks/session-end.js
  - plugin/bin/lib/hooks/subagent-stop.js
  - plugin/skills/dispatch/sequential-execution.md
  - docs/hooks.md
---

# Keep a Dispatching Session's Worktree Through a Sibling's Reconcile

**Persona:** A maintainer running `/claude-tweaks:dispatch` over several records in one session, under `pr-first`, while other Claude sessions on the same repo start, compact and run their own background reconcile. In #4960's incident, record #4551's PR merged, a sibling session's SessionStart-spawned reconcile reaped `dispatch-record-4551` while the dispatching session still stood in it, and every later `gh`/`git` call failed with `not a git repository`.
**Goal:** No session removes a worktree that a live session is standing in. If one disappears anyway, the stranded session recovers in two tool calls without guessing.
**Entry point:** Any session entering a linked worktree: `EnterWorktree` from `/claude-tweaks:dispatch`, `/claude-tweaks:flow`, or a subagent; a session launched or resumed inside one. A reconcile pass in any session (`reap-merged.js` under pr-first, `reapWorktrees` at SessionStart) then meets that worktree.
**Success state:**
- **While a session lives:** the worktree survives every sibling's reconcile pass while its session lives, through compaction, `/clear` and subagent finishes.
- **After the session ends:** the worktree is reaped on the next pass, and the reap lands as a `worktree-reaped` event in its run's `events.jsonl`, even when that run was already closed or archived in the same pass.
- **Feel:** the maintainer should feel that sibling sessions share the machine without stepping on each other's working directories.

## Steps

### 1. Entering a worktree leaves a hold — `plugin/bin/lib/hooks/worktree-hold.js`, `post-tool-use.js`, `session-start.js`
- **URL:** —
- **Action:**
  - **The dispatching session** calls `EnterWorktree(path: …)`. The PostToolUse hook writes `{gitdir}/claude-tweaks-holds/{session}__main__{claude-pid}.json` in that worktree's own git admin dir, and clears the same key from any worktree the session left. A subagent's EnterWorktree writes its own `agent_id` key instead.
  - **A session launched or resumed inside a worktree** gets a separate `home` hold from SessionStart. EnterWorktree never moves that hold and ExitWorktree never clears it, so a compaction inside another worktree does not take it away.
- **Should feel:** Invisible: nothing prints, and a failing hold write never changes a hook's answer.
- **Should understand:**
  - The hold names the Claude process's pid and its start time, so a dead or recycled pid reads as gone.
  - The hold lives in the admin dir, so `git worktree remove` takes it along. An older plugin build in flight never reads it, and nothing it does breaks.
  - Which hook writes or clears which key (`main`, a subagent's `agent_id`, `home`) is spelled out in `docs/hooks.md`'s "Worktree hold (log tier, #4960)" bullet, the contract this journey walks.
- **Red flags:**
  - No hold file after EnterWorktree.
  - A hold left in the previous worktree under the same key.
  - The `home` hold gone after a compact or `/clear`.

### 2. A sibling's reconcile skips the held worktree — `plugin/bin/lib/hooks/worktree-reap.js` (`holdVerdict`), `plugin/bin/lib/reconcile/reap-merged.js`
- **URL:** —
- **Action:** **A sibling session's** background reconcile reaches the merged group's worktree. `holdVerdict` judges each hold with the shared owner-pid probe:
  - a live pid reads `held`;
  - an unreadable hold, a foreign host or a missing pid reads `held-unverifiable`, which fails closed.
  Either way the worktree is skipped.
- **Should feel:** Quiet for the normal case:
  - a `held` skip writes no event;
  - the SessionStart banner does not list it, like `in-use`.
  A `held-unverifiable` skip is reported on every pass, so a stuck hold cannot hide.
- **Should understand:** Deleting a file under `{gitdir}/claude-tweaks-holds/` is safe once no session stands in that worktree. That is the way out of a hold that stays unverifiable, for example after a crashed session and a hostname change.
- **Red flags:**
  - A held worktree reaped.
  - A thrown probe read as "dead".
  - A `held-unverifiable` skip that never surfaces.

### 3. Leaving lets the reaper back in — `session-end.js`, `subagent-stop.js`, `post-tool-use.js` (ExitWorktree)
- **URL:** —
- **Action:**
  - ExitWorktree clears the session's key.
  - SubagentStop clears the finished subagent's key, so a parent's still-live pid never keeps a subagent's worktree.
  - SessionEnd clears every hold for the session and pid, `home` included.
  - On `/clear`, SessionEnd releases nothing. The process lives on, and pid liveness frees those holds when it exits.
  - The next reconcile pass reaps the merged worktree and writes `worktree-reaped` into the owning run's `events.jsonl`. When several runs recorded the same path, the newest one gets the event: a live run first, then the newer of the closed and archived matches.
- **Should feel:** Like normal cleanup: the merged worktree goes away after its session is gone, and the reap is on the run's trail.
- **Should understand:** Skip events stay live-only. A closed or archived run gets the reap event, never a repeating skip line on every background pass.
- **Red flags:**
  - A hold that survives its session's exit.
  - A reap with no event in its run.
  - A skip line appended to an archived run every few minutes.

### 4. A stranded session recovers in two calls — `plugin/skills/dispatch/sequential-execution.md`
- **URL:** —
- **Action:** If a group's worktree disappears anyway (the symptom is Bash's `Working directory … was deleted; shell cwd recovered`, then `gh`/`git` failing with `not a git repository`), **the dispatching session** runs `ExitWorktree(action: "keep")` first. It then creates the next group's worktree per "Creating the group's worktree" and runs `EnterWorktree(path: …)` into it. With no group left, it stays in the original checkout.
- **Should feel:** Mechanical: the section names the symptom, the two calls in order, and the one thing not to do.
- **Should understand:** Never use a plain `cd`. The session stays isolated in the deleted path, and the harness keeps refusing every command until ExitWorktree releases it.
- **Red flags:**
  - Recovery prose that recommends `cd`.
  - EnterWorktree tried before ExitWorktree.
  - A step pointing at a worktree that does not exist yet.

## Origin
- Created during build of #4960 (dispatch: a merged group's worktree can be deleted while the dispatching session is still in it, stranding the session).
- Steps 1-4 were built in this session.
- Related:
  - `reap-merged-worktrees-at-drain-end-3026.md`: the reap-merged path this journey guards.
  - `session-start-fast-background-reconcile.md`: the background reconcile that ran the reap.
