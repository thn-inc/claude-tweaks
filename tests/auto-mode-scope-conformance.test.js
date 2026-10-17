'use strict';
// tests/auto-mode-scope-conformance.test.js — pins that the `auto-mode` policy
// key's description correctly names /flow, /build, and /tidy, and that it
// reflects the actual scoped default behavior (each skill keeps its own).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');

const MD_PATH = path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'policy-schema.md');
const md = fs.readFileSync(MD_PATH, 'utf8');

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
  const rowLine = lines.find((line) => line.includes('| `auto-mode` |'));
  assert.ok(rowLine, 'no row starting with | `auto-mode` | found in policy-schema.md');

  // Split on | and trim to get cells
  const cells = rowLine.split('|').map((cell) => cell.trim());
  // Cells: [0: empty, 1: key, 2: home, 3: owners, 4: default, 5: meaning, 6: empty]
  const defaultCell = cells[4];
  const meaningCell = cells[5];

  assert.ok(
    !defaultCell.includes('still defaults to `auto`'),
    `auto-mode default cell must not contain "still defaults to \`auto\`"; got: ${defaultCell}`
  );

  assert.ok(
    !meaningCell.includes('standalone `/build` and unattended `/tidy` firings'),
    `auto-mode meaning cell must not contain old text; got: ${meaningCell}`
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
    meaningCell.includes('interactive'),
    `auto-mode meaning cell must state that default-off resolves to interactive; got: ${meaningCell}`
  );
});
