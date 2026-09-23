# Dispatch Step 5 — Sequential Execution Mechanism

Referenced by `skills/dispatch/SKILL.md` Step 5's banner. Full detail on why Step 5 processes groups one at a time instead of in parallel, and what the loop actually does between groups.

## Why sequential, not parallel

A Task-tool subagent is always launched cwd-pinned to the *dispatching session's* own worktree — there is no route to giving two concurrently-running subagents independent worktrees (`EnterWorktree` refuses a subagent cwd override; see #155). The fix is structural, not a policy dial: the **dispatching session itself** switches worktrees between groups.

## When the dispatching session itself is cwd-pinned (#447)

Distinct from `_shared/worktree-setup.md`'s "Adopt-or-create" gate: that section covers a session
that *could* move its cwd via `EnterWorktree` but is already elsewhere when the decision point is
reached (it adopts in place); this section covers a session that structurally cannot move its cwd
at all. Do not merge the two.

The loop below, and `SKILL.md` Step 5's own description of it, assume this dispatching session's cwd is free to move — it enters group N's worktree, and that entry is what lets the two Task calls dispatched into it inherit the right cwd. That assumption fails when `/claude-tweaks:dispatch` is itself launched as a Task/Agent-tool subagent instead of a top-level session: this session's own cwd is pinned by the harness the same way a dispatched call's would be, so this session's own worktree-entry attempt is refused for the identical reason — the same signal `EnterWorktree`'s own refusal already surfaces, just observed one level higher up the chain. Confirmed independently across 3 separate dispatch firings on 2026-08-14, each self-settling correctly via the existing failure path (claim released, `auto:build`/`auto:merge` preserved, no unsafe state left behind) — so the failure mode was safe, just undocumented and previously re-solved ad hoc per firing.

Detect the shape up front — before attempting to enter group N's worktree at all, not after the attempt fails — by checking this session's own context for the same cwd-pinned signal. When detected, this session still creates the group's worktree via a plain `git worktree add` (a filesystem operation that does not require repinning this session's own cwd), but skips relying on cwd inheritance for the group's two Task calls: since this session's own cwd never moves into the new worktree, neither Task call can inherit it. Instead, every command each call's prompt issues is prefixed with an explicit `cd {worktree-path} &&`, so both calls are anchored to the worktree per-command rather than through a shared shell cwd this session cannot set. Everything else in the loop below — enter once per group, dispatch both calls, tear down via wrap-up's cleanup route before the next group — is unchanged; only the *mechanism* a Task call uses to reach the worktree differs.

A top-level dispatching session (the common case, and the one the rest of this file describes) never hits this — its own cwd is not pinned, so it enters each group's worktree directly and both Task calls inherit it, exactly as below.

**Don't reach for `isolation: "worktree"` plus a joining `EnterWorktree(path=)` as a shortcut here.** A cwd-pinned dispatching session might be tempted to launch the first Task call with `Agent(isolation: "worktree")` to get it worktree-isolated on its own, then have the second call join that same worktree via `EnterWorktree(path: <first call's worktree>)` instead of adopting the `cd`-prefix mechanism above. This reported success while leaving the second call's actual Bash execution sandbox pinned to whatever worktree it inherited at its own launch, refusing every subsequent command (`docs/incident-log.md`'s `IL-155`, from #1875). `EnterWorktree`'s own current tool documentation describes `path`-based redirection working for a pinned agent, but that claim is unverified against this exact two-call shape — until a live dispatch confirms it, use the `cd {worktree-path} &&` mechanism above instead of this join pattern.

## The loop

For group N, enter **one** fresh worktree, then run that group's whole dispatch sequence inside it: both of its Task calls (`build,test`, then — gated — `review,polish,wrap-up`; see `two-call-gate.md`) inherit that single cwd, and each reports its own terminal status line (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED) plus an OUTCOME line. One worktree per group, entered once and torn down once — never one per call.

**Mechanically verify the status line the moment each Task call returns — never infer compliance from how the reply reads.** Check the reply's last non-empty line against `^STATUS: (DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED)$`, exactly as `task-prompt.md`'s OUTPUT FORMAT requires it to appear. A reply where that line is missing, malformed, or not the last non-empty line is not a status to parse — a call that actually finished in-turn always ends with it, so its absence is direct evidence the dispatched agent backgrounded `/flow` or otherwise yielded outside the Foreground execution clause (`task-prompt.md`; #1965) rather than a report this loop can read. Treat a missing/malformed status line exactly like `BLOCKED` for gating purposes here (#2429): never dispatch the second call on it, never enter group N+1's worktree on it — route it through this group's own Settle procedure (`settle-and-merge.md`) the same as any other first-call failure. **On the second (`review,polish,wrap-up`) call specifically,** this same check's remedy is `two-call-gate.md`'s §6 ("Terminal path when the second call's status line is missing or malformed"), not §5 — Settle may never have run inside that call (it runs "on any path that reaches wrap-up," which a backgrounded/malformed-status second call may not have reached), so the dispatching session makes the same direct `/claude-tweaks:wrap-up {target} cleanup-only` call §5 specifies for the first-call case. This is a per-group failure, not a firing-wide stop (`CLAUDE.md`'s Auto-Mode Contract: `auto` never gains a new mid-flow stop from this).

Where that teardown falls depends on which call ends the group. A first call that fails or blocks its `build,test` gate *is* the group's terminal point — the second call is never dispatched, and teardown routes through the explicit `/claude-tweaks:flow {target} wrap-up` call `two-call-gate.md` section 5 specifies. A first call that clears the gate hands off to the second, whose own wrap-up performs the cleanup at its terminal OUTCOME. Either way the worktree comes down through wrap-up's cleanup route, never a raw removal (`[IL-116]`), and only THEN does the dispatching session enter a fresh worktree for group N+1. Never enter group N+1's worktree, and never dispatch any of its calls, while any of group N's is still running.

This is the same enter→dispatch→teardown→next sequence `bin/lib/issues/sequential-dispatch.js`'s `runGroupsSequentially` pins as a unit-testable invariant — that module is what a regression here should be checked against. It sequences *groups*; the two calls within a group are sequenced by the gate in `two-call-gate.md`.

## No per-group timeout, and the wall-clock trade-off

There is no per-group timeout — nothing elsewhere in this codebase imposes one (existing parallel-Task dispatch sites, e.g. `/help`'s Stage 1-7, wait for all dispatched agents regardless of duration; this is the same "no timeout" posture, just applied to a sequential loop instead of a concurrent one). A timeout would still leave the question this section answers unanswered — "is it stuck, or just slow?" — while actively killing legitimately slow but healthy work; the fix for that question is visibility, below, not a deadline.

## Heartbeat: how a long-running group's progress becomes observable mid-flight (#2427)

**Not from the dispatched Task call itself.** It cannot safely interrupt its own foreground turn to
report progress without recreating the exact stall hazard the Foreground execution clause
(`task-prompt.md`) exists to prevent (#1965) — no mid-turn check-in, no `run_in_background`, ever.
**Not from the dispatching session either, while that Task call is in flight** — dispatching a
Task call is this session's own turn; it has no opportunity to act on anything, including a
user's "still waiting?" question, until the call returns.

**The answer is passive, and needs no new mechanism: the group's own run directory is already
being written to in real time, and anyone else can read it while the dispatching session's turn
is still blocked.** Every `log-decision.js` call inside the dispatched agent's own execution
(`_shared/auto-decision-log.md`) is a real, immediate filesystem write to `{group-run-dir}/decisions.md`
— not buffered until the call returns — so its last line is genuine evidence of the most recent
completed step, not a summary composed after the fact. A **bundle** group (2+ issues; `/flow`'s
multi-spec mode) additionally writes a `phase`/`phases[]` transition log to
`{group-run-dir}/manifest.yml` at every `/flow` step boundary (`flow/multi-spec.md`'s
`multispec-progress-banner.md`) — coarser than `decisions.md` but a single field to check
(`phase:`) rather than a tail. A **singleton** group (1 issue) has no `manifest.yml` — `/flow`'s
own single-spec path narrates its step banner as free text with nothing to write it to
(`flow/SKILL.md` Step 4's "no manifest.yml for a single-spec run" note) — so `decisions.md`'s own
entries are the only available signal there; this is a real, documented granularity gap, not one
this record closes, since giving singleton runs the same mechanism bundles already have is a
change to `/flow`'s own step-announcement logic, out of this file's scope.

**When a user asks whether a firing is still working:** tell them (or, if you are the dispatching
session between groups rather than mid-call, check yourself) to read
`{group-run-dir}/decisions.md`'s last line and, for a bundle, `{group-run-dir}/manifest.yml`'s
current `phase:` — that names the actual last completed step and when it happened, rather than a
guess. `{group-run-dir}` is `$GROUP_RUN_ID`, minted at Step 4 and known before the Task call is
ever dispatched, so it is nameable even while that call is still running.

A multi-group firing's wall-clock time now scales linearly with group count instead of being bounded by the slowest group — an accepted, documented trade-off (dispatch only fires on a schedule with nobody waiting synchronously), not a regression to flag at review time.

## Running more than one session

The supported way to drain more than one group at a time is **N top-level sessions**, each running `/claude-tweaks:dispatch #N` (or a bare drain) — the shape every existing invariant already assumes: one session, one worktree, one owned run. Nothing structural changes for N > 1, because collision is already prevented by five controls this file cites rather than restates: claims (`_shared/issue-claims.md` — CAS on the claims registry, so two sessions cannot take the same record), the sibling-session check (`dispatch/sibling-session-check.md`, `[IL-107]`), fail-closed worktree reaping (`bin/lib/hooks/worktree-reap.js` never removes a locked worktree or one with a live pid), per-checkout port leases (`bin/lib/ports/registry.js` — every session's checkout gets its own block, and the block's base is exported as `CLAUDE_TWEAKS_LEASE` so a project can key its test database on it, `DATABASE_URL=…test_${CLAUDE_TWEAKS_LEASE}`), and GitHub rate-limit backoff (`_shared/github-rate-limit.md`). The one thing a human must not do is run two sessions from the **same worktree**: `record-worktree` stamps one `{worktree, sessionId}` per run, and every hook gate resolves its target from that binding. Load is the cost: N sessions share one machine, and a `npm test` failure count that varies run-to-run under that load is the signal CLAUDE.md's Commands note describes — re-run the affected file in isolation before concluding anything, and let the flaky allowlist (`test/verification.md`'s Flake handling) absorb the known offenders.

The `cd {worktree} &&` prefix shape (#447 above) is **not a concurrency mechanism** inside one session, and must not be read as one: it breaks the one-session-one-worktree binding the hook gates depend on (`record-worktree`'s stamp, `wd-deny`/`checkWorktreeRequired` resolving the target from the session's tracked cwd rather than a command's `cd`, SubagentStop and every `events.jsonl` append attributing to the session's single owned run), the worktree Bash-shape guard refuses most compound commands, and it puts N groups' outcomes in one orchestrator's context (`[IL-130]`). #447's own scope is a cwd-pinned session running groups *sequentially*, confirmed only on the failure path — never two groups at once.
