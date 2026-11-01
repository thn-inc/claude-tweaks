# Closed-Parent Acceptance Backstop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tidy surfaces a decomposition parent closed by hand above the oversight floor with no acceptance disposition, on both work-record drivers. A parent closed by #4466's below-floor close stays excluded.

**Architecture:** The parent-gate sweeps already fetch every parent's sub-issues with their risk. They are GitHub's `parent-gate` scope (`_shared/github-pr-scan-acceptance.md`) and local-files Shape 7 (`tidy/step-1-records.md`). Both sweeps now also take in parents closed in the last 30 days. Each closed parent is judged by one new pure function, `closedParentGap` in `bin/lib/issues/acceptance.js`, which returns `gap`, `none`, `no-sub-issues` or `unread-sub-issue`. A `gap` prints the standard `[acceptance-gap]` row recommending `/claude-tweaks:demo`. The two "cannot read" verdicts print no row and are counted in a warning line. `closedParentGap` checks #4466's durable close marker first, then the disposition and not-planned rules (through `needsBackstop`, which gains a `parentExceedsFloor` field), then the sub-issue risk aggregate against `risk-floor`. The `acceptance-gap` scope and Shape 8 keep excluding parents (they never pass the new field), so no parent is reported twice.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose with executable `node -e` fences.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T190944-record-4600/work/4600-spec.md` (record #4600). Its `## Plan Review Decisions` section governs. It supersedes the prior run's plan, which predated those decisions.

## Global Constraints

- **Decision Q1 (Reading B):** exclude any closed parent carrying #4466's durable close marker before applying the floor. AC2 must hold even after the floor or a sub-issue's `risk:*` label changes. The marker is recognised exactly as #4466 recognises it (spec `## Plan Review Clarifications`). On GitHub: a comment whose body has a line matching `/^## Closed below the oversight floor\s*$/m`, from a trusted author (`bin/lib/issues/comment-trust.js`'s `isTrustedComment`) or from the current `gh` identity (`gh api user --jq .login`). That is the test `bin/lib/issues/below-floor-parent-close.js` applies. On local-files: the same heading line in the parent record's body. Only then compute the sub-issue risk aggregate against `risk-floor`. Any other marker comment counts as no marker, which fails toward printing the row.
- **Decision Q2 (Reading B):** a closed parent with zero discoverable sub-issues prints no `[acceptance-gap]` row. The sweep emits one warning line with the count of such parents.
- **Decision Q3 (Reading B):** only parents closed in the last 30 days are swept, the same window as the `acceptance-gap` scope. GitHub: server `closed:>=$SINCE` (31 days back), then a strict 30-day client `closedAt` cutoff. local-files: a `closedAt` older than 30 days drops the parent; a missing or unparseable `closedAt` keeps it, as Shape 8 does.
- **Sub-issue missing from the state map (spec `## Plan Review Clarifications`):** on GitHub, a closed parent whose sub-issue is missing from the state map (truncated, or the native search index lagging) still prints the row when its readable sub-issues already exceed the floor, since an unread sub-issue can only raise the maximum. Only otherwise is it indeterminate: it prints no row and is counted in its own warning line.
- The row is exactly the existing `[acceptance-gap]` form, so tidy routes it like every other acceptance gap. GitHub: `[acceptance-gap] #{n}: {title} — closed with no acceptance disposition — recommend /claude-tweaks:demo #{n}`. local-files: `{path}<TAB>[acceptance-gap] {id}: {title} — closed with no acceptance disposition — recommend /claude-tweaks:demo {id}`.
- The parent floor is the existing rule: `exceedsOversightFloor({ risk: maxRiskTier(...) }, { riskFloor, sizeFloor: null })` from `bin/lib/issues/oversight-floor.js`. A single unscored sub-issue fails closed (exceeds).
- Open-parent behavior must not change. `tests/below-floor-parent-close-conformance.test.js`'s two AC3.1 tests feed gate objects and records with no closed-parent fields, and their exact output stays as it is. The pre-filter reads only `$GATES`, because those tests substitute only `$GATES`.
- Do not add a new `if (fetched.some((f) => …)) {` site to `github-pr-scan-acceptance.md`. `tests/acceptance-scan-server-filter.test.js` pins exactly three. The closed-parent fetch files join the existing `fetched` array of the parent-gate fetch block.
- The governing skill is `skill-prose-conformance-tests` (`.claude/skills/skill-prose-conformance-tests/`). Tests run the live fences against fixtures, never a regex over the fence text alone. Each fixture set includes a control row that only the clause under test drops.
- **Byte rail (`RAIL_BYTES` = 52,500, measured at this branch's merge base):** `_shared/github-pr-scan-acceptance.md` is 49,552 B (2,948 B headroom), `tidy/scan-procedures.md` 51,217 B (1,283 B), `tidy/step-1-records.md` 36,950 B and `tidy/SKILL.md` 43,092 B. Task 2's total addition to `github-pr-scan-acceptance.md` must leave it at or below 52,000 B. That is why the reasoning lives in `closedParentGap`'s code comment and the prose only cites it. **Named remedy if Task 2 lands over 52,000 B:** cut the new prose first. If that is not enough, move the parent-gate scope's `#### Fallback (probe unavailable — older GHE)` subsection, which only an exit-4 host reads, into its own cited file. `tests/fetch-sub-issues-prose-conformance.test.js` counts two Fallback blocks in this file, so that move must update that test in the same commit. `tidy/scan-procedures.md` gains at most one sentence (≤ 250 B).
- Commit subjects use `{Verb} {what} — {detail}` and reference the record as `refs #4600`. Never use `closes`/`fixes`.

## Review Focus

1. A parent closed by #4466 whose sub-issue was relabelled `risk:high` after the close, or whose floor was lowered, still prints no row, because the marker check runs before the floor (Q1). Covered by the Task 1 unit test, the Task 2 fixture `#7 Closed below floor, relabelled`, and the Task 3 fixture parent 7.
2. A marker comment from an untrusted author (`authorAssociation: 'NONE'`) does not exclude the parent: the row prints (Task 2 fetch-block test, parent #13).
3. A closed parent above the floor whose sub-issue is still open still prints the gap row. It was closed by hand, so the `due` filter must not gate closed parents (Task 2 fixture #4, Task 3 parent 2).
4. A parent closed more than 30 days ago prints no row. GitHub: the client cutoff in the fetch block. local-files: a `closedAt` 40 days back (Task 2 fetch-block test, Task 3 parent 5).
5. A parent present in both the `parent-issue` and the legacy `family:parent` fetches appears once (number-keyed dedup over all four files, Task 2 fetch-block test).

---

### Task 1: `closedParentGap` and `needsBackstop`'s `parentExceedsFloor`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/acceptance.js` (`needsBackstop` at ~80-89; new `closedParentGap` after `parentGateState`; exports)
- Test: `tests/bin-lib/issues/acceptance.test.js` (append after the `AC4.1: needsBackstop excludes a decomposition parent` test)

**Interfaces:**
- Produces: `needsBackstop({ state, labels, hasParent, isParent, parentExceedsFloor, stateReason }) -> boolean`. With `isParent: true` it returns `false` unless `parentExceedsFloor === true` (literal `true` only); it then applies the existing disposition and not-planned rules. When `parentExceedsFloor` is absent, every parent stays excluded, as today.
- Produces: `closedParentGap({ parentLabels, stateReason, belowFloorClose, subIssues, riskFloor }) -> 'gap' | 'none' | 'no-sub-issues' | 'unread-sub-issue'`. `subIssues` is `[{ risk, unread }]`: `risk` is a tier string or `null`/`undefined` when unscored, and `unread === true` marks a sub-issue whose risk the caller could not read. Evaluation order, which is the contract:
  1. `belowFloorClose === true` → `'none'` (Q1).
  2. `needsBackstop({ state: 'CLOSED', labels: parentLabels, isParent: true, parentExceedsFloor: true, stateReason })` is false → `'none'` (a disposition, or a not-planned or duplicate close).
  3. Empty or missing `subIssues` → `'no-sub-issues'` (Q2).
  4. Let `readable` be the sub-issues without `unread === true`. Compute `exceedsOversightFloor({ risk: maxRiskTier(readable) }, { riskFloor, sizeFloor: null }).exceeds`. If no sub-issue is unread, `'gap'` when it exceeds, else `'none'`.
  5. With at least one unread sub-issue: `'gap'` when `readable` is non-empty and exceeds (an unread sub-issue can only raise the maximum), else `'unread-sub-issue'`.

  Both helpers come from `./oversight-floor`. `maxRiskTier` takes `[{ risk }]`, so pass `subIssues` directly. `oversight-floor.js` does not require `acceptance.js`, so there is no require cycle.

- [ ] **Step 1: Write the failing tests**

```js
test('AC1.1: needsBackstop admits a closed parent the caller shows above the floor', () => {
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: true, parentExceedsFloor: true }), true);
  assert.equal(needsBackstop({ state: 'CLOSED', labels: ['demo:approved'], isParent: true, parentExceedsFloor: true }), false);
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: true, parentExceedsFloor: true, stateReason: 'NOT_PLANNED' }), false);
  assert.equal(needsBackstop({ state: 'OPEN', labels: [], isParent: true, parentExceedsFloor: true }), false);
});

test('AC2.1: needsBackstop keeps a parent at or below the floor excluded', () => {
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: true, parentExceedsFloor: false }), false);
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: true, parentExceedsFloor: 'true' }), false);
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: true }), false);
});

test('AC1.1: closedParentGap reports a hand-closed parent above the floor', () => {
  const high = [{ risk: 'high' }, { risk: 'low' }];
  assert.equal(closedParentGap({ parentLabels: [], stateReason: 'COMPLETED', subIssues: high, riskFloor: 'high' }), 'gap');
  // Unscored fails closed.
  assert.equal(closedParentGap({ parentLabels: [], subIssues: [{ risk: null }], riskFloor: 'high' }), 'gap');
  // Disposition, not planned and duplicate are never a gap.
  assert.equal(closedParentGap({ parentLabels: ['demo:approved'], subIssues: high, riskFloor: 'high' }), 'none');
  assert.equal(closedParentGap({ parentLabels: ['accept:pending'], subIssues: high, riskFloor: 'high' }), 'none');
  assert.equal(closedParentGap({ parentLabels: [], stateReason: 'NOT_PLANNED', subIssues: high, riskFloor: 'high' }), 'none');
  assert.equal(closedParentGap({ parentLabels: [], stateReason: 'DUPLICATE', subIssues: high, riskFloor: 'high' }), 'none');
});

test('AC2.1: closedParentGap excludes a #4466-closed parent before the floor', () => {
  // Relabelled to risk:high after the close: the marker still excludes it (Decision Q1).
  assert.equal(closedParentGap({ parentLabels: [], belowFloorClose: true, subIssues: [{ risk: 'high' }], riskFloor: 'high' }), 'none');
  // Control: the same parent without the marker is a gap.
  assert.equal(closedParentGap({ parentLabels: [], belowFloorClose: false, subIssues: [{ risk: 'high' }], riskFloor: 'high' }), 'gap');
  // Below the floor with no marker (hand-closed below the floor): no sign-off owed.
  assert.equal(closedParentGap({ parentLabels: [], subIssues: [{ risk: 'medium' }], riskFloor: 'high' }), 'none');
});

test('closedParentGap reports an unreadable parent instead of guessing', () => {
  assert.equal(closedParentGap({ parentLabels: [], subIssues: [], riskFloor: 'high' }), 'no-sub-issues');
  assert.equal(closedParentGap({ parentLabels: [], riskFloor: 'high' }), 'no-sub-issues');
  // A readable sub-issue already above the floor proves the gap: an unread one can only raise the max.
  assert.equal(closedParentGap({ parentLabels: [], subIssues: [{ risk: 'high' }, { risk: null, unread: true }], riskFloor: 'high' }), 'gap');
  // Readable ones below the floor: indeterminate, never a guessed row.
  assert.equal(closedParentGap({ parentLabels: [], subIssues: [{ risk: 'low' }, { risk: null, unread: true }], riskFloor: 'high' }), 'unread-sub-issue');
  assert.equal(closedParentGap({ parentLabels: [], subIssues: [{ risk: null, unread: true }], riskFloor: 'high' }), 'unread-sub-issue');
  // The disposition and marker checks run first: an approved or #4466-closed parent is never counted.
  assert.equal(closedParentGap({ parentLabels: ['demo:approved'], subIssues: [], riskFloor: 'high' }), 'none');
  assert.equal(closedParentGap({ parentLabels: [], belowFloorClose: true, subIssues: [], riskFloor: 'high' }), 'none');
});
```

Add `closedParentGap` to the test file's destructured `require` of `acceptance.js`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/acceptance.test.js`
Expected: FAIL after Step 1. `closedParentGap` is not a function, and the first AC1.1 assertion fails with `false !== true`.

- [ ] **Step 3: Implement both in `plugin/bin/lib/issues/acceptance.js`**

In `needsBackstop`, replace `if (record.isParent === true) return false;` with `if (record.isParent === true && record.parentExceedsFloor !== true) return false;`. Update its comment. Add `closedParentGap` with the evaluation order above and export it. Its comment (four to six lines) carries the reasoning the prose cites: a parent's acceptance is the parent gate's. Below the floor, #4466 closes the parent with a durable `## Closed below the oversight floor` marker and no sign-off owed, and the marker, not a scan-time recomputation, is what excludes it. Above the floor the disposition is `/claude-tweaks:demo`'s. A parent whose sub-issues cannot be read is reported to the caller, not guessed (#4600).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/acceptance.test.js`
Expected: PASS, every test, including the existing `AC4.1` one.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/acceptance.js tests/bin-lib/issues/acceptance.test.js
git commit -m "Add closedParentGap and needsBackstop's parentExceedsFloor — marker before floor, refs #4600"
```

### Task 2: GitHub `parent-gate` scope reports a hand-closed above-floor parent

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan-acceptance.md`, by section:
  - `## Scope: acceptance-gap`, the `isParent` clause (~111-114): a parent's acceptance is the parent gate's, and the `parent-gate` scope below reports a hand-closed parent above the floor itself (#4600). Keep the code line `isParent: parseRecordFacets(r.labels).isParentIssue,` byte-identical; it is pinned.
  - `## Scope: parent-gate`, the `Record set:` sentence (~404-406): add the parents closed in the last 30 days.
  - The parent-gate fetch block (~453-493), detailed in Step 3.
  - The three gate composers: body-text (~530-545), native (~580-596) and Fallback (~626-653), detailed in Step 3. Update the "converge on the same … shape" sentence (~656-658) to list `state`, `stateReason`, `belowFloorClose` and the sub-issue `unread` flag.
  - The `### Oversight-floor pre-filter` code block (~680-706), and one new paragraph after it. The paragraph covers the closed-parent row: it cites `closedParentGap` for the rules and says it uses the same row, severity and routing as `acceptance-gap`, mutates nothing, and recommends `/claude-tweaks:demo #{n}`. It says the two warnings are reported verbatim beside the rows, under the existing "Report every warning … verbatim" rule.
- Modify: `plugin/skills/tidy/scan-procedures.md:298`. Append one sentence (≤ 250 B): the scope also reports a parent closed in the last 30 days with no disposition and no #4466 close marker, whose sub-issue risk exceeds the oversight floor, as an `[acceptance-gap]` row (#4600).
- Modify: `docs/skill-graph.md:640`. After `(a below-floor parent closes with no acceptance label by design, #4466)`, add: the parent-gate sweep itself reports a hand-closed parent above the floor as an `[acceptance-gap]` row (#4600).
- Modify: `docs/journeys/close-a-below-floor-decomposition-parent-4466.md:95`. The "Should understand" line becomes: `needsBackstop` skips a decomposition parent unless the parent-gate sweep shows it closed above the floor with no #4466 close marker, because a parent's acceptance belongs to the parent gate.
- Test: `tests/closed-parent-acceptance-backstop.test.js` (create). Copy `section`, `extractNodeScripts`, `scanScript` and `mkTmp` locally, in the style of `tests/below-floor-parent-close-conformance.test.js`.

**Interfaces:**
- Consumes: `closedParentGap` (Task 1).
- Produces: gate objects in the session-scoped `tidy-parent-gates.json` shaped `{number, title, parentLabels, state: 'OPEN'|'CLOSED', stateReason: string|null, belowFloorClose: boolean, subIssues:[{number, state, labels, unread: boolean}]}`. `$PARENTS` rows carry `belowFloorClose` and no `comments`. New session-scoped files: `tidy-closed-parent-issues-new.json`, `tidy-closed-parent-issues-legacy.json`.

- [ ] **Step 1: Write the failing tests** in `tests/closed-parent-acceptance-backstop.test.js`

Constants: `const GAP_TAIL = ' — closed with no acceptance disposition — recommend /claude-tweaks:demo ';`, `const ABOVE_ROW_TAIL` as in the below-floor test, and `PG = section(read('_shared/github-pr-scan-acceptance.md'), '## Scope: \`parent-gate\`', null)`. Sub-issue helper: `sub(number, risk, state = 'CLOSED', unread = false)` → `{ number, state, labels: risk ? [{ name: 'risk:' + risk }] : [], unread }`.

1. `AC1.1: the GitHub parent-gate scan prints an acceptance-gap row for a hand-closed above-floor parent`. Run the pre-filter (`scanScript(PG, "'[parent-gate] #'")`, `$GATES` → fixture, argv `-- high`) over:
   - #1 `Open high parent`: no `state` field, sub risk:high closed → `[parent-gate] #1: Open high parent` + ABOVE_ROW_TAIL + `#1`
   - #2 `Closed high parent`: `state:'CLOSED', stateReason:'COMPLETED'`, subs risk:high and risk:low → `[acceptance-gap] #2: Closed high parent` + GAP_TAIL + `#2`
   - #3 `Closed unscored parent`: CLOSED/COMPLETED, one unscored sub → acceptance-gap row for #3
   - #4 `Closed high parent, open sub`: CLOSED/COMPLETED, subs risk:high CLOSED and risk:low OPEN → acceptance-gap row for #4
   - #5 `Closed high not planned`: CLOSED/NOT_PLANNED, sub risk:high → no row
   - #6 `Closed high approved`: CLOSED/COMPLETED, `parentLabels:['demo:approved']`, sub risk:high → no row

   Assert stdout lines equal exactly `[#1 row, #2 row, #3 row, #4 row]`.
2. `AC2.1: the GitHub scan prints no row for a #4466-closed or below-floor parent`. Same runner over:
   - #7 `Closed below floor, relabelled`: CLOSED/COMPLETED, `belowFloorClose: true`, sub risk:high → no row
   - #8 `Hand-closed below floor`: CLOSED/COMPLETED, no marker, sub risk:medium → no row
   - #9 control `Closed above floor`: identical to #7 but `belowFloorClose: false` → acceptance-gap row

   Assert stdout equals exactly the #9 row.
3. `Q2: an unreadable closed parent prints no row and one warning line per cause`. Same runner over: #10 CLOSED with `subIssues: []`, #11 CLOSED with `subIssues: []`, #12 CLOSED with `[sub(121, 'low'), sub(122, null, 'OPEN', true)]`, #16 CLOSED with `[sub(161, 'high'), sub(162, null, 'OPEN', true)]`, and control #14 CLOSED with `[sub(141, 'high')]`. Capture stderr (`spawnSync`). Assert stdout is exactly the #14 and #16 acceptance-gap rows, in that fixture order. Assert stderr has exactly one line containing `'2 closed parent'` and `'no-sub-issues'`, and exactly one containing `'1 closed parent'` and `'unread-sub-issue'`. Assert an all-open fixture writes nothing to stderr.
4. `AC1.1: the parent-gate fetch block merges open and closed parents inside the 30-day window and marks the #4466 close`. Extract the one PG node script carrying `process.env.STATE_SEARCH`. Substitute `$PI_NEW`, `$PI_LEG`, `$PC_NEW`, `$PC_LEG`, `$ALL_STATES` and `$PARENTS` with fixture paths, replacing longer names first, and `${CLAUDE_PLUGIN_ROOT}` with the plugin root. Run it with env `{ FETCH_LIMIT: '500', STATE_SEARCH: '' }`. The fixtures use real `gh issue list --json` shapes; closed rows look like `{"number":3979,"state":"CLOSED","stateReason":"COMPLETED","closedAt":"2026-10-27T06:05:03Z","labels":[{"name":"parent-issue"}],"comments":[{"author":{"login":"x"},"authorAssociation":"MEMBER","body":"..."}]}`, probed on this repo.
   - PI_NEW: open #10 (no `state` field). PI_LEG: open #10 duplicate.
   - PC_NEW: #11 closed 5 days ago, with a MEMBER comment whose body is `'## Closed below the oversight floor\n\nEvery sub-issue …'`. #12 closed 40 days ago. #13 closed 5 days ago, with the same marker comment but `authorAssociation: 'NONE'` and author `stranger`. #15 closed 5 days ago, with a MEMBER comment that only quotes the heading mid-line (`'see ## Closed below the oversight floor'`). #17 closed 5 days ago, with the marker comment under `authorAssociation: 'NONE'` and author `bot-self`.
   - PC_LEG: #11 duplicate. ALL_STATES: `[]`.

   Substitute `LOGIN: 'bot-self'` into the env (the block's current-`gh`-identity value). Assert `$PARENTS` holds numbers `[10, 11, 13, 15, 17]` (sorted). Assert `belowFloorClose` is `true` for exactly #11 and #17, #11 keeps `state: 'CLOSED'`, and no row carries a `comments` key. Control: with `LOGIN: ''`, #17's `belowFloorClose` is `false`.
5. `AC1.1: the closed-parent fetches are bounded to the window and carry what the gate reads`. In PG, find the `gh issue list --label (parent-issue|family:parent) --state closed` lines. Assert there are exactly 2. Assert each carries `--search "closed:>=$SINCE"` and a `--json` list containing `state`, `stateReason`, `closedAt`, `comments`, `body` and `labels`. Assert the `SINCE=` assignment computes the date in-block (it contains `31 * 864e5`), so no placeholder is left to substitute.
6. `AC1.1: every gate composer carries the parent's closed state and the unread flag`. Run the body-text composer (the PG script carrying `parseSubIssues(p.body)`) with `$PARENTS`/`$ALL_STATES`/`$GATES` fixtures. Run the native composer (the PG script carrying `batch.byParent`), with `$PG_BATCH` too. The parent fixture has `state:'CLOSED', stateReason:'COMPLETED', belowFloorClose: true`, and one of its two sub-issues is absent from `$ALL_STATES`. Assert `gates[0]` has `state === 'CLOSED'`, `stateReason === 'COMPLETED'`, `belowFloorClose === true`, and `unread` values `[false, true]`. For a parent row with no `state`, assert `state === 'OPEN'`, `stateReason === null` and `belowFloorClose === false`. The Fallback composer needs `gh`, so for it assert the script text contains `state: p.state || 'OPEN'`, `stateReason: p.stateReason || null`, `belowFloorClose: p.belowFloorClose === true` and `unread: !info`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/closed-parent-acceptance-backstop.test.js`
Expected: FAIL. Test 1 has no `[acceptance-gap]` rows, test 4 cannot find `$PC_NEW`, test 5 finds 0 closed fetches, and test 6 finds no `state` field.

- [ ] **Step 3: Implement in `plugin/skills/_shared/github-pr-scan-acceptance.md`**

- **Fetch block.** Add `PC_NEW`/`PC_LEG` session-tmp paths. Add `SINCE="$(node -e "console.log(new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10))")"`: computed in-block, so there is no placeholder to substitute and no guard is needed. Add two fetches after the open ones: `gh issue list --label parent-issue --state closed --search "closed:>=$SINCE" --json number,title,body,labels,state,stateReason,closedAt,comments --limit "$LIMIT" \` + `  > "$PC_NEW"`, and the same for `family:parent` → `$PC_LEG` under the existing legacy-label comment. Leave the open fetches' `--json` unchanged. In the node block:
  - `fetched` becomes `['$PI_NEW', '$PI_LEG', '$PC_NEW', '$PC_LEG'].map(require)`.
  - Require `isTrustedComment` from `${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/comment-trust.js`.
  - Add `const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();`.
  - In the shell, before the node block: `LOGIN="$(gh api user --jq .login)"` + `export LOGIN`. A failed lookup leaves it empty, and only trusted authors then count.
  - `parents` keeps the number-keyed dedup over `fetched.flat().filter((p) => p.state !== 'CLOSED' || p.closedAt > cutoff)`. Each row maps to `{ ...p, comments: undefined, belowFloorClose: (p.comments || []).some((c) => (isTrustedComment(c) || (process.env.LOGIN && c.author && c.author.login === process.env.LOGIN)) && /^## Closed below the oversight floor\s*$/m.test(c.body || '')) }`.
- **Three composers.** Each gate object adds `state: p.state || 'OPEN', stateReason: p.stateReason || null, belowFloorClose: p.belowFloorClose === true,`. Each sub-issue object adds `unread: !info`.
- **Pre-filter block.** Also require `closedParentGap`. Replace the `.filter(...due).forEach(...)` chain with one `gates.forEach((f) => { … })`:
  - When `f.state === 'CLOSED'`: `const v = closedParentGap({ parentLabels: f.parentLabels, stateReason: f.stateReason, belowFloorClose: f.belowFloorClose, subIssues: f.subIssues.map((s) => ({ risk: parseRecordFacets(s.labels).risk, unread: s.unread === true })), riskFloor })`. Print the `[acceptance-gap]` row when `v === 'gap'`, count the two "cannot read" verdicts by verdict name, then return.
  - Otherwise keep today's `due` test, the floor call and the two `[parent-gate]` row texts byte-identical.
  - After the loop, print to stderr one line per non-zero count: `'WARNING: ' + n + ' closed parent(s) print no [acceptance-gap] row (' + verdict + ') — their sub-issue risk cannot be read; check work-links and backlog-fetch-limit, then re-run.'`
  - The local `maxRiskTier` helper stays for the open path.
- **Prose.** Make the edits listed in Files. Cite `closedParentGap` and never restate its rules.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/closed-parent-acceptance-backstop.test.js tests/below-floor-parent-close-conformance.test.js tests/acceptance-scan-server-filter.test.js tests/fetch-sub-issues-prose-conformance.test.js tests/session-tmp-root-migration.test.js tests/tidy-scan-dispatch-conformance.test.js`
Expected: PASS, all files.

- [ ] **Step 5: Measure, then commit**

Run `wc -c plugin/skills/_shared/github-pr-scan-acceptance.md plugin/skills/tidy/scan-procedures.md`. The first must be ≤ 52,000 and the second < 52,500. If the first is over, apply the named remedy from Global Constraints. Put the headroom in the commit body.

```bash
git add plugin/skills/_shared/github-pr-scan-acceptance.md plugin/skills/tidy/scan-procedures.md docs/skill-graph.md docs/journeys/close-a-below-floor-decomposition-parent-4466.md tests/closed-parent-acceptance-backstop.test.js
git commit -m "Report hand-closed above-floor parents from the GitHub parent-gate scope — refs #4600"
```

### Task 3: local-files Shape 7 reports a hand-closed above-floor parent

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/tidy/step-1-records.md`:
  - Shape 7 code block (~248-288), detailed in Step 3.
  - The `Both \`queryRecords\` shapes are deliberate` paragraph (~294-301). It now describes three queries. The open-parent query is unchanged. A closed-parent query `{ isParentIssue: true, closed: true }` covers the last 30 days and keeps a missing `closedAt`. The sub-issue merge is unchanged. A closed parent is judged by `closedParentGap` (cite it). The parent's `## Closed below the oversight floor` body section is #4466's marker.
  - The Collect line (~303): append `` or, for a hand-closed parent above the floor: `[acceptance-gap] {id}: {title} — closed with no acceptance disposition — recommend /claude-tweaks:demo {id}` ``.
  - Shape 8's `isParent` sentence (~352-353): a parent's acceptance is Shape 7's, which reports a hand-closed one above the floor itself (#4600), or the below-floor close (#4466). Never a row here.
- Modify: `plugin/skills/tidy/SKILL.md:98`. `Shape 7 pairs an open-parent query (\`{ isParentIssue: true }\`)` becomes `Shape 7 pairs an open-parent query (\`{ isParentIssue: true }\`) and a 30-day closed-parent query`. `keeps every one that is not a decomposed sub-issue — a closed parent surfaces there, only sub-issues are suppressed` becomes `keeps every one that is neither a decomposed sub-issue nor a parent — a closed parent surfaces from Shape 7 instead`.
- Test: `tests/closed-parent-acceptance-backstop.test.js` (append)

**Interfaces:**
- Consumes: `closedParentGap` (Task 1); the test file's helpers (Task 2).
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing tests** (append)

Run the Shape 7 script (`scanScript(section(read('tidy/step-1-records.md'), '### Shape 7 — decomposition parent gate due', '### Shape 8 —'), "'\\t[parent-gate] '")`) in a temp cwd holding `specs/`, with argv `-- high`. Build records with `local-store.js`'s `writeRecord`/`closeRecord`/`defaultFacets`, as the below-floor test does.

1. `AC1.1: Shape 7 prints an acceptance-gap row for a hand-closed above-floor local parent`.
   - Parent 1 `Closed high parent`: closed via `closeRecord`, sub risk:high closed → `[acceptance-gap] 1: Closed high parent` + GAP_TAIL + `1`.
   - Parent 2 `Closed high, open sub`: closed; subs risk:high closed and risk:low open → acceptance-gap row for 2.
   - Parent 3 `Closed high not planned`: closed with `notPlanned: true`, sub risk:high → no row.
   - Parent 4 `Closed high approved`: closed with `acceptance: 'approved'`, sub risk:high → no row.
   - Parent 5 `Closed high long ago`: written with `closed: true, closedAt: <40 days ago ISO>`, sub risk:high → no row.
   - Parent 6 `Open high parent`: open, sub risk:high closed → the existing `[parent-gate]` above-floor row for 6.

   Assert the row column equals `[row 1, row 2, row 6]` in that order, and the row-1 path column ends with parent 1's filename.
2. `AC2.1: Shape 7 prints no row for a #4466-closed or below-floor local parent`.
   - Parent 7 `Closed below floor, relabelled`: body ends with a `## Closed below the oversight floor` section (the #4466 close shape), closed; sub risk:high → no row (the marker, not the floor, excludes it).
   - Parent 8 `Hand-closed below floor`: closed, no section, sub risk:medium → no row.
   - Parent 9 control: identical to 7 but with no section → acceptance-gap row.

   Assert stdout equals exactly the parent-9 row.
3. `Q2: Shape 7 counts a closed local parent with no sub-issues in one warning line`. Parents 10 and 11 closed with no sub-issue records, plus control parent 12 (closed, sub risk:high). Capture stderr (`spawnSync`). Assert stdout is exactly the parent-12 row, and stderr has exactly one line containing `'2 closed parent'` and `'no-sub-issues'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/closed-parent-acceptance-backstop.test.js`
Expected: the Task 3 tests FAIL, because closed parents are never queried, so no `[acceptance-gap]` row prints. The Task 2 tests stay green.

- [ ] **Step 3: Implement in Shape 7's code block**

- Also require `closedParentGap`.
- `parents` becomes the open query plus `queryRecords('specs', { isParentIssue: true, closed: true })`, filtered to `Number.isNaN(Date.parse(p.facets.closedAt)) || Date.parse(p.facets.closedAt) >= cutoff`, with `cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000`.
- Each gate adds `closed: p.facets.closed === true, notPlanned: p.facets.notPlanned === true, belowFloorClose: /^## Closed below the oversight floor\s*$/m.test(p.body || '')`.
- After the `needsDefinition` filter, one `forEach`. A `closed` gate calls `closedParentGap({ parentLabels: f.parentLabels, stateReason: f.notPlanned ? 'NOT_PLANNED' : undefined, belowFloorClose: f.belowFloorClose, subIssues: f.subIssues, riskFloor })`. It prints the `[acceptance-gap]` row on `'gap'` and counts `'no-sub-issues'`, then returns. An open gate keeps today's `due` test and both `[parent-gate]` texts byte-identical.
- After the loop, print to stderr the same warning line form as Task 2 for a non-zero count.
- Make the prose edits listed in Files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/closed-parent-acceptance-backstop.test.js tests/below-floor-parent-close-conformance.test.js tests/tidy-needs-worklist-rule.test.js tests/tidy-release-note-shape.test.js tests/tidy-residue-markers.test.js tests/tidy-scan-dispatch-conformance.test.js`
Expected: PASS, all files.

- [ ] **Step 5: Measure, then commit**

Run `wc -c plugin/skills/tidy/step-1-records.md plugin/skills/tidy/SKILL.md`. Both must be under 52,500; put the headroom in the commit body.

```bash
git add plugin/skills/tidy/step-1-records.md plugin/skills/tidy/SKILL.md tests/closed-parent-acceptance-backstop.test.js
git commit -m "Report hand-closed above-floor parents from local-files Shape 7 — refs #4600"
```
