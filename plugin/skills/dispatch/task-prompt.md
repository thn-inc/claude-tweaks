# Dispatch Step 5 — Task() Prompt Template

Referenced by `skills/dispatch/SKILL.md` Step 5. Unlike `sequential-execution.md` and `deprecated-aliases.md` (background detail, read for understanding), **each of this file's two templates must be inlined verbatim into its own `Task()` tool call** when dispatching a group — they are the operative templates, not supplementary reading. Never inline both into one call. Copy each fenced block below exactly, substituting `{issue list}`, `{minted-run-dir}`, `{plugin-root}`, `{context-pack}`, etc. as SKILL.md's Step 5 directs.

Each group is dispatched as **two sequential `Task()` calls**, not one (per `_shared/subagent-output-contract.md`'s input discipline — minimal input, literal output template inlined, no conversation history). The single-assistant-message rule (`_shared/subagent-dispatch-core.md`'s fan-out section) creates no batching decision here — these two calls are sequential by design, never emitted together.

## Context pack (#1542 — resolve once, substitute into both calls)

A dispatched Task agent inherits no shell environment (`_shared/subagent-output-contract.md`'s
Input Discipline) — so every `${CLAUDE_PLUGIN_ROOT}`-style env-var reference embedded literally
in a template resolves to nothing inside the dispatched agent's own shell, forcing it to
rediscover the value from scratch (`--help` probes, `find` searches, trial-and-error against CLI
argument enums — the exact rediscovery this section eliminates). The dispatching session already
resolved these facts earlier in the same firing (Steps 1-4); it resolves them **once
more here, as literals**, before composing either call:

1. **`{plugin-root}`** — this session's own already-resolved `$CLAUDE_PLUGIN_ROOT` value,
   substituted as a literal absolute path everywhere this file used to embed the env-var
   reference `${CLAUDE_PLUGIN_ROOT}` — never left as `${CLAUDE_PLUGIN_ROOT}` for the dispatched
   agent's shell to expand.
2. **`{minted-run-dir}`** — unchanged from before this section existed (Step 4's mint).
3. **Resolved policy values** — one call, before either dispatch: `node "{plugin-root}/bin/resolve-policy.js" --values autonomy,integration-model,merge-verification,risk-floor,size-floor`. The four values this call's own Settle/Auto-merge procedures need downstream.
4. **Canonical CLI invocation table** — the argument shapes and enums a dispatched call has
   historically had to rediscover by trial and error:

   | CLI | Canonical shape |
   |---|---|
   | `log-decision.js` | `node "{plugin-root}/bin/log-decision.js" --run "{minted-run-dir}" --status AUTO\|STAGED\|KEPT-PROMPT\|SCANNED\|REFUSED\|SKIP --text "..." [--reversibility high\|med\|low\|n/a]` |
   | `claim-targets.js` | `node "{plugin-root}/bin/claim-targets.js" --run-id "{run-id}" --targets {n}[,{m}...] [--keep-going]` |
   | `materialize.js` | `node "{plugin-root}/bin/materialize.js" <n> --run-dir "{minted-run-dir}" [--multi-record-slug <n>]` |
   | claims-registry read | `{minted-run-dir}/context/claims.md`'s "Reading claim state" git-trees path (`claims/issue-{n}.json` on the `claims-registry` branch) — never `gh api ...?ref=` query-string quoting, never `-f ref=` on a GET (if that bundle is absent, read `_shared/issue-claims.md` directly) |

5. **Composed bundles** — `{minted-run-dir}/context/claims.md` and
   `{minted-run-dir}/context/merge.md`, composed by the dispatching session before either call;
   every citation of them in the templates below carries its own fallback to the source file.

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

## First call — build,test

**No handoff to capture from this call's report.** Dispatch Step 4 already minted this group's run directory before either call — `{minted-run-dir}` below is that same directory, substituted literally, on both calls. There is nothing to parse out of this call's prose report to construct the second call's input; the gate between calls (`two-call-gate.md`) reduces to reading the status line and `OUTCOME`.

**Before substituting this template**, the dispatching session decides whether to add `DISPATCH_HEADLESS=1 ` immediately before `/claude-tweaks:flow` on the invocation line below — a decision made once, here, never left in the copy-pasted text for the dispatched agent to reason about. Add it when this firing came from a scheduled Routine — a bare drain, or its deprecated `next` alias — with nobody present; omit it entirely (no `{headless-marker}` placeholder, no trailing space) when a human typed the command directly, in any form (bare, `next`, `#N`, or explicit-list) — the same human-present/Routine discriminator `SKILL.md`'s Next Actions render rule already uses. When set, it tells this call's Settle procedure (`settle-and-merge.md`) that nobody is present to read a Step 2.8 claim-contest stop, so a contest there should self-report via `_shared/headless-self-report.md` instead of just failing silently to whoever isn't watching. This is exactly why the marker must not live inside the fenced block below: the block is copied verbatim into every dispatch regardless of firing form, and the dispatched agent itself has no way to know which form the dispatching session used — only the dispatching session can make this call, before substitution.

```
Task scope: Execute claude-tweaks build+test for this file-overlap group of
GitHub records: {issue list}. Singleton -> run
`PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow #{issue} build,test`.
Bundle (2+ issues) -> run
`PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow "#{n1},#{n2},..." build,test`
once, comma-joined. Stop after the test gate -- do not proceed to review, polish, or wrap-up;
a separate Task call handles those. If you reference any of these issue numbers in an
intermediate commit message, write "refs #N" -- never "closes #N" or "fixes #N".

Foreground execution (required): run `npm test` and every other long-running command in the
foreground of this turn, output redirected to a file if it's long -- never with
`run_in_background`. Never end this turn waiting on a background test run, fix-round, or child
agent's completion notification; a dispatched agent that yields this way is never re-woken and
the run stalls silently (#1965).

{context-pack}

Ephemeral dev server (only if this run's steps include a browser-driving step in a later,
separate call -- review or stories/QA): if this call starts an ephemeral worktree dev server (a
background dev command on a free port, recorded in `ephemeral-server.txt`), start it detached --
POSIX: launch under `setsid` (e.g. `setsid {dev command} > {log} 2>&1 &`); Windows: no detach
primitive exists, record `detached: no` instead -- and append a fourth field to the recorded
line (`detached:yes`/`detached:no`). Never delete `ephemeral-server.txt` at the end of this call,
whether or not the server is still alive -- the record belongs to the run, not to this call, and
the second call's own liveness re-check depends on it still being there.

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
The actual artifact is the test-output log this call's own `npm test` run wrote, or a
runner-written pass stamp matching HEAD (`verify.js --stamp-status`) and its `report.json` (the
shape `bin/lib/dispatch/artifact-verdict.js`'s `deriveTestVerdict` pins). Never report a result
from narrative or memory of an earlier pass in this same call -- if the artifact does not exist
or does not match HEAD, re-run the check before reporting.

OUTPUT FORMAT (required) -- return ONLY these lines, no preamble:

GROUP: {comma-joined issue numbers}
OUTCOME: {build-test-ok | build-test-failed | build-test-blocked}
MANIFEST: {absolute path to this group's run-dir manifest.yml/decisions.md -- a
  human-readable trace only; the dispatching session already holds this run's identity as
  {minted-run-dir} and derives nothing from this line}

One line per issue in this group that hit a HARD-GATE (omit if none):
ISSUE #{n}: failed:{gate}

Status line (required): on its own trailing line, after everything above -- the reply's last
non-empty line -- write exactly `STATUS: {WORD}`, where {WORD} is one of: DONE /
DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.

[Use: Standard] -- this dispatch wraps build+test execution, not analysis; the pipeline's own
steps select their own models as usual. Resolve via `node "{plugin-root}/bin/resolve-profile.js" standard`
(contract § Model Selection).
```

## Second call — review,polish,wrap-up (gated on the first call)

**Only dispatch this call if the first call's status line was DONE or DONE_WITH_CONCERNS AND its OUTCOME was `build-test-ok`.** A `NEEDS_CONTEXT`/`BLOCKED` status, an `OUTCOME` of `build-test-failed`/`build-test-blocked`, or no parseable report at all means this second call is never dispatched — the first call's own agent settles its own failure (its template above instructs it to), and the dispatching session takes the terminal path in `two-call-gate.md` section 5 (fail-loud reporting plus the `/claude-tweaks:wrap-up {target} cleanup-only` teardown call).

**Substitute `{minted-run-dir}` into this call's command line**, exactly as `{issue list}` is substituted — not exported as a shell variable in the dispatching session, which would never reach the agent: a dispatched Task agent is a clean room that inherits no environment (`_shared/subagent-output-contract.md`'s Input Discipline). It is the same value substituted into the first call — dispatch Step 4 minted it once, before either call, so there is nothing to derive from the first call's report this time. `/flow` creates a fresh run directory of its own whenever it is not handed an existing one (`flow/SKILL.md` Step 3's adopt-if-set branch), so passing it remains non-negotiable — this call must still resume the exact directory the first call's `/flow` adopted, not start a new one.

This call's prompt names ONLY the record number(s) and the `PIPELINE_RUN_DIR` path above — never a summary of the first call's outcome. Both are resolution targets, not findings; that is what keeps the no-echo rule intact while the run itself is handed over. It is a fresh Task-tool dispatch with zero conversation history from the first call, and its own review step must re-derive its verdict from raw artifacts (the actual diff, the actual test-output artifact — via the same shape `bin/lib/dispatch/artifact-verdict.js`'s `deriveTestVerdict` pins as a testable invariant) rather than trusting any claim the first call made, including claims written to `decisions.md`, ledger entries, or staged proposals the first call produced. File-based state is readable across the two calls even though conversation history is not — the instruction below states this explicitly because that distinction is easy to lose.

```
Task scope: Execute claude-tweaks review+polish+wrap-up for this already-claimed file-overlap
group of GitHub records: {issue list}. Singleton -> run
`PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow #{issue}
review,polish,wrap-up`. Bundle -> run `PIPELINE_RUN_DIR="{minted-run-dir}"
/claude-tweaks:flow "#{n1},#{n2},..." review,polish,wrap-up` once, comma-joined. The
{minted-run-dir} value substituted into those commands is the same run directory dispatch
minted before either call and the first call's own /flow invocation adopted; passing it on
the command line is what makes this call resume that exact run rather than start a new one --
_shared/run-dir-resolution.md's resolution order step 1 (the env var, its documented preferred
path) feeding flow/SKILL.md Step 3's adopt-if-set branch. You need no other input about what
the prior call did or found.

Foreground execution (required): run `npm test` and every other long-running command in the
foreground of this turn, output redirected to a file if it's long -- never with
`run_in_background`. Never end this turn waiting on a background test run, fix-round, or child
agent's completion notification; a dispatched agent that yields this way is never re-woken and
the run stalls silently (#1965).

{context-pack}

Ephemeral dev server liveness (only if `{minted-run-dir}/ephemeral-server.txt` exists): before
the first browser-driving step, and again before any `trace stop`, verify the recorded pid
answers on the recorded port. On a dead pid, start a fresh server the same way the plugin's own
Ephemeral server start procedure does (re-resolve the port lease, launch detached, poll until
reachable), rewrite `ephemeral-server.txt`, and log `AUTO {time} -- ephemeral server restarted:
recorded pid {old} dead, new pid {new} on port {port}`.

CRITICAL: your review step must re-derive its verdict from raw artifacts -- the actual diff,
the actual test-output log in the run directory -- never from a prior claim, whether that
claim lives in conversation (you have none from the first call) or in a file the first call
wrote (decisions.md, ledger entries, staged proposals). Treat every such file's claims as
unverified until checked against the artifact it claims to summarize.

A runner-written pass stamp matching HEAD (`verify.js --stamp-status`) is the raw artifact `artifact-verdict.js` describes — read it and its `report.json`; re-execute only when it does not match.

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
human -- report `pending-review` only for the latter. If the claim's `runId` no longer matches
this run, or is not `live`, or `bot:in-progress` is already gone -- another session has taken over
this record since your run started; report `pending-review` and note the discrepancy rather than
reporting `merged`/`armed`/`ready-to-merge` against a claim you no longer hold.

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
(`dispatch/settle-and-merge.md` for a bundle, `wrap-up/review-console.md`'s dispatch-claim branch
for a singleton). `merged` means you also completed claim release and run-dir archival directly
(that procedure's Step 4) — but not worktree removal: this call inherited the worktree and never
itself `EnterWorktree`'d it, so `ExitWorktree` is a no-op for it, the same structural constraint
`settle-and-merge.md` states at the top of that file. Worktree removal defers to the reconciler
on merged-PR evidence instead — the same mechanism the next sentence already describes for
`armed`/`pending-review`.
`armed`/`pending-review` complete none of those three; the reconciler finishes them later, on
merged-PR evidence, whichever trigger point observes it first. There is no `ready-to-merge` value
under this model — the merge already happened, or didn't, by the time you report.

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

None of Templates A/B/C (A in `_shared/subagent-dispatch-core.md`; B/C in `_shared/subagent-output-contract.md`) fit an agent that executes pipeline stages rather than returning findings/locations/a yes-no, so these are their own minimal templates, inlined verbatim at every dispatch site. The universal parts of the contract still apply: the four-value status line, minimal input, and literal (not referenced) output format.
