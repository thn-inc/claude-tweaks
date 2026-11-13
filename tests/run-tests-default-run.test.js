// tests/run-tests-default-run.test.js — a plain local `node tools/run-tests.js` selects the test files
// the impact map names for the changes since the integration base; `--full`, any other flag or root,
// and CI run the whole suite (#5319). The mode decision and the plan are pure and tested as tables;
// the selector runs against injected deps.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { extractRunFlags, resolveRunMode, selectChangedTests, planDefaultRun } = require(path.join(ROOT, 'tools', 'run-tests.js'));
const { readDeclaration } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'verify', 'declaration.js'));
const { lazyImpactContext, encodeImpactMap, parseImpactMap } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'verify', 'impact.js'));
const { selectScope } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'verify', 'scope.js'));

const REAL = readDeclaration(path.join(ROOT, '.claude-tweaks', 'verify-scope.json'));
const BASE = 'a'.repeat(40);

function mapOf(tests) {
  const parsed = parseImpactMap(JSON.stringify(encodeImpactMap({
    commit: 'b'.repeat(40), tracedAt: '2026-10-24T00:00:00Z', exitCode: 0, node: 'v20.0.0', tests,
  })));
  assert.strictEqual(parsed.ok, true);
  return parsed.map;
}

// A healthy checkout: `tests/one.test.js` reads plugin/bin/x.js, two test files exist.
function fakeDeps(over = {}) {
  const map = mapOf({ 'tests/one.test.js': { f: ['plugin/bin/x.js'] }, 'tests/two.test.js': { f: ['plugin/bin/y.js'] } });
  return {
    readDeclaration: () => ({ ok: true, decl: REAL.decl }),
    resolveBase: () => BASE,
    changedFiles: () => ({ files: ['plugin/bin/x.js'], statuses: { 'plugin/bin/x.js': 'M' } }),
    gitLocations: () => ({ repoRoot: ROOT, commonDir: ROOT }),
    loadImpactContext: () => ({ map, problem: null, headTests: ['tests/one.test.js', 'tests/two.test.js'], driftTests: [] }),
    lazyImpactContext,
    selectScope,
    runFetch: () => ({ ran: false }),
    exists: () => true,
    countTests: () => 2,
    ...over,
  };
}

const select = (over) => selectChangedTests({ repoRoot: ROOT, deps: fakeDeps(over) });

test('AC2.1: --full is a run flag and selects the whole suite', () => {
  assert.deepStrictEqual(extractRunFlags(['--full']), { rest: [], shard: null, recordDurations: null, full: true });
  assert.strictEqual(resolveRunMode({ rest: [], shard: null, recordDurations: null, full: true, env: {} }), 'whole');
});

test('AC2.2 / AC7.1: resolveRunMode table', () => {
  const mode = (over) => resolveRunMode({ rest: [], shard: null, recordDurations: null, full: false, env: {}, ...over });
  assert.strictEqual(mode({}), 'select');
  assert.strictEqual(mode({ env: { CI: '' } }), 'select');
  assert.strictEqual(mode({ env: { CI: 'true' } }), 'whole');
  assert.strictEqual(mode({ env: { CI: 'false' } }), 'whole'); // any non-empty value, as resolveConcurrency reads it
  assert.strictEqual(mode({ shard: { index: 1, total: 4 } }), 'whole');
  assert.strictEqual(mode({ recordDurations: 'out.json' }), 'whole');
  assert.strictEqual(mode({ rest: ['perf'] }), 'whole');
  assert.strictEqual(mode({ rest: ['--files-from', 'list.txt'] }), 'listed');
  assert.throws(() => mode({ full: true, rest: ['--files-from', 'list.txt'] }), /--full cannot be combined with --files-from/);
});

test('AC1.1: a changed plugin module selects only the test files the map names for it', () => {
  assert.deepStrictEqual(select(), { files: ['tests/one.test.js'], reason: null, base: BASE, total: 2, otherSuites: [] });
});

test('AC1.2: a heavy test file is selected only when the map says it reads a changed path', () => {
  const heavy = 'tests/bin-lib/dispatch/queue-pull.test.js';
  const headTests = ['tests/one.test.js', 'tests/two.test.js', heavy];
  const notReader = mapOf({ 'tests/one.test.js': { f: ['plugin/bin/x.js'] }, [heavy]: { f: ['plugin/bin/z.js'] } });
  const reader = mapOf({ 'tests/one.test.js': { f: ['plugin/bin/x.js'] }, [heavy]: { f: ['plugin/bin/x.js'] } });
  const withMap = (map) => select({ loadImpactContext: () => ({ map, problem: null, headTests, driftTests: [] }) });
  assert.ok(!withMap(notReader).files.includes(heavy));
  assert.ok(withMap(reader).files.includes(heavy));
});

test('AC3.1: a map problem runs the whole suite and names it', () => {
  const r = select({ loadImpactContext: () => ({ map: null, problem: 'map-missing', headTests: [], driftTests: [] }) });
  assert.strictEqual(r.files, null);
  assert.strictEqual(r.reason, 'map-missing');
});

test('AC3.2: a path a full-suite rule matches runs the whole suite', () => {
  const r = select({ changedFiles: () => ({ files: ['tools/run-tests.js'], statuses: { 'tools/run-tests.js': 'M' } }) });
  assert.strictEqual(r.files, null);
  assert.match(r.reason, /^superseded by a full-suite rule \(tools\/run-tests\.js\)$/);
});

test('AC3.3: a base that does not resolve runs the whole suite', () => {
  const { ChangedFilesError } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'verify', 'changed-files.js'));
  const err = new ChangedFilesError('no usable base: main does not resolve');
  const r = select({ resolveBase: () => { throw err; } });
  assert.strictEqual(r.files, null);
  assert.strictEqual(r.reason, err.message);
});

test('AC3.4: an unreadable declaration runs the whole suite', () => {
  const r = select({ readDeclaration: () => ({ ok: false, errors: ['verify-scope.json: could not parse JSON: boom'] }) });
  assert.strictEqual(r.files, null);
  assert.strictEqual(r.reason, 'verify-scope.json: could not parse JSON: boom');
  const missing = select({ readDeclaration: () => ({ ok: true, decl: null, missing: true }) });
  assert.strictEqual(missing.files, null);
  assert.strictEqual(missing.reason, 'no declaration');
  const noImpact = select({ readDeclaration: () => ({ ok: true, decl: { ...REAL.decl, impact: undefined } }) });
  assert.strictEqual(noImpact.files, null);
  assert.strictEqual(noImpact.reason, 'the declaration has no impact block');
});

test('AC3.5: a thrown error becomes a one-line reason, never an exception', () => {
  const r = select({ changedFiles: () => { throw new Error('git exploded\nfatal: second line'); } });
  assert.strictEqual(r.files, null);
  assert.strictEqual(r.reason, 'selection failed: git exploded');
  assert.doesNotMatch(planDefaultRun(r).line, /[\r\n]/);
});

test('AC4.1: no change selects nothing', () => {
  const r = select({ changedFiles: () => ({ files: [], statuses: {} }) });
  assert.deepStrictEqual(r.files, []);
  assert.strictEqual(r.reason, null);
});

test('selectChangedTests drops selected files that are not on disk', () => {
  const r = select({ exists: (f) => f !== 'tests/one.test.js' });
  assert.deepStrictEqual(r.files, []);
});

test('AC4.2: other selected suites are named, never silently dropped', () => {
  const suffix = ' — also selected: journeys (run by `verify.js --scope`, not here)';
  const change = (files) => ({ files, statuses: Object.fromEntries(files.map((f) => [f, 'M'])) });
  const both = select({ changedFiles: () => change(['plugin/bin/x.js', 'docs/journeys/x.md']) });
  assert.deepStrictEqual(both.files, select().files);
  assert.deepStrictEqual(both.otherSuites, ['journeys']);
  assert.ok(planDefaultRun(both).line.endsWith(suffix), planDefaultRun(both).line);
  const alone = select({ changedFiles: () => change(['docs/journeys/x.md']) });
  assert.deepStrictEqual(alone.files, []);
  assert.deepStrictEqual(alone.otherSuites, ['journeys']);
  const plan = planDefaultRun(alone);
  assert.strictEqual(plan.action, 'none');
  assert.ok(plan.line.endsWith(suffix), plan.line);
  // A whole-suite result names no other suite.
  assert.deepStrictEqual(select({ loadImpactContext: () => ({ map: null, problem: 'map-missing', headTests: [], driftTests: [] }) }).otherSuites, []);
});

test('AC1.3 / AC4.2 / AC3.6: planDefaultRun returns the action and the exact line', () => {
  const base = 'a'.repeat(40);
  assert.deepStrictEqual(planDefaultRun({ files: ['tests/one.test.js'], reason: null, base, total: 2 }), {
    action: 'subset',
    files: ['tests/one.test.js'],
    line: 'run-tests.js: impact-selected 1 of 2 test files for changes since aaaaaaaaa — `npm test -- --full` runs the whole suite here; CI runs it on every PR',
  });
  assert.deepStrictEqual(planDefaultRun({ files: [], reason: null, base, total: 2 }), {
    action: 'none',
    files: [],
    line: 'run-tests.js: no test file selected for changes since aaaaaaaaa — nothing to run; `npm test -- --full` runs the whole suite here',
  });
  assert.deepStrictEqual(planDefaultRun({ files: null, reason: 'map-missing', base, total: 2 }), {
    action: 'whole',
    files: null,
    line: 'run-tests.js: running the whole suite — impact selection could not narrow it: map-missing',
  });
});
