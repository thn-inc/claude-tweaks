'use strict';
// tests/bin-lib/wrap-up/ledger-cells.test.js — #3353: splitLedgerRow honors
// GFM's `\|` table escape, so a pipe inside a ledger cell does not split it.
const test = require('node:test');
const assert = require('node:assert');

const { splitLedgerRow } = require('../../../plugin/bin/lib/wrap-up/ledger-cells');

const NO_BACKSLASH_ROWS = ['| 1 | build | item | open | — |', '|||', ''];

test('splitLedgerRow keeps an escaped pipe inside its cell', () => {
  assert.deepStrictEqual(
    splitLedgerRow('| 1 | build | a\\|b | open | — |'),
    ['', ' 1 ', ' build ', ' a\\|b ', ' open ', ' — ', ''],
  );
});

test('splitLedgerRow splits after an escaped backslash', () => {
  assert.deepStrictEqual(
    splitLedgerRow('| a\\\\| b |'),
    ['', ' a\\\\', ' b ', ''],
  );
});

test('splitLedgerRow keeps a trailing lone backslash', () => {
  assert.deepStrictEqual(
    splitLedgerRow('| a \\'),
    ['', ' a \\'],
  );
});

test('splitLedgerRow matches split(\'|\') on rows with no backslash', () => {
  for (const row of NO_BACKSLASH_ROWS) {
    assert.deepStrictEqual(splitLedgerRow(row), row.split('|'));
  }
});

test('splitLedgerRow round-trips byte-identically', () => {
  const rows = [
    '| 1 | build | a\\|b | open | — |',
    '| a\\\\| b |',
    '| a \\',
    ...NO_BACKSLASH_ROWS,
  ];
  for (const row of rows) {
    assert.strictEqual(splitLedgerRow(row).join('|'), row);
  }
});
