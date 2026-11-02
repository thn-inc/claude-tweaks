# Partial Step 4.0b Parent-Close Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reconcile post-merge run whose Step 4.0b left a parent open (a `gh-failed`, `internal-error`, or other non-deliberate skip) stops counting as a clean `ran`, and the next SessionStart names the parent left open.

**Architecture:** `plugin/bin/lib/reconcile/post-merge.js` already computes `parentFailures` (Step 4.0b's non-deliberate skips) but only attaches it for the single-run path (`includeRecords`, `postMergeOne`). Attach it to every `ran` entry Step 4.0b ran for, the reconcile loop's included. `plugin/bin/hooks.js`'s `reconcile-background` summary then splits `ran` entries into clean and partial (non-empty `parentFailures`), and `plugin/bin/lib/hooks/session-start.js` renders the partial runs with each parent named.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T065212-record-4798/work/4798-spec.md`

Scope keywords: parentFailures, postMergeRan, postMergeParentsClosed

## Global Constraints

- Verbatim from the spec's Acceptance Criteria: "A test drives Step 4.0b to a `gh-failed` skip and asserts the entry is not a clean `ran` and that the SessionStart summary names the parent." / "`npm test` passes."
- Verbatim (project CLAUDE.md Working Approach): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Hooks never break a session (`docs/hooks.md`): the SessionStart rendering stays inside its existing `try { … } catch { /* best-effort */ }` block, and every new summary field is read through a type guard, so a status file written by an older build (no new fields) renders exactly what it renders today.
- Governing skill `driver-skill-outcome-taxonomy` (applicable row, quoted): "Have the engine classify its own outcome, route the prose only on that field, and quote the raw word in the report." — the partial/clean split is decided in code (`hooks.js`'s summary), never in skill prose; the rendered line quotes each raw skip `reason`.
- `hooks-js-verb-registration` does not apply: no verb or flag is added to `hooks.js`. `bin-source-scan-conformance`, `gh-api-module-pattern`, `prose-code-twin-pin`: no source scan, no new `gh`/`git` call, no prose pinned by a test changes — none apply.
- `postMergeOne`'s entry shape is unchanged (it already carries `parentFailures`); `classifyEntry` is unchanged. `bin/post-merge-run.js`'s documented output is unchanged.
- Commit subjects: `{Verb} {what} — {detail}`, referencing the record as `refs #4798` (never `closes`/`fixes`).

## Review Focus

1. A partial run that closed some parents and failed others: its closes must still appear at SessionStart (they are excluded from `postMergeRan`'s closes, so they ride on the partial line) — Task 2 test `partial closes ride on the partial line`.
2. A status file from a build before this change (no `postMergePartial`/`postMergeParentsLeftOpen`) must render no new text and no error — Task 2 SessionStart test's legacy seed.
3. A step-wide skip (`unreadable-policy`, `invalid-risk-floor`: no `parent`, no `issue`) must still render a readable target — Task 2 renders it as `every parent`.
4. Only deliberate skips (`above-floor`, `sibling-unsettled`, …) must keep the run a clean `ran` counted in `postMergeRan` — Task 1 (`parentFailures: []`) and Task 2 summary test.
5. A `step40Failed` entry (Step 4.0b never ran) must never be counted partial — Task 2 summary test.

---

### Task 1: Carry `parentFailures` on every reconcile-loop `ran` entry

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/reconcile/post-merge.js` (lines 475-478 header comment, 587-598 `parentFailures` construction)
- Modify: `docs/reconcile-checks.md` (Single-run path bullet, ~lines 741-744: `parentFailures` is no longer single-run-only)
- Test: `tests/bin-lib/reconcile/post-merge.test.js`

**Interfaces:**
- Produces: every `ran` entry from `postMerge` (and `postMergeOne`) for which Step 4.0b ran carries `parentFailures: Array<{ parent?: number, issue?: number, reason: string, detail?: string }>` — `[]` when every skip was deliberate. A `ran` entry from the no-closing-set branch (Step 4.0b never ran, incl. `step40Failed`) carries no `parentFailures` key. `marker-write-failed` skipped entries are unchanged. Task 2 reads `entry.parentFailures`.

- [ ] **Step 1: Write the failing test** in `tests/bin-lib/reconcile/post-merge.test.js`

```js
test('AC1.1: a gh-failed Step 4.0b skip in the reconcile loop is recorded on the entry, which is not a clean ran', async () => {
  const root = mainCheckout();
  addRun(root, '2026-10-30T090000-spec-1');
  const r = await run(root, {
    prs: { 11: merged() }, links: fakeClosingLinks(ENVELOPE),
    close: fakeCloseParents({ closed: [], skipped: [{ parent: 100, reason: 'gh-failed', detail: 'HTTP 502' }] }),
  });
  assert.equal(r.entries[0].action, 'ran');
  assert.deepEqual(r.entries[0].parentFailures, [{ parent: 100, reason: 'gh-failed', detail: 'HTTP 502' }]);
  assert.deepEqual(classifyEntry(r.entries[0]), { verdict: 'failed', next: 'none', failedSteps: ['4.0b'] });
});
```

Also change the existing `I1: postMergeOne lists Step 4.0b failures …; postMerge entries carry none` test: rename to `I1: postMergeOne and postMerge entries both list Step 4.0b failures in parentFailures; a deliberate policy skip is not one`, and replace its last assertion `assert.ok(!('parentFailures' in loop.entries[0]));` with `assert.deepEqual(loop.entries[0].parentFailures, entry.parentFailures);`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="AC1.1|I1: postMergeOne and postMerge" tests/bin-lib/reconcile/post-merge.test.js`
Expected: FAIL — `parentFailures` is `undefined` on the loop entry.

- [ ] **Step 3: Implement** in `processRun`: build the `parentFailures` object unconditionally (drop the `includeRecords ?` gate on it; `recordsOf` keeps its gate). Update the comments at lines 475-478 and 587 so they no longer say `parentFailures` is postMergeOne-only.

- [ ] **Step 4: Update the exact-shape loop assertions Step 3 widens** — add `parentFailures` to each `ran` entry literal where Step 4.0b ran (a closing-set envelope): `parentFailures: []` at the `deepEqual` assertions currently at lines ~994 (`M6 end to end`), ~1015 (`M6 end to end (I1)`), ~1026 and ~1043 (`#4549 end to end` ×2); and at ~712 (`an unreadable policy.yml skips Step 4.0b fail-closed`) the step-wide failure `parentFailures: [{ reason: 'unreadable-policy', detail: '.claude-tweaks/policy.yml: EISDIR' }]` — the same value the I1 test already asserts for `postMergeOne`. Leave literals for the no-closing-set branch (`step40Failed`, `not-merged`, lines ~448/465/493/524/618/624) and `marker-write-failed` (~759/773) unchanged. Find any other with `grep -n "action: 'ran'" tests/bin-lib/reconcile/post-merge.test.js`.

- [ ] **Step 5: Run the suite to verify it passes**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js tests/post-merge-run-cli.test.js tests/reconcile.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Update `docs/reconcile-checks.md`'s Single-run path bullet** so it no longer implies `parentFailures` is single-run-only: `records`, `logFailed`, `verdict`/`next` and `failedSteps` stay single-run; `parentFailures` is on every `ran` entry Step 4.0b ran for, both paths.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/reconcile/post-merge.js tests/bin-lib/reconcile/post-merge.test.js docs/reconcile-checks.md
git commit -m "Carry parentFailures on every reconcile post-merge ran entry — refs #4798"
```

### Task 2: Count and surface partial runs in the background summary and SessionStart

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/hooks.js` (`reconcile-background` summary, lines ~1873-1891)
- Modify: `plugin/bin/lib/hooks/session-start.js` (prior-pass post-merge lines, ~337-350)
- Modify: `docs/reconcile-checks.md` (Surfacing bullet, ~lines 717-731)
- Test: `tests/bin-lib/hooks/reconcile-background.test.js`
- Test: `tests/hooks-session-start.test.js`

**Interfaces:**
- Consumes: Task 1's `entry.parentFailures` on `ran` entries.
- Produces (status-file `summary` fields; `session-start.js` reads them):
  - `postMergeRan`: `ran` entries with no `step40Failed` and no non-empty `parentFailures` (narrowed from today).
  - `postMergeParentsClosed`: closes by those clean runs only (narrowed from all `ran`).
  - `postMergePartial: number` — `ran` entries with no `step40Failed` and a non-empty `parentFailures`.
  - `postMergePartialParentsClosed: number` — `parentsClosed` summed over those partial runs.
  - `postMergeParentsLeftOpen: Array<{ pr: number, parent?: number, issue?: number, reason: string }>` — one element per `parentFailures` element of each partial run, in entry order (`detail` dropped).
  - `postMergeFailed`, `postMergeUnmarkedParentsClosed` unchanged.

- [ ] **Step 1: Write the failing summary test** in `tests/bin-lib/hooks/reconcile-background.test.js`

```js
test('AC1.1: a ran entry whose Step 4.0b left a parent open is counted partial, never ran, and names the parent (#4798)', async () => {
  const summary = await backgroundSummaryFor({
    postMerge: [
      { runDir: '/r/a', pr: 1, action: 'ran', closingLinks: 'closed', parentsClosed: 1, parentFailures: [] },
      { runDir: '/r/b', pr: 2, action: 'ran', closingLinks: 'closed', parentsClosed: 2, parentFailures: [{ parent: 100, reason: 'gh-failed', detail: 'HTTP 502' }, { issue: 103, reason: 'internal-error' }] },
      { runDir: '/r/c', pr: 3, action: 'ran', closingLinks: 'nothing-closed', parentsClosed: 0, parentFailures: [{ reason: 'unreadable-policy' }] },
      { runDir: '/r/d', pr: 4, action: 'ran', closingLinks: 'exit 5', parentsClosed: 0, step40Failed: true },
    ],
  });
  assert.equal(summary.postMergeRan, 1);
  assert.equal(summary.postMergeParentsClosed, 1, 'partial runs\' closes are not credited to the clean runs');
  assert.equal(summary.postMergePartial, 2);
  assert.equal(summary.postMergePartialParentsClosed, 2);
  assert.equal(summary.postMergeFailed, 1, 'a step40Failed entry is never partial');
  assert.deepEqual(summary.postMergeParentsLeftOpen, [
    { pr: 2, parent: 100, reason: 'gh-failed' },
    { pr: 2, issue: 103, reason: 'internal-error' },
    { pr: 3, reason: 'unreadable-policy' },
  ]);
});
```

Extend the existing `counts post-merge runs …` test's empty-input loop to also assert `none.postMergePartial === 0`, `none.postMergePartialParentsClosed === 0`, `deepEqual(none.postMergeParentsLeftOpen, [])`.

- [ ] **Step 2: Write the failing SessionStart test** in `tests/hooks-session-start.test.js`, beside the `#4599` post-merge test

```js
test('AC1.1: SessionStart names the parents a prior pass\'s Step 4.0b left open (#4798)', async () => {
  const project = gitProject();
  fs.mkdirSync(path.join(project, '.claude-tweaks'), { recursive: true });
  const statusPath = path.join(project, '.claude-tweaks', 'reconcile-background-status.json');
  const seed = (summary) => fs.writeFileSync(statusPath, JSON.stringify({ completedAt: Date.now(), surfaced: false, summary }));

  seed({ postMergeRan: 1, postMergeParentsClosed: 1, postMergePartial: 2, postMergePartialParentsClosed: 0, postMergeParentsLeftOpen: [
    { pr: 11, parent: 100, reason: 'gh-failed' }, { pr: 11, issue: 103, reason: 'internal-error' }, { pr: 12, reason: 'unreadable-policy' },
  ] });
  const out = await runSessionStart({ input: {}, runDir: null, runState: null, cwd: project });
  assert.match(
    out.json.hookSpecificOutput.additionalContext,
    /post-merge steps ran for 1 merged run\(s\), closing 1 parent record\(s\) below the oversight floor; post-merge Step 4\.0b left parent record\(s\) open in 2 merged run\(s\): #100 \(gh-failed, PR #11\), the parent of record #103 \(internal-error, PR #11\), every parent \(unreadable-policy, PR #12\) \(tidy's parent-gate backstop recovers them\)\./,
  );

  // partial closes ride on the partial line
  seed({ postMergeRan: 0, postMergePartial: 1, postMergePartialParentsClosed: 2, postMergeParentsLeftOpen: [{ pr: 11, parent: 100, reason: 'gh-failed' }] });
  const withCloses = await runSessionStart({ input: {}, runDir: null, runState: null, cwd: project });
  assert.match(withCloses.json.hookSpecificOutput.additionalContext, /left parent record\(s\) open in 1 merged run\(s\), after closing 2 below the oversight floor: #100 \(gh-failed, PR #11\)/);
  assert.doesNotMatch(withCloses.json.hookSpecificOutput.additionalContext, /steps ran for/);

  // a status file from before #4798 (no partial fields) renders nothing new
  seed({ postMergeRan: 1, postMergeParentsClosed: 0 });
  const legacy = await runSessionStart({ input: {}, runDir: null, runState: null, cwd: project });
  assert.doesNotMatch(legacy.json.hookSpecificOutput.additionalContext, /left parent record/);
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `node --test --test-name-pattern="AC1.1" tests/bin-lib/hooks/reconcile-background.test.js tests/hooks-session-start.test.js`
Expected: FAIL — `summary.postMergePartial` is `undefined`; no `left parent record(s) open` text.

- [ ] **Step 4: Implement the summary** in `plugin/bin/hooks.js`: a `leftOpen(e)` predicate (`e.action === 'ran' && !e.step40Failed && Array.isArray(e.parentFailures) && e.parentFailures.length > 0`); `postMergeRan` and `postMergeParentsClosed` filter clean runs (`action === 'ran' && !step40Failed && !leftOpen(e)`); add the three new fields per the Interfaces block. Update the surrounding comments.

- [ ] **Step 5: Implement the render** in `plugin/bin/lib/hooks/session-start.js`, right after the unmarked-closes line and before the `postMergeFailed` line, inside the existing try block. Render only when `Number.isInteger(s.postMergePartial) && s.postMergePartial > 0 && Array.isArray(s.postMergeParentsLeftOpen)`. Exact copy:
  - line: `` `post-merge Step 4.0b left parent record(s) open in ${n} merged run(s)${closed ? `, after closing ${closed} below the oversight floor` : ''}: ${items.join(', ')} (tidy's parent-gate backstop recovers them)` `` where `closed` is `s.postMergePartialParentsClosed` when an integer, else 0
  - item with `parent`: `` `#${parent} (${reason}, PR #${pr})` ``; with `issue`: `` `the parent of record #${issue} (${reason}, PR #${pr})` ``; neither: `` `every parent (${reason}, PR #${pr})` ``. Skip a non-object element.

- [ ] **Step 6: Run the suites to verify they pass**

Run: `node --test tests/bin-lib/hooks/reconcile-background.test.js tests/hooks-session-start.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 7: Update `docs/reconcile-checks.md`'s Surfacing bullet**: `postMergeRan` and `postMergeParentsClosed` now exclude partial runs; describe `postMergePartial`, `postMergePartialParentsClosed`, `postMergeParentsLeftOpen` and the rendered `post-merge Step 4.0b left parent record(s) open in N merged run(s)…` line. Behavior-change sweep: `git grep -n -e postMergeRan -e postMergeParentsClosed -e "steps ran for" -- plugin docs` — every hit other than code/tests changed here is either updated or classified no-change in the commit message.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/hooks.js plugin/bin/lib/hooks/session-start.js tests/bin-lib/hooks/reconcile-background.test.js tests/hooks-session-start.test.js docs/reconcile-checks.md
git commit -m "Surface partial Step 4.0b parent closes at SessionStart — refs #4798"
```

### Verification

Waived AC2.1: `npm test` passing is verified by `/claude-tweaks:build` Common Step 5 (the runner-backed full suite), not a plan task.

### Scope sweep (plan audit Check B) — classified no-change

- `docs/plugin-structure.md` — documents `bin/post-merge-run.js`'s single-run output, whose shape this plan does not change (`parentFailures` was already on every `postMergeOne` `ran` entry Step 4.0b ran for).
- `plugin/bin/post-merge-run.js` — the single-run CLI; prints `postMergeOne`'s entry, unchanged.
- `plugin/skills/wrap-up/merge-mode.md` — routes the single-run entry's `verdict`/`failedSteps`/`parentFailures`, all unchanged.
- `tests/wrap-up-merge-mode-conformance.test.js` — pins `merge-mode.md`'s prose, unchanged.
