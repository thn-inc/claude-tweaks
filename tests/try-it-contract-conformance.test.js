'use strict';
// #2821: one shared "Try it" walkthrough block, defined once in
// _shared/try-it.md and cited (never restated) by every surface that shows it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const read = (rel) => fs.readFileSync(path.join(SKILLS, rel), 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.md') ? [p] : []);
  });
}

const FIELD_LINE = /^- (Precondition|Access): /m;

test('try-it.md defines the five fields in fixed order', () => {
  const doc = read('_shared/try-it.md');
  const fields = ['- Precondition: ', '- Access: ', '- Entry point: ', '- Steps:', '- Expected: '];
  const idx = fields.map((f) => doc.indexOf(f));
  assert.ok(idx.every((i) => i >= 0), `missing a field line: ${JSON.stringify(idx)}`);
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, 'fields must appear in the fixed order');
  for (const h of ['## Shape', '## End-to-end variant', '## Sources', '## Rules', '## Where it appears']) {
    assert.ok(doc.includes(h), `try-it.md missing ${h}`);
  }
  assert.ok(doc.includes('### Try it — end to end'), 'end-to-end variant heading');
  assert.ok(doc.includes('try-it-{N}.md'), 'session file name');
});

test('try-it.md forbids empty and placeholder blocks and decouples from the oversight floor', () => {
  const doc = read('_shared/try-it.md');
  assert.match(doc, /Never empty, never placeholder/);
  assert.match(doc, /no green QA stories/i);
  assert.match(doc, /never gates the block/);
});

test('the Try it field lines live in exactly one skill file', () => {
  const owners = walk(SKILLS).filter((f) => FIELD_LINE.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(SKILLS, f));
  assert.deepEqual(owners, ['_shared/try-it.md']);
});
