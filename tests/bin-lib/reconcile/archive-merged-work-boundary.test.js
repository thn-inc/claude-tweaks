'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { archiveRunDir } = require('../../../plugin/bin/lib/reconcile/archive-merged');

// archiveRunDir's tracked-entry guard exempts the run dir's `work/` subtree via
// `isPathContained(abs, workDir, { orEqual: true })` (#3498 replaced a
// `rel.startsWith('work' + path.sep) || rel === 'work'` test). The sibling suite
// pins a stray tracked file outside `work/`; this pins the prefix-sibling edge,
// which a separator-less `startsWith(workDir)` would exempt. The `orEqual` edge
// (a tracked path exactly at {runDir}/work) has no observable test: the workMoves
// batch `git mv`s `work` before the guard runs, so `git ls-files` never lists it
// there and a strict-mode mutant is equivalent.

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-work-boundary-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'init');
  return dir;
}

function commitPath(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  git(root, 'add', relPath);
  git(root, 'commit', '-m', `add ${relPath}`);
}

test('archiveRunDir: a tracked path under a work-prefixed sibling ({runDir}/workshop/) still refuses tracked-entry', () => {
  const root = makeRepo();
  const runId = '2026-10-19T090100-record-43-standalone';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  commitPath(root, `.claude-tweaks/pipelines/${runId}/workshop/notes.md`, '# not under work/\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));

  const result = archiveRunDir(root, runDir);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'tracked-entry');
});
