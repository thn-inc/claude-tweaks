// plugin/bin/lib/verify/scope.js — the pure scope-selection rule (#1922).
// No fs, no git: declaration + changed files + current stamp in,
// {mode, suites, static, base, unmatched, matched} out. Unmatched paths fail
// CLOSED to {suites: '*', static: true} ([IL-120]: a markdown edit tripped a
// size-ceiling test in an unrelated suite — only declared paths get cheaper).
// The anchoring invariant lives here: every non-full mode's base is the
// stamp's fullSha (or, for an impact declaration with no stamp, the caller's
// integration-branch merge-base, fallbackBase), never a prior scoped sha, so
// scoped runs never chain.
//
// Test-impact selection (#4024), gated on decl.impact: a file matched by an
// impact rule goes to impact.js's selectImpactTests, so impact.suite runs only
// the test files a traced map says read it. Any reason the map cannot answer
// (impact.problem, an untraced path) runs that suite full with the reason in
// `fallback`; a non-impact rule (or an unmatched path) that selects the suite
// supersedes the subset. Without a stamp, the caller's --integration-branch
// merge-base (`fallbackBase`) anchors an impact declaration; an explicit
// --base never does.
'use strict';

const { globToRegExp } = require('../issues/blast-radius');
const { anchorOf } = require('./stamp');
const { selectImpactTests } = require('./impact');

function impactResult(suite, fields = {}) {
  return { suite, files: null, fallback: null, selected: null, changedTests: [], untracedTests: [], superseded: false, ...fields };
}

// `ctx` is the caller's {map, problem, headTests}; a missing context or map
// fails closed as 'map-missing'.
function contextProblem(ctx) {
  return !ctx ? 'map-missing' : ctx.problem || (ctx.map ? null : 'map-missing');
}

// Never called with an empty `paths`.
function resolveImpact(decl, paths, statuses, ctx) {
  const suite = decl.impact.suite;
  const problem = contextProblem(ctx);
  if (problem) return impactResult(suite, { fallback: problem });
  const patterns = decl.impact.tests.map((g) => globToRegExp(g));
  // A path with no recorded status reads as 'A' — added/deleted reaches
  // existence probes and directory listings too, the broader match — so a
  // missing status can only select more tests, never fewer (fail-conservative).
  const changed = paths.map((p) => ({ path: p, status: (statuses && statuses[p]) || 'A' }));
  const r = selectImpactTests({ map: ctx.map, changed, headTests: ctx.headTests || [], isTestFile: (p) => patterns.some((re) => re.test(p)) });
  if (!r.ok) return impactResult(suite, { fallback: r.reason });
  return impactResult(suite, { files: r.tests, selected: r.tests.length, changedTests: r.changedTests, untracedTests: r.untracedTests });
}

function selectScope({ decl, files, stamp, statuses = null, impact = null, fallbackBase = null }) {
  let base = anchorOf(stamp);
  if (base === null && decl && decl.impact) base = fallbackBase || null;
  // No declaration: today's behavior byte-for-byte. No prior full pass: the
  // first run IS the anchor everything later diffs against, so it is full too.
  if (!decl || base === null) {
    const full = { mode: 'full', suites: '*', static: true, base, unmatched: [], matched: [] };
    // Unanchored, the impact suite runs full like every other suite: a
    // context problem names why when there is one, else 'no-anchor'.
    if (decl && decl.impact) full.impact = impactResult(decl.impact.suite, { fallback: contextProblem(impact) || 'no-anchor' });
    return full;
  }
  const matched = [];
  const unmatched = [];
  const selected = new Set();
  const impactPaths = [];
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
    if (rule.impact) impactPaths.push(file);
    else if (rule.suites === '*') all = true;
    else for (const s of rule.suites) selected.add(s);
    if (rule.static) isStatic = true;
  }
  if (decl.toolScoped) {
    if (files.length === 0) return { mode: 'none', suites: [], static: false, base, unmatched, matched };
    return { mode: 'tool-scoped', suites: ['tests'], static: isStatic, base, unmatched, matched };
  }
  let imp = null;
  if (decl.impact) {
    const suite = decl.impact.suite;
    if (all || selected.has(suite)) imp = impactResult(suite, { superseded: true });
    // Nothing selected it: the empty subset, so `files null` keeps meaning
    // "runs its full command".
    else if (impactPaths.length === 0) imp = impactResult(suite, { files: [], selected: 0 });
    else {
      imp = resolveImpact(decl, impactPaths, statuses, impact);
      // A full run (files null) or a non-empty subset selects the suite; an
      // empty subset drops it.
      if (imp.files === null || imp.files.length > 0) selected.add(suite);
    }
  }
  const subset = imp !== null && imp.files !== null && imp.files.length > 0;
  const suites = all ? decl.suites.slice().sort() : [...selected].sort();
  const everySuite = suites.length > 0 && suites.length === decl.suites.length;
  let mode;
  if (everySuite && isStatic && !subset) mode = 'full';
  else if (suites.length === 0 && isStatic) mode = 'static-only';
  else if (suites.length === 0) mode = 'none';
  else mode = 'scoped';
  const result = { mode, suites: mode === 'full' ? '*' : suites, static: isStatic, base, unmatched, matched };
  if (imp) result.impact = imp;
  return result;
}

module.exports = { selectScope };
