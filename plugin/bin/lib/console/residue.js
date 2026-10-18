// plugin/bin/lib/console/residue.js — the "no human has reviewed this" predicate
// for a resolved Review Console, and the paste-ready lines that name it (#3370).
// An `unattended` run's console.json records items it deliberately left
// `pending` / `keep-staged`; nothing re-surfaced them once the run archived.
// Pure apart from the default fs readers: read-only toward staged/ and toward
// resolution. The only write in the feature (`--ack`) lives in the CLI.
'use strict';

const fs = require('fs');
const path = require('path');

const UNRESOLVED_RESOLUTIONS = new Set(['pending', 'keep-staged']);

function unresolvedItems(consoleJson) {
  if (!consoleJson || typeof consoleJson !== 'object' || !Array.isArray(consoleJson.items)) return [];
  return consoleJson.items.filter((i) => i && UNRESOLVED_RESOLUTIONS.has(i.resolution));
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
function readRunResidue(runDir, { readFile = defaultReadFile, readdir = defaultReaddir } = {}) {
  const candidates = [path.join(runDir, 'console.json')];
  for (const name of readdir(runDir).filter((n) => /^spec-/.test(n)).sort()) {
    candidates.push(path.join(runDir, name, 'console.json'));
  }
  const consoles = [];
  const unreadable = [];
  for (const p of candidates) {
    let parsed;
    try { parsed = JSON.parse(readFile(p)); } catch (err) {
      if (!(err && err.code === 'ENOENT')) unreadable.push(p);
      continue;
    }
    const items = unresolvedItems(parsed);
    if (items.length === 0) continue;
    consoles.push({ path: p, items, acknowledged: typeof parsed.residueAcknowledgedAt === 'string' });
  }
  return { dir: runDir, consoles, unreadable };
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
function formatResidueLines({ dir, consoles }, { pluginRoot, maxItems = 5 }) {
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
  lines.push(`  mark reviewed: node "${pluginRoot}/bin/console-residue.js" --ack --run "${dir}"`);
  return lines;
}

module.exports = { UNRESOLVED_RESOLUTIONS, unresolvedItems, readRunResidue, formatResidueLines };
