'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #3887: a dispatch retry whose fresh branch collides with the record's own failed
// earlier attempt adopts that branch (build/adopted-branch-collision-check.md's
// `prior-attempt` state, unit-covered in the sibling collision tests). The push then
// fast-forwards and pr-early-run-lifecycle.md Step 1's CLOSED branch reopens the old
// PR — whose body still names the old run, so the reopen must rebind it before
// bin/pr-checklist.js (which refuses another run's body with exit 4) can update it.
// settle-and-merge.md's failure-tombstone step must say the kept branch is adopted.
// Read live: just-shipped prose expected to evolve with the files it mirrors.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const norm = (text) => text.replace(/\s+/g, ' ');

const PR_EARLY = read('plugin', 'skills', '_shared', 'pr-early-run-lifecycle.md');
const SETTLE = read('plugin', 'skills', 'dispatch', 'settle-and-merge.md');
const CHECK = read('plugin', 'skills', 'build', 'adopted-branch-collision-check.md');
const SHIPPED = read('plugin', 'skills', 'build', 'already-shipped-assessment.md');

const REBIND_SENTENCE = /\*\*Rebind a retry's body \(#3887\)\.\*\*.*?Reversibility: high\./s;
const SETTLE_SENTENCE = /A retry adopts that branch \(.*?so the failure reason may say a plan commit is kept for the retry\./s;
const SHIPPED_SENTENCE = /After a `prior-attempt` adoption.*?never evidence the record shipped\. /s;
const CHECK_SHIPPED_SENTENCE = /After this adoption, "already shipped".*?never evidence the record shipped\./s;
const GH_ABSENT_SENTENCE = /With `gh` absent there is no PR lookup.*?tracked follow-up \(#3915\)\./s;
const MCP_REBIND_SENTENCE = /With `gh` absent, write the same body via .*?section\)\. /s;
const STALE_CLAUSE = 'just never for a same-name-collision retry anymore';

function assertRebind(text) {
  const t = norm(text);
  assert.match(t, /Rebind a retry's body/);
  assert.match(t, /gh pr edit \{number\}/);
  assert.match(t, /--body-file/);
  assert.match(t, /bin\/pr-checklist\.js/);
  assert.match(t, /exit 4/);
  assert.match(t, /prior-attempt/);
  assert.match(t, /PR-early run lifecycle: rebound reopened PR #\{number\} to run \{run-id\}/);
  assert.match(t, /rebind it unconditionally/);
  assert.match(t, /"Skipped when Step 1 found a reusable open PR" header does not apply to this compose/);
  assert.match(t, /Rebind a retry's body.*?mcp__github__update_pull_request.*?github-write-transport\.md.*?Exception: PR create\/update \(#929\)" section.*?Reversibility: high\./);
}

function assertSettle(text) {
  const t = norm(text);
  assert.match(t, /A retry adopts that branch/);
  assert.match(t, /build\/adopted-branch-collision-check\.md/);
  assert.match(t, /prior-attempt/);
  assert.match(t, /plan commit/);
  assert.doesNotMatch(t, /name its sha/);
  const at = t.indexOf('A retry adopts that branch');
  const composeStart = t.indexOf('5. Compose the failure comment');
  const tempPaths = t.indexOf("Resolve this run's session-scoped temp paths first", composeStart);
  assert.ok(composeStart !== -1 && at > composeStart && at < tempPaths, 'adopt sentence must open step 5, before the reason is composed');
}

function assertCollisionParagraph(text) {
  const t = norm(text);
  assert.match(t, /That holds on the creation path only/);
  assert.match(t, /own failed earlier attempt/);
  assert.match(t, /That check adopts the record's own failed earlier attempt/);
  assert.ok(!t.includes(STALE_CLAUSE), 'the creation-path clause must not contradict the adopt-path sentence');
}

function assertShippedAgainstOrigin(text, { diffClause }) {
  const t = norm(text);
  assert.match(t, /against `origin\/\{integration-branch\}` only/);
  assert.match(t, /never evidence the record shipped/);
  if (diffClause) assert.match(t, /git diff origin\/\{integration-branch\}\.\.\.HEAD/);
}

function assertGhAbsentLimitation(text) {
  const t = norm(text);
  assert.match(t, /With `gh` absent there is no PR lookup/);
  assert.match(t, /stays `foreign` and stops \(fail closed\)/);
  assert.match(t, /MCP-fed lookup is a tracked follow-up/);
}

test('AC1.1: a reopened retry PR is rebound to this run before any checklist update', () => {
  assertRebind(PR_EARLY);
});

test('the rebind sits inside Step 1, before Step 2\'s push', () => {
  const rebind = PR_EARLY.indexOf("Rebind a retry's body");
  const reopen = PR_EARLY.indexOf('**Reopen succeeds:**');
  const step2 = PR_EARLY.indexOf('### Step 2: Push the branch');
  assert.ok(reopen !== -1 && rebind > reopen && rebind < step2, 'rebind paragraph misplaced');
});

test('AC3.1: the failure comment\'s plan-for-retry claim matches what the retry does', () => {
  assertSettle(SETTLE);
});

test('pr-early-run-lifecycle.md\'s collision paragraph states the check adopts the record\'s own prior attempt', () => {
  assertCollisionParagraph(PR_EARLY);
});

test('go-red: assertRebind throws once the rebind paragraph is removed', () => {
  const stripped = PR_EARLY.replace(REBIND_SENTENCE, '');
  assert.notStrictEqual(stripped, PR_EARLY, 'control did not remove anything');
  assert.throws(() => assertRebind(stripped));
});

test('go-red: assertSettle throws once the adopt sentence is removed', () => {
  const stripped = norm(SETTLE).replace(SETTLE_SENTENCE, '');
  assert.notStrictEqual(stripped, norm(SETTLE), 'control did not remove anything');
  assert.throws(() => assertSettle(stripped));
});

test('go-red: assertCollisionParagraph throws once the prior-attempt clause is removed', () => {
  const stripped = norm(PR_EARLY).replace(/own failed earlier attempt/g, 'x');
  assert.notStrictEqual(stripped, norm(PR_EARLY), 'control did not remove anything');
  assert.throws(() => assertCollisionParagraph(stripped));
});

test('an adopted prior attempt is never evidence the record already shipped (already-shipped-assessment.md)', () => {
  assertShippedAgainstOrigin(SHIPPED, { diffClause: true });
});

test('the adoption item states the same already-shipped rule (adopted-branch-collision-check.md item 5)', () => {
  assertShippedAgainstOrigin(CHECK, { diffClause: false });
});

test('the adoption item states the gh-absent limitation plainly', () => {
  assertGhAbsentLimitation(CHECK);
});

test('go-red: assertShippedAgainstOrigin throws once the already-shipped-assessment sentence is removed', () => {
  const without = norm(SHIPPED).replace(SHIPPED_SENTENCE, '');
  assert.notStrictEqual(without, norm(SHIPPED), 'control did not remove anything');
  assert.throws(() => assertShippedAgainstOrigin(without, { diffClause: true }));
});

test('go-red: assertShippedAgainstOrigin throws once item 5\'s sentence is removed', () => {
  const without = norm(CHECK).replace(CHECK_SHIPPED_SENTENCE, '');
  assert.notStrictEqual(without, norm(CHECK), 'control did not remove anything');
  assert.throws(() => assertShippedAgainstOrigin(without, { diffClause: false }));
});

test('go-red: assertGhAbsentLimitation throws once the limitation sentence is removed', () => {
  const without = norm(CHECK).replace(GH_ABSENT_SENTENCE, '');
  assert.notStrictEqual(without, norm(CHECK), 'control did not remove anything');
  assert.throws(() => assertGhAbsentLimitation(without));
});

test('go-red: assertRebind throws once the MCP equivalent is removed', () => {
  const without = norm(PR_EARLY).replace(MCP_REBIND_SENTENCE, '');
  assert.notStrictEqual(without, norm(PR_EARLY), 'control did not remove anything');
  assert.throws(() => assertRebind(without));
});

test('go-red: assertCollisionParagraph throws once the stale creation-path clause is restored', () => {
  const stale = norm(PR_EARLY).replace('That check adopts', `${STALE_CLAUSE}. That check adopts`);
  assert.notStrictEqual(stale, norm(PR_EARLY), 'control did not change anything');
  assert.throws(() => assertCollisionParagraph(stale));
});

test('go-red: assertSettle throws when the adopt sentence sits after the reason is composed', () => {
  const t = norm(SETTLE);
  const sentence = t.match(SETTLE_SENTENCE)[0];
  const moved = t.replace(SETTLE_SENTENCE, '').replace('Leave the branch and worktree in place;', (m) => `${m} ${sentence}`);
  assert.notStrictEqual(moved, t, 'control did not change anything');
  assert.throws(() => assertSettle(moved));
});

// Review follow-up (#3887): the three fail-safe clauses the adoption path owes
// beyond the happy path — a conflict aborts back to the foreign card, a failed
// rebind degrades, a multi-PR reopen targets the verified number.
const CONFLICT_CLAUSE = /its "ask the user" fallback does not apply in `auto`.*?take item 4's `foreign` stop card instead/s;
const REBIND_FAIL_CLAUSE = /A failed rebind \(edit rejected, network, MCP error\) is a degrade, never a stop.*?until its body names run \{run-id\}\. Reversibility: n\/a\./s;
const REOPEN_NUMBER_CLAUSE = /reopen that number, the one the collision check verified/;

function assertFailSafeClauses({ check, prEarly }) {
  assert.match(norm(check), CONFLICT_CLAUSE);
  assert.match(norm(check), /git merge --abort/);
  assert.match(norm(prEarly), REBIND_FAIL_CLAUSE);
  assert.match(norm(prEarly), REOPEN_NUMBER_CLAUSE);
}

test('the adoption path states its conflict abort, rebind degrade, and verified-number reopen', () => {
  assertFailSafeClauses({ check: CHECK, prEarly: PR_EARLY });
});

test('go-red: assertFailSafeClauses throws once any one clause is removed', () => {
  const cases = [
    { check: norm(CHECK).replace(CONFLICT_CLAUSE, ''), prEarly: PR_EARLY },
    { check: CHECK, prEarly: norm(PR_EARLY).replace(REBIND_FAIL_CLAUSE, '') },
    { check: CHECK, prEarly: norm(PR_EARLY).replace(REOPEN_NUMBER_CLAUSE, '') },
  ];
  for (const c of cases) assert.throws(() => assertFailSafeClauses(c));
  assert.notStrictEqual(cases[0].check, norm(CHECK), 'control did not remove the conflict clause');
  assert.notStrictEqual(cases[1].prEarly, norm(PR_EARLY), 'control did not remove the rebind clause');
  assert.notStrictEqual(cases[2].prEarly, norm(PR_EARLY), 'control did not remove the reopen clause');
});
