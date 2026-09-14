// tests/bin-lib/issues/shipped-candidate.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyShipped } = require('../../../plugin/bin/lib/issues/shipped-candidate');

function withKeyFiles(files) {
  return `## Current State\n\nn/a\n\n## Technical Approach\n\n### Key Files\n\n${files.map((f) => `- \`${f}\` — modify`).join('\n')}\n`;
}

// ── the two observed instances (#1791/#1803, #1484/#1857) -> strong ────────

test('the #1791/#1803 shape (merged PR mentions the record, title matches) classifies strong', () => {
  const record = {
    number: 1791,
    title: 'dispatch has no pre-build check for a record whose deliverables are already shipped on main',
    createdAt: '2026-09-02T00:00:00Z',
    body: withKeyFiles(['plugin/bin/lib/hooks/context.js']),
  };
  const mentions = [
    { number: 1803, title: 'Fix dispatch pre-build check for a record already shipped on main', state: 'MERGED', merged: true, mergedAt: '2026-09-03T00:00:00Z' },
  ];
  const result = classifyShipped(record, mentions);
  assert.strictEqual(result.tier, 'strong');
  assert.strictEqual(result.pr, 1803);
  assert.ok(result.signals.includes('title-similarity'));
});

test('the #1484/#1857 shape (merged PR mentions the record, changed files cover its Key Files) classifies strong', () => {
  const record = {
    number: 1484,
    title: 'Something entirely different from the PR title',
    createdAt: '2026-08-01T00:00:00Z',
    body: withKeyFiles(['plugin/bin/lib/issues/record.js', 'plugin/skills/dispatch/queue-pull-script.md']),
  };
  const mentions = [
    { number: 1857, title: 'Unrelated PR title wording entirely', state: 'MERGED', merged: true, mergedAt: '2026-08-15T00:00:00Z' },
  ];
  const prFiles = new Map([[1857, ['plugin/bin/lib/issues/record.js', 'plugin/skills/dispatch/queue-pull-script.md', 'docs/plugin-structure.md']]]);
  const result = classifyShipped(record, mentions, { prFiles });
  assert.strictEqual(result.tier, 'strong');
  assert.strictEqual(result.pr, 1857);
  assert.ok(result.signals.includes('key-files-covered'));
});

// ── mention-only, unrelated title/files -> weak ─────────────────────────────

test('a merged PR mentioning the record ("refs #N, follow-up") with unrelated title and files classifies weak', () => {
  const record = {
    number: 42,
    title: 'Add a statusline git segment',
    createdAt: '2026-01-01T00:00:00Z',
    body: withKeyFiles(['plugin/bin/statusline.js']),
  };
  const mentions = [
    { number: 99, title: 'Unrelated cleanup pass, refs #42 follow-up', state: 'MERGED', merged: true, mergedAt: '2026-02-01T00:00:00Z' },
  ];
  const prFiles = new Map([[99, ['plugin/bin/some-other-file.js']]]);
  const result = classifyShipped(record, mentions, { prFiles });
  assert.strictEqual(result.tier, 'weak');
  assert.strictEqual(result.pr, 99);
  assert.deepStrictEqual(result.signals, ['merged-pr-mention-after-created']);
});

// ── open PR mention -> none ──────────────────────────────────────────────────

test('an open (not merged) PR mention classifies none', () => {
  const record = { number: 5, title: 'x', createdAt: '2026-01-01T00:00:00Z', body: withKeyFiles(['a.js']) };
  const mentions = [{ number: 6, title: 'x', state: 'OPEN', merged: false, mergedAt: null }];
  assert.deepStrictEqual(classifyShipped(record, mentions), { tier: 'none', pr: null, signals: [] });
});

// ── no Key Files and no title match -> never strong ─────────────────────────

test('no Key Files section and no title match can never classify strong, even with a files map', () => {
  const record = { number: 5, title: 'Completely unrelated wording here', createdAt: '2026-01-01T00:00:00Z', body: '## Current State\n\nn/a\n' };
  const mentions = [{ number: 6, title: 'Also totally different words entirely', state: 'MERGED', merged: true, mergedAt: '2026-02-01T00:00:00Z' }];
  // Even a files map claiming coverage can't fire filesCoverAll when the record's own Key Files list is empty.
  const prFiles = new Map([[6, ['anything.js']]]);
  const result = classifyShipped(record, mentions, { prFiles });
  assert.strictEqual(result.tier, 'weak');
});

// ── merged-before-createdAt is excluded entirely (not even weak) ───────────

test('a PR merged before the record was created is not a shipped-candidate signal at all', () => {
  const record = { number: 5, title: 'x', createdAt: '2026-06-01T00:00:00Z', body: withKeyFiles(['a.js']) };
  const mentions = [{ number: 6, title: 'x', state: 'MERGED', merged: true, mergedAt: '2026-01-01T00:00:00Z' }];
  assert.deepStrictEqual(classifyShipped(record, mentions), { tier: 'none', pr: null, signals: [] });
});

// ── multiple mentions: strong wins over weak regardless of order ───────────

test('when multiple mentions qualify, strong wins over weak regardless of array order', () => {
  const record = {
    number: 5,
    title: 'dispatch pre-build check for shipped records',
    createdAt: '2026-01-01T00:00:00Z',
    body: withKeyFiles(['a.js']),
  };
  const mentions = [
    { number: 6, title: 'totally unrelated wording', state: 'MERGED', merged: true, mergedAt: '2026-02-01T00:00:00Z' },
    { number: 7, title: 'dispatch pre-build check for shipped records', state: 'MERGED', merged: true, mergedAt: '2026-02-02T00:00:00Z' },
  ];
  const result = classifyShipped(record, mentions);
  assert.strictEqual(result.tier, 'strong');
  assert.strictEqual(result.pr, 7);
});

// ── no mentions at all -> none ───────────────────────────────────────────────

test('no mentions at all classifies none', () => {
  const record = { number: 5, title: 'x', createdAt: '2026-01-01T00:00:00Z', body: withKeyFiles(['a.js']) };
  assert.deepStrictEqual(classifyShipped(record, []), { tier: 'none', pr: null, signals: [] });
  assert.deepStrictEqual(classifyShipped(record, null), { tier: 'none', pr: null, signals: [] });
});
