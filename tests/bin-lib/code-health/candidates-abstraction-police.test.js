'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const {
  splitTopLevel,
  destructuredKeysOf,
  signatureShape,
  signaturesMatch,
  jaccard,
  tokenBag,
  scanAbstractionPolice,
  candidatesAbstractionPolice,
  BODY_OVERLAP_THRESHOLD,
  MAX_BODY_CHARS,
} = require('../../../plugin/bin/lib/code-health/candidates-abstraction-police');

function tmp() {
  return scratchDir('codehealth-abspolice-');
}
function gitInit(root) {
  execFileSync('git', ['-C', root, 'init', '-q']);
}
function tmpGitRepo() {
  const root = tmp();
  gitInit(root);
  return root;
}

// ── Unit-level helpers ──────────────────────────────────────────────────────

test('splitTopLevel: does not split on commas nested inside braces/brackets/parens', () => {
  assert.deepStrictEqual(splitTopLevel('a, {b, c}, [d, e], f(g, h)'), ['a', ' {b, c}', ' [d, e]', ' f(g, h)']);
});

test('destructuredKeysOf: extracts top-level keys of an object-destructured param, ignores rest', () => {
  assert.deepStrictEqual(destructuredKeysOf('{ file, evidence, ...rest }'), ['file', 'evidence']);
});

test('destructuredKeysOf: returns empty for a plain positional param', () => {
  assert.deepStrictEqual(destructuredKeysOf('finding'), []);
});

test('signatureShape: arity + destructured key set', () => {
  const shape = signatureShape('{ file, evidence }, strict');
  assert.strictEqual(shape.arity, 2);
  assert.deepStrictEqual(shape.destructuredKeys, ['evidence', 'file']);
});

test('signaturesMatch: true only when arity and destructuredKeys sets are equal', () => {
  const a = signatureShape('{ file, evidence }');
  const b = signatureShape('{ evidence, file }'); // same keys, different order
  const c = signatureShape('{ file }');
  const d = signatureShape('finding');
  assert.strictEqual(signaturesMatch(a, b), true);
  assert.strictEqual(signaturesMatch(a, c), false);
  assert.strictEqual(signaturesMatch(a, d), false);
});

test('jaccard: intersection over union of two token sets', () => {
  assert.strictEqual(jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
  assert.strictEqual(jaccard(new Set(['a', 'b']), new Set(['c', 'd'])), 0);
  assert.strictEqual(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd'])), 0.5);
});

test('tokenBag: lowercased bare identifiers, deduplicated', () => {
  const bag = tokenBag('return Foo + foo + BAR;');
  assert.deepStrictEqual([...bag].sort(), ['bar', 'foo', 'return']);
});

// ── AC1: two near-identical validateFinding-shaped helpers in different
// modules plus one coincidentally-similar-name function with a different
// signature yields exactly one cluster of the two — exact-set, not count.

function buildAc1Fixture() {
  const root = tmpGitRepo();
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  const body = [
    'function validateFinding(finding) {',
    "  if (!finding.file) throw new Error('missing file');",
    "  if (!finding.evidence) throw new Error('missing evidence');",
    '  return true;',
    '}',
    'module.exports = { validateFinding };',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'lib', 'a.js'), body);
  fs.writeFileSync(path.join(root, 'lib', 'b.js'), body); // byte-identical body in a different file

  // Coincidentally-similar name, genuinely different signature (arity 2 vs 1) —
  // must never join the cluster regardless of any name-similarity signal.
  fs.writeFileSync(
    path.join(root, 'lib', 'c.js'),
    [
      'function validateFindingList(findings, strict) {',
      '  return findings.every((f) => f.ok);',
      '}',
      'module.exports = { validateFindingList };',
      '',
    ].join('\n'),
  );
  return root;
}

test('AC1: fixture yields exactly one cluster of the two near-identical helpers', () => {
  const root = buildAc1Fixture();
  const candidates = candidatesAbstractionPolice(root);
  assert.strictEqual(candidates.length, 1, `expected exactly 1 cluster, got ${candidates.length}`);
  const [cluster] = candidates;
  assert.strictEqual(cluster.kind, 'duplicate-abstraction');
  assert.deepStrictEqual([...cluster.files].sort(), ['lib/a.js', 'lib/b.js']);
  assert.deepStrictEqual(cluster.symbols.sort(), ['validateFinding', 'validateFinding']);
});

test('AC1: the different-signature same-ish-name function never joins the cluster', () => {
  const root = buildAc1Fixture();
  const candidates = candidatesAbstractionPolice(root);
  for (const c of candidates) {
    assert.ok(!c.files.includes('lib/c.js'), 'lib/c.js must not appear in any cluster');
  }
});

// ── AC2: threshold behavior asserted at the boundary — a fixture pair just
// under BODY_OVERLAP_THRESHOLD produces no cluster; just over produces one
// (both directions, against the spec-stated constant).

function bodyWithTokens(sharedTokens, uniqueTokens) {
  const all = [...sharedTokens, ...uniqueTokens];
  return `{\n  return ${all.join(' + ')};\n}`;
}

function writeFn(root, relFile, symbol, tokens) {
  fs.mkdirSync(path.dirname(path.join(root, relFile)), { recursive: true });
  const bodyBlock = bodyWithTokens(tokens.shared, tokens.unique);
  const text = `function ${symbol}(x) ${bodyBlock}\nmodule.exports = { ${symbol} };\n`;
  fs.writeFileSync(path.join(root, relFile), text);
}

test('AC2: a pair just under the threshold produces no cluster', () => {
  const root = tmpGitRepo();
  const shared = Array.from({ length: 9 }, (_, i) => `sharedTok${i}`);
  writeFn(root, 'lib/under1.js', 'underA', { shared, unique: ['uniqA1', 'uniqA2', 'uniqA3', 'uniqA4'] });
  writeFn(root, 'lib/under2.js', 'underB', { shared, unique: ['uniqB1', 'uniqB2', 'uniqB3'] });
  // jaccard = 9 / (9+4+3) = 9/16 = 0.5625 < 0.6
  const candidates = candidatesAbstractionPolice(root);
  assert.strictEqual(candidates.length, 0, `expected no cluster below threshold, got ${JSON.stringify(candidates)}`);
});

test('AC2: a pair just over the threshold produces exactly one cluster', () => {
  const root = tmpGitRepo();
  const shared = Array.from({ length: 10 }, (_, i) => `sharedTok${i}`);
  writeFn(root, 'lib/over1.js', 'overA', { shared, unique: ['uniqA1', 'uniqA2', 'uniqA3'] });
  writeFn(root, 'lib/over2.js', 'overB', { shared, unique: ['uniqB1', 'uniqB2', 'uniqB3'] });
  // jaccard = 10 / (10+3+3) = 10/16 = 0.625 > 0.6
  const candidates = candidatesAbstractionPolice(root);
  assert.strictEqual(candidates.length, 1, `expected exactly one cluster above threshold, got ${candidates.length}`);
  assert.deepStrictEqual([...candidates[0].files].sort(), ['lib/over1.js', 'lib/over2.js']);
});

test('BODY_OVERLAP_THRESHOLD is the documented 0.6 anchor', () => {
  assert.strictEqual(BODY_OVERLAP_THRESHOLD, 0.6);
});

// ── AC2b: transitive-closure fixture — a coincidental function pairwise
// near-threshold with one real cluster member does not get chained into the
// cluster by union-find.

test('AC2b: a near-threshold-but-under coincidental function is not chained into a real cluster', () => {
  const root = tmpGitRepo();
  const sharedReal = Array.from({ length: 12 }, (_, i) => `realTok${i}`);
  // P and Q: a real cluster, well over threshold — jaccard(P,Q) = 12/14 ≈ 0.857.
  writeFn(root, 'lib/p.js', 'realP', { shared: sharedReal, unique: ['pOnly'] });
  writeFn(root, 'lib/q.js', 'realQ', { shared: sharedReal, unique: ['qOnly'] });
  // R: same signature as P/Q. Its overlap with Q is computed against Q's FULL
  // token set (the 12 shared reals + Q's own 'qOnly'), i.e. 13 tokens: R
  // shares 9 of those 13 and adds 6 tokens of its own. union = 13 + 6 = 19,
  // intersection = 9 -> jaccard(R,Q) = 9/19 ≈ 0.474 — comfortably under
  // BODY_OVERLAP_THRESHOLD (0.6), but still "near" in the sense of sharing a
  // real majority of the tokens, the case a naive proximity/chaining bug
  // (rather than a strict direct-pairwise union) would most plausibly leak.
  const sharedWithQ = [...sharedReal.slice(0, 9)];
  writeFn(root, 'lib/r.js', 'coincidentalR', {
    shared: sharedWithQ,
    unique: ['rOnly1', 'rOnly2', 'rOnly3', 'rOnly4', 'rOnly5', 'rOnly6'],
  });
  const candidates = candidatesAbstractionPolice(root);
  const pqCluster = candidates.find((c) => c.files.includes('lib/p.js'));
  assert.ok(pqCluster, 'P and Q must form a cluster');
  assert.ok(pqCluster.files.includes('lib/q.js'), 'P and Q must be in the same cluster');
  assert.ok(!pqCluster.files.includes('lib/r.js'), 'R must not be chained into the P/Q cluster despite sharing a majority of tokens with Q');
});

test('AC2b: a coincidental function whose direct overlap with every real-cluster member is under threshold stays out', () => {
  const root = tmpGitRepo();
  const sharedReal = Array.from({ length: 12 }, (_, i) => `realTok${i}`);
  writeFn(root, 'lib/p.js', 'realP', { shared: sharedReal, unique: ['pOnly'] });
  writeFn(root, 'lib/q.js', 'realQ', { shared: sharedReal, unique: ['qOnly'] });
  // R shares only a minority of tokens with either P or Q — well under
  // threshold against both, and must never appear in their cluster.
  writeFn(root, 'lib/r.js', 'coincidentalR', {
    shared: sharedReal.slice(0, 3),
    unique: ['rOnly1', 'rOnly2', 'rOnly3', 'rOnly4', 'rOnly5', 'rOnly6'],
  });
  const candidates = candidatesAbstractionPolice(root);
  const pqCluster = candidates.find((c) => c.files.includes('lib/p.js'));
  assert.ok(pqCluster, 'P and Q must still form a cluster');
  assert.ok(!pqCluster.files.includes('lib/r.js'), 'R must not be chained into the P/Q cluster');
  assert.ok(!candidates.some((c) => c.symbols.includes('coincidentalR')), 'R must not appear in any cluster');
});

// ── AC2c: a candidate function body exceeding the bounded-read window is
// skipped with a logged note and never silently half-compared.

test('AC2c: a body exceeding MAX_BODY_CHARS is skipped, not half-compared, and reported', () => {
  const root = tmpGitRepo();
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  // The matching '}' sits well past MAX_BODY_CHARS from the opening '{'.
  const oversized = 'x'.repeat(MAX_BODY_CHARS + 2000);
  const text = `function tooLong(x) {\n  ${oversized}\n}\nmodule.exports = { tooLong };\n`;
  fs.writeFileSync(path.join(root, 'lib', 'big.js'), text);
  const { candidates, skippedSymbols } = scanAbstractionPolice(root);
  assert.ok(!candidates.some((c) => c.symbols.includes('tooLong')), 'an oversized body must never produce a candidate');
  const skip = skippedSymbols.find((s) => s.file === 'lib/big.js' && s.symbol === 'tooLong');
  assert.ok(skip, 'the oversized symbol must be reported in skippedSymbols');
  assert.strictEqual(skip.reason, 'body-exceeds-read-window');
});

// ── AC3: a cluster's evidence names each member's file, symbol, and the
// similarity basis — sufficient for the judge to reason without re-deriving.

test('AC3: cluster evidence names each member file, symbol, and similarity basis', () => {
  const root = buildAc1Fixture();
  const candidates = candidatesAbstractionPolice(root);
  const [cluster] = candidates;
  const lines = cluster.evidence.split('\n');
  assert.strictEqual(lines.length, 2, 'one evidence line per member');
  for (const line of lines) {
    assert.match(line, /lib\/[ab]\.js — validateFinding — /);
    assert.match(line, /signature arity=\d+/);
  }
});

// ── AC5: the generator ignores test fixtures and generated/vendored paths.

test('AC5: files under a fixtures/vendor/third_party path never produce candidates', () => {
  const root = tmpGitRepo();
  const body = [
    'function sharedHelper(finding) {',
    "  if (!finding.file) throw new Error('x');",
    "  if (!finding.evidence) throw new Error('y');",
    '  return true;',
    '}',
    'module.exports = { sharedHelper };',
    '',
  ].join('\n');
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'fixtures'), { recursive: true });
  fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'real.js'), body);
  fs.writeFileSync(path.join(root, 'fixtures', 'copy.js'), body);
  fs.writeFileSync(path.join(root, 'vendor', 'copy2.js'), body);
  const candidates = candidatesAbstractionPolice(root);
  for (const c of candidates) {
    assert.ok(!c.files.some((f) => f.startsWith('fixtures/') || f.startsWith('vendor/')), `no fixture/vendor file expected in ${JSON.stringify(c.files)}`);
  }
});

test('AC5: a *.test.js file is excluded from candidacy even with a duplicate body', () => {
  const root = tmpGitRepo();
  const body = [
    'function sharedHelper(finding) {',
    "  if (!finding.file) throw new Error('x');",
    "  if (!finding.evidence) throw new Error('y');",
    '  return true;',
    '}',
    'module.exports = { sharedHelper };',
    '',
  ].join('\n');
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lib', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'real.js'), body);
  fs.writeFileSync(path.join(root, 'lib', 'tests', 'real.test.js'), body);
  const candidates = candidatesAbstractionPolice(root);
  for (const c of candidates) {
    assert.ok(!c.files.includes('lib/tests/real.test.js'));
  }
});

// ── Discovery-failure passthrough (mirrors candidates-dead-code.test.js's
// own coverage of listTrackedSourceFiles's discoveryFailed contract).

test('scanAbstractionPolice: a non-git root reports discoveryFailed with a reason, zero candidates', () => {
  const root = tmp(); // no git init
  const { candidates, discoveryFailed, discoveryReason } = scanAbstractionPolice(root);
  assert.deepStrictEqual(candidates, []);
  assert.strictEqual(discoveryFailed, true);
  assert.ok(typeof discoveryReason === 'string' && discoveryReason.length > 0);
});
