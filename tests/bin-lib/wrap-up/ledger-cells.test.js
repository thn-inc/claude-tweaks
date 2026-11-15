'use strict';
// tests/bin-lib/wrap-up/ledger-cells.test.js — the ledger cell codec: a `|`
// inside a 5-column ledger cell is written as `\|` and read back unchanged.
const test = require('node:test');
const assert = require('node:assert');

const {
  escapeLedgerCell, unescapeLedgerCell, collapseLineBreaks, splitLedgerRow, ledgerRowCells,
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

// #4439: collapseLineBreaks replaces `text.replace(/\s*\r?\n\s*/g, ' ').trim()` (quadratic on a long run of spaces).
// The old expression is the oracle here; the output must be byte-identical for every input.
const oldCollapse = (text) => String(text).replace(/\s*\r?\n\s*/g, ' ').trim();

test('collapseLineBreaks is byte-identical to the old whitespace-run regex on every edge input', () => {
  const edges = [
    '', ' ', '\n', '\r\n', '\r', ' \n ', 'a', ' a ', 'a\nb', 'a\r\nb', 'a \n b', 'a\n\nb', 'a\r\n\r\nb', 'a \n \n b', 'a\n \n b',
    '\na', 'a\n', '\n\na\n\n', '  \n  a  \n  ', '\r\na\r\n', 'a\rb', 'a \r b', 'a\r\rb', 'a\r\r\nb', 'a\n\rb', 'a  b', 'a\tb', 'a\t\nb\t',
    ' a ', 'a b', 'a \nb', 'a\n b', 'a \n b', '﻿a﻿', 'a b', ' \n ',
    'a\n b\n  c\n   d', ' \t\r\n a \t\r\n ', 'x\n\n\n\ny', 'x \n\t\n y', 'a|b\nc|d', 'a\\\nb',
  ];
  for (const text of edges) assert.strictEqual(collapseLineBreaks(text), oldCollapse(text), JSON.stringify(text));
  // Seeded fuzz over the alphabet the collapse reads (xorshift32, so a failure replays).
  let seed = 0x4439;
  const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const pieces = ['a', 'b', ' ', '  ', '\t', '\n', '\r', '\r\n', ' ', ' ', ' ', '﻿', '|', '\\'];
  for (let n = 0; n < 5000; n += 1) {
    let text = '';
    for (let k = Math.floor(next() * 10); k >= 0; k -= 1) text += pieces[Math.floor(next() * pieces.length)];
    assert.strictEqual(collapseLineBreaks(text), oldCollapse(text), JSON.stringify(text));
  }
});

test('collapseLineBreaks takes non-string input the way the old expression did', () => {
  for (const value of [undefined, null, 0, 12, true, ['a\nb']]) assert.strictEqual(collapseLineBreaks(value), oldCollapse(value), String(value));
});
