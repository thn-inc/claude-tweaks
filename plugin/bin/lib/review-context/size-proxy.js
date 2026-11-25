'use strict';

// Review size proxy (#5148): sizes a change for /review Step 2.5 while leaving
// out files that are pipeline bookkeeping or lockfiles. computeSizeProxy and its helpers are pure;
// collectSizeProxy gathers inputs through an injected git and reader.

const { globToRegExp } = require('../issues/blast-radius');
const { BOOKKEEPING_RULES } = require('../init/verify-scope-starter');
const fs = require('node:fs');
const path = require('node:path');
const { ALWAYS_STUB_BASENAMES } = require('./build');
const { readDeclaration, DECLARATION_PATH } = require('../verify/declaration');

const HIGH_FILES = 10;
const HIGH_LINES = 300;
const MEDIUM_FILES = 3;
const MEDIUM_LINES = 50;

// Assumes `git diff --numstat -z --no-renames` output: a rename record would otherwise carry an
// empty path field followed by two path records.
function parseNumstat(text) {
  const s = String(text || '');
  const records = s.includes('\0') ? s.split('\0') : s.split('\n');
  const out = [];
  // An unparseable record still counts as one file with 0 lines: the proxy fails toward the higher count.
  for (const rec of records) {
    if (!rec) continue;
    const i1 = rec.indexOf('\t');
    const i2 = i1 < 0 ? -1 : rec.indexOf('\t', i1 + 1);
    if (i2 < 0) { out.push({ file: rec, lines: 0 }); continue; }
    const a = rec.slice(0, i1);
    const d = rec.slice(i1 + 1, i2);
    const file = rec.slice(i2 + 1);
    if (!file) { out.push({ file: rec, lines: 0 }); continue; }
    const lines = a === '-' && d === '-' ? 0 : Number(a) + Number(d);
    out.push({ file, lines: Number.isFinite(lines) ? lines : 0 });
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
    // A listed path numstat did not report (git quotes non-ASCII paths in a plain --name-only list)
    // still counts as one file with 0 lines, so the size fails toward higher.
    const seen = new Set(entries.map((e) => e.file));
    for (const f of keep) if (!seen.has(f)) entries.push({ file: f, lines: 0 });
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

const NUMSTAT_ARGV = ['-c', 'core.quotePath=false', 'diff', '--numstat', '-z', '--no-renames', '--no-color', '--no-ext-diff', '--end-of-options'];

// The git-facing half: runs the pinned numstat, reads the declaration (an unreadable one falls
// back to the built-in list, never to "no exclusions"), and applies an optional --files-from scope.
function collectSizeProxy({ base, branch, filesFrom = null, cwd, git, readFile = fs.readFileSync, readDecl = readDeclaration }) {
  const numstat = git([...NUMSTAT_ARGV, `${base}...${branch}`]);
  const root = String(git(['rev-parse', '--show-toplevel'])).trim();
  const res = readDecl(path.join(root, DECLARATION_PATH));
  const decl = res && res.ok ? res.decl || null : null;
  const ownWork = filesFrom
    ? readFile(cwd ? path.resolve(cwd, filesFrom) : filesFrom, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
    : null;
  return computeSizeProxy({ numstat, decl, ownWork });
}

module.exports = { collectSizeProxy, parseNumstat, classifyPath, sizeTier, computeSizeProxy };
