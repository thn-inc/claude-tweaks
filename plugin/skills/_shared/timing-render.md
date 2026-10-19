# Timing Render — the Pipeline Summary's Timing Section

This contract governs how `bin/phase-timing.js --markdown --auto-transcript` output renders under a `### Timing` heading in a Pipeline Summary.

**Consumers:** `wrap-up/summary-template.md`, `flow/summary-template.md`, `flow/multispec-summary.md`. Each consumer keeps its own `### Timing` heading and its own invocation line, because the `--run` value differs (the citing template's run dir — `$PIPELINE_RUN_DIR`, or `$MULTISPEC_PARENT_DIR` for the multi-spec summary). Everything else about the section is defined here; the consumers cite this file and restate none of it (#3413).

## Phase table

Rendered verbatim from the citing template's `phase-timing.js` invocation (#1928) — never composed by hand; a phase with no event reads `unattributed`. `{Minutes}` is the phase's span, with `(own N)` when nested phases are excluded. An `unattributed` table row (below the phase rows, above `total`) appears only when transcript usage rows fall outside every phase's span (#1929). When the CLI prints a `tokens: transcript not found (...)` line, render it verbatim above the table — blank token columns are a fact about the run, not a formatting error (#1929). `Tokens (in/out)` sums the transcript's raw `input_tokens`/`output_tokens` only — cache reads and cache creation are separate fields in `timing.json`'s `tokens`, and on a cache-heavy session dwarf `in`.

**Archive-path rule.** When wrap-up's cleanup item 8 has already archived the run directory (`wrap-up/cleanup-procedures.md`), pass `$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/` as `--run` instead of the citing template's run dir — the events and manifest travel with the archive. The rule only fires once the run is archived, so it is inert for a summary rendered before cleanup.

| Phase | Minutes | Verify | Tokens (in/out) | Proc. KB | Tool RTs |
|---|---|---|---|---|---|
| {phase} | {minutes} | {mode ×n | — | unattributed} | {in/out | —} | {kb | —} | {n | —} |
| unattributed | — | — | {in/out} | {kb} | {n} |
| total | {totals.minutes} | {verifyRuns} run(s) ({modes}) | {in/out} | {kb} | {n} |

Guard denials: {n} gate · {n} wd-ambiguous · {n} wd-deny

## Dispatches

Under `--auto-transcript`/`--transcript` the CLI also appends a Dispatches section (#3375), rendered verbatim below the `Tokens (in/out)` footnote that follows the Guard denials line — never composed by hand. It carries two tables over the run's subagent dispatches, scoped to the `run window` (or the `whole session` when the run has no events): one by model tier (`fast`, `standard`, `capable`, `frontier`; an `unmapped` row carries the raw model names), one by role (implementer, task review, re-review, whole-branch review, plan review, lens reviewer, unlabelled). `Agent-seconds` sums each dispatch's span with overlap kept; `Elapsed (min)` is the union of those spans in minutes. The two are not comparable to phase minutes, and the Dispatches tokens are never summed with the phase table's main-session `Tokens (in/out)` column. A `Dispatches ({run window | whole session — no run events}; …):` line heads the tables. Render the not-found line (`dispatches: subagent transcripts not found (...)`, once per transcript whose `subagents/` directory yielded nothing), each per-dispatch line (`dispatch agent-{id}: ` followed by `transcript not found (...)`, `transcript has no usage rows`, `meta not found (description null)` or `meta not readable (...) (description null)`) and `dispatches: {n} outside the run window excluded` verbatim — a missing value is a fact about the run, never a zero.

| Tier | Dispatches | Agent-seconds | Elapsed (min) | Tokens (in/out) | Cache (read/create) |
|---|---|---|---|---|---|
| {fast \| standard \| capable \| frontier \| unmapped (raw: {model}[, {model}…])} | {n} | {s} | {min} | {in/out} | {read/create} |

| Role | Dispatches | Agent-seconds | Elapsed (min) | Tokens (in/out) | Cache (read/create) |
|---|---|---|---|---|---|
| {role} | {n} | {s} | {min} | {in/out} | {read/create} |
