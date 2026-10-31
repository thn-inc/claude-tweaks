# Closed-Parent Acceptance Backstop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tidy surfaces a decomposition parent that was closed by hand above the oversight floor with no acceptance disposition, on both work-record drivers, and keeps a parent closed by #4466's below-floor close excluded.

**Architecture:** The parent-gate sweeps already fetch every parent's sub-issues with their `risk:*` labels and compute the aggregate floor. They are GitHub's `parent-gate` scope (`_shared/github-pr-scan-acceptance.md`) and local-files Shape 7 (`tidy/step-1-records.md`). Both sweeps now also take in closed parents from the last 30 days that carry no disposition. A closed parent whose sub-issue aggregate exceeds the risk floor prints the standard `[acceptance-gap]` row, recommending `/claude-tweaks:demo`. `needsBackstop` gains a `parentExceedsFloor` field, so it stays the one place the disposition, not-planned and parent rules are classified. The `acceptance-gap` scope and Shape 8 keep excluding parents (their callers never pass the new field), so no parent is reported twice.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose with executable `node -e` fences.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T074012-record-4600/work/4600-spec.md` (record #4600)

## Global Constraints

- The row is exactly the existing `[acceptance-gap]` form, so tidy routes it like every other acceptance gap (`tidy/collection-routing.md`: Yours, no-op, staged at every tier). GitHub: `[acceptance-gap] #{n}: {title} — closed with no acceptance disposition — recommend /claude-tweaks:demo #{n}`. local-files: `{path}<TAB>[acceptance-gap] {id}: {title} — closed with no acceptance disposition — recommend /claude-tweaks:demo {id}`.
- The parent floor uses the existing rule: the max `risk:*` tier across sub-issues against `risk-floor`, with `sizeFloor: null`. A single unscored sub-issue fails closed (exceeds).
- The closed-parent window is the `acceptance-gap` scope's own. GitHub: server `closed:>=$SINCE` (31-day `{since-date}`), then a strict 30-day client `closedAt` cutoff. local-files: keep a missing or unparseable `closedAt`, as Shape 8 does.
- The closed-parent GitHub fetches carry the byte-identical `--search` string of the `acceptance-gap` closed-record fetch: `closed:>=$SINCE -reason:\"not planned\" -reason:duplicate -label:demo:approved -label:demo:changes-requested -label:demo:pending`.
- Do not add a new `if (fetched.some((f) => …)) {` site to `github-pr-scan-acceptance.md`. `tests/acceptance-scan-server-filter.test.js` pins exactly three. The closed-parent fetch files join the existing `fetched` array of the parent-gate fetch block.
- A gate object with no `state` field (or `closed` field) is an open parent. `tests/below-floor-parent-close-conformance.test.js`'s AC3.1 fixtures carry none, and their output must not change.
- Governing skill `skill-prose-conformance-tests` (`.claude/skills/skill-prose-conformance-tests/executable-snippet-pins.md`), quoted: "When the fence does run against a fixture, give it a row that only the clause under test drops." and "Extract the one line or expression and run it with `new Function`, injecting what it reads". Tests run the live fences against fixtures, never a regex over the fence text alone.
- Byte rail (`RAIL_BYTES` = 52,500): `_shared/github-pr-scan-acceptance.md` is 46,898 B, so Task 2 may add at most ~3,000 B. `tidy/scan-procedures.md` is 51,208 B, so Task 2 adds at most one sentence (≤ 250 B). `tidy/step-1-records.md` is 36,950 B and `tidy/SKILL.md` is 43,046 B; both have room. Re-run `wc -c` after each task and record the headroom in the commit body.
- Commit subjects use `{Verb} {what} — {detail}` and reference the record as `refs #4600`. Never use `closes`/`fixes`.

## Review Focus

1. A closed parent below the floor with no #4466 comment (hand-closed below the floor) prints no row. No sign-off is owed below the floor (Task 2 and Task 3 fixtures: `hand-closed below floor`).
2. A closed parent above the floor whose sub-issue is still open still prints the gap row. It was closed by hand, so the `due` filter must not gate closed parents (Task 2 and Task 3 fixtures).
3. A closed parent above the floor but closed not planned prints no row (`needsBackstop`'s NOT_PLANNED exclusion, both drivers).
4. A parent closed more than 30 days ago prints no row. GitHub: client cutoff in the fetch block. local-files: a `closedAt` older than 30 days (Task 2 fetch-block test, Task 3 fixture).
5. A parent present in both the `parent-issue` and legacy `family:parent` fetches appears once (number-keyed dedup over all four files, Task 2 fetch-block test).

---

### Task 1: `needsBackstop` admits a closed parent above the floor

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/acceptance.js:88-97` (`needsBackstop`)
- Test: `tests/bin-lib/issues/acceptance.test.js` (append after the `AC4.1: needsBackstop excludes a decomposition parent` test)

**Interfaces:**
- Produces: `needsBackstop({ state, labels, hasParent, isParent, parentExceedsFloor, stateReason }) -> boolean`. With `isParent: true` it returns `false` unless `parentExceedsFloor === true`, then applies the existing disposition and not-planned rules. Absent `parentExceedsFloor` keeps today's behavior: every parent is excluded.

- [ ] **Step 1: Write the failing test**

```js
test('AC1.1: needsBackstop admits a closed parent the caller shows above the floor', () => {
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: true, parentExceedsFloor: true }), true);
  // The disposition and not-planned rules still apply to that parent.
  assert.equal(needsBackstop({ state: 'CLOSED', labels: ['demo:approved'], isParent: true, parentExceedsFloor: true }), false);
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: true, parentExceedsFloor: true, stateReason: 'NOT_PLANNED' }), false);
  assert.equal(needsBackstop({ state: 'OPEN', labels: [], isParent: true, parentExceedsFloor: true }), false);
});

test('AC2.1: needsBackstop keeps a parent at or below the floor excluded', () => {
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: true, parentExceedsFloor: false }), false);
  // Only literal true admits: a truthy non-boolean is not the caller's floor verdict.
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: true, parentExceedsFloor: 'true' }), false);
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: true }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/acceptance.test.js`
Expected: FAIL after Step 1. The AC1.1 test's first assertion is `false !== true`.

- [ ] **Step 3: Implement**

In `needsBackstop`, replace `if (record.isParent === true) return false;` with `if (record.isParent === true && record.parentExceedsFloor !== true) return false;`. Rewrite its comment (two or three lines): a decomposition parent's acceptance is the parent gate's. Below the oversight floor that gate closes the parent with no disposition owed (#4466); above it the disposition is `/claude-tweaks:demo`'s. So a closed parent is a gap only when its caller (the parent-gate sweep) shows its sub-issue aggregate exceeds the floor (#4600).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/acceptance.test.js`
Expected: PASS, every test, including the existing `AC4.1` one.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/acceptance.js tests/bin-lib/issues/acceptance.test.js
git commit -m "Admit above-floor closed parents in needsBackstop — parentExceedsFloor field, refs #4600"
```

### Task 2: GitHub `parent-gate` scope reports a hand-closed above-floor parent

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan-acceptance.md`. Changes, by section:
  - `## Scope: acceptance-gap`, the paragraph at ~94-97. Reword the `isParent` clause: `isParent` keeps every parent out of this scope's rows, because the `parent-gate` scope below owns parents, open and closed, and itself reports a closed parent above the oversight floor with no disposition as an `[acceptance-gap]` row (#4600). Keep the code line `isParent: parseRecordFacets(r.labels).isParentIssue,` byte-identical; it is pinned.
  - `## Scope: parent-gate`, opening paragraph (~358-363) and the `Record set:` sentence (~384-386). Add the closed set: parents closed in the last 30 days with no disposition and not closed not-planned/duplicate.
  - The parent-gate fetch block (~433-473), detailed in Step 3.
  - The failure sentence after the fetch block (~475-478) also names the since-date guard. Keep `the state-map-search` … `throws` and `report no \`[parent-gate]\` rows at all` within 300 chars of each other; `tests/acceptance-scan-server-filter.test.js` pins that window.
  - The three gate composers: body-text (~510-525), native (~560-576) and Fallback (~606-633). Detailed in Step 3. Update the "converge on the same … shape" sentence (~636-638) to list `state` and `stateReason`.
  - The `### Oversight-floor pre-filter` code block (~660-686) and one new paragraph after the `[parent-gate]` severity paragraph. The paragraph covers the closed-parent row: same row, severity `info` and routing as `acceptance-gap`, mutates nothing, recommends `/claude-tweaks:demo #{n}`. Below the floor no row, since #4466's close owes no sign-off.
- Modify: `plugin/skills/tidy/scan-procedures.md`. Add one sentence (≤ 250 B) to the end of the `The \`parent-gate\` scope finds …` paragraph: it also reports a parent closed in the last 30 days with no disposition and sub-issue risk above the oversight floor as an `[acceptance-gap]` row (#4600). No new Collect line, because the row is the existing `[acceptance-gap]` form.
- Modify: `docs/skill-graph.md:635`. After `and a parent's acceptance is the parent gate's (a below-floor parent closes with no \`demo:*\` label by design, #4466)`, add: the parent-gate sweep itself reports a closed parent above the floor with no disposition as an `[acceptance-gap]` row (#4600).
- Modify: `docs/journeys/close-a-below-floor-decomposition-parent-4466.md:74`. The "Should understand" line reads: `needsBackstop` skips a decomposition parent unless the parent-gate sweep shows it closed above the floor, because a parent's acceptance belongs to the parent gate.
- Test: `tests/closed-parent-acceptance-backstop.test.js` (create; style of `tests/below-floor-parent-close-conformance.test.js`, reusing its `section`/`extractNodeScripts`/`scanScript`/`mkTmp` shapes copied locally)

**Interfaces:**
- Consumes: `needsBackstop` with `parentExceedsFloor` (Task 1).
- Produces: gate objects in the session-scoped `tidy-parent-gates.json` shaped `{number, title, parentLabels, state: 'OPEN'|'CLOSED', stateReason: string|null, subIssues:[{number,state,labels}]}`. New session-scoped files: `tidy-closed-parent-issues-new.json`, `tidy-closed-parent-issues-legacy.json`.

- [ ] **Step 1: Write the failing tests** in `tests/closed-parent-acceptance-backstop.test.js`

Constants: `const GAP_TAIL = ' — closed with no acceptance disposition — recommend /claude-tweaks:demo ';` and `PG = section(read('_shared/github-pr-scan-acceptance.md'), '## Scope: \`parent-gate\`', null)`.

1. `AC1.1: the GitHub parent-gate scan prints an acceptance-gap row for a hand-closed above-floor parent`. Run the scan script (`scanScript(PG, "'[parent-gate] #'")`, `$GATES` → fixture, argv `-- high`) over these gates (sub-issue helper as in the below-floor test):
   - #1 `Open high parent`: open, no `state` field, sub risk:high closed → `[parent-gate] #1: Open high parent — parent complete, no acceptance disposition — Open parent gate, then /claude-tweaks:demo #1`
   - #2 `Closed high parent`: `state:'CLOSED', stateReason:'COMPLETED'`, subs risk:high and risk:low closed → `[acceptance-gap] #2: Closed high parent` + GAP_TAIL + `#2`
   - #3 `Closed unscored parent`: CLOSED/COMPLETED, one unscored sub → acceptance-gap row for #3
   - #4 `Closed high parent, open sub`: CLOSED/COMPLETED, subs risk:high CLOSED and risk:low OPEN → acceptance-gap row for #4
   - #5 `Closed high not planned`: CLOSED/NOT_PLANNED, sub risk:high → no row
   - #6 `Closed high approved`: CLOSED/COMPLETED, `parentLabels:['demo:approved']`, sub risk:high → no row

   Assert the exact output array `[#1 row, #2 row, #3 row, #4 row]`.
2. `AC2.1: the GitHub scan prints no row for a parent closed below the floor`. Same runner over:
   - #7 `Closed below floor`: CLOSED/COMPLETED, subs risk:medium and risk:low, the #4466 close shape → no row
   - #8 `Hand-closed below floor`: CLOSED/COMPLETED, sub risk:medium → no row
   - #9 control `Closed above floor`: identical to #7 but one sub is risk:high → acceptance-gap row

   Assert output equals exactly the #9 row. That row is what proves the floor, not the fixture, excludes #7.
3. `AC1.1: the parent-gate fetch block merges open and closed parents inside the 30-day window`. Extract the PG node script carrying `process.env.STATE_SEARCH` (exactly one). Substitute `$PI_NEW`, `$PI_LEG`, `$PC_NEW`, `$PC_LEG`, `$ALL_STATES`, `$PARENTS` with fixture paths (replace longer names first). Run with env `{ FETCH_LIMIT: '500', STATE_SEARCH: '', SINCE: day(31) }`. The fixtures use real `gh issue list --json` shapes, probed on this repo: closed rows look like `{"number":3979,"state":"CLOSED","stateReason":"COMPLETED","closedAt":"2026-10-27T06:05:03Z","labels":[{"name":"parent-issue"}], ...}`.
   - PI_NEW: open #10.
   - PI_LEG: open #10 duplicate.
   - PC_NEW: closed #11 with closedAt 5 days ago, and closed #12 with closedAt 40 days ago.
   - PC_LEG: closed #11 duplicate.
   - ALL_STATES: `[]`.

   Assert `$PARENTS` holds numbers `[10, 11]` (sorted) and #11 keeps `state: 'CLOSED'`.
4. `AC1.1: the closed-parent fetches carry the acceptance-gap search string`. Extract every `--search "…"` argument following a `gh issue list --label (parent-issue|family:parent) --state closed` line in PG. Assert there are exactly 2, and each equals the `acceptance-gap` closed-record fetch's search string (`--search "…"` after `gh issue list --state closed` in the `acceptance-gap` section).
5. `AC1.1: the parent-gate since-date guard throws on bad values and passes good ones`. Take the PG line containing `process.env.SINCE` and `throw new Error` and evaluate it with `new Function('process', line)({ env })`. `day(31)` passes. `''`, `'{since-date}'` and `day(29)` throw. Control: the `if (!`→`if (` inversion throws on `day(31)`.
6. `AC1.1: every gate composer carries the parent's state`. Run the body-text composer (PG script carrying `parseSubIssues(p.body)`) with `$PARENTS`/`$ALL_STATES`/`$GATES` fixtures. Run the native composer (PG script carrying `batch.byParent`) with `$PG_BATCH` too. Each parent fixture has `state:'CLOSED', stateReason:'COMPLETED'`, so assert `gates[0].state === 'CLOSED'` and `gates[0].stateReason === 'COMPLETED'`. For a parent row with no `state`, assert `state === 'OPEN'` and `stateReason === null`. For the Fallback composer (it needs `gh`), assert its script text contains `state: p.state || 'OPEN'` and `stateReason: p.stateReason || null`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/closed-parent-acceptance-backstop.test.js`
Expected: FAIL. Test 1 lacks the `[acceptance-gap]` rows, test 3 cannot find `$PC_NEW`, test 4 finds 0 searches, and tests 5 and 6 find no line or field.

- [ ] **Step 3: Implement in `plugin/skills/_shared/github-pr-scan-acceptance.md`**

- **Fetch block.** Resolve `{since-date}` exactly as the `acceptance-gap` scope does (cite it; do not restate its one-liner). Add `PC_NEW`/`PC_LEG` session-tmp paths and `SINCE="{since-date}"` + `export SINCE`. Add `state` to both open fetches' `--json`. Add two fetches `gh issue list --label parent-issue --state closed --limit "$LIMIT" \` + `  --search "<the acceptance-gap string>" \` + `  --json number,title,body,labels,state,stateReason,closedAt`, then the same for `family:parent` under the existing legacy-label comment. In the node block:
  - Add the SINCE guard, copied byte-identical from the `acceptance-gap` block.
  - `fetched` becomes `['$PI_NEW', '$PI_LEG', '$PC_NEW', '$PC_LEG'].map(require)`.
  - Add `const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();`.
  - Build `parents` from `fetched.flat().filter((p) => p.state !== 'CLOSED' || p.closedAt > cutoff)` with the same number-keyed dedup.
- **Three composers.** Add `state: p.state || 'OPEN', stateReason: p.stateReason || null,` to each gate object.
- **Pre-filter block.** Also require `needsBackstop`. Replace the `.filter(...due).forEach(...)` chain with one `gates.forEach((f) => { … })`:
  - Compute `exceeds = exceedsOversightFloor({ risk: maxRiskTier(f.subIssues) }, { riskFloor, sizeFloor: null }).exceeds` once.
  - When `f.state === 'CLOSED'`: print the `[acceptance-gap]` row iff `needsBackstop({ state: 'CLOSED', labels: f.parentLabels, isParent: true, parentExceedsFloor: exceeds, stateReason: f.stateReason })`, then return.
  - Otherwise keep today's `due` test and the two `[parent-gate]` row texts byte-identical, choosing between them with `exceeds`.
- **Prose.** Make the prose edits listed in Files. Cite where needed, never restate.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/closed-parent-acceptance-backstop.test.js tests/below-floor-parent-close-conformance.test.js tests/acceptance-scan-server-filter.test.js tests/fetch-sub-issues-prose-conformance.test.js tests/session-tmp-root-migration.test.js tests/tidy-scan-dispatch-conformance.test.js`
Expected: PASS, all files.

- [ ] **Step 5: Measure, then commit**

Run `wc -c plugin/skills/_shared/github-pr-scan-acceptance.md plugin/skills/tidy/scan-procedures.md`. Both must be under 52500; put the headroom in the commit body.

```bash
git add plugin/skills/_shared/github-pr-scan-acceptance.md plugin/skills/tidy/scan-procedures.md docs/skill-graph.md docs/journeys/close-a-below-floor-decomposition-parent-4466.md tests/closed-parent-acceptance-backstop.test.js
git commit -m "Report hand-closed above-floor parents from the GitHub parent-gate scope — refs #4600"
```

### Task 3: local-files Shape 7 reports a hand-closed above-floor parent

**Role:** integration

**Files:**
- Modify: `plugin/skills/tidy/step-1-records.md`. Changes:
  - Shape 7 code block (~248-288), detailed in Step 3.
  - The `Both \`queryRecords\` shapes are deliberate` paragraph (~294-301). It now describes three queries. The open-parent query is unchanged. A closed-parent query `{ isParentIssue: true, closed: true }` covers the last 30 days and keeps a missing `closedAt`, as Shape 8 does. The sub-issue merge is unchanged. A closed parent is reported as an `[acceptance-gap]` row when its sub-issue aggregate exceeds the floor and it carries no `acceptance` facet. Below the floor, #4466's close owes no sign-off.
  - The Collect line (~303): append the closed-parent form, `` or, for a parent closed above the floor: `[acceptance-gap] {id}: {title} — closed with no acceptance disposition — recommend /claude-tweaks:demo {id}` ``.
  - Shape 8's `isParent` sentence (~352-353): a parent's acceptance is Shape 7's, which reports a closed one above the floor itself (#4600), or the below-floor close (#4466). Never a row here.
- Modify: `plugin/skills/tidy/SKILL.md:98`. `Shape 7 pairs an open-parent query` becomes `Shape 7 pairs an open-parent query and a 30-day closed-parent query`. `keeps every one that is not a decomposed sub-issue — a closed parent surfaces there, only sub-issues are suppressed` becomes `keeps every one that is neither a decomposed sub-issue nor a parent — a closed parent surfaces from Shape 7 instead`.
- Test: `tests/closed-parent-acceptance-backstop.test.js` (append)

**Interfaces:**
- Consumes: `needsBackstop` with `parentExceedsFloor` (Task 1); the test file's helpers (Task 2).
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing tests** (append)

Run the Shape 7 script (`scanScript(section(read('tidy/step-1-records.md'), '### Shape 7 — decomposition parent gate due', '### Shape 8 —'), "'\\t[parent-gate] '")`) in a temp cwd holding `specs/`. Build the records with `local-store.js`'s `writeRecord`/`closeRecord`/`defaultFacets`, as the below-floor test does. Argv is `-- high`.

1. `AC1.1: Shape 7 prints an acceptance-gap row for a hand-closed above-floor local parent`.
   - Parent 1 `Closed high parent`: closed via `closeRecord`, subs risk:high closed → `[acceptance-gap] 1: Closed high parent` + GAP_TAIL + `1`.
   - Parent 2 `Closed high, open sub`: closed, subs risk:high closed and risk:low open → acceptance-gap row for 2.
   - Parent 3 `Closed high not planned`: closed with `notPlanned: true`, sub risk:high → no row.
   - Parent 4 `Closed high approved`: closed with `acceptance: 'approved'`, sub risk:high → no row.
   - Parent 5 `Closed high long ago`: written with `closed: true, closedAt: <40 days ago ISO>`, sub risk:high → no row.
   - Parent 6 `Open high parent`: open, sub risk:high closed → the existing `[parent-gate]` above-floor row for 6.

   Assert the row column equals `[row 1, row 2, row 6]`, and the row-1 path column ends with parent 1's filename.
2. `AC2.1: Shape 7 prints no row for a local parent closed below the floor`.
   - Parent 7 `Closed below floor`: body ends with a `## Closed below the oversight floor` section (the #4466 close shape), closed, subs risk:medium and risk:low → no row.
   - Parent 8 `Hand-closed below floor`: closed, sub risk:medium → no row.
   - Parent 9 control: identical to 7 but one sub is risk:high → acceptance-gap row.

   Assert output equals exactly the parent-9 row.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/closed-parent-acceptance-backstop.test.js`
Expected: the Task 3 tests FAIL. No `[acceptance-gap]` row prints, because closed parents are never queried. The Task 2 tests stay green.

- [ ] **Step 3: Implement in Shape 7's code block**

- Also require `needsBackstop`.
- `parents` becomes the open query plus `queryRecords('specs', { isParentIssue: true, closed: true })`, filtered to `Number.isNaN(Date.parse(p.facets.closedAt)) || Date.parse(p.facets.closedAt) >= cutoff`, where `cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000`.
- Each gate adds `closed: p.facets.closed === true, notPlanned: p.facets.notPlanned === true`.
- After the `needsDefinition` filter, one `forEach` computes `exceeds` once. A `closed` gate prints the `[acceptance-gap]` row iff `needsBackstop({ state: 'CLOSED', labels: f.parentLabels, isParent: true, parentExceedsFloor: exceeds, stateReason: f.notPlanned ? 'NOT_PLANNED' : undefined })`, then returns. An open gate keeps today's `due` test and both `[parent-gate]` texts byte-identical.
- Make the prose edits listed in Files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/closed-parent-acceptance-backstop.test.js tests/below-floor-parent-close-conformance.test.js tests/tidy-needs-worklist-rule.test.js tests/tidy-release-note-shape.test.js tests/tidy-residue-markers.test.js tests/tidy-scan-dispatch-conformance.test.js`
Expected: PASS, all files.

- [ ] **Step 5: Measure, then commit**

Run `wc -c plugin/skills/tidy/step-1-records.md plugin/skills/tidy/SKILL.md`. Both must be under 52500; put the headroom in the commit body.

```bash
git add plugin/skills/tidy/step-1-records.md plugin/skills/tidy/SKILL.md tests/closed-parent-acceptance-backstop.test.js
git commit -m "Report hand-closed above-floor parents from local-files Shape 7 — refs #4600"
```
