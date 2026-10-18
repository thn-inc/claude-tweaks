# Reconciler Merged-PR Closing Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `releaseMerged` release a claim on merged-PR evidence only when the merged PR actually closes that claim's issue, so a multi-record run whose PR merges with some records unshipped keeps the unshipped records' claims and grants.

**Architecture:** `pr-state.js`'s PR-state join starts carrying `closingIssuesReferences` (one `--json` field on every resolver). `release-merged.js` gains a pure `prClosesIssue` check (closing references by number plus repository, or a line-anchored GitHub closing keyword in the merge commit message), a fourth `closesIssue` argument on `decideRelease`/`needsIssueEvidence` with two new skip reasons, and one pooled merge-commit-message fetch (Phase 1.75) for MERGED candidates the references do not already settle. Grant stripping stays keyed on a `merged:` reason, so a kept claim strips nothing.

**Tech Stack:** Node 18+ CommonJS modules under `plugin/bin/lib/reconcile/`; `node --test` suites under `tests/bin-lib/reconcile/` using the existing `gh`-wrapper-on-PATH and injectable `ghApi(args)` fake techniques.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T192303-spec-3412/work/3412-spec.md` (record #3412)

**Scope keywords:** decideRelease, needsIssueEvidence, PR_LIST_ARGS, closingIssuesReferences

## Global Constraints

- Fail closed: a MERGED PR whose parsed state has no `closingIssuesReferences` array never releases on merged evidence (spec AC4).
- Match closing references on `number` AND `repository.owner.login/name === repoSlug`, never on number alone (spec Gotchas).
- Closing keywords are GitHub's set, case-insensitive, line-anchored: `close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved` followed by `#N`. `Refs #N` never matches (spec Technical Approach 2).
- Skip reasons are exactly `pr-merged-not-closing` (references present, no match) and `pr-merged-closing-unknown` (no references array) (spec Technical Approach 3).
- The merge-commit fetch runs through the module's existing `apiAsync` seam and `runWithConcurrency`, only for MERGED candidates whose references do not already name the issue and whose `mergeCommit.oid` is present (spec Technical Approach 4).
- Scope discipline: touch only the four Key Files plus `tests/reconcile.test.js` (its `decideRelease` pins). No adjacent refactors. `archive-merged.js` is out of scope (#3416).
- Commit messages: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_01K2fNS9LsyAtzkTuvEnpWXU`.

## Review Focus

1. A `closingIssuesReferences` entry whose `repository` is absent (older gh output shape) — `prClosesIssue` must treat it as a non-match, not throw (Task 2 test `cross-repo and malformed entries never match`).
2. A merge commit message with `Fixes #34120` must not match issue `3412` — the `\b` boundary after the number (Task 2 test `#N is matched on a word boundary`).
3. The commit fetch's `apiAsync` result carries `failure` set (transport failure) — the signal is absent, `closesIssue` is decided from references alone, never `undefined` when an array was present (Task 4 end-to-end `references present, commit fetch fails`).
4. `needsIssueEvidence` for a MERGED PR with `closesIssue === true` must stay `false`, so a closing merge pays no extra issue-state read (Task 3 test).
5. A MERGED candidate whose `mergeCommit` is `null`/absent (the existing fixtures' shape) must skip the commit fetch without throwing and decide from references (Task 4 fixture updates exercise this on every pre-existing end-to-end test).

---

### Task 1: Carry `closingIssuesReferences` through the PR-state join

**Files:**
- Modify: `plugin/bin/lib/reconcile/pr-state.js:548` (`PR_LIST_ARGS`), `:683` and `:758` (the two by-number `--json` field literals)
- Test: `tests/bin-lib/reconcile/pr-state.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: every resolver's returned PR object carries `closingIssuesReferences: [{ number, repository: { name, owner: { login } }, url }]` when gh returns it; `pickGoverningPr` already passes the object through untouched.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/reconcile/pr-state.test.js`, reusing the argv-logging wrapper shape of the `(#2367)` test at line 322:

```js
test('resolvePrState/resolvePrStateAsync: request closingIssuesReferences in the --json field list (#3412)', async () => {
  const pr = { number: 9, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', closingIssuesReferences: [{ number: 3412, repository: { name: 'w', owner: { login: 'acme' } } }] };
  // wrapper: echo "$@" > argv.log then cat the JSON array [pr]
  // assert: resolvePrState('/tmp','b').closingIssuesReferences[0].number === 3412
  // assert: (await resolvePrStateAsync('/tmp','b')).closingIssuesReferences[0].number === 3412
  // assert: /closingIssuesReferences/.test(argv) for each call
});

test('resolvePrStateByNumber/resolvePrStateByNumberAsync: request closingIssuesReferences (#3412)', async () => {
  // same wrapper shape, single PR object (not an array) with closingIssuesReferences
  // assert both resolvers return the field and both argv logs match /closingIssuesReferences/
});
```

Also extend the existing `(#2367)` test's argv assertion with `assert.match(argv, /closingIssuesReferences/);`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/pr-state.test.js`
Expected: FAIL — the wrapper returns its fixed JSON whatever argv it receives, so the returned-field assertions pass trivially; the discriminating assertions are the `assert.match(argv, /closingIssuesReferences/)` lines, which fail because no resolver requests the field yet.

- [ ] **Step 3: Widen the three field lists in `plugin/bin/lib/reconcile/pr-state.js`**

`PR_LIST_ARGS`'s `--json` value becomes `number,state,mergedAt,updatedAt,mergeCommit,closingIssuesReferences`; the two by-number literals become `number,state,mergedAt,updatedAt,mergeCommit,mergeable,mergeStateStatus,closingIssuesReferences`. Update the `resolvePrStateByNumber` header comment's shape list to name the new field. No other change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/pr-state.test.js`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/pr-state.js tests/bin-lib/reconcile/pr-state.test.js
git commit -m "Request closingIssuesReferences in every pr-state resolver — carries the closing-issue set to release-merged (#3412)" -m "Claude-Session: https://claude.ai/code/session_01K2fNS9LsyAtzkTuvEnpWXU"
```

---

### Task 2: Pure `prClosesIssue` helper

**Files:**
- Modify: `plugin/bin/lib/reconcile/release-merged.js` (new exported function beside `decideRelease`; add to `module.exports` at line 506)
- Test: `tests/bin-lib/reconcile/release-merged.test.js`

**Interfaces:**
- Produces: `prClosesIssue(prState, issueNumber, repoSlug, mergeCommitMessage) → true | false | undefined`.
  - `true` when `prState.closingIssuesReferences` (an array) has an entry with `Number(entry.number) === issueNumber` and `` `${entry.repository.owner.login}/${entry.repository.name}` === repoSlug ``; or when `mergeCommitMessage` is a string with a line matching `/^\s*(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved):?\s+#(\d+)\b/gim` whose captured number equals `issueNumber`.
  - `false` when the references array is present and neither signal matches.
  - `undefined` when `prState` has no `closingIssuesReferences` array and the commit message (if any) does not match.
  - Never throws on a malformed entry (missing `repository`/`owner`).
- Also export the keyword regex as `CLOSING_KEYWORD_RE` for the test file's negative-control reuse.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/reconcile/release-merged.test.js` (extend the existing `require` destructuring at line 8-10 rather than adding a second one):

```js
const { prClosesIssue } = require('../../../plugin/bin/lib/reconcile/release-merged');
const ref = (number, login = 'acme', name = 'w') => ({ number, repository: { name, owner: { login } } });

test('prClosesIssue: closing reference naming the issue in this repo -> true', () => {
  assert.equal(prClosesIssue({ state: 'MERGED', closingIssuesReferences: [ref(3306), ref(3311)] }, 3311, 'acme/w'), true);
});
test('prClosesIssue: references present, none match -> false (the #3348 shape)', () => {
  assert.equal(prClosesIssue({ state: 'MERGED', closingIssuesReferences: [ref(3306), ref(3310)] }, 3311, 'acme/w'), false);
});
test('prClosesIssue: cross-repo and malformed entries never match', () => {
  assert.equal(prClosesIssue({ closingIssuesReferences: [ref(3311, 'other', 'repo')] }, 3311, 'acme/w'), false);
  assert.equal(prClosesIssue({ closingIssuesReferences: [{ number: 3311 }] }, 3311, 'acme/w'), false);
});
test('prClosesIssue: merge commit closing keyword line -> true; Refs never matches', () => {
  const noRefs = { closingIssuesReferences: [ref(3306)] };
  assert.equal(prClosesIssue(noRefs, 3311, 'acme/w', 'feat: x (#3306)\n\nFixes #3306\nFixes #3311\n'), true);
  assert.equal(prClosesIssue(noRefs, 3311, 'acme/w', 'feat: x\n\ncloses: #3311'), true);
  assert.equal(prClosesIssue(noRefs, 3311, 'acme/w', 'feat: x\n\nRefs #3311\n'), false);
});
test('prClosesIssue: #N is matched on a word boundary', () => {
  assert.equal(prClosesIssue({ closingIssuesReferences: [] }, 3412, 'acme/w', 'Fixes #34120\n'), false);
});
test('prClosesIssue: no closingIssuesReferences array -> undefined unless the commit message closes it (AC4.1)', () => {
  assert.equal(prClosesIssue({ state: 'MERGED', number: 7 }, 7, 'acme/w'), undefined);
  assert.equal(prClosesIssue({ state: 'MERGED', number: 7 }, 7, 'acme/w', 'Fixes #7'), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/release-merged.test.js`
Expected: FAIL with `prClosesIssue is not a function`

- [ ] **Step 3: Implement `prClosesIssue` in `plugin/bin/lib/reconcile/release-merged.js`**

Place it directly above `decideRelease` with a header comment naming the three outcomes and citing #3412. Define `const CLOSING_KEYWORD_RE = /^\s*(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved):?\s+#(\d+)\b/gim;` at module scope; inside the function iterate `message.matchAll(CLOSING_KEYWORD_RE)` (never a shared `lastIndex` via `.test`). Reference matching reads `entry.repository && entry.repository.owner` defensively. Add both names to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/release-merged.test.js`
Expected: PASS for the six new tests; every pre-existing test still passes (nothing else changed yet)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/release-merged.js tests/bin-lib/reconcile/release-merged.test.js
git commit -m "Add prClosesIssue — closing references by number and repo, or a merge-commit closing keyword (#3412)" -m "Claude-Session: https://claude.ai/code/session_01K2fNS9LsyAtzkTuvEnpWXU"
```

---

### Task 3: Widen `decideRelease` and `needsIssueEvidence` with `closesIssue`

**Files:**
- Modify: `plugin/bin/lib/reconcile/release-merged.js:33-68` (`decideRelease`, `needsIssueEvidence`, their header comments)
- Modify: `tests/reconcile.test.js:317-323` (two MERGED → release pins gain the fourth argument `true`)
- Test: `tests/bin-lib/reconcile/release-merged.test.js`

**Interfaces:**
- Consumes: nothing from Task 2 at runtime (pure functions), but the same file.
- Produces: `decideRelease(classifiedState, prState, issueState, closesIssue)` and `needsIssueEvidence(prState, closesIssue)`; `needsIssueEvidence` is exported for the new unit tests (add to `module.exports`).

Sole-site proof (run at authoring, recorded here): `grep -rln "decideRelease\|needsIssueEvidence" plugin tests` → `plugin/bin/lib/reconcile/release-merged.js`, `tests/reconcile.test.js`, `tests/bin-lib/reconcile/release-merged.test.js`. No other caller.

- [ ] **Step 1: Write the failing tests and update the two existing pins**

In `tests/bin-lib/reconcile/release-merged.test.js`, change the existing `decideRelease: merged PR still releases regardless of issue state` test to pass `true` as the fourth argument and rename it `decideRelease: merged PR that closes the issue releases regardless of issue state (AC2.1)`. Add:

```js
const { needsIssueEvidence } = require('../../../plugin/bin/lib/reconcile/release-merged');
const merged = { number: 3348, state: 'MERGED' };

test('decideRelease: AC1.1 live claim + MERGED PR not closing the issue + open issue -> skip pr-merged-not-closing', () => {
  assert.deepStrictEqual(decideRelease('live', merged, 'OPEN', false), { action: 'skip', reason: 'pr-merged-not-closing' });
  assert.deepStrictEqual(decideRelease('stale', merged, undefined, false), { action: 'skip', reason: 'pr-merged-not-closing' });
});
test('decideRelease: AC3.1 MERGED PR not closing the issue + CLOSED issue -> release issue-closed', () => {
  assert.deepStrictEqual(decideRelease('live', merged, 'CLOSED', false), { action: 'release', reason: 'issue-closed' });
});
test('decideRelease: AC4.1 MERGED PR with unknown closing data never releases on merged evidence', () => {
  assert.deepStrictEqual(decideRelease('live', merged, 'OPEN', undefined), { action: 'skip', reason: 'pr-merged-closing-unknown' });
  assert.deepStrictEqual(decideRelease('live', merged, 'OPEN'), { action: 'skip', reason: 'pr-merged-closing-unknown' });
  assert.deepStrictEqual(decideRelease('live', merged, 'CLOSED', undefined), { action: 'release', reason: 'issue-closed' });
});
test('needsIssueEvidence: MERGED needs issue evidence unless closesIssue is true', () => {
  assert.equal(needsIssueEvidence(merged, true), false);
  assert.equal(needsIssueEvidence(merged, false), true);
  assert.equal(needsIssueEvidence(merged, undefined), true);
  assert.equal(needsIssueEvidence({ number: 1, state: 'OPEN' }, false), false);
  assert.equal(needsIssueEvidence(null), true);
  assert.equal(needsIssueEvidence({ number: 1, state: 'CLOSED' }), true);
  assert.equal(needsIssueEvidence('gh-absent'), false);
});
```

In `tests/reconcile.test.js`, the `live claim + merged PR -> release` (line 317) and `stale claim + merged PR -> release` (line 322) calls gain `, undefined, true` as the third and fourth arguments; the `only live/stale claims` test (line 312) is unchanged (non-candidates skip before the PR branch).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/release-merged.test.js`
Expected: FAIL — `needsIssueEvidence is not a function`, and the AC1.1/AC4.1 cases receive `{ action: 'release', reason: 'merged: reconciled from PR #3348' }`

- [ ] **Step 3: Implement the widened decision table in `plugin/bin/lib/reconcile/release-merged.js`**

Replace the MERGED branch of `decideRelease` (lines 47-49) with:

```js
if (prState && prState.state === 'MERGED') {
  if (closesIssue === true) return { action: 'release', reason: `merged: reconciled from PR #${prState.number}` };
  if (issueState === 'CLOSED') return { action: 'release', reason: 'issue-closed' };
  return { action: 'skip', reason: closesIssue === false ? 'pr-merged-not-closing' : 'pr-merged-closing-unknown' };
}
```

`needsIssueEvidence(prState, closesIssue)`: `null` → true; non-object → false; `state === 'CLOSED'` → true; `state === 'MERGED' && closesIssue !== true` → true; else false. Rewrite both functions' header comments to state the new rows and the fail-closed rule (#3412). Export `needsIssueEvidence`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/release-merged.test.js tests/reconcile.test.js`
Expected: PASS for every `decideRelease`/`needsIssueEvidence` test. The five pre-existing end-to-end `releaseMerged` tests that expect a merged release (`Phase 1.5 … pool`, `#3249 by-number fallback`, `does not invoke the by-number fallback`, `unstamped worktree … fallbackBranch`, `merged: release strips every GRANT_LABELS entry`) now FAIL with `pr-merged-closing-unknown` — expected and deliberate (spec Gotchas); Task 4 updates their fixtures. Do not relax the decision table to make them pass.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/release-merged.js tests/bin-lib/reconcile/release-merged.test.js tests/reconcile.test.js
git commit -m "Gate decideRelease's merged-PR release on closesIssue — fail closed, fall through to issue-closed (#3412)" -m "Claude-Session: https://claude.ai/code/session_01K2fNS9LsyAtzkTuvEnpWXU"
```

---

### Task 4: Wire `releaseMerged` — Phase 1.75 commit fetch, per-candidate `closesIssue`, fixtures, regression

**Files:**
- Modify: `plugin/bin/lib/reconcile/release-merged.js:402-490` (between the by-number fallback and Phase 2; Phase 2's filter; Phase 3's `decideRelease` call) and the function header comment's phase list (lines 263-282)
- Test: `tests/bin-lib/reconcile/release-merged.test.js`

**Interfaces:**
- Consumes: `prClosesIssue` (Task 2), `decideRelease`/`needsIssueEvidence` (Task 3), existing `apiAsync`, `runWithConcurrency`, `resultsByIssue`, `repoSlug`.
- Produces: candidates carry `mergeCommitMessage` (string | undefined) and `closesIssue` (true | false | undefined) before Phase 2.
- Verbatim-command probe (run once live, 2026-10-17, read-only): `gh api repos/thn-inc/claude-tweaks/commits/a39cd61fad9d8bac2dc855216489b65286fe92e2 -q .commit.message` printed PR #3348's squash body ending in `Fixes #3306` … `Fixes #3310` — the argv shape Phase 1.75 passes through `apiAsync` (which prepends `api`).

- [ ] **Step 1: Update the five existing end-to-end fixtures and write the regression tests**

Append the new tests to `tests/bin-lib/reconcile/release-merged.test.js` and edit the five fixtures in place in that same file. Fixture updates — each `gh` wrapper's MERGED PR JSON gains a `closingIssuesReferences` entry naming the test's own issue in `acme/w` (the fixtures' `origin` is `git@github.com:acme/w.git`): PR 42 → issue 11; PR 3249001 → issue 61; PR 77 → issue 62; PR 88 → issue 64; PR 55 → issue 21. Shape: `"closingIssuesReferences":[{"number":11,"repository":{"name":"w","owner":{"login":"acme"}}}]`. These fixtures have no `mergeCommit.oid` (or already close via references), so no `/commits/` call is reached and their `ghApi` fakes need no new branch.

New tests (same wrapper/fake technique as the `(#3249)` tests):

```js
test('releaseMerged: AC1.1 AC5.1 the #3348 shape — merged PR closing other records keeps this record\'s claim and labels', async () => {
  // run-state with a live worktree on branch 'run-3348-branch'; live claim issue-3311.json
  // gh wrapper: `pr list --head run-3348-branch` -> [{number:3348,state:'MERGED',mergedAt,updatedAt,mergeCommit:{oid:'a39cd61'},closingIssuesReferences:[ref(3306),ref(3307)]}]
  // ghApi fake: '/commits/a39cd61' -> stdout 'feat: x (#3306)\n\nFixes #3306\nFixes #3307\n'; '/issues/3311' -> 'OPEN\n';
  //   any '/labels/' path -> push to labelDeletes (must stay empty); writeTombstone PUT must never be reached (wrapper `api --method PUT` exits 1)
  // assert result.released.length === 0
  // assert result.skipped.some(s => s.issueNumber === 3311 && s.reason === 'pr-merged-not-closing')
  // assert labelDeletes.length === 0
  // assert commitReads === 1 and issueReads === 1
});
test('releaseMerged: AC3.1 merged-not-closing PR whose issue is now CLOSED releases via issue-closed', async () => {
  // same fixture, '/issues/3311' -> 'CLOSED\n'; wrapper `api --method PUT` exits 0
  // assert released[0].issueNumber === 3311 and released[0].prNumber === 3348
  // assert the tombstone reason / decision uses issue-closed: no GRANT_LABELS DELETE recorded, only 'bot:in-progress'
});
test('releaseMerged: references present, commit fetch fails -> still decided from references (not unknown)', async () => {
  // '/commits/a39cd61' -> { stdout: null, failure: 'network-failure' }; '/issues/3311' -> 'OPEN\n'
  // assert skipped reason === 'pr-merged-not-closing' (never 'pr-merged-closing-unknown')
});
test('releaseMerged: a merge commit closing keyword releases when references do not name the issue', async () => {
  // closingIssuesReferences: [ref(3306)]; '/commits/a39cd61' -> 'feat: x\n\nFixes #3306\nFixes #3311\n'
  // assert released[0].issueNumber === 3311, reason path merged: (GRANT_LABELS DELETEs recorded)
});
test('releaseMerged: references already naming the issue skip the commit fetch entirely', async () => {
  // closingIssuesReferences: [ref(3311)], mergeCommit:{oid:'a39cd61'}; ghApi fake throws on any '/commits/' path
  // assert released.length === 1
});
```

Each wrapper script answers `*"api --method PUT"*` per the existing fixtures (exit 0 where a release is expected, exit 1 where none must happen).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/release-merged.test.js`
Expected: FAIL — nothing computes `closesIssue` yet, so every MERGED candidate reaches `decideRelease` with `undefined`: the five updated fixtures still skip with `pr-merged-closing-unknown`, the #3348 regression's reason assertion fails (`pr-merged-closing-unknown`, not `pr-merged-not-closing`) and its `commitReads === 1` assertion fails (no fetch), and the AC3.1 case releases via issue-closed only once Phase 2 is reached for it.

Discrimination proof for AC5.1 (the test must go red on the **pre-fix** `decideRelease`, not merely on the unwired one): temporarily restore the MERGED branch of `decideRelease` to the original one-line unconditional release (`if (prState && prState.state === 'MERGED') return { action: 'release', reason: ... }`), run `node --test --test-name-pattern "3348" tests/bin-lib/reconcile/release-merged.test.js`, confirm the test reports `released.length` as 1 (red), then restore the Task 3 code (`git checkout -- plugin/bin/lib/reconcile/release-merged.js` — the file is committed at Task 3's state). Quote the red output in the task reply.

- [ ] **Step 3: Implement Phase 1.75 and the per-candidate verdict in `releaseMerged`**

After the by-number fallback loop (line 451) and before Phase 2:

```js
// Phase 1.75 (#3412): merge-commit message, only where the references don't already settle it.
const needCommit = candidates.filter((c) => c.prState && typeof c.prState === 'object' && c.prState.state === 'MERGED'
  && prClosesIssue(c.prState, c.issueNumber, repoSlug) !== true
  && c.prState.mergeCommit && c.prState.mergeCommit.oid);
const commitReads = await runWithConcurrency(needCommit, (c) => apiAsync([`repos/${repoSlug}/commits/${c.prState.mergeCommit.oid}`, '-q', '.commit.message']));
const commitByIssue = resultsByIssue(needCommit, commitReads);
for (const c of candidates) {
  const r = commitByIssue.get(c.issueNumber);
  c.mergeCommitMessage = r && typeof r === 'object' && !r.failure && typeof r.stdout === 'string' ? r.stdout : undefined;
  c.closesIssue = c.prState && typeof c.prState === 'object' && c.prState.state === 'MERGED'
    ? prClosesIssue(c.prState, c.issueNumber, repoSlug, c.mergeCommitMessage)
    : undefined;
}
```

Phase 2's filter becomes `needsIssueEvidence(c.prState, c.closesIssue)`; Phase 3 calls `decideRelease(c.classifiedState, c.prState, issueState, c.closesIssue)`. Add `prState: null, joinFailure, ...` → also initialize `mergeCommitMessage: undefined, closesIssue: undefined` on the candidate literal at line 397 for shape clarity. Update the function's header comment (lines 263-282) to list Phase 1.75 between 1.5 and 2 and name #3412.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/release-merged.test.js tests/bin-lib/reconcile/pr-state.test.js tests/reconcile.test.js`
Expected: PASS — every test in the three files

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/release-merged.js tests/bin-lib/reconcile/release-merged.test.js
git commit -m "Keep a claim when the run's PR merged without closing it — Phase 1.75 commit fetch, closesIssue verdict, #3348 regression (#3412)" -m "Claude-Session: https://claude.ai/code/session_01K2fNS9LsyAtzkTuvEnpWXU"
```

---

### Task 5: Full-suite verification

**Files:**
- Test: `tests/` (whole suite via `npm test`)

**Interfaces:**
- Consumes: Tasks 1-4 committed.
- Produces: the green suite (AC6.1).

- [ ] **Step 1: Verification — run the full test suite (AC6.1)**

Run: `npm test`
Expected: PASS — exit 0 and a failure count of 0. Redirect the output to a log file rather than reading the truncated tail; if the count is non-zero, compare the failing-file set against the baseline log captured at worktree setup and re-run each affected file in isolation (`node --test {file}`) before concluding anything regressed — never accept a summary count. Verification only: nothing to stage or commit in this task.
