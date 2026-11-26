# Held CI Conclusions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the newest run of a check at the PR head concluded `CANCELLED`, `ACTION_REQUIRED` or `STALE`, every merge gate that reads CI treats the check as `pending`: not green, not red.

**Architecture:** `plugin/bin/lib/pr-checks/classify.js` gains a pinned `HELD_CONCLUSIONS` list and an exported `heldChecks` pass that picks the newest run per check name. It accepts GraphQL-shaped and REST-shaped rows. `classifyRollup` adds held checks to its `pending` verdict. Head-run reads gain `startedAt` and `databaseId` through one exported `HEAD_RUN_FIELDS` constant. The learned-skills drain, the `github-pr-scan.md` display reader, Step 2.5's prose and Step 2.5's bounded-watch loop all follow the same rule. Each reads the list from `classify.js` or is pinned to it by a conformance test.

**Tech Stack:** Node 18+ CommonJS, `node --test`, bash/zsh (the bounded-watch fence).

**Spec:** `.claude-tweaks/pipelines/2026-11-26T164235-record-3467/work/3467-spec.md` (record #3467)

Scope keywords: UNVERIFIED_CONCLUSIONS, OK_CONCLUSIONS

## Global Constraints

- Held conclusions are exactly `CANCELLED`, `ACTION_REQUIRED`, `STALE` (the existing `UNVERIFIED_CONCLUSIONS` minus `SKIPPED`), in that order.
- `SKIPPED` stays green-compatible.
- Only the newest run of a check counts: group by check name, newest by start time, ties broken by id. Start time is `startedAt`, then `run_started_at`, then `createdAt`, then `created_at` (the first one present). The id is `databaseId`, then `id`.
- A held check makes the verdict `pending`, never `red`. Red (any `FAILING_CONCLUSIONS` entry) still wins first. Newest-per-check decides only the held rule: a `FAILURE`-class row stays red even when a newer success supersedes it. This is today's red behaviour, unchanged (spec, Plan Review Clarifications).
- Family rule (spec): newest run per check name; `FAILING_CONCLUSIONS` → red; `HELD_CONCLUSIONS` → pending; `SUCCESS`/`NEUTRAL`/`SKIPPED` → green-compatible. There is one shared list, imported from `classify.js` or pinned to it, never a free-standing copy.
- `FAILING_CONCLUSIONS` is unchanged and stays pinned equal to Step 2.5's red-bullet prose list.
- The composed `merge` bundle (`pr-first-merge.md` + `pr-checklist-refresh.md`) measured 52,480 B against the 52,500 B rail at plan time. Across Tasks 5 and 6, `pr-first-merge.md`'s net growth must stay at or under 20 B. Pay for additions by moving rationale into `pr-first-merge-appendix.md`'s `## Rationale notes`, which no bundle composes.
- Commit subjects use the `{Verb} {what} — {detail}` style and end with "refs #3467", never "closes" or "fixes".
- Maturity `established`: before changing pre-existing behavior, add a characterization test covering its edge cases. A test this plan flips counts as the characterization; every other existing test keeps passing unchanged.
- Governing skill `prose-code-twin-pin` (quoted): "When one vocabulary lives in three or more hand-kept places, list every pair. Pin each pair a real failure can travel along, or say why that pair cannot drift." For this plan the pairs are:
  - classify.js and Step 2.5's held bullet: pinned by Task 5.
  - classify.js `FAILING_CONCLUSIONS` and `github-pr-scan.md`'s `FAILURE` set: pinned by Task 4.
  - classify.js and the drain: cannot drift, because Task 3 imports the list.
  - classify.js and the watch fence: cannot drift, because Task 6 `require`s `classify.js`.
  - The appendix's rationale bullet names the list but routes nothing, so it is not a twin.
  Governing skill `skill-prose-conformance-tests` (the "a table or list that restates a data structure living in code → read it live and pin it against that structure" row) applies to Tasks 4 and 5: their pins read the live prose and the live constant, and each carries a go-red control.
- Re-derive the record's facts against HEAD before editing (its `Verified-as-of` stamp is 1841 commits old). Every path and line number below was re-checked at plan time (base `eaa89bea31`).

## Scope-keyword hits deliberately left unplanned

A Check B sweep with `ACTION_REQUIRED` as a scope keyword listed these files. Each one is ruled out here. That keyword was then dropped, because every hit was a reader this list rules out:
- `plugin/bin/lib/reconcile/red-tip.js` (+ its test): it judges the integration-branch tip for reconcile, not a PR head before merge. Its own comment excludes `cancelled`/`stale`/`action_required` from red by design (Non-Goals), and its verdict gates no merge.
- `plugin/skills/_shared/ci-skips-drafts.md`, `tests/close-out-ready-run-conformance.test.js`, `docs/journeys/skip-ci-on-draft-prs-5153.md`: the ready-run rule already counts a held post-ready run for nothing, so it is never green. That rule agrees with the held rule and needs no change.
- `docs/journeys/recover-a-ci-parked-run.md`: the user-facing effect (a held check now parks as `checks-pending-timeout`, and its remedy is a rerun) is Common Step 6's journey capture to add, not a task here.
- `docs/plans/*-ledger.md`: pipeline ledgers, not code.

## Review Focus

1. A workflow re-triggered on the same sha (for example a `synchronize` run cancelled by the `ready_for_review` run under `cancel-in-progress`): the older cancelled run must not hold a PR whose newer run passed. This is pinned by Task 1's newer-success test, Task 3's drain test and Task 6's watch test.
2. Rows with no usable timestamp or id (older callers, test fakes, a `gh` shape change): ordering cannot be decided, so a tie that contains a held row reads held (fail closed). Pinned by Task 1's tie test.
3. REST rows appended beside `gh run list` rows for the same run (`pr-checks.js` appends `ready.headRuns`): the same run in both shapes must order identically, and a REST-only newer success must override an older cancelled `gh` row. Pinned by Task 1's REST tests.
4. `gh pr checks` exits `1` for `ACTION_REQUIRED` and `0` for a lone `CANCELLED` (gh v2.103.3 source, below). The watch loop must turn both into "keep watching", while a real `FAILURE` beside a held row still exits red. Pinned by Task 6.
5. Prose and code drifting apart (a fourth held conclusion added on one side only). Pinned by Task 5's conformance test and Task 4's pin, each with a go-red control.

---

### Task 1: Held-conclusion rule in `classifyRollup`

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/pr-checks/classify.js`
- Test: `tests/bin-lib/pr-checks/classify.test.js`

**Interfaces:**
- Produces: `HELD_CONCLUSIONS` (frozen array `['CANCELLED', 'ACTION_REQUIRED', 'STALE']`), exported. `UNVERIFIED_CONCLUSIONS` becomes `Object.freeze(['SKIPPED', ...HELD_CONCLUSIONS])` (same values and order as today).
- Produces: `heldChecks(rollup: Array, headRuns: Array) → Array<{ name, url, conclusion }>`, exported. It returns the checks whose newest row is held, in first-seen group order.
- Produces: the `classifyRollup` `pending` result gains a `held: [{ name, url, conclusion }]` key. The key is present only when non-empty and sits after `pending` and before `awaitingReadyRun`. Held names are also appended to `pending`, deduplicated, in first-seen order.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/pr-checks/classify.test.js`. Extend the `run`/`hr` helpers, or add sibling helpers, so a row can carry `startedAt` and, for head runs, `databaseId`. For REST rows, reuse the file's `rest(...)` helper (line 258), which carries `created_at` and `id`, and add `run_started_at` where a test needs it. Name each test with its clause id:
  - `AC1.1: a CANCELLED, ACTION_REQUIRED or STALE rollup check at HEAD is pending, not green`: for each conclusion `c`, `classifyRollup({ rollup: [run('test','COMPLETED',c), run('lint','COMPLETED','SUCCESS')], headRefOid: HEAD, localHead: HEAD, hasPrCi: true })` gives `state === 'pending'`, `pending` deep-equal to `['test']`, and `held` deep-equal to `[{ name: 'test', url: 'https://ci.example/test', conclusion: c }]`.
  - `AC1.1: a cancelled completed head run is pending, not green`: this replaces the existing `'a cancelled completed head run is neither red nor pending'` test (line 119). Use the same input (`GREEN_ROLLUP`, `headRuns: [hr('test','completed','cancelled')]`). Expect `state === 'pending'` and `held[0].conclusion === 'CANCELLED'`. Also update the line-360 table row that feeds the same input, if it asserts a state.
  - `a successful rerun newer than a cancelled run reads green`: two head runs named `test`, one cancelled at `startedAt: '2026-11-26T10:00:00Z'` and one success at `'2026-11-26T10:05:00Z'` → `green`. Pass the rows in both orders and expect the same result.
  - `a cancelled run newer than a success is pending`: the same two rows with the timestamps swapped → `pending`.
  - `equal startedAt: the higher databaseId decides`: same `startedAt`; success with `databaseId: 2` and cancelled with `databaseId: 1` → `green`. Swap the ids → `pending`.
  - `a tie it cannot break, containing a held row, is held (fail closed)`: two `test` head runs with no timestamps and no ids, one success and one cancelled → `pending`.
  - `REST rows order by run_started_at, then created_at, ties by id`: a REST row `{ name: 'test', status: 'completed', conclusion: 'success', run_started_at: T2, id: 5 }` beside a `gh` row `hr('test','completed','cancelled')` with `startedAt: T1` (T1 < T2) → `green`. Swap T1/T2 → `pending`. Repeat with `created_at` in place of `run_started_at`. Then use equal `created_at` with `id: 7` (success) against `id: 6` (cancelled) → `green`.
  - `the same run in gh and REST shape orders as one`: a cancelled run as `{ ...hr('test','completed','cancelled'), startedAt: T, databaseId: 9 }` and as REST `{ name: 'test', status: 'completed', conclusion: 'cancelled', run_started_at: T, id: 9 }` → `pending`, and `held` has length 1.
  - `cross-source: a cancelled rollup job and a newer successful head run of the same name read green`: rollup `run('test','COMPLETED','CANCELLED')` with `startedAt` T1, head run `test` success with `startedAt` T2 > T1, plus `GREEN_ROLLUP` → `green`.
  - `a skipped head run stays green`: `GREEN_ROLLUP` with `headRuns: [hr('test','completed','skipped')]` → `green`.
  - `red wins over a held check and names only the failing check`: rollup `[run('test','COMPLETED','CANCELLED'), run('lint','COMPLETED','FAILURE')]` → `red`, and `failing` names only `lint`.
  - `a held check whose newer run is in progress is pending and named once`: `test` cancelled (T1), then `test` in_progress (T2) → `pending`, `pending` deep-equal to `['test']`, and no `held` key.
  - `HELD_CONCLUSIONS is the unverified set minus SKIPPED`: deep-equal to `['CANCELLED','ACTION_REQUIRED','STALE']` and frozen.
  - `heldChecks is exported and reads head runs alone`: `heldChecks([], [hr('test','completed','cancelled')])` deep-equals `[{ name: 'test', url: 'https://ci.example/runs/test', conclusion: 'CANCELLED' }]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/pr-checks/classify.test.js`
Expected: FAIL. The AC1.1 tests read `green`, and `HELD_CONCLUSIONS`/`heldChecks` are undefined.

- [ ] **Step 3: Implement in `plugin/bin/lib/pr-checks/classify.js`**
  - Add `HELD_CONCLUSIONS` next to `UNVERIFIED_CONCLUSIONS`, and derive `UNVERIFIED_CONCLUSIONS` from it. Export both `HELD_CONCLUSIONS` and `heldChecks`.
  - `heldChecks(rollup, headRuns)` builds rows from `normalizeEntry` (rollup) and `normalizeHeadRun` (head runs). Each row gets an ordering key `[at, id]`:
    - `at` is `Date.parse` of the raw row's first present field among `startedAt`, `run_started_at`, `createdAt`, `created_at`. An unparseable or absent value is `-Infinity`.
    - `id` is a finite `databaseId ?? id`, otherwise `-Infinity`. This is the same `databaseId ?? id` reading `readyRunVerdict`'s `ids` already uses.
    Leave the return shapes of `normalizeEntry` and `normalizeHeadRun` unchanged, because existing tests pin them. Skip a non-object row or a nameless row. Group the rows by `name` and find each group's maximum key. The check is held when any row at that maximum key has `status === 'COMPLETED'` and a conclusion in `HELD_CONCLUSIONS`; that is the fail-closed tie rule. Emit the first such row's `{ name, url, conclusion }`, in first-seen group order.
  - In `classifyRollup`, after the red return and before the pending computation, call `heldChecks(rollup, headRuns || [])`. Pending names are the not-completed names followed by the held names, deduplicated. Return `pending` when there are pending names, `awaiting` entries or held entries. Include `held` only when it is non-empty. The extras order is `pending`, `held`, `awaitingReadyRun`.
  - Update the header comment with one bullet: a newest-per-check held conclusion reads pending (#3467), and the conformance test pins `HELD_CONCLUSIONS` too.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/pr-checks/classify.test.js tests/bin-lib/pr-checks/cli.test.js tests/bin-lib/driver/merge.test.js`
Expected: PASS, all tests. `merge.js` and `pr-checks.js` call `classifyRollup` and must not regress.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/pr-checks/classify.js tests/bin-lib/pr-checks/classify.test.js
git commit -m "Hold cancelled, action_required and stale checks as pending — newest run per check decides, refs #3467"
```

### Task 2: One head-run field list carrying start time and id

**Files:**
- Modify: `plugin/bin/lib/pr-checks/classify.js` (export `HEAD_RUN_FIELDS`)
- Modify: `plugin/bin/lib/driver/merge.js:565` (`RUN_FIELDS`)
- Modify: `plugin/bin/lib/learned-skills/drain.js:228`
- Modify: `plugin/bin/pr-checks.js:220` (the head read only; the base read at `:148` stays as is)
- Test: `tests/bin-lib/pr-checks/classify.test.js`
- Test: `tests/bin-lib/driver/merge.test.js:974`
- Test: `tests/bin-lib/pr-checks/cli.test.js:201`

**Interfaces:**
- Consumes: Task 1's `heldChecks`, which reads `startedAt` and `databaseId` from head-run rows.
- Produces: `HEAD_RUN_FIELDS = 'databaseId,name,workflowName,status,conclusion,url,startedAt'`, exported from `classify.js`. All three head-run readers pass it as the `--json` value.

- [ ] **Step 1: Write the failing test, then update the two pins.** Append `HEAD_RUN_FIELDS carries start time and id for newest-per-check ordering` to `tests/bin-lib/pr-checks/classify.test.js`. It asserts `HEAD_RUN_FIELDS === 'databaseId,name,workflowName,status,conclusion,url,startedAt'`. Then change `merge.test.js:974` and `cli.test.js:201` to expect `HEAD_RUN_FIELDS` (imported from `plugin/bin/lib/pr-checks/classify`) in place of the old `'name,workflowName,status,conclusion,url'` literal.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/pr-checks/classify.test.js`
Expected: FAIL (`HEAD_RUN_FIELDS` is undefined).

- [ ] **Step 3: Implement.** Export `HEAD_RUN_FIELDS` from `classify.js`. `merge.js` sets `RUN_FIELDS = HEAD_RUN_FIELDS`, imported through its existing `require('../pr-checks/classify')` destructure. `drain.js` and `pr-checks.js:220` pass `HEAD_RUN_FIELDS` through their existing classify imports. Then sweep with `git grep -n -F "name,workflowName,status,conclusion,url" -- plugin/bin`: it must print only `pr-checks.js`'s base read (`databaseId,name,...` without `startedAt`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/driver/merge.test.js tests/bin-lib/pr-checks/cli.test.js tests/bin-lib/learned-skills/drain.test.js tests/bin-lib/pr-checks/classify.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/pr-checks/classify.js plugin/bin/lib/driver/merge.js plugin/bin/lib/learned-skills/drain.js plugin/bin/pr-checks.js tests/bin-lib/pr-checks/classify.test.js tests/bin-lib/driver/merge.test.js tests/bin-lib/pr-checks/cli.test.js
git commit -m "Read head runs with start time and id from one field list — newest-per-check needs an order, refs #3467"
```

### Task 3: The learned-skills drain follows the held rule (Reading B)

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/learned-skills/drain.js:42` (import), `:58` (`OK_CONCLUSIONS` comment), `:94` (the second scan)
- Test: `tests/bin-lib/learned-skills/drain.test.js`

**Interfaces:**
- Consumes: `HELD_CONCLUSIONS`, imported from `../pr-checks/classify` into the existing destructure, never a local copy.

- [ ] **Step 1: Write the failing tests**
  - `:579`: change the expectation for `classifyPr(view(), [{ workflowName: 'w', status: 'completed', conclusion: 'cancelled' }], { state: 'met' })` from `'red'` to `'pending'`.
  - Add, beside it, `classifyPr: a held newest run is pending, a newer success over a cancelled run is green, a non-held non-OK conclusion stays red`, with three cases:
    - head runs `[{ workflowName: 'w', status: 'completed', conclusion: 'action_required', startedAt: T1, databaseId: 1 }]` → `'pending'`.
    - the same `w` cancelled at T1 plus `w` success at T2 > T1 → `'green'`.
    - a rollup entry `{ name: 'x', status: 'COMPLETED', conclusion: 'WEIRD' }` → `'red'`. This pins that the second scan still catches a conclusion that is neither held nor OK.
  - AC5.1 table (`:510`): the `cancelled` row's expected `reason` becomes the same reason the `partial` row expects (`'timeout'`), because a held check now takes the pending path. Keep `h.merges().length === 0`, which says the drain still never merges on a held check.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/learned-skills/drain.test.js`
Expected: FAIL after Step 1. The cancelled cases read `red`.

- [ ] **Step 3: Implement.** In `classifyPr`'s second scan (`:94`), a completed check is red only when its conclusion is neither in `OK_CONCLUSIONS` nor in `HELD_CONCLUSIONS`. A held newest run then reaches `classifyRollup`'s `pending`. An older held run superseded by a newer success is excluded by the scan and read green by `classifyRollup`. Leave `OK_CONCLUSIONS` as it is, and extend the comment above it with one line that names the held exclusion and #3467.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/learned-skills/drain.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/learned-skills/drain.js tests/bin-lib/learned-skills/drain.test.js
git commit -m "Read held checks as pending in the learned-skills drain — one rule for every CI merge gate, refs #3467"
```

### Task 4: The `github-pr-scan.md` display reader follows the held rule

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan.md:70` (item 1's `FAILURE` set)
- Test: `tests/display-ci-readers-conformance.test.js`

**Interfaces:**
- Consumes: `FAILING_CONCLUSIONS`, `HELD_CONCLUSIONS` from `plugin/bin/lib/pr-checks/classify` (test side only). The fence runs with `PLUGIN_ROOT` pointed at a stub root, so it cannot `require` `classify.js`. Both sets stay literals and are pinned instead.
- Byte budget: `github-pr-scan.md` had 391 B of headroom at plan time, and the composed `pr-scan` bundle (`tidy/scan-procedures.md:295`) had 244 B. Keep the net growth under 200 B, and re-run `plan-audit.js` (Step 4) to confirm.

- [ ] **Step 1: Write the failing tests**
  - In the item 1 run-the-fence test, add three PRs. PR 8 has `[{ conclusion: 'SUCCESS' }, { conclusion: 'CANCELLED' }]` and PR 9 has `[{ conclusion: 'SUCCESS' }, { conclusion: 'ACTION_REQUIRED' }]`: their rollups hold only OK and held conclusions, so they now reach `pr-checks.js` and print its verdict. PR 10 has `[{ conclusion: 'CANCELLED' }, { conclusion: 'FAILURE' }]`. Extend the stub's state map with `8: 'pending'` and `9: 'green'`. Expected lines: `'#8 CI pending'`, `'#9 CI passing'` (newest-per-check is `pr-checks.js`'s call, not the pre-filter's), and `'#10 CI failing'`. The `pr-checks.js` call list becomes `['1','2','3','4','5','8','9']`.
  - New test `the item 1 FAILURE set equals FAILING_CONCLUSIONS and HELD equals HELD_CONCLUSIONS (code twins)`: extract the quoted tokens of the `` FAILURE = new Set([...]) `` literal and the `` HELD = new Set([...]) `` literal from `repoWideItem1Slice()`. Deep-equal them to `[...FAILING_CONCLUSIONS]` and `[...HELD_CONCLUSIONS]`. Add a go-red control: with `'CANCELLED'` spliced back into the `FAILURE` literal, the deep-equal fails.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/display-ci-readers-conformance.test.js`
Expected: FAIL after Step 1. `#8 CI failing` is printed, and the set holds `CANCELLED`/`ACTION_REQUIRED`.

- [ ] **Step 3: Implement.** Change line 70 to `const FAILURE = new Set(['FAILURE', 'TIMED_OUT', 'ERROR', 'STARTUP_FAILURE']);` (`FAILING_CONCLUSIONS`' order). Add `const HELD = new Set(['CANCELLED', 'ACTION_REQUIRED', 'STALE']);` (`HELD_CONCLUSIONS`' order). Then widen the `pr-checks.js` pre-filter (`:75`) from "every check is `NON_BLOCKING`" to "every check is `NON_BLOCKING` or `HELD`". A rollup whose only non-OK checks are held is then judged by `pr-checks.js` (`classifyRollup`, newest per check) instead of the pre-filter. Update the pre-filter's comment to say so in a few words. Item 9's `NON_BLOCKING` filter (`:186`) already reads held as non-green, which is the fail-closed direction for an unarmed-PR candidate list, so leave it as it is.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/display-ci-readers-conformance.test.js tests/github-pr-scan-unsettled-node-budget.test.js tests/skill-fence-guard-shapes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/github-pr-scan.md tests/display-ci-readers-conformance.test.js
git commit -m "Show held CI conclusions as pending in the PR scan — pinned to FAILING_CONCLUSIONS, refs #3467"
```

### Task 5: Step 2.5 prose and conformance pins

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md:131` (the head-run read) and the Step 2.5 classification list (a new bullet after the `- Any entry with \`status\`` pending bullet)
- Modify: `plugin/skills/release/execute.md:140` (the same head-run read, kept identical to Step 2.5's)
- Modify: `plugin/skills/_shared/pr-first-merge-appendix.md` (`## Rationale notes`)
- Modify: `docs/plugin-structure.md:79` (the classify.js line: name `HELD_CONCLUSIONS` and `HEAD_RUN_FIELDS` as pinned too)
- Test: `tests/pr-check-gate-conformance.test.js`, `tests/pr-first-merge.test.js:590`

**Interfaces:**
- Consumes: `HELD_CONCLUSIONS`, `HEAD_RUN_FIELDS` from `plugin/bin/lib/pr-checks/classify`.

- [ ] **Step 1: Write the failing tests**
  - In `tests/pr-check-gate-conformance.test.js`, add `AC2.1: HELD_CONCLUSIONS equals the merge gate held-bullet prose list (code twin)`. Find the one `MERGE` line that starts `- A check whose newest entry`. Take the text between `` `conclusion` in`` and `→`, extract the `` `([A-Z_]+)` `` tokens, and deep-equal them to `[...HELD_CONCLUSIONS]`. Add a go-red control: with `STALE` deleted from that line, the same extraction no longer deep-equals.
  - In the same file, add `AC2.1: FAILING_CONCLUSIONS and HELD_CONCLUSIONS are disjoint`.
  - In the same file, add `the Step 2.5 head-run read requests HEAD_RUN_FIELDS`. The `MERGE` line starting `gh run list --repo {owner}/{repo} --commit {headRefOid} --limit 100 --json` must end with `--json ${HEAD_RUN_FIELDS}`. Also assert that `plugin/skills/release/execute.md` carries `--limit 100 --json ${HEAD_RUN_FIELDS}` on its head-run read line.
  - In `tests/pr-first-merge.test.js:590`, set `HEAD_RUNS_LINE`'s `--json` value to the new field list.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/pr-check-gate-conformance.test.js tests/pr-first-merge.test.js`
Expected: FAIL. There is no held bullet yet, and the old field list is still in place.

- [ ] **Step 3: Edit the prose (the byte budget is in Global Constraints)**
  - At `pr-first-merge.md:131`, change the `--json` value to `databaseId,name,workflowName,status,conclusion,url,startedAt`. Make the same change at `release/execute.md:140`.
  - Directly after the pending bullet (`- Any entry with \`status\` not \`COMPLETED\`…`), insert one bullet. The marker phrase and the three-conclusion list must sit on its first physical line:

    `- A check whose newest entry (rollup entries and head runs by name; newest by start time, then id; an unbreakable tie holds) completed with \`conclusion\` in \`CANCELLED\`, \`ACTION_REQUIRED\`, or \`STALE\` → **pending** (held; code twin \`HELD_CONCLUSIONS\`).`

  - Pay for it at `pr-first-merge.md:128`. Cut the sentence "The rollup lists only the checks GitHub has registered so far, so a partial rollup — some workflows reported, others not yet registered — reads green while a sibling workflow is still pending." Replace it with a short `(why: \`pr-first-merge-appendix.md\`'s "Rationale notes")` pointer.
  - Append two bullets to the appendix's `## Rationale notes`. The first is the cut sentence, verbatim. The second gives the held rule's why: nothing failed, so the remedy is a rerun, not a fix round; `SKIPPED` stays green because draft-time fix-label jobs skip; a newer successful run of the same check reads green because only the newest counts, and `cancel-in-progress` cancels runs of older shas. It also names the four start-time fields and the two id fields the code twin reads. Cite #3467.
  - At `docs/plugin-structure.md:79`, after the `FAILING_CONCLUSIONS is pinned…` clause, add `; HELD_CONCLUSIONS (the newest run per check concluded CANCELLED/ACTION_REQUIRED/STALE reads pending, #3467) and HEAD_RUN_FIELDS are pinned the same way`.
  - Sweep for prose that still says a cancelled run reads green: `git grep -n -i -E "cancel+ed[^.]*green|neither red nor pending" -- plugin docs tests`. Fix any hit in shipped prose that describes the old rule. Leave history files (`docs/incident-log.md`, `CHANGELOG.md`) alone. `pr-first-merge.md:408`'s post-merge report is out of scope, because it describes a merge that has already happened and gates nothing.

- [ ] **Step 4: Run the tests to verify they pass, then check the byte rails**

Run: `node --test tests/pr-check-gate-conformance.test.js tests/pr-first-merge.test.js tests/merge-verification-gate-conformance.test.js`
Expected: PASS.
Run: `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.180.0/bin/plan-audit.js" docs/superpowers/plans/2026-11-26-held-ci-conclusions.md`
Expected: `headroom.breaches` is empty, and no `headroom.composed` row has `over > 0`. If a row does, move more Step 2.5 rationale to the appendix and re-run.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge.md plugin/skills/_shared/pr-first-merge-appendix.md plugin/skills/release/execute.md docs/plugin-structure.md tests/pr-check-gate-conformance.test.js tests/pr-first-merge.test.js
git commit -m "State the held-conclusion rule in Step 2.5 — pinned to HELD_CONCLUSIONS and HEAD_RUN_FIELDS, refs #3467"
```

### Task 6: The Step 2.5 bounded watch treats a held check as still pending

**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md:198-244` (the bounded-watch fence, its intro sentence and the `RC=0`/`RC=1` bullets)
- Modify: `plugin/skills/_shared/pr-first-merge-appendix.md` (`## Rationale notes` and `## Signatures`: the gh source facts below)
- Test: `tests/merge-watch-ready-run.test.js` (the extract-and-run harness), `tests/merge-verification-gate-conformance.test.js`

**Interfaces:**
- Consumes: `heldChecks` and `HELD_CONCLUSIONS`, `FAILING_CONCLUSIONS` from Task 1, reached in the fence as `require("${CLAUDE_PLUGIN_ROOT}/bin/lib/pr-checks/classify.js")` through `process.argv`. The loop already reaches `${CLAUDE_PLUGIN_ROOT}/bin/ready-run.js` the same way.

**Observed `gh pr checks` behavior (probe done at plan time, gh v2.103.3).** No PR in this repo's last 1,000 carries a held conclusion, so there was no live sample. These facts come from the installed version's own source, `cli/cli@v2.103.3` `pkg/cmd/pr/checks/aggregate.go` and `checks.go`:
- `CANCELLED` → bucket `cancel`. It is counted in neither `Failed` nor `Pending`, so a lone cancelled check exits **0** (reads green to today's loop).
- `ACTION_REQUIRED` → bucket `fail`, which exits **1** (reads red to today's loop).
- `STALE` → bucket `pending`, which exits **8** (already pending).
- `STARTUP_FAILURE` → bucket `pending`, which exits 8. It is red in the rollup read Step 2.5 makes after the watch, so it is out of scope here.
- With `--json`, the command returns before its exit-code logic, so it always exits 0 once checks exist. The `no checks reported` error still fires.
- gh keeps only the newest entry per check name/workflow/event, by `startedAt`.

The first step re-checks these on the installed gh: `gh --version`, then the two files at that tag via `gh api "repos/cli/cli/contents/pkg/cmd/pr/checks/aggregate.go?ref=v{version}" -H "Accept: application/vnd.github.raw"`. If the bucket mapping differs, build to what you observed and record it in the appendix.

- [ ] **Step 1: Write the failing tests** in `tests/merge-watch-ready-run.test.js`. Extend the harness so the `gh` stub answers `pr checks … --json state` with the contents of `$CHECKS_JSON` (default `[]`) and answers plain `pr checks` with exit `$CHECKS_RC` (default 0). `run list` prints `$RUNS_JSON` (default `[]`). Copy the real `plugin/bin/lib/pr-checks/classify.js` into the stub root at `bin/lib/pr-checks/classify.js`. Then add these tests, each in bash and zsh like the file's existing ones:
  - `a lone cancelled check (gh exit 0) keeps watching until the bound`: `CHECKS_RC=0`, `CHECKS_JSON=[{"state":"CANCELLED"}]`, `DATE_MODE=jump` → final `RC=124`.
  - `ACTION_REQUIRED (gh exit 1) keeps watching, not red`: `CHECKS_RC=1`, `CHECKS_JSON=[{"state":"ACTION_REQUIRED"}]`, `DATE_MODE=jump` → `RC=124`.
  - `a real failure beside a held check is still red, naming only the failing check`: `CHECKS_RC=1`, `CHECKS_JSON=[{"name":"a","state":"ACTION_REQUIRED"},{"name":"b","state":"FAILURE"}]` → `RC=1` on the first pass. The names the `RC=1` bullet parks with come from `{pr-checks-json-path}`'s rows whose state is in `FAILING_CONCLUSIONS`, so they are `b` only, never `a`. Pin it with a conformance assertion on the `RC=1` bullet's wording.
  - `a held newest head run keeps watching`: `CHECKS_RC=0`, `RUNS_JSON` holds one `test` run, completed and cancelled, with `startedAt`/`databaseId` → `RC=124` under `DATE_MODE=jump`.
  - `a cancelled head run superseded by a newer success breaks green`: `RUNS_JSON` holds `test` cancelled at T1 and `test` success at T2 > T1 → `RC=0` on the first pass.
  - `a failed --json read stops the watch`: the stub exits non-zero for `pr checks … --json` → `RC=2`.
  - Go-red control: remove the fence line that maps a held `--json` read to pending, and the cancelled test ends `RC=0`.
  - Keep every existing test in the file passing. Their stubs now print `[]` for the `--json` read.
  In `tests/merge-verification-gate-conformance.test.js`, extend the `0)` branch assertions so the head-run read requests `HEAD_RUN_FIELDS` and `PENDING_RUNS` counts `heldChecks`. Assert that the `RC=0` bullet names a held head run as resuming the watch.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/merge-watch-ready-run.test.js tests/merge-verification-gate-conformance.test.js`
Expected: FAIL. The cancelled case breaks green (`RC=0`) and the `ACTION_REQUIRED` case breaks red (`RC=1`).

- [ ] **Step 3: Edit the fence and its prose**
  - Right after the `no checks reported` line, add one guarded re-read, which runs only when `RC` is 0 or 1. It runs `gh pr checks {pr-number} --repo {owner}/{repo} --json name,state > "{pr-checks-json-path}"` (a failure gives `RC=2; break`). Then a `node -e` over the saved file and `classify.js` prints the new `RC`: `1` when any state is in `FAILING_CONCLUSIONS`, else `8` when any state is in `HELD_CONCLUSIONS`, else the unchanged `RC`. A failed `node` gives `RC=2; break`. Add `PR_CHECKS_JSON=pr-checks-{n}.json` to Step 2.5's `session-tmp-resolve.js` line, and add `{pr-checks-json-path}` to the substitution sentence.
  - In the `0)` arm, change the runs read to `--json databaseId,name,workflowName,status,conclusion,url,startedAt` (the `HEAD_RUN_FIELDS` value). `PENDING_RUNS` then becomes the not-completed count plus `heldChecks([], rows).length` (`require` of `classify.js` via `process.argv`). Keep the line reading counts from the saved file, with no `--jq`.
  - Update the exit-code sentence above the fence to state the held mapping in one clause, and move the gh-source facts above into the appendix (`## Signatures` for the observed exit codes, `## Rationale notes` for the why), with a pointer left in the gate.
  - In the `RC=0` bullet, a head run not yet `completed` **or held** resumes the bounded watch at the same `DEADLINE`. In the `RC=1` bullet, the names come from the `{pr-checks-json-path}` rows whose state is in `FAILING_CONCLUSIONS`, in place of the `fail` rows of `{pr-checks-path}` (gh buckets `ACTION_REQUIRED` as `fail`).
  - Known fail-closed divergence, stated in the appendix's `## Rationale notes`, not fixed in the fence. The watch's held mapping reads `gh pr checks` states, which gh deduplicates newest-per-check within the rollup only. A cancelled rollup job whose newer run of the same name exists only as a head run, and not in the rollup, keeps the watch waiting until the bound. It then parks as `checks-pending-timeout`, whose remedy is a rerun, never a merge. `classifyRollup` (Task 1) reads that case green. The fence takes the conservative direction because the merge bundle has no byte room for a cross-source comparison, and a rerun registers its check run in the rollup in the ordinary case.
  - Keep `pr-first-merge.md`'s net growth across Tasks 5 and 6 within the Global Constraints budget. Pay for it by moving Step 2.5 rationale (for example the paragraph under the fence about `--jq`, or the Read-state-first rationale) into the appendix.

- [ ] **Step 4: Run the tests to verify they pass, then check the byte rails**

Run: `node --test tests/merge-watch-ready-run.test.js tests/merge-verification-gate-conformance.test.js tests/pr-first-merge.test.js tests/pr-check-gate-conformance.test.js tests/session-tmp-root-migration.test.js tests/skill-fence-guard-shapes.test.js`
Expected: PASS.
Run: `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.180.0/bin/plan-audit.js" docs/superpowers/plans/2026-11-26-held-ci-conclusions.md`
Expected: `headroom.breaches` is empty, and no `headroom.composed` row has `over > 0`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge.md plugin/skills/_shared/pr-first-merge-appendix.md tests/merge-watch-ready-run.test.js tests/merge-verification-gate-conformance.test.js
git commit -m "Keep the bounded watch waiting on a held check — gh exits 0 for cancelled and 1 for action_required, refs #3467"
```
