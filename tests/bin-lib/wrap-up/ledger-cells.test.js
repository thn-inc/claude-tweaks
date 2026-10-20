'use strict';
// tests/bin-lib/wrap-up/ledger-cells.test.js — the ledger cell codec: a `|`
// inside a 5-column ledger cell is written as `\|` and read back unchanged.
const test = require('node:test');
const assert = require('node:assert');

const {
  escapeLedgerCell, unescapeLedgerCell, splitLedgerRow, ledgerRowCells,
} = require('../../../plugin/bin/lib/wrap-up/ledger-cells');

test('AC1.1: escape → split → unescape round-trips an Item carrying a|b as 5 cells with the original text', () => {
  const row = `| 7 | build | ${escapeLedgerCell('SDD ruling — match a|b|c')} | open | — |`;
  assert.strictEqual(splitLedgerRow(row).length, 7);
  assert.deepStrictEqual(ledgerRowCells(row), ['7', 'build', 'SDD ruling — match a|b|c', 'open', '—']);
});

test('a cell already containing a literal \\| round-trips unchanged', () => {
  const original = String.raw`grep 'x\|y'`;
  const row = `| 1 | review | ${escapeLedgerCell(original)} | fixed | ok |`;
  assert.strictEqual(ledgerRowCells(row)[2], original);
});

test('escapeLedgerCell / unescapeLedgerCell are inverses on pipe-free and pipe-bearing text', () => {
  for (const s of ['plain', 'a|b', '|lead', 'trail|', 'a||b', 'a\\', 'a\\|b']) assert.strictEqual(unescapeLedgerCell(escapeLedgerCell(s)), s);
  assert.strictEqual(escapeLedgerCell('a|b'), String.raw`a\|b`);
});

test('a cell whose original text ends in a backslash round-trips through a padded full row', () => {
  const original = 'ends in a backslash\\';
  const row = `| 4 | build | ${escapeLedgerCell(original)} | open | — |`;
  assert.strictEqual(splitLedgerRow(row).length, 7);
  assert.deepStrictEqual(ledgerRowCells(row), ['4', 'build', original, 'open', '—']);
});
