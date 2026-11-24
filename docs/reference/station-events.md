# station-events.jsonl — where a record is in its journey, as local facts

`station-events.jsonl` is an append-only log of station events: one JSON line each time claude-tweaks program code moves a record into, through or out of a station (intake, shape, authorize, release, build, test, review, polish, wrap-up, merge, accept). It is written locally, with no network call, no hub dependency and no policy key. A reader (the dispatch scoreboard) pairs the lines into station visits; the emitter only records facts.

The code is `plugin/bin/lib/station-events/emit.js` (`appendStationEvent`, `buildLine`, `eventKey`, `toRepoName`, `stationEventPath`) and `plugin/bin/lib/station-events/stations.js` (every station, lane, kind, outcome and mapping name). Tests: `tests/bin-lib/station-events/emit.test.js`, `tests/bin-lib/station-events/transition-table.test.js`.

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

## Transition code by station

Which code performs each station transition today, read from the files (record #6145). A cell is `none` or entries `` `plugin/bin/<path>.js:<function>` `` joined by `; `; the function is the one that defines or performs the emit. `kinds emitted today` is what that code writes now; the two right-hand columns say what the code itself already knows, so a later record adding `payload.reasonCode` or `payload.actor` knows where each is available. `tests/bin-lib/station-events/transition-table.test.js` pins one row per station and that each cited file defines its function.

| station | code that performs the transition (path:function) | kinds emitted today | outcome known to the code | reason known to the code |
|---------|----------------------------------------------------|---------------------|---------------------------|--------------------------|
| `intake` | `plugin/bin/apply-refine-labels.js:emitLabelTransitions` | `exited` | `passed` (`needs:definition` removed, or `ready` added) | the label and direction (`payload.label`, `payload.direction`) only |
| `shape` | `plugin/bin/apply-refine-labels.js:emitLabelTransitions` | `exited` | `passed` (`ready` added) | the label and direction only |
| `authorize` | `plugin/bin/apply-refine-labels.js:emitLabelTransitions`; `plugin/bin/lib/station-events/blockers.js:makeBlockerSnapshotSink`; `plugin/bin/resolve-blockers.js:run`; `plugin/bin/preflight-records.js:loadFromGh` | `entered` (`ready` added), `exited` (`auto:build` added), `blockers` | `passed` on the exit | the label and direction; a blocker snapshot carries `blockedBy`, `openBlockerIds`, `crossRepoBlockers` |
| `release` | `plugin/bin/apply-refine-labels.js:emitLabelTransitions`; `plugin/bin/lib/claim-targets/claim-targets.js:emitInProgressTransition` | `entered` (`auto:build` added), `exited` (`bot:in-progress` added, or the claim landing) | `passed` | the label, known only on the `apply-refine-labels.js` path; the `claim-targets.js` exit carries an empty payload (`{}`), so nothing on the claim path |
| `build` | `plugin/bin/apply-refine-labels.js:emitLabelTransitions`; `plugin/bin/lib/claim-targets/claim-targets.js:emitStation`; `plugin/bin/lib/claim-targets/claim-targets.js:emitInProgressTransition`; `plugin/bin/lib/claim-targets/claim-targets.js:emitRollbackExit`; `plugin/bin/lib/claim-targets/claim-targets.js:emitPlanned`; `plugin/bin/release-claim.js:run`; `plugin/bin/accept-park.js:parkSteps`; `plugin/bin/pr-early-open.js:run`; `plugin/bin/lib/station-events/driver-mirror.js:stationEventsFor` | `entered` (`bot:in-progress` added, the claim), `planned` (the claim), `started` (driver `worker` step; `pr_opened` fact), `session_bound`, `exited` (a claim release, a rollback, a driver `worker` exit) | claim release: from the release reason (`outcomeForReleaseReason`); rollback: `abandoned`; park hand-forward: `passed`; driver `worker`: from step status (`ok` passed, `fail` failed, `stop` stopped) | the release reason string (`reason`: `never-started: ...` on rollback, `awaiting-local-acceptance` on the park hand-forward, the caller's reason on a release), plus `link` on a release-claim exit and `sweptBy` / `sweptBySession` on a swept release; for a driver step, `actor` on every driver `exited`, `reasonCode` when not `passed`, `reasonText` on a `stopped` exit (see the driver mirror row below) |
| `test` | `plugin/bin/lib/station-events/driver-mirror.js:stationEventsFor` | `started`, `exited` (driver `test` step) | from step status (`ok` passed, `fail` failed, `stop` stopped; a `verifyExit: 1` red-tests stop is `failed` with `test-failed`) | `actor` on every driver `exited`, `reasonCode` when not `passed`, `reasonText` on a `stopped` exit (see the driver mirror row below) |
| `review` | `plugin/bin/lib/station-events/driver-mirror.js:stationEventsFor` | `started`, `exited` (driver `review` step); `session_bound` for a review fix session is filed under `build` | from step status (`ok` passed, `fail` failed, `stop` stopped) | `actor` on every driver `exited`, `reasonCode` when not `passed`, `reasonText` on a `stopped` exit (see the driver mirror row below) |
| `polish` | none | none | none | none |
| `wrap-up` | `plugin/bin/lib/station-events/driver-mirror.js:stationEventsFor` | `started`, `exited` (driver `pr` step) | from step status (`ok` passed, `fail` failed, `stop` stopped) | `actor` on every driver `exited`, `reasonCode` when not `passed`, `reasonText` on a `stopped` exit (see the driver mirror row below) |
| `merge` | `plugin/bin/lib/station-events/driver-mirror.js:stationEventsFor` | `started`, `exited` (driver `ci` and `merge` steps); `entered` / `exited` for the merge sub-steps | from step status (`ok` passed, `fail` failed, `stop` stopped); sub-steps `merge-confirm` `passed`, `merge-park` `returned` | for a step, `actor` on every driver `exited`, `reasonCode` when not `passed`, `reasonText` on a `stopped` exit (see the driver mirror row below); for a sub-step, its name |
| `accept` | `plugin/bin/apply-refine-labels.js:emitLabelTransitions`; `plugin/bin/accept-park.js:parkSteps` | `entered` (`accept:pending` added; packet posted) | none (no exit is written) | the label (`accept:pending`) |

### Holds and plan changes

Code that changes a record's state without a station transition today, and so the code a hold, release or replan fact would attach to:

- `bot:blocked` is added by `plugin/bin/lib/driver/settle.js` (`settle`, its `settle-label` step: `gh issue edit --add-label bot:blocked` after a driver stop). The stop's step, outcome and detail are known there.
- `bot:parked` is added by `plugin/bin/lib/driver/merge.js` (`park`, the red-path park at merge: bootstrap check, label add, re-read). The park reason is known there.
- `accept:changes-requested` is named by `plugin/bin/lib/issues/accept-entry.js` (`verdictLabelEdits`, which only returns the label edits for a verdict); the `accept` skill's prose applies them with `gh issue edit`, so no program code adds the label itself.
- A claimed record's ceremony profile is changed by `plugin/bin/lib/set-config/write.js` (`setConfigLever`, whose `ceremony-profile` branch calls `fillRunManifest` to write `ceremonyProfile` into the run manifest). `writeManifesto` (`plugin/bin/lib/flow/manifesto-write.js`) writes the replan, once after its `setConfigLever` batch, whose calls pass no sink; `setConfigLever` replans only when a caller passes `stationDeps`, which no production caller does, and the `set-config.js` CLI passes none. `plugin/bin/lib/express/cli.js` (`runCheck`) returns `configSet` with `ceremony-profile=fast-lane` for an express run that proceeds, which the caller applies through that same lever.

## Station order from real moves

Confirmed order: `intake` → `shape` → `authorize` → `release` → `build` → `test` → `review` → `polish` → `wrap-up` → `merge` → `accept`

`STATION` in `stations.js` already has this order, so it was not reordered. This section and `## Starting lists` on `main` are the report the hub plan's Task 4 (`thn-inc/dispatch` H4) reads; no other post is made.

Basis: the hub node database (local hub Postgres, table `station_visits`; the query takes `lead(station) over (partition by work_order_key order by entered_at, id)`, last 28 days, pairs with n >= 10, run 2026-11-23): 14,900 visits over 3,196 work orders.

| pair | n |
|------|---|
| intake→shape | 3132 |
| shape→authorize | 3132 |
| release→build | 1920 |
| authorize→release | 1467 |
| build→release | 469 |
| authorize→intake | 213 |
| build→intake | 212 |
| build→build | 166 |
| polish→test | 138 |
| test→wrap-up | 130 |
| wrap-up→build | 123 |
| build→polish | 112 |
| wrap-up→wrap-up | 105 |
| build→accept | 79 |
| wrap-up→polish | 62 |
| polish→wrap-up | 60 |
| build→wrap-up | 33 |
| test→test | 22 |
| intake→intake | 21 |
| build→authorize | 19 |
| release→authorize | 14 |
| release→polish | 14 |
| authorize→build | 13 |
| test→polish | 11 |

Visits per station: authorize 3167, intake 3154, shape 3132, release 2322, build 2295, wrap-up 336, polish 199, test 173, accept 122; `review` and `merge` have 0 visits.

Reading the counts. The hub opens a Polish visit on a session `simplify` segment (`hub/packages/core/src/stations.ts` in `thn-inc/dispatch`: polish `workStarts` is "a `simplify` segment opens"; its own `startsWaiting` note says "`simplify` also opens before `test`"). `/claude-tweaks:build` runs `/claude-tweaks:simplify` at its Common Step 3, before its final verification and before `/claude-tweaks:test`. So the Polish-to-Test pairs (138) against Test-to-Polish (11) measure a `simplify` segment inside build followed by test, and are not returns to an earlier station. In claude-tweaks' own code paths Test comes before Polish: `/flow`'s default step list is `build,test,review,polish,wrap-up` (polish then re-runs `test skip-qa` as re-verify), and the driver's steps run `worker, test, review, pr, ci, merge` (`STEP_NAMES` in `plugin/bin/lib/driver/events.js`) with no polish step. Review and merge have no visits because the hub leaves them unconfirmed (no session or driver key maps to them in 28 days). Answer: **Test comes before Polish.**

## Starting lists

The lists a `planned` event can start from, from the real manifests (`.claude-tweaks/pipelines/**/manifest.json`, 306 files, 2026-11-21 to 2026-11-23). Observed `lane` / `ceremonyProfile` pairs: absent/absent 223 (manifests from before the fields existed), standard/standard 47, unknown/null 31, driver/standard 3, driver/fast-lane 1, standard/fast-lane 1.

| list | stations | selected by |
|------|----------|-------------|
| `standard` | `intake`, `shape`, `authorize`, `release`, `build`, `test`, `review`, `polish`, `wrap-up`, `merge`, `accept` | otherwise: `ceremonyProfile: standard`, or a null or absent profile on lane `standard`, `unknown` or absent |
| `fast-lane` | `intake`, `shape`, `authorize`, `release`, `build`, `test`, `review`, `wrap-up`, `merge`, `accept` | `ceremonyProfile: fast-lane` on any lane other than `driver` (`_shared/ceremony-profile.md`'s `polish` row skips polish under fast-lane); observed `standard`/`fast-lane` 1 |
| `driver` | `intake`, `shape`, `authorize`, `release`, `build`, `test`, `review`, `wrap-up`, `merge`, `accept` | lane `driver`, whatever the ceremony profile (the driver has no polish step); observed `driver`/`standard` 3, `driver`/`fast-lane` 1 |

A lane of `driver` selects the list `driver`; otherwise a ceremony profile of `fast-lane` selects `fast-lane`; otherwise the list is `standard`. An absent or unknown lane with an absent profile is `standard`, and the `planned` event carries reason `default-list`. A null `ceremonyProfile` is treated as absent, so lane `unknown` (or absent) with a null profile is `standard` with reason `default-list`.

`planned` is written at the claim with what is known then. A `/flow` claim usually precedes the Config Manifesto, so it usually knows neither profile nor lane and plans `standard` with reason `default-list`, which is a true statement of what was known. A `replanned` event (emission 4/8) corrects it when the Manifesto write fixes the profile or lane; its `before` is the latest `planned` or `replanned` line for the record and run. A claim passed a lane (the driver's claims) or whose run manifest already holds a profile selects the list at once; a selected list carries reason `other` with a `reasonText` (`lane driver`, `ceremony profile fast-lane`, `ceremony profile standard`, and, with no profile, `lane standard` or `lane express`). Only an unknown or absent lane with an absent profile carries `default-list`. A claim whose label add fails still writes `planned`. The line's `lane` field stays the passed lane.

The lane `express` was not observed in any manifest and follows the same rule; no list is written for it.

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

`entered`, `started`, `exited`, `session_bound`, `blockers`, `planned`, `replanned`, `held`, `released`, `decided`.

`planned`, `replanned`, `held`, `released` and `decided` are the vocabulary `stations.js` already holds; `planned` (`claim-targets.js`), `replanned` (the Manifesto write) and `decided` (`apply-refine-labels.js`, the `authorize` decision) have a producer today. A `planned` line is filed under the station the item is at when it is written, which at the claim is `build`.

`blockers` is an addition to the design's four kinds (`entered`, `started`, `exited`, `session_bound`); dispatch must accept it. A blocker snapshot is filed under station `authorize` (`BLOCKER_SNAPSHOT_STATION`, an unconfirmed reading).

### Outcomes

`passed`, `sent-back`, `failed`, `stopped`. `returned`, `skipped` and `abandoned` are retired but still accepted (`RETIRED_OUTCOMES`) until record 8/8 migrates the emitters that write them. An `exited` event without one of these is refused.

### Lanes

`standard`, `express`, `driver`, `unknown`. The caller passes the lane; it is never inferred, and `unknown` is valid (a `/flow` claim happens before its express gate, so it carries `unknown`). Only two producers write a lane other than `unknown` today: the driver mirror (`driver`) and `claim-targets.js` when its caller passes `--lane` (the driver passes `--lane driver`; every other caller omits it). `standard` and `express` are valid values that no producer writes yet.

## eventKey and deduplication

`eventKey` is the first 32 hex chars of sha256 over `repoName|recordNumber|kind|station|outcome|runId|discriminator`, an absent field hashed as `''`. `discriminator` is a stable string the caller already holds (a claim's `claimedAt` or run id; a driver step's `step@ts`), never `Date.now`. `at` is not an input, so re-emitting the same fact yields the same key. **Consumers dedupe on `eventKey`.**

## Producers

Every event comes from program code at the moment it makes the transition; no skill prose writes one. Each row names the discriminator (the `eventKey` input that tells two facts apart; see above). Lane is `unknown` unless the row says otherwise.

| Producer | Kind | Station | Outcome | Payload keys | Discriminator |
|----------|------|---------|---------|--------------|---------------|
| `claim-targets.js` (`lib/claim-targets/claim-targets.js`), per newly claimed record | `session_bound` | `build` | none | `{}`; `sessionId` is `CLAUDE_CODE_SESSION_ID`, none written when it is unset or empty; `runId` is `--run-id`; lane is `--lane` | the claim's `claimedAt` |
| same, per newly claimed record (not on a `--resume-pr` re-claim; written even when the label add fails) | `planned` | `build` | none | `process`, `processVersion`, `list`, `stations`, `reasonCode`, `reasonText` (only for a list a lane or profile selected); the line's lane is always `--lane`; the list is chosen by `--lane`, else the run manifest's `lane`, with `ceremonyProfile` from the run manifest (`--run`) | `planned:{runId}` (so a re-emit for the same record and run keys identically) |
| `lib/flow/manifesto-write.js` (`writeManifesto`, once, after its config.yml batch and lane fill succeed; it supplies the real sink itself, the one producer that does; `lib/set-config/write.js`'s `setConfigLever` also replans when a caller passes `stationDeps`, which no production caller does), per record holding a `planned` line for the run whose stations change | `replanned` | `build` | none | `stations`, `reasonCode` (`ceremony-downgrade` when a station is removed, else `other` with `reasonText`), `cause` (`{ kind: 'config', ref: 'ceremony-profile' }`); the line's lane is the `planned` line's | `replanned:{after joined}:{at}` |
| same, when the `bot:in-progress` label add succeeded (not on a `--resume-pr` re-claim) | `exited`, then `entered` | `release` (`passed`), then `build` | `passed` on the `release` exit | `{}` | `{claimedAt}:{kind}:{station}` |
| same, rollback: a group claim aborts and releases a record this run claimed | `exited` | `build` | `abandoned` (reason `never-started: file-overlap group partial claim`) | `reason` | `{claimedAt}:abort` |
| `release-claim.js`, only for a `released` result | `exited` | `build` | by reason, see below | `reason`, `link` (`null` when none); `actor` (`script`) on a `passed` or `failed` release only, a retired-outcome release (`abandoned`, `returned`) carries none until record 8/8; on `--sweep` also `sweptBy` (the sweeper's run id) and `sweptBySession` (when set). A sweep is written under the holder's `runId` with `sessionId` null | `release:{runId}:{claimedAt}`; `claimedAt` is the released claim's own, so a re-claim by the same run keys differently |
| `accept-park.js` (`park`), packet posted or `accept:pending` added | `entered` | `accept` | none | `label` (`accept:pending`) | `accept-pending:{record}:{runId}` |
| same, in-process claim release, only for a `released` result | `exited` | `build` | `passed` (reason `awaiting-local-acceptance`: build hands forward into accept) | `reason` | `release:{runId}:{claimedAt}` |
| `pr-early-open.js`, a PR it opened or reopened, one event per record in `--fixes` (a reused PR or a degrade writes nothing) | `started` | `build` | none | `fact` (`pr_opened`), `prNumber`, `prUrl`, `outcome` (`opened` or `reopened`). No `step`, no `substep` | `pr:{number}:{outcome}` |
| `apply-refine-labels.js`, after a successful label edit | the row's kind per `LABEL_TRANSITIONS` (`needs:definition` removed, `ready`, `auto:build`, `bot:in-progress`, `accept:pending` added) | the row's station | the row's outcome on an `exited` | `label`, `direction` (`added` or `removed`); a transition one action would record twice (`ready` plus a `needs:definition` removal both exit `intake`) is written once. The `auto:build` authorize exit also carries `actor` (`person`) and is followed by a `decided` line at `authorize` (`decision: 'authorize'` — a re-authorize, `auto:build` added with `bot:blocked` removed, included; `actor: 'person'`; `via: 'skill'`; `outcomeRef` = the exit's `eventKey`, same discriminator); the `decided` line is skipped when the exit call throws or reports the exit line was not written | `refine:{issue}:{direction}:{label}:{run id, else the invocation's start time}` |
| driver mirror (`lib/station-events/driver-mirror.js`), step lines `worker`, `test`, `review`, `pr`, `ci`, `merge`; lane `driver` | `started` then `exited` | `build`, `test`, `review`, `wrap-up`, `merge`, `merge` | `ok` is `passed`, `fail` is `failed`, `stop` is `stopped`; a `test` stop with `verifyExit: 1` (red tests) is `failed` | `step`, `actor` (`agent` for `worker`/`test`/`review`, `script` for `pr`/`ci`/`merge`, on every `exited`), `reasonCode` (every non-passed exit), `reasonText` (the driver's `detail`, on a `stopped` exit, only when it is a non-empty string) | `{step}@{ts}`; `started` carries `at` = line time minus `ms` |
| same, a `worker` line with `fix: true` (the review fix round's own relaunch line, #5942) | none | none | none | none | none |
| same, worker line with a `sessionId`, review line with a `fixSessionId` | `session_bound` | `build` | none | `step`; `fix: true` on the review fix session | `{step}@{ts}` |
| same, merge sub-steps (see Reading the events) | `entered` / `exited` | `merge` | `merge-confirm` `passed`, `merge-park` `returned` | `substep` | `{step}@{ts}` |
| `resolve-blockers.js` and `preflight-records.js` (native-dependency fetch), one per fetched record per call | `blockers` | `authorize` | none | `blockedBy`, `openBlockerIds`, `crossRepoBlockers` (`[]` when none), `fetchedAt`; `sessionId` is `CLAUDE_CODE_SESSION_ID`, `runId` is always `null` | `fetchedAt` |

The driver mirror's reason codes: a `test` stop with `verifyExit: 1` is `test-failed`; a `test` fail carrying `verifyExit` (any value, `null` included: `verify.js` gave no verdict) is `infrastructure`; a `test` fail without it (an interrupt, a throw, a dirty tree after a green run, an index flag) is `unspecified`; a `ci` fail or stop whose `detail` is `read-failed`, `gh-absent` or `no-pr` is `infrastructure`; any other fail or stop is `unspecified`. Under that mapping, a red CI state is data for the reviewer, not an exit; it is not mirrored as a failure. The `ci` `infrastructure` branch is reached only by a non-passing `ci` line, which the driver writes today only on a throw or an interrupt, so no real `ci` line takes it yet. The `merge-park` sub-step keeps the retired `returned` until record 8/8.

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
- The accept verdict exits (`passed` plus `decided accept`; `sent-back` to `build` with `changes-requested`) are not emitted: the verdict labels are applied by skill prose, so they need a code path first.
- Every producer except the driver mirror and a `claim-targets.js` run given `--lane` writes lane `unknown`: `release-claim.js`, `accept-park.js`, `pr-early-open.js`, `apply-refine-labels.js` and the blocker snapshot hardcode it, so a release or PR event of a driver run also carries `unknown`. `standard` and `express` are never written. `--lane` is accepted by `claim-targets.js` only; the driver is its one caller that passes it (`--lane driver`).
- A release is emitted from `plugin/bin/release-claim.js` and `plugin/bin/accept-park.js`'s in-process release only, and only for a `released` result (an `already-released` repeat writes nothing). `accept-park.js`'s in-process release is still written without `actor` (pre-contract). A shaping claim's release (`shaped: #n`, `routed: needs:definition #n`, `failed: shaping`) writes nothing: it never entered build, and the shape station has no `entered` producer to pair an exit with. `reconcile`'s `release-merged.js` path calls the library directly and emits nothing.
- `plugin/bin/repair-claim.js` (`plugin/bin/lib/repair-claim/repair.js`) force-releases (`release` mode) or re-claims (`reclaim` mode) through the release library's helpers and emits nothing. It acts on an unreadable claim blob, so there is no readable `claimedAt` for the claim being repaired to key an event on.
- `bot:blocked` / `bot:parked` additions emit nothing: the emitter cannot know which station's visit they end.
- A driver worker launch refused for want of a model (#5917, `docs/driver.md`'s Worker models) writes no `worker` line, so the mirror emits no `build` segment for it; the record's stop reaches only the driver's final line.
- `express-lane.js` call paths emit nothing yet; `express` stays a valid lane.
- `ready` applied by `/specify` (skill prose, not program code) emits nothing.
- A standard-lane `gh pr merge` has no code emitter, so its merge-station exit is not recorded.
- A ceremony-profile change made at wrap-up is not recorded as a replan.
- A lane or profile change made through the express gate or the driver's adoption is not recorded as a replan.
