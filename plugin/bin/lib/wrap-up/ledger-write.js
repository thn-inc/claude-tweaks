// bin/lib/wrap-up/ledger-write.js — the write half of the pipeline ledger
// (_shared/ledger-format.md). `parseLedger` in ./pack.js is read-only
// (open/total/byPhase counts for the nothing-left-behind gate); this module
// resolves a single ledger file's path and flips one row's Status/Resolution
// cells in place, text-level, preserving every other row and the surrounding
// markdown verbatim. Used by wrap-up-engine.js's `finish-console` (#2546)
// and bin/hooks.js's `delete-ledger` subcommand.
'use strict';

const fs = require('fs');
const path = require('path');

const TERMINAL_STATUSES = ['fixed', 'deferred', 'accepted', 'acknowledged', 'observation'];

// Resolves the single active ledger file for a run dir, per
// _shared/ledger-format.md's Location section: `{run-dir}/ledger.md` first
// (the worktree-always/no-worktree gated location), else exactly one
// `docs/plans/*-ledger.md` candidate in the worktree. Returns
// `{ ok: true, path }` or `{ ok: false, reason: 'not-found' | 'ambiguous',
// candidates? }` — never guesses among 2+ docs/plans/ candidates (unlike the
// read-only probe in ./pack.js, a write needs a single certain target; the
// caller passes `explicit` to disambiguate instead). An `explicit` path is
// confined: it must be named `ledger.md` or `*-ledger.md` and its real path
// must sit under `runDir` or `worktree` — otherwise `{ ok: false, reason:
// 'rejected', detail }`, since callers unlink or overwrite whatever it names.
function resolveLedgerPath({ runDir, worktree, explicit, deps = {} } = {}) {
  const existsSync = deps.existsSync || fs.existsSync;
  const readdirSync = deps.readdirSync || fs.readdirSync;
  const realpathSync = deps.realpathSync || fs.realpathSync;

  if (explicit) {
    const base = path.basename(explicit);
    if (base !== 'ledger.md' && !base.endsWith('-ledger.md')) {
      return { ok: false, reason: 'rejected', detail: 'not a ledger file name (expected ledger.md or *-ledger.md)', candidates: [explicit] };
    }
    if (!existsSync(explicit)) return { ok: false, reason: 'not-found', candidates: [explicit] };
    const real = (p) => { try { return realpathSync(p); } catch { return null; } };
    const target = real(explicit);
    const roots = [runDir, worktree].filter(Boolean).map(real).filter(Boolean);
    if (!target || !roots.some((r) => target.startsWith(r + path.sep))) {
      return { ok: false, reason: 'rejected', detail: 'outside the run directory and worktree', candidates: [explicit] };
    }
    return { ok: true, path: explicit };
  }

  const runDirLedger = path.join(runDir, 'ledger.md');
  if (existsSync(runDirLedger)) return { ok: true, path: runDirLedger };

  const plansDir = path.join(worktree, 'docs', 'plans');
  let entries = [];
  try { entries = readdirSync(plansDir); } catch { entries = []; }
  const candidates = entries.filter((f) => f.endsWith('-ledger.md')).map((f) => path.join(plansDir, f));
  if (candidates.length === 0) return { ok: false, reason: 'not-found', candidates: [] };
  if (candidates.length > 1) return { ok: false, reason: 'ambiguous', candidates };
  return { ok: true, path: candidates[0] };
}

// Splits a ledger file's text into { preamble, header, separator, rows } —
// `rows` keyed by item number (string, as it appears in the `#` column).
// Throws if the file doesn't look like a ledger table at all (no header row
// found) — a caller mutating a row needs the table to actually be there.
function parseLedgerTable(text) {
  const lines = text.split('\n');
  const headerIdx = lines.findIndex((l) => /^\|\s*#\s*\|/.test(l));
  if (headerIdx === -1) throw new Error('no ledger table header row found (expected "| # | Phase | Item | Status | Resolution |")');
  const separatorIdx = headerIdx + 1;
  const rows = new Map();
  let rowsEnd = separatorIdx + 1;
  for (let i = separatorIdx + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^\|\s*(\d+)\s*\|/);
    if (!m) { rowsEnd = i; break; }
    rows.set(m[1], lines[i]);
    rowsEnd = i + 1;
  }
  return {
    preamble: lines.slice(0, headerIdx),
    header: lines[headerIdx],
    separator: lines[separatorIdx],
    rows,
    trailer: lines.slice(rowsEnd),
  };
}

function serializeLedgerTable(table) {
  return [...table.preamble, table.header, table.separator, ...table.rows.values(), ...table.trailer].join('\n');
}

// Rewrites one row's Status/Resolution cells (columns 4 and 5) in place,
// leaving the `#`/Phase/Item cells and every other row untouched. Throws
// when `item` has no matching row, or `status` is not one of the five
// terminal statuses (`open` is never a valid target here — this function
// only resolves items, never reopens one; ledger-format.md's lifecycle has
// no terminal-to-open transition). `resolution` is required unless `status`
// is `observation`, matching ledger-format.md's Resolution-text requirement.
function flipLedgerRow(text, { item, status, resolution }) {
  if (!TERMINAL_STATUSES.includes(status)) {
    throw new Error(`invalid status '${status}' (expected one of ${TERMINAL_STATUSES.join(', ')})`);
  }
  if (status !== 'observation' && !String(resolution || '').trim()) {
    throw new Error(`resolution text is required for status '${status}'`);
  }
  const table = parseLedgerTable(text);
  const key = String(item);
  const row = table.rows.get(key);
  if (row === undefined) throw new Error(`no ledger row for item #${item}`);
  const cells = row.split('|');
  // cells[0] is '' (text before the leading '|'); columns are 1-indexed from
  // there: [1]=#, [2]=Phase, [3]=Item, [4]=Status, [5]=Resolution, [6]=''
  // (text after the trailing '|'). A row with extra/fewer cells than this
  // fixed 7-slot shape is malformed — refuse rather than guess which cell is
  // which.
  if (cells.length !== 7) throw new Error(`ledger row for item #${item} does not have the expected 5-column shape`);
  cells[4] = ` ${status} `;
  cells[5] = ` ${String(resolution || '').trim() || '—'} `;
  table.rows.set(key, cells.join('|'));
  return serializeLedgerTable(table);
}

module.exports = { TERMINAL_STATUSES, resolveLedgerPath, parseLedgerTable, serializeLedgerTable, flipLedgerRow };
