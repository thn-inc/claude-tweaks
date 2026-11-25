'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..', '..');
const { RECHECK_CAP, HUNK_BYTE_CAP, EXCLUDED_LABELS, parseJudgedItems, parseChangedPaths, selectCandidates,
  splitHunks, quoteFound, checkVerdicts, outcomeFor, composeProposal, parseProposal, judgeHunks } =
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

const DIFF = [
  'diff --git a/src/a.js b/src/a.js', 'index 1..2 100644', '--- a/src/a.js', '+++ b/src/a.js',
  '@@ -1,3 +1,3 @@', ' keep', '-const old = 1;', '+const next = 2;',
  '@@ -20,2 +20,3 @@', '+function  added() {}',
  'diff --git a/src/gone.js b/src/gone.js', 'deleted file mode 100644', '--- a/src/gone.js', '+++ /dev/null',
  '@@ -1,1 +0,0 @@', '-bye();', '',
].join('\n');

test('splitHunks keys hunks by +++ path, or --- path for a deletion', () => {
  const m = splitHunks(DIFF);
  assert.deepEqual([...m.keys()], ['src/a.js', 'src/gone.js']);
  assert.equal(m.get('src/a.js').length, 2);
  assert.match(m.get('src/a.js')[0], /^@@ -1,3 \+1,3 @@/);
  assert.match(m.get('src/gone.js')[0], /-bye\(\);/);
});

test('Review Focus 1: a quote spanning two hunks is false; a quote with leading - markers matches', () => {
  const hunks = splitHunks(DIFF).get('src/a.js');
  assert.equal(quoteFound('const next = 2;\nfunction added() {}', hunks), false);
  assert.equal(quoteFound('function added() {}', hunks), true);
  assert.equal(quoteFound('-const old = 1;', hunks), true);
  assert.equal(quoteFound('+const next = 2;', hunks), true);
  assert.equal(quoteFound('', hunks), false);
  assert.equal(quoteFound('   ', hunks), false);
  assert.equal(quoteFound('@@ -1,3 +1,3 @@', hunks), false);
});

test('splitHunks registers a renamed file hunks under both old and new path; a pure rename yields none', () => {
  const diff = [
    'diff --git a/old/x.js b/new/x.js', 'similarity index 90%', 'rename from old/x.js', 'rename to new/x.js',
    '--- a/old/x.js', '+++ b/new/x.js', '@@ -1 +1 @@', '-a', '+b',
    'diff --git a/old/p.js b/new/p.js', 'similarity index 100%', 'rename from old/p.js', 'rename to new/p.js', '',
  ].join('\n');
  const m = splitHunks(diff);
  assert.equal(m.get('new/x.js').length, 1);
  assert.deepEqual(m.get('old/x.js'), m.get('new/x.js'));
  assert.equal(m.has('old/p.js'), false);
  assert.equal(m.has('new/p.js'), false);
});

const V = (deliverable, verdict, quote) => ({ deliverable, verdict, quote });
const HK = ['@@ -1 +1 @@\n+alpha beta\n+gamma'];
const chk = (items, verdicts, hunks = HK) => checkVerdicts({ items, verdicts, hunks });

test('AC4.1: all satisfied stages close and the body quotes each hunk beside each item text', () => {
  const checked = chk(['Item one', 'Item two'], [V('Item one', 'satisfied', 'alpha beta'), V('2', 'satisfied', 'gamma')]);
  assert.equal(outcomeFor(checked), 'close');
  const text = composeProposal({ number: 12, title: 'T', outcome: 'close', checked, bodyHash: 'a'.repeat(64), updatedAt: 'u', runId: 'r' });
  assert.match(text, /^Title: Close #12: T\nTarget: #12\nAction: close\nBody-hash: a{64}\nUpdated-at: u\nRun: r\n\n## Comment\n/);
  assert.match(text, /Item one/);
  assert.match(text, /Item two/);
  assert.match(text, /```\nalpha beta\n```/);
});

test('AC4.2/4.3: satisfied + not-satisfied or cant-tell -> narrow', () => {
  assert.equal(outcomeFor(chk(['a', 'b'], [V('a', 'satisfied', 'alpha beta'), V('b', 'not-satisfied')])), 'narrow');
  assert.equal(outcomeFor(chk(['a', 'b'], [V('a', 'satisfied', 'alpha beta')])), 'narrow');
});

test('AC4.4/4.5: all cant-tell or all not-satisfied -> null; empty -> null', () => {
  assert.equal(outcomeFor(chk(['a', 'b'], [])), null);
  assert.equal(outcomeFor(chk(['a', 'b'], [V('a', 'not-satisfied'), V('b', 'not-satisfied')])), null);
  assert.equal(outcomeFor([]), null);
});

test('AC5.1: a satisfied quote absent from the hunks is cant-tell, turning a would-be close into narrow', () => {
  const checked = chk(['a', 'b'], [V('a', 'satisfied', 'alpha beta'), V('b', 'satisfied', 'invented text')]);
  assert.equal(checked[1].verdict, 'cant-tell');
  assert.equal(checked[1].quote, null);
  assert.equal(outcomeFor(checked), 'narrow');
});

test('AC10.2: hunks empty -> every item cant-tell, never not-satisfied', () => {
  const checked = chk(['a', 'b'], [V('a', 'satisfied', 'x'), V('b', 'not-satisfied')], []);
  assert.deepEqual(checked.map((c) => c.verdict), ['cant-tell', 'cant-tell']);
});

test('checkVerdicts: unknown verdict word and satisfied without quote are cant-tell', () => {
  const checked = chk(['a', 'b'], [V('a', 'maybe'), V('b', 'satisfied')]);
  assert.deepEqual(checked.map((c) => c.verdict), ['cant-tell', 'cant-tell']);
});

test('judgeHunks collects intersecting paths; over cap -> overCap true, no hunks', () => {
  const m = splitHunks(DIFF);
  const ok = judgeHunks(m, ['src/a.js', 'missing.js']);
  assert.equal(ok.overCap, false);
  assert.equal(ok.hunks.length, 2);
  const over = judgeHunks(m, ['src/a.js'], 10);
  assert.deepEqual(over, { hunks: [], overCap: true });
  assert.deepEqual(checkVerdicts({ items: ['a'], verdicts: [V('a', 'satisfied', 'x')], hunks: over.hunks }).map((c) => c.verdict), ['cant-tell']);
});

test('parseProposal round-trips composeProposal (also with CRLF); null on malformed headers', () => {
  const checked = chk(['a ``` b'], [V('a ``` b', 'satisfied', 'alpha beta')]);
  const text = composeProposal({ number: 7, title: 'T', outcome: 'narrow', checked, bodyHash: 'b'.repeat(64), updatedAt: '2026-11-25T00:00:00Z', runId: 'run-1' });
  const p = parseProposal(text);
  assert.equal(p.number, 7);
  assert.equal(p.action, 'narrow');
  assert.equal(p.bodyHash, 'b'.repeat(64));
  assert.equal(p.updatedAt, '2026-11-25T00:00:00Z');
  assert.equal(p.comment, text.slice(text.indexOf('## Comment') + '## Comment'.length).trim());
  assert.deepEqual(parseProposal(text.replace(/\n/g, '\r\n')), p);
  assert.equal(parseProposal(text.replace('Target: #7', 'Target: #abc')), null);
  assert.equal(parseProposal(text.replace(/^Updated-at: .*$/m, 'Updated-at: undefined')), null);
  assert.equal(parseProposal(text.replace('Action: narrow', 'Action: nuke')), null);
  assert.equal(parseProposal(text.replace('b'.repeat(64), 'b'.repeat(63))), null);
  assert.equal(parseProposal('garbage'), null);
});

test('composeProposal fences a quote containing backticks with a longer fence', () => {
  const checked = chk(['a'], [V('a', 'satisfied', 'alpha beta')]);
  checked[0].quote = 'x ```` y';
  const text = composeProposal({ number: 1, title: 'T', outcome: 'close', checked, bodyHash: 'c'.repeat(64), updatedAt: 'u', runId: 'r' });
  assert.match(text, /`{5}\nx `{4} y\n`{5}/);
});
