# Phase 4 — The Phase-Trace Report Template

Loaded by `/claude-tweaks:wrap-up` Phase 4's "The phase-trace report", which always runs. Holds the render template for the wrap-up report — one section per phase — its conversation-mode variant, and the closure lines for record mode and conversation mode.

References inside the blocks below to "this file" and to a `## Next Actions` section "below" resolve to `SKILL.md`, not to this file.

**This file renders a record, never a decision.** In every mode — `auto`, `hybrid`, interactive, standalone — cleanup, configuration, queue-write, memory, and upstream proposals are decided at the Wrap-Up Review Console (`review-console.md` in this skill's directory), which runs on every wrap-up because Phase 1 guarantees a run directory. What this template renders is the **record of what the console decided**. Never present a batch table, an `AskUserQuestion`, or a per-item prompt here: a second decision point duplicates the console and breaks both the "one decision per message" convention and the bookend promise of at most two stops.

**Standalone multi-record batch.** When this wrap-up covers N already-completed, already-merged records from one batch (e.g. following up on a `/flow` multi-record run whose pipeline run directory was already archived — no live materialized header to key a single-record template on), render **one consolidated summary** covering all N records — a table with one row per record, mirroring `flow/multispec-summary.md`'s Multi-Spec Summary shape — rather than forcing the single-record template below N separate times.

```
## Wrap-Up: {Record #{n} — {title}   |   {topic}}
{Origin: {origin} — record mode only; the materialized header's origin field:
by:code-health / by:harness-health / by:journey-health / by:docs-health /
by:capture / by:dispatch, or "human" when absent. Omit entirely in
conversation mode and for legacy spec-file-mode runs.}

### Verdict

{One line: what shipped, where it is now, and what blocks it. State the
push status from the State block's own measurement — never assert "it
landed" from memory.}

### State

Render VERBATIM from the helper — do not compose these facts from memory:

Paste `pack.state.value.rendered` from `{run-dir}/wrap-up-pack.json` (#1930) verbatim — that field is byte-identical to what the command below prints, and it is the ONLY field of `pack.state` this block reads. Never compose the block from the sibling `state`/`ops`/`since` fields: doing so is the from-memory reconstruction the VERBATIM rule above exists to forbid, dressed as a JSON read. Run the command only when the pack file is absent; an `ok: false` field takes the re-derive-`{base}`-and-retry-once path below.

    node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-state.js" --since {base}

If the helper exits non-zero, `{base}` was not a resolvable commit-ish —
re-derive it by the rule below and retry once. If it still fails, render the
State block's fields as `unknown` and say so; never omit the block.

Resolve `{base}` — a commit-ish, never a date — by the first rule that applies.
`{integration-branch}` is the branch this project integrates work into, resolved
via `skills/_shared/integration-branch.md`'s canonical ladder — not always the
GitHub default branch that fragment's git-inference rank would otherwise settle
on:

1. `git merge-base HEAD {integration-branch}` when HEAD is not on the
   integration branch. The branch's whole life is the work, so this is immune
   to how often the session pushed.
2. `git merge-base HEAD @{u}` when HEAD IS on the integration branch and it has
   an upstream — the base is the last commit the remote has, so the window is
   exactly what has not been pushed.
3. `HEAD` otherwise. The window is empty and renders as `0 commits`, which is a
   visible, checkable answer rather than a silent guess.

The helper echoes the base back on the `Scope` line, so a wrong one shows up in
the output instead of silently narrowing the window.

Then append, in record mode only:

Record    #{n} — {closes via merge | closed | open}
Ledger    {n} items, {n} open   |   none

### Timing

Rendered verbatim from `node "${CLAUDE_PLUGIN_ROOT}/bin/phase-timing.js" --run "$PIPELINE_RUN_DIR" --markdown --auto-transcript` (#1928) — never composed by hand; a phase with no event reads `unattributed`. `{Minutes}` is the phase's span, with `(own N)` when nested phases are excluded. An `unattributed` table row (below the phase rows, above `total`) appears only when transcript usage rows fall outside every phase's span (#1929). When the CLI prints a `tokens: transcript not found (...)` line, render it verbatim above the table — blank token columns are a fact about the run, not a formatting error (#1929). `Tokens (in/out)` sums the transcript's raw `input_tokens`/`output_tokens` only — cache reads and cache creation are separate fields in `timing.json`'s `tokens`, and on a cache-heavy session dwarf `in`.

| Phase | Minutes | Verify | Tokens (in/out) | Proc. KB | Tool RTs |
|---|---|---|---|---|---|
| {phase} | {minutes} | {mode ×n | — | unattributed} | {in/out | —} | {kb | —} | {n | —} |
| unattributed | — | — | {in/out} | {kb} | {n} |
| total | {totals.minutes} | {verifyRuns} run(s) ({modes}) | {in/out} | {kb} | {n} |

Guard denials: {n} gate · {n} wd-ambiguous · {n} wd-deny

### Phase 1 — Establish

| Item | Value |
|---|---|
| Mode | {record-based \| conversation-based} |
| Record | {#{n} — {title}} \| {n/a — conversation mode} |
| Run dir | {created (standalone)} \| {inherited from {parent}} |
| Ceremony profile | {fast-lane \| standard} {— downgraded fast-lane to standard: {trigger}, when the escape hatch fired} |
| Reflection | {n} insights routed in Phase 2 \| {light mode — {n} insights} |

The `Run dir` row states Phase 1's own inherited-vs-created determination,
carried forward as a run-scoped fact. Never re-read it from `run-state.json` at
render time — Phase 4's cleanup item 8 has usually archived the directory by
then, and the re-read fails on exactly the standalone runs whose value matters.

### Phase 2 — Route

Insert the output of the command below VERBATIM — never compose this table
by hand:

    node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-engine.js" render --run-dir "$PIPELINE_RUN_DIR" --section trace --strict

(Substitute the re-resolved run-dir path — env assignments do not survive between calls.)

`--strict` prints the table first and then exits 2 when any worklist row has no
recorded result, so a hole is visible AND fatal — the exit code is the signal,
not a reason to withhold the table.

Under the prose fallback (engine unavailable), follow `curation-engine.md`
section 6's trace format and append `(engine unavailable — prose fallback ran)`
to the table caption. A hand-composed trace that looks engine-produced is worse
than no trace: the trace's whole value is that it is mechanical.

Destinations are NAMED, never coded — this is the origin of the vocabulary rule
`curation-engine.md` section 5 states and the engine's `render` enforces.
`_shared/learning-routing.md`'s D1-D5 are internal classifier vocabulary and
must not reach the reader. The engine implements this mapping; the prose
fallback applies it by hand:

| Internal | Rendered |
|---|---|
| D1 | `CLAUDE.md Don'ts`, or the specific `.claude/rules/` file |
| D2 | the actual path — `docs/x.md`, `skills/y/SKILL.md` |
| D3 | `Backlog record` |
| D4 | `Memory` |
| D5 | `Upstream issue` |

Name the destination; never restate what landed there. A learning with no
destination is visibly missing from the trace, which is the point.

### Phase 3 — Settle

| Check | Result | Detail |
|---|---|---|
| Leftover routing | {{n} sections routed \| none \| n/a — conversation mode} | {each section — its routing destination} |
| Residue sweep | {{n} findings \| clean \| unknown — {reason}} | {each finding — {Fixed — `{hash}` \| Filed as #{n} \| Accepted — {reason}}} |
| Ledger gate | {{n} items resolved, {n} open \| no ledger items to resolve \| unknown — {reason}} | {each non-terminal item — its disposition} |
| Unblocked records | {{n} records unblocked \| none \| n/a — conversation mode} | {#{n} — {title}, one per record} |

Every row renders. A null result is stated as a null (`n/a — conversation
mode`, `none`, `no ledger items to resolve`), never by dropping the row — an
omitted row reads as "nothing outstanding", which is the failure this table
exists to eliminate.

No item may render without a disposition. A probe that could not run renders
its Result as `unknown` with the reason in Detail — never folded into a `none`,
and never silently absent. In record mode a partial completion verdict from
Phase 1 lands in the Leftover routing row as the specific sections that remain,
never as a percentage.

> Items whose disposition is `Filed as #{n}` or `Accepted` are completed after
> merging. Each is a real, trackable record (`_shared/ledger-format.md`'s Resolve Gate section's
> `Acknowledge` disposition) — not just a note in this transcript.

#### Routed to backlog

Render in every mode whenever `ledgerRouteRemainder` (`unattended` only)
auto-routed at least one item, OR this run filed at least one record (N > 0), OR
refused at least one proposal (M > 0). Table rows come only from route-remainder's own log lines — parsed from `_shared/ledger-format.md`'s Resolve Gate Phase 2
`AUTO … auto-routed to backlog as {ref} (defer-reason: {value}) — "{description}"`
log lines, one row per line:

| Record | Description | Defer-reason |
|---|---|---|
| #{ref} | {one-line description} | {value} |

Below the table (or alone when the table is omitted), render a trailing
`{N} record(s) filed by this run` line whenever N > 0 (every record this run
created — console approvals, auto-files, and route-remainder together), and a
`{M} proposal(s) refused — no defer reason` line whenever M > 0 (from
`REFUSED` entries in `decisions.md` — `wrap-up/refused-proposals.md`). A run
that files six records reads as a signal.

Omit this section entirely only when nothing was routed this way AND N = 0 AND M = 0 — this is
`ledgerRouteRemainder`'s own report row, distinct from `ledgerNarrowing`'s
routed items (which the Phase 3 Ledger gate row above already accounts for
under its normal disposition reporting) and from Queue writes at the Review
Console (a different mechanism, staged proposals awaiting per-item approval,
not yet-created records).

### Phase 4 — Close

Review Console — {approved all {n} items | overrode {n} of {n} | nothing to
review (empty-console fast path) | deferred — see multi-spec consolidated
console}.

Under `MULTISPEC_REVIEW_DEFER=1` the line reads `deferred — see multi-spec
consolidated console`, and nothing the parent `/claude-tweaks:flow`'s
consolidated console still owns is reported here as executed — including the
cleanup items `cleanup-procedures.md` marks deferred under that flag.

### Actions Performed

| Action | Detail | Ref |
|--------|--------|-----|
| History | {op} {target} — {one line} | `{hash}` |
| Implemented | {what was built} | `{hash}` |
| Operational | Closed record #{n} via merge (`Fixes #{n}`) | `{hash}` |
| Operational | Deleted plans `docs/plans/{files}` | — |
| Operational | Removed worktree `{path}`, deleted branch `{branch}` | — |
| Ledger fix | {item} ({phase}) — {resolution} | `{hash}` |

Generate from: the helper's History ops (every row it reports gets a `History`
row — that is the whole point of reading them), cleanup actions executed in
Phase 4, config/skill updates applied, ledger items resolved in Phase 3, and the
run dir's `events.jsonl` when present (hook-recorded commit breadcrumbs — the
hash reflects HEAD at hook time and is NOT verified against commit success —
and contract violations).

Omit the table entirely when no autonomous action was performed. Never fold a
history operation into `Operational` — that type means cleanup, and burying a
rebase there is the failure this row type exists to prevent.

(Next Actions are rendered as a top-level section after execution — see
`## Next Actions` in SKILL.md. Do NOT render them here.)
```

**Conversation mode.** When no record is identified for this run (`SKILL.md`
Phase 1's Conversation-based row — no `#`-prefixed argument, git commit/branch
reference, or, as fallback, materialized header resolved one), render the SAME
phase sections with the record-keyed pieces dropped **from the same tables**:
the `## Wrap-Up:` heading takes the work's topic instead of `Record #{n} —
{title}`; the `Origin:` line and the `Record` and `Ledger` State lines are
omitted; the Phase 1 table's `Record` row reads `n/a — conversation mode`; the
Phase 3 table's Leftover routing and Unblocked records rows read `n/a —
conversation mode`; and any `Operational` row about closing a record or
deleting plans is omitted from Actions Performed. Verdict, State, and Phases
1-4 render identically to record mode — the closure line does not.

This variant is not optional. Its absence is what caused a conversation-based
run to compose its report from the steps it had just executed, surfacing
internal step numbers and route codes and reporting a rebase inside a table
cell's rationale column.

Close conversation mode with this line instead of the record-mode archival
line below. State what this run's Phase 4 cleanup-gate check actually found —
never assume the negative default: a conversation-based run CAN carry a
ledger, a worktree, and a run directory (`SKILL.md`'s cleanup-gate note), and
a design-mode build's plan and design doc are deliberately kept in place
rather than deleted (`[IL-36]`), so "deleted" is not the only disposition a
found plan or ledger can have:

```
Work wrapped up. This run closed no record. {Measured plans/ledger clause —
"It had no plans or ledger to delete" when the cleanup gate found neither;
otherwise name what this run had and its actual disposition, e.g. "Its plan
under docs/superpowers/plans/{file} and SDD ledger were resolved during
cleanup" when deleted, or "Its plan under docs/superpowers/plans/{file}
remains in place — kept, not deleted, for a design-mode build" when kept}.
What it leaves behind is the code and the learnings above.
```

After presenting the report, output an explicit closure line. State what this
run's Phase 4 cleanup-gate check actually found — never assume the default
"deleted": a design-mode build's plan and design doc are deliberately kept in
place rather than deleted (`[IL-36]`), so "deleted" is not the only
disposition a found plan or ledger can have:

```
Work archived. Record #{n} closes via this merge (or the wrap-up commit, in current-branch mode); {Measured plans/ledger clause — "it had no plans or ledger to delete" when the cleanup gate found neither; otherwise name what this run had and its actual disposition, e.g. "its plan under docs/superpowers/plans/{file} and SDD ledger were resolved during cleanup" when deleted, or "its plan under docs/superpowers/plans/{file} remains in place — kept, not deleted, for a design-mode build" when kept}. The code and learnings remain.
```

This signals clearly that the lifecycle is complete — there's nothing left to do for this spec.
