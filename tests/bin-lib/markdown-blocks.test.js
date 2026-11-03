'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('../helpers/read-skill');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../helpers/strip-comments');
const FILE = path.join(__dirname, '../../plugin/bin/lib/markdown-blocks.js');

test('markdown-blocks.js is a leaf module: it requires nothing, so any lib module can require it without a cycle (#4645)', () => {
  const raw = readText(FILE);
  const src = stripComments(raw);
  const verdict = stripperVerdict(raw, src);
  assert.strictEqual(verdict, 'ok', STRIPPER_VERDICT_MESSAGES[verdict]);
  assert.doesNotMatch(src, /\brequire\s*\(/);
  const m = require(FILE);
  assert.deepStrictEqual(Object.keys(m).sort(), ['extractSection', 'fenceFor', 'fencedBlock', 'fencedLineMask', 'fencedLineRanges', 'findSection', 'hiddenByUnclosedFence', 'unclosedFenceLine', 'unfencedText']);
});

const { hiddenByUnclosedFence, unclosedFenceLine, findSection } = require(FILE);
const H2 = { levelPattern: '2', stopPattern: '2', trim: true };
const HIDING = '## Current State\nx\n\n```\nnever closed\n\n## Deliverables\n- [ ] d';

test('unclosedFenceLine: 0-based index of a trailing unclosed opener, -1 when every fence closes (#4350)', () => {
  assert.strictEqual(unclosedFenceLine(HIDING.split('\n')), 3);
  assert.strictEqual(unclosedFenceLine(['```', 'a', '```', 'b']), -1);
  assert.strictEqual(unclosedFenceLine(['```', 'a', '```', '~~~', 'b']), 3);
});

test('findSection: unclosedAsText reads a trailing unclosed fence as prose (#4350)', () => {
  assert.strictEqual(findSection(HIDING, 'Deliverables', H2), null);
  assert.strictEqual(findSection(HIDING, 'Deliverables', { ...H2, unclosedAsText: true }), '- [ ] d');
});

test('hiddenByUnclosedFence: 1-based opener line for a hidden heading; the CRLF twin gives the same line (#4350)', () => {
  assert.strictEqual(hiddenByUnclosedFence(HIDING, 'Deliverables', H2), 4);
  assert.strictEqual(hiddenByUnclosedFence(HIDING.replace(/\n/g, '\r\n'), 'Deliverables', H2), 4);
});

test('hiddenByUnclosedFence: null for a found, absent, or present-but-empty heading, and a non-string body (#4350)', () => {
  assert.strictEqual(hiddenByUnclosedFence(HIDING, 'Current State', H2), null);
  assert.strictEqual(hiddenByUnclosedFence(HIDING, 'Release Note', H2), null);
  assert.strictEqual(hiddenByUnclosedFence('## Release Note\n\n## Deliverables\n```\nx', 'Release Note', H2), null);
  assert.strictEqual(hiddenByUnclosedFence(undefined, 'Release Note', H2), null);
});

test('hiddenByUnclosedFence: a rejected backtick opener is prose, so it hides nothing (#4350)', () => {
  assert.strictEqual(hiddenByUnclosedFence('## Current State\n```foo``` is the command\n\n## Deliverables\n- [ ] d', 'Deliverables', H2), null);
});
