'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../../plugin/bin/lib/release-local/manifest.js');

const files = (map) => ({ readFile: (p) => (Object.prototype.hasOwnProperty.call(map, p) ? map[p] : null), map });
const config = (releaseType, extraFiles) => JSON.stringify({ packages: { '.': { 'release-type': releaseType, ...(extraFiles ? { 'extra-files': extraFiles } : {}) } } });

test('readConfig: null without a config, release-type + extra-files with one', () => {
  assert.strictEqual(M.readConfig(files({}).readFile), null);
  assert.deepStrictEqual(M.readConfig(files({ 'release-please-config.json': config('node') }).readFile), { releaseType: 'node', extraFiles: [] });
  const ef = [{ type: 'json', path: 'plugin/.claude-plugin/plugin.json', jsonpath: '$.version' }];
  assert.deepStrictEqual(M.readConfig(files({ 'release-please-config.json': config('simple', ef) }).readFile).extraFiles, ef);
});

test('resolveTargets: one row per stack type, the manifest file always, unsupported types throw naming the type', () => {
  assert.deepStrictEqual(M.resolveTargets({ releaseType: 'node', extraFiles: [] }).map((t) => [t.path, t.kind]),
    [['.release-please-manifest.json', 'manifest'], ['package.json', 'json'], ['package-lock.json', 'json-lock']]);
  // step-21-release.md selects `python` from pyproject.toml OR setup.py — every marker it can
  // select on must be a target, or a setup.py-only repo fails every release (all three optional).
  assert.deepStrictEqual(M.resolveTargets({ releaseType: 'python', extraFiles: [] }).map((t) => t.path), ['.release-please-manifest.json', 'pyproject.toml', 'setup.py', 'setup.cfg']);
  assert.deepStrictEqual(M.resolveTargets({ releaseType: 'rust', extraFiles: [] }).map((t) => t.path), ['.release-please-manifest.json', 'Cargo.toml']);
  assert.deepStrictEqual(M.resolveTargets({ releaseType: 'php', extraFiles: [] }).map((t) => t.path), ['.release-please-manifest.json', 'composer.json']);
  assert.deepStrictEqual(M.resolveTargets({ releaseType: 'go', extraFiles: [] }).map((t) => t.path), ['.release-please-manifest.json']);
  assert.deepStrictEqual(M.resolveTargets({ releaseType: 'simple', extraFiles: ['VERSION.txt', { type: 'json', path: 'p.json', jsonpath: '$.version' }] }).map((t) => [t.path, t.kind]),
    [['.release-please-manifest.json', 'manifest'], ['version.txt', 'text'], ['VERSION.txt', 'generic'], ['p.json', 'json']]);
  assert.throws(() => M.resolveTargets({ releaseType: 'java', extraFiles: [] }), (e) => e instanceof M.ManifestError && /java/.test(e.message) && /simple/.test(e.message));
  assert.throws(() => M.resolveTargets({ releaseType: 'simple', extraFiles: [{ type: 'yaml', path: 'x.yml' }] }), /yaml/);
  assert.throws(() => M.resolveTargets({ releaseType: 'simple', extraFiles: [{ type: 'json', path: 'p.json', jsonpath: '$.nested.version' }] }), /jsonpath/);
});

test('resolveTargets: extra-files may not escape the repo root — but a leading-dots FILENAME is not an escape', () => {
  const targets = (extraFiles) => M.resolveTargets({ releaseType: 'simple', extraFiles }).map((t) => t.path);
  assert.ok(targets(['..hidden.json']).includes('..hidden.json'));
  assert.ok(targets(['a/..b/c.json']).includes('a/..b/c.json'));
  // validated after normalize, but the target keeps the path the config wrote
  assert.ok(targets(['nested/../x.json']).includes('nested/../x.json'), 'a path that normalizes back inside the root is fine');
  for (const bad of ['../x.json', '..', 'a/../../x.json', '/abs/x.json', 'C:/x.json', '\\\\server\\share\\x.json']) {
    assert.throws(() => targets([bad]), (e) => e instanceof M.ManifestError && /extra-files path escapes the repo root/.test(e.message), bad);
  }
});

test('spliceVersion json: only the version token changes, formatting untouched, previous reported', () => {
  const text = '{\n\t"name": "x",\n\t"version": "1.2.0",\n\t"dependencies": {"y": {"version": "9.9.9"}}\n}\n';
  const out = M.spliceVersion('json', text, '1.3.0');
  assert.strictEqual(out.text, text.replace('"1.2.0"', '"1.3.0"'));
  assert.strictEqual(out.previous, '1.2.0');
  assert.strictEqual(M.spliceVersion('json', '{"name":"x"}', '1.3.0').found, false);
});

test('spliceVersion json: a nested "version" PRECEDING the root one is never the match (structural, not first-occurrence)', () => {
  const text = '{\n  "publishConfig": {\n    "version": "9.9.9"\n  },\n  "version": "1.2.0"\n}\n';
  const out = M.spliceVersion('json', text, '1.3.0');
  assert.strictEqual(out.previous, '1.2.0');
  assert.strictEqual(out.text, text.replace('"version": "1.2.0"', '"version": "1.3.0"'));
  assert.ok(out.text.includes('"version": "9.9.9"'), out.text);
  // a "version"-looking key inside an array at the root is not a root key either
  const arr = '{\n  "bundles": [\n    { "version": "9.9.9" }\n  ],\n  "version": "1.2.0"\n}\n';
  assert.strictEqual(M.spliceVersion('json', arr, '1.3.0').previous, '1.2.0');
  // escaped quotes in a preceding string value must not desynchronize the scanner
  const esc = '{\n  "desc": "a \\"version\\": \\"9.9.9\\" quote",\n  "version": "1.2.0"\n}\n';
  assert.strictEqual(M.spliceVersion('json', esc, '1.3.0').previous, '1.2.0');
});

test('spliceVersion json-lock: the first two root tokens change, nested dependency versions do not', () => {
  const text = '{\n  "name": "x",\n  "version": "1.2.0",\n  "packages": {\n    "": {\n      "version": "1.2.0"\n    },\n    "node_modules/y": {\n      "version": "1.2.0"\n    }\n  }\n}\n';
  const out = M.spliceVersion('json-lock', text, '1.3.0');
  assert.strictEqual((out.text.match(/1\.3\.0/g) || []).length, 2);
  assert.ok(out.text.includes('"node_modules/y": {\n      "version": "1.2.0"'));
  // lockfileVersion 1: no packages block — only the root token changes, never the first dependency's pin (ruling 9)
  const v1 = '{\n  "name": "x",\n  "version": "1.2.0",\n  "lockfileVersion": 1,\n  "dependencies": {\n    "y": {\n      "version": "1.2.0"\n    }\n  }\n}\n';
  const o1 = M.spliceVersion('json-lock', v1, '1.3.0');
  assert.strictEqual((o1.text.match(/1\.3\.0/g) || []).length, 1);
  assert.ok(o1.text.includes('"y": {\n      "version": "1.2.0"'));
  // a packages[""] entry without its own version must not leak the second splice into a dependency
  const noInner = '{\n  "version": "1.2.0",\n  "packages": {\n    "": {\n      "name": "x"\n    },\n    "node_modules/y": {\n      "version": "1.2.0"\n    }\n  }\n}\n';
  assert.strictEqual((M.spliceVersion('json-lock', noInner, '1.3.0').text.match(/1\.3\.0/g) || []).length, 1);
});

test('spliceVersion toml: the version under the named section, other sections untouched', () => {
  const text = '[build-system]\nversion = "0.0.1"\n\n[project]\nname = "x"\nversion = "1.2.0"   # keep comment\n\n[tool.poetry]\nversion = "1.2.0"\n';
  const out = M.spliceVersion('toml', text, '1.3.0', { sections: ['project', 'tool.poetry'] });
  assert.strictEqual(out.text, text.replace('version = "1.2.0"   # keep', 'version = "1.3.0"   # keep'));
  assert.strictEqual(out.previous, '1.2.0');
  const poetryOnly = '[tool.poetry]\nversion = "1.2.0"\n';
  assert.strictEqual(M.spliceVersion('toml', poetryOnly, '1.3.0', { sections: ['project', 'tool.poetry'] }).text, '[tool.poetry]\nversion = "1.3.0"\n');
  // TOML single quotes are literal strings, just as valid as double quotes
  assert.strictEqual(M.spliceVersion('toml', "[project]\nversion = '1.2.0'\n", '1.3.0', { sections: ['project'] }).text, "[project]\nversion = '1.3.0'\n");
  // setup.cfg's INI value is unquoted
  assert.strictEqual(M.spliceVersion('toml', '[metadata]\nname = x\nversion = 1.2.0\n', '1.3.0', { sections: ['metadata'], unquoted: true }).text, '[metadata]\nname = x\nversion = 1.3.0\n');
});

test('spliceVersion py-assign: the first quoted version= assignment in setup.py', () => {
  const setup = "from setuptools import setup\n\nsetup(\n    name='x',\n    version='1.2.0',\n    python_requires='>=3.8',\n)\n";
  const out = M.spliceVersion('py-assign', setup, '1.3.0');
  assert.strictEqual(out.text, setup.replace("'1.2.0'", "'1.3.0'"));
  assert.strictEqual(out.previous, '1.2.0');
  assert.strictEqual(M.spliceVersion('py-assign', 'setup(name="x", version="1.2.0")\n', '1.3.0').text, 'setup(name="x", version="1.3.0")\n');
  assert.strictEqual(M.spliceVersion('py-assign', 'setup(name="x")\n', '1.3.0').found, false);
});

test('spliceVersion py-assign / toml: an identifier ENDING in "version" is never the match', () => {
  const setup = 'min_version = "0.1.0"\npython_version = "3.8.0"\nsetup(\n    name="x",\n    version="1.2.0",\n)\n';
  const out = M.spliceVersion('py-assign', setup, '1.3.0');
  assert.strictEqual(out.previous, '1.2.0');
  assert.strictEqual(out.text, setup.replace('version="1.2.0"', 'version="1.3.0"'));
  assert.ok(out.text.includes('min_version = "0.1.0"') && out.text.includes('python_version = "3.8.0"'), out.text);
  // setup.cfg's [metadata] line is start-of-line anchored, so the same holds there
  const cfg = '[metadata]\nmin_version = 0.1.0\nversion = 1.2.0\n';
  assert.strictEqual(M.spliceVersion('toml', cfg, '1.3.0', { sections: ['metadata'], unquoted: true }).text, '[metadata]\nmin_version = 0.1.0\nversion = 1.3.0\n');
});

test('applyVersion python: setup.py alone is enough; no stack manifest at all throws BEFORE any write', () => {
  const t = M.resolveTargets({ releaseType: 'python', extraFiles: [] });
  const run = (store) => {
    const writes = [];
    M.applyVersion(t, '1.3.0', (p) => (p in store ? store[p] : null), (p, text) => { writes.push(p); store[p] = text; });
    return writes;
  };
  const setupOnly = { 'setup.py': "setup(version='1.2.0')\n" };
  assert.deepStrictEqual(run(setupOnly), ['setup.py']);
  assert.strictEqual(setupOnly['setup.py'], "setup(version='1.3.0')\n");
  const pyproject = { 'pyproject.toml': '[project]\nversion = "1.2.0"\n' };
  assert.deepStrictEqual(run(pyproject), ['pyproject.toml']);
  assert.strictEqual(pyproject['pyproject.toml'], '[project]\nversion = "1.3.0"\n');
  const cfgOnly = { 'setup.cfg': '[metadata]\nversion = 1.2.0\n' };
  assert.deepStrictEqual(run(cfgOnly), ['setup.cfg']);
  const writes = [];
  assert.throws(
    () => M.applyVersion(t, '1.3.0', () => null, (p) => writes.push(p)),
    (e) => e instanceof M.ManifestError && /no stack manifest carried a version token \(looked for pyproject\.toml, setup\.py, setup\.cfg\)/.test(e.message),
  );
  assert.deepStrictEqual(writes, []);
});

test('spliceVersion text/generic/manifest', () => {
  assert.deepStrictEqual(M.spliceVersion('text', '1.2.0\n', '1.3.0'), { text: '1.3.0\n', found: true, previous: '1.2.0' });
  assert.deepStrictEqual(M.spliceVersion('text', null, '1.3.0'), { text: '1.3.0\n', found: false, previous: null });
  const gen = 'FOO=1\nAPP_VERSION=1.2.0 # x-release-please-version\nOTHER=1.2.0\n';
  assert.strictEqual(M.spliceVersion('generic', gen, '1.3.0').text, 'FOO=1\nAPP_VERSION=1.3.0 # x-release-please-version\nOTHER=1.2.0\n');
  assert.strictEqual(M.spliceVersion('manifest', '{\n  ".": "1.2.0"\n}\n', '1.3.0').text, '{\n  ".": "1.3.0"\n}\n');
});

test('spliceVersion generic: EVERY annotated line is rewritten (release-please parity), unannotated lines are not', () => {
  const gen = 'A=1.2.0 # x-release-please-version\nB: 1.2.0 # x-release-please-version\nOTHER=1.2.0\n';
  const out = M.spliceVersion('generic', gen, '1.3.0');
  assert.strictEqual(out.text, 'A=1.3.0 # x-release-please-version\nB: 1.3.0 # x-release-please-version\nOTHER=1.2.0\n');
  assert.strictEqual(out.found, true);
  assert.strictEqual(out.previous, '1.2.0');
});

test('currentVersion / versionAtRef: manifest file first, then the stack manifest, null when nothing carries a version', () => {
  const t = M.resolveTargets({ releaseType: 'node', extraFiles: [] });
  assert.strictEqual(M.currentVersion(t, files({ '.release-please-manifest.json': '{".": "1.2.0"}', 'package.json': '{"version": "1.1.0"}' }).readFile), '1.2.0');
  assert.strictEqual(M.currentVersion(t, files({ 'package.json': '{"version": "1.1.0"}' }).readFile), '1.1.0');
  assert.strictEqual(M.currentVersion(t, files({}).readFile), null);
  const show = (p) => { if (p === 'package.json') return '{"version": "1.1.0"}'; throw new Error(`fatal: path '${p}' does not exist in 'main'`); };
  assert.strictEqual(M.versionAtRef(t, show), '1.1.0');
  const bad = () => { throw new Error('fatal: invalid object name'); };
  assert.throws(() => M.versionAtRef(t, bad), /invalid object name/);
});

test('applyVersion: writes only files that exist (optional targets skipped, text created), reports previous values', () => {
  const store = { 'package.json': '{"version": "1.2.0"}\n' };
  const writes = [];
  const t = M.resolveTargets({ releaseType: 'node', extraFiles: [] });
  const out = M.applyVersion(t, '1.3.0', (p) => (p in store ? store[p] : null), (p, text) => { writes.push(p); store[p] = text; });
  assert.deepStrictEqual(writes, ['package.json']);
  assert.deepStrictEqual(out, [{ path: 'package.json', previous: '1.2.0' }]);
  assert.strictEqual(store['package.json'], '{"version": "1.3.0"}\n');
  const simple = M.resolveTargets({ releaseType: 'simple', extraFiles: [] });
  const s2 = {}; const w2 = [];
  M.applyVersion(simple, '0.2.0', (p) => (p in s2 ? s2[p] : null), (p, text) => { w2.push(p); s2[p] = text; });
  assert.deepStrictEqual(w2, ['version.txt']);
  assert.strictEqual(s2['version.txt'], '0.2.0\n');
  assert.throws(() => M.applyVersion(t, '1.3.0', () => '{"name":"x"}', () => {}), /no version token/);
});

test('applyVersion: a one-of member present without a token is skipped when another member carries it, and nothing is written before a refusal', () => {
  const py = M.resolveTargets({ releaseType: 'python', extraFiles: [] });
  const store = { '.release-please-manifest.json': '{\n  ".": "1.2.0"\n}\n', 'pyproject.toml': '[tool.ruff]\nline-length = 100\n', 'setup.cfg': '[metadata]\nname = x\nversion = 1.2.0\n' };
  const writes = [];
  const out = M.applyVersion(py, '1.3.0', (p) => (p in store ? store[p] : null), (p, text) => { writes.push(p); store[p] = text; });
  assert.deepStrictEqual(writes, ['.release-please-manifest.json', 'setup.cfg']);
  assert.deepStrictEqual(out.map((w) => w.path), ['.release-please-manifest.json', 'setup.cfg']);
  assert.strictEqual(store['pyproject.toml'], '[tool.ruff]\nline-length = 100\n');
  // a present-but-tokenless non-one-of target still refuses, and refuses before any sibling write
  const node = M.resolveTargets({ releaseType: 'node', extraFiles: [] });
  const s2 = { '.release-please-manifest.json': '{\n  ".": "1.2.0"\n}\n', 'package.json': '{"name":"x"}\n' };
  const w2 = [];
  assert.throws(() => M.applyVersion(node, '1.3.0', (p) => (p in s2 ? s2[p] : null), (p, text) => { w2.push(p); s2[p] = text; }), /package\.json carries no version token/);
  assert.deepStrictEqual(w2, []);
});

test('applyVersion: an existing version.txt without a semver token refuses instead of silently shipping out of sync', () => {
  const simple = M.resolveTargets({ releaseType: 'simple', extraFiles: [] });
  const store = { 'version.txt': 'unreleased\n' };
  const writes = [];
  assert.throws(() => M.applyVersion(simple, '0.2.0', (p) => (p in store ? store[p] : null), (p, text) => { writes.push(p); store[p] = text; }), /version\.txt exists but carries no version token/);
  assert.deepStrictEqual(writes, []);
  const s2 = { 'version.txt': '0.1.0' };
  M.applyVersion(simple, '0.2.0', (p) => (p in s2 ? s2[p] : null), (p, text) => { s2[p] = text; });
  assert.strictEqual(s2['version.txt'], '0.2.0\n');
});
