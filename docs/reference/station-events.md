# station-events.jsonl — where a record is in its journey, as local facts

`station-events.jsonl` is an append-only log of station events: one JSON line each time claude-tweaks program code moves a record into, through or out of a station (intake, shape, authorize, release, build, test, review, polish, wrap-up, merge, accept). It is written locally, with no network call, no hub dependency and no policy key. A reader (the dispatch scoreboard) pairs the lines into station visits; the emitter only records facts.

The code is `plugin/bin/lib/station-events/emit.js` (`appendStationEvent`, `buildLine`, `eventKey`, `toRepoName`, `stationEventPath`, `realDeps`) and `plugin/bin/lib/station-events/stations.js` (every station, lane, kind, outcome and mapping name). Tests: `tests/bin-lib/station-events/emit.test.js`.

> **Unconfirmed names.** Station, label and driver-step names are unconfirmed against the design's Phase 0 fixtures. They live only in `stations.js`, so a correction is a one-file change; no call site spells a station itself.

## File location

`{main checkout}/.claude-tweaks/station-events.jsonl`, where the main checkout is resolved with `mainCheckoutRoot` (`plugin/bin/lib/hooks/worktree-detect.js`) from the caller's cwd. An emit from a linked worktree writes to the main checkout's file, never a copy inside the worktree. When no main checkout resolves, the event is dropped.

Each append is one `fs.appendFileSync` of a whole line (ending `\n`) inside `withLock` (`plugin/bin/lib/file-lock.js`) on the sibling lock directory `station-events.jsonl.lock`. The lock is fail-open: a lock timeout still appends. Both paths are gitignored. There is no rotation or compaction.

## Line format, v1

One object per line, with exactly these fields:

| Field | Value |
|-------|-------|
| `v` | `1` |
| `eventKey` | 32 lowercase hex chars; see below |
| `repoName` | `owner/name` (`toRepoName` turns a `[host/]owner/name` slug into it) |
| `recordNumber` | positive integer |
| `kind` | one of the kinds below |
| `station` | one of the stations above |
| `at` | ISO-8601 UTC, ends in `Z`; the caller's `at`, else the emit time |
| `outcome` | on `exited`, one of the outcomes below; `null` on every other kind |
| `lane` | one of the lanes below; `unknown` when the caller passes none |
| `sessionId` | string or `null` |
| `runId` | string or `null` |
| `payload` | object, `{}` by default |

### Kinds

`entered`, `started`, `exited`, `session_bound`, `blockers`.

`blockers` is an addition to the design's four kinds (`entered`, `started`, `exited`, `session_bound`); dispatch must accept it. A blocker snapshot is filed under station `authorize` (`BLOCKER_SNAPSHOT_STATION`, an unconfirmed reading).

### Outcomes

`passed`, `failed`, `returned`, `skipped`, `abandoned`. An `exited` event without one of these is refused.

### Lanes

`standard`, `express`, `driver`, `unknown`. The caller passes the lane; it is never inferred, and `unknown` is valid (a `/flow` claim happens before its express gate, so it carries `unknown`).

## eventKey and deduplication

`eventKey` is the first 32 hex chars of sha256 over `repoName|recordNumber|kind|station|outcome|runId|discriminator`, an absent field hashed as `''`. `discriminator` is a stable string the caller already holds (a claim's `claimedAt` or run id; a driver step's `step@ts`), never `Date.now`. `at` is not an input, so re-emitting the same fact yields the same key. **Consumers dedupe on `eventKey`.**

## Reading the events

- **Work segments vs visit boundaries.** `started` / `exited` events carrying `payload.step` are work segments (a driver step ran). Events carrying `payload.substep` are visit boundaries: at the merge station, `merge-ready` is `entered`, a `merge-confirm` that merged is `exited` `passed`, `merge-park` is `exited` `returned`. A `merge-confirm` whose detail starts with `armed` (auto-merge armed, not merged) is not a boundary, and `merge-call` is never mapped, because it also reports non-merges as `ok`. Pairing events into visits is the consumer's job: the dispatch scoreboard's `deriveVisits`, in `thn-inc/dispatch`, not this repo.
- **Driver session binding.** For a driver run both the claim and the worker write a `session_bound`: the claim's names the host session, the worker's names the worker session. For `lane: driver`, the worker's `session_bound` supersedes the claim's.
- **Resumed claim.** A `--resume-pr` re-claim writes a `session_bound` but no `bot:in-progress` transition, because the record never left `build`.

## Failure posture

`appendStationEvent` never throws and never changes its caller's outcome. It returns `{ written: true }`, or `{ written: false, reason }` with exactly one stderr line, when the identity is unresolvable (`repoName` not `owner/name`, `recordNumber` not a positive integer), a kind, station, outcome or lane falls outside its closed set, `discriminator` is missing, no main checkout resolves, or the write fails. Every call site emits through an optional `deps.stationEvent` inside its own try/catch.

## Coverage gaps

These transitions write no station event; the reconciler or a later record covers them:

- `accept-entry.js`'s `labels` subcommand only prints label edits that skill prose applies with `gh issue edit`, so no `accept:*` verdict label emits; the reconciler keeps those.
- A claim carries `lane: unknown` unless the caller passes `--lane` (only the driver passes `--lane driver`); later events carry the real lane.
- A release is emitted from `plugin/bin/release-claim.js` and `plugin/bin/accept-park.js`'s in-process release only, and only for a `released` result (an `already-released` repeat writes nothing). `reconcile`'s `release-merged.js` path calls the library directly and emits nothing.
- `bot:blocked` / `bot:parked` additions emit nothing: the emitter cannot know which station's visit they end.
- `express-lane.js` call paths emit nothing yet; `express` stays a valid lane.
- `ready` applied by `/specify` (skill prose, not program code) emits nothing.
- A standard-lane `gh pr merge` has no code emitter, so its merge-station exit is not recorded.
