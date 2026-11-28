const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('node:os');
const path = require('node:path');
const { hasTestScript } = require('../../../plugin/bin/lib/residue/detect-test-script');

function tmpDir() {
  return scratchDir('residue-detect-test-');
}

// Every fixture below plants a `.git` marker at the boundary it wants the
// walk-up to stop at, so the test is hermetic — it never depends on what
// happens to live above os.tmpdir() on the machine running it.
function markRepoRoot(dir) {
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n');
}

// Verified live before this fix: a directory with no package.json at all
// (the case any non-Node project, or a bare scratch dir, hits) made
// bin/residue.js run `npm test` anyway, and npm's own "missing script" exit
// code was reported as a genuine red suite finding.
test('no package.json at all degrades to unknown, never a finding', () => {
  const dir = tmpDir();
  markRepoRoot(dir);
  assert.strictEqual(hasTestScript(dir), false);
});

test('a package.json with no scripts.test key degrades to unknown', () => {
  const dir = tmpDir();
  markRepoRoot(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { build: 'tsc' } }));
  assert.strictEqual(hasTestScript(dir), false);
});

test('a package.json with an empty scripts.test string degrades to unknown', () => {
  const dir = tmpDir();
  markRepoRoot(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: '   ' } }));
  assert.strictEqual(hasTestScript(dir), false);
});

test('a package.json with a real scripts.test entry is detected', () => {
  const dir = tmpDir();
  markRepoRoot(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node --test tests/' } }));
  assert.strictEqual(hasTestScript(dir), true);
});

test('a malformed package.json degrades to unknown rather than throwing', () => {
  const dir = tmpDir();
  markRepoRoot(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{ not valid json');
  assert.strictEqual(hasTestScript(dir), false);
});

// The regression this fix closes: `npm test` walks up to the nearest
// package.json; a check confined to `cwd` alone does not. Verified live
// before this fix, on this repo, with a genuinely red suite: run from the
// repo root, the suite probe ran and reported the failure; run from
// `sub/deeper`, it reported "unknown: no test command detected" instead —
// a false reason string on a repo that plainly has a test command, and a
// silent loss of the one probe this whole feature exists for.
test('a package.json above the starting directory is found by walking up', () => {
  const root = tmpDir();
  markRepoRoot(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node --test tests/' } }));
  const deep = path.join(root, 'sub', 'deeper');
  fs.mkdirSync(deep, { recursive: true });
  assert.strictEqual(hasTestScript(deep), true, 'the walk-up must find the repo root\'s package.json');
});

// The walk stops at the repository boundary rather than the filesystem
// root: an enclosing directory's package.json belongs to a different
// project (a parent workspace, an unrelated checkout one level up), and
// picking it up would be its own wrong answer, not a more honest one.
test('the walk-up stops at the repository boundary, never searching an enclosing project', () => {
  const outer = tmpDir();
  fs.writeFileSync(path.join(outer, 'package.json'), JSON.stringify({ name: 'enclosing-project', scripts: { test: 'node --test tests/' } }));
  const repo = path.join(outer, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  markRepoRoot(repo); // repo/ is where the git repository actually starts
  const deep = path.join(repo, 'sub');
  fs.mkdirSync(deep, { recursive: true });
  assert.strictEqual(hasTestScript(deep), false, 'must not ascend past the .git boundary into the enclosing project');
});
