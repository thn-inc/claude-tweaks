'use strict';

// Review size proxy (#5148): sizes a change for /review Step 2.5 while leaving
// out files that are pipeline bookkeeping or lockfiles. Pure: no fs, no git.

const { globToRegExp } = require('../issues/blast-radius');
const { BOOKKEEPING_RULES } = require('../init/verify-scope-starter');
const { ALWAYS_STUB_BASENAMES } = require('./build');

const HIGH_FILES = 10;
const HIGH_LINES = 300;
const MEDIUM_FILES = 3;
const MEDIUM_LINES = 50;

function parseNumstat(text) {
  const s = String(text || '');
  const records = s.includes('\0') ? s.split('\0') : s.split('\n');
  const out = [];
  for (const rec of records) {
    if (!rec) continue;
    const i1 = rec.indexOf('\t');
    if (i1 < 0) continue;
    const i2 = rec.indexOf('\t', i1 + 1);
    if (i2 < 0) continue;
    const a = rec.slice(0, i1);
    const d = rec.slice(i1 + 1, i2);
    const file = rec.slice(i2 + 1);
    if (!file) continue;
    out.push({ file, lines: a === '-' && d === '-' ? 0 : (Number(a) || 0) + (Number(d) || 0) });
  }
  return out;
}

// A rule is bookkeeping by shape only: it runs no suite, is not static, and
// carries no impact selection.
function isBookkeepingRule(rule) {
  return Array.isArray(rule.suites) && rule.suites.length === 0 && rule.static === false && !rule.impact;
}

function isBookkeeping(file, decl) {
  if (decl === null || decl === undefined) {
    return BOOKKEEPING_RULES.some((g) => globToRegExp(g).test(file));
  }
  const idx = decl.rules.findIndex((r) => globToRegExp(r.match).test(file));
  return idx >= 0 && isBookkeepingRule(decl.rules[idx]);
}

function classifyPath(file, decl) {
  if (isBookkeeping(file, decl)) return 'bookkeeping';
  const base = file.split(/[\\/]/).pop();
  if (ALWAYS_STUB_BASENAMES.has(base)) return 'lockfile';
  return null;
}

function sizeTier(files, lines) {
  if (files >= HIGH_FILES || lines >= HIGH_LINES) return 'high';
  if (files >= MEDIUM_FILES || lines >= MEDIUM_LINES) return 'medium';
  return 'low';
}

function computeSizeProxy({ numstat, decl = null, ownWork = null }) {
  let entries = parseNumstat(numstat);
  if (Array.isArray(ownWork)) {
    const keep = new Set(ownWork);
    entries = entries.filter((e) => keep.has(e.file));
  }
  let files = 0;
  let lines = 0;
  const excluded = [];
  for (const e of entries) {
    const reason = classifyPath(e.file, decl);
    if (reason) excluded.push({ file: e.file, lines: e.lines, reason });
    else { files += 1; lines += e.lines; }
  }
  return { files, lines, size: sizeTier(files, lines), excluded };
}

module.exports = { parseNumstat, classifyPath, sizeTier, computeSizeProxy };
