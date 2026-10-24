# Disposition — Step 8's Staged-Findings Gate

Step 8 of `/claude-tweaks:release` reads this file before it renders the summary block. It decides what becomes of every review finding the run staged, so the run directory Step 8 then archives holds no finding nobody read (#3898).

## When this runs

On every outcome — `released`, `HELD`, `PARTIAL`, `failed` — and under `--dry-run` too: the whole-branch review's findings are real whether or not anything ships, so this step still runs when a dry run lands nothing.

It disposes only a **created** run directory, read from Step 0's carried fact and never re-read from disk — the directory may already have been moved. Any other directory writes this one line, through the canonical writer, and nothing else:

```
SKIP {HH:MM:SS} — Step 8 disposition (skipped): condition: inherited run directory → fallback: the parent's Review Console owns staged/. Reversibility: n/a.
```

## Inventory

Read `{run-dir}/staged/` once and list every file in it except `release-held.md`, which is not a finding: it stays where it is and is archived with the run. An absent or empty `staged/` means no staged files. When Step 3 logged no `## /review` marker this run (an early exit before Step 3: a Step 1 or Step 2 stop, a refused `--train`), read no `decisions.md` line at all. Otherwise read `{run-dir}/decisions.md`'s `## /review` block — only the lines after Step 3's carried marker `{k}`, never the whole block — and add every `STAGED` line whose stage path is absent or names no existing file. `_shared/auto-decision-log.md` counts those as staged findings with no `staged/` file: `review/step3-lens-dispatch.md`'s `not reproduced` lines, the gap sweep's, the earlier line a tiebreak `console` outcome leaves standing (`review/step3-tiebreak.md`), and a failed tiebreak's. A line whose stage path names a listed file is that file's finding, counted once by its stage path.

- Each `staged/review-{n}.{md,patch}` — a confirmed finding, one per file, its severity read from the file's `Finding: {severity} {category} — …` line. A critical finding lands here too, because `review/step3-routing.md`'s KEPT-PROMPT row stages a patch as well as surfacing it inline.
- Each entry line of `staged/review-unconfirmed-{n}.md` — a finding the tiebreak left unconfirmed (`_shared/multi-agent-coordination.md`).
- Each `staged/review-contested-{n}.md` and `staged/review-debate-{n}.md` — a finding two lenses disagreed on, both verdicts side by side (`review/step3-debate-and-refutation.md`).
- Each `staged/reflect-*`, `staged/simplify-*` and `staged/deepen-*` file — the review's own `/claude-tweaks:reflect` and `/claude-tweaks:simplify` passes (`review/code-mode-steps.md` Steps 4-5) and any deepen candidate list.
- Each `decisions.md`-only `STAGED` line, its severity read from the line when it names one.

Any other file in `staged/` is unrecognised: it has no route and counts as a failure (below), so the run is not archived with a finding nobody read.

With nothing to dispose, write one `SCANNED` line and do nothing else:

```
SCANNED {HH:MM:SS} — Step 8 disposition: no staged review findings. Reversibility: n/a.
```

## Routing table

The Recommended column is what the batch table below pre-fills for each row.

| Finding | Recommended disposition |
|---|---|
| Confirmed, any severity | Defer per `review/step3-routing.md`'s Defer bullet: compose the body with `specShapedBody`, file it with `recordPayload`, born-ready. Apply that bullet's materiality-floor test (`_shared/materiality-floor.md`) first: a finding that fails the floor is `Digest — below floor`, appended only once the row is approved, after the dedup check. Use `Defer-reason: pre-existing-outside-diff` — a release reviews already-merged history and has no diff of its own — and `provenance.origin: /claude-tweaks:release v{version} release-gate review (run {run-id})`. |
| An unconfirmed critical/high finding | The same Defer |
| Contested or debate, critical/high in either verdict | The same Defer, both verdicts quoted in the body |
| Unconfirmed medium/low/info | `declined (unconfirmed: one reproduction agent of the pair)` |
| Contested or debate, otherwise | `declined (contested: {verdicts})` |
| A `decisions.md`-only `STAGED` line at critical/high | The same Defer |
| A `decisions.md`-only `STAGED` line, otherwise | `declined (unconfirmed: {the line's own reason, e.g. not reproduced})` |
| A `reflect-*`, `simplify-*` or `deepen-*` file | The same Defer path and Defer-reason, so the materiality floor routes a small one to the digest. Severity is read from the file when it carries one, else treated as medium for the floor test |
| Any other staged file | No route: a failure (below), never archived unread |
| An open record already covering the same file and defect, found by searching open records for the finding's path | `declined (covered by #{n})` |

The covering-record row wins over every other row: a finding an open record already tracks is never filed a second time.

Every filing, every digest comment and the covered-by lookup over open records go through `_shared/github-write-transport.md`'s CRUD mapping, so an MCP-only sandbox disposes the same set without `gh`.

## Approval

Three cases, keyed on the `autonomy` ceiling and on whether a human is reachable:

1. **`unattended`** — always the case under `--train`, by that flag's own refusal rule. Nothing is asked, but the table is never skipped: the full table renders, every row stamped `AUTO-RESOLVED`, in the shape `_shared/autonomy-ceiling.md` gives `consoleAutoResolve`. Zero clicks, never zero render.
2. **Below `unattended`, a human reachable in the session** — interactive, hybrid, or a terminal `auto` session. Render the batch table first — one row per inventoried finding, with its staged path, severity and Recommended disposition — then ask once with `AskUserQuestion`: `Apply all (Recommended)` or `Override`. An override is ordinary free-text chat naming the row numbers to change, per the Interaction style directive. This is the release run's end-of-run bookend console, so `auto` permits it: work-record creation is on `_shared/auto-mode-contract.md`'s never-silenced list ("Each record filed on the user's tracker needs explicit approval"), and an end-of-run question is not a mid-flow stop.
3. **Below `unattended`, no human reachable** — headless, such as a Routine firing without `--train`. File nothing and decline nothing; write one line, through the canonical writer:

   ```
   SKIP {HH:MM:SS} — Step 8 disposition (degraded): condition: no human present below autonomy unattended → fallback: {n} findings left staged at {paths}. Reversibility: n/a.
   ```

   Each such finding counts as undisposed — a failure for archival purposes — and the summary's `findings:` line names its path.

## Logging

Write exactly one line per inventoried finding, through the canonical writer (`--section "/release" --step "Step 8 disposition"`), then the summary line. In the headless case above, its one `SKIP` line stands in for the per-finding lines:

```
AUTO {HH:MM:SS} — Step 8 disposition: {staged path}{#entry} → {filed #{n} | digest ({comment url}) | declined ({reason})}. Reversibility: high.
AUTO {HH:MM:SS} — Step 8 disposition: {f} filed, {d} digest, {x} declined, {k} failed. Reversibility: n/a.
```

`{#entry}` is the entry's `#` position within an `unconfirmed` file, and is omitted for a one-finding file. State the digest comment URL and the count routed to the digest in this step's own output, per the floor contract's "Digest URL and count surfacing" section; a run that routes none states `0`.

## Failure

A filing or digest write that fails leaves that staged file where it is and writes the line below. `FAILED` is not one of the canonical writer's statuses, so it is hand-composed, as `bookkeeping.md` does for its own failures:

```
FAILED {HH:MM:SS} — Step 8 disposition: {staged path} — {file|digest} failed: {message}. Reversibility: n/a (write did not land).
```

An unrecognised file takes the same line with `unrecognised staged file, no route` in place of `{file|digest} failed: {message}`, and `Reversibility: n/a (nothing written).` Any failure means Step 8 skips archival for this run and names the failed paths in its summary. The closed directory stays in place with the unread finding still in `staged/`, and the next release will not adopt it (Step 0 refuses a terminal directory).

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Archiving the run directory with a finding still undisposed | `archive-run` moves `staged/` out of reach: a finding nobody filed, declined or digested is then discoverable only by digging through `archive/`, which is a silent loss of exactly what the review gate produced |
| Re-reading the created-or-inherited fact from disk | The directory can be archived out from under the read, and `$PIPELINE_RUN_DIR` is set for Step 3's review whether or not this run minted the directory, so only Step 0's carried fact answers it |
