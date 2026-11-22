# Release block

A durable "do not release" signal (#5882): an **open** record carrying the `release-block` label stops a release. The release reads the label when `/release` Step 1's fact-pack `engine` is `pr-first` **or** `work-backend` is `github-issues` (read as `release/console.md`'s Inputs reads it), so a `pr-first` project with no `## Work records` flag reads it too. Only `local-merge` **and** `local-files` together mean no GitHub forge to read: the release logs a skip. Neither input is a fresh remote probe. The release runs no forge detection: Step 1's pack takes `engine` only from an explicit `integration-model` (`_shared/integration-model.md`) and stops without one. `bin/release-block.js` is the one reader and writer; #5885 (the rolling review) and #5887 (the promotion gate) call its `stamp` and `check`.

## What sets a block

Three setters:

1. A critical or high finding that the rolling review or a release's delta review files as a record — the filer stamps that record.
2. `/release` Step 8's disposition — it stamps each critical/high finding it files, and also the covering record of a critical/high finding it declines as `declined (covered by #{n})`, whenever `work-backend` is `github-issues`, under either engine (a `local-files` record number is not a GitHub issue).
3. The `release-block` label added by a human to any record.

Every stamp targets a GitHub issue; under `work-backend: local-files` a filer stamps nothing and logs a SKIP (a local record number is not one).

## How a block clears

A block clears by one of two acts: close the record, or remove the label. No reason is required — this is the durable form of the old interactive "Proceed". A clearing comment is recommended, not required.

## The CLI

```
release-block.js check [--repo [host/]owner/name | --records-json <path>]
release-block.js stamp --record <n> (--finding "<category> at <file:line>|general" | --finding-file <path>) [--repo [host/]owner/name]
```

`check` prints one JSON line. Exit 1 carries `{"blocked":true,"records":[{"number":N,"title":"…","url":"…"}]}`, ascending by number; exit 0 carries `{"blocked":false,"records":[]}`. A missing label reads as none open. A list that fills `--limit 100` is truncated, so it is exit 3, never clear.

| `check` | Meaning |
|---|---|
| 0 | none open |
| 1 | blocked — at least one open record carries the label |
| 2 | usage error, or an unresolvable or refused repo |
| 3 | state unreadable — a failed call, malformed JSON, a row missing number/title/url, an unrecognised state, a full list, or gh absent without `--records-json` |

| `stamp` | Meaning |
|---|---|
| 0 | stamped or already stamped — `{"record":N,"outcome":"stamped"\|"already-stamped"}` |
| 2 | usage error, an unresolvable or refused repo, no such record, or a PR number |
| 3 | write failure or unreadable state; the label is added before the comment, so a comment failure leaves the label |

`--finding` is `<category> at <file:line>` or `<category> at general`, on one line. The location is the text after the last ` at `: `general`, or a file part that starts with a non-whitespace character, followed by `:` and one or more digits, optionally a range: `-` and one or more digits (`a.js:12-15`). The file part may contain spaces and colons. The category is non-blank with no trailing whitespace. The CLI rejects anything else (`isValidFinding`); the MCP `stamp` path applies the same rule before any write. `--finding-file <path>` takes the same one line from a file (one trailing line break allowed) and is the form a skill uses: a finding is review-derived text, and a shell would expand the `$(…)` or backtick a file name or category can carry in `--finding "…"`. The two flags are mutually exclusive, and an unreadable or malformed file is a usage error (exit 2).

### Stamp comment

```text
**Release block:** {finding}

Releases stop while this record is open and carries the `release-block` label. To clear the block, close this record or remove the label.
```

## What a release does while a block is open

This is the full Step 1.5 procedure; `/release` Step 4's re-read (`release/console.md`) runs it with a different stop point. **Step 1.5** stops before any review or suite work (before Step 2). **Step 4** has already run Step 3's review, so it stops before Step 5, before anything merges; its log lines say `Step 4` and end `Stopped before Step 5.` in place of `Stopped before Step 2.`

1. **Engine and work-backend check.** Read `engine` from Step 1's fact pack and `work-backend` as `release/console.md`'s Inputs reads it, neither re-detected. `local-merge` with `local-files` → log the `SKIP` line below; the release proceeds. `pr-first`, or `github-issues` under either engine → go on.
2. **Detect `gh`** with `command -v gh`, per `_shared/github-write-transport.md`'s Detection. This picks the transport, never the engine: `/release` Step 0's "do not ask whether `gh` is installed" is about the engine.
3. **gh present** → run `node "${CLAUDE_PLUGIN_ROOT}/bin/release-block.js" check`. **gh absent** → `## gh-absent (MCP) path`'s `check`, never the bash call. There is no new exit code: an unavailable transport is exit 3.

Route on the exit code:

- **0** → log the AUTO line and continue.
- **1** → stop at the step's stop point and print `release: blocked — {n} open release-block record(s): #{N} {title}[; #{M} {title}]. Close each record or remove its release-block label, then re-run.` Stage `release-held.md` through `node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "{run-dir}" --id release-held --file {composed .md file}`, using the existing schema: the gate (`release-block`), each record as `#N {title} {url}`, the effective version and its base (`n/a — {proposedVersion error}` when the pack has none), and the clearing act (close the record or remove the label). The outcome is `HELD` in every mode (reason `release-block — {n} open record(s)`), with no question, and `--allow-blocking` does not lift it. A Step 1.5 hold runs before Step 4 builds the shipped set, so Step 8's line reads `records: not computed (held at Step 1.5)`; a Step 4 hold keeps `records: {n} would ship`.
- **2 or 3** → stop and print `release: stopped — release-block state unreadable (exit {code}: {first stderr line})`, which Step 8 quotes verbatim as its `failed` error line. The outcome is `failed`, reason `release-block state unreadable`.
- **Any other exit, or exit 1 whose stdout is not the `{"blocked":true,…}` line** (a crash also exits 1) → treat it as exit 3: `failed`, `release-block state unreadable`, never `HELD` with no records.

Log through `log-decision.js --section "/release" --step "Step 1.5"`; the text never starts with the step name:

```
AUTO … — Step 1.5: release-block check: none open. Reversibility: n/a (read-only).
STAGED … — Step 1.5: HARD-GATE release-block — {n} open record(s) {#a, #b}; release held. Stage path: staged/release-held.md. Reversibility: high.
AUTO … — Step 1.5: release-block state unreadable — exit {code}: {stderr line}. Stopped before Step 2. Reversibility: n/a.
SKIP … — Step 1.5 release-block check (skipped): condition: engine local-merge (Step 1 fact pack) and work-backend local-files → fallback: no GitHub forge to read; release proceeds. Reversibility: n/a.
```

No autonomy ceiling lifts the block, and every firing re-runs `check` — a block cleared since the last firing is simply not there.

## gh-absent (MCP) path

Detection is per `_shared/github-write-transport.md`. The CLI never reaches MCP itself; the agent fetches and hands it a file.

**`check`:**

1. Run `list_issues` with labels `["release-block"]`, state open and `perPage: 100`.
2. Reshape each row to `{number, title, url, state}`.
3. Get the session-scoped path from `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value release-block-records.json` and write the array there with the Write tool.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/release-block.js" check --records-json {path}`. Its exit codes are the gh path's.
5. An unavailable or erroring `list_issues` is exit 3, without calling the CLI.

**`stamp`:**

1. Check the finding against the grammar under `## The CLI`; a bad one is the exit-2 equivalent, before any call.
2. `issue_read` in get mode. A missing issue or a PR is the exit-2 equivalent; an issue already carrying the label is a no-op.
3. `issue_write` in update mode with the full label array from `mergeLabelNames` (`_shared/github-write-transport.md`'s Full-replace hazard), then read the labels back.
4. If the label is absent, retry once. Still absent is the exit-3 equivalent. `label create` has no MCP row, so the label must already exist; create it with `gh` or the GitHub UI.
5. Once the label reads back, invalidate the snapshot per that file's Snapshot invalidation — whether or not the comment lands.
6. `add_issue_comment` with the fixed body above, composed from that literal. A comment failure leaves the label in place.

## What this does not stop

A manual tag, or merging release-please's PR by hand. This is accepted, per the design: the block gates `/claude-tweaks:release`, not the forge.
