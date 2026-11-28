'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const {
  hasAssertionToken,
  isTautological,
  pairedByFilename,
  pairedByImport,
  findPairing,
  scanTestHygiene,
  candidatesTestHygiene,
} = require('../../../plugin/bin/lib/code-health/candidates-test-hygiene');

function tmp() {
  return scratchDir('codehealth-testhygiene-');
}
function gitInit(root) {
  execFileSync('git', ['-C', root, 'init', '-q']);
}
function tmpGitRepo() {
  const root = tmp();
  gitInit(root);
  return root;
}
function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// ── Unit-level helpers ──────────────────────────────────────────────────────

test('hasAssertionToken: recognizes assert-prefixed calls, expect(, t.assert, matcher chains', () => {
  assert.strictEqual(hasAssertionToken("const assert = require('assert'); assert.ok(true);"), true);
  assert.strictEqual(hasAssertionToken('expect(foo).toBe(1);'), true);
  assert.strictEqual(hasAssertionToken('t.assert(x, "message");'), true);
  assert.strictEqual(hasAssertionToken('expect(promise).rejects.toThrow();'), true);
  assert.strictEqual(hasAssertionToken('function noop() { return 1; }'), false);
});

test('isTautological: catches assert.equal(x, x)-shape, not two different expressions', () => {
  assert.strictEqual(isTautological('assert.equal(1, 1);'), true);
  assert.strictEqual(isTautological('assert.strictEqual(x, x);'), true);
  assert.strictEqual(isTautological('assert.equal(1, 2);'), false);
  assert.strictEqual(isTautological('assert.equal(foo(), bar());'), false);
});

// ── AC1: fixture with a source module having no test file, one with a
// properly paired test, an assertion-free test file, and a tautological test
// yields exactly the gap + the two useless-test candidates — exact-set.

function buildAc1Fixture(root) {
  // Unpaired source — no test file names it, and its own directory ('gap/')
  // has no sibling tests/ dir at all, so the coarse directory-convention
  // heuristic (any test file under a sibling tests/ pairs the whole
  // directory — see candidates-test-hygiene.js's own header) has nothing to
  // find either. Deliberately kept out of lib/, which DOES have a tests/
  // subdirectory for its other (paired) fixtures below.
  write(root, 'gap/orphaned.js', 'function orphanedFn() { return 1; }\nmodule.exports = { orphanedFn };\n');

  // Properly paired source + test (real assertion, real reference).
  write(root, 'lib/paired.js', 'function pairedFn(x) { return x + 1; }\nmodule.exports = { pairedFn };\n');
  write(
    root,
    'lib/tests/paired.test.js',
    "const assert = require('node:assert/strict');\nconst { pairedFn } = require('../paired');\nrequire('node:test').test('x', () => { assert.strictEqual(pairedFn(1), 2); });\n",
  );

  // Assertion-free test file (still references paired.js by name, so it
  // doesn't itself introduce a coverage-gap, but it IS a useless-test).
  write(root, 'lib/tests/empty.test.js', "require('node:test').test('x', () => { const y = 1 + 1; });\n");

  // Tautological test file.
  write(
    root,
    'lib/tests/tautological.test.js',
    "const assert = require('node:assert/strict');\nrequire('node:test').test('x', () => { assert.equal(1, 1); });\n",
  );
}

test('AC1: fixture yields exactly the gap + the two useless-test candidates', () => {
  const root = tmpGitRepo();
  buildAc1Fixture(root);
  const candidates = candidatesTestHygiene(root);
  const simplified = candidates
    .map((c) => ({ file: c.file, symbol: c.symbol, kind: c.kind }))
    .sort((a, b) => (a.file === b.file ? (a.symbol || '').localeCompare(b.symbol || '') : a.file.localeCompare(b.file)));
  assert.deepStrictEqual(simplified, [
    { file: 'gap/orphaned.js', symbol: undefined, kind: 'coverage-gap' },
    { file: 'lib/tests/empty.test.js', symbol: undefined, kind: 'useless-test' },
    { file: 'lib/tests/tautological.test.js', symbol: undefined, kind: 'useless-test' },
  ]);
});

// ── AC1b: symbol-level gap fixture — a source module whose file IS paired
// but which exports one symbol no test file references yields a
// symbol-scoped coverage-gap candidate.

test('AC1b: a paired file with one unreferenced exported symbol yields a symbol-scoped gap', () => {
  const root = tmpGitRepo();
  write(
    root,
    'lib/multi.js',
    'function usedOne(x) { return x; }\nfunction neverReferenced(x) { return x * 2; }\nmodule.exports = { usedOne, neverReferenced };\n',
  );
  write(
    root,
    'lib/tests/multi.test.js',
    "const assert = require('node:assert/strict');\nconst { usedOne } = require('../multi');\nrequire('node:test').test('x', () => { assert.strictEqual(usedOne(1), 1); });\n",
  );
  const candidates = candidatesTestHygiene(root);
  // The file itself must NOT be a file-level gap (it is paired).
  assert.ok(!candidates.some((c) => c.file === 'lib/multi.js' && !c.symbol));
  // The unreferenced symbol must be a symbol-scoped gap.
  const symGap = candidates.find((c) => c.file === 'lib/multi.js' && c.symbol === 'neverReferenced');
  assert.ok(symGap, 'expected a symbol-scoped coverage-gap for neverReferenced');
  assert.strictEqual(symGap.kind, 'coverage-gap');
  // usedOne must not itself be flagged.
  assert.ok(!candidates.some((c) => c.file === 'lib/multi.js' && c.symbol === 'usedOne'));
});

// ── AC2: a test-double whose `returns` fields are lazily-called functions is
// NOT flagged as assertion-free merely for having no top-level assert
// (IL-30's pattern appears in healthy suites).

test('AC2: a lazily-called assertion inside a test-double is not flagged assertion-free', () => {
  const root = tmpGitRepo();
  // No TOP-LEVEL assert call anywhere — the only assertion token lives
  // inside a function value that is never invoked at module-evaluation time.
  write(
    root,
    'lib/tests/double.test.js',
    [
      "const assert = require('node:assert/strict');",
      'const testDouble = {',
      '  returns: () => { assert.ok(true); return 42; },',
      '};',
      "require('node:test').test('uses double', () => { testDouble.returns(); });",
      '',
    ].join('\n'),
  );
  const { candidates } = scanTestHygiene(root);
  const uselessForDouble = candidates.filter((c) => c.file === 'lib/tests/double.test.js' && c.kind === 'useless-test');
  assert.deepStrictEqual(uselessForDouble, [], 'must not be flagged assertion-free — the vocabulary scan is whole-file, not call-position-based');
});

// ── AC3 (evidence content): both candidate kinds carry evidence strings
// naming the exact pairing/assertion basis.

test('AC3: coverage-gap evidence names the file and that no test paired it', () => {
  const root = tmpGitRepo();
  write(root, 'lib/lonely.js', 'function lonelyFn() {}\nmodule.exports = { lonelyFn };\n');
  const candidates = candidatesTestHygiene(root);
  const gap = candidates.find((c) => c.file === 'lib/lonely.js');
  assert.ok(gap);
  assert.match(gap.evidence, /lib\/lonely\.js/);
});

test('AC3: useless-test evidence distinguishes tautological from assertion-free', () => {
  const root = tmpGitRepo();
  write(root, 'lib/tests/taut.test.js', "const assert = require('node:assert/strict');\nassert.equal(2, 2);\n");
  write(root, 'lib/tests/empty.test.js', "require('node:test').test('x', () => {});\n");
  const candidates = candidatesTestHygiene(root);
  const taut = candidates.find((c) => c.file === 'lib/tests/taut.test.js');
  const empty = candidates.find((c) => c.file === 'lib/tests/empty.test.js');
  assert.match(taut.evidence, /tautological/);
  assert.match(empty.evidence, /no recognized assertion/);
});

// ── Pairing heuristics — false-friend fixture (a test file whose name pairs
// but imports nothing) so discrimination is real: naming-convention pairing
// must succeed on its own, independent of the import heuristic.

test('pairing: filename-convention pairs a test file that imports nothing (false-friend safe)', () => {
  const root = tmpGitRepo();
  write(root, 'lib/standalone.js', 'function standaloneFn() {}\nmodule.exports = { standaloneFn };\n');
  // False-friend: name pairs, but the file requires nothing from the source.
  write(root, 'lib/tests/standalone.test.js', "require('node:test').test('unrelated', () => {});\n");
  const testFiles = ['lib/tests/standalone.test.js'];
  const contentsByFile = new Map([[testFiles[0], "require('node:test').test('unrelated', () => {});\n"]]);
  assert.strictEqual(pairedByImport('lib/standalone.js', testFiles, contentsByFile), null, 'import heuristic must find nothing');
  assert.strictEqual(pairedByFilename('lib/standalone.js', testFiles), testFiles[0], 'filename heuristic must still pair it');
  assert.strictEqual(findPairing('lib/standalone.js', testFiles, contentsByFile), testFiles[0]);
  // And the file-level generator output must reflect it: no file-level gap
  // for lib/standalone.js (it's paired, even though the test asserts
  // nothing about it and the import heuristic alone would have missed it).
  const candidates = candidatesTestHygiene(root);
  assert.ok(!candidates.some((c) => c.file === 'lib/standalone.js' && c.kind === 'coverage-gap' && !c.symbol));
});

// ── Exclusions: vendored paths never produce coverage-gap candidates;
// fixture-directory source files are excluded from coverage-gap candidacy.

test('exclusions: a vendored source file is never a coverage-gap candidate', () => {
  const root = tmpGitRepo();
  write(root, 'vendor/thirdparty.js', 'function vendoredFn() {}\nmodule.exports = { vendoredFn };\n');
  const candidates = candidatesTestHygiene(root);
  assert.ok(!candidates.some((c) => c.file.startsWith('vendor/')));
});

test('exclusions: a fixtures-directory source file is never a coverage-gap candidate', () => {
  const root = tmpGitRepo();
  write(root, 'lib/fixtures/sample.js', 'function sampleFn() {}\nmodule.exports = { sampleFn };\n');
  const candidates = candidatesTestHygiene(root);
  assert.ok(!candidates.some((c) => c.file === 'lib/fixtures/sample.js'));
});

// ── Discovery-failure passthrough.

test('scanTestHygiene: a non-git root reports discoveryFailed with a reason, zero candidates', () => {
  const root = tmp(); // no git init
  const { candidates, discoveryFailed, discoveryReason } = scanTestHygiene(root);
  assert.deepStrictEqual(candidates, []);
  assert.strictEqual(discoveryFailed, true);
  assert.ok(typeof discoveryReason === 'string' && discoveryReason.length > 0);
});
