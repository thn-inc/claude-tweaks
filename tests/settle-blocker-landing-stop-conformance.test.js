// tests/settle-blocker-landing-stop-conformance.test.js — pins #4792: dispatch's Settle treats /flow's
// pre-claim blocker-landing stop (`ISSUE #{n}: failed:blocker-landing`) as a non-failing stop. Pins, in
// file order: settle-and-merge.md's "Blocker-landing special case (#4792)" paragraph (the gate line, the
// claimed-case release and PR tombstone, the unclaimed-case skip, the skipped failure machinery, the
// headless self-report), its placement before Settle step 1, the shared gate token with
// flow/failure-cards.md, step 5's tombstone that the claimed case runs, the pointer's immunity to the
// retry counter, and the skill-graph edge. Test-title ids (AC*) are the acceptance-criterion ids of the
// #4792 spec.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith } = require('./helpers/conformance-asserts');
const { countFailedAttempts } = require('../plugin/bin/lib/issues/retry');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const SETTLE = path.join(SKILLS, 'dispatch', 'settle-and-merge.md');
const FAILURE_CARDS = path.join(SKILLS, 'flow', 'failure-cards.md');
const SKILL_GRAPH = path.join(ROOT, 'docs', 'skill-graph.md');
const SETTLE_PREFIX = '**Blocker-landing special case (#4792).**';
const SETTLE_STEP1 = '1. The CLI in step 2 performs the ownership read itself';

// The live line of `text` starting with `prefix`. Asserts it exists.
function requireLine(text, prefix, name) {
  const line = lineStartingWith(text, prefix);
  assert.ok(line, `${name} has no line starting "${prefix}"`);
  return line;
}

const SETTLE_FACTS = [
  [/`ISSUE #\{n\}: failed:blocker-landing`/, 'AC1.1: Settle recognizes the stop by its gate line'],
  [/on an `open` or `unlanded` out-of-run blocker/, 'AC1.1: names both stopping verdicts'],
  [/treat it as a non-failing stop: the blocker, not the record, is at fault/, 'AC1.1: non-failing stop'],
  [/The claimed case is when this run's `decisions\.md` already carries a `Step 2\.8: claimed #\{n\}` line/, 'AC5.1: the claimed case keys on the Step 2.8 claim line'],
  [/a handoff continuation of either call re-ran the pre-claim checks/, 'AC6.1: the claimed case covers a second call\'s continuation too'],
  [/In the claimed case, run steps 1-2 with `--reason "failed: blocker-landing"`/, 'AC2.1: the claimed case releases the claim'],
  [/then step 5's PR tombstone and nothing else of step 5/, 'AC5.1: the claimed case runs only step 5\'s tombstone'],
  [/post the `failure`-kind pointer with the sentence `Stopped: an out-of-run blocker has not landed\. Resume with the ### Resume command in this PR body once it lands\.`/, 'AC5.1: the pointer carries the resume command'],
  [/then `gh pr close` the PR, so the record is not stranded behind the `open-pr` exclusion/, 'AC5.1: the claimed case closes the draft PR'],
  [/When step 2's ownership read exits 4 \(a successor holds the lock\), skip the tombstone too/, 'AC5.1: a successor\'s PR is never tombstoned'],
  [/Otherwise the stop came before any claim of this run's, so skip steps 1-2 and the tombstone/, 'AC2.1: no release or tombstone without a claim of this run\'s'],
  [/no `failure-check` classification/, 'AC2.1: no failure-check'],
  [/no `auto:merge`\/`auto:merge-pending` revocation/, 'AC2.1: auto:merge stays'],
  [/no attempt counted against `dispatch-retry-ceiling`/, 'AC1.1: does not count toward the retry ceiling'],
  [/no failure comment on the issue/, 'AC1.1: no failure comment'],
  [/never reaches `bot:blocked` on this stop/, 'AC1.1: never bot:blocked'],
  [/When `DISPATCH_HEADLESS=1` was set, read `_shared\/headless-self-report\.md`/, 'self-report gated on DISPATCH_HEADLESS=1'],
  [/failing-check-name `flow-step-2\.7b-blocker-landing`/, 'self-report name'],
  [/with the stop message as the diagnostic body \(the `unlanded` card, or the `open` verdict's one-line stop, which has no card\)/, 'the self-report body exists for both verdicts: an `open` stop has no card'],
];
const settleMissing = missingFactsOf(SETTLE_FACTS);

const assertSettle = (text) => assert.deepEqual(
  settleMissing(requireLine(text, SETTLE_PREFIX, 'settle-and-merge.md')),
  [],
  'the Settle special case must state every fact (#4792)',
);

test('AC1.1 AC2.1 AC5.1 AC6.1: Settle settles a blocker-landing stop as a non-failing stop (#4792)', () => {
  assertSettle(readText(SETTLE));
});

test('AC1.2: each Settle blocker-landing fact can go red', () => {
  assertEachPatternGoesRed(requireLine(readText(SETTLE), SETTLE_PREFIX, 'settle-and-merge.md'), SETTLE_FACTS, settleMissing);
});

test('AC1.2: reverting the Settle paragraph turns the suite red', () => {
  const text = readText(SETTLE);
  const chunks = text.split('\n\n');
  const kept = chunks.filter((chunk) => !chunk.startsWith(SETTLE_PREFIX));
  assert.equal(chunks.length - kept.length, 1, 'exactly one chunk must start with the Settle prefix');
  const reverted = kept.join('\n\n');
  assert.notEqual(reverted, text, 'the revert control must change the text');
  assert.throws(() => assertSettle(reverted), /settle-and-merge\.md has no line starting/);
});

test('AC1.1: the special case sits before Settle step 1', () => {
  const placed = (text) => {
    const at = text.indexOf(SETTLE_PREFIX);
    return at >= 0 && at < text.indexOf(SETTLE_STEP1);
  };
  const text = readText(SETTLE);
  assert.ok(text.includes(SETTLE_STEP1), 'Settle step 1 anchor not found');
  assert.ok(placed(text), 'the Blocker-landing special case must precede Settle step 1');

  // Control: a copy with the paragraph removed and re-inserted after the END of step 1's full line
  // must fail the same check.
  const paragraph = requireLine(text, SETTLE_PREFIX, 'settle-and-merge.md');
  const without = text.replace(`${paragraph}\n\n`, '');
  const step1End = without.indexOf('\n', without.indexOf(SETTLE_STEP1));
  assert.notEqual(step1End, -1, 'step 1 line end not found — control cannot discriminate');
  const moved = `${without.slice(0, step1End)}\n\n${paragraph}${without.slice(step1End)}`;
  assert.notEqual(moved, text, 'move anchor not found — control cannot discriminate');
  assert.ok(!placed(moved), 'a paragraph moved after step 1 must turn the placement check red');
});

test('AC1.1: Settle and failure-cards name the same gate', () => {
  const GATE = 'failed:blocker-landing';
  const paragraph = requireLine(readText(SETTLE), SETTLE_PREFIX, 'settle-and-merge.md');
  const cardsLine = requireLine(readText(FAILURE_CARDS), '| Step 2.7b blocker landing', 'failure-cards.md');
  const namesGate = (t) => t.includes(GATE);
  assert.ok(namesGate(cardsLine), 'the failure-cards routing row must name the gate token');
  assert.ok(namesGate(paragraph), 'the Settle paragraph must name the same gate token');

  // Control: a drifted Settle paragraph must fail the same check.
  const drifted = paragraph.replaceAll('blocker-landing', 'blocker-landed');
  assert.notEqual(drifted, paragraph, 'drift anchor not found — control cannot discriminate');
  assert.ok(!namesGate(drifted), 'a Settle paragraph with a drifted gate token must turn the check red');
});

// The claimed case runs step 5's tombstone, so step 5 must still carry it.
const TOMBSTONE_START = '5. Compose the failure comment';
const TOMBSTONE_END = '6. **If `ceilingHit`';
const TOMBSTONE_CHECKS = [
  ['**`run-state.json` carries a `pr` object — this is the failure tombstone**', 'step 5 lost its failure-tombstone block'],
  ['Attempt failed — see the full comment on #%s.', 'step 5 lost the generic failure pointer sentence the claimed case replaces'],
  ['gh pr close {pr-number} --repo {owner}/{repo}', 'step 5 lost the `gh pr close` the claimed case runs'],
];

function assertTombstone(text) {
  const start = text.indexOf(TOMBSTONE_START);
  const end = text.indexOf(TOMBSTONE_END);
  assert.notEqual(start, -1, 'Settle step 5 start anchor not found');
  assert.notEqual(end, -1, 'Settle step 6 start anchor not found');
  assert.ok(start < end, 'Settle step 5 must precede step 6');
  const slice = text.slice(start, end);
  for (const [needle, message] of TOMBSTONE_CHECKS) assert.ok(slice.includes(needle), message);
}

test('AC5.2: step 5 still carries the tombstone the claimed case runs', () => {
  const text = readText(SETTLE);
  assertTombstone(text);

  // Control: a copy with the `gh pr close {pr-number}` line removed must throw that check's message.
  const doctored = text.split('\n').filter((line) => !line.includes('gh pr close {pr-number}')).join('\n');
  assert.notEqual(doctored, text, 'the `gh pr close` anchor was not found — control cannot discriminate');
  assert.throws(() => assertTombstone(doctored), { message: 'step 5 lost the `gh pr close` the claimed case runs' });
});

test('AC5.1: the claimed-case pointer never counts as a failed attempt', () => {
  const paragraph = requireLine(readText(SETTLE), SETTLE_PREFIX, 'settle-and-merge.md');
  const found = paragraph.match(/pointer with the sentence `([^`]+)`/);
  assert.ok(found, 'the paragraph does not carry the pointer sentence');
  const body = `<!-- run-comment: failure -->\n\n${found[1]}`;
  assert.equal(countFailedAttempts([{ body }]), 0, 'the tombstone pointer must not count toward dispatch-retry-ceiling');

  // Counter control: the counter does count a real failed-attempt comment.
  assert.equal(countFailedAttempts([{ body: 'Attempt 1 failed: x' }]), 1, 'countFailedAttempts must count an "Attempt N failed:" body');
});

test('skill-graph names the blocker-landing Settle edge (#4792)', () => {
  const PREFIX = '| `flow/failure-cards.md` |';
  const text = readText(SKILL_GRAPH);
  const rowOf = (t) => {
    const row = lineStartingWith(t, PREFIX);
    assert.ok(row, `skill-graph.md has no line starting "${PREFIX}"`);
    return row;
  };
  const row = rowOf(text);
  for (const token of ['failed:blocker-landing', 'flow-step-2.7b-blocker-landing', 'PR tombstone']) {
    assert.ok(row.includes(token), `the skill-graph row must name ${token}`);
  }

  // Control: a copy with that line removed must fail the existence check.
  const without = text.split('\n').filter((line) => !line.startsWith(PREFIX)).join('\n');
  assert.notEqual(without, text, 'row anchor not found — control cannot discriminate');
  assert.throws(() => rowOf(without), /skill-graph\.md has no line starting/);
});
