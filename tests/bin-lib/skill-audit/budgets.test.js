'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const budgets = require('../../../plugin/bin/lib/skill-audit/budgets.js');

const {
  READ_TOKEN_CAP, READ_LINE_CAP, BASH_OUTPUT_CAP_CHARS, RAIL_RATIO, RAIL_TOKENS, RAIL_LINES,
  BYTES_PER_TOKEN, RAIL_BYTES, DESCRIPTION_MAX_CHARS, LISTING_BUDGET_FRACTION,
  LISTING_CHARS_PER_TOKEN, listingBudgetChars, overRail,
} = budgets;

const BUDGETS_SRC = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'skill-audit', 'budgets.js');

// ── Derivations (AC1-AC3, AC9)

test('budgets: the platform caps and listing constants carry their exact values', () => {
  assert.strictEqual(READ_TOKEN_CAP, 25000);
  assert.strictEqual(READ_LINE_CAP, 2000);
  assert.strictEqual(BASH_OUTPUT_CAP_CHARS, 30000);
  assert.strictEqual(RAIL_RATIO, 1.0);
  assert.strictEqual(DESCRIPTION_MAX_CHARS, 1536);
  assert.strictEqual(LISTING_BUDGET_FRACTION, 0.01);
  assert.strictEqual(LISTING_CHARS_PER_TOKEN, 4);
});

test('budgets: the rails derive from the caps by formula', () => {
  assert.strictEqual(RAIL_TOKENS, Math.floor(READ_TOKEN_CAP * RAIL_RATIO));
  assert.strictEqual(RAIL_LINES, Math.floor(READ_LINE_CAP * RAIL_RATIO));
  assert.strictEqual(RAIL_BYTES, Math.floor(RAIL_TOKENS * BYTES_PER_TOKEN));
});

test('budgets: BYTES_PER_TOKEN is a calibrated ratio rounded down to one decimal', () => {
  assert.ok(BYTES_PER_TOKEN > 0);
  assert.strictEqual(Math.round(BYTES_PER_TOKEN * 10) / 10, BYTES_PER_TOKEN);
});

test('budgets: listingBudgetChars at 200k and 1M context', () => {
  assert.strictEqual(listingBudgetChars(200000), 8000);
  assert.strictEqual(listingBudgetChars(1000000), 40000);
});

test('budgets: the header records the calibration — CLI version, date, and all three token counts', () => {
  const src = fs.readFileSync(BUDGETS_SRC, 'utf8');
  for (const needle of ['2.1.302', '2026-10-17', '45,241', '51,251', '65,782']) {
    assert.ok(src.includes(needle), `budgets.js header is missing ${needle}`);
  }
});

test('budgets: requires nothing, so any unit can import it without a cycle', () => {
  const src = fs.readFileSync(BUDGETS_SRC, 'utf8');
  assert.doesNotMatch(src, /\brequire\s*\(/);
});

// ── overRail (AC5)

test('overRail: over the byte rail or the line rail, never at it', () => {
  const entries = [
    { file: 'a.md', bytes: RAIL_BYTES, lines: 10 },
    { file: 'b.md', bytes: RAIL_BYTES + 1, lines: 10 },
    { file: 'c.md', bytes: 100, lines: RAIL_LINES + 1 },
  ];
  assert.deepStrictEqual(overRail(entries).map((e) => e.file), ['b.md', 'c.md']);
});

test('overRail: an entry with no lines field is judged on bytes only', () => {
  assert.deepStrictEqual(overRail([{ file: 'bundle', bytes: RAIL_BYTES }]), []);
  assert.deepStrictEqual(overRail([{ file: 'bundle', bytes: RAIL_BYTES + 1 }]).map((e) => e.file), ['bundle']);
});
