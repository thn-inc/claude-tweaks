const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { listSlices, contentHash, selectSlice, listWorkspaceSlices, gitChurn, sliceRecursive, sourceFiles } = require('../../../plugin/bin/lib/code-health/scope');
const { MAX_STALE_DAYS } = require('../../../plugin/bin/lib/code-health/score');
const { skipUnderRoot } = require('../../helpers/root');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'codehealth-scope-')); }

function initGitRepo(root) {
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@test.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test']);
}

// ─── sliceRecursive ────────────────────────────────────────────────────────

test('sliceRecursive is false only for the "." slice id', () => {
  assert.strictEqual(sliceRecursive('.'), false);
  assert.strictEqual(sliceRecursive('src'), true);
  assert.strictEqual(sliceRecursive('packages/a'), true);
});

// Bytes of filler that reliably pushes a directory past MAX_SLICE_BYTES (30 KB)
// in code-health/scope.js — unrelated to the skill-content 40 KB ceiling
// in context-cost.js, so #1997 re-expresses this literal rather than
// importing that unrelated module's constant.
const BIG = 'x'.repeat(31 * 1024);

test('sliceRecursive(id, root) reports false for a split directory\'s own-files slice', () => {
  const root = tmp();
  // 'big' exceeds the cap only via its subdirectory, so 'big' splits into a
  // non-recursive own-files slice plus a recursive 'big/deep'.
  fs.mkdirSync(path.join(root, 'big', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'big', 'own.js'), `// ${BIG}\n`);
  fs.writeFileSync(path.join(root, 'big', 'deep', 'd.js'), `// ${BIG}\n`);
  assert.strictEqual(sliceRecursive('big', root), false, 'a split directory\'s own-files slice is non-recursive');
  assert.strictEqual(sliceRecursive('big/deep', root), true, 'an under-cap child stays recursive');
  // Without root, the pre-split heuristic still answers for a manual --area path.
  assert.strictEqual(sliceRecursive('big'), true);
});

// ─── listSlices ────────────────────────────────────────────────────────────

test('listSlices returns "." for a flat dir with no subdirs', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = {};\n');
  const slices = listSlices(root);
  assert.deepStrictEqual(slices.map((s) => s.id), ['.']);
});

test('listSlices omits "." entirely when the root has no direct root-level source files', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const x = 1;\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# hi\n'); // not a SOURCE_EXTS match
  const ids = listSlices(root).map((s) => s.id);
  assert.ok(!ids.includes('.'), '"." must be omitted when root has zero direct source files (README.md does not count)');
  assert.ok(ids.includes('src'), 'src must still be included');
});

test('listSlices still includes "." when the root has at least one direct root-level source file', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const x = 1;\n');
  fs.writeFileSync(path.join(root, 'webpack.config.js'), 'module.exports = {};\n');
  const ids = listSlices(root).map((s) => s.id);
  assert.ok(ids.includes('.'), '"." must still be included when root has a direct source file');
});

test('listSlices includes immediate subdirs, excludes SKIP_DIRS', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = {};\n');
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'lib'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.mkdirSync(path.join(root, '.claude-tweaks'));
  const ids = listSlices(root).map((s) => s.id).sort();
  assert.ok(ids.includes('src'), 'src should be included');
  assert.ok(ids.includes('lib'), 'lib should be included');
  assert.ok(!ids.includes('node_modules'), 'node_modules must be excluded');
  assert.ok(!ids.includes('.claude-tweaks'), '.claude-tweaks must be excluded');
  assert.ok(ids.includes('.'), '. (root) must be included');
});

test('listSlices excludes .claude and .worktrees (other sessions\' live worktrees)', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, '.claude', 'worktrees', 'foo'), { recursive: true });
  fs.mkdirSync(path.join(root, '.worktrees', 'bar'), { recursive: true });
  const ids = listSlices(root).map((s) => s.id).sort();
  assert.ok(ids.includes('src'), 'src should be included');
  assert.ok(!ids.includes('.claude'), '.claude must be excluded');
  assert.ok(!ids.includes('.worktrees'), '.worktrees must be excluded');
});

test('listSlices excludes a dot-directory with zero SOURCE_EXTS files (config dot-dirs)', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const x = 1;\n');
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'test.yml'), 'name: test\n');
  fs.mkdirSync(path.join(root, '.vscode'));
  fs.writeFileSync(path.join(root, '.vscode', 'settings.json'), '{}\n');
  const ids = listSlices(root).map((s) => s.id).sort();
  assert.ok(ids.includes('src'), 'src should be included');
  assert.ok(!ids.includes('.github'), '.github must be excluded — no SOURCE_EXTS files, only YAML');
  assert.ok(!ids.includes('.vscode'), '.vscode must be excluded — no SOURCE_EXTS files, only JSON');
});

test('listSlices still includes a dot-directory that holds real SOURCE_EXTS source', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const x = 1;\n');
  fs.mkdirSync(path.join(root, '.config'));
  fs.writeFileSync(path.join(root, '.config', 'index.js'), 'module.exports = {};\n');
  const ids = listSlices(root).map((s) => s.id).sort();
  assert.ok(ids.includes('.config'), 'a dot-directory with real source must not be excluded');
});

// Review finding (whole-branch review, e90376a4..HEAD): the dot-directory rotation-exclusion
// check treated sourceFiles()===[] as "genuinely empty", but sourceFiles' own catch collapses a
// real scan failure (permission denial, spawn failure, timeout) into the same []. A transient
// failure therefore silently excluded a dot-directory that actually holds real source, with no
// error surfaced. isEmptySourceDir now fails SAFE — a scan failure keeps the directory in
// rotation rather than excluding it — and reports the failure to stderr. Simulated here via a
// real permission-denied `find` failure (chmod 000 makes it un-listable), not a mock.
test('listSlices keeps (does not exclude) a dot-directory whose scan genuinely fails, and reports it to stderr', skipUnderRoot('root ignores directory permissions'), () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const x = 1;\n');
  const dotDir = path.join(root, '.broken');
  fs.mkdirSync(dotDir);
  fs.writeFileSync(path.join(dotDir, 'x.js'), 'module.exports = {};\n');
  fs.chmodSync(dotDir, 0o000);

  const origWrite = process.stderr.write;
  let stderrOut = '';
  process.stderr.write = (chunk) => { stderrOut += chunk; return true; };
  let ids;
  try {
    ids = listSlices(root).map((s) => s.id).sort();
  } finally {
    process.stderr.write = origWrite;
    fs.chmodSync(dotDir, 0o755);
  }

  assert.ok(ids.includes('.broken'), 'a dot-directory whose scan failed must be kept in rotation, not silently excluded');
  assert.match(stderrOut, /dot-directory scan failed/, 'the failure must be reported, not swallowed');
});

test('listSlices slice.path is the absolute path', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = {};\n');
  fs.mkdirSync(path.join(root, 'pkg'));
  const slices = listSlices(root);
  const pkg = slices.find((s) => s.id === 'pkg');
  assert.ok(pkg, 'pkg slice must exist');
  assert.strictEqual(pkg.path, path.join(root, 'pkg'));
  const dot = slices.find((s) => s.id === '.');
  assert.strictEqual(dot.path, root);
});

test('listSlices: a workspace-covered top-level dir is replaced by its expanded children', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
  fs.mkdirSync(path.join(root, 'packages', 'a'), { recursive: true });
  fs.mkdirSync(path.join(root, 'packages', 'b'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true }); // not covered by any workspace pattern
  const ids = listSlices(root).map((s) => s.id).sort();
  assert.deepStrictEqual(ids, ['.', 'docs', 'packages/a', 'packages/b']);
  assert.ok(!ids.includes('packages'), 'the raw "packages" mega-slice must not also appear');
});

test('listSlices: falls back to one-level behavior when no workspace manifest exists', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = {};\n');
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'lib'));
  const ids = listSlices(root).map((s) => s.id).sort();
  assert.deepStrictEqual(ids, ['.', 'lib', 'src']);
});

test('listSlices: a literal (non-glob) single-package workspace entry does NOT swallow sibling top-level subdirs', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['tools/cli'] }));
  fs.mkdirSync(path.join(root, 'tools', 'cli'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools', 'scripts'), { recursive: true }); // unrelated sibling, not in any pattern
  const ids = listSlices(root).map((s) => s.id).sort();
  assert.ok(ids.includes('tools/cli'), 'the literal workspace entry must still appear');
  assert.ok(ids.includes('tools'), 'the "tools" top-level dir must still appear so tools/scripts is reachable — a literal pattern does not cover its whole parent');
});

test('listSlices: a workspace-expanded slice.path is the absolute path to the package', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
  fs.mkdirSync(path.join(root, 'packages', 'db'), { recursive: true });
  const slice = listSlices(root).find((s) => s.id === 'packages/db');
  assert.ok(slice, 'packages/db slice must exist');
  assert.strictEqual(slice.path, path.join(root, 'packages', 'db'));
});

// ─── contentHash ───────────────────────────────────────────────────────────

test('contentHash returns a non-empty hex string', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  const h = contentHash(root);
  assert.match(h, /^[0-9a-f]+$/);
  assert.ok(h.length > 0);
});

test('contentHash is deterministic: same content → same hash', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  assert.strictEqual(contentHash(root), contentHash(root));
});

test('contentHash changes when file content changes', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  const h1 = contentHash(root);
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 2;\n');
  const h2 = contentHash(root);
  assert.notStrictEqual(h1, h2, 'hash must change when content changes');
});

test('contentHash does NOT change when .claude-tweaks content changes', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  const h1 = contentHash(root);
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'cache.json'), '{}');
  const h2 = contentHash(root);
  assert.strictEqual(h1, h2, '.claude-tweaks must be excluded from the hash');
});

test('contentHash does NOT change when .next content changes (build cache, matches SKIP_DIRS)', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  const h1 = contentHash(root);
  fs.mkdirSync(path.join(root, '.next', 'static'), { recursive: true });
  fs.writeFileSync(path.join(root, '.next', 'static', 'chunk.js'), 'regenerated bundle content');
  const h2 = contentHash(root);
  assert.strictEqual(h1, h2, '.next must be excluded from the hash, same as it is excluded from listSlices via SKIP_DIRS');
});

test('contentHash does NOT change when .turbo content changes (build cache, matches SKIP_DIRS)', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  const h1 = contentHash(root);
  fs.mkdirSync(path.join(root, '.turbo'), { recursive: true });
  fs.writeFileSync(path.join(root, '.turbo', 'cache.js'), 'regenerated turbo cache content');
  const h2 = contentHash(root);
  assert.strictEqual(h1, h2, '.turbo must be excluded from the hash, same as it is excluded from listSlices via SKIP_DIRS');
});

test('contentHash does NOT change when .claude/worktrees content changes (other sessions\' live worktrees)', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  const h1 = contentHash(root);
  fs.mkdirSync(path.join(root, '.claude', 'worktrees', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'worktrees', 'foo', 'b.js'), 'const y = 2;\n');
  const h2 = contentHash(root);
  assert.strictEqual(h1, h2, '.claude must be excluded from the hash');
});

test('contentHash does NOT change when a NESTED node_modules changes (not just a direct child)', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  const h1 = contentHash(root);
  // node_modules two levels deep under a package subdir — not a direct
  // child of root, the shape SKIP_DIRS must still exclude.
  fs.mkdirSync(path.join(root, 'pkg', 'nested', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pkg', 'nested', 'node_modules', 'vendor.js'), 'vendor code');
  const h2 = contentHash(root);
  assert.strictEqual(
    h2,
    h1,
    'a nested node_modules (not a direct child of root) must be excluded from the hash, same as a direct-child node_modules',
  );
});

// REGRESSION: a shared cache Map lets contentHash (and selectSlice's
// internal computeScore) reuse a prior read for the same absDir instead of
// re-spawning `find` and re-reading every file — used by cmdNextSlice's
// --budget path to avoid re-hashing every candidate on every budget
// iteration, and to avoid a second, fully-redundant hash pass for the
// eventually-picked slice's cursor-patch write.
test('contentHash with a shared cache reuses the first read (proven by deleting the file in between — a fresh read would see the deletion, the cached read would not)', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  const cache = new Map();
  const first = contentHash(root, cache);
  fs.rmSync(path.join(root, 'a.js'));
  const second = contentHash(root, cache);
  assert.strictEqual(second, first, 'second call with the same cache must reuse the first read, not re-scan the now-empty dir');
});

test('contentHash without a cache (or with a fresh cache) does re-read the filesystem', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  const first = contentHash(root);
  fs.rmSync(path.join(root, 'a.js'));
  const second = contentHash(root);
  assert.notStrictEqual(second, first, 'without a shared cache, the deleted file must be reflected in a new hash');
});

test('selectSlice reuses a caller-supplied fileDataCache across repeated calls for the same slice (no cache: computes fresh; with cache: the winning slice\'s hash matches contentHash computed via that same cache)', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  const cache = new Map();
  const oldHash = 'stale-hash-from-last-run';
  const cursors = { '.': { lastSweptMs: Date.now() - 86400000, lastHash: oldHash } };
  const result = selectSlice(root, cursors, { now: Date.now(), fileDataCache: cache });
  assert.ok(result !== null);
  // The cache must now hold this slice's file data — contentHash(path, cache)
  // must return the exact same hash without needing the file on disk anymore.
  fs.rmSync(path.join(root, 'a.js'));
  // Ask for the same recursive-ness the slice was read under ('.' is
  // non-recursive) — the cache is keyed on (path, recursive), so a bare
  // contentHash(path, cache) is a deliberate miss, not a hit on this entry.
  const hashViaCache = contentHash(result.path, cache, { recursive: result.recursive });
  const expectedHash = contentHash(root); // fresh dir is now empty — different value; used only to confirm cache !== a fresh read
  assert.notStrictEqual(hashViaCache, expectedHash, 'the cached hash must reflect the pre-deletion content, not a fresh (now-empty) read');
});

test('fileDataCache does not serve a non-recursive read to a recursive caller for the same directory', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'nested', 'b.js'), 'const y = 2;\n');
  const cache = new Map();
  // Populate the cache with the NON-recursive read of root first...
  const nonRecursive = contentHash(root, cache, { recursive: false });
  // ...then ask for the recursive read of the very same directory.
  const recursive = contentHash(root, cache, { recursive: true });
  assert.notStrictEqual(
    recursive,
    nonRecursive,
    'a recursive read must see nested/b.js — a path-only cache key would hand back the non-recursive file list instead',
  );
  assert.strictEqual(recursive, contentHash(root, null, { recursive: true }), 'cached recursive read must equal an uncached one');
});

test('contentHash returns a stable hash for a dir with no source files', () => {
  const root = tmp();
  // No source files — should return a non-empty string without throwing
  const h = contentHash(root);
  assert.ok(typeof h === 'string' && h.length > 0);
});

test('contentHash with { recursive: false } is unaffected by a change inside a subdirectory', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const x = 1;\n');
  const before = contentHash(root, null, { recursive: false });
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const x = 2;\n');
  const after = contentHash(root, null, { recursive: false });
  assert.strictEqual(before, after, 'a change inside a subdirectory must not affect the non-recursive "." hash');
});

test('contentHash with { recursive: false } DOES change when a direct root-level file changes', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'root.js'), 'const x = 1;\n');
  const before = contentHash(root, null, { recursive: false });
  fs.writeFileSync(path.join(root, 'root.js'), 'const x = 2;\n');
  const after = contentHash(root, null, { recursive: false });
  assert.notStrictEqual(before, after, 'a change to a direct root-level file must affect the non-recursive "." hash');
});

test('contentHash: a flat repo with no subdirectories hashes identically whether recursive or not', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  fs.writeFileSync(path.join(root, 'b.js'), 'const y = 2;\n');
  assert.strictEqual(contentHash(root), contentHash(root, null, { recursive: false }));
});

// ─── selectSlice ───────────────────────────────────────────────────────────

test('selectSlice returns null when the only slice was recently judged and hash unchanged', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  const hash = contentHash(root);
  const recentMs = Date.now() - 1 * 86400000; // 1 day ago — well under MAX_STALE_DAYS
  const cursors = { '.': { lastSweptMs: recentMs, lastHash: hash } };
  // Only one slice (.) and its hash matches → nothing to pick
  const result = selectSlice(root, cursors, { now: Date.now() });
  assert.strictEqual(result, null, 'unchanged recently-judged slice must be skipped');
});

test('selectSlice picks a slice whose content-hash changed', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  const oldHash = 'stale-hash-from-last-run';
  const recentMs = Date.now() - 1 * 86400000;
  const cursors = { '.': { lastSweptMs: recentMs, lastHash: oldHash } };
  const result = selectSlice(root, cursors, { now: Date.now() });
  assert.ok(result !== null, 'changed content must be picked');
  assert.strictEqual(result.id, '.');
  assert.strictEqual(result.why, 'hotspot');
});

test('selectSlice force-picks a slice unjudged past MAX_STALE_DAYS', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  const hash = contentHash(root);
  // last judged 35 days ago — past the 30-day floor
  const staleMs = Date.now() - (MAX_STALE_DAYS + 5) * 86400000;
  const cursors = { '.': { lastSweptMs: staleMs, lastHash: hash } };
  const result = selectSlice(root, cursors, { now: Date.now() });
  assert.ok(result !== null, 'stale slice must be force-picked even if hash unchanged');
  assert.strictEqual(result.why, 'stale');
});

test('selectSlice force-picks a slice that has never been judged', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'a.js'), 'const x = 1;\n');
  const result = selectSlice(root, {}, { now: Date.now() });
  assert.ok(result !== null, 'never-judged slice must be picked');
  assert.strictEqual(result.why, 'stale');
});

test('selectSlice hotspot priority: a high-churn dir is preferred over a low-churn one (via opts.signals override)', () => {
  // We cannot run real git in tmp, so test priority via the signals-injection hook
  const root = tmp();
  fs.mkdirSync(path.join(root, 'hot'));
  fs.mkdirSync(path.join(root, 'cold'));
  fs.writeFileSync(path.join(root, 'hot', 'a.js'), 'const x = 1;\n');
  fs.writeFileSync(path.join(root, 'cold', 'b.js'), 'const y = 2;\n');
  const oldHash = 'old-hash';
  const recentMs = Date.now() - 1 * 86400000;
  const cursors = {
    '.': { lastSweptMs: recentMs, lastHash: oldHash },
    'hot': { lastSweptMs: recentMs, lastHash: oldHash },
    'cold': { lastSweptMs: recentMs, lastHash: oldHash },
  };
  // Inject signals: 'hot' has high churn, 'cold' has low
  const result = selectSlice(root, cursors, {
    now: Date.now(),
    signals: { '.': { churn: 0, loc: 0 }, 'hot': { churn: 20, loc: 10 }, 'cold': { churn: 1, loc: 5 } },
  });
  assert.ok(result !== null, 'must pick a slice when hashes differ');
  assert.strictEqual(result.id, 'hot', 'high-churn slice must be picked first');
});

test('selectSlice rotation: a second call after first is recorded picks a different slice', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'pkg-a'));
  fs.mkdirSync(path.join(root, 'pkg-b'));
  fs.writeFileSync(path.join(root, 'pkg-a', 'a.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(root, 'pkg-b', 'b.js'), 'const b = 2;\n');

  // First pick: no cursors → picks something (stale)
  const first = selectSlice(root, {}, { now: Date.now() });
  assert.ok(first !== null);

  // Record the first pick: mark it as recently judged with its current hash
  const hash1 = contentHash(first.path);
  const cursorsAfterFirst = {
    [first.id]: { lastSweptMs: Date.now(), lastHash: hash1 },
  };

  // Second pick: first slice is now fresh and hash-matched; a different slice should be chosen
  const second = selectSlice(root, cursorsAfterFirst, { now: Date.now() });
  // second must be null OR a different slice (could be null if only one non-root slice + root and
  // both just got recorded; the key property is it does NOT re-pick the same unchanged slice)
  if (second !== null) {
    assert.notStrictEqual(second.id, first.id, 'must not re-pick the already-judged unchanged slice');
  }
});

// ─── Workspace-aware slicing: listWorkspaceSlices ─────────────────────────────

test('listWorkspaceSlices: expands a package.json workspaces array with a trailing /* pattern', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
  fs.mkdirSync(path.join(root, 'packages', 'a'), { recursive: true });
  fs.mkdirSync(path.join(root, 'packages', 'b'), { recursive: true });
  const ids = listWorkspaceSlices(root).map((s) => s.id).sort();
  assert.deepStrictEqual(ids, ['packages/a', 'packages/b']);
});

test('listWorkspaceSlices: expands the package.json workspaces.packages object form', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: { packages: ['apps/*'] } }));
  fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
  const ids = listWorkspaceSlices(root).map((s) => s.id);
  assert.deepStrictEqual(ids, ['apps/web']);
});

test('listWorkspaceSlices: accepts a literal (non-glob) package path', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['tools/cli'] }));
  fs.mkdirSync(path.join(root, 'tools', 'cli'), { recursive: true });
  const ids = listWorkspaceSlices(root).map((s) => s.id);
  assert.deepStrictEqual(ids, ['tools/cli']);
});

test('listWorkspaceSlices: a literal pattern pointing at a non-existent path yields nothing', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['tools/missing'] }));
  assert.deepStrictEqual(listWorkspaceSlices(root), []);
});

test('listWorkspaceSlices: reads pnpm-workspace.yaml when package.json has no workspaces field', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'root' }));
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n  - "apps/*"\n');
  fs.mkdirSync(path.join(root, 'packages', 'db'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
  const ids = listWorkspaceSlices(root).map((s) => s.id).sort();
  assert.deepStrictEqual(ids, ['apps/web', 'packages/db']);
});

test('listWorkspaceSlices: package.json workspaces field takes precedence over pnpm-workspace.yaml', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n');
  fs.mkdirSync(path.join(root, 'packages', 'db'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
  const ids = listWorkspaceSlices(root).map((s) => s.id);
  assert.deepStrictEqual(ids, ['packages/db'], 'package.json must win when both manifests exist');
});

test('listWorkspaceSlices: unsupported pattern (double-star) is skipped, not thrown', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['apps/**'] }));
  fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
  assert.doesNotThrow(() => listWorkspaceSlices(root));
  assert.deepStrictEqual(listWorkspaceSlices(root), []);
});

test('listWorkspaceSlices: returns [] when neither package.json nor pnpm-workspace.yaml exist', () => {
  const root = tmp();
  assert.deepStrictEqual(listWorkspaceSlices(root), []);
});

test('listWorkspaceSlices: returns [] when package.json has no workspaces field', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x' }));
  assert.deepStrictEqual(listWorkspaceSlices(root), []);
});

test('listWorkspaceSlices: slice.path is the absolute path to the expanded package', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
  fs.mkdirSync(path.join(root, 'packages', 'db'), { recursive: true });
  const slice = listWorkspaceSlices(root).find((s) => s.id === 'packages/db');
  assert.ok(slice, 'packages/db slice must exist');
  assert.strictEqual(slice.path, path.join(root, 'packages', 'db'));
});

test('listWorkspaceSlices: strips a leading "./" from a workspace pattern', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['./packages/*'] }));
  fs.mkdirSync(path.join(root, 'packages', 'a'), { recursive: true });
  const ids = listWorkspaceSlices(root).map((s) => s.id);
  assert.deepStrictEqual(ids, ['packages/a'], 'a leading "./" must not produce a malformed id');
});

test('listSlices: a leading "./" workspace pattern still replaces the mega-slice (no duplicate coverage)', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['./packages/*'] }));
  fs.mkdirSync(path.join(root, 'packages', 'a'), { recursive: true });
  const ids = listSlices(root).map((s) => s.id).sort();
  assert.deepStrictEqual(ids, ['.', 'packages/a']);
  assert.ok(!ids.includes('packages'), 'raw mega-slice must not survive alongside the expanded child');
});

test('listSlices: a literal workspace entry that exactly names a top-level dir does NOT also produce a duplicate top-level slice for the same dir', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['packages'] }));
  fs.mkdirSync(path.join(root, 'packages'), { recursive: true });
  const slices = listSlices(root);
  const packagesSlices = slices.filter((s) => s.id === 'packages');
  assert.strictEqual(
    packagesSlices.length,
    1,
    `"packages" must appear exactly once, got ${packagesSlices.length}: ${JSON.stringify(packagesSlices)}`,
  );
  assert.strictEqual(packagesSlices[0].path, path.join(root, 'packages'));
});

// ─── listSlices ordering (deterministic, not readdir-order-dependent) ─────────

test('listSlices returns slices sorted by id, not raw readdir order', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = {};\n');
  // Create in an order that is very unlikely to already be alphabetical.
  for (const name of ['zeta', 'alpha', 'mu', 'beta']) {
    fs.mkdirSync(path.join(root, name));
  }
  const ids = listSlices(root).map((s) => s.id);
  assert.deepStrictEqual(ids, [...ids].sort(), 'listSlices output must already be in sorted order');
  assert.deepStrictEqual(ids, ['.', 'alpha', 'beta', 'mu', 'zeta']);
});

// ─── listSlices byte cap (splitOversized) ──────────────────────────────────

test('listSlices leaves an under-cap directory as one recursive slice', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'small', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'small', 'a.js'), 'const x = 1;\n');
  fs.writeFileSync(path.join(root, 'small', 'nested', 'b.js'), 'const y = 2;\n');
  const slices = listSlices(root);
  assert.deepStrictEqual(slices.map((s) => s.id), ['small'], 'an under-cap dir must not be split');
  assert.strictEqual(slices[0].recursive, true);
});

test('listSlices splits an over-cap directory into own-files + per-subdirectory slices', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'big', 'one'), { recursive: true });
  fs.mkdirSync(path.join(root, 'big', 'two'), { recursive: true });
  fs.writeFileSync(path.join(root, 'big', 'own.js'), `// ${BIG}\n`);
  fs.writeFileSync(path.join(root, 'big', 'one', 'a.js'), `// ${BIG}\n`);
  fs.writeFileSync(path.join(root, 'big', 'two', 'b.js'), 'const y = 2;\n');
  const slices = listSlices(root);
  assert.deepStrictEqual(slices.map((s) => s.id), ['big', 'big/one', 'big/two']);
  const byId = Object.fromEntries(slices.map((s) => [s.id, s]));
  assert.strictEqual(byId['big'].recursive, false, 'the parent covers only its OWN direct files once split');
  assert.strictEqual(byId['big/one'].recursive, true);
  assert.strictEqual(byId['big/two'].recursive, true);
});

test('listSlices splitting loses no source file — every file lands in exactly one slice', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'big', 'one', 'deeper'), { recursive: true });
  fs.mkdirSync(path.join(root, 'big', 'two'), { recursive: true });
  const written = [
    path.join(root, 'big', 'own.js'),
    path.join(root, 'big', 'one', 'a.js'),
    path.join(root, 'big', 'one', 'deeper', 'c.js'),
    path.join(root, 'big', 'two', 'b.js'),
  ];
  for (const f of written) fs.writeFileSync(f, `// ${BIG}\n`);

  // Reconstruct the covered set from the emitted slices, honoring each
  // slice's own recursive flag — the same way every consumer reads them.
  const covered = [];
  for (const slice of listSlices(root)) {
    const args = ['find', slice.path, '-type', 'f', '-name', '*.js'];
    if (!slice.recursive) args.splice(2, 0, '-maxdepth', '1');
    const out = execFileSync(args[0], args.slice(1), { encoding: 'utf8' });
    covered.push(...out.split('\n').filter(Boolean));
  }
  assert.deepStrictEqual([...covered].sort(), [...written].sort(), 'split must cover every file exactly once — no drops, no double-counting');
});

test('listSlices emits an over-cap directory whole when it has no subdirectory to split by', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'flat'));
  fs.writeFileSync(path.join(root, 'flat', 'a.js'), `// ${BIG}\n`);
  const slices = listSlices(root);
  // Splitting is impossible here; truncating would make the judge blind to
  // files it is told it read, so the oversized slice is emitted intact.
  assert.deepStrictEqual(slices.map((s) => s.id), ['flat']);
  assert.strictEqual(slices[0].recursive, true);
});

test('listSlices splits recursively — an over-cap child is itself split', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'big', 'mid', 'leaf'), { recursive: true });
  fs.writeFileSync(path.join(root, 'big', 'mid', 'own.js'), `// ${BIG}\n`);
  fs.writeFileSync(path.join(root, 'big', 'mid', 'leaf', 'x.js'), `// ${BIG}\n`);
  const ids = listSlices(root).map((s) => s.id);
  assert.deepStrictEqual(ids, ['big/mid', 'big/mid/leaf'], 'the split must descend past the first level');
});

// ─── gitChurn ──────────────────────────────────────────────────────────────

test('gitChurn counts a commit within the 30-day window', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const x = 1;\n');
  initGitRepo(root);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'init']);
  const churn = gitChurn(root, '.', Date.now());
  assert.ok(churn >= 1, `expected the just-made commit to be counted, got churn=${churn}`);
});

test(
  'gitChurn does not collapse its --since boundary to a bare date string ' +
  '(regression: a bare "1970-01-01" --since value is silently mishandled by git ' +
  'and matches zero commits in some timezones — confirmed by direct experimentation ' +
  'with TZ=Asia/Tokyo against this exact repo/commit shape)',
  () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const x = 1;\n');
    initGitRepo(root);
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'init']);

    const originalTz = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      // now = 30 days (in ms) after the epoch, so gitChurn's internal
      // `now - 30*86400000` boundary is exactly epoch (0). The old buggy
      // implementation (`.toISOString().slice(0, 10)`) turns that into the
      // bare string "1970-01-01"; the fix uses the full ISO datetime
      // instead. Both are handed to `git log --since=`, but only the bare
      // form is silently mishandled under TZ=Asia/Tokyo.
      const now = 30 * 86400000;
      const churn = gitChurn(root, '.', now);
      assert.ok(
        churn >= 1,
        `expected the just-made commit to be counted with a full-ISO --since boundary, got churn=${churn}`,
      );
    } finally {
      if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
    }
  },
);

test('gitChurn with { recursive: false } scopes to the named directory, not to the repo root', () => {
  // splitOversized emits a non-recursive slice for any oversized directory's
  // own files, so recursive:false now reaches gitChurn with a non-"." relDir.
  // The pre-split implementation hardcoded the ROOT's direct files in this
  // branch, which would report root-level churn under 'pkg''s id (and zero
  // churn for pkg's own files).
  const root = tmp();
  fs.mkdirSync(path.join(root, 'pkg', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'rootlevel.js'), 'const r = 0;\n');
  fs.writeFileSync(path.join(root, 'pkg', 'own.js'), 'const x = 1;\n');
  fs.writeFileSync(path.join(root, 'pkg', 'nested', 'deep.js'), 'const y = 2;\n');
  initGitRepo(root);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'init']);

  // A commit touching ONLY pkg/own.js must count for pkg's non-recursive churn.
  fs.writeFileSync(path.join(root, 'pkg', 'own.js'), 'const x = 2;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'touch pkg/own.js']);
  assert.ok(
    gitChurn(root, 'pkg', Date.now(), { recursive: false }) >= 1,
    "a commit to pkg's own direct file must count toward pkg's non-recursive churn",
  );

  // A commit touching ONLY pkg/nested must NOT count — that is a different slice.
  const before = gitChurn(root, 'pkg', Date.now(), { recursive: false });
  fs.writeFileSync(path.join(root, 'pkg', 'nested', 'deep.js'), 'const y = 3;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'touch pkg/nested only']);
  assert.strictEqual(
    gitChurn(root, 'pkg', Date.now(), { recursive: false }),
    before,
    "a commit touching only pkg/nested belongs to the pkg/nested slice, not to pkg's own-files slice",
  );

  // A commit touching ONLY a root-level file must NOT count toward pkg.
  const beforeRoot = gitChurn(root, 'pkg', Date.now(), { recursive: false });
  fs.writeFileSync(path.join(root, 'rootlevel.js'), 'const r = 1;\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'touch rootlevel.js only']);
  assert.strictEqual(
    gitChurn(root, 'pkg', Date.now(), { recursive: false }),
    beforeRoot,
    "root-level churn must not be reported under pkg's id",
  );
});

test('gitChurn with { recursive: false } does not count a commit that only touches a nested file', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const x = 1;\n');
  initGitRepo(root);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'nested file only']);
  const churn = gitChurn(root, '.', Date.now(), { recursive: false });
  assert.strictEqual(churn, 0, 'a commit touching only a nested file must not count toward the non-recursive "." churn');
});

test('gitChurn with { recursive: false } counts a commit that touches a direct root-level file', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'root.js'), 'const x = 1;\n');
  initGitRepo(root);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'root-level file']);
  const churn = gitChurn(root, '.', Date.now(), { recursive: false });
  assert.ok(churn >= 1, `expected the root-level commit to be counted, got churn=${churn}`);
});

// ─── SKIP_DIRS anchoring (#111) ────────────────────────────────────────────
//
// sourceFiles excludes SKIP_DIRS by passing find `-not -path "*/<dir>/*"`.
// find's -path matches the WHOLE path string, so while the start point was
// absolute, absDir's own ancestors sat in front of every candidate — and a
// checkout living under any segment named in SKIP_DIRS excluded itself
// entirely. A linked worktree sits at <repo>/.claude/worktrees/<name>, so every
// sweep run from one found zero files while still emitting every slice: it
// judged nothing and filed nothing, and reported success.

// Identical content at each root, so any difference in what is found is
// attributable to the root's own path and nothing else.
function checkoutUnder(...ancestorSegments) {
  const root = path.join(tmp(), ...ancestorSegments);
  fs.mkdirSync(path.join(root, 'bin', 'nested'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'top.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(root, 'bin', 'a.js'), 'const b = 2;\n');
  fs.writeFileSync(path.join(root, 'bin', 'nested', 'deep.js'), 'const c = 3;\n');
  fs.writeFileSync(path.join(root, 'node_modules', 'dep.js'), 'const d = 4;\n');
  return root;
}

const relFiles = (root) => sourceFiles(root).map((f) => path.relative(root, f)).sort();

// Every ancestor here is a SKIP_DIRS entry. `.claude/worktrees` is the one that
// bit in production; the others share the exact generated -path shape.
for (const ancestors of [['.claude', 'worktrees', 'demo'], ['build', 'checkout'], ['node_modules', 'checkout'], ['dist', 'checkout']]) {
  const label = ancestors.join('/');

  test(`sourceFiles finds the same files from a checkout under ${label} as from a plain root`, () => {
    const expected = relFiles(checkoutUnder());
    assert.deepStrictEqual(expected, ['bin/a.js', 'bin/nested/deep.js', 'top.js'], 'baseline fixture changed');
    assert.deepStrictEqual(relFiles(checkoutUnder(...ancestors)), expected);
  });

  test(`listSlices emits the same slices from a checkout under ${label}`, () => {
    const ids = (root) => listSlices(root).map((s) => s.id);
    // The "." slice is the tell: it exists only when sourceFiles finds a direct
    // file child, so an ancestor-excluded root drops it without erroring.
    assert.deepStrictEqual(ids(checkoutUnder()), ['.', 'bin'], 'baseline fixture changed');
    assert.deepStrictEqual(ids(checkoutUnder(...ancestors)), ['.', 'bin']);
  });
}

test('a SKIP_DIRS directory INSIDE the scanned tree is still excluded', () => {
  // The exclusions must keep meaning what they say — this is what breaks if the
  // anchoring fix is mistaken for "drop the exclusions".
  for (const root of [checkoutUnder(), checkoutUnder('.claude', 'worktrees', 'demo')]) {
    assert.ok(!relFiles(root).some((f) => f.startsWith('node_modules/')), `node_modules leaked into ${root}`);
  }
});

test('sourceFiles returns absolute paths regardless of where the root sits', () => {
  // Callers read these with fs.readFileSync and hash them by path, so a
  // relative path would fail silently one layer away from the change.
  for (const root of [checkoutUnder(), checkoutUnder('.claude', 'worktrees', 'demo')]) {
    for (const f of sourceFiles(root)) assert.ok(path.isAbsolute(f), `not absolute: ${f}`);
  }
});
