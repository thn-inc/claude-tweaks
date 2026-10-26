'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  EXPRESS_MARKER_RE, REVIEW_COMMENT_MARKER, expressMarker, isExpressPr, selectReviewSamples, isReviewed, fixesRecords,
} = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'express', 'sampling.js'));

// Ten express merges, one per day, numbers 101..110 in merge order.
function expressMerges() {
  return Array.from({ length: 10 }, (_, i) => ({
    number: 101 + i,
    mergedAt: `2026-10-${String(i + 1).padStart(2, '0')}T12:00:00Z`,
    body: `Summary line.\n\n${expressMarker(`run-${i + 1}`)}\n\nFixes #${900 + i}`,
  }));
}

// A fixed shuffle so the test does not depend on input order matching merge order.
function shuffled(list) {
  const order = [6, 2, 9, 0, 4, 7, 1, 8, 3, 5];
  return order.map((i) => list[i]);
}

test('expressMarker renders the line EXPRESS_MARKER_RE matches; isExpressPr reads it', () => {
  assert.strictEqual(expressMarker('2026-10-25T10-00-00Z-x'), 'claude-tweaks-express: 2026-10-25T10-00-00Z-x');
  const m = `Body.\n${expressMarker('r1')}\nmore`.match(EXPRESS_MARKER_RE);
  assert.strictEqual(m && m[1], 'r1');
  assert.strictEqual(isExpressPr(`Body.\n${expressMarker('r1')}`), true);
  assert.strictEqual(isExpressPr('Body without marker'), false);
  assert.strictEqual(isExpressPr(`see claude-tweaks-express: r1 inline`), false);
  assert.strictEqual(isExpressPr('see claude-tweaks-express: r1'), false);
  assert.strictEqual(isExpressPr(undefined), false);
});

test('a CRLF body (edited in the GitHub web UI) still counts as an express PR and still names its records', () => {
  const body = `Summary.\r\n\r\n${expressMarker('r1')}\r\n\r\nFixes #12\r\nFixes #13\r\n`;
  assert.strictEqual(isExpressPr(body), true);
  assert.strictEqual(body.match(EXPRESS_MARKER_RE)[1], 'r1');
  assert.deepStrictEqual(fixesRecords(body), [12, 13]);
  const crlf = expressMerges().map((m, i) => (i === 3 ? { ...m, body: m.body.replace(/\n/g, '\r\n') } : m));
  assert.deepStrictEqual(selectReviewSamples(crlf, 5).map((s) => s.number), [105, 110], 'a CRLF body must not shift later ordinals');
});

test('ordinals follow merge time, not PR number', () => {
  // PR numbers run opposite to merge order: sorting by number would sample #91 and #90 instead.
  const merges = [
    { number: 93, mergedAt: '2026-10-01T00:00:00Z', body: expressMarker('a') },
    { number: 92, mergedAt: '2026-10-02T00:00:00Z', body: expressMarker('b') },
    { number: 91, mergedAt: '2026-10-03T00:00:00Z', body: expressMarker('c') },
    { number: 90, mergedAt: '2026-10-04T00:00:00Z', body: expressMarker('d') },
  ];
  assert.deepStrictEqual(selectReviewSamples(merges, 2).map((s) => [s.ordinal, s.number]), [[2, 92], [4, 90]]);
});

test('AC5.1: across 10 express merges, every=5 samples exactly 2', () => {
  const merges = shuffled(expressMerges());
  const five = selectReviewSamples(merges, 5);
  assert.strictEqual(five.length, 2);
  assert.deepStrictEqual(five.map((s) => s.ordinal), [5, 10]);
  assert.deepStrictEqual(five.map((s) => s.number), [105, 110]);
  assert.deepStrictEqual(five[0], { number: 105, ordinal: 5, mergedAt: '2026-10-05T12:00:00Z' });

  const three = selectReviewSamples(merges, 3);
  assert.strictEqual(three.length, 3);
  assert.deepStrictEqual(three.map((s) => s.ordinal), [3, 6, 9]);

  assert.strictEqual(selectReviewSamples(merges, 1).length, 10);
  assert.strictEqual(selectReviewSamples(merges, 11).length, 0);

  const reversed = expressMerges().reverse();
  assert.deepStrictEqual(selectReviewSamples(reversed, 5), five);
  assert.deepStrictEqual(selectReviewSamples(reversed, 3), three);
});

test('selectReviewSamples breaks a mergedAt tie by PR number', () => {
  const tied = [
    { number: 7, mergedAt: '2026-10-01T00:00:00Z', body: expressMarker('b') },
    { number: 3, mergedAt: '2026-10-01T00:00:00Z', body: expressMarker('a') },
  ];
  assert.deepStrictEqual(selectReviewSamples(tied, 1).map((s) => s.number), [3, 7]);
});

test('non-express PRs interleaved among the ten do not consume ordinals', () => {
  const plain = [
    { number: 200, mergedAt: '2026-10-02T18:00:00Z', body: 'Ordinary PR.\n\nFixes #1' },
    { number: 201, mergedAt: '2026-10-07T18:00:00Z', body: 'Another ordinary PR.' },
  ];
  const merges = shuffled(expressMerges()).concat(plain);
  assert.strictEqual(merges.length, 12);
  const out = selectReviewSamples(merges, 5);
  assert.deepStrictEqual(out.map((s) => [s.number, s.ordinal]), [[105, 5], [110, 10]]);
});

test('an express merge with an unparseable mergedAt consumes no ordinal (fail closed)', () => {
  const garbage = { number: 150, mergedAt: 'garbage', body: expressMarker('bad') };
  const baseline = selectReviewSamples(expressMerges(), 5);
  // Placed mid-list so a non-transitive comparator would actually reorder around it.
  const withGarbage = expressMerges();
  withGarbage.splice(5, 0, garbage);
  assert.deepStrictEqual(selectReviewSamples(withGarbage, 5), baseline);
  assert.deepStrictEqual(selectReviewSamples(withGarbage.slice().reverse(), 5), baseline);
  assert.deepStrictEqual(selectReviewSamples(shuffled(expressMerges()).concat(garbage), 1).map((s) => s.number),
    expressMerges().map((m) => m.number));
  const missing = { number: 151, body: expressMarker('none') };
  assert.deepStrictEqual(selectReviewSamples([missing].concat(expressMerges()), 5), baseline);
  assert.deepStrictEqual(selectReviewSamples([missing, garbage].concat(expressMerges()), 1).map((s) => s.number),
    expressMerges().map((m) => m.number));
});

test('every of 0, -1, NaN samples nothing (fail closed)', () => {
  const merges = expressMerges();
  for (const every of [0, -1, NaN]) {
    assert.deepStrictEqual(selectReviewSamples(merges, every), [], `every=${every}`);
  }
});

test('isReviewed: only a trusted comment that starts with the marker counts', () => {
  const body = `${REVIEW_COMMENT_MARKER}\nPost-merge review: no findings.`;
  assert.strictEqual(REVIEW_COMMENT_MARKER, '<!-- run-comment: express-review -->');
  assert.strictEqual(isReviewed([{ authorAssociation: 'OWNER', body }]), true);
  assert.strictEqual(isReviewed([{ author_association: 'OWNER', body }]), true);
  assert.strictEqual(isReviewed([{ authorAssociation: 'NONE', body }]), false);
  assert.strictEqual(isReviewed([{ authorAssociation: 'OWNER', body: `Quoting: ${REVIEW_COMMENT_MARKER}` }]), false);
  assert.strictEqual(isReviewed([]), false);
  assert.strictEqual(isReviewed(undefined), false);
});

test('fixesRecords returns Fixes #N line numbers in order, deduplicated', () => {
  assert.deepStrictEqual(fixesRecords('Fixes #12\nRefs #13\nFixes #14\nFixes #12'), [12, 14]);
  assert.deepStrictEqual(fixesRecords('See Fixes #5 inline'), []);
  assert.deepStrictEqual(fixesRecords(undefined), []);
});
