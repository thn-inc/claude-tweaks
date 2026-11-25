'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectSizeProxy, parseNumstat, classifyPath, sizeTier, computeSizeProxy } = require('../../../plugin/bin/lib/review-context/size-proxy');

const num = (rows) => rows.map(([p, n]) => `${n}\t0\t${p}`).join('\n');

test('AC1.1: 13 files / 350 lines with 10 bookkeeping files / 290 lines → files 3, lines 60, size medium', () => {
  const book = [
    '.claude-tweaks/pipelines/r/work/1-spec.md', '.claude-tweaks/pipelines/r/work/2-spec.md', '.claude-tweaks/pipelines/r/x.json',
    'docs/superpowers/plans/a.md', 'docs/superpowers/plans/b.md', 'docs/superpowers/plans/c.md', 'docs/superpowers/plans/d.md',
    'docs/plans/x-ledger.md', 'docs/plans/y-ledger.md', 'docs/plans/z-ledger.md',
  ];
  const rows = [['src/a.js', 20], ['src/b.js', 20], ['src/c.js', 20], ...book.map((p) => [p, 29])];
  const r = computeSizeProxy({ numstat: num(rows), decl: null });
  assert.equal(r.files, 3);
  assert.equal(r.lines, 60);
  assert.equal(r.size, 'medium');
  assert.equal(r.excluded.length, 10);
  assert.ok(r.excluded.every((e) => e.reason === 'bookkeeping'));
  assert.deepEqual(r.excluded.map((e) => e.file).sort(), [...book].sort());
});

test('AC2.1: package-lock.json (274 lines) is excluded as lockfile; tests/fixtures/x.jsonl is counted', () => {
  const r = computeSizeProxy({ numstat: num([['package-lock.json', 274], ['sub/yarn.lock', 5], ['tests/fixtures/x.jsonl', 7]]), decl: null });
  assert.deepEqual(r.excluded, [
    { file: 'package-lock.json', lines: 274, reason: 'lockfile' },
    { file: 'sub/yarn.lock', lines: 5, reason: 'lockfile' },
  ]);
  assert.equal(r.files, 1);
  assert.equal(r.lines, 7);
});

test('AC3.1: a declaration replaces the fallback list — a plan file is counted when only the ledger rule is declared', () => {
  const decl = { rules: [{ match: 'docs/plans/*-ledger.md', suites: [], static: false }] };
  const r = computeSizeProxy({ numstat: num([['docs/superpowers/plans/p.md', 10], ['docs/plans/x-ledger.md', 4]]), decl });
  assert.equal(r.files, 1);
  assert.equal(r.lines, 10);
  assert.deepEqual(r.excluded.map((e) => e.file), ['docs/plans/x-ledger.md']);
});

test('AC3.2: with decl null the same plan file is excluded through BOOKKEEPING_RULES', () => {
  const r = computeSizeProxy({ numstat: num([['docs/superpowers/plans/p.md', 10]]), decl: null });
  assert.equal(r.files, 0);
  assert.deepEqual(r.excluded, [{ file: 'docs/superpowers/plans/p.md', lines: 10, reason: 'bookkeeping' }]);
});

test('AC4.1: first matching rule wins — a suite-selecting rule ahead of a bookkeeping rule keeps the path counted', () => {
  const led = 'docs/plans/x-ledger.md';
  const book = { match: 'docs/plans/*-ledger.md', suites: [], static: false };
  assert.equal(classifyPath(led, { rules: [{ match: '**/*.md', suites: '*', static: true }, book] }), null);
  assert.equal(classifyPath(led, { rules: [{ match: '**/*.md', suites: null, impact: true, static: false }, book] }), null);
  assert.equal(classifyPath(led, { rules: [{ match: led, suites: [], static: true }] }), null);
  assert.equal(classifyPath(led, { rules: [book] }), 'bookkeeping');
});

test('AC5.1: a binary file (-\\t-\\tpath) counts as one file with 0 lines', () => {
  const r = computeSizeProxy({ numstat: '-\t-\timg/logo.png', decl: null });
  assert.equal(r.files, 1);
  assert.equal(r.lines, 0);
});

test('AC6.1: ownWork restricts the count to the listed paths', () => {
  const r = computeSizeProxy({ numstat: num([['a.js', 5], ['b.js', 7], ['package-lock.json', 90]]), decl: null, ownWork: ['a.js'] });
  assert.equal(r.files, 1);
  assert.equal(r.lines, 5);
  assert.deepEqual(r.excluded, []);
});

test('parseNumstat reads both NUL- and newline-separated input and keeps odd paths intact', () => {
  const want = [{ file: 'my dir/ünï.js', lines: 5 }, { file: 'b.js', lines: 3 }];
  assert.deepEqual(parseNumstat('3\t2\tmy dir/ünï.js\n1\t2\tb.js'), want);
  assert.deepEqual(parseNumstat('3\t2\tmy dir/ünï.js\0' + '1\t2\tb.js\0'), want);
  assert.deepEqual(parseNumstat(''), []);
});

test('sizeTier boundaries', () => {
  assert.equal(sizeTier(2, 49), 'low');
  assert.equal(sizeTier(3, 0), 'medium');
  assert.equal(sizeTier(0, 50), 'medium');
  assert.equal(sizeTier(9, 299), 'medium');
  assert.equal(sizeTier(10, 0), 'high');
  assert.equal(sizeTier(0, 300), 'high');
});

test('a lockfile under a bookkeeping glob is listed once with reason bookkeeping', () => {
  const r = computeSizeProxy({ numstat: num([['.claude-tweaks/pipelines/r/package-lock.json', 9]]), decl: null });
  assert.deepEqual(r.excluded, [{ file: '.claude-tweaks/pipelines/r/package-lock.json', lines: 9, reason: 'bookkeeping' }]);
});

function fakeGit(calls) {
  return (argv) => {
    calls.push(argv);
    if (argv[0] === 'rev-parse') return '/repo\n';
    return '5\t0\tsrc/a.js\0' + '9\t0\tdocs/superpowers/plans/x.md\0' + '4\t0\tsrc/b.js\0';
  };
}

test('collectSizeProxy passes the pinned numstat argv', () => {
  const calls = [];
  const r = collectSizeProxy({ base: 'main', branch: 'HEAD', git: fakeGit(calls), readDecl: () => ({ ok: false, errors: ['x'] }) });
  assert.deepEqual(calls[0], ['-c', 'core.quotePath=false', 'diff', '--numstat', '-z', '--no-renames', '--no-color', '--no-ext-diff', '--end-of-options', 'main...HEAD']);
  assert.equal(r.files, 2);
  assert.deepEqual(r.excluded.map((e) => e.file), ['docs/superpowers/plans/x.md']);
});

test('collectSizeProxy with filesFrom reads the list relative to cwd and drops blanks', () => {
  const seen = [];
  const r = collectSizeProxy({
    base: 'main', branch: 'HEAD', filesFrom: 'list.txt', cwd: '/work', git: fakeGit([]),
    readDecl: () => ({ ok: true, decl: null, missing: true }),
    readFile: (p) => { seen.push(p); return ' src/a.js \n\n'; },
  });
  assert.equal(require('node:path').resolve('/work', 'list.txt'), seen[0]);
  assert.equal(r.files, 1);
  assert.equal(r.lines, 5);
});

test('parseNumstat skips a record whose counts are not numbers', () => {
  assert.deepEqual(parseNumstat('x\ty\tfile.js\0'), []);
});
