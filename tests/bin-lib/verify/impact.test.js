'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  IMPACT_MAP_VERSION, DEFAULT_MAP_NAME, KINDS,
  encodeImpactMap, parseImpactMap, under, selectImpactTests, mapProblem,
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
  assert.deepStrictEqual(r, { ok: true, tests: ['tests/a.test.js'], matched: ['tests/a.test.js'], changedTests: [], untracedTests: [] });
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
  assert.deepStrictEqual(modified, { ok: true, tests: ['tests/a.test.js'], matched: [], changedTests: ['tests/a.test.js'], untracedTests: [] });
  // A deleted test (absent from headTests) is not selected and does not fail closed.
  const deleted = select(XMAP, [{ path: 'tests/b.test.js', status: 'D' }], ['tests/a.test.js']);
  assert.deepStrictEqual(deleted, { ok: true, tests: [], matched: [], changedTests: [], untracedTests: [] });
});

test('untraced tests at HEAD are selected', () => {
  const r = select(XMAP, [{ path: 'src/x.js', status: 'M' }], ['tests/a.test.js', 'tests/b.test.js', 'tests/new.test.js']);
  assert.deepStrictEqual(r, {
    ok: true, tests: ['tests/a.test.js', 'tests/new.test.js'], matched: ['tests/a.test.js'], changedTests: [], untracedTests: ['tests/new.test.js'],
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
  assert.deepStrictEqual(r, { ok: true, tests: ['tests/a.test.js'], matched: ['tests/a.test.js'], changedTests: [], untracedTests: [] });
});

test('result tests are the sorted unique union', () => {
  const r = select(XMAP, [{ path: 'src/x.js', status: 'D' }, { path: 'tests/a.test.js', status: 'M' }], ['tests/b.test.js', 'tests/a.test.js', 'tests/c.test.js']);
  assert.deepStrictEqual(r, {
    ok: true,
    tests: ['tests/a.test.js', 'tests/b.test.js', 'tests/c.test.js'],
    matched: ['tests/a.test.js', 'tests/b.test.js'],
    changedTests: ['tests/a.test.js'],
    untracedTests: ['tests/c.test.js'],
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
  const base = { parsed: ok, isAncestor: true, distance: 3, maxAgeCommits: 50 };
  const cases = [
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
