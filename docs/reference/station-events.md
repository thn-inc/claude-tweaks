# station-events.jsonl — where a record is in its journey, as local facts

`station-events.jsonl` is an append-only log of station events: one JSON line each time claude-tweaks program code moves a record into, through or out of a station (intake, shape, authorize, release, build, test, review, polish, wrap-up, merge, accept). It is written locally, with no network call, no hub dependency and no policy key. A reader (the dispatch scoreboard) pairs the lines into station visits; the emitter only records facts.

The code is `plugin/bin/lib/station-events/emit.js` (`appendStationEvent`, `buildLine`, `eventKey`, `toRepoName`, `stationEventPath`) and `plugin/bin/lib/station-events/stations.js` (every station, lane, kind, outcome and mapping name). Tests: `tests/bin-lib/station-events/emit.test.js`.

> **Unconfirmed names.** Station, label and driver-step names are unconfirmed against the design's Phase 0 fixtures. "The design" is the factory floor design, `docs/superpowers/specs/2026-11-18-factory-floor-design.md` in the `thn-inc/dispatch` repository (dispatch PR #1894): its "The ledger: station events" section and its station registry table. They live only in `stations.js`, so a correction is a one-file change; no call site under `plugin/bin` spells a station itself (`tests/bin-lib/station-events/station-literal-conformance.test.js` fails when one does).

## Stations

In journey order (`STATION` in `stations.js`). Each line is the reading this repo's emitter uses, not a definition the design pins.

- `intake`: the record exists but is not yet shaped; exited when `needs:definition` is removed or `ready` is added.
- `shape`: `/specify` turns the record into spec shape; exited `passed` when `ready` is added.
- `authorize`: `ready`, waiting for a human or policy to authorize the build; entered when `ready` is added, exited `passed` when `auto:build` is added. A blocker snapshot is filed here (`blockers`) because blocker state decides whether an authorized record can be released to build; an unconfirmed reading.
- `release`: the authorized-but-unclaimed wait: entered when `auto:build` is added, exited `passed` when `bot:in-progress` is added (the claim lands). Distinct from a claim release, which exits `build`.
- `build`: the record is claimed (`bot:in-progress`) and being built; a claim, its bound sessions, the draft-PR fact, the driver `worker` step and every claim release land here.
- `test`: the driver's `test` step.
- `review`: the driver's `review` step.
- `polish`: named by the design; no producer writes it today.
- `wrap-up`: the driver's `pr` step. Opening the PR is the driver's wrap-up step, and the design has no separate PR station; an unconfirmed reading.
- `merge`: the driver's `ci` and `merge` steps and the merge sub-steps (`merge-ready`, `merge-confirm`, `merge-park`).
- `accept`: the record awaits local acceptance; entered when `accept:pending` is added.

## File location

`{main checkout}/.claude-tweaks/station-events.jsonl`, where the main checkout is resolved with `mainCheckoutRoot` (`plugin/bin/lib/hooks/worktree-detect.js`) from the caller's cwd. An emit from a linked worktree writes to the main checkout's file, never a copy inside the worktree. When no main checkout resolves, the event is dropped.

Each append is one `fs.appendFileSync` of a whole line (ending `\n`) inside `withLock` (`plugin/bin/lib/file-lock.js`) on the sibling lock directory `station-events.jsonl.lock`. The lock is fail-open: a lock timeout still appends. There is no rotation or compaction.

Each append first makes sure `{main checkout}/.git/info/exclude` lists both paths (`ensureLocalExclude`, `EXCLUDE_ENTRIES`), so a project whose `.gitignore` lacks them still reads clean to `git status --porcelain` and reconcile's mirror (#5957). `/init`'s `.gitignore` rows remain as belt-and-braces. `info/exclude` lives in the git common dir, so linked worktrees share it. The path deliberately stays put: the dispatch scoreboard reads it (#5951), and moving it would be a cross-repo contract change.

Two limits. `info/exclude` hides only an untracked file, so a log already tracked in a project's index would still dirty it; none is expected, because #5902's emitters had not reached a release when this exclude landed (#5957). A checkout that does track it untracks it with `git rm --cached .claude-tweaks/station-events.jsonl`. And when `{main checkout}/.git` is a file rather than a directory (a submodule, or a `--separate-git-dir` checkout), `mainCheckoutRoot` resolves no main checkout there, so `appendStationEvent` drops the event with its one stderr line and writes nothing. `ensureLocalExclude`'s non-directory `.git` guard only matters for an injected `mainRoot`.

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

`standard`, `express`, `driver`, `unknown`. The caller passes the lane; it is never inferred, and `unknown` is valid (a `/flow` claim happens before its express gate, so it carries `unknown`). Only two producers write a lane other than `unknown` today: the driver mirror (`driver`) and `claim-targets.js` when its caller passes `--lane` (the driver passes `--lane driver`; every other caller omits it). `standard` and `express` are valid values that no producer writes yet.

## eventKey and deduplication

`eventKey` is the first 32 hex chars of sha256 over `repoName|recordNumber|kind|station|outcome|runId|discriminator`, an absent field hashed as `''`. `discriminator` is a stable string the caller already holds (a claim's `claimedAt` or run id; a driver step's `step@ts`), never `Date.now`. `at` is not an input, so re-emitting the same fact yields the same key. **Consumers dedupe on `eventKey`.**

## Producers

Every event comes from program code at the moment it makes the transition; no skill prose writes one. Each row names the discriminator (the `eventKey` input that tells two facts apart; see above). Lane is `unknown` unless the row says otherwise.

| Producer | Kind | Station | Outcome | Payload keys | Discriminator |
|----------|------|---------|---------|--------------|---------------|
| `claim-targets.js` (`lib/claim-targets/claim-targets.js`), per newly claimed record | `session_bound` | `build` | none | `{}`; `sessionId` is `CLAUDE_CODE_SESSION_ID`, none written when it is unset or empty; `runId` is `--run-id`; lane is `--lane` | the claim's `claimedAt` |
| same, when the `bot:in-progress` label add succeeded (not on a `--resume-pr` re-claim) | `exited`, then `entered` | `release` (`passed`), then `build` | `passed` on the `release` exit | `{}` | `{claimedAt}:{kind}:{station}` |
| same, rollback: a group claim aborts and releases a record this run claimed | `exited` | `build` | `abandoned` (reason `never-started: file-overlap group partial claim`) | `reason` | `{claimedAt}:abort` |
| `release-claim.js`, only for a `released` result | `exited` | `build` | by reason, see below | `reason`, `link` (`null` when none); on `--sweep` also `sweptBy` (the sweeper's run id) and `sweptBySession` (when set). A sweep is written under the holder's `runId` with `sessionId` null | `release:{runId}:{claimedAt}`; `claimedAt` is the released claim's own, so a re-claim by the same run keys differently |
| `accept-park.js` (`park`), packet posted or `accept:pending` added | `entered` | `accept` | none | `label` (`accept:pending`) | `accept-pending:{record}:{runId}` |
| same, in-process claim release, only for a `released` result | `exited` | `build` | `passed` (reason `awaiting-local-acceptance`: build hands forward into accept) | `reason` | `release:{runId}:{claimedAt}` |
| `pr-early-open.js`, a PR it opened or reopened, one event per record in `--fixes` (a reused PR or a degrade writes nothing) | `started` | `build` | none | `fact` (`pr_opened`), `prNumber`, `prUrl`, `outcome` (`opened` or `reopened`). No `step`, no `substep` | `pr:{number}:{outcome}` |
| `apply-refine-labels.js`, after a successful label edit | the row's kind per `LABEL_TRANSITIONS` (`needs:definition` removed, `ready`, `auto:build`, `bot:in-progress`, `accept:pending` added) | the row's station | the row's outcome on an `exited` | `label`, `direction` (`added` or `removed`); a transition one action would record twice (`ready` plus a `needs:definition` removal both exit `intake`) is written once | `refine:{issue}:{direction}:{label}:{run id, else the invocation's start time}` |
| driver mirror (`lib/station-events/driver-mirror.js`), step lines `worker`, `test`, `review`, `pr`, `ci`, `merge`; lane `driver` | `started` then `exited` | `build`, `test`, `review`, `wrap-up`, `merge`, `merge` | `ok` is `passed`, `fail` is `failed`, `stop` is `returned` | `step` | `{step}@{ts}`; `started` carries `at` = line time minus `ms` |
| same, a `worker` line with `fix: true` (the review fix round's own relaunch line, #5942) | none | none | none | none | none |
| same, worker line with a `sessionId`, review line with a `fixSessionId` | `session_bound` | `build` | none | `step`; `fix: true` on the review fix session | `{step}@{ts}` |
| same, merge sub-steps (see Reading the events) | `entered` / `exited` | `merge` | `merge-confirm` `passed`, `merge-park` `returned` | `substep` | `{step}@{ts}` |
| `resolve-blockers.js` and `preflight-records.js` (native-dependency fetch), one per fetched record per call | `blockers` | `authorize` | none | `blockedBy`, `openBlockerIds`, `crossRepoBlockers` (`[]` when none), `fetchedAt`; `sessionId` is `CLAUDE_CODE_SESSION_ID`, `runId` is always `null` | `fetchedAt` |

### Release reasons to outcomes

`exited build` takes its outcome from the release reason (`outcomeForReleaseReason` in `stations.js`; an unrecognised reason is `returned`):

| Reason | Outcome |
|--------|---------|
| `merged…`, `pr-opened…`, `awaiting-local-acceptance`, `drive.js settle: pending-review at …` | `passed` |
| `abandoned…`, `never-started…`, `swept: …`, `drive.js settle: refused at …` | `abandoned` |
| `failed…` (a gate), `drive.js settle: blocked at …` | `failed` |
| `drive.js settle: express-escalated at …`, anything else | `returned` |

A shaping release (`shaped: #n`, `routed: needs:definition #n`, `failed: shaping`) is no transition and writes no event.

### The `pr_opened` event is a point fact

`pr-early-open.js`'s `started build` carries `payload.fact: 'pr_opened'` and no `payload.step`. It marks the moment the draft PR exists; it has no `exited` pair, so under the rule below it is neither a work segment nor a visit boundary, and a reader must not wait for one.

## Reading the events

- **Work segments vs visit boundaries.** `started` / `exited` events carrying `payload.step` are work segments (a driver step ran). Events carrying `payload.substep` are visit boundaries: at the merge station, `merge-ready` is `entered`, a `merge-confirm` that merged is `exited` `passed`, `merge-park` is `exited` `returned`. A `merge-confirm` whose detail starts with `armed` (auto-merge armed, not merged) is not a boundary, and `merge-call` is never mapped, because it also reports non-merges as `ok`. Pairing events into visits is the consumer's job: the dispatch scoreboard's `deriveVisits`, in `thn-inc/dispatch`, not this repo.
- **Driver session binding.** For a driver run both the claim and the worker write a `session_bound`: the claim's names the host session, the worker's names the worker session. For `lane: driver`, the worker's `session_bound` supersedes the claim's.
- **Resumed claim.** A `--resume-pr` re-claim writes a `session_bound` but no `bot:in-progress` transition, because the record never left `build`.

## Failure posture

`appendStationEvent` never throws and never changes its caller's outcome. It returns `{ written: true }`, or `{ written: false, reason }` with exactly one stderr line, when the identity is unresolvable (`repoName` not `owner/name`, `recordNumber` not a positive integer), a kind, station, outcome or lane falls outside its closed set, `discriminator` is missing, no main checkout resolves, or the write fails. Every call site emits through an optional `deps.stationEvent` inside its own try/catch.

## Coverage gaps

These transitions write no station event; the reconciler or a later record covers them:

- `accept-entry.js`'s `labels` subcommand only prints label edits that skill prose applies with `gh issue edit`, so no `accept:*` verdict label emits; the reconciler keeps those.
- Every producer except the driver mirror and a `claim-targets.js` run given `--lane` writes lane `unknown`: `release-claim.js`, `accept-park.js`, `pr-early-open.js`, `apply-refine-labels.js` and the blocker snapshot hardcode it, so a release or PR event of a driver run also carries `unknown`. `standard` and `express` are never written. `--lane` is accepted by `claim-targets.js` only; the driver is its one caller that passes it (`--lane driver`).
- A release is emitted from `plugin/bin/release-claim.js` and `plugin/bin/accept-park.js`'s in-process release only, and only for a `released` result (an `already-released` repeat writes nothing). A shaping claim's release (`shaped: #n`, `routed: needs:definition #n`, `failed: shaping`) writes nothing: it never entered build, and the shape station has no `entered` producer to pair an exit with. `reconcile`'s `release-merged.js` path calls the library directly and emits nothing.
- `plugin/bin/repair-claim.js` (`plugin/bin/lib/repair-claim/repair.js`) force-releases (`release` mode) or re-claims (`reclaim` mode) through the release library's helpers and emits nothing. It acts on an unreadable claim blob, so there is no readable `claimedAt` for the claim being repaired to key an event on.
- `bot:blocked` / `bot:parked` additions emit nothing: the emitter cannot know which station's visit they end.
- A driver worker launch refused for want of a model (#5917, `docs/driver.md`'s Worker models) writes no `worker` line, so the mirror emits no `build` segment for it; the record's stop reaches only the driver's final line.
- `express-lane.js` call paths emit nothing yet; `express` stays a valid lane.
- `ready` applied by `/specify` (skill prose, not program code) emits nothing.
- A standard-lane `gh pr merge` has no code emitter, so its merge-station exit is not recorded.
