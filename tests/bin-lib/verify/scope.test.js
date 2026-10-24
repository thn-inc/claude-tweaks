'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { selectScope } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'scope.js'));
const { readDeclaration } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'declaration.js'));

const FULL = '0123456789abcdef0123456789abcdef01234567';
const STAMP = { sha: 'deadbeef', fullSha: FULL, scope: 'full' };

function decl(json) {
  const r = readDeclaration('/d.json', { readFileSync: () => JSON.stringify(json) });
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  return r.decl;
}

const EXAMPLE = decl({
  checks: { types: 't', lint: 'l', tests: { api: 'a', web: 'w' } },
  rules: [
    { match: 'apps/api/**', suites: ['api'], static: true },
    { match: 'apps/web/**', suites: ['web'], static: true },
    { match: 'packages/shared/**', suites: '*', static: true },
    { match: 'docs/**/*.md', suites: [], static: false },
    { match: 'docs/plans/*-ledger.md', suites: [], static: false },
    { match: '.claude-tweaks/pipelines/**', suites: [], static: false },
  ],
});

test('no declaration → full, byte-for-byte today (AC1)', () => {
  for (const files of [[], ['anything.js'], ['docs/x.md']]) {
    assert.deepStrictEqual(selectScope({ decl: null, files, stamp: STAMP }), { mode: 'full', suites: '*', static: true, base: FULL, unmatched: [], matched: [] });
  }
});

test('no prior stamp → full even with a declaration (the first run is always the anchor)', () => {
  const r = selectScope({ decl: EXAMPLE, files: ['docs/x.md'], stamp: null });
  assert.strictEqual(r.mode, 'full');
  assert.strictEqual(r.suites, '*');
  assert.strictEqual(r.static, true);
  assert.strictEqual(r.base, null);
});

test('the example declaration selects per AC2', () => {
  const sel = (files) => selectScope({ decl: EXAMPLE, files, stamp: STAMP });
  assert.strictEqual(sel(['docs/plans/x-ledger.md']).mode, 'none');
  assert.strictEqual(sel(['docs/guide.md']).mode, 'none');
  let r = sel(['apps/api/src/a.ts']);
  assert.strictEqual(r.mode, 'scoped'); assert.deepStrictEqual(r.suites, ['api']); assert.strictEqual(r.static, true);
  r = sel(['packages/shared/x.ts']);
  assert.strictEqual(r.mode, 'full'); assert.strictEqual(r.suites, '*');
  r = sel(['unknown/path.txt']);
  assert.strictEqual(r.mode, 'full'); assert.deepStrictEqual(r.unmatched, ['unknown/path.txt']);
  r = sel(['apps/api/src/a.ts', 'docs/plans/x-ledger.md']);
  assert.strictEqual(r.mode, 'scoped'); assert.deepStrictEqual(r.suites, ['api']);
  assert.deepStrictEqual(r.matched, [{ file: 'apps/api/src/a.ts', rule: 0 }, { file: 'docs/plans/x-ledger.md', rule: 3 }]);
});

test('every selected suite without static is scoped, not full; the anchoring base is the stamp fullSha', () => {
  const d = decl({ checks: { tests: { api: 'a', web: 'w' } }, rules: [{ match: 'src/**', suites: '*', static: false }] });
  const r = selectScope({ decl: d, files: ['src/a.js'], stamp: STAMP });
  assert.strictEqual(r.mode, 'scoped');
  assert.deepStrictEqual(r.suites, ['api', 'web']);
  assert.strictEqual(r.static, false);
  assert.strictEqual(r.base, FULL);
});

test('static-only: suites empty with static true (the branch no example rule exercises)', () => {
  const d = decl({ checks: { tests: 'npm test' }, rules: [{ match: 'config/**', suites: [], static: true }] });
  const r = selectScope({ decl: d, files: ['config/a.json'], stamp: STAMP });
  assert.strictEqual(r.mode, 'static-only');
  assert.deepStrictEqual(r.suites, []);
  assert.strictEqual(r.static, true);
});

test('first matching rule wins — order matters', () => {
  const shadowing = decl({ checks: { tests: 'npm test' }, rules: [
    { match: 'docs/**/*.md', suites: ['tests'], static: true },
    { match: 'docs/plans/*-ledger.md', suites: [], static: false },
  ] });
  assert.strictEqual(selectScope({ decl: shadowing, files: ['docs/plans/x-ledger.md'], stamp: STAMP }).mode, 'full');
  const ordered = decl({ checks: { tests: 'npm test' }, rules: [
    { match: 'docs/plans/*-ledger.md', suites: [], static: false },
    { match: 'docs/**/*.md', suites: ['tests'], static: true },
  ] });
  assert.strictEqual(selectScope({ decl: ordered, files: ['docs/plans/x-ledger.md'], stamp: STAMP }).mode, 'none');
});

test('an empty changed-file set with a declaration and a stamp is none', () => {
  const r = selectScope({ decl: EXAMPLE, files: [], stamp: STAMP });
  assert.strictEqual(r.mode, 'none');
  assert.deepStrictEqual(r.suites, []);
  assert.strictEqual(r.static, false);
});

test('tool-scoped: path rules do not pick suites, static still follows the rules', () => {
  const d = decl({ checks: { types: 't', tests: 'pnpm vitest --changed {base}' }, rules: [
    { match: 'src/**', suites: [], static: true },
    { match: 'docs/**', suites: [], static: false },
  ] });
  let r = selectScope({ decl: d, files: ['src/a.js'], stamp: STAMP });
  assert.strictEqual(r.mode, 'tool-scoped'); assert.deepStrictEqual(r.suites, ['tests']); assert.strictEqual(r.static, true);
  r = selectScope({ decl: d, files: ['docs/a.md'], stamp: STAMP });
  assert.strictEqual(r.mode, 'tool-scoped'); assert.strictEqual(r.static, false);
  r = selectScope({ decl: d, files: [], stamp: STAMP });
  assert.strictEqual(r.mode, 'none');
});

test('a legacy stamp with no fullSha anchors on its sha', () => {
  const r = selectScope({ decl: EXAMPLE, files: ['docs/x.md'], stamp: { sha: FULL, scope: 'full', legacy: true } });
  assert.strictEqual(r.base, FULL);
});

// ── impact rules (#4024) ──────────────────────────────────────────────────
const { encodeImpactMap, parseImpactMap } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'impact.js'));

const IMPACT = decl({
  checks: { tests: { tests: 'npm test', docs: 'npm run docs' } },
  impact: { suite: 'tests', command: 'node --test {files}', tests: ['tests/**/*.test.js'] },
  rules: [
    { match: 'src/**', impact: true, static: true },
    { match: 'tests/**', impact: true, static: false },
    { match: 'docs/**', suites: ['docs'], static: true },
    { match: 'lib/**', suites: ['tests'], static: false },
    { match: 'shared/**', suites: '*', static: false },
  ],
});
const MAP = parseImpactMap(JSON.stringify(encodeImpactMap({
  commit: FULL, tracedAt: '2026-10-24T00:00:00Z', exitCode: 0, node: 'v22.0.0',
  tests: {
    'tests/a.test.js': { f: ['src/x.js'] },
    'tests/b.test.js': { f: ['src/y.js'] },
    'tests/p.test.js': { s: ['src/new.js'] },
  },
}))).map;
const HEAD = ['tests/a.test.js', 'tests/b.test.js', 'tests/p.test.js'];
const CTX = { map: MAP, problem: null, headTests: HEAD };
const FULL_RUN = { suite: 'tests', files: null, fallback: null, selected: null, changedTests: [], untracedTests: [], superseded: false };
const NOT_SELECTED = { ...FULL_RUN, files: [], selected: 0 };
const SUPERSEDED = { ...FULL_RUN, superseded: true };
const isel = (files, statuses, impact = CTX, extra = {}) => selectScope({ decl: IMPACT, files, stamp: STAMP, statuses, impact, ...extra });

test('impact subset → scoped, only the tests that read the changed path', () => {
  const r = isel(['src/x.js'], { 'src/x.js': 'M' });
  assert.strictEqual(r.mode, 'scoped');
  assert.deepStrictEqual(r.suites, ['tests']);
  assert.strictEqual(r.static, true);
  assert.strictEqual(r.base, FULL);
  assert.deepStrictEqual(r.matched, [{ file: 'src/x.js', rule: 0 }]);
  assert.deepStrictEqual(r.impact, { suite: 'tests', files: ['tests/a.test.js'], fallback: null, selected: 1, changedTests: [], untracedTests: [], superseded: false });
});

test('a subset impact suite never yields full, even with every suite selected and static', () => {
  const r = isel(['src/x.js', 'docs/a.md'], { 'src/x.js': 'M', 'docs/a.md': 'M' });
  assert.strictEqual(r.mode, 'scoped');
  assert.deepStrictEqual(r.suites, ['docs', 'tests']);
  assert.deepStrictEqual(r.impact.files, ['tests/a.test.js']);
});

test('fallback names its reason and runs the impact suite full', () => {
  const ctx = { ...CTX, problem: 'map-stale: 300 commits > 200' };
  let r = isel(['src/x.js'], { 'src/x.js': 'M' }, ctx);
  assert.strictEqual(r.mode, 'scoped');
  assert.deepStrictEqual(r.suites, ['tests']);
  assert.deepStrictEqual(r.impact, { ...FULL_RUN, fallback: 'map-stale: 300 commits > 200' });
  r = isel(['src/x.js', 'docs/a.md'], { 'src/x.js': 'M', 'docs/a.md': 'M' }, ctx);
  assert.strictEqual(r.mode, 'full');
  assert.strictEqual(r.suites, '*');
  assert.strictEqual(r.impact.files, null);
  assert.strictEqual(r.impact.fallback, 'map-stale: 300 commits > 200');
});

test('a missing impact context (or a null map) reads as map-missing', () => {
  for (const ctx of [null, { map: null, problem: null, headTests: HEAD }]) {
    const r = isel(['src/x.js'], { 'src/x.js': 'M' }, ctx);
    assert.strictEqual(r.mode, 'scoped');
    assert.deepStrictEqual(r.suites, ['tests']);
    assert.strictEqual(r.impact.fallback, 'map-missing');
    assert.strictEqual(r.impact.files, null);
    assert.strictEqual(r.impact.selected, null);
  }
});

test('untraced path fails closed', () => {
  const r = isel(['src/x.js', 'src/nobody.js'], { 'src/x.js': 'M', 'src/nobody.js': 'M' });
  assert.deepStrictEqual(r.suites, ['tests']);
  assert.deepStrictEqual(r.impact, { ...FULL_RUN, fallback: 'untraced-path: src/nobody.js' });
});

test('a context with a map but no headTests reads as headTests [] (never a TypeError)', () => {
  const r = isel(['src/x.js'], { 'src/x.js': 'M' }, { map: MAP, problem: null });
  assert.deepStrictEqual(r.impact, { ...FULL_RUN, fallback: 'untraced-path: src/x.js' });
  const t = isel(['tests/gone.test.js'], { 'tests/gone.test.js': 'D' }, { map: MAP, problem: null });
  assert.deepStrictEqual(t.impact, NOT_SELECTED);
});

test('an unmatched path supersedes the impact subset', () => {
  const r = isel(['src/x.js', 'unknown/path.txt'], { 'src/x.js': 'M', 'unknown/path.txt': 'M' });
  assert.strictEqual(r.mode, 'full');
  assert.strictEqual(r.suites, '*');
  assert.deepStrictEqual(r.unmatched, ['unknown/path.txt']);
  assert.deepStrictEqual(r.impact, SUPERSEDED);
});

test('a "*" rule or an explicit rule naming the impact suite also supersedes; fallback stays null', () => {
  const ctx = { ...CTX, problem: 'map-missing' };
  let r = isel(['src/x.js', 'shared/k.js'], { 'src/x.js': 'M', 'shared/k.js': 'M' }, ctx);
  assert.strictEqual(r.mode, 'full');
  assert.deepStrictEqual(r.impact, SUPERSEDED);
  r = isel(['src/x.js', 'lib/k.js'], { 'src/x.js': 'M', 'lib/k.js': 'M' }, ctx);
  assert.strictEqual(r.mode, 'scoped');
  assert.deepStrictEqual(r.suites, ['tests']);
  assert.deepStrictEqual(r.impact, SUPERSEDED);
  // Selected in full with no impact-rule file at all is still superseded.
  r = isel(['lib/k.js'], { 'lib/k.js': 'M' });
  assert.deepStrictEqual(r.impact, SUPERSEDED);
});

test('no impact-rule file and the impact suite unselected: impact is the empty subset (files [], selected 0)', () => {
  const r = isel(['docs/a.md'], { 'docs/a.md': 'M' });
  assert.strictEqual(r.mode, 'scoped');
  assert.deepStrictEqual(r.suites, ['docs']);
  assert.deepStrictEqual(r.impact, NOT_SELECTED);
  assert.deepStrictEqual(isel([], {}).impact, NOT_SELECTED);
  assert.strictEqual(isel([], {}).mode, 'none');
});

test('changed test files at HEAD and untraced HEAD tests join the subset', () => {
  const head = [...HEAD, 'tests/new.test.js'];
  const r = isel(['src/x.js', 'tests/b.test.js'], { 'src/x.js': 'M', 'tests/b.test.js': 'M' }, { ...CTX, headTests: head });
  assert.deepStrictEqual(r.impact, {
    suite: 'tests', files: ['tests/a.test.js', 'tests/b.test.js', 'tests/new.test.js'], fallback: null, selected: 3,
    changedTests: ['tests/b.test.js'], untracedTests: ['tests/new.test.js'], superseded: false,
  });
  assert.strictEqual(r.static, true);
});

test('an empty subset drops the impact suite', () => {
  const r = isel(['tests/gone.test.js'], { 'tests/gone.test.js': 'D' });
  assert.strictEqual(r.mode, 'none');
  assert.deepStrictEqual(r.suites, []);
  assert.deepStrictEqual(r.impact, NOT_SELECTED);
  const s = isel(['tests/gone.test.js', 'docs/a.md'], { 'tests/gone.test.js': 'D', 'docs/a.md': 'M' });
  assert.strictEqual(s.mode, 'scoped');
  assert.deepStrictEqual(s.suites, ['docs']);
});

test('a path with no status reads as A (the broader match), never M', () => {
  // p.test.js only probes src/new.js for existence: A reaches it, M does not.
  for (const statuses of [null, {}]) {
    const r = isel(['src/new.js'], statuses);
    assert.deepStrictEqual(r.impact.files, ['tests/p.test.js'], JSON.stringify(statuses));
  }
  assert.strictEqual(isel(['src/new.js'], { 'src/new.js': 'M' }).impact.fallback, 'untraced-path: src/new.js');
});

test('no stamp + fallbackBase anchors on the merge-base; no stamp + no fallbackBase is full', () => {
  const MB = 'fedcba9876543210fedcba9876543210fedcba98';
  let r = selectScope({ decl: IMPACT, files: ['src/x.js'], stamp: null, statuses: { 'src/x.js': 'M' }, impact: CTX, fallbackBase: MB });
  assert.strictEqual(r.base, MB);
  assert.strictEqual(r.mode, 'scoped');
  assert.deepStrictEqual(r.impact.files, ['tests/a.test.js']);
  // A stamp still wins over fallbackBase.
  r = isel(['src/x.js'], { 'src/x.js': 'M' }, CTX, { fallbackBase: MB });
  assert.strictEqual(r.base, FULL);
  r = selectScope({ decl: IMPACT, files: ['src/x.js'], stamp: null, statuses: { 'src/x.js': 'M' }, impact: CTX });
  assert.strictEqual(r.mode, 'full');
  assert.strictEqual(r.suites, '*');
  assert.strictEqual(r.base, null);
  assert.deepStrictEqual(r.impact, { ...FULL_RUN, fallback: 'no-anchor' });
  // A context problem still wins as the unanchored run's fallback reason.
  r = selectScope({ decl: IMPACT, files: ['src/x.js'], stamp: null, statuses: { 'src/x.js': 'M' }, impact: { ...CTX, problem: 'map-not-ancestor' } });
  assert.deepStrictEqual(r.impact, { ...FULL_RUN, fallback: 'map-not-ancestor' });
  r = selectScope({ decl: IMPACT, files: [], stamp: null });
  assert.strictEqual(r.mode, 'full');
  assert.deepStrictEqual(r.impact, { ...FULL_RUN, fallback: 'map-missing' });
});

test('no impact block is unchanged: no impact key, fallbackBase ignored', () => {
  const MB = 'fedcba9876543210fedcba9876543210fedcba98';
  assert.deepStrictEqual(
    selectScope({ decl: null, files: ['a.js'], stamp: STAMP, statuses: { 'a.js': 'M' }, impact: CTX, fallbackBase: MB }),
    { mode: 'full', suites: '*', static: true, base: FULL, unmatched: [], matched: [] },
  );
  assert.strictEqual(EXAMPLE.impact, null);
  for (const files of [[], ['apps/api/src/a.ts'], ['docs/x.md'], ['unknown/path.txt']]) {
    assert.strictEqual('impact' in selectScope({ decl: EXAMPLE, files, stamp: STAMP }), false, files.join());
  }
  const r = selectScope({ decl: EXAMPLE, files: ['docs/x.md'], stamp: null, fallbackBase: MB });
  assert.deepStrictEqual(r, { mode: 'full', suites: '*', static: true, base: null, unmatched: [], matched: [] });
});
