'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { checkEvidence, SOURCE_RE } = require('../../../plugin/bin/lib/design-session/evidence');

test('AC1.1: every evidence line names a source', () => {
  const text = [
    '# Evidence',
    '',
    'Status: done',
    '',
    '- Queue drains in order — source: #6352',
    '- Slug rule — source: plugin/bin/lib/worktree/name.js:20, 014fe653bf',
    '- Run — source: .claude-tweaks/pipelines/2026-11-27T180207-record-6352/work',
  ].join('\n');
  assert.deepStrictEqual(checkEvidence(text), { done: true, unsourced: [] });

  const bad = ['# E', 'Status: done', '- ok — source: #1', '- none', '- vague — source: somewhere'].join('\n');
  const r = checkEvidence(bad);
  assert.deepStrictEqual(r.unsourced, [4, 5]);
  assert.strictEqual(r.done, false);
});

test('done with no claim bullets is not done', () => {
  assert.strictEqual(checkEvidence('# E\nStatus: done\n\nno bullets').done, false);
});

test('bullets inside a fenced code block are not claims', () => {
  const text = ['# E', 'Status: done', '- a — source: #1', '```', '- example bullet', '```'].join('\n');
  assert.deepStrictEqual(checkEvidence(text), { done: true, unsourced: [] });
});

test('unsourced bullets are reported by line number', () => {
  const text = [
    '# Evidence',
    'Status: done',
    '- ok — source: #1',
    '- no source here',
    '- vague — source: somewhere',
  ].join('\n');
  const r = checkEvidence(text);
  assert.deepStrictEqual(r.unsourced, [4, 5]);
  assert.strictEqual(r.done, false);
});

test('in-progress status is not done', () => {
  const r = checkEvidence('# E\n\nStatus: in-progress\n- a — source: #1\n');
  assert.deepStrictEqual(r, { done: false, unsourced: [] });
});

test('SOURCE_RE accepts exactly the four forms', () => {
  for (const ok of ['#12', 'abcdef1', 'a/b.js:3', '.claude-tweaks/pipelines/x', '#1, abcdef1']) {
    assert.ok(SOURCE_RE.test(ok), ok);
  }
  for (const bad of ['somewhere', 'abc12', '#x', 'a.js', '']) {
    assert.ok(!SOURCE_RE.test(bad), bad);
  }
});
