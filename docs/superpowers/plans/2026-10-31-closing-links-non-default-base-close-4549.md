# Close Fixes records on a non-default base (#4549) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a `pr-first` run PR merges into an integration branch that is not the repo's default branch, `closing-links.js --mode post-merge` closes the still-open `Fixes` records itself, reports them, and builds `closingSet[]` from confirmed-closed records; the shared contracts stop claiming a merge-commit message makes keywords work on any branch.

**Architecture:** One new pass at the end of `closing-links.js`'s existing post-merge branch, after the keep-open reopen loop, reading `baseRefName` plus the PR repo's default branch through the injected `deps.gh`. Prose in `_shared/pr-first-merge.md` Step 3 and `_shared/pr-first-merge-post-merge.md` Steps 4.0/4.0b follows the new envelope.

**Tech Stack:** Node 18+ CommonJS CLI, `node --test`, Markdown skill contracts.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T095259-spec-4549-4550-4556/spec-4549/work/4549-spec.md`

Scope keywords: closingSet, close-pending

## Global Constraints

- Default-base behavior (PR `baseRefName` equals the repo default branch) is unchanged, envelope and `closingSet[]` included.
- Worst-wins action order, exactly: `reopen-failed > close-failed > base-unchecked > close-pending > reopened > closed > nothing-closed` (plan review, user-decided).
- Default branch read, exactly: `gh repo view {host}/{owner}/{repo} --json defaultBranchRef -q .defaultBranchRef.name` with `host`/`owner`/`repo` from `prRepoFromUrl(pr.url)` — never `gh api` (wrong host on GHE; and `closing-links-cli.test.js:697` pins zero `api` calls on a bad-oid run).
- The base is read before the keep-open reopen loop; on a non-default base that loop does no will-close polling and reports no `pendingClose` (plan review, user-decided).
- Close comment, exactly: `Closed by claude-tweaks: PR #{n} merged into {base}, which is not the default branch, so GitHub does not act on its closing keywords.`
- AUTO reversibility for a close, exactly: `high (gh issue reopen)`. Failures are `SKIP … (degraded)` lines, reversibility `n/a` (the file's existing `degraded()` helper).
- Exit code stays 0 for every new outcome (status is data).
- Never close on an unverified premise: an unreadable default branch or `baseRefName` closes nothing and omits `closingSet[]`.
- No new prose may spell the integration-branch resolver command without citing `_shared/integration-branch.md` (`tests/integration-branch-conformance.test.js`).

## Review Focus

1. A Fixes-span record already `CLOSED` on a non-default base — must not get a second close call or a comment, yet must count in `closingSet[]` (Task 1 test `#4549 AC4.1`).
2. `baseRefName` missing or empty in the PR read (older gh, malformed response) — must behave like an unreadable default branch, never like "non-default" (Task 1 test `post-merge: a missing baseRefName is treated as unchecked`).
3. Base and default differing only by case is not realistic on GitHub; compare exact strings — no normalization (no test; decided here).
4. A record listed twice in the Fixes span — closed once (`uniqueSorted(expected)`), Task 1 test `post-merge non-default: a duplicated Fixes line closes the record once`.
5. A reopen failure and a close failure in the same run — `reopen-failed` wins the action, both lists reported (Task 1 test `post-merge: reopen-failed outranks close-failed`).

---

### Task 1: Non-default-base close pass in `closing-links.js`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/closing-links.js` (post-merge field list line ~231; new pass after the `pendingClose` block ~line 368; action precedence ~373; `closingSet` ~382; header comment lines 24-41; `USAGE` line 76)
- Modify: `tests/bin-lib/flow/closing-links-cli.test.js` (`makeDeps` fake gh: post-merge field-list matcher at line 80, new `api repos/thn-inc/claude-tweaks --jq .default_branch` and `issue close` handlers; `mergedView` default `baseRefName: 'main'`; usage-string assertion line 371)
- Modify: `docs/plugin-structure.md` line 186 (the `closing-links.js` entry: post-merge envelope fields and action vocabulary)

Return-shape widening (plan-authoring check): the post-merge envelope gains keys. Full-envelope `deepEqual` asserts in the test file (lines 232, 602, 761, 914) are all non-post-merge-success shapes (`no-fixes-span`, `not-merged`, `gh-absent`) and stay valid; no prose cites a field count.

**Interfaces:**
- Produces (envelope, post-merge, exit 0): on the default base, unchanged. On a non-default base: adds `nonDefaultBase: true`, `closed: number[]` (records this pass closed), `closeFailed: {issue, error, stage?}[]` (`stage: 'read'` for a failed state read), and `closingSet` = `uniqueSorted([...closed, ...expected records read CLOSED])`, never containing a `closeFailed` issue. When the base or default branch cannot be read: adds `baseUnchecked: true`, `action: 'base-unchecked'` (unless `reopen-failed`/`close-failed` outrank it), no `closingSet`, no close call. New `action` values `close-failed`, `base-unchecked` and `closed` in the order of the Global Constraints. On a non-default base, `willClose` is `[]` and `pendingClose` is `[]`.
- Consumed by: Task 2's prose (`closed[]`, `closeFailed[]`, `nonDefaultBase`, `baseUnchecked`, `closingSet[]`, the two new actions).

- [ ] **Step 1: Update the fake gh and fixtures, keep every existing test green**

In `makeDeps`, match the post-merge view by **either** field string — the current one and `state,mergedAt,body,closingIssuesReferences,url,mergeCommit,baseRefName` — so the pre-existing suite stays green before Step 4 changes production, and new tests fail for the intended reason (no close), never a fake-gh "unexpected" exit 5; add options `defaultBranch = 'main'`, `defaultBranchThrows = false`, `closeThrows = {}` (by issue number) and handlers: `repo view {host}/{owner}/{repo} --json defaultBranchRef -q .defaultBranchRef.name` (match `args[0] === 'repo' && args[1] === 'view'` and record `args[2]` so tests can assert the host) → `${defaultBranch}\n` (or throw), `issue close {n} --reason completed --comment {text}` → `''` (or throw `closeThrows[n]`). Add `closes: () => calls.filter((c) => c.args[0] === 'issue' && c.args[1] === 'close')`. `mergedView` gains `baseRefName: 'main'` before `...extra`.

- [ ] **Step 2: Write the failing tests**

```js
const NON_DEFAULT = { baseRefName: 'develop' };
const CLOSE_COMMENT = 'Closed by claude-tweaks: PR #7 merged into develop, which is not the default branch, so GitHub does not act on its closing keywords.';

test('#4549 AC2.1: non-default base closes an open Fixes record, AUTO logged, action closed', () => {
  // span: Fixes #3997 only; issues: { 3997: [{ state: 'OPEN', closedAt: null }] }; mergedView(b, [], NON_DEFAULT)
  // assert: closes() has one call, args exactly ['issue','close','3997','--reason','completed','--comment', CLOSE_COMMENT]
  // assert: j.closed deepEqual [3997], j.closingSet deepEqual [3997], j.nonDefaultBase === true, j.action === 'closed'
  // assert: log has exactly one line matching /^- AUTO .*closed #3997 after PR #7 merged into develop.*Reversibility: high \(gh issue reopen\)\.$/m
});
test('#4549 AC3.1: a failing close lands in closeFailed, not closingSet, degraded SKIP, exit 0', () => {
  // closeThrows: { 3997: 'HTTP 403' } → exit 0, j.closeFailed[0].issue === 3997, j.closingSet deepEqual [], j.action === 'close-failed'
  // log has one line matching /^- SKIP .*Closing links \(degraded\): condition: could not close #3997 .*→ fallback: close it by hand/m
});
test('#4549 AC4.1: an already CLOSED Fixes record gets no close call and counts in closingSet', () => {
  // issues: { 3997: [{ state: 'CLOSED', closedAt: CLOSED_BEFORE }] } → closes() empty, j.closed deepEqual [], j.closingSet deepEqual [3997], j.action === 'nothing-closed'
});
test('#4549 AC5.1: an unreadable default branch closes nothing and omits closingSet', () => {
  // defaultBranchThrows: true → closes() empty, j.baseUnchecked === true, j.action === 'base-unchecked', !('closingSet' in j), no issue view for 3997,
  // log has one degraded SKIP naming #3997 as unchecked
});
test('post-merge: a missing baseRefName is treated as unchecked', () => {
  // mergedView(b, [], { baseRefName: undefined }) → same assertions as AC5.1, and no `repo view` call is made
});
test('post-merge: a GitHub Enterprise PR reads the default branch from its own host', () => {
  // mergedView(b, [], { ...NON_DEFAULT, url: 'https://acme.ghe.com/acme/app/pull/7' }) → the repo-view call's args[2] === 'acme.ghe.com/acme/app'; zero `api` calls besides the merge-message read
});
test('post-merge non-default: keep-open candidates are read once, never polled, never pendingClose', () => {
  // NON_DEFAULT, span with Refs #2724, messageThrows: true (every candidate would be will-close), issues: { 2724: [{ state: 'OPEN' }], 3997: [{ state: 'OPEN' }] }
  // → sleeps empty, j.willClose deepEqual [], j.pendingClose deepEqual [], j.action === 'closed'
});
test('#4549 AC6.1: the default base makes no close call and keeps the existing envelope', () => {
  // mergedView(b, [3997]) with defaultBranch 'main' → closes() empty, no 'nonDefaultBase'/'closed'/'closeFailed' keys, j.closingSet deepEqual [3997]
});
test('post-merge non-default: a duplicated Fixes line closes the record once', () => {
  // span ['Fixes #3997', 'Fixes #3997'] → closes() length 1
});
test('post-merge: reopen-failed outranks close-failed', () => {
  // non-default base, a Refs #2724 record reopen fails (existing reopenThrows fixture shape) AND closeThrows {3997} → action 'reopen-failed', both lists non-empty
});
test('post-merge non-default: a failed state read is closeFailed with stage read', () => {
  // issueThrows: { 3997: true } → j.closeFailed deepEqual [{ issue: 3997, error: <bounded text>, stage: 'read' }] (assert issue and stage), no close call
});
```

Write each test fully from these comments; reuse the file's existing `fixture`, `body({ span })`, `makeDeps`, `run([...POST, '--run', runDir], h.deps)` shapes exactly as the `#4597` closingSet tests (lines 707-767) do.

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `node --test --test-name-pattern="4549|missing baseRefName|duplicated Fixes|outranks close-failed|stage read" tests/bin-lib/flow/closing-links-cli.test.js`
Expected: FAIL (no `issue close` call is ever made; `nonDefaultBase` undefined)

- [ ] **Step 4: Implement the pass in `run()`**

Before the keep-open candidate loop (right after `span.found` is confirmed):
1. `const base = typeof pr.baseRefName === 'string' && pr.baseRefName.trim() ? pr.baseRefName.trim() : null;` then, only when `base`, read the default branch with `deps.gh(['repo', 'view', `${repo.host}/${repo.owner}/${repo.repo}`, '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'])`, trimmed; a throw or empty result leaves it `null`. `const nonDefaultBase = base && defaultBranch && base !== defaultBranch`.
2. On `nonDefaultBase`, the reopen loop's `willClose` is `[]` (no polling) and so `pendingClose` is `[]`; every candidate is still read once.

After the existing `pendingClose` block and before the action computation:
3. Either `base` or `defaultBranch` is `null` → `baseUnchecked = true`; `degraded(`could not tell whether PR #${n} merged into the default branch (${reason})`, `Fixes records #${expected.join(', #')} not checked — close any still open by hand if the base is not the default branch`)`; no closes.
4. `nonDefaultBase` → for each of `uniqueSorted(expected)`: read with the same `issue view {n} --json state,closedAt` read (no polling); a read throw → `closeFailed.push({ issue, error: errText(e), stage: 'read' })`; `CLOSED` → `alreadyClosed`; `OPEN` → `deps.gh(['issue', 'close', String(issue), '--reason', 'completed', '--comment', <Global Constraints comment>])`, push to `closed`, or on throw `closeFailed.push({ issue, error: errText(e) })`. Log one `log(`closed #${issue} after PR #${n} merged into ${base} (not the default branch ${defaultBranch}; GitHub does not act on closing keywords there)`, 'high (gh issue reopen)')` per closed record, and one `degraded(…)` per `closeFailed` entry: read → `could not read #${i} after PR #${n} merged into ${base} (${error})` / `check it and close it by hand if it is still open`; close → `could not close #${i} after PR #${n} merged into ${base} (${error})` / `close it by hand`.
5. Action: insert `close-failed` and `base-unchecked` after `reopen-failed`, and `closed` after `reopened`, per the Global Constraints order.
6. `closingSet`: unchanged expression on the default base; on the non-default base `uniqueSorted([...closed, ...alreadyClosed])`; omitted when `baseUnchecked`.
7. Envelope: spread `nonDefaultBase: true, closed, closeFailed` only on the non-default path, `baseUnchecked: true` only when unchecked.

Update the header comment's post-merge paragraph and `USAGE`'s post-merge action line to the new vocabulary; add `baseRefName` to the post-merge field list at line ~231.

- [ ] **Step 5: Run the file's whole suite**

Run: `node --test tests/bin-lib/flow/closing-links-cli.test.js tests/bin-lib/flow/closing-links.test.js`
Expected: PASS, every pre-existing test included unchanged except the usage assertion at line ~371, updated to `/reopen-failed > close-failed > base-unchecked > close-pending > reopened > closed > nothing-closed/`; then drop the old field string from the fake's matcher and re-run (still PASS).

- [ ] **Step 6: Prove discrimination, one mutant per test**

Scratch copies only — never edit the shared worktree in place (#2740): copy `plugin/bin/closing-links.js` and the test file into a scratch directory under the session scratchpad, apply each mutant there, run the test file against it, record red/green, discard. Mutants: (a) empty the non-default close body → AC2.1, AC3.1, AC4.1, duplicated-Fixes, stage-read, reopen-outranks-close tests red; (b) force `nonDefaultBase = true` → AC6.1 red; (c) treat a null `base`/`defaultBranch` as non-default instead of unchecked → AC5.1 and missing-baseRefName red; (d) use `repo.owner/repo.repo` without `repo.host` → GHE test red; (e) keep will-close polling on a non-default base → no-polling test red. Every new test must go red under at least one mutant.

- [ ] **Step 7: Update `docs/plugin-structure.md` line 186**

Post-merge sentence: add that on a base other than the default branch the CLI closes each still-open `Fixes` record (`closed[]`, `closeFailed[]`, `nonDefaultBase: true`, logged AUTO / SKIP), and that an unreadable base or default branch sets `baseUnchecked: true` and omits `closingSet`; replace the action vocabulary with the Global Constraints order.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/closing-links.js tests/bin-lib/flow/closing-links-cli.test.js docs/plugin-structure.md
git commit -m "Close Fixes records after a merge into a non-default base — closing-links.js post-merge (#4549)"
```

### Task 2: Correct the shared contracts and their pins

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md` Step 3, lines ~326-334 (the "what GitHub scans for closing keywords on a non-default integration branch … any integration branch" sentence)
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md` Step 4.0 (report `closeFailed[]`; describe the close) and Step 4.0b (non-default gate paragraph lines ~41-46; `$CLOSING_SUB_ISSUES` bullet; the "only an exit-0 `post-merge` action carries" action list; the "when `closingSet[]` is absent" skip list)
- Modify: `docs/journeys/close-a-below-floor-decomposition-parent-4466.md` line 49 (states Step 4.0b does nothing on a non-default branch) and line 51 (the list of reasons a Step 4.0 result has no `closingSet` — add `base-unchecked`)
- Modify: `tests/below-floor-parent-close-conformance.test.js` (pins at ~251 non-default no-op, ~324 `CLOSING_SET_READ`, ~337 action list)
- Modify: `tests/closing-links-prose-conformance.test.js` (new pins below)
- No change (swept, still accurate): `plugin/skills/wrap-up/execution-and-verification.md:28`, `plugin/skills/_shared/issue-claims.md:525`, `plugin/skills/flow/multispec-console-template.md:131`, `plugin/skills/init/bootstrap/step-16-non-default-branch-issue-tracking.md`, `plugin/skills/_shared/express-lane.md`, `plugin/skills/_shared/pr-checklist-refresh.md` (pre-merge only), `docs/journeys/keep-a-deferred-record-open-when-its-bundle-pr-merges-4199.md` (lists actions it observed; `nothing-closed` still valid)
- Reference only (no change): `plugin/skills/_shared/integration-branch.md`, `plugin/bin/lib/merge-verification.js` (its private `readDefaultBranch` is not reused — no injectable runner, reads the cwd repo), `tests/integration-branch-conformance.test.js` (run in Step 4)

**Interfaces:**
- Consumes: Task 1's envelope fields and action names verbatim.

- [ ] **Step 1: Write the failing prose pins**

In `tests/closing-links-prose-conformance.test.js`, one assertion function per behavior, each also run against a pre-change constant and expected to throw (go-red control, factored per `plan-authoring-checks.md`):

```js
test('#4549 AC1.1: Step 3 no longer claims keywords close on any integration branch', () => {
  // collapse(section(pr-first-merge.md, Step 3)) does not match /any\s+integration\s+branch/; control: the current sentence text throws
});
test('#4549 AC1.2: Step 3 says keywords close only on the default branch and points at Step 4.0', () => {
  // collapsed Step 3 includes 'only when the merge lands on the repo\'s default branch' and 'Step 4.0' (pr-first-merge-post-merge.md)
});
test('#4549 AC1.3: no plugin file still carries the any-integration-branch claim', () => {
  // walk plugin/**/*.md and plugin/bin/**/*.js, collapse whitespace, assert none matches /closing\s+work\s+on\s+any\s+integration\s+branch/
});
test('#4549 AC7.1: Step 4.0 tells the caller to report closeFailed[] for a hand close', () => {
  // collapsed Step 4.0 includes '`closeFailed[]`' and 'close it by hand'
});
test('#4549 AC7.2: Step 4.0b lists close-failed and closed and uses closingSet[] on a non-default branch', () => {
  // action list sentence includes '`reopen-failed`, `close-failed`, `close-pending`, `reopened`, `closed` or `nothing-closed`'
  // and Step 4.0b no longer contains the PR-merge non-default no-op sentence (control: the pre-change paragraph throws)
});
```

Update `below-floor-parent-close-conformance.test.js`: `CLOSING_SET_READ` and the line-337 literal take the new action list; the line-251 pin moves to the local-merge-scoped sentence written in Step 3 below (its pre-change text kept as the control).

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/closing-links-prose-conformance.test.js tests/below-floor-parent-close-conformance.test.js`
Expected: FAIL (#4549 AC1.1/1.2/1.3/7.1/7.2 and the updated below-floor literals)

- [ ] **Step 3: Rewrite the prose**

- `pr-first-merge.md` Step 3: replace the "restated here because … any integration branch" clause with: the merge commit carries the PR body's `Fixes` lines because GitHub closes records from them only when the merge lands on the repo's default branch, and the lines travel with the commit when it is later promoted; on a non-default integration branch they close nothing, and `pr-first-merge-post-merge.md`'s Step 4.0 closes those records itself.
- `pr-first-merge-post-merge.md` Step 4.0: one sentence that on a base other than the default branch the CLI also closes each still-open `Fixes` record (`closed[]`), and add `closeFailed[]` (close it by hand) to the "Whatever the `action`, report …" list; an envelope with `baseUnchecked: true` means the Fixes records were not checked — name them in the closing summary.
- Step 4.0b: scope the default-branch no-op sentence to the no-PR local merge entry only (keep the `gh repo view` command and its `_shared/integration-branch.md` citation for that entry); after a PR merge, use `closingSet[]` on either branch, because on a non-default base it lists only records Step 4.0 confirmed `CLOSED`; add `closeFailed[]` to the parents to skip and name; extend the closingSet-carrying action list to `reopen-failed`, `close-failed`, `close-pending`, `reopened`, `closed` or `nothing-closed`; add `base-unchecked` (the `baseUnchecked: true` envelope) to the reasons `closingSet[]` is absent.
- Journey 4466 line 49: Step 4.0b closes the parent after a PR merge on either branch (Step 4.0 closes the Fixes records on a non-default base); after a no-PR local merge it still does nothing unless the integration branch is the default branch. Line 51: add `base-unchecked` to the no-`closingSet` reasons.

- [ ] **Step 4: Run the prose suites and the integration-branch conformance test**

Run: `node --test tests/closing-links-prose-conformance.test.js tests/below-floor-parent-close-conformance.test.js tests/integration-branch-conformance.test.js tests/pr-first-merge.test.js tests/merge-subject-composer-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge.md plugin/skills/_shared/pr-first-merge-post-merge.md docs/journeys/close-a-below-floor-decomposition-parent-4466.md tests/closing-links-prose-conformance.test.js tests/below-floor-parent-close-conformance.test.js
git commit -m "Correct the closing-keyword contract for non-default integration branches — pr-first-merge Steps 3, 4.0, 4.0b (#4549)"
```

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1, AC1.2, AC1.3 | Task 2 tests `#4549 AC1.1`, `#4549 AC1.2`, `#4549 AC1.3` |
| AC2.1 | Task 1 test `#4549 AC2.1` |
| AC3.1 | Task 1 test `#4549 AC3.1` |
| AC4.1 | Task 1 test `#4549 AC4.1` |
| AC5.1 | Task 1 test `#4549 AC5.1` |
| AC6.1 | Task 1 test `#4549 AC6.1` plus the unchanged pre-existing suite (Task 1 Step 5) |
| AC7.1, AC7.2 | Task 2 tests `#4549 AC7.1`, `#4549 AC7.2` |
| AC8.1 | Task 1 Step 6 (revert discrimination), Task 2 go-red controls; `npm test` at /build Common Step 5 |
