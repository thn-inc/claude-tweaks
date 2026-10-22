'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findingId, parseTiebreakReply, VERDICTS, SEVERITIES } = require('../../plugin/bin/lib/tiebreak');

const WELL_FORMED = [
  'Verdict: confirmed',
  'Evidence: plugin/bin/foo.js:42 `const x = readSync(fd);`',
  'Severity: High',
  'Recommendation: file — the read is unguarded',
  'STATUS: DONE',
].join('\n');

test('findingId is stable and claim-sensitive (AC7.1)', () => {
  const base = { lens: 'correctness', path: 'plugin/bin/foo.js', line: 42, claim: 'reads fd without a guard' };
  const id = findingId(base);
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.equal(findingId({ ...base }), id);
  assert.equal(findingId({ ...base, claim: '  reads fd   without\na guard ' }), id);
  assert.notEqual(findingId({ ...base, claim: 'writes fd without a guard' }), id);
  assert.notEqual(findingId({ ...base, lens: 'security' }), id);
  assert.notEqual(findingId({ ...base, line: 43 }), id);
});

test('exports the verdict and severity sets', () => {
  assert.deepEqual(VERDICTS, ['confirmed', 'refuted', 'cant-tell']);
  assert.deepEqual(SEVERITIES, ['critical', 'high', 'medium', 'low', 'info']);
});

test('parses a well-formed reply (AC1.1)', () => {
  assert.deepEqual(parseTiebreakReply(WELL_FORMED), {
    parse: 'ok',
    verdict: 'confirmed',
    evidence: { path: 'plugin/bin/foo.js', line: 42, quote: 'const x = readSync(fd);' },
    severity: 'high',
    recommendation: 'file',
    recommendationReason: 'the read is unguarded',
    status: 'DONE',
  });
});

test('parses reason separators, quote wrappers, and out-of-set severity', () => {
  const r = parseTiebreakReply([
    'verdict: REFUTED',
    'evidence: a/b.js:7 "return null;"',
    'severity: catastrophic',
    'recommendation: drop: guarded two lines up',
    'status: done',
  ].join('\n'));
  assert.equal(r.parse, 'ok');
  assert.equal(r.verdict, 'refuted');
  assert.deepEqual(r.evidence, { path: 'a/b.js', line: 7, quote: 'return null;' });
  assert.equal(r.severity, null);
  assert.equal(r.recommendation, 'drop');
  assert.equal(r.recommendationReason, 'guarded two lines up');
  assert.equal(r.status, 'DONE');
  const dash = parseTiebreakReply('Verdict: cant-tell\nRecommendation: drop - no evidence\nSTATUS: DONE');
  assert.equal(dash.recommendationReason, 'no evidence');
  assert.equal(dash.evidence, null);
});

test('could-not-parse: empty reply (AC6.1)', () => {
  for (const text of ['', '   \n\n', null, undefined]) {
    const r = parseTiebreakReply(text);
    assert.equal(r.parse, 'could-not-parse');
    assert.equal(r.verdict, null);
  }
});

test('could-not-parse: no Verdict line (AC6.1)', () => {
  const r = parseTiebreakReply('Evidence: a.js:1 x\nSeverity: low\nSTATUS: DONE');
  assert.equal(r.parse, 'could-not-parse');
  assert.equal(r.verdict, null);
});

test('could-not-parse: Verdict value outside the set (AC6.1)', () => {
  for (const v of ['maybe', 'confirmed-ish', '']) {
    const r = parseTiebreakReply(`Verdict: ${v}\nSTATUS: DONE`);
    assert.equal(r.parse, 'could-not-parse');
    assert.equal(r.verdict, null);
  }
});

test('could-not-parse: no trailing STATUS line (AC6.1)', () => {
  const missing = parseTiebreakReply('Verdict: confirmed\nSeverity: low');
  assert.equal(missing.parse, 'could-not-parse');
  assert.equal(missing.verdict, null);
  const narrated = parseTiebreakReply(`${WELL_FORMED}\nHope that helps.`);
  assert.equal(narrated.parse, 'could-not-parse');
  assert.equal(narrated.verdict, null);
});

test('non-DONE status parses ok (AC6.1)', () => {
  const r = parseTiebreakReply('Verdict: cant-tell\nSTATUS: BLOCKED');
  assert.equal(r.parse, 'ok');
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.verdict, 'cant-tell');
});
