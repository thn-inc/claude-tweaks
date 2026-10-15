'use strict';
// Shared git-repo test fixtures.
//
// tests/hooks-worktree-detect.test.js's `gitRepo()`/`linkedWorktreeOf()` were
// byte-for-byte copies of the same helpers in tests/hooks-pre-tool-use.test.js
// (differing only in the mkdtemp prefix), and the two had already silently
// drifted — this file's `gitRepo()` does an initial empty commit,
// hooks-pre-tool-use.test.js's does not, forcing a second `gitRepoWithCommit()`
// wrapper there to get the same behavior. Centralizing here means a future
// change to how these fixtures are built (e.g. a `git worktree add` flag
// change) only needs to land once.
//
// tests/hooks-worktree-detect.test.js consumes all of it;
// tests/hooks-dispatcher.test.js consumes `linkedWorktreeOf` only. The
// duplication described in the review finding also recurs in
// tests/hooks-pre-tool-use.test.js, the rest of tests/hooks-dispatcher.test.js,
// tests/hooks-session-start.test.js, and tests/policy.test.js, but migrating
// those is out of scope here — no task in this plan claims them for this
// finding, and this task's own scope is tests/hooks-worktree-detect.test.js.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Ceiling for a single fixture git spawn.
//
// These calls previously passed no `timeout` at all, so they were unbounded by
// construction — a fixture could block indefinitely rather than fail (#134).
// Under three concurrent full test suites a single fixture spawn was measured
// at 2884ms, and a hooks test that should take ~50ms was observed taking
// 41,074ms. An unbounded fixture turns machine contention into a hung suite
// with no diagnosis; a bounded one fails fast and names itself.
//
// Deliberately generous (30s vs. the ~2.9s worst case measured) — this bound
// exists to convert a hang into an error, not to police fixture performance.
// A fixture that genuinely needs longer than 30s is broken, not slow.
const FIXTURE_TIMEOUT_MS = 30000;

// execFileSync's own timeout kill surfaces as an opaque error. Wrap it so a
// bound that fires says which fixture command hit it, rather than leaving a
// bare ETIMEDOUT for a future reader to trace back.
// `opts` is spread into execFileSync's options AFTER the timeout, so a caller
// can pin `env` (e.g. GIT_AUTHOR_DATE/GIT_COMMITTER_DATE for a fixture whose
// assertions must not depend on the wall clock) without losing the bound.
function fixtureGit(args, opts = {}) {
  try {
    return execFileSync('git', args, { timeout: FIXTURE_TIMEOUT_MS, ...opts });
  } catch (err) {
    if (err.killed || err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM') {
      throw new Error(
        `git-fixtures: \`git ${args.join(' ')}\` exceeded ${FIXTURE_TIMEOUT_MS}ms and was killed. `
        + 'This usually means the machine is heavily contended (concurrent test suites), not that the fixture is wrong.',
      );
    }
    throw err;
  }
}

// A git repo initialized with one empty commit, so it always has a HEAD.
function gitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wtd-'));
  fixtureGit(['-C', dir, 'init', '-q']);
  fixtureGit(['-C', dir, 'commit', '--allow-empty', '-m', 'init', '-q']);
  return fs.realpathSync(dir);
}

// A linked worktree of `main` (itself created via gitRepo()), placed OUTSIDE
// the main checkout — the shape raw `git worktree add` produces. Deliberately
// not in the harness domain: bin/lib/hooks/worktree-reap.js only reaps
// `<main>/.claude/worktrees/`, so this is also the fixture for "a worktree the
// reaper must refuse to touch."
function linkedWorktreeOf(main) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wtd-parent-'));
  const wt = path.join(parent, 'wt');
  fixtureGit(['-C', main, 'worktree', 'add', '-q', wt, '-b', `wt-branch-${path.basename(parent)}`]);
  return fs.realpathSync(wt);
}

// A linked worktree inside the harness-owned domain — `<main>/.claude/worktrees/<name>`,
// where the native EnterWorktree tool puts them (ADR-0004). This is the only
// domain bin/lib/hooks/worktree-reap.js will consider.
let harnessWorktreeSeq = 0;
function harnessWorktreeOf(main, name) {
  const leaf = name || `wt-${process.pid}-${harnessWorktreeSeq++}`;
  const wt = path.join(main, '.claude', 'worktrees', leaf);
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  fixtureGit(['-C', main, 'worktree', 'add', '-q', wt, '-b', `wt-branch-${leaf}`]);
  return fs.realpathSync(wt);
}

// A bare `origin` plus two clones of it, `work` and `other`, sharing one pushed
// `base` commit on `main` — the shape a remote-branch collision needs: `work`
// is this run's checkout, `other` an unrelated checkout that can push a
// same-name branch. Shared by tests/bin-lib/worktree/remote-branch-collision.test.js
// and tests/adopted-branch-collision-snippet-fixture.test.js (#3091's review:
// the second suite had grown a verbatim copy). `env` pins the git identity and
// blanks GH_REPO/GH_HOST so a caller that spawns `gh` against these local-path
// remotes never resolves an exported repo instead. The temp root is removed if
// setup itself throws; the caller removes it after the test.
function originWithTwoClones(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    const origin = path.join(root, 'origin.git');
    const work = path.join(root, 'work');
    const other = path.join(root, 'other');
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
      GH_REPO: '', GH_HOST: '',
    };
    const run = (cwd, args) => fixtureGit(args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const commit = (cwd, name) => {
      fs.writeFileSync(path.join(cwd, name), name);
      run(cwd, ['add', name]);
      run(cwd, ['commit', '-q', '-m', name]);
    };
    fixtureGit(['init', '-q', '--bare', '-b', 'main', origin], { env, stdio: 'ignore' });
    for (const dir of [work, other]) {
      fixtureGit(['init', '-q', '-b', 'main', dir], { env, stdio: 'ignore' });
      run(dir, ['remote', 'add', 'origin', origin]);
    }
    commit(work, 'base');
    run(work, ['push', '-q', 'origin', 'main']);
    run(other, ['pull', '-q', 'origin', 'main']);
    return {
      root, work, other, env, run, commit,
      gitIn: (cwd) => (args) => run(cwd, args),
    };
  } catch (err) {
    fs.rmSync(root, { recursive: true, force: true });
    throw err;
  }
}

module.exports = { gitRepo, linkedWorktreeOf, harnessWorktreeOf, originWithTwoClones, fixtureGit, FIXTURE_TIMEOUT_MS };
