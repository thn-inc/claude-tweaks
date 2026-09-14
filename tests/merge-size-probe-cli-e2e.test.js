'use strict';
// Fixture e2e for #641's merge-tree ceiling probe (bin/merge-size-probe.js).
// Proves the record's own scenario against a REAL git repo, not a fake
// runner: two branches that are each green alone against a shared file, but
// whose merge pushes it over the 40 KB ceiling -- the exact failure mode the
// in-tree-only skill-audit/context-cost.js checks cannot see, since each
// branch is measured in isolation there.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { CEILING_BYTES } = require('../plugin/bin/lib/skill-audit/context-cost.js');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'merge-size-probe.js');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// A block of exactly `n` bytes (ASCII, so byte count === char count),
// newline-terminated, tagged so two blocks never collide on git's own
// merge-conflict diff heuristics when placed at different file offsets.
function block(tag, n) {
  const filler = tag.repeat(Math.ceil(n / tag.length)).slice(0, n - 1);
  return `${filler}\n`;
}

// Base repo: `main` with skills/_shared/big.md at BASE_SIZE bytes. Then:
// - `main` gets SIBLING's own commit appended at the file's END (simulating
//   a concurrent sibling branch that already merged).
// - `feature` branches from the pre-sibling base and prepends its own
//   addition at the file's START (a different offset, so the 3-way merge
//   is clean -- no conflict, just size growth from both sides).
// Each of `main` (base+sibling) and `feature` (base+feature) alone stays
// under CEILING_BYTES; merging them does not.
// Relative to CEILING_BYTES (not hardcoded) so this fixture stays correct
// whatever the ceiling is: base+add stays comfortably under it, base+add+add
// pushes just over it.
const BASE_SIZE = CEILING_BYTES - 1960;
const ADD_SIZE = 1200;

function makeFixtureRepo(featureAddSize) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-size-probe-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  const filePath = path.join(dir, 'skills', '_shared', 'big.md');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, block('B', BASE_SIZE));
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'base');

  git(dir, 'checkout', '-b', 'feature');
  const baseContent = fs.readFileSync(filePath, 'utf8');
  fs.writeFileSync(filePath, block('F', featureAddSize) + baseContent);
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'feature addition (prepended)');

  git(dir, 'checkout', 'main');
  fs.writeFileSync(filePath, baseContent + block('S', ADD_SIZE));
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'sibling addition (already on main, appended)');

  return { dir, filePath };
}

test('e2e: two branches each green alone; merge pushes the shared file over the 40 KB ceiling', () => {
  const { dir, filePath } = makeFixtureRepo(ADD_SIZE);

  // Each side alone is under the ceiling -- the record's own premise.
  const mainBytes = fs.statSync(filePath).size;
  git(dir, 'checkout', 'feature');
  const featureBytes = fs.statSync(filePath).size;
  git(dir, 'checkout', 'main');
  assert.ok(mainBytes < CEILING_BYTES, `main alone (${mainBytes} B) should be under ceiling`);
  assert.ok(featureBytes < CEILING_BYTES, `feature alone (${featureBytes} B) should be under ceiling`);

  const res = spawnSync(
    'node',
    [CLI, '--integration-branch', 'main', '--head', 'feature'],
    { cwd: dir, encoding: 'utf8' }
  );
  assert.strictEqual(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.strictEqual(out.overflow.length, 1, `expected exactly one overflow entry, got: ${res.stdout}`);
  assert.strictEqual(out.overflow[0].path, 'skills/_shared/big.md');
  assert.strictEqual(out.overflow[0].bytes, BASE_SIZE + ADD_SIZE + ADD_SIZE);
  assert.ok(out.overflow[0].bytes > CEILING_BYTES);
});

// AC3 (#641): a branch that stays under ceiling both alone AND merged with
// main must pass with no false-positive overflow.
test('e2e: a branch under ceiling alone and merged reports zero overflow (no false positive)', () => {
  const smallAdd = 100; // base+sibling(1200)+small(100) stays comfortably under CEILING_BYTES.
  const { dir } = makeFixtureRepo(smallAdd);

  const res = spawnSync(
    'node',
    [CLI, '--integration-branch', 'main', '--head', 'feature'],
    { cwd: dir, encoding: 'utf8' }
  );
  assert.strictEqual(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.deepStrictEqual(out.overflow, []);
  assert.strictEqual(out.measured.length, 1);
  assert.ok(out.measured[0].bytes < CEILING_BYTES);
});

test('e2e: an unresolvable integration branch exits 1 with stderr and NO stdout', () => {
  const { dir } = makeFixtureRepo(ADD_SIZE);
  const res = spawnSync(
    'node',
    [CLI, '--integration-branch', 'no-such-branch', '--head', 'feature'],
    { cwd: dir, encoding: 'utf8' }
  );
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /merge-size-probe: /);
  assert.strictEqual(res.stdout, '', 'a resolution failure must never print a result');
});
