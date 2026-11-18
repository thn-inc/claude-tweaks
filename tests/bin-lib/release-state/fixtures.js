'use strict';
// Template-copy git fixtures for the release-state store's suites (#5883), in the shape of
// tests/bin-lib/issues/claims-git-cas-fixtures.js: each line is built once per test process
// and copied per call, so a further call starts no git process. No test runner import here.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fromTemplate, disableReceiveAutoGc } = require('../../helpers/git-template');
const { fixtureGit, writeIdentity } = require('../../helpers/git-fixtures');
const { pinnedGitEnv } = require('../../helpers/pinned-git');
const { repoPinnedEnv } = require('../../../plugin/bin/lib/hooks/git-exec');

const PIPE_ALL = ['pipe', 'pipe', 'pipe'];
const RELEASE_STATE_REF = 'refs/heads/release-state';

// A git call for fixture setup: pinned away from the host's config, stderr piped (the
// failure paths these suites exercise on purpose must not echo into the TAP stream).
// The env is built per call, never cached (pinned-git.js).
function setupGit(args, cwd) {
  return fixtureGit(args, {
    cwd, env: repoPinnedEnv(pinnedGitEnv()), encoding: 'utf8', stdio: PIPE_ALL,
  }).trim();
}

// The runner a store takes as `gitRunner`: owns its cwd and its repo-pinned env, and
// layers `extraEnv` on top.
function realRunner(cwd) {
  return (args, { input, extraEnv } = {}) => execFileSync('git', args, {
    cwd,
    env: { ...repoPinnedEnv(pinnedGitEnv()), ...extraEnv },
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function commitFile(clone, file, text, message) {
  fs.writeFileSync(path.join(clone, file), text);
  setupGit(['add', '--', file], clone);
  setupGit(['commit', '-q', '-m', message], clone);
  return setupGit(['rev-parse', 'HEAD'], clone);
}

// Per-process cache of the shas each template holds, keyed on the branch. Set as the
// build's last statement, so a failed build leaves it unset and the next call rebuilds.
const shasByBranch = new Map();

// A bare origin whose `{branch}` first-parent line is P1<-P2<-P3<-P4<-P5, where P4 is a
// `--no-ff` merge whose second parent is the side commit S. There is no `release-state`
// branch. Clones A and B carry identity written through `writeIdentity`. The template key
// includes the branch, so `main` and `trunk` are separate templates.
function makeLine({ branch = 'main' } = {}) {
  const root = fromTemplate(`release-state:line:${branch}`, (dir) => {
    const originDir = path.join(dir, 'origin.git');
    const cloneA = path.join(dir, 'cloneA');
    const cloneB = path.join(dir, 'cloneB');
    setupGit(['init', '--bare', '-q', '-b', branch, originDir]);
    disableReceiveAutoGc(originDir);
    setupGit(['clone', '-q', originDir, cloneA]);
    writeIdentity(cloneA, { name: 'Test', email: 'test@example.com' });
    // Pointing HEAD at the branch works whether the empty clone's HEAD is unborn on it or not.
    setupGit(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], cloneA);
    const P1 = commitFile(cloneA, 'p1.txt', 'p1\n', 'P1');
    const P2 = commitFile(cloneA, 'p2.txt', 'p2\n', 'P2');
    const P3 = commitFile(cloneA, 'p3.txt', 'p3\n', 'P3');
    setupGit(['checkout', '-q', '-b', 'side'], cloneA);
    const S = commitFile(cloneA, 's.txt', 's\n', 'S');
    setupGit(['checkout', '-q', branch], cloneA);
    setupGit(['merge', '-q', '--no-ff', '-m', 'P4', 'side'], cloneA);
    const P4 = setupGit(['rev-parse', 'HEAD'], cloneA);
    const P5 = commitFile(cloneA, 'p5.txt', 'p5\n', 'P5');
    setupGit(['branch', '-q', '-D', 'side'], cloneA);
    setupGit(['push', '-q', 'origin', branch], cloneA);
    setupGit(['clone', '-q', originDir, cloneB]);
    writeIdentity(cloneB, { name: 'Test', email: 'test@example.com' });
    shasByBranch.set(branch, {
      P1, P2, P3, P4, P5, S,
    });
  }, { prefix: 'release-state-line-' });
  return {
    root,
    originDir: path.join(root, 'origin.git'),
    cloneA: path.join(root, 'cloneA'),
    cloneB: path.join(root, 'cloneB'),
    branch,
    ...shasByBranch.get(branch),
  };
}

// Writes `text` byte for byte as `{name}` on `release-state` with plain git (hash-object,
// an index commit on the branch tip, or on the default tip when the branch is missing,
// then push), bypassing the store. The only way to plant content the store refuses (`[]`,
// `null`, `'x'`, a raw `{`). Returns the new tip sha.
function commitRawState(fx, clone, name, text) {
  const run = realRunner(clone);
  const scratchRef = `refs/release-state-fixture/${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const scratchIndex = path.join(os.tmpdir(), `release-state-fixture-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const listed = run(['ls-remote', '--heads', 'origin', RELEASE_STATE_REF]).trim();
  const branchExists = listed !== '';
  try {
    run(['fetch', '-q', 'origin', branchExists ? `release-state:${scratchRef}` : `HEAD:${scratchRef}`]);
    const parent = run(['rev-parse', scratchRef]).trim();
    const extraEnv = { GIT_INDEX_FILE: scratchIndex };
    const blob = run(['hash-object', '-w', '--stdin'], { input: text, extraEnv }).trim();
    run(['read-tree', parent], { extraEnv });
    run(['update-index', '--add', '--cacheinfo', `100644,${blob},${name}`], { extraEnv });
    const tree = run(['write-tree'], { extraEnv }).trim();
    const commit = run(['commit-tree', tree, '-p', parent, '-m', 'Plant raw state'], { extraEnv }).trim();
    run(['push', '-q', '--no-verify', 'origin', `${commit}:${RELEASE_STATE_REF}`, `--force-with-lease=${RELEASE_STATE_REF}:${branchExists ? parent : ''}`]);
    return commit;
  } finally {
    try { run(['update-ref', '-d', scratchRef]); } catch { /* best-effort cleanup */ }
    fs.rmSync(scratchIndex, { force: true });
  }
}

// A throwaway clone of the origin in `fx.root`, so a fixture that rewrites or extends the
// branch leaves clones A and B (and their remote-tracking refs) exactly as built.
function scratchClone(fx, label) {
  const dir = path.join(fx.root, `${label}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  setupGit(['clone', '-q', fx.originDir, dir]);
  return dir;
}

// Force-pushes the branch to P1<-P2<-P3' and returns P3'.
function rewriteMain(fx) {
  const dir = scratchClone(fx, 'rewrite');
  setupGit(['checkout', '-q', '--detach', fx.P2], dir);
  const rewritten = commitFile(dir, 'p3-rewritten.txt', 'p3 rewritten\n', "P3'");
  setupGit(['push', '-q', '--force', 'origin', `HEAD:refs/heads/${fx.branch}`], dir);
  return rewritten;
}

// Commits on the branch's current remote tip from `clone` and pushes it. Returns the new
// first-parent tip P6.
function pushMainCommit(fx, clone) {
  setupGit(['fetch', '-q', 'origin'], clone);
  setupGit(['checkout', '-q', '-B', fx.branch, `origin/${fx.branch}`], clone);
  const P6 = commitFile(clone, 'p6.txt', 'p6\n', 'P6');
  setupGit(['push', '-q', 'origin', fx.branch], clone);
  return P6;
}

// A depth-limited clone of the origin. A file URL, because git ignores `--depth` on a plain
// local path.
function shallowClone(fx, depth) {
  const dir = path.join(fx.root, `shallow-${depth}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  setupGit(['clone', '-q', '--depth', String(depth), pathToFileURL(fx.originDir).href, dir]);
  return dir;
}

module.exports = {
  makeLine, commitRawState, realRunner, rewriteMain, pushMainCommit, shallowClone, setupGit,
};
