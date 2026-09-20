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
