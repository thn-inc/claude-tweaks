// plugin/bin/lib/verify/scope.js — the pure scope-selection rule (#1922).
// No fs, no git: declaration + changed files + current stamp in,
// {mode, suites, static, base, unmatched, matched} out. Unmatched paths fail
// CLOSED to {suites: '*', static: true} ([IL-120]: a markdown edit tripped a
// size-ceiling test in an unrelated suite — only declared paths get cheaper).
// The anchoring invariant lives here: every non-full mode's base is the
// stamp's fullSha, never a prior scoped sha, so scoped runs never chain.
'use strict';

const { globToRegExp } = require('../issues/blast-radius');
const { anchorOf } = require('./stamp');

function selectScope({ decl, files, stamp }) {
  const base = anchorOf(stamp);
  // No declaration: today's behavior byte-for-byte. No prior full pass: the
  // first run IS the anchor everything later diffs against, so it is full too.
  if (!decl || base === null) {
    return { mode: 'full', suites: '*', static: true, base, unmatched: [], matched: [] };
  }
  const matched = [];
  const unmatched = [];
  const selected = new Set();
  let all = false;
  let isStatic = false;
  for (const file of files) {
    const idx = decl.rules.findIndex((r) => globToRegExp(r.match).test(file));
    if (idx === -1) {
      unmatched.push(file);
      matched.push({ file, rule: null });
      all = true;
      isStatic = true;
      continue;
    }
    const rule = decl.rules[idx];
    matched.push({ file, rule: idx });
    if (rule.suites === '*') all = true;
    else for (const s of rule.suites) selected.add(s);
    if (rule.static) isStatic = true;
  }
  if (decl.toolScoped) {
    if (files.length === 0) return { mode: 'none', suites: [], static: false, base, unmatched, matched };
    return { mode: 'tool-scoped', suites: ['tests'], static: isStatic, base, unmatched, matched };
  }
  const suites = all ? decl.suites.slice().sort() : [...selected].sort();
  const everySuite = suites.length > 0 && suites.length === decl.suites.length;
  let mode;
  if (everySuite && isStatic) mode = 'full';
  else if (suites.length === 0 && isStatic) mode = 'static-only';
  else if (suites.length === 0) mode = 'none';
  else mode = 'scoped';
  return { mode, suites: mode === 'full' ? '*' : suites, static: isStatic, base, unmatched, matched };
}

module.exports = { selectScope };
