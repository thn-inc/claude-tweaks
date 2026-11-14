'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { isSampleOrdinal, sampledForDemo } = require('../../../plugin/bin/lib/issues/grant-sampling.js');
const { trustRows, MIN_SAMPLES, MIN_VERDICTS } = require('../../../plugin/bin/lib/issues/trust.js');

const MARKER = '<!-- grant-mode-audit: date=2026-08-14T09:00:12Z auto-merge=false -->';
const NO_MARKER = ['looks good, merging'];

test('isSampleOrdinal: flags exactly every Nth ordinal, driven across several cycles', () => {
  const flagged = [];
  for (let ordinal = 1; ordinal <= 25; ordinal += 1) {
    if (isSampleOrdinal(ordinal, 10)) flagged.push(ordinal);
  }
  assert.deepStrictEqual(flagged, [10, 20]);
});

test('isSampleOrdinal: default-shaped every=10 never flags ordinals 1-9', () => {
  for (let ordinal = 1; ordinal <= 9; ordinal += 1) {
    assert.strictEqual(isSampleOrdinal(ordinal, 10), false);
  }
});

test('isSampleOrdinal: non-positive or non-finite every fails closed (never flags)', () => {
  assert.strictEqual(isSampleOrdinal(10, 0), false);
  assert.strictEqual(isSampleOrdinal(10, -1), false);
  assert.strictEqual(isSampleOrdinal(10, NaN), false);
  assert.strictEqual(isSampleOrdinal(10, undefined), false);
});

test('isSampleOrdinal: rejects a non-positive or non-integer ordinal', () => {
  assert.strictEqual(isSampleOrdinal(0, 10), false);
  assert.strictEqual(isSampleOrdinal(-10, 10), false);
  assert.strictEqual(isSampleOrdinal(10.5, 10), false);
});

test('sampledForDemo: flags every Nth machine-granted merge, in closedAt order', () => {
  const merges = [];
  for (let i = 1; i <= 12; i += 1) {
    merges.push({
      number: 100 + i,
      closedAtIso: `2026-08-${String(i).padStart(2, '0')}T00:00:00Z`,
      commentBodies: [MARKER],
    });
  }
  const flagged = sampledForDemo(merges, 5);
  assert.deepStrictEqual(flagged, [
    { number: 105, ordinal: 5 },
    { number: 110, ordinal: 10 },
  ]);
});

test('sampledForDemo: excludes human-granted merges (no audit marker) from the count entirely', () => {
  const merges = [
    { number: 1, closedAtIso: '2026-08-01T00:00:00Z', commentBodies: [MARKER] }, // machine, ordinal 1
    { number: 2, closedAtIso: '2026-08-02T00:00:00Z', commentBodies: NO_MARKER }, // human — excluded
    { number: 3, closedAtIso: '2026-08-03T00:00:00Z', commentBodies: [MARKER] }, // machine, ordinal 2
  ];
  // A human-granted merge sitting between two machine ones must not shift or
  // consume an ordinal slot — the orthogonal-category regression this test
  // guards against is the human merge silently being counted as ordinal 2,
  // which would push the real second machine merge to 3 and desync the
  // sampling boundary from the population it's meant to describe.
  assert.deepStrictEqual(sampledForDemo(merges, 2), [{ number: 3, ordinal: 2 }]);
});

test('sampledForDemo: sorts out-of-order input by closedAtIso before assigning ordinals', () => {
  const merges = [
    { number: 3, closedAtIso: '2026-08-03T00:00:00Z', commentBodies: [MARKER] },
    { number: 1, closedAtIso: '2026-08-01T00:00:00Z', commentBodies: [MARKER] },
    { number: 2, closedAtIso: '2026-08-02T00:00:00Z', commentBodies: [MARKER] },
  ];
  assert.deepStrictEqual(sampledForDemo(merges, 3), [{ number: 3, ordinal: 3 }]);
});

test('sampledForDemo: empty or non-array input flags nothing', () => {
  assert.deepStrictEqual(sampledForDemo([], 10), []);
  assert.deepStrictEqual(sampledForDemo(null, 10), []);
  assert.deepStrictEqual(sampledForDemo(undefined, 10), []);
});

// #310's Deliverables state this integration must exercise #268's existing
// negative-evidence path with no new revocation code. This module never
// touches trustRows or dispositionState — it only decides which record gets
// asked for a verdict. This test is the call-count proof: recording
// demo:changes-requested on the sampled record and calling the SAME,
// unmodified trustRows import is enough to pin the class 'mixed' — no
// sampling-aware branch exists in trust.js for this to have required.
test('a sampled record given demo:changes-requested is graded by the unmodified trustRows, no new code path', () => {
  const merges = [
    { number: 1, closedAtIso: '2026-08-01T00:00:00Z', commentBodies: ['<!-- grant-mode-audit: date=2026-08-01T00:00:00Z auto-merge=true -->'] },
    { number: 2, closedAtIso: '2026-08-02T00:00:00Z', commentBodies: ['<!-- grant-mode-audit: date=2026-08-02T00:00:00Z auto-merge=true -->'] },
  ];
  const flagged = sampledForDemo(merges, 2);
  assert.deepStrictEqual(flagged, [{ number: 2, ordinal: 2 }]);

  // Build a cell large enough to clear both floors (MIN_SAMPLES, MIN_VERDICTS)
  // so the verdict isn't masked by 'insufficient-evidence' regardless of the
  // one changes-requested outcome sampling produced. Closed a day ago, inside
  // trustRows' default evaluation window on the default clock.
  const closedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const records = Array.from({ length: MIN_SAMPLES }, (_, i) => ({
    number: 100 + i,
    labels: ['by:capture', 'risk:low', i < MIN_VERDICTS - 1 ? 'demo:approved' : undefined].filter(Boolean),
    body: '',
    state: 'CLOSED',
    closedAt,
  }));
  // Record #2 is the sampled one from above; give it exactly the verdict a
  // human recording changes-requested on a sampled record would produce.
  records.push({ number: flagged[0].number, labels: ['by:capture', 'risk:low', 'demo:changes-requested'], body: '', state: 'CLOSED', closedAt });

  const rows = trustRows(records);
  const row = rows.find((r) => r.key === 'producer:capture|low');
  assert.equal(row.changesRequested, 1);
  assert.equal(row.verdict, 'mixed');
});
