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

// `path` on each console is the ABSOLUTE console.json path.
function readRunResidue(runDir, { readFile = defaultReadFile, readdir = defaultReaddir } = {}) {
  const candidates = [path.join(runDir, 'console.json')];
  for (const name of readdir(runDir).filter((n) => /^spec-/.test(n)).sort()) {
    candidates.push(path.join(runDir, name, 'console.json'));
  }
  const consoles = [];
  for (const p of candidates) {
    let parsed;
    try { parsed = JSON.parse(readFile(p)); } catch { continue; }
    const items = unresolvedItems(parsed);
    if (items.length === 0) continue;
    consoles.push({ path: p, items, acknowledged: typeof parsed.residueAcknowledgedAt === 'string' });
  }
  return { dir: runDir, consoles };
}

function formatResidueLines({ dir, consoles }, { pluginRoot, maxItems = 5 }) {
  if (!consoles || consoles.length === 0) return [];
  const lines = [];
  for (const c of consoles) {
    const consoleDir = path.dirname(c.path);
    lines.push(`- ${path.basename(dir)}: ${c.items.length} item(s) no human has reviewed (${path.relative(dir, c.path)})`);
    for (const item of c.items.slice(0, maxItems)) {
      lines.push(`  - ${item.id} — ${item.section}: ${item.resolution} (${item.reason})`);
      const staged = path.join(consoleDir, 'staged', item.id);
      if (fs.existsSync(staged)) lines.push(`    cat "${staged}"`);
    }
    if (c.items.length > maxItems) {
      lines.push(`  … and ${c.items.length - maxItems} more — see "${c.path}"`);
    }
  }
  lines.push(`  mark reviewed: node "${pluginRoot}/bin/console-residue.js" --ack --run "${dir}"`);
  return lines;
}

module.exports = { UNRESOLVED_RESOLUTIONS, unresolvedItems, readRunResidue, formatResidueLines };
