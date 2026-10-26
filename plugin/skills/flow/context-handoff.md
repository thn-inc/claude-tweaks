# Flow — Context Handoff

Loaded by `/claude-tweaks:flow` Step 4's context cap check only when `bin/context-gauge.js` printed `over: true` with a `handoff` path: this agent's context crossed the cap, so the next phase starts in a fresh agent from `{run}/handoff.json` instead of growing this one (#4027). Every other gauge result continues in this agent and never needs this file.

## The check

The gauge runs only where a fresh agent can take over cleanly:

- **A single-spec run.** Multi-spec handoff is not supported, so the gauge never runs in a multi-spec run: `--next-steps` names one spec's remaining steps, but the handoff's `resume` command re-targets every record in the run dir, so a resumed sequential run would skip the later specs' earlier steps. A `MULTISPEC_PARALLEL_WAVE=1` wave member runs `/build` and `/test` directly and never reaches this step.
- **Not under `interactive`.** That mode exists for in-flow questions, and a fresh `Agent` cannot ask the user any. `auto`, `confirm` and `hybrid` all run as `auto` past the Manifesto, and their `resume` line carries ` auto`.
- **At a boundary with a step left.** After a step's gate passes, with at least one step still to run. `build` with its automatic `stories`, and `polish` with its re-verify, are each one unit: gauge after `build`'s automatic `stories` and after the re-verify, never between them.
- **Never `wrap-up` from a top-level run.** A run not bound `dispatched: true` leaves `wrap-up` out of `--next-steps`, and with `wrap-up` the only step left it does not gauge (see Top-level run below). It gauges only when two or more steps remain before `wrap-up` (or before the end of a list with no `wrap-up`), so its `--next-steps` is always a comma list. A run with just one step left before `wrap-up` (`polish` after `review`, or `review` after `test` under `no-polish`) does not gauge. The reason is that a single step resumes from that step onward (`steps-and-gates.md`'s Step Arguments), so the child would run `wrap-up` too. A dispatched call's `--next-steps` is every remaining step.

One call, its own Bash call, with the run dir spelled out as a literal absolute path:

`node "${CLAUDE_PLUGIN_ROOT}/bin/context-gauge.js" --run "/abs/path/.claude-tweaks/pipelines/{run-id}" --next-steps {remaining steps, comma-joined}`

Never `--run "$PIPELINE_RUN_DIR"`. The gauge finds its caller's transcript by an unanswered Bash call whose command text names `context-gauge` and the run id. A shell variable hides the run id, so the gauge falls back to a weaker match and its `reason` starts `caller-not-identified`.

## Reading the result

The gauge prints one JSON line, `{contextTokens, cap, over, transcript, handoff, reason}`.

- `over: false` means continue in this agent, whatever `reason` says: a missing or unreadable transcript fails open to `over: false`.
- `over: true` with `handoff: null` also continues in this agent: `{run}/handoff.json` could not be written, and `reason` says why.
- At the bound the gauge writes no handoff. The bound is `HANDOFF_BOUND` (3) handoffs per run, counted in handoff.json's `handoffCount`. The count is per run, not per call: a dispatch group's two calls share one run dir, so they share the three. At the bound the gauge prints `over: true` and `handoff: null` with `reason` `handoff bound reached (3 handoffs this run): continue in place`. Continue in this agent and never stop: the call ends as it would have without the gauge, completing or hitting a HARD-GATE it settles itself.
- Exit 2 (a malformed call, a refused `--run`) or any non-JSON output: continue in this agent.

A gauge failure never stops the run, and the gauge itself logs every non-null `reason` to `decisions.md` as a SKIP, so a gauge that cannot measure (a changed transcript layout, an unidentified caller) shows at the Review Console and needs no log line from you. Only `over: true` with `handoff` set hands off. Log it first, as its own Bash call:

`node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run}" --status AUTO --step "Step 4 context cap" --text "context {contextTokens} tokens over cap {cap}; steps {next-steps} handed to a fresh agent from handoff.json" --reversibility n/a`

Then take the branch that matches the run, by the same `dispatched` read Step 4 used to build `--next-steps`: `SKILL.md` Step 1 rung 2's fail-open one-liner. It prints `dispatched` (take the Dispatched call branch) or nothing; when it prints nothing, take the Top-level run branch.

## Dispatched call

A `/claude-tweaks:dispatch` Task call (`run-state.json` `dispatched: true`) stops before the next step and hands the rest back to its dispatcher, which continues it in a fresh call (`dispatch/two-call-gate.md`).

1. **Push first.** Under `integration-model: pr-first` (`_shared/integration-model.md`), the phase that just ended pushed its branch (`_shared/git-discipline.md`'s Phase-exit push section). If that push failed or did not run, run it now as its own Bash call: `git -C "{worktree}" push origin {branch}`. Under `local-merge` or `current-branch` there is nothing to push, because the continuation inherits this worktree.
2. **Stop** before the next step. Do not settle or release the claim and do not tear anything down: the continuation needs the claim, the worktree and the run dir as they are. The template's checks before `build-test-ok` (the pass-stamp confirmation, the bookends) belong to the call that finishes the steps.
3. **Render** `steps-and-gates.md`'s handed-off note (its Partial step lists section).
4. **Report** the call's normal OUTPUT FORMAT with `OUTCOME: handoff`, then one line right after `OUTCOME`: `NEXT_STEPS: {comma-joined remaining steps}`. That is the same list as the gauge's `--next-steps` and handoff.json's `nextSteps`. End with `STATUS: DONE`. No `ISSUE #{n}: failed:{gate}` line goes with it, since a handoff happens only after a passing gate.

## Top-level run

A run not bound `dispatched: true` (a human-typed `/flow`, a Routine, or an earlier handoff's child) hands the remaining steps to one fresh `Agent` and relays its report. Use a fresh agent, never `fork`: a fork inherits this context, which is the thing being shed.

A top-level run never hands off `wrap-up`: its `--next-steps` stops before `wrap-up`, and with `wrap-up` the only step left it does not gauge. A subagent cannot call `AskUserQuestion`, so a child running `wrap-up` would strand the Review Console and Step 5's ledger gate, which `auto` never silences. A child's own handoff never carries `wrap-up` either. This agent renders no note of its own at the handoff; the child's Steps Complete note says what ran.

1. **Resolve** the substitutions. `{run}` is the literal run dir. `{worktree}` is what `git rev-parse --show-toplevel` prints, run as its own call. `{plugin-root}` is this session's `$CLAUDE_PLUGIN_ROOT` as a literal path. The model comes from `node "{plugin-root}/bin/resolve-profile.js" capable` (the profile dispatch's first call uses), passed as `model` on the `Agent` call.
2. **Dispatch** one `Agent` with the template below inlined verbatim and the substitutions filled in. This is a dispatch site under `_shared/subagent-output-contract.md`.
3. **Wait** for the child. The template's 20-minute bound (`sleep 20` at most 60 times) applies only when this agent is itself a subagent, such as an earlier handoff's child, whose own prompt already carries that rule: wait within the turn under it and never end the turn with the child outstanding. A top-level session waits for the child's task-notification with no bound, as the parallel-wave orchestrator does (`_shared/dispatch-waiting.md`): a child phase often runs past 20 minutes. Never redo the child's steps in this session, since a child that has not reported may still be writing. Any blocked report (a subagent's bound expired, the `Agent` call failed) must tell the reader to confirm the child has stopped before anyone runs `resume`, then give `{run}/handoff.json`'s `resume` line on its own line.
4. **Relay** the child's final report, unchanged. If it is a failure card, or its status is not `DONE`/`DONE_WITH_CONCERNS`, stop there: a gate failed (Step 4 item 3). After relaying the child's Steps Complete note, this agent runs `wrap-up` and Step 5 itself. It does so when `wrap-up` is in its step list, continuing its own Step 4 loop at that step with `$PIPELINE_RUN_DIR` unchanged. With no `wrap-up` in the list, the relayed note is this run's close.

The child may cross the cap and hand off in turn. That does not end because each hop finishes a step (a resume at `review` auto-inserts `test` first, `steps-and-gates.md`'s Auto-insert rule). The chain ends because a fresh agent starts well under the cap and so finishes several steps before it nears the cap again. The gauge's per-run bound of three handoffs (Reading the result) caps it regardless.

```
Task scope: continue a /claude-tweaks:flow run in a fresh context. The previous agent
finished some of this run's steps and handed the rest to you because its context crossed
the cap. Your first act: Read `{run}/handoff.json`. It holds `nextSteps` (the steps still to
run), the measured `contextTokens` and `cap`, and `resume` -- the exact command that continues
this run. Then run that `resume` command as written, as a literal `Skill`-tool invocation of
/claude-tweaks:flow with its `PIPELINE_RUN_DIR` prefix -- the prefix is what makes /flow adopt
this run directory instead of starting a new one. Never re-run a step that is not in
`nextSteps`. You need no other input about what the earlier steps did.

Working directory: you inherit this run's checkout, {worktree}. Do NOT create, enter, or
switch worktrees. Run `pwd` and `git rev-parse --show-toplevel` before any commit and verify
both resolve to {worktree}; if either does not, STOP and report BLOCKED rather than committing.

Plugin root: {plugin-root} -- use this literal path wherever an instruction names
${CLAUDE_PLUGIN_ROOT}; your shell may not carry that variable.

Async-wait discipline (required): you are a subagent, not a top-level session. Once your turn ends you
cannot count on being re-woken: a reply that ends without a tool call ends your turn, whatever is
still in flight, so a progress note rides alongside a tool call or is skipped (#3266). Run a long
command (e.g. the full test suite) as a normal foreground call with a large explicit timeout
(#1965). A nested `Agent` call launches async, and its completion notification reaches you only
while your turn is alive (when the call instead returns the child's own reply, that child has
reported and needs no wait): keep your turn alive with bounded foreground waits — repeated
`sleep 20` Bash calls, at most 60 (20 minutes) per wave of children (the set launched
together), each wait logged as one line (what you wait on, the iteration against the bound, how
many children are still pending), stopping as soon as every child's `<task-notification>` has
arrived, never reading or tailing a running child's `output_file` — until every child you
launched has reported, and never end your turn with one outstanding. With no `Agent` tool
(`ToolSearch` finds none, deferred or otherwise), or a child still silent when the bound
expires, judge that unit yourself, log the downgrade, and mark its findings `unconfirmed`; that
child is abandoned and no longer counts as outstanding, so your final reply still ends with
`STATUS: {WORD}`. For a `/claude-tweaks:review` lens unit, log that downgrade as the single-read
coverage line, and carry its caveat, from `review/step3-lens-dispatch.md`'s partner-died
paragraph. Ignore a late result; if a late notification re-wakes you after your final
reply, repeat your whole final reply unchanged — the dispatcher keeps only your latest reply, so
a bare `STATUS:` line would replace the report. A child that reports a failure (a `failed`
notification, an API error, a `BLOCKED`/`NEEDS_CONTEXT` reply) has reported, so it is not
outstanding: handle it per the dispatching skill's own status handling where one exists
(`superpowers:subagent-driven-development`'s BLOCKED handling), otherwise judge that unit
yourself. Self-judging is for a read-only unit (a lens, a single read, a judge); a
write-capable child (one that edits files) still silent at the bound is never redone in-session,
because an abandoned child keeps running and may still write — stop, and end with
`STATUS: BLOCKED` naming that child and its unit. A wait call that is blocked or fails is not a
wait and never counts toward the bound; never retry it in another form (a longer, wrapped or
backgrounded sleep): treat every child still outstanding as silent at the bound. The full rule is
in `subagent-dispatch-core.md`'s Foreground Execution Discipline section. Give any agent you
dispatch this same instruction, whether it is a nested Task/Agent call or a
`superpowers:subagent-driven-development` or review-lens fan-out. **Mark every interim reply
(#2714):** if a turn ends anyway while a keep-alive wait is still in progress, with a child
outstanding — the keep-alive rule's failure path — make that reply's last non-empty line
`INTERIM_STATUS: {one-line progress note}`, never `STATUS: {WORD}`, which is reserved for your
genuine final reply (an abandoned child is not outstanding; that reply is final and ends with
`STATUS: {WORD}`). An unmarked interim reply is graded by the `SubagentStop` hook as a final
reply missing its status line and logged as a false-positive `contract-violation`, unless your
own async `Agent` launches are still pending in your transcript (#3015) — the marker stays
required, since that exemption covers only pending launches. Forward this marker rule, with the
rest of this item, to any nested dispatch that itself dispatches.

OUTPUT FORMAT (required) -- reply with your /claude-tweaks:flow run's final rendered output
(its Steps Complete note, or its failure card), unchanged, then one line:
HANDOFF: {run}/handoff.json

Status line (required): on its own trailing line, after everything above -- the reply's last
non-empty line -- write exactly `STATUS: {WORD}`, where {WORD} is one of: DONE /
DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
```
