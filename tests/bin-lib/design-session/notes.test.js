'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  MAX_ROUNDS, PERSPECTIVES, OUTCOMES, parseNotes, checkNotes,
} = require('../../../plugin/bin/lib/design-session/notes');

function round(n, status, entries) {
  return [`# Perspective notes — round ${n}`, '', `Status: ${status}`, '', ...entries].join('\n');
}

const ALL_FIVE = [
  '## 1.1 — user — serious', 'Too many steps.', 'Outcome: changed — merged steps 2 and 3', '',
  '## 1.2 — smallest — minor', 'Drop the export.', 'Outcome: declined — export is the point', '',
  '## 1.3 — ownership — minor', 'Who owns the cache?', 'Outcome: accepted-risk — two writers may race', '',
  '## 1.4 — token-cost — none', '',
  '## 1.5 — introduction — minor', 'Needs a changelog line.', 'Outcome: changed — added one', '',
];

test('vocabulary constants', () => {
  assert.strictEqual(MAX_ROUNDS, 4);
  assert.deepStrictEqual(PERSPECTIVES, ['user', 'smallest', 'ownership', 'token-cost', 'introduction']);
  assert.deepStrictEqual(OUTCOMES, ['changed', 'declined', 'accepted-risk']);
});

test('parses all three outcomes and a none entry', () => {
  const r = parseNotes(round(1, 'done', ALL_FIVE));
  assert.strictEqual(r.done, true);
  assert.deepStrictEqual(r.notes, [
    { id: '1.1', perspective: 'user', severity: 'serious', outcome: 'changed' },
    { id: '1.2', perspective: 'smallest', severity: 'minor', outcome: 'declined' },
    { id: '1.3', perspective: 'ownership', severity: 'minor', outcome: 'accepted-risk' },
    { id: '1.4', perspective: 'token-cost', severity: 'none', outcome: null },
    { id: '1.5', perspective: 'introduction', severity: 'minor', outcome: 'changed' },
  ]);
  assert.deepStrictEqual(r.perspectivesRecorded, PERSPECTIVES);
  assert.deepStrictEqual(checkNotes(round(1, 'done', ALL_FIVE)), {
    ok: true, pending: [], serious: ['1.1'], missingPerspectives: [], malformed: [],
  });
});

test('a none entry is never pending and counts its perspective as recorded', () => {
  const entries = PERSPECTIVES.map((p, i) => `## 2.${i + 1} — ${p} — none`);
  const r = checkNotes(round(2, 'done', entries));
  assert.deepStrictEqual(r, { ok: true, pending: [], serious: [], missingPerspectives: [], malformed: [] });
});

test('pending, a bare outcome word, and a missing Outcome line all read null', () => {
  const text = round(1, 'in-progress', [
    '## 1.1 — user — serious', 'x', 'Outcome: pending', '',
    '## 1.2 — smallest — minor', 'x', 'Outcome: changed', '',
    '## 1.3 — ownership — minor', 'x', '',
  ]);
  const r = parseNotes(text);
  assert.strictEqual(r.done, false);
  assert.deepStrictEqual(r.notes.map((n) => n.outcome), [null, null, null]);
});

test('AC3.1: a note with no outcome blocks the next round or step', () => {
  const text = round(1, 'done', [
    '## 1.1 — user — serious', 'x', 'Outcome: pending', '',
    '## 1.2 — smallest — minor', 'x', '',
    '## 1.3 — ownership — minor', 'x', 'Outcome: declined — no', '',
  ]);
  const r = checkNotes(text);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.pending, ['1.1', '1.2']);
  assert.deepStrictEqual(r.serious, ['1.1']);
  assert.deepStrictEqual(r.missingPerspectives, ['token-cost', 'introduction']);

  // Every perspective recorded: the one pending outcome still blocks.
  const onePending = ALL_FIVE.map((l) => (l === 'Outcome: declined — export is the point' ? 'Outcome: pending' : l));
  const p = checkNotes(round(1, 'done', onePending));
  assert.deepStrictEqual([p.ok, p.pending, p.missingPerspectives], [false, ['1.2'], []]);
});

test('missing perspectives alone keep the round open', () => {
  const r = checkNotes(round(1, 'done', ALL_FIVE.slice(0, 12)));
  assert.deepStrictEqual(r.pending, []);
  assert.deepStrictEqual(r.missingPerspectives, ['token-cost', 'introduction']);
  assert.strictEqual(r.ok, false);
});

test('a malformed or unknown-perspective heading keeps the round open', () => {
  const text = round(1, 'done', [
    ...ALL_FIVE,
    '## 1.6 user serious', 'x', 'Outcome: changed — y', '',
    '## 1.7 — pre-mortem — minor', 'x', 'Outcome: changed — y', '',
  ]);
  const r = checkNotes(text);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.malformed.length, 2);
  assert.match(r.malformed[0], /^line 23: /);
  assert.deepStrictEqual(r.pending, []);
});

test('a duplicate entry id is malformed, naming the id', () => {
  const r = checkNotes(round(1, 'done', [...ALL_FIVE, '## 1.2 — smallest — minor', 'x', 'Outcome: changed — y']));
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.malformed, ['line 23: duplicate id 1.2']);
});

test('an entry id from another round is malformed, naming the id', () => {
  const entries = ALL_FIVE.map((l) => l.replace(/^## 1\.5 /, '## 3.5 '));
  const r = checkNotes(round(1, 'done', entries));
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.malformed, ['line 19: id 3.5 is not in round 1']);
});

test('the round comes from the H1; a missing or mismatched H1 is malformed', () => {
  assert.strictEqual(parseNotes(round(2, 'done', [])).round, 2);

  const noHeading = round(1, 'done', ALL_FIVE).replace('# Perspective notes — round 1', '# Notes');
  const m = checkNotes(noHeading);
  assert.strictEqual(m.ok, false);
  assert.deepStrictEqual(m.malformed, ["line 1: missing '# Perspective notes — round N' heading"]);
  assert.strictEqual(parseNotes(noHeading).round, null);

  // Round 1 file read as round 2 (the caller's expected round from the file name).
  const wrong = checkNotes(round(1, 'done', ALL_FIVE), 2);
  assert.strictEqual(wrong.ok, false);
  assert.deepStrictEqual(wrong.malformed, ['line 1: heading says round 1, expected round 2']);
  assert.strictEqual(checkNotes(round(1, 'done', ALL_FIVE), 1).ok, true);
});

test('headings and outcomes inside a fence are note text', () => {
  const text = round(1, 'done', [
    ...ALL_FIVE.slice(0, 3),
    '```', '## 1.9 — user — serious', 'Outcome: pending', '```', '',
    ...ALL_FIVE.slice(3),
  ]);
  const r = parseNotes(text);
  assert.strictEqual(r.notes.length, 5);
  assert.strictEqual(r.notes[0].outcome, 'changed');
});

test('status line and severity are whitespace- and case-tolerant', () => {
  const text = ['# Perspective notes — round 1', '', '  status:   DONE ', '## 1.1 — User — SERIOUS', 'outcome:  Declined — why'].join('\n');
  const r = parseNotes(text);
  assert.strictEqual(r.done, true);
  assert.deepStrictEqual(r.notes, [{ id: '1.1', perspective: 'user', severity: 'serious', outcome: 'declined' }]);
});

test('CRLF text parses like LF', () => {
  const lf = round(1, 'done', ALL_FIVE);
  assert.deepStrictEqual(parseNotes(lf.replace(/\n/g, '\r\n')), parseNotes(lf));
});
