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
//
// The module also exports the plain-row writer behind `hooks.js ledger-row`
// (#4439): checkLedgerStatus (the status/Resolution rules a caller validates
// with first), appendRow and settleRow (the locked append and settle, under the
// same `.ledger.lock`, fail-closed). Neither write function applies
// checkLedgerStatus's status/Resolution rules — the CLI calls it before them;
// settleRow only enforces the row-transition guards.
'use strict';

const fs = require('fs');
const path = require('path');
const {
  TERMINAL_STATUSES, parseLedgerTable, serializeLedgerTable, rewriteLedgerRow,
} = require('../wrap-up/ledger-write');
const { escapeLedgerCell, collapseLineBreaks, ledgerRowCells } = require('../wrap-up/ledger-cells');
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
  return escapeLedgerCell(collapseLineBreaks(text));
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
function appendLedgerRow(ledgerText, {
  phase, item, status, resolution,
}) {
  const table = parseLedgerTable(ledgerText);
  const numbered = ledgerText.split('\n').map((l) => NUMBERED_ROW_RE.exec(l)).filter(Boolean).map((m) => parseInt(m[1], 10));
  const outside = [...table.preamble, ...table.trailer].filter((l) => NUMBERED_ROW_RE.test(l)).length;
  const unsafe = (message) => Object.assign(new Error(message), { code: 'LEDGER_UNSAFE' });
  if (outside > 0) throw unsafe('numbered rows exist outside the contiguous table (a row after a blank or non-table line) — fix the ledger by hand');
  if (numbered.length !== table.rows.size) throw unsafe('duplicate row numbers in the ledger table — fix the ledger by hand');
  const number = Math.max(0, ...numbered) + 1;
  table.rows.set(String(number), `| ${number} | ${ledgerCell(phase)} | ${ledgerCell(item)} | ${status} | ${ledgerCell(resolution == null ? '' : resolution) || '—'} |`);
  return { text: serializeLedgerTable(table), number };
}

// The lock every ledger writer in a run takes (carryForward, appendRow, settleRow).
function ledgerLockPath(runDir) {
  return path.join(runDir, '.ledger.lock');
}

function carryForward({
  runDir, ledgerPath, ledgerRef, id, sourcePath, content, allocate, phase, item, label, section, now,
  readLedger = (p) => fs.readFileSync(p, 'utf8'), // test seam: lets a test take a row between the reads
  unlink = fs.unlinkSync, // test seam: lets a test fail the staged file's removal
}) {
  return withLock(ledgerLockPath(runDir), () => {
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

// ---- The plain-row writer behind `hooks.js ledger-row` (#4439) ----

// _shared/ledger-format.md's Status enum.
const LEDGER_STATUSES = ['open', ...TERMINAL_STATUSES];
// The note wrap-up/refused-proposals.md's Ledger origin writes when it reopens a refused proposal's row.
const REFUSED_PROPOSAL_NOTE = 'proposal refused — no defer reason';

// Loaded on first use: bin/stage-item.js requires this module and must not pay for pack.js.
const wrapUpPack = () => require('../wrap-up/pack');

// Every pattern below runs over an unbounded Resolution (.claude/skills/regex-scan-linearity):
// single-character classes only, nothing repeated before a literal that can fail.
const URL_SPAN_RE = /https?:\/\/\S+/g;
const SHA_RE = /\b(?=[0-9a-f]{0,39}[0-9])[0-9a-f]{6,40}\b/g; // a digit-free run ("facade") is a word
const FILENAME_RE = /\w\.[A-Za-z]{2}[A-Za-z0-9]{0,4}\b/; // two or more letters: "e.g." is not a file
const PR_REF_RE = /\bPR #\d+\b/;
const PULL_URL_RE = /^https?:\/\/([A-Za-z0-9.-]+)\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#]\S*)?$/;

// A sha not immediately preceded by `#` (a bare `#123456` is an item number). Checked by hand, not a
// lookbehind, so the regex keeps one shape.
function hasSha(text) {
  for (const m of text.matchAll(SHA_RE)) {
    if (text[m.index - 1] !== '#') return true;
  }
  return false;
}

// Two or more `/` with a non-empty segment between them ("plugin/bin/x"; not "n/a" or "and/or").
function hasPath(text) {
  for (const token of text.split(/\s+/)) {
    const parts = token.split('/');
    if (parts.length >= 3 && parts.slice(1, -1).some((segment) => segment !== '')) return true;
  }
  return false;
}

// A URL span runs to the next whitespace, so it carries the prose punctuation around it: a
// backtick, a closing paren, a sentence period. Trimmed from the end by index, not a `+$` regex.
const URL_TAIL_PUNCTUATION = '`)>.,;:\'"';
function trimUrlTail(span) {
  let end = span.length;
  while (end > 0 && URL_TAIL_PUNCTUATION.includes(span[end - 1])) end -= 1;
  return span.slice(0, end);
}

const sameText = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// `repo` is repo-resolve.js's parseRepo shape ({ host, owner, repo }) or null (origin unresolvable).
function checkFixed(resolution, repo) {
  const urls = resolution.match(URL_SPAN_RE) || [];
  const bare = resolution.replace(URL_SPAN_RE, ' ');
  if (hasSha(bare) || hasPath(bare) || FILENAME_RE.test(bare) || PR_REF_RE.test(resolution)) return null;
  const pulls = urls.map((url) => PULL_URL_RE.exec(trimUrlTail(url))).filter(Boolean);
  if (repo && pulls.some((m) => sameText(m[1], repo.host) && sameText(m[2], repo.owner) && sameText(m[3], repo.repo))) return null;
  const accepted = 'a commit sha, file reference, or resolving PR (`PR #N` or this repo\'s /pull/N URL)';
  if (!repo && pulls.length > 0) {
    return `status 'fixed' needs ${accepted}; origin repo unresolvable, so a /pull/N URL cannot be matched to it — name the PR as \`PR #N\``;
  }
  return `status 'fixed' needs ${accepted} in the Resolution`;
}

function isIncompleteDeferral(resolution, excludeRecords) {
  const { LEDGER_DEFERRED_STAGED_RE, namesRecordReference } = wrapUpPack();
  return !LEDGER_DEFERRED_STAGED_RE.test(resolution) && !namesRecordReference(resolution, excludeRecords);
}

// The rules a status/Resolution pair owes before a row is written — the sanctioned writer's half of
// _shared/ledger-format.md's Resolution-text requirements. `incompleteDeferral` marks a `deferred`
// row that carries only a valid `Defer-reason:`: accepted, but settleRow may later resolve it.
function checkLedgerStatus(status, resolution, { excludeRecords = [], repo = null } = {}) {
  const text = String(resolution == null ? '' : resolution);
  const ok = { refusal: null, incompleteDeferral: false };
  if (!LEDGER_STATUSES.includes(status)) {
    return { ...ok, refusal: `invalid status '${status}' (expected one of ${LEDGER_STATUSES.join(', ')})` };
  }
  if (status === 'fixed') return { ...ok, refusal: checkFixed(text, repo) };
  if (status === 'deferred') {
    if (!isIncompleteDeferral(text, excludeRecords)) return ok;
    if (wrapUpPack().hasValidDeferReason(text)) return { refusal: null, incompleteDeferral: true };
    return {
      ...ok,
      refusal: 'status \'deferred\' needs the Resolution to name a `staged/` path, a record reference (issue/PR URL or `#N`), or exactly one valid `Defer-reason:` token (_shared/deferral-gate.md)',
    };
  }
  if ((status === 'accepted' || status === 'acknowledged') && !text.trim()) {
    return { ...ok, refusal: `status '${status}' needs a non-blank resolution` };
  }
  return ok;
}

// Appends one row under the ledger lock, fail-closed: a held lock throws LOCK_TIMEOUT instead of
// racing. Throws on an unreadable ledger, no table, and LEDGER_UNSAFE (see appendLedgerRow).
function appendRow({
  runDir, ledgerPath, phase, item, status, resolution,
  readLedger = (p) => fs.readFileSync(p, 'utf8'), // test seam: lets a test attempt a second append between this call's read and its write
}) {
  return withLock(ledgerLockPath(runDir), () => {
    const appended = appendLedgerRow(readLedger(ledgerPath), {
      phase, item, status, resolution,
    });
    writeFileAtomic(ledgerPath, appended.text);
    return { number: appended.number };
  }, { failClosed: true });
}

// Rewrites row `row`'s Status and Resolution under the ledger lock, fail-closed. The status guards
// read the row's current state first: a terminal row is final ("a wrong resolution gets a new
// item") except an incomplete `deferred` one, and `open` is reachable only from `open` or by the
// refused-proposal reopen. The row is looked up before any guard runs, so a missing or
// non-5-column row throws rewriteLedgerRow's own message, never a guard reading a shifted cell.
function settleRow({
  runDir, ledgerPath, row, status, resolution, excludeRecords = [],
}) {
  return withLock(ledgerLockPath(runDir), () => {
    const text = fs.readFileSync(ledgerPath, 'utf8');
    const rewritten = rewriteLedgerRow(text, { item: row, status, resolution });
    const [, , , currentRaw, currentResolution] = ledgerRowCells(parseLedgerTable(text).rows.get(String(row)));
    const current = (currentRaw || '').toLowerCase();
    const shown = current || '(empty)';
    const { LEDGER_DEFERRED_STAGED_RE } = wrapUpPack();
    if (status === 'open') {
      const refusedReopen = current === 'deferred' && LEDGER_DEFERRED_STAGED_RE.test(currentResolution)
        && String(resolution || '').includes(REFUSED_PROPOSAL_NOTE);
      if (current !== 'open' && !refusedReopen) {
        throw new Error(`row #${row} is ${shown}; only an open row, or a deferred row naming a staged/ path reopened with the note '${REFUSED_PROPOSAL_NOTE}' (the refused-proposal reopen, _shared/ledger-format.md's Resolution-text requirements), can be set to open`);
      }
    } else if (TERMINAL_STATUSES.includes(current) && !(current === 'deferred' && isIncompleteDeferral(currentResolution, excludeRecords))) {
      throw new Error(`row #${row} is already ${shown} (terminal) — a wrong resolution gets a new item`);
    }
    writeFileAtomic(ledgerPath, rewritten);
    return { number: Number(row) };
  }, { failClosed: true });
}

module.exports = {
  fillLedgerHeader, headerField, appendLedgerRow, carryForward,
  LEDGER_STATUSES, REFUSED_PROPOSAL_NOTE, ledgerLockPath, isIncompleteDeferral, checkLedgerStatus, appendRow, settleRow,
};
