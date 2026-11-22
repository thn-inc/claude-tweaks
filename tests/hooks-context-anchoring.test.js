'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const path = require('path');
const { iterRunDirsWithState } = require('../plugin/bin/lib/hooks/context');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');

function seedRun(root, name, state) {
  const dir = path.join(root, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify(state));
  return dir;
}

test('iterRunDirsWithState: from inside a linked worktree yields the MAIN checkout run set', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  seedRun(main, '2026-08-07T120000-spec-1', { status: 'active' });

  const names = [...iterRunDirsWithState(wt)].map((e) => path.basename(e.dir));
  assert.deepStrictEqual(names, ['2026-08-07T120000-spec-1']);
});

test('iterRunDirsWithState: a run dir inside the worktree is NOT yielded once anchoring is on', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  seedRun(wt, '2026-08-07T130000-spec-9', { status: 'active' });

  const names = [...iterRunDirsWithState(wt)].map((e) => path.basename(e.dir));
  assert.deepStrictEqual(names, []);
});

test('iterRunDirsWithState: from the main checkout is unchanged', () => {
  const main = gitRepo();
  seedRun(main, '2026-08-07T140000-spec-2', { status: 'interrupted' });

  const names = [...iterRunDirsWithState(main)].map((e) => path.basename(e.dir));
  assert.deepStrictEqual(names, ['2026-08-07T140000-spec-2']);
});

test('iterRunDirsWithState: outside any repo falls back to cwd-relative behavior', () => {
  const dir = scratchDir('ct-anchor-');
  seedRun(dir, '2026-08-07T150000-spec-3', { status: 'active' });

  const names = [...iterRunDirsWithState(dir)].map((e) => path.basename(e.dir));
  assert.deepStrictEqual(names, ['2026-08-07T150000-spec-3']);
});
