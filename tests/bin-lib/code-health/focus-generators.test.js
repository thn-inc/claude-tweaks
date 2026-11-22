'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function tmp() {
  return scratchDir('codehealth-focusgen-');
}

function tmpGitRepo() {
  const root = tmp();
  execFileSync('git', ['-C', root, 'init', '-q']);
  return root;
}

// buildAc1Fixture mirrors candidates-dead-code.test.js's own fixture (same
// shape: a live+dead export pair, an orphan file) — duplicated here rather
// than shared, since these tests only need the rich-shape contract, not the
// exact candidate content.
function buildAc1Fixture() {
  const root = tmpGitRepo();
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'lib', 'used.js'),
    'function usedFn() { return 1; }\nfunction deadFn() { return 2; }\nmodule.exports = { usedFn, deadFn };\n',
  );
  fs.writeFileSync(path.join(root, 'lib', 'caller.js'), "const { usedFn } = require('./used');\nusedFn();\n");
  fs.writeFileSync(path.join(root, 'orphan.js'), 'function orphanFn() { return 3; }\nmodule.exports = { orphanFn };\n');
  return root;
}

// ── FOCUS_GENERATORS registry (docs/plans/2026-08-09-code-health-focus-mode-
// dead-code-ledger.md item #6: the registry is shared cross-vertical
// framework machinery, homed in its own neutral module rather than inside
// the one vertical — candidates-dead-code.js — that happened to ship first)

// This test file's own top-level requires below deliberately do NOT require
// candidates-dead-code.js first — the first require of it anywhere in this
// process is `focus-generators.js`'s own internal autoload. That is exactly
// the shape of skills/code-health/focus-mode.md's F1/"Known values" node -e
// snippets, which require only focus-generators.js. If the registry were
// populated only as a side effect of some OTHER module requiring
// candidates-dead-code.js directly first, this would see an empty registry.
const { FOCUS_GENERATORS, registerGenerator } = require('../../../plugin/bin/lib/code-health/focus-generators');

test('FOCUS_GENERATORS: requiring focus-generators.js alone (never candidates-dead-code.js directly) still yields "dead-code" registered', () => {
  assert.ok(Object.keys(FOCUS_GENERATORS).includes('dead-code'), 'the dead-code vertical must self-register via focus-generators.js\'s own autoload, without this file ever requiring candidates-dead-code.js directly');
  const root = buildAc1Fixture();
  const result = FOCUS_GENERATORS['dead-code'](root);
  assert.ok(Array.isArray(result.candidates));
  assert.strictEqual(typeof result.scannedFiles, 'number');
  assert.ok(Array.isArray(result.skippedFiles));
  assert.strictEqual(result.discoveryFailed, false);
});

test('FOCUS_GENERATORS: the registered "dead-code" generator is the same function candidates-dead-code.js exports as scanDeadCode, not a copy', () => {
  const { scanDeadCode } = require('../../../plugin/bin/lib/code-health/candidates-dead-code');
  assert.strictEqual(FOCUS_GENERATORS['dead-code'], scanDeadCode);
});

test('registerGenerator: registers an arbitrary name -> function pair, for a future vertical adding its own key', () => {
  const fakeGenerator = () => ({ candidates: [], scannedFiles: 0, skippedFiles: [], discoveryFailed: false });
  registerGenerator('fake-vertical-for-this-test', fakeGenerator);
  assert.strictEqual(FOCUS_GENERATORS['fake-vertical-for-this-test'], fakeGenerator);
});

test('the other require order (candidates-dead-code.js required first, in a fresh module cache) also yields a populated registry', () => {
  // Bust the cache for both files to simulate a process that requires
  // candidates-dead-code.js before ever touching focus-generators.js — the
  // reverse of this test file's own top-level require order above.
  delete require.cache[require.resolve('../../../plugin/bin/lib/code-health/candidates-dead-code')];
  delete require.cache[require.resolve('../../../plugin/bin/lib/code-health/focus-generators')];
  const { scanDeadCode } = require('../../../plugin/bin/lib/code-health/candidates-dead-code');
  const { FOCUS_GENERATORS: freshRegistry } = require('../../../plugin/bin/lib/code-health/focus-generators');
  assert.strictEqual(freshRegistry['dead-code'], scanDeadCode);
});
