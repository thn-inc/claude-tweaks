'use strict';

// Build and dispatch sub-file table completeness guard (#3087).
//
// The same drift tests/flow-subfile-table-completeness.test.js (#1136) and
// tests/tidy-subfile-table-completeness.test.js close for their rows: a new
// plugin/skills/{skill}/*.md file that never lands in docs/plugin-structure.md's
// `| {skill} | ... |` row. Two release reviews in a row (v6.139.0 review-12,
// v6.139.1 review-6) found build and dispatch files missing from theirs.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const STRUCTURE = readText(path.join(ROOT, 'docs/plugin-structure.md'));

for (const skill of ['build', 'dispatch']) {
  test(`every plugin/skills/${skill}/*.md sibling file appears in the ${skill} row of docs/plugin-structure.md`, () => {
    const siblingFiles = fs.readdirSync(path.join(ROOT, 'plugin/skills', skill))
      .filter((name) => name.endsWith('.md') && name !== 'SKILL.md');
    assert.ok(siblingFiles.length > 0, `expected at least one ${skill} sub-file -- a glob/path mistake would make this test vacuous`);

    const rowMatch = STRUCTURE.match(new RegExp(`^\\| ${skill} \\| ([^|]+) \\|`, 'm'));
    assert.ok(rowMatch, `docs/plugin-structure.md is missing a '| ${skill} | ... |' row`);
    const listedFiles = new Set(rowMatch[1].split(',').map((s) => s.trim()));

    for (const file of siblingFiles) {
      assert.ok(listedFiles.has(file), `docs/plugin-structure.md's ${skill} row is missing ${file}`);
    }
  });
}
