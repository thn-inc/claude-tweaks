'use strict';

// Flow sub-file table completeness guard (#1136).
//
// docs/plugin-structure.md's per-skill sub-file table has a `| flow | ... |`
// row listing every flow-skill sibling file. Nothing enforced that a newly
// added plugin/skills/flow/*.md file actually landed in that row -- six
// multispec-* files drifted past it across two separate ships before this
// test existed. Scoped to the flow row only (not generalized to every
// skill's row) per #1136's own Gotchas note -- a larger, separate change.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');

test('every plugin/skills/flow/*.md sibling file appears in the flow row of docs/plugin-structure.md', () => {
  const flowDir = path.join(ROOT, 'plugin/skills/flow');
  const siblingFiles = fs.readdirSync(flowDir)
    .filter((name) => name.endsWith('.md') && name !== 'SKILL.md');
  assert.ok(siblingFiles.length > 0, 'expected at least one flow sub-file -- a glob/path mistake would make this test vacuous');

  const body = readText(path.join(ROOT, 'docs/plugin-structure.md'));
  const rowMatch = body.match(/^\| flow \| ([^|]+) \|/m);
  assert.ok(rowMatch, "docs/plugin-structure.md is missing a '| flow | ... |' row");
  const listedFiles = new Set(rowMatch[1].split(',').map((s) => s.trim()));

  for (const file of siblingFiles) {
    assert.ok(listedFiles.has(file), `docs/plugin-structure.md's flow row is missing ${file}`);
  }
});
