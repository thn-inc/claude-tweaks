# Partial Step 4.0b Parent-Close Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a reconcile post-merge run's Step 4.0b leaves a parent open (a `gh-failed`, `internal-error`, or other non-deliberate skip), the entry carries that as structured data, the run is never counted as a clean `ran`, and the next SessionStart names the parent. A Step 4.0b skip that names no parent and no record, on a merge whose effective closing set is empty, goes to its own `stepSkips` field and is reported on its own line on every surface, because no parent can have been left open. A `marker-write-failed` entry keeps both fields (Q5), so no outcome drops them.

**Architecture:** #4897 (merged) already makes `hooks.js`'s background summary and `format-summary.js` count any `ran` entry with a non-empty `parentFailures` as failed, through `post-merge.js`'s `classifyEntry`. Only `postMergeOne` (the single-run path) emits `parentFailures` today. `processRun` in `plugin/bin/lib/reconcile/post-merge.js` will (a) split Step 4.0b's non-deliberate skips into `parentFailures` (a parent may be left open) and a new `stepSkips` (a parentless skip on an empty effective closing set: none can be), (b) put `parentFailures` on a loop entry when it is non-empty, and (c) put the same fields on the `skipped / marker-write-failed` entry that replaces the `ran` entry when the marker write fails. Two pure helpers flatten those fields from every entry that carries them, whatever its action, and two pure line formatters render them. The background summary stores the flattened lists; SessionStart and the reconcile CLI each print the formatters' two lines; merge mode reports both fields on the entry's own line.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T201056-record-4798/work/4798-spec.md` (the worktree copy; its `## Decisions` section answers plan-review Q1–Q5)

Scope keywords: parentFailures, stepSkips, postMergeParentsLeftOpen

## Global Constraints

- From the spec's Acceptance Criteria, verbatim: "A test drives Step 4.0b to a `gh-failed` skip and asserts the entry is not a clean `ran` and that the SessionStart summary names the parent." / "`npm test` passes."
- Spec Decisions, verbatim. Q1: "add one end-to-end test that sends a real `postMerge` run (a fake `closeParents` returning a `gh-failed` skip) through `hooks.js reconcile-background` into SessionStart, and asserts the rendered summary names the parent (`#100 (gh-failed, …)`). Seam tests may stay as well, but they do not satisfy the criterion on their own." Q2: "A Step 4.0b step-wide skip (`unreadable-policy`, `invalid-risk-floor`) on a merge whose Step 4.0 closing set is empty does not count as a parent left open and must not render under "left parent record(s) open". Surface it on its own separate line in the summary (the unreadable/invalid policy is still worth reporting). A step-wide skip with a non-empty closing set still counts as partial." Q3: "The "nothing to close" condition tests the effective closing set, `closingSet` minus `closedAfterWindow`, not the raw `closingSet`. A PR whose `Fixes` records all closed after the window has nothing left to close." Q4: "Any step skip that names no parent and no record goes on the separate line whenever the effective closing set is empty. This is not limited to `unreadable-policy`/`invalid-risk-floor`, so a skip kind added later needs no new ruling." Family rule: "`stepSkips` are reported in every mode, including merge mode and on a failed entry; no mode or outcome drops them. A plan task that changes this reporting carries `Review risk: high`." Q5: "When `processRun`'s marker write fails and the entry becomes `skipped / marker-write-failed`, that entry still carries the run's `stepSkips` and `parentFailures`, and every surface reports them on it: merge mode, the background summary, SessionStart, and the reconcile CLI summary. The shape change is additive: new fields on an existing entry, and existing readers ignore them. The family rule "no mode or outcome drops stepSkips" therefore holds with no exemption. If any other replacement or short-circuit entry in `post-merge.js` drops them the same way, it gets the same treatment, with no new ruling needed." Plan marker: "Task 5 carries `Review risk: high`."
- The split is applied once, in `processRun`, so it holds on both paths (loop and `postMergeOne`). For the single-run path an empty-effective-set parentless skip now reads `verdict: clean`, and merge mode reports it (Task 2), so it is never dropped.
- "Effective closing set" means the `closingSet` local `processRun` hands to `closeParents`: `numbers(envelope.closingSet)` minus `closedAfterWindow` (post-merge.js line ~573).
- Q5's other-entries sweep, classified (no change needed): every other entry `processRun` or `processCandidate` returns is produced before Step 4.0b's split exists, so it has no `parentFailures`/`stepSkips` to drop. The `retry()` attempt entries (`transient-failure`, and a `marker-write-failed` from the attempt-line write) and the no-closing-set branch (lines ~550-568) return before `closeParents` runs. `processCandidate`'s `catch` (`error`, line ~380) only fires on a throw, which leaves no split result; `closeBelowFloorParents` reports its own failures as `internal-error` skips rather than throwing. Only the Step 4.0b branch's final `write` (line ~614) replaces an entry that carries the fields.
- No surface words `stepSkips` as limited to `unreadable-policy`/`invalid-risk-floor` (Q4). Every surface's step-skip text says "nothing left to close", never "closed no sub-issue" (Q3: the records may have closed by hand after the window).
- Shape convention (#4897's "a clean one keeps its short shape"): a loop entry carries `parentFailures` only when it is non-empty. `postMergeOne` keeps emitting it every time (`includeRecords`). Both paths carry `stepSkips` only when it is non-empty. A `marker-write-failed` entry from the Step 4.0b branch follows the same rule as the `ran` entry it replaces (Q5: additive fields).
- One renderer: the SessionStart line and the reconcile CLI line come from the same two pure formatters in `post-merge.js` (`parentsLeftOpenLine`, `stepSkipsLine`), so their wording cannot drift. `session-start.js` already loads `post-merge.js` transitively (its top-level `require('../reconcile')` loads `./post-merge`), so requiring it there adds no new module load.
- Hooks never break a session (`docs/hooks.md`): the new SessionStart rendering stays inside the existing `try { … } catch` block (~321-400). The formatters validate every element (`Array.isArray`, an integer `pr`, a string `reason`), so a status file from an older build renders exactly what it renders today.
- Project CLAUDE.md Working Approach, verbatim: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Governing skill `driver-skill-outcome-taxonomy`, verbatim rows. "Driver prose that routes an engine's outcome by hand-listing its raw action or reason words: which mean clean, which mean failed, which earn a re-run | Have the engine classify its own outcome, route the prose only on that field, and quote the raw word in the report." And: "Giving one path an outcome classifier while a sibling path over the same entries keeps its own narrower test | Grep every reader of those entries and route them through the classifier in the same change, checking what it says of entries only the new reader sees." Applied here: the split is decided in `processRun`, the flattening and the line text in exported helpers (`parentsLeftOpen`, `stepSkipsOf`, `parentsLeftOpenLine`, `stepSkipsLine`), and every surface (hooks.js summary, SessionStart, format-summary.js, merge-mode.md) only renders those fields. `classifyEntry` is unchanged: a `marker-write-failed` entry already reads `failed` / `rerun`.
- Governing skill `prose-code-twin-pin`: `merge-mode.md` names the new fields on the entry's line, so Task 2 pins that sentence in `tests/wrap-up-merge-mode-conformance.test.js`. These skills do not apply, because no `hooks.js` verb or flag is added and no `gh`/`git` call or source scan is introduced: `hooks-js-verb-registration`, `gh-api-module-pattern`, `bin-source-scan-conformance`.
- Commit subjects: `{Verb} {what} — {detail}`, referencing the record as `refs #4798` (never `closes`/`fixes`).

## Review Focus

1. A parentless skip whose closing set is empty only after the close-window filter (`closingSet: [101]`, `closedAfterWindow: [101]`) must go to `stepSkips`. Task 1's Q2 test pins it.
2. A parentless skip with a non-empty effective closing set must stay a parent left open (`parentFailures`, failed). Task 1's Q2 test and the widened line-722 literal pin it.
3. A failed entry (a non-clean Step 4.0 word) that also carries `stepSkips` must still report them in merge mode, the background summary, SessionStart and the CLI. Task 1's helper test, Task 2's pin, Task 3's summary test and Task 4's CLI test pin it.
4. Q5: a `marker-write-failed` entry from the Step 4.0b branch keeps `parentFailures` and `stepSkips` (loop and single-run), and every surface reports them: the helpers read it (Task 1), merge mode's `skipped` line names them (Task 2), and SessionStart and the CLI print them although neither `postMergeFailed` nor the CLI's failed row counts that entry (Tasks 3 and 4).
5. A status file from before this change (no `postMergeParentsLeftOpen`/`postMergeStepSkips`), or one carrying junk elements, must render no new text and throw nothing. Task 1's formatter test and Task 3's SessionStart test pin it.
6. Deliberate skips (`above-floor`, …) must keep a loop entry's short shape: no `parentFailures` key. Task 1's AC1.1 test (mixed skips) and the unchanged `marker-write-failed`/`M8` literals pin it.

---

### Task 1: Split Step 4.0b failures into `parentFailures` and `stepSkips`, keep them on a failed marker write, and add the flatten and line helpers

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/post-merge.js`: the `postMergeOne` entry-shape comment at ~471-473, the `processRun` comment at ~495-499, the `write` helper at ~529-537, the `parentFailures` construction and the final `write` at ~605-616, `failedRecordNumbers`' neighborhood (~458-469) for the four helpers, and `module.exports` at ~619-624
- Test: `tests/bin-lib/reconcile/post-merge.test.js`

**Interfaces:**
- Produces, on the entry from the Step 4.0b branch of `processRun` (an envelope with an array `closingSet`), whether it is the `ran` entry or the `skipped / marker-write-failed` entry that replaces it when the marker write throws:
  - `parentFailures: Array<{ parent?: number, issue?: number, reason: string, detail?: string }>`: the non-deliberate skips, except those routed to `stepSkips`. Always present on a `postMergeOne` entry (possibly `[]`). Present on a loop entry only when non-empty.
  - `stepSkips: Array<{ reason: string, detail?: string }>`: when the effective closing set is empty, every non-deliberate skip with neither `parent` nor `issue`, whatever its reason. Present only when non-empty (both paths). `detail` is bounded the same way `parentFailures`' is (`boundDetail(oneLine(...))`).
  - Every other entry (the no-closing-set branch, the `retry()` entries, `processCandidate`'s skips) is unchanged; see the Q5 sweep in Global Constraints.
- Produces (exported pure helpers, consumed by Tasks 3 and 4):
  - `parentsLeftOpen(entries) -> Array<{ pr, parent?, issue?, reason }>`: over every entry with an array `parentFailures`, whatever its `action`, in entry order, one element per `parentFailures` element, `detail` dropped. Non-array input → `[]`.
  - `stepSkipsOf(entries) -> Array<{ pr, reason }>`: the same shape over `stepSkips`, whatever the entry's action or verdict.
  - `parentsLeftOpenLine(items) -> string | null`: `post-merge Step 4.0b left parent record(s) open: {item}, … — tidy's parent-gate backstop recovers them`. A valid item is an object with an integer `pr` and a string `reason`; it renders `#${parent} (${reason}, PR #${pr})` when `parent` is an integer, else `the parent of record #${issue} (${reason}, PR #${pr})` when `issue` is an integer, else `every parent (${reason}, PR #${pr})`. Invalid items are skipped. `null` when the input is not an array or no item is valid.
  - `stepSkipsLine(items) -> string | null`: `post-merge Step 4.0b skipped step-wide, leaving no parent open (nothing left to close): ${reason} (PR #${pr}), …`, under the same validity rule, `null` likewise.
- `classifyEntry` is unchanged. A `stepSkips`-only entry with a clean Step 4.0 word reads `clean` because it has no `parentFailures` element; a `marker-write-failed` entry reads `failed` / `rerun` as today.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/reconcile/post-merge.test.js` (add `parentsLeftOpen, stepSkipsOf, parentsLeftOpenLine, stepSkipsLine` to the top-level require ending at line 10)

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

test('Q2-Q4: a parentless Step 4.0b skip on an empty effective closing set is a stepSkips element, never a parent left open, on both paths (#4798)', async () => {
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
  // Q3 + Q4: closeParents' own parentless skips (any reason) on a closing set the close window emptied.
  const winRoot = mainCheckout();
  addRun(winRoot, '2026-10-30T090000-spec-1');
  const windowed = await run(winRoot, {
    prs: { 11: merged() }, links: fakeClosingLinks({ ...ENVELOPE, closingSet: [101], closedAfterWindow: [101] }),
    close: fakeCloseParents({ closed: [], skipped: [{ reason: 'invalid-risk-floor' }, { reason: 'internal-error', detail: 'boom' }] }),
  });
  assert.deepEqual(windowed.entries[0].stepSkips, [{ reason: 'invalid-risk-floor' }, { reason: 'internal-error', detail: 'boom' }]);
  assert.ok(!('parentFailures' in windowed.entries[0]));
  // A non-empty effective closing set: the same skip is a parent left open.
  const { root: setRoot } = policyCheckout(null);
  fs.mkdirSync(path.join(setRoot, '.claude-tweaks', 'policy.yml'));
  const withSet = await run(setRoot, { prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE), close: fakeCloseParents() });
  assert.deepEqual(withSet.entries[0].parentFailures, [EISDIR]);
  assert.ok(!('stepSkips' in withSet.entries[0]));
});

test('Q5: a marker-write-failed entry keeps the run\'s parentFailures and stepSkips, on both paths (#4798)', async () => {
  const readOnly = { appendEntries: () => { throw new Error('read-only'); } };
  // Loop path: a parent left open.
  const root = mainCheckout();
  const dir = addRun(root, '2026-10-30T090000-spec-1');
  const loop = await run(root, {
    prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE),
    close: fakeCloseParents({ closed: [], skipped: [{ parent: 100, reason: 'gh-failed', detail: 'HTTP 502' }] }),
    extra: readOnly,
  });
  assert.deepEqual(loop.entries, [{
    runDir: dir, pr: 11, action: 'skipped', reason: 'marker-write-failed', parentsClosed: 0,
    parentFailures: [{ parent: 100, reason: 'gh-failed', detail: 'HTTP 502' }],
  }]);
  // Single-run path: a step skip on an empty effective closing set.
  const { root: oneRoot, dir: oneDir } = policyCheckout(null);
  fs.mkdirSync(path.join(oneRoot, '.claude-tweaks', 'policy.yml'));
  const one = await postMergeOne(oneArgs(oneRoot, oneDir, {
    prs: { 11: merged() }, links: fakeClosingLinks({ ...ENVELOPE, closingSet: [] }), close: fakeCloseParents(), extra: readOnly,
  }));
  assert.equal(one.reason, 'marker-write-failed');
  assert.deepEqual(one.parentFailures, []);
  assert.deepEqual(one.stepSkips, [{ reason: 'unreadable-policy', detail: '.claude-tweaks/policy.yml: EISDIR' }]);
  assert.deepEqual([one.verdict, one.next], ['failed', 'rerun']);
});

test('parentsLeftOpen and stepSkipsOf flatten every entry carrying the fields, in order, any action or verdict, detail dropped (#4798)', () => {
  const entries = [
    { pr: 11, action: 'ran', parentFailures: [{ parent: 100, reason: 'gh-failed', detail: 'x' }, { issue: 103, reason: 'internal-error' }] },
    { pr: 12, action: 'ran', parentFailures: [], stepSkips: [{ reason: 'unreadable-policy', detail: 'y' }] },
    { pr: 13, action: 'skipped', reason: 'marker-write-failed', parentFailures: [{ parent: 9, reason: 'gh-failed' }], stepSkips: [{ reason: 'invalid-risk-floor' }] },
    { pr: 14, action: 'ran', parentFailures: 'junk', stepSkips: 'junk' },
    { pr: 15, action: 'ran', closingLinks: 'close-failed', stepSkips: [{ reason: 'internal-error' }] },
  ];
  assert.deepEqual(parentsLeftOpen(entries), [
    { pr: 11, parent: 100, reason: 'gh-failed' }, { pr: 11, issue: 103, reason: 'internal-error' }, { pr: 13, parent: 9, reason: 'gh-failed' },
  ]);
  assert.deepEqual(stepSkipsOf(entries), [{ pr: 12, reason: 'unreadable-policy' }, { pr: 13, reason: 'invalid-risk-floor' }, { pr: 15, reason: 'internal-error' }]);
  assert.deepEqual(parentsLeftOpen(null), []);
  assert.deepEqual(stepSkipsOf(undefined), []);
});

test('parentsLeftOpenLine and stepSkipsLine render the valid items and nothing for none (#4798)', () => {
  assert.equal(
    parentsLeftOpenLine([{ pr: 11, parent: 100, reason: 'gh-failed' }, { pr: 11, issue: 103, reason: 'internal-error' }, { pr: 12, reason: 'unreadable-policy' }, 'x', { pr: 'x', parent: 1, reason: 'gh-failed' }]),
    "post-merge Step 4.0b left parent record(s) open: #100 (gh-failed, PR #11), the parent of record #103 (internal-error, PR #11), every parent (unreadable-policy, PR #12) — tidy's parent-gate backstop recovers them",
  );
  assert.equal(
    stepSkipsLine([{ pr: 13, reason: 'invalid-risk-floor' }, { pr: 14, reason: 5 }]),
    'post-merge Step 4.0b skipped step-wide, leaving no parent open (nothing left to close): invalid-risk-floor (PR #13)',
  );
  for (const junk of [undefined, null, 'x', [], [{ pr: 11, reason: 5 }]]) {
    assert.equal(parentsLeftOpenLine(junk), null);
    assert.equal(stepSkipsLine(junk), null);
  }
});
```

In the existing `I1: postMergeOne lists Step 4.0b failures in parentFailures; a deliberate policy skip is not one; postMerge entries carry none` test (line ~1334), rename it to `I1: postMergeOne and postMerge entries list the same Step 4.0b failures; a deliberate policy skip is not one`. Replace its last assertion `assert.ok(!('parentFailures' in loop.entries[0]));` (line ~1375) with `assert.deepEqual(loop.entries[0].parentFailures, entry.parentFailures);`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="#4798|I1: postMergeOne and postMerge" tests/bin-lib/reconcile/post-merge.test.js`
Expected: FAIL. The loop entry has no `parentFailures`, there is no `stepSkips`, the `marker-write-failed` entry carries neither field, and `parentsLeftOpen` is not a function.

- [ ] **Step 3: Implement** in `processRun`
  - Replace the `includeRecords ? { parentFailures: … } : {}` construction with this computation, placed before the final `write`: `failures` = the non-deliberate skips (same filter and per-element mapping as today). When the effective `closingSet` local is empty, route each failure with neither `parent` nor `issue` to `stepSkips` (mapped to `{ reason, detail? }`) and keep the rest in `parentFailures`. Collect the emitted fields in one object: `parentFailures` when `includeRecords || parentFailures.length > 0`, `stepSkips` when it is non-empty.
  - Give `write` a fourth parameter, `extra = {}`, spread into its `marker-write-failed` entry after `parentsClosed`. Pass the fields object as `extra` in the Step 4.0b branch's final `write`, and spread it into the `ran` entry as today. The other `write` callers pass no `extra`, so their entries are unchanged.
  - Add `parentsLeftOpen`, `stepSkipsOf`, `parentsLeftOpenLine` and `stepSkipsLine` as pure functions beside `failedRecordNumbers`, and export them.
  - Update the comments at ~471-473 (add `stepSkips?` after `parentFailures?`), ~495-499, ~529 and ~605 so none of them says `parentFailures` is `postMergeOne`-only, and so the `write` comment says a failed marker write keeps Step 4.0b's fields (Q5). State the empty-effective-set `stepSkips` rule once, at the construction.

- [ ] **Step 4: Widen the exact-shape loop literals Step 3 changes**
  - line ~103 (`merged unmarked run…`, whose skips include `{ issue: 102, reason: 'gh-failed', detail: 'boom' }`): the entry gains `parentFailures: [{ issue: 102, reason: 'gh-failed', detail: 'boom' }]`.
  - line ~722 (`an unreadable policy.yml skips Step 4.0b fail-closed`, closing set `[101, 102]`): the entry gains `parentFailures: [{ reason: 'unreadable-policy', detail: '.claude-tweaks/policy.yml: EISDIR' }]`.
  - Leave every other `action: 'ran'` and `marker-write-failed` literal unchanged (`grep -n -e "action: 'ran'" -e "marker-write-failed" tests/bin-lib/reconcile/post-merge.test.js`): those entries are either no-closing-set entries or entries with no non-deliberate skip (`marker-write-failed` at ~769 and `M8` at ~783 use `fakeCloseParents()` with no failed skip).

- [ ] **Step 5: Run the suites to verify they pass**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js tests/post-merge-run-cli.test.js tests/reconcile*.test.js tests/bin-lib/hooks/reconcile-background.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/reconcile/post-merge.js tests/bin-lib/reconcile/post-merge.test.js
git commit -m "Carry Step 4.0b parent failures and step skips on loop and marker-write-failed entries — refs #4798"
```

### Task 2: Merge mode reports `stepSkips` and a `marker-write-failed` entry's `parentFailures`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/wrap-up/merge-mode.md`: `## Already merged`, a new bullet right after the `logFailed` bullet (line ~37), and one sentence appended to the `skipped` failure bullet (line ~38). The file is ~14 KB against the 52,500 B rail.
- Modify: `plugin/bin/post-merge-run.js`: the header entry shape and `parentFailures` paragraph (~14-28) and the `--help` usage string (~67-69)
- Modify: `docs/plugin-structure.md`: the `post-merge-run.js` CLI line (~195)
- Test: `tests/wrap-up-merge-mode-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `stepSkips` (`[{ reason, detail? }]`, only when non-empty) and the narrowed `parentFailures`, on a `ran` entry or a `skipped / marker-write-failed` one.

- [ ] **Step 1: Write the failing pin** in `tests/wrap-up-merge-mode-conformance.test.js` (reuse the file's existing `alreadyMergedSection`, `flat` and `read` helpers)

```js
test('#4798: the Already merged section reports stepSkips on every ran and marker-write-failed line, and a marker-write-failed line\'s parentFailures; the CLI docs name the fields', () => {
  assert.match(alreadyMergedSection(), /Any line reporting an entry that carries `stepSkips` — a `ran` entry, clean or a failure, or a `skipped` `marker-write-failed` one — also adds `, Step 4\.0b skipped — \{reason\}` per element/);
  assert.match(alreadyMergedSection(), /A `marker-write-failed` line also adds `, Step 4\.0b \{reason\} on #\{parent\}` per `parentFailures` element/);
  assert.doesNotMatch(alreadyMergedSection(), /stepSkips[^\n]*`unreadable-policy` or `invalid-risk-floor`/, 'Q4: stepSkips are not limited to the two policy reasons');
  for (const file of [['plugin', 'bin', 'post-merge-run.js'], ['docs', 'plugin-structure.md']]) {
    const text = flat(read(...file));
    assert.match(text, /stepSkips\?/, `${file.join('/')}: the entry shape carries stepSkips`);
    assert.match(text, /closing set was empty/, `${file.join('/')}: states when a parentless skip is a stepSkips element`);
    assert.match(text, /marker-write-failed[^.]*keeps/, `${file.join('/')}: a failed marker write keeps the Step 4.0b fields`);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-name-pattern="#4798" tests/wrap-up-merge-mode-conformance.test.js`
Expected: FAIL. The section has no `stepSkips` bullet.

- [ ] **Step 3: Edit the three files**
  - `merge-mode.md`: insert this bullet right after the `logFailed` bullet, leaving the `clean` bullet and the failed-`4.0b` bullet as they are: ``- Any line reporting an entry that carries `stepSkips` — a `ran` entry, clean or a failure, or a `skipped` `marker-write-failed` one — also adds `, Step 4.0b skipped — {reason}` per element: a Step 4.0b skip that names no parent and no record, on a merge whose closing set was empty once records closed after the close window are left out, so nothing was left to close and no parent was left open.`` Append to the `skipped` failure bullet: ``A `marker-write-failed` line also adds `, Step 4.0b {reason} on #{parent}` per `parentFailures` element (`on record #{issue}` for a bare record; a step-wide skip names no target): the closes ran, only the marker is missing, so its `rerun` retries them.``
  - `post-merge-run.js` header and `plugin-structure.md`: add `stepSkips?` to the entry shape right after `parentFailures?`, keeping `verdict, next, failedSteps?}` adjacent and last (an existing pin reads it). In each `parentFailures` description, add that a skip naming no parent and no record, on a merge whose closing set was empty (after the close window), goes to `stepSkips` (`[{reason, detail?}]`) instead, which leaves a clean-word entry `clean`; and that a `marker-write-failed` entry from a Step 4.0b run keeps both fields. In the `--help` usage string, add `stepSkips?` to the printed shape.

- [ ] **Step 4: Run the suite to verify it passes**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js tests/post-merge-run-cli.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/merge-mode.md plugin/bin/post-merge-run.js docs/plugin-structure.md tests/wrap-up-merge-mode-conformance.test.js
git commit -m "Report Step 4.0b step skips and a failed marker write's parent failures in merge mode — refs #4798"
```

### Task 3: Name the parents left open, and the step skips, in the background summary and SessionStart

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/hooks.js`: the `reconcile-background` summary at ~1881-1908
- Modify: `plugin/bin/lib/hooks/session-start.js`: the prior-pass post-merge lines at ~337-364
- Test: `tests/bin-lib/hooks/reconcile-background.test.js`
- Test: `tests/hooks-session-start.test.js`

**Interfaces:**
- Consumes: Task 1's `parentsLeftOpen(entries)`, `stepSkipsOf(entries)`, `parentsLeftOpenLine(items)` and `stepSkipsLine(items)` from `post-merge.js`.
- Produces (status-file `summary` fields, read by `session-start.js` and Task 5):
  - `postMergeParentsLeftOpen: parentsLeftOpen(postMergeEntries)`
  - `postMergeStepSkips: stepSkipsOf(postMergeEntries)`
  - Every existing field is unchanged. A `parentFailures` `ran` entry is already counted by `postMergeFailed` through `classifyEntry`, and a clean-word `stepSkips`-only entry by `postMergeRan`. A `marker-write-failed` entry stays out of both counts (#4897's `AC3.1`), and its fields reach SessionStart only through the two lists, which is why SessionStart prints them on their own lines rather than inside the failed line.

- [ ] **Step 1: Write the failing summary test** in `tests/bin-lib/hooks/reconcile-background.test.js`

```js
test('AC1.1 + Q5: the summary lists each parent Step 4.0b left open and each step skip, a marker-write-failed entry\'s included, whatever the verdict (#4798)', async () => {
  const summary = await backgroundSummaryFor({ postMerge: [
    { runDir: '/r/a', pr: 11, action: 'ran', closingLinks: 'nothing-closed', parentsClosed: 1, parentFailures: [{ parent: 100, reason: 'gh-failed', detail: 'HTTP 502' }, { issue: 103, reason: 'internal-error' }] },
    { runDir: '/r/b', pr: 12, action: 'ran', closingLinks: 'nothing-closed', parentsClosed: 0, stepSkips: [{ reason: 'unreadable-policy', detail: '.claude-tweaks/policy.yml: EISDIR' }] },
    { runDir: '/r/c', pr: 13, action: 'ran', closingLinks: 'close-failed', parentsClosed: 0, stepSkips: [{ reason: 'internal-error' }] },
    { runDir: '/r/d', pr: 14, action: 'skipped', reason: 'marker-write-failed', parentsClosed: 0, parentFailures: [{ parent: 200, reason: 'gh-failed' }], stepSkips: [{ reason: 'invalid-risk-floor' }] },
  ] });
  assert.equal(summary.postMergeFailed, 2);
  assert.equal(summary.postMergeRan, 1, 'a step skip alone never leaves a parent open');
  assert.deepEqual(summary.postMergeParentsLeftOpen, [{ pr: 11, parent: 100, reason: 'gh-failed' }, { pr: 11, issue: 103, reason: 'internal-error' }, { pr: 14, parent: 200, reason: 'gh-failed' }]);
  assert.deepEqual(summary.postMergeStepSkips, [{ pr: 12, reason: 'unreadable-policy' }, { pr: 13, reason: 'internal-error' }, { pr: 14, reason: 'invalid-risk-floor' }]);
});
```

Also extend the empty-input loop in `counts post-merge runs and the parents they closed …` (line ~262) with `assert.deepEqual(none.postMergeParentsLeftOpen, [])` and `assert.deepEqual(none.postMergeStepSkips, [])`.

- [ ] **Step 2: Write the failing SessionStart test** in `tests/hooks-session-start.test.js`, after the `#4599` post-merge test (line ~731)

```js
test('AC1.1 + Q5: SessionStart names the parents a prior pass\'s Step 4.0b left open, and the step skips, each on its own line (#4798)', async () => {
  const project = gitProject();
  fs.mkdirSync(path.join(project, '.claude-tweaks'), { recursive: true });
  const statusPath = path.join(project, '.claude-tweaks', 'reconcile-background-status.json');
  const seed = (summary) => fs.writeFileSync(statusPath, JSON.stringify({ completedAt: Date.now(), surfaced: false, summary }));
  const contextOf = async () => (await runSessionStart({ input: {}, runDir: null, runState: null, cwd: project })).json.hookSpecificOutput.additionalContext;

  seed({ postMergeRan: 0, postMergeFailed: 2, postMergeFailedRecords: [101], postMergeParentsLeftOpen: [
    { pr: 11, parent: 100, reason: 'gh-failed' }, { pr: 11, issue: 103, reason: 'internal-error' }, { pr: 12, reason: 'unreadable-policy' },
  ], postMergeStepSkips: [{ pr: 13, reason: 'invalid-risk-floor' }] });
  const named = await contextOf();
  assert.match(named, /post-merge steps failed for 2 merged run\(s\) \(records #101 need a hand reopen or close/);
  assert.match(named, /post-merge Step 4\.0b left parent record\(s\) open: #100 \(gh-failed, PR #11\), the parent of record #103 \(internal-error, PR #11\), every parent \(unreadable-policy, PR #12\) — tidy's parent-gate backstop recovers them/);
  assert.match(named, /post-merge Step 4\.0b skipped step-wide, leaving no parent open \(nothing left to close\): invalid-risk-floor \(PR #13\)/);

  // Q5: a marker-write-failed entry's parent is named although no count includes that run.
  seed({ postMergeRan: 0, postMergeFailed: 0, postMergeParentsLeftOpen: [{ pr: 14, parent: 200, reason: 'gh-failed' }] });
  const unmarked = await contextOf();
  assert.match(unmarked, /post-merge Step 4\.0b left parent record\(s\) open: #200 \(gh-failed, PR #14\)/);
  assert.doesNotMatch(unmarked, /post-merge steps failed/);

  // Step skips alone never read as a parent left open.
  seed({ postMergeRan: 1, postMergeStepSkips: [{ pr: 12, reason: 'unreadable-policy' }] });
  const skipsOnly = await contextOf();
  assert.doesNotMatch(skipsOnly, /left parent record/);
  assert.match(skipsOnly, /skipped step-wide, leaving no parent open \(nothing left to close\): unreadable-policy \(PR #12\)/);

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

- [ ] **Step 4: Implement the summary** in `hooks.js`: add the two fields per the Interfaces block, importing the helpers in the existing `require('./lib/reconcile/post-merge')` destructure (~1881). Comment that both lists read every entry carrying the fields, a `marker-write-failed` one included (Q5), quoting each element's raw `reason` and dropping its `detail`.

- [ ] **Step 5: Implement the render** in `session-start.js`, inside the existing try block, right after the `postMergeFailed` line (~363): require `parentsLeftOpenLine` and `stepSkipsLine` from `../reconcile/post-merge`, and push `parentsLeftOpenLine(s.postMergeParentsLeftOpen)` and then `stepSkipsLine(s.postMergeStepSkips)` when each is non-null. Neither depends on `postMergeFailed` or `postMergeRan`. Leave the failed line's text unchanged. Comment that the lines stand alone because a `marker-write-failed` entry is in neither count.

- [ ] **Step 6: Run the suites to verify they pass**

Run: `node --test tests/bin-lib/hooks/reconcile-background.test.js tests/hooks-session-start.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/hooks.js plugin/bin/lib/hooks/session-start.js tests/bin-lib/hooks/reconcile-background.test.js tests/hooks-session-start.test.js
git commit -m "Name the parents a background Step 4.0b left open at SessionStart — refs #4798"
```

### Task 4: The reconcile CLI summary reports parents left open and step skips

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/format-summary.js`: a new `formatPostMergeStep40bLines(result)` beside the other line formatters, its lines pushed in `formatSummary` (~227-262) right after the `CATEGORIES` loop
- Test: `tests/reconcile-dispatch.test.js`, after the `formatSummary: the failed row names the records …` test (pre-split `tests/reconcile.test.js` ~2255)

**Interfaces:**
- Consumes: Task 1's `parentsLeftOpen`, `stepSkipsOf`, `parentsLeftOpenLine` and `stepSkipsLine`, loaded on first use (`require('./post-merge')` inside the function, never at module load: the file's header at ~38-45 explains why).
- Produces: the same two lines SessionStart prints, in that order, each only when non-null, rendered when `result.postMerge` is an array, whatever the entries' actions or verdicts (Q5: a `marker-write-failed` entry is folded into the aggregated `skipped:` line, so these lines are the only place its fields show).

- [ ] **Step 1: Write the failing test** in `tests/reconcile-dispatch.test.js`

```js
test('formatSummary: parents left open and step skips render on their own lines, a marker-write-failed entry\'s included, never dropped (#4798)', () => {
  const base = { mirror: null, redTip: null, worktrees: null, claims: null, runs: null, branches: null, remoteBranches: null, console: null, skipped: null };
  const clean = { runDir: 'r1', pr: 12, action: 'ran', closingLinks: 'nothing-closed', parentsClosed: 0, stepSkips: [{ reason: 'unreadable-policy', detail: 'x' }] };
  const failed = { runDir: 'r2', pr: 13, action: 'ran', closingLinks: 'close-failed', parentsClosed: 0, stepSkips: [{ reason: 'internal-error' }] };
  const unmarked = { runDir: 'r3', pr: 14, action: 'skipped', reason: 'marker-write-failed', parentsClosed: 0, parentFailures: [{ parent: 200, reason: 'gh-failed' }] };
  assert.strictEqual(formatSummary({ ...base, postMerge: [clean, failed, unmarked] }), [
    'post-merge steps run: 1 merged run',
    'post-merge steps failed: 1 merged run',
    "post-merge Step 4.0b left parent record(s) open: #200 (gh-failed, PR #14) — tidy's parent-gate backstop recovers them",
    'post-merge Step 4.0b skipped step-wide, leaving no parent open (nothing left to close): unreadable-policy (PR #12), internal-error (PR #13)',
    'skipped: 1 merged run (marker-write-failed 1)',
  ].join('\n'));
  assert.strictEqual(formatSummary({ ...base, postMerge: [{ runDir: 'r4', pr: 15, action: 'ran', closingLinks: 'nothing-closed', parentsClosed: 0 }] }), 'post-merge steps run: 1 merged run');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-name-pattern="#4798" tests/reconcile-dispatch.test.js`
Expected: FAIL. Neither line is rendered.

- [ ] **Step 3: Implement** `formatPostMergeStep40bLines` in `format-summary.js`: return `[]` when `result.postMerge` is not an array, else `[parentsLeftOpenLine(parentsLeftOpen(pm)), stepSkipsLine(stepSkipsOf(pm))]` with the nulls dropped. Push its lines right after the `CATEGORIES` loop.

- [ ] **Step 4: Run the suites to verify they pass**

Run: `node --test tests/reconcile-dispatch.test.js tests/bin-lib/reconcile/post-merge.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/format-summary.js tests/reconcile-dispatch.test.js
git commit -m "Report Step 4.0b parents left open and step skips in the reconcile CLI summary — refs #4798"
```

### Task 5: End-to-end acceptance test and the surfacing docs

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tests/post-merge-parent-left-open-e2e.test.js`
- Modify: `docs/reconcile-checks.md`: the Post-merge closes `Surfacing` bullet (~730-770) and `Single-run path` bullet (~771-790), and the marker-write bullet (~690)
- Modify: `docs/journeys/close-a-below-floor-decomposition-parent-4466.md`: the SessionStart prior-pass `Should understand` bullet (~81)
- Modify: `docs/journeys/session-start-fast-background-reconcile.md`: step 3's `Action` (~42)

**Interfaces:**
- Consumes: Task 1's loop-entry `parentFailures`, Task 3's `postMergeParentsLeftOpen` and render, Task 4's CLI lines.

- [ ] **Step 1: Write the end-to-end test** `tests/post-merge-parent-left-open-e2e.test.js`. This is spec Decision Q1, and it carries AC1.1.
  - Fixture, built like `tests/bin-lib/reconcile/post-merge.test.js`'s `mainCheckout` + `addRun`: a `fs.realpathSync`'d temp dir with `git init -q`, `git remote add origin git@github.com:acme/w.git`, a `CLAUDE.md` holding `## Work records\n\nwork-backend: github-issues\n`, and a run dir `.claude-tweaks/pipelines/2026-10-30T090000-spec-1/run-state.json` = `{ status: 'in-progress', pr: { number: 11 } }`.
  - Stub `require('../plugin/bin/lib/reconcile').reconcile` (module-object stub, as `tests/bin-lib/hooks/reconcile-background.test.js`'s `backgroundSummaryFor` does) with an async function. It calls the real `postMerge({ cwd: root, prStates: { byNumberAsync: async () => ({ number: 11, state: 'MERGED', mergedAt: <now − 1 h ISO> }) }, now, deps: { gh: () => '', closingLinks, closeParents } })`, keeps the entries, and returns `{ postMerge: entries }`.
    - `closingLinks` is the in-process core's stand-in (#4781): it returns `{ code: 0, envelope: { action: 'nothing-closed', pr: 11, closingSet: [101], reopened: [], pendingClose: [], failed: [] } }`.
    - `closeParents` returns `{ closed: [], skipped: [{ parent: 100, reason: 'gh-failed', detail: 'HTTP 502' }] }`.
  - With `process.chdir(root)` and `process.stdout.write` silenced, run `require('../plugin/bin/hooks').main(['node', 'hooks.js', 'reconcile-background'])` and assert it returns 0. Restore cwd, stdout and the stub in `finally`.
  - Then `git remote remove origin` (SessionStart's inline FAST_CHECKS then do no network I/O), and run `require('../plugin/bin/lib/hooks/session-start').run({ input: {}, runDir: null, runState: null, cwd: root, superpowersDeps: { readFile: () => { throw Object.assign(new Error('no install (test)'), { code: 'ENOENT' }); } } })`.
  - Test name `AC1.1: a real postMerge run whose Step 4.0b hit gh-failed reaches SessionStart naming the parent, never as a clean ran (#4798)`. Assertions:
    - `entries[0].action === 'ran'`
    - `deepEqual(entries[0].parentFailures, [{ parent: 100, reason: 'gh-failed', detail: 'HTTP 502' }])`
    - `classifyEntry(entries[0]).verdict === 'failed'`
    - the status file's `summary.postMergeRan === 0`, `summary.postMergeFailed === 1`, and `deepEqual(summary.postMergeParentsLeftOpen, [{ pr: 11, parent: 100, reason: 'gh-failed' }])`
    - `additionalContext` matches `/post-merge steps failed for 1 merged run\(s\)/` and `/post-merge Step 4\.0b left parent record\(s\) open: #100 \(gh-failed, PR #11\) — tidy's parent-gate backstop recovers them/`, and does not match `/post-merge steps ran for/`
  - Remove the temp dir in `test.after`.

- [ ] **Step 2: Run it to verify it passes** (Tasks 1 and 3 already landed the behavior. The test's red state is proven by reverting: with Task 1's `processRun` change reverted it fails on `parentFailures`.)

Run: `node --test tests/post-merge-parent-left-open-e2e.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 3: Update `docs/reconcile-checks.md`**
  - Surfacing bullet: replace `(`parentFailures`; #4798 adds that field to loop entries, …)` with a sentence stating that a loop entry carries `parentFailures` when non-empty. Describe `postMergeParentsLeftOpen` and `postMergeStepSkips` (both read every entry carrying the fields, a `marker-write-failed` one included), then SessionStart's and the reconcile CLI's two lines, `post-merge Step 4.0b left parent record(s) open: #100 (gh-failed, PR #11), … — tidy's parent-gate backstop recovers them` with its three item forms and `post-merge Step 4.0b skipped step-wide, leaving no parent open (nothing left to close): …`, each printed whatever the entry's verdict. State the rule that routes any skip naming no parent and no record to `stepSkips` when the effective closing set (`closingSet` minus `closedAfterWindow`) is empty.
  - Marker-write bullet: add that a `marker-write-failed` entry from a Step 4.0b run keeps `parentFailures` and `stepSkips` (Q5).
  - Single-run bullet: replace `and `parentFailures`, `verdict`, `next` and `failedSteps` stay single-run` with a statement that a loop entry carries `parentFailures` only when non-empty and `stepSkips` (either path) only when non-empty, while `verdict`, `next` and `failedSteps` stay single-run.

- [ ] **Step 4: Update both journeys.** Add the Step 4.0b parent line after each quoted failed line (`post-merge Step 4.0b left parent record(s) open: #100 (gh-failed, PR #11) — tidy's parent-gate backstop recovers them`, "only when Step 4.0b left a parent open, a run whose marker write failed included"). Add the step-skip line, citing `#4798` beside the existing `#4599, #4897` citations.

- [ ] **Step 5: Verify the doc sweep**
  - `git grep -n -F "#4798 adds that field" -- docs plugin` → no output. Control: `git grep -n -F "#4798 adds that field" HEAD -- docs/reconcile-checks.md` matches line ~744 at plan time.
  - Wording sweep: `git grep -n -e "closed no sub-issue" -- plugin docs/reconcile-checks.md docs/journeys` → no output (Q3).
  - Behavior-change sweep: `git grep -n -e "postMergeOne only" -e "stay single-run" -e "carry none" -- plugin/bin docs/reconcile-checks.md docs/plugin-structure.md`. Every hit is either updated in this plan or classified below.
  - Run: `node --test tests/below-floor-parent-close-conformance.test.js tests/reconcile-dispatch.test.js tests/wrap-up-merge-mode-conformance.test.js`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/post-merge-parent-left-open-e2e.test.js docs/reconcile-checks.md docs/journeys/close-a-below-floor-decomposition-parent-4466.md docs/journeys/session-start-fast-background-reconcile.md
git commit -m "Pin the partial parent-close surfacing end to end and document it — refs #4798"
```

### Verification

Waived AC2.1: `npm test` passing is verified by `/claude-tweaks:build` Common Step 5 (the runner-backed full suite), not by a plan task.

### Scope sweep (plan audit Check B): classified no-change

- `docs/superpowers/plans/2026-11-02-background-post-merge-summary-4897.md` (Check B's one hit), plus other `docs/superpowers/plans/*` and `.claude-tweaks/pipelines/*/work/*-spec.md` files: historical plans and specs that quote `parentFailures`. They are not shipped.
- `plugin/skills/_shared/pr-first-merge-post-merge.md`: describes the in-session Step 4.0b, whose marker text is unchanged.
