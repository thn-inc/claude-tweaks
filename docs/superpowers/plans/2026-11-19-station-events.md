# Station Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The program code that already makes each transition appends one JSON line to a local station-event file in the main checkout, so the dispatch factory floor can read a record's session, station history and blocker snapshot without a GitHub call.

**Architecture:** One module (`plugin/bin/lib/station-events/emit.js`) owns the v1 line format, `eventKey` and a locked append; one table module (`stations.js`) owns every station, label and driver-step name. Call sites hand the emitter facts they already hold, through an injectable dep (`deps.stationEvent`) that is wired to the real emitter only in each CLI's `realDeps`, so existing tests never write a file. The driver mirrors its own event lines through the same sink, so the station file and `driver-events.jsonl` cannot disagree.

**Tech Stack:** Node 18+, `node --test`, no new dependencies. `plugin/bin/lib/file-lock.js` (`withLock`), `plugin/bin/lib/hooks/worktree-detect.js` (`mainCheckoutRoot`).

**Spec:** `.claude-tweaks/pipelines/2026-11-19T073112-spec-5902/work/5902-spec.md` (record #5902). Design: dispatch `docs/superpowers/specs/2026-11-18-factory-floor-design.md` at `b1393a56` ("The ledger: station events", "The station registry").

Scope keywords: station-events, appendStationEvent, session_bound

## Global Constraints

- File: `{main checkout}/.claude-tweaks/station-events.jsonl`, resolved with `mainCheckoutRoot`, never the linked worktree.
- Line format v1, one object per line, fields exactly: `v` (1), `eventKey`, `repoName` (`owner/name`), `recordNumber`, `kind` (`entered | started | exited | session_bound | blockers`), `station`, `at` (ISO-8601 UTC, ends `Z`), `outcome` (on `exited`: `passed | failed | returned | skipped | abandoned`, else `null`), `lane` (`standard | express | driver | unknown`), `sessionId`, `runId`, `payload` (object).
- `appendStationEvent(event, deps)` never throws and never changes a caller's outcome; a failed append is dropped with one stderr line. No network call, no hub dependency, no policy key.
- `lane` is passed in by the caller, never inferred; `unknown` is valid.
- No skill prose instructs anyone to log a station event: `git grep -n "station-events" -- plugin/skills` matches only `step-04-gitignore-suggestions.md`.
- Station, label and driver-step names are unconfirmed against the design's Phase 0 fixtures; they live only in `stations.js` so a correction is a one-file change.
- No rotation or compaction. Driver stdout and `driver-events.jsonl` stay unchanged.
- Commit style: `{Verb} {what} — {detail}`; end every commit message with `Claude-Session: https://claude.ai/code/session_016yg3zp42DtDaBA2L7DpEgX`.

## Spec deviations (decided here, each logged to the ledger at build)

1. `accept-entry.js` emits nothing. Its `labels` subcommand only prints the edit lists (`verdictLabelEdits`); skill prose applies them with `gh issue edit`. An event there would record a transition no code performed. The `accept:*` verdict labels stay with the reconciler.
2. The claim event carries `lane: unknown` unless the caller passes `--lane`. `/flow` claims before the express gate runs, so it cannot know its lane; only the driver passes `--lane driver`. Later events carry the real lane. No `/flow` prose changes.
3. The release transition is emitted from `plugin/bin/release-claim.js` (the CLI, which holds `runId`, reason and repo), not `lib/release-claim/release.js`. `reconcile`'s `release-merged.js` releases without the CLI and emits nothing; the reconciler covers it.
4. `bot:blocked` / `bot:parked` additions are not emitted: the emitter cannot know which station's visit they end.
5. `express-lane.js` call paths emit nothing in this record; `express` stays a valid `lane` value.

## Spec paths this plan deliberately does not edit

Named in the spec's Technical Approach, left alone for the reasons in "Spec deviations": `plugin/bin/lib/release-claim/release.js` (the CLI emits instead), `plugin/bin/lib/issues/accept-entry.js` (it applies no label), `plugin/bin/lib/flow/pr-early-open.js` (the CLI emits instead), `plugin/bin/lib/driver/merge.js` (its sub-step lines already pass through the driver sink, so the mirror covers them), `plugin/bin/lib/hooks/worktree-detect.js` (read-only use, shared with #5903's run-dir work), `plugin/skills/_shared/label-bootstrap.md` (read for label names only), and `.claude-tweaks/station-events.jsonl` (the file the emitter writes, ignored by git).

## Acceptance criteria map

- After `claim-targets.js` claims record N, the file holds a `session_bound` event whose `recordNumber` is N and whose `sessionId` equals `CLAUDE_CODE_SESSION_ID`; claiming records 1, 2 and 3 in one session writes three such events with the same `sessionId` — Task 3.
- A driver run's `driver-events.jsonl` and the station-event file agree: every `worker`, `test`, `review`, `pr`, `ci` and `merge` step that has a line in the first has a started and an exited event in the second, with the same record and run id, and the `session_bound` event names the worker's `session_id` — Tasks 8 and 9.
- `resolve-blockers.js 12,13` emits two `kind: blockers` events and prints the same stdout and exit code as before; a record with a blocker in another repository carries it in `payload.crossRepoBlockers` — Tasks 5 and 6.
- Every event passes a line-format check: valid JSON, a known `kind`, `at` in UTC, a deterministic `eventKey`; emitting the same transition twice yields one `eventKey` — Task 1.
- Run from a linked worktree, the event lands in the main checkout's `.claude-tweaks/station-events.jsonl` — Task 1.
- With the file unwritable (read-only directory), the claim, the release, `resolve-blockers.js` and a driver run still finish with their unchanged results and exit codes — Task 12.
- No event is written by a skill prose step; `git grep -n "station-events" -- plugin/skills` matches no instruction to log — Task 2.
- The full test suite and lint pass — `/build` Common Step 5.

## Review Focus

- A `--budget` drain claiming records 1, 2, 3 in one session writes three `session_bound` events, same `sessionId` (Task 3).
- `CLAUDE_CODE_SESSION_ID` empty or unset: no `session_bound` is written (nothing to bind), the claim still succeeds (Task 3).
- The events directory unwritable, or its parent missing: claim, release, `resolve-blockers.js`, preflight and a driver run keep their stdout and exit codes (Task 12).
- Two sessions in two worktrees appending at once: whole lines, no interleaving (Task 1).
- A record number or repo that cannot be resolved: the event is dropped with one stderr line, not written with `null` identity (Task 1).

---

### Task 1: Emitter, station table, reference page

**Files:**
- Create: `plugin/bin/lib/station-events/emit.js`
- Create: `plugin/bin/lib/station-events/stations.js`
- Create: `docs/reference/station-events.md`
- Modify: `.gitignore`
- Test: `tests/bin-lib/station-events/emit.test.js`

**Interfaces:**
- Produces (`emit.js`): `appendStationEvent(event, deps = {}) -> { written: boolean, reason?: string }`; `buildLine(event, deps) -> object | null` (`null` when `repoName` is not `owner/name` or `recordNumber` is not a positive integer); `eventKey({ repoName, recordNumber, kind, station, outcome, runId, discriminator }) -> string` (first 32 hex chars of sha256 over those fields joined by `|`, absent fields as `''`); `toRepoName(slug) -> string | null` (last two `/` segments of `[host/]owner/name`); `stationEventPath(mainRoot) -> string`; `realDeps()`.
- `event` input: `{ repoName, recordNumber, kind, station, outcome?, lane?, sessionId?, runId?, payload?, discriminator, at? }`. `discriminator` is required: a stable string the caller already holds (claim: the claim's `claimedAt` or run id; driver: `step@ts`); never `Date.now`.
- `deps`: `{ fs, withLock, mainRoot, now, stderr }`; all default to the real ones; `mainRoot` defaults to `mainCheckoutRoot(process.cwd())`; `at` defaults to `deps.now()` as ISO.
- Produces (`stations.js`): `STATIONS` (ordered array: `intake, shape, authorize, release, build, test, review, polish, wrap-up, merge, accept`), `LANES`, `KINDS`, `OUTCOMES`, `DRIVER_STEP_STATIONS`, `MERGE_SUBSTEP_TRANSITIONS`, `LABEL_TRANSITIONS`, `outcomeForReleaseReason(reason)`, `outcomeForDriverStatus(status)`, `transitionsForLabel(label, direction) -> [{kind, station, outcome?}]`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/station-events/emit.test.js` using a temp dir as `mainRoot` and fake `now`/`stderr`:
  - `v1 line has exactly the spec fields` — deep-equals the key set of a built line; `at` ends in `Z`; `outcome` is `null` on a non-`exited` kind; `payload` defaults to `{}`; `lane` defaults to `unknown`.
  - `eventKey is deterministic` — same inputs twice give one key; changing only `discriminator` changes it; `at` is not an input (same key when `now` differs).
  - `appends whole lines under the lock` — two `appendStationEvent` calls produce two parseable lines, file ends with `\n`; the lock directory `station-events.jsonl.lock` is gone afterwards.
  - `resolves to the main checkout from a linked worktree` — with a fixture linked worktree whose `.git` file points at `<main>/.git/worktrees/x`, the default `mainRoot` resolution writes under `<main>/.claude-tweaks/`.
  - `a write failure is swallowed` — `fs.appendFileSync` throwing yields `{ written: false }`, exactly one `stderr` call, no throw.
  - `an unresolvable identity is dropped` — `repoName: 'unknown'` or `recordNumber: 0` returns `{ written: false }` with one stderr line and creates no file.
  - `kind and outcome outside the closed sets are refused` the same way.
  - `toRepoName` maps `github.com/o/n` and `o/n` to `o/n`, and `''` to `null`.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/station-events/emit.test.js`
Expected: FAIL with "Cannot find module" for `emit.js`

- [ ] **Step 3: Implement `emit.js` and `stations.js`.** Append with one `fs.appendFileSync(file, line + '\n')` inside `withLock(file + '.lock', fn, { createParent: true })` after `fs.mkdirSync(dirname, { recursive: true })`. `stations.js` tables, each with a header comment saying names are unconfirmed pending the design's Phase 0 fixtures:
  - `DRIVER_STEP_STATIONS`: `worker→build`, `test→test`, `review→review`, `pr→wrap-up`, `ci→merge`, `merge→merge`.
  - `outcomeForDriverStatus`: `ok→passed`, `fail→failed`, `stop→returned`.
  - `MERGE_SUBSTEP_TRANSITIONS`: `merge-ready→{kind: entered, station: merge}`, `merge-call→{kind: exited, station: merge}` (outcome from status), `merge-park→{kind: exited, station: merge, outcome: returned}`.
  - `LABEL_TRANSITIONS` per the design registry: `needs:definition` removed → exited `intake` passed; `ready` added → exited `intake` passed, exited `shape` passed, entered `authorize`; `auto:build` added → exited `authorize` passed, entered `release`; `bot:in-progress` added → exited `release` passed, entered `build`; `accept:pending` added → entered `accept`.
  - `outcomeForReleaseReason`: `merged`/`pr-opened*` → `passed`; `never-started*`/`swept:*` → `abandoned`; `fail*` → `failed`; anything else → `returned`.
- [ ] **Step 4: Write `docs/reference/station-events.md`** — the v1 field table, the kind and outcome sets, the eventKey rule and "consumers dedupe on `eventKey`", file location and the main-checkout rule, the lane values, that `blockers` is an addition to the design's four kinds and dispatch must accept it, the coverage gaps (the five deviations above plus `ready` by `/specify` and a standard-lane `gh pr merge` having no code emitter), and the unconfirmed-names warning. Add `.claude-tweaks/station-events.jsonl` and `.claude-tweaks/station-events.jsonl.lock` to `.gitignore` next to `wrap-up-outcomes.tsv`.
- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/bin-lib/station-events/emit.test.js`
Expected: PASS

- [ ] **Step 6: Commit** — `git add` the five files; message `Add station-event emitter — v1 line format, station table, reference page`.

### Task 2: Gitignore suggestion and no-prose guard

**Files:**
- Modify: `plugin/skills/init/bootstrap/step-04-gitignore-suggestions.md`
- Test: `tests/bin-lib/station-events/no-prose-logging.test.js`

**Interfaces:**
- Consumes: the `.gitignore` entries from Task 1.

- [ ] **Step 1: Write the failing test** `no-prose-logging.test.js`: it runs `git grep -l "station-events" -- plugin/skills` through `execFileSync('git', ['grep', '-l', ...])` (exit 1 = no match is fine) and asserts the match set is exactly `['plugin/skills/init/bootstrap/step-04-gitignore-suggestions.md']`; a second case asserts the root `.gitignore` contains both entries from Task 1; a third asserts the suggestions file names the same two entries. The first case must discriminate: assert it is red when the suggestions file is temporarily absent from the set (run the matcher over a fixture list containing one extra `plugin/skills/x.md` and expect a failure message naming it).
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/station-events/no-prose-logging.test.js`
Expected: FAIL (the suggestions file does not name the entries yet)

- [ ] **Step 3: Edit the suggestions file** — add the two entries to the ignore list, one sentence to the explanatory paragraph (an untracked station-event file makes reconcile's and mirror's `git status --porcelain` read the checkout as dirty, the same reason as `wrap-up-outcomes.tsv`), and the entries to the "already migrated" row's conjunction.
- [ ] **Step 4: Run the guard and the neighbouring gitignore suites**

Run: `node --test tests/bin-lib/station-events/no-prose-logging.test.js`
Expected: PASS

Run: `node --test tests/init-bootstrap-gitignore.test.js` — first `git grep -l "step-04-gitignore-suggestions" -- tests` to find the real suite names, and run each one found. Expected: PASS
- [ ] **Step 5: Commit** — `Suggest ignoring the station-event file — and guard skill prose from logging it`.

### Task 3: Claim — `session_bound` and the claim transition

**Files:**
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js`
- Modify: `plugin/bin/claim-targets.js`
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js`

**Interfaces:**
- Consumes: `appendStationEvent`, `toRepoName`, `LABEL_TRANSITIONS`/`transitionsForLabel('bot:in-progress', 'added')` from Task 1.
- Produces: `run()` calls `deps.stationEvent(event)` (optional dep; absent = no emission) once per newly claimed record, immediately after `claimedThisRun.push(issue)` (`claim-targets.js:747`); `--lane <standard|express|driver|unknown>` flag (default `unknown`, anything else exit 2 with `USAGE`); `realDeps.stationEvent = (e) => appendStationEvent(e)`.

- [ ] **Step 1: Write the failing tests** (append to the existing suite; `Expected: FAIL after Step 1`) with a fake `stationEvent` recording calls:
  - claiming `[5902]` records a `session_bound` event with `recordNumber: 5902`, `repoName` `acme/w`, `sessionId` equal to `deps.sessionId`, `runId` equal to `--run-id`, `lane: unknown`, `discriminator` equal to the claim payload's `claimedAt`.
  - claiming `[1,2,3]` records three `session_bound` events with one `sessionId`, in target order.
  - each claim also records an `exited release passed` and an `entered build` event (the `bot:in-progress` transition).
  - `--lane driver` stamps `lane: driver` on all of them; `--lane bogus` exits 2.
  - empty `sessionId` records the two transition events and no `session_bound`.
  - a contested, transient or `alreadyOwned` target records nothing.
  - a `stationEvent` that throws leaves the exit code, stdout and `claimed` list byte-identical to a run without it.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: FAIL after Step 1 (new assertions) — the pre-existing tests pass.

- [ ] **Step 3: Implement** the `--lane` parse in `parseArgs` and `USAGE`, the emission block wrapped in try/catch, and `realDeps.stationEvent` in `plugin/bin/claim-targets.js`. `repoName` is `toRepoName(repoSlug)`. `claimedAt` comes from the same `payload` built at `claim-targets.js:646`.
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: PASS

Run: `node --test tests/bin-lib/claim-targets/cli.test.js`
Expected: PASS (the CLI wiring test still sees `gitRunner`; add one case asserting `realDeps.stationEvent` is a function).
- [ ] **Step 5: Commit** — `Emit session_bound and the claim transition — one event per claimed record`.

### Task 4: Release transition

**Files:**
- Modify: `plugin/bin/release-claim.js`
- Test: `tests/bin-lib/release-claim/cli.test.js`

**Interfaces:**
- Consumes: Task 1's `outcomeForReleaseReason`, `toRepoName`.
- Produces: `run()` calls `deps.stationEvent` once after `release.releaseClaim` when `r.outcome` is a real release (not `skipped-not-owner`, `unreadable`, `failed`): `{ kind: 'exited', station: 'build', outcome: outcomeForReleaseReason(reason), runId, recordNumber: issue, payload: { reason, link } , discriminator: 'release:' + runId }`; `realDeps.stationEvent` wired as in Task 3.

- [ ] **Step 1: Write the failing tests** (`Expected: FAIL after Step 1`): a released claim with `--reason merged` records one `exited build passed` event carrying `payload.reason`; `--reason "never-started: x"` gives `abandoned`; an `skipped-not-owner` outcome records nothing; a throwing `stationEvent` leaves stdout and the exit code unchanged.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/release-claim/cli.test.js`
Expected: FAIL after Step 1 (new assertions)

- [ ] **Step 3: Implement** the emission in `plugin/bin/release-claim.js` after the stdout payload is composed and before the `return`, in try/catch.
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/release-claim/cli.test.js`
Expected: PASS

Run: `node --test tests/bin-lib/release-claim/release.test.js`
Expected: PASS
- [ ] **Step 5: Commit** — `Emit the release transition from release-claim — reason maps to an outcome`.

### Task 5: Blocker snapshot callback

**Files:**
- Create: `plugin/bin/lib/station-events/blockers.js`
- Modify: `plugin/bin/lib/issues/native-dependencies.js`
- Test: `tests/bin-lib/station-events/blockers.test.js`
- Test: `tests/bin-lib/issues/native-dependencies.test.js`

**Interfaces:**
- Produces: `fetchNativeDependencies({ numbers, owner, repo, host, runner, onSnapshot, now })` — `onSnapshot` optional (default none), `now` defaults to `() => new Date()`; after a successful parse it calls `onSnapshot(number, entry, { owner, repo, host, fetchedAt })` once per number, inside try/catch (a throwing callback never changes the returned Map); no extra `runner` call.
- Produces (`blockers.js`): `makeBlockerSnapshotSink({ stationEvent, sessionId, runId }) -> (number, entry, meta) => void` building `{ kind: 'blockers', station: 'authorize', recordNumber: number, repoName: owner/repo, payload: { blockedBy, openBlockerIds, crossRepoBlockers: entry.crossRepoBlockers || [], fetchedAt }, discriminator: fetchedAt }`.

- [ ] **Step 1: Write the failing tests.** `native-dependencies.test.js` (append; `Expected: FAIL after Step 1`): `onSnapshot` is called once per number with the entry and `fetchedAt` from an injected `now`; the runner is called exactly once; a throwing `onSnapshot` leaves the Map identical; absent `onSnapshot` behaves as today. `blockers.test.js`: the sink maps an entry with `crossRepoBlockers` into `payload.crossRepoBlockers`, and defaults it to `[]` when absent.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/station-events/blockers.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement** the callback and the sink. The station `authorize` is the table's closest reading of "where blocker state matters" and is flagged unconfirmed in `stations.js` as `BLOCKER_SNAPSHOT_STATION`.
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/station-events/blockers.test.js tests/bin-lib/issues/native-dependencies.test.js`
Expected: PASS
- [ ] **Step 5: Commit** — `Add the blocker-snapshot callback — fetchNativeDependencies hands each entry to an optional sink`.

### Task 6: `resolve-blockers.js` emits the snapshot

**Files:**
- Modify: `plugin/bin/lib/number-list-cli.js`
- Modify: `plugin/bin/resolve-blockers.js`
- Test: `tests/resolve-blockers-cli.test.js`

**Interfaces:**
- Consumes: `makeBlockerSnapshotSink` (Task 5), `appendStationEvent` (Task 1).
- Produces: `makeNumberListCli`'s `run(argv, deps)` passes `onSnapshot: deps.onSnapshot` into `fetch(...)` (unused by `resolve-linked-prs.js`); `resolve-blockers.js` forwards it to `fetchNativeDependencies` and, at the bottom, runs with `{ ...realDeps, onSnapshot: makeBlockerSnapshotSink({ stationEvent: appendStationEvent, sessionId: process.env.CLAUDE_CODE_SESSION_ID || null, runId: null }) }`. The default `deps = realDeps` stays untouched, so in-process callers never write.

- [ ] **Step 1: Write the failing tests** (append): `run(['12,13'], { ...fakeDeps, onSnapshot })` calls `onSnapshot` twice (12, then 13) and the stdout and exit code equal those of the same call without it; a blocker in another repository reaches the callback entry's `crossRepoBlockers`; a throwing `onSnapshot` leaves stdout and exit code unchanged; exit 3 (GraphQL failure) records no snapshot.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/resolve-blockers-cli.test.js`
Expected: FAIL after Step 1 (new assertions)

- [ ] **Step 3: Implement** the pass-through in `number-list-cli.js` (one line in the `fetch({...})` call) and the wiring in `resolve-blockers.js`.
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/resolve-blockers-cli.test.js`
Expected: PASS

Run: `node --test tests/resolve-linked-prs-cli.test.js` — find the real name with `git grep -l "resolve-linked-prs" -- tests` and run every match. Expected: PASS
- [ ] **Step 5: Commit** — `Emit the blocker snapshot from resolve-blockers — stdout and exit codes unchanged`.

### Task 7: `preflight-records.js` emits the snapshot

**Files:**
- Modify: `plugin/bin/lib/preflight-records/preflight-records.js`
- Modify: `plugin/bin/preflight-records.js`
- Test: `tests/bin-lib/preflight-records/preflight-records.test.js`

**Interfaces:**
- Produces: the lib's `fetchNativeDependencies({ numbers, owner, repo, host, runner = defaultRunner, onSnapshot })` forwards `onSnapshot`; the CLI passes `deps.onSnapshot` at `plugin/bin/preflight-records.js:280` and defines it in `realDeps` (`plugin/bin/preflight-records.js:179`) with the same sink factory as Task 6.

- [ ] **Step 1: Write the failing tests** (append): with `workLinks: native` and a fake `deps.onSnapshot`, a run over three records calls it three times and prints the same envelope and exit code as without it; under `body-text` it is never called.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/preflight-records/preflight-records.test.js`
Expected: FAIL after Step 1 (new assertions)

- [ ] **Step 3: Implement** the forwarding and the `realDeps.onSnapshot`.
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/preflight-records/preflight-records.test.js`
Expected: PASS
- [ ] **Step 5: Commit** — `Emit the blocker snapshot from preflight-records — one more caller of the same sink`.

### Task 8: Worker `session_id` reaches the driver event

**Files:**
- Modify: `plugin/bin/lib/driver/worker.js`
- Modify: `plugin/bin/lib/driver/steps.js`
- Test: `tests/bin-lib/driver/worker.test.js`
- Test: `tests/bin-lib/driver/run.test.js`

**Interfaces:**
- Produces: `classify()`'s envelope gains `sessionId` (`obj.session_id` when a non-empty string, else `null`); `runImplementer` copies it to `ctx.worker.sessionId` and into the `worker` step's `extra` as `sessionId` (only when non-null, like `spendOverrun`); the driver's claim step passes `--lane driver` to `claim-targets.js`. Fixture: `tests/bin-lib/driver/fixtures/worker-result.json` already carries `session_id`.

- [ ] **Step 1: Write the failing tests** (append): `launchWorker` over the fixture returns an envelope with `sessionId` equal to the fixture's `session_id`; a result with no `session_id` gives `null`; a driver run's `worker` event has `sessionId`; the claim step's `claim-targets.js` argv ends with `--lane driver`.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/driver/worker.test.js`
Expected: FAIL after Step 1 (new assertions)

- [ ] **Step 3: Implement** the three one-line changes. Read the claim step's argv construction in `steps.js` first (`git grep -n "claim-targets" plugin/bin/lib/driver/steps.js`) and add the flag where the argv is built.
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/driver/worker.test.js`
Expected: PASS

Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: PASS
- [ ] **Step 5: Commit** — `Carry the worker's session_id into its driver event — and mark driver claims with their lane`.

### Task 9: Driver events mirror into station events

**Files:**
- Create: `plugin/bin/lib/station-events/driver-mirror.js`
- Modify: `plugin/bin/lib/driver/run.js`
- Test: `tests/bin-lib/station-events/driver-mirror.test.js`
- Test: `tests/bin-lib/driver/run.test.js`

**Interfaces:**
- Consumes: `DRIVER_STEP_STATIONS`, `MERGE_SUBSTEP_TRANSITIONS`, `outcomeForDriverStatus` (Task 1).
- Produces (`driver-mirror.js`): `stationEventsFor(event, { repoName, runId }) -> event[]` — pure. For a step line whose `step` is in `DRIVER_STEP_STATIONS` it returns a `started` event (`at` = `ts` minus `ms`) and an `exited` event (`at` = `ts`, outcome from `status`); if `event.sessionId` is present on a `worker` line it also returns a `session_bound`; for a `merge-*` sub-step in `MERGE_SUBSTEP_TRANSITIONS` it returns that one transition. Every event has `lane: 'driver'`, `runId`, `discriminator: step + '@' + ts`. Other steps return `[]`. `run.js` passes `deps.stationEvent` (optional) through a wrapper around the sink so every `sink.emit(...)` (`run.js:331,386,431,446`) also calls `deps.stationEvent` for each mirrored event, inside try/catch; `repoName` is `toRepoName(shared.ghRepo)`.

- [ ] **Step 1: Write the failing tests.** `driver-mirror.test.js`: a `worker` line with `ms: 4000` and `ts` gives `started` at `ts-4000ms` and `exited` at `ts`; `fail` → outcome `failed`; `stop` → `returned`; a `worker` line carrying `sessionId` adds one `session_bound` with it; `merge-ready`, `merge-call`, `merge-park` map per the table; `claim`, `policy`, `summary`, `final` return `[]`; a replay of the same line gives the same `eventKey`s. `run.test.js`: a driver run over the existing fake-deps harness with a recording `deps.stationEvent` — for every `worker`, `test`, `review`, `pr`, `ci` and `merge` line in the run's emitted events there is a `started` and an `exited` station event with the same record and run id, and the `session_bound` names the fixture's `session_id`.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/station-events/driver-mirror.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement** `driver-mirror.js` and the sink wrapper in `run.js` (`driveWithCtx`, where `createEventSink` is called). Wire `deps.stationEvent` in the driver's real deps (`git grep -n "appendFile:" plugin/bin` finds the realDeps; add `stationEvent: appendStationEvent`).
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/station-events/driver-mirror.test.js`
Expected: PASS

Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: PASS
- [ ] **Step 5: Commit** — `Mirror driver events into station events — one pure mapping, emitted beside the sink`.

### Task 10: Label transitions from `apply-refine-labels.js`

**Files:**
- Modify: `plugin/bin/apply-refine-labels.js`
- Test: `tests/apply-refine-labels.test.js`

**Interfaces:**
- Consumes: `transitionsForLabel(label, 'added' | 'removed')` (Task 1).
- Produces: after a successful `deps.gh(editArgs)` for an action, `deps.stationEvent` (optional dep; `realDeps.stationEvent = appendStationEvent`) is called once per transition of every added and removed label, with `lane: 'unknown'`, `runId: basename(runDir)` when a run dir is bound, `discriminator: 'refine:{issue}:{direction}:{label}:{runId or empty}'` (no clock in it, so a replayed batch dedupes); `repoName: toRepoName(repoFlag)`.

- [ ] **Step 1: Write the failing tests** (`Expected: FAIL after Step 1`): an action adding `auto:build` records `exited authorize passed` and `entered release`; adding `ready` records the three `ready` transitions; removing `needs:definition` records `exited intake passed`; a label with no table row records nothing; a failed edit records nothing; a throwing `stationEvent` leaves `{ok, failed}` and the exit code unchanged.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/apply-refine-labels.test.js`
Expected: FAIL after Step 1 (new assertions)

- [ ] **Step 3: Implement** the emission inside the `try` after `deps.gh(editArgs)`, in its own try/catch.
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/apply-refine-labels.test.js tests/apply-refine-labels-run-dir-anchoring.test.js`
Expected: PASS
- [ ] **Step 5: Commit** — `Emit label-protocol transitions from apply-refine-labels — grants and stage moves`.

### Task 11: `accept:pending` and PR creation

**Files:**
- Modify: `plugin/bin/accept-park.js`
- Modify: `plugin/bin/pr-early-open.js`
- Test: `tests/accept-park-cli.test.js`
- Test: `tests/bin-lib/flow/pr-early-open.test.js`

**Interfaces:**
- Produces: in `accept-park.js` `postPacket` (`accept-park.js:722`), after either branch returns anything but `'pending label present'`, one `entered accept` event (`discriminator: 'accept-pending:' + n + ':' + runDir basename`); in `pr-early-open.js` after `openPrEarly` resolves with outcome `opened` or `reopened`, one `{ kind: 'started', station: 'build', payload: { fact: 'pr_opened', prNumber, prUrl, outcome } , discriminator: 'pr:' + number }` (`lane: unknown`). Both through an optional `deps.stationEvent`, wired in each `realDeps`.

- [ ] **Step 1: Write the failing tests** (`Expected: FAIL after Step 1`): `postPacket` over a record with no pending label records one event; with the label already present records none; `pr-early-open` records one event for `opened`, none for `reused`, and none when `openPrEarly` returns a degrade; a throwing `stationEvent` changes neither stdout nor the exit code in either CLI. Find the `pr-early-open.js` CLI suite with `git grep -ln "pr-early-open.js" -- tests` and add the CLI cases there if `tests/bin-lib/flow/pr-early-open.test.js` covers the lib only.
- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/accept-park-cli.test.js`
Expected: FAIL after Step 1 (new assertions)

- [ ] **Step 3: Implement** both emissions, each in its own try/catch.
- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/accept-park-cli.test.js tests/accept-park-prose-conformance.test.js tests/bin-lib/flow/pr-early-open.test.js`
Expected: PASS
- [ ] **Step 5: Commit** — `Emit accept:pending and PR-open events — the two remaining code-made transitions`.

### Task 12: Failure isolation, driver docs, public-contract proof

**Files:**
- Test: `tests/bin-lib/station-events/failure-isolation.test.js`
- Modify: `docs/driver.md`

**Interfaces:**
- Consumes: every CLI's `run(argv, deps)` and the real `appendStationEvent` pointed at an unwritable `mainRoot`.

- [ ] **Step 1: Write the test.** For each of `claim-targets`, `release-claim`, `resolve-blockers` (via `onSnapshot`) and `driver/run` (mirror), run once with `stationEvent` wired to the real `appendStationEvent` over a read-only directory (`fs.chmodSync(dir, 0o555)`, skipped on win32 and when running as root, with the skip named in the output) and once with `stationEvent` absent; assert identical stdout and exit codes. Add a field-by-field pin of one real v1 line per `kind`, and a case that a missing `.claude-tweaks` directory is created, not an error.
- [ ] **Step 2: Run the test**

Run: `node --test tests/bin-lib/station-events/failure-isolation.test.js`
Expected: PASS (the behaviour exists from Tasks 3-9; this is the cross-cutting proof). If any case fails, fix the call site that leaked.
- [ ] **Step 3: Write the `docs/driver.md` section** "Station events" (after "Event lines"): three sentences — the station file is the contract and `driver-events.jsonl` is not, the driver mirrors its lines into it, and a link to `docs/reference/station-events.md`.
- [ ] **Step 4: Record the public-contract proof** — confirm by reading the tests that exist after Tasks 1-11:

Proof(public-contract): the v1 line is pinned field-by-field per kind in failure-isolation.test.js and emit.test.js, and every touched CLI (claim-targets, release-claim, resolve-blockers, preflight-records, apply-refine-labels, accept-park, pr-early-open) has a test asserting its stdout and exit code are byte-identical with stationEvent absent, present, and throwing.

- [ ] **Step 5: Commit** — `Pin station-event failure isolation — and document the file in docs/driver.md`.

The full suite and lint run in `/build`'s Common Step 5 (`verification.md`), not as a plan task.
