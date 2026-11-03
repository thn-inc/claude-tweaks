# Prior-attempt tombstone evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A closed, run-marked PR counts as the record's own prior attempt only with failure-tombstone evidence, so a dispatch retry never silently adopts the branch of a PR a human closed.

**Architecture:** `findPriorAttemptPr` judges only the newest closed PR on the branch (the spec's plan-review decision, Reading A), and that PR gains a final check after its existing ones: a trusted `Attempt {N} failed` comment on a record the PR closes, created in `[closedAt - TOMBSTONE_CLOSE_WINDOW_MS, closedAt]`. Comments come from an injected reader, read at most once per record per call. Every doubt returns no match, so the branch stays `foreign` and the existing stop card fires.

**Tech Stack:** Node 18+, `node --test`, `gh` CLI through the module's injectable seam.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T180036-record-4058/work/4058-spec.md` (resume run; amended after plan review: Reading A)

**Scope keywords:** findPriorAttemptPr

## Global Constraints

- Evidence is an `ATTEMPT_RE` match on a comment `isTrustedComment` accepts, with `createdAt` in `[closedAt - TOMBSTONE_CLOSE_WINDOW_MS, closedAt]`. Not after `closedAt`.
- `TOMBSTONE_CLOSE_WINDOW_MS` = 15 minutes, an exported module constant, not a policy key.
- Issue comments only. Do not widen evidence to PR comments (the PR's `run-comment: failure` pointer is updated in place; its timestamp is unreliable).
- A failed or partial lookup yields no match. The evidence lookup reads a record's comments at most once per record per check.
- Export `ATTEMPT_RE` from `retry.js`; never copy the regex.
- Reading A (spec, Acceptance Criteria): only the newest closed PR on the branch is judged. The candidates are the lookup's `CLOSED` PRs whose `isCrossRepository` is not `true` (a fork PR's head is the fork's branch, not this one; an unknown value stays a candidate and then fails the existing same-repo check). Newest is the latest parseable `closedAt`. Any candidate with an unparseable `closedAt`, or two candidates sharing the newest `closedAt`, yields no match: newest cannot be established, so fail closed. A newest PR that fails any check yields `null` even when an older PR on the branch is a genuine tombstone.
- A non-object element in `comments` (or in `prs`) is skipped, never thrown on (plan review, low row 2).
- `gh`-absent behavior is unchanged (no PR lookup; #3915 tracks the MCP-fed one).
- Scope and edit discipline: Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.
- Commits say `refs #4058`, never `closes`/`fixes`. Style: `{Verb} {what} — {detail}`. End each message with the trailer `Claude-Session: https://claude.ai/code/session_01UwjosJVnTXDKFVduzhuimu`.

Governing skills, quoted (`.claude/skills/gh-api-module-pattern/SKILL.md`):

- "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.**" The new read reuses the module's `defaultGh`, which does.
- "**The quiet posture is owed by any call the module catches and recovers from, not only by a probe seam**" and "passes `stdio: ['ignore', 'pipe', 'pipe']`". The new read is caught and recovered from, so `defaultGh`'s options literal gains that `stdio`.
- "Tests never touch real `gh`: fake runners branch on the `args` shape" and "**A fake `gh` that returns a fixed full row ignores the `--json` field list, so a test using it cannot see the list shrink.**" So the `closedAt` field and the reader's argv are asserted exactly.

`.claude/skills/skill-prose-conformance-tests/SKILL.md` applies to Task 2's prose pin: read live skill text, and prove the assertion can go red by running the same assertion function on mutated text.

No other project skill names these files: `parse-signal-discipline` is honored by the reader's distinct `ok: false`; `bin-source-scan-conformance` does not apply (no source-text test is added).

## Real-input evidence (run while authoring)

Scratch probe over all 128 closed, unmerged PRs this repo's search returns for `claude-tweaks-run in:body is:unmerged` (120 carry the first-line marker). 33 PR-to-record rows have at least one `Attempt N failed` issue comment. `closedAt - createdAt` for the comment nearest before close:

- 15 rows fall in `[0, 900s]`: 4, 5, 5, 6, 6, 7, 7, 8, 9, 9, 9, 10, 11, 24, 173 seconds. These are the tombstones. Every one from October is under 12 seconds.
- #4860 and #4871 (record 4848) have only a later attempt comment: closed roughly 3 hours before it. They stay foreign, correctly.
- #4457 (record 4343) has only stale comments, nearest 105810s before close. The stale-marker shape is real.
- #2639 and #2464 have the comment 188s and 171s *after* close. Both are September PRs, older than the current order. They stay foreign, which is the spec's fail-closed direction for old tombstones.
- Trust: all in-window comments are `MEMBER`; one `CONTRIBUTOR` attempt comment exists on #1315.

Verbatim commands run live: `gh issue view 4058 --repo thn-inc/claude-tweaks --json comments` returns `authorAssociation` and `createdAt` on each comment; `gh pr list --repo thn-inc/claude-tweaks --head worktree-dispatch-record-4058 --state all --json number,closedAt` accepts the field. `gh issue view --json comments` paginates fully (`plugin/bin/lib/issue-branch-tracking.js:124` records the cli source).

Empty-value probe: `readIssueComments` receives only a positive integer from `records` already filtered through `Number.isInteger`, and `repo` already checked non-empty by the function's opening guard, so no degenerate value reaches `gh`.

Sole-caller grep: `git grep -n "findPriorAttemptPr(" -- plugin tests` hits only `plugin/skills/build/adopted-branch-collision-check.md:58`, `tests/bin-lib/worktree/remote-branch-collision.test.js`, and the module. Reach through the stub in `tests/adopted-branch-collision-snippet-fixture.test.js` is the one other runtime caller.

## Review Focus

1. A comment posted after the close (older settle order, or a human commenting after closing) must not count: pinned in Task 1 (`after closedAt stays foreign`).
2. A CLOSED PR with a null or unparseable `closedAt`, or a comment with an unparseable `createdAt`, must stay foreign rather than compare as NaN into a match: pinned in Task 1.
3. A bundle PR closing several records must match on evidence from any linked record and never read a record it does not close: pinned in Task 1.
4. Several closed PRs on one branch (Reading A): only the newest closed PR is judged. A newest human-closed (evidence-less) PR makes the result `null` even with an older genuine tombstone on the branch, so rejected commits are never adopted; a newest tombstone still matches over an older evidence-less PR; an older PR's comments are never read: pinned in Task 1.
5. A `gh` failure or malformed payload during the comment read must stay foreign, with the stop card still naming the closed PR: pinned in Tasks 1 and 2.
6. A newest closed PR that cannot be established (an unparseable `closedAt` on any candidate, or a tie on the newest one) stays foreign: pinned in Task 1.

---

### Task 1: Tombstone evidence in `findPriorAttemptPr`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/retry.js`
- Modify: `plugin/bin/lib/worktree/remote-branch-collision.js`
- Test: `tests/bin-lib/worktree/remote-branch-collision.test.js`
- Test: `tests/adopted-branch-collision-snippet-fixture.test.js`
- Test: `tests/bin-lib/issues/retry.test.js`

Waived `plugin/bin/lib/issues/comment-trust.js`: read only; Step 3 imports `isTrustedComment` from it unchanged.
Waived `plugin/skills/dispatch/settle-and-merge.md`: read only; Task 2 Step 1 pins its Step 6 step 5 order, the order the window relies on.

**Interfaces:**
- Produces: `ATTEMPT_RE` exported from `retry.js`.
- Produces, from `remote-branch-collision.js`: `TOMBSTONE_CLOSE_WINDOW_MS` (number, ms), `readIssueComments({ number, repo, gh = defaultGh }) -> { ok: true, comments: [] } | { ok: false, error?, comments: [] }` (never throws), `findPriorAttemptPr({ remoteSha, prLookup, records, repo, git = defaultGit, readComments = readIssueComments })`, called as `readComments({ number, repo })`.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/worktree/remote-branch-collision.test.js`, near the #3887 fixtures, add `const CLOSED_AT = '2026-10-21T12:00:00Z';`, add `closedAt: CLOSED_AT` to `closedPr`, and give the `priorAttempt` helper a default `readComments: () => ({ ok: true, comments: [tombstoneComment()] })`, where `tombstoneComment(over)` is `{ body: 'Attempt 1 failed: tests red. Claim released, will retry.', authorAssociation: 'MEMBER', createdAt: '2026-10-21T11:59:55Z', ...over }`. Add `closedAt` to the literal in the `requests the fields` test (`number,url,state,isDraft,headRefOid,closingIssuesReferences,body,isCrossRepository,closedAt`). In the real-git `AC1.1` test pass the same default `readComments`. Import `TOMBSTONE_CLOSE_WINDOW_MS` and `readIssueComments`.

Add these tests; the four in the block below are the spec's four cases, each of which must go red with the evidence check removed (AC4.1, proved in Step 5). `withComments(comments)` is `{ readComments: () => ({ ok: true, comments }) }`; `PR9` is `{ number: 9, url: 'https://example.test/pr/9' }`.

```js
test('#4058 AC2.1: a tombstone PR (attempt comment just before closedAt) matches, read from the record it closes', () => {
  const calls = [];
  const readComments = (a) => { calls.push(a); return { ok: true, comments: [tombstoneComment()] }; };
  assert.deepEqual(priorAttempt({ readComments }), PR9);
  assert.deepEqual(calls, [{ number: 42, repo: 'o/r' }]);
});
test('#4058 AC1.1: a PR with no attempt comment stays foreign', () => {
  assert.equal(priorAttempt(withComments([])), null);
  assert.equal(priorAttempt(withComments([tombstoneComment({ body: 'Rejected, wrong approach.' })])), null);
});
test('#4058 AC1.1: a PR whose only attempt comment is older than the window stays foreign (stale marker)', () => {
  const edge = new Date(Date.parse(CLOSED_AT) - TOMBSTONE_CLOSE_WINDOW_MS).toISOString();
  const justOutside = new Date(Date.parse(CLOSED_AT) - TOMBSTONE_CLOSE_WINDOW_MS - 1000).toISOString();
  assert.equal(priorAttempt(withComments([tombstoneComment({ createdAt: justOutside })])), null);
  assert.deepEqual(priorAttempt(withComments([tombstoneComment({ createdAt: edge })])), PR9);
});
test('#4058 AC1.1: a failed or partial issue-comment lookup stays foreign', () => {
  assert.equal(priorAttempt({ readComments: () => ({ ok: false, comments: [] }) }), null);
  assert.equal(priorAttempt({ readComments: () => ({ ok: false, comments: [tombstoneComment()] }) }), null);
});
```

Further tests, each isolating one guard:

- `#4058 AC3.1: an attempt comment from an untrusted author never counts`: for `authorAssociation` in `CONTRIBUTOR`, `NONE`, `undefined`, the result is `null`.
- `#4058: a comment after closedAt stays foreign; one at closedAt counts`: `2026-10-21T12:00:01Z` gives `null`, `CLOSED_AT` gives `PR9`.
- `#4058: an unparseable closedAt or createdAt stays foreign`: `closedPr({ closedAt: null })`, `closedPr({ closedAt: 'nope' })`, and `tombstoneComment({ createdAt: 'nope' })`, each `null`, the valid case beside them matching.
- `#4058: ancestry failure never reads the comments`: `git` throws, `readComments` recording, zero calls.
- `#4058 Reading A: a newest human-closed PR hides an older genuine tombstone`: PR 3 tombstoned (`closedAt: '2026-10-01T00:00:00Z'`, its record's comments include an in-window attempt comment for that time) and PR 9 newest with `CLOSED_AT` and no in-window comment; the reader returns both comments for record 42 (`tombstoneComment({ createdAt: '2026-09-30T23:59:55Z' })` only), result `null`, regardless of the PRs' order in the lookup (run it with both orders).
- `#4058 Reading A: a newest tombstone matches over an older evidence-less PR, and only the newest PR is read`: PR 3 `closedAt: '2026-10-01T00:00:00Z'` evidence-less, PR 9 with `CLOSED_AT` and the default in-window comment, both orders; result `PR9`, one recording reader, `calls.length === 1`, and the ancestry `git` called only with PR 9's head.
- `#4058 Reading A: a newest closed PR that fails an existing check is null, never a fallback to an older match`: newest PR 9 for a different record (`closingIssuesReferences: [ref(43)]`, body `Fixes #43`), and separately newest PR 9 with a non-ancestor head; an older PR 3 (`closedAt: '2026-10-01T00:00:00Z'`) that would otherwise match; each `null`.
- `#4058 Reading A: a fork PR is not a candidate for newest`: newest PR 2 `isCrossRepository: true` with a later `closedAt`, older own PR 9 with evidence: result `PR9`. An OPEN or MERGED newer PR is not a candidate either: result `PR9`.
- `#4058 Reading A: newest cannot be established, so foreign`: two candidates where one has `closedAt: null` (and separately `'nope'`), and two candidates sharing `CLOSED_AT`; each `null`.
- `#4058: a null or non-object comment element is skipped, never thrown on`: `comments: [null, 'x', tombstoneComment()]` gives `PR9`; `comments: [null]` gives `null`.
- `#4058: a bundle PR matches on any record it closes and never reads a record it does not`: `records: [7, 42, 8]`, `closingIssuesReferences: [ref(7), ref(42)]`, body `Fixes #42`, reader returns evidence only for 42, result `PR9`, called numbers `[7, 42]`, never 8.

Rewrite the existing `#3887` test `skips non-matching closed PRs ahead of the record's own and returns the own one` for Reading A: give PRs 1 and 3 earlier `closedAt` values than PR 9's `CLOSED_AT` (PR 2, the fork, keeps the default), keep the expected `PR9`, and rename it `judges the newest closed PR, ignoring older non-matching ones and fork PRs`. Under Reading A the old shape (non-matching PRs judged and skipped regardless of age) no longer exists; the Reading A tests above pin the newer-non-matching direction.
- `readIssueComments`: exact argv `['issue', 'view', '42', '--repo', 'o/r', '--json', 'comments']` and `{ ok: true, comments }` on `{"comments":[...]}`; `{ ok: false }` when `gh` throws (timeout included), on `not json`, on `{}`, and on `{"comments":"x"}`.

In `tests/bin-lib/issues/retry.test.js` add: `ATTEMPT_RE` matches `attemptFailedCommentBody({ attemptNumber: 2, reason: 'r', ceilingHit: false })`, and is not global (`ATTEMPT_RE.global === false`, so `.test` holds no state across comments).

In `tests/adopted-branch-collision-snippet-fixture.test.js`: `stubPluginRoot(t, result, prs = [], comments = [])` also exports `findPriorAttemptPr: (args) => real.findPriorAttemptPr({ ...args, readComments: () => ({ ok: true, comments: <JSON comments> }) })`. Give the #3887 test's `pr` a `closedAt: '2026-10-21T12:00:00Z'`, and its `run` a trusted in-window attempt comment. Add:

```js
test('#4058 AC1.2: the snippet stops with the foreign card on a closed PR that has no tombstone evidence', ...)
// same fixture as the #3887 test, comments = []: state 'foreign', card matches /closed PR #9/ and /worktree-record-1/
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/worktree/remote-branch-collision.test.js`
Expected: FAIL (the new `#4058` tests and the `requests the fields` literal)

- [ ] **Step 3: Implement**

`retry.js`: add `ATTEMPT_RE` to `module.exports`; no other change.

`remote-branch-collision.js`: require `ATTEMPT_RE` from `../issues/retry` and `isTrustedComment` from `../issues/comment-trust`. `defaultGh`'s options literal gains `stdio: ['ignore', 'pipe', 'pipe']`. Append `,closedAt` to `findPrsForBranch`'s `--json` list. Add `TOMBSTONE_CLOSE_WINDOW_MS = 15 * 60 * 1000` with a comment naming `settle-and-merge.md` Step 6 step 5's order and that real tombstones land within seconds. Add `readIssueComments` (an `Array.isArray(parsed.comments)` check; any throw or other shape is `{ ok: false, comments: [] }`).

In `findPriorAttemptPr`, replace the `for` loop with Reading A's single judgment. A private `newestClosedPr(prs)` returns the one candidate (`pr` an object, `state === 'CLOSED'`, `isCrossRepository !== true`) with the greatest `Date.parse(closedAt)`, or `null` when there is no candidate, any candidate's `closedAt` parses to NaN, or the greatest value is shared. Then judge that one PR with the existing checks in their current order (same-repo `isCrossRepository === false`, first-line marker, `const linked = wanted.filter((n) => prClosesIssue(pr, n, repo, pr.body) === true)` non-empty, head sha, ancestry `try/catch`), and last `linked.some((n) => hasTombstoneEvidence(pr.closedAt, readComments({ number: n, repo })))` — `some` stops at the first record with evidence, and each linked record is read at most once because only one PR is judged (no memo needed). Any failed check returns `null`. `hasTombstoneEvidence(closedAt, lookup)` is a private helper: false unless `lookup` is an object with `lookup.ok === true` and `lookup.comments` an array; `closed = Date.parse(closedAt)`, and for each comment skip anything that is not a non-null object, then require `ATTEMPT_RE.test(body)` on a string body, `isTrustedComment(comment)`, `created = Date.parse(createdAt)`, `created <= closed && closed - created <= WINDOW`. A NaN compares false, so an unparseable value never matches. Update the function's doc comment (it no longer returns "the first" match; it judges the newest closed PR) and the header's #3887 paragraph with a #4058 sentence naming the evidence and Reading A. Export `TOMBSTONE_CLOSE_WINDOW_MS` and `readIssueComments`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/worktree/remote-branch-collision.test.js tests/adopted-branch-collision-snippet-fixture.test.js tests/bin-lib/issues/retry.test.js`
Expected: PASS

- [ ] **Step 5: Prove AC4.1 by reverting the check, then restore**

Delete only the `linked.some((n) => hasTombstoneEvidence(...))` check (make the judgment return the match without it), run `node --test tests/bin-lib/worktree/remote-branch-collision.test.js`, and confirm the four tests named in Step 1 fail (AC4.1): the tombstone case on its `calls` assertion, the other three on a non-null result. Restore the line in the same step and re-run: PASS. Quote the raw failing-test names in the report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/issues/retry.js plugin/bin/lib/worktree/remote-branch-collision.js tests/bin-lib/worktree/remote-branch-collision.test.js tests/adopted-branch-collision-snippet-fixture.test.js tests/bin-lib/issues/retry.test.js
git commit -m "Require tombstone evidence before adopting a closed PR's branch — refs #4058"
```

### Task 2: State the condition in the collision check and its docs

**Role:** integration

**Files:**
- Modify: `plugin/skills/build/adopted-branch-collision-check.md`
- Modify: `docs/skill-graph.md:268`
- Modify: `docs/journeys/retry-a-record-whose-first-attempt-left-a-branch-3887.md:30`
- Test: `tests/adopted-branch-collision-prose-conformance.test.js`

Behavior-change sweep, classified as no change because the sentence stays true (each says "own failed earlier attempt" or "prior attempt", which now just has a stricter test): `plugin/skills/build/worktree-setup.md`'s collision paragraph, `plugin/skills/_shared/pr-early-run-lifecycle.md:134`, `plugin/skills/build/already-shipped-assessment.md:3`, `plugin/skills/dispatch/settle-and-merge.md:183`, `docs/plugin-structure.md:106`.

Headroom: `adopted-branch-collision-check.md` is well under `RAIL_BYTES` (52,500).

**Interfaces:**
- Consumes: Task 1's `TOMBSTONE_CLOSE_WINDOW_MS`, and the `findPriorAttemptPr` call the snippet makes without a reader.

- [ ] **Step 1: Write the failing test**

In `tests/adopted-branch-collision-prose-conformance.test.js`, add a `SETTLE = read('plugin', 'skills', 'dispatch', 'settle-and-merge.md')` and:

```js
function assertTombstoneEvidence(text) {
  const t = norm(text);
  const item5 = t.slice(t.indexOf('5. `prior-attempt`'));
  assert.match(item5, /`Attempt \{N\} failed`/);
  assert.match(item5, /isTrustedComment/);
  assert.match(item5, /closedAt/);
  assert.match(item5, /TOMBSTONE_CLOSE_WINDOW_MS/);
  assert.match(item5, /the only producer/);
  assert.match(item5, /human/);
  assert.match(item5, /newest closed PR/);
}
test('#4058: item 5 states the tombstone-evidence condition', () => assertTombstoneEvidence(CHECK));
test('#4058 go-red: the assertion throws once the evidence clause is removed', () => {
  assert.throws(() => assertTombstoneEvidence(CHECK.replace(/TOMBSTONE_CLOSE_WINDOW_MS/g, 'WINDOW')));
});
test('#4058: settle posts the attempt comment on the issue before it closes the PR', () => {
  const posted = SETTLE.indexOf('gh issue comment "$ISSUE" --body-file "$ATTEMPT_COMMENT_BODY"');
  const closed = SETTLE.indexOf('gh pr close {pr-number} --repo {owner}/{repo}');
  assert.ok(posted !== -1 && closed !== -1 && posted < closed);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/adopted-branch-collision-prose-conformance.test.js`
Expected: FAIL (`#4058: item 5 states the tombstone-evidence condition`)

- [ ] **Step 3: Edit the prose**

Item 5 of `adopted-branch-collision-check.md`: keep the existing conditions and add the new one, as a clause after the ancestry one: the record's issue carries a trusted (`isTrustedComment`) `Attempt {N} failed` comment created no more than `TOMBSTONE_CLOSE_WINDOW_MS` before the PR's `closedAt`, and not after it. Name dispatch's failure path (`dispatch/settle-and-merge.md` Step 6 step 5, which posts that comment and then closes the PR) as the only producer of the `prior-attempt` shape. State why: a PR a human closed to reject the approach has every other property, so timing against a fresh attempt comment is the discriminator. Extend "Anything else" with: a closed PR with no such comment, a comment older than the window (an earlier failure, then a retry that reopened the PR, then a human closed it), an untrusted author, or a failed comment lookup. Add that a tombstone from before #1963, with attempt comments only on the PR, stops as `foreign` by design. State Reading A: only the newest closed PR on the branch is judged, so a newer PR a human closed stops the run as `foreign` even when an older PR on the branch is a genuine tombstone. Add one sentence for the transient case (plan review, low row 3): a failed comment read renders the same `foreign` card as a human-closed PR, so when the card names a closed PR whose issue does carry a fresh `Attempt {N} failed` comment, re-run the build once before choosing an option.

Snippet: add one comment line above the `const prior` line, with no `$`, no backtick and no `{`:

`// findPriorAttemptPr judges only the newest closed PR and reads its linked records' comments: without failure-tombstone evidence (item 5), or on a failed read, it returns null.`

`docs/skill-graph.md:268`: extend the shape with "the newest closed PR on the branch, whose record carries a trusted `Attempt {N} failed` issue comment within `TOMBSTONE_CLOSE_WINDOW_MS` before its `closedAt`", and add to the consequence sentence that reordering or dropping Settle's comment-then-close turns every retry into a `foreign` stop.

`docs/journeys/retry-a-record-whose-first-attempt-left-a-branch-3887.md:30`: add the same condition to the action, and that a PR without that comment, such as one a human closed, stops as `foreign`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/adopted-branch-collision-prose-conformance.test.js tests/adopted-branch-collision-snippet-fixture.test.js tests/dispatch-retry-prior-attempt-conformance.test.js tests/bin-lib/worktree/remote-branch-collision.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/adopted-branch-collision-check.md docs/skill-graph.md docs/journeys/retry-a-record-whose-first-attempt-left-a-branch-3887.md tests/adopted-branch-collision-prose-conformance.test.js
git commit -m "State the tombstone-evidence condition in the collision check — refs #4058"
```

## Controller check before the whole-branch review

Run the finished reader over real input from a scratch script: `findPriorAttemptPr` with the real `readIssueComments` and a stubbed `git`, against real `gh pr view` rows for #3885 (record 3488, expected match, comment 5s before close), #4871 (record 4848, expected `null`), and #4457 (record 4343, expected `null`). Log the outcome as an `AC evidence` entry.
