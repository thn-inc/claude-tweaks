# Stage-item Unmapped-Prefix Producers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `stage-item.js`'s unmapped-prefix warning true for every staged-id producer. Each producer's id either maps to a Review Console section or sits on an exemption list with a stated reason. A conformance test fails when a producer is neither.

**Architecture:** `plugin/bin/lib/console/resolve.js` already owns `SECTION_MAP` and `CANONICAL_PREFIXES`. It gains new rows for the producers whose runs reach wrap-up's `console-resolve.js`, plus an exported `STAGING_EXEMPTIONS` table (`[RegExp, reason]` pairs) and a `stagingExemption(id)` helper for producers whose runs never reach it. `stage-item.js`'s `warnUnmappedPrefix` skips exempt ids. A new conformance suite scans the corpus for every producer call site and asserts each one's id is mapped or exempt.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T235713-record-3488/work/3488-spec.md` (record #3488)

Scope keywords: warnUnmappedPrefix, nearestCanonicalPrefixes, CANONICAL_PREFIXES

## Global Constraints

- `stage-item.js --id release-held` and `--id dispatch-target-missing-x` print no unmapped-prefix warning. `--id review-13-record` still prints it (AC1).
- Every id named in the spec's Current State must classify through `classifyStagedItem` without `unmapped-prefix`, or match `STAGING_EXEMPTIONS` with its reason (AC2). The ids are `release-held`, `upstream-draft-{N}`, `shipped-close-*`, `dispatch-target-missing-*`, `review-followup-*`, `build-followup-*`, `docs-*`, `skills-*`, `wrap-up-reflect-insights`, `wrap-up-cleanup-ordering` and `reconcile-live-run-archived`.
- `npm test` passes with no new failures relative to `main` (AC3).
- An exemption is only for a producer whose run directory never reaches wrap-up's `console-resolve.js`. An id whose run does reach it is mapped, never exempted. Exempting such an id would make the warning silent while the console still parks the item, which is the false signal this record removes.
- Commit style: `{Verb} {what} — {detail}`, body ends `refs #3488` (never `closes`/`fixes`). Every commit message ends with `Claude-Session: https://claude.ai/code/session_01D9kmzbX15tiPfELgr6q5BL`.

## Producer inventory (Deliverable 1 — decided here; Task 3's test pins it)

Every `stage-item.js --id` call site under `plugin/skills/` and every in-process `writeStagedItem({ … id: … })` call under `plugin/bin/`. The table also records whether each producer's run reaches `console-resolve.js` (the only caller sites are `wrap-up/review-console.md` and `flow/multispec-review-console.md`).

| Call site | Id (static head) | Run dir | Reaches console? | Disposition |
|---|---|---|---|---|
| `wrap-up/leftover-routing.md` | `leftover-` | flow run | yes | already mapped (Queue writes) |
| `build/dispatch.md` | `sdd-ruling-`, `build-deviation-` | flow run | yes | already mapped (Pending review) |
| `build/architecture-alignment.md` | `build-deviation-` | flow run | yes | already mapped |
| `flow/polish-execution.md` | `polish-suggestion-` | flow run | yes | already mapped |
| `test/verification.md`, `bin/verify.js` | `flaky-allowlist-` | flow run | yes | already mapped (Queue writes) |
| `specify/red-team.md` | `red-team-` | inherited/standalone | yes (when inherited) | already mapped |
| `tidy/step-6-auto.md` (`{id}`), `tidy/release-note-repair.md` | `tidy-` (documented: `tidy-release-note-`, `tidy-claim-releases-`, `tidy-absorb-`) | tidy/pipeline run | yes in a pipeline | already mapped (Queue writes) |
| `feedback/upstream-draft.md` | `upstream-draft-` | `resolve-run-dir` → can be a /flow run (reflect → `_shared/learning-routing.md` → `/feedback --upstream`) | **yes** | **map**: Upstream feedback, reason `hand-off-draft` (pending — a human pastes it; the console must never file it) |
| `bin/materialize.js` | `premise-satisfied-` | flow/build run | **yes** (`build/SKILL.md` Spec Step 2 routes it to the console) | **map**: Queue writes, reason `premise-satisfied-close-proposal` (pending, the same behavior as today with an accurate reason) |
| `bin/materialize.js` | `sibling-premise-disproof-` | flow/build run | **yes** | **map**: Pending review, reason `sibling-premise-disproof-note` (pending) |
| `release/SKILL.md`, `release/execute.md` | `release-held` | `*-release-standalone` | **no**: surfaced by release's own Step 4 console (`release/console.md`) | **exempt** |
| `dispatch/queue-pull-script.md` | `dispatch-target-missing-` | `$DISPATCH_STANDALONE_DIR` (`*-dispatch-standalone`) | **no**: dispatch renders no console (`dispatch/SKILL.md` Reporting) | **exempt** |
| `dispatch/queue-pull-script.md` | `shipped-close-` | `$DISPATCH_FIRING_RUN_DIR` (`*-dispatch-standalone`) | **no** | **exempt**; drop the call's ` 2>&1` |
| `bin/dream-scan.js` | `dream-proposal-` | `*-dream-standalone` (`harness-health/dream-pass.md`) | **no**: report-only pass, `report.md` is its surface | **exempt** |

Ids that real staged output carries with no corpus producer, all observed reaching the console as `pending — unmapped-prefix`:

| Id | Content shape (real archived file) | Disposition |
|---|---|---|
| `review-followup-{n}`, `build-followup-{n}` | record proposal (`Title:`/`Type:`/`Labels:` header) | map: Queue writes (alongside `leftover-`/`ledger-record-`) |
| `reconcile-live-run-archived` | record proposal | map: Queue writes (exact name) |
| `wrap-up-cleanup-ordering` | `**Category:** observation` finding | map: Queue writes (exact name). The Queue row's existing Category gate reroutes it to Pending review with `non-tangential-category:observation` |
| `docs-{n}`, `skills-{n}` | engine-recorded Docs/Skills curation findings | map: Documentation updates / Skill updates (aliases, same precedent as the existing `journeys` alias) |
| `wrap-up-reflect-insights` | reflect's batch insights table (`reflect/full-mode.md` Step 3), applied by `review-console.md` step 10 | map: Queue writes, reason `reflect-insights-table` (pending: console-resolve has no executor for the table) |

---

### Task 1: Map and exempt in `resolve.js`

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` (`SECTION_MAP` ~line 47, `CANONICAL_PREFIXES` ~line 76, `module.exports` line 487)
- Modify: `docs/plugin-structure.md:37` (append one clause naming `STAGING_EXEMPTIONS`)
- Test: `tests/bin-lib/console/resolve.test.js`

**Interfaces:**
- Produces: `STAGING_EXEMPTIONS: Array<[RegExp, string]>` (exported, frozen). `stagingExemption(id: string) => string | null` (exported) returns the matching reason or `null`. Matching runs on the id without its extension: `release-held` and `release-held.md` both match.

- [ ] **Step 1: Write the failing tests** in `resolve.test.js` (factor the AC2 predicate into one function so the go-red control reuses it):

```js
const { STAGING_EXEMPTIONS, stagingExemption } = require(MOD);
// AC2.1: one predicate, used by the positive test and by the control.
function mappedOrExempt(id) {
  return classifyStagedItem(id + '.md').reason !== 'unmapped-prefix' || stagingExemption(id) !== null;
}
const CURRENT_STATE_IDS = ['release-held', 'upstream-draft-1', 'shipped-close-12', 'dispatch-target-missing-12',
  'review-followup-1', 'build-followup-1', 'docs-1', 'skills-1', 'wrap-up-reflect-insights',
  'wrap-up-cleanup-ordering', 'reconcile-live-run-archived'];
test('AC2.1: every id named in #3488 Current State classifies mapped or is exempt with a reason', () => {
  for (const id of CURRENT_STATE_IDS) assert.ok(mappedOrExempt(id), id);
});
test('AC2.1 (control): an unknown id fails the same predicate', () => {
  assert.equal(mappedOrExempt('review-13-record'), false);
});
test('exempt and mapped are disjoint: no exempt id also classifies mapped', () => {
  for (const id of ['release-held', 'dispatch-target-missing-1', 'shipped-close-1', 'dream-proposal-1']) {
    assert.ok(stagingExemption(id), id);
    assert.equal(classifyStagedItem(id + '.md').reason, 'unmapped-prefix', id);
  }
});
test('every STAGING_EXEMPTIONS entry carries a non-empty reason', () => {
  assert.ok(STAGING_EXEMPTIONS.length >= 4);
  for (const [re, reason] of STAGING_EXEMPTIONS) assert.ok(re instanceof RegExp && typeof reason === 'string' && reason.length > 20);
});
```

Also assert these exact classifications:
- `upstream-draft-1.md` → `{section:'Upstream feedback', reason:'hand-off-draft'}`
- `premise-satisfied-7.md` → `{section:'Queue writes', reason:'premise-satisfied-close-proposal'}`
- `sibling-premise-disproof-7.md` → `{section:'Pending review', reason:'sibling-premise-disproof-note'}`
- `wrap-up-reflect-insights.md` → `{section:'Queue writes', reason:'reflect-insights-table'}`
- `docs-1.md` → `{section:'Documentation updates'}`
- `skills-1.md` → `{section:'Skill updates'}`
- `review-followup-1.md`, `build-followup-1.md`, `reconcile-live-run-archived.md` → `{section:'Queue writes'}`
- `wrap-up-cleanup-ordering.md` with text `'**Category:** observation\n'` → `{section:'Pending review', reason:'non-tangential-category:observation'}`
- `resolveAll` over a fixture holding `upstream-draft-1.md` gives that item `resolution: 'pending'`. This is the guard that the console never files a hand-off draft. Reuse the file's existing `fixture()`/`deps()` helpers.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: FAIL after Step 1 (`stagingExemption is not a function`, plus classification mismatches)

- [ ] **Step 3: Implement in `resolve.js`**
- Widen existing rows: `^(wrap-up-skill|skills)(-|\b)`, `^(wrap-up-doc|tidy-doc|docs)-`. Add `review-followup|build-followup|reconcile-live-run-archived|wrap-up-cleanup-ordering` to the Queue writes alternation (its `(-|\b)` tail matches the two exact names).
- Add reason rows, placed **before** the rows they would otherwise fall through to (first match wins): `[/^upstream-draft-/, SECTIONS.UPSTREAM, 'hand-off-draft']`, `[/^premise-satisfied-/, SECTIONS.QUEUE, 'premise-satisfied-close-proposal']`, `[/^sibling-premise-disproof-/, SECTIONS.PENDING, 'sibling-premise-disproof-note']`, `[/^wrap-up-reflect-insights(-|\b)/, SECTIONS.QUEUE, 'reflect-insights-table']`. Give each a one-line comment naming its producer file and why it resolves pending. Keep every new row in a shape that `resolve.test.js`'s `rowPrefixes` parser accepts (`^a-`, `^a(-|\b)`, `^(a|b)-`, `^(a|b)(-|\b)`). The single-prefix PENDING row does not match `isPendingMdPrefixRow` (`^\^\(.*\)-$`), so the #3401 twin pin is unaffected.
- `CANONICAL_PREFIXES` gains every new alternative with its `-`: `skills-`, `docs-`, `review-followup-`, `build-followup-`, `reconcile-live-run-archived-`, `wrap-up-cleanup-ordering-`, `upstream-draft-`, `premise-satisfied-`, `sibling-premise-disproof-`, `wrap-up-reflect-insights-` (the existing completeness tests enforce this).
- `STAGING_EXEMPTIONS` (frozen array), with each reason written out beside its entry:
  - `/^release-held(\.|$)/`: `/claude-tweaks:release`'s standalone run dir; surfaced by release's own Step 4 console (release/console.md), never by wrap-up's console-resolve.js
  - `/^dispatch-target-missing-/`: `/claude-tweaks:dispatch`'s `*-dispatch-standalone` run dir (queue-pull-script.md); dispatch renders no Review Console
  - `/^shipped-close-/`: the same dispatch-standalone firing run dir (queue-pull-script.md's #1984 shipped-candidate pass); no Review Console
  - `/^dream-proposal-/`: harness-health's `*-dream-standalone` run dir (dream-pass.md); report-only, `report.md` is its surface
- `stagingExemption(id)` strips one trailing extension (`path.extname`) before matching. Export both.
- `docs/plugin-structure.md:37`: append `; STAGING_EXEMPTIONS (staged-id prefixes whose run never reaches the console — stage-item.js's unmapped-prefix warning skips them, each with its reason)`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/console/cli.test.js tests/bin-lib/console/residue.test.js`
Expected: PASS, every test

- [ ] **Step 5: Commit** `resolve.js`, its test, `docs/plugin-structure.md`: `Map or exempt every staged-id producer prefix in resolve.js — refs #3488`

### Task 2: `stage-item.js` skips exempt ids; unsilence `shipped-close`

**Files:**
- Modify: `plugin/bin/stage-item.js:116-123` (`warnUnmappedPrefix`), its header comment at lines 35-38
- Modify: `plugin/skills/dispatch/queue-pull-script.md:623`: `>/dev/null 2>&1 || true` → `>/dev/null || true` (stdout stays quiet, stderr shows a real staging failure, and `|| true` keeps the loop going). The file is 50,615 B against the 52,500 B rail; this edit only removes bytes.
- Test: `tests/bin-lib/stage-item/cli.test.js`

**Interfaces:**
- Consumes: `stagingExemption(id) => string | null` from Task 1 (`./lib/console/resolve`)

- [ ] **Step 1: Write the failing tests** in `cli.test.js`, following the existing `#3370` test's fixture/fakeDeps shape:
  - `AC1.1: --id release-held prints no unmapped-prefix warning (exempt: release console)`: exit 0, file written, `err.join('') === ''`
  - `AC1.1: --id dispatch-target-missing-x prints no unmapped-prefix warning (exempt: dispatch standalone)`: same assertions
  - `AC1.1: --id review-13-record still warns`: the existing test covers this; rename its title to carry the `AC1.1` id rather than duplicating it
  - `--id upstream-draft-1 prints no warning (mapped, hand-off-draft)`
- Add one prose pin test for the queue-pull-script edit: the `shipped-close-` stage-item line in `plugin/skills/dispatch/queue-pull-script.md` contains no `2>` redirect. Find the line by `/--id "shipped-close-/` and assert `doesNotMatch(line, /2>/)`. Factor the line lookup and the assertion into one function, and add a control test that runs it against the original string `'... --id "shipped-close-$NUM" --file "$FILE" >/dev/null 2>&1 || true'` and expects a throw.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/stage-item/cli.test.js`
Expected: FAIL after Step 1 (release-held and dispatch-target-missing-x warn; the prose pin finds `2>&1`)

- [ ] **Step 3: Implement**: in `warnUnmappedPrefix`, return early when `stagingExemption(landedId)` is non-null. Update the lines 35-38 comment to say that exempt prefixes (resolve.js's `STAGING_EXEMPTIONS`) print nothing. Make the queue-pull-script.md edit.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/stage-item/cli.test.js tests/archive-run-verb.test.js tests/dispatch-tidy-named-target-coordination.test.js`
Expected: PASS

- [ ] **Step 5: Commit**: `Skip the unmapped-prefix warning for exempt staging producers — release-held, dispatch-standalone, dream; shipped-close stderr unsilenced, refs #3488`

### Task 3: Producer conformance scan (Deliverables 1 + 4)

**Files:**
- Create: `tests/bin-lib/console/staged-id-producers.test.js`

**Interfaces:**
- Consumes: `classifyStagedItem`, `stagingExemption` (Task 1); `stripComments`/`stripperVerdict` from `tests/helpers/strip-comments` (see the `bin-source-scan-conformance` skill: bin files are scanned after comment stripping, and a bad stripper verdict fails as an offender)

- [ ] **Step 1: Write the test.** Required shape:
  - `collectProducers()` → `[{file, id}]`. It walks `plugin/skills/**/*.md` for every `stage-item.js` invocation carrying `--id <token>` (quoted or bare, same line), plus `plugin/bin/**/*.js` (comment-stripped, `stage-item/` lib excluded) for `writeStagedItem(` calls whose object literal carries `id: \`…\`` or `id: '…'`. Ignore usage-placeholder ids (`<kind>-<n>`) in `stage-item.js`'s own usage line and in `_shared/auto-decision-log.md`'s synopsis.
  - `staticHead(id)` returns the id text before its first `{`, `$` or `<`.
  - `DYNAMIC_ID_PREFIXES = { 'plugin/skills/tidy/step-6-auto.md': 'tidy-' }` maps fully dynamic ids (empty static head) to their documented prefix. A dynamic call site missing from this map fails the test with its path.
  - `assertProducerDisposition(producers)` throws, naming `file` and `id`, unless `classifyStagedItem(probe + '.md').reason !== 'unmapped-prefix' || stagingExemption(probe) !== null`, where `probe = head.endsWith('-') ? head + '1' : head`.
  - Tests: (a) `Deliverable 4: every staging producer's id is mapped or exempt`, (b) a floor: at least 14 producers found, and the set includes `release-held`, `dispatch-target-missing-`, `shipped-close-`, `upstream-draft-`, `premise-satisfied-`, `dream-proposal-`, `flaky-allowlist-`, (c) go-red control: `assertProducerDisposition([{file:'x.md', id:'review-13-record'}])` throws, (d) control: a `.md` fixture string with a new `stage-item.js --id "{x}"` call site not in `DYNAMIC_ID_PREFIXES` makes `collectProducers`' dynamic-id check throw. Factor that check so the test can pass it a text.
- [ ] **Step 2: Run, then prove discrimination by reverting one entry**

Run: `node --test tests/bin-lib/console/staged-id-producers.test.js`
Expected: PASS on this branch.
Then temporarily delete the `release-held` entry from `STAGING_EXEMPTIONS` in `resolve.js` and re-run. Expected: FAIL naming `plugin/skills/release/SKILL.md` and `release-held`. Restore the entry and confirm `git diff --stat plugin/bin/lib/console/resolve.js` is empty. Never use `git stash`. Quote both raw outputs in the report.

- [ ] **Step 3: Commit**: `Pin every staged-id producer's console disposition in a conformance scan — refs #3488`

Waived AC3.1: a whole-suite property — verified by Common Step 5's verify.js full-suite run against main's baseline, not by a unit test.

## Review Focus

1. A new `stage-item.js` call site in a skill whose `--id` spans a line break or uses `--id=` form. `collectProducers` must not silently miss it. Task 3's floor and named-member set catch a regression in the matcher.
2. `upstream-draft-*` reaching an `unattended` console. It must resolve `pending`, never `filed`. Task 1's `resolveAll` assertion pins this.
3. First-match ordering. A reason row placed after a broader row (e.g. `wrap-up-reflect-insights` after a `wrap-up-skill(-|\b)`-style row) would be shadowed. Task 1's exact-classification assertions pin each reason.
4. An exempt prefix that later gains a console-reaching producer. The disjointness test (exempt ids still classify `unmapped-prefix`) keeps "exempt" meaning "not mapped". A future mapped row for an exempt prefix fails it, and that forces a deliberate removal from `STAGING_EXEMPTIONS`.
5. `wrap-up-cleanup-ordering` and similar `**Category:**`-bearing improvised names. Mapping them into Queue writes must not auto-file a non-tangential finding. Task 1 pins the Category-gate reroute.
