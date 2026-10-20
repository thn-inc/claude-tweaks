// bin/lib/stage-item/ledger.js — the `--ledger` carry-forward of bin/stage-item.js:
// stage one proposal file AND append its open-items ledger row in one call, so
// the ledger row and the staged file can never name each other wrongly.
//
// The order is stage-then-append. The next row number is computed from the
// ledger text first (without writing), written into the staged file's
// `Ledger: {ref}#{n}` header, and only then is row {n} appended — naming the
// path `writeStagedItem` actually wrote (an `--allocate` reallocation can
// change the id). Either half failing degrades to exit 3 with a SKIP line in
// decisions.md; neither half is ever left pointing at a half that is not
// there. The whole sequence runs under `{run-dir}/.ledger.lock` and the ledger
// goes through atomic-write.js's tmp+rename — the pairing the *Sanctioned-writer*
// contract asks of a writer that read-modify-writes a shared file. The ledger is
// re-read right before each write, so a row a concurrent writer took since the
// first read is never overwritten: the staged file this call created is
// renumbered to the next free row instead, and never keeps pointing at a number
// someone else owns.
'use strict';

const fs = require('fs');
const path = require('path');
const { parseLedgerTable, serializeLedgerTable } = require('../wrap-up/ledger-write');
const { escapeLedgerCell } = require('../wrap-up/ledger-cells');
const { writeStagedItem } = require('./write');
const { formatEntry, appendEntry } = require('../log-decision/append');
const { withLock } = require('../file-lock');
const { writeFileAtomic } = require('../atomic-write');

// The header block is the lines before the first empty line (all of them when
// there is none). A CRLF file's empty line is a lone `\r`.
function headerEnd(lines) {
  const blank = lines.findIndex((l) => l === '' || l === '\r');
  return blank === -1 ? lines.length : blank;
}

// Replaces the first `Ledger:` line inside the header block with
// `Ledger: {ref}`; when absent, inserts it as the header block's last line.
function fillLedgerHeader(text, ref) {
  const source = String(text);
  const lines = source.split('\n');
  const end = headerEnd(lines);
  const crlf = source.includes('\r\n');
  const line = `Ledger: ${ref}`;
  for (let i = 0; i < end; i += 1) {
    if (/^Ledger:/.test(lines[i])) { lines[i] = line + (lines[i].endsWith('\r') ? '\r' : ''); return lines.join('\n'); }
  }
  // A CRLF header block with no empty line after it has no terminator on its last line yet.
  if (crlf && end === lines.length && end > 0 && !lines[end - 1].endsWith('\r')) lines[end - 1] += '\r';
  lines.splice(end, 0, line + (crlf && end < lines.length ? '\r' : ''));
  return lines.join('\n');
}

// The trimmed value of the first `{name}:` line in the header block, or null.
function headerField(text, name) {
  const lines = String(text).split('\n');
  const end = headerEnd(lines);
  const prefix = `${name}:`;
  for (let i = 0; i < end; i += 1) {
    if (lines[i].startsWith(prefix)) return lines[i].slice(prefix.length).trim();
  }
  return null;
}

// A line break would split the row across lines; a raw `|` would add a column.
function ledgerCell(text) {
  return escapeLedgerCell(String(text).replace(/\s*\r?\n\s*/g, ' ').trim());
}

const NUMBERED_ROW_RE = /^\|\s*(\d+)\s*\|/;

// Appends one open row numbered highest-existing + 1 (1 for an empty table).
// "Existing" is every numbered row line in the whole file — the scan
// wrap-up/pack.js's parseLedger counts with — so a number is never reused
// (_shared/ledger-format.md's Item Numbering). Throws (from parseLedgerTable)
// when the text has no ledger table, and a `LEDGER_UNSAFE` error when appending
// would reuse a number or drop a row: numbered rows outside the contiguous
// table, or duplicate numbers inside it (the table parser's Map collapses them
// on write-back).
function appendLedgerRow(ledgerText, { phase, item, status }) {
  const table = parseLedgerTable(ledgerText);
  const numbered = ledgerText.split('\n').map((l) => NUMBERED_ROW_RE.exec(l)).filter(Boolean).map((m) => parseInt(m[1], 10));
  const outside = [...table.preamble, ...table.trailer].filter((l) => NUMBERED_ROW_RE.test(l)).length;
  const unsafe = (message) => Object.assign(new Error(message), { code: 'LEDGER_UNSAFE' });
  if (outside > 0) throw unsafe('numbered rows exist outside the contiguous table (a row after a blank or non-table line) — fix the ledger by hand');
  if (numbered.length !== table.rows.size) throw unsafe('duplicate row numbers in the ledger table — fix the ledger by hand');
  const number = Math.max(0, ...numbered) + 1;
  table.rows.set(String(number), `| ${number} | ${ledgerCell(phase)} | ${ledgerCell(item)} | ${status} | — |`);
  return { text: serializeLedgerTable(table), number };
}

function carryForward({
  runDir, ledgerPath, ledgerRef, id, sourcePath, content, allocate, phase, item, label, section, now,
  readLedger = (p) => fs.readFileSync(p, 'utf8'), // test seam: lets a test take a row between the reads
  unlink = fs.unlinkSync, // test seam: lets a test fail the staged file's removal
}) {
  return withLock(path.join(runDir, '.ledger.lock'), () => {
    const warnings = [];
    const summary = headerField(content, 'Title') || item;
    const log = (status, step, text, reversibility) => {
      try {
        appendEntry({ runDir, section, entry: formatEntry({ status, now, step, text, reversibility }) });
      } catch (err) {
        warnings.push(`could not log ${status} entry to decisions.md (${err && err.message})`);
      }
    };
    const degraded = (condition) => {
      log('SKIP', `${label} carry-forward (degraded)`, condition, 'n/a');
      return { code: 3, reason: condition, warnings };
    };

    let ledgerText;
    try {
      ledgerText = readLedger(ledgerPath);
    } catch (err) {
      return degraded(`condition: ledger ${ledgerRef} unreadable (${err && err.message}) → fallback: nothing staged or appended; "${summary}" reaches no console`);
    }
    let planned;
    try {
      planned = appendLedgerRow(ledgerText, { phase, item, status: 'open' });
    } catch (err) {
      const what = err && err.code === 'LEDGER_UNSAFE' ? 'cannot take a new row safely' : 'has no ledger table';
      return degraded(`condition: ledger ${ledgerRef} ${what} (${err && err.message}) → fallback: nothing staged or appended; "${summary}" reaches no console`);
    }
    const { number } = planned;

    let staged;
    try {
      staged = writeStagedItem({
        runDir, id, sourcePath, content: fillLedgerHeader(content, `${ledgerRef}#${number}`), allocate,
      });
    } catch (err) {
      const stagedMsg = err && err.message;
      // No staged file references the planned number, so re-read and take the next free one.
      let open;
      try {
        open = appendLedgerRow(readLedger(ledgerPath), { phase, item, status: 'open' });
        writeFileAtomic(ledgerPath, open.text);
      } catch (ledgerErr) {
        return degraded(`condition: staged write failed for ${id} (${stagedMsg}) and ledger append to ${ledgerRef} failed (${ledgerErr && ledgerErr.message}) → fallback: nothing staged or appended; "${summary}" reaches no console`);
      }
      return degraded(`condition: staged write failed for ${id} (${stagedMsg}) → fallback: ledger row #${open.number} left open with no staged file; the resolve gate drills it`);
    }

    // --allocate (required by the CLI) makes the create exclusive, so removing staged.file only ever removes this call's own file.
    const base = path.basename(staged.file);
    // The SKIP text says whether the removal actually happened.
    const removeStaged = () => {
      try { unlink(staged.file); } catch (err) {
        return `staged/${base} could NOT be removed (${err && err.message}) — delete it by hand; its Ledger: header names no row of this call`;
      }
      return `staged/${base} removed`;
    };
    let withPath;
    try {
      // Re-read: a concurrent writer may have taken row `number` since the first read, and the staged file already names it.
      withPath = appendLedgerRow(readLedger(ledgerPath), { phase, item: `${item} (staged/${base})`, status: 'open' });
      if (withPath.number !== number) {
        // This call created the staged file exclusively, so it owns it: renumber its header rather than discard the ruling.
        try {
          fs.writeFileSync(staged.file, fillLedgerHeader(content, `${ledgerRef}#${withPath.number}`));
        } catch (headerErr) {
          return degraded(`condition: ledger row #${number} in ${ledgerRef} was taken concurrently and the staged header could not be renumbered (${headerErr && headerErr.message}) → fallback: ${removeStaged()}; "${summary}" reaches no console`);
        }
      }
      writeFileAtomic(ledgerPath, withPath.text);
    } catch (err) {
      return degraded(`condition: ledger append to ${ledgerRef} failed (${err && err.message}) → fallback: ${removeStaged()}; "${summary}" reaches no console`);
    }

    log('STAGED', `${label} carried forward`, `"${summary}". Stage path: staged/${base}`, 'high');
    return {
      code: 0, file: staged.file, id: staged.id, renamed: staged.renamed, requestedId: staged.requestedId, number: withPath.number, warnings,
    };
  });
}

module.exports = {
  fillLedgerHeader, headerField, appendLedgerRow, carryForward,
};
