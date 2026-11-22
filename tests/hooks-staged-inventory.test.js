'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { checkStagedInventory, parseStagePaths } = require('../plugin/bin/lib/hooks/staged-inventory');

function tmpRunDir() {
  return scratchDir('ct-staged-inventory-');
}

function writeDecisions(runDir, text) {
  fs.writeFileSync(path.join(runDir, 'decisions.md'), text);
}

test('parseStagePaths: extracts a simple Stage path line', () => {
  const text = 'STAGED 14:41:15 — Step 3 Routing: 1 finding. Stage path: staged/review-2.patch.';
  assert.deepStrictEqual(parseStagePaths(text), ['staged/review-2.patch']);
});

test('parseStagePaths: extracts the path even with trailing prose on the same line', () => {
  const text = 'STAGED 14:41:15 — Step 3 Routing: high-severity finding. Stage path: staged/review-3.patch. Reversibility: high.';
  assert.deepStrictEqual(parseStagePaths(text), ['staged/review-3.patch']);
});

test('parseStagePaths: extracts a filename containing a dot before its extension', () => {
  const text = 'STAGED 15:02:18 — Leftover routing: section cannot finish. Stage path: staged/leftover-error-handling-edge-cases.md.';
  assert.deepStrictEqual(parseStagePaths(text), ['staged/leftover-error-handling-edge-cases.md']);
});

test('parseStagePaths: extracts multiple lines in order, ignores non-STAGED lines', () => {
  const text = [
    'AUTO 14:32:14 — Step 1.5: scope-creep applied. Reversibility: high (commit abc1234).',
    'STAGED 14:41:15 — Step 3 Routing: finding one. Stage path: staged/review-1.patch.',
    'KEPT-PROMPT 14:12:40 — Step 2.6: needed input. Surfaced inline.',
    'STAGED 14:41:22 — Step 3 Routing: finding two. Stage path: staged/review-2.patch.',
  ].join('\n');
  assert.deepStrictEqual(parseStagePaths(text), ['staged/review-1.patch', 'staged/review-2.patch']);
});

test('checkStagedInventory: no decisions.md is checked:0, missing:[] (nothing to reconcile)', () => {
  const runDir = tmpRunDir();
  assert.deepStrictEqual(checkStagedInventory(runDir), { checked: 0, missing: [] });
});

test('checkStagedInventory: every named staged/ file exists — missing is empty', () => {
  const runDir = tmpRunDir();
  fs.mkdirSync(path.join(runDir, 'staged'));
  fs.writeFileSync(path.join(runDir, 'staged', 'review-1.patch'), 'diff content');
  writeDecisions(runDir, 'STAGED 14:41:15 — Step 3 Routing: finding. Stage path: staged/review-1.patch.');
  assert.deepStrictEqual(checkStagedInventory(runDir), { checked: 1, missing: [] });
});

test('checkStagedInventory: a STAGED line naming a staged/ file that was never written is flagged (regression, #1269)', () => {
  const runDir = tmpRunDir();
  // No staged/ dir at all -- simulates the exact crash: log-decision.js's
  // write landed, stage-item.js's write never happened.
  writeDecisions(runDir, 'STAGED 08:22:19 — Step 3 lens dispatch: deferred finding. Stage path: staged/review-defer-1.md.');
  assert.deepStrictEqual(checkStagedInventory(runDir), {
    checked: 1,
    missing: ['staged/review-defer-1.md'],
  });
});

test('checkStagedInventory: mixed present and missing entries — only the missing one is reported', () => {
  const runDir = tmpRunDir();
  fs.mkdirSync(path.join(runDir, 'staged'));
  fs.writeFileSync(path.join(runDir, 'staged', 'review-1.patch'), 'diff content');
  writeDecisions(runDir, [
    'STAGED 14:41:15 — Step 3 Routing: finding one. Stage path: staged/review-1.patch.',
    'STAGED 14:41:22 — Step 3 Routing: finding two. Stage path: staged/review-2.patch.',
  ].join('\n'));
  assert.deepStrictEqual(checkStagedInventory(runDir), {
    checked: 2,
    missing: ['staged/review-2.patch'],
  });
});
