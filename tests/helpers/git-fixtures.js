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
// Loading git-template.js also points a bare run's repoInfo store at a temp file (#5294).
const { fromTemplate, disableReceiveAutoGc } = require('./git-template');
const { scratchDir } = require('./tmp-dir');

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
// `opts.execFileSync` (optional) replaces the real spawn, so a test can inject a spawn-level failure.
function fixtureGit(args, { execFileSync: run = execFileSync, ...opts } = {}) {
  try {
    return run('git', args, { timeout: FIXTURE_TIMEOUT_MS, ...opts });
  } catch (err) {
    // A maxBuffer overflow kills the child with SIGTERM too, so it is told apart by its code first:
    // it is an output-size failure, not contention. A spawn-level ENOBUFS carries no signal and is not one.
    if (err.code === 'ENOBUFS' && err.signal) {
      const cap = opts.maxBuffer ?? 1024 * 1024;
      throw Object.assign(new Error(
        `git-fixtures: \`git ${args.join(' ')}\` printed more than its maxBuffer (${cap} bytes) and was killed. `
        + 'Pass a larger maxBuffer for a real-sized output.',
        { cause: err },
      ), { code: 'ENOBUFS' });
    }
    if (err.killed || err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM') {
      throw new Error(
        `git-fixtures: \`git ${args.join(' ')}\` exceeded ${FIXTURE_TIMEOUT_MS}ms and was killed. `
        + 'This usually means the machine is heavily contended (concurrent test suites), not that the fixture is wrong.',
      );
    }
    throw err;
  }
}

// A one-process `git init` (#5771). Fixtures ran `git init` then the config command's `user.name`
// and `user.email` writes: an identity pair is two extra git processes per fixture repo, across
// ~300 call sites. `initRepo` starts exactly one process (the init); `writeIdentity` appends the
// `[user]` section to the config file directly and starts none.
//
// `opts` beyond name/email/branch/bare go to fixtureGit (env, cwd, stdio...). A relative `dir`
// resolves against `opts.cwd` for the identity write, as git resolved it for the init.
function initRepo(dir, { name, email, branch, bare, ...opts } = {}) {
  fixtureGit(['init', '-q', ...(bare ? ['--bare'] : []), ...(branch ? ['-b', branch] : []), dir], opts);
  if (name !== undefined || email !== undefined) {
    writeIdentity(path.resolve(opts.cwd ?? '', dir), { name, email });
  }
  return dir;
}

// The config file `git config --local` writes for `repoDir`: a plain repo's `.git/config`, a
// linked worktree's common config (through its `.git` pointer and the `commondir` file), or a
// bare repo's own `config`.
function localConfigPath(repoDir) {
  const stat = (p) => { try { return fs.statSync(p); } catch { return null; } };
  const dotGit = path.join(repoDir, '.git');
  const s = stat(dotGit);
  if (s && s.isDirectory()) return path.join(dotGit, 'config');
  if (s && s.isFile()) {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    if (!m) throw new Error(`writeIdentity: ${repoDir} is not a git repository (${dotGit} names no gitdir)`);
    const gitDir = path.resolve(repoDir, m[1]);
    const commondir = path.join(gitDir, 'commondir');
    const common = stat(commondir) ? path.resolve(gitDir, fs.readFileSync(commondir, 'utf8').trim()) : gitDir;
    return path.join(common, 'config');
  }
  const head = stat(path.join(repoDir, 'HEAD'));
  const objects = stat(path.join(repoDir, 'objects'));
  if (head && head.isFile() && objects && objects.isDirectory()) return path.join(repoDir, 'config');
  throw new Error(`writeIdentity: ${repoDir} is not a git repository`);
}

// Spells a config value the way git's own config writer does (config.c write_pair, as of git 2.56), so
// the file holds the bytes `git config` would leave: backslash, double quote, newline and tab always
// escaped, a carriage return kept raw, and the whole value in double quotes only when it begins or ends
// with a space or contains `;`, `#` or a carriage return (unquoted, git's reader drops a CR before the
// line end). A reader that parses config text (the statusline's fast path defers on any quote) sees git's file.
const CONFIG_ESCAPES = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t' };
function quoteConfigValue(value) {
  const needsQuotes = value.startsWith(' ') || value.endsWith(' ') || /[;#\r]/.test(value);
  const quote = needsQuotes ? '"' : '';
  return `${quote}${value.replace(/[\\"\n\t]/g, (c) => CONFIG_ESCAPES[c])}${quote}`;
}

// Appends `[user]` with the given name and/or email to `repoDir`'s local config — what the config
// command's `user.email` then `user.name` writes leave, without starting a process (the swept call
// sites wrote the email first, so `email` precedes `name`). Refuses a config that already has a
// `[user]` section (any case): a second header would leave git reading the last value of each key,
// silently.
function writeIdentity(repoDir, { name, email } = {}) {
  if (name === undefined && email === undefined) throw new TypeError('writeIdentity: pass name, email, or both');
  const cfg = localConfigPath(repoDir);
  let text = '';
  try { text = fs.readFileSync(cfg, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  if (/^[ \t]*\[user\]/im.test(text)) throw new Error(`writeIdentity: ${cfg} already has a [user] section`);
  let section = text && !text.endsWith('\n') ? '\n[user]\n' : '[user]\n';
  if (email !== undefined) section += `\temail = ${quoteConfigValue(email)}\n`;
  if (name !== undefined) section += `\tname = ${quoteConfigValue(name)}\n`;
  fs.appendFileSync(cfg, section);
}

// A git repo initialized with one empty commit, so it always has a HEAD.
// Optional `{ parent, branch }`: the directory the repo's temp dir is created
// in (default os.tmpdir()) and the initial branch name (default: git's own).
// Copied from a once-per-process template keyed on `branch` (#5297); `parent`
// only chooses where the copy lands.
function gitRepo({ parent = os.tmpdir(), branch } = {}) {
  return fromTemplate(`git-fixtures:repo:${branch || ''}`, (dir) => {
    fixtureGit(['-C', dir, 'init', '-q', ...(branch ? ['-b', branch] : [])]);
    fixtureGit(['-C', dir, 'commit', '--allow-empty', '-m', 'init', '-q']);
  }, { parent, prefix: 'ct-wtd-', realpath: true });
}

// A linked worktree of `main` (itself created via gitRepo()), placed OUTSIDE
// the main checkout — the shape raw `git worktree add` produces. Deliberately
// not in the harness domain: bin/lib/hooks/worktree-reap.js only reaps
// `<main>/.claude/worktrees/`, so this is also the fixture for "a worktree the
// reaper must refuse to touch."
function linkedWorktreeOf(main) {
  const parent = scratchDir('ct-wtd-parent-');
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
//
// The whole root is built once per process and copied per call (#5297), with
// the bare origin's `receive.autogc` off so a push into it starts no
// maintenance process. `env`/`run`/`commit`/`gitIn` are rebuilt per call; the
// copy's remote urls were rewritten to its own `origin.git`.
//
// `opts.seed(ops)` (with a non-empty `opts.key`, which names its template) runs as the
// template build's last step with the build's own ops and the template-side paths
// `{ root, work, other, env, run, commit }`, so a caller's per-test commits, pushes and
// pulls run once per process too (#5769). Without `opts` nothing changes, key included.
function originWithTwoClones(prefix, { key, seed } = {}) {
  if (seed && (typeof key !== 'string' || !key)) throw new TypeError('originWithTwoClones: seed needs a key');
  // Snapshots process.env when called, so the template build (which runs with
  // auto-maintenance switched off in process.env) calls it again inside `build`.
  const makeOps = () => {
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
    return { env, run, commit };
  };
  const root = fromTemplate(key ? `git-fixtures:origin-two-clones:${key}` : 'git-fixtures:origin-two-clones', (tplRoot) => {
    const { env, run, commit } = makeOps();
    const origin = path.join(tplRoot, 'origin.git');
    const work = path.join(tplRoot, 'work');
    const other = path.join(tplRoot, 'other');
    fixtureGit(['init', '-q', '--bare', '-b', 'main', origin], { env, stdio: 'ignore' });
    disableReceiveAutoGc(origin);
    for (const dir of [work, other]) {
      fixtureGit(['init', '-q', '-b', 'main', dir], { env, stdio: 'ignore' });
      run(dir, ['remote', 'add', 'origin', origin]);
    }
    commit(work, 'base');
    run(work, ['push', '-q', 'origin', 'main']);
    run(other, ['pull', '-q', 'origin', 'main']);
    if (seed) seed({ root: tplRoot, work, other, env, run, commit });
  }, { prefix });
  const { env, run, commit } = makeOps();
  return {
    root, work: path.join(root, 'work'), other: path.join(root, 'other'), env, run, commit,
    gitIn: (cwd) => (args) => run(cwd, args),
  };
}

// `base` (default process.env) minus the variables that pick which repository a git child reads
// (a test running under a git hook inherits them). The env a fixture's own setup git calls run with,
// and the base a test layers an injected `GIT_DIR` and the like onto.
function cleanGitEnv(base = process.env) {
  const env = { ...base };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[k];
  return env;
}

// The complete environment a hooks.js test hands `runCli`/`spawnCli`: the runner's minus the four git-location
// variables, with the ambient run dir neutralized (#1130), plus the caller's keys (which win).
function hookEnv(extra = {}) {
  return { ...cleanGitEnv(), PIPELINE_RUN_DIR: '', ...extra };
}

// A fresh repository with one commit of `file` (content `${prefix}\n`, so two repos built with distinct
// prefixes hold distinct commits): `{ dir, head, git }`. `git(...args)` runs in `dir` under cleanGitEnv()
// with a fixed identity and returns trimmed stdout; the caller removes `dir`.
function committedRepo({ prefix = 'ct-fx-', file = 'seed.txt', branch } = {}) {
  const dir = scratchDir(prefix);
  const env = cleanGitEnv();
  const git = (...args) => fixtureGit(['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();
  git('init', '-q', ...(branch ? ['-b', branch] : []));
  fs.writeFileSync(path.join(dir, file), `${prefix}\n`);
  git('add', '.');
  git('commit', '-q', '-m', prefix);
  return { dir, head: git('rev-parse', 'HEAD'), git };
}

module.exports = { gitRepo, linkedWorktreeOf, harnessWorktreeOf, originWithTwoClones, fixtureGit, FIXTURE_TIMEOUT_MS, cleanGitEnv, hookEnv, committedRepo, initRepo, writeIdentity };
