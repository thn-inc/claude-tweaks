// tests/dispatch-unlanded-blocker-exclusion-fixture.test.js — #4792.
//
// #5230: the pass is pinned against the queue-pull module (plugin/bin/lib/dispatch/queue-pull.js).
// How the module calls bin/dispatch-unlanded-blockers.js -- the argv, the pool replaced on exit 0,
// the stop on a non-zero exit with dispatch-groups.json untouched and no .tmp left -- is in
// tests/bin-lib/dispatch/queue-pull.test.js (the AC2.1 malformed-blocker/unlanded-blocker test, the
// `#5227 blocker-landing` tests and the `#5230 blocker-landing` parseArgs fixture); the pass's own
// logic is pinned by tests/bin-lib/dispatch/unlanded-blockers.test.js. This suite keeps the pass's
// position and its two reasons' registry rows, the rationale in queue-pull-notes.md, and the Read
// rail on SKILL.md.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, sectionOf } = require('./helpers/conformance-asserts');
const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');
const { PASSES } = require('../plugin/bin/lib/dispatch/queue-pull');

const ROOT = path.join(__dirname, '..');
const NOTES = path.join(ROOT, 'plugin', 'skills', 'dispatch', 'queue-pull-notes.md');
const SKILL_PATH = path.join(ROOT, 'plugin', 'skills', 'dispatch', 'SKILL.md');

// Each pass must exist before the order is checked, so a renamed id fails as missing, not as a
// vacuous pass. queuePull walks PASSES in array order, so an index is a position in the pull.
function requireOrder(passes, ids) {
  const at = ids.map((id) => passes.findIndex((p) => p.id === id));
  at.forEach((idx, i) => assert.notEqual(idx, -1, `pass missing: ${ids[i]}`));
  for (let i = 1; i < ids.length; i++) {
    assert.ok(at[i] > at[i - 1], `${ids[i]} must come after ${ids[i - 1]}`);
  }
}

// The shipped pass ends by staging its Close proposals, so "after shipped" is after that staging.
const ORDER = ['shipped', 'blocker-landing', 'neighbour-in-flight'];

test('the blocker-landing pass sits after the shipped pass (and its Close-proposal staging) and before the neighbour-in-flight pass', () => {
  requireOrder(PASSES, ORDER);

  // Permutation control: both blocker-landing rows moved ahead of the shipped pass.
  const landing = PASSES.filter((p) => p.id === 'blocker-landing');
  const without = PASSES.filter((p) => p.id !== 'blocker-landing');
  const shippedAt = without.findIndex((p) => p.id === 'shipped');
  const permuted = [...without.slice(0, shippedAt), ...landing, ...without.slice(shippedAt)];
  assert.notDeepEqual(permuted, PASSES);
  assert.throws(() => requireOrder(permuted, ORDER), /must come after/);

  // Deletion control: the existence half goes red with its own message.
  assert.throws(() => requireOrder(without, ORDER), /pass missing: blocker-landing/);
});

test('AC3.1 AC4.3: the unlanded-blocker and malformed-blocker rows are removing, with no bypass, rerun on every pull, fail open, and share one call', () => {
  for (const reason of ['unlanded-blocker', 'malformed-blocker']) {
    const row = PASSES.find((p) => p.reason === reason);
    assert.ok(row, `no ${reason} row in the queue-pull registry`);
    assert.equal(row.kind, 'exclusion', reason);
    assert.equal(row.removes, true, `${reason}: removes the candidate from dispatch-groups.json`);
    assert.equal(row.bypass, false, `${reason}: no #N / #N,#M,... bypass`);
    // Recomputed on a queue-order cache hit too, so a record is eligible again on the first pull
    // after its blocker lands (or its blocker declaration can be checked).
    assert.equal(row.runsOnCacheHit, true, `${reason}: runs on a cache hit`);
    assert.equal(row.failOpen, 'open', `${reason}: a failed call lets the pull continue`);
    assert.equal(row.id, 'blocker-landing', `${reason}: written by the one shared call`);
  }
});

test("the unlanded-blocker pass's rationale lives in queue-pull-notes.md", () => {
  const notes = readText(NOTES);
  const section = sectionOf(notes, '## Where four exclusion passes sit, and why');
  for (const label of ['**Not-spec-shaped pass (#2829).**', '**Open-linked-PR pass (#1224).**', '**Named-target existence pass (#1983).**', '**Unlanded-blocker pass (#4792).**']) {
    assert.ok(section.includes(label), `section lacks ${label}`);
  }
  const paragraphs = section.split(/\n\n/);
  const last = paragraphs[paragraphs.length - 1];
  assert.ok(last.startsWith('**Unlanded-blocker pass (#4792).**'), 'the last paragraph is the unlanded-blocker one');
  const facts = [
    [/is excluded as `malformed-blocker` instead/, 'excluded as malformed-blocker'],
    [/the call re-run once without it/, 'one re-run'],
    [/Every other candidate is still checked/, 'every other candidate is still checked'],
    [/Only a whole-call failure/, 'only a whole-call failure fails open'],
    [/the `malformed-blocker` exclusions stand/, 'malformed-blocker exclusions stand'],
  ];
  const missing = missingFactsOf(facts);
  assert.deepEqual(missing(last), []);
  assertEachPatternGoesRed(last, facts, missing);
});

test('SKILL.md fits the Read rail', () => {
  const bytes = Buffer.byteLength(readText(SKILL_PATH));
  assert.ok(bytes <= RAIL_BYTES, `${path.basename(SKILL_PATH)} is ${bytes} B, over the ${RAIL_BYTES} B rail`);
});
