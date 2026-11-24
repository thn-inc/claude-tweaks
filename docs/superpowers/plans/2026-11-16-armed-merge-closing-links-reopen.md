# Armed-Merge Closing-Links Reopen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove with end-to-end tests that the reconciler's existing `post-merge` check reopens a kept-open (`Refs`) record an armed merge closed, and remove the stale "gap" caveat from Step 4.0's prose.

**Architecture:** The reconcile convergence check the record asks for already exists. #4599 added `plugin/bin/lib/reconcile/post-merge.js`, which runs `_shared/pr-first-merge-post-merge.md` Step 4.0 (`closingLinks()` in post-merge mode, `CLOSE_WINDOW_MS` = 10 min) and Step 4.0b once for every merged run with a recorded PR and no marker. `closing-links.js`'s post-merge candidates are `linked` (`closingIssuesReferences`, Development-sidebar links included) plus `keepOpen` (the fixes span's `Refs` records), minus `Fixes`. This plan adds no second check. It pins that path end to end with the real `closingLinks` core and a fake `gh`, then corrects the prose and its conformance pin.

**Tech Stack:** Node 20 (CI), `node --test`, no external deps.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T190414-record-4251/work/4251-spec.md` (rescoped by the record's Reading A decision; this plan already implements it)

**Scope keywords:** Development-sidebar, gap tracked in the run's ledger

## Global Constraints

- Commit style: `{Verb} {what} — {detail}`, body carries `refs #4251` (never `closes`/`fixes`).
- Run test files singly: `node --test <file>`; never a multi-file `node --test` invocation.
- `plugin/skills/_shared/pr-first-merge-post-merge.md` is 22,018 B against `RAIL_BYTES` 52,500 B — ~30 KB headroom; this plan changes it by under 200 B.
- Project skill `skill-prose-conformance-tests` governs Task 2's conformance pin: the new assertion must be shown to go red against the pre-change text (prove by reverting the prose edit and re-running).
- Scope and edit discipline (CLAUDE.md Working Approach): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Review Focus

- A `Refs` record a human closed hours after the merge (outside `CLOSE_WINDOW_MS`) must stay closed. The CLI already pins this in `tests/bin-lib/flow/closing-links-cli.test.js`; Task 1 covers only the reconcile-driven reopen and adds no new code.
- A second reconcile pass after a reopen must make no `gh` call. Task 1's AC1.1 test also asserts this (the marker is written).
- `parentsClosed: 0` in AC1.1 is an envelope fact only (the world has no parent); the core pins that a reopened record leaves `closingSet` in `tests/bin-lib/flow/closing-links-cli.test.js`.

---

### Task 1: End-to-end reconcile tests for the Refs reopen (AC1, AC2)

**Role:** integration

**Files:**
- Test: `tests/bin-lib/reconcile/post-merge.test.js` (add a helper + two tests after the `AC4.1 #4549 end to end` test, ~line 1419)
- Waived `plugin/bin/closing-links.js`: read only (reused unchanged; mutated temporarily for the go-red proof, then restored)
- Waived `docs/reconcile-checks.md`: edited in Task 2

**Interfaces:**
- Consumes: `postMerge({ cwd, now, prStates, deps: { gh } })`, `MARKER_STEP`, `CLOSE_WINDOW_MS`, the existing helpers `mainCheckout`, `addRun`, `entriesOf`, `decisionsOf`, `NOW`, `now`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write a world helper `refsWorld({ refs, closedAtOffsetMs, parent })`**

Model it on `e2eWorld` (do not change `e2eWorld`). Fixed values: PR 11, `mergedAt = NOW - 60 min`, run marker `<!-- claude-tweaks-run: 2026-10-30T090000-spec-101 -->`, fixes block `Fixes #101` plus one `Refs #N — kept open` line per `refs` entry, `closingIssuesReferences` = `[101, ...refs]` (the refs as sidebar links), `baseRefName: 'main'`, default branch `main`, merge commit `abcdef1` whose message names only `Fixes #101`. Issue states: 101 `CLOSED` with `closedAt` = mergedAt + 2 s; each ref `CLOSED` with `closedAt` = mergedAt + `closedAtOffsetMs` until an `issue reopen N` call, then `OPEN`. GraphQL parent lookup returns `parent: parent ? { number: parent } : null`. Throw `unexpected gh call: {key}` on anything else, so an unplanned call fails the test loudly. Return `{ gh, calls, mergedAt }`. A checkout helper writes `policy.yml` `risk-floor: high\nwork-links: native\n` and adds run `2026-10-30T090000-spec-101` with `status: 'clean'` (reuse `e2eCheckout`).

- [ ] **Step 2: Write the AC1 test**

```js
test('AC1.1 #4251 end to end: an armed merge closed a kept-open Refs record through a sidebar link — the late Step 4.0 reopens it and logs it, then writes the marker', async () => {
  const { root, dir } = e2eCheckout();
  const world = refsWorld({ refs: [103], closedAtOffsetMs: 2000, parent: null });
  const r = await e2ePass(root, world);
  assert.deepEqual(r.entries.map((e) => [e.runDir, e.pr, e.action, e.closingLinks, e.parentsClosed]), [[dir, 11, 'ran', 'reopened', 0]]);
  assert.ok(world.calls.some((c) => /^issue reopen 103 --comment /.test(c.key)), 'the Refs record is reopened');
  assert.match(decisionsOf(dir), /^- AUTO \d{2}:\d{2}:\d{2} — Closing links: reopened #103 after PR #11's merge closed it/m);
  assert.equal(entriesOf(dir).at(-1).location, MARKER_STEP, 'the marker is written last');
  const before = world.calls.length;
  assert.deepEqual(await e2ePass(root, world), { entries: [], deferred: [] });
  assert.equal(world.calls.length, before, 'a second pass makes no gh call');
});
```

Adjust only the parts the real envelope proves different (e.g. a `records` field on the entry), never the four facts asserted: reopen call, `closingLinks: 'reopened'`, the `reopened #103` AUTO line, the marker.

- [ ] **Step 3: Write the AC2 test**

```js
test('AC2.1 #4251 end to end: a run whose fixes span has no Refs record makes no gh issue call', async () => {
  const { root, dir } = e2eCheckout();
  const world = refsWorld({ refs: [], closedAtOffsetMs: 2000, parent: null });
  const r = await e2ePass(root, world);
  assert.deepEqual(r.entries.map((e) => [e.action, e.closingLinks]), [['ran', 'nothing-closed']]);
  assert.deepEqual(world.calls.filter((c) => /^issue /.test(c.key)).map((c) => c.key), []);
  assert.equal(entriesOf(dir).at(-1).location, MARKER_STEP);
});
```

If Step 4.0b's native parent path makes a `gh issue` call for a parentless record, STOP and report NEEDS_CONTEXT naming the call. Never narrow the assertion to closing-links' calls on your own.

- [ ] **Step 4: Run and confirm both pass**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js`
Expected: PASS, all tests (the two new ones included).

- [ ] **Step 5: Prove both tests discriminate (scratch, uncommitted)**

1. In `plugin/bin/closing-links.js` (~line 420), change `const candidates = uniqueSorted([...linked, ...keepOpen].filter(...))` so it drops `103` from the candidates (for example, `.filter((x) => x !== 103)`). Re-run the file; AC1.1 must FAIL. Restore the line.
2. In the same place, temporarily add a `deps.gh(['issue', 'view', '999', '--json', 'state,closedAt'])` call that runs whenever `candidates` is empty. Re-run; AC2.1 must FAIL. Restore it.
3. Confirm the restore with `git diff -- plugin/bin/closing-links.js`, which must print nothing. Quote the FAIL lines in your report.

- [ ] **Step 6: Commit**

```bash
git add tests/bin-lib/reconcile/post-merge.test.js
git commit -m "Pin the reconciler's late Refs reopen end to end — refs #4251"
```

### Task 2: Drop the stale gap caveat and record the coverage in the docs (deliverable 2)

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md:33-36` (Step 4.0)
- Modify: `docs/reconcile-checks.md:598-606` (`## Post-merge closes (#4599)` intro)
- Test: `tests/below-floor-parent-close-conformance.test.js:379-396`

**Interfaces:**
- Consumes: none.
- Produces: none.

- [ ] **Step 1: Update the conformance pin first (it should fail)**

In the test `#4599: Step 4.0 says the reconciler's post-merge check runs the CLI for an armed merge`:
- Change the long `body.includes(...)` literal so that it ends `... with no settle poll and reopens bounded to 10 minutes after \`mergedAt\`, so it also reopens a kept-open record (a \`Refs\` record, or one a Development-sidebar link names) that the merge closed (#4251).` in place of the `; with \`--keep-open\` on the composer,` tail.
- Replace line 392's assertion with `assert.ok(!body.includes("a gap tracked in the run's ledger"), 'the sidebar-link gap caveat is gone (#4251)');`.

Run: `node --test tests/below-floor-parent-close-conformance.test.js`
Expected: FAIL in that one test (the new literal is absent and the caveat is still present).

- [ ] **Step 2: Edit Step 4.0's prose**

In `plugin/skills/_shared/pr-first-merge-post-merge.md`, replace

```
with no settle poll and reopens bounded to 10 minutes after `mergedAt`; with `--keep-open` on the composer, only a
Development-sidebar link can still close a kept-open record there, a gap tracked in the run's ledger.
```

with

```
with no settle poll and reopens bounded to 10 minutes after `mergedAt`, so it also reopens a kept-open record (a `Refs` record, or one a Development-sidebar link names) that the merge closed (#4251).
```

Mechanism behind the claim (behavioral-claim check): `closing-links.js` step 6b, `candidates = uniqueSorted([...linked, ...keepOpen])`, where `linked` comes from `closingIssuesReferences` and `keepOpen` from the span's `Refs` lines. Task 1's AC1.1 test runs that path.

- [ ] **Step 3: Add one sentence to `docs/reconcile-checks.md`**

At the end of the `## Post-merge closes (#4599)` intro paragraph (after "...every fail-open path below leaves the parent open for it."), add: `The late Step 4.0 also reopens a kept-open record the merge closed (a fixes-span \`Refs\` record, or one only a Development-sidebar link names), within the same 10-minute window, so an armed merge leaves no closing channel unchecked (#4251).`

- [ ] **Step 4: Run and confirm green; prove the pin is real**

Run: `node --test tests/below-floor-parent-close-conformance.test.js`
Expected: PASS.
Run: `node --test tests/closing-links-prose-conformance.test.js`
Expected: PASS (it pins other Step 4.0 sentences).
Go-red proof (scratch): `git show HEAD:plugin/skills/_shared/pr-first-merge-post-merge.md` holds the old text. Temporarily restore the old two lines, re-run the conformance file and confirm FAIL, then re-apply the edit.

Absence control (run once and record): `git grep -n -F "a gap tracked in the run's ledger" HEAD -- plugin docs tests` must match `plugin/skills/_shared/pr-first-merge-post-merge.md:36` before the commit. After the commit, `git grep -n -F "a gap tracked in the run's ledger" -- plugin docs` must print nothing.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge-post-merge.md docs/reconcile-checks.md tests/below-floor-parent-close-conformance.test.js
git commit -m "Drop Step 4.0's sidebar-link gap caveat — the reconciler's late run reopens kept-open records (refs #4251)"
```

## Spec coverage

| Spec item | Covered by |
|---|---|
| Deliverable 1 (end-to-end tests pinning the shipped `post-merge` reopen) | Task 1 |
| Deliverable 2 (remove the caveat) | Task 2 |
| Deliverable 3 (docs sentence) | Task 2 Step 3 |
| AC1.1 (fake gh, merged PR, Refs record closed after mergedAt, reopened + decisions line); AC1.2 (same with no sidebar link) | Task 1 Step 2 |
| AC2.1 (no Refs record → no `gh issue` call) | Task 1 Step 3 |
