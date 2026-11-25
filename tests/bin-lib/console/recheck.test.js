'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..', '..');
const { RECHECK_CAP, HUNK_BYTE_CAP, EXCLUDED_LABELS, parseJudgedItems, parseChangedPaths, selectCandidates } =
  require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'recheck'));

function rec(number, files, { labels = [], items = ['Do the thing'], title = `Record ${number}` } = {}) {
  const body = [
    '### Current State', 'Something.', '',
    '## Deliverables', ...items.map((i) => `- [ ] ${i}`), '',
    '### Key Files', ...files.map((f) => `- \`${f}\``), '',
  ].join('\n');
  return { number, title, labels, body, updatedAt: '2026-11-25T00:00:00Z' };
}
const sel = (over) => selectCandidates({ openRecords: [], changedPaths: [], hubPaths: new Set(), ownRecords: [], ...over });

test('constants', () => {
  assert.equal(RECHECK_CAP, 5);
  assert.equal(HUNK_BYTE_CAP, 24000);
  assert.deepEqual(EXCLUDED_LABELS, ['parent-issue', 'bot:in-progress', 'digest']);
});

test('AC1.1: a record whose Key File is in the changed paths is a candidate', () => {
  const r = rec(10, ['plugin/a.js']);
  const out = sel({ openRecords: [r], changedPaths: ['plugin/a.js', 'x.md'] });
  assert.equal(out.candidates.length, 1);
  const c = out.candidates[0];
  assert.equal(c.number, 10);
  assert.equal(c.title, 'Record 10');
  assert.deepEqual(c.intersecting, ['plugin/a.js']);
  assert.deepEqual(c.items, ['Do the thing']);
  assert.equal(c.bodyHash, crypto.createHash('sha256').update(r.body).digest('hex'));
  assert.equal(c.updatedAt, r.updatedAt);
});

test('AC1.2: one whose Key Files are all outside is not', () => {
  const out = sel({ openRecords: [rec(10, ['plugin/b.js'])], changedPaths: ['plugin/a.js'] });
  assert.deepEqual(out, { candidates: [], overCap: [], excluded: [] });
});

test('AC2.1: parent-issue, bot:in-progress, digest and own records are excluded even when they intersect', () => {
  const out = sel({
    openRecords: [
      rec(1, ['a.js'], { labels: ['parent-issue'] }),
      rec(2, ['a.js'], { labels: [{ name: 'bot:in-progress' }] }),
      rec(3, ['a.js'], { labels: ['digest'] }),
      rec(4, ['a.js']),
    ],
    changedPaths: ['a.js'], ownRecords: [4],
  });
  assert.deepEqual(out.candidates, []);
  assert.deepEqual(out.excluded, [
    { number: 1, reason: 'label:parent-issue' },
    { number: 2, reason: 'label:bot:in-progress' },
    { number: 3, reason: 'label:digest' },
    { number: 4, reason: 'own' },
  ]);
});

test('AC2.2: a candidate whose only intersecting path is a hub is not a candidate', () => {
  const out = sel({ openRecords: [rec(5, ['hub.js'])], changedPaths: ['hub.js'], hubPaths: new Set(['hub.js']) });
  assert.deepEqual(out.candidates, []);
  assert.deepEqual(out.excluded, [{ number: 5, reason: 'hub-only' }]);
});

test('Review Focus 2: hub + non-hub intersection is a candidate with the non-hub path only', () => {
  const out = sel({ openRecords: [rec(5, ['hub.js', 'real.js'])], changedPaths: ['hub.js', 'real.js'], hubPaths: new Set(['hub.js']) });
  assert.equal(out.candidates.length, 1);
  assert.deepEqual(out.candidates[0].intersecting, ['real.js']);
});

test('AC3.1: cap N with N+2 qualifying returns N candidates and the 2 highest numbers in overCap', () => {
  const records = [9, 3, 7, 1, 5].map((n) => rec(n, ['a.js']));
  const out = sel({ openRecords: records, changedPaths: ['a.js'], cap: 3 });
  assert.deepEqual(out.candidates.map((c) => c.number), [1, 3, 5]);
  assert.deepEqual(out.overCap, [7, 9]);
});

test('default cap is RECHECK_CAP', () => {
  const records = [1, 2, 3, 4, 5, 6].map((n) => rec(n, ['a.js']));
  const out = sel({ openRecords: records, changedPaths: ['a.js'] });
  assert.equal(out.candidates.length, 5);
  assert.deepEqual(out.overCap, [6]);
});

test('AC10.1: parseChangedPaths returns both sides of R100 and a deleted path', () => {
  const ns = 'M\tplugin/m.js\nR100\told/x.js\tnew/x.js\nD\tgone.js\nM\tplugin/m.js\n';
  assert.deepEqual(parseChangedPaths(ns), ['plugin/m.js', 'old/x.js', 'new/x.js', 'gone.js']);
  assert.deepEqual(parseChangedPaths(''), []);
  const out = sel({ openRecords: [rec(8, ['old/x.js'])], changedPaths: parseChangedPaths(ns) });
  assert.deepEqual(out.candidates.map((c) => c.number), [8]);
});

test('AC12.1: a record with no parseable Deliverables or Acceptance Criteria is excluded with reason no-items', () => {
  const r = { number: 6, title: 't', labels: [], updatedAt: 'u', body: '### Key Files\n- `a.js`\n' };
  const out = sel({ openRecords: [r], changedPaths: ['a.js'] });
  assert.deepEqual(out.candidates, []);
  assert.deepEqual(out.excluded, [{ number: 6, reason: 'no-items' }]);
});

test('Review Focus 5: parseJudgedItems on a CRLF body with plain bullets returns the item texts', () => {
  const body = '## Deliverables\r\n- first item\r\n* second item\r\n- [x] third\r\n  continued here\r\n\r\n### Key Files\r\n- a.js\r\n';
  assert.deepEqual(parseJudgedItems(body), ['first item', 'second item', 'third continued here']);
});

test('parseJudgedItems falls back to Acceptance Criteria, else []', () => {
  assert.deepEqual(parseJudgedItems('## Acceptance Criteria\n- It works\n- It is fast\n'), ['It works', 'It is fast']);
  assert.deepEqual(parseJudgedItems('nothing here'), []);
  assert.deepEqual(parseJudgedItems(''), []);
});
