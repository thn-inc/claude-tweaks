// bin/lib/wrap-up/ledger-write.js — the write half of the pipeline ledger
// (_shared/ledger-format.md). `parseLedger` in ./pack.js is read-only
// (open/total/byPhase counts for the nothing-left-behind gate); this module
// resolves a single ledger file's path and flips one row's Status/Resolution
// cells in place, text-level, preserving every other row and the surrounding
// markdown verbatim. Rows are split and written through ./ledger-cells.js, so
// a `|` inside a cell is escaped as `\|`. Used by wrap-up-engine.js's
// `finish-console` (#2546) and bin/hooks.js's `delete-ledger` subcommand.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ownedPlansFiles } = require('./ledger-ownership');
const { splitLedgerRow, escapeLedgerCell } = require('./ledger-cells');
const { isPathContained } = require('../shared-primitives');

const TERMINAL_STATUSES = ['fixed', 'deferred', 'accepted', 'acknowledged', 'observation'];

// Local on purpose: resolveLedgerPath must not load pack.js eagerly (pack.js is required lazily, only on the docs/plans fallback).
function defaultGit(args, { cwd } = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

// Resolves the single active ledger file for a run dir, per
// _shared/ledger-format.md's Location section: `{run-dir}/ledger.md` first
// (the worktree-always/no-worktree gated location), else the one
// `docs/plans/*-ledger.md` this branch owns — added or changed against the
// merge base, or untracked (shared with pack.js's ledger probe via
// ./ledger-ownership.js, #3566). A ledger inherited from the merge base was
// written by another run and is never a candidate. Returns `{ ok: true, path }`
// or `{ ok: false, reason: 'not-found' | 'ambiguous' | 'unattributable',
// candidates?, detail? }` — never guesses among 2+ owned candidates (unlike the
// read-only probe in ./pack.js, a write needs a single certain target; the
// caller passes `explicit` to disambiguate instead), and fails closed as
// `unattributable` when ownership cannot be computed (no merge base, or git
// failed) rather than treating a lone candidate as this run's. An `explicit`
// path is never ownership-filtered; it is confined: it must be named
// `ledger.md` or `*-ledger.md` and its real path must sit under `runDir` or
// `worktree` — otherwise `{ ok: false, reason: 'rejected', detail }`, since
// callers unlink or overwrite whatever it names.
function resolveLedgerPath({ runDir, worktree, explicit, deps = {} } = {}) {
  const existsSync = deps.existsSync || fs.existsSync;
  const readdirSync = deps.readdirSync || fs.readdirSync;
  const realpathSync = deps.realpathSync || fs.realpathSync;
  const git = deps.git || defaultGit;
  // Lazy: pack.js is a heavy module, and only the docs/plans fallback needs it.
  const resolveBase = deps.resolveBase || ((wt) => require('./pack').resolveWorktreeBase(wt));

  if (explicit) {
    const base = path.basename(explicit);
    if (base !== 'ledger.md' && !base.endsWith('-ledger.md')) {
      return { ok: false, reason: 'rejected', detail: 'not a ledger file name (expected ledger.md or *-ledger.md)', candidates: [explicit] };
    }
    if (!existsSync(explicit)) return { ok: false, reason: 'not-found', candidates: [explicit] };
    const real = (p) => { try { return realpathSync(p); } catch { return null; } };
    const target = real(explicit);
    const roots = [runDir, worktree].filter(Boolean).map(real).filter(Boolean);
    if (!target || !roots.some((r) => isPathContained(target, r))) {
      return { ok: false, reason: 'rejected', detail: 'outside the run directory and worktree', candidates: [explicit] };
    }
    return { ok: true, path: explicit };
  }

  const runDirLedger = path.join(runDir, 'ledger.md');
  if (existsSync(runDirLedger)) return { ok: true, path: runDirLedger };

  const plansDir = path.join(worktree, 'docs', 'plans');
  let entries = [];
  try { entries = readdirSync(plansDir); } catch { entries = []; }
  const names = entries.filter((f) => f.endsWith('-ledger.md'));
  if (names.length === 0) return { ok: false, reason: 'not-found', candidates: [] };

  // Ownership decides which of them is this run's (#3566): a ledger inherited
  // from the merge base belongs to another run, and flipping or deleting it
  // from here would destroy that run's record.
  let owned;
  try {
    owned = ownedPlansFiles({ worktree, base: resolveBase(worktree), git });
  } catch (e) {
    return { ok: false, reason: 'unattributable', detail: e.message, candidates: names.map((f) => path.join(plansDir, f)) };
  }
  const candidates = names.filter((f) => owned.has(f)).map((f) => path.join(plansDir, f));
  if (candidates.length === 0) return { ok: false, reason: 'not-found', candidates: [] };
  if (candidates.length > 1) return { ok: false, reason: 'ambiguous', candidates };
  return { ok: true, path: candidates[0] };
}

// Splits a ledger file's text into { preamble, header, separator, rows, trailer,
// duplicates } — `rows` keyed by item number (string, as it appears in the `#`
// column). `duplicates` lists each item number that more than one row carries
// (once each, in first-repeat order; `[]` when none): `rows` keeps only the last
// such row, so serializeLedgerTable refuses to write a table with duplicates
// back (#3834). Throws if the file doesn't look like a ledger table at all (no
// header row found) — a caller mutating a row needs the table to actually be there.
function parseLedgerTable(text) {
  const lines = text.split('\n');
  const headerIdx = lines.findIndex((l) => /^\|\s*#\s*\|/.test(l));
  if (headerIdx === -1) throw new Error('no ledger table header row found (expected "| # | Phase | Item | Status | Resolution |")');
  const separatorIdx = headerIdx + 1;
  const rows = new Map();
  const duplicates = [];
  let rowsEnd = separatorIdx + 1;
  for (let i = separatorIdx + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^\|\s*(\d+)\s*\|/);
    if (!m) { rowsEnd = i; break; }
    if (rows.has(m[1]) && !duplicates.includes(m[1])) duplicates.push(m[1]);
    rows.set(m[1], lines[i]);
    rowsEnd = i + 1;
  }
  return {
    preamble: lines.slice(0, headerIdx),
    header: lines[headerIdx],
    separator: lines[separatorIdx],
    rows,
    trailer: lines.slice(rowsEnd),
    duplicates,
  };
}

// Throws when the table holds duplicate row numbers: the Map in `rows` already
// collapsed them, so writing it back would silently drop a row (#3834).
function serializeLedgerTable(table) {
  const duplicates = table.duplicates || [];
  if (duplicates.length > 0) {
    throw new Error(`ledger table has duplicate row number(s) ${duplicates.map((n) => `#${n}`).join(', ')} — writing it back would drop a row; renumber by hand (_shared/ledger-format.md's Item Numbering)`);
  }
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
  const cells = splitLedgerRow(row);
  // cells[0] is '' (text before the leading '|'); columns are 1-indexed from
  // there: [1]=#, [2]=Phase, [3]=Item, [4]=Status, [5]=Resolution, [6]=''
  // (text after the trailing '|'). A row with extra/fewer cells than this
  // fixed 7-slot shape is malformed — refuse rather than guess which cell is
  // which. A raw `|` inside a cell (a legacy, unescaped row) is one such case.
  if (cells.length !== 7) {
    throw new Error(`ledger row for item #${item} does not have the expected 5-column shape — a raw \`|\` inside a cell must be written \`\\|\` (_shared/ledger-format.md's Format section)`);
  }
  cells[4] = ` ${status} `;
  // Line breaks collapse to one space: a raw newline would split the row across lines.
  const singleLine = String(resolution || '').replace(/\s*\r?\n\s*/g, ' ').trim();
  cells[5] = ` ${escapeLedgerCell(singleLine) || '—'} `;
  table.rows.set(key, cells.join('|'));
  return serializeLedgerTable(table);
}

module.exports = { TERMINAL_STATUSES, resolveLedgerPath, parseLedgerTable, serializeLedgerTable, flipLedgerRow };
