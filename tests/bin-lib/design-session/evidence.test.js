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
  assert.deepStrictEqual(checkEvidence(text), { done: true, unsourced: [], unclosedFence: false });

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
  assert.deepStrictEqual(checkEvidence(text), { done: true, unsourced: [], unclosedFence: false });
});

test('a tilde or longer backtick fence hides its bullets too', () => {
  for (const [open, inner, close] of [['~~~', null, '~~~'], ['````', '```', '````']]) {
    const text = ['# E', 'Status: done', '- a — source: #1', open, inner, '- example bullet', inner, close].filter((l) => l !== null).join('\n');
    assert.deepStrictEqual(checkEvidence(text), { done: true, unsourced: [], unclosedFence: false }, open);
  }
});

test('the Status line parses as notes.js parses it: indented, and with no H1', () => {
  assert.strictEqual(checkEvidence('# E\n\n  status:  DONE \n- a — source: #1\n').done, true);
  assert.strictEqual(checkEvidence('Status: done\n- a — source: #1\n').done, true);
});

test('a fence that is never closed leaves the evidence not done', () => {
  const only = ['# E', 'Status: done', '```', '- a — source: #1'].join('\n');
  assert.strictEqual(checkEvidence(only).done, false);
  // A sourced claim before the open fence must not let the swallowed bullets pass.
  const after = ['# E', 'Status: done', '- a — source: #1', '```', '- unsourced claim'].join('\n');
  assert.deepStrictEqual(checkEvidence(after), { done: false, unsourced: [], unclosedFence: true });
  assert.strictEqual(checkEvidence(only).unclosedFence, true);
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
  assert.deepStrictEqual(r, { done: false, unsourced: [], unclosedFence: false });
});

test('SOURCE_RE accepts exactly the four forms', () => {
  for (const ok of ['#12', 'abcdef1', 'a/b.js:3', '.claude-tweaks/pipelines/x', '#1, abcdef1']) {
    assert.ok(SOURCE_RE.test(ok), ok);
  }
  for (const bad of ['somewhere', 'abc12', '#x', 'a.js', '']) {
    assert.ok(!SOURCE_RE.test(bad), bad);
  }
});

test('a path:line source may contain spaces (a plugin root under a spaced directory)', () => {
  const posix = '/Users/John Smith/.claude/plugins/cache/m/claude-tweaks/6.180.0/bin/lib/policy-schema.js:12';
  const win = 'C:\\Users\\John Smith\\.claude\\plugins\\cache\\m\\claude-tweaks\\6.180.0\\bin\\lib\\policy-schema.js:12';
  const dir = '/Users/u/Code Workspaces/claude-tweaks/plugin/bin/lib/policy.js:52';
  for (const ok of [posix, win, dir, `${posix}, #12`, `#12, ${win}`, `${posix}, ${win}, abcdef1`]) {
    assert.ok(SOURCE_RE.test(ok), ok);
    const text = ['# E', 'Status: done', `- a claim — source: ${ok}`].join('\n');
    assert.deepStrictEqual(checkEvidence(text), { done: true, unsourced: [], unclosedFence: false }, ok);
  }
});

test('a spaced source that is not a path:line, or whose path edges are blank, stays rejected', () => {
  for (const bad of ['a b', 'John Smith/x', 'a b.js', 'a b.js:x', '/Users/John Smith/x.js', '#12, a b', 'a b.js:3,  #1', ',a b.js:3']) {
    assert.ok(!SOURCE_RE.test(bad), bad);
    const text = ['# E', 'Status: done', `- a claim — source: ${bad}`].join('\n');
    assert.deepStrictEqual(checkEvidence(text).unsourced, [3], bad);
  }
});

test('SOURCE_RE rejects a path with leading or trailing whitespace around a list item', () => {
  for (const bad of [' /a b.js:3', '/a b.js:3 ', '#1,  /a b.js:3', '#1, /a b.js:3 ']) {
    assert.ok(!SOURCE_RE.test(bad), JSON.stringify(bad));
  }
});

test('SOURCE_RE accepts an absolute path:line under the plugin root, the settings schema source', () => {
  for (const ok of ['/Users/u/.claude/plugins/cache/m/claude-tweaks/6.180.0/bin/lib/policy-schema.js:42', 'C:\\Users\\u\\.claude\\plugins\\cache\\m\\claude-tweaks\\6.180.0\\bin\\lib\\policy-schema.js:42']) {
    assert.ok(SOURCE_RE.test(ok), ok);
    assert.ok(SOURCE_RE.test(`${ok}, #7`), `${ok} in a list`);
  }
});
