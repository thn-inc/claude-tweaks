'use strict';
// tests/bin-lib/wrap-up/ledger-cells.test.js — #3353: splitLedgerRow honors
// GFM's `\|` table escape, so a pipe inside a ledger cell does not split it.
const test = require('node:test');
const assert = require('node:assert');

const { splitLedgerRow, escapeLedgerPipes } = require('../../../plugin/bin/lib/wrap-up/ledger-cells');

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

test('splitLedgerRow treats a backslash before an ordinary character as a literal pair', () => {
  assert.deepStrictEqual(
    splitLedgerRow('| a\\x| b |'),
    ['', ' a\\x', ' b ', ''],
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

test('escapeLedgerPipes escapes a bare pipe and keeps an already-escaped one', () => {
  assert.strictEqual(escapeLedgerPipes('a | b'), 'a \\| b');
  assert.strictEqual(escapeLedgerPipes('a \\| b'), 'a \\| b');
  assert.strictEqual(escapeLedgerPipes('x\\\\| y'), 'x\\\\\\| y');
  assert.strictEqual(escapeLedgerPipes('no pipes \\'), 'no pipes \\');
});

test('escapeLedgerPipes output stays inside one cell when split', () => {
  for (const text of ['a | b', 'a \\| b', 'x\\\\| y', '||', 'plain']) {
    assert.strictEqual(splitLedgerRow(`| ${escapeLedgerPipes(text)} |`).length, 3);
  }
});
