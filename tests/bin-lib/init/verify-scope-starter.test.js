'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const M = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'init', 'verify-scope-starter.js');
const { detectWorkspace, composeStarter, diffAgainstWorkspace, BOOKKEEPING_RULES } = require(M);
const { readDeclaration } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'declaration.js'));

// An in-memory fs keyed by absolute path; directories are listed from the file map.
// `symlinks` names entries that list as symbolic links (never as directories).
function memFs(files, symlinks = []) {
  const has = (p) => Object.prototype.hasOwnProperty.call(files, p);
  return {
    readFileSync: (p) => { if (!has(p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files[p]; },
    existsSync: (p) => has(p) || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
    readdirSync: (p, opts) => {
      const names = new Set();
      for (const f of Object.keys(files)) if (f.startsWith(`${p}/`)) names.add(f.slice(p.length + 1).split('/')[0]);
      for (const s of symlinks) if (path.posix.dirname(s) === p) names.add(path.posix.basename(s));
      return [...names].map((name) => (opts && opts.withFileTypes ? {
        name,
        isSymbolicLink: () => symlinks.includes(`${p}/${name}`),
        isDirectory: () => !symlinks.includes(`${p}/${name}`) && Object.keys(files).some((f) => f.startsWith(`${p}/${name}/`)),
      } : name));
    },
  };
}

const PNPM = {
  '/w/pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - packages/shared\n",
  '/w/package.json': JSON.stringify({ name: 'root', scripts: { typecheck: 'tsc -b', lint: 'eslint .' } }),
  '/w/apps/api/package.json': JSON.stringify({ name: 'api', scripts: { test: 'vitest run' }, dependencies: { shared: 'workspace:*' } }),
  '/w/apps/web/package.json': JSON.stringify({ name: 'web', scripts: { test: 'vitest run' }, dependencies: { shared: 'workspace:*' } }),
  '/w/packages/shared/package.json': JSON.stringify({ name: 'shared', scripts: { test: 'vitest run' } }),
};

test('detectWorkspace reads pnpm-workspace.yaml globs, package names, test scripts, and dependencies', () => {
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs(PNPM) });
  assert.strictEqual(ws.tool, 'pnpm');
  assert.deepStrictEqual(ws.packages.map((p) => [p.name, p.path, p.hasTest, p.dependencies]), [
    ['api', 'apps/api', true, ['shared']], ['web', 'apps/web', true, ['shared']], ['shared', 'packages/shared', true, []],
  ]);
  assert.deepStrictEqual(ws.rootScripts, { typecheck: 'tsc -b', lint: 'eslint .' });
});

test('composeStarter on the pnpm fixture: suites api+web(+shared), shared → "*", per-package rules, four bookkeeping rules, and it passes readDeclaration (AC1)', () => {
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs(PNPM) });
  const decl = composeStarter({ workspace: ws, rootScripts: { typecheck: 'tsc -b', lint: 'eslint .' } });
  assert.deepStrictEqual(decl.checks, { types: 'tsc -b', lint: 'eslint .', tests: { api: 'pnpm --filter api test', web: 'pnpm --filter web test', shared: 'pnpm --filter shared test' } });
  assert.deepStrictEqual(decl.rules.slice(0, 3), [
    { match: 'apps/api/**', suites: ['api'], static: true },
    { match: 'apps/web/**', suites: ['web'], static: true },
    { match: 'packages/shared/**', suites: '*', static: true },
  ]);
  assert.deepStrictEqual(decl.rules.slice(3).map((r) => r.match), BOOKKEEPING_RULES);
  for (const r of decl.rules.slice(3)) assert.deepStrictEqual([r.suites, r.static], [[], false]);
  const parsed = readDeclaration('/x.json', { readFileSync: () => JSON.stringify(decl) });
  assert.strictEqual(parsed.ok, true, JSON.stringify(parsed.errors));
});

test('npm and yarn workspaces are told apart by the lockfile and use their own suite templates', () => {
  const base = {
    '/w/package.json': JSON.stringify({ name: 'root', workspaces: ['apps/*'] }),
    '/w/apps/api/package.json': JSON.stringify({ name: 'api', scripts: { test: 'jest' } }),
  };
  const npm = composeStarter({ workspace: detectWorkspace({ root: '/w', fsImpl: memFs({ ...base, '/w/package-lock.json': '{}' }) }) });
  assert.deepStrictEqual(npm.checks.tests, { api: 'npm test -w apps/api' });
  const yarn = composeStarter({ workspace: detectWorkspace({ root: '/w', fsImpl: memFs({ ...base, '/w/yarn.lock': '' }) }) });
  assert.deepStrictEqual(yarn.checks.tests, { api: 'yarn workspace api test' });
  const bare = detectWorkspace({ root: '/w', fsImpl: memFs(base) });
  assert.strictEqual(bare.tool, 'npm');
});

test('a package with no test script gets no rule unless it is shared; no test scripts at all → checks.tests omitted', () => {
  const files = {
    '/w/package.json': JSON.stringify({ name: 'root', workspaces: ['apps/*', 'packages/*'] }),
    '/w/apps/api/package.json': JSON.stringify({ name: 'api', scripts: { test: 'jest' }, dependencies: { util: '*' } }),
    '/w/apps/docs/package.json': JSON.stringify({ name: 'docs', scripts: { build: 'x' } }),
    '/w/packages/util/package.json': JSON.stringify({ name: 'util', scripts: { build: 'x' } }),
  };
  const decl = composeStarter({ workspace: detectWorkspace({ root: '/w', fsImpl: memFs(files) }) });
  assert.deepStrictEqual(decl.rules.filter((r) => r.suites !== undefined && r.static === true).map((r) => [r.match, r.suites]), [['apps/api/**', ['api']], ['packages/util/**', '*']]);
  const none = composeStarter({ workspace: detectWorkspace({ root: '/w', fsImpl: memFs({ '/w/package.json': JSON.stringify({ name: 'root', workspaces: ['apps/*'] }), '/w/apps/docs/package.json': JSON.stringify({ name: 'docs' }) }) }) });
  assert.ok(!('tests' in none.checks));
  assert.deepStrictEqual(none.rules.map((r) => r.match), BOOKKEEPING_RULES);
  assert.strictEqual(readDeclaration('/x.json', { readFileSync: () => JSON.stringify(none) }).ok, true);
});

test('single-package repo: root test/lint scripts, no types, bookkeeping rules only (AC2)', () => {
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs({ '/w/package.json': JSON.stringify({ name: 'one', scripts: { test: 'vitest run', lint: 'eslint .' } }) }) });
  assert.deepStrictEqual(ws, { tool: null, packages: [], skipped: [], rootScripts: { test: 'vitest run', lint: 'eslint .' } });
  // No explicit rootScripts: composeStarter defaults to the ones detectWorkspace read (one root read, not two).
  const decl = composeStarter({ workspace: ws });
  assert.deepStrictEqual(decl.checks, { lint: 'eslint .', tests: 'vitest run' });
  assert.deepStrictEqual(decl.rules.map((r) => r.match), BOOKKEEPING_RULES);
  assert.strictEqual(readDeclaration('/x.json', { readFileSync: () => JSON.stringify(decl) }).ok, true);
});

test('diffAgainstWorkspace reports extra declared suites and test-bearing packages without a suite (AC4)', () => {
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs(PNPM) });
  const decl = readDeclaration('/x.json', { readFileSync: () => JSON.stringify({ checks: { tests: { api: 'a', legacy: 'l' } }, rules: [] }) }).decl;
  assert.deepStrictEqual(diffAgainstWorkspace(decl, ws), { missingSuites: ['web', 'shared'], extraSuites: ['legacy'] });
  const clean = readDeclaration('/x.json', { readFileSync: () => JSON.stringify(composeStarter({ workspace: ws })) }).decl;
  assert.deepStrictEqual(diffAgainstWorkspace(clean, ws), { missingSuites: [], extraSuites: [] });
});

test('BOOKKEEPING_RULES is the four pipeline-owned globs in order', () => {
  assert.deepStrictEqual(BOOKKEEPING_RULES, ['docs/plans/*-ledger.md', '.claude-tweaks/pipelines/**', 'docs/superpowers/plans/**', 'docs/superpowers/specs/**']);
});

test('pnpmGlobs (via detectWorkspace) tolerates a trailing YAML comment, quoted or bare (A1)', () => {
  const files = {
    '/w/pnpm-workspace.yaml': "packages:\n  - 'apps/*'   # the apps\n  - packages/* # libs\n",
    '/w/apps/api/package.json': JSON.stringify({ name: 'api', scripts: { test: 'jest' } }),
    '/w/packages/util/package.json': JSON.stringify({ name: 'util', scripts: { test: 'jest' } }),
  };
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs(files) });
  assert.deepStrictEqual(ws.packages.map((p) => p.name).sort(), ['api', 'util']);
});

test('expandGlob walks `dir/**` recursively for nested package.json, and skips a `.` member entirely (A2)', () => {
  const files = {
    '/w/package.json': JSON.stringify({ name: 'root', workspaces: ['packages/**', '.'] }),
    '/w/packages/a/package.json': JSON.stringify({ name: 'a', scripts: { test: 'jest' } }),
    '/w/packages/nested/b/package.json': JSON.stringify({ name: 'b', scripts: { test: 'jest' } }),
  };
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs(files) });
  assert.deepStrictEqual(ws.packages.map((p) => p.path).sort(), ['packages/a', 'packages/nested/b']);
  // The `.` member contributes no package and no `./**` rule of its own.
  assert.ok(!ws.packages.some((p) => p.path === '.'));
  assert.ok(!ws.skipped.some((s) => s.glob === '.' || s.glob === './**'));
});

test('composeStarter falls back to the root test script when packages exist but none has one (A3)', () => {
  const files = {
    '/w/package.json': JSON.stringify({ name: 'root', workspaces: ['apps/*'], scripts: { test: 'turbo test' } }),
    '/w/apps/api/package.json': JSON.stringify({ name: 'api', scripts: { build: 'x' } }),
    '/w/apps/web/package.json': JSON.stringify({ name: 'web', scripts: { build: 'x' } }),
  };
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs(files) });
  const decl = composeStarter({ workspace: ws, rootScripts: { test: 'turbo test' } });
  assert.strictEqual(decl.checks.tests, 'turbo test');
  assert.deepStrictEqual(decl.rules.map((r) => r.match), BOOKKEEPING_RULES);
});

test('diffAgainstWorkspace treats a string-form checks.tests as a sentinel, not an extra suite named "tests" (A4)', () => {
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs(PNPM) });
  const decl = readDeclaration('/x.json', { readFileSync: () => JSON.stringify({ checks: { tests: 'node --test' }, rules: [] }) }).decl;
  assert.deepStrictEqual(decl.suites, ['tests']);
  const diff = diffAgainstWorkspace(decl, ws);
  assert.deepStrictEqual(diff.extraSuites, []);
  assert.deepStrictEqual(diff.missingSuites.sort(), ['api', 'shared', 'web']);
});

test('detectWorkspace reports skipped entries for a glob with no packages and a package with no name (A5)', () => {
  const files = {
    '/w/pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'missing/*'\n",
    '/w/apps/api/package.json': JSON.stringify({ name: 'api', scripts: { test: 'vitest run' } }),
    '/w/apps/noname/package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
  };
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs(files) });
  assert.deepStrictEqual(ws.packages.map((p) => p.name), ['api']);
  assert.deepStrictEqual(ws.skipped, [
    { path: 'apps/noname', reason: 'package.json has no name' },
    { glob: 'missing/*', reason: 'no packages under glob' },
  ]);
});

test('pnpmGlobs tolerates a column-0 `#` comment and a blank line inside the packages list without ending it (N1)', () => {
  const files = {
    '/w/pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n# generated\n\n  - 'packages/*'\n",
    '/w/apps/api/package.json': JSON.stringify({ name: 'api', scripts: { test: 'jest' } }),
    '/w/packages/util/package.json': JSON.stringify({ name: 'util', scripts: { test: 'jest' } }),
  };
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs(files) });
  assert.deepStrictEqual(ws.packages.map((p) => p.name).sort(), ['api', 'util']);
});

test('a `dir/*` glob skips node_modules/dot-dirs the same way `dir/**` does (N3)', () => {
  const files = {
    '/w/package.json': JSON.stringify({ name: 'root', workspaces: ['apps/*'] }),
    '/w/apps/.turbo/cache.json': '{}',
    '/w/apps/node_modules/.bin/x': '',
    '/w/apps/api/package.json': JSON.stringify({ name: 'api', scripts: { test: 'jest' } }),
    '/w/apps/dist/readme.txt': 'x',
  };
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs(files) });
  assert.deepStrictEqual(ws.packages.map((p) => p.path), ['apps/api']);
  assert.ok(!ws.skipped.some((s) => s.path === 'apps/.turbo' || s.path === 'apps/node_modules'));
  assert.deepStrictEqual(ws.skipped, [{ path: 'apps/dist', reason: 'no package.json' }]);
});

test('a `!` exclusion member is surfaced, not expanded, and its literal-dir shape drops the matching package (N4)', () => {
  const files = {
    '/w/package.json': JSON.stringify({ name: 'root', workspaces: ['packages/*', '!packages/legacy'] }),
    '/w/packages/util/package.json': JSON.stringify({ name: 'util', scripts: { test: 'jest' } }),
    '/w/packages/legacy/package.json': JSON.stringify({ name: 'legacy', scripts: { test: 'jest' } }),
  };
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs(files) });
  assert.deepStrictEqual(ws.packages.map((p) => p.name), ['util']);
  assert.ok(ws.skipped.some((s) => s.glob === '!packages/legacy' && s.reason === 'unsupported exclusion pattern — packages it excludes may still be proposed'));
});

test('a `dir/**` walk cut off by MAX_WALK_DEPTH reports it in `skipped` (N7)', () => {
  const files = {
    '/w/package.json': JSON.stringify({ name: 'root', workspaces: ['deep/**'] }),
    '/w/deep/a/b/c/d/e/f/g/package.json': JSON.stringify({ name: 'g', scripts: { test: 'jest' } }),
  };
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs(files) });
  assert.deepStrictEqual(ws.packages, []);
  assert.deepStrictEqual(ws.skipped, [{ glob: 'deep/**', reason: 'walk depth limit reached (6) — deeper packages not scanned' }]);
});

test('a pnpm-workspace.yaml that exists but cannot be read is treated as absent, never thrown (review 3c)', () => {
  const base = memFs({
    '/w/package.json': JSON.stringify({ name: 'root', workspaces: ['apps/*'] }),
    '/w/apps/api/package.json': JSON.stringify({ name: 'api', scripts: { test: 'vitest run' } }),
  });
  const fsImpl = {
    ...base,
    existsSync: (p) => p === '/w/pnpm-workspace.yaml' || base.existsSync(p),
    readFileSync: (p) => { if (p === '/w/pnpm-workspace.yaml') { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; } return base.readFileSync(p); },
  };
  const ws = detectWorkspace({ root: '/w', fsImpl });
  assert.strictEqual(ws.tool, 'npm');
  assert.deepStrictEqual(ws.packages.map((p) => p.name), ['api']);
});

test('an unparseable root package.json is surfaced in skipped, not merged with "no workspace" (review 3c)', () => {
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs({ '/w/package.json': '{ not json' }) });
  assert.strictEqual(ws.tool, null);
  assert.deepStrictEqual(ws.skipped, [{ path: 'package.json', reason: 'unparseable package.json' }]);
});

test('a package whose name or path is not shell-safe is skipped with a reason and never becomes a suite (review 3b)', () => {
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs({
    '/w/pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - packages/shared\n",
    '/w/apps/api/package.json': JSON.stringify({ name: 'api; touch /tmp/pwned', scripts: { test: 'vitest run' } }),
    '/w/apps/web/package.json': JSON.stringify({ name: '@scope/web', scripts: { test: 'vitest run' } }),
    '/w/packages/shared/package.json': JSON.stringify({ name: 'shared' }),
  }) });
  assert.deepStrictEqual(ws.packages.map((p) => p.name), ['@scope/web', 'shared']);
  assert.deepStrictEqual(ws.skipped, [{ path: 'apps/api', reason: 'package name or path is not shell-safe — not proposed as a suite' }]);
  const decl = composeStarter({ workspace: ws });
  assert.deepStrictEqual(Object.keys(decl.checks.tests), ['@scope/web']);
});

test('a symlinked workspace entry is reported in skipped rather than silently dropped, for `dir/*` and `dir/**` alike (review 3b)', () => {
  const files = {
    '/w/pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'libs/**'\n",
    '/w/apps/api/package.json': JSON.stringify({ name: 'api', scripts: { test: 'vitest run' } }),
    '/w/libs/core/package.json': JSON.stringify({ name: 'core', scripts: { test: 'vitest run' } }),
  };
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs(files, ['/w/apps/linked', '/w/libs/vendored']) });
  assert.deepStrictEqual(ws.packages.map((p) => p.name), ['api', 'core']);
  assert.deepStrictEqual(ws.skipped, [
    { path: 'apps/linked', reason: 'symlinked entry not followed' },
    { path: 'libs/vendored', reason: 'symlinked entry not followed' },
  ]);
});

test('AC1 literal fixture: packages/shared without a test script — checks.tests is exactly api+web, shared rule stays "*" (A8)', () => {
  const files = {
    '/w/pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - packages/shared\n",
    '/w/package.json': JSON.stringify({ name: 'root' }),
    '/w/apps/api/package.json': JSON.stringify({ name: 'api', scripts: { test: 'vitest run' }, dependencies: { shared: 'workspace:*' } }),
    '/w/apps/web/package.json': JSON.stringify({ name: 'web', scripts: { test: 'vitest run' }, dependencies: { shared: 'workspace:*' } }),
    '/w/packages/shared/package.json': JSON.stringify({ name: 'shared' }),
  };
  const ws = detectWorkspace({ root: '/w', fsImpl: memFs(files) });
  const decl = composeStarter({ workspace: ws });
  assert.deepStrictEqual(decl.checks.tests, { api: 'pnpm --filter api test', web: 'pnpm --filter web test' });
  const sharedRule = decl.rules.find((r) => r.match === 'packages/shared/**');
  assert.strictEqual(sharedRule.suites, '*');
});
