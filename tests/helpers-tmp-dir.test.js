'use strict';
// tests/helpers/tmp-dir.js: scratch directories removed when the test process exits. The exit-time removal is
// only observable from outside the process, so each case runs a child node process and inspects what it left.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { scratchDir, removeScratchDir } = require('./helpers/tmp-dir');

const HELPER = path.join(__dirname, 'helpers', 'tmp-dir.js');

// Runs `body` (it can use `h`, the helper) in a child whose TMPDIR is a fresh directory of this test's; returns
// `{ out, left }`: the child's stdout and the entries still in that directory after the child exited.
function inChild(body) {
  const parent = scratchDir('ct-tmpdir-helper-');
  const out = execFileSync(process.execPath, ['-e', `const h = require(${JSON.stringify(HELPER)}); const os = require('os'); const fs = require('fs');\n${body}`], {
    env: { ...process.env, TMPDIR: parent, TMP: parent, TEMP: parent },
    encoding: 'utf8',
  });
  return { out: out.trim(), left: fs.readdirSync(parent), parent };
}

test('scratchDir makes a prefixed directory under the tmpdir and removes it when the process exits', () => {
  const { out, left, parent } = inChild("const d = h.scratchDir('ct-x-'); fs.writeFileSync(d + '/f', 'x'); console.log(d);");
  assert.equal(path.dirname(out), path.resolve(parent));
  assert.match(path.basename(out), /^ct-x-[A-Za-z0-9]{6}$/);
  assert.deepEqual(left, []);
});

test('scratchDir removes every directory it made, nested contents included', () => {
  const { left } = inChild("for (let i = 0; i < 5; i++) { const d = h.scratchDir('ct-y-'); fs.mkdirSync(d + '/a/b', { recursive: true }); fs.writeFileSync(d + '/a/b/f', 'x'); }");
  assert.deepEqual(left, []);
});

test('scratchDir takes an explicit parent and a realpath option', () => {
  const root = scratchDir('ct-parent-', { realpath: true });
  assert.equal(root, fs.realpathSync(root));
  const child = scratchDir('ct-kid-', { parent: root });
  assert.equal(path.dirname(child), root);
  const real = scratchDir('ct-real-', { realpath: true });
  assert.equal(real, fs.realpathSync(real));
});

test('removeScratchDir removes now and a second removal, or the exit hook after it, is harmless', () => {
  const dir = scratchDir('ct-gone-');
  fs.writeFileSync(path.join(dir, 'f'), 'x');
  removeScratchDir(dir);
  assert.equal(fs.existsSync(dir), false);
  removeScratchDir(dir);
  const { left } = inChild("const d = h.scratchDir('ct-z-'); h.removeScratchDir(d); h.removeScratchDir(d);");
  assert.deepEqual(left, []);
});

test('isolateTmpdir points TMPDIR/TMP/TEMP and os.tmpdir() at a directory removed at exit, children inheriting it', () => {
  const { out, left, parent } = inChild([
    "const d = h.isolateTmpdir('ct-iso-');",
    "const seen = require('child_process').execFileSync(process.execPath, ['-e', 'require(\"fs\").mkdtempSync(require(\"os\").tmpdir() + \"/kid-\"); console.log(process.env.TMPDIR)'], { encoding: 'utf8' }).trim();",
    "console.log(JSON.stringify({ d, tmp: os.tmpdir(), TMP: process.env.TMP, TEMP: process.env.TEMP, seen, inside: fs.readdirSync(d) }));",
  ].join('\n'));
  const r = JSON.parse(out);
  assert.equal(path.dirname(r.d), path.resolve(parent));
  assert.equal(path.resolve(r.tmp), path.resolve(r.d));
  assert.equal(r.TMP, r.d);
  assert.equal(r.TEMP, r.d);
  assert.equal(r.seen, r.d);
  assert.equal(r.inside.length, 1, 'the child process wrote into the isolated tmpdir');
  assert.deepEqual(left, []);
});

// #6006: tools/run-tests.js points CT_FACTORY_POLICY_FILE at a missing file; a bare `node --test` has no runner, so
// loading this helper supplies the same kind of path (the CT_HOOKS_REPO_INFO_STORE precedent in git-template.js).
test('applyFactoryFileFallback gives an unset or empty CT_FACTORY_POLICY_FILE an absolute path that does not exist', () => {
  const { applyFactoryFileFallback } = require('./helpers/tmp-dir');
  for (const env of [{}, { CT_FACTORY_POLICY_FILE: '' }]) {
    applyFactoryFileFallback(env);
    assert.ok(path.isAbsolute(env.CT_FACTORY_POLICY_FILE), JSON.stringify(env));
    assert.equal(fs.existsSync(env.CT_FACTORY_POLICY_FILE), false, 'the fallback names a file that is never created');
  }
});

test('applyFactoryFileFallback never replaces a value the runner already set', () => {
  const { applyFactoryFileFallback } = require('./helpers/tmp-dir');
  const set = path.join(os.tmpdir(), 'runner-set', 'factory-policy.absent.yml');
  const env = { CT_FACTORY_POLICY_FILE: set, OTHER: 'kept' };
  applyFactoryFileFallback(env);
  assert.deepEqual(env, { CT_FACTORY_POLICY_FILE: set, OTHER: 'kept' });
});

test('loading the helper applies the fallback to the process environment when the variable is unset', () => {
  const run = (envOverride) => execFileSync(process.execPath, ['-e', `require(${JSON.stringify(HELPER)}); console.log(process.env.CT_FACTORY_POLICY_FILE || '')`], {
    env: { ...process.env, CT_FACTORY_POLICY_FILE: '', ...envOverride }, encoding: 'utf8',
  }).trim();
  assert.ok(path.isAbsolute(run({})), 'an empty variable gets the fallback');
  assert.equal(run({ CT_FACTORY_POLICY_FILE: '/runner/set/it.yml' }), '/runner/set/it.yml');
});
