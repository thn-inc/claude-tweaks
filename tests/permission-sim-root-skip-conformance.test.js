'use strict';
// tests/permission-sim-root-skip-conformance.test.js — #1853: a chmodSync-based
// permission-denial simulation only exercises the denial as a normal user; under
// a root-privileged runner (process.getuid() === 0, the shape of a sandboxed
// cloud or CI harness — CLAUDE.md's Cloud parity section) the kernel ignores
// mode bits and the assertion fails deterministically. This scan enforces the
// rule: a test file calling chmodSync( must either (a) import the shared
// tests/helpers/root.js helper and use skipUnderRoot at least once, or (b) mark
// every chmodSync( call `// root-safe` — the exception for a restore-only use
// (undoing a fixture's own chmod) or an exec-bit setup (making a spy/stub
// script runnable), neither of which is a permission-denial simulation at all.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TESTS_DIR = __dirname;

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.name.endsWith('.test.js')) acc.push(full);
  }
  return acc;
}

const HELPER_IMPORT_RE = /require\(['"][^'"]*helpers\/root(?:\.js)?['"]\)/;

// Returns null when the file conforms, or a violation message naming the
// first bare (unmarked) chmodSync( line otherwise.
function checkFile(filePath, text) {
  if (!text.includes('chmodSync(')) return null;
  const usesHelper = HELPER_IMPORT_RE.test(text) && text.includes('skipUnderRoot(');
  if (usesHelper) return null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('chmodSync(') && !lines[i].includes('root-safe')) {
      return `${path.relative(ROOT, filePath)}:${i + 1} calls chmodSync( without importing tests/helpers/root.js's skipUnderRoot, and is not marked // root-safe`;
    }
  }
  return null;
}

test('every chmodSync( call under tests/** either uses skipUnderRoot or is marked // root-safe (#1853)', () => {
  const violations = [];
  for (const file of walk(TESTS_DIR)) {
    // The helper file itself and this conformance test are not subject to the rule.
    if (file === path.join(TESTS_DIR, 'helpers', 'root.js')) continue;
    if (file === __filename) continue;
    const text = fs.readFileSync(file, 'utf8');
    const v = checkFile(file, text);
    if (v) violations.push(v);
  }
  assert.deepStrictEqual(violations, [], `unguarded permission-simulation chmodSync( found:\n${violations.join('\n')}`);
});

// AC3: the scan must actually be able to go red — proven against a live
// fixture file, not just asserted in prose.
test('the scan fails on a fixture test that calls chmodSync without the helper (self-check)', () => {
  const bad = "const fs = require('fs');\nfs.chmodSync('/tmp/x', 0o000);\n";
  const v = checkFile('/fake/bad.test.js', bad);
  assert.ok(v, 'a bare, unmarked chmodSync( must be flagged');
  assert.match(v, /bad\.test\.js:2/);
});

test('the scan passes a fixture using skipUnderRoot, and a fixture marked // root-safe (self-check)', () => {
  const goodHelper = "const { skipUnderRoot } = require('./helpers/root');\n"
    + "test('x', skipUnderRoot('reason'), () => { fs.chmodSync('/tmp/x', 0o000); });\n";
  assert.strictEqual(checkFile('/fake/good1.test.js', goodHelper), null);

  const goodMarked = "const fs = require('fs');\nfs.chmodSync('/tmp/x', 0o755); // root-safe: exec-bit stub\n";
  assert.strictEqual(checkFile('/fake/good2.test.js', goodMarked), null);
});

test('helpers/root.js exports IS_ROOT and skipUnderRoot with the documented shape', () => {
  const { IS_ROOT, skipUnderRoot } = require(path.join(TESTS_DIR, 'helpers', 'root.js'));
  assert.strictEqual(typeof IS_ROOT, 'boolean');
  assert.deepStrictEqual(skipUnderRoot('reason'), { skip: IS_ROOT && 'reason' });
  // Never skipped when not root; the real process.getuid, not a stub, since
  // this suite must be honest about the runner it is actually executing under.
  if (!IS_ROOT) assert.strictEqual(skipUnderRoot('reason').skip, false);
});
