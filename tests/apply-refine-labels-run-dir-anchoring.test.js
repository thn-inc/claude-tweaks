// tests/apply-refine-labels-run-dir-anchoring.test.js
//
// #844: apply-refine-labels.js's --run must be anchored under the main
// checkout, never a worktree-relative shadow ([IL-127]) — same guard
// bin/materialize.js's --run-dir applies (see
// tests/materialize-run-dir-anchoring.test.js, the pattern this file
// mirrors). run(argv, deps) is directly callable against real
// gitRepo()/linkedWorktreeOf() fixtures, chdir'd per test, proving the
// anchoring check runs BEFORE any gh call.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');
const wtDetect = require('../plugin/bin/lib/hooks/worktree-detect');
const { run } = require('../plugin/bin/apply-refine-labels');

function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(prev); }
}

function fakeDeps(overrides = {}) {
  const calls = { ghAvailable: 0, stderr: [] };
  return {
    calls,
    ghAvailable: () => { calls.ghAvailable += 1; return false; }, // stop right after, if reached
    gh: () => { throw new Error('gh should never be called when --run is rejected'); },
    readFile: () => { throw new Error('readFile should never be called when --run is rejected'); },
    remoteUrl: () => { throw new Error('remoteUrl should never be called in these tests'); },
    cwd: () => process.cwd(),
    mainRoot: (cwd) => wtDetect.mainCheckoutRoot(cwd),
    isAnchored: (resolvedPath, mainRoot) => wtDetect.isAnchoredUnderRoot(resolvedPath, mainRoot),
    stdout: () => {},
    stderr: (s) => { calls.stderr.push(s); },
    ...overrides,
  };
}

test('reject: --run resolves inside the linked worktree, not the main checkout', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const deps = fakeDeps();
  const abs = path.join(wt, '.claude-tweaks', 'pipelines', 'x');
  const code = withCwd(wt, () => run(['actions.json', '--run', abs], deps));
  assert.strictEqual(code, 2);
  assert.match(deps.calls.stderr.join(''), /resolves outside the main checkout/i);
  assert.strictEqual(deps.calls.ghAvailable, 0, 'must reject before ever checking gh availability');
});

test('accept: --run is absolute and anchored under the main checkout', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const deps = fakeDeps();
  const abs = path.join(main, '.claude-tweaks', 'pipelines', 'x');
  const code = withCwd(wt, () => run(['actions.json', '--run', abs], deps));
  // Rejected downstream by the stubbed ghAvailable()=false, NOT by anchoring.
  assert.strictEqual(code, 2);
  assert.doesNotMatch(deps.calls.stderr.join(''), /resolves outside the main checkout/i);
  assert.strictEqual(deps.calls.ghAvailable, 1, 'a correctly anchored --run must reach the gh-availability check');
});

test('reject: --run has no git repo ancestor at all — distinct message', () => {
  const bare = scratchDir('ct-apply-refine-norepo-');
  const deps = fakeDeps();
  const abs = path.join(bare, '.claude-tweaks', 'pipelines', 'x');
  const code = withCwd(bare, () => run(['actions.json', '--run', abs], deps));
  assert.strictEqual(code, 2);
  assert.match(deps.calls.stderr.join(''), /could not determine the git repository root/i);
  assert.strictEqual(deps.calls.ghAvailable, 0);
});

test('run with no --run flag skips the anchoring check entirely (optional flag)', () => {
  const main = gitRepo();
  const deps = fakeDeps();
  const code = withCwd(main, () => run(['actions.json'], deps));
  assert.strictEqual(code, 2); // stops at the stubbed ghAvailable()=false, having never touched --run logic
  assert.doesNotMatch(deps.calls.stderr.join(''), /resolves outside|could not determine/i);
});
