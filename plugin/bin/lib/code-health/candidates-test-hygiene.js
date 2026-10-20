'use strict';

// candidates-test-hygiene.js — deterministic candidate generator for code-
// health's `focus=test-hygiene` scoping mode (see skills/code-health/focus-
// mode.md). One generator, two candidate kinds, covering both reel-shaped
// test jobs: `coverage-gap` (source files/exports with no corresponding test
// coverage — creation work) and `useless-test` (assertion-free or
// tautological test files — deletion work). The existing `test-quality`
// criterion judges the useless-test half; the new `missing-tests` fragment
// (skills/_shared/criteria-missing-tests.md) judges the gap half. Candidates
// are INPUT to the judge, never filed directly.
//
// Coverage (stated explicitly, never implied total — IL-110):
//   - JS/TS files only (SOURCE_EXTS, shared via source-scan.js).
//   - Coverage-gap detection is STRUCTURAL (file/export correspondence), not
//     line-coverage-based — no nyc/c8 instrumentation, no dependency added.
//   - Pairing heuristics are a FIXED priority order in v1 (never
//     "configurable" beyond `opts.exclude`): (1) explicit import/require of
//     the source module from a test file, (2) filename-convention pairing
//     (`foo.test.js` <-> `foo.js`), (3) directory-convention pairing
//     (`dir/tests/*` <-> `dir/*`). Heuristics 1-2 (import, filename) cover
//     this repo's own layout — a top-level `tests/bin-lib/{name}/` mirror,
//     not a nested per-module `tests/` sibling; heuristic 3 remains for the
//     widespread sibling-directory convention other repos use. A
//     repo whose test layout matches none of the three under-reports
//     coverage — an accepted false-negative in the
//     "prefer missing a gap over flagging a covered module" direction the
//     spec states.
//   - File-level pairing gates symbol-level gap detection: a file-level gap
//     is reported for an entirely-unpaired file; a symbol-level gap is
//     reported ONLY for a file that IS paired but has an exported symbol no
//     test file references by name — the two never double-report the same
//     root cause.
//   - Barrel re-export chains are NOT followed (v1): a symbol referenced
//     only through a barrel may over-nominate as a gap — accepted, since
//     the generator nominates and the criterion (fragment) filters.
//   - Assertion detection is a fixed, exported vocabulary
//     (ASSERTION_PATTERNS) — extend by editing that one constant, never by
//     scattering ad-hoc regexes. A token/pattern match ANYWHERE in file
//     scope counts, regardless of call position (the IL-30 exception): a
//     lazily-called assertion inside a test-double's `returns` function
//     still counts as "this file has assertions", so it is never flagged
//     assertion-free merely for having no TOP-LEVEL assert call.
//   - "Useless test" detection granularity is PER-FILE in v1 — block-level
//     is AST territory, out of scope. Two independent signals, either one
//     nominates a `useless-test` candidate: (a) zero assertion-vocabulary
//     matches anywhere in the file ("assertion-free"), (b) a tautological
//     assertion comparing one expression to itself
//     (`assert.equal(x, x)`-shape, TAUTOLOGY_PATTERN).
//   - Excluded from candidacy (both kinds): SKIP_DIRS (the same shared
//     exclusion source `bin/lib/code-health/scope.js`'s `next-slice`
//     scoping uses), plus any path under a `vendor`/`third_party` directory
//     segment. Files under a `fixtures`/`__fixtures__` segment are excluded
//     from COVERAGE-GAP candidacy (a fixture tree is not source code needing
//     its own tests) but a genuinely test-shaped fixture file is not
//     specially exempted from useless-test detection — a fixture directory
//     name does not imply the file inside it is exempt from being a real,
//     judged test.

const fs = require('fs');
const path = require('path');
const { registerGenerator } = require('./focus-generators');
const { listTrackedSourceFiles, isGlobDiscoveredTestFile, extractModuleExports } = require('./source-scan');
const { escapeRegExp } = require('../shared-primitives');
const { SKIP_DIRS } = require('./scope');

// ─── Assertion vocabulary (module constant — the contract; extend here only) ─

// Word-bounded regex fragments. A match anywhere in a file's raw text counts
// (IL-30 exception — see module header). Covers: assert-prefixed calls
// (`assert(...)`, `assert.ok`, `assert.equal`, `node:assert/strict`, ...),
// `expect(` (jest/vitest/chai), `t.assert` (tap-style), and the jest/vitest
// matcher-chain shape `expect(...).to*` / `.rejects` (captured separately
// since the chain's trailing matcher can be far from the literal `expect(`
// token on a multi-line chain).
const ASSERTION_PATTERNS = [
  /\bassert\b/,
  /\bexpect\s*\(/,
  /\bt\.assert\b/,
  /\)\s*\.\s*to[A-Za-z]*\b/,
  /\.\s*rejects\b/,
];

function hasAssertionToken(text) {
  return ASSERTION_PATTERNS.some((re) => re.test(text));
}

// Tautological assertion: an equality-style assert call whose two arguments
// are the textually IDENTICAL expression — `assert.equal(1, 1)`,
// `assert.strictEqual(x, x)`. Backreference-based, so it only catches a
// literal repeat of the same token/expression, never two different
// expressions that merely evaluate equal — conservative by design, same
// direction as the rest of this generator.
const TAUTOLOGY_PATTERN = /\bassert\.(?:equal|strictEqual|deepEqual|deepStrictEqual)\s*\(\s*([^,()]+?)\s*,\s*\1\s*\)/;

function isTautological(text) {
  return TAUTOLOGY_PATTERN.test(text);
}

const VENDORED_DIR_RE = /(^|\/)(vendor|third_party)(\/|$)/;
const FIXTURE_DIR_RE = /(^|\/)(fixtures|__fixtures__)(\/|$)/;

function isExcludedPath(relFile) {
  const parts = relFile.split('/');
  for (const p of parts) {
    if (SKIP_DIRS.has(p)) return true;
  }
  return VENDORED_DIR_RE.test(relFile);
}

// ─── Pairing heuristics (fixed priority order) ─────────────────────────────

function basenameNoExt(p) {
  return path.basename(p).replace(/\.(js|ts|tsx|jsx|mjs|cjs)$/, '');
}

// Strips a test-discovery suffix (`.test`/`.spec`) so `foo.test.js`'s stem
// compares equal to `foo.js`'s stem.
function stemWithoutTestSuffix(base) {
  return base.replace(/\.(test|spec)$/, '');
}

// Heuristic 1 — explicit import/require: does any test file's text contain a
// require/import specifier whose last path segment (stem, extension- and
// test-suffix-insensitive) names `sourceRel`?
function pairedByImport(sourceRel, testFiles, contentsByFile) {
  const sourceStem = basenameNoExt(sourceRel);
  const specRe = /(?:require\s*\(|import\s*\(|from\s+|import\s+)\s*['"`]([^'"`]+)['"`]/g;
  for (const tf of testFiles) {
    const text = contentsByFile.get(tf);
    if (!text) continue;
    let m;
    specRe.lastIndex = 0;
    while ((m = specRe.exec(text))) {
      const specStem = basenameNoExt(m[1]);
      if (specStem === sourceStem) return tf;
    }
  }
  return null;
}

// Heuristic 2 — filename convention: `foo.test.js`/`foo.spec.js` (anywhere
// in the tree) whose stem, with the test suffix stripped, equals the
// source's own stem.
function pairedByFilename(sourceRel, testFiles) {
  const sourceStem = basenameNoExt(sourceRel);
  for (const tf of testFiles) {
    const tfStem = stemWithoutTestSuffix(basenameNoExt(tf));
    if (tfStem === sourceStem) return tf;
  }
  return null;
}

// Heuristic 3 — directory convention: a `tests/` (or `test/`) subdirectory
// alongside or above the source file contains ANY test file — the
// `dir/tests/*.test.js` <-> `dir/*.js` sibling shape some repos use (this
// repo's own layout no longer has it: `tests/bin-lib/{name}/` mirrors
// `plugin/bin/lib/{name}/` at the top level instead, already caught by
// Heuristics 1-2). Deliberately coarse (any test file in the sibling
// tests/ dir pairs the whole directory's source files) since the finer
// filename/import heuristics above already catch the precise pairing when
// it exists.
function pairedByDirectory(sourceRel, testFiles) {
  const sourceDir = path.dirname(sourceRel);
  const siblingTestsDir = path.join(sourceDir, 'tests').split(path.sep).join('/');
  const siblingTestDir = path.join(sourceDir, 'test').split(path.sep).join('/');
  for (const tf of testFiles) {
    const tfDir = path.dirname(tf);
    if (tfDir === siblingTestsDir || tfDir === siblingTestDir) return tf;
  }
  return null;
}

// Returns the pairing test file for `sourceRel`, or null if unpaired —
// fixed priority order 1 -> 2 -> 3, first match wins.
function findPairing(sourceRel, testFiles, contentsByFile) {
  return (
    pairedByImport(sourceRel, testFiles, contentsByFile) ||
    pairedByFilename(sourceRel, testFiles) ||
    pairedByDirectory(sourceRel, testFiles)
  );
}

// ─── Main scan ───────────────────────────────────────────────────────────

// The full scan. Returns the rich shape
// `{ candidates, scannedFiles, skippedFiles, discoveryFailed, discoveryReason? }`
// — `candidatesTestHygiene` below is the spec-pinned narrow wrapper
// returning just `.candidates`.
function scanTestHygiene(rootDir, opts = {}) {
  const discovery = listTrackedSourceFiles(rootDir);
  const allFiles = discovery.files;
  const files = allFiles.filter((f) => !isExcludedPath(f));
  const skippedFiles = allFiles.filter((f) => isExcludedPath(f)).map((f) => ({ file: f, reason: 'excluded-path' }));

  const testFiles = [];
  const sourceFiles = [];
  for (const f of files) {
    if (isGlobDiscoveredTestFile(f)) testFiles.push(f);
    else sourceFiles.push(f);
  }

  const contentsByFile = new Map();
  for (const f of files) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(rootDir, f));
    } catch {
      skippedFiles.push({ file: f, reason: 'unreadable' });
      continue;
    }
    if (buf.includes(0)) {
      skippedFiles.push({ file: f, reason: 'binary-or-nul' });
      continue;
    }
    contentsByFile.set(f, buf.toString('utf8'));
  }

  const candidates = [];

  // ── coverage-gap ──
  for (const rel of sourceFiles) {
    if (!contentsByFile.has(rel)) continue; // skipped above (unreadable/binary)
    if (FIXTURE_DIR_RE.test(rel)) continue; // fixture trees are not source needing tests

    const pairing = findPairing(rel, testFiles, contentsByFile);
    if (!pairing) {
      candidates.push({
        file: rel,
        kind: 'coverage-gap',
        evidence: `no test file imports, name-pairs (filename convention), or directory-pairs with ${rel} (checked ${testFiles.length} test files)`,
      });
      continue;
    }

    // File IS paired — check per-exported-symbol gap (AC1b). Barrel
    // re-export chains are not followed: a symbol referenced only via a
    // barrel may over-nominate here, stated in this module's header.
    const exported = extractModuleExports(contentsByFile.get(rel));
    for (const { symbol } of exported) {
      const bounded = new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(symbol)}(?![A-Za-z0-9_$])`);
      const referenced = testFiles.some((tf) => contentsByFile.has(tf) && bounded.test(contentsByFile.get(tf)));
      if (!referenced) {
        candidates.push({
          file: rel,
          symbol,
          kind: 'coverage-gap',
          evidence: `${rel} is paired with ${pairing} but exported symbol "${symbol}" is never referenced by name in any test file`,
        });
      }
    }
  }

  // ── useless-test ──
  for (const rel of testFiles) {
    if (!contentsByFile.has(rel)) continue;
    const text = contentsByFile.get(rel);
    const tautological = isTautological(text);
    const assertionFree = !hasAssertionToken(text);
    if (tautological) {
      candidates.push({
        file: rel,
        kind: 'useless-test',
        evidence: `${rel} contains a tautological assertion (comparing an expression to itself)`,
      });
    }
    if (assertionFree) {
      candidates.push({
        file: rel,
        kind: 'useless-test',
        evidence: `${rel} contains no recognized assertion call anywhere in file scope (checked: ${ASSERTION_PATTERNS.length} vocabulary patterns)`,
      });
    }
  }

  candidates.sort((a, b) => (a.file === b.file ? String(a.symbol || '').localeCompare(String(b.symbol || '')) : a.file.localeCompare(b.file)));

  const result = { candidates, scannedFiles: files.length, skippedFiles, discoveryFailed: discovery.discoveryFailed };
  if (discovery.discoveryFailed) result.discoveryReason = discovery.reason;
  return result;
}

// Spec-pinned Data/API Surface signature:
// `candidatesTestHygiene(rootDir, opts) → [{file, symbol?, kind, evidence}]`.
function candidatesTestHygiene(rootDir, opts) {
  return scanTestHygiene(rootDir, opts).candidates;
}

registerGenerator('test-hygiene', scanTestHygiene);

module.exports = {
  ASSERTION_PATTERNS,
  hasAssertionToken,
  TAUTOLOGY_PATTERN,
  isTautological,
  isExcludedPath,
  basenameNoExt,
  stemWithoutTestSuffix,
  pairedByImport,
  pairedByFilename,
  pairedByDirectory,
  findPairing,
  scanTestHygiene,
  candidatesTestHygiene,
};
