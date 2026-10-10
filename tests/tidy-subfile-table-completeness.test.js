'use strict';

// Tidy sub-file table completeness guard (fix-wave review of #1493, REC4).
//
// docs/plugin-structure.md's per-skill sub-file table has a `| tidy | ... |`
// row listing every tidy-skill sibling file. decision-markers.md and
// approve-mode.md landed as part of #1493 without ever being added to that
// row -- the same drift #1136 caught for /flow's row. Mirrors
// tests/flow-subfile-table-completeness.test.js's own derivation approach:
// enumerate plugin/skills/tidy/*.md siblings, assert every one appears in
// the row.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');

test('every plugin/skills/tidy/*.md sibling file appears in the tidy row of docs/plugin-structure.md', () => {
  const tidyDir = path.join(ROOT, 'plugin/skills/tidy');
  const siblingFiles = fs.readdirSync(tidyDir)
    .filter((name) => name.endsWith('.md') && name !== 'SKILL.md');
  assert.ok(siblingFiles.length > 0, 'expected at least one tidy sub-file -- a glob/path mistake would make this test vacuous');

  const body = readText(path.join(ROOT, 'docs/plugin-structure.md'));
  const rowMatch = body.match(/^\| tidy \| ([^|]+) \|/m);
  assert.ok(rowMatch, "docs/plugin-structure.md is missing a '| tidy | ... |' row");
  const listedFiles = new Set(rowMatch[1].split(',').map((s) => s.trim()));

  for (const file of siblingFiles) {
    assert.ok(listedFiles.has(file), `docs/plugin-structure.md's tidy row is missing ${file}`);
  }
});
