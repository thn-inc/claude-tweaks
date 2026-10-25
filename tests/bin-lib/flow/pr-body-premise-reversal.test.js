// tests/bin-lib/flow/pr-body-premise-reversal.test.js — #3050: parsing the
// canonical `premise reversed:` decisions.md line and the idempotent,
// heading-anchored Spec-summary rewrite in plugin/bin/lib/flow/pr-body.js.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  composePrEarlyBody, parsePremiseReversals, formatReversal, reviseSpecSummary,
  PREMISE_REVERSED_MARKER, REVISION_PREFIX,
} = require('../../../plugin/bin/lib/flow/pr-body');
const { findClosingRefs } = require('../../../plugin/bin/lib/flow/closing-links');

// The exact line bin/log-decision.js writes for this marker.
const line = (text, step = 'Spec Step 3') => `- AUTO 09:35:19 — ${step}: ${text} Reversibility: high.`;

function body(summary = 'Reads the deployed commit from the health endpoint.') {
  return composePrEarlyBody({ runId: 'r1', specSummary: summary, target: '#3050', nextStep: 'build', fixesLines: ['Fixes #3050'] });
}

test('the two literals are exported verbatim', () => {
  assert.equal(PREMISE_REVERSED_MARKER, 'premise reversed:');
  assert.equal(REVISION_PREFIX, 'Revised during build:');
});

test('parsePremiseReversals reads the log-decision line shape and strips the one period formatEntry adds', () => {
  const text = [
    '## /build',
    line('premise reversed: read the deployed commit from /health → read it from the release tag.'),
    line('confirmed: the endpoint exists.'),
  ].join('\n');
  assert.deepEqual(parsePremiseReversals(text), [
    { original: 'read the deployed commit from /health', replacement: 'read it from the release tag' },
  ]);
});

test('parsePremiseReversals keeps internal periods and splits on the first arrow (Review Focus 1, 2)', () => {
  const text = line('premise reversed: v1.2 sha → ancestry → judge age on main v1.3.');
  assert.deepEqual(parsePremiseReversals(text), [{ original: 'v1.2 sha', replacement: 'ancestry → judge age on main v1.3' }]);
});

test('parsePremiseReversals dedupes repeated entries and ignores non-entry text', () => {
  const entry = line('premise reversed: A → B.');
  const text = [entry, 'premise reversed: hand-written → not an entry', entry, line('premise reversed: C → D.', 'spec #9 — Spec Step 3')].join('\n');
  assert.deepEqual(parsePremiseReversals(text), [{ original: 'A', replacement: 'B' }, { original: 'C', replacement: 'D' }]);
  assert.deepEqual(parsePremiseReversals(''), []);
});

test('a line that only quotes the marker mid-sentence is not read as a reversal', () => {
  const text = [
    line('docs sync names the `premise reversed: A → B` marker in README.', 'Common Step 6.5'),
    line('lens probe logged "premise reversed: X → Y" as a fixture.', 'review'),
    line('premise reversed: health endpoint → release tag.'),
  ].join('\n');
  assert.deepEqual(parsePremiseReversals(text), [{ original: 'health endpoint', replacement: 'release tag' }]);
});

test('formatReversal joins with a spaced U+2192 arrow', () => {
  assert.equal(formatReversal({ original: 'A', replacement: 'B' }), 'A → B');
  assert.equal(formatReversal({ original: 'A; B', replacement: 'C; D' }), 'A, B → C, D');
});

test('no reversals leaves the body byte-unchanged', () => {
  const b = body();
  const r = reviseSpecSummary({ body: b, reversals: [], summary: 'ignored' });
  assert.equal(r.body, b);
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'no-reversals');
});

test('a reversal rewrites only the Spec summary span, note line first', () => {
  const b = body();
  const r = reviseSpecSummary({ body: b, reversals: [{ original: 'health endpoint', replacement: 'release tag' }], summary: 'Reads the deployed commit from the release tag.\n' });
  assert.equal(r.changed, true);
  assert.deepEqual(r.uncovered, ['health endpoint → release tag']);
  assert.match(r.body, /### Spec summary\n\nRevised during build: health endpoint → release tag\n\nReads the deployed commit from the release tag\.\n\n### Phases\n/);
  assert.doesNotMatch(r.body, /health endpoint\.$/m);
  // everything from ### Phases on is untouched
  assert.equal(r.body.slice(r.body.indexOf('### Phases')), b.slice(b.indexOf('### Phases')));
});

test('re-running with the same reversal is idempotent — already-noted, unchanged', () => {
  const rev = [{ original: 'A', replacement: 'B' }];
  const first = reviseSpecSummary({ body: body(), reversals: rev, summary: 'New behavior.' });
  const second = reviseSpecSummary({ body: first.body, reversals: rev, summary: 'Different paragraph.' });
  assert.equal(second.changed, false);
  assert.equal(second.reason, 'already-noted');
  assert.equal(second.body, first.body);
});

test('a sibling spec\'s existing note entry survives; only the new entry is appended (Review Focus 4)', () => {
  const afterA = reviseSpecSummary({ body: body(), reversals: [{ original: 'A', replacement: 'B' }], summary: 'Run behavior v1.' }).body;
  const r = reviseSpecSummary({ body: afterA, reversals: [{ original: 'A', replacement: 'B' }, { original: 'C', replacement: 'D' }], summary: 'Run behavior v2.' });
  assert.equal(r.changed, true);
  assert.deepEqual(r.uncovered, ['C → D']);
  assert.match(r.body, /\nRevised during build: A → B; C → D\n\nRun behavior v2\.\n/);
  assert.equal((r.body.match(/Revised during build:/g) || []).length, 1);
});

test('a distinct reversal is not masked by a longer existing entry that merely contains it as a substring', () => {
  const afterXA = reviseSpecSummary({ body: body(), reversals: [{ original: 'XA', replacement: 'B' }], summary: 'Run behavior v1.' }).body;
  const r = reviseSpecSummary({ body: afterXA, reversals: [{ original: 'XA', replacement: 'B' }, { original: 'A', replacement: 'B' }], summary: 'Run behavior v2.' });
  assert.equal(r.changed, true);
  assert.deepEqual(r.uncovered, ['A → B']);
  assert.match(r.body, /\nRevised during build: XA → B; A → B\n\nRun behavior v2\.\n/);
});

test('a distinct reversal is not masked by an existing claim that itself contains the "; " separator', () => {
  const afterXY = reviseSpecSummary({ body: body(), reversals: [{ original: 'X; Y', replacement: 'Z' }], summary: 'Run behavior v1.' }).body;
  assert.match(afterXY, /\nRevised during build: X, Y → Z\n/);
  const r = reviseSpecSummary({ body: afterXY, reversals: [{ original: 'X; Y', replacement: 'Z' }, { original: 'Y', replacement: 'Z' }], summary: 'Run behavior v2.' });
  assert.equal(r.changed, true);
  assert.deepEqual(r.uncovered, ['Y → Z']);
  assert.match(r.body, /\nRevised during build: X, Y → Z; Y → Z\n\nRun behavior v2\.\n/);
});

test('missing Spec summary heading leaves the body unchanged with a reason (Review Focus 3)', () => {
  const b = 'claude-tweaks-run: r1\n\n### Phases\n\n- [ ] build\n';
  const r = reviseSpecSummary({ body: b, reversals: [{ original: 'A', replacement: 'B' }], summary: 'x' });
  assert.equal(r.body, b);
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'no-spec-summary-heading');
  assert.deepEqual(r.uncovered, ['A → B']);
});

test('an empty summary is refused — unchanged, summary-required, uncovered reported', () => {
  const b = body();
  const r = reviseSpecSummary({ body: b, reversals: [{ original: 'A', replacement: 'B' }], summary: '   ' });
  assert.equal(r.body, b);
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'summary-required');
  assert.deepEqual(r.uncovered, ['A → B']);
});

test('a CRLF body still has its Spec summary located and rewritten (Review Focus 5)', () => {
  const b = body().replace(/\n/g, '\r\n');
  const r = reviseSpecSummary({ body: b, reversals: [{ original: 'A', replacement: 'B' }], summary: 'New.' });
  assert.equal(r.changed, true);
  assert.match(r.body, /Revised during build: A → B/);
  assert.match(r.body, /### Phases/);
});

test('a trailing-space note is still recognized as already-noted, not duplicated (M2)', () => {
  const noted = body().replace('Reads the deployed commit from the health endpoint.', 'Revised during build: A → B \n\nSome paragraph.');
  const r = reviseSpecSummary({ body: noted, reversals: [{ original: 'A', replacement: 'B' }], summary: 'ignored' });
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'already-noted');
  assert.equal(r.body, noted);
});

test('a summary with a blank line is refused as summary-not-one-paragraph (M3)', () => {
  const b = body();
  const r = reviseSpecSummary({ body: b, reversals: [{ original: 'A', replacement: 'B' }], summary: 'First part.\n\nSecond part.' });
  assert.equal(r.body, b);
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'summary-not-one-paragraph');
  assert.deepEqual(r.uncovered, ['A → B']);
});

test('a summary containing a heading line is refused as summary-not-one-paragraph (M3)', () => {
  const b = body();
  const r = reviseSpecSummary({ body: b, reversals: [{ original: 'A', replacement: 'B' }], summary: '### Not a paragraph\nmore text' });
  assert.equal(r.body, b);
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'summary-not-one-paragraph');
  assert.deepEqual(r.uncovered, ['A → B']);
});

test('closing-keyword phrases in a reversal or the summary never reach the PR body, and coverage stays idempotent (#4199)', () => {
  const rev = [{ original: "the Refs line whose reason says 'closes #4233' links it", replacement: 'PR #4144 closed #2724 from prose' }];
  const first = reviseSpecSummary({ body: body(), reversals: rev, summary: 'Resolves #2724 by neutralizing.' });
  assert.equal(first.changed, true);
  assert.deepEqual(findClosingRefs(first.body).map((r) => r.number), [3050], 'only the Fixes line links');
  assert.match(first.body, /'closes issue #4233'/);
  assert.match(first.body, /closed issue #2724/);
  assert.match(first.body, /Resolves issue #2724 by neutralizing\./);
  const second = reviseSpecSummary({ body: first.body, reversals: rev, summary: 'Different paragraph.' });
  assert.equal(second.reason, 'already-noted');
  assert.equal(second.body, first.body);
});
