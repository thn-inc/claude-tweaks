'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const M = require('../../../plugin/bin/lib/release-local/manifest.js');

const files = (map) => ({ readFile: (p) => (Object.prototype.hasOwnProperty.call(map, p) ? map[p] : null), map });
const config = (releaseType, extraFiles) => JSON.stringify({ packages: { '.': { 'release-type': releaseType, ...(extraFiles ? { 'extra-files': extraFiles } : {}) } } });

// #2791: real fixture files (not hand-typed minimal strings) for the three new
// stacks — a genuine multi-dependency pom.xml/build.gradle/csproj etc., the same
// shape a real project's manifest would carry, proving each splice is structural
// (finds the right token among several plausible false matches) rather than a
// first-occurrence accident that a one-line fixture couldn't expose.
const FIXTURES = path.join(__dirname, 'fixtures');
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

test('readConfig: null without a config, release-type + extra-files with one', () => {
  assert.strictEqual(M.readConfig(files({}).readFile), null);
  assert.deepStrictEqual(M.readConfig(files({ 'release-please-config.json': config('node') }).readFile),
    { releaseType: 'node', extraFiles: [], bumpMinorPreMajor: true, bumpPatchForMinorPreMajor: false });
  const ef = [{ type: 'json', path: 'plugin/.claude-plugin/plugin.json', jsonpath: '$.version' }];
  assert.deepStrictEqual(M.readConfig(files({ 'release-please-config.json': config('simple', ef) }).readFile).extraFiles, ef);
});

test('#2327: readConfig lifts bump-minor-pre-major/bump-patch-for-minor-pre-major, package-level over top-level, defaulting true/false', () => {
  const pkgLevel = JSON.stringify({ packages: { '.': { 'release-type': 'node', 'bump-minor-pre-major': false, 'bump-patch-for-minor-pre-major': true } } });
  assert.deepStrictEqual(M.readConfig(files({ 'release-please-config.json': pkgLevel }).readFile),
    { releaseType: 'node', extraFiles: [], bumpMinorPreMajor: false, bumpPatchForMinorPreMajor: true });
  const topLevel = JSON.stringify({ 'release-type': 'node', 'bump-minor-pre-major': false });
  assert.strictEqual(M.readConfig(files({ 'release-please-config.json': topLevel }).readFile).bumpMinorPreMajor, false);
  // Package-level wins over a conflicting top-level value.
  const both = JSON.stringify({ 'bump-minor-pre-major': false, packages: { '.': { 'release-type': 'node', 'bump-minor-pre-major': true } } });
  assert.strictEqual(M.readConfig(files({ 'release-please-config.json': both }).readFile).bumpMinorPreMajor, true);
});

test('#2327: readBumpFlags never throws — absent file, malformed JSON, and a readFile that throws all default true/false', () => {
  assert.deepStrictEqual(M.readBumpFlags(files({}).readFile), { bumpMinorPreMajor: true, bumpPatchForMinorPreMajor: false });
  assert.deepStrictEqual(M.readBumpFlags(files({ 'release-please-config.json': '{ not json' }).readFile), { bumpMinorPreMajor: true, bumpPatchForMinorPreMajor: false });
  assert.deepStrictEqual(M.readBumpFlags(() => { throw new Error('EISDIR'); }), { bumpMinorPreMajor: true, bumpPatchForMinorPreMajor: false });
  const cfg = JSON.stringify({ packages: { '.': { 'release-type': 'node', 'bump-patch-for-minor-pre-major': true } } });
  assert.deepStrictEqual(M.readBumpFlags(files({ 'release-please-config.json': cfg }).readFile), { bumpMinorPreMajor: true, bumpPatchForMinorPreMajor: true });
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
  // #2791: java/ruby/dotnet now resolve like python's own multi-candidate stacks —
  // every member optional, present regardless of whether listRoot finds a file for
  // the fixed-name ones (existence is an applyVersion-time question, not a resolve-time one).
  assert.deepStrictEqual(M.resolveTargets({ releaseType: 'java', extraFiles: [] }).map((t) => [t.path, t.kind, t.optional]),
    [['.release-please-manifest.json', 'manifest', true], ['pom.xml', 'maven', true], ['build.gradle', 'gradle', true], ['build.gradle.kts', 'gradle', true]]);
  assert.throws(() => M.resolveTargets({ releaseType: 'simple', extraFiles: [{ type: 'yaml', path: 'x.yml' }] }), /yaml/);
  assert.throws(() => M.resolveTargets({ releaseType: 'simple', extraFiles: [{ type: 'json', path: 'p.json', jsonpath: '$.nested.version' }] }), /jsonpath/);
});

test('#2791: UNSUPPORTED is now empty (java/ruby/dotnet supported), but the exit-2 mechanism it drives is intact for whatever is added to it next', () => {
  assert.strictEqual(M.UNSUPPORTED.size, 0);
  M.UNSUPPORTED.add('cobol');
  try {
    assert.throws(() => M.resolveTargets({ releaseType: 'cobol', extraFiles: [] }),
      (e) => e instanceof M.ManifestError && /cobol/.test(e.message) && /simple/.test(e.message) && /extra-files/.test(e.message));
  } finally {
    M.UNSUPPORTED.delete('cobol');
  }
});

test('#2791: resolveTargets glob targets (ruby *.gemspec, dotnet *.csproj) resolve the actual filename against listRoot', () => {
  // ruby: version.rb is a fixed-name candidate present regardless of listRoot;
  // *.gemspec resolves to the one real match.
  const rubyOne = M.resolveTargets({ releaseType: 'ruby', extraFiles: [] }, { listRoot: () => ['foo.gemspec', 'Gemfile', 'README.md'] });
  assert.deepStrictEqual(rubyOne.map((t) => [t.path, t.kind]),
    [['.release-please-manifest.json', 'manifest'], ['version.rb', 'ruby-assign'], ['foo.gemspec', 'gemspec']]);
  // Zero matches: the glob row drops out entirely, the fixed-name row stays.
  const rubyNone = M.resolveTargets({ releaseType: 'ruby', extraFiles: [] }, { listRoot: () => ['Gemfile'] });
  assert.deepStrictEqual(rubyNone.map((t) => t.path), ['.release-please-manifest.json', 'version.rb']);
  // Ambiguous (2+ matches): dropped the same way, not an error — a multi-project
  // root is out of this root-only engine's scope, same posture as a genuinely
  // absent candidate.
  const rubyAmbiguous = M.resolveTargets({ releaseType: 'ruby', extraFiles: [] }, { listRoot: () => ['a.gemspec', 'b.gemspec'] });
  assert.deepStrictEqual(rubyAmbiguous.map((t) => t.path), ['.release-please-manifest.json', 'version.rb']);
  // No listRoot passed at all (existing callers/tests never had to know about this) —
  // every glob candidate resolves as absent, never throws.
  assert.deepStrictEqual(M.resolveTargets({ releaseType: 'ruby', extraFiles: [] }).map((t) => t.path), ['.release-please-manifest.json', 'version.rb']);

  const dotnetOne = M.resolveTargets({ releaseType: 'dotnet', extraFiles: [] }, { listRoot: () => ['MyApp.csproj'] });
  assert.deepStrictEqual(dotnetOne.map((t) => [t.path, t.kind]),
    [['.release-please-manifest.json', 'manifest'], ['MyApp.csproj', 'csproj'], ['AssemblyInfo.cs', 'assembly-info']]);
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

test('#2791: spliceVersion maven — the project\'s own <version>, never the <parent> block\'s or a dependency\'s', () => {
  const pom = readFixture('pom.xml');
  const out = M.spliceVersion('maven', pom, '1.5.0');
  assert.strictEqual(out.previous, '1.4.2');
  assert.strictEqual(out.found, true);
  // Exactly one token changed — the project's own <version>1.4.2</version>, immediately
  // after <artifactId>widget-service</artifactId>.
  assert.strictEqual(out.text, pom.replace('<artifactId>widget-service</artifactId>\n  <version>1.4.2</version>', '<artifactId>widget-service</artifactId>\n  <version>1.5.0</version>'));
  // The parent's version (3.2.5) and the dependency's (0.9.1) and the plugin's (3.2.5) survive untouched.
  assert.ok(out.text.includes('<version>3.2.5</version>') && out.text.includes('<version>0.9.1</version>'), out.text);
  assert.strictEqual((out.text.match(/<version>3\.2\.5<\/version>/g) || []).length, 2, 'both parent and plugin 3.2.5 tokens remain');
});

test('#2791: spliceVersion gradle — Groovy build.gradle and Kotlin build.gradle.kts, dependency coordinates untouched', () => {
  const groovy = readFixture('build.gradle');
  const outGroovy = M.spliceVersion('gradle', groovy, '1.5.0');
  assert.strictEqual(outGroovy.previous, '1.4.2');
  assert.strictEqual(outGroovy.text, groovy.replace("version = '1.4.2'", "version = '1.5.0'"));
  assert.ok(outGroovy.text.includes("implementation 'com.example:widget-common:0.9.1'"), 'dependency coordinate version untouched');

  const kts = readFixture('build.gradle.kts');
  const outKts = M.spliceVersion('gradle', kts, '1.5.0');
  assert.strictEqual(outKts.previous, '1.4.2');
  assert.strictEqual(outKts.text, kts.replace('version = "1.4.2"', 'version = "1.5.0"'));
  assert.ok(outKts.text.includes('implementation("com.example:widget-common:0.9.1")'), 'dependency coordinate version untouched');
});

test('#2791: spliceVersion ruby-assign (version.rb) and gemspec — the inline assignment, not the required-file dependency versions', () => {
  const versionRb = readFixture('version.rb');
  const outRb = M.spliceVersion('ruby-assign', versionRb, '1.5.0');
  assert.strictEqual(outRb.previous, '1.4.2');
  assert.strictEqual(outRb.text, versionRb.replace('VERSION = "1.4.2"', 'VERSION = "1.5.0"'));

  const gemspec = readFixture('widget.gemspec');
  const outGemspec = M.spliceVersion('gemspec', gemspec, '1.5.0');
  assert.strictEqual(outGemspec.previous, '1.4.2');
  assert.strictEqual(outGemspec.text, gemspec.replace('spec.version       = "1.4.2"', 'spec.version       = "1.5.0"'));
  assert.ok(outGemspec.text.includes('spec.add_dependency "activesupport", ">= 6.0"'), 'dependency constraint untouched');

  // A gemspec that references a VERSION constant instead of a literal carries no
  // token here at all — version.rb is the sibling target that has it.
  const constRef = 'Gem::Specification.new do |spec|\n  spec.version = Widget::Gem::VERSION\nend\n';
  assert.strictEqual(M.spliceVersion('gemspec', constRef, '1.5.0').found, false);
});

test('#2791: spliceVersion csproj and assembly-info — the PropertyGroup <Version>/assembly attributes, not a PackageReference', () => {
  const csproj = readFixture('widget.csproj');
  const outCsproj = M.spliceVersion('csproj', csproj, '1.5.0');
  assert.strictEqual(outCsproj.previous, '1.4.2');
  assert.strictEqual(outCsproj.text, csproj.replace('<Version>1.4.2</Version>', '<Version>1.5.0</Version>'));
  // The PackageReference's Version="13.0.3" ATTRIBUTE is a different syntactic shape
  // (attribute, not an element) and is never touched.
  assert.ok(outCsproj.text.includes('Version="13.0.3"'), 'PackageReference attribute version untouched');

  const assemblyInfo = readFixture('AssemblyInfo.cs');
  const outAssembly = M.spliceVersion('assembly-info', assemblyInfo, '1.5.0');
  assert.strictEqual(outAssembly.previous, '1.4.2');
  assert.strictEqual(outAssembly.text, assemblyInfo
    .replace('AssemblyVersion("1.4.2.0")', 'AssemblyVersion("1.5.0.0")')
    .replace('AssemblyFileVersion("1.4.2.0")', 'AssemblyFileVersion("1.5.0.0")'));
  // Both attributes moved, and each kept its own trailing .0 revision component.
  assert.ok(outAssembly.text.includes('AssemblyVersion("1.5.0.0")') && outAssembly.text.includes('AssemblyFileVersion("1.5.0.0")'));
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
