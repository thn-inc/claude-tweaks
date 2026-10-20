---
files:
  - plugin/skills/dispatch/sibling-session-check.md
  - plugin/skills/dispatch/task-prompt.md
  - plugin/bin/hooks.js
  - plugin/bin/lib/hooks/pre-tool-use.js
  - plugin/skills/flow/manifesto.md
  - plugin/skills/flow/SKILL.md
---

# Recover from a Dispatch Config Deny

**Persona:** a dispatched first-call agent running `/claude-tweaks:flow #{n} build,test auto` inside a `/claude-tweaks:dispatch` group's worktree, usually headless. Secondary persona: the `/claude-tweaks:dispatch` session that binds the run before call 1 (Step 1 only).
**Goal:** when a git commit in the group's worktree is denied because `/claude-tweaks:flow` Step 3 never wrote `config.yml`, recover in one step by writing it the sanctioned way and retrying the same commit. The agent should not stall, re-stamp in a loop, or report BLOCKED.
**Entry point:** the dispatching session has run `hooks.js record-worktree --run "$GROUP_RUN_DIR" "{worktree}" --dispatch` before call 1, so the run carries `dispatched: true`. The first call then attempts a Bash git write (`git commit` including `--amend`, `git push`, `git mv`/`rm`/`update-ref`/`apply`) in that worktree while `$GROUP_RUN_DIR/config.yml` does not exist yet. The usual shape is the materialize commit landing before Step 3's Manifesto has run (observed in #3064 and #3066). It also covers a call that skipped `/claude-tweaks:flow` entirely.
**Success state:** Step 3 writes `config.yml` through `set-config.js`, and the identical commit command passes on retry. The run then proceeds through Step 4 in the documented order, and no BLOCKED report is filed for a self-correctable ordering slip.

## Steps

### 1. Bind the run before call 1 — dispatching session
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "$GROUP_RUN_DIR" "{worktree}" --dispatch`, in `dispatch/sibling-session-check.md`'s Worktree-resume check, after the worktree is confirmed fresh
- **Action:** run the bind once, then dispatch the group's first Task call.
- **Should feel:** a single bookkeeping line. It prints `claude-tweaks: worktree recorded for {run-id}`, and a failure never blocks the dispatch.
- **Should understand:** one `run-state.json` write records the worktree, this session's id, a permanent `dispatched: true`, and a `dispatchSessionId` (that same id, written only by `--dispatch`). A later plain `record-worktree` re-stamp never clears that marker or `dispatchSessionId`. Task subagents share this session's id, so their hook calls resolve this same run through `ctx.ownedRun`.
- **Red flags:**
  - binding a worktree the resume check found already present, because that is a sibling's run;
  - a bind failure that stops the dispatch, when it should only be logged;
  - a missing confirmation line silently treated as success;
  - a bind that also prints `dispatchSessionId recorded as null` on stderr. The session had no `CLAUDE_CODE_SESSION_ID`, so wrap-up's auto-merge short-circuit will treat this run's Task calls as human-run: under `local-merge` the merge falls back to the console instead of relaying `ready-to-merge`.

### 2. Commit before config.yml exists — first-call agent
- **URL:** any covered Bash git write issued from inside the bound worktree, typically `git commit -m "Materialize #{n} spec …"`
- **Action:** commit as usual. The gate is invisible to a call that followed `/claude-tweaks:flow`'s documented order (Step 3 Manifesto, then Step 4 materialize commit).
- **Should feel:** unchanged on the documented path. Only an out-of-order or `/flow`-bypassing call ever sees the gate.
- **Should understand:** the deny needs positive evidence on every axis before it fires. That means a session-owned run marked `dispatched: true`, not `clean`, with a caller inside a linked worktree that is provably this run's binding, a git-write target inside that worktree, and no `config.yml`. Anything unprovable is allowed.
- **Red flags:**
  - a deny on a run with no `dispatched` marker (a standalone `/claude-tweaks:build`, a human `/claude-tweaks:flow`), on a `clean` run, or from the main checkout;
  - a deny for `git -C /some/other/repo commit`, which is a foreign repo and should be allowed.

### 3. Read the deny — same agent
- **URL:** the tool call's `permissionDecisionReason`, which starts `claude-tweaks: git write blocked — \`/claude-tweaks:flow\` Step 3 (Manifesto) has not written config.yml`
- **Action:** read the cause, the missing `config.yml` path, and the remedy.
- **Should feel:** diagnosed and self-correcting, not stonewalled. The message also says what not to do.
- **Should understand:**
  - A `record-worktree` re-stamp does not clear this deny, and this deny does not count toward `dispatch/task-prompt.md`'s "denied once, re-stamp and retry; denied twice, BLOCKED" budget.
  - An agent already inside `/claude-tweaks:flow` runs its Step 3 now; an agent that bypassed `/flow` invokes it through the Skill tool.
- **Red flags:**
  - treating this as the first-commit working-directory deny, then re-stamping, retrying, and reporting BLOCKED;
  - hand-writing `config.yml` or editing `run-state.json` to get past it. That works mechanically, but it is the bypass #2837's post-hoc artifact check exists to catch.

### 4. Write config.yml the sanctioned way — same agent
- **URL:** `/claude-tweaks:flow` Step 3: the Manifesto's single `set-config.js --run "$PIPELINE_RUN_DIR" --set "mode=…,…"` batch write
- **Action:** run Step 3 as documented. In `auto` mode that is the read-only FYI table plus the one batch write; there is no approval stop.
- **Should feel:** like resuming the pipeline at the step that was skipped, not like a workaround.
- **Should understand:**
  - `config.yml` existing is the only thing the gate checks, so once Step 3 lands, nothing else needs to change.
  - The run is in `auto` even when the project sets `auto-mode: default-off`: both of dispatch's Task-call commands end their step list with `auto` (`… build,test auto`, `… review,polish,wrap-up auto`), and an explicit mode argument outranks the policy. Without it, `/flow` Step 1's dispatch-binding rung (#3372) still resolves the run to `auto`, because its `run-state.json` carries `dispatched: true`.
- **Red flags:**
  - a Step 3 that writes `config.yml` somewhere other than `$GROUP_RUN_DIR`, such as a worktree-local shadow. The gate keeps denying in that case, and the fix belongs in run-dir anchoring, not here;
  - a dispatched call that still resolves to `interactive`. Now only an explicit `interactive` token, or a call that also lost `PIPELINE_RUN_DIR`, can do that (#3372); it skips the Manifesto, and every commit stays denied.

### 5. Retry the same commit — same agent
- **URL:** the exact command from Step 2
- **Action:** re-issue it unchanged.
- **Should feel:** ordinary. It is identical to a commit that never hit the gate, and from now on the gate costs nothing because the `config.yml` check runs before any git spawn.
- **Should understand:** the gate re-reads the run on every call, so the `config.yml` that `/claude-tweaks:flow` Step 3 wrote (journey step 4 above) is picked up immediately.
- **Red flags:** the retry still denying after `config.yml` exists in `$GROUP_RUN_DIR`. That is a real gap, worth its own report.

## Known limit

A cwd-pinned dispatching session (#447, `dispatch/sequential-execution.md`) still binds, but its Task calls reach the worktree only through a `cd {worktree} &&` prefix. The hook therefore sees the pinned session's cwd rather than the worktree, and the gate is inert. #2837's first-call artifact check is the only guard on that path.

## Origin
- Created during build of #3225: dispatch binds the minted run to the group's worktree before call 1 (`record-worktree --dispatch`), and `pre-tool-use.js`'s `checkDispatchConfigGate` denies git writes there until `/claude-tweaks:flow` Step 3 writes `config.yml`. The deny text was hardened during the whole-branch review: a re-stamp never clears it, it carries no retry-budget charge, and it gives an in-flow remedy.
- Updated during build of #3335: dispatch's Task-call `/claude-tweaks:flow` commands now pass `auto` explicitly, so a project with `auto-mode: default-off` no longer resolves a dispatched call to `interactive`. That mode skipped Step 3 and left this deny with no satisfiable remedy. The pin is `tests/dispatch-flow-explicit-auto-mode.test.js`.
- Updated during build of #3372: `/flow` Step 1 treats a run bound `dispatched: true` as `auto` regardless of `auto-mode`, so a dispatched agent that drops the `auto` token no longer lands here. Pinned by `tests/flow-dispatched-run-auto-mode.test.js`.
- Updated during build of #3711 (dispatch-call discriminator): step 1's bind also stamps `dispatchSessionId`, which wrap-up's auto-merge short-circuit compares against the current session to recognise dispatch's own Task calls. Wrap-up added the red flag for the null stamp written when the session has no id.
- Related records: #2837 (post-hoc first-call artifact check, the backstop), #3212 (the dispatch firing whose first calls #3064 and #3066 committed before writing `config.yml`), #991 / IL-131 (the sibling bookkeeping-stamps gate, `recover-from-a-bookkeeping-stamp-deny.md`).
