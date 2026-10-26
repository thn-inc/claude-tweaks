'use strict';
// tests/auto-mode-scope-conformance.test.js — pins that the `auto-mode` policy
// key's description correctly names /flow, /build, and /tidy, and that it
// reflects the actual scoped default behavior (each skill keeps its own).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');
const { readText } = require('./helpers/read-skill');

const MD_PATH = path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'policy-schema.md');
const md = readText(MD_PATH);

test('auto-mode summary in POLICY_KEYS contains /flow and is <= 140 chars', () => {
  const row = POLICY_KEYS.find((r) => r.key === 'auto-mode');
  assert.ok(row, 'auto-mode not found in POLICY_KEYS');
  assert.ok(row.summary.includes('/flow'), `auto-mode summary must mention /flow; got: ${row.summary}`);
  assert.ok(row.summary.length <= 140, `auto-mode summary is ${row.summary.length} chars (> 140 ceiling); got: ${row.summary}`);
});

test('auto-mode summary does not contain the old stale text', () => {
  const row = POLICY_KEYS.find((r) => r.key === 'auto-mode');
  assert.ok(row, 'auto-mode not found in POLICY_KEYS');
  assert.ok(
    !row.summary.includes('Sets whether a standalone build or an unattended cleanup run starts hands-off by default'),
    `auto-mode summary must not contain old stale text; got: ${row.summary}`
  );
});

test('policy-schema.md auto-mode row is correctly updated', () => {
  const lines = md.split('\n');
  const matches = lines.filter((line) => line.startsWith('| `auto-mode` |'));
  assert.equal(matches.length, 1, `expected exactly one row starting with | \`auto-mode\` | in policy-schema.md; found ${matches.length}`);
  const rowLine = matches[0];

  // Split on unescaped | only — an escaped \| inside a cell (used elsewhere in
  // this table, e.g. `routine\|sweep`) must not be mistaken for a column break.
  const cells = rowLine.split(/(?<!\\)\|/).map((cell) => cell.trim());
  // Cells: [0: empty, 1: key, 2: home, 3: owners, 4: default, 5: meaning, 6: empty]
  const meaningCell = cells[5];

  // Run the negative "must not contain" checks against the whole row line so
  // a column-count shift can never silently empty the cell under test.
  assert.ok(
    !rowLine.includes('still defaults to `auto`'),
    `auto-mode row must not contain "still defaults to \`auto\`"; got: ${rowLine}`
  );

  assert.ok(
    !rowLine.includes('standalone `/build` and unattended `/tidy` firings'),
    `auto-mode row must not contain old text; got: ${rowLine}`
  );

  assert.ok(
    meaningCell.includes('/flow') || meaningCell.includes('/claude-tweaks:flow'),
    `auto-mode meaning cell must mention /flow; got: ${meaningCell}`
  );

  assert.ok(
    meaningCell.includes('`default-off`'),
    `auto-mode meaning cell must contain \`default-off\`; got: ${meaningCell}`
  );

  assert.ok(
    /`default-off`\s*→\s*`interactive`/.test(meaningCell),
    `auto-mode meaning cell must state that \`default-off\` maps to \`interactive\`; got: ${meaningCell}`
  );
});
