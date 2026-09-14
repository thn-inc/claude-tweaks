# Archive-branches: confirm young squash-merged branches whose remote ref is gone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route a screen-`null`, cherry-`false` local branch into `archiveBranches`'s per-branch confirm regardless of its age, so a young squash-merged branch whose remote ref was already deleted (`gh pr merge --delete-branch`) converges on the first reconcile pass after its PR merges instead of waiting out the 14-day `BRANCH_AGE_DAYS` gate.

**Architecture:** `plugin/bin/lib/reconcile/archive-branches.js`'s per-branch loop already routes a MERGED-screened, non-cherry-equivalent branch to the per-branch confirm via a `squashCandidate` flag, bypassing the provisional-skip short-circuit. Widen that same flag's condition to also cover the screen-`null` case (the bulk screen's documented deleted-ref blind spot) — one boolean-expression change, no new control flow. A new fixture proves a *young* screen-null branch now reaches the confirm and deletes with reason `squash-merged`; existing fixtures (including the already-aged variant of this exact shape) must keep passing unchanged.

**Tech Stack:** Node.js (`node --test`), plain CommonJS module, no external test framework.

**Spec:** `.claude-tweaks/pipelines/2026-09-14T201743-record-2322/work/2322-spec.md` (materialized from GitHub issue #2322)

## Global Constraints

- Repo test runner is `node --test`, invoked against explicit file globs — a bare directory argument fails under Node 22 (`node --test tests/bin-lib/reconcile/*.test.js` form, never `node --test tests/bin-lib/reconcile/`).
- `ceremony: fast-lane`, `size: low`, `risk: low` (materialized header) — keep this to one task, one commit.
- Touch only the routing condition and its immediate surrounding comment in `archive-branches.js` — the file is dense and heavily commented; do not reformat or restructure anything else in it.
- Commit message must include `refs #2322` (never `closes`/`fixes` — this build runs inside an automated pipeline that manages issue-closing separately).

---

### Task 1: Widen `squashCandidate` to cover the screen-null confirm-routing gap

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-branches.js:220` (the `squashCandidate` assignment inside `archiveBranches()`'s per-branch loop)
- Modify: `docs/reconcile-checks.md` (the "Merged-proof for the two branch checks" section, lines 63-98)
- Test: `tests/bin-lib/reconcile/archive-branches.test.js`

**Interfaces:**
- Consumes: `decideArchive({ branch, tipAgeDays, cherryEquivalent, squashMerged, prState })` (existing, unchanged signature, same file) and `archiveBranches({ cwd, integration, dryRun, now, resolvePr, resolvePrBulk })` (existing, unchanged signature) — both already exported from `plugin/bin/lib/reconcile/archive-branches.js`.
- Produces: no new exports, no signature changes — this task only widens one internal boolean condition inside `archiveBranches()`'s loop body. Every existing caller (`plugin/bin/lib/reconcile/index.js`, `tests/bin-lib/reconcile/archive-branches.test.js`) is unaffected by signature.

- [ ] **Step 1: Write the failing test**

Open `tests/bin-lib/reconcile/archive-branches.test.js`. Find the existing test named `'archiveBranches: aged squash-merged branch screened null (deleted-ref blind spot) still deletes via squash provenance, no tag — F2'` (uses `makeSquashMergedRepo()`, a screen that returns `null` for the branch, `confirmMergedVia(squash)` for the per-branch confirm, and a `now: Date.now() + 30 * DAY` override to force the branch to read as aged). Add a new test directly after it, in the same style, but **without the age offset** — `makeSquashMergedRepo()`'s branch is only seconds old at creation time, well under the 14-day `BRANCH_AGE_DAYS` threshold, so omitting `now` alone is enough to make this the young-branch case:

```javascript
// The young counterpart to F2 above: no `now` override, so the branch's
// natural tip age (seconds, from makeSquashMergedRepo()) stays well under
// BRANCH_AGE_DAYS. Before this fix, a young screen-null branch's
// provisional verdict is 'skip' (reason 'too-young') and squashCandidate
// was false for a null screen, so it never reached the confirm at all —
// it read too-young forever, regardless of what actually merged. #2322.
test('archiveBranches: YOUNG squash-merged branch screened null (deleted-ref blind spot) still deletes via squash provenance on the first pass, no tag — #2322', () => {
  const { dir, squash } = makeSquashMergedRepo();
  let confirms = 0;
  const resolvePrBulk = () => new Map([['build/squashed', null]]); // screen blind spot
  const resolvePr = (...args) => { confirms += 1; return confirmMergedVia(squash)(...args); }; // confirm still carries mergeCommit
  const r = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk });
  const entry = r.entries.find((e) => e.name === 'build/squashed');
  assert.strictEqual(entry.action, 'delete');
  assert.strictEqual(entry.reason, 'squash-merged');
  assert.strictEqual(confirms, 1); // confirmed exactly once, even though it's young
  assert.strictEqual(git(dir, 'branch', '--list', 'build/squashed').trim(), ''); // really gone
  assert.strictEqual(git(dir, 'tag', '--list', 'archive/*').trim(), ''); // no archive tag for a proven merge
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/reconcile/archive-branches.test.js`
Expected: FAIL — the new test's assertion `entry.action === 'delete'` fails because today's code gives `entry.action === 'skip'` (reason `'too-young'`) for a young, screen-null branch: `squashCandidate` is `false` when `screenPr === null`, so the provisional `skip` short-circuits before the per-branch confirm ever runs, and `confirms` stays `0`.

- [ ] **Step 3: Implement the routing widening**

In `plugin/bin/lib/reconcile/archive-branches.js`, locate this block inside `archiveBranches()`'s per-branch loop (currently around line 212-221, immediately after the `provisional = decideArchive(...)` call for the non-OPEN-screened path):

```javascript
      // #2252: a MERGED-screened branch cherry could not prove is the
      // squash-merge shape. Its verdict is not final on screen evidence —
      // mergeCommit rides only on the per-branch confirm — so it joins the
      // destructive candidates below instead of skipping here. ROUTING only
      // (#2252 review F2): squashCandidate decides whether a provisional
      // skip proceeds to the confirm — it does NOT gate whether squashMerged
      // gets computed below. A screen-null branch (the deleted-ref blind
      // spot, e.g. after `gh pr merge --delete-branch`) already reaches the
      // confirm via the age-driven tag-and-delete provisional with
      // squashCandidate false; hardcoding squashMerged to false in that case
      // would discard the confirm's own MERGED-with-mergeCommit verdict and
      // skip the branch forever.
      const squashCandidate = !cherryEquivalent && Boolean(screenPr) && screenPr.state === 'MERGED';
      if (provisional.action === 'skip' && !squashCandidate) {
        entries.push({ name: branch, kind: 'branch', action: provisional.action, reason: provisional.reason });
        continue;
      }
```

Replace the comment and the `squashCandidate` line with (leaving the `if` guard beneath it untouched):

```javascript
      // #2252: a MERGED-screened branch cherry could not prove is the
      // squash-merge shape. Its verdict is not final on screen evidence —
      // mergeCommit rides only on the per-branch confirm — so it joins the
      // destructive candidates below instead of skipping here. ROUTING only
      // (#2252 review F2): squashCandidate decides whether a provisional
      // skip proceeds to the confirm — it does NOT gate whether squashMerged
      // gets computed below.
      // #2322: widened to also cover the screen-null case. A screen-null
      // branch (the deleted-ref blind spot, e.g. after `gh pr merge
      // --delete-branch`) previously reached the confirm only once aged past
      // BRANCH_AGE_DAYS, via the age-driven tag-and-delete provisional — a
      // YOUNG screen-null branch's provisional is 'skip' (reason
      // 'too-young') with the old squashCandidate: false, so it never
      // reached the confirm at all and read too-young on every pass
      // regardless of what had actually merged. Treating screenPr === null
      // as a candidate too closes that gap: the confirm below still makes
      // the final call (nothingLanded stays true, and the age rules still
      // apply, if the confirm itself comes back null/CLOSED/OPEN) — this
      // only widens which branches get a confirm, never what the confirm
      // decides.
      const squashCandidate = !cherryEquivalent && (screenPr === null || screenPr.state === 'MERGED');
      if (provisional.action === 'skip' && !squashCandidate) {
        entries.push({ name: branch, kind: 'branch', action: provisional.action, reason: provisional.reason });
        continue;
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/reconcile/archive-branches.test.js`
Expected: PASS — every test in the file, including the new one and the pre-existing F2 (aged) variant.

- [ ] **Step 5: Update the docs**

In `docs/reconcile-checks.md`, in the "Merged-proof for the two branch checks" section (starts at the `## Merged-proof for the two branch checks` heading), add one paragraph after the existing numbered list (after the sentence ending "...never falsely proven." through the `merge-tree --write-tree` sentence — i.e., after point 2's full text, before the "Both proofs judge the **local** integration ref..." paragraph):

```markdown
**Confirm-routing symmetry (#2322).** `archive-branches.js`'s per-branch confirm — the only place `mergeCommit` becomes available for the squash-provenance check above — is reached by any non-cherry-equivalent branch whose bulk screen read `MERGED` *or* `null`. The `null` case is the bulk screen's documented deleted-ref blind spot (`pr-state.js`'s header): a branch whose remote ref `gh pr merge --delete-branch` already removed. Routing both shapes into the same confirm means a young squash-merged branch in that blind spot converges on the first pass after its PR merges, at the cost of one extra `gh pr list --head` call per screen-null, non-cherry-equivalent branch per pass — the same per-branch cost the MERGED-screened routing already pays, now paid symmetrically rather than only after the branch ages past `BRANCH_AGE_DAYS` (14 days).
```

- [ ] **Step 6: Run the full check suite to confirm no regressions**

Run: `node --test tests/bin-lib/reconcile/archive-branches.test.js tests/bin-lib/reconcile/*.test.js`
Expected: PASS — every archive-branches and sibling reconcile-check test still green (this widening only affects the `screenPr === null` branch of `squashCandidate`; every existing test either supplies a non-null screen or already exercised the null-screen path in a way this change doesn't alter — the age-driven `tag-and-delete` route for an aged screen-null branch is untouched, and every OPEN/MERGED-screened test path is untouched).

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-branches.js docs/reconcile-checks.md tests/bin-lib/reconcile/archive-branches.test.js
git commit -m "reconcile: route screen-null branches into archive-branches confirm regardless of age

A young squash-merged local branch whose remote ref was already deleted
(gh pr merge --delete-branch) screened null and read too-young on every
pass until it aged past BRANCH_AGE_DAYS (14d), even once its PR had
merged. Widen squashCandidate to also treat screenPr === null as a
confirm candidate, symmetric with the existing MERGED-screened routing —
the confirm's own MERGED-with-mergeCommit verdict now converges the
branch on the first pass after merge.

refs #2322"
```

## Self-Review

- **Spec coverage:** Deliverable 1 (route `screenPr === null && !cherryEquivalent` to the confirm) — Step 3. Deliverable 2 (fixture: young two-commit branch, squash-merged, screen null, confirm MERGED with mergeCommit → delete squash-merged) — Step 1. Deliverable 3 (document the posture in `docs/reconcile-checks.md`'s Merged-proof section) — Step 5. Acceptance criterion 1 (young branch converges on first pass) — proven by the new test (Step 1/4). Acceptance criterion 2 (every pre-existing fixture keeps passing) — Step 4/6 runs the full file. Acceptance criterion 3 (confirm count for non-candidates doesn't grow) — every existing test that asserts a `confirmCalls`/`confirms` count (e.g. the screen-then-confirm section) exercises branches whose `screenPr` is non-null-and-non-MERGED or cherry-equivalent, none of which this widening touches (`squashCandidate` only changes for `screenPr === null && !cherryEquivalent`, which was never a "non-candidate" the AC is protecting — it's exactly the gap being closed).
- **Placeholder scan:** none — every step carries literal code/commands.
- **Type consistency:** `squashCandidate` stays a plain boolean; no new function signatures introduced.
