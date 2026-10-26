// plugin/bin/lib/console/residue.js — the "no human has reviewed this" predicate
// for a resolved Review Console, and the paste-ready lines that name it (#3370).
// An `unattended` run's console.json records items it deliberately left
// `pending` / `keep-staged`; nothing re-surfaced them once the run archived.
// Pure apart from the default fs readers: read-only toward staged/ and toward
// resolution. The only write in the feature (`--ack`) lives in the CLI.
// An unresolved item whose staged file has since vanished (a rename, a cleanup)
// is `missing` (#3772): nothing exists at the id the console recorded, so there
// is nothing a human can open from it; `splitMissing` takes it out of the count
// and the banner names it once instead. A PR console's `filing-failed` /
// `reverse-failed` outcome is residue as well (#4172), with no staged file to check.
'use strict';

const fs = require('fs');
const path = require('path');

const UNRESOLVED_RESOLUTIONS = new Set(['pending', 'keep-staged']);
// #4172: a PR console's item whose filing or reverse failed is residue too; its
// `outcome` is the failed word, and its id names a PR row, not a staged file.
const FAILED_OUTCOMES = new Set(['filing-failed', 'reverse-failed']);
const MISSING_RESOLUTION = 'missing';

// A live item is returned as-is; a PR item with a failed `outcome` is returned as
// a normalized copy so the residue renderers read it like any other item.
function unresolvedItems(consoleJson) {
  if (!consoleJson || typeof consoleJson !== 'object' || !Array.isArray(consoleJson.items)) return [];
  return consoleJson.items.flatMap((i) => {
    if (!i) return [];
    if (UNRESOLVED_RESOLUTIONS.has(i.resolution)) return [i];
    if (FAILED_OUTCOMES.has(i.outcome)) {
      return [{ ...i, section: i.section ?? i.kind, resolution: i.outcome, reason: i.reason ?? i.note }];
    }
    return [];
  });
}

// Partition unresolved items into those a human can still review and those
// whose `staged/{id}` is gone from `consoleDir`. An item with no usable id, a
// `decision:` item (it lives in decisions.md, not staged/), an engine-row id
// (`docs:CLAUDE.md` — a `{row}:{label}` item with no staged file of its own),
// or an id that is not a bare file name is never classified missing — only a
// plain staged-file id can be proven absent. A failed PR outcome (#4172) is never
// missing either: its id is a PR row, so there is no staged file to be absent.
function splitMissing(items, consoleDir, exists = fs.existsSync) {
  const kept = [];
  const missing = [];
  for (const item of items) {
    const id = item && item.id;
    const checkable = typeof id === 'string' && id !== '' && !id.includes(':') && path.basename(id) === id
      && !FAILED_OUTCOMES.has(item.resolution);
    if (checkable && !exists(path.join(consoleDir, 'staged', id))) {
      missing.push({ ...item, resolution: MISSING_RESOLUTION, reason: `staged file absent (was ${item.resolution})` });
    } else {
      kept.push(item);
    }
  }
  return { items: kept, missing };
}

const defaultReadFile = (p) => fs.readFileSync(p, 'utf8');
const defaultReaddir = (p) => {
  try { return fs.readdirSync(p); } catch { return []; }
};

// `path` on each console is the ABSOLUTE console.json path. A console.json that
// is absent is the normal case (no console, or a spec dir without one) and is
// silent; one that exists but cannot be read or parsed is listed in
// `unreadable` instead, so a caller can say its items could not be checked
// rather than let it read as "no residue".
function readRunResidue(runDir, { readFile = defaultReadFile, readdir = defaultReaddir, exists } = {}) {
  const candidates = [path.join(runDir, 'console.json')];
  for (const name of readdir(runDir).filter((n) => /^spec-/.test(n)).sort()) {
    candidates.push(path.join(runDir, name, 'console.json'));
  }
  const consoles = [];
  const missingOnly = [];
  const unreadable = [];
  for (const p of candidates) {
    let parsed;
    try { parsed = JSON.parse(readFile(p)); } catch (err) {
      if (!(err && err.code === 'ENOENT')) unreadable.push(p);
      continue;
    }
    // Valid JSON that is not an object (`null`, a number) is a malformed console, not "no residue".
    if (!parsed || typeof parsed !== 'object') { unreadable.push(p); continue; }
    const { items, missing } = splitMissing(unresolvedItems(parsed), path.dirname(p), exists);
    const acknowledged = typeof parsed.residueAcknowledgedAt === 'string';
    if (items.length === 0) {
      // Not residue (nothing a human can open), but its missing items are still
      // named in the run's `not counted` line when another console is listed.
      if (missing.length > 0) missingOnly.push({ path: p, missing, acknowledged });
      continue;
    }
    consoles.push({ path: p, items, missing, acknowledged });
  }
  return { dir: runDir, consoles, missingOnly, unreadable };
}

const shown = (v) => (v === undefined || v === null || v === '' ? '—' : v);

// One item line plus its pointer: a `cat` of the staged file, or for a
// `decision:` item (no staged file — it lives in decisions.md) a `see` line.
// An item without a usable id is still listed, as `(no id)`, but gets no
// pointer — a malformed item must never throw and hide every other banner.
function itemLines(item, consoleDir) {
  const hasId = typeof item.id === 'string' && item.id !== '';
  const lines = [`  - ${hasId ? item.id : '(no id)'} — ${shown(item.section)}: ${item.resolution} (${shown(item.reason)})`];
  if (!hasId) return lines;
  if (item.id.startsWith('decision:')) {
    const decisions = path.join(consoleDir, 'decisions.md');
    if (fs.existsSync(decisions)) lines.push(`    see "${decisions}"`);
    return lines;
  }
  const staged = path.join(consoleDir, 'staged', item.id);
  if (fs.existsSync(staged)) lines.push(`    cat "${staged}"`);
  return lines;
}

// One header per run; `maxItems` caps item lines across the whole run, not
// per console. With several consoles each gets a `(relative path)` sub-line.
function formatResidueLines({ dir, consoles, missingOnly = [] }, { pluginRoot, maxItems = 5 }) {
  if (!consoles || consoles.length === 0) return [];
  const single = consoles.length === 1;
  const total = consoles.reduce((n, c) => n + c.items.length, 0);
  const lines = [`- ${path.basename(dir)}: ${total} item(s) no human has reviewed${single ? ` (${path.relative(dir, consoles[0].path)})` : ''}`];
  let count = 0;
  for (const c of consoles) {
    if (count >= maxItems) break;
    const consoleDir = path.dirname(c.path);
    if (!single) lines.push(`  (${path.relative(dir, c.path)})`);
    for (const item of c.items) {
      if (count >= maxItems) break;
      lines.push(...itemLines(item, consoleDir));
      count += 1;
    }
  }
  if (total > count) {
    lines.push(`  … and ${total - count} more — see "${single ? consoles[0].path : dir}"`);
  }
  const gone = [...consoles, ...missingOnly].flatMap((c) => {
    const stagedDir = path.join(path.dirname(c.path), 'staged');
    return (c.missing || []).map((m) => path.relative(dir, path.join(stagedDir, m.id)));
  });
  if (gone.length > 0) lines.push(`  not counted — staged file(s) no longer on disk: ${gone.join(', ')}`);
  lines.push(`  mark reviewed: node "${pluginRoot}/bin/console-residue.js" --ack --run "${dir}"`);
  return lines;
}

module.exports = { UNRESOLVED_RESOLUTIONS, FAILED_OUTCOMES, MISSING_RESOLUTION, unresolvedItems, splitMissing, readRunResidue, formatResidueLines };
