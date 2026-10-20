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

test('flow SKILL.md documents the token, its dispatch-bound refusal, and that no skill composes it', () => {
  const row = read('plugin/skills/flow/SKILL.md').split('\n').find((l) => l.startsWith('| `' + TOKEN + '` |'));
  assert.ok(row, 'flow/SKILL.md: no Arguments row for the token');
  assert.match(row, /dispatch-bound/);
  assert.match(row, /no skill composes it/);
});

test('manifesto.md sets lever 13 from the token (source arg) and refuses it on a dispatch-bound run', () => {
  const row = read('plugin/skills/flow/manifesto.md').split('\n').find((l) => l.startsWith('| Merge authorization | `ask` |'));
  assert.ok(row, 'manifesto.md: Recommendation defaults Merge authorization row not found');
  assert.ok(row.includes('`' + TOKEN + '`'));
  assert.match(row, /source `arg`/);
  assert.match(row, /dispatch-bound/);
  assert.match(row, /`SKIP`/);
});

// An agent never originates its own merge authorization: no plugin file other
// than flow's own grammar/examples may compose a /claude-tweaks:flow invocation
// carrying the token. `[^`|\n]*` keeps the match inside one invocation string,
// so prose naming both in separate code spans does not count.
test('no plugin file composes a /claude-tweaks:flow invocation carrying the token', () => {
  const ALLOWED = new Set(['plugin/skills/flow/SKILL.md']);
  const INVOCATION = new RegExp('/claude-tweaks:flow[^`|\\n]*' + TOKEN);
  const offenders = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + '/' + ent.name;
      if (ent.isDirectory()) { walk(rel); continue; }
      if (!/\.(md|js|ya?ml|json)$/.test(ent.name) || ALLOWED.has(rel)) continue;
      if (INVOCATION.test(read(rel))) offenders.push(rel);
    }
  };
  walk('plugin');
  assert.deepStrictEqual(offenders, []);
});
