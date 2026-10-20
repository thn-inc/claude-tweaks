# Reconciler merged-partial archive guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `archiveMerged` (the reconcile sweep) from archiving a pipeline run on merged-PR evidence when the merged PR does not close every record the run still intends to ship.

**Architecture:** One pure helper computes which of the run's records a merged PR does not close (reusing #3412's `prClosesIssue`). `decideArchiveCore` consults it only at the point where it would otherwise return `archive`. One I/O reader derives the run's record set from `manifest.yml` or the run-dir slug. The main loop's two merged-PR paths (the branch-joined path via `archiveMergedRun`, and the by-number fallback) apply the check. The `status: clean` sweep does not.

**Tech Stack:** Node 18+, CommonJS, `node --test`. No new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T185603-record-3503/work/3503-spec.md` (record #3503)

**Scope keywords:** decideArchiveCore, STRUCTURALLY_STUCK_REASONS, prClosesIssue

## Global Constraints

- Skip reason for a partial merge is the literal `merged-partial`; the skipped entry also carries `unclosed: number[]` (ascending), the records the PR does not close.
- Skip reason when closing-issue data is unavailable (no `closingIssuesReferences` array on the PR object, or no resolvable repo slug) is the literal `closing-issues-unknown`. A `gh` transport failure keeps its existing `gh-absent` / `network-failure` / `invalid-arguments` reasons, unchanged.
- A skipped run's `run-state.json` is never written (no `status: clean`, no `worktree: null`), and the run dir stays in place.
- `decideArchiveCore` stays pure (no I/O). The caller supplies the record set and repo slug.
- Every existing skip reason, and its precedence, is unchanged. The new check runs only where `decideArchiveCore` (or the by-number fallback) would otherwise archive.
- Commit messages follow `{Verb} {what} — {detail}` and reference the record as `refs #3503` (never a closing keyword).

## Design decisions (from the run's decisions.md, `Spec Step 3 design`)

- **Required-record set.** For a run with `manifest.yml`: `multispec.specs[].id` minus specs whose `status` is `failed` or `not-run`, and minus specs with a deferred-closure entry (`readDeferredClosures`). These are exactly the records `composeFixesBlock` writes `Refs` for, so the run's own PR never closes them. Without the exclusion, a `keep-going` run with one failed spec could never archive. `pending`, `running` and `complete` specs are required. The incident's #3311 was `running`.
- **Manifest-less runs.** Use the record ids in a canonical numeric slug, `{ts}-record-{n}[-{m}…]` (dispatch) or `{ts}-spec-{n}[-{m}…]` (direct `/flow`). Exclude a single record that has a top-level deferred-closure entry (`readSingleRecordDeferredClosure`). Any other slug (topic, `*-standalone`, `record-42-foo`) yields `null`, meaning no record set, so the run behaves as today.
- **The `status: clean` sweep is exempt.** wrap-up already closed that run, so no record is still being built. That loop also has no stuck-tracking hook, so a check there would freeze silently.
- **`merged-partial` joins `STRUCTURALLY_STUCK_REASONS`.** A run legitimately waiting for a second PR stays visible as a skip every pass, and escalates through the residue streak only after the existing 7-day TTL. It never freezes silently.

## Review Focus

1. A PR whose `closingIssuesReferences` names the right number in a **different repo** must not count as closing it. `prClosesIssue` already matches `owner/name`, so pin it with a test (Task 1).
2. A manifest spec with status `failed`/`not-run`, or with a deferred-closure entry, must not block archival (Task 2 reader tests and a Task 3 integration test).
3. **Truncated or absent closing data:** a merged PR object with no `closingIssuesReferences` key must skip `closing-issues-unknown`, never archive (Tasks 1 and 3).
4. A run dir whose slug is a topic or standalone name must archive exactly as today, with no new `gh` call and no new skip (Task 2 reader returns `null`, Task 1 treats `null` as no check).
5. The `status: clean` sweep must still archive a clean run whose PR closes nothing (exemption pinned in Task 3).

---

### Task 1: Pure partial-merge decision in `decideArchiveCore`

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`decideArchiveCore` at ~320-351, `STRUCTURALLY_STUCK_REASONS` at ~1425, `module.exports`)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js` (append near the existing `decideArchiveCore:` tests, ~2792-2810)

**Interfaces:**
- Consumes: `prClosesIssue(prState, issueNumber, repoSlug)` from `./release-merged` (already exported). It returns `true`, `false`, or `undefined` when `closingIssuesReferences` is not an array. `archive-merged.js` already requires `./release-merged` for `repoSlugOf`. Extend that destructure.
- Produces:
  - `unclosedRecords(prState, records, repoSlug) -> number[] | undefined`. Exported, pure. It returns `undefined` when `repoSlug` is falsy or any record's `prClosesIssue` verdict is `undefined`. Otherwise it returns the ascending array of records whose verdict is `false`, which is `[]` when all are closed.
  - `decideArchiveCore(prState, consoleState, hasStagedPending, recordCheck)`, where `recordCheck` is `{ records: number[] | null, repoSlug: string | null } | undefined`. When it is `undefined`, or `records` is `null` or empty, behavior is byte-identical to today. Otherwise, at each point that would return `{ action: 'archive' }`, it calls `unclosedRecords`:
    - `undefined` returns `{ action: 'skip', reason: 'closing-issues-unknown' }`.
    - A non-empty result returns `{ action: 'skip', reason: 'merged-partial', unclosed }`.
    - `[]` returns `{ action: 'archive' }`.
  - `STRUCTURALLY_STUCK_REASONS` gains `'merged-partial'`. Do not add `'closing-issues-unknown'`: it is a transport-class reason, like `network-failure`, which is not in the set either.

- [ ] **Step 1: Write the failing tests.** Use a `ref(n, owner = 'acme', name = 'w')` helper that builds `{ number: n, repository: { name, owner: { login: owner } } }`, which is the shape `gh pr view 3348 --json closingIssuesReferences` returns. Every test name carries its AC clause id:

```js
test('AC1.1 decideArchiveCore: MERGED + resolved console + a record the PR does not close skips merged-partial naming it', () => {
  const pr = { state: 'MERGED', closingIssuesReferences: [ref(3306), ref(3307)] };
  assert.deepStrictEqual(
    decideArchiveCore(pr, 'resolved', false, { records: [3306, 3307, 3311], repoSlug: 'acme/w' }),
    { action: 'skip', reason: 'merged-partial', unclosed: [3311] });
});
test('AC2.1 decideArchiveCore: MERGED + every record closed archives', () => {
  const pr = { state: 'MERGED', closingIssuesReferences: [ref(3306), ref(3311)] };
  assert.deepStrictEqual(decideArchiveCore(pr, 'none', false, { records: [3311, 3306], repoSlug: 'acme/w' }), { action: 'archive' });
});
test('AC4.1 decideArchiveCore: no closingIssuesReferences array skips closing-issues-unknown, never archives', () => {
  assert.deepStrictEqual(decideArchiveCore({ state: 'MERGED' }, 'resolved', false, { records: [5], repoSlug: 'acme/w' }),
    { action: 'skip', reason: 'closing-issues-unknown' });
});
test('AC4.1 decideArchiveCore: an unresolvable repo slug skips closing-issues-unknown', () => {
  const pr = { state: 'MERGED', closingIssuesReferences: [ref(5)] };
  assert.deepStrictEqual(decideArchiveCore(pr, 'resolved', false, { records: [5], repoSlug: null }),
    { action: 'skip', reason: 'closing-issues-unknown' });
});
test('decideArchiveCore: a same-number closing reference in another repo does not count as closing', () => {
  const pr = { state: 'MERGED', closingIssuesReferences: [ref(5, 'other', 'repo')] };
  assert.deepStrictEqual(decideArchiveCore(pr, 'resolved', false, { records: [5], repoSlug: 'acme/w' }),
    { action: 'skip', reason: 'merged-partial', unclosed: [5] });
});
test('AC3.1 decideArchiveCore: records null or recordCheck absent behaves exactly as before', () => {
  const pr = { state: 'MERGED' };
  assert.deepStrictEqual(decideArchiveCore(pr, 'resolved', false, { records: null, repoSlug: 'acme/w' }), { action: 'archive' });
  assert.deepStrictEqual(decideArchiveCore(pr, 'resolved'), { action: 'archive' });
});
test('decideArchiveCore: existing skip reasons keep precedence over the record check', () => {
  const check = { records: [9], repoSlug: 'acme/w' };
  assert.deepStrictEqual(decideArchiveCore({ state: 'OPEN' }, 'resolved', false, check), { action: 'skip', reason: 'pr-open' });
  assert.deepStrictEqual(decideArchiveCore({ state: 'MERGED' }, 'unresolved', false, check), { action: 'skip', reason: 'console-unresolved' });
  assert.deepStrictEqual(decideArchiveCore({ state: 'MERGED' }, 'none', true, check), { action: 'skip', reason: 'console-never-rendered' });
});
test('STRUCTURALLY_STUCK_REASONS includes merged-partial but not closing-issues-unknown', () => {
  assert.ok(STRUCTURALLY_STUCK_REASONS.has('merged-partial'));
  assert.ok(!STRUCTURALLY_STUCK_REASONS.has('closing-issues-unknown'));
});
```

Add `STRUCTURALLY_STUCK_REASONS` and `unclosedRecords` to the test file's top-level destructure.

- [ ] **Step 2: Run to verify they fail.**
Run: `node --test --test-name-pattern="decideArchiveCore|STRUCTURALLY_STUCK_REASONS" tests/bin-lib/reconcile/archive-merged.test.js`
Expected: FAIL after Step 1. The merged-partial and closing-issues-unknown cases return `{ action: 'archive' }`, and the set assertion fails. The two unchanged-behavior tests pass.

- [ ] **Step 3: Implement `unclosedRecords` and the `recordCheck` gate in `decideArchiveCore`, and add `'merged-partial'` to `STRUCTURALLY_STUCK_REASONS`.** Fold the two `return { action: 'archive' }` sites into one tail that applies the gate. Update the comment block above `STRUCTURALLY_STUCK_REASONS` with one sentence on why `merged-partial` is tracked: a run waiting on a later PR must escalate rather than freeze, and the 7-day TTL keeps a legitimately split run quiet while it waits. Export `unclosedRecords`.

- [ ] **Step 4: Run to verify they pass.**
Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js`
Expected: every test passes. Existing callers pass no `recordCheck`, so nothing else moves.

- [ ] **Step 5: Commit**
```bash
git add plugin/bin/lib/reconcile/archive-merged.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "Add merged-partial decision to decideArchiveCore — refs #3503"
```

### Task 2: `runRecordSet(dir)` — the run's required records

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (new function next to `recordNumbersFromSlug`, ~780-791; `module.exports`)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js` (append near the `recordNumbersFromSlug:` tests, ~3275)

**Interfaces:**
- Consumes: `readManifest(runDir)`, `readDeferredClosures(runDir, specs)` and `readSingleRecordDeferredClosure(runDir, recordId)` from `../flow/manifest`. `readManifest` returns `{ multispec: { specs: [{ id, status }] } }` or `null`.
- Produces: `runRecordSet(dir) -> number[] | null`. Exported.
  - **Manifest present** with a non-empty `multispec.specs`: returns spec ids as numbers, in manifest order, minus `status` `failed`/`not-run` and minus deferred-closure ids. This can be `[]`.
  - **No manifest:** parses the basename with `/-(?:record|spec)-(\d+(?:-\d+)*)$/` and returns those ids, minus any id that has a top-level deferred-closure entry.
  - **Otherwise:** returns `null`.
  - Do not change `recordNumbersFromSlug` or `RECORD_SLUG_RE`. `isClosedSlugStuck` depends on their record-only shape.

- [ ] **Step 1: Write the failing tests.** Build each run dir under `fs.mkdtempSync`. Write `manifest.yml` with `serializeManifestYaml` from `../../../plugin/bin/lib/flow/manifest`, never by hand. Write deferred-closure lines in the canonical shape `- AUTO 10:00:00 — spec #N: deferred-closure: spec #N closing keyword withheld (pending manual step).`. Tests:
  - `runRecordSet: a manifest with a running spec keeps it required (the #3311 incident shape)`. The specs are 3307 `complete`, 3311 `running`, and the expected result is `[3307, 3311]`.
  - `runRecordSet: failed and not-run specs are excluded`. The specs are 1 `complete`, 2 `failed`, 3 `not-run`, and the expected result is `[1]`.
  - `runRecordSet: a spec with a deferred-closure entry in spec-{id}/decisions.md is excluded`.
  - `runRecordSet: manifest-less record-{n} and spec-{n}-{m} slugs parse to their ids`. The slugs `2026-10-19T185603-record-3503` and `2026-08-01T090000-spec-10-11` give `[3503]` and `[10, 11]`.
  - `runRecordSet: a manifest-less singleton with a top-level deferred-closure entry yields []`.
  - `runRecordSet: topic, standalone and suffixed slugs yield null`. The slugs are `…-meal-planning`, `…-record-42-standalone`, `…-tidy-standalone` and `…-record-3249-ordinary-empty`.

- [ ] **Step 2: Run to verify they fail.**
Run: `node --test --test-name-pattern="runRecordSet" tests/bin-lib/reconcile/archive-merged.test.js`
Expected: FAIL after Step 1 with `runRecordSet is not a function`.

- [ ] **Step 3: Implement `runRecordSet(dir)`** per the Interfaces block.

- [ ] **Step 4: Run to verify they pass.** Use the same command, which is expected to PASS. Then run the real-input probe against the incident's archived run in the main checkout:
Run: `node -e "console.log(JSON.stringify(require('./plugin/bin/lib/reconcile/archive-merged').runRecordSet(process.argv[1])))" "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-10-17T062549-spec-3307-3308-3306-3309-3310-3311"`
Expected: `[3307,3308,3306,3309,3310,3311]`. The independent count is 6 `- id:` lines in that `manifest.yml`, all with status `complete` or `running`.

- [ ] **Step 5: Commit**
```bash
git add plugin/bin/lib/reconcile/archive-merged.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "Add runRecordSet reader for a run's required records — refs #3503"
```

### Task 3: Wire the check into both main-loop merged-PR paths

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`archiveMergedRun` ~1650-1675, main-loop by-number fallback ~1903-1950, main-loop call ~1957-1962; the clean loop ~1974-1983 stays unchanged)
- Modify: `plugin/bin/lib/reconcile/index.js:385-386` (pass `unclosed` through to `result.runs`)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`

**Interfaces:**
- Consumes: `runRecordSet(dir)` (Task 2), `decideArchiveCore(..., recordCheck)` and `unclosedRecords(prState, records, repoSlug)` (Task 1).
- Produces:
  - `archiveMergedRun({ …, recordCheck })` passes `recordCheck` to `decideArchiveCore`. A skip returns `{ outcome: 'skipped', reason, unclosed? }`, and `onSkip(reason)` is still called. That is how `merged-partial` reaches `trackStuckSkip`.
  - The main loop passes `recordCheck: { records: runRecordSet(dir), repoSlug }` and pushes `{ runDir, reason, unclosed }` (`unclosed` only when present). The clean loop passes no `recordCheck`.
  - In the by-number fallback, each MERGED branch that would reach `finishArchiveAttempt` first evaluates `unclosedRecords(byNumber, records, repoSlug)` when `records` is a non-empty array. There are two such branches: console `none` with nothing staged, and console resolved. The fallback then skips `closing-issues-unknown`, or skips `merged-partial` with `unclosed` and calls `trackStuckSkip(…, 'merged-partial')`, using the same rule as Task 1. A CLOSED PR is unaffected.
  - In `index.js`, each `runs` skip entry carries `unclosed` when the archive result has it.

- [ ] **Step 1: Write the failing integration tests.** Each fixture gets `git(root, 'remote', 'add', 'origin', 'git@github.com:acme/w.git')` so `repoSlugOf` resolves to `acme/w`. Add an `origin` option to `fixtureOrdinaryMergedNoConsole` (and any fixture you reuse) instead of copying it. PR JSON carries `closingIssuesReferences` built with Task 1's `ref` helper.
  - `AC1.1/AC1.2/AC5.1 regression: a multi-spec run whose merged PR leaves a running manifest record unclosed is not archived (#3311 shape, branch-joined path)`. The slug is `2026-10-17T062549-spec-3306-3311`, `manifest.yml` has 3306 `complete` and 3311 `running`, and the PR closes `[3306]`. Assert: not archived, run dir present, `skip.reason === 'merged-partial'`, `skip.unclosed` deep-equals `[3311]`, and `run-state.json` is byte-identical before and after (read it before `archiveMerged`, compare after).
  - `AC1.1 by-number path: the same partial merge reached via the by-number fallback is not archived`. Build it like the existing `a MERGED PR reached via the by-number fallback with no console.json and nothing staged now archives (#3249)` test, with the branch ref deleted, and a slug of `…-record-3503-3504`, which is manifest-less with two ids. The PR closes `[3503]`. Expect `merged-partial` and `unclosed: [3504]`.
  - `AC2.1: a merged PR closing every manifest record archives on the branch-joined path` and `AC2.1: … on the by-number path`.
  - `AC3.1: a singleton record-{n} run whose PR closes its record archives as before`.
  - `AC4.1: a merged PR object without closingIssuesReferences skips closing-issues-unknown and is not archived`.
  - `AC4.1: a by-number gh failure still skips network-failure (unchanged)`. This is covered by the existing `AC1.1 transport failure` test. Keep it green, and do not add a duplicate.
  - `a failed manifest spec does not block archival`. The manifest has 1 `complete` and 2 `failed`, and the PR closes `[1]`. Expect it archived.
  - `the status:clean sweep is exempt: a clean run whose merged PR closes nothing still archives`. Use `fixtureCleanUnarchivedRun` with an `origin` remote, a numeric `…-record-77` slug, and a PR with `closingIssuesReferences: []`.
  - `a merged-partial skip past the TTL enters the structurally-stuck residue counter`. Backdate the run dir with `STRUCTURALLY_STUCK_TTL_MS * 2`, then assert that `listResidueFailures(root)` holds a `structurally-stuck` entry for `runDir`, matching the existing `console-never-rendered-pr-closed` tracking test.

- [ ] **Step 2: Run to verify they fail.**
Run: `node --test --test-name-pattern="AC1.1/AC1.2/AC5.1 regression|AC1.1 by-number path|AC4.1: a merged PR object|merged-partial skip past" tests/bin-lib/reconcile/archive-merged.test.js`
Expected: FAIL after Step 1. Each of these runs archives today.

- [ ] **Step 3: Implement the wiring** per the Interfaces block. Compute `runRecordSet(dir)` once per run dir in the main loop, before the branch/no-branch split, so both paths share it.

- [ ] **Step 4: Sweep the existing fixtures.** Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/reconcile.test.js tests/bin-lib/reconcile/*.test.js`. Some existing tests use a numeric-only slug (`…-spec-3375-3381`, `…-spec-42`, `…-record-3119` and similar) and reach the archive point without an `origin` remote or `closingIssuesReferences`. Those now skip `closing-issues-unknown`. For each failing test, make the fixture carry the real `gh` shape: an `origin` remote plus a `closingIssuesReferences` naming the slug's records. Never weaken the assertion, and never change the slug to dodge the check. Then grep for reconcile-output shape pins: `git grep -n "action: 'skipped'" -- tests`. Confirm that no deep-equality assertion breaks on the added `unclosed` key.

- [ ] **Step 5: Prove the regression test discriminates.** Temporarily pass `recordCheck: undefined` from the main loop. Re-run the `AC1.1/AC1.2/AC5.1 regression` test and see it FAIL (the run is archived). Restore the code, and see it PASS.

- [ ] **Step 6: Commit**
```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/lib/reconcile/index.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "Skip archiving a run whose merged PR leaves a record unclosed — refs #3503"
```

### Task 4: Full verification (folded — runner checks only)

- [ ] **Step 1: AC6.1 verification — full suite.** Run: `npm test > /private/tmp/claude-501/npm-test-3503.txt 2>&1; echo exit=$?`. Expected: `exit=0`, and the summary's `ℹ fail 0`.
