const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  resolveDir,
  buildContext,
  PER_FILE_CAP_BYTES,
  isAlwaysStub,
  elideDiff,
} = require('../../../plugin/bin/lib/review-context/build');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'build-review-context.js');

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

// Real-git fixture: base branch with two files, feature branch that modifies one,
// adds one, and deletes one — the deletion exercises the empty-section degradation.
function makeFixtureRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'review-ctx-fixture-'));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.invalid']);
  git(repo, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'kept.txt'), 'kept line 1\n');
  fs.writeFileSync(path.join(repo, 'doomed.txt'), 'doomed content\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'base']);
  git(repo, ['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(repo, 'kept.txt'), 'kept line 1\nkept line 2\n');
  fs.writeFileSync(path.join(repo, 'added.txt'), 'added content\n');
  fs.rmSync(path.join(repo, 'doomed.txt'));
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'feature work']);
  return repo;
}

// Deps that anchor git and file reads to the fixture repo, the way the CLI's
// process-cwd anchoring behaves when invoked from a checkout.
function repoDeps(repo) {
  return {
    git: (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }),
    readFile: (p, enc) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(repo, p), enc),
  };
}

test('resolveDir: explicit dir wins and is created recursively', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'review-ctx-test-'));
  const target = path.join(base, 'nested', 'scratch');
  const dir = resolveDir({ dir: target });
  assert.strictEqual(dir, target);
  assert.ok(fs.existsSync(target));
});

test('resolveDir: run-dir scoping lands under {run}/review-ctx (no tmp/ segment — refs #1213)', () => {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'review-ctx-run-'));
  const dir = resolveDir({ run });
  assert.strictEqual(dir, path.join(run, 'review-ctx'));
  assert.ok(fs.existsSync(dir));
});

test('resolveDir: default mints a fresh unique dir per call — no fixed shared path', () => {
  const a = resolveDir({});
  const b = resolveDir({});
  assert.notStrictEqual(a, b, 'two mints must never collide');
  assert.ok(fs.existsSync(a));
  assert.ok(fs.existsSync(b));
  assert.ok(path.basename(a).startsWith('review-ctx-'));
});

test('buildContext: bundle carries the full diff, one section per changed file, and current content', () => {
  const repo = makeFixtureRepo();
  const dir = resolveDir({});
  const result = buildContext({ base: 'main', branch: 'feature', dir, ...repoDeps(repo) });

  assert.strictEqual(result.dir, dir);
  assert.strictEqual(result.contextPath, path.join(dir, 'context.md'));
  const bundle = fs.readFileSync(result.contextPath, 'utf8');

  // Full diff at the top: covers all three files, including the deleted one.
  assert.match(bundle, /diff --git a\/kept\.txt b\/kept\.txt/);
  assert.match(bundle, /diff --git a\/added\.txt b\/added\.txt/);
  assert.match(bundle, /diff --git a\/doomed\.txt b\/doomed\.txt/);

  // Per-file sections with current working-tree content.
  assert.match(bundle, /===== kept\.txt =====\nkept line 1\nkept line 2\n/);
  assert.match(bundle, /===== added\.txt =====\nadded content\n/);

  // Deleted file degrades to an empty section, reported — never a crash.
  assert.match(bundle, /===== doomed\.txt =====\n/);
  assert.deepStrictEqual(result.emptySections, ['doomed.txt']);
  // AC4.1-AC4.2: a small deleted file is an empty section only; only a deleted file whose diff
  // chunk is elided (over the cap, or a lockfile/.jsonl) is also listed as oversize.
  assert.deepStrictEqual(result.oversizeSections, []);
  assert.strictEqual(result.files, 3);
  assert.strictEqual(result.bytes, Buffer.byteLength(bundle));
});

test('buildContext: --files-from list overrides git-derived scope (merge-provenance own-work set)', () => {
  const repo = makeFixtureRepo();
  const dir = resolveDir({});
  const listPath = path.join(dir, 'own-work.txt');
  fs.writeFileSync(listPath, 'kept.txt\n\n');
  const result = buildContext({ base: 'main', branch: 'feature', dir, filesFrom: listPath, ...repoDeps(repo) });

  const bundle = fs.readFileSync(result.contextPath, 'utf8');
  assert.match(bundle, /===== kept\.txt =====/);
  assert.ok(!bundle.includes('===== added.txt ====='), 'out-of-scope file must not get a section');
  assert.strictEqual(result.files, 1);
});

test('buildContext: missing base/branch/dir throw rather than silently building the wrong bundle', () => {
  assert.throws(() => buildContext({ branch: 'feature', dir: '/x' }), /base and branch/);
  assert.throws(() => buildContext({ base: 'main', branch: 'feature' }), /dir is required/);
});

test('CLI end-to-end: mint prints a JSON dir that exists', () => {
  const out = execFileSync('node', [CLI, 'mint'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.ok(fs.existsSync(parsed.dir));
});

test('CLI end-to-end: build from a fixture checkout writes the bundle and prints its stats', () => {
  const repo = makeFixtureRepo();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-ctx-cli-'));
  const out = execFileSync('node', [CLI, 'build', '--base', 'main', '--branch', 'feature', '--dir', dir], {
    cwd: repo,
    encoding: 'utf8',
  });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.contextPath, path.join(dir, 'context.md'));
  assert.ok(fs.existsSync(parsed.contextPath));
  assert.strictEqual(parsed.files, 3);
  assert.deepStrictEqual(parsed.emptySections, ['doomed.txt']);
  // AC5.1: the printed line carries the new field.
  assert.ok(Array.isArray(parsed.oversizeSections));
});

test('CLI end-to-end: build from a subdirectory of the checkout still reads real file content (#3017)', () => {
  // Reproduces the reported bug: invoked from <checkout>/sub instead of the
  // repo root, every changed file used to land in emptySections because
  // readFile(f) resolved the repo-root-relative name against process.cwd().
  const repo = makeFixtureRepo();
  fs.mkdirSync(path.join(repo, 'sub'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-ctx-cli-subdir-'));
  const out = execFileSync('node', [CLI, 'build', '--base', 'main', '--branch', 'feature', '--dir', dir], {
    cwd: path.join(repo, 'sub'),
    encoding: 'utf8',
  });
  const parsed = JSON.parse(out);
  const bundle = fs.readFileSync(parsed.contextPath, 'utf8');
  assert.match(bundle, /===== kept\.txt =====\nkept line 1\nkept line 2\n/);
  assert.match(bundle, /===== added\.txt =====\nadded content\n/);
  // Only the genuinely-deleted file is an empty section — not every file.
  assert.deepStrictEqual(parsed.emptySections, ['doomed.txt']);
  assert.strictEqual(parsed.files, 3);
});

// --- Per-file cap (#3020) ---------------------------------------------------------------

// Text of exactly `total` bytes made of many short lines, so a one-line edit near the top
// yields a hunk with only a few context lines. `marker` replaces line `markerAt` — a
// distinctive late line the tests search the whole bundle for. `first` is line 0.
function shortLines(total, first, marker, markerAt = 2000) {
  let text = first;
  for (let i = 1; total - Buffer.byteLength(text) >= 20; i++) {
    text += i === markerAt ? marker : `line ${i}\n`;
  }
  const rest = total - Buffer.byteLength(text);
  if (rest > 0) text += `${'p'.repeat(rest - 1)}\n`;
  assert.strictEqual(Buffer.byteLength(text), total);
  return text;
}

const LATE_MARKER = 'DISTINCTIVE-LATE-LINE-MARKER\n';

// A fresh repo on `main` with a committer identity configured; `prefix` names the temp dir.
function initRepo(prefix) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.invalid']);
  git(repo, ['config', 'user.name', 'Test']);
  return repo;
}

function commitAll(repo, message) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message]);
}

// Commit the working tree as the base on `main`, then switch to a new `feature` branch.
function startFeatureBranch(repo) {
  commitAll(repo, 'base');
  git(repo, ['checkout', '-q', '-b', 'feature']);
}

// Real-git fixture for the cap: a modified file one byte over the cap, a modified file at
// exactly the cap, added over-cap / jsonl / lockfile / spaced-name files, and two deletions
// (a plain file and a lockfile).
function makeOversizeFixtureRepo() {
  const repo = initRepo('review-ctx-oversize-');
  fs.writeFileSync(path.join(repo, 'big-modified.txt'), shortLines(PER_FILE_CAP_BYTES, 'first\n', LATE_MARKER));
  fs.writeFileSync(path.join(repo, 'exact.txt'), 'small\n');
  fs.writeFileSync(path.join(repo, 'doomed.txt'), 'doomed content\n');
  fs.writeFileSync(path.join(repo, 'yarn.lock'), '# yarn lockfile\n');
  startFeatureBranch(repo);
  fs.writeFileSync(path.join(repo, 'big-modified.txt'), shortLines(PER_FILE_CAP_BYTES + 1, 'first!\n', LATE_MARKER));
  fs.writeFileSync(path.join(repo, 'exact.txt'), shortLines(PER_FILE_CAP_BYTES, 'exact first\n', 'exact marker\n'));
  fs.writeFileSync(path.join(repo, 'big-added.txt'), `${'b'.repeat(PER_FILE_CAP_BYTES)}\n`);
  fs.writeFileSync(path.join(repo, 'fixture.jsonl'), '{"a":1}\n');
  fs.writeFileSync(path.join(repo, 'package-lock.json'), '{}\n');
  fs.writeFileSync(path.join(repo, 'has space.txt'), `${'s'.repeat(PER_FILE_CAP_BYTES)}\n`);
  fs.rmSync(path.join(repo, 'doomed.txt'));
  fs.rmSync(path.join(repo, 'yarn.lock'));
  commitAll(repo, 'feature work');
  return repo;
}

// Built once and shared: every test reading it is read-only on the repo (each builds its own
// output dir), and the real-git build is the slow part.
let oversizeRepo;
function getOversizeRepo() {
  if (!oversizeRepo) oversizeRepo = makeOversizeFixtureRepo();
  return oversizeRepo;
}

// The diff part of a bundle: everything before the first `===== {file} =====` section.
function diffPartOf(bundle) {
  return bundle.slice(0, bundle.indexOf('\n===== '));
}

// Build the `main...feature` bundle of `repo` into a fresh output dir and read it back.
function buildFrom(repo, extra = {}) {
  const dir = resolveDir({});
  const result = buildContext({ base: 'main', branch: 'feature', dir, ...repoDeps(repo), ...extra });
  const bundle = fs.readFileSync(result.contextPath, 'utf8');
  return { result, bundle, diffPart: diffPartOf(bundle) };
}

function buildOversize() {
  return buildFrom(getOversizeRepo());
}

// The text of one `===== {name} =====` section: everything up to the blank-line separator
// before the next header (the section's own trailing newline is kept).
function sectionOf(bundle, name) {
  const head = `===== ${name} =====\n`;
  const start = bundle.indexOf(head) + head.length;
  const next = bundle.indexOf('\n=====', start);
  return bundle.slice(start, next === -1 ? undefined : next);
}

function lineCount(text) {
  return text.split('\n').filter(Boolean).length;
}

test('AC1.1, AC1.2: a modified file of PER_FILE_CAP_BYTES + 1 bytes gets a stub section, is listed, and keeps its hunk in the diff', () => {
  const { result, bundle, diffPart } = buildOversize();
  const section = sectionOf(bundle, 'big-modified.txt');
  assert.strictEqual(lineCount(section), 1, 'stub is a single line');
  assert.match(section, /^\[section omitted: big-modified\.txt is 65537 bytes/);
  // Full content absent from the whole bundle: a distinctive late line appears nowhere.
  assert.ok(!bundle.includes('DISTINCTIVE-LATE-LINE-MARKER'));
  assert.ok(result.oversizeSections.includes('big-modified.txt'));
  // Its hunk is still in the diff part, with no elision marker for that path.
  assert.match(diffPart, /diff --git a\/big-modified\.txt b\/big-modified\.txt/);
  assert.match(diffPart, /^@@ .* @@/m);
  assert.match(diffPart, /^-first$/m);
  assert.match(diffPart, /^\+first!$/m);
  assert.ok(!diffPart.includes('diff elided for big-modified.txt'));
});

test('AC2.1-AC2.2: a file of exactly PER_FILE_CAP_BYTES bytes is inlined in full and not listed', () => {
  const { result, bundle } = buildOversize();
  const full = shortLines(PER_FILE_CAP_BYTES, 'exact first\n', 'exact marker\n');
  assert.strictEqual(sectionOf(bundle, 'exact.txt'), full);
  assert.ok(!result.oversizeSections.includes('exact.txt'));
});

test('AC3.1: small fixture.jsonl and package-lock.json are stubbed and listed despite being under the cap', () => {
  const { result, bundle } = buildOversize();
  for (const name of ['fixture.jsonl', 'package-lock.json']) {
    const section = sectionOf(bundle, name);
    assert.ok(section.startsWith(`[section omitted: ${name} — always stubbed`), `${name}: ${section}`);
    assert.strictEqual(lineCount(section), 1, `${name} stub is a single line`);
    assert.ok(result.oversizeSections.includes(name));
  }
});

test('AC6.1, AC6.2: added over-cap and added small .jsonl get one elision marker each, listed once; modified over-cap keeps its hunk', () => {
  const { result, bundle, diffPart } = buildOversize();
  assert.match(diffPart, /^\[\d+ bytes of diff elided for big-added\.txt — see oversizeSections\]$/m);
  assert.match(diffPart, /^\[\d+ bytes of diff elided for fixture\.jsonl — see oversizeSections\]$/m);
  assert.ok(!bundle.includes('b'.repeat(1000)), 'added content appears nowhere in the bundle');
  assert.strictEqual(result.oversizeSections.filter((p) => p === 'big-added.txt').length, 1);
  assert.strictEqual(result.oversizeSections.filter((p) => p === 'fixture.jsonl').length, 1);
  // The modified over-cap file's hunk is whole (shared with AC1.3).
  assert.match(diffPart, /^\+first!$/m);
  assert.ok(!diffPart.includes('diff elided for big-modified.txt'));
  // The marker keeps the diff --git header so the chunk stays attributable.
  assert.match(diffPart, /diff --git a\/big-added\.txt b\/big-added\.txt\n\[/);
});

test('deleted lockfile is stubbed (matcher before read), not empty', () => {
  const { result, bundle, diffPart } = buildOversize();
  assert.ok(result.oversizeSections.includes('yarn.lock'));
  assert.ok(!result.emptySections.includes('yarn.lock'));
  assert.deepStrictEqual(result.emptySections, ['doomed.txt']);
  assert.ok(sectionOf(bundle, 'yarn.lock').startsWith('[section omitted: yarn.lock — always stubbed'));
  assert.match(diffPart, /^\[\d+ bytes of diff elided for yarn\.lock — see oversizeSections\]$/m);
  assert.ok(!diffPart.includes('# yarn lockfile'));
});

test('a modified lockfile has its diff chunk elided (always-stub applies to every change type) and is listed once', () => {
  const repo = initRepo('review-ctx-modlock-');
  fs.writeFileSync(path.join(repo, 'yarn.lock'), 'v1\n');
  startFeatureBranch(repo);
  fs.writeFileSync(path.join(repo, 'yarn.lock'), 'v2\n');
  commitAll(repo, 'bump');
  const { result, bundle } = buildFrom(repo);
  assert.ok(!/^\+v2$/m.test(bundle), 'the lockfile hunk is replaced by the marker');
  assert.match(bundle, /^\[\d+ bytes of diff elided for yarn\.lock — see oversizeSections\]$/m);
  assert.match(bundle, /diff --git a\/yarn\.lock b\/yarn\.lock\n\[/);
  assert.deepStrictEqual(result.oversizeSections, ['yarn.lock']);
});

test('added file with a space in its name is elided and listed once', () => {
  const { result, diffPart } = buildOversize();
  assert.match(diffPart, /^\[\d+ bytes of diff elided for has space\.txt — see oversizeSections\]$/m);
  assert.strictEqual(result.oversizeSections.filter((p) => p === 'has space.txt').length, 1);
});

test('--files-from scope still reports a diff-elided path outside the list', () => {
  const repo = getOversizeRepo();
  const dir = resolveDir({});
  const listPath = path.join(dir, 'own-work.txt');
  fs.writeFileSync(listPath, 'exact.txt\n');
  const result = buildContext({ base: 'main', branch: 'feature', dir, filesFrom: listPath, ...repoDeps(repo) });
  assert.ok(result.oversizeSections.includes('big-added.txt'));
  assert.ok(!result.oversizeSections.includes('exact.txt'));
  assert.strictEqual(result.oversizeSections.filter((p) => p === 'big-added.txt').length, 1);
});

// A tiny repo whose feature branch adds one over-cap file named `name`; `config` pairs are
// applied to the repo before the commits.
function makeAddedOversizeRepo(name, config = []) {
  const repo = initRepo('review-ctx-added-');
  for (const [k, v] of config) git(repo, ['config', k, v]);
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  startFeatureBranch(repo);
  fs.writeFileSync(path.join(repo, name), `${'n'.repeat(PER_FILE_CAP_BYTES)}\n`);
  commitAll(repo, 'feature work');
  return repo;
}

test('F2: diff.noprefix=true in the repo config does not defeat header parsing — added over-cap file is elided and listed once', () => {
  const repo = makeAddedOversizeRepo('noprefix-big.txt', [['diff.noprefix', 'true']]);
  const { result, bundle, diffPart } = buildFrom(repo);
  assert.match(bundle, /^\[\d+ bytes of diff elided for noprefix-big\.txt — see oversizeSections\]$/m);
  assert.ok(!diffPart.includes('n'.repeat(1000)), 'diff part holds no added content');
  assert.strictEqual(result.oversizeSections.filter((p) => p === 'noprefix-big.txt').length, 1);
});

test('F2: a non-ASCII added over-cap name is elided, stubbed, listed once under the unquoted name, and not empty', () => {
  const repo = makeAddedOversizeRepo('café.txt');
  const { result, bundle, diffPart } = buildFrom(repo);
  assert.match(diffPart, /^\[\d+ bytes of diff elided for café\.txt — see oversizeSections\]$/m);
  assert.ok(!diffPart.includes('n'.repeat(1000)));
  assert.ok(sectionOf(bundle, 'café.txt').startsWith('[section omitted: café.txt is '));
  assert.deepStrictEqual(result.oversizeSections, ['café.txt']);
  assert.ok(!result.emptySections.includes('café.txt'));
  assert.deepStrictEqual(result.emptySections, []);
});

test('F2: the git calls carry core.quotePath=false and explicit diff prefixes', () => {
  const calls = [];
  buildContext({
    base: 'main',
    branch: 'feature',
    dir: resolveDir({}),
    git: (args) => {
      calls.push(args);
      return args.includes('rev-parse') ? '/x\n' : '';
    },
    readFile: () => '',
  });
  const diffCall = calls.find((a) => a.includes('diff') && !a.includes('--name-only'));
  assert.deepStrictEqual(diffCall, [
    '-c',
    'core.quotePath=false',
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    'main...feature',
  ]);
  const namesCall = calls.find((a) => a.includes('--name-only'));
  assert.deepStrictEqual(namesCall, ['-c', 'core.quotePath=false', 'diff', 'main...feature', '--name-only']);
});

test('F3: elideDiff splits only after a line feed — a CR inside a hunk line never starts a chunk', () => {
  const diff =
    'diff --git a/a.txt b/a.txt\n' +
    'index 1111111..2222222 100644\n' +
    '--- a/a.txt\n' +
    '+++ b/a.txt\n' +
    '@@ -1 +1,3 @@\n' +
    ' ctx\n' +
    '+x\rdiff --git a/z.jsonl b/z.jsonl\rnew file mode 100644\n' +
    '+y\rdiff --git a/w.jsonl b/w.jsonl\n' +
    '+z\rnew file mode 100644\n';
  const { text, elided } = elideDiff(diff);
  assert.deepStrictEqual(elided, []);
  assert.strictEqual(text, diff, 'a modified file with no always-stub name rejoins byte-for-byte');
});

test('F3: elideDiff keeps a diff that begins with a header intact and rejoins losslessly', () => {
  const diff =
    'diff --git a/a.txt b/a.txt\nindex 1..2 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n' +
    'diff --git a/c.txt b/c.txt\nindex 3..4 100644\n--- a/c.txt\n+++ b/c.txt\n@@ -1 +1 @@\n-c\n+d\n';
  const { text, elided } = elideDiff(diff);
  assert.strictEqual(text, diff);
  assert.deepStrictEqual(elided, []);
});

test('F4: stub text says what is true for each stubbed path', () => {
  const { bundle } = buildOversize();
  // Modified over-cap file: its hunk was NOT elided, so the diff above carries the change.
  assert.strictEqual(
    sectionOf(bundle, 'big-modified.txt'),
    '[section omitted: big-modified.txt is 65537 bytes, over the 65536-byte per-file cap; its change is in the diff above — read the live file for full content]\n',
  );
  // Added over-cap file: its diff chunk WAS elided too.
  const added = sectionOf(bundle, 'big-added.txt');
  assert.ok(added.startsWith('[section omitted: big-added.txt is '), added);
  assert.match(
    added,
    /its diff was elided too \(see the marker line above\) — run `git diff main\.\.\.feature -- 'big-added\.txt'` for the change, or read the live file for full content\]\n$/,
  );
  assert.ok(!added.includes('change is in the diff above'));
  // Deleted lockfile: nothing live to read — point at the same range the bundle's diff used.
  const deleted = sectionOf(bundle, 'yarn.lock');
  assert.ok(deleted.startsWith('[section omitted: yarn.lock — always stubbed'), deleted);
  assert.ok(deleted.includes("`git diff main...feature -- 'yarn.lock'`"), deleted);
  assert.ok(!deleted.includes('read the live file'));
  assert.ok(!deleted.includes('change is in the diff above'));
  for (const s of [added, deleted]) assert.strictEqual(lineCount(s), 1, 'stub stays one line');
});

test('a deleted over-cap non-lockfile gets an in-bundle pointer: section stub and diff marker, listed in both lists', () => {
  const repo = initRepo('review-ctx-delbig-');
  fs.writeFileSync(path.join(repo, 'big-gone.txt'), `${'g'.repeat(PER_FILE_CAP_BYTES)}\n`);
  startFeatureBranch(repo);
  fs.rmSync(path.join(repo, 'big-gone.txt'));
  commitAll(repo, 'drop it');
  const { result, bundle, diffPart } = buildFrom(repo);
  assert.deepStrictEqual(result.emptySections, ['big-gone.txt']);
  assert.deepStrictEqual(result.oversizeSections, ['big-gone.txt']);
  assert.match(diffPart, /^\[\d+ bytes of diff elided for big-gone\.txt — see oversizeSections\]$/m);
  assert.strictEqual(
    sectionOf(bundle, 'big-gone.txt'),
    "[section omitted: big-gone.txt — the file is deleted and its diff was elided (see the marker line above) — run `git diff main...feature -- 'big-gone.txt'` for its last content]\n",
  );
});

test('a renamed lockfile has its diff chunk elided (matched on the rename destination) and is listed once', () => {
  const repo = initRepo('review-ctx-renlock-');
  const lines = Array.from({ length: 200 }, (_, i) => `entry ${i}\n`);
  fs.writeFileSync(path.join(repo, 'yarn.lock'), lines.join(''));
  startFeatureBranch(repo);
  fs.mkdirSync(path.join(repo, 'sub'));
  lines[100] = 'CHANGED-LOCK-LINE\n';
  fs.writeFileSync(path.join(repo, 'sub', 'yarn.lock'), lines.join(''));
  fs.rmSync(path.join(repo, 'yarn.lock'));
  commitAll(repo, 'move lockfile');
  const { result, bundle, diffPart } = buildFrom(repo);
  assert.match(diffPart, /^diff --git a\/yarn\.lock b\/sub\/yarn\.lock$/m, 'the fixture really is a rename chunk');
  assert.ok(!bundle.includes('CHANGED-LOCK-LINE'), 'the renamed lockfile hunk is elided');
  assert.match(diffPart, /^\[\d+ bytes of diff elided for sub\/yarn\.lock — see oversizeSections\]$/m);
  assert.deepStrictEqual(result.oversizeSections, ['sub/yarn.lock']);
});

test('a renamed ordinary file keeps its chunk whole (rename matching is by the destination name)', () => {
  const repo = initRepo('review-ctx-renplain-');
  const lines = Array.from({ length: 200 }, (_, i) => `entry ${i}\n`);
  fs.writeFileSync(path.join(repo, 'old.txt'), lines.join(''));
  startFeatureBranch(repo);
  lines[100] = 'CHANGED-PLAIN-LINE\n';
  fs.writeFileSync(path.join(repo, 'new.txt'), lines.join(''));
  fs.rmSync(path.join(repo, 'old.txt'));
  commitAll(repo, 'rename');
  const { result, diffPart } = buildFrom(repo);
  assert.match(diffPart, /^rename to new\.txt$/m, 'the fixture really is a rename chunk');
  assert.match(diffPart, /^\+CHANGED-PLAIN-LINE$/m);
  assert.deepStrictEqual(result.oversizeSections, []);
});

test('the command a stub suggests single-quotes a hostile path so it cannot end the argument or substitute', () => {
  const hostile = "it's $(x).jsonl";
  const repo = initRepo('review-ctx-quote-');
  fs.writeFileSync(path.join(repo, hostile), '{"a":1}\n');
  startFeatureBranch(repo);
  fs.rmSync(path.join(repo, hostile));
  commitAll(repo, 'drop it');
  const { bundle } = buildFrom(repo);
  const section = sectionOf(bundle, hostile);
  assert.ok(section.includes("-- 'it'\\''s $(x).jsonl'`"), section);
});

test('isAlwaysStub: named lockfiles and .jsonl match on basename; near-misses do not', () => {
  for (const f of [
    'a/b/Cargo.lock',
    'x.jsonl',
    'poetry.lock',
    'composer.lock',
    'Gemfile.lock',
    'npm-shrinkwrap.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'package-lock.json',
    'a\\b\\yarn.lock',
  ]) {
    assert.strictEqual(isAlwaysStub(f), true, f);
  }
  for (const f of ['package.json', 'x.json', 'jsonl.txt', 'my-yarn.lock', 'yarn.lock/readme.md']) {
    assert.strictEqual(isAlwaysStub(f), false, f);
  }
});

test('CLI: malformed invocations exit 2 with usage', () => {
  for (const args of [[], ['build'], ['frobnicate']]) {
    let code = 0;
    try {
      execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      code = err.status;
    }
    assert.strictEqual(code, 2, `expected exit 2 for args: ${JSON.stringify(args)}`);
  }
});
