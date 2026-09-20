const { test } = require('node:test');
const assert = require('node:assert');
const {
  COLUMN_ORDER, COLUMN_LABELS, ORIGIN_COLORS, BORDER_COLORS,
} = require('../../../plugin/bin/lib/record-graph/palette');

test('palette exports all three column keys in a fixed left-to-right order', () => {
  assert.deepStrictEqual(COLUMN_ORDER, ['backlog', 'parked', 'ready']);
});

test('palette has a string label for every column key', () => {
  for (const key of COLUMN_ORDER) {
    assert.strictEqual(typeof COLUMN_LABELS[key], 'string');
  }
});

test('palette has a hex origin color for every recognized origin plus the human fallback', () => {
  for (const key of ['code-health', 'harness-health', 'journey-health', 'docs-health', 'capture', 'dispatch', 'human']) {
    assert.match(ORIGIN_COLORS[key], /^#[0-9a-f]{6}$/);
  }
});

test('palette has a hex border color for every bot-state value', () => {
  for (const key of ['blocked', 'in-progress', 'bot-parked', 'default']) {
    assert.match(BORDER_COLORS[key], /^#[0-9a-f]{6}$/);
  }
});
