'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readDeclaration, generatedExemption } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'declaration.js'));

function fakeFs(files) {
  return {
    readFileSync: (p) => {
      if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return files[p];
    },
  };
}

const EXAMPLE = {
  checks: {
    types: 'pnpm typecheck',
    lint: 'pnpm lint',
    tests: { api: 'pnpm --filter api test', web: 'pnpm --filter web test' },
  },
  retry: { api: 'pnpm --filter api test -- {file}', web: 'pnpm --filter web test -- {file}' },
  rules: [
    { match: 'apps/api/**', suites: ['api'], static: true },
    { match: 'apps/web/**', suites: ['web'], static: true },
    { match: 'packages/shared/**', suites: '*', static: true },
    { match: 'docs/**/*.md', suites: [], static: false },
    { match: 'docs/plans/*-ledger.md', suites: [], static: false },
    { match: '.claude-tweaks/pipelines/**', suites: [], static: false },
  ],
  flaky: { files: ['apps/api/test/mailer.test.ts'], maxRetries: 1 },
};

test('a missing declaration file is ok with decl null (mode full) and missing:true, never a throw', () => {
  assert.deepStrictEqual(readDeclaration('/nope.json', fakeFs({})), { ok: true, decl: null, missing: true });
});

test('a non-ENOENT read failure is ok:false naming the path, distinct from "missing" (#1922 review L10)', () => {
  const fsImpl = {
    readFileSync: () => { const e = new Error('permission denied'); e.code = 'EACCES'; throw e; },
  };
  const r = readDeclaration('/d.json', fsImpl);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors.length, 1);
  assert.match(r.errors[0], /could not read \/d\.json/);
  assert.match(r.errors[0], /permission denied/);
});

test('the example declaration parses to the normalized shape', () => {
  const r = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify(EXAMPLE) }));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.decl.suites, ['api', 'web']);
  assert.strictEqual(r.decl.toolScoped, false);
  assert.strictEqual(r.decl.checks.types, 'pnpm typecheck');
  assert.strictEqual(r.decl.rules.length, 6);
  assert.deepStrictEqual(r.decl.rules[2], { match: 'packages/shared/**', suites: '*', static: true });
  assert.deepStrictEqual(r.decl.flaky, { files: ['apps/api/test/mailer.test.ts'], maxRetries: 1 });
  assert.deepStrictEqual(r.decl.retry, EXAMPLE.retry);
});

test('a string checks.tests declares the single suite "tests"; one carrying {base} is tool-scoped', () => {
  const plain = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: 'npm test' }, rules: [] }) }));
  assert.strictEqual(plain.ok, true);
  assert.deepStrictEqual(plain.decl.suites, ['tests']);
  assert.strictEqual(plain.decl.toolScoped, false);
  assert.deepStrictEqual(plain.decl.flaky, { files: [], maxRetries: 1 });
  assert.deepStrictEqual(plain.decl.retry, {});
  const tool = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: 'pnpm vitest --changed {base}' }, rules: [] }) }));
  assert.strictEqual(tool.ok, true);
  assert.strictEqual(tool.decl.toolScoped, true);
  assert.deepStrictEqual(tool.decl.suites, ['tests']);
});

test('unparseable JSON is ok:false with one error naming the parse failure', () => {
  const r = readDeclaration('/d.json', fakeFs({ '/d.json': '{ not json' }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors.length, 1);
  assert.match(r.errors[0], /parse/i);
});

test('every invalid field is named, including the rule index and the unknown suite (AC6)', () => {
  const bad = {
    checks: { types: 7, tests: { api: 'x' } },
    retry: { web: 'no placeholder' },
    rules: [
      { match: 'a/**', suites: ['api', 'nope'], static: true },
      { match: 'b/**', suites: 'all', static: 'yes' },
      { suites: [], static: false },
    ],
    flaky: { files: 'not-an-array', maxRetries: 5 },
  };
  const r = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify(bad) }));
  assert.strictEqual(r.ok, false);
  const joined = r.errors.join('\n');
  assert.match(joined, /checks\.types/);
  assert.match(joined, /rules\[0\].*nope/);
  assert.match(joined, /rules\[1\].*suites/);
  assert.match(joined, /rules\[1\].*static/);
  assert.match(joined, /rules\[2\].*match/);
  assert.match(joined, /retry\.web/);
  assert.match(joined, /flaky\.files/);
  assert.match(joined, /flaky\.maxRetries/);
  assert.ok(r.errors.length >= 8, `expected every invalid field named, got ${r.errors.length}`);
});

test('an empty checks.tests, a non-object checks, and a non-array rules are errors', () => {
  assert.strictEqual(readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: '' }, rules: [] }) })).ok, false);
  assert.strictEqual(readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: 'x', rules: [] }) })).ok, false);
  assert.strictEqual(readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: 'x' } }) })).ok, false);
});

test('flaky.maxRetries defaults to 1 and accepts 0..2 only', () => {
  const zero = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: 'x' }, rules: [], flaky: { files: [], maxRetries: 0 } }) }));
  assert.strictEqual(zero.decl.flaky.maxRetries, 0);
  const two = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: 'x' }, rules: [], flaky: { files: [], maxRetries: 2 } }) }));
  assert.strictEqual(two.decl.flaky.maxRetries, 2);
  const dflt = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: 'x' }, rules: [], flaky: { files: ['a.js'] } }) }));
  assert.strictEqual(dflt.decl.flaky.maxRetries, 1);
  assert.strictEqual(readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: 'x' }, rules: [], flaky: { files: [], maxRetries: 3 } }) })).ok, false);
});

test('a present but wrong-typed checks.tests names its actual type, distinct from the required/missing message (#1922 review L15)', () => {
  const arr = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: ['a', 'b'] }, rules: [] }) }));
  assert.strictEqual(arr.ok, false);
  assert.match(arr.errors.join('\n'), /checks\.tests: must be a command string or a map of suite name to command, got object/);

  const num = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: 7 }, rules: [] }) }));
  assert.strictEqual(num.ok, false);
  assert.match(num.errors.join('\n'), /checks\.tests: must be a command string or a map of suite name to command, got number/);

  // empty string/object still keep the existing "required" message; undefined
  // is now valid (zero suites, #1924) — covered by the dedicated test below.
  const emptyStr = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: '' }, rules: [] }) }));
  assert.match(emptyStr.errors.join('\n'), /checks\.tests: required/);
  const emptyObj = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: {} }, rules: [] }) }));
  assert.match(emptyObj.errors.join('\n'), /checks\.tests: required/);
});

test('a non-string rules[i].suites entry names its type, not "unknown suite" (#1922 review L15)', () => {
  const r = readDeclaration('/d.json', fakeFs({
    '/d.json': JSON.stringify({
      checks: { tests: { api: 'a' } },
      rules: [{ match: 'x/**', suites: ['api', 7], static: true }],
    }),
  }));
  assert.strictEqual(r.ok, false);
  assert.match(r.errors.join('\n'), /rules\[0\]\.suites: entries must be strings, got number/);
  assert.ok(!r.errors.join('\n').includes('unknown suite'), 'a wrong-typed entry must not also fire the unknown-suite message');
});

test('preExisting defaults to [] and parses to the declared array verbatim (#3129)', () => {
  const dflt = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: 'npm test' }, rules: [] }) }));
  assert.deepStrictEqual(dflt.decl.preExisting, []);
  const declared = readDeclaration('/d.json', fakeFs({
    '/d.json': JSON.stringify({ checks: { tests: 'npm test' }, rules: [], preExisting: ['tests/known-shallow.test.js', 'tests/flaky-pid/**'] }),
  }));
  assert.strictEqual(declared.ok, true, JSON.stringify(declared.errors));
  assert.deepStrictEqual(declared.decl.preExisting, ['tests/known-shallow.test.js', 'tests/flaky-pid/**']);
});

test('preExisting must be an array of strings — a non-array or a non-string entry is an error naming the field (#3129)', () => {
  const notArray = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: 'x' }, rules: [], preExisting: 'tests/a.test.js' }) }));
  assert.strictEqual(notArray.ok, false);
  assert.match(notArray.errors.join('\n'), /preExisting: must be an array of path or glob strings/);
  const badEntry = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: 'x' }, rules: [], preExisting: ['tests/a.test.js', 7] }) }));
  assert.strictEqual(badEntry.ok, false);
  assert.match(badEntry.errors.join('\n'), /preExisting: must be an array of path or glob strings/);
});

test('generated defaults to [] and parses to the declared array verbatim (#2987)', () => {
  const dflt = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: 'npm test' }, rules: [] }) }));
  assert.deepStrictEqual(dflt.decl.generated, []);
  const declared = readDeclaration('/d.json', fakeFs({
    '/d.json': JSON.stringify({ checks: { tests: 'npm test' }, rules: [], generated: ['next-env.d.ts', 'packages/*/dist/**'] }),
  }));
  assert.strictEqual(declared.ok, true, JSON.stringify(declared.errors));
  assert.deepStrictEqual(declared.decl.generated, ['next-env.d.ts', 'packages/*/dist/**']);
});

test('generated must be an array of strings — a non-array or a non-string entry is an error naming the field (#2987)', () => {
  const notArray = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: 'x' }, rules: [], generated: 'next-env.d.ts' }) }));
  assert.strictEqual(notArray.ok, false);
  assert.match(notArray.errors.join('\n'), /generated: must be an array of path glob strings/);
  const badEntry = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: 'x' }, rules: [], generated: ['next-env.d.ts', 7] }) }));
  assert.strictEqual(badEntry.ok, false);
  assert.match(badEntry.errors.join('\n'), /generated: must be an array of path glob strings/);
});

test('a generated glob that would cover the declaration file itself is refused, naming the glob (#2987)', () => {
  for (const glob of ['**', '**/*', '*/**', '.claude-tweaks/**']) {
    const res = readDeclaration('/d.json', fakeFs({
      '/d.json': JSON.stringify({ checks: { tests: 'x' }, rules: [], generated: ['next-env.d.ts', glob] }),
    }));
    assert.strictEqual(res.ok, false, `${glob} was accepted`);
    assert.match(res.errors.join('\n'), /would also cover \.claude-tweaks\/verify-scope\.json itself/);
    assert.ok(res.errors.join('\n').includes(JSON.stringify(glob)), `error does not name ${glob}`);
  }
});

test('a generated glob covering a declaration read from a non-default path is refused too (#2987)', () => {
  const text = JSON.stringify({ checks: { tests: 'x' }, rules: [], generated: ['ci/**'] });
  const custom = readDeclaration('/d.json', fakeFs({ '/d.json': text }), { selfPath: 'ci/scope.json' });
  assert.strictEqual(custom.ok, false, 'ci/** covers the declaration actually read');
  assert.match(custom.errors.join('\n'), /"ci\/\*\*" would also cover ci\/scope\.json itself/);
  const atDefault = readDeclaration('/d.json', fakeFs({ '/d.json': text }));
  assert.strictEqual(atDefault.ok, true, 'the same glob is fine when the declaration lives at the default path');
});

test('a declaration with no checks.tests is valid — bookkeeping-only rules, zero suites (#1924)', () => {
  const r = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { lint: 'eslint .' }, rules: [{ match: 'docs/plans/*-ledger.md', suites: [], static: false }, { match: 'src/**', suites: '*', static: true }] }) }));
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.strictEqual(r.decl.checks.tests, null);
  assert.deepStrictEqual(r.decl.suites, []);
  assert.strictEqual(r.decl.toolScoped, false);
  const named = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: {}, rules: [{ match: 'src/**', suites: ['api'], static: true }] }) }));
  assert.strictEqual(named.ok, false);
  assert.match(named.errors.join('\n'), /rules\[0\].*api/);
  const empty = readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify({ checks: { tests: '' }, rules: [] }) }));
  assert.strictEqual(empty.ok, false);
});

test('generatedExemption exempts a dirty set only when every path matches a declared glob', () => {
  assert.deepStrictEqual(
    generatedExemption(['next-env.d.ts', 'dist/b.js', 'dist/a.js', 'dist/a.js'], ['next-env.d.ts', 'dist/**']),
    ['dist/a.js', 'dist/b.js', 'next-env.d.ts'],
  );
  assert.strictEqual(generatedExemption(['dist/a.js', 'src/edit.js'], ['dist/**']), null);
  assert.strictEqual(generatedExemption([], ['dist/**']), null);
  assert.strictEqual(generatedExemption(null, ['dist/**']), null);
});

// #4024: the `impact` block and the impact rule kind.
const IMPACT = { suite: 'tests', command: 'run {files}', tests: ['tests/**/*.test.js'] };
function readJson(obj) { return readDeclaration('/d.json', fakeFs({ '/d.json': JSON.stringify(obj) })); }

test('a valid impact block parses (#4024)', () => {
  const r = readJson({ checks: { tests: 'npm test' }, impact: IMPACT, rules: [{ match: 'src/**', impact: true, static: true }] });
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.deepStrictEqual(r.decl.impact, { suite: 'tests', command: 'run {files}', tests: ['tests/**/*.test.js'], maxAgeCommits: 200, map: null, fetch: null });
  assert.deepStrictEqual(r.decl.rules[0], { match: 'src/**', suites: null, impact: true, static: true });
});

test('a fully declared impact block keeps every optional field; a map-form suite name is accepted (#4024)', () => {
  const full = { suite: 'api', command: 'pnpm vitest {files}', tests: ['apps/api/**/*.test.ts', 'packages/**/*.test.ts'], maxAgeCommits: 50, map: '{git-common-dir}/maps/impact.json', fetch: 'node fetch-map.js' };
  const r = readJson({ checks: { tests: { api: 'pnpm --filter api test', web: 'x' } }, impact: full, rules: [{ match: 'apps/api/**', impact: true, static: false }, { match: 'apps/web/**', suites: ['web'], static: true }] });
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.deepStrictEqual(r.decl.impact, full);
  assert.deepStrictEqual(r.decl.rules[0], { match: 'apps/api/**', suites: null, impact: true, static: false });
  assert.deepStrictEqual(r.decl.rules[1], { match: 'apps/web/**', suites: ['web'], static: true }, 'a non-impact rule carries no impact key');
  const rel = readJson({ checks: { tests: 'npm test' }, impact: { ...IMPACT, map: '.cache/impact.json' }, rules: [] });
  assert.strictEqual(rel.ok, true, JSON.stringify(rel.errors));
  assert.strictEqual(rel.decl.impact.map, '.cache/impact.json');
});

test('every invalid impact field is named (#4024)', () => {
  const r = readJson({
    checks: { tests: 'npm test' },
    impact: { suite: 'nope', command: 'run', tests: [], maxAgeCommits: 0, map: '../x', fetch: '' },
    rules: [],
  });
  assert.strictEqual(r.ok, false);
  const joined = r.errors.join('\n');
  assert.match(joined, /impact\.suite: unknown suite "nope" \(declared: tests\)/);
  assert.match(joined, /impact\.command: .*\{files\}/);
  assert.match(joined, /impact\.tests: /);
  assert.match(joined, /impact\.maxAgeCommits: /);
  assert.match(joined, /impact\.map: .*\{git-common-dir\}\//);
  assert.match(joined, /impact\.fetch: /);
  assert.strictEqual(r.errors.length, 6, joined);
});

test('impact.map refuses absolute paths, .. segments anywhere, and a misplaced {git-common-dir} (#4024)', () => {
  for (const map of ['/abs/map.json', 'C:\\maps\\m.json', 'a/../../m.json', 'a\\..\\m.json', '{git-common-dir}/../m.json', '{git-common-dir}/', '{git-common-dir}//abs.json', 'cache/{git-common-dir}/m.json', '', 7]) {
    const r = readJson({ checks: { tests: 'npm test' }, impact: { ...IMPACT, map }, rules: [] });
    assert.strictEqual(r.ok, false, `${JSON.stringify(map)} was accepted`);
    assert.match(r.errors.join('\n'), /impact\.map: /);
  }
});

test('impact field types: non-object block, wrong-typed fields, non-integer maxAgeCommits, unknown keys (#4024)', () => {
  const notObj = readJson({ checks: { tests: 'npm test' }, impact: 'yes', rules: [] });
  assert.strictEqual(notObj.ok, false);
  assert.match(notObj.errors.join('\n'), /impact: must be an object/);
  const bad = readJson({ checks: { tests: 'npm test' }, impact: { suite: 7, command: 7, tests: ['ok', ''], maxAgeCommits: 1.5, fetch: 3, extra: 1, other: 2 }, rules: [] });
  assert.strictEqual(bad.ok, false);
  const joined = bad.errors.join('\n');
  assert.match(joined, /impact\.suite: /);
  assert.match(joined, /impact\.command: /);
  assert.match(joined, /impact\.tests: /);
  assert.match(joined, /impact\.maxAgeCommits: /);
  assert.match(joined, /impact\.fetch: /);
  assert.match(joined, /impact: unknown key\(s\) "extra", "other"/);
  const missing = readJson({ checks: { tests: 'npm test' }, impact: {}, rules: [] });
  assert.strictEqual(missing.ok, false);
  assert.match(missing.errors.join('\n'), /impact\.suite: /);
  assert.match(missing.errors.join('\n'), /impact\.command: /);
  assert.match(missing.errors.join('\n'), /impact\.tests: /);
});

test('an impact rule needs the impact block (#4024)', () => {
  const r = readJson({ checks: { tests: 'npm test' }, rules: [{ match: 'src/**', impact: true, static: true }] });
  assert.strictEqual(r.ok, false);
  assert.match(r.errors.join('\n'), /rules\[0\]\.impact: .*impact block/);
  const invalid = readJson({ checks: { tests: 'npm test' }, impact: { ...IMPACT, command: 'run' }, rules: [{ match: 'src/**', impact: true, static: true }] });
  assert.strictEqual(invalid.ok, false);
  assert.match(invalid.errors.join('\n'), /rules\[0\]\.impact: .*impact block/);
});

test('an impact rule may not also carry suites, except the "*" legacy fallback (#4024)', () => {
  const r = readJson({ checks: { tests: 'npm test' }, impact: IMPACT, rules: [{ match: 'src/**', impact: true, suites: ['tests'], static: true }] });
  assert.strictEqual(r.ok, false);
  assert.match(r.errors.join('\n'), /rules\[0\]\.suites: .*impact rule/);
  // "*" is what a reader built before `impact` existed needs to read the rule (as: every suite).
  const legacy = readJson({ checks: { tests: 'npm test' }, impact: IMPACT, rules: [{ match: 'src/**', impact: true, suites: '*', static: true }] });
  assert.strictEqual(legacy.ok, true, JSON.stringify(legacy.errors));
  assert.deepStrictEqual(legacy.decl.rules[0], { match: 'src/**', suites: null, impact: true, static: true }, 'a current reader ignores the fallback');
});

test('rules[i].impact must be the boolean true when present; an impact rule still needs a boolean static (#4024)', () => {
  for (const impact of [false, 'true', 1, null]) {
    const r = readJson({ checks: { tests: 'npm test' }, impact: IMPACT, rules: [{ match: 'src/**', impact, suites: '*', static: true }] });
    assert.strictEqual(r.ok, false, `${JSON.stringify(impact)} was accepted`);
    assert.match(r.errors.join('\n'), /rules\[0\]\.impact: must be true/);
  }
  const noStatic = readJson({ checks: { tests: 'npm test' }, impact: IMPACT, rules: [{ match: 'src/**', impact: true }] });
  assert.strictEqual(noStatic.ok, false);
  assert.match(noStatic.errors.join('\n'), /rules\[0\]\.static: must be a boolean/);
});

test('impact with a tool-scoped tests command is refused (#4024)', () => {
  const r = readJson({ checks: { tests: 'pnpm vitest --changed {base}' }, impact: IMPACT, rules: [] });
  assert.strictEqual(r.ok, false);
  assert.match(r.errors.join('\n'), /impact: .*\{base\}/);
});

test('no impact block → decl.impact is null and rules keep exactly {match, suites, static} (#4024)', () => {
  const r = readJson(EXAMPLE);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.strictEqual(r.decl.impact, null);
  assert.deepStrictEqual(r.decl.rules[2], { match: 'packages/shared/**', suites: '*', static: true });
  assert.ok(r.decl.rules.every((rule) => !('impact' in rule)), 'a non-impact rule must carry no impact key');
  const zero = readJson({ checks: {}, rules: [] });
  assert.strictEqual(zero.ok, true);
  assert.strictEqual(zero.decl.impact, null);
});

test('a ci block declares a CI source per suite, with wait/poll defaults (#4347)', () => {
  const r = readJson({ ...EXAMPLE, ci: { api: { workflow: 'test.yml', job: 'test' }, web: { workflow: 'web.yml', job: 'unit', waitSeconds: 60, pollSeconds: 5 } } });
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.deepStrictEqual(r.decl.ci, {
    api: { workflow: 'test.yml', job: 'test', waitSeconds: 900, pollSeconds: 20 },
    web: { workflow: 'web.yml', job: 'unit', waitSeconds: 60, pollSeconds: 5 },
  });
});

test('no ci block → decl.ci is null (#4347)', () => {
  assert.strictEqual(readJson(EXAMPLE).decl.ci, null);
});

test('every invalid ci field is reported (#4347)', () => {
  const r = readJson({
    ...EXAMPLE,
    ci: {
      nope: { workflow: 'a.yml', job: 'j' },
      api: { workflow: '', job: 3, waitSeconds: 0, pollSeconds: 1.5, extra: true },
    },
  });
  assert.strictEqual(r.ok, false);
  const text = r.errors.join('\n');
  assert.match(text, /ci\.nope: unknown suite/);
  assert.match(text, /ci\.api\.workflow: must be a non-empty string/);
  assert.match(text, /ci\.api\.job: must be a non-empty string/);
  assert.match(text, /ci\.api\.waitSeconds: must be a positive integer/);
  assert.match(text, /ci\.api\.pollSeconds: must be a positive integer/);
  assert.match(text, /ci\.api: unknown key\(s\) "extra"/);
  assert.match(readJson({ ...EXAMPLE, ci: [] }).errors.join('\n'), /ci: must be an object/);
  assert.match(readJson({ ...EXAMPLE, ci: { api: 'test.yml' } }).errors.join('\n'), /ci\.api: must be an object/);
});

test('a ci source on a tool-scoped tests command is refused (#4347)', () => {
  const r = readJson({ checks: { tests: 'pnpm vitest --changed {base}' }, ci: { tests: { workflow: 'a.yml', job: 'j' } }, rules: [] });
  assert.strictEqual(r.ok, false);
  assert.match(r.errors.join('\n'), /ci\.tests: .*\{base\}/);
});
