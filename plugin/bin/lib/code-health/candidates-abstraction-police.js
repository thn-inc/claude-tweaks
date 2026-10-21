'use strict';

// candidates-abstraction-police.js — deterministic cross-file duplicate-
// abstraction candidate generator for code-health's `focus=abstraction-
// police` scoping mode (see skills/code-health/focus-mode.md). Clusters
// exported functions/helpers across files that look like the same
// abstraction rebuilt more than once, judged by the existing
// `architecture-depth` criterion (skills/_shared/criteria-architecture-
// depth.md's cross-file calibration addition). Candidates are INPUT to the
// judge, never filed directly — the judge and the verify gate remain the
// filter of record.
//
// Coverage (stated explicitly, never implied total — IL-110):
//   - JS/TS files only (SOURCE_EXTS, shared via source-scan.js).
//   - Exported symbols only — `module.exports = { a, b, c }` shorthand-brace
//     shape, reusing source-scan.js's extractModuleExports. Every
//     coverage caveat that function's own header documents (single ESM
//     `export`, `module.exports.NAME = ...`, aliased/computed keys all
//     unrecognized) applies here too.
//   - Only a symbol whose declaration this module can locate and whose body
//     it can bound-read gets compared. A symbol re-exported from elsewhere,
//     an arrow function with an expression body (no `{ ... }` block), or a
//     declaration this module's regexes don't recognize contributes no
//     candidate — an accepted false-negative, same conservative direction
//     as candidates-dead-code.js.
//   - Similarity is lexical/structural, never semantic/AST-equivalent: a
//     pair "matches" when their parameter SIGNATURE SHAPE is equal (arity +
//     the set of destructured top-level parameter keys) AND their body's
//     token-bag Jaccard overlap clears BODY_OVERLAP_THRESHOLD. Normalized
//     name similarity is recorded in the evidence as a secondary signal —
//     it is never sufficient or necessary on its own to cluster a pair.
//   - A candidate function body that cannot be bounded-read within
//     MAX_BODY_CHARS (brace-matching runs past the window before finding
//     the close) is skipped with a logged note in `skippedSymbols`, never
//     silently half-compared against a truncated body.
//   - Clustering is transitive-closure via union-find over every pairwise
//     match — deliberately, since "A duplicates B" and "B duplicates C"
//     should read as one 3-way cluster. A pair that fails the AND condition
//     (signature mismatch, or body overlap under threshold) never unions,
//     even if one member separately unions with a third symbol — so a
//     coincidental near-threshold pair cannot get chained into a real
//     cluster through an unrelated third member (see the test suite's
//     transitive-closure fixture).
//   - Judged clusters are capped at CLUSTER_CAP per firing — when the cap
//     truncates, the caller (focus-mode.md's F1/F2) reports how many were
//     dropped via `droppedClusters`; this module never silently caps.
//   - Excluded from candidacy: SKIP_DIRS (the same shared exclusion source
//     `bin/lib/code-health/scope.js`'s `next-slice` scoping uses — never a
//     copied list), any path under a `fixtures`/`__fixtures__`/`vendor`/
//     `third_party` directory segment, and any file matching this repo's
//     own test-discovery naming convention (`isGlobDiscoveredTestFile`,
//     reused from source-scan.js) — test doubles and fixture trees
//     legitimately share shapes without being a real duplicated abstraction.

const fs = require('fs');
const path = require('path');
const { registerGenerator } = require('./focus-generators');
const { listTrackedSourceFiles, isGlobDiscoveredTestFile, extractModuleExports } = require('./source-scan');
const { escapeRegExp } = require('../shared-primitives');
const { SKIP_DIRS } = require('./scope');

// Module constants — header rationale per each, calibrated at build against
// the boundary fixtures; the spec-stated value is the anchor AC2 tests
// against (skills/_shared/… issue #273's Deliverables bullet).
const BODY_OVERLAP_THRESHOLD = 0.6; // Jaccard, token-bag over function bodies
const MAX_BODY_CHARS = 4000; // bounded-read window per candidate function body
const CLUSTER_CAP = 10; // judged clusters per firing — the judge pays to read members

const VENDORED_DIR_RE = /(^|\/)(fixtures|__fixtures__|vendor|third_party)(\/|$)/;

function isExcludedPath(relFile) {
  const parts = relFile.split('/');
  for (const p of parts) {
    if (SKIP_DIRS.has(p)) return true;
  }
  if (VENDORED_DIR_RE.test(relFile)) return true;
  if (isGlobDiscoveredTestFile(relFile)) return true;
  return false;
}

// ─── Signature shape ────────────────────────────────────────────────────────

// Splits a parameter-list string on top-level commas only — commas nested
// inside `{}`/`[]`/`()` (a destructured default, a nested object pattern)
// must not split the parameter they belong to.
function splitTopLevel(str) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of str) {
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts;
}

const KEY_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/;

// Given one top-level parameter's raw text, returns the set of destructured
// key names it introduces at its own top level (empty for a plain
// positional or array-destructured parameter — array patterns are treated
// as opaque single positionals, not counted into destructuredKeys, since a
// bare `[a, b]` carries no stable key names to compare across files).
function destructuredKeysOf(paramText) {
  const trimmed = paramText.trim();
  if (!trimmed.startsWith('{')) return [];
  const close = trimmed.lastIndexOf('}');
  if (close === -1) return [];
  const inner = trimmed.slice(1, close);
  const keys = [];
  for (const rawEntry of splitTopLevel(inner)) {
    const entry = rawEntry.trim();
    if (entry === '' || entry.startsWith('...')) continue;
    const m = KEY_RE.exec(entry);
    if (m) keys.push(m[0]);
  }
  return keys;
}

// Returns { arity, destructuredKeys } — the SIGNATURE SHAPE compared between
// candidates. `arity` counts top-level parameters (rest/default params
// included as one each); `destructuredKeys` is the sorted, deduped union of
// every destructured object parameter's own top-level keys.
function signatureShape(paramsStr) {
  const rawParams = splitTopLevel(paramsStr).map((p) => p.trim()).filter((p) => p !== '');
  const keys = new Set();
  for (const p of rawParams) {
    for (const k of destructuredKeysOf(p)) keys.add(k);
  }
  return { arity: rawParams.length, destructuredKeys: [...keys].sort() };
}

function signaturesMatch(a, b) {
  if (a.arity !== b.arity) return false;
  if (a.destructuredKeys.length !== b.destructuredKeys.length) return false;
  for (let i = 0; i < a.destructuredKeys.length; i++) {
    if (a.destructuredKeys[i] !== b.destructuredKeys[i]) return false;
  }
  return true;
}

// ─── Declaration + body location ────────────────────────────────────────────

// Locates `symbol`'s own function declaration in `text` and returns
// { paramsStr, bodyStart } (index of the body's opening '{'), or null when
// no recognized declaration shape is found. Recognized shapes: a `function
// NAME(...)` declaration, and `const NAME = (...) => {`/`const NAME =
// function(...) {` assignments with a block body. An arrow with an
// expression body (no `{`) is not recognized — nothing to bound-read as a
// "body" in the same sense, so it contributes no candidate (accepted false
// negative, conservative direction).
function locateDeclaration(text, symbol) {
  const bounded = escapeRegExp(symbol);
  const fnDeclRe = new RegExp(`function\\s+${bounded}\\s*\\(([^)]*)\\)\\s*\\{`);
  const arrowRe = new RegExp(`(?:const|let|var)\\s+${bounded}\\s*=\\s*\\(([^)]*)\\)\\s*=>\\s*\\{`);
  const fnExprRe = new RegExp(`(?:const|let|var)\\s+${bounded}\\s*=\\s*function\\s*\\(([^)]*)\\)\\s*\\{`);
  for (const re of [fnDeclRe, arrowRe, fnExprRe]) {
    const m = re.exec(text);
    if (m) {
      const bodyStart = m.index + m[0].length - 1; // index of the '{'
      return { paramsStr: m[1], bodyStart };
    }
  }
  return null;
}

// Brace-matches from `bodyStart` (index of the opening '{') within
// MAX_BODY_CHARS of scan. Returns the body text (braces included) on
// success, or null when the window is exhausted before the matching close
// is found — the AC2c "bounded-read window" case, reported by the caller as
// a skipped symbol, never a silently truncated comparison.
function boundedBody(text, bodyStart) {
  let depth = 0;
  const limit = Math.min(text.length, bodyStart + MAX_BODY_CHARS);
  for (let i = bodyStart; i < limit; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(bodyStart, i + 1);
    }
  }
  return null;
}

// Token-bag (Set) of body text: every bare identifier, lowercased, stripped
// of the function's own name and JS keyword noise is NOT special-cased here
// — deliberately: keeping keywords/punctuation-tokens in the bag is what
// makes structurally-similar control flow (the same if/for/try shape) count
// toward overlap, not just shared variable-naming taste.
const TOKEN_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
function tokenBag(bodyText) {
  const set = new Set();
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(bodyText))) set.add(m[0].toLowerCase());
  return set;
}

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Normalized-name similarity — a SECONDARY signal recorded in evidence,
// never sufficient or necessary alone to cluster a pair (per the combination
// rule). Normalizes by lowercasing and stripping non-alphanumerics, then
// reports exact-equality of the normalized forms as the only value used.
function normalizedName(symbol) {
  return symbol.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ─── Union-find ──────────────────────────────────────────────────────────

function makeUnionFind(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  return { find, union };
}

// ─── Main scan ───────────────────────────────────────────────────────────

// The full scan. Returns the rich shape
// `{ candidates, scannedFiles, skippedFiles, skippedSymbols, discoveryFailed, discoveryReason?, droppedClusters }` —
// `candidatesAbstractionPolice` below is the spec-pinned narrow wrapper
// returning just `.candidates`.
function scanAbstractionPolice(rootDir, opts = {}) {
  const discovery = listTrackedSourceFiles(rootDir);
  const allFiles = discovery.files;
  const files = allFiles.filter((f) => !isExcludedPath(f));
  const skippedFiles = allFiles.filter((f) => isExcludedPath(f)).map((f) => ({ file: f, reason: 'excluded-path' }));

  // Pass 1: collect every locatable exported symbol's signature + body.
  const entries = []; // { file, symbol, signature, tokens }
  const skippedSymbols = [];
  for (const rel of files) {
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
    const exported = extractModuleExports(text);
    for (const { symbol } of exported) {
      const decl = locateDeclaration(text, symbol);
      if (!decl) continue; // no recognized declaration shape — not a candidate, no error
      const body = boundedBody(text, decl.bodyStart);
      if (body === null) {
        skippedSymbols.push({ file: rel, symbol, reason: 'body-exceeds-read-window' });
        continue;
      }
      entries.push({
        file: rel,
        symbol,
        signature: signatureShape(decl.paramsStr),
        tokens: tokenBag(body),
        normName: normalizedName(symbol),
      });
    }
  }

  // Pass 2: pairwise compare, union matching pairs.
  const uf = makeUnionFind(entries.length);
  const pairBasis = new Map(); // "i-j" -> { overlap, nameMatch }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a.file === b.file && a.symbol === b.symbol) continue;
      if (!signaturesMatch(a.signature, b.signature)) continue;
      const overlap = jaccard(a.tokens, b.tokens);
      if (overlap < BODY_OVERLAP_THRESHOLD) continue;
      uf.union(i, j);
      pairBasis.set(`${i}-${j}`, { overlap, nameMatch: a.normName === b.normName });
    }
  }

  // Group by root.
  const groups = new Map(); // root -> [entry indices]
  for (let i = 0; i < entries.length; i++) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }

  const clusters = [];
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    const members = idxs.map((i) => entries[i]);
    members.sort((a, b) => (a.file === b.file ? a.symbol.localeCompare(b.symbol) : a.file.localeCompare(b.file)));
    const evidenceLines = members.map((m, k) => {
      // Basis for member k: the pairwise overlap/name-match against the
      // first other member in the group it actually unioned with — enough
      // for the judge to reason about, per AC3 ("sufficient for the judge to
      // reason without re-deriving"), without re-printing every pair in an
      // N-member cluster.
      let basis = `signature arity=${m.signature.arity}, keys=[${m.signature.destructuredKeys.join(',')}]`;
      for (let other = 0; other < members.length; other++) {
        if (other === k) continue;
        const iA = idxs[k];
        const iB = idxs[other];
        const key = iA < iB ? `${iA}-${iB}` : `${iB}-${iA}`;
        const info = pairBasis.get(key);
        if (info) {
          basis += `; body-overlap=${info.overlap.toFixed(2)}${info.nameMatch ? '; normalized-name match' : ''}`;
          break;
        }
      }
      return `${m.file} — ${m.symbol} — ${basis}`;
    });
    clusters.push({
      files: [...new Set(members.map((m) => m.file))],
      symbols: members.map((m) => m.symbol),
      kind: 'duplicate-abstraction',
      evidence: evidenceLines.join('\n'),
    });
  }

  clusters.sort((a, b) => a.files[0].localeCompare(b.files[0]));
  const droppedClusters = Math.max(0, clusters.length - CLUSTER_CAP);
  const cappedClusters = clusters.slice(0, CLUSTER_CAP);

  const result = {
    candidates: cappedClusters,
    scannedFiles: files.length,
    skippedFiles,
    skippedSymbols,
    discoveryFailed: discovery.discoveryFailed,
    droppedClusters,
  };
  if (discovery.discoveryFailed) result.discoveryReason = discovery.reason;
  return result;
}

// Spec-pinned Data/API Surface signature:
// `candidatesAbstractionPolice(rootDir, opts) → [{files, symbols, kind, evidence}]`.
function candidatesAbstractionPolice(rootDir, opts) {
  return scanAbstractionPolice(rootDir, opts).candidates;
}

registerGenerator('abstraction-police', scanAbstractionPolice);

module.exports = {
  splitTopLevel,
  destructuredKeysOf,
  signatureShape,
  signaturesMatch,
  locateDeclaration,
  boundedBody,
  tokenBag,
  jaccard,
  normalizedName,
  isExcludedPath,
  scanAbstractionPolice,
  candidatesAbstractionPolice,
  BODY_OVERLAP_THRESHOLD,
  MAX_BODY_CHARS,
  CLUSTER_CAP,
};
