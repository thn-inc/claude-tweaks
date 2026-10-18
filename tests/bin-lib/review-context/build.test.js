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
  // AC4.1-AC4.2: a deleted file is an empty section only, never an oversize one.
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

// Real-git fixture for the cap: a modified file one byte over the cap, a modified file at
// exactly the cap, added over-cap / jsonl / lockfile / spaced-name files, and two deletions
// (a plain file and a lockfile).
function makeOversizeFixtureRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'review-ctx-oversize-'));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.invalid']);
  git(repo, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'big-modified.txt'), shortLines(PER_FILE_CAP_BYTES, 'first\n', LATE_MARKER));
  fs.writeFileSync(path.join(repo, 'exact.txt'), 'small\n');
  fs.writeFileSync(path.join(repo, 'doomed.txt'), 'doomed content\n');
  fs.writeFileSync(path.join(repo, 'yarn.lock'), '# yarn lockfile\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'base']);
  git(repo, ['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(repo, 'big-modified.txt'), shortLines(PER_FILE_CAP_BYTES + 1, 'first!\n', LATE_MARKER));
  fs.writeFileSync(path.join(repo, 'exact.txt'), shortLines(PER_FILE_CAP_BYTES, 'exact first\n', 'exact marker\n'));
  fs.writeFileSync(path.join(repo, 'big-added.txt'), `${'b'.repeat(PER_FILE_CAP_BYTES)}\n`);
  fs.writeFileSync(path.join(repo, 'fixture.jsonl'), '{"a":1}\n');
  fs.writeFileSync(path.join(repo, 'package-lock.json'), '{}\n');
  fs.writeFileSync(path.join(repo, 'has space.txt'), `${'s'.repeat(PER_FILE_CAP_BYTES)}\n`);
  fs.rmSync(path.join(repo, 'doomed.txt'));
  fs.rmSync(path.join(repo, 'yarn.lock'));
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'feature work']);
  return repo;
}

function buildOversize(extra = {}) {
  const repo = makeOversizeFixtureRepo();
  const dir = resolveDir({});
  const result = buildContext({ base: 'main', branch: 'feature', dir, ...repoDeps(repo), ...extra });
  const bundle = fs.readFileSync(result.contextPath, 'utf8');
  return { result, bundle, diffPart: bundle.slice(0, bundle.indexOf('\n===== ')) };
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

test('a modified lockfile keeps its full hunk (diff elision is added/deleted only)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'review-ctx-modlock-'));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.invalid']);
  git(repo, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'yarn.lock'), 'v1\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'base']);
  git(repo, ['checkout', '-q', '-b', 'feature']);
  fs.writeFileSync(path.join(repo, 'yarn.lock'), 'v2\n');
  git(repo, ['commit', '-q', '-am', 'bump']);
  const dir = resolveDir({});
  const result = buildContext({ base: 'main', branch: 'feature', dir, ...repoDeps(repo) });
  const bundle = fs.readFileSync(result.contextPath, 'utf8');
  assert.match(bundle, /^\+v2$/m);
  assert.ok(!bundle.includes('diff elided'));
  assert.deepStrictEqual(result.oversizeSections, ['yarn.lock']);
});

test('added file with a space in its name is elided and listed once', () => {
  const { result, diffPart } = buildOversize();
  assert.match(diffPart, /^\[\d+ bytes of diff elided for has space\.txt — see oversizeSections\]$/m);
  assert.strictEqual(result.oversizeSections.filter((p) => p === 'has space.txt').length, 1);
});

test('--files-from scope still reports a diff-elided path outside the list', () => {
  const repo = makeOversizeFixtureRepo();
  const dir = resolveDir({});
  const listPath = path.join(dir, 'own-work.txt');
  fs.writeFileSync(listPath, 'exact.txt\n');
  const result = buildContext({ base: 'main', branch: 'feature', dir, filesFrom: listPath, ...repoDeps(repo) });
  assert.ok(result.oversizeSections.includes('big-added.txt'));
  assert.ok(!result.oversizeSections.includes('exact.txt'));
  assert.strictEqual(result.oversizeSections.filter((p) => p === 'big-added.txt').length, 1);
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
