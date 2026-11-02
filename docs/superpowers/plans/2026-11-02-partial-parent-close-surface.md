# Partial Step 4.0b Parent-Close Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a reconcile post-merge run's Step 4.0b leaves a parent open (a `gh-failed`, `internal-error`, or other non-deliberate skip), the loop entry carries that as structured data, the run is never counted as a clean `ran`, and the next SessionStart names the parent. A step-wide policy skip on a merge whose closing set was empty is reported on its own line instead, because no parent can have been left open.

**Architecture:** #4897 (merged, `d334af38e`) already makes `hooks.js`'s background summary and `format-summary.js` count any `ran` entry with a non-empty `parentFailures` as failed, through `post-merge.js`'s `classifyEntry`. Only `postMergeOne` (the single-run path) emits `parentFailures` today. `processRun` in `plugin/bin/lib/reconcile/post-merge.js` will (a) split Step 4.0b's non-deliberate skips into `parentFailures` (a parent may be left open) and a new `stepSkips` (a step-wide skip on an empty closing set: none can be), and (b) put `parentFailures` on a loop entry when it is non-empty. Two new pure helpers flatten those fields for the background summary. `session-start.js` names each parent inside the existing failed line and renders the step skips on a separate line.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T201932-record-4798/work/4798-spec.md` (the worktree copy, which includes the `## Decisions` section answering plan-review Q1/Q2)

Scope keywords: parentFailures, stepSkips, postMergeParentsLeftOpen

## Global Constraints

- From the spec's Acceptance Criteria, verbatim: "A test drives Step 4.0b to a `gh-failed` skip and asserts the entry is not a clean `ran` and that the SessionStart summary names the parent." / "`npm test` passes."
- Spec Decisions, verbatim. Q1: "add one end-to-end test that sends a real `postMerge` run (a fake `closeParents` returning a `gh-failed` skip) through `hooks.js reconcile-background` into SessionStart, and asserts the rendered summary names the parent (`#100 (gh-failed, …)`). Seam tests may stay as well, but they do not satisfy the criterion on their own." Q2: "A Step 4.0b step-wide skip (`unreadable-policy`, `invalid-risk-floor`) on a merge whose Step 4.0 closing set is empty does not count as a parent left open and must not render under "left parent record(s) open". Surface it on its own separate line in the summary (the unreadable/invalid policy is still worth reporting). A step-wide skip with a non-empty closing set still counts as partial."
- Q2 is applied in `processRun`, so it holds on both paths (loop and `postMergeOne`): one classification rule, not one rule per caller. For the single-run path this means an empty-closing-set step-wide skip now reads `verdict: clean`, and `merge-mode.md` reports it on the clean line (Task 2), so it is never dropped silently.
- "Closing set" means the set `processRun` hands to `closeParents`: `numbers(envelope.closingSet)` minus `closedAfterWindow` (post-merge.js line ~581), not the raw envelope field.
- Shape convention (#4897's "a clean one keeps its short shape"): a loop entry carries `parentFailures` only when it is non-empty. `postMergeOne` keeps emitting it every time (`includeRecords`). Both paths carry `stepSkips` only when it is non-empty.
- Hooks never break a session (`docs/hooks.md`): the new SessionStart rendering stays inside the existing `try { … } catch` block. Every new summary field is read through `Array.isArray` plus per-element type guards, so a status file from an older build renders exactly what it renders today.
- Project CLAUDE.md Working Approach, verbatim: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Governing skill `driver-skill-outcome-taxonomy`, verbatim rows. "Driver prose that routes an engine's outcome by hand-listing its raw action or reason words: which mean clean, which mean failed, which earn a re-run | Have the engine classify its own outcome, route the prose only on that field, and quote the raw word in the report." And: "Giving one path an outcome classifier while a sibling path over the same entries keeps its own narrower test | Grep every reader of those entries and route them through the classifier in the same change, checking what it says of entries only the new reader sees." Applied here: the parentFailures/stepSkips split is decided in `processRun`, the flattening in exported helpers, and SessionStart only renders fields. `format-summary.js` already routes through `classifyEntry`/`isFailedRun`, so it is classified no-change below.
- Governing skill `prose-code-twin-pin`: `merge-mode.md` names the new `stepSkips` field, so Task 2 pins that sentence in `tests/wrap-up-merge-mode-conformance.test.js`. These skills do not apply, because no `hooks.js` verb or flag is added and no `gh`/`git` call or source scan is introduced: `hooks-js-verb-registration`, `gh-api-module-pattern`, `bin-source-scan-conformance`.
- Commit subjects: `{Verb} {what} — {detail}`, referencing the record as `refs #4798` (never `closes`/`fixes`).

## Review Focus

1. A step-wide skip whose closing set is empty only after the close-window filter (`closingSet: [101]`, `closedAfterWindow: [101]`) must go to `stepSkips`. Task 1's Q2 test pins it.
2. A step-wide skip with a non-empty closing set must stay a parent left open (`parentFailures`, failed). Task 1's Q2 test and the widened line-716 literal pin it.
3. A status file from before this change (no `postMergeParentsLeftOpen`/`postMergeStepSkips`), or one carrying junk elements, must render no new text and throw nothing. Task 3's SessionStart test pins it.
4. A run that only has step skips must never render "left parent record(s) open" and must stay counted in `postMergeRan`. Task 3's summary and SessionStart tests pin it.
5. Deliberate skips (`above-floor`, …) must keep a loop entry's short shape: no `parentFailures` key. Task 1's AC1.1 test (mixed skips) pins it, together with the unchanged literals at lines ~998/1019/1030.

---

### Task 1: Split Step 4.0b failures into `parentFailures` and `stepSkips` on every path

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/post-merge.js`: the header comments at ~476-478 and ~496-500, the `parentFailures` construction at ~613-624, and `module.exports` at ~627
- Test: `tests/bin-lib/reconcile/post-merge.test.js`

**Interfaces:**
- Produces, on a `ran` entry from the Step 4.0b branch of `processRun` (an envelope with an array `closingSet`):
  - `parentFailures: Array<{ parent?: number, issue?: number, reason: string, detail?: string }>`: the non-deliberate skips, except those routed to `stepSkips`. Always present on a `postMergeOne` entry (possibly `[]`). Present on a loop entry only when non-empty.
  - `stepSkips: Array<{ reason: string, detail?: string }>`: when the filtered closing set is empty, every non-deliberate skip with neither `parent` nor `issue`. Present only when non-empty (both paths). `detail` is bounded the same way `parentFailures`' is (`boundDetail(oneLine(...))`).
  - The no-closing-set branch and `marker-write-failed` entries are unchanged.
- Produces (exported pure helpers, consumed by Task 3):
  - `parentsLeftOpen(entries) -> Array<{ pr, parent?, issue?, reason }>`: over entries with `action === 'ran'` and an array `parentFailures`, in entry order, one element per `parentFailures` element, `detail` dropped. Non-array input → `[]`.
  - `stepSkipsOf(entries) -> Array<{ pr, reason }>`: the same shape over `stepSkips`.
- `classifyEntry` is unchanged. A `stepSkips`-only entry reads `clean` because it has no `parentFailures` element.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/reconcile/post-merge.test.js` (add `parentsLeftOpen, stepSkipsOf` to the top-level require)

```js
test('AC1.1: a gh-failed Step 4.0b skip in the reconcile loop rides on the entry, which is not a clean ran (#4798)', async () => {
  const root = mainCheckout();
  addRun(root, '2026-10-30T090000-spec-1');
  const r = await run(root, {
    prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE),
    close: fakeCloseParents({ closed: [], skipped: [{ parent: 100, reason: 'gh-failed', detail: 'HTTP 502' }, { parent: 88, reason: 'above-floor' }] }),
  });
  assert.equal(r.entries[0].action, 'ran');
  assert.deepEqual(r.entries[0].parentFailures, [{ parent: 100, reason: 'gh-failed', detail: 'HTTP 502' }]);
  assert.ok(!('stepSkips' in r.entries[0]));
  assert.deepEqual(classifyEntry(r.entries[0]), { verdict: 'failed', next: 'none', failedSteps: ['4.0b'] });
});

test('Q2: a step-wide Step 4.0b skip on an empty closing set is a stepSkips element, never a parent left open, on both paths (#4798)', async () => {
  const EISDIR = { reason: 'unreadable-policy', detail: '.claude-tweaks/policy.yml: EISDIR' };
  const emptySet = { ...ENVELOPE, closingSet: [] };
  // Loop path, policySkipOf's skip.
  const { root, dir } = policyCheckout(null);
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'policy.yml'));
  const loop = await run(root, { prs: { 11: merged() }, links: fakeClosingLinks(emptySet), close: fakeCloseParents() });
  assert.deepEqual(loop.entries, [{ runDir: dir, pr: 11, action: 'ran', closingLinks: 'nothing-closed', parentsClosed: 0, stepSkips: [EISDIR] }]);
  assert.equal(classifyEntry(loop.entries[0]).verdict, 'clean');
  // Single-run path: same split, parentFailures still present and empty.
  const { root: oneRoot, dir: oneDir } = policyCheckout(null);
  fs.mkdirSync(path.join(oneRoot, '.claude-tweaks', 'policy.yml'));
  const one = await postMergeOne(oneArgs(oneRoot, oneDir, { prs: { 11: merged() }, links: fakeClosingLinks(emptySet), close: fakeCloseParents() }));
  assert.deepEqual(one.parentFailures, []);
  assert.deepEqual(one.stepSkips, [EISDIR]);
  assert.equal(one.verdict, 'clean');
  // closeParents' own step-wide skip, on a closing set the close window emptied.
  const winRoot = mainCheckout();
  addRun(winRoot, '2026-10-30T090000-spec-1');
  const windowed = await run(winRoot, {
    prs: { 11: merged() }, links: fakeClosingLinks({ ...ENVELOPE, closingSet: [101], closedAfterWindow: [101] }),
    close: fakeCloseParents({ closed: [], skipped: [{ reason: 'invalid-risk-floor' }] }),
  });
  assert.deepEqual(windowed.entries[0].stepSkips, [{ reason: 'invalid-risk-floor' }]);
  assert.ok(!('parentFailures' in windowed.entries[0]));
  // A non-empty closing set: the same skip is a parent left open.
  const { root: setRoot } = policyCheckout(null);
  fs.mkdirSync(path.join(setRoot, '.claude-tweaks', 'policy.yml'));
  const withSet = await run(setRoot, { prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE), close: fakeCloseParents() });
  assert.deepEqual(withSet.entries[0].parentFailures, [EISDIR]);
  assert.ok(!('stepSkips' in withSet.entries[0]));
});

test('parentsLeftOpen and stepSkipsOf flatten ran entries in order, detail dropped (#4798)', () => {
  const entries = [
    { pr: 11, action: 'ran', parentFailures: [{ parent: 100, reason: 'gh-failed', detail: 'x' }, { issue: 103, reason: 'internal-error' }] },
    { pr: 12, action: 'ran', parentFailures: [], stepSkips: [{ reason: 'unreadable-policy', detail: 'y' }] },
    { pr: 13, action: 'skipped', reason: 'marker-write-failed', parentFailures: [{ parent: 9, reason: 'gh-failed' }], stepSkips: [{ reason: 'x' }] },
    { pr: 14, action: 'ran', parentFailures: 'junk', stepSkips: 'junk' },
  ];
  assert.deepEqual(parentsLeftOpen(entries), [{ pr: 11, parent: 100, reason: 'gh-failed' }, { pr: 11, issue: 103, reason: 'internal-error' }]);
  assert.deepEqual(stepSkipsOf(entries), [{ pr: 12, reason: 'unreadable-policy' }]);
  assert.deepEqual(parentsLeftOpen(null), []);
  assert.deepEqual(stepSkipsOf(undefined), []);
});
```

In the existing `I1: postMergeOne lists Step 4.0b failures …; postMerge entries carry none` test (~line 1273), rename it to `I1: postMergeOne and postMerge entries list the same Step 4.0b failures; a deliberate policy skip is not one`. Replace its last assertion `assert.ok(!('parentFailures' in loop.entries[0]));` with `assert.deepEqual(loop.entries[0].parentFailures, entry.parentFailures);`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="#4798|I1: postMergeOne and postMerge" tests/bin-lib/reconcile/post-merge.test.js`
Expected: FAIL. The loop entry has no `parentFailures`, there is no `stepSkips`, and `parentsLeftOpen` is not a function.

- [ ] **Step 3: Implement** in `processRun`
  - Replace the `includeRecords ? { parentFailures: … } : {}` construction with this computation: `failures` = the non-deliberate skips (same filter and per-element mapping as today). When the filtered `closingSet` is empty, route each failure with neither `parent` nor `issue` to `stepSkips` (mapped to `{ reason, detail? }`) and keep the rest in `parentFailures`.
  - Emit `parentFailures` when `includeRecords || parentFailures.length > 0`. Emit `stepSkips` when it is non-empty.
  - Add `parentsLeftOpen` and `stepSkipsOf` as pure functions beside `failedRecordNumbers`, and export them.
  - Update the comments at ~476-478, ~496-500 and ~613 so none of them says `parentFailures` is `postMergeOne`-only. State the empty-closing-set `stepSkips` rule once, at the construction.

- [ ] **Step 4: Widen the exact-shape loop literals Step 3 changes**
  - ~line 103 (`merged unmarked run…`, whose skips include `{ issue: 102, reason: 'gh-failed', detail: 'boom' }`): the entry gains `parentFailures: [{ issue: 102, reason: 'gh-failed', detail: 'boom' }]`.
  - ~line 716 (`an unreadable policy.yml skips Step 4.0b fail-closed`, closing set `[101, 102]`): the entry gains `parentFailures: [{ reason: 'unreadable-policy', detail: '.claude-tweaks/policy.yml: EISDIR' }]`.
  - Leave every other `action: 'ran'` literal unchanged (`grep -n "action: 'ran'" tests/bin-lib/reconcile/post-merge.test.js`): those entries are either no-closing-set entries or entries with no non-deliberate skip.

- [ ] **Step 5: Run the suites to verify they pass**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js tests/post-merge-run-cli.test.js tests/reconcile.test.js tests/bin-lib/hooks/reconcile-background.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/reconcile/post-merge.js tests/bin-lib/reconcile/post-merge.test.js
git commit -m "Carry Step 4.0b parent failures on loop entries, step-wide empty-set skips apart — refs #4798"
```

### Task 2: Single-run consumers report `stepSkips`

**Role:** integration

**Files:**
- Modify: `plugin/skills/wrap-up/merge-mode.md`: the `verdict` `clean` bullet in `## Already merged` (line ~32). The file is 13,744 B against the 52,500 B rail, so it has ample headroom.
- Modify: `plugin/bin/post-merge-run.js`: the header entry shape and `parentFailures` paragraph (~14-27) and the `--help` usage string (~65-67)
- Modify: `docs/plugin-structure.md`: the `post-merge-run.js` CLI line (~192)
- Test: `tests/wrap-up-merge-mode-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `stepSkips` (`[{ reason, detail? }]`, only when non-empty) and the narrowed `parentFailures`.

- [ ] **Step 1: Write the failing pin** in `tests/wrap-up-merge-mode-conformance.test.js`

```js
test('#4798: the Already merged section reports stepSkips on its clean line, and the CLI docs name the field', () => {
  assert.match(alreadyMergedSection(), /`verdict` `clean`: report `ran` with its `closingLinks` word and `parentsClosed` count, plus `, Step 4\.0b skipped — \{reason\}` per `stepSkips` element/);
  for (const file of [['plugin', 'bin', 'post-merge-run.js'], ['docs', 'plugin-structure.md']]) {
    const text = flat(read(...file));
    assert.match(text, /stepSkips\?/, `${file.join('/')}: the entry shape carries stepSkips`);
    assert.match(text, /closing set was empty/, `${file.join('/')}: states when a step-wide skip is a stepSkips element`);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-name-pattern="#4798" tests/wrap-up-merge-mode-conformance.test.js`
Expected: FAIL. The section has no `stepSkips` clause.

- [ ] **Step 3: Edit the three files**
  - `merge-mode.md`: change the clean bullet to read exactly ``- `verdict` `clean`: report `ran` with its `closingLinks` word and `parentsClosed` count, plus `, Step 4.0b skipped — {reason}` per `stepSkips` element (a step-wide `unreadable-policy` or `invalid-risk-floor` on a merge whose closing set was empty, so no parent was left open).``
  - `post-merge-run.js` header and `plugin-structure.md`: add `stepSkips?` to the entry shape right after `parentFailures?`, keeping `verdict, next, failedSteps?}` adjacent and last (an existing pin reads it). In each `parentFailures` description, add that a step-wide skip on a merge whose closing set was empty goes to `stepSkips` (`[{reason, detail?}]`) instead, which leaves the entry `clean`. In the `--help` usage string, add `stepSkips?` to the printed shape.

- [ ] **Step 4: Run the suite to verify it passes**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js tests/post-merge-run-cli.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/merge-mode.md plugin/bin/post-merge-run.js docs/plugin-structure.md tests/wrap-up-merge-mode-conformance.test.js
git commit -m "Report a step-wide empty-set Step 4.0b skip in merge mode's clean line — refs #4798"
```

### Task 3: Name the parents left open, and the step skips, in the background summary and SessionStart

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/hooks.js`: the `reconcile-background` summary at ~1871-1898
- Modify: `plugin/bin/lib/hooks/session-start.js`: the prior-pass post-merge lines at ~352-364
- Test: `tests/bin-lib/hooks/reconcile-background.test.js`
- Test: `tests/hooks-session-start.test.js`

**Interfaces:**
- Consumes: Task 1's `parentsLeftOpen(entries)` and `stepSkipsOf(entries)` from `./lib/reconcile/post-merge`.
- Produces (status-file `summary` fields, read by `session-start.js` and Task 4):
  - `postMergeParentsLeftOpen: parentsLeftOpen(postMergeEntries)`
  - `postMergeStepSkips: stepSkipsOf(postMergeEntries)`
  - Every existing field is unchanged. A `parentFailures` entry is already counted by `postMergeFailed` through `classifyEntry`, and a `stepSkips`-only entry by `postMergeRan`.

- [ ] **Step 1: Write the failing summary test** in `tests/bin-lib/hooks/reconcile-background.test.js`

```js
test('AC1.1: the summary names each parent a ran entry\'s Step 4.0b left open; a stepSkips-only run stays a clean ran (#4798)', async () => {
  const summary = await backgroundSummaryFor({ postMerge: [
    { runDir: '/r/a', pr: 11, action: 'ran', closingLinks: 'nothing-closed', parentsClosed: 1, parentFailures: [{ parent: 100, reason: 'gh-failed', detail: 'HTTP 502' }, { issue: 103, reason: 'internal-error' }] },
    { runDir: '/r/b', pr: 12, action: 'ran', closingLinks: 'nothing-closed', parentsClosed: 0, stepSkips: [{ reason: 'unreadable-policy', detail: '.claude-tweaks/policy.yml: EISDIR' }] },
  ] });
  assert.equal(summary.postMergeFailed, 1);
  assert.equal(summary.postMergeRan, 1, 'no parent can be left open by a merge that closed no sub-issue');
  assert.deepEqual(summary.postMergeParentsLeftOpen, [{ pr: 11, parent: 100, reason: 'gh-failed' }, { pr: 11, issue: 103, reason: 'internal-error' }]);
  assert.deepEqual(summary.postMergeStepSkips, [{ pr: 12, reason: 'unreadable-policy' }]);
});
```

Also extend the empty-input loop in `counts post-merge runs and the parents they closed …` with `assert.deepEqual(none.postMergeParentsLeftOpen, [])` and `assert.deepEqual(none.postMergeStepSkips, [])`.

- [ ] **Step 2: Write the failing SessionStart test** in `tests/hooks-session-start.test.js`, after the `#4599` post-merge test

```js
test('AC1.1: SessionStart names the parents a prior pass\'s Step 4.0b left open, and reports step-wide skips on their own line (#4798)', async () => {
  const project = gitProject();
  fs.mkdirSync(path.join(project, '.claude-tweaks'), { recursive: true });
  const statusPath = path.join(project, '.claude-tweaks', 'reconcile-background-status.json');
  const seed = (summary) => fs.writeFileSync(statusPath, JSON.stringify({ completedAt: Date.now(), surfaced: false, summary }));
  const contextOf = async () => (await runSessionStart({ input: {}, runDir: null, runState: null, cwd: project })).json.hookSpecificOutput.additionalContext;

  seed({ postMergeRan: 0, postMergeFailed: 2, postMergeFailedRecords: [101], postMergeParentsLeftOpen: [
    { pr: 11, parent: 100, reason: 'gh-failed' }, { pr: 11, issue: 103, reason: 'internal-error' }, { pr: 12, reason: 'unreadable-policy' },
  ], postMergeStepSkips: [{ pr: 13, reason: 'invalid-risk-floor' }] });
  const named = await contextOf();
  assert.match(named, /post-merge steps failed for 2 merged run\(s\) \(records #101 need a hand reopen or close per _shared\/pr-first-merge-post-merge\.md Step 4\.0, each with its action in the run's decisions\.md, and no later pass retries them; Step 4\.0b left parent record\(s\) open: #100 \(gh-failed, PR #11\), the parent of record #103 \(internal-error, PR #11\), every parent \(unreadable-policy, PR #12\); tidy's parent-gate backstop recovers the parents\)/);
  assert.match(named, /post-merge Step 4\.0b skipped step-wide, leaving no parent open \(the merge closed no sub-issue\): invalid-risk-floor \(PR #13\)/);

  // Q2: step skips alone never read as a parent left open.
  seed({ postMergeRan: 1, postMergeStepSkips: [{ pr: 12, reason: 'unreadable-policy' }] });
  const skipsOnly = await contextOf();
  assert.doesNotMatch(skipsOnly, /left parent record/);
  assert.match(skipsOnly, /skipped step-wide, leaving no parent open \(the merge closed no sub-issue\): unreadable-policy \(PR #12\)/);

  // An older status file, and junk values: nothing new renders.
  for (const summary of [
    { postMergeRan: 0, postMergeFailed: 1 },
    { postMergeRan: 0, postMergeFailed: 1, postMergeParentsLeftOpen: ['x', { pr: 11, reason: 5 }, { pr: 'x', parent: 1, reason: 'gh-failed' }], postMergeStepSkips: 'x' },
  ]) {
    seed(summary);
    const legacy = await contextOf();
    assert.match(legacy, /post-merge steps failed for 1 merged run\(s\) \(tidy's parent-gate backstop recovers the parents\)/);
    assert.doesNotMatch(legacy, /left parent record|skipped step-wide/);
  }
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `node --test --test-name-pattern="#4798" tests/bin-lib/hooks/reconcile-background.test.js tests/hooks-session-start.test.js`
Expected: FAIL. `postMergeParentsLeftOpen` is `undefined`, and no `left parent record(s) open` text appears.

- [ ] **Step 4: Implement the summary** in `hooks.js`: add the two fields per the Interfaces block, importing the helpers in the existing `require('./lib/reconcile/post-merge')` destructure. Comment that each element's raw `reason` is quoted and its `detail` dropped.

- [ ] **Step 5: Implement the render** in `session-start.js`, inside the existing try block
  - A valid left-open item is an object with an integer `pr` and a string `reason`. It renders `#${parent} (${reason}, PR #${pr})` when `parent` is an integer, else `the parent of record #${issue} (${reason}, PR #${pr})` when `issue` is an integer, else `every parent (${reason}, PR #${pr})`. Skip anything else.
  - In the `postMergeFailed` line, insert `Step 4.0b left parent record(s) open: ${items.join(', ')}; ` between the `failedRecords` clause and `tidy's parent-gate backstop recovers the parents`, only when at least one item is valid.
  - Right after the failed line, as its own line: `post-merge Step 4.0b skipped step-wide, leaving no parent open (the merge closed no sub-issue): ${skips.join(', ')}`. Each skip is `${reason} (PR #${pr})`, under the same `pr`/`reason` validity rule. Render it only when at least one skip is valid. It does not depend on `postMergeFailed`.

- [ ] **Step 6: Run the suites to verify they pass**

Run: `node --test tests/bin-lib/hooks/reconcile-background.test.js tests/hooks-session-start.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/hooks.js plugin/bin/lib/hooks/session-start.js tests/bin-lib/hooks/reconcile-background.test.js tests/hooks-session-start.test.js
git commit -m "Name the parents a background Step 4.0b left open at SessionStart — refs #4798"
```

### Task 4: End-to-end acceptance test and the surfacing docs

**Role:** integration

**Files:**
- Create: `tests/post-merge-parent-left-open-e2e.test.js`
- Modify: `docs/reconcile-checks.md`: the Post-merge closes `Surfacing` bullet (~717-760) and `Single-run path` bullet (~761-774)
- Modify: `docs/journeys/close-a-below-floor-decomposition-parent-4466.md`: the SessionStart prior-pass `Should understand` bullet (~79)
- Modify: `docs/journeys/session-start-fast-background-reconcile.md`: step 3's `Action` (~42)

**Interfaces:**
- Consumes: Task 1's loop-entry `parentFailures`, and Task 3's `postMergeParentsLeftOpen` and render.

- [ ] **Step 1: Write the end-to-end test** `tests/post-merge-parent-left-open-e2e.test.js`. This is spec Decision Q1, and it carries AC1.1.
  - Fixture, built like `tests/bin-lib/reconcile/post-merge.test.js`'s `mainCheckout` + `addRun`: a `fs.realpathSync`'d temp dir with `git init -q`, `git remote add origin git@github.com:acme/w.git`, a `CLAUDE.md` holding `## Work records\n\nwork-backend: github-issues\n`, and a run dir `.claude-tweaks/pipelines/2026-10-30T090000-spec-1/run-state.json` = `{ status: 'in-progress', pr: { number: 11 } }`.
  - Stub `require('../plugin/bin/lib/reconcile').reconcile` (module-object stub, as `backgroundSummaryFor` does) with an async function. It calls the real `postMerge({ cwd: root, prStates: { byNumberAsync: async () => ({ number: 11, state: 'MERGED', mergedAt: <now − 1 h ISO> }) }, now, deps: { gh: () => '', closingLinksRun, closeParents } })`, keeps the entries, and returns `{ postMerge: entries }`.
    - `closingLinksRun` prints `{ action: 'nothing-closed', pr: 11, closingSet: [101], reopened: [], pendingClose: [], failed: [] }` and returns 0.
    - `closeParents` returns `{ closed: [], skipped: [{ parent: 100, reason: 'gh-failed', detail: 'HTTP 502' }] }`.
  - With `process.chdir(root)` and `process.stdout.write` silenced, run `require('../plugin/bin/hooks').main(['node', 'hooks.js', 'reconcile-background'])` and assert it returns 0. Restore cwd, stdout and the stub in `finally`.
  - Then `git remote remove origin` (SessionStart's inline FAST_CHECKS then do no network I/O), and run `require('../plugin/bin/lib/hooks/session-start').run({ input: {}, runDir: null, runState: null, cwd: root, superpowersDeps: { readFile: () => { throw Object.assign(new Error('no install (test)'), { code: 'ENOENT' }); } } })`.
  - Test name `AC1.1: a real postMerge run whose Step 4.0b hit gh-failed reaches SessionStart naming the parent, never as a clean ran (#4798)`. Assertions:
    - `entries[0].action === 'ran'`
    - `deepEqual(entries[0].parentFailures, [{ parent: 100, reason: 'gh-failed', detail: 'HTTP 502' }])`
    - `classifyEntry(entries[0]).verdict === 'failed'`
    - the status file's `summary.postMergeRan === 0`, `summary.postMergeFailed === 1`, and `deepEqual(summary.postMergeParentsLeftOpen, [{ pr: 11, parent: 100, reason: 'gh-failed' }])`
    - `additionalContext` matches `/post-merge steps failed for 1 merged run\(s\) \(Step 4\.0b left parent record\(s\) open: #100 \(gh-failed, PR #11\); tidy's parent-gate backstop recovers the parents\)/` and does not match `/post-merge steps ran for/`
  - Remove the temp dir in `test.after`.

- [ ] **Step 2: Run it to verify it passes** (Tasks 1 and 3 already landed the behavior. The test's red state is proven by reverting: with Task 1's `processRun` change reverted it fails on `parentFailures`.)

Run: `node --test tests/post-merge-parent-left-open-e2e.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 3: Update `docs/reconcile-checks.md`**
  - Surfacing bullet: replace `(`parentFailures`; #4798 adds that field to loop entries, so until it lands only Step 4.0 can fail one)` with a sentence stating that a loop entry carries `parentFailures` when non-empty. Describe `postMergeParentsLeftOpen` and `postMergeStepSkips`, then the failed line's `Step 4.0b left parent record(s) open: #100 (gh-failed, PR #11), …` clause with its three item forms. Then the separate `post-merge Step 4.0b skipped step-wide, leaving no parent open (the merge closed no sub-issue): …` line, and the empty-closing-set rule that routes a step-wide skip to `stepSkips`.
  - Single-run bullet: replace `and `parentFailures`, `verdict`, `next` and `failedSteps` stay single-run` with a statement that a loop entry carries `parentFailures` only when non-empty and `stepSkips` (either path) only when non-empty, while `verdict`, `next` and `failedSteps` stay single-run.

- [ ] **Step 4: Update both journeys.** Add the Step 4.0b parent clause to each quoted failed line (`…; Step 4.0b left parent record(s) open: #100 (gh-failed, PR #11); tidy's parent-gate backstop recovers the parents)`, "the parent clause only when Step 4.0b left a parent open"). Add the step-wide skip line, citing `#4798` beside the existing `#4599, #4897` citations.

- [ ] **Step 5: Verify the doc sweep**
  - `git grep -n -F "#4798 adds that field" -- docs plugin` → no output. Control: `git grep -n -F "#4798 adds that field" HEAD -- docs/reconcile-checks.md` matches line 731 at plan time.
  - Behavior-change sweep: `git grep -n -e "postMergeOne only" -e "stay single-run" -e "carry none" -- plugin/bin docs/reconcile-checks.md docs/plugin-structure.md`. Every hit is either updated in this plan or classified below.
  - Run: `node --test tests/below-floor-parent-close-conformance.test.js tests/reconcile.test.js tests/wrap-up-merge-mode-conformance.test.js`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/post-merge-parent-left-open-e2e.test.js docs/reconcile-checks.md docs/journeys/close-a-below-floor-decomposition-parent-4466.md docs/journeys/session-start-fast-background-reconcile.md
git commit -m "Pin the partial parent-close surfacing end to end and document it — refs #4798"
```

### Verification

Waived AC2.1: `npm test` passing is verified by `/claude-tweaks:build` Common Step 5 (the runner-backed full suite), not by a plan task.

### Scope sweep (plan audit Check B): classified no-change

- `plugin/bin/lib/reconcile/format-summary.js`: the CLI rows already route through `classifyEntry`/`isFailedRun` (#4897), so a loop entry with `parentFailures` lands on the failed row and a `stepSkips`-only entry on the clean row. Naming parents in the compact CLI row is not in the spec.
- `docs/superpowers/plans/2026-11-02-background-post-merge-summary-4897.md` (Check B's one hit), plus other `docs/superpowers/plans/*` and `.claude-tweaks/pipelines/*/work/*-spec.md` files: historical plans and specs that quote `parentFailures`. They are not shipped.
- `plugin/skills/_shared/pr-first-merge-post-merge.md`: describes the in-session Step 4.0b, whose marker text is unchanged.
