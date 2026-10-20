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
// contract asks of a writer that read-modify-writes a shared file.
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
// there is none).
function headerEnd(lines) {
  const blank = lines.indexOf('');
  return blank === -1 ? lines.length : blank;
}

// Replaces the first `Ledger:` line inside the header block with
// `Ledger: {ref}`; when absent, inserts it as the header block's last line.
function fillLedgerHeader(text, ref) {
  const lines = String(text).split('\n');
  const end = headerEnd(lines);
  const line = `Ledger: ${ref}`;
  for (let i = 0; i < end; i += 1) {
    if (/^Ledger:/.test(lines[i])) { lines[i] = line; return lines.join('\n'); }
  }
  lines.splice(end, 0, line);
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

// Appends one open row numbered highest-existing + 1 (1 for an empty table).
// Throws (from parseLedgerTable) when the text has no ledger table.
function appendLedgerRow(ledgerText, { phase, item, status }) {
  const table = parseLedgerTable(ledgerText);
  let number = 0;
  for (const key of table.rows.keys()) number = Math.max(number, parseInt(key, 10));
  number += 1;
  table.rows.set(String(number), `| ${number} | ${ledgerCell(phase)} | ${ledgerCell(item)} | ${status} | — |`);
  return { text: serializeLedgerTable(table), number };
}

function carryForward({
  runDir, ledgerPath, ledgerRef, id, sourcePath, content, allocate, phase, item, label, section, now,
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
    let planned;
    try {
      ledgerText = fs.readFileSync(ledgerPath, 'utf8');
      planned = appendLedgerRow(ledgerText, { phase, item, status: 'open' });
    } catch (err) {
      return degraded(`condition: ledger ${ledgerRef} has no ledger table (${err && err.message}) → fallback: nothing staged or appended; "${summary}" reaches no console`);
    }
    const { number } = planned;

    let staged;
    try {
      staged = writeStagedItem({
        runDir, id, sourcePath, content: fillLedgerHeader(content, `${ledgerRef}#${number}`), allocate,
      });
    } catch (err) {
      const stagedMsg = err && err.message;
      try {
        writeFileAtomic(ledgerPath, planned.text);
      } catch (ledgerErr) {
        return degraded(`condition: staged write failed for ${id} (${stagedMsg}) and ledger append to ${ledgerRef} failed (${ledgerErr && ledgerErr.message}) → fallback: nothing staged or appended; "${summary}" reaches no console`);
      }
      return degraded(`condition: staged write failed for ${id} (${stagedMsg}) → fallback: ledger row #${number} left open with no staged file; the resolve gate drills it`);
    }

    const base = path.basename(staged.file);
    try {
      const withPath = appendLedgerRow(ledgerText, { phase, item: `${item} (staged/${base})`, status: 'open' });
      writeFileAtomic(ledgerPath, withPath.text);
    } catch (err) {
      try { fs.unlinkSync(staged.file); } catch { /* best-effort */ }
      return degraded(`condition: ledger append to ${ledgerRef} failed (${err && err.message}) → fallback: staged/${base} removed; "${summary}" reaches no console`);
    }

    log('STAGED', `${label} carried forward`, `"${summary}". Stage path: staged/${base}`, 'high');
    return {
      code: 0, file: staged.file, id: staged.id, renamed: staged.renamed, requestedId: staged.requestedId, number, warnings,
    };
  });
}

module.exports = {
  fillLedgerHeader, headerField, appendLedgerRow, carryForward,
};
