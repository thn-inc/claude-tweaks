'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readPlanningHold, HELD_BY_LINE, BLOCK_START, BLOCK_END } = require('../../../plugin/bin/lib/issues/planning-hold');
const { untrustedSkipNote } = require('../../../plugin/bin/lib/issues/comment-trust');

// #6059: readPlanningHold over `planning.md`'s `## Hold` comment template.
const trusted = { authorAssociation: 'OWNER' };
const Q1 = ['- Question: Which store?', '  Option: Use the ref', '  Option: Use a file', '  Recommended: Use the ref'];
const Q2 = ['- Question: Retry?', '  Option: Yes', '  Option: No', '  Recommended: Yes'];

function hold(questionLines = Q1, { heldBy = HELD_BY_LINE, marker = '<!-- needs-decision: specify -->', end = BLOCK_END, gap = false } = {}) {
  return [
    marker,
    '## Decision needed',
    '**Proposed:** x',
    '**Why:** planning held',
    '**Command:** `/claude-tweaks:specify #7`',
    ...(heldBy === null ? [] : [heldBy]),
    ...(gap ? [''] : []),
    BLOCK_START,
    ...questionLines,
    ...(end === null ? [] : [end]),
  ].join('\n');
}
const at = (n) => `2026-11-22T10:00:0${n}Z`;
const c = (body, extra = {}) => ({ id: 'IC_a', url: 'https://x/1', body, createdAt: at(1), ...trusted, ...extra });

test('AC5.1: a decision comment without the Held-by line is not-planning', () => {
  const r = readPlanningHold([c(hold(Q1, { heldBy: null }))]);
  assert.equal(r.verdict, 'not-held');
  assert.equal(r.reason, 'not-planning');
});

test('AC5.2: a planning comment from an untrusted author is not a hold', () => {
  const comment = c(hold(), { authorAssociation: 'CONTRIBUTOR' });
  const r = readPlanningHold([comment]);
  assert.equal(r.verdict, 'not-held');
  assert.equal(r.reason, 'untrusted');
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0], untrustedSkipNote(comment));
});

test('Plan review Reading A: an untrusted decision comment newer than a trusted hold leaves the trusted hold deciding', () => {
  const planning = c(hold(), { id: 'IC_p', createdAt: at(1) });
  const stranger = c(hold(Q2), { id: 'IC_u', createdAt: at(2), authorAssociation: 'CONTRIBUTOR' });
  const r = readPlanningHold([planning, stranger]);
  assert.equal(r.verdict, 'held');
  assert.equal(r.comment.id, 'IC_p');
  assert.equal(r.questions[0].question, 'Which store?');
  assert.equal(r.otherUnresolved, 0);
  assert.deepEqual(r.skipped, [untrustedSkipNote(stranger)]);
});

test('held: two questions parse in order', () => {
  const r = readPlanningHold([c(hold([...Q1, ...Q2]))]);
  assert.equal(r.verdict, 'held');
  assert.equal(r.reason, null);
  assert.deepEqual(r.questions, [
    { question: 'Which store?', options: ['Use the ref', 'Use a file'], recommended: 'Use the ref' },
    { question: 'Retry?', options: ['Yes', 'No'], recommended: 'Yes' },
  ]);
  assert.deepEqual(r.comment, { id: 'IC_a', url: 'https://x/1' });
  assert.equal(r.otherUnresolved, 0);
});

test('CRLF bodies parse the same as LF', () => {
  const r = readPlanningHold([c(hold().replace(/\n/g, '\r\n'))]);
  assert.equal(r.verdict, 'held');
  assert.equal(r.questions.length, 1);
});

test('MCP shape: comment.id is node_id, not the numeric id', () => {
  const r = readPlanningHold([{ id: 123, node_id: 'IC_x', author_association: 'OWNER', created_at: at(1), body: hold() }]);
  assert.equal(r.verdict, 'held');
  assert.equal(r.comment.id, 'IC_x');
});

test('Review Focus 4: an empty block is a hold with zero questions', () => {
  const r = readPlanningHold([c(hold([]))]);
  assert.equal(r.verdict, 'held');
  assert.deepEqual(r.questions, []);
});

test('Review Focus 3: a newest planning hold beside an older unresolved backlog-grant comment is held', () => {
  const grant = c('<!-- needs-decision: backlog -->\n## Decision needed\nHeld', { id: 'IC_g', createdAt: at(1) });
  const planning = c(hold(), { id: 'IC_p', createdAt: at(2) });
  const r = readPlanningHold([grant, planning]);
  assert.equal(r.verdict, 'held');
  assert.equal(r.otherUnresolved, 1);
  assert.equal(r.comment.id, 'IC_p');

  const reversed = readPlanningHold([
    { ...grant, createdAt: at(2) },
    { ...planning, createdAt: at(1) },
  ]);
  assert.equal(reversed.verdict, 'not-held');
  assert.equal(reversed.reason, 'not-planning');
});

test('newest is chosen by timestamp, not by API position', () => {
  const older = c(hold(), { id: 'IC_old', createdAt: at(1) });
  const newer = c(hold(Q2), { id: 'IC_new', createdAt: at(5) });
  assert.equal(readPlanningHold([newer, older]).comment.id, 'IC_new');
});

test('ambiguous: two newest share a createdAt', () => {
  const r = readPlanningHold([c(hold(), { id: 'a' }), c(hold(), { id: 'b' })]);
  assert.equal(r.reason, 'ambiguous');
});

test('ambiguous: a candidate has no or an unparseable timestamp', () => {
  const noStamp = c(hold(), { createdAt: undefined });
  assert.equal(readPlanningHold([noStamp]).reason, 'ambiguous');
  assert.equal(readPlanningHold([c(hold(), { createdAt: 'not a date' })]).reason, 'ambiguous');
});

test('a resolved planning comment is not a hold', () => {
  const r = readPlanningHold([c(`**Resolved:** answered\n${hold()}`)]);
  assert.equal(r.verdict, 'not-held');
  assert.equal(r.reason, 'no-decision-comment');
});

test('no comments at all is no-decision-comment', () => {
  assert.equal(readPlanningHold([]).reason, 'no-decision-comment');
  assert.equal(readPlanningHold(undefined).reason, 'no-decision-comment');
});

test('unparseable: three Option lines', () => {
  const q = [Q1[0], Q1[1], Q1[2], '  Option: third', Q1[3]];
  assert.equal(readPlanningHold([c(hold(q))]).reason, 'unparseable');
});

test('unparseable: Recommended not the first option', () => {
  const q = [Q1[0], Q1[1], Q1[2], '  Recommended: Use a file'];
  assert.equal(readPlanningHold([c(hold(q))]).reason, 'unparseable');
});

test('unparseable: missing end marker', () => {
  assert.equal(readPlanningHold([c(hold(Q1, { end: null }))]).reason, 'unparseable');
});

test('unparseable: Held-by not directly above the block', () => {
  assert.equal(readPlanningHold([c(hold(Q1, { gap: true }))]).reason, 'unparseable');
});

test('unparseable: an empty value', () => {
  const q = [Q1[0], '  Option: ', Q1[2], '  Recommended: '];
  assert.equal(readPlanningHold([c(hold(q))]).reason, 'unparseable');
});

test('L1: Held-by under a backlog marker is not-planning (the specify-marker half alone)', () => {
  const r = readPlanningHold([c(hold(Q1, { marker: '<!-- needs-decision: backlog -->' }))]);
  assert.equal(r.verdict, 'not-held');
  assert.equal(r.reason, 'not-planning');
  // Control: the same body under the specify marker is held.
  assert.equal(readPlanningHold([c(hold(Q1))]).verdict, 'held');
});

test('L1: two start markers are unparseable', () => {
  const body = `${hold(Q1)}\n${HELD_BY_LINE}\n${BLOCK_START}\n${Q2.join('\n')}\n${BLOCK_END}`;
  assert.equal(readPlanningHold([c(body)]).reason, 'unparseable');
});

test('L2: values are trimmed before comparing and returning', () => {
  const q = ['- Question: Which store?  ', '  Option: Use the ref ', '  Option:  Use a file', '  Recommended:  Use the ref'];
  const r = readPlanningHold([c(hold(q))]);
  assert.equal(r.verdict, 'held');
  assert.deepEqual(r.questions, [{ question: 'Which store?', options: ['Use the ref', 'Use a file'], recommended: 'Use the ref' }]);
  const blank = [Q1[0], '  Option:   ', Q1[2], Q1[3]];
  assert.equal(readPlanningHold([c(hold(blank))]).reason, 'unparseable');
});

test('M1: an older unresolved specify planning hold is superseded, not another unit', () => {
  const old = c(hold(Q2), { id: 'IC_old', url: 'https://x/old', createdAt: at(1) });
  const grant = c('<!-- needs-decision: backlog -->\n## Decision needed\nHeld', { id: 'IC_g', createdAt: at(2) });
  const newest = c(hold(), { id: 'IC_new', createdAt: at(3) });
  const r = readPlanningHold([old, newest]);
  assert.equal(r.verdict, 'held');
  assert.equal(r.comment.id, 'IC_new');
  assert.equal(r.otherUnresolved, 0);
  assert.deepEqual(r.supersededHolds, [{ id: 'IC_old', url: 'https://x/old' }]);

  const mixed = readPlanningHold([old, grant, newest]);
  assert.equal(mixed.otherUnresolved, 1);
  assert.deepEqual(mixed.supersededHolds, [{ id: 'IC_old', url: 'https://x/old' }]);
});

test('M1: a specify comment without Held-by, or a Held-by under another unit, counts as another unit', () => {
  const specifyNoHeldBy = c(hold(Q2, { heldBy: null }), { id: 'IC_s', createdAt: at(1) });
  const backlogHeldBy = c(hold(Q2, { marker: '<!-- needs-decision: backlog -->' }), { id: 'IC_b', createdAt: at(2) });
  const newest = c(hold(), { id: 'IC_new', createdAt: at(3) });
  const r = readPlanningHold([specifyNoHeldBy, backlogHeldBy, newest]);
  assert.equal(r.verdict, 'held');
  assert.equal(r.otherUnresolved, 2);
  assert.deepEqual(r.supersededHolds, []);
});

test('M1: a not-held verdict carries an empty supersededHolds', () => {
  assert.deepEqual(readPlanningHold([]).supersededHolds, []);
  assert.deepEqual(readPlanningHold([c(hold(Q1, { heldBy: null }))]).supersededHolds, []);
});
