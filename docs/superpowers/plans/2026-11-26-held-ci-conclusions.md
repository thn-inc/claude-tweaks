# Held CI Conclusions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the newest run of a check at the PR head concluded `CANCELLED`, `ACTION_REQUIRED` or `STALE`, the merge-verification classifier reads `pending` instead of `green`.

**Architecture:** `plugin/bin/lib/pr-checks/classify.js` gains a pinned `HELD_CONCLUSIONS` list and a newest-per-check pass inside `classifyRollup`. It runs after the red rule and adds held checks to the `pending` verdict. Head-run reads gain `startedAt` and `databaseId` so "newest" is decidable. One exported `HEAD_RUN_FIELDS` constant replaces the three copied field strings. `_shared/pr-first-merge.md` Step 2.5's prose gains the held bullet and the widened read. Conformance tests pin the prose list against `HELD_CONCLUSIONS` and the prose read against `HEAD_RUN_FIELDS`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T162224-record-3467/work/3467-spec.md` (record #3467)

Scope keywords: UNVERIFIED_CONCLUSIONS

## Global Constraints

- Held conclusions are exactly `CANCELLED`, `ACTION_REQUIRED`, `STALE` (the existing `UNVERIFIED_CONCLUSIONS` minus `SKIPPED`), in that order.
- `SKIPPED` stays green-compatible.
- Only the newest run of a check counts: group by check name, newest by start time, ties broken by id.
- A held check makes the verdict `pending`, never `red`. Red (any `FAILING_CONCLUSIONS` entry) still wins first.
- `FAILING_CONCLUSIONS` is unchanged and stays pinned equal to Step 2.5's red-bullet prose list.
- Commit subjects use the `{Verb} {what} — {detail}` style and end with "refs #3467", never "closes" or "fixes".
- Maturity `established`: before changing pre-existing behavior, add a characterization test covering its edge cases (the cancelled-is-green test this plan flips counts as the existing characterization; keep every other existing classify test passing unchanged).

## Review Focus

1. A workflow re-triggered on the same sha (for example a `synchronize` run cancelled by the `ready_for_review` run under `cancel-in-progress`): the older cancelled run must not hold a PR whose newer run passed. Pinned by Task 1's "newer success after a cancelled run reads green" test.
2. Rows with no usable timestamp or id (older callers, test fakes, a `gh` shape change): ordering cannot be decided, so a tie containing a held row reads held (fail closed). Pinned by Task 1's tie test.
3. A held rollup job and a successful head run of the same name (cross-source grouping): only the newest counts. Pinned by Task 1's cross-source test.
4. A red check beside a held check: still red, naming only the failing check. Pinned by Task 1.
5. Prose and code drifting apart (a fourth held conclusion added to one side): pinned by Task 3's conformance test and its go-red control.

---

### Task 1: Held-conclusion rule in `classifyRollup`

**Files:**
- Modify: `plugin/bin/lib/pr-checks/classify.js`
- Test: `tests/bin-lib/pr-checks/classify.test.js`

**Interfaces:**
- Produces: `HELD_CONCLUSIONS` (frozen array `['CANCELLED', 'ACTION_REQUIRED', 'STALE']`), exported. `UNVERIFIED_CONCLUSIONS` becomes `Object.freeze(['SKIPPED', ...HELD_CONCLUSIONS])` (same values and order as today). The `classifyRollup` `pending` result gains a `held: [{ name, url, conclusion }]` key, present only when non-empty, placed after `pending` and before `awaitingReadyRun`. Held names are also appended to `pending` (deduplicated, first-seen order).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/pr-checks/classify.test.js`. Extend the `run`/`hr` helpers (or add sibling helpers) so a row can carry `startedAt` and, for head runs, `databaseId`. Name each test with its clause id:
  - `AC1.1: a CANCELLED, ACTION_REQUIRED or STALE rollup check at HEAD is pending, not green`: for each conclusion, `classifyRollup({ rollup: [run('test','COMPLETED',c), run('lint','COMPLETED','SUCCESS')], headRefOid: HEAD, localHead: HEAD, hasPrCi: true })` gives `state === 'pending'`, `pending` deep-equal to `['test']`, and `held` deep-equal to `[{ name: 'test', url: 'https://ci.example/test', conclusion: c }]`.
  - `AC1.1: a cancelled completed head run is pending, not green`: replace the existing `'a cancelled completed head run is neither red nor pending'` test. Same input as that test (`GREEN_ROLLUP`, `headRuns: [hr('test','completed','cancelled')]`). Expect `state === 'pending'` and `held[0].conclusion === 'CANCELLED'`.
  - `a successful rerun newer than a cancelled run reads green`: two head runs named `test`, one cancelled at `startedAt: '2026-11-26T10:00:00Z'`, one success at `'2026-11-26T10:05:00Z'` → `green`. Pass the rows in both orders and expect the same result.
  - `a cancelled run newer than a success is pending`: the same two rows with the timestamps swapped → `pending`.
  - `equal startedAt: the higher databaseId decides`: same `startedAt`; success with `databaseId: 2` and cancelled with `databaseId: 1` → `green`; swap the ids → `pending`.
  - `a tie it cannot break, containing a held row, is held (fail closed)`: two `test` head runs with no `startedAt` and no `databaseId`, one success and one cancelled → `pending`.
  - `cross-source: a cancelled rollup job and a newer successful head run of the same name read green`: rollup `run('test','COMPLETED','CANCELLED')` with `startedAt` T1, head run `test` success with `startedAt` T2 > T1, plus `GREEN_ROLLUP` → `green`.
  - `a skipped head run stays green`: `GREEN_ROLLUP` with `headRuns: [hr('test','completed','skipped')]` → `green`.
  - `red wins over a held check and names only the failing check`: rollup `[run('test','COMPLETED','CANCELLED'), run('lint','COMPLETED','FAILURE')]` → `red`, `failing` names only `lint`.
  - `a held check whose newer run is in progress is pending and named once`: `test` cancelled (T1), then `test` in_progress (T2) → `pending`, `pending` deep-equal to `['test']`, and no `held` key.
  - `HELD_CONCLUSIONS is the unverified set minus SKIPPED`: deep-equal to `['CANCELLED','ACTION_REQUIRED','STALE']` and frozen.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/pr-checks/classify.test.js`
Expected: FAIL. The AC1.1 tests read `green` and `HELD_CONCLUSIONS` is undefined.

- [ ] **Step 3: Implement in `plugin/bin/lib/pr-checks/classify.js`**
  - Add `HELD_CONCLUSIONS` next to `UNVERIFIED_CONCLUSIONS`, and derive `UNVERIFIED_CONCLUSIONS` from it. Export `HELD_CONCLUSIONS`.
  - Add an internal `heldChecks(rollup, headRuns)` that returns `[{ name, url, conclusion }]`. It builds rows from `normalizeEntry` (rollup) and `normalizeHeadRun` (head runs), each with an ordering key `[at, id]`:
    - `at` is `Date.parse` of the raw row's `startedAt`, then `createdAt` for a head run. An unparseable value is `-Infinity`.
    - `id` is a finite `databaseId` (head runs only), otherwise `-Infinity`.
    Leave `normalizeEntry`/`normalizeHeadRun`'s return shapes unchanged; existing tests pin them. Group rows by `name` and find the group's maximum key. The check is held when any row at that maximum key has `status === 'COMPLETED'` and a conclusion in `HELD_CONCLUSIONS`; that is the fail-closed tie rule. Emit the first such row's `{ name, url, conclusion }`, in first-seen group order.
  - In `classifyRollup`, after the red return and before the pending computation, call `heldChecks(rollup, headRuns || [])`. Pending names are the not-completed names followed by the held names, deduplicated. Return `pending` when pending names, `awaiting` or held entries exist. Include `held` only when it is non-empty. The extras order is `pending`, `held`, `awaitingReadyRun`.
  - Update the header comment: add one bullet saying a newest-per-check held conclusion reads pending (#3467), and say the conformance test pins `HELD_CONCLUSIONS` too.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/pr-checks/classify.test.js`
Expected: PASS, all tests.

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
- Modify: `plugin/bin/pr-checks.js:220` (head read only; the base read at `:148` stays as is)
- Test: `tests/bin-lib/pr-checks/classify.test.js`
- Test: `tests/bin-lib/driver/merge.test.js:974`
- Test: `tests/bin-lib/pr-checks/cli.test.js:201`

**Interfaces:**
- Consumes: Task 1's `heldChecks` reads `startedAt` and `databaseId` from head-run rows.
- Produces: `HEAD_RUN_FIELDS = 'databaseId,name,workflowName,status,conclusion,url,startedAt'`, exported from `classify.js`. All three head-run readers pass it as the `--json` value.

- [ ] **Step 1: Write the failing test, then update the two pins.** Append `HEAD_RUN_FIELDS carries start time and id for newest-per-check ordering` to `tests/bin-lib/pr-checks/classify.test.js`. It asserts `HEAD_RUN_FIELDS === 'databaseId,name,workflowName,status,conclusion,url,startedAt'`. Then change `merge.test.js:974` and `cli.test.js:201` to expect `HEAD_RUN_FIELDS` (imported from `plugin/bin/lib/pr-checks/classify`) in place of the old `'name,workflowName,status,conclusion,url'` literal.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/pr-checks/classify.test.js`
Expected: FAIL (`HEAD_RUN_FIELDS` is undefined).

- [ ] **Step 3: Implement.** Export `HEAD_RUN_FIELDS` from `classify.js`. `merge.js` sets `RUN_FIELDS = HEAD_RUN_FIELDS`, imported through its existing `require('../pr-checks/classify')` destructure. `drain.js` and `pr-checks.js:220` pass `HEAD_RUN_FIELDS` through their existing classify imports. Then sweep: `git grep -n -F "name,workflowName,status,conclusion,url" -- plugin/bin` must print only `pr-checks.js`'s base read (`databaseId,name,...` without `startedAt`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/driver/merge.test.js tests/bin-lib/pr-checks/cli.test.js tests/bin-lib/learned-skills/drain.test.js tests/bin-lib/pr-checks/classify.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/pr-checks/classify.js plugin/bin/lib/driver/merge.js plugin/bin/lib/learned-skills/drain.js plugin/bin/pr-checks.js tests/bin-lib/driver/merge.test.js tests/bin-lib/pr-checks/cli.test.js
git commit -m "Read head runs with start time and id from one field list — newest-per-check needs an order, refs #3467"
```

### Task 3: Step 2.5 prose and conformance pins

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md:131` (head-run read) and the Step 2.5 classification list (new bullet after the `- Any entry with \`status\`` pending bullet)
- Modify: `plugin/skills/release/execute.md:140` (same head-run read, kept identical to Step 2.5's)
- Modify: `plugin/skills/_shared/pr-first-merge-appendix.md` ("Rationale notes")
- Modify: `docs/plugin-structure.md:79` (classify.js line: name `HELD_CONCLUSIONS` and `HEAD_RUN_FIELDS` as pinned too)
- Test: `tests/pr-check-gate-conformance.test.js`, `tests/pr-first-merge.test.js:590`

**Interfaces:**
- Consumes: `HELD_CONCLUSIONS`, `HEAD_RUN_FIELDS` from `plugin/bin/lib/pr-checks/classify`.

- [ ] **Step 1: Write the failing tests**
  - In `tests/pr-check-gate-conformance.test.js`: `AC2.1: HELD_CONCLUSIONS equals the merge gate held-bullet prose list (code twin)`. Find the one `MERGE` line that starts `- A check whose newest entry`. Take the text between `` `conclusion` in`` and `→`, extract the `` `([A-Z_]+)` `` tokens, and deep-equal them to `[...HELD_CONCLUSIONS]`. Add a go-red control: with `STALE` deleted from that line, the same extraction no longer deep-equals.
  - In the same file: `AC2.1: FAILING_CONCLUSIONS and HELD_CONCLUSIONS are disjoint`.
  - In the same file: `the Step 2.5 head-run read requests HEAD_RUN_FIELDS`. The `MERGE` line starting `gh run list --repo {owner}/{repo} --commit {headRefOid}` ends with `--json ${HEAD_RUN_FIELDS}`. Also assert that `plugin/skills/release/execute.md` carries `--limit 100 --json ${HEAD_RUN_FIELDS}` on its head-run read line.
  - In `tests/pr-first-merge.test.js:590`, set `HEAD_RUNS_LINE`'s `--json` value to the new field list.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/pr-check-gate-conformance.test.js tests/pr-first-merge.test.js`
Expected: FAIL (there is no held bullet yet, and the old field list).

- [ ] **Step 3: Edit the prose. The composed `merge` bundle has a 20 B budget.** `bin/lib/compose-context/phases.js:35` composes `pr-first-merge.md` + `pr-checklist-refresh.md` into the second call's `merge` bundle. `plan-audit.js` measured that bundle at 52,480 B against the 52,500 B rail, so this file's net growth must stay at or under 20 B. Pay for the additions by moving rationale into `pr-first-merge-appendix.md`, which is not in any bundle. That file's existing "Rationale notes" section is the established home.
  - `pr-first-merge.md:131`: change the `--json` value to `databaseId,name,workflowName,status,conclusion,url,startedAt`. Make the same change on `release/execute.md:140`.
  - Directly after the pending bullet (`- Any entry with \`status\` not \`COMPLETED\`…`), insert one bullet. The marker phrase and the three-conclusion list must sit on its first physical line. Wording:

    `- A check whose newest entry (rollup entries and head runs by name; newest by \`startedAt\`, then \`databaseId\`; an unbreakable tie holds) completed with \`conclusion\` in \`CANCELLED\`, \`ACTION_REQUIRED\`, or \`STALE\` → **pending** (held; code twin \`HELD_CONCLUSIONS\`).`

  - Pay for it at `pr-first-merge.md:128`. Cut the sentence "The rollup lists only the checks GitHub has registered so far, so a partial rollup — some workflows reported, others not yet registered — reads green while a sibling workflow is still pending." In its place, put a short `(why: \`pr-first-merge-appendix.md\`'s "Rationale notes")` pointer.
  - Append two bullets to the appendix's `## Rationale notes`. First, the cut sentence, verbatim. Second, the held rule's why: nothing failed, so the remedy is a rerun, not a fix round; `SKIPPED` stays green because draft-time fix-label jobs skip; a newer successful run of the same check reads green because only the newest counts, and `cancel-in-progress` cancels runs of older shas. Cite #3467.
  - `docs/plugin-structure.md:79`: after the `FAILING_CONCLUSIONS is pinned…` clause, add `; HELD_CONCLUSIONS (the newest run per check concluded CANCELLED/ACTION_REQUIRED/STALE reads pending, #3467) and HEAD_RUN_FIELDS are pinned the same way`.
  - Sweep for prose that still says a cancelled run reads green: `git grep -n -i -E "cancel+ed[^.]*green|neither red nor pending" -- plugin docs tests`. Fix any shipped-prose hit that describes the old rule. Leave history files (`docs/incident-log.md`, `CHANGELOG.md`) alone.

- [ ] **Step 4: Run the tests to verify they pass, then the byte rails**

Run: `node --test tests/pr-check-gate-conformance.test.js tests/pr-first-merge.test.js tests/merge-verification-gate-conformance.test.js`
Expected: PASS.
Run: `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.180.0/bin/plan-audit.js" docs/superpowers/plans/2026-11-26-held-ci-conclusions.md`
Expected: `headroom.breaches` is empty, and no `headroom.composed` row has `over > 0`. If one does, move more rationale from `pr-first-merge.md` to the appendix and re-run.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge.md plugin/skills/_shared/pr-first-merge-appendix.md plugin/skills/release/execute.md docs/plugin-structure.md tests/pr-check-gate-conformance.test.js tests/pr-first-merge.test.js
git commit -m "State the held-conclusion rule in Step 2.5 — pinned to HELD_CONCLUSIONS and HEAD_RUN_FIELDS, refs #3467"
```
