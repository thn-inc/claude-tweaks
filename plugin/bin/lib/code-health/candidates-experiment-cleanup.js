'use strict';

// candidates-experiment-cleanup.js — deterministic feature-flag/experiment
// scaffolding candidate generator for code-health's `focus=experiment-cleanup`
// scoping mode (see skills/code-health/focus-mode.md). Finds flag call sites
// and registry entries matching a repo-configured idiom (the
// `experiment-flag-patterns` policy key) and classifies decision signals —
// never removes anything, never files anything itself. Candidates are INPUT
// to the judge (skills/code-health/SKILL.md Step 5), the same contract as
// every other focus-mode vertical (see candidates-dead-code.js).
//
// Coverage (stated explicitly, never implied total — IL-110):
//   - Pattern-driven only: this generator has no opinion about what a flag
//     idiom looks like beyond the configured `experiment-flag-patterns`
//     regex list. A repo with an unconfigured or partially-matching idiom
//     yields zero or partial sites — that is the generator working as
//     designed, not a bug. `sitesMatched` and `candidates.length` are
//     reported separately for exactly this reason: "patterns configured but
//     missing the repo's real idiom" shows as sitesMatched: 0, distinct
//     from "sites found, none decided" (sitesMatched > 0, candidates: []).
//   - Two-key config, both read from this project's .claude-tweaks/policy.yml
//     — never passed as a live parameter by focus-mode.md's generic F1
//     wiring, which calls every registered generator as `gen(root)` only:
//     `experiment-flag-patterns` (regex-source strings, first capture group
//     = the flag identifier) and `experiment-flag-exclude` (kill-switch name
//     substrings, extending the shipped defaults
//     ["emergency","circuit","kill"] rather than replacing them).
//   - JS/TS files only — reuses source-scan.js's
//     listTrackedSourceFiles (same git-ls-files-based discovery, same
//     extension set, same .gitignore handling, same discoveryFailed/
//     discoveryReason IL-115 distinction).
//   - Line-bounded scanning: each line is matched independently, capped at
//     opts.maxLineLength (default 1000 chars) — an over-cap line is skipped
//     (counted in `overLengthLinesSkipped`), never regex-matched at full
//     length. Linear input bounding, not a regex-engine timeout — Node has
//     none.
//   - Guard-block detection (dead-branch / identical-branches signals) is a
//     brace-depth scan starting at the first `{` after a call-site match —
//     it assumes the classic `if (<call-site-match>) { ... } else { ... }`
//     shape and does not resolve `else if` chains, ternaries, or a guard
//     whose condition spans many lines before its own `{`. A flag idiom
//     using any of those shapes will not trigger the block-based signals
//     (accepted false-negative — the registry-terminal-state and
//     dated-cleanup-comment signals are shape-independent and still apply).
//   - Registry / dated-comment signals are text-window heuristics (a small
//     forward window of characters from a call site) — not a structural
//     parse of whatever registry format a repo actually uses.
//
// Why no git blame / kill-switch semantic check here. The identical-branches
// signal is a decided signal, but per this leaf's own Gotchas it is also
// exactly what an IL-87-style merge artifact produces, and a kill-switch not
// matching any configured exclude pattern reads as decided too — both are
// JUDGE-time calibration (skills/_shared/criteria-experiment-cleanup.md),
// never something this deterministic generator resolves. Findings from this
// generator always propose records for the supervised/granted pipeline,
// never direct removal.

const fs = require('fs');
const path = require('path');
const { registerGenerator } = require('./focus-generators');
const { listTrackedSourceFiles } = require('./source-scan');
const { readListKey } = require('../policy');

const DEFAULT_EXCLUDES = ['emergency', 'circuit', 'kill'];
const DEFAULT_MAX_LINE_LENGTH = 1000;

// Compiles each pattern-source string into a RegExp with a fresh 'g' flag.
// Throws loud, naming the offending pattern, on the first invalid regex
// (AC3 — never silently skipped; fail-open here would suspend the vertical
// invisibly, IL-92).
function compilePatterns(patterns) {
  return patterns.map((p) => {
    try {
      return { source: p, re: new RegExp(p, 'g') };
    } catch (err) {
      throw new Error(`Invalid experiment-flag-patterns entry: "${p}" — ${err.message}`);
    }
  });
}

// True if `flag` matches any configured (+ default) exclude name — case-
// insensitive substring, matching the "kill-switch name patterns" framing
// (these are name fragments, not regexes; experiment-flag-patterns is the
// only regex-typed key here).
function isExcluded(flag, excludes) {
  const lower = flag.toLowerCase();
  return excludes.some((ex) => lower.includes(String(ex).toLowerCase()));
}

// Strips // line comments and /* */ block comments, then collapses all
// whitespace runs to a single space and trims — used both to test a branch
// body for emptiness after stripping a comment-only branch, and to compare
// two branch bodies "token-identical, whitespace/comment-normalized, never
// byte-exact" (this leaf's own Data/API Surface note).
function normalizeBranch(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Depth-tracking brace match — returns the index of the `}` that closes the
// `{` at `openIdx`, or -1 if unterminated. Same technique as
// source-scan.js's extractModuleExports.
function matchBrace(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// From `text`, starting the search at `fromIndex`, finds the first `{` and
// brace-matches to its closing `}`, then — if the next non-whitespace token
// past that close is `else {` — does the same for the else block. Returns
// `{ ifBody, elseBody }` (raw text between the respective braces; elseBody
// is `null` when no else-block was found) or `null` if no `{` follows within
// `maxLookahead` chars (a call-site match that isn't actually an if-guard).
function findGuardBlock(text, fromIndex, maxLookahead = 400) {
  const braceIdx = text.indexOf('{', fromIndex);
  if (braceIdx === -1 || braceIdx - fromIndex > maxLookahead) return null;
  const ifEnd = matchBrace(text, braceIdx);
  if (ifEnd === -1) return null;
  const ifBody = text.slice(braceIdx + 1, ifEnd);

  const afterIf = text.slice(ifEnd + 1, ifEnd + 41);
  const elseMatch = /^\s*else\s*\{/.exec(afterIf);
  if (!elseMatch) return { ifBody, elseBody: null };

  const elseBraceIdx = ifEnd + 1 + afterIf.indexOf('{');
  const elseEnd = matchBrace(text, elseBraceIdx);
  if (elseEnd === -1) return { ifBody, elseBody: null };
  const elseBody = text.slice(elseBraceIdx + 1, elseEnd);
  return { ifBody, elseBody };
}

const TERMINAL_MARKERS = ['always-on', 'always on', 'always-off', 'always off', 'expired', 'shipped', 'sunset', 'removed'];
const DATED_COMMENT_RE = /\/\/\s*(cleanup|remove|delete|todo)\b[^\n]*\b(20\d{2}-\d{2}(?:-\d{2})?)\b/i;

// Scans one file's text for every configured pattern's matches, returning
// per-match sites `{ flag, line, index }` (1-based line, 0-based char index
// into `text` — the index is what the guard-block/window scans re-slice
// from) plus a count of lines skipped for exceeding `maxLineLength`.
function scanFileForSites(text, compiled, maxLineLength) {
  const sites = [];
  const lines = text.split('\n');
  const lineStarts = [];
  let cursor = 0;
  for (const line of lines) {
    lineStarts.push(cursor);
    cursor += line.length + 1;
  }
  let overLengthLines = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > maxLineLength) {
      overLengthLines++;
      continue;
    }
    for (const { re } of compiled) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(lines[i]))) {
        const flag = m[1] !== undefined ? m[1] : m[0];
        sites.push({ flag, line: i + 1, index: lineStarts[i] + m.index });
        if (m.index === re.lastIndex) re.lastIndex += 1; // guard against zero-width match loops
      }
    }
  }
  return { sites, overLengthLines };
}

// The rich-shape scan — registered under 'experiment-cleanup' in
// FOCUS_GENERATORS. Reads both policy keys from `${rootDir}/.claude-tweaks/
// policy.yml` itself (via opts.patterns/opts.excludes override for direct
// callers/tests), since focus-mode.md's F1 invokes every registered
// generator as `gen(root)` with no config parameter.
function scanExperimentCleanup(rootDir, opts = {}) {
  const patterns = opts.patterns !== undefined ? opts.patterns : readListKey(rootDir, 'experiment-flag-patterns');
  const userExcludes = opts.excludes !== undefined ? opts.excludes : readListKey(rootDir, 'experiment-flag-exclude');
  const excludes = DEFAULT_EXCLUDES.concat(userExcludes);
  const maxLineLength = opts.maxLineLength || DEFAULT_MAX_LINE_LENGTH;

  if (!patterns || patterns.length === 0) {
    return {
      candidates: [],
      scannedFiles: 0,
      skippedFiles: [],
      discoveryFailed: false,
      sitesMatched: 0,
      flagsMatched: 0,
      overLengthLinesSkipped: 0,
      noIdiomConfigured: true,
    };
  }

  const compiled = compilePatterns(patterns); // throws loud on malformed (AC3)

  const discovery = listTrackedSourceFiles(rootDir);
  if (discovery.discoveryFailed) {
    return {
      candidates: [],
      scannedFiles: 0,
      skippedFiles: [],
      discoveryFailed: true,
      discoveryReason: discovery.reason,
      sitesMatched: 0,
      flagsMatched: 0,
      overLengthLinesSkipped: 0,
      noIdiomConfigured: false,
    };
  }

  const skippedFiles = [];
  const byFlag = new Map(); // flag -> { sites: [{file, line}], signalSet: Set, evidence: [] }
  let overLengthLinesTotal = 0;
  let sitesMatched = 0;

  for (const rel of discovery.files) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(rootDir, rel));
    } catch {
      skippedFiles.push({ file: rel, reason: 'unreadable' });
      continue;
    }
    if (buf.includes(0)) {
      skippedFiles.push({ file: rel, reason: 'binary-or-nul' });
      continue;
    }
    const text = buf.toString('utf8');
    const { sites, overLengthLines } = scanFileForSites(text, compiled, maxLineLength);
    overLengthLinesTotal += overLengthLines;
    if (sites.length === 0) continue;
    sitesMatched += sites.length;

    for (const site of sites) {
      if (!byFlag.has(site.flag)) byFlag.set(site.flag, { sites: [], signalSet: new Set(), evidence: [] });
      const entry = byFlag.get(site.flag);
      entry.sites.push({ file: rel, line: site.line });

      // Signal: registry-terminal-state — a terminal marker within a small
      // forward window from the site (covers a `{ status: 'always-on' }`
      // registry entry sitting a few characters past the flag identifier's
      // own match).
      const windowEnd = Math.min(text.length, site.index + 200);
      const window = text.slice(site.index, windowEnd);
      const marker = TERMINAL_MARKERS.find((mk) => window.toLowerCase().includes(mk));
      if (marker) {
        entry.signalSet.add('registry-terminal-state');
        entry.evidence.push(`"${site.flag}" co-occurs with terminal-state marker "${marker}" at ${rel}:${site.line}`);
      }

      // Signals: dead-branch / identical-branches — brace-scan the guard
      // block starting from this site's match position.
      const block = findGuardBlock(text, site.index);
      if (block && block.elseBody !== null) {
        const ifNorm = normalizeBranch(block.ifBody);
        const elseNorm = normalizeBranch(block.elseBody);
        if (elseNorm === '' && ifNorm !== '') {
          entry.signalSet.add('dead-branch');
          entry.evidence.push(`else branch is empty (comment-only or blank) at ${rel}:${site.line}`);
        } else if (ifNorm !== '' && ifNorm === elseNorm) {
          entry.signalSet.add('identical-branches');
          entry.evidence.push(`if/else branches are token-identical (whitespace/comment-normalized) at ${rel}:${site.line} — verify against git blame before filing, an IL-87-style merge artifact produces the same signal`);
        }
      }

      // Signal: dated-cleanup-comment — a dated cleanup/remove/delete/TODO
      // comment within the same forward window used for the registry signal.
      const dated = DATED_COMMENT_RE.exec(window);
      if (dated) {
        entry.signalSet.add('dated-cleanup-comment');
        entry.evidence.push(`dated cleanup comment "${dated[0].trim()}" near ${rel}:${site.line}`);
      }
    }
  }

  const candidates = [];
  const flagNames = [...byFlag.keys()].sort();
  for (const flag of flagNames) {
    const entry = byFlag.get(flag);
    if (entry.signalSet.size === 0) continue; // no decision signal — live flag, not a candidate
    if (isExcluded(flag, excludes)) continue; // kill-switch exclusion (AC5) — suppressed, never a candidate
    candidates.push({
      flag,
      sites: entry.sites,
      signals: [...entry.signalSet],
      evidence: entry.evidence,
    });
  }

  return {
    candidates,
    scannedFiles: discovery.files.length,
    skippedFiles,
    discoveryFailed: false,
    sitesMatched,
    flagsMatched: byFlag.size,
    overLengthLinesSkipped: overLengthLinesTotal,
    noIdiomConfigured: false,
  };
}

// Spec-pinned Data/API Surface signature:
// candidatesExperimentCleanup(rootDir, patterns, excludes, opts) → [{flag, sites, signals, evidence}]
// — a bare array, mirroring candidates-dead-code.js's candidatesDeadCode
// wrapper. Unlike the registered generator (which reads both keys from
// policy.yml itself, since focus-mode.md's F1 calls `gen(root)` with no
// config parameter), this pinned entry point takes patterns/excludes
// explicitly — the shape a direct unit test, or a future non-focus-mode
// caller, needs.
function candidatesExperimentCleanup(rootDir, patterns, excludes, opts = {}) {
  return scanExperimentCleanup(rootDir, { ...opts, patterns: patterns || [], excludes: excludes || [] }).candidates;
}

// Registers this vertical's generator into the shared framework registry —
// see focus-generators.js for why that registry lives in its own neutral
// module rather than inside any one vertical's file.
registerGenerator('experiment-cleanup', scanExperimentCleanup);

module.exports = {
  compilePatterns,
  isExcluded,
  normalizeBranch,
  matchBrace,
  findGuardBlock,
  scanFileForSites,
  scanExperimentCleanup,
  candidatesExperimentCleanup,
  DEFAULT_EXCLUDES,
};
