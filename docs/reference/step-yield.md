# step-yield.json — what each step of a pipeline run produced

`step-yield.json` is a per-run fact pack: for every step of a run (`build`, `test`, `review`, …) it records the minutes the step took, the tokens and agents it spent, and what it yielded — commits, verify runs, decision-log entries by status, hook events, questions asked of the user, and the review's finding counters. It is derived from the run directory alone, with no model turn.

The code is `plugin/bin/lib/timing/step-yield.js` (`deriveStepYield`, `writeStepYield`, `KEY_PATHS`, `SCHEMA_VERSION`, `STEP_YIELD_FILE`). `tests/bin-lib/timing/step-yield-schema.test.js` pins this document to that code: every `KEY_PATHS` entry must appear below in backticks, every key the function emits must be a `KEY_PATHS` entry, and `tests/fixtures/step-yield/key-paths.golden.json` fixes the paths' types and nullability.

## Readers

- The dispatch scoreboard (unit 5.4 of `docs/superpowers/specs/2026-11-15-process-efficiency-design.md`), which lives in a separate repository and reads this file as its contract.
- The Phase 6 done criterion and Phase 7 of the same design, which read the review counters (`findings`) and the per-step cost.
- `plugin/bin/lib/review-lens/history.js` (#5998), which reads each closed run's per-lens counters as that lens's confirmed findings (`both` plus tiebreak `confirmed`, through its `confirmedCount`, which `tools/step-yield-report.js` also uses) for the lens history over the last 20 runs; a run's `lens-dispatch.json`, not this file, says which lenses ran.

## File location and when it is written

`{run-dir}/step-yield.json`, beside `timing.json`. It is written by `plugin/bin/lib/timing/at-close.js`, the one module every closing path already calls, so one call site covers all four:

1. `close-run` (the run's own close),
2. `teardown-run`,
3. the reconciler archive's synchronous write (archiving a merged run),
4. the background token pass (`bin/timing-at-close.js`), which rewrites the file once `timing.json` carries the transcript-derived tokens and `questions`.

Rules:

- The file is **rewritten whole** on every close (temp file in the run dir, then rename). An existing file never takes precedence, so the last close wins and the background token pass can improve on an earlier phase-only write.
- A failure while deriving or writing logs exactly one `SKIP` line (via `log-decision/timing-skip.js`) and never fails or stalls the close.
- The yield is derived and written **under the run dir's `.timing.lock`**, the lock the `timing.json` write takes, so a yield is never derived from a `timing.json` that a concurrent token pass is about to replace and then written after it. The lock is waited for `PHASE_LOCK_WAIT_MS` at most and never past the close's deadline; a lock not acquired **inside the bound** skips the yield and logs one `SKIP` (`step-yield.json lock not acquired within {n} ms`; a later close rewrites the file whole); a lock wait that spends the bound is reported as the next bullet says.
- The yield is written inside the close's own time bound (`TIMING_BOUND_MS`, from the start of the close): a close already past it derives nothing and logs one `SKIP` naming that bound (`close passed the {n} ms time bound before the step yield was derived`). A close logs at most **one** timing-family `SKIP` line. Whenever `step-yield.json` is not written (the bound ran out, a lock miss inside it, or a derive or write that threw), that one line says so: when the timing write logged a `SKIP` (a transcript read that ran out the bound, a timing lock wait that spent it), the suffix `; no step-yield.json written` is appended to it for the bound, and the yield's own condition text (`condition: … → fallback: no step-yield.json written`) for a lock miss or a throw; when it logged none, the yield's condition is the line.
- The write never creates the run directory and never strands a file in a vacated one. A write racing an archive that moved the directory **follows the archive twin once** (`{pipelines}/archive/{run-id}`) and writes there; when the run dir and its twin are both gone there is nowhere to log, so nothing is written and nothing is logged. A run dir whose `run-state.json` has already moved to the twin counts as vacated: `run-state.json` is checked again under the lock right before the write. The twin is followed only for a run dir that had a `run-state.json` when the write began, so an unrelated twin of the same name is never written.
- A multi-spec `spec-N` child run directory gets **no** `step-yield.json` (the same rule as `timing.json`). The parent's yield reads the parent `decisions.md` and every `spec-*/decisions.md` under it.
- Sources read: `timing.json` (when present), `decisions.md` and each `spec-*/decisions.md`, `events.jsonl`, `run-state.json`, and `manifest.yml` (`derivePhases` reads its multi-spec phase log to fill spans the events could not). Nothing else outside the run directory is read; transcript facts reach the yield only through `timing.json`.

## Top-level shape

`steps` is an array in phase order (the order `derivePhases` returns, keeping only phases that have a span). `unattributed` and each step share one bucket shape (the produced counts below). A source that does not exist sets its `sources.*` flag to `false`; a source that exists but cannot be read counts in the top-level `unparsed`, never as absent.

## Key paths

`[]` marks an array element. `<action>`, `<status>`, `<type>`, `<verdict>`, `<outcome>` and `<lens>` are key patterns, explained under the table. The bucket rows hold for `steps[]` (one object per step) and for `unattributed` (the same shape, for what no step span holds); both paths are listed on one row.

### Run

| Path | Type | Source and when `null` |
|---|---|---|
| `schemaVersion` | number | `SCHEMA_VERSION` (1). |
| `runDir` | string | The run directory the yield was derived from. |
| `generatedAt` | string | ISO time of the derivation. |
| `sources.timing` | boolean | `timing.json` was present and an object. |
| `sources.decisions` | boolean | At least one `decisions.md` was present. |
| `sources.events` | boolean | `events.jsonl` was present. |
| `sources.runState` | boolean | `run-state.json` was present and an object. |
| `sources.questions` | string, nullable | `"timing.json"` when `timing.json` carries a `questions` array; `null` otherwise (the wait times then cannot be computed). |
| `unparsed.count` | number | Source files that could not be read or parsed, and malformed `events.jsonl` lines: invalid JSON, a line that parses but is not an object (an array, a number, `null`), or an event without a string `type` and a parseable `ts`. |
| `unparsed.samples[]` | string | Up to 5 samples, each truncated to 200 characters. |

### Step

| Path | Type | Source and when `null` |
|---|---|---|
| `steps[].phase` | string | The phase name from `derivePhases`. |
| `steps[].start` | string, nullable | ISO start of the phase's span; `null` when the span has no recorded instant. |
| `steps[].end` | string, nullable | ISO end of the span; `null` when the span has none. |
| `steps[].minutes` | number | From `derivePhases` spans. **Always a number, never `null`.** |
| `steps[].ownMinutes` | number | From `derivePhases` spans. **Always a number, never `null`.** |
| `steps[].tokens` | object, nullable | `timing.json`'s per-phase tokens; `null` when `timing.json` is absent, carries no token totals, or has no row for the phase. |
| `steps[].tokens.input` | number, nullable | `null` when `timing.json`'s row lacks the field. |
| `steps[].tokens.output` | number, nullable | As above. |
| `steps[].tokens.cacheRead` | number, nullable | As above. |
| `steps[].tokens.cacheCreate` | number, nullable | As above. |
| `steps[].agents` | number, nullable | `timing.json`'s subagent count for the phase; `null` when there is no source. |

**A cost field with no source is `null`, never `0`.** The cost fields are `tokens` and `agents` (transcript-derived). `minutes` and `ownMinutes` come from the `derivePhases` spans and are always numbers.

### Produced counts (per step and unattributed)

| Path | Type | Source and when `null` |
|---|---|---|
| `steps[].commits.<action>` / `unattributed.commits.<action>` | number | `commit` events by their `action` (`unknown` when an event has none). Only actions seen are keys. |
| `steps[].verify.runs` / `unattributed.verify.runs` | number | `verify` events counted for the bucket. |
| `steps[].verify.pass` / `unattributed.verify.pass` | number | Of those, `pass: true`. |
| `steps[].verify.fail` / `unattributed.verify.fail` | number | Of those, `pass: false`. |
| `steps[].verify.unknown` / `unattributed.verify.unknown` | number | Of those, no boolean `pass`. |
| `steps[].decisions.<status>` / `unattributed.decisions.<status>` | number | Decision-log lines by status. Every status key is present, `0` when none. |
| `steps[].events.<type>` / `unattributed.events.<type>` | number | Every well-formed event (object with a string `type` and a parseable `ts`) by `type`. Only types seen are keys. |
| `steps[].questions[].question` / `unattributed.questions[].question` | string | The question text(s), joined with ` / `: the `ask-user-question` event's, or the transcript ask's for a question no event answered. |
| `steps[].questions[].askedAt` / `unattributed.questions[].askedAt` | string, nullable | ISO ask time from the transcript; `null` when the event could not be joined to a transcript ask. |
| `steps[].questions[].answeredAt` / `unattributed.questions[].answeredAt` | string, nullable | The event's `ts` (the answer); for a transcript ask no event answered, the transcript's own answer time, `null` when it has none. |
| `steps[].questions[].waitedMinutes` / `unattributed.questions[].waitedMinutes` | number, nullable | Answer minus ask, in minutes to one decimal; `null` when not joined, when the answer precedes the ask, or for an asked question with no recorded answer event. |
| `steps[].questions[].askSource` / `unattributed.questions[].askSource` | string, nullable | `toolUseId` or `questionText` (the join that found the ask), or `transcript` (an ask no event answered); `null` when an event was not joined. |
| `steps[].findings` / `unattributed.findings` | object, nullable | The review counters; `null` for a bucket with no pair or tiebreak line. |
| `steps[].findings.raised` / `unattributed.findings.raised` | number | `both + one`. |
| `steps[].findings.both` / `unattributed.findings.both` | number | Findings both reviewers reported. |
| `steps[].findings.one` / `unattributed.findings.one` | number | Findings one reviewer reported. |
| `steps[].findings.relabeled` / `unattributed.findings.relabeled` | number | Findings already counted that changed label (adds to no finding count). |
| `steps[].findings.tiebreak.byVerdict.<verdict>` / `unattributed.findings.tiebreak.byVerdict.<verdict>` | number | Tiebreak lines by verdict; every verdict key present. |
| `steps[].findings.tiebreak.byOutcome.<outcome>` / `unattributed.findings.tiebreak.byOutcome.<outcome>` | number | Tiebreak lines by outcome; every outcome key present. |
| `steps[].findings.byLens.<lens>.raised` / `unattributed.findings.byLens.<lens>.raised` | number | The same counters, split by lens. |
| `steps[].findings.byLens.<lens>.both` / `unattributed.findings.byLens.<lens>.both` | number | As above. |
| `steps[].findings.byLens.<lens>.one` / `unattributed.findings.byLens.<lens>.one` | number | As above. |
| `steps[].findings.byLens.<lens>.relabeled` / `unattributed.findings.byLens.<lens>.relabeled` | number | As above. |
| `steps[].findings.byLens.<lens>.tiebreak.byVerdict.<verdict>` / `unattributed.findings.byLens.<lens>.tiebreak.byVerdict.<verdict>` | number | As above. |
| `steps[].findings.byLens.<lens>.tiebreak.byOutcome.<outcome>` / `unattributed.findings.byLens.<lens>.tiebreak.byOutcome.<outcome>` | number | As above. |
| `steps[].unparsed.count` / `unattributed.unparsed.count` | number | Decision-file lines no reader recognised, for the bucket. |
| `steps[].unparsed.samples[]` / `unattributed.unparsed.samples[]` | string | Up to 5 raw lines, each truncated to 200 characters. |

### Key patterns

- `<status>` is every status in `DECISION_STATUSES`, defined once in `plugin/bin/lib/log-decision/append.js` as `[...STATUSES, 'FAILED']` and re-exported by `plugin/bin/lib/calibration/decisions-classifier.js` (whose lenient `KIND_RE`, the one the yield reads through, is built from it). That list is the source: today `AUTO`, `STAGED`, `KEPT-PROMPT`, `SCANNED`, `REFUSED`, `SKIP`, `FAILED`. `FAILED` is a read-only historical status that `log-decision.js` never writes. A new status appears here by editing that one list.
- `<verdict>` is `confirmed`, `refuted`, `cant-tell`, `unsettled`. `<outcome>` is `confirmed`, `drop`, `digest`, `console`, `none`.
- `<lens>` is the lens id the line names (`3a`, `3f`, …). `unknown` is the lens of a `judge: none` line that names none.
- `<action>` and `<type>` are open: the commit event's `action` and the event's `type`.

## What is counted where

### Nothing is dropped silently

A decision-file line that is a log entry but that no reader recognises counts under its step's `unparsed` (`{ count, samples }`, samples at most 5, each the raw line truncated to 200 characters). A line whose time cannot be placed goes to the top-level `unattributed` bucket, which has the same shape as a step. The Manifesto's `Pipeline config snapshot:` block and its `- key: value` bullets are structural, never `unparsed`. A line mentioning `Reproduction:` or `Tiebreak tiebreak:` that no reader matches counts as `unparsed` in its step.

**Reading of "an unrecognised line is not counted" (AC2).** A review-marked line no reader matches is still a status line: it keeps its count in `decisions.<status>` (an `AUTO` line is one `AUTO` decision) and is `unparsed` **only as a review line**. No finding, tiebreak or other counter includes it. A line that is not a log entry at all (no status head) is `unparsed` with no `decisions` count.

The yield module holds no regex or delimiter for a log line. The patterns live in `append.js` (`parseEntry`), `console/resolve.js` (`parseTiebreakLine`), `timing/pair-lines.js` (including `entryLine` and `isJudgeNone`) and `calibration/decisions-classifier.js`.

**The yield reads status lines leniently, as an opt-in beside the calibration reader.** `calibration/decisions-classifier.js` keeps `classifyDecisionLine` exactly as it was before the yield (a dashed status line only), so `calibration/aggregate.js`'s counts over archived runs do not move. The yield alone calls the added `classifyDecisionLineLenient` (dash after the status optional, whitespace required after the status so `AUTO-merge was declined` is prose), plus `entryClock` and `isStructuralLine`.

### Attribution: which step owns a time

A decision line or an event belongs to the step whose span holds its instant, via `phaseAt` over the rows `derivePhases` (`plugin/bin/lib/timing/derive.js`) returns. **The dispatch scoreboard's per-step numbers depend on `derivePhases`**: a change to how phases are derived moves numbers in this file.

- **An instant that ends a span belongs to that span.** `phaseAt`'s rule is half-open, `[start, end)`; when no span holds an instant but it is exactly where a span ends (the merge commit ends the `merge` span, the terminal `close-run` ends the last one), the yield attributes it to the innermost span ending there (shortest span, ties to the later start). `derivePhases` itself, and so the token join, is untouched.
- **A `verify` event's `events` count follows its `verify` count.** `verify[]` is attributed by `derivePhases`' closed interval (an event on a span's end counts there); the same owner is used for `events.verify`, so `events.verify` equals `verify.runs` in every bucket.
- Attribution is **per occurrence**. Each phase row carries `spans` (one entry per occurrence of the skill) and `phaseAt` picks the innermost single occurrence span that holds the instant, not the row's overall start and end. A row's overall span can overlap another phase it was interleaved with, so the row span would misattribute.
- An open-ended re-entry (a wrap-up re-run, whose span has no end yet) can therefore outrank a longer enclosing merge span: the innermost occurrence wins.
- Pre-flight lines written before the first `skill_invoked` event hold no span and land in `unattributed`.
- A run with no `events.jsonl`, or an empty one, has `steps: []` and every decision line in `unattributed`; nothing throws.
- A `verify` event no row took counts under `unattributed.verify`.

### Decision-line time reconstruction

A decision line's time is local `HH:MM:SS` (the writer's `hms` in `append.js` uses local `getHours`), while an event's `ts` is ISO UTC. The yield places a line on a calendar day within the run window (`run-timing.js`'s `runWindow`, widened by 10 minutes each side), in the reading process's local timezone.

- Placement is **section-monotone**: entries are appended to a `## ` section in write order, so within a section a local clock never lands before the section's previous placed line. A section's first line takes the earliest instant that fits the window. This puts a line written just before local midnight on the right day in a run that crosses midnight, and keeps a multi-day archived run in order. A hand-reordered section misplaces its lines.
- A line already carrying an ISO clock uses it as is.
- **Limit: this assumes reader TZ = writer TZ.** A yield derived in another timezone than the one the lines were written in (an archive read on a different machine setting) mis-places lines by the offset; a line that then fits no day in the window goes to `unattributed`.

### Questions: `waitedMinutes`

Each `ask-user-question` event (the answer, written by the PostToolUse hook) becomes one `questions[]` entry in a step. The ask time comes from `timing.json`'s top-level `questions` array, derived from the transcript's `AskUserQuestion` `tool_use` / `tool_result` rows by the timing writer (no new hook surface, no transcript read here).

- Join order: the event's `toolUseId` matches a transcript ask's `id` exactly (`askSource: "toolUseId"`); an event with none (older runs) falls back to the first question's text, taking the latest unused ask at or before the answer (`askSource: "questionText"`); otherwise there is no ask time (`askedAt`, `waitedMinutes` and `askSource` are `null`). A transcript ask is joined to at most one event, so two asks with identical question text never share one.
- The entry sits in the step whose span holds the ask time; **a known ask time that no span holds falls back to the answer time's step**.
- **An asked question with no recorded answer is still emitted.** Every transcript ask no event joined becomes one `questions[]` entry placed by its ask time (`unattributed` when no span holds it), with `askedAt` set, `answeredAt` the transcript's own answer time when it has one else `null`, `waitedMinutes: null` and `askSource: "transcript"`. A transcript ask is never emitted twice and never dropped.
- **Limits:** a run whose `timing.json` has no `questions` key (no transcript read yet, the transcript gone, or `timing.json` written before the key existed) has `waitedMinutes: null` and `sources.questions: null`. The archive path's synchronous write has no wait times until the background token pass writes `timing.json` and rewrites the yield. Only the main transcript is read: an ask made inside a subagent transcript has no ask time.

## Review counters

### Pair lines

A review-marked decision line is a `Reproduction:` pair line. Seven forms are composed by `plugin/bin/lib/reproduction-log.js` and written by `review-coordination.js categorise-reproduction --run` and `log-reproduction-judgment` (#5595); the agent writes one form from the template in `plugin/skills/review/step3-tier-variants.md`. `plugin/bin/lib/timing/pair-lines.js`'s `PAIR_FORMS` is the reader and the source for this table; `tests/bin-lib/timing/pair-lines.test.js` pins the seven composed forms to the composer and the eighth to its prose template.

| Form (`PAIR_FORMS` id) | Template head | both | one | relabel |
|---|---|---|---|---|
| `reproduced` | `… finding {path}:{line} reproduced. Confirmed.` | +1 | 0 | 0 |
| `reproduced-severity-contested` | `… reproduced, severity contested (took the lower of the two). Confirmed.` | +1 | 0 | 0 |
| `not-reproduced` | `… not reproduced. Staged to Review Console as low-confidence.` | 0 | +1 | 0 |
| `absence-refuted` | `… absence claim {path}:{symbol} refuted by ground-truth check (…). Not staged.` | 0 | +1 | 0 |
| `vacuity-downgraded` | `lens "3f" vacuity finding … downgraded to unconfirmed …` | 0 | 0 | +1 |
| `vacuity-reconfirmed` | `lens "3f" vacuity finding … re-confirmed by executed run: …` | 0 | +1 | 0 |
| `single-read-coverage` | `… {session limit twice \| unavailable \| timed out \| blocked: {reason} \| needs-context: {reason}}; single-read coverage.` | 0 | 0 | 0 |
| `coincidence` | `… findings {path}:{lineA} / {path}:{lineB} share a location but not substance; both staged unconfirmed.` | 0 | +2 | 0 |

`raised = both + one`. A relabel adds to no finding count. A `vacuity-downgraded` line relabels a finding already counted and adds none. `vacuity-reconfirmed` counts one `+1` as the spec says; **a finding that was reproduced, downgraded and then re-confirmed therefore counts in both `both` and `one`.** `single-read-coverage` is a coverage notice; its findings are counted by their own `not-reproduced` lines. The six spec forms are these rows with `reproduced-severity-contested` folded into `reproduced`.

**Archived wording.** Runs archived before the templates were pinned carry the same lines in wording no live template produces. `pair-lines.js` reads it, found by measuring the archive with `tools/step-yield-report.js`:

- **The label before `Reproduction:` is one of an allow-list**, the writer labels measured in the archive (a census of the label before every classified `Reproduction:`): none, `log-decision:`, `Step 3` (with or without a colon, `Step 3 reproduction:`, `Step 3 (reproduction):`, `Step 3 lens {id}:`), `Delta`, `Delta-2`, `Delta review`, a doubled `Reproduction:`, each optionally behind `spec #N — ` or `spec #N: `. A label outside the list (`wrap-up: carried forward from review`, `Step 3 Routing:`, a dispatch notice that merely mentions a reproduction pair, a Review Console restatement) marks a quoted or carried line, not a new finding: it is not a pair line and, being review-marked, counts as `unparsed`. The status head is read as the archive spelled it (a bullet or none, a time with or without seconds or a date, an em dash or a hyphen): that is the writer's clock, not a label.
- Every `PAIR_FORMS` form also carries looser patterns, each built on one `path:line` location (no whitespace) and one verdict: a writer label that does not end in a colon (`Delta Reproduction:`), a `Reproduction: delta:` or `Reproduction: #4169:` tag, an unquoted lens, a lens label after the id (`3b (Security)`, keyed by the leading id `3b`), a parenthetical on the location or after the verdict, a `Stage path:` clause, the writer's own `Reversibility:` tail repeated, a status line with no time, and agent commentary after `reproduced. Confirmed` or `not reproduced`. Commentary is accepted only after a delimiter (`;`, `,`, ` —` or ` (` after `Confirmed`; `;` or a one-level parenthesis after `not reproduced`) with content after it, and only when it holds no second verdict (`reproduced`, `not reproduced`, `elevated via`), no second `Reproduction:` and no `finding(s)` word. **A line naming more than one finding, more than one lens or more than one verdict is not a pair line: it stays `unparsed`** (a count must not be guessed). A bare truncation (`… reproduced. Confirmed.`, `… not reproduced;`) and a bare tail (`… Reversibility: high. extra`) stay `unparsed` too. A review-marked line over 2,000 characters is read only by the pinned templates and counts as `unparsed` (the longest real one is 1,355), which bounds the cost of every legacy pattern.
- `LEGACY_FORMS`, line shapes no current template produces. They are pinned by real archived lines in `tests/bin-lib/timing/pair-lines.test.js`, not to prose:

| Form (`LEGACY_FORMS` id) | Line | both | one | relabel |
|---|---|---|---|---|
| `direct-verification-elevated` | `… finding {path}:{line} elevated via direct-verification override (…). Confirmed.` — a finding the controller confirmed by reading the source | 0 | 0 | +1 |
| `no-findings` | `… lens "{lens}" both agents returned No findings.` | 0 | 0 | 0 |
| `console-disposition` | `Review Console: Console item decision:… (Low-confidence findings): keep-staged — …` — the console's restatement of an already-staged finding; it adds nothing and creates no `findings` object | 0 | 0 | 0 |

`direct-verification-elevated` is a relabel: an elevation changes the confidence of a finding a pair line already counted, so it adds to no finding count. (In the archive only 23 of 267 such lines sit beside a `not reproduced` line for the same location; the rest elevate a finding that has no pair line of its own, which therefore does not appear in `raised`. That undercount is accepted over guessing.) A line naming a count of findings (`5 unconfirmed findings staged …`) or several findings with no per-finding verdict is not classified and stays `unparsed`.

Pair-line patterns are **additive**: a reworded template adds a pattern to its form, never replaces one, so archived runs keep parsing. Since #5595 (Phase 6 of `docs/superpowers/specs/2026-11-15-process-efficiency-design.md`) `categorise-reproduction --run` and `log-reproduction-judgment` write the pair lines, so this reader (`pair-lines.js`) and its test follow that writer: each composed form is pinned to `reproduction-log.js`, not to prose.

### Tiebreak lines

A `Tiebreak tiebreak:` line is written by `tiebreak.js` and parsed by `console/resolve.js`'s `parseTiebreakLine`. The kind maps to a verdict and an outcome:

| `parseTiebreakLine` kind | verdict | outcome |
|---|---|---|
| `confirmed` | `confirmed` | `confirmed` |
| `dropped` | `refuted` | `drop` |
| `console` | `cant-tell` when the reason is `verdict:cant-tell`, else `unsettled` | `console` |
| `digested` | `cant-tell` when the reason is `verdict:cant-tell`, else `unsettled` | `digest` |

`unsettled` means the judge's verdict is not on the line. A review-marked line containing the literal token `judge: none` (`JUDGE_NONE` in `pair-lines.js`) counts outcome `none`. It is checked **before** `parseTiebreakLine`, so it counts even when that parser rejects the line's shape; its verdict is the parsed one when the parser accepts it, else `unsettled`. The token is matched only **before** the line's first ` Evidence: `: quoted evidence is never a judge token. A `judge: none` line with no lens of its own counts under `byLens.unknown`.

The review counters live on whichever step the lines attribute to (normally `review`), as that step's `findings`; a step with no pair or tiebreak line has `findings: null`.

## Compatibility

A field is added, never renamed. Adding a key to the file means adding it to `KEY_PATHS`, to this document and to `tests/fixtures/step-yield/key-paths.golden.json` in the same change. Removing a key, or changing a path's type or nullability, requires a `schemaVersion` bump (`SCHEMA_VERSION`) and a note here. Current version: 1; no earlier version has been released.
