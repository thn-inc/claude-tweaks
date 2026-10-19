// bin/lib/wrap-up/ledger-cells.js — the ledger row splitter (#3353). GFM's
// table escape is `\|`: a pipe preceded by a backslash is cell content, not a
// cell boundary, so a ledger item whose text contains a literal `|` must not
// split into extra cells. `splitLedgerRow` walks the row once, left to right,
// and returns untrimmed segments such that `splitLedgerRow(row).join('|')`
// reproduces `row` byte-for-byte. Two deliberate edges versus GFM proper: a
// backslash consumes exactly the one character after it, so an escaped
// backslash `\\` followed by `|` IS a cell boundary (cmark-gfm / GitHub treat
// any `|` right after a backslash as literal); and a cell ending in a backslash
// directly before the delimiter with no space (`C:\dir\|`) merges with the next
// cell. Ledger writers pad cells with spaces, so the latter does not arise.
'use strict';

function splitLedgerRow(row) {
  const segments = [];
  let current = '';
  let i = 0;
  while (i < row.length) {
    const ch = row[i];
    if (ch === '\\') {
      current += row.slice(i, i + 2);
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
