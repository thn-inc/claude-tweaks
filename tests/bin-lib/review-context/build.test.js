const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { resolveDir, buildContext } = require('../../../plugin/bin/lib/review-context/build');

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
