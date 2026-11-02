# Background post-merge summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A background post-merge run that left a record or parent in the wrong state is reported as failed, never as clean, and the SessionStart line names the records that need a hand fix.

**Architecture:** `classifyEntry` (`plugin/bin/lib/reconcile/post-merge.js`) becomes the one judge of a `ran` entry for the background summary and the CLI summary. Non-clean loop entries gain `records`, so the summary can name them. SessionStart renders the new field.

**Tech Stack:** Node, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T073234-spec-4897/work/4897-spec.md`

Scope keywords: postMergeFailed, postMergeRan, step40Failed

## Global Constraints

- Call `classifyEntry` on `ran` entries only: on a `skipped` entry it returns `failed` for every reason, including `transient-failure`.
- `parentFailures` emission on loop entries belongs to #4798. Do not add it here.
- A clean loop entry keeps exactly `{ runDir, pr, action: 'ran', closingLinks, parentsClosed }`. `postMergeOne`'s entries do not change.
- Governing project skills: none under `.claude/skills/` state a rule for these summary counts or lines. The `.claude/skills/` hits for `reconcile`/`post-merge` concern gh modules, hook verbs and merge proofs, and this plan adds no verb, gh call or source scan.
- Touching `plugin/bin/hooks.js` or `plugin/bin/lib/reconcile/`: read `docs/hooks.md` and `docs/reconcile-checks.md`' Post-merge closes section first.
- Consumers classified: `postMergeRan`/`postMergeFailed` have one writer (`hooks.js`) and one reader (`session-start.js`), per `git grep -n -E "postMergeRan|postMergeFailed" -- plugin docs tests`.
- Return-shape widening: `git grep -n -E "closingLinks: '(reopen-failed|close-failed|close-pending|base-unchecked)'|closingLinks: envelope\.action" -- tests` lists the two loop pins that change (`tests/bin-lib/reconcile/post-merge.test.js:493`, `:1043`). The other hits call `classifyEntry` directly and do not change.

- Check B's other `step40Failed` hits need no change: `plugin/bin/post-merge-run.js`, `plugin/skills/wrap-up/merge-mode.md`, `docs/plugin-structure.md`, `tests/post-merge-run-cli.test.js` and `tests/wrap-up-merge-mode-conformance.test.js` describe the single-run path, which already routes on `classifyEntry` and whose entries do not change. `docs/superpowers/plans/2026-11-01-merge-mode-already-merged.md` is a shipped plan.

## Review Focus

- A status file from an older build has no `postMergeFailedRecords`, or a non-array value: the failed line renders without a record clause. Pinned in Task 2.
- A failed entry with no `records` key (a non-zero `closing-links` exit): the summary does not throw and the count still includes it. Pinned in Task 1.
- The same record in two runs' lists: named once. Pinned in Task 1.
- A `ran` entry with a Step 4.0 word `closing-links.js` adds later: counts as failed, since the set runs in the deny direction. Pinned in Task 1.
- A failed run that also closed a parent: the closed parent still shows when no run is clean. Pinned in Task 2.

---

### Task 1: Judge entries with classifyEntry and carry records
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/post-merge.js` (`processRun`'s `recordsOf`, its comment)
- Modify: `plugin/bin/hooks.js` (the `reconcile-background` summary, around `:1882`)
- Modify: `plugin/bin/lib/reconcile/format-summary.js:54-57`
- Test: `tests/bin-lib/hooks/reconcile-background.test.js`
- Test: `tests/bin-lib/reconcile/post-merge.test.js`
- Test: `tests/reconcile.test.js`

**Interfaces:**
- Produces: summary field `postMergeFailedRecords: number[]` (sorted ascending, unique). `postMergeRan` and `postMergeFailed` keep their names and integer type.
- Produces: a loop `ran` entry with a readable, non-clean envelope carries `records: { failed, closeFailed, pendingClose, unchecked }`, and `logFailed: true` when the envelope sets it.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/hooks/reconcile-background.test.js`, using `backgroundSummaryFor`:

```js
test('AC1.1 AC1.2 AC1.3: a close-failed ran entry counts as failed and names its records (#4897)', async () => {
  const summary = await backgroundSummaryFor({ postMerge: [
    { runDir: '/r/a', pr: 1, action: 'ran', closingLinks: 'close-failed', parentsClosed: 0, records: { failed: [], closeFailed: [101], pendingClose: [], unchecked: [] } },
  ] });
  assert.equal(summary.postMergeFailed, 1);
  assert.equal(summary.postMergeRan, 0);
  assert.deepEqual(summary.postMergeFailedRecords, [101]);
});

test('AC2.1 AC2.2: a clean word with parentFailures counts as failed (#4897)', async () => {
  const summary = await backgroundSummaryFor({ postMerge: [
    { runDir: '/r/a', pr: 1, action: 'ran', closingLinks: 'nothing-closed', parentsClosed: 0, parentFailures: [{ parent: 9, reason: 'gh-failed' }] },
  ] });
  assert.equal(summary.postMergeFailed, 1);
  assert.equal(summary.postMergeRan, 0);
  assert.deepEqual(summary.postMergeFailedRecords, []);
});

test('AC3.1: transient-failure and marker-write-failed stay out of both counts (#4897)', async () => {
  const summary = await backgroundSummaryFor({ postMerge: [
    { runDir: '/r/a', pr: 1, action: 'skipped', reason: 'transient-failure' },
    { runDir: '/r/b', pr: 2, action: 'skipped', reason: 'marker-write-failed', parentsClosed: 1 },
  ] });
  assert.equal(summary.postMergeFailed, 0);
  assert.equal(summary.postMergeRan, 0);
});

test('#4897: failed entries with no records, a word added later, and a record in two runs', async () => {
  const summary = await backgroundSummaryFor({ postMerge: [
    { runDir: '/r/a', pr: 1, action: 'ran', closingLinks: 'exit 5', parentsClosed: 0, step40Failed: true },
    { runDir: '/r/b', pr: 2, action: 'ran', closingLinks: 'a-word-added-later', parentsClosed: 0 },
    { runDir: '/r/c', pr: 3, action: 'ran', closingLinks: 'reopen-failed', parentsClosed: 0, records: { failed: [7], closeFailed: [], pendingClose: [3], unchecked: [] } },
    { runDir: '/r/d', pr: 4, action: 'ran', closingLinks: 'close-pending', parentsClosed: 0, records: { failed: [], closeFailed: [], pendingClose: [3], unchecked: [] } },
  ] });
  assert.equal(summary.postMergeFailed, 4);
  assert.deepEqual(summary.postMergeFailedRecords, [3, 7]);
});
```

Add `postMergeFailedRecords` to the empty-input loop at `:261-267`: `assert.deepEqual(none.postMergeFailedRecords, [])`.

In `tests/bin-lib/reconcile/post-merge.test.js`, change the deep-equal at `:1043` to expect, and name the test's new clause `AC4.1`:

```js
records: { failed: [], closeFailed: [102], pendingClose: [], unchecked: [] }
```

Change `:493` to expect `records` from the fixture's own lists (`BASE_UNCHECKED` and its `reopen-failed` variant: read the fixture, and pin the literal numbers per variant). The clean-shape deep-equal at `:712` stays as is and carries `AC4.2`: add `// AC4.2` beside it.

In `tests/reconcile.test.js`, give the fixtures at `:1947` and `:1957` `closingLinks: 'nothing-closed'`, change the verb at `:1969`, `:1972` and `:1976` to `post-merge steps failed`, and add:

```js
test('AC8.1: a close-failed entry renders under post-merge steps failed, never steps run (#4897)', () => {
  const base = { mirror: null, redTip: null, worktrees: null, claims: null, runs: null, branches: null, remoteBranches: null, console: null, skipped: null };
  const entry = { runDir: 'r1', pr: 11, action: 'ran', closingLinks: 'close-failed', parentsClosed: 0 };
  assert.strictEqual(formatSummary({ ...base, postMerge: [entry] }), 'post-merge steps failed: 1 merged run');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/hooks/reconcile-background.test.js tests/bin-lib/reconcile/post-merge.test.js tests/reconcile.test.js`
Expected: FAIL on the new tests and the changed pins.

- [ ] **Step 3: Implement**

`post-merge.js`, `processRun`: `recordsOf` emits when `includeRecords` is set, or when the envelope has an `action` that is not in `CLEAN_CLOSING_LINKS`. Keep the existing null-envelope guard; an envelope with no `action` (the unreadable case) gets no `records` on the loop path. Update the comment above `processRun` and on `recordsOf`.

`hooks.js`: `const { classifyEntry } = require('./lib/reconcile/post-merge');` beside the existing lazy requires in this command. `postMergeRan` counts `e.action === 'ran'` with verdict `clean`. `postMergeFailed` counts `e.action === 'ran'` with verdict `failed`, or `e.reason === 'error'`. `postMergeFailedRecords` flattens the four `records` lists of those failed `ran` entries, tolerating a missing `records`, and sorts numerically with duplicates removed. Update the comments, including the claim that the parent always waits for tidy's backstop.

`format-summary.js`: require `classifyEntry` from `./post-merge` (no cycle: `post-merge.js` does not require this file, and the `reconcile` command has already loaded it through `index.js`). Row one's filter keeps every non-`ran` entry, because it also feeds the skip aggregate: `(e) => e.action !== 'ran' || classifyEntry(e).verdict === 'clean'`. Row two: `(e) => e.action === 'ran' && classifyEntry(e).verdict === 'failed'`, verb `post-merge steps failed`. Update the comment at `:55-56` and the file's "no I/O" header only if it becomes untrue.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/hooks/reconcile-background.test.js tests/bin-lib/reconcile/post-merge.test.js tests/reconcile.test.js`
Expected: PASS

- [ ] **Step 5: Prove the discrimination**

Revert the `hooks.js` verdict test to `!e.step40Failed` in the working tree, re-run `tests/bin-lib/hooks/reconcile-background.test.js`, confirm AC1 goes red, and restore it. Do the same for the `recordsOf` condition against `post-merge.test.js`. Quote both raw outputs in the report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/reconcile/post-merge.js plugin/bin/hooks.js plugin/bin/lib/reconcile/format-summary.js tests/bin-lib/hooks/reconcile-background.test.js tests/bin-lib/reconcile/post-merge.test.js tests/reconcile.test.js
git commit -m "Judge background post-merge entries with classifyEntry — a failed close no longer reads as ran"
```

### Task 2: Make the SessionStart line and docs true

**Files:**
- Modify: `plugin/bin/lib/hooks/session-start.js:339-350`
- Modify: `docs/reconcile-checks.md:717-744`
- Modify: `docs/journeys/close-a-below-floor-decomposition-parent-4466.md:79`
- Modify: `docs/journeys/session-start-fast-background-reconcile.md:42`
- Test: `tests/hooks-session-start.test.js`

**Interfaces:**
- Consumes: `postMergeFailedRecords: number[]` from Task 1.

- [ ] **Step 1: Write the failing tests**

In the test at `tests/hooks-session-start.test.js:731`, change the regex at `:752` to end `\(tidy's parent-gate backstop recovers the parents\)\.`, then add, using its `seed`:

```js
// AC5.1 AC5.2 AC5.3 AC5.4
seed({ postMergeRan: 0, postMergeFailed: 1, postMergeFailedRecords: [101, 102] });
const named = (await runSessionStart({ input: {}, runDir: null, runState: null, cwd: project })).json.hookSpecificOutput.additionalContext;
assert.match(named, /records #101, #102 need a hand reopen or close per _shared\/pr-first-merge-post-merge\.md Step 4\.0/);
assert.match(named, /no later pass retries them/);
assert.match(named, /tidy's parent-gate backstop recovers the parents/);

// AC6.1 AC6.2: an older status file, and a non-array value
for (const summary of [{ postMergeRan: 0, postMergeFailed: 1 }, { postMergeRan: 0, postMergeFailed: 1, postMergeFailedRecords: 'x' }]) {
  seed(summary);
  const unnamed = (await runSessionStart({ input: {}, runDir: null, runState: null, cwd: project })).json.hookSpecificOutput.additionalContext;
  assert.match(unnamed, /post-merge steps failed for 1 merged run\(s\) \(tidy's parent-gate backstop recovers the parents\)/);
  assert.doesNotMatch(unnamed, /records #/);
}

// AC7.1
seed({ postMergeRan: 0, postMergeFailed: 1, postMergeParentsClosed: 2 });
const closedByFailed = (await runSessionStart({ input: {}, runDir: null, runState: null, cwd: project })).json.hookSpecificOutput.additionalContext;
assert.match(closedByFailed, /post-merge steps closed 2 parent record\(s\) below the oversight floor/);
assert.doesNotMatch(closedByFailed, /steps ran for/);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-session-start.test.js`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement**

The failed line, exact copy (the record clause only when `postMergeFailedRecords` is a non-empty array):

`post-merge steps failed for N merged run(s) (records #101, #102 need a hand reopen or close per _shared/pr-first-merge-post-merge.md Step 4.0, and no later pass retries them; tidy's parent-gate backstop recovers the parents)`

With no records: `post-merge steps failed for N merged run(s) (tidy's parent-gate backstop recovers the parents)`

When `postMergeRan` is 0 and `ranClosed` is above 0, push `post-merge steps closed ${ranClosed} parent record(s) below the oversight floor`. Update the comments at `:339-340` and `:348-349`.

Docs: rewrite the Surfacing bullet to state the `classifyEntry` rule, `postMergeFailedRecords`, that `postMergeParentsClosed` counts every `ran` run's closes, the new line text, and that a non-clean loop entry carries `records` (and `logFailed` when set). Replace the bullet's "counting only those runs' closes": M now includes closes by failed runs. In the Single-run bullet, the sentence saying `postMerge` entries never carry `records` or `logFailed` becomes: `postMergeOne` entries always carry them, a non-clean loop entry carries them too, and `parentFailures`, `verdict`, `next` and `failedSteps` stay single-run. State that #4798 adds `parentFailures` to loop entries, only if it has not merged yet when this task runs; otherwise describe the field as present. Update the failed-line quote in both journeys. No change to `plugin/bin/lib/reconcile/post-merge.js:139` or `plugin/skills/_shared/pr-first-merge-post-merge.md:88`: those log a no-closing-set SKIP, whose "recovers them" means parents and is true.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-session-start.test.js`
Expected: PASS

- [ ] **Step 5: Run the absence greps (AC9.1)**

Run: `git grep -n -F -e "!e.step40Failed" -- plugin/bin`
Expected: no output, exit 1. Control on the base: this printed `plugin/bin/hooks.js:1882` and `plugin/bin/lib/reconcile/format-summary.js:54` before Task 1.

Run: `git grep -n -F -e "e.step40Failed === true" -- plugin/bin/lib/reconcile/format-summary.js`
Expected: no output, exit 1. Control on the base: this printed `format-summary.js:57`.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/session-start.js docs/reconcile-checks.md docs/journeys/close-a-below-floor-decomposition-parent-4466.md docs/journeys/session-start-fast-background-reconcile.md tests/hooks-session-start.test.js
git commit -m "Name the records a failed post-merge run left on SessionStart — limit tidy's backstop to parents"
```

Waived AC10.1: `npm test` runs centrally at Common Step 5, never in a dispatched task.
