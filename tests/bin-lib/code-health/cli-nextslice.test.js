const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { contentHash, sliceRecursive } = require('../../../plugin/bin/lib/code-health/scope');
const { sweepCli } = require('../../helpers/health-sweep-cli');
const { spawnCli } = require('../../helpers/run-cli');
const { cleanGitEnv } = require('../../helpers/git-fixtures');

// Every setup git call runs without an inherited GIT_DIR and friends, so they cannot land in another repo.
const GIT_OPTS = { env: cleanGitEnv(process.env) };

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'code-health.js');

function tmp() { return scratchDir('codehealth-ns-'); }
// In-process (#5381), with the file-protocol-only git guard and a throwaway real cwd — see tests/helpers/health-sweep-cli.js.
function runNextSlice(args, root) {
  const res = sweepCli(CLI, ['next-slice', '--root', root, ...args]);
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

// Cursors are now durable (health-state branch), not local disk (writeCursors
// no longer exists — see bin/lib/code-health/cache.js). readDurableState's
// read path is pure git plumbing (fetch + show), so it CAN be exercised for
// real without gh/network: seed a local bare repo as `origin`, commit the
// cursors file directly onto a `health-state` branch, and point `root`'s own
// `origin` remote at it. Only the WRITE path (gh api blob/tree/commit/ref
// calls) requires live GitHub credentials — this helper never touches it.
function seedDurableCursors(root, cursors) {
  const bareDir = scratchDir('codehealth-ns-bare-');
  execFileSync('git', ['init', '--bare', '-q', bareDir], GIT_OPTS);
  const seedDir = scratchDir('codehealth-ns-seed-');
  execFileSync('git', ['init', '-q', seedDir], GIT_OPTS);
  execFileSync('git', ['-C', seedDir, 'checkout', '-q', '-b', 'health-state'], GIT_OPTS);
  fs.mkdirSync(path.join(seedDir, 'code-health'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'code-health', 'cursors.json'), JSON.stringify(cursors));
  execFileSync('git', ['-C', seedDir, 'add', '-A'], GIT_OPTS);
  execFileSync(
    'git',
    ['-C', seedDir, '-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'seed'],
    GIT_OPTS,
  );
  execFileSync('git', ['-C', seedDir, 'push', '-q', bareDir, 'health-state'], GIT_OPTS);
  execFileSync('git', ['init', '-q'], { cwd: root, ...GIT_OPTS });
  execFileSync('git', ['remote', 'add', 'origin', bareDir], { cwd: root, ...GIT_OPTS });
}

test('next-slice returns a slice object for a new repo', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  const result = runNextSlice([], root);
  assert.ok(result !== null, 'must pick a slice when nothing has been judged');
  assert.ok(typeof result.id === 'string');
  assert.ok(typeof result.why === 'string');
});

// No --root: the root is the injected cwd, the same outcome as the --root twin above.
test('AC8.1: next-slice without --root picks a slice under the injected cwd', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  const res = sweepCli(CLI, ['next-slice'], { cwd: root });
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const result = JSON.parse(res.stdout);
  assert.ok(result !== null, 'must pick a slice when nothing has been judged');
  assert.ok(typeof result.id === 'string');
  assert.strictEqual(result.path, root, 'the picked slice must lie under the injected cwd');
});

// Accepted output difference of the in-process entry (#5381): a RELATIVE --root now resolves
// against the injected cwd once, so the printed slice paths are absolute.
test('next-slice --root <relative> prints absolute slice paths under the injected cwd', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src', 'pkg-a'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'pkg-b'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'pkg-a', 'a.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(root, 'src', 'pkg-b', 'b.js'), 'const b = 2;\n');

  const res = sweepCli(CLI, ['next-slice', '--root', 'src', '--budget', '2'], { cwd: root });
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const slices = JSON.parse(res.stdout);
  assert.ok(slices.length >= 1, 'must pick at least one slice');
  for (const slice of slices) {
    assert.strictEqual(slice.path, path.resolve(root, 'src', slice.id), `slice ${slice.id} must print its absolute path`);
  }
});

test('next-slice returns null when the only slice has an unchanged hash', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  // Seed with the SAME { recursive } mode the real CLI now persists for the
  // '.' slice (see cmdNextSlice's buildCursorPatch / cmdValidateFindings in
  // bin/code-health.js) — recursive:false for '.', via sliceRecursive('.').
  const hash = contentHash(root, null, { recursive: sliceRecursive('.') });
  seedDurableCursors(root, { '.': { lastSweptMs: Date.now(), lastHash: hash } });
  const result = runNextSlice([], root);
  assert.strictEqual(result, null, 'unchanged recently-judged slice must yield null');
});

test('next-slice --budget 2 returns an array of up to 2 slices', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'pkg-a'));
  fs.mkdirSync(path.join(root, 'pkg-b'));
  fs.writeFileSync(path.join(root, 'pkg-a', 'a.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(root, 'pkg-b', 'b.js'), 'const b = 2;\n');
  // No cursors → all slices are stale → budget=2 returns up to 2
  const raw = sweepCli(CLI, ['next-slice', '--root', root, '--budget', '2']).stdout;
  const result = JSON.parse(raw);
  assert.ok(Array.isArray(result), '--budget must return an array');
  assert.ok(result.length >= 1 && result.length <= 2);
  // IDs must be unique
  const ids = result.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'budget results must have unique ids');
});

test('next-slice exits 0 and writes nothing to disk', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  // A hash-matched cursor means nothing is due. Seed with the SAME
  // { recursive } mode the real CLI now persists for the '.' slice.
  const hash = contentHash(root, null, { recursive: sliceRecursive('.') });
  seedDurableCursors(root, { '.': { lastSweptMs: Date.now(), lastHash: hash } });
  // Must exit 0 even when returning null
  const raw = sweepCli(CLI, ['next-slice', '--root', root]).stdout;
  assert.strictEqual(JSON.parse(raw), null);
  // Cache must be untouched
  assert.strictEqual(fs.existsSync(path.join(root, '.claude-tweaks', 'code-health', 'cache.json')), false);
});

test('next-slice: a change inside a subdirectory does not make the "." slice look changed (regression for #66)', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'sub', 'b.js'), 'const y = 1;\n');
  const now = Date.now();
  // Seed BOTH slices with cursors matching their current content, using each
  // slice's own real { recursive } mode (recursive:false for '.', true for
  // 'sub') — exactly what the real CLI now persists.
  const rootHash = contentHash(root, null, { recursive: sliceRecursive('.') });
  const subHash = contentHash(path.join(root, 'sub'), null, { recursive: sliceRecursive('sub') });
  seedDurableCursors(root, {
    '.': { lastSweptMs: now, lastHash: rootHash },
    sub: { lastSweptMs: now, lastHash: subHash },
  });
  // Modify ONLY the file inside the subdirectory — the root-level a.js is untouched.
  fs.writeFileSync(path.join(root, 'sub', 'b.js'), 'const y = 2;\n');
  const result = runNextSlice([], root);
  // Before the #66 fix, '.' scanned recursively and would have picked up
  // sub/b.js's change too, making '.' look changed (and, on a score tie,
  // win the alphabetical tie-break ahead of 'sub'). After the fix, '.' only
  // covers direct root-level files, so it correctly still matches its
  // cursor and is excluded from Phase 2 — only 'sub' (whose own content
  // actually changed) is picked.
  assert.ok(result !== null, 'the changed "sub" slice should still be picked');
  assert.strictEqual(result.id, 'sub', 'a change inside "sub" must not make "." look changed instead');
});

// Real-process pin of the script entry (#5381): an unknown command exits 2 with empty stdout and
// the usage text on stderr.
test('AC2.1, AC2.2: code-health.js no-such-command exits 2 with the usage text on stderr, naming no removed command (real process)', () => {
  const r = spawnCli(CLI, ['no-such-command'], { env: { ...process.env }, cwd: tmp() });
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(
    r.stderr,
    'usage: code-health.js <command> [options]\ncommands: validate-findings [--slice <id>], classify, next-slice, status, churn-report, retry-queue drain, retry-queue update <results.json>\n',
  );
});
