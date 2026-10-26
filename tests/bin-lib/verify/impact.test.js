'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  IMPACT_MAP_VERSION, DEFAULT_MAP_NAME, KINDS,
  encodeImpactMap, parseImpactMap, under, selectImpactTests, mapProblem,
  resolveMapPath, gitLocations, loadImpactContext, lazyImpactContext,
} = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'impact.js'));

const SHA = '0123456789abcdef0123456789abcdef01234567';

const isTestFile = (p) => p.endsWith('.test.js');

// Builds a parsed map straight from path-form tests, through the real codec.
function mapOf(tests, extra = {}) {
  const encoded = encodeImpactMap({ commit: SHA, tracedAt: '2026-10-24T00:00:00Z', exitCode: 0, node: 'v22.0.0', tests, ...extra });
  const parsed = parseImpactMap(JSON.stringify(encoded));
  assert.strictEqual(parsed.ok, true, parsed.reason);
  return parsed.map;
}

function select(tests, changed, headTests) {
  const map = mapOf(tests);
  return selectImpactTests({ map, changed, headTests: headTests || Object.keys(tests), isTestFile });
}

test('constants', () => {
  assert.strictEqual(IMPACT_MAP_VERSION, 1);
  assert.strictEqual(DEFAULT_MAP_NAME, 'claude-tweaks-test-impact.json');
  assert.deepStrictEqual(KINDS, ['f', 's', 'd', 'c']);
});

test('encode/parse round-trips', () => {
  const tests = {
    'tests/b.test.js': { f: ['src/y.js', 'src/x.js', 'src/x.js'], s: [], d: ['src'], c: [] },
    'tests/a.test.js': { f: ['src/x.js'], s: ['cfg.json'], d: [], c: [''] },
  };
  const encoded = encodeImpactMap({ commit: SHA, tracedAt: 't0', exitCode: 0, node: 'v22.0.0', tests });
  // Interned + deterministic: sorted unique paths, sorted index lists, empty kinds omitted, sorted test keys.
  assert.deepStrictEqual(encoded, {
    version: 1, commit: SHA, tracedAt: 't0', exitCode: 0, node: 'v22.0.0',
    paths: ['', 'cfg.json', 'src', 'src/x.js', 'src/y.js'],
    tests: {
      'tests/a.test.js': { f: [3], s: [1], c: [0] },
      'tests/b.test.js': { f: [3, 4], d: [2] },
    },
  });
  assert.deepStrictEqual(Object.keys(encoded.tests), ['tests/a.test.js', 'tests/b.test.js']);
  assert.strictEqual(JSON.stringify(encodeImpactMap({ commit: SHA, tracedAt: 't0', exitCode: 0, node: 'v22.0.0', tests })), JSON.stringify(encoded));

  const parsed = parseImpactMap(JSON.stringify(encoded));
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.map.commit, SHA);
  assert.strictEqual(parsed.map.exitCode, 0);
  assert.deepStrictEqual(parsed.map.tests, {
    'tests/a.test.js': { f: ['src/x.js'], s: ['cfg.json'], d: [], c: [''] },
    'tests/b.test.js': { f: ['src/x.js', 'src/y.js'], s: [], d: ['src'], c: [] },
  });
});

test('AC1.1: a dirty map parses with dirty: true; a clean or older map with dirty: false', () => {
  const tests = { 'tests/a.test.js': { f: ['src/x.js'] } };
  const enc = (extra) => encodeImpactMap({ commit: SHA, tracedAt: 't', exitCode: 0, node: 'v', tests, ...extra });
  assert.strictEqual(enc({ dirty: true }).dirty, true);
  assert.strictEqual(enc({ dirty: false }).dirty, false);
  assert.strictEqual(Object.hasOwn(enc({}), 'dirty'), false);
  assert.strictEqual(parseImpactMap(JSON.stringify(enc({ dirty: true }))).map.dirty, true);
  assert.strictEqual(parseImpactMap(JSON.stringify(enc({ dirty: false }))).map.dirty, false);
  assert.strictEqual(parseImpactMap(JSON.stringify(enc({}))).map.dirty, false);
  for (const dirty of ['true', 1, null, 0]) {
    assert.deepStrictEqual(parseImpactMap(JSON.stringify({ ...enc({}), dirty })), { ok: false, reason: 'bad-shape' }, String(dirty));
  }
});

test('AC1.2: the v1 reader shipped before the dirty field still parses dirty and clean maps', () => {
  const v1 = require(path.join(__dirname, '..', '..', 'fixtures', 'test-impact', 'parse-impact-map-v1.js'));
  for (const dirty of [true, false, undefined]) {
    const text = JSON.stringify(encodeImpactMap({ commit: SHA, tracedAt: 't', exitCode: 0, node: 'v', tests: { 'tests/a.test.js': { f: ['src/x.js'] } }, dirty }));
    if (dirty !== undefined) assert.strictEqual(JSON.parse(text).dirty, dirty);
    const parsed = v1.parseImpactMap(text);
    assert.strictEqual(parsed.ok, true, `dirty ${dirty}: ${parsed.reason}`);
    assert.deepStrictEqual(parsed.map.tests['tests/a.test.js'].f, ['src/x.js']);
  }
});

test('a traced test that read nothing is kept (it is traced, not untraced)', () => {
  const encoded = encodeImpactMap({ commit: SHA, tracedAt: 't', exitCode: 0, node: 'v', tests: { 'tests/z.test.js': {} } });
  assert.deepStrictEqual(encoded.tests, { 'tests/z.test.js': {} });
  const parsed = parseImpactMap(JSON.stringify(encoded));
  assert.deepStrictEqual(parsed.map.tests, { 'tests/z.test.js': { f: [], s: [], d: [], c: [] } });
});

test('parseImpactMap rejects bad input with the named reason', () => {
  const good = encodeImpactMap({ commit: SHA, tracedAt: 't', exitCode: 0, node: 'v', tests: { 'tests/a.test.js': { f: ['src/x.js'] } } });
  const withField = (patch) => JSON.stringify({ ...good, ...patch });
  const cases = [
    ['{', 'unparseable'],
    ['', 'unparseable'],
    ['null', 'bad-shape'],
    ['[]', 'bad-shape'],
    ['42', 'bad-shape'],
    ['"x"', 'bad-shape'],
    [withField({ version: 2 }), 'wrong-version'],
    [withField({ version: undefined }), 'wrong-version'],
    [withField({ commit: 'abc' }), 'bad-commit'],
    [withField({ commit: SHA.toUpperCase() }), 'bad-commit'],
    [withField({ exitCode: '0' }), 'bad-shape'],
    [withField({ exitCode: 0.5 }), 'bad-shape'],
    [withField({ exitCode: undefined }), 'bad-shape'],
    [withField({ paths: 'src/x.js' }), 'bad-shape'],
    [withField({ paths: [1] }), 'bad-shape'],
    [withField({ tests: null }), 'bad-shape'],
    [withField({ tests: [] }), 'bad-shape'],
    [withField({ tests: { 'tests/a.test.js': null } }), 'bad-shape'],
    [withField({ tests: { 'tests/a.test.js': { f: [99] } } }), 'bad-shape'],
    [withField({ tests: { 'tests/a.test.js': { f: [-1] } } }), 'bad-shape'],
    [withField({ tests: { 'tests/a.test.js': { f: [0.5] } } }), 'bad-shape'],
    [withField({ tests: { 'tests/a.test.js': { f: ['0'] } } }), 'bad-shape'],
    [withField({ tests: { 'tests/a.test.js': { f: 0 } } }), 'bad-shape'],
    [withField({ tests: { 'tests/a.test.js': { x: [0] } } }), 'bad-shape'],
  ];
  for (const [text, reason] of cases) {
    assert.deepStrictEqual(parseImpactMap(text), { ok: false, reason }, `input: ${text}`);
  }
  // The brief's literal case: an index 99 with one path.
  const one = JSON.stringify({ version: 1, commit: SHA, tracedAt: 't', exitCode: 0, node: 'v', paths: ['src/x.js'], tests: { 't.test.js': { f: [99] } } });
  assert.deepStrictEqual(parseImpactMap(one), { ok: false, reason: 'bad-shape' });
});

test('under: root prefix, exact path, beneath only', () => {
  assert.strictEqual(under('a/b.js', ''), true);
  assert.strictEqual(under('a', 'a'), true);
  assert.strictEqual(under('a/b.js', 'a'), true);
  assert.strictEqual(under('ab/c.js', 'a'), false);
  assert.strictEqual(under('a', 'a/b'), false);
});

const XMAP = {
  'tests/a.test.js': { f: ['src/x.js'] },
  'tests/b.test.js': { s: ['src/x.js'], d: ['src'] },
};

test('M selects only content readers', () => {
  const r = select(XMAP, [{ path: 'src/x.js', status: 'M' }]);
  assert.deepStrictEqual(r, { ok: true, tests: ['tests/a.test.js'], matched: ['tests/a.test.js'], changedTests: [], untracedTests: [], driftTests: [] });
});

test('A selects existence and listing readers (AC3.1)', () => {
  const r = select(XMAP, [{ path: 'src/x.js', status: 'A' }]);
  assert.deepStrictEqual(r.tests, ['tests/a.test.js', 'tests/b.test.js']);
  // Listing alone (d) is enough for an added file: the s entry is not needed.
  const listingOnly = select({ 'tests/b.test.js': { d: ['src'] } }, [{ path: 'src/new.js', status: 'A' }]);
  assert.deepStrictEqual(listingOnly.tests, ['tests/b.test.js']);
});

test('D selects existence and listing readers', () => {
  const r = select(XMAP, [{ path: 'src/x.js', status: 'D' }]);
  assert.deepStrictEqual(r.tests, ['tests/a.test.js', 'tests/b.test.js']);
});

test('M does not select an existence probe or a listing', () => {
  const r = select({ 'tests/b.test.js': { s: ['src/x.js'], d: ['src'] } }, [{ path: 'src/x.js', status: 'M' }]);
  assert.deepStrictEqual(r, { ok: false, reason: 'untraced-path: src/x.js' });
});

test('c prefix selects on any status, including prefix \'\'', () => {
  for (const status of ['A', 'M', 'D']) {
    const r = select({ 'tests/a.test.js': { c: ['src'] }, 'tests/r.test.js': { c: [''] } }, [{ path: 'src/deep/x.js', status }]);
    assert.deepStrictEqual(r.tests, ['tests/a.test.js', 'tests/r.test.js'], status);
    const rootOnly = select({ 'tests/r.test.js': { c: [''] } }, [{ path: 'README.md', status }]);
    assert.deepStrictEqual(rootOnly.tests, ['tests/r.test.js'], status);
  }
});

test('a directory read matches only beneath it', () => {
  const r = select({ 'tests/a.test.js': { d: ['plugin/skills'] } }, [{ path: 'plugin/skillsX/a.md', status: 'A' }]);
  assert.deepStrictEqual(r, { ok: false, reason: 'untraced-path: plugin/skillsX/a.md' });
  const beneath = select({ 'tests/a.test.js': { d: ['plugin/skills'] } }, [{ path: 'plugin/skills/a.md', status: 'A' }]);
  assert.deepStrictEqual(beneath.tests, ['tests/a.test.js']);
});

test('changed test files are selected directly', () => {
  // A new test absent from the map, present at HEAD: selected, never untraced-path.
  const added = select(XMAP, [{ path: 'tests/new.test.js', status: 'A' }], ['tests/a.test.js', 'tests/b.test.js', 'tests/new.test.js']);
  assert.strictEqual(added.ok, true);
  assert.deepStrictEqual(added.changedTests, ['tests/new.test.js']);
  assert.ok(added.tests.includes('tests/new.test.js'));
  // A modified test in the map is selected as a changed test.
  const modified = select(XMAP, [{ path: 'tests/a.test.js', status: 'M' }]);
  assert.deepStrictEqual(modified, { ok: true, tests: ['tests/a.test.js'], matched: [], changedTests: ['tests/a.test.js'], untracedTests: [], driftTests: [] });
  // A deleted test (absent from headTests) is not selected and does not fail closed.
  const deleted = select(XMAP, [{ path: 'tests/b.test.js', status: 'D' }], ['tests/a.test.js']);
  assert.deepStrictEqual(deleted, { ok: true, tests: [], matched: [], changedTests: [], untracedTests: [], driftTests: [] });
});

test('a changed test file also selects the other tests that read it', () => {
  const meta = {
    'tests/a.test.js': { f: ['src/x.js'] },
    'tests/meta-read.test.js': { f: ['tests/a.test.js'] },
    'tests/meta-list.test.js': { d: ['tests'] },
  };
  // Modified: the content reader (f) is selected; the listing (d) is not.
  const modified = select(meta, [{ path: 'tests/a.test.js', status: 'M' }]);
  assert.deepStrictEqual(modified, {
    ok: true, tests: ['tests/a.test.js', 'tests/meta-read.test.js'], matched: ['tests/meta-read.test.js'], changedTests: ['tests/a.test.js'], untracedTests: [], driftTests: [],
  });
  // Added: the listing of tests (d) is selected alongside the new test itself.
  const head = [...Object.keys(meta), 'tests/new.test.js'];
  const added = select(meta, [{ path: 'tests/new.test.js', status: 'A' }], head);
  assert.deepStrictEqual(added, {
    ok: true, tests: ['tests/meta-list.test.js', 'tests/new.test.js'], matched: ['tests/meta-list.test.js'], changedTests: ['tests/new.test.js'], untracedTests: ['tests/new.test.js'], driftTests: [],
  });
  // A test that reads itself is a changed test, not its own matched reader.
  const self = select({ 'tests/s.test.js': { f: ['tests/s.test.js'] } }, [{ path: 'tests/s.test.js', status: 'M' }]);
  assert.deepStrictEqual(self, { ok: true, tests: ['tests/s.test.js'], matched: [], changedTests: ['tests/s.test.js'], untracedTests: [], driftTests: [] });
});

test('A/D reach an f or s entry on an ancestor directory; M does not; \'\' never counts', () => {
  const probe = { 'tests/p.test.js': { s: ['plugin/skills/foo'] }, 'tests/st.test.js': { f: ['plugin/skills/foo'] } };
  for (const status of ['A', 'D']) {
    const r = select(probe, [{ path: 'plugin/skills/foo/SKILL.md', status }]);
    assert.deepStrictEqual(r.tests, ['tests/p.test.js', 'tests/st.test.js'], status);
  }
  const modified = select(probe, [{ path: 'plugin/skills/foo/SKILL.md', status: 'M' }]);
  assert.deepStrictEqual(modified, { ok: false, reason: 'untraced-path: plugin/skills/foo/SKILL.md' });
  // A sibling sharing the name prefix is not beneath the entry.
  const sibling = select(probe, [{ path: 'plugin/skills/foobar/SKILL.md', status: 'A' }]);
  assert.deepStrictEqual(sibling, { ok: false, reason: 'untraced-path: plugin/skills/foobar/SKILL.md' });
  // An exists/stat of the repo root never changes existence.
  const root = select({ 'tests/r.test.js': { s: [''], f: [''] } }, [{ path: 'README.md', status: 'A' }]);
  assert.deepStrictEqual(root, { ok: false, reason: 'untraced-path: README.md' });
});

test('untraced tests at HEAD are selected', () => {
  const r = select(XMAP, [{ path: 'src/x.js', status: 'M' }], ['tests/a.test.js', 'tests/b.test.js', 'tests/new.test.js']);
  assert.deepStrictEqual(r, {
    ok: true, tests: ['tests/a.test.js', 'tests/new.test.js'], matched: ['tests/a.test.js'], changedTests: [], untracedTests: ['tests/new.test.js'], driftTests: [],
  });
});

test('drifted tests the map knows and HEAD still has are selected as untraced (#4132)', () => {
  const head = ['tests/a.test.js', 'tests/b.test.js', 'tests/new.test.js'];
  const r = selectImpactTests({
    map: mapOf(XMAP), changed: [{ path: 'src/x.js', status: 'M' }], headTests: head, isTestFile,
    driftTests: ['tests/b.test.js', 'tests/new.test.js', 'tests/gone.test.js'],
  });
  // b: known + at HEAD → drift. new: unknown → untraced only. gone: absent at HEAD → never selected.
  assert.deepStrictEqual(r, {
    ok: true, tests: ['tests/a.test.js', 'tests/b.test.js', 'tests/new.test.js'], matched: ['tests/a.test.js'],
    changedTests: [], untracedTests: ['tests/new.test.js'], driftTests: ['tests/b.test.js'],
  });
  // Go-red control: without the drift input b is not selected.
  assert.deepStrictEqual(
    selectImpactTests({ map: mapOf(XMAP), changed: [{ path: 'src/x.js', status: 'M' }], headTests: head, isTestFile }).tests,
    ['tests/a.test.js', 'tests/new.test.js'],
  );
});

test('a changed test that is also in the drift input is not counted as drift-selected (#4132)', () => {
  const head = ['tests/a.test.js', 'tests/b.test.js'];
  const r = selectImpactTests({
    map: mapOf(XMAP), changed: [{ path: 'tests/a.test.js', status: 'M' }], headTests: head, isTestFile,
    driftTests: ['tests/a.test.js'],
  });
  // a is the branch's own edit: the changed set already selects it, so drift selected nothing.
  assert.deepStrictEqual(r, {
    ok: true, tests: ['tests/a.test.js'], matched: [], changedTests: ['tests/a.test.js'], untracedTests: [], driftTests: [],
  });
});

test('untraced path fails closed', () => {
  const r = select(XMAP, [{ path: 'src/nobody.js', status: 'M' }]);
  assert.deepStrictEqual(r, { ok: false, reason: 'untraced-path: src/nobody.js' });
  // Several untraced paths: the reason names the first in sorted order, and a selecting path does not mask them.
  const many = select(XMAP, [
    { path: 'src/zz.js', status: 'M' }, { path: 'src/x.js', status: 'M' }, { path: 'src/aa.js', status: 'M' },
  ]);
  assert.deepStrictEqual(many, { ok: false, reason: 'untraced-path: src/aa.js' });
});

test('a map reader no longer present at HEAD is not selected', () => {
  const r = select(XMAP, [{ path: 'src/x.js', status: 'A' }], ['tests/a.test.js']);
  assert.deepStrictEqual(r, { ok: true, tests: ['tests/a.test.js'], matched: ['tests/a.test.js'], changedTests: [], untracedTests: [], driftTests: [] });
});

test('result tests are the sorted unique union', () => {
  const r = select(XMAP, [{ path: 'src/x.js', status: 'D' }, { path: 'tests/a.test.js', status: 'M' }], ['tests/b.test.js', 'tests/a.test.js', 'tests/c.test.js']);
  assert.deepStrictEqual(r, {
    ok: true,
    tests: ['tests/a.test.js', 'tests/b.test.js', 'tests/c.test.js'],
    matched: ['tests/a.test.js', 'tests/b.test.js'],
    changedTests: ['tests/a.test.js'],
    untracedTests: ['tests/c.test.js'],
    driftTests: [],
  });
});

test('discrimination (AC4.1 AC4.2)', () => {
  const changed = [{ path: 'src/x.js', status: 'M' }];
  const both = { 'tests/a.test.js': { f: ['src/x.js'] }, 'tests/b.test.js': { f: ['src/x.js'] } };
  assert.deepStrictEqual(select(both, changed).tests, ['tests/a.test.js', 'tests/b.test.js']);
  // Remove src/x.js from b's f: b is deselected.
  const without = { 'tests/a.test.js': { f: ['src/x.js'] }, 'tests/b.test.js': { f: [] } };
  assert.deepStrictEqual(select(without, changed).tests, ['tests/a.test.js']);
  // Restore it: b is reselected.
  const restored = { ...without, 'tests/b.test.js': { f: ['src/x.js'] } };
  assert.deepStrictEqual(select(restored, changed).tests, ['tests/a.test.js', 'tests/b.test.js']);
});

test('mapProblem', () => {
  const ok = parseImpactMap(JSON.stringify(encodeImpactMap({ commit: SHA, tracedAt: 't', exitCode: 0, node: 'v', tests: {} })));
  const failing = parseImpactMap(JSON.stringify(encodeImpactMap({ commit: SHA, tracedAt: 't', exitCode: 1, node: 'v', tests: {} })));
  const dirtyOk = parseImpactMap(JSON.stringify(encodeImpactMap({ commit: SHA, tracedAt: 't', exitCode: 0, node: 'v', tests: {}, dirty: true })));
  const base = { parsed: ok, isAncestor: true, distance: 3, maxAgeCommits: 50 };
  const cases = [
    [{ ...base, parsed: dirtyOk }, 'map-dirty'],
    [{ ...base, parsed: dirtyOk, isAncestor: false }, 'map-dirty'],
    [{ ...base, parsed: null }, 'map-missing'],
    [{ ...base, parsed: parseImpactMap('{') }, 'map-invalid: unparseable'],
    [{ ...base, parsed: { ok: false, reason: 'bad-commit' } }, 'map-invalid: bad-commit'],
    [{ ...base, parsed: failing }, 'map-from-failing-suite'],
    [{ ...base, isAncestor: false }, 'map-not-ancestor'],
    [{ ...base, distance: 51 }, 'map-stale: 51 commits > 50'],
    [base, null],
    [{ ...base, distance: 50 }, null],
    [{ ...base, distance: 0 }, null],
  ];
  for (const [input, expected] of cases) {
    assert.strictEqual(mapProblem(input), expected, JSON.stringify(input));
  }
});

test('mapProblem: a distance that is not an integer never reads as fresh', () => {
  const ok = parseImpactMap(JSON.stringify(encodeImpactMap({ commit: SHA, tracedAt: 't', exitCode: 0, node: 'v', tests: {} })));
  for (const distance of [undefined, null, NaN, 1.5, '3']) {
    assert.strictEqual(mapProblem({ parsed: ok, isAncestor: true, distance, maxAgeCommits: 50 }), 'map-stale: unknown commits > 50', String(distance));
  }
});

// I/O helpers (#4024): a fake git runner keyed on the subcommand, and a fake fs.
const ROOT = path.join(path.sep, 'repo');
const COMMON = path.join(ROOT, '.git');
const MAP_PATH = path.join(COMMON, DEFAULT_MAP_NAME);
const declOf = (impact = {}) => ({
  impact: { suite: 'tests', command: 'run {files}', tests: ['tests/**/*.test.js'], maxAgeCommits: 5, map: null, fetch: null, ...impact },
});
const mapText = (extra = {}) => JSON.stringify(encodeImpactMap({
  commit: SHA, tracedAt: 't', exitCode: 0, node: 'v', tests: { 'tests/a.test.js': { f: ['src/x.js'] } }, ...extra,
}));

function fakeGit(overrides = {}) {
  const calls = [];
  const handlers = {
    'ls-files': () => 'tests/a.test.js\0tests/b.test.js\0src/x.js\0tests/gone.test.js\0tests/a.test.js\0',
    'merge-base': () => '',
    'rev-list': () => '2\n',
    diff: () => '',
    ...overrides,
  };
  const execImpl = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const h = handlers[args[0]];
    if (!h) throw new Error(`unexpected git ${args.join(' ')}`);
    return h(args);
  };
  return { execImpl, calls };
}

function fakeFs(files) {
  return {
    readFileSync(p) {
      if (Object.hasOwn(files, p)) {
        if (files[p] instanceof Error) throw files[p];
        return files[p];
      }
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    },
    // Only a.test.js and b.test.js are on disk; gone.test.js is tracked but deleted.
    lstatSync(p) {
      if (!p.endsWith('a.test.js') && !p.endsWith('b.test.js')) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false };
    },
  };
}

test('resolveMapPath: default, {git-common-dir}/ expansion, and a repo-relative path', () => {
  assert.strictEqual(resolveMapPath({ decl: declOf(), commonDir: COMMON, repoRoot: ROOT }), MAP_PATH);
  assert.strictEqual(resolveMapPath({ decl: declOf({ map: '{git-common-dir}/maps/m.json' }), commonDir: COMMON, repoRoot: ROOT }), path.join(COMMON, 'maps', 'm.json'));
  assert.strictEqual(resolveMapPath({ decl: declOf({ map: 'build/m.json' }), commonDir: COMMON, repoRoot: ROOT }), path.join(ROOT, 'build', 'm.json'));
});

test('gitLocations: resolves a relative common dir against the cwd; null when git fails', () => {
  const { execImpl, calls } = fakeGit({ 'rev-parse': (args) => (args.includes('--show-toplevel') ? `${ROOT}\n` : '.git\n') });
  assert.deepStrictEqual(gitLocations({ cwd: ROOT, execImpl }), { repoRoot: ROOT, commonDir: COMMON });
  for (const c of calls) {
    assert.deepStrictEqual(c.opts.stdio, ['ignore', 'pipe', 'pipe']);
    assert.strictEqual(c.opts.windowsHide, true);
    assert.strictEqual(c.opts.cwd, ROOT);
  }
  const failing = fakeGit({ 'rev-parse': () => { throw new Error('not a repo'); } });
  assert.strictEqual(gitLocations({ cwd: ROOT, execImpl: failing.execImpl }), null);
});

test('loadImpactContext: a fresh map loads, with every matching test present at HEAD', () => {
  const { execImpl, calls } = fakeGit();
  const ctx = loadImpactContext({ decl: declOf(), repoRoot: ROOT, commonDir: COMMON, execImpl, fsImpl: fakeFs({ [MAP_PATH]: mapText() }) });
  assert.strictEqual(ctx.problem, null);
  assert.strictEqual(ctx.map.commit, SHA);
  assert.deepStrictEqual(ctx.headTests, ['tests/a.test.js', 'tests/b.test.js'], 'glob-filtered, on disk, deduplicated');
  assert.strictEqual(ctx.mapPath, MAP_PATH);
  assert.strictEqual(ctx.mapCommit, SHA);
  assert.strictEqual(ctx.mapDirty, false);
  assert.strictEqual(ctx.distance, 2);
  assert.strictEqual(ctx.fetch, null);
  const byCmd = Object.fromEntries(calls.map((c) => [c.args[0], c]));
  assert.deepStrictEqual(byCmd['ls-files'].args, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  assert.deepStrictEqual(byCmd['merge-base'].args, ['merge-base', '--is-ancestor', '--end-of-options', SHA, 'HEAD']);
  assert.deepStrictEqual(byCmd['rev-list'].args, ['rev-list', '--count', '--end-of-options', `${SHA}..HEAD`]);
  for (const c of calls) {
    assert.strictEqual(c.opts.cwd, ROOT);
    assert.strictEqual(c.opts.windowsHide, true);
  }
});

test('loadImpactContext: driftTests are the test-glob files differing between the map commit and HEAD (#4132)', () => {
  const { execImpl, calls } = fakeGit({ diff: () => 'tests/b.test.js\0src/x.js\0tests/a.test.js\0' });
  const ctx = loadImpactContext({ decl: declOf(), repoRoot: ROOT, commonDir: COMMON, execImpl, fsImpl: fakeFs({ [MAP_PATH]: mapText() }) });
  assert.strictEqual(ctx.problem, null);
  assert.deepStrictEqual(ctx.driftTests, ['tests/a.test.js', 'tests/b.test.js']);
  const diff = calls.find((c) => c.args[0] === 'diff');
  assert.deepStrictEqual(diff.args, ['diff', '--name-only', '-z', '--no-renames', '--end-of-options', SHA, 'HEAD']);
  assert.strictEqual(diff.opts.cwd, ROOT);
});

test('loadImpactContext: an unreadable drift diff fails closed as map-drift-unreadable; a map problem skips the diff (#4132)', () => {
  const failing = loadImpactContext({
    decl: declOf(), repoRoot: ROOT, commonDir: COMMON,
    execImpl: fakeGit({ diff: () => { throw new Error('bad object'); } }).execImpl, fsImpl: fakeFs({ [MAP_PATH]: mapText() }),
  });
  assert.strictEqual(failing.problem, 'map-drift-unreadable');
  assert.deepStrictEqual(failing.driftTests, []);
  const { execImpl, calls } = fakeGit();
  const missing = loadImpactContext({ decl: declOf(), repoRoot: ROOT, commonDir: COMMON, execImpl, fsImpl: fakeFs({}) });
  assert.strictEqual(missing.problem, 'map-missing');
  assert.deepStrictEqual(missing.driftTests, []);
  assert.strictEqual(calls.some((c) => c.args[0] === 'diff'), false);
});

test('loadImpactContext: missing, unreadable, invalid, non-ancestor, stale and unknown-distance maps', () => {
  const run = (files, overrides = {}, impact = {}) => loadImpactContext({
    decl: declOf(impact), repoRoot: ROOT, commonDir: COMMON, execImpl: fakeGit(overrides).execImpl, fsImpl: fakeFs(files),
  });
  assert.strictEqual(run({}).problem, 'map-missing');
  assert.strictEqual(run({}).map, null);
  assert.strictEqual(run({}).mapDirty, null);
  const eisdir = Object.assign(new Error('EISDIR'), { code: 'EISDIR' });
  assert.strictEqual(run({ [path.join(ROOT, '.')]: eisdir }, {}, { map: '.' }).problem, 'map-invalid: unreadable');
  assert.strictEqual(run({ [MAP_PATH]: '{' }).problem, 'map-invalid: unparseable');
  assert.strictEqual(run({ [MAP_PATH]: mapText({ exitCode: 1 }) }).problem, 'map-from-failing-suite');
  const dirty = run({ [MAP_PATH]: mapText({ dirty: true }) });
  assert.strictEqual(dirty.problem, 'map-dirty');
  assert.strictEqual(dirty.mapDirty, true);
  const notAncestor = run({ [MAP_PATH]: mapText() }, { 'merge-base': () => { throw new Error('exit 1'); } });
  assert.strictEqual(notAncestor.problem, 'map-not-ancestor');
  assert.strictEqual(notAncestor.mapCommit, SHA);
  assert.strictEqual(run({ [MAP_PATH]: mapText() }, { 'rev-list': () => '9\n' }).problem, 'map-stale: 9 commits > 5');
  const garbled = run({ [MAP_PATH]: mapText() }, { 'rev-list': () => '2 extra\n' });
  assert.strictEqual(garbled.problem, 'map-stale: unknown commits > 5');
  assert.strictEqual(garbled.distance, null);
  assert.strictEqual(run({ [MAP_PATH]: mapText() }, { 'rev-list': () => { throw new Error('bad'); } }).problem, 'map-stale: unknown commits > 5');
});

test('loadImpactContext: an unreadable test listing fails closed, never an empty headTests', () => {
  const ctx = loadImpactContext({
    decl: declOf(), repoRoot: ROOT, commonDir: COMMON,
    execImpl: fakeGit({ 'ls-files': () => { throw new Error('boom'); } }).execImpl, fsImpl: fakeFs({ [MAP_PATH]: mapText() }),
  });
  assert.strictEqual(ctx.problem, 'head-tests-unreadable');
});

test('lazyImpactContext: nothing loads until a field is read, then it loads once', () => {
  let loads = 0;
  const ctx = lazyImpactContext(() => { loads += 1; return { map: null, problem: 'map-missing', headTests: ['tests/a.test.js'], driftTests: [], mapPath: '/m', mapCommit: null, mapDirty: true, distance: null, fetch: null }; });
  assert.strictEqual(ctx.loaded, false);
  assert.strictEqual(loads, 0);
  assert.strictEqual(ctx.problem, 'map-missing');
  assert.deepStrictEqual(ctx.headTests, ['tests/a.test.js']);
  assert.deepStrictEqual(ctx.driftTests, []);
  assert.strictEqual(ctx.mapPath, '/m');
  assert.strictEqual(ctx.mapDirty, true, 'mapDirty is forwarded');
  assert.strictEqual(ctx.loaded, true);
  assert.strictEqual(loads, 1);
  assert.strictEqual({ ...ctx, problem: 'x' }.mapPath, '/m', 'a spread copies the loaded values');
});

test('loadImpactContext: a listing that names no test file fails closed instead of selecting nothing', () => {
  const ctx = loadImpactContext({
    decl: declOf(), repoRoot: ROOT, commonDir: COMMON,
    execImpl: fakeGit({ 'ls-files': () => '' }).execImpl, fsImpl: fakeFs({ [MAP_PATH]: mapText() }),
  });
  assert.strictEqual(ctx.problem, 'head-tests-empty');
});

test('loadImpactContext: git reads carry the shared large maxBuffer', () => {
  const seen = [];
  const { execImpl } = fakeGit();
  loadImpactContext({
    decl: declOf(), repoRoot: ROOT, commonDir: COMMON,
    execImpl: (cmd, args, opts) => { seen.push(opts.maxBuffer); return execImpl(cmd, args, opts); }, fsImpl: fakeFs({ [MAP_PATH]: mapText() }),
  });
  assert.ok(seen.length > 0 && seen.every((b) => b === 64 * 1024 * 1024), JSON.stringify(seen));
});

test('loadImpactContext: the fetch runs once on a problem and the map is reloaded', () => {
  const files = {};
  const commands = [];
  const fetched = 'fedcba9876543210fedcba9876543210fedcba98';
  const runFetch = (command) => { commands.push(command); files[MAP_PATH] = mapText({ commit: fetched }); return { ran: true, exitCode: 0, durationMs: 4 }; };
  const { execImpl, calls } = fakeGit();
  const ctx = loadImpactContext({
    decl: declOf({ fetch: 'get-map' }), repoRoot: ROOT, commonDir: COMMON, execImpl, fsImpl: fakeFs(files), runFetch,
  });
  assert.deepStrictEqual(commands, ['get-map']);
  assert.strictEqual(ctx.problem, null);
  assert.deepStrictEqual(ctx.fetch, { ran: true, exitCode: 0, durationMs: 4 });
  // The drift read runs once, against the reloaded map's commit (#4132).
  const diffs = calls.filter((c) => c.args[0] === 'diff');
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].args[5], fetched);
});

test('loadImpactContext: a failed fetch keeps the original problem; no problem or no fetch command never fetches', () => {
  const commands = [];
  const failing = (command) => { commands.push(command); return { ran: true, exitCode: 3, durationMs: 1 }; };
  const failed = loadImpactContext({
    decl: declOf({ fetch: 'get-map', maxAgeCommits: 1 }), repoRoot: ROOT, commonDir: COMMON, execImpl: fakeGit().execImpl, fsImpl: fakeFs({ [MAP_PATH]: mapText() }), runFetch: failing,
  });
  assert.strictEqual(failed.problem, 'map-stale: 2 commits > 1');
  assert.deepStrictEqual(failed.fetch, { ran: true, exitCode: 3, durationMs: 1 });
  assert.strictEqual(commands.length, 1);
  const fresh = loadImpactContext({
    decl: declOf({ fetch: 'get-map' }), repoRoot: ROOT, commonDir: COMMON, execImpl: fakeGit().execImpl, fsImpl: fakeFs({ [MAP_PATH]: mapText() }), runFetch: failing,
  });
  assert.strictEqual(fresh.fetch, null);
  const noCommand = loadImpactContext({
    decl: declOf(), repoRoot: ROOT, commonDir: COMMON, execImpl: fakeGit().execImpl, fsImpl: fakeFs({}), runFetch: failing,
  });
  assert.strictEqual(noCommand.fetch, null);
  assert.strictEqual(commands.length, 1);
});
