'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  splitNul, parseNameStatusZ, splitLogZ,
  parseNumstatZ, parseStatusPorcelainZ, parseLsTreeZ, unquoteCPath,
} = require('../../plugin/bin/lib/git-z.js');

const isHeader = (t) => t.startsWith('\x01');

test('splitNul splits on NUL and drops empty tokens', () => {
  assert.deepEqual(splitNul('docs/a.md\0docs/café.md\0'), ['docs/a.md', 'docs/café.md']);
  assert.deepEqual(splitNul(null), []);
  assert.deepEqual(splitNul(undefined), []);
  assert.deepEqual(splitNul(''), []);
  assert.deepEqual(splitNul(' lead.md\0'), [' lead.md']);
});

test('parseNameStatusZ takes two paths for R/C statuses and one otherwise', () => {
  assert.deepEqual(
    parseNameStatusZ('M\0docs/café.md\0R100\0old.md\0new.md\0D\0gone.md\0'),
    [
      { status: 'M', paths: ['docs/café.md'] },
      { status: 'R100', paths: ['old.md', 'new.md'] },
      { status: 'D', paths: ['gone.md'] },
    ],
  );
  assert.deepEqual(parseNameStatusZ(null), []);
  assert.deepEqual(parseNameStatusZ(''), []);
});

test('splitLogZ groups tokens under headers and strips the one leading newline', () => {
  assert.deepEqual(
    splitLogZ('\x01100\0\ndocs/b.md\0\x01200\0\x01300\0\ndocs/a.md\0docs/café.md\0', isHeader),
    [
      { header: '\x01100', tokens: ['docs/b.md'] },
      { header: '\x01200', tokens: [] },
      { header: '\x01300', tokens: ['docs/a.md', 'docs/café.md'] },
    ],
  );
});

test('splitLogZ: a defensive leading newline before a header is stripped and the header still opens a record', () => {
  // Real git does not emit this shape (an empty commit's header is followed
  // directly by the next header, as in the test above); the strip-before-test
  // order just keeps a stray "\n" from hiding a header.
  assert.deepEqual(
    splitLogZ('\x01100\0\n\x01200\0\ndocs/a.md\0', isHeader),
    [
      { header: '\x01100', tokens: [] },
      { header: '\x01200', tokens: ['docs/a.md'] },
    ],
  );
});

test('splitLogZ drops tokens before any header and tolerates empty input', () => {
  assert.deepEqual(splitLogZ('stray\0\x01100\0\nx.md\0', isHeader), [{ header: '\x01100', tokens: ['x.md'] }]);
  assert.deepEqual(splitLogZ(null, isHeader), []);
  assert.deepEqual(splitLogZ('', isHeader), []);
});

test('AC1.1: real git -z output reports docs/café.md unquoted', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'git-z-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    // Pin the two settings a host's global config could flip: quotepath decides
    // whether the plain form below is C-quoted, gpgsign would make `commit` prompt.
    git('config', 'core.quotepath', 'true');
    git('config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(cwd, 'docs'));
    fs.writeFileSync(path.join(cwd, 'docs', 'a.md'), 'a\n');
    git('add', 'docs/a.md');
    git('commit', '-q', '-m', 'first');
    fs.writeFileSync(path.join(cwd, 'docs', 'café.md'), 'c\n');
    git('add', 'docs/café.md');

    // Without -z git C-quotes the path - the hazard the -z readers exist to avoid.
    assert.equal(git('diff', '--cached', '--name-only').trim(), '"docs/caf\\303\\251.md"');
    assert.ok(splitNul(git('diff', '--cached', '--name-only', '-z')).includes('docs/café.md'));
    assert.deepEqual(
      parseNameStatusZ(git('diff', '--cached', '--name-status', '-z')),
      [{ status: 'A', paths: ['docs/café.md'] }],
    );

    git('commit', '-q', '-m', 'second');
    const records = splitLogZ(git('log', '-z', '--format=%x01%ct', '--name-only'), isHeader);
    assert.equal(records.length, 2);
    assert.deepEqual(records[0].tokens, ['docs/café.md']);
    assert.deepEqual(records[1].tokens, ['docs/a.md']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('parseNumstatZ: plain, binary and rename records from real -z output', () => {
  assert.deepEqual(parseNumstatZ('1\t2\tdocs/café.md\u00000\t0\t\u0000docs/old.md\u0000docs/néw.md\u0000'), [
    { path: 'docs/café.md', additions: 1, deletions: 2 },
    { path: 'docs/néw.md', oldPath: 'docs/old.md', additions: 0, deletions: 0 },
  ]);
  assert.deepEqual(parseNumstatZ('-\t-\tassets/logo.png\u0000'), [{ path: 'assets/logo.png', additions: 0, deletions: 0 }]);
  assert.deepEqual(parseNumstatZ('1\t1\tdir/a\tb.md\u0000'), [{ path: 'dir/a\tb.md', additions: 1, deletions: 1 }]);
  assert.deepEqual(parseNumstatZ(''), []);
  assert.deepEqual(parseNumstatZ(null), []);
});

test('parseStatusPorcelainZ: raw paths, and the new-path-first rename order', () => {
  assert.deepEqual(parseStatusPorcelainZ(' M docs/café.md\u0000?? docs/ünt.yml\u0000'), [
    { xy: ' M', path: 'docs/café.md' },
    { xy: '??', path: 'docs/ünt.yml' },
  ]);
  assert.deepEqual(parseStatusPorcelainZ('R  docs/néw.md\u0000docs/old.md\u0000 M a.md\u0000'), [
    { xy: 'R ', path: 'docs/néw.md', origPath: 'docs/old.md' },
    { xy: ' M', path: 'a.md' },
  ]);
  assert.deepEqual(parseStatusPorcelainZ(''), []);
});

test('parseLsTreeZ: full-format records with raw names', () => {
  const sha = '1892bdfca6755927bb5dea46d624c4dbf38e2da4';
  assert.deepEqual(parseLsTreeZ(`100644 blob ${sha}\tdocs/café.md\u0000040000 tree ${sha}\tsub\u0000`), [
    { mode: '100644', type: 'blob', sha, path: 'docs/café.md' },
    { mode: '040000', type: 'tree', sha, path: 'sub' },
  ]);
  assert.deepEqual(parseLsTreeZ(''), []);
});

test('unquoteCPath: decodes octal UTF-8 bytes and escapes, leaves unquoted input alone', () => {
  assert.equal(unquoteCPath('"docs/caf\\303\\251.md"'), 'docs/café.md');
  assert.equal(unquoteCPath('"a\\tb\\"c\\\\d"'), 'a\tb"c\\d');
  assert.equal(unquoteCPath('docs/plain.md'), 'docs/plain.md');
});

test('parseNumstatZ: a truncated rename tail yields nothing; a rename is followed by the next plain record', () => {
  assert.deepEqual(parseNumstatZ('0\t0\t\u0000docs/old.md\u0000'), []);
  assert.deepEqual(parseNumstatZ('0\t0\t\u0000docs/old.md\u0000docs/new.md\u00003\t4\tx.md\u0000'), [
    { path: 'docs/new.md', oldPath: 'docs/old.md', additions: 0, deletions: 0 },
    { path: 'x.md', additions: 3, deletions: 4 },
  ]);
});

test('parseStatusPorcelainZ: copy and Y-column rename carry origPath; a token shorter than 4 characters is skipped', () => {
  assert.deepEqual(parseStatusPorcelainZ('C  b.md\u0000a.md\u0000'), [{ xy: 'C ', path: 'b.md', origPath: 'a.md' }]);
  assert.deepEqual(parseStatusPorcelainZ(' R b.md\u0000a.md\u0000'), [{ xy: ' R', path: 'b.md', origPath: 'a.md' }]);
  assert.deepEqual(parseStatusPorcelainZ('M a\u0000 M ok.md\u0000'), [{ xy: ' M', path: 'ok.md' }]);
});

test('unquoteCPath: the remaining C escapes decode, and an unknown backslash escape is kept literally', () => {
  assert.equal(unquoteCPath('"\\a\\b\\v\\f\\r"'), '\x07\b\v\f\r');
  assert.equal(unquoteCPath('"a\\qb"'), 'a\\qb');
});
