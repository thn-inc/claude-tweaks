'use strict';
// Template-copy fixtures for statusline.test.js (#5772): each fixture repo is built once per test
// process and copied per call, so a further call starts no git process (tests/helpers/git-template.js).
// The caller removes what it gets back (`repoDir`, or `base`): a copy has no registration outside its
// own base, so no `git worktree remove` is needed.
//
// Every build's git call inherits process.env as it is when the call runs (no env captured at load),
// so a caller's GIT_TRACE2_EVENT reaches a build — which is what lets a "copy starts no git" test go red.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { fromTemplate } = require('./git-template');
const { initRepo } = require('./git-fixtures');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// init on `branch`, the test identity, then `file` holding `content` committed as `init`.
function initCommitted(dir, branch, file, content) {
  initRepo(dir, { branch, name: 'Test', email: 'test@example.com' });
  fs.writeFileSync(path.join(dir, file), content);
  git(['add', file], dir);
  git(['commit', '-q', '-m', 'init'], dir);
}

// A throwaway repo on `branch` with one committed file (file.txt). Returns the repo dir.
function committedRepo({ branch = 'main' } = {}) {
  return fromTemplate(`statusline:committed:${branch}`, (dir) => initCommitted(dir, branch, 'file.txt', 'hello\n'), { prefix: 'ct-git-' });
}

// `base/glyph-project`: a repo on main with README.md committed and, when remoteUrl is truthy, an origin remote.
function repoWithOrigin(remoteUrl) {
  const base = fromTemplate(`statusline:withRepo:${remoteUrl ?? ''}`, (dir) => {
    const repo = path.join(dir, 'glyph-project');
    fs.mkdirSync(repo);
    initCommitted(repo, 'main', 'README.md', 'hi');
    if (remoteUrl) git(['remote', 'add', 'origin', remoteUrl], repo);
  }, { prefix: 'ct-sl-repo-' });
  return { base, repoDir: path.join(base, 'glyph-project') };
}

// `base/real-project-name` (GitHub origin) plus its linked worktree `base/worktree-branch-name` on `feature`.
// Raw (not realpath'd) base, unlike worktreeShapes: its test passes the symlinked mkdtemp path on purpose
// and builds the expected link from fs.realpathSync(mainDir), so the reader's realpath step stays exercised.
function linkedWorktreeProject() {
  const base = fromTemplate('statusline:linkedWorktree', (dir) => {
    const mainDir = path.join(dir, 'real-project-name');
    fs.mkdirSync(mainDir);
    initCommitted(mainDir, 'main', 'README.md', 'hi');
    git(['remote', 'add', 'origin', 'git@github.com:owner/real-project.git'], mainDir);
    git(['worktree', 'add', '-q', path.join(dir, 'worktree-branch-name'), '-b', 'feature'], mainDir);
  }, { prefix: 'ct-sl-wt-' });
  return { base, mainDir: path.join(base, 'real-project-name'), worktreeDir: path.join(base, 'worktree-branch-name') };
}

// Creating a symlink needs a privilege on win32 that CI runners hold and a
// developer machine may not. Returns false on that EPERM, so the caller skips its
// symlink case instead of failing in setup.
function trySymlink(target, link) {
  try {
    fs.symlinkSync(target, link);
    return true;
  } catch (err) {
    if (err.code === 'EPERM') return false;
    throw err;
  }
}

// The submodule url the shapes template was built with (its own inner-repo, forward slashes).
let shapesInnerUrl = null;
const fwd = (p) => p.split(path.sep).join('/');

// The spawn-free main-checkout resolution fixture, under one base: a main repo, an absolute linked
// worktree, a --relative-paths worktree (null when this git lacks the flag) of a second main repo,
// since the flag writes an [extensions] section into its main repo's config, a submodule checkout
// and a symlink to the absolute worktree (null when the host refuses symlinks). The template holds
// all but the symlink, which each copy makes for itself; a missing rel-wt dir records that the flag
// was unsupported. Returns { base, main, wt, relWt, sub, link }.
//
// The copy's base is its realpath: git writes the physical path into the abs-wt `.git` pointer and
// its admin `gitdir`, and the rewrite spells them as the copy's path. On a raw mkdtemp path
// (macOS /var -> /private/var) the pointer would cross a symlink a freshly built one never held,
// and the win32 no-symlink fast-path test defers to git on it.
function worktreeShapes() {
  const base = fromTemplate('statusline:shapes', (dir) => {
    const init = (repo) => {
      fs.mkdirSync(repo);
      initCommitted(repo, 'main', 'README.md', 'hi');
    };
    const main = path.join(dir, 'main-repo');
    const inner = path.join(dir, 'inner-repo');
    init(main);
    init(inner);
    git(['worktree', 'add', '-q', path.join(dir, 'abs-wt'), '-b', 'a'], main);
    const relMain = path.join(dir, 'rel-main');
    init(relMain);
    const relWt = path.join(dir, 'rel-wt');
    try {
      git(['worktree', 'add', '-q', '--relative-paths', relWt, '-b', 'b'], relMain);
    } catch {
      fs.rmSync(relWt, { recursive: true, force: true });
    }
    // A forward-slash spelling: Git for Windows writes a backslash path into the main
    // config as an escaped `url = D:\\a\\...`, and the reader defers to git on any backslash.
    const innerUrl = fwd(inner);
    git(['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', innerUrl, 'sub'], main);
    shapesInnerUrl = innerUrl;
  }, { prefix: 'ct-sl-shapes-', realpath: true });
  const main = path.join(base, 'main-repo');
  // git-template rewrites the git-owned path files (main's .git/config submodule url, the
  // submodule's origin), but .gitmodules is a working-tree file: point it at this copy's inner-repo
  // so the template's is unreachable from a copy. The staged .gitmodules blob in the index keeps
  // the template path; accepted because no test reads the index copy — at the time of writing,
  // `git grep -n "gitmodules\|submodule" -- tests/statusline.test.js` lists only the fixture's own
  // comment and `submodule add`, the reader's `gitdir: ../.git/modules/sub` comment and assertion,
  // and the parity test's `submodule checkout` case, which renders from `sub` (no `git show
  // :.gitmodules`, `git diff` or `status` in main-repo).
  const gitmodules = path.join(main, '.gitmodules');
  const text = fs.readFileSync(gitmodules, 'utf8');
  if (!shapesInnerUrl || !text.includes(shapesInnerUrl)) {
    throw new Error(`worktreeShapes: .gitmodules does not name the template's inner-repo (${shapesInnerUrl}), so a copy would keep pointing at it`);
  }
  fs.writeFileSync(gitmodules, text.split(shapesInnerUrl).join(fwd(path.join(base, 'inner-repo'))));
  const wt = path.join(base, 'abs-wt');
  const relWt = path.join(base, 'rel-wt');
  const linkPath = path.join(base, 'link-wt');
  return {
    base,
    main,
    wt,
    relWt: fs.existsSync(relWt) ? relWt : null,
    sub: path.join(main, 'sub'),
    link: trySymlink(wt, linkPath) ? linkPath : null,
  };
}

module.exports = { committedRepo, repoWithOrigin, linkedWorktreeProject, worktreeShapes, trySymlink };
