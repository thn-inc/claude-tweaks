# Floor map, emission 4/8: Replanning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write one `replanned` station event when the Config Manifesto fixes a claimed record's ceremony profile or lane and that changes the record's stations, with `before` taken from the claim's own latest plan line.

**Architecture:** `replanEvent` (pure, already in `plan.js`, commit 61bc665734) builds the line. A new I/O module `station-events/replan.js` reads the latest `planned`/`replanned` line per record for a run id from the station-events log and emits a `replanned` for each record whose stations differ under the run manifest's lane and profile. It is called from the two files the record names (plan-review Q3, Reading A): `setConfigLever` in `set-config/write.js` after its `ceremony-profile` fill, only when its caller passes `stationDeps`; and `writeManifesto` in `flow/manifesto-write.js`, which passes `stationDeps` to its `set()` calls and replans once more after its own lane fill. `writeManifesto` is the only caller that passes `stationDeps`, so the `set-config.js` CLI — the writer wrap-up's narrowing and escape hatch and the express route use — never emits (Q1, Reading B). `fillRunManifest`, `set-config.js` and `manifesto-write.js` (the CLI) are not touched.

**Tech Stack:** Node.js (CommonJS), `node:test`; run tests with `node tools/run-tests.js <file>`.

**Spec:** `.claude-tweaks/pipelines/2026-11-24T092648-record-6148/work/6148-spec.md`

Scope keywords: replanEvent, replanned, setConfigLever, writeManifesto

## Global Constraints

- No prose is asked to log; only code that already makes the transition does. No skill text changes.
- Every version of a plan is kept with its reason and cause; a plan is never rewritten silently.
- Every station name, kind, outcome and lane literal lives in `plugin/bin/lib/station-events/stations.js`; `tests/bin-lib/station-events/station-literal-conformance.test.js` scans for violations (name codes via `REASON.*`, `KIND.*`, `STATION.*`).
- Emission never blocks or fails a transition: every emit path is wrapped, never throws, and never changes the caller's return value, config.yml content or exit code.
- `replanned` payload: `{ stations: string[], reasonCode: string, reasonText?: string, cause: { kind: 'outcome' | 'decision' | 'config', ref?: string } }`, filed under the station the item is at (`build`: the Manifesto runs before build).
- Reason `ceremony-downgrade` when a station is removed; a change that only adds stations carries `other` with `reasonText` naming the cause (`ceremony profile standard`, the `planOf` text of the after list) (Q2, Reading A); cause `{ kind: 'config', ref }`; nothing when the lists are equal.
- The `before` plan is the claim's `planned` event's stations — the latest `planned`/`replanned` line for that record and run id.
- Q1 (Reading B): a ceremony change made at wrap-up writes nothing. Q3 (Reading A): emit only from `plugin/bin/lib/set-config/write.js` and `plugin/bin/lib/flow/manifesto-write.js`; `fillRunManifest` is left alone, so the express gate and the driver's adoption do not emit.
- Quoted from `.claude/skills/station-event-producer-addition/SKILL.md` Rules: "1. **Name stations through `stations.js`.** Use `STATION.*` … `tests/bin-lib/station-events/station-literal-conformance.test.js` fails on `station: 'build'` anywhere else under `plugin/bin`." / "2. **Optional seam, wrapped call.** An absent `deps.stationEvent` means no emission. Every call sits in its own try/catch, so a throwing emitter never changes stdout, the exit code or the CLI's envelope." / "5. **The lane is passed, never inferred.** Write `'unknown'` unless the caller knows." / "6. **No skill prose names the file.**"
- Deviation from that skill's Rule 2 and its "producer CLI's exported `realDeps`" row, forced by Q3 (the CLIs are outside this record's Files): `setConfigLever` keeps the optional seam exactly (absent `stationDeps` = no emission). `writeManifesto` is the one site that supplies the real sink itself: `deps.stationEvent === undefined` means `(e) => appendStationEvent(e, { mainRoot })` with `mainRoot = mainCheckoutRoot(runDir)`; an explicit `null` disables. Rule 3 (stable discriminator) is overridden by the spec's interface: `replanEvent`'s discriminator is `replanned:{after joined}:{at}`, as the spec states.
- A new file `plugin/bin/lib/station-events/replan.js` is added. It is owned by no other emission record, so it widens no other record's Files; the two emitting call sites stay the two the record names.

## Review Focus

- No `planned` line for the run (an unclaimed run, no log file, an unreadable log, a run dir outside any git checkout): writes nothing and never throws — pinned in Task 1.
- A malformed, partial or foreign line in the log (bad JSON, a half-written last line from a concurrent append, another run id): skipped, never fatal — pinned in Task 1. The read and the append are not under one lock on purpose: one run's profile and lane are fixed by one Manifesto, so no second writer races the same run's latest plan; a concurrent append from another run can only add a partial last line, which is skipped.
- A second change after a replan: `before` is the replanned list, not the original claim's — pinned in Task 1 (and is why the Manifesto's later lane fill writes nothing after its profile replan — pinned in Task 2).
- A claim line whose own `lane` is `driver` keeps the driver list whatever the profile becomes — pinned in Task 1.
- Every existing caller that passes no sink (the `set-config.js` CLI, every existing test) reads no log and writes nothing — pinned in Task 2.

---

### Already landed (commit 61bc665734)

- `plugin/bin/lib/station-events/plan.js` — `replanEvent` (the spec's Deliverables interface), unchanged by this plan.
- `tests/bin-lib/station-events/plan.test.js` — AC1.1 `replanEvent returns null when the stations are unchanged` and AC1.2 `replanEvent for Test and Polish removed carries the after list and reason documents-only` exist and pass; keep them.
- `plugin/bin/lib/set-config/write.js` — a `replan` option, `manifestBefore` and `emitReplan`, plus two tests in `tests/bin-lib/set-config/write.test.js` passing `replan:`. Task 2 replaces all of them (grep shows no other caller of `replan:`).

Every task re-runs `node tools/run-tests.js tests/bin-lib/station-events/plan.test.js` in its Step 4 so these stay green.

| AC clause | Test | Where |
|---|---|---|
| AC1.1 | `replanEvent returns null when the stations are unchanged` | `tests/bin-lib/station-events/plan.test.js` (landed, kept) |
| AC1.2 | `replanEvent for Test and Polish removed carries the after list and reason documents-only` | `tests/bin-lib/station-events/plan.test.js` (landed, kept) |
| AC1.3 | `downgrading the ceremony profile on a claimed record writes one replanned with reason ceremony-downgrade` | Task 2, `tests/bin-lib/set-config/write.test.js` |

Waived plugin/bin/lib/station-events/plan.js: `replanEvent` landed in 61bc665734 and is consumed unchanged; every task's Step 4 re-runs its tests.
Waived tests/bin-lib/station-events/plan.test.js: AC1.1 and AC1.2 landed in 61bc665734; every task's Step 4 re-runs the file.

Not in scope (Check B scope-keyword matches, read and ruled out): `plugin/bin/set-config.js` and `plugin/bin/manifesto-write.js` (Q3: CLIs unchanged; `set-config.js` passing no sink is what makes wrap-up writes silent); `plugin/bin/lib/station-events/emit.js` and `stations.js` (`KIND.REPLANNED`, `REASON.CEREMONY_DOWNGRADE`, `REASON.OTHER` and the `replanned` payload contract already exist); `plugin/bin/lib/wrap-up/pack.js`, `plugin/skills/reflect/full-mode.md`, `docs/hooks.md`, `docs/journeys/read-a-records-station-events-from-the-main-checkout-5902.md`, `tests/bin-lib/station-events/emit.test.js` (mention `setConfigLever`/`replanned` only as existing vocabulary or another mechanism); `docs/reference/run-manifest.md` (the run manifest's own write behaviour does not change under Q3 — `fillRunManifest` is untouched). `docs/plugin-structure.md` IS changed, in Task 2.

### Task 1: The replan reader and emitter

**Files:**
- Create: `plugin/bin/lib/station-events/replan.js`
- Test: `tests/bin-lib/station-events/replan.test.js`

**Interfaces:**
- Consumes: `planOf`, `replanEvent` from `./plan`; `stationEventPath` from `./emit`; `KIND`, `REASON` from `./stations`; `mainCheckoutRoot` from `../hooks/worktree-detect`.
- Produces:
  - `latestPlans({ mainRoot, runId, fs? }): Map<number, { repoName: string, lane: string|null, stations: string[] }>` — the last `planned` or `replanned` line (file order) per `recordNumber` whose `runId` equals `runId`, `stations` from `payload.stations` (an array of strings, else the line is skipped). Empty map on a non-string/empty `mainRoot` or `runId`, a missing or unreadable file; unparseable lines skipped.
  - `replanRun({ runDir, manifest: { lane, ceremonyProfile }, ref: string, deps: { stationEvent, mainRoot?, sessionId?, now?, fs? } }): number` — events emitted. Returns 0 without reading anything when `deps.stationEvent` is not a function. `runId = path.basename(runDir)`; `mainRoot` defaults to `mainCheckoutRoot(runDir)`. Per record in `latestPlans`: list lane = the plan line's `lane` when it is a string other than `unknown`, else `manifest.lane`; `afterPlan = planOf({ lane: listLane, ceremonyProfile: manifest.ceremonyProfile })`; `reasonCode = REASON.CEREMONY_DOWNGRADE` when any `before` station is missing from `afterPlan.stations`, else `REASON.OTHER` with `reasonText = afterPlan.reasonText`; `cause = { kind: 'config', ref }`; the line's `lane` = the plan line's lane; `sessionId = deps.sessionId ?? null`; `at = (deps.now || (() => new Date()))().toISOString()`. Calls `deps.stationEvent(event)` when `replanEvent` returns non-null. Never throws (whole body wrapped; each emit wrapped separately so one throwing emit does not stop the next record).

- [ ] **Step 1: Write the failing tests** (temp `mainRoot` via `scratchDir` from `tests/helpers/tmp-dir`; write `.claude-tweaks/station-events.jsonl` lines by hand in the v1 shape of a real `planned` line, e.g. `{ v: 1, repoName: 'acme/w', recordNumber: 7, kind: 'planned', station: 'build', lane: 'unknown', runId: 'r1', payload: { stations: [...] } }`; `runDir = path.join(mainRoot, '.claude-tweaks', 'pipelines', 'r1')`; pass `mainRoot` in deps; build kinds and lists from `KIND`, `STARTING_LISTS`)
  - `latestPlans returns the last planned or replanned stations per record for the run` — lines: `planned` r1 #7 standard; `planned` r2 #7 (other run); `replanned` r1 #7 with `STARTING_LISTS['fast-lane']`; `not json`; a truncated `{"v":1,"kind":"pla` → map size 1, `get(7).stations` deep-equals `STARTING_LISTS['fast-lane']`, `get(7).repoName === 'acme/w'`.
  - `replanRun writes nothing when the run has no planned line` → returns 0, sink not called; also with no log file at all, and with `runDir` under a scratch dir with no `.git` and no `mainRoot` passed.
  - `fixing the profile to fast-lane after a standard claim writes one replanned without polish` — manifest `{ lane: 'unknown', ceremonyProfile: 'fast-lane' }`, ref `'ceremony-profile'`: one event, `kind === KIND.REPLANNED`, `station === STATION.BUILD`, `payload.stations` deep-equals `STARTING_LISTS['fast-lane']`, `payload.reasonCode === REASON.CEREMONY_DOWNGRADE`, `payload.cause` deep-equals `{ kind: 'config', ref: 'ceremony-profile' }`, `recordNumber === 7`, `runId === 'r1'`, `repoName === 'acme/w'`, `lane === 'unknown'`.
  - `fixing the profile to standard after a fast-lane plan writes one replanned with reason other` — log: `planned` with `STARTING_LISTS['fast-lane']`; manifest profile `standard` → one event, `payload.reasonCode === REASON.OTHER`, `payload.reasonText === 'ceremony profile standard'`, `payload.stations` deep-equals `STARTING_LISTS.standard`.
  - `fixing the profile to standard after a standard claim writes nothing` → returns 0.
  - `replanRun uses the replanned list as before` — log: `planned` standard then `replanned` fast-lane; manifest profile fast-lane → returns 0.
  - `setting the lane to driver after a standard claim writes one replanned` — manifest `{ lane: 'driver', ceremonyProfile: null }`, ref `'lane'` → one event, `payload.stations` deep-equals `STARTING_LISTS.driver`, `payload.cause.ref === 'lane'`.
  - `a claim line with lane driver keeps the driver list` — `planned` line `lane: 'driver'` with `STARTING_LISTS.driver`; manifest `{ lane: 'standard', ceremonyProfile: 'standard' }` → returns 0.
  - `replanRun without a stationEvent function reads nothing and returns 0` — pass `fs` whose `readFileSync` throws; assert 0 and the fs was never called.
  - `a throwing sink never throws out of replanRun` — two records with a standard plan, manifest fast-lane, sink that throws on the first call → no throw, the sink was called twice.

- [ ] **Step 2: Run** `node tools/run-tests.js tests/bin-lib/station-events/replan.test.js`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `plugin/bin/lib/station-events/replan.js` per the Interfaces block. Read with `(deps.fs || fs).readFileSync(stationEventPath(mainRoot), 'utf8')` inside try/catch (no `existsSync`/`realpathSync`: the path-guard conformance scan refuses them). Header comment names #6148, `docs/reference/station-events.md`, and that the only emitting caller is the Manifesto (wrap-up and express changes go through the `set-config.js` CLI, which passes no sink).

- [ ] **Step 4: Run** `node tools/run-tests.js tests/bin-lib/station-events/replan.test.js tests/bin-lib/station-events/plan.test.js tests/bin-lib/station-events/station-literal-conformance.test.js tests/path-guard-conformance.test.js`. Expected: PASS.

- [ ] **Step 5: Real-input probe** (scratch, not committed): `node -e` requiring the new module with the absolute path, calling `latestPlans({ mainRoot: '/Users/thomasholknielsen/Code Workspaces/claude-tweaks', runId: '2026-11-24T092648-record-6148' })` and printing `[...map]`. Expected: exactly one entry, `6148`, `repoName` `thn-inc/claude-tweaks`, lane `unknown`, the 11-station standard list (the claim's real `planned` line, `at` 2026-11-24T09:29:17.118Z). Independent count: `grep -c '"runId":"2026-11-24T092648-record-6148"' "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/station-events.jsonl"` piped through a second `grep -c '"kind":"planned"'` on the same lines prints 1. Record both outputs in the task report.

- [ ] **Step 6: Commit** `git add` both files by path; message `Add the station-event replan reader — refs #6148`.

### Task 2: Emit from the Manifesto's profile and lane writes; retire the express hook; document

**Files:**
- Modify: `plugin/bin/lib/set-config/write.js` (remove `replan`, `manifestBefore`, `emitReplan`; `setConfigLever({ runDir, key, value, stationDeps })`)
- Modify: `plugin/bin/lib/flow/manifesto-write.js` (`writeManifesto`)
- Modify: `docs/reference/station-events.md`
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/station-events/` line: plan.js also holds `replanEvent` (#6148); add `replan.js` (#6148: `latestPlans`, `replanRun` — the `replanned` line the Manifesto write emits when it changes a claimed record's stations); add `lib/flow/manifesto-write.js` to the producer list, noting it is the one site that supplies the real sink itself)
- Test: `tests/bin-lib/set-config/write.test.js`
- Test: `tests/bin-lib/set-config/cli.test.js`
- Test: `tests/bin-lib/flow/manifesto-write.test.js`

Waived `plugin/bin/lib/express/cli.js`: read only — its `configSet` `ceremony-profile=fast-lane` is applied by the express route through the `set-config.js` CLI, which passes no sink, so under Q3 it writes nothing; Step 3's doc line records it as a coverage gap.
Waived `plugin/bin/lib/run-manifest/write.js`: unchanged (Q3).
Waived `plugin/bin/manifesto-write.js`: unchanged (Q3); its `writeManifesto(..., { mkdir })` call passes no `stationEvent`, so the library default sink applies.

Dependency-caller enumeration: `setConfigLever` callers — `plugin/bin/set-config.js` (no `stationDeps`: unchanged behaviour), `writeManifesto`, and tests in `tests/bin-lib/set-config/write.test.js`, `tests/bin-lib/flow/manifesto-write.test.js` (both listed). `writeManifesto` callers — `plugin/bin/manifesto-write.js` and `tests/bin-lib/flow/manifesto-write.test.js`; the new default sink reads the log under `mainCheckoutRoot(runDir)`, which for those tests' scratch or `gitRepo` fixture run dirs holds no `planned` line for the fixture run id, so they write nothing and need no stub. Grep `tests/` for `writeManifesto(` and `manifesto-write` once more in Step 4 and add any other module found here.

**Interfaces:**
- Consumes: `replanRun` (Task 1).
- Produces:
  - `setConfigLever({ runDir, key, value, stationDeps? })` — for `key === 'ceremony-profile'`, after its existing `fillRunManifest` call, when `stationDeps` is an object with a `stationEvent` function: read `manifest.json` from `runDir` (try/catch; no manifest → no replan) and call `replanRun({ runDir, manifest: { lane, ceremonyProfile }, ref: 'ceremony-profile', deps: stationDeps })`. Return value unchanged (`{ file, previous }`).
  - `writeManifesto(input, deps)` — `stationDeps = { stationEvent, sessionId: process.env.CLAUDE_CODE_SESSION_ID || null, mainRoot: deps.stationMainRoot }` where `stationEvent = deps.stationEvent === undefined ? (e) => appendStationEvent(e, { mainRoot: deps.stationMainRoot ?? mainCheckoutRoot(runDir) }) : deps.stationEvent` (`null` disables). Passes `stationDeps` to every `set({ runDir, key, value, stationDeps })`; after its existing lane fill, reads `manifest.json` and calls `replanRun({ ..., ref: 'lane', deps: stationDeps })`, wrapped. Return value and decisions.md lines unchanged.

- [ ] **Step 1: Write the failing tests** (seed manifest with `initRunManifest` as the files' existing tests do; temp `mainRoot` = the scratch root above the run dir, with a `planned` line for `runId = path.basename(runDir)`, #7, `STARTING_LISTS.standard`, `lane: 'unknown'`)
  - `write.test.js`: replace the two `replan:` tests with: AC1.3 `downgrading the ceremony profile on a claimed record writes one replanned with reason ceremony-downgrade` (`setConfigLever({ ..., value: 'fast-lane', stationDeps: { stationEvent, mainRoot } })`; one event, `reasonCode === 'ceremony-downgrade'`, `cause.kind === 'config'`, `stations` without `polish`); `fixing the profile to standard after a standard claim writes nothing via setConfigLever`; `setConfigLever without stationDeps writes no event` (same seeded log, real-file check: the log's line count is unchanged).
  - `cli.test.js`: `a ceremony change during wrap-up writes no replanned` — the run dir under a scratch main root (create `.git` as a directory so `mainCheckoutRoot` resolves it) whose log holds a `fast-lane` `planned` line for the run id; config.yml already carrying `ceremony-profile: fast-lane`; run the CLI in-process the way the file's existing tests do with `--run {runDir} --key ceremony-profile --value standard`; assert exit 0, config.yml now `standard`, and the log file byte-identical to before.
  - `manifesto-write.test.js`: `writeManifesto with a fast-lane ceremony after a standard claim writes one replanned` (`deps.stationEvent` collecting, `deps.stationMainRoot` = scratch root; exactly one event — the later lane fill adds none — `payload.cause.ref === 'ceremony-profile'`); `writeManifesto with a standard ceremony after a standard claim writes nothing`; `a throwing stationEvent leaves writeManifesto's result, config.yml and decisions.md as with stationEvent null` (compare the returned table and both files' bytes across the two runs on fresh fixtures).

- [ ] **Step 2: Run** `node tools/run-tests.js tests/bin-lib/set-config/write.test.js tests/bin-lib/set-config/cli.test.js tests/bin-lib/flow/manifesto-write.test.js`. Expected: FAIL on the new manifesto and setConfigLever emitting tests (the wrap-up CLI test and the no-sink test may already pass — they pin behaviour that must not change).

- [ ] **Step 3: Implement** the two call sites and the removals above. Update `docs/reference/station-events.md`:
  - Producers table: a `replanned` row — producer `lib/flow/manifesto-write.js` (`writeManifesto`, via `lib/set-config/write.js`'s `setConfigLever` for the `ceremony-profile` lever and after its own lane fill), per record holding a `planned` line for the run whose stations change; kind `replanned`; station `build`; outcome none; payload keys `stations`, `reasonCode` (`ceremony-downgrade` when a station is removed, else `other` with `reasonText`), `cause` (`{ kind: 'config', ref: 'ceremony-profile' | 'lane' }`); the line's lane is the `planned` line's; discriminator `replanned:{after joined}:{at}`.
  - `### Kinds`: "only `planned` has a producer today (`claim-targets.js`)" → `planned` (`claim-targets.js`) and `replanned` (the Manifesto write) have producers today.
  - `## Starting lists`: "A `replanned` event (emission 4/8) corrects it when the Manifesto or ceremony verdict fixes the profile or lane." → names the Manifesto write as the producer and that `before` is the latest `planned`/`replanned` line for the record and run.
  - `### Holds and plan changes`, the ceremony-profile bullet: say the Manifesto's `setConfigLever` call now writes the replan, and the `set-config.js` CLI does not.
  - `## Coverage gaps`, two new bullets, verbatim: "A ceremony-profile change made at wrap-up is not recorded as a replan." and "A lane or profile change made through the express gate or the driver's adoption is not recorded as a replan."

- [ ] **Step 4: Run** `node tools/run-tests.js tests/bin-lib/set-config/write.test.js tests/bin-lib/set-config/cli.test.js tests/bin-lib/flow/manifesto-write.test.js tests/bin-lib/station-events/ tests/bin-lib/run-manifest/write.test.js`. Expected: PASS. Then `git grep -n -E 'replan:|emitReplan|manifestBefore' -- plugin tests` prints nothing (control: the same grep before Step 3 printed the write.js and write.test.js hits).

- [ ] **Step 5: Commit** by path; message `feat: write replanned when the Manifesto changes a claimed record's stations — refs #6148`.
