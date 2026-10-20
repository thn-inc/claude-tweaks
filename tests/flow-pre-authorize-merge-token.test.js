// tests/flow-pre-authorize-merge-token.test.js — #2734. Pins the decision that
// no autonomy ceiling sets merge-authorization, and the /flow
// `pre-authorize-merge` token that answers lever 13 for one run instead. Reads
// live skill prose deliberately (skill-prose-conformance-tests): these
// sentences ARE the contract the record asked to have documented.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const TOKEN = 'pre-authorize-merge';

function ceilingSection() {
  const text = read('plugin/skills/_shared/autonomy-ceiling.md');
  const start = text.indexOf("### Orthogonal to the ceiling: the Manifesto's `merge-authorization` lever");
  assert.ok(start !== -1, 'autonomy-ceiling.md: Orthogonal-to-the-ceiling heading not found');
  const end = text.indexOf('\n### ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

test('AC1.1: autonomy-ceiling.md records the #2734 decision that no ceiling sets merge-authorization', () => {
  const section = ceilingSection();
  assert.match(section, /no ceiling sets it/);
  assert.match(section, /#2734/);
  assert.match(section, /#1802/, 'the rationale must name the ungranted-member carve-out it protects');
  assert.ok(section.includes('`' + TOKEN + '`'), 'the section must name the per-run route that replaces the extension');
});
