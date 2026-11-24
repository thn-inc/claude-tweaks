---
name: station-event-producer-addition
description: Use when adding or changing a station-event producer (a plugin/bin CLI or library that appends a line to `.claude-tweaks/station-events.jsonl` when it moves a record through a transition), or adding a station, kind, lane, outcome, label mapping, driver-step mapping or release-reason rule to `plugin/bin/lib/station-events/stations.js`. Covers the registration set, the optional `deps.stationEvent` seam, the stable discriminator, emitting only on a transition that landed, and the failure-isolation proof. Keywords - station event, station-events.jsonl, appendStationEvent, stationEvent, stations.js, STATION, eventKey, discriminator, releaseTransition, transitionsForLabel, lane, FAIL_CLOSED_KEYS, producer, coverage gap.
---

# Station-event producer addition

## Overview

Program code writes a station event at the moment it makes a transition; no skill prose writes one. `docs/reference/station-events.md` is the reader's contract (line format, stations, the Producers table, Coverage gaps). This skill is the change-side checklist. The Coverage gaps section lists the transitions that have no producer yet (`express-lane.js`, the standard-lane merge, `accept:*` verdict labels; `bot:blocked`/`bot:parked` holds have producers since #6151), and each one is a future use of this skill.

## The registration set

| Site | What changes |
|---|---|
| `plugin/bin/lib/station-events/stations.js` | Any new station, kind, lane or outcome, a `LABEL_TRANSITIONS` row, a `DRIVER_STEP_STATIONS` entry, a release-reason pattern. It is the only file under `plugin/bin` that spells a station name. |
| The producer CLI's exported `realDeps` | `stationEvent: (e) => appendStationEvent(e)`, never wired only under `require.main === module`. |
| The producer's `run()` | Emits through `deps.stationEvent`. A native-dependency fetch uses `snapshotSinkOf(deps)` from `lib/station-events/blockers.js` as its `onSnapshot`, and wires `lastPayload: lastPayloadFromCwd` in its exported `realDeps` so an unchanged snapshot is not appended (a missing `lastPayload` means every snapshot appends, silently). |
| The producer's own test file | `assert.equal(typeof realDeps.stationEvent, 'function', 'stationEvent is wired')`, plus fake-emitter assertions. |
| `tests/bin-lib/station-events/failure-isolation.test.js` | A case for the new CLI. |
| `docs/reference/station-events.md` | A Producers row (kind, station, outcome, payload keys, discriminator), and the item removed from Coverage gaps. |

`tests/helpers/run-cli.js`'s `FAIL_CLOSED_KEYS` already lists `stationEvent`, so a `runCli` test that forgets a fake fails instead of appending to the developer's main-checkout file. A producer that names its seam differently adds that key there in the same change.

## Rules

1. **Name stations through `stations.js`.** Use `STATION.*`, `SESSION_BOUND_STATION`, `BLOCKER_SNAPSHOT_STATION`, `PR_OPENED_TRANSITION`, `releaseTransition(reason)` or `transitionsForLabel(label, direction)`. `tests/bin-lib/station-events/station-literal-conformance.test.js` fails on `station: 'build'` anywhere else under `plugin/bin`. Its header lists what it cannot see (a computed key, a name held in a local constant); those shapes are still wrong, just unpoliced.
2. **Optional seam, wrapped call.** An absent `deps.stationEvent` means no emission. Every call sits in its own try/catch, so a throwing emitter never changes stdout, the exit code or the CLI's envelope. `appendStationEvent` itself never throws and reports a drop as one stderr line; the wrap guards a fake or a later emitter.
3. **The discriminator is a value the caller already holds.** A claim's `claimedAt`, a run id, a driver line's `step@ts`, a PR number with its outcome. Never `Date.now()`: `eventKey` hashes the discriminator, and consumers dedupe on `eventKey`. Where an invocation has no stable id, the Producers row says what it uses instead (`apply-refine-labels.js` falls back to the invocation's start time, so a rerun keys differently).
4. **Emit only on a transition that landed.** `release-claim.js` emits for `released`, never `already-released`. `claim-targets.js` emits the `bot:in-progress` transition only after the label add succeeded, and not on a `--resume-pr` re-claim, which never left `build`. A shaping release emits nothing because `releaseTransition` returns `null` for it. The `planned` line is the stated exception: it is a fact of the claim, not of the label, so `claim-targets.js` writes it once per newly claimed record even when the label add failed (still never on a `--resume-pr` re-claim).
5. **The lane is passed, never inferred.** Write `'unknown'` unless the caller knows. `claim-targets.js` takes `--lane` and refuses a blank or unknown value with exit 2 rather than reading it as `unknown`.
6. **No skill prose names the file.** `tests/bin-lib/station-events/no-prose-logging.test.js` allows only `plugin/skills/init/bootstrap/step-04-gitignore-suggestions.md` to mention `station-events` under `plugin/skills`.

## Tests

- **Fake emitter.** Pass `stationEvent: (e) => seen.push(e)` and assert each event's `kind`, `station`, `outcome` and `discriminator`, and that stdout and the exit code equal a run with no `stationEvent`.
- **Failure isolation.** Add `[name, once, expectedEvents]` to the `cases` list in `failure-isolation.test.js`, with a `once(stationEventFor)` that runs the CLI with no emitter and with `realEmitterAt(root, stderr)` over `unwritableRoot()`. The shared test pins byte-identical stdout, the same exit code and one drop line per call. The driver's case lives in `tests/bin-lib/driver/run.test.js` beside its run harness.
- **Wiring.** The one-line `typeof realDeps.stationEvent` assertion per CLI is what goes red if the wiring is deleted.

## Anti-Patterns

| Pattern | Why it fails here |
|---|---|
| The real emitter wired only inside `if (require.main === module)` | Deleting it left every test green; #5902's whole-branch review found it and it cost a fix wave across six producers |
| `station: 'build'` at a call site | A station-name correction stops being a one-file change, and the conformance scan fails |
| A `Date.now()` discriminator | Every re-emit of the same fact gets a new `eventKey`, so consumers cannot dedupe |
| Emitting before the side effect lands | A failed label add or an `already-released` repeat records a transition that did not happen |
