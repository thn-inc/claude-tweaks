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

const REBIND_SENTENCE = /\*\*Rebind a retry's body \(#3887\)\.\*\*.*?Reversibility: high\./s;
const SETTLE_SENTENCE = /A retry adopts that branch \(.*?so the failure reason may say a plan commit is kept for the retry — name its sha\./s;

function assertRebind(text) {
  const t = norm(text);
  assert.match(t, /Rebind a retry's body/);
  assert.match(t, /gh pr edit \{number\}/);
  assert.match(t, /--body-file/);
  assert.match(t, /bin\/pr-checklist\.js/);
  assert.match(t, /exit 4/);
  assert.match(t, /prior-attempt/);
  assert.match(t, /PR-early run lifecycle: rebound reopened PR #\{number\} to run \{run-id\}/);
}

function assertSettle(text) {
  const t = norm(text);
  assert.match(t, /A retry adopts that branch/);
  assert.match(t, /build\/adopted-branch-collision-check\.md/);
  assert.match(t, /prior-attempt/);
  assert.match(t, /plan commit/);
}

function assertCollisionParagraph(text) {
  const t = norm(text);
  assert.match(t, /That holds on the creation path only/);
  assert.match(t, /own failed earlier attempt/);
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
