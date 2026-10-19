// bin/lib/wrap-up/ledger-cells.js — the ledger row splitter (#3353). GFM's
// table escape is `\|`: a pipe preceded by a backslash is cell content, not a
// cell boundary, so a ledger item whose text contains a literal `|` must not
// split into extra cells. `splitLedgerRow` walks the row once, left to right,
// and returns untrimmed segments such that `splitLedgerRow(row).join('|')`
// reproduces `row` byte-for-byte.
'use strict';

function splitLedgerRow(row) {
  const segments = [];
  let current = '';
  let i = 0;
  while (i < row.length) {
    const ch = row[i];
    if (ch === '\\') {
      current += ch;
      if (i + 1 < row.length) current += row[i + 1];
      i += 2;
    } else if (ch === '|') {
      segments.push(current);
      current = '';
      i += 1;
    } else {
      current += ch;
      i += 1;
    }
  }
  segments.push(current);
  return segments;
}

module.exports = { splitLedgerRow };
