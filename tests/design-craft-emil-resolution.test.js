// tests/design-craft-emil-resolution.test.js — pins #3000's fix:
// skills/_shared/design-craft.md's Emil skill resolution must list the
// `.agents/skills` install-layout path as a direct lookup entry, not only
// reachable through the `.claude/skills` symlink, and the two-path list this
// lookup defines must exist in exactly one place (design-craft.md) — every
// other consumer cites it instead of restating it. Reads the live skill
// files — this test pins prose we just wrote, not a third-party fact.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const PLUGIN_SKILLS_ROOT = path.join(__dirname, '..', 'plugin', 'skills');
const DESIGN_CRAFT_MD = path.join(PLUGIN_SKILLS_ROOT, '_shared', 'design-craft.md');
const REVIEW_MD = path.join(PLUGIN_SKILLS_ROOT, 'design-wrapper', 'modes', 'review.md');
const PLUGIN_ROOT = path.join(__dirname, '..', 'plugin');

function read(p) {
  return readText(p);
}

function stepSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `expected to find "${startMarker}"`);
  const end = endMarker ? text.indexOf(endMarker, start) : text.length;
  return text.slice(start, end === -1 ? text.length : end);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

test('design-craft.md Emil skill resolution lists three lookup paths in order', () => {
  const text = read(DESIGN_CRAFT_MD);
  const section = stepSlice(text, '## Emil skill resolution', '## Relevance map');
  const order = [
    '{project}/.claude/skills/{name}/SKILL.md',
    '{project}/.agents/skills/{name}/SKILL.md',
    '~/.claude/skills/{name}/SKILL.md',
  ];
  let cursor = 0;
  for (const entry of order) {
    const idx = section.indexOf('`' + entry + '`', cursor);
    assert.ok(idx !== -1, `expected to find lookup path "${entry}" after position ${cursor}`);
    cursor = idx + entry.length;
  }
});

test('design-craft.md install-layout note says the .agents/skills path is now consulted directly', () => {
  const text = read(DESIGN_CRAFT_MD);
  const section = stepSlice(text, '## Emil skill resolution', '## Relevance map');
  assert.match(section, /Path 2 is now consulted directly/);
});

test('the literal two-path lookup string appears in exactly one file under plugin/skills/ (design-craft.md)', () => {
  const needle = '{project}/.claude/skills/{name}/SKILL.md';
  const files = walk(PLUGIN_SKILLS_ROOT);
  const hits = files.filter((f) => read(f).includes(needle));
  assert.deepEqual(
    hits.map((f) => path.relative(PLUGIN_SKILLS_ROOT, f)),
    [path.relative(PLUGIN_SKILLS_ROOT, DESIGN_CRAFT_MD)],
    'expected the literal lookup-path string to appear only in design-craft.md',
  );
});

test('no file under plugin/ still contains the retired "not installed at either path" string', () => {
  const files = walk(PLUGIN_ROOT);
  const hits = files.filter((f) => read(f).includes('not installed at either path'));
  assert.deepEqual(hits, [], `expected no hits, found: ${hits.join(', ')}`);
});

test('review.md Step 3.8 (c) cites design-craft.md instead of restating the lookup, and uses the reworded missed value', () => {
  const text = read(REVIEW_MD);
  const step = stepSlice(text, '**(c) Availability.**', '**(d) Decisions layer.**');
  assert.doesNotMatch(step, /\{project\}\/\.claude\/skills\/\{name\}\/SKILL\.md/);
  assert.match(step, /design-craft\.md`'s \*\*Emil skill resolution\*\*/);
  assert.match(step, /"not installed at any lookup path"/);
  assert.match(step, /not installed at any lookup path\)\. Reversibility: n\/a\./);
});
