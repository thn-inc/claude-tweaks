# Disposition — Step 8's Staged-Findings Gate

Step 8 of `/claude-tweaks:release` reads this file before it renders the summary block. It decides what becomes of every review finding the run staged, so the run directory Step 8 then archives holds no finding nobody read (#3898).

## When this runs

On every outcome — `released`, `HELD`, `PARTIAL`, `failed` — and under `--dry-run` too: the whole-branch review's findings are real whether or not anything ships, so this step still runs when a dry run lands nothing.

It disposes only a **created** run directory, read from Step 0's carried fact and never re-read from disk — the directory may already have been moved. Any other directory writes this one line, through the canonical writer, and nothing else:

```
SKIP {HH:MM:SS} — Step 8 disposition: condition: inherited run directory → fallback: the parent's Review Console owns staged/. Reversibility: n/a.
```

## Inventory

Read `{run-dir}/staged/` once and list every finding in it:

- Each `staged/review-{n}.{md,patch}` — a confirmed finding, one per file, its severity read from the file's `Finding: {severity} {category} — …` line. A critical finding lands here too, because `review/step3-routing.md`'s KEPT-PROMPT row stages a patch as well as surfacing it inline.
- Each entry line of `staged/review-unconfirmed-{n}.md` — a finding the tiebreak left unconfirmed (`_shared/multi-agent-coordination.md`).
- Each `staged/review-contested-{n}.md` and `staged/review-debate-{n}.md` — a finding two lenses disagreed on, both verdicts side by side (`review/step3-debate-and-refutation.md`).

Any other `staged/review-*` file is unrecognised: it counts as a failure (below), so the run is not archived with a finding nobody read.

`release-held.md` is not a finding. It stays where it is and is archived with the run.

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
| An open record already covering the same file and defect, found by searching open records for the finding's path | `declined (covered by #{n})` |

The covering-record row wins over every other row: a finding an open record already tracks is never filed a second time.

## Approval

When a human is present, render the batch table first — one row per inventoried finding, with its staged path, severity and Recommended disposition — then ask once with `AskUserQuestion`: `Apply all (Recommended)` or `Override`. An override is ordinary free-text chat naming the row numbers to change, per the Interaction style directive.

When `autonomy` resolves `unattended` — always the case under `--train`, by that flag's own refusal rule — nothing is asked, but the table is never skipped. The full table still renders, every row stamped `AUTO-RESOLVED`, in the same shape `_shared/autonomy-ceiling.md` gives `consoleAutoResolve`. Zero clicks, never zero render.

## Logging

Write exactly one line per inventoried finding, through the canonical writer (`--section "/release" --step "Step 8 disposition"`), then the summary line:

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

An unrecognised file takes the same line with `unrecognised staged review file, no route` in place of `{file|digest} failed: {message}`, and `Reversibility: n/a (nothing written).` Any failure means Step 8 skips archival for this run and names the failed paths in its summary. The closed directory stays in place with the unread finding still in `staged/`, and the next release will not adopt it (Step 0 refuses a terminal directory).

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Archiving the run directory with a finding still undisposed | `archive-run` moves `staged/` out of reach: a finding nobody filed, declined or digested is then discoverable only by digging through `archive/`, which is a silent loss of exactly what the review gate produced |
| Re-reading the created-or-inherited fact from disk | The directory can be archived out from under the read, and `$PIPELINE_RUN_DIR` is set for Step 3's review whether or not this run minted the directory, so only Step 0's carried fact answers it |
