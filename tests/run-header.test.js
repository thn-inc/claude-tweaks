'use strict';

// run-header — the one resolver for where a spec header (work/{N}-spec.md)
// lives, live or archived (#3974).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PIPELINES_REL,
  ARCHIVE_SEGMENT,
  HEADER_PATH_RE,
  runIdentity,
  checkoutRootOf,
  headerRelPaths,
  headerPathspecs,
  headerTreeDirs,
  findHeaderFiles,
  listHeaderDirs,
} = require('../plugin/bin/lib/run-header');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');

const P = '.claude-tweaks/pipelines';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'run-header-'));
}

// Writes `rel` (POSIX, repo-relative) under `root`, creating parents.
function put(root, rel, body = '# header\n') {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
}

test('constants', () => {
  assert.strictEqual(PIPELINES_REL, '.claude-tweaks/pipelines');
  assert.strictEqual(ARCHIVE_SEGMENT, 'archive');
});

test('HEADER_PATH_RE matches both header locations and nothing else', () => {
  assert.ok(HEADER_PATH_RE.test('work/5-spec.md'));
  assert.ok(HEADER_PATH_RE.test(`${P}/R/work/5-spec.md`));
  assert.ok(HEADER_PATH_RE.test(`${P}/R/spec-5/work/5-spec.md`));
  assert.ok(HEADER_PATH_RE.test(`${P}/archive/R/spec-12/work/12-spec.md`));
  assert.ok(!HEADER_PATH_RE.test(`${P}/R/work/5-plan.md`));
  assert.ok(!HEADER_PATH_RE.test(`${P}/R/notwork/5-spec.md`));
  assert.ok(!HEADER_PATH_RE.test(`${P}/R/5-spec.md`));
  assert.ok(!HEADER_PATH_RE.test(`${P}/R/work/5-spec.md.bak`));
});

test('runIdentity: per-spec dir under a run-id parent yields the parent run id and N', () => {
  assert.deepStrictEqual(
    runIdentity('/p/.claude-tweaks/pipelines/2026-10-22T184947-spec-1-2/spec-7'),
    { runId: '2026-10-22T184947-spec-1-2', specN: 7 },
  );
});

test('runIdentity: a plain run dir yields its basename and a null specN', () => {
  assert.deepStrictEqual(
    runIdentity('/p/.claude-tweaks/pipelines/2026-08-22T061958-record-991'),
    { runId: '2026-08-22T061958-record-991', specN: null },
  );
});

test('runIdentity: spec-N under a non-run-id parent is itself the run id', () => {
  assert.deepStrictEqual(runIdentity('/x/spec-7'), { runId: 'spec-7', specN: null });
});

test('runIdentity: unusable input is null', () => {
  assert.strictEqual(runIdentity(''), null);
  assert.strictEqual(runIdentity('.'), null);
  assert.strictEqual(runIdentity('..'), null);
  assert.strictEqual(runIdentity(undefined), null);
  assert.strictEqual(runIdentity(42), null);
});

test('headerRelPaths: live-flat, live-nested, archived-flat, archived-nested', () => {
  assert.deepStrictEqual(headerRelPaths('R', 5), [
    `${P}/R/work/5-spec.md`,
    `${P}/R/spec-5/work/5-spec.md`,
    `${P}/archive/R/work/5-spec.md`,
    `${P}/archive/R/spec-5/work/5-spec.md`,
  ]);
});

test("headerRelPaths: shape 'nested' drops the flat entries", () => {
  assert.deepStrictEqual(headerRelPaths('R', 5, { shape: 'nested' }), [
    `${P}/R/spec-5/work/5-spec.md`,
    `${P}/archive/R/spec-5/work/5-spec.md`,
  ]);
});

test('headerRelPaths: specN set names only that spec dir, live then archived', () => {
  assert.deepStrictEqual(headerRelPaths('R', 5, { specN: 5 }), [
    `${P}/R/spec-5/work/5-spec.md`,
    `${P}/archive/R/spec-5/work/5-spec.md`,
  ]);
});

test('headerPathspecs: parent or single run carries the trailing wildcard on the nested form', () => {
  assert.deepStrictEqual(headerPathspecs('R'), [
    `${P}/R/work`,
    `${P}/R/spec-*/work/*`,
    `${P}/archive/R/work`,
    `${P}/archive/R/spec-*/work/*`,
  ]);
});

test('headerPathspecs: per-spec form names only that spec', () => {
  assert.deepStrictEqual(headerPathspecs('R', { specN: 4 }), [
    `${P}/R/spec-4/work/*`,
    `${P}/archive/R/spec-4/work/*`,
  ]);
});

test('headerTreeDirs: run dirs, suffixed with spec-N for a per-spec run', () => {
  assert.deepStrictEqual(headerTreeDirs('R'), [`${P}/R`, `${P}/archive/R`]);
  assert.deepStrictEqual(headerTreeDirs('R', { specN: 4 }), [`${P}/R/spec-4`, `${P}/archive/R/spec-4`]);
});

test('findHeaderFiles: live and archived in one root come back live first', () => {
  const root = tmp();
  try {
    const archived = put(root, `${P}/archive/R/work/5-spec.md`);
    const live = put(root, `${P}/R/work/5-spec.md`);
    assert.deepStrictEqual(findHeaderFiles([root], 'R', 5), [live, archived]);
    assert.deepStrictEqual(live, path.join(root, '.claude-tweaks', 'pipelines', 'R', 'work', '5-spec.md'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findHeaderFiles: roots are walked in caller order, archived-in-root-1 before live-in-root-2', () => {
  const r1 = tmp();
  const r2 = tmp();
  try {
    const a1 = put(r1, `${P}/archive/R/spec-5/work/5-spec.md`);
    const l2 = put(r2, `${P}/R/work/5-spec.md`);
    assert.deepStrictEqual(findHeaderFiles([r1, r2], 'R', 5), [a1, l2]);
    assert.deepStrictEqual(findHeaderFiles([r2, r1], 'R', 5), [l2, a1]);
  } finally {
    fs.rmSync(r1, { recursive: true, force: true });
    fs.rmSync(r2, { recursive: true, force: true });
  }
});

test('findHeaderFiles: flat before nested within one location', () => {
  const root = tmp();
  try {
    const nested = put(root, `${P}/R/spec-5/work/5-spec.md`);
    const flat = put(root, `${P}/R/work/5-spec.md`);
    assert.deepStrictEqual(findHeaderFiles([root], 'R', 5), [flat, nested]);
    assert.deepStrictEqual(findHeaderFiles([root], 'R', 5, { shape: 'nested' }), [nested]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findHeaderFiles: a missing root, a directory at the header path, and junk roots yield nothing and never throw', () => {
  const root = tmp();
  try {
    fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', 'R', 'work', '5-spec.md'), { recursive: true });
    const missing = path.join(root, 'does-not-exist');
    assert.deepStrictEqual(findHeaderFiles([missing], 'R', 5), []);
    assert.deepStrictEqual(findHeaderFiles([root], 'R', 5), []);
    assert.deepStrictEqual(findHeaderFiles([null, undefined, 3], 'R', 5), []);
    assert.deepStrictEqual(findHeaderFiles(undefined, 'R', 5), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A symlink's target decides what it is, as it did for the pre-#3974 readers'
// followed reads (`readdirSync(base/work)`, `readFile(header)`): a link to a
// regular file is a header, a link to a directory is a header dir, and a
// dangling, looping or wrong-typed link is absent. Skipped where the platform
// cannot create a symlink (an unprivileged Windows account).
function symlinkOrSkip(t, target, link, type) {
  try {
    fs.symlinkSync(target, link, type);
    return true;
  } catch (err) {
    t.skip(`cannot create a symlink here (${err.code})`);
    return false;
  }
}

test('findHeaderFiles: a symlink to a regular file counts; a dangling link and a link to a directory do not', (t) => {
  const root = tmp();
  try {
    const store = path.join(root, 'store');
    fs.mkdirSync(store);
    const target = put(store, 'real.md');
    const live = path.join(root, '.claude-tweaks', 'pipelines', 'R');
    fs.mkdirSync(path.join(live, 'work'), { recursive: true });
    fs.mkdirSync(path.join(live, 'spec-5', 'work'), { recursive: true });
    fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', 'R', 'work'), { recursive: true });
    const flat = path.join(live, 'work', '5-spec.md');
    if (!symlinkOrSkip(t, target, flat)) return;
    symlinkOrSkip(t, path.join(store, 'nowhere.md'), path.join(root, '.claude-tweaks', 'pipelines', 'archive', 'R', 'work', '5-spec.md'));
    symlinkOrSkip(t, store, path.join(live, 'spec-5', 'work', '5-spec.md'), 'dir');
    assert.deepStrictEqual(findHeaderFiles([root], 'R', 5), [flat]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listHeaderDirs: a symlinked work/ dir is listed; a dangling link and a link to a regular file are not', (t) => {
  const root = tmp();
  try {
    const store = path.join(root, 'store');
    const realDir = path.join(store, 'real-work');
    fs.mkdirSync(realDir, { recursive: true });
    const file = put(store, 'plain.md');
    const live = path.join(root, '.claude-tweaks', 'pipelines', 'R');
    const archived = path.join(root, '.claude-tweaks', 'pipelines', 'archive', 'R');
    fs.mkdirSync(path.join(live, 'spec-2'), { recursive: true });
    fs.mkdirSync(path.join(live, 'spec-3'), { recursive: true });
    fs.mkdirSync(archived, { recursive: true });
    if (!symlinkOrSkip(t, realDir, path.join(live, 'work'), 'dir')) return;
    symlinkOrSkip(t, realDir, path.join(live, 'spec-2', 'work'), 'dir');
    symlinkOrSkip(t, file, path.join(live, 'spec-3', 'work'));
    symlinkOrSkip(t, path.join(store, 'nowhere'), path.join(archived, 'work'), 'dir');
    const got = listHeaderDirs([root], 'R').map((e) => [e.dir, e.location, e.shape]);
    assert.deepStrictEqual(got, [
      [path.join(live, 'work'), 'live', 'flat'],
      [path.join(live, 'spec-2', 'work'), 'live', 'nested'],
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listHeaderDirs: live flat, live spec-N ascending, then archived flat, with location tags', () => {
  const root = tmp();
  try {
    put(root, `${P}/R/spec-9/work/9-spec.md`);
    put(root, `${P}/R/spec-2/work/2-spec.md`);
    put(root, `${P}/archive/R/work/1-spec.md`);
    put(root, `${P}/R/spec-10/notwork/10-spec.md`); // no work/ dir: not listed
    const abs = (...p) => path.join(root, '.claude-tweaks', 'pipelines', ...p);
    assert.deepStrictEqual(listHeaderDirs([root], 'R'), [
      { dir: abs('R', 'spec-2', 'work'), location: 'live', specN: 2, shape: 'nested', root },
      { dir: abs('R', 'spec-9', 'work'), location: 'live', specN: 9, shape: 'nested', root },
      { dir: abs('archive', 'R', 'work'), location: 'archived', specN: null, shape: 'flat', root },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listHeaderDirs: flat live work dir comes before nested ones; archived nested sorts numerically', () => {
  const root = tmp();
  try {
    put(root, `${P}/R/work/1-spec.md`);
    put(root, `${P}/R/spec-3/work/3-spec.md`);
    put(root, `${P}/archive/R/spec-10/work/10-spec.md`);
    put(root, `${P}/archive/R/spec-2/work/2-spec.md`);
    const got = listHeaderDirs([root], 'R').map((e) => [e.location, e.specN]);
    assert.deepStrictEqual(got, [
      ['live', null],
      ['live', 3],
      ['archived', 2],
      ['archived', 10],
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listHeaderDirs: any spec-* dir is listed — numeric spec-N ascending first (specN a number), then non-numeric names lexically (specN null)', () => {
  const root = tmp();
  try {
    put(root, `${P}/R/spec-991-995/work/991-spec.md`);
    put(root, `${P}/R/spec-10/work/10-spec.md`);
    put(root, `${P}/R/spec-alpha/work/1-spec.md`);
    put(root, `${P}/R/spec-2/work/2-spec.md`);
    put(root, `${P}/R/notspec/work/3-spec.md`); // not spec-*: not listed
    const got = listHeaderDirs([root], 'R').map((e) => [path.basename(path.dirname(e.dir)), e.specN]);
    assert.deepStrictEqual(got, [
      ['spec-2', 2],
      ['spec-10', 10],
      ['spec-991-995', null],
      ['spec-alpha', null],
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listHeaderDirs: a per-spec run lists only its own spec-N/work at both locations', () => {
  const root = tmp();
  try {
    put(root, `${P}/R/work/1-spec.md`);
    put(root, `${P}/R/spec-4/work/4-spec.md`);
    put(root, `${P}/R/spec-5/work/5-spec.md`);
    put(root, `${P}/archive/R/spec-4/work/4-spec.md`);
    const got = listHeaderDirs([root], 'R', { specN: 4 });
    assert.deepStrictEqual(got.map((e) => [e.location, e.specN]), [['live', 4], ['archived', 4]]);
    assert.strictEqual(got[0].dir, path.join(root, '.claude-tweaks', 'pipelines', 'R', 'spec-4', 'work'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listHeaderDirs: roots in caller order; a missing root and junk roots never throw', () => {
  const r1 = tmp();
  const r2 = tmp();
  try {
    put(r1, `${P}/archive/R/work/1-spec.md`);
    put(r2, `${P}/R/work/1-spec.md`);
    const got = listHeaderDirs([path.join(r1, 'nope'), r1, r2, null], 'R').map((e) => [e.root, e.location]);
    assert.deepStrictEqual(got, [[r1, 'archived'], [r2, 'live']]);
    assert.deepStrictEqual(listHeaderDirs(undefined, 'R'), []);
  } finally {
    fs.rmSync(r1, { recursive: true, force: true });
    fs.rmSync(r2, { recursive: true, force: true });
  }
});

test('listHeaderDirs: every entry carries its shape — flat for a run\'s own work/, nested for spec-*/work/', () => {
  const root = tmp();
  try {
    put(root, `${P}/R/work/1-spec.md`);
    put(root, `${P}/R/spec-3/work/3-spec.md`);
    put(root, `${P}/archive/R/work/1-spec.md`);
    put(root, `${P}/archive/R/spec-alpha/work/1-spec.md`);
    assert.deepStrictEqual(
      listHeaderDirs([root], 'R').map((e) => [e.location, e.shape]),
      [['live', 'flat'], ['live', 'nested'], ['archived', 'flat'], ['archived', 'nested']],
    );
    assert.deepStrictEqual(listHeaderDirs([root], 'R', { specN: 3 }).map((e) => e.shape), ['nested']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A run dir outside any .claude-tweaks/pipelines tree (a bare tmp fixture) has
// no checkout root; `runDir` makes the resolver read it directly (#3974).
test('findHeaderFiles: runDir of a root-less run dir yields its own work/ and spec-{n}/work/ header files', () => {
  const base = tmp();
  try {
    const runDir = path.join(base, 'R');
    const flat = put(runDir, 'work/5-spec.md');
    const nested = put(runDir, 'spec-5/work/5-spec.md');
    put(runDir, 'spec-6/work/5-spec.md'); // another spec's dir: not a candidate for 5
    assert.deepStrictEqual(findHeaderFiles([], 'R', 5, { runDir }), [flat, nested]);
    assert.deepStrictEqual(findHeaderFiles([], 'R', 5, { runDir, shape: 'nested' }), [nested]);
    assert.deepStrictEqual(findHeaderFiles([], 'R', 5, { runDir, specN: 7 }), [flat], 'per-spec: only the run dir\'s own work/');
    assert.deepStrictEqual(findHeaderFiles([], 'R', 5), [], 'without runDir the root-less dir is invisible');
    assert.deepStrictEqual(findHeaderFiles([], 'R', 99, { runDir }), []);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('listHeaderDirs: runDir of a root-less run dir lists its work/ (flat) and spec-*/work/ (nested) as live, root null', () => {
  const base = tmp();
  try {
    const runDir = path.join(base, 'R');
    put(runDir, 'work/1-spec.md');
    put(runDir, 'spec-9/work/9-spec.md');
    put(runDir, 'spec-2/work/2-spec.md');
    assert.deepStrictEqual(listHeaderDirs([], 'R', { runDir }), [
      { dir: path.join(runDir, 'work'), location: 'live', specN: null, shape: 'flat', root: null },
      { dir: path.join(runDir, 'spec-2', 'work'), location: 'live', specN: 2, shape: 'nested', root: null },
      { dir: path.join(runDir, 'spec-9', 'work'), location: 'live', specN: 9, shape: 'nested', root: null },
    ]);
    assert.deepStrictEqual(listHeaderDirs([], 'R', { runDir, specN: 4 }).map((e) => e.dir), [path.join(runDir, 'work')], 'per-spec: its own work/ only');
    assert.deepStrictEqual(listHeaderDirs([], 'R'), []);
    assert.deepStrictEqual(listHeaderDirs([], 'R', { runDir: path.join(base, 'absent') }), []);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('runDir is inert when the run dir sits under a .claude-tweaks/pipelines tree (the root-based lookup already covers it)', () => {
  const root = tmp();
  try {
    const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'R');
    const live = put(root, `${P}/R/work/5-spec.md`);
    assert.deepStrictEqual(findHeaderFiles([root], 'R', 5, { runDir }), [live]);
    assert.deepStrictEqual(listHeaderDirs([root], 'R', { runDir }).map((e) => e.root), [root]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkoutRootOf: the native path before the last .claude-tweaks/pipelines pair', () => {
  assert.strictEqual(
    checkoutRootOf(path.join('/a', 'b', '.claude-tweaks', 'pipelines', 'R')),
    path.join('/a', 'b'),
  );
  assert.strictEqual(
    checkoutRootOf(path.join('/a', 'b', '.claude-tweaks', 'pipelines', 'archive', 'R', 'spec-3')),
    path.join('/a', 'b'),
  );
  // The last pair wins when a checkout itself sits under a pipelines tree.
  assert.strictEqual(
    checkoutRootOf(path.join('/a', '.claude-tweaks', 'pipelines', 'x', '.claude-tweaks', 'pipelines', 'R')),
    path.join('/a', '.claude-tweaks', 'pipelines', 'x'),
  );
});

test('checkoutRootOf: null without a .claude-tweaks/pipelines pair', () => {
  assert.strictEqual(checkoutRootOf(path.join('/a', 'b', 'c')), null);
  assert.strictEqual(checkoutRootOf(path.join('/a', '.claude-tweaks', 'policy.yml')), null);
  assert.strictEqual(checkoutRootOf(''), null);
  assert.strictEqual(checkoutRootOf(undefined), null);
});

// The win32 branch, reached on any host through an injected path flavor
// (.claude/skills/windows-checkout-test-parity: inject the stdlib module).
test('checkoutRootOf (path.win32): drive, mixed separators, UNC, nested pair, and the bare drive root', () => {
  const w = path.win32;
  assert.strictEqual(checkoutRootOf('C:\\a\\b\\.claude-tweaks\\pipelines\\R', w), 'C:\\a\\b');
  assert.strictEqual(checkoutRootOf('C:/a/b/.claude-tweaks/pipelines/archive/R/spec-3', w), 'C:\\a\\b');
  assert.strictEqual(checkoutRootOf('\\\\server\\share\\repo\\.claude-tweaks\\pipelines\\R', w), '\\\\server\\share\\repo');
  assert.strictEqual(checkoutRootOf('\\\\server\\share\\.claude-tweaks\\pipelines\\R', w), '\\\\server\\share');
  assert.strictEqual(
    checkoutRootOf('D:\\a\\.claude-tweaks\\pipelines\\x\\.claude-tweaks\\pipelines\\R', w),
    'D:\\a\\.claude-tweaks\\pipelines\\x',
  );
  // A bare `C:` is drive-relative; the checkout root is the drive root `C:\`,
  // so a resolver join lands at C:\.claude-tweaks, not C:.claude-tweaks.
  assert.strictEqual(checkoutRootOf('C:\\.claude-tweaks\\pipelines\\R', w), 'C:\\');
  assert.strictEqual(w.join(checkoutRootOf('C:\\.claude-tweaks\\pipelines\\R', w), '.claude-tweaks'), 'C:\\.claude-tweaks');
  assert.strictEqual(checkoutRootOf('\\.claude-tweaks\\pipelines\\R', w), '\\');
  assert.strictEqual(checkoutRootOf('C:\\a\\b\\c', w), null);
});

test('checkoutRootOf (path.posix): absolute, filesystem root, relative, and a backslash that is not a separator', () => {
  const p = path.posix;
  assert.strictEqual(checkoutRootOf('/a/b/.claude-tweaks/pipelines/R', p), '/a/b');
  assert.strictEqual(checkoutRootOf('/.claude-tweaks/pipelines/R', p), '/');
  assert.strictEqual(checkoutRootOf('.claude-tweaks/pipelines/R', p), '.');
  assert.strictEqual(checkoutRootOf('C:/.claude-tweaks/pipelines/R', p), 'C:', 'a C: dir is an ordinary name on posix');
  assert.strictEqual(checkoutRootOf('/a\\.claude-tweaks\\pipelines\\R', p), null);
});

// ---------------------------------------------------------------------------
// Source scan (#3974): the spec-header location rule lives in run-header.js.
//
// Two pins over plugin/bin, comments stripped by the shared helper
// (tests/helpers/strip-comments.js; see .claude/skills/bin-source-scan-conformance):
//   1. the header READERS (seven readers, in the six READER_FILES; preflight.js
//      holds two) name neither the archive segment literal nor
//      `pipelines/archive`, nor a `work` path-segment literal -- a reader that
//      joins its own `work` dir reads only one location; headers resolve
//      through run-header.js;
//   2. no string or template literal outside the allowlist holds a header
//      filename (`${n}-spec.md`, `work/{n}-spec.md`, `work/*-spec.md`) -- a
//      reader that rebuilds the location rule on its own has to spell one.
//      `[}*\d'"`]-spec\.md` is the filename shape: the prefix class covers an
//      interpolation, a glob or a number before it, and a quote before it (a
//      literal that starts with the suffix, `n + '-spec.md'`); it keeps
//      `multi-spec.md` doc references out.
// ---------------------------------------------------------------------------

const BIN_ROOT = path.join(__dirname, '..', 'plugin', 'bin');

const READER_FILES = [
  'verify-run-bookends.js',
  'lib/flow/preflight.js',
  'lib/hooks/pre-tool-use.js',
  'lib/pr-bookkeeping/precondition.js',
  'lib/wrap-up/pack.js',
  'lib/dispatch/first-call-artifact-check.js',
];

// An allowlist entry that matches no site is stale and fails; `lines` keys an
// entry to the source lines (by substring) it covers, any other site in that
// file stays an offender.
const HEADER_ALLOWLIST = {
  'lib/run-header.js': { reason: 'the resolver: it owns the header filename and the live/archived location rule.' },
  'materialize.js': {
    reason: 'the header writer: it creates work/{n}-spec.md, it does not locate an existing header.',
    lines: ['path.join(workDir, `${opts.n}-spec.md`)'],
  },
  'lib/issues/blast-radius.js': {
    reason: 'classifier glob over changed files, not a header read path; it already matches the archived location.',
    lines: ["'.claude-tweaks/pipelines/**/work/*-spec.md'"],
  },
  'verify-run-bookends.js': {
    reason: 'user-facing text (usage line and materialize remedy message), not a read path.',
    lines: ['a committed work/{n}-spec.md', 'then commit work/${n}-spec.md'],
  },
};

const HEADER_FILENAME_RE = /[}*\d'"`]-spec\.md/g;

// End index (exclusive) of the string or template literal opening at `i` in
// `blank` (stripComments with literals: 'blank': bodies are spaces, delimiters
// and template `${…}` code stay).
function literalEnd(blank, i) {
  const q = blank[i];
  if (q !== '`') {
    let j = i + 1;
    while (j < blank.length && blank[j] !== q && blank[j] !== '\n') {
      j += blank[j] === '\\' ? 2 : 1; // a kept `\` is a line continuation
    }
    return blank[j] === q ? j + 1 : j;
  }
  let j = i + 1;
  while (j < blank.length) {
    if (blank[j] === '`') return j + 1;
    if (blank[j] === '$' && blank[j + 1] === '{') {
      j += 2;
      for (let depth = 0; j < blank.length; ) {
        const c = blank[j];
        if (c === "'" || c === '"' || c === '`') j = literalEnd(blank, j);
        else if (c === '{') { depth++; j++; }
        else if (c === '}') { j++; if (depth === 0) break; depth--; }
        else j++;
      }
    } else j++;
  }
  return j;
}

// Top-level string/template literal spans [start, end). A regex literal is not
// one: its body is blanked, so a quote inside it never opens a span.
function literalSpans(blank) {
  const spans = [];
  for (let i = 0; i < blank.length; ) {
    const c = blank[i];
    if (c === "'" || c === '"' || c === '`') {
      const end = literalEnd(blank, i);
      spans.push([i, end]);
      i = end;
    } else i++;
  }
  return spans;
}

// -> { sites: [{ line, text }], verdictOffender: string|null } for one file.
function headerSites(src) {
  const keep = stripComments(src);
  const blank = stripComments(src, { literals: 'blank' });
  for (const stripped of [keep, blank]) {
    const verdict = stripperVerdict(src, stripped);
    if (verdict !== 'ok') return { sites: [], verdictOffender: STRIPPER_VERDICT_MESSAGES[verdict] };
  }
  const lines = src.split('\n');
  const sites = [];
  for (const [start, end] of literalSpans(blank)) {
    for (const m of keep.slice(start, end).matchAll(HEADER_FILENAME_RE)) {
      const line = keep.slice(0, start + m.index).split('\n').length;
      sites.push({ line, text: lines[line - 1].trim() });
    }
  }
  return { sites, verdictOffender: null };
}

// files: { relPosixPath: source }; allowlist as HEADER_ALLOWLIST ->
// { offenders, allowed } (allowed = matched sites that sit on the allowlist).
function evaluateHeaderScan(files, allowlist) {
  const offenders = [];
  const allowed = [];
  const hitsByFile = {};
  const usedKeys = {};
  for (const [rel, entry] of Object.entries(allowlist)) {
    if (!entry || typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      offenders.push(`${rel}: allowlist entry has no reason`);
    }
  }
  for (const [rel, src] of Object.entries(files)) {
    const { sites, verdictOffender } = headerSites(src);
    if (verdictOffender) {
      offenders.push(`${rel}: ${verdictOffender}`);
      continue;
    }
    for (const site of sites) {
      const entry = allowlist[rel];
      const key = entry && (entry.lines ? entry.lines.find((k) => site.text.includes(k)) : true);
      if (!key) {
        offenders.push(`${rel}:${site.line}: header filename literal outside the allowlist -- resolve the header through plugin/bin/lib/run-header.js: ${site.text}`);
        continue;
      }
      allowed.push({ rel, ...site });
      hitsByFile[rel] = (hitsByFile[rel] || 0) + 1;
      if (key !== true) (usedKeys[rel] = usedKeys[rel] || new Set()).add(key);
    }
  }
  for (const [rel, entry] of Object.entries(allowlist)) {
    if (!(rel in files)) offenders.push(`${rel}: stale allowlist entry -- no such file under plugin/bin/`);
    else if (!hitsByFile[rel]) offenders.push(`${rel}: stale allowlist entry -- no header filename literal matches`);
    for (const k of entry.lines || []) {
      if (rel in files && !(usedKeys[rel] && usedKeys[rel].has(k))) offenders.push(`${rel}: stale allowlist line key -- matches nothing: ${k}`);
    }
  }
  return { offenders, allowed };
}

// Text bodies of every string, template-text piece and regex literal in the
// source -- [{ start, end, kind }] over `keep` offsets. `blank` is the same
// source with literal bodies blanked (delimiters, `${…}` code and offsets stay),
// so it shows where each literal sits; `keep` holds the body text. A template
// contributes one body per text piece around its `${…}` code (that code is
// scanned for literals of its own); a regex is a `/` pair whose blanked body
// held text (a division's slashes enclose only code, which blanks to itself).
function literalBodies(keep, blank) {
  const bodies = [];
  const scanTemplate = (i) => {
    let seg = i + 1;
    let j = i + 1;
    while (j < blank.length) {
      if (blank[j] === '`') {
        bodies.push({ start: seg, end: j, kind: 'template' });
        return j + 1;
      }
      if (blank[j] === '$' && blank[j + 1] === '{') {
        bodies.push({ start: seg, end: j, kind: 'template' });
        j = scanCode(j + 2, true);
        seg = j;
      } else j++;
    }
    bodies.push({ start: seg, end: j, kind: 'template' });
    return j;
  };
  const scanCode = (from, inInterpolation) => {
    let i = from;
    let depth = 0;
    while (i < blank.length) {
      const c = blank[i];
      if (c === "'" || c === '"') {
        const end = literalEnd(blank, i);
        bodies.push({ start: i + 1, end: blank[end - 1] === c && end - 1 > i ? end - 1 : end, kind: 'string' });
        i = end;
      } else if (c === '`') i = scanTemplate(i);
      else if (c === '/') {
        const close = blank.indexOf('/', i + 1);
        const body = close === -1 ? '' : blank.slice(i + 1, close);
        if (/^ +$/.test(body) && keep.slice(i + 1, close) !== body) {
          bodies.push({ start: i + 1, end: close, kind: 'regex' });
          i = close + 1;
        } else i++;
      } else if (inInterpolation && c === '{') { depth++; i++; }
      else if (inInterpolation && c === '}') {
        if (depth === 0) return i + 1;
        depth--;
        i++;
      } else i++;
    }
    return i;
  };
  scanCode(0, false);
  return bodies;
}

// Offsets (into `keep`) of every `work`/`archive` that is a whole path segment
// inside a literal body. Bounded on each side by the body's edge or a `/` (so
// `\/` too); in a regex also by a metacharacter `( ) | ? ^ $ [ ]` and, on the
// right, by `\/`. Any other neighbour -- a letter, digit, `_`, `-`, `.`, a space --
// means a longer word, a name or prose, not a segment.
const REGEX_BOUNDARY = '/()|?^$[]';
function segmentOffsets(keep, bodies) {
  const hits = [];
  for (const { start, end, kind } of bodies) {
    const text = keep.slice(start, end);
    for (const m of text.matchAll(/work|archive/g)) {
      const before = m.index === 0 ? null : text[m.index - 1];
      const at = m.index + m[0].length;
      const after = at === text.length ? null : text[at];
      const bounds = (ch) => ch === null || ch === '/' || (kind === 'regex' && REGEX_BOUNDARY.includes(ch));
      if (bounds(before) && (bounds(after) || (kind === 'regex' && after === '\\' && text[at + 1] === '/'))) hits.push(start + m.index);
    }
  }
  return hits;
}

// -> offender strings for one reader file: a `work`/`archive` path segment inside
// a string, template or regex literal (segmentOffsets), or the text
// `pipelines/archive`, comments excluded.
function readerOffenders(rel, src) {
  const keep = stripComments(src);
  const blank = stripComments(src, { literals: 'blank' });
  for (const stripped of [keep, blank]) {
    const verdict = stripperVerdict(src, stripped);
    if (verdict !== 'ok') return [`${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`];
  }
  const lines = keep.split('\n');
  const flagged = new Set();
  lines.forEach((text, i) => {
    if (/pipelines\/archive/.test(text)) flagged.add(i + 1);
  });
  for (const offset of segmentOffsets(keep, literalBodies(keep, blank))) flagged.add(keep.slice(0, offset).split('\n').length);
  return [...flagged].sort((a, b) => a - b).map((n) => `${rel}:${n}: ${lines[n - 1].trim()}`);
}

// A reader line the segment rule flags that is nonetheless not a header read.
// Same shape and stale-key rule as HEADER_ALLOWLIST: `lines` keys an entry to
// the offending lines (by substring), every other offender in the file stays,
// and an entry whose file or key matches nothing fails.
const READER_ALLOWLIST = {
  'lib/hooks/pre-tool-use.js': {
    reason: 'write-target carve-out for the pipeline-shadow guard (materialize writes the live header); not a header read -- whether archived writes need it is #3976\'s question.',
    lines: ['const WORK_SPEC_TAIL_RE = '],
  },
};

// files: { relPosixPath: source }; readerFiles: the rel paths to scan ->
// offender strings (comments excluded), allowlist applied.
function evaluateReaderScan(files, readerFiles, allowlist) {
  const offenders = [];
  const usedKeys = {};
  for (const [rel, entry] of Object.entries(allowlist)) {
    if (!entry || typeof entry.reason !== 'string' || entry.reason.trim() === '') offenders.push(`${rel}: allowlist entry has no reason`);
  }
  for (const rel of readerFiles) {
    if (!(rel in files)) {
      offenders.push(`${rel}: reader file not found under plugin/bin/`);
      continue;
    }
    const entry = allowlist[rel];
    for (const offender of readerOffenders(rel, files[rel])) {
      const key = entry && (entry.lines || []).find((k) => offender.includes(k));
      if (key) (usedKeys[rel] = usedKeys[rel] || new Set()).add(key);
      else offenders.push(offender);
    }
  }
  for (const [rel, entry] of Object.entries(allowlist)) {
    if (!readerFiles.includes(rel) || !(rel in files)) {
      offenders.push(`${rel}: stale allowlist entry -- not a reader file under plugin/bin/`);
      continue;
    }
    for (const k of (entry && entry.lines) || []) {
      if (!(usedKeys[rel] && usedKeys[rel].has(k))) offenders.push(`${rel}: stale allowlist line key -- matches nothing: ${k}`);
    }
  }
  return offenders;
}

function readBinTree(root = BIN_ROOT) {
  const files = {};
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files[path.relative(root, full).replace(/\\/g, '/')] = fs.readFileSync(full, 'utf8');
    }
  })(root);
  return files;
}

test('header scan matcher: flags a path.join with a literal work segment and a header filename template', () => {
  const src = "const p = path.join(dir, 'work', `${n}-spec.md`);\n";
  assert.deepStrictEqual(headerSites(src).sites, [{ line: 1, text: src.trim() }]);
});

test('header scan matcher: flags a filename template with no work segment in the same call (materialize.js shape)', () => {
  const src = 'const f = path.join(workDir, `${n}-spec.md`);\n';
  assert.deepStrictEqual(headerSites(src).sites, [{ line: 1, text: src.trim() }]);
});

test('header scan matcher: flags work/{n}-spec.md and work/*-spec.md text in plain strings, with exact lines', () => {
  const src = ["const a = 'x';", "const u = 'a committed work/{n}-spec.md';", 'const g = ".claude-tweaks/pipelines/**/work/*-spec.md";'].join('\n');
  assert.deepStrictEqual(headerSites(src).sites.map((s) => s.line), [2, 3]);
});

test('header scan matcher: the same text in a // or /* comment is not flagged', () => {
  const src = [
    "// const p = path.join(dir, 'work', `${n}-spec.md`);",
    "/* const q = path.join(dir, 'work', `${n}-spec.md`); */",
    'const ok = 1;',
  ].join('\n');
  assert.deepStrictEqual(headerSites(src).sites, []);
});

test('header scan matcher: a regex literal is not a string, and code after it is still scanned', () => {
  const re = '/work[/\\\\]\\d+-spec\\.md/';
  assert.deepStrictEqual(headerSites(`const re = ${re};\n`).sites, []);
  // A quote inside a regex must not open a fake string that swallows the next line.
  const src = ['const re = /[`"\']/;', 'const f = `${n}-spec.md`;'].join('\n');
  assert.deepStrictEqual(headerSites(src).sites.map((s) => s.line), [2]);
});

test('header scan matcher: flags a literal that starts with the suffix (concatenated header name)', () => {
  const src = ["const f = path.join(dir, n + '-spec.md');", 'const g = String(n) + "-spec.md";', 'const h = n + `-spec.md`;'].join('\n');
  assert.deepStrictEqual(headerSites(src).sites.map((s) => s.line), [1, 2, 3]);
});

test('header scan matcher: multi-spec.md doc references and nested template code are handled', () => {
  assert.deepStrictEqual(headerSites("const d = 'multi-spec.md';\n").sites, []);
  assert.deepStrictEqual(headerSites("const d = 'see multi-spec.md for the shape';\n").sites, []);
  // One site for a template whose ${} code holds its own string; code after it is still seen.
  const src = ["const t = `${a ? 'x' : 'y'}/work/${n}-spec.md`;", "const u = '1-spec.md';"].join('\n');
  assert.deepStrictEqual(headerSites(src).sites.map((s) => s.line), [1, 2]);
});

test('header scan: a comment-stripper mis-parse is reported as an offender, not a clean file', () => {
  const src = 'if (b) /"/.test(b); const c = "//"; const f = `${n}-spec.md`;';
  assert.deepStrictEqual(evaluateHeaderScan({ 'lib/x.js': src }, {}).offenders, [`lib/x.js: ${STRIPPER_VERDICT_MESSAGES.misparsed}`]);
});

test('header scan: a site outside the allowlist is an offender; a keyed file allows only its keyed lines', () => {
  const lone = { 'lib/new-reader.js': 'const f = path.join(workDir, `${n}-spec.md`);\n' };
  const res = evaluateHeaderScan(lone, {});
  assert.strictEqual(res.offenders.length, 1);
  assert.match(res.offenders[0], /^lib\/new-reader\.js:1: header filename literal outside the allowlist/);
  assert.strictEqual(evaluateHeaderScan(lone, { 'lib/new-reader.js': { reason: 'x' } }).offenders.length, 0);

  const keyed = { 'v.js': ["const u = 'a committed work/{n}-spec.md';", 'const p = `work/${n}-spec.md`;'].join('\n') };
  const entry = { reason: 'x', lines: ['a committed work/{n}-spec.md'] };
  const out = evaluateHeaderScan(keyed, { 'v.js': entry }).offenders;
  assert.strictEqual(out.length, 1);
  assert.match(out[0], /^v\.js:2: header filename literal outside the allowlist/);
});

test('header scan: a stale allowlist file, zero-match file, line key or missing reason is an offender', () => {
  const files = { 'a.js': "const x = 'nothing here';\n", 'b.js': "const u = 'work/{n}-spec.md';\n" };
  const offenders = evaluateHeaderScan(files, {
    'gone.js': { reason: 'x' },
    'a.js': { reason: 'x' },
    'b.js': { reason: 'x', lines: ['work/{n}-spec.md', 'a key that matches nothing'] },
  }).offenders;
  assert.deepStrictEqual(offenders, [
    'gone.js: stale allowlist entry -- no such file under plugin/bin/',
    'a.js: stale allowlist entry -- no header filename literal matches',
    'b.js: stale allowlist line key -- matches nothing: a key that matches nothing',
  ]);
  assert.deepStrictEqual(evaluateHeaderScan({ 'b.js': files['b.js'] }, { 'b.js': { reason: ' ' } }).offenders, ['b.js: allowlist entry has no reason']);
});

test('header scan: a second header literal in a one-site allowlisted file (materialize.js, blast-radius.js) is an offender', () => {
  const planted = {
    'materialize.js': ['const outFile = path.join(workDir, `${opts.n}-spec.md`);', 'const again = path.join(dir, `${n}-spec.md`);'].join('\n'),
    'lib/issues/blast-radius.js': ["const G = ['.claude-tweaks/pipelines/**/work/*-spec.md', 'docs/superpowers/plans/*.md'];", "const H = ['pipelines/**/work/*-spec.md'];"].join('\n'),
  };
  for (const [rel, src] of Object.entries(planted)) {
    const out = evaluateHeaderScan({ [rel]: src }, { [rel]: HEADER_ALLOWLIST[rel] }).offenders;
    assert.strictEqual(out.length, 1, `${rel}: ${JSON.stringify(out)}`);
    assert.match(out[0], new RegExp(`^${rel.replace(/[./]/g, '\\$&')}:2: header filename literal outside the allowlist`));
  }
});

test('reader scan matcher: an archive literal or pipelines/archive in code is flagged; in a comment it is not', () => {
  assert.deepStrictEqual(readerOffenders('r.js', "const a = path.join(d, 'archive', id);\n"), ["r.js:1: const a = path.join(d, 'archive', id);"]);
  assert.deepStrictEqual(readerOffenders('r.js', 'const a = "archive";\n'), ['r.js:1: const a = "archive";']);
  assert.deepStrictEqual(readerOffenders('r.js', 'const a = `archive`;\n'), ['r.js:1: const a = `archive`;']);
  assert.deepStrictEqual(readerOffenders('r.js', 'const a = `.claude-tweaks/pipelines/archive/${id}`;\n'), ['r.js:1: const a = `.claude-tweaks/pipelines/archive/${id}`;']);
  assert.deepStrictEqual(readerOffenders('r.js', "// the 'archive' dir, pipelines/archive\n/* \"archive\" */\nconst ok = 1;\n"), []);
  assert.deepStrictEqual(readerOffenders('r.js', 'if (b) /"/.test(b); const c = "//";'), [`r.js: ${STRIPPER_VERDICT_MESSAGES.misparsed}`]);
});

test('reader scan matcher: a work path-segment literal in code is flagged; in a comment, or as part of a longer string, it is not', () => {
  assert.deepStrictEqual(readerOffenders('r.js', "const w = path.join(runDir, 'work');\n"), ["r.js:1: const w = path.join(runDir, 'work');"]);
  assert.deepStrictEqual(readerOffenders('r.js', 'const w = path.join(runDir, sub, "work");\n'), ['r.js:1: const w = path.join(runDir, sub, "work");']);
  assert.deepStrictEqual(readerOffenders('r.js', 'const w = path.join(runDir, `work`);\n'), ['r.js:1: const w = path.join(runDir, `work`);']);
  assert.deepStrictEqual(readerOffenders('r.js', "// path.join(runDir, 'work')\n/* \"work\" */\nconst ok = 1;\n"), []);
  assert.deepStrictEqual(readerOffenders('r.js', "const label = `the work of ${name}`; const w = 'worker';\n"), []);
});

// The segment rule (F2): in comment-stripped reader source, `work` or `archive`
// is an offender when it is a whole path segment inside a string, template-text
// or regex literal -- bounded on each side by the literal's own edge (start or
// end of the string, of a template piece next to `${…}`, of the regex body), a
// `/` (which covers `\/`), or, in a regex only, a metacharacter `( ) | ? ^ $ [ ]`.
// A space, `-`, `.`, `_` or a letter is not a boundary: `'no work to do'` is
// prose, `'work-dir'`/`'archive.md'` are names, `worker`/`network`/`archived`
// are other words, and an identifier (`workDir`) is not inside a literal at all.
test('reader scan matcher: work/archive as a path segment inside a string, template or regex literal is flagged (every shape)', () => {
  const flagged = (src) => readerOffenders('r.js', `${src}\n`).length === 1;
  assert.ok(flagged('const a = `${rel}/work/`;'), '`${rel}/work/` template');
  assert.ok(flagged("const a = 'work/';"), "'work/' string");
  assert.ok(flagged('const a = `${runDir}/work`;'), '`${runDir}/work` template');
  assert.ok(flagged('const a = `${runDir}/archive/${id}`;'), 'archive segment in a template');
  assert.ok(flagged("const a = base + '/work';"), "'/work' string");
  assert.ok(flagged('const re = /(^|\\/)(spec-\\d+\\/)?work\\/\\d+-spec\\.md$/;'), 'the pre-#3974 specOnBranch regex');
  assert.ok(flagged('const re = /^archive$/;'), 'regex anchors bound a segment');
  assert.ok(flagged('const t = `${a ? `${b}/work` : x}`;'), 'a template nested in ${…} code');
});

test('reader scan matcher: worker, network, rework, archived, an identifier, prose, a name and a comment are not flagged', () => {
  const clean = (src) => assert.deepStrictEqual(readerOffenders('r.js', `${src}\n`), [], src);
  clean("const a = 'worker'; const b = 'network'; const c = 'rework'; const d = 'archived';");
  clean('const a = `${x}worker/${y}network`;');
  clean('const workDir = path.join(root, dir); const archiveDir = workDir; work(archive);');
  clean("const m = 'no work to do'; const n = `nothing to archive here`; const o = 'see work/ dir';");
  clean("const m = 'work-dir'; const n = 'archive.md'; const o = 'work_dir'; const p = `${x}.work`;");
  clean('const re = /\\bworker\\b/; const r2 = /no work to do/;');
  clean("// const a = `${rel}/work/`; const b = 'work/';\n/* const re = /(^|\\/)work\\/x/; */");
  assert.deepStrictEqual(
    readerOffenders('r.js', "const ok = 1;\n// 'work/'\nconst bad = 'work/';\n"),
    ["r.js:3: const bad = 'work/';"],
    'a comment line does not hide, or shift, the flagged line',
  );
});

test('reader scan matcher: the pre-#3974 flow/preflight.js specOnBranch location rule is flagged', () => {
  // Verbatim from `git show 5c7722f246d20628a8f8f7d8453e473e06748a8d:plugin/bin/lib/flow/preflight.js`.
  const src = [
    '  const direct = ls(`${rel}/work/`, false);',
    '  if (direct === null) return null;',
    '  if (splitNul(direct).some((l) => /(^|\\/)work\\/\\d+-spec\\.md$/.test(l))) return true;',
    '  const nested = ls(`${rel}/`, true);',
    '  return splitNul(nested).some((l) => /(^|\\/)(spec-\\d+\\/)?work\\/\\d+-spec\\.md$/.test(l));',
  ].join('\n');
  assert.deepStrictEqual(readerOffenders('lib/flow/preflight.js', src).map((o) => o.split(': ')[0]), [
    'lib/flow/preflight.js:1',
    'lib/flow/preflight.js:3',
    'lib/flow/preflight.js:5',
  ]);
});

test('reader scan: an allowlisted line is allowed only on its keyed line; a second work segment in the same file is still an offender', () => {
  const rel = 'lib/hooks/pre-tool-use.js';
  const allow = { [rel]: READER_ALLOWLIST[rel] };
  const carveOut = 'const WORK_SPEC_TAIL_RE = /^(?:spec-[^/\\\\]+[/\\\\])?work(?:[/\\\\]\\d+-spec\\.md)?$/;';
  const src = [carveOut, "const other = path.join(runDir, 'work');"].join('\n');
  assert.deepStrictEqual(evaluateReaderScan({ [rel]: src }, [rel], allow), [`${rel}:2: const other = path.join(runDir, 'work');`]);
  assert.deepStrictEqual(evaluateReaderScan({ [rel]: carveOut }, [rel], allow), []);
});

test('reader scan: a stale allowlist file, line key, or a missing reason is an offender', () => {
  const files = { 'a.js': "const ok = 1;\nconst w = path.join(d, 'work');\n", 'b.js': 'const ok = 1;\n' };
  const offenders = evaluateReaderScan(files, ['a.js', 'b.js'], {
    'a.js': { reason: 'x', lines: ["path.join(d, 'work')", 'a key that matches nothing'] },
    'b.js': { reason: 'x', lines: ['const ok'] },
    'gone.js': { reason: 'x', lines: ['y'] },
    'c.js': { reason: ' ', lines: ['z'] },
  });
  assert.deepStrictEqual(offenders, [
    'c.js: allowlist entry has no reason',
    'a.js: stale allowlist line key -- matches nothing: a key that matches nothing',
    'b.js: stale allowlist line key -- matches nothing: const ok',
    'gone.js: stale allowlist entry -- not a reader file under plugin/bin/',
    'c.js: stale allowlist entry -- not a reader file under plugin/bin/',
  ]);
});

test('AC 8: the header reader files name neither the archive segment, pipelines/archive, nor a work path segment (comments excluded)', () => {
  const offenders = evaluateReaderScan(readBinTree(), READER_FILES, READER_ALLOWLIST);
  assert.deepStrictEqual(offenders, [],'a header reader spells a header location itself -- resolve it through plugin/bin/lib/run-header.js');
});

test('AC 8: no header filename literal in plugin/bin outside run-header.js and the allowlist', () => {
  const { offenders, allowed } = evaluateHeaderScan(readBinTree(), HEADER_ALLOWLIST);
  assert.deepStrictEqual(offenders, [], 'a header filename literal outside the allowlist rebuilds the location rule -- use plugin/bin/lib/run-header.js, or allowlist it here with a reason');
  // Observed 6 when the scan landed: verify-run-bookends x2, materialize x1,
  // run-header x2, blast-radius x1. Fewer means the matcher stopped matching,
  // not that the sites went away. Raise on additions; never lower to go green.
  assert.ok(allowed.length >= 6, `matched ${allowed.length} allowlisted header-filename sites, expected at least 6 -- the matcher has stopped matching`);
});
