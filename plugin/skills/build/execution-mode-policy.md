# Execution Mode Policy — No Licensed Third Path (record #491)

`/claude-tweaks:build` Common Step 2 offers exactly two execution strategies: `subagent`
(the default — Task-tool dispatch via `/superpowers:subagent-driven-development`) and
`batched` (human-paced 3-task batches via `/superpowers:executing-plans`). An interactive
session executing the plan's substance directly — Edit/Bash/Write in the main thread,
skipping Task dispatch entirely — is not a licensed third mode, regardless of how capable
the session judges itself, and regardless of whether it also streamlines the
Manifesto/ledger/`decisions.md`/Review Console apparatus alongside skipping dispatch.

## Why this was an open question

A precedent run (`/claude-tweaks:flow #473,#474,#475,#476`) executed this way: tests stayed
green throughout, a `/code-review high` pass caught real issues, and all four records shipped
cleanly. Neither `flow/SKILL.md` nor `build/SKILL.md` stated whether this divergence was
licensed or forbidden — the plugin's own skill files were silent either way. Record #491 named
this gap.

## The decision

**Never licensed**, in either policy configuration:

- **A locked `execution-strategy: subagent-only`/`batched-only`** (`_shared/policy-schema.md`)
  forbids the *other offered value* — it says nothing about a third, undocumented "skip
  dispatch entirely" option, and silence is not a license. The lock's own definition
  ("the other strategy is not offered and a contradicting explicit argument is substituted")
  presumes exactly two candidates; direct execution was never one of them.
- **An unlocked `execution-strategy`** (plain `subagent`/`batched`, an overridable default)
  still resolves to one of the two dispatch-based strategies by default. Nothing in the
  existing contract offers "run it inline instead" as an override value, the way
  `current-branch` is an explicit, documented override of the `worktree` git-strategy
  default. Absent that kind of explicit opt-in mechanism, the safe default holds.

**Why, mechanically:** the same reason `_shared/subagent-output-contract.md`'s own header
states for the dispatch contract generally — a clean room is what makes a Task-tool dispatch
independent evidence rather than the orchestrating session's own echo. Direct in-session
execution has no clean room: the same context that wrote the plan also writes the code and
judges its own review, collapsing the independence the dispatch contract exists to buy.

**This project's own `.claude-tweaks/policy.yml` sets `execution-strategy: subagent-only`** —
this decision is consistent with that existing project-level lock, not a supersession of it.

## What this does not mean

A run that already shipped this way (the #473-#476 precedent, or any other) is not
retroactively invalid — tests passing and review catching real issues are real evidence of
correctness for that run's actual code. It was **non-compliant**, not a second sanctioned
mode, and its clean outcome is not license to repeat the pattern. "It worked last time" is
not a standing exception.

## Schema impact

`resolve-policy.js`'s `execution-strategy` schema key (`_shared/policy-schema.md`) needs no
new enum value — the existing `subagent`/`batched`/`subagent-only`/`batched-only` set already
covers every licensed choice; this decision closes an undocumented gap between those values,
not a missing one among them.

## No-dispatch host (#4555)

A host with no `Agent`/`Task` tool — `_shared/subagent-dispatch-core.md`'s probe, "`ToolSearch` finds none, deferred or otherwise" — is exactly the case this decision forbids silent inline execution for: `subagent` cannot run there, and implementing the plan's tasks in-session would be the unlicensed third path above. The probe's result decides, never the host's shape: a fork or a cwd-pinned Task subagent whose probe finds `Agent` is not a no-dispatch host (#4555 found `Agent` present in a fork). That file's self-judge fallback covers read-only lens and judge units, never plan implementation.

The enforcement point is the dispatch-capability preflight. `/claude-tweaks:flow` Step 2.4 runs it whenever the step list includes `build`, before it claims targets or creates a worktree, fresh or resumed; `/claude-tweaks:build` Common Step 1.5 runs it before Common Step 1.6's plan reviewer and Common Step 2's `subagent` execution. When the probe finds none:

1. Stop: never implement plan tasks inline, never switch to `batched` on the run's behalf. Report BLOCKED with the cause, and the resume command on its own line:

   ```
   BLOCKED — this host has no Agent/Task tool, so the `subagent` execution strategy cannot run.
   Resume from a top-level session:
   {resume command}
   ```

   `{resume command}` depends on how the run was started. Under `/claude-tweaks:dispatch` (`run-state.json` `dispatched: true`) it is `/claude-tweaks:dispatch #{n}`, to use after dispatch's Settle procedure runs. When the record already has an open draft PR, that command's open-pr line names `/claude-tweaks:dispatch resume #{n}` whenever resume would accept it (`dispatch/open-pr-exclusion-report.md`). Otherwise it repeats the invocation the stopped run received, keeping its `PIPELINE_RUN_DIR="…"` prefix whenever one was adopted — e.g. `PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow #{n} {steps}` or `/claude-tweaks:build {received target}`, where `{received target}` is the `#{n}` or design-doc path the build received. Render the command only when each interpolated part fits its grammar (`{n}` digits; `{received target}` `#{n}` or a plain repo-relative path of letters, digits, `.`, `_`, `/`, `-`; `{steps}` the step-list tokens; `{run-dir}` the resolved run directory in double quotes). A part that does not fit (a quote, `$`, backtick, newline or space in the target) is replaced by "re-run your original invocation" — never pasted into a command.
2. A standalone `/claude-tweaks:build` whose `execution-strategy` is not `subagent-only` adds one line, a choice for a human and never taken automatically: Or run it in-session, in human-reviewed batches: `/claude-tweaks:build {received target} batched`. Under `subagent-only` that line is omitted — the lock forbids `batched`.
3. When a pipeline run directory resolves — at flow Step 2.4 only when it already has `config.yml` — log one line per `_shared/auto-decision-log.md`: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/{flow|build}" --step "{Step 2.4 | Common Step 1.5} dispatch-capability preflight (skipped)" --status SKIP --text "condition: no Agent/Task tool in this host → fallback: run stopped before build; resume from a top-level session" --reversibility n/a`; otherwise the `SKIP` text goes in the stop report only, so a resume never adopts the directory as a recovery (`flow/steps-and-gates.md`'s case 3).
4. Under `/claude-tweaks:dispatch` (`run-state.json` `dispatched: true`, headless or not), report through its existing channel — `OUTCOME: build-test-blocked`, `STATUS: BLOCKED`, `ISSUE #{n}: failed:no-dispatch-host` — never a new outcome word; Settle treats it as a pre-flight stop (`dispatch/settle-and-merge.md`'s No-dispatch-host special case).
5. This stop tears nothing down itself: what already exists — on a resume the claim, worktree and draft PR, under `current-branch` the open-items ledger flow Step 1 created, and for a standalone worktree-mode `/claude-tweaks:build` the worktree, materialize commit and draft PR that Spec Step 1 created before Common Step 1.5 — stays in place for the resume (under dispatch, its Settle procedure still acts on the reported outcome).
6. A flow resume whose step list omits `build` is not probed here: `/claude-tweaks:review`'s run-level **Independence: degraded** caveat covers it, and `assess-agent-autonomy`'s `merge-check` then routes that run's merge to a human.
