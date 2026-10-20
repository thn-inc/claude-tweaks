'use strict';

// source-scan.js — the leaf home for source-scanning helpers shared across
// code-health's focus verticals (`candidates-*.js`): tracked-file discovery,
// `module.exports` symbol extraction, and the test-file naming predicate.
//
// This module must never require `./focus-generators` or any `candidates-*.js`
// file (#3478). The registry autoloads every vertical, so a helper that lived
// in one vertical and was imported by its siblings made the require graph a
// cycle that only survived through load order. A leaf has no such edge to
// reorder around: every vertical may require this file first, last, or alone.
// `tests/bin-lib/code-health/candidates-require-order.test.js` pins that in a
// fresh process.

const { execFileSync } = require('child_process');
const path = require('path');

const SOURCE_EXTS = new Set(['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs']);

// True if `relFile`'s basename matches this repo's own test-discovery
// naming convention — `*.test.js`/`*.test.ts`/etc., the pattern
// `package.json`'s `test` script discovers via its single recursive
// `find tests tools/upstream-drift/tests -name '*.test.js'` (not an
// enumerated glob list) and the one `node --test <dir>` itself
// recognizes when given a directory to walk. A file matching this is
// discovered by the test runner's own glob, never by a `require`/`import`
// specifier naming it — so it is never a genuine file-orphan candidate (see
// candidates-dead-code.js's module header Coverage block). Name-based rather
// than a literal read of `package.json`'s globs: a generic heuristic that
// holds for any consumer repo following the widespread `*.test.js`/
// `*.spec.js` convention, not just this one.
const TEST_GLOB_BASENAME_RE = /\.(test|spec)\.(js|ts|tsx|jsx|mjs|cjs)$/;
function isGlobDiscoveredTestFile(relFile) {
  return TEST_GLOB_BASENAME_RE.test(relFile);
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Extracts every bare identifier out of every `module.exports = { ... }`
// brace block in `text` — this repo's dominant export shape, single- or
// multi-line alike (a single-line block is just the one-line case of the
// same brace scan). Character-by-character brace-depth tracking, not a
// line-by-line split, so a nested object value can't prematurely end the
// block. Tokens that aren't bare identifiers (spread `...x`, aliased
// `a: b`, computed `[x]: y`) are silently skipped — conservative by
// design (AC2): prefer missing a dead export over flagging a live one.
function extractModuleExports(text) {
  const results = [];
  const startRe = /module\.exports\s*=\s*\{/g;
  let m;
  while ((m = startRe.exec(text))) {
    const openIdx = m.index + m[0].length - 1; // index of the '{'
    let depth = 0;
    let closeIdx = -1;
    for (let i = openIdx; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }
    if (closeIdx === -1) {
      // Unterminated block (malformed or truncated file) — skip gracefully,
      // never throw. startRe.lastIndex is already past openIdx, so the
      // outer while loop simply finds no further "module.exports = {" and
      // exits.
      continue;
    }
    const inner = text.slice(openIdx + 1, closeIdx);
    const startLine = text.slice(0, openIdx).split('\n').length;
    const endLine = text.slice(0, closeIdx).split('\n').length;
    for (const rawToken of inner.split(',')) {
      const token = rawToken.trim();
      if (token === '' || !IDENTIFIER_RE.test(token)) continue;
      results.push({ symbol: token, startLine, endLine });
    }
    startRe.lastIndex = closeIdx;
  }
  return results;
}

// Files git would track or allow to be tracked, respecting .gitignore —
// `--cached` (tracked/staged) + `--others --exclude-standard` (untracked
// but not ignored) together, so a fixture tree needs only `git init` and a
// `.gitignore` on disk; nothing needs to be `git add`ed or committed for
// exclusion to take effect. No extension filter — every tracked/untracked-
// unignored path, sorted for deterministic ordering. `listTrackedSourceFiles`
// below layers the JS/TS extension filter on top for the source-only
// verticals; `candidates-prelaunch.js` (#2693) calls this extension-agnostic form
// directly, since a pre-launch checklist needs non-source files too
// (`robots.txt`, `sitemap.xml`, image assets).
//
// Returns `{ files, discoveryFailed, reason? }`, never a bare array —
// `discoveryFailed` distinguishes "git itself failed" (timeout, permission
// denied, repo corruption, non-git root, output past maxBuffer) from a
// legitimately empty tracked tree, both of which would otherwise collapse
// into the identical `files: []` sentinel a caller can't tell apart
// (IL-115: a focus-mode firing must be able to report which one happened,
// not silently degrade a real failure into "zero candidates, clean repo").
// `reason` is the captured stderr (or, failing that, the error message) and
// is present only when `discoveryFailed` is true. `maxBuffer` is set
// explicitly (Node's execFileSync default is ~1MB) since a large consumer
// repo's `git ls-files` output can exceed that on the default.
function listTrackedFiles(rootDir) {
  let raw;
  try {
    raw = execFileSync(
      'git',
      ['-C', rootDir, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    );
  } catch (err) {
    const stderr = err && err.stderr ? String(err.stderr).trim() : '';
    const reason = stderr || (err && err.message) || 'unknown error';
    return { files: [], discoveryFailed: true, reason };
  }
  const files = raw
    .split('\0')
    .filter(Boolean)
    .sort();
  return { files, discoveryFailed: false };
}

// JS/TS-only view of listTrackedFiles, for the source-only verticals' scans.
function listTrackedSourceFiles(rootDir) {
  const discovery = listTrackedFiles(rootDir);
  if (discovery.discoveryFailed) return discovery;
  return { files: discovery.files.filter((f) => SOURCE_EXTS.has(path.extname(f))), discoveryFailed: false };
}

module.exports = {
  isGlobDiscoveredTestFile,
  extractModuleExports,
  listTrackedFiles,
  listTrackedSourceFiles,
};
