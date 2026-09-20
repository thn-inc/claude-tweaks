'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { run, parseArgs } = require('../../../plugin/bin/check-pr-bookkeeping');

// Realistic git shape, mirroring tests/bin-lib/log-decision/cli.test.js's own
// fixture: the main checkout's `.git` is a DIRECTORY; a linked worktree's is
// a FILE carrying a gitdir: pointer. resolveTarget's structural anchoring
// check keys on that difference, so a fake marker (no real git init needed)
// is enough for the anchor-ok / shadow-refused cases below. `mainRoot: main`
// is injected explicitly so resolveTarget never has to spawn real git either.
function anchoredFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prbk-cli-'));
  const main = path.join(root, 'main');
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  return main;
}

function makeCleanRunDir(main) {
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-09-17T000009-spec-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  return runDir;
}

// `mainRoot` mirrors log-decision.js's realDeps shape: explicit (a fake-.git
// fixture, or an intentional override) or omitted so resolveTarget computes
// the anchor itself via a real `mainCheckoutRoot(cwd)` git spawn (the
// exit-4 fixture below, which needs the genuine git-worktree traversal).
function makeDeps({ cwd, mainRoot } = {}) {
  const out = []; const err = [];
  return {
    deps: {
      cwd: () => cwd || process.cwd(),
      mainRoot,
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    },
    out,
    err,
  };
}

// --- real-git fixtures for the exit-4 end-to-end DENY test (Finding 3) ---
// Mirrors tests/bin-lib/pr-bookkeeping/precondition.test.js's own helpers —
// this is the #2472 core DENY scenario, exercised here through the CLI's
// run() rather than calling checkPrBookkeepingPrecondition directly.
function gitRepoWithCommit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prbk-cli-git-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'init', '-q']);
  return fs.realpathSync(dir);
}

function linkedWorktreeOf(main) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prbk-cli-wtparent-'));
  const wt = path.join(parent, 'wt');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt, '-b', `wt-branch-${path.basename(parent)}`]);
  return fs.realpathSync(wt);
}

function commitMaterializeFile(repo, runId) {
  const rel = path.join('.claude-tweaks', 'pipelines', runId, 'work', '1-spec.md');
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'spec\n');
  execFileSync('git', ['-C', repo, 'add', rel.split(path.sep).join('/')]);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'materialize', '-q']);
}

test('parseArgs: --help sets help flag', () => {
  const o = parseArgs(['--help']);
  assert.strictEqual(o.help, true);
});

test('parseArgs: unknown flag returns an error', () => {
  const o = parseArgs(['--bogus']);
  assert.ok(o.error);
});

test('run: --help exits 0 and prints usage', () => {
  const { deps, out } = makeDeps();
  const code = run(['--help'], deps);
  assert.strictEqual(code, 0);
  assert.match(out.join(''), /usage: check-pr-bookkeeping\.js/);
});

test('run: missing --run exits 2', () => {
  const { deps, err } = makeDeps();
  const code = run([], deps);
  assert.strictEqual(code, 2);
  assert.match(err.join(''), /--run <run-dir> is required/);
});

test('run: unknown argument exits 2', () => {
  const { deps, err } = makeDeps();
  const code = run(['--bogus'], deps);
  assert.strictEqual(code, 2);
  assert.match(err.join(''), /unknown argument/);
});

test('run: nonexistent run dir exits 3', () => {
  const { deps, err } = makeDeps();
  const code = run(['--run', '/nonexistent/path/xyz'], deps);
  assert.strictEqual(code, 3);
  assert.match(err.join(''), /run dir does not exist/);
});

test('run: a clean run anchored under the main checkout exits 0', () => {
  const main = anchoredFixture();
  const { deps, out } = makeDeps({ cwd: main, mainRoot: main });
  const runDir = makeCleanRunDir(main);
  const code = run(['--run', runDir], deps);
  assert.strictEqual(code, 0);
  assert.match(out.join(''), /ok \(clean\)/);
});

// Finding 2: a worktree-local shadow copy of an otherwise-compliant run dir
// (same run id, but living under a linked worktree's own
// .claude-tweaks/pipelines/ rather than the main checkout) must be refused,
// not silently treated as ok or as a fresh denial — mirrors
// tests/bin-lib/log-decision/cli.test.js's own shadow-rejection test.
test('run: a worktree-local shadow copy of the run dir is refused (exit 3), not ok or a fresh denial', () => {
  const main = anchoredFixture();
  const runId = '2026-09-17T000010-spec-1';
  const shadow = path.join(main, '.claude', 'worktrees', 'flow-spec-1', '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(shadow, { recursive: true });
  fs.writeFileSync(path.join(shadow, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  fs.writeFileSync(
    path.join(main, '.claude', 'worktrees', 'flow-spec-1', '.git'),
    'gitdir: ../../../.git/worktrees/flow-spec-1\n',
  );
  const { deps, err, out } = makeDeps({ cwd: main, mainRoot: main });
  const code = run(['--run', shadow], deps);
  assert.strictEqual(code, 3);
  assert.match(err.join(''), /not anchored/);
  assert.match(err.join(''), /pipeline-run-dir\.md/);
  assert.strictEqual(out.join(''), '', 'a shadow copy must never print an ok/clean result');
});

// Finding 3: exit code 4 has no end-to-end CLI test — exercise a genuine
// { ok: false } result through run() (the #2472 core DENY scenario: a real
// git repo + linked worktree + materialize commit + no worktree stamp
// recorded), asserting the exit code AND that deps.stderr received the
// violation message, rather than mocking checkPrBookkeepingPrecondition.
test('run: a genuine bookkeeping violation exits 4 and surfaces the message on stderr', () => {
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  const runId = '2026-09-17T000011-spec-1';
  commitMaterializeFile(wt, runId);
  // Anchored under the main checkout, per the real run-dir layout —
  // record-worktree never ran, so no run-state.json exists at all.
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const { deps, err, out } = makeDeps({ cwd: wt });
  const code = run(['--run', runDir], deps);
  assert.strictEqual(code, 4);
  assert.match(err.join(''), /record-worktree/);
  assert.match(err.join(''), /IL-131/);
  assert.strictEqual(out.join(''), '', 'a violation must never print an ok result');
});
