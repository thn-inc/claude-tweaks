// tests/bin-lib/issues/near-duplicate.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  findNearDuplicates,
  tokenizeTitle,
  jaccard,
  isReconcileResidueTitle,
} = require('../../../plugin/bin/lib/issues/near-duplicate');

function withKeyFiles(files) {
  return `## Current State\n\nn/a\n\n## Technical Approach\n\n### Key Files\n\n${files.map((f) => `- \`${f}\` — modify`).join('\n')}\n`;
}

// ── each signal fires alone ─────────────────────────────────────────────────

test('key-files-overlap fires alone on 2+ shared paths, unrelated title/body', () => {
  const subject = { number: 1, title: 'Completely unrelated title alpha', body: withKeyFiles(['a.js', 'b.js']) };
  const record = { number: 2, title: 'Something else entirely zeta', body: withKeyFiles(['a.js', 'b.js', 'c.js']) };
  const [hit] = findNearDuplicates(subject, [record]);
  assert.ok(hit);
  assert.deepStrictEqual(hit.signals, ['key-files-overlap']);
});

test('key-files-overlap fires on a single shared path when either list has <=2 entries', () => {
  const subject = { number: 1, title: 'Grapefruit orchard survey plan', body: withKeyFiles(['a.js']) };
  const record = { number: 2, title: 'Winter hiking boot review notes', body: withKeyFiles(['a.js', 'x.js', 'y.js', 'z.js']) };
  const [hit] = findNearDuplicates(subject, [record]);
  assert.ok(hit);
  assert.deepStrictEqual(hit.signals, ['key-files-overlap']);
});

test('a single shared path does NOT fire when both lists have 3+ entries', () => {
  const subject = { number: 1, title: 'Grapefruit orchard survey plan', body: withKeyFiles(['a.js', 'b.js', 'c.js']) };
  const record = { number: 2, title: 'Winter hiking boot review notes', body: withKeyFiles(['a.js', 'x.js', 'y.js']) };
  assert.deepStrictEqual(findNearDuplicates(subject, [record]), []);
});

test('title-similarity fires alone on unrelated key files/bodies', () => {
  const subject = { number: 1, title: 'Detect near-duplicate open records before build', body: withKeyFiles(['a.js']) };
  const record = { number: 2, title: 'Detect near-duplicate open records at build time', body: withKeyFiles(['z.js']) };
  const [hit] = findNearDuplicates(subject, [record]);
  assert.ok(hit);
  assert.deepStrictEqual(hit.signals, ['title-similarity']);
});

test('body-anchor-overlap fires alone on a shared backticked symbol in Current State, unrelated titles/key files', () => {
  const subject = {
    number: 1,
    title: 'Alpha unrelated title here',
    body: '## Current State\n\nThe check lives in `bin/lib/issues/grouping.js`.\n\n## Technical Approach\n\n### Key Files\n\n- `a.js` — modify\n',
  };
  const record = {
    number: 2,
    title: 'Zeta unrelated title elsewhere',
    body: '## Current State\n\nAlso touches `bin/lib/issues/grouping.js` directly.\n\n## Technical Approach\n\n### Key Files\n\n- `z.js` — modify\n',
  };
  const [hit] = findNearDuplicates(subject, [record]);
  assert.ok(hit);
  assert.deepStrictEqual(hit.signals, ['body-anchor-overlap']);
});

// ── thresholds honoured ──────────────────────────────────────────────────────

test('title similarity below the default 0.5 threshold does not fire', () => {
  const subject = { number: 1, title: 'dispatch queue pull script', body: withKeyFiles(['a.js']) };
  const record = { number: 2, title: 'wrap-up review console summary', body: withKeyFiles(['z.js']) };
  assert.deepStrictEqual(findNearDuplicates(subject, [record]), []);
});

test('title similarity threshold is overridable via opts', () => {
  const subject = { number: 1, title: 'alpha beta gamma delta', body: withKeyFiles(['a.js']) };
  const record = { number: 2, title: 'alpha beta zeta eta', body: withKeyFiles(['z.js']) };
  // shared {alpha,beta} of union {alpha,beta,gamma,delta,zeta,eta} = 2/6 = 0.333
  assert.deepStrictEqual(findNearDuplicates(subject, [record]), []);
  const [hit] = findNearDuplicates(subject, [record], { titleSimilarityThreshold: 0.3 });
  assert.ok(hit);
  assert.deepStrictEqual(hit.signals, ['title-similarity']);
});

// ── exclusions honoured ──────────────────────────────────────────────────────

test('a record carrying parent-issue is excluded entirely', () => {
  const subject = { number: 1, title: 'dispatch pre-build duplicate check', body: withKeyFiles(['a.js', 'b.js']) };
  const record = {
    number: 2,
    title: 'dispatch pre-build duplicate check',
    body: withKeyFiles(['a.js', 'b.js']),
    labels: ['parent-issue'],
  };
  assert.deepStrictEqual(findNearDuplicates(subject, [record]), []);
});

test('a record carrying parked is excluded entirely', () => {
  const subject = { number: 1, title: 'dispatch pre-build duplicate check', body: withKeyFiles(['a.js', 'b.js']) };
  const record = {
    number: 2,
    title: 'dispatch pre-build duplicate check',
    body: withKeyFiles(['a.js', 'b.js']),
    labels: ['parked'],
  };
  assert.deepStrictEqual(findNearDuplicates(subject, [record]), []);
});

test('the subject\'s own number is excluded even if present in the records pool', () => {
  const subject = { number: 1, title: 'dispatch pre-build duplicate check', body: withKeyFiles(['a.js', 'b.js']) };
  assert.deepStrictEqual(findNearDuplicates(subject, [subject]), []);
});

test('a reconcile: residue title is excluded from the title-similarity signal only, not from key-files overlap', () => {
  const subject = { number: 1, title: 'reconcile: structurally-stuck on worktree X', body: withKeyFiles(['a.js', 'b.js']) };
  const record = { number: 2, title: 'reconcile: structurally-stuck on worktree Y', body: withKeyFiles(['a.js', 'b.js']) };
  const [hit] = findNearDuplicates(subject, [record]);
  assert.ok(hit, 'key-files-overlap must still fire for a reconcile-residue pair');
  assert.deepStrictEqual(hit.signals, ['key-files-overlap']);
});

test('isReconcileResidueTitle is case-insensitive and requires the leading colon form', () => {
  assert.strictEqual(isReconcileResidueTitle('Reconcile: structurally-stuck on X'), true);
  assert.strictEqual(isReconcileResidueTitle('reconciled the worktree'), false);
});

// ── #1821/#1224-shaped fixture: each returns the other as a candidate ───────

test('a fixture built from the #1821/#1224 shape returns each as the other\'s candidate', () => {
  const record1821 = {
    number: 1821,
    title: 'dispatch: open-linked-PR exclusion misses a merged PR mentioning the record without a closing keyword',
    body: '## Current State\n\n`bin/lib/issues/record.js`\'s `partitionByOpenLinkedPR` only reads `closedByPullRequestsReferences`.\n\n## Technical Approach\n\n### Key Files\n\n- `plugin/bin/lib/issues/record.js` — extend query\n- `plugin/skills/dispatch/queue-pull-script.md` — new step\n',
  };
  const record1224 = {
    number: 1224,
    title: 'dispatch: open linked PR exclusion misses a merged PR that mentions the record without a closing keyword',
    body: '## Current State\n\nSame root cause in `bin/lib/issues/record.js`\'s `partitionByOpenLinkedPR`.\n\n## Technical Approach\n\n### Key Files\n\n- `plugin/bin/lib/issues/record.js` — extend query\n- `plugin/skills/dispatch/queue-pull-script.md` — new step\n',
  };
  const forward = findNearDuplicates(record1821, [record1224]);
  assert.strictEqual(forward.length, 1);
  assert.strictEqual(forward[0].number, 1224);
  assert.ok(forward[0].signals.includes('key-files-overlap'));
  assert.ok(forward[0].signals.includes('title-similarity'));

  const backward = findNearDuplicates(record1224, [record1821]);
  assert.strictEqual(backward.length, 1);
  assert.strictEqual(backward[0].number, 1821);
});

// ── unrelated records return nothing ─────────────────────────────────────────

test('unrelated fixtures return []', () => {
  const subject = { number: 1, title: 'Add a statusline git segment', body: withKeyFiles(['plugin/bin/statusline.js']) };
  const record = { number: 2, title: 'Fix flaky Playwright timeout in QA harness', body: withKeyFiles(['tests/qa/timeout.test.js']) };
  assert.deepStrictEqual(findNearDuplicates(subject, [record]), []);
});

test('findNearDuplicates([]) and empty records pool both return []', () => {
  assert.deepStrictEqual(findNearDuplicates({ number: 1, title: 'x', body: '' }, []), []);
  assert.deepStrictEqual(findNearDuplicates({ number: 1, title: 'x', body: '' }, null), []);
});

// ── tokenizer / jaccard unit coverage ───────────────────────────────────────

test('tokenizeTitle strips #refs, numbers, and stop words', () => {
  const tokens = tokenizeTitle('Fix #1224 — the dispatch check for a duplicate 42 record');
  assert.ok(!tokens.includes('1224'));
  assert.ok(!tokens.includes('42'));
  assert.ok(!tokens.includes('the'));
  assert.ok(!tokens.includes('a'));
  assert.ok(!tokens.includes('for'));
  assert.ok(tokens.includes('dispatch'));
  assert.ok(tokens.includes('duplicate'));
  assert.ok(tokens.includes('record'));
});

test('jaccard of two empty token sets is 0, never throws', () => {
  assert.strictEqual(jaccard([], []), 0);
});

test('sorting: multiple candidates sort by score descending then number ascending', () => {
  const subject = {
    number: 1,
    title: 'dispatch pre-build near-duplicate check',
    body: '## Current State\n\nUses `bin/lib/issues/grouping.js`.\n\n### Key Files\n\n- `a.js` — modify\n',
  };
  const twoSignal = {
    number: 20,
    title: 'dispatch pre-build near-duplicate check',
    body: '## Current State\n\nUses `bin/lib/issues/grouping.js`.\n\n### Key Files\n\n- `z.js` — modify\n',
  };
  const oneSignalLow = {
    number: 5,
    title: 'totally unrelated',
    body: '## Current State\n\nUses `bin/lib/issues/grouping.js`.\n\n### Key Files\n\n- `y.js` — modify\n',
  };
  const oneSignalHigh = {
    number: 30,
    title: 'totally unrelated too',
    body: '## Current State\n\nUses `bin/lib/issues/grouping.js`.\n\n### Key Files\n\n- `w.js` — modify\n',
  };
  const results = findNearDuplicates(subject, [oneSignalHigh, twoSignal, oneSignalLow]);
  assert.deepStrictEqual(results.map((r) => r.number), [20, 5, 30]);
});
