# Station Transition Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document in `docs/reference/station-events.md` which code performs each station transition, the station order confirmed from real moves, and the starting lists real manifests show, pinned by one table-parsing test.

**Architecture:** Documentation capture plus one `node:test` suite that parses the three new markdown sections and checks them against `STATIONS` (`plugin/bin/lib/station-events/stations.js`) and the files under `plugin/bin/`. No emitter behaviour changes: the confirmed order equals `STATION`'s order, so the spec's conditional reorder (its Step 5) does not fire.

**Tech Stack:** Node.js (CommonJS), `node:test`, `node:assert/strict`.

**Spec:** `.claude-tweaks/pipelines/2026-11-23T160956-record-6145/work/6145-spec.md` (re-materialized with the record's `## Decisions` section; supersedes the `2026-11-23T155325` copy)

Scope keywords: Transition code by station, Station order from real moves, Starting lists

## Global Constraints

- The station order is the confirmed one from this task, not the order in `STATION` by assumption.
- A list not observed in real manifests is not written.
- Emission never blocks or fails a transition; this task changes no emission path.
- No skill prose changes.
- Starting-list precedence is lane first (spec Decisions, Q1): a lane of `driver` selects `driver`; otherwise a ceremony profile of `fast-lane` selects `fast-lane`; otherwise `standard`.
- The doc is the report to the hub plan's Task 4 (spec Decisions, Q2): no comment, post or cross-repository write.

## Review Focus

- A `path:function` cell naming a function that exists only in a comment, a call site or another file: the test must check the named file (full repo-relative `plugin/bin/...` path) *defines* the function — a `function name`, `const|let|var name =`, or method-shorthand `name(...) {` definition — not merely mentions the name.
- A station row duplicated or a station missing: the test asserts the row set equals `STATIONS` exactly (no extra, no duplicate).
- A future reorder of `STATION` without a doc update: the order test asserts the confirmed-order line equals `STATIONS` in order, so it goes red.
- A cell holding prose next to a path: a cell is exactly `none` or a `; `-separated list of backticked `plugin/bin/...js:fn` entries; anything else fails.
- The sections' position in the file: parsing is by `## ` heading, so a section is read up to the next `## ` heading only.

---

### Task 1: Capture pass — transition table, confirmed order, starting lists

**Role:** integration

**Files:**
- Modify: `docs/reference/station-events.md` (add three sections after `## Stations`)
- Test: `tests/bin-lib/station-events/transition-table.test.js` (Create)
- Waived `plugin/bin/lib/station-events/stations.js`: read only — Step 5 compares `STATION`'s order with the confirmed order; they are equal, so it is not modified.

**Interfaces:**
- Consumes: `STATIONS` from `plugin/bin/lib/station-events/stations.js`.
- Produces (read by emission Tasks 3, 4, 6, 7):
  - `## Transition code by station` — a markdown table with header row exactly `| station | code that performs the transition (path:function) | kinds emitted today | outcome known to the code | reason known to the code |`, one row per `STATIONS` entry, station cell a backticked id. Code cell: exactly `none`, or one or more `` `plugin/bin/<path>.js:<function>` `` entries separated by `; `. Followed by a `### Holds and plan changes` sub-section (prose list) naming the code that adds `bot:blocked` (`plugin/bin/lib/driver/settle.js`), `bot:parked` (`plugin/bin/lib/driver/merge.js`), and `accept:changes-requested` (`plugin/bin/lib/issues/accept-entry.js` prints it; skill prose applies it), and the code that changes a claimed record's ceremony profile (`plugin/bin/lib/set-config/write.js`, the `ceremony-profile` branch that calls `fillRunManifest`; `plugin/bin/lib/express/cli.js` writes `ceremony-profile=fast-lane` for an express run). Name each with its enclosing function, found by reading the file.
  - `## Station order from real moves` — contains exactly one line starting `Confirmed order: ` followed by the 11 backticked station ids joined by ` → `, plus the counts it rests on (below), and a sentence stating that the Polish-to-Test pairs measure a `simplify` segment inside build and are not returns (spec's added AC). It also states that this section and `## Starting lists` on `main` are the report the hub plan's Task 4 (`thn-inc/dispatch` H4) reads.
  - `## Starting lists` — a table `| list | stations | selected by |` with one row per observed list (below), followed by the spec's precedence sentence verbatim: `A lane of \`driver\` selects the list \`driver\`; otherwise a ceremony profile of \`fast-lane\` selects \`fast-lane\`; otherwise the list is \`standard\`. An absent or unknown lane with an absent profile is \`standard\`, and the \`planned\` event carries reason \`default-list\`.` plus one sentence that the lane `express` was not observed and follows the same rule.

**Evidence already gathered (use verbatim; do not re-query).** Raw output (prior run, archived): `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-11-23T155325-record-6145/evidence/station-order-pairs.txt` and `.../evidence/starting-lists-manifests.txt`.

- Hub node database (local hub Postgres, table `station_visits`, query: `lead(station) over (partition by work_order_key order by entered_at, id)`, last 28 days, pairs with n >= 10, run 2026-11-23): 14,899 visits over 3,196 work orders. Pairs: intake→shape 3132, shape→authorize 3132, release→build 1920, authorize→release 1467, build→release 469, authorize→intake 213, build→intake 212, build→build 166, polish→test 138, test→wrap-up 130, wrap-up→build 123, build→polish 112, wrap-up→wrap-up 105, build→accept 79, wrap-up→polish 62, polish→wrap-up 60, build→wrap-up 33, test→test 22, intake→intake 21, build→authorize 19, release→authorize 14, release→polish 14, authorize→build 13, test→polish 11. Visits per station: authorize 3167, intake 3154, shape 3132, release 2322, build 2295, wrap-up 336, polish 199, test 173, accept 122; `review` and `merge` have 0 visits.
- Reading the counts (write this into the section): the hub opens a Polish visit on a session `simplify` segment (`hub/packages/core/src/stations.ts` in `thn-inc/dispatch`: polish `workStarts` is "a `simplify` segment opens"; its own `startsWaiting` note says "`simplify` also opens before `test`"). `/claude-tweaks:build` runs `/claude-tweaks:simplify` at its Common Step 3, before its final verification and before `/claude-tweaks:test`. So Polish→Test 138 vs Test→Polish 11 measures simplify-inside-build followed by test, not an Impeccable polish pass ahead of test. In claude-tweaks' own code paths Test comes before Polish: `/flow`'s default step list is `build,test,review,polish,wrap-up` (polish then re-runs `test skip-qa` as re-verify), and the driver's steps run `worker, test, review, pr, ci, merge` (`plugin/bin/lib/driver/events.js` `STEP_NAMES`) with no polish step. Review and merge have no visits because the hub leaves them unconfirmed (no session or driver key maps to them in 28 days). Answer: **Test comes before Polish.**
- Confirmed order (equal to `STATION`): `intake` → `shape` → `authorize` → `release` → `build` → `test` → `review` → `polish` → `wrap-up` → `merge` → `accept`. State that `STATION` was not reordered and that this order is what the hub plan's Task 4 takes.
- Manifests (`.claude-tweaks/pipelines/**/manifest.json`, 306 files, 2026-11-21 to 2026-11-23): lane/ceremonyProfile pairs — absent/absent 223 (pre-field manifests), standard/standard 47, unknown/null 31, driver/standard 3, driver/fast-lane 1, standard/fast-lane 1; `express` lane not observed.
- Starting lists to write (three rows; `express` is not written), lane first:
  - `driver`: every station except `polish` (the driver has no polish step); selected by lane `driver`, whatever the ceremony profile (observed: `driver`/`standard` 3, `driver`/`fast-lane` 1).
  - `fast-lane`: every station except `polish` (`_shared/ceremony-profile.md`'s `polish` row skips it under fast-lane); selected by `ceremonyProfile: fast-lane` on any lane other than `driver` (observed: `standard`/`fast-lane` 1).
  - `standard`: all 11 stations; selected otherwise — `ceremonyProfile: standard`, or a null/absent profile on lane `standard`, `unknown` or absent (an absent or unknown lane with an absent profile carries reason `default-list` on the `planned` event).
- Per-station code (verify each by reading; enclosing function names were found by reading the files):
  - `intake`, `shape`: `plugin/bin/apply-refine-labels.js:emitLabelTransitions` (`exited` `passed` on `needs:definition` removed / `ready` added).
  - `authorize`: `apply-refine-labels.js:emitLabelTransitions` (`entered` on `ready`, `exited` `passed` on `auto:build`); `plugin/bin/lib/station-events/blockers.js:makeBlockerSnapshotSink` (`blockers`).
  - `release`: `apply-refine-labels.js:emitLabelTransitions` (`entered` on `auto:build`); `plugin/bin/lib/claim-targets/claim-targets.js:emitInProgressTransition` (`exited` `passed`).
  - `build`: `claim-targets.js:emitStation` (`session_bound`), `emitInProgressTransition` (`entered`), `emitRollbackExit` (`exited` `abandoned`, reason `never-started: …`); `plugin/bin/release-claim.js:run` (`exited`, outcome from the release reason); `plugin/bin/accept-park.js:parkSteps` (`exited` `passed`, reason `awaiting-local-acceptance`); `plugin/bin/pr-early-open.js:run` (`started`, `pr_opened`); `plugin/bin/lib/station-events/driver-mirror.js:stationEventsFor` (`worker` step `started`/`exited`, `session_bound`).
  - `test`, `review`, `wrap-up`, `merge`: `driver-mirror.js:stationEventsFor` (driver `test`, `review`, `pr`, `ci`/`merge` steps and merge sub-steps). Outcome from step status (`ok`/`fail`/`stop`); reason: none beyond the step's status.
  - `polish`: `none`.
  - `accept`: `accept-park.js:parkSteps` (`entered`).

- [ ] **Step 1: Write the failing test** `tests/bin-lib/station-events/transition-table.test.js`

Read `tests/bin-lib/station-events/stations.test.js` for the suite's require and naming style. Helpers: `section(md, heading)` returns the text from the `## {heading}` line to the next `^## ` line (throws a clear message when absent); `tableRows(text)` returns the cells of each markdown table row after the header and separator, trimmed. Tests (names cite the spec's ACs):

```js
test('AC1.1 every station has a row in the transition table', () => {
  const rows = tableRows(section(doc, 'Transition code by station'));
  const ids = rows.map((r) => r[0].replace(/`/g, ''));
  assert.deepEqual([...ids].sort(), [...STATIONS].sort());
  assert.equal(new Set(ids).size, ids.length);
});
test('AC1.2 every cited code path exists', () => {
  // each code cell (column 2) is exactly 'none' or entries joined by '; ',
  // each matching /^`(plugin\/bin\/[^`:]+\.js):([A-Za-z_$][\w$]*)`$/ (full repo-relative path);
  // the file exists (path from repo root) and *defines* fn: its text matches
  // new RegExp(`(?:\\bfunction\\s*\\*?\\s*${fn}\\s*\\(|\\b(?:const|let|var)\\s+${fn}\\s*=|^\\s*(?:async\\s+)?${fn}\\s*\\([^)]*\\)\\s*\\{)`, 'm').
});
test('AC1.3 the order section names every station once', () => {
  // exactly one line starting 'Confirmed order: '; backticked ids split on ' → ';
  // each STATIONS id appears exactly once; the list deepEquals STATIONS (order pinned).
});
test('AC2.1 AC2.2 the starting lists section lists observed lists only', () => {
  // `## Starting lists` table rows: list ids are exactly ['standard', 'fast-lane', 'driver'];
  // each stations cell's backticked ids are a subsequence of STATIONS; `standard` equals STATIONS.
});
test('AC3 the precedence sentence and the simplify reading are stated', () => {
  // `## Starting lists` contains the spec's precedence sentence verbatim (lane first, `default-list`);
  // `## Station order from real moves` contains a sentence naming Polish-to-Test, `simplify`
  // and "not returns" (match /Polish-to-Test[^.]*`simplify`[^.]*not returns/).
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tools/run-tests.js tests/bin-lib/station-events/transition-table.test.js`
Expected: FAIL (sections missing)

- [ ] **Step 3: Capture.** Add the three sections to `docs/reference/station-events.md` directly after `## Stations`, from the evidence above, reading each cited file to confirm its function name and what it emits. Also update the doc's opening code paragraph's "Tests:" mention to include the new test file.

- [ ] **Step 4: Run** the Step 2 command. Expected: PASS. Then run `node tools/run-tests.js tests/bin-lib/station-events`. Expected: PASS.

- [ ] **Step 5: Order check.** The confirmed order equals `STATION`'s order in `stations.js`, so `STATION` is not reordered; the `## Station order from real moves` section says so. (If reading `stations.js` shows otherwise, stop and report.) Reporting to the hub plan's Task 4 is the doc section itself (spec Decisions, Q2) — no other action.

- [ ] **Step 6: Commit**

```bash
git add docs/reference/station-events.md tests/bin-lib/station-events/transition-table.test.js
git commit -m "Capture station transition code, order and starting lists — refs #6145"
```
