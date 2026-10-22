# Dispatch Step 5 — Task() Prompt Template

Referenced by `skills/dispatch/SKILL.md` Step 5. Unlike `sequential-execution.md` and `deprecated-aliases.md` (background detail, read for understanding), **each of this file's two templates must be inlined verbatim into its own `Task()` tool call** when dispatching a group — they are the operative templates, not supplementary reading. Never inline both into one call. Copy each fenced block below exactly, substituting `{issue list}`, `{minted-run-dir}`, `{plugin-root}`, `{context-pack}`, etc. as SKILL.md's Step 5 directs.

Each group is dispatched as **two sequential `Task()` calls**, not one (per `_shared/subagent-output-contract.md`'s input discipline — minimal input, literal output template inlined, no conversation history). The single-assistant-message rule (`_shared/subagent-dispatch-core.md`'s fan-out section) creates no batching decision here — these two calls are sequential by design, never emitted together.

## Context pack (#1542 — resolve once, substitute into both calls)

A dispatched Task agent inherits no shell environment (`_shared/subagent-output-contract.md`'s
Input Discipline) — so every `${CLAUDE_PLUGIN_ROOT}`-style env-var reference embedded literally
in a template resolves to nothing inside the dispatched agent's own shell, forcing it to
rediscover the value from scratch (`--help` probes, `find` searches, trial-and-error against CLI
argument enums — the exact rediscovery this section eliminates). The dispatching session already
resolved seven of these facts earlier in the same firing (Steps 1-4); it resolves them **once
more here, as literals**, before composing either call — plus one standing instruction (item 7)
that needs no resolution, only inclusion:

1. **`{plugin-root}`** — this session's own already-resolved `$CLAUDE_PLUGIN_ROOT` value,
   substituted as a literal absolute path everywhere this file used to embed the env-var
   reference `${CLAUDE_PLUGIN_ROOT}` — never left as `${CLAUDE_PLUGIN_ROOT}` for the dispatched
   agent's shell to expand.
2. **`{minted-run-dir}`** — unchanged from before this section existed (Step 4's mint).
3. **Resolved policy values** — one call, before either dispatch: `node "{plugin-root}/bin/resolve-policy.js" --values autonomy,integration-model,merge-verification,risk-floor,size-floor`. The five values this call's own Settle/Auto-merge procedures need downstream. **Scope note (#2413):** these are read-only facts for Settle/Auto-merge only — they never substitute for `/flow`'s own Step 3 Manifesto, which independently computes and writes the full 13-lever `config.yml` (including its own `merge-verification` entry) on the first call regardless of what is handed here. A lever already resolved above is never grounds for that call to skip the Manifesto's `config.yml` write.
4. **Canonical CLI invocation table** — the argument shapes and enums a dispatched call has
   historically had to rediscover by trial and error:

   | CLI | Canonical shape |
   |---|---|
   | `log-decision.js` | `node "{plugin-root}/bin/log-decision.js" --run "{minted-run-dir}" --status AUTO\|STAGED\|KEPT-PROMPT\|SCANNED\|REFUSED\|SKIP --text "..." [--reversibility high\|med\|low\|n/a[" (qualifier)"]]` |
   | `claim-targets.js` | `node "{plugin-root}/bin/claim-targets.js" --run-id "{run-id}" --targets {n}[,{m}...] [--keep-going] [--run "{minted-run-dir}"]` |
   | `materialize.js` | `node "{plugin-root}/bin/materialize.js" <n> --run-dir "{minted-run-dir}" [--multi-record-slug <n>]` |
   | claims-registry read | `{minted-run-dir}/context/claims.md`'s "Reading claim state" git-trees path (`claims/issue-{n}.json` on the `claims-registry` branch) — never `gh api ...?ref=` query-string quoting, never `-f ref=` on a GET (if that bundle is absent, read `_shared/issue-claims.md` directly) |

5. **Composed bundles** — `{minted-run-dir}/context/claims.md` and
   `{minted-run-dir}/context/merge.md`, composed by the dispatching session before either call;
   every citation of them in the templates below carries its own fallback to the source file.

6. **Worktree shell constraint** — the Claude Code harness enforces limits on Bash commands in a single call, independent of filesystem effect (see `_shared/scratch-worktree.md` §7 ("Shell constraint") for the full boundary description, if that bundle is absent, read `_shared/scratch-worktree.md` directly). Avoid these shapes: quoted JSON containing `git`; a `for`/`while` loop variable; a glob argument; a `gh api` call inside an `if RAW=$(...)`; `sed -i` on a variable path; `cat "$P/…"` or `sed -n 'a,bp' "$P/…"` where `$P` is a runtime-computed path variable. Use `Write`/`Edit`/`Read` tools instead of equivalent shell commands, separate commands instead of loops or compound constructs, and literal file paths instead of variables. One plain command per Bash call is the general pattern.

7. **Async-wait discipline** — you are a subagent, not a top-level session. Once your turn ends you
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
   `STATUS: {WORD}`. Ignore a late result; if a late notification re-wakes you after your final
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
8. **Selected at** (#3131) — one literal line, `Selected at: {ISO}`: the modification time of
   this firing's session-scoped `dispatch-groups.json` (`queue-pull-script.md`'s output, resolved
   via `sessionTmpPath` as `next-ranking.md` does). That pull already dropped every
   `bot:in-progress` record, so each selected record lacked the label at that moment. A Task call
   cannot see the dispatcher's files' timing; Settle's contested-claim self-report compares this
   against the holder's `claimedAt` to tell a missing projection from a claim race. An unreadable
   file → `Selected at: unknown`; never block the dispatch on it.

Substitute this whole block, filled in with this firing's actual resolved values, as
`{context-pack}` immediately after each call's opening `Task scope:` paragraph below. This is
environment facts and tool signatures only — never a prior call's conclusions (test results,
verdicts) — so it does not weaken the two-call gate's fresh-context independence property (see
each template's own "CRITICAL"/re-derive-from-artifacts language, unchanged by this section).

**Before substituting `{context-pack}` into either call, compose item 5's two bundles** — once,
into the minted run directory, one physical line each:
`node "{plugin-root}/bin/compose-context.js" --run "{minted-run-dir}" --step claims "{plugin-root}/skills/_shared/issue-claims.md"`
and
`node "{plugin-root}/bin/compose-context.js" --run "{minted-run-dir}" --step merge "{plugin-root}/skills/_shared/pr-first-merge.md" "{plugin-root}/skills/_shared/pr-checklist-refresh.md"`.
The directory needs nothing else to compose into: Step 4 minted it mkdir-only, and `mode` is
unresolved at this point (no `config.yml` yet) — neither bundle's sources branch on that key
today. `integration-model` resolves only from `.claude-tweaks/policy.yml`'s pin — on a repo that
does not pin it the `merge` bundle keeps both integration-model branches, and item 3's resolved
value is what the agent acts on. These `{plugin-root}` lines are placeholders to the
composed-bytes scanner, not call sites of their own — the bundles are measured at their skill
call sites. Compose both before either dispatch anyway: if the compose command is unavailable or exits non-zero, read the named source files directly — which, for the dispatched agent, each template citation's own fallback already says.

**Log each group's resolved first-call model (#3212).** This is a dispatching-session step, not
part of `{context-pack}`. When resolving the first call's profile
(`node "{plugin-root}/bin/resolve-profile.js" capable`, the template below), keep the resolved
`model` and `source`; after the first call returns — never before it is dispatched — write one
line per group to that group's `{minted-run-dir}/decisions.md` by running
`node "{plugin-root}/bin/log-decision.js" --run "{minted-run-dir}" --status AUTO --step "Dispatch group {group}" --text "first-call model resolved to {model} (source: {source})" --reversibility n/a`,
which produces, per `_shared/auto-decision-log.md`'s canonical entry schema:
`- AUTO {time} — Dispatch group {group}: first-call model resolved to {model} (source: {source}). Reversibility: n/a.`
where `{model}` and `{source}` are the `model` and `source` fields of the `resolve-profile.js
capable` JSON, and `{group}` is the group's comma-joined issue list in brackets (e.g. `[42]` or
`[42,43]`). The timing matters: before the first call, the minted directory's `decisions.md` may
hold only `/flow` Step 2.8's claim-log lines, and any other line makes `/flow` Step 3 treat the
directory as a recovery (adoption case 3, `bin/lib/flow/preflight.js` via
`bin/lib/log-decision/claim-log.js`'s `classifyDecisions`) instead of a fresh mint (case 2). A
`source` of `ceiling` in the resolver's output means the clamp described under the first-call
template applied.

## First call — build,test

**No handoff to capture from this call's report.** Dispatch Step 4 already minted this group's run directory before either call — `{minted-run-dir}` below is that same directory, substituted literally, on both calls. There is nothing to parse out of this call's prose report to construct the second call's input; the gate between calls (`two-call-gate.md`) reduces to reading the status line and `OUTCOME`.

**Before substituting this template**, the dispatching session decides whether to add `DISPATCH_HEADLESS=1 ` immediately before `/claude-tweaks:flow` on the invocation line below — a decision made once, here, never left in the copy-pasted text for the dispatched agent to reason about. Add it when this firing came from a scheduled Routine — a bare drain, or its deprecated `next` alias — with nobody present; omit it entirely (no `{headless-marker}` placeholder, no trailing space) when a human typed the command directly, in any form (bare, `next`, `#N`, or explicit-list) — the same human-present/Routine discriminator `SKILL.md`'s Next Actions render rule already uses. When set, it tells this call's Settle procedure (`settle-and-merge.md`) that nobody is present to read a Step 2.8 claim-contest stop, so a contest there should self-report via `_shared/headless-self-report.md` instead of just failing silently to whoever isn't watching. This is exactly why the marker must not live inside the fenced block below: the block is copied verbatim into every dispatch regardless of firing form, and the dispatched agent itself has no way to know which form the dispatching session used — only the dispatching session can make this call, before substitution.

A dispatched call is headless and cannot answer `interactive` prompts, so both calls pass `auto` explicitly; an explicit mode argument outranks the project's `auto-mode` policy (`_shared/auto-mode-contract.md`'s precedence: CLI arg > pipeline config > project policy > skill default), and the `autonomy` ceiling still bounds what the run may do. The `auto` suffix after the step list is independent of the `DISPATCH_HEADLESS=1 ` prefix before `/claude-tweaks:flow`.

```
Task scope: Execute claude-tweaks build+test for this dispatch group of
GitHub records: {issue list}. Singleton -> run
`PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow #{issue} build,test auto`.
Bundle (2+ issues) -> run
`PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow "#{n1},#{n2},..." build,test auto`
once, comma-joined. Stop after the test gate -- do not proceed to review, polish, or wrap-up;
a separate Task call handles those. If you reference any of these issue numbers in an
intermediate commit message, write "refs #N" -- never "closes #N" or "fixes #N".

Foreground execution (required): run `npm test` and every other long-running command in the
foreground of this turn, output redirected to a file if it's long -- never with `run_in_background`.
Never end this turn waiting on a background test run or fix-round you started this way -- you cannot
count on being re-woken by either, and the run stalls silently when you are not (#1965). A nested
`Agent` call (a lens-dispatch fan-out, a reproduction pair) launches async, and its completion
notification reaches you only while this turn is alive (when the call instead returns the child's
own reply, that child has reported and needs no wait): keep the turn alive with bounded
foreground waits -- repeated `sleep 20` Bash calls, at most 60 (20 minutes) per wave of children
(the set launched together), each wait logged as one line (what you wait on, the iteration against
the bound, how many children are still pending), stopping as soon as every child's
`<task-notification>` has arrived, never reading or tailing a running child's `output_file` --
until every child has reported, and never end this turn with one child outstanding. With no `Agent`
tool (`ToolSearch` finds none, deferred or otherwise), or a child still silent when the bound
expires, judge that unit yourself, log the downgrade, and mark its findings `unconfirmed`; that
child is abandoned and no longer counts as outstanding, so your final reply still ends with its
usual `STATUS:` line. Ignore that child's result if it arrives later; if a late notification
re-wakes you after your final reply, repeat your whole final reply unchanged -- the dispatcher keeps
only your latest reply, so a bare `STATUS:` line would replace the report. A child that reports a
failure (a `failed` notification, an API error, a `BLOCKED`/`NEEDS_CONTEXT` reply) has reported, so
it is not outstanding: handle it per the dispatching skill's own status handling where one exists,
otherwise judge that unit yourself. Self-judging is for a read-only unit (a lens, a single read, a
judge); a write-capable child (one that edits files) still silent at the bound is never redone
in-session, because an abandoned child keeps running and may still write -- stop, and end with
`STATUS: BLOCKED` naming that child and its unit. A wait call that is blocked or fails is not a
wait and never counts toward the bound; never retry it in another form (a longer, wrapped or
backgrounded sleep): treat every child still outstanding as silent at the bound. A reply that ends
without a tool call ends the turn.

{context-pack}

Ephemeral dev server (only if this run's steps include a browser-driving step in a later,
separate call -- review or stories/QA): if this call starts an ephemeral worktree dev server (a
background dev command on a free port, recorded in `ephemeral-server.txt`), start it detached --
POSIX: launch under `setsid` (e.g. `setsid {dev command} > {log} 2>&1 &`); Windows: no detach
primitive exists, record `detached:no` instead -- and end the recorded line with a trailing
`detached:yes`/`detached:no` token. Write this record via a plain Bash redirect (e.g. `printf '%s
%s %s detached:%s\n' "$PID" "$PORT" "$WORKTREE_ROOT" "$DETACHED" > "{minted-run-dir}/ephemeral-server.txt"`),
never the Edit/Write tool -- the run dir is anchored under the main checkout, and this worktree
session's Edit/Write attempt against it is refused by the harness's own cross-checkout
write-pinning, while a plain Bash write into `.claude-tweaks/pipelines/` is not.
`{minted-run-dir}` is the run's server-record location for a bundle too -- the parent run dir
`/flow` exports as `MULTISPEC_PARENT_DIR`, never a `spec-{N}/` subdirectory.
Never delete `ephemeral-server.txt` at the end of this call, whether or not the server is still alive -- the record belongs to the run, not to this call, and the second call's own liveness re-check depends
on it still being there.

If the build or test step hits a HARD-GATE, handle it per
skills/dispatch/settle-and-merge.md's Settle procedure (claim ownership check against
basename($PIPELINE_RUN_DIR), release, assess-agent-autonomy failure classification, retry
counting, failure comment) before finishing -- that procedure runs inside this agent, against
this group's own record(s), not in the dispatching session's thread, and this call's own
failure is exactly the failure it settles. Do not leave a failed record's claim or label
state unresolved. Do NOT tear the worktree down yourself, and do not run ExitWorktree or
`git worktree remove` -- a Task call that inherited this worktree without entering it can
never tear it down, on any outcome (the outcome-independent constraint at the top of
settle-and-merge.md). Who does tear it down depends on the path, never on this call: on a
build/test failure, the dispatching session's own `/claude-tweaks:wrap-up {target}
cleanup-only` call (two-call-gate.md section 5); on a successful run, the second call's own
integration path -- under pr-first the reconciler, on merged-PR evidence; under local-merge
the dispatching session, after it merges.

Working directory: the dispatching session has ALREADY entered this group's worktree; you
inherit it. Do NOT create, enter, or switch worktrees, and do not invoke
/superpowers:using-git-worktrees. Echo `pwd` and `git rev-parse --show-toplevel` before any
commit and verify both resolve to that inherited worktree; if they resolve to the main
checkout instead, STOP and report BLOCKED rather than committing.
If your first commit is denied by the working-directory hook even though `pwd` and
`git rev-parse --show-toplevel` both resolve to the worktree above, re-stamp the run's worktree
assignment once with `node "{plugin-root}/bin/hooks.js" record-worktree --run "<RUN_DIR>" "<WORKTREE>"`
and retry the commit. If it is denied a second time, STOP and report BLOCKED.

Never run `git stash` or `git stash pop` -- the stash stack is shared repo-wide across every
worktree of this checkout, so it can pop or clobber a sibling worktree's in-flight work. To
compare against a baseline without mutating the tree, use `git show <rev>:<path>`; to set your
own work aside, make a temporary WIP commit instead.

CRITICAL: before reporting `DONE`/`build-test-ok`, confirm your own claim against the artifact
you just produced -- this call is the producer, not a second call distrusting someone else's
prior claim, so there is no earlier report to check here, only your own freshly written result.
The actual artifact is the runner-written pass stamp verifying HEAD (`verify.js --stamp-status`
reports `verifiedHead: true`) and its `report.json`, which exist only when the test phase runs
through `/claude-tweaks:test`. A raw `npm test` log is not that artifact: it leaves no stamp, and
the second call then re-runs the full suite (#3661). Never report a result from narrative or
memory of an earlier pass in this same call -- if the stamp is absent or does not verify HEAD,
re-run the test phase through `/claude-tweaks:test` once before reporting. If the stamp still does
not verify HEAD (a dirty tree never verifies), report `STATUS: DONE_WITH_CONCERNS` (the OUTCOME is
unchanged by this alone), naming the stamp state -- the gate notes it, and the second call's
review re-verifies through the runner.

Bookends (every transport, #2912): before reporting `DONE`/`build-test-ok`, also run
`node "{plugin-root}/bin/verify-run-bookends.js" --run "{minted-run-dir}" --targets {comma-joined issue numbers}`.
Exit 0 is required. On exit 1, run each `missing` entry's `remedy` (substituting its `<...>` and
`{...}` placeholders) -- committed spec, worktree stamp, draft PR under pr-first, canonical
`Step 2.8: claimed #{n}` line, live claim -- then re-run it; if it still exits 1, report
`OUTCOME: build-test-blocked` / `STATUS: BLOCKED`, never `DONE`. Exit 2 is a malformed invocation,
not a missing bookend: correct the `--run`/`--targets` arguments and re-run, never report `DONE`
on it.
A `verify-run-bookends: degraded —` stderr line (exit 0; the run's `config.yml` carries no valid
`integration-model` pin) is logged as a `SKIP` decision via `log-decision.js --status SKIP`,
never treated as a failure or a missing bookend.

OUTPUT FORMAT (required) -- return ONLY these lines, no preamble:

GROUP: {comma-joined issue numbers}
OUTCOME: {build-test-ok | build-test-failed | build-test-blocked | already-shipped}
MANIFEST: {absolute path to this group's run-dir manifest.yml/decisions.md -- a
  human-readable trace only; the dispatching session already holds this run's identity as
  {minted-run-dir} and derives nothing from this line}

One line per issue in this group that hit a HARD-GATE (omit if none):
ISSUE #{n}: failed:{gate}

Status line (required): on its own trailing line, after everything above -- the reply's last
non-empty line -- write exactly `STATUS: {WORD}`, where {WORD} is one of: DONE /
DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.

[Use: Capable] -- raised from Standard: bypassed /flow in 6 of 10 firings vs 0 of 3 (#3212); the
pipeline's own steps still select their own models as usual. Resolve via
`node "{plugin-root}/bin/resolve-profile.js" capable` (contract § Model Selection).
```

**The `model-ceiling` clamp (#3212).** `[Use: Capable]` above does not guarantee Opus. A project
`model-ceiling: standard` policy value clamps the resolved `capable` profile back to `sonnet` —
`plugin/bin/lib/model-profiles/profiles.js`'s `resolve()`, the `model-ceiling` clamp at lines
122-128, which reports `source: 'ceiling'` in `resolve-profile.js`'s JSON. On such a project this
call runs on Sonnet by configuration, an expected and named outcome; the per-group log line in the
Context pack section above records it. The same function's later diff-size cap does not apply
here: it fires only when the caller passes `--diff-facts`, and this invocation never does.

The Foreground execution clause above is backed by a mechanical check, not prose alone (#2429):
`sequential-execution.md`'s "The loop" section verifies this call's `STATUS:` line against the
required pattern the moment the call returns, and treats a missing or malformed one as evidence
of backgrounded/yielded execution — never trust to this clause's own wording without also keeping
that check current.

This call's own `decisions.md` writes (`log-decision.js`, called throughout `/flow`'s steps) are
also what `sequential-execution.md`'s Heartbeat section (#2427) points a "still waiting?" user at
for a long-running call like this one — a passive read of this group's run directory, never a
reason to relax the Foreground execution clause above or have this call check in mid-turn.

The Foreground execution clause's nested-`Agent` rule (#2533, reworked in #3078) is restated in
each template, because each template is inlined verbatim into a `Task()` prompt whose agent never
sees the core file. `_shared/subagent-dispatch-core.md`'s Foreground Execution Discipline is the
one definition of that rule, its keep-alive bound and its `unconfirmed` fallback.
`_shared/dispatch-waiting.md` describes a top-level dispatcher waiting on its own children, not
this agent, so it is not the basis for the clause.

## Second call — review,polish,wrap-up (gated on the first call)

**Only dispatch this call if the first call's status line was DONE or DONE_WITH_CONCERNS AND its OUTCOME was `build-test-ok`.** A `NEEDS_CONTEXT`/`BLOCKED` status, an `OUTCOME` of `build-test-failed`/`build-test-blocked`, or no parseable report at all means this second call is never dispatched — the first call's own agent settles its own failure (its template above instructs it to), and the dispatching session takes the terminal path in `two-call-gate.md` section 5 (fail-loud reporting plus the `/claude-tweaks:wrap-up {target} cleanup-only` teardown call). An `OUTCOME` of `already-shipped` (#2502) is a **third, distinct** case, neither success nor failure: this second call is never dispatched here either, but the reason is that the first call already finished the record (staged a Close proposal, closed any draft PR, released the claim) — there is nothing left to review, polish, or wrap up. Take `two-call-gate.md` §7's terminal path for it, never section 5's — §7 tears the worktree down the same way section 5 does, but never invokes Settle's failure classification, retry counting, or failure comment, and the dispatching session's own report surfaces the group as a no-op, not `pending-review`.

**Substitute `{minted-run-dir}` into this call's command line**, exactly as `{issue list}` is substituted — not exported as a shell variable in the dispatching session, which would never reach the agent: a dispatched Task agent is a clean room that inherits no environment (`_shared/subagent-output-contract.md`'s Input Discipline). It is the same value substituted into the first call — dispatch Step 4 minted it once, before either call, so there is nothing to derive from the first call's report this time. `/flow` creates a fresh run directory of its own whenever it is not handed an existing one (`flow/SKILL.md` Step 3's adopt-if-set branch), so passing it remains non-negotiable — this call must still resume the exact directory the first call's `/flow` adopted, not start a new one.

This call's prompt names ONLY the record number(s) and the `PIPELINE_RUN_DIR` path above — never a summary of the first call's outcome. Both are resolution targets, not findings; that is what keeps the no-echo rule intact while the run itself is handed over. It is a fresh Task-tool dispatch with zero conversation history from the first call, and its own review step must re-derive its verdict from raw artifacts (the actual diff, the actual test-output artifact — via the same shape `bin/lib/dispatch/artifact-verdict.js`'s `deriveTestVerdict` pins as a testable invariant) rather than trusting any claim the first call made, including claims written to `decisions.md`, ledger entries, or staged proposals the first call produced. File-based state is readable across the two calls even though conversation history is not — the instruction below states this explicitly because that distinction is easy to lose.

```
Task scope: Execute claude-tweaks review+polish+wrap-up for this already-claimed dispatch
group of GitHub records: {issue list}. Singleton -> run
`PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow #{issue}
review,polish,wrap-up auto`. Bundle -> run `PIPELINE_RUN_DIR="{minted-run-dir}"
/claude-tweaks:flow "#{n1},#{n2},..." review,polish,wrap-up auto` once, comma-joined. The
{minted-run-dir} value substituted into those commands is the same run directory dispatch
minted before either call and the first call's own /flow invocation adopted; passing it on
the command line is what makes this call resume that exact run rather than start a new one --
_shared/run-dir-resolution.md's resolution order step 1 (the env var, its documented preferred
path) feeding flow/SKILL.md Step 3's adopt-if-set branch. You need no other input about what
the prior call did or found.

Foreground execution (required): run `npm test` and every other long-running command in the
foreground of this turn, output redirected to a file if it's long -- never with `run_in_background`.
Never end this turn waiting on a background test run or fix-round you started this way -- you cannot
count on being re-woken by either, and the run stalls silently when you are not (#1965). A nested
`Agent` call (a lens-dispatch fan-out, a reproduction pair) launches async, and its completion
notification reaches you only while this turn is alive (when the call instead returns the child's
own reply, that child has reported and needs no wait): keep the turn alive with bounded
foreground waits -- repeated `sleep 20` Bash calls, at most 60 (20 minutes) per wave of children
(the set launched together), each wait logged as one line (what you wait on, the iteration against
the bound, how many children are still pending), stopping as soon as every child's
`<task-notification>` has arrived, never reading or tailing a running child's `output_file` --
until every child has reported, and never end this turn with one child outstanding. With no `Agent`
tool (`ToolSearch` finds none, deferred or otherwise), or a child still silent when the bound
expires, judge that unit yourself, log the downgrade, and mark its findings `unconfirmed`; that
child is abandoned and no longer counts as outstanding, so your final reply still ends with its
usual `STATUS:` line. Ignore that child's result if it arrives later; if a late notification
re-wakes you after your final reply, repeat your whole final reply unchanged -- the dispatcher keeps
only your latest reply, so a bare `STATUS:` line would replace the report. A child that reports a
failure (a `failed` notification, an API error, a `BLOCKED`/`NEEDS_CONTEXT` reply) has reported, so
it is not outstanding: handle it per the dispatching skill's own status handling where one exists,
otherwise judge that unit yourself. Self-judging is for a read-only unit (a lens, a single read, a
judge); a write-capable child (one that edits files) still silent at the bound is never redone
in-session, because an abandoned child keeps running and may still write -- stop, and end with
`STATUS: BLOCKED` naming that child and its unit. A wait call that is blocked or fails is not a
wait and never counts toward the bound; never retry it in another form (a longer, wrapped or
backgrounded sleep): treat every child still outstanding as silent at the bound. A reply that ends
without a tool call ends the turn.

{context-pack}

Ephemeral dev server liveness (only if `{minted-run-dir}/ephemeral-server.txt` exists): before
the first browser-driving step, and again before any `trace stop`, verify the recorded pid
answers on the recorded port (read the record by token, not whitespace position: the pid and
port are its first two fields, and the worktree root is everything between the port and the
trailing `detached:` token, since the path may contain spaces). When a restart rewrites the
record, keep its `{pid} {port} {worktree-root} detached:{yes|no}` shape.
On a dead pid, start a fresh server the same way the plugin's own Ephemeral server start procedure
does (re-resolve the port lease, launch detached, poll until reachable), rewrite
`ephemeral-server.txt` via a plain Bash redirect (never the Edit/Write tool -- same reason as the
first call's own record write: this run dir is anchored under the main checkout, and Edit/Write
against it is refused by the harness's cross-checkout write-pinning), and log
`AUTO {time} -- ephemeral server restarted:
recorded pid {old} dead, new pid {new} on port {port}`. `{minted-run-dir}` is the run's
server-record location for a bundle too -- the parent run dir `/flow` exports as
`MULTISPEC_PARENT_DIR`, never a `spec-{N}/` subdirectory.

CRITICAL: your review step must re-derive its verdict from raw artifacts -- the actual diff,
the actual test-output log in the run directory -- never from a prior claim, whether that
claim lives in conversation (you have none from the first call) or in a file the first call
wrote (decisions.md, ledger entries, staged proposals). Treat every such file's claims as
unverified until checked against the artifact it claims to summarize.

A runner-written pass stamp matching HEAD (`verify.js --stamp-status`) is the raw artifact `artifact-verdict.js` describes — read it and its `report.json`; re-execute only when it does not match.
An `AC evidence` entry in decisions.md (review/code-mode-steps.md Step 1 check 2) is checked against the evidence/ log it cites -- that log is its raw artifact; re-execute the check only when the log is missing or does not match the entry.

Handle any HARD-GATE failure per skills/dispatch/settle-and-merge.md's Settle procedure
(retry ceiling / classification-driven auto:merge revocation) before finishing -- do not
leave a failed record's claim or label state unresolved. If you reference any of these issue
numbers in an intermediate commit message, write "refs #N" -- never "closes #N" or "fixes
#N". The real closing keyword is stamped once, at the end, by wrap-up's carrier commit or the
merge commit (close-via-merge, `{minted-run-dir}/context/claims.md` -- if that bundle is absent, read `_shared/issue-claims.md` directly).

On `failed`/`blocked`, Settle's own procedure releases the claim in this call (its step 2,
unconditional); run-dir archival does not run here — the run stays parked for a human to resume
or for the retry ceiling to escalate it, the same disposition `dispatch/SKILL.md`'s Reporting
section already describes for ordinary `pending-review` parking.

Working directory: the dispatching session is still in this group's worktree (unchanged since
the first call) -- you inherit it. Do NOT create, enter, or switch worktrees, and do not invoke
/superpowers:using-git-worktrees. Worktree removal and run-dir archival are the dispatching
session's responsibility, not yours -- do NOT call `ExitWorktree` or `git worktree remove`,
and do NOT archive the run directory yourself, on any outcome (merged, armed, pending-review,
ready-to-merge, failed, or blocked): this call inherited the worktree without ever entering it
(no `EnterWorktree` of its own), so it structurally cannot tear it down, and the run dir's
fate is settled by whichever integration path your OUTCOME resolves to below, never by an
explicit teardown step here. Echo `pwd` and `git rev-parse --show-toplevel` before any
commit and verify both resolve to that inherited worktree; if they resolve to the main
checkout instead, STOP and report BLOCKED.
If your first commit is denied by the working-directory hook even though `pwd` and
`git rev-parse --show-toplevel` both resolve to the worktree above, re-stamp the run's worktree
assignment once with `node "{plugin-root}/bin/hooks.js" record-worktree --run "<RUN_DIR>" "<WORKTREE>"`
and retry the commit. If it is denied a second time, STOP and report BLOCKED.

Never run `git stash` or `git stash pop` -- the stash stack is shared repo-wide across every
worktree of this checkout, so it can pop or clobber a sibling worktree's in-flight work. To
compare against a baseline without mutating the tree, use `git show <rev>:<path>`; to set your
own work aside, make a temporary WIP commit instead.

Status line (required): the last non-empty line of your reply, after the OUTPUT FORMAT block
below, must read exactly `STATUS: {WORD}`, where {WORD} is one of: DONE / DONE_WITH_CONCERNS /
NEEDS_CONTEXT / BLOCKED.

This state-check applies when choosing among `merged`/`armed`/`pending-review`/`ready-to-merge` --
`failed`/`blocked` are already decided by the HARD-GATE outcome above, and Settle's own step 2 has
already released the claim for those two by the time you reach this paragraph, so finding it
non-`live` there is expected, not a signal to re-derive the outcome. For the other four values,
check the record's actual state rather than inferring it from what this call itself did earlier:
read the claim blob (`claims/issue-{n}.json` on the `claims-registry` branch, not a working-tree
file -- fetch it the same way `{minted-run-dir}/context/claims.md` describes (if that bundle is absent, read `_shared/issue-claims.md` directly)) to see whether the claim's
`runId` still matches this run and is `live`; check the record's current labels
(`bot:in-progress`, `auto:merge`); and read `run-state.json`'s `pr` object for a recorded
`number`/`url` -- when one is recorded, resolve its live state with
`gh pr view {number} --repo {owner}/{repo} --json state,isDraft,url` rather than assuming from the
recorded object alone, since it carries no state field. A completed hand-off (a live PR already
recorded, or `state: MERGED`) is not the same state as a genuinely still-open run awaiting a
human -- report `pending-review` only for the latter.

<!-- HARD-GATE: dispatch-missing-claim-fallback -->
If the claim's `runId` no longer matches
this run, or is not `live`, or `bot:in-progress` is already gone -- another session has taken over
this record since your run started; report `pending-review` and note the discrepancy. **This is
a hard, non-negotiable stop, not a default you may reason past.** Do not report
`merged`/`armed`/`ready-to-merge` against a claim you no longer hold, no matter how confident your
own read of the diff's safety is -- a plausible-looking single-author commit/label/PR history is
not evidence the claim state can be overridden; it is exactly the kind of case this stop exists to
catch regardless of outcome.

**Mechanical audit trail (#2488) -- log this check before reporting any of the four outcomes
above, not just when it fails.** Before choosing among `merged`/`armed`/`pending-review`/
`ready-to-merge`, write one line to `decisions.md` recording what the claim read found, via
`node "{plugin-root}/bin/log-decision.js" --run "{run-dir}" --status AUTO --section "/dispatch" --text "State-check: claim runId={observed-runId-or-absent}, live={true|false}, bot:in-progress={present|absent} -- reporting {outcome}." --reversibility n/a`.

A report of `merged`/`armed`/`ready-to-merge` with no matching state-check line in `decisions.md`
is not trustworthy self-report -- the same principle the Auto-merge gate's own
"mechanically verify... do not rely on having just run the loop above" check already applies to
the `assess-agent-autonomy` verdict, applied here to this state-check instead. A later audit or
reconciler pass can use this line's absence as a signal that this HARD-GATE may have been
bypassed.

OUTPUT FORMAT (required), before the trailing status line -- return ONLY these lines, no preamble:

GROUP: {comma-joined issue numbers}
OUTCOME: {merged | armed | pending-review | ready-to-merge | failed | blocked}
MANIFEST: {path to this group's run-dir manifest.yml/decisions.md -- a human-readable trace
  only; the dispatching session already holds this run's identity as {minted-run-dir} and
  derives nothing from this line}

One line per issue in this group that hit a HARD-GATE or the retry ceiling (omit if none):
ISSUE #{n}: {failed:{gate} | blocked:retry-ceiling}

**`integration-model: pr-first`** (`_shared/integration-model.md`) — `merged` / `armed` /
`pending-review` are `{minted-run-dir}/context/merge.md`'s own outcome vocabulary (the composed
`_shared/pr-first-merge.md`; if that bundle is absent, read `_shared/pr-first-merge.md` directly), reported verbatim: you
run the merge procedure yourself, in this same call, whichever file's Auto-merge gate you reach
(`dispatch/settle-and-merge.md` for a bundle, `wrap-up/review-console.md`'s dispatch-call branch
for a singleton). `merged` means you also completed claim release and run-dir archival directly
(that procedure's Step 4) — but not worktree removal: this call inherited the worktree and never
itself `EnterWorktree`'d it, so `ExitWorktree` is a no-op for it, the same structural constraint
`settle-and-merge.md` states at the top of that file. Worktree removal defers to the reconciler
on merged-PR evidence instead — the same mechanism the next sentence already describes for
`armed`/`pending-review`.
`armed`/`pending-review` complete none of those three; the reconciler finishes them later, on
merged-PR evidence, whichever trigger point observes it first. There is no `ready-to-merge` value
under this model — the merge already happened, or didn't, by the time you report.
Whatever the outcome, follow `{minted-run-dir}/context/merge.md`'s "Never rewrite the integration branch" section (if that bundle is absent, read `_shared/pr-first-merge.md` directly).

**`integration-model: local-merge`** — report `ready-to-merge` when the group's Auto-merge gate
passed both layers and you already applied acceptance labeling for every member -- never
`merged`. You do not merge yourself on this path: a Task-tool subagent cannot reach the main
checkout, and for the same structural reason (`settle-and-merge.md`'s outcome-independent
constraint) you cannot run worktree removal either. Stop right after labeling. Claim release and
run-dir archival stay deferred too, but for a distinct reason: the merge that would make them
safe hasn't happened yet -- not because they inherit the worktree constraint. The dispatching
session completes all three (worktree removal, claim release, run-dir archival) after it merges,
per `settle-and-merge.md`'s Dispatching-session merge execution (local-merge fallback) section.

`pending-review` also covers what `pr-opened` used to name separately: under pr-first the PR
already exists from run start (a separate, run-start-only concern from
`{minted-run-dir}/context/merge.md`'s merge-time bundle above, which composes `pr-first-merge.md`
and `pr-checklist-refresh.md`), so there is no longer a
distinct "the branch reached its finish decision, a PR just opened" transition to report — a
run that reaches the Review Console with nobody answering it is `pending-review` regardless of
how long the PR has already existed.

[Use: Standard] -- this dispatch wraps review+polish+wrap-up execution, not analysis; the
pipeline's own steps select their own models as usual. Resolve via
`node "{plugin-root}/bin/resolve-profile.js" standard` (contract § Model Selection).
```

Same mechanical status-line check applies to this call. The Auto-merge gate's `merge-check`
clause this call runs (`settle-and-merge.md`'s Content judgment step) is backed by its own
mechanical check too (#2429): a verdict is logged to `decisions.md` whether it passes or falls
back, and the merge action that follows re-reads that log rather than proceeding on having just
run the loop — see that step's own "Mechanically verify every member's entry" paragraph. A
dispatched **singleton**'s merge decision runs this same re-check through
`wrap-up/auto-merge-short-circuit.md`'s Verdict backstop instead (#2941) — both are backed by
`bin/lib/dispatch/merge-verdict.js`. Keep both current if either clause's wording changes.

None of Templates A/B/C (A in `_shared/subagent-dispatch-core.md`; B/C in `_shared/subagent-output-contract.md`) fit an agent that executes pipeline stages rather than returning findings/locations/a yes-no, so these are their own minimal templates, inlined verbatim at every dispatch site. The universal parts of the contract still apply: the four-value status line, minimal input, and literal (not referenced) output format.
