const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { pathToFileURL } = require('node:url');

const STATUSLINE = path.join(__dirname, '..', 'plugin', 'bin', 'claude-tweaks-statusline.js');
const sl = require('../plugin/bin/claude-tweaks-statusline.js');
const color = require('../plugin/bin/lib/color');
const { readText } = require('./helpers/read-skill');
const { fixtureHomeEnv } = require('./helpers/fixture-home');
const { chmodDenialSkip } = require('./helpers/root');

// The project segment wraps text in OSC 8 hyperlinks (\x1b]8;;URL\x07text\x1b]8;;\x07).
// Assertions about segment order/content strip those wrappers first; the link
// URLs themselves are asserted by the dedicated link tests below.
function stripLinks(s) {
  return s.replace(/\x1b\]8;;[^\x07]*\x07/g, '');
}

// Expected project segment for a dir with no GitHub origin remote: the
// basename wrapped in a file:// hyperlink to the (resolved) project dir.
// The URL must end with "/" — a directory URL without it makes macOS reveal
// the folder in its parent instead of opening the folder itself.
function linkedName(dir) {
  return color.link(`${pathToFileURL(dir).href}/`, path.basename(dir));
}

// Hermetic: a throwaway $HOME, and the running session's own CLAUDE_CONFIG_DIR
// dropped so the acct segment sees only what `seedHome` put in that HOME.
function runStatusline(input, env = {}, seedHome = () => {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sl-'));
  try {
    seedHome(home);
    return execFileSync('node', [STATUSLINE], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: { ...fixtureHomeEnv(home), ...env },
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('parseStatusBranch: clean branch with no upstream', () => {
  assert.deepStrictEqual(sl.parseStatusBranch('## main\n'), { branch: 'main', dirty: false });
});

test('parseStatusBranch: dirty branch with tracked upstream and ahead/behind info', () => {
  assert.deepStrictEqual(
    sl.parseStatusBranch('## main...origin/main [ahead 1]\n M file.js\n'),
    { branch: 'main', dirty: true },
  );
});

test('parseStatusBranch: fresh repo with no commits yet', () => {
  assert.deepStrictEqual(sl.parseStatusBranch('## No commits yet on main\n'), { branch: 'main', dirty: false });
});

test('parseStatusBranch: detached HEAD reports no branch', () => {
  assert.deepStrictEqual(sl.parseStatusBranch('## HEAD (no branch)\n'), { branch: null, dirty: false });
});

test('parseStatusBranch: empty or unparseable output reports no branch', () => {
  assert.deepStrictEqual(sl.parseStatusBranch(''), { branch: null, dirty: false });
});

test('renderGit: uses the passed cwd rather than the process-wide cwd', () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-git-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'feature/isolated-branch'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'hello\n');
    execFileSync('git', ['add', 'file.txt'], { cwd: repoDir });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repoDir });

    // The real process cwd (this repo checkout) is on a different branch, so if renderGit
    // ever regresses to relying on execSync's implicit process.cwd() instead of the passed
    // cwd, this would report the wrong (or no) branch instead of the isolated repo's.
    const realBranch = execFileSync('git', ['branch', '--show-current'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
    assert.notStrictEqual(realBranch, 'feature/isolated-branch');

    const orig = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    try {
      assert.strictEqual(sl.renderGit(repoDir), 'feature/isolated-branch');
    } finally {
      if (orig === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = orig;
    }
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

// A throwaway repo on `main` with one committed file (file.txt). Caller removes it.
function makeCommittedRepo() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-git-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
  fs.writeFileSync(path.join(repoDir, 'file.txt'), 'hello\n');
  execFileSync('git', ['add', 'file.txt'], { cwd: repoDir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repoDir });
  return repoDir;
}

// renderGit with colors off, so assertions compare plain text.
function renderGitPlain(repoDir) {
  const orig = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    return sl.renderGit(repoDir);
  } finally {
    if (orig === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = orig;
  }
}

test('renderGit: does not rewrite the index on a stale-stat repo (AC1 — --no-optional-locks)', () => {
  const repoDir = makeCommittedRepo();
  try {
    // Content is unchanged but the stat cache no longer matches the index entry, so a plain
    // `git status` refreshes the index and rewrites .git/index under index.lock.
    const stale = new Date('2001-01-01T00:00:00Z');
    fs.utimesSync(path.join(repoDir, 'file.txt'), stale, stale);
    const indexPath = path.join(repoDir, '.git', 'index');
    const before = fs.readFileSync(indexPath);
    const beforeMtime = fs.statSync(indexPath).mtimeMs;

    assert.strictEqual(renderGitPlain(repoDir), 'main');
    assert.ok(fs.readFileSync(indexPath).equals(before), 'renderGit rewrote .git/index');
    assert.strictEqual(fs.statSync(indexPath).mtimeMs, beforeMtime);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test('renderGit: dirty repo renders the dirty dot (AC2)', () => {
  const repoDir = makeCommittedRepo();
  try {
    fs.writeFileSync(path.join(repoDir, 'untracked.txt'), 'x\n');
    assert.strictEqual(renderGitPlain(repoDir), 'main●');
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test('readStdin: clears the 50ms fallback timeout once stdin ends (regression: dangling timer)', async () => {
  const { EventEmitter } = require('node:events');
  const fakeStdin = new EventEmitter();
  fakeStdin.isTTY = false;
  fakeStdin.setEncoding = () => {};

  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let capturedTimer = null;
  let clearedWith = null;
  global.setTimeout = (fn, ms, ...args) => {
    capturedTimer = originalSetTimeout(fn, ms, ...args);
    return capturedTimer;
  };
  global.clearTimeout = (t) => {
    clearedWith = t;
    return originalClearTimeout(t);
  };

  try {
    const promise = sl.readStdin();
    fakeStdin.emit('data', '{"ok":true}');
    fakeStdin.emit('end');
    const result = await promise;
    assert.strictEqual(result, '{"ok":true}');
    assert.ok(capturedTimer !== null, 'expected the 50ms fallback timer to be scheduled');
    assert.strictEqual(clearedWith, capturedTimer, 'expected the fallback timer to be cleared once stdin ended');
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    Object.defineProperty(process, 'stdin', stdinDescriptor);
  }
});

test('readStdin: detaches listeners and pauses stdin once the 50ms fallback timeout fires (regression: hung process)', async () => {
  const { EventEmitter } = require('node:events');
  const fakeStdin = new EventEmitter();
  fakeStdin.isTTY = false;
  fakeStdin.setEncoding = () => {};
  let paused = false;
  fakeStdin.pause = () => { paused = true; };

  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  try {
    // Never emit 'data' or 'end' — force the read to resolve via the 50ms
    // fallback timer, the exact path that used to leave listeners attached
    // and the stream unpaused, keeping the event loop referenced forever.
    const result = await sl.readStdin();
    assert.strictEqual(result, '');
    assert.strictEqual(paused, true, 'expected stdin to be paused once the fallback timeout fires');
    assert.strictEqual(fakeStdin.listenerCount('data'), 0, 'expected the data listener to be detached');
    assert.strictEqual(fakeStdin.listenerCount('end'), 0, 'expected the end listener to be detached');
    assert.strictEqual(fakeStdin.listenerCount('error'), 0, 'expected the error listener to be detached');
  } finally {
    Object.defineProperty(process, 'stdin', stdinDescriptor);
  }
});

// perf/statusline-render.test.js carries its own, separate model fixture — it sits outside
// npm test's coverage (timing assertions run only via `npm run test:perf`), so a model-family
// rename here is easy to miss there. Check it too.
test('renderModel: nested display_name', () => {
  assert.strictEqual(sl.renderModel({ model: { display_name: 'Sonnet 5', id: 'claude-sonnet-5' } }), 'Sonnet 5');
});

test('renderModel: falls back to id when display_name absent', () => {
  assert.strictEqual(sl.renderModel({ model: { id: 'claude-sonnet-5' } }), 'claude-sonnet-5');
});

test('renderModel: accepts plain string model', () => {
  assert.strictEqual(sl.renderModel({ model: 'Sonnet 5' }), 'Sonnet 5');
});

test('renderModel returns null when missing', () => {
  assert.strictEqual(sl.renderModel({}), null);
});

test('renderProject: uses workspace.project_dir basename, hyperlinked to the dir', () => {
  assert.strictEqual(
    sl.renderProject({ workspace: { project_dir: '/Users/x/Code/claude-tweaks' } }),
    linkedName('/Users/x/Code/claude-tweaks'),
  );
});

test('renderProject: falls back to current_dir when project_dir missing', () => {
  assert.strictEqual(
    sl.renderProject({ workspace: { current_dir: '/Users/x/Code/other-proj' } }),
    linkedName('/Users/x/Code/other-proj'),
  );
});

test('renderProject: falls back to input.cwd when workspace missing', () => {
  assert.strictEqual(sl.renderProject({ cwd: '/Users/x/Code/fallback' }), linkedName('/Users/x/Code/fallback'));
});

test('renderProject returns null when no directory or fallback available', () => {
  assert.strictEqual(sl.renderProject({}), null);
});

test('renderProject: falls back to explicit fallbackCwd when nothing else available', () => {
  assert.strictEqual(sl.renderProject({}, '/Users/x/Code/fallback-cwd'), linkedName('/Users/x/Code/fallback-cwd'));
});

test('renderProject: percent-encodes spaces in the file:// link (real project dirs contain them)', () => {
  const dir = '/Users/x/Code Workspaces/my-proj';
  const out = sl.renderProject({ workspace: { project_dir: dir } });
  assert.strictEqual(out, linkedName(dir), `expected derived file URL: ${out}`);
  // Literal fragment, independent of the derivation: a raw space must never reach the link.
  assert.ok(out.includes('Code%20Workspaces'), `expected encoded space in file URL: ${out}`);
  assert.strictEqual(stripLinks(out), 'my-proj');
});

test('renderProject: the file:// link ends with a trailing slash (opens the folder, not a reveal in its parent)', () => {
  const dir = '/Users/x/Code/claude-tweaks';
  const out = sl.renderProject({ workspace: { project_dir: dir } });
  assert.strictEqual(out, linkedName(dir), `expected derived file URL: ${out}`);
  // Literal check, independent of the derivation: the link target (from the OSC 8 opener to
  // its first BEL) ends in "/", so the folder opens rather than revealing in its parent.
  assert.match(out, /^\x1b\]8;;[^\x07]*\/\x07/, `expected trailing slash before terminator: ${out}`);
});

test('color.link emits the documented OSC 8 byte shape (BEL-terminated)', () => {
  assert.strictEqual(
    color.link('https://github.com/o/r', 'text'),
    '\x1b]8;;https://github.com/o/r\x07text\x1b]8;;\x07',
  );
});

test('githubRepoUrl normalizes the three GitHub remote forms to a browse URL', () => {
  assert.strictEqual(sl.githubRepoUrl('git@github.com:owner/repo.git'), 'https://github.com/owner/repo');
  assert.strictEqual(sl.githubRepoUrl('ssh://git@github.com/owner/repo.git'), 'https://github.com/owner/repo');
  assert.strictEqual(sl.githubRepoUrl('https://github.com/owner/repo.git'), 'https://github.com/owner/repo');
  assert.strictEqual(sl.githubRepoUrl('https://github.com/owner/repo'), 'https://github.com/owner/repo');
});

test('githubRepoUrl returns null for non-GitHub remotes and garbage', () => {
  assert.strictEqual(sl.githubRepoUrl('git@gitlab.com:owner/repo.git'), null);
  assert.strictEqual(sl.githubRepoUrl('https://gitlab.com/owner/repo.git'), null);
  assert.strictEqual(sl.githubRepoUrl('not a url'), null);
  assert.strictEqual(sl.githubRepoUrl(''), null);
  assert.strictEqual(sl.githubRepoUrl(null), null);
});

test('githubRepoUrl rejects a github.com remote whose path is not owner/repo shaped', () => {
  assert.strictEqual(sl.githubRepoUrl('https://github.com/owner'), null);
  assert.strictEqual(sl.githubRepoUrl('https://github.com/a/b/c'), null);
});

// Fixture: an init'd repo with one commit and, optionally, an origin remote.
function withRepo(remoteUrl, fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sl-repo-'));
  const repoDir = path.join(base, 'glyph-project');
  fs.mkdirSync(repoDir);
  const git = (args) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repoDir, 'README.md'), 'hi');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  if (remoteUrl) git(['remote', 'add', 'origin', remoteUrl]);
  try {
    return fn(repoDir);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test('renderProject: GitHub origin remote adds a glyph hyperlinked to the repo page', () => {
  withRepo('git@github.com:owner/repo.git', (repoDir) => {
    const out = sl.renderProject({ workspace: { project_dir: repoDir } });
    assert.strictEqual(
      out,
      `${linkedName(repoDir)} ${color.link('https://github.com/owner/repo', '')}`,
    );
  });
});

test('renderProject: non-GitHub origin remote renders no glyph', () => {
  withRepo('git@gitlab.com:owner/repo.git', (repoDir) => {
    assert.strictEqual(sl.renderProject({ workspace: { project_dir: repoDir } }), linkedName(repoDir));
  });
});

test('renderProject: repo with no origin remote renders no glyph', () => {
  withRepo(null, (repoDir) => {
    assert.strictEqual(sl.renderProject({ workspace: { project_dir: repoDir } }), linkedName(repoDir));
  });
});

test('renderProject: resolves a linked worktree to the main project name', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sl-wt-'));
  const mainDir = path.join(base, 'real-project-name');
  fs.mkdirSync(mainDir);
  const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main'], mainDir);
  git(['config', 'user.email', 'test@example.com'], mainDir);
  git(['config', 'user.name', 'Test'], mainDir);
  fs.writeFileSync(path.join(mainDir, 'README.md'), 'hi');
  git(['add', '.'], mainDir);
  git(['commit', '-q', '-m', 'init'], mainDir);
  git(['remote', 'add', 'origin', 'git@github.com:owner/real-project.git'], mainDir);
  const worktreeDir = path.join(base, 'worktree-branch-name');
  git(['worktree', 'add', '-q', worktreeDir, '-b', 'feature'], mainDir);
  try {
    // EnterWorktree pivots workspace.project_dir to the worktree path — the
    // statusline must still surface the real project's name, not the
    // worktree folder's. The file:// link and the GitHub glyph must likewise
    // resolve against the main checkout, not the worktree folder.
    // git rev-parse reports the physical path (macOS /var → /private/var),
    // so the expected file:// URL is built from the realpath, not the
    // symlinked mkdtemp path.
    assert.strictEqual(
      sl.renderProject({ workspace: { project_dir: worktreeDir } }),
      `${linkedName(fs.realpathSync(mainDir))} ${color.link('https://github.com/owner/real-project', '')}`,
    );
  } finally {
    git(['worktree', 'remove', '--force', worktreeDir], mainDir);
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// Fixture for the spawn-free main-checkout resolution: one mkdtemp base holding
// a main repo, an absolute linked worktree, a --relative-paths worktree (null
// when this git lacks the flag) of a second main repo, since the flag writes an
// [extensions] section into its main repo's config, a submodule checkout and a
// symlink to the absolute worktree. fn receives { base, main, wt, relWt, sub, link }.
function withWorktrees(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sl-shapes-'));
  const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const init = (dir) => {
    fs.mkdirSync(dir);
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 'test@example.com'], dir);
    git(['config', 'user.name', 'Test'], dir);
    fs.writeFileSync(path.join(dir, 'README.md'), 'hi');
    git(['add', '.'], dir);
    git(['commit', '-q', '-m', 'init'], dir);
  };
  const main = path.join(base, 'main-repo');
  const inner = path.join(base, 'inner-repo');
  init(main);
  init(inner);
  const wt = path.join(base, 'abs-wt');
  git(['worktree', 'add', '-q', wt, '-b', 'a'], main);
  const relMain = path.join(base, 'rel-main');
  init(relMain);
  let relWt = null;
  try {
    const p = path.join(base, 'rel-wt');
    git(['worktree', 'add', '-q', '--relative-paths', p, '-b', 'b'], relMain);
    relWt = p;
  } catch {
    relWt = null;
  }
  git(['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', inner, 'sub'], main);
  const sub = path.join(main, 'sub');
  const link = path.join(base, 'link-wt');
  fs.symlinkSync(wt, link);
  try {
    return fn({ base, main, wt, relWt, sub, link });
  } finally {
    try { git(['worktree', 'remove', '--force', wt], main); } catch {}
    if (relWt) { try { git(['worktree', 'remove', '--force', relWt], relMain); } catch {} }
    fs.rmSync(base, { recursive: true, force: true });
  }
}

function gitCommonMain(dir) {
  const out = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: dir, encoding: 'utf8' }).trim();
  return path.dirname(fs.realpathSync(path.resolve(dir, out)));
}

// A --relative-paths worktree is left out: its main config carries [extensions],
// so the reader defers to git for it (pinned in its own test below).
function shapeDirs(f) {
  return [f.wt, f.sub, f.link];
}

// Runs fn(freshModule) with every child_process launcher wrapped by a
// recording call-through, re-requiring the status line so its destructured
// bindings capture the wrappers. Returns { result, launches }.
function recordLaunches(fn) {
  const cp = require('node:child_process');
  const names = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync'];
  const originals = {};
  const launches = [];
  const modPath = require.resolve('../plugin/bin/claude-tweaks-statusline.js');
  const savedEntry = require.cache[modPath];
  for (const n of names) {
    originals[n] = cp[n];
    cp[n] = function (file, args, ...rest) {
      launches.push({ fn: n, file, args: Array.isArray(args) ? args : [] });
      return originals[n].call(this, file, args, ...rest);
    };
  }
  try {
    delete require.cache[modPath];
    const fresh = require(modPath);
    return { result: fn(fresh), launches };
  } finally {
    for (const n of names) cp[n] = originals[n];
    delete require.cache[modPath];
    if (savedEntry) require.cache[modPath] = savedEntry;
  }
}

test('commonDirFromFs: matches git rev-parse --git-common-dir for every worktree shape', () => {
  withWorktrees((f) => {
    for (const dir of shapeDirs(f)) {
      assert.strictEqual(path.dirname(sl.commonDirFromFs(dir)), gitCommonMain(dir), dir);
    }
  });
});

test('resolveMainProjectDir: equals git\'s answer for every worktree shape', () => {
  withWorktrees((f) => {
    for (const dir of shapeDirs(f)) {
      assert.strictEqual(sl.resolveMainProjectDir(dir), gitCommonMain(dir), dir);
    }
  });
});

test('commonDirFromFs: GIT_DIR or GIT_COMMON_DIR in the env defers to git', () => {
  withWorktrees((f) => {
    assert.strictEqual(sl.commonDirFromFs(f.wt, { GIT_DIR: '/x' }), null);
    assert.strictEqual(sl.commonDirFromFs(f.wt, { GIT_COMMON_DIR: '/x' }), null);
    assert.strictEqual(sl.commonDirFromFs(f.wt, { GIT_DIR: '' }), null);
    assert.strictEqual(sl.commonDirFromFs(f.wt, { GIT_COMMON_DIR: '' }), null);
  });
});

// A temp dir whose `.git` FILE holds `content`; fn receives the dir.
function withGitFile(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sl-gitfile-'));
  try {
    fs.writeFileSync(path.join(dir, '.git'), content);
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A fake gitdir whose `commondir` is a directory (EISDIR on read).
function withEisdirCommondir(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sl-eisdir-'));
  try {
    const gitdir = path.join(root, 'admin');
    fs.mkdirSync(path.join(gitdir, 'commondir'), { recursive: true });
    // Valid git-dir shape (also what an ENOENT fallback would land on), so only
    // the EISDIR rule can reject it.
    makeGitDirShape(gitdir);
    const dir = path.join(root, 'checkout');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '.git'), `gitdir: ${gitdir}\n`);
    return fn(dir);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('commonDirFromFs: an unparseable .git file defers to git', () => {
  withGitFile('not a gitdir line\n', (dir) => assert.strictEqual(sl.commonDirFromFs(dir), null));
});

// A checkout dir holding a real `admin/` dir whose commondir names a real main
// .git, plus a `.git` file with the given content. A lax parser that slices the
// content blindly would land on `admin` and return a WRONG non-null answer.
function withLaxTrap(content, fn) {
  withWorktrees((f) => {
    const dir = path.join(f.base, 'trap-checkout');
    fs.mkdirSync(path.join(dir, 'admin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'admin', 'commondir'), path.join(f.main, '.git'));
    fs.writeFileSync(path.join(dir, 'admin', 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(dir, '.git'), content);
    fn(dir, f);
  });
}

// Marks `root` as a valid git directory (HEAD file, objects/ and refs/ dirs).
function makeGitDirShape(root) {
  fs.mkdirSync(path.join(root, 'objects'), { recursive: true });
  fs.mkdirSync(path.join(root, 'refs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'HEAD'), 'ref: refs/heads/main\n');
}

const GIT_LAUNCH = { fn: 'execFileSync', file: 'git', args: ['rev-parse', '--git-common-dir'] };

test('commonDirFromFs: an empty `gitdir: ` path defers to git (git: no path in gitfile)', () => {
  withGitFile('gitdir: \n', (dir) => {
    makeGitDirShape(dir); // without the guard, the checkout itself would pass as a git dir
    assert.strictEqual(sl.commonDirFromFs(dir), null);
    const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(dir));
    assert.deepStrictEqual(launches, [GIT_LAUNCH]);
    assert.strictEqual(result, dir);
  });
});

test('commonDirFromFs: a zero-byte commondir defers to git (git dies on it)', () => {
  withLaxTrap('gitdir: admin\n', (dir) => {
    makeGitDirShape(path.join(dir, 'admin')); // without the guard, the admin dir itself would pass
    fs.writeFileSync(path.join(dir, 'admin', 'commondir'), '');
    assert.strictEqual(sl.commonDirFromFs(dir), null);
    const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(dir));
    assert.deepStrictEqual(launches, [GIT_LAUNCH]);
    assert.strictEqual(result, dir);
  });
});

test('commonDirFromFs: a gitdir without HEAD is not a repository — defers to git', () => {
  withLaxTrap('gitdir: admin\n', (dir) => {
    fs.rmSync(path.join(dir, 'admin', 'HEAD'));
    assert.strictEqual(sl.commonDirFromFs(dir), null);
    const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(dir));
    assert.deepStrictEqual(launches, [GIT_LAUNCH]);
    assert.strictEqual(result, dir);
  });
});

for (const missing of ['objects', 'refs']) {
  test(`commonDirFromFs: a common dir without ${missing}/ is not a repository — defers to git`, () => {
    withLaxTrap('gitdir: admin\n', (dir) => {
      const common = path.join(dir, 'common2');
      makeGitDirShape(common);
      fs.rmSync(path.join(common, missing), { recursive: true });
      fs.writeFileSync(path.join(dir, 'admin', 'commondir'), common);
      assert.strictEqual(sl.commonDirFromFs(dir), null);
      const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(dir));
      assert.deepStrictEqual(launches, [GIT_LAUNCH]);
      assert.strictEqual(result, dir);
    });
  });
}

test('commonDirFromFs: `gitdir:` without the space defers to git (git rejects it)', () => {
  // 'gitdir:' is 7 chars; a parser that skips 8 would read `admin` from here.
  withLaxTrap('gitdir:Xadmin\n', (dir) => {
    assert.strictEqual(sl.commonDirFromFs(dir), null);
    const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(dir));
    assert.deepStrictEqual(launches.map((l) => l.file), ['git']);
    assert.strictEqual(result, dir);
  });
});

test('commonDirFromFs: `gitdir:` on a second line defers to git (git rejects it)', () => {
  withLaxTrap('# comment\ngitdir: admin\n', (dir) => {
    assert.strictEqual(sl.commonDirFromFs(dir), null);
  });
});

test('commonDirFromFs: a multi-line gitdir value defers to git', { skip: process.platform === 'win32' ? 'win32 paths cannot contain a newline' : false }, () => {
  withLaxTrap('gitdir: admin\nextra\n', (dir, f) => {
    // A real directory literally named `admin\nextra`: a reader without the
    // newline check would resolve to it and answer non-null.
    const odd = path.join(dir, 'admin\nextra');
    makeGitDirShape(odd);
    fs.writeFileSync(path.join(odd, 'commondir'), path.join(f.main, '.git'));
    assert.strictEqual(sl.commonDirFromFs(dir), null);
  });
});

for (const [label, setup] of [
  ['garbage content', (head) => fs.writeFileSync(head, 'garbage\n')],
  ['empty content', (head) => fs.writeFileSync(head, '')],
  ['a directory', (head) => fs.mkdirSync(head)],
  ['a symlink to a valid HEAD', (head) => {
    fs.writeFileSync(`${head}.real`, 'ref: refs/heads/x\n');
    fs.symlinkSync(`${head}.real`, head);
  }],
]) {
  test(`commonDirFromFs: a gitdir whose HEAD is ${label} is not a repository — defers to git`, { skip: label === 'a symlink to a valid HEAD' && process.platform === 'win32' ? 'symlinks need privileges on win32' : false }, () => {
    withLaxTrap('gitdir: admin\n', (dir) => {
      const head = path.join(dir, 'admin', 'HEAD');
      fs.rmSync(head);
      setup(head);
      assert.strictEqual(sl.commonDirFromFs(dir), null);
      const { launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(dir));
      assert.deepStrictEqual(launches, [GIT_LAUNCH]);
    });
  });
}

test('commonDirFromFs: a 40- or 64-hex HEAD (detached) is a valid repository', () => {
  for (const hex of ['a'.repeat(40), 'b'.repeat(64)]) {
    withLaxTrap('gitdir: admin\n', (dir, f) => {
      fs.writeFileSync(path.join(dir, 'admin', 'HEAD'), `${hex}\r\n`);
      assert.strictEqual(path.dirname(sl.commonDirFromFs(dir)), fs.realpathSync(f.main));
    });
  }
});

test('commonDirFromFs: an objects entry that is an executable FILE is not a repository — defers to git', { skip: process.platform === 'win32' ? 'win32 has no executable bit' : false }, () => {
  withLaxTrap('gitdir: admin\n', (dir) => {
    const common = path.join(dir, 'common2');
    makeGitDirShape(common);
    fs.rmSync(path.join(common, 'objects'), { recursive: true });
    const objectsFile = path.join(common, 'objects');
    fs.writeFileSync(objectsFile, '', { mode: 0o755 }); // passes X_OK, is not a directory
    fs.chmodSync(objectsFile, 0o755); // the write mode above is masked by the umask
    // Fail loudly rather than pass vacuously (restrictive umask, noexec mount).
    fs.accessSync(objectsFile, fs.constants.X_OK);
    fs.writeFileSync(path.join(dir, 'admin', 'commondir'), common);
    assert.strictEqual(sl.commonDirFromFs(dir), null);
  });
});

test('commonDirFromFs: GIT_OBJECT_DIRECTORY in the env defers to git', () => {
  withWorktrees((f) => {
    assert.strictEqual(sl.commonDirFromFs(f.wt, { GIT_OBJECT_DIRECTORY: '/x' }), null);
    assert.strictEqual(sl.commonDirFromFs(f.wt, { GIT_OBJECT_DIRECTORY: '' }), null);
  });
});

test('commonDirFromFs: an objects/ dir without search permission defers to git (access X_OK)', chmodDenialSkip('root ignores directory permissions'), () => {
  withLaxTrap('gitdir: admin\n', (dir) => {
    const common = path.join(dir, 'common2');
    makeGitDirShape(common);
    fs.writeFileSync(path.join(dir, 'admin', 'commondir'), common);
    fs.chmodSync(path.join(common, 'objects'), 0o600);
    try {
      assert.strictEqual(sl.commonDirFromFs(dir), null);
      const { launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(dir));
      assert.deepStrictEqual(launches, [GIT_LAUNCH]);
    } finally {
      fs.chmodSync(path.join(common, 'objects'), 0o755);
    }
  });
});

test('commonDirFromFs: sanity — the trap fixture resolves when the line is well formed', () => {
  withLaxTrap('gitdir: admin\n', (dir, f) => {
    assert.strictEqual(path.dirname(sl.commonDirFromFs(dir)), fs.realpathSync(f.main));
  });
});

test('commonDirFromFs: a commondir with a trailing space is not trimmed (git fails on it too)', () => {
  withWorktrees((f) => {
    const admin = fs.readFileSync(path.join(f.wt, '.git'), 'utf8').replace(/^gitdir: /, '').trim();
    fs.writeFileSync(path.join(admin, 'commondir'), '../.. \n');
    assert.throws(() => execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: f.wt, stdio: 'pipe' }));
    assert.strictEqual(sl.commonDirFromFs(f.wt), null);
  });
});

test('resolveMainProjectDir: an env redirect reaches git, not the file read', () => {
  withWorktrees((f) => {
    const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(f.wt, { env: { GIT_DIR: '' } }));
    assert.deepStrictEqual(launches, [{ fn: 'execFileSync', file: 'git', args: ['rev-parse', '--git-common-dir'] }]);
    assert.strictEqual(result, gitCommonMain(f.wt));
  });
});

test('resolveMainProjectDir: an unreadable .git file reaches git', chmodDenialSkip('root ignores file permissions'), () => {
  withWorktrees((f) => {
    // A REAL worktree's gitdir line: readable, it takes the fast path (no spawn).
    const gitFile = path.join(f.wt, '.git');
    assert.deepStrictEqual(recordLaunches((fresh) => fresh.resolveMainProjectDir(f.wt)).launches, []);
    fs.chmodSync(gitFile, 0);
    try {
      const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(f.wt));
      assert.deepStrictEqual(launches, [GIT_LAUNCH]);
      assert.strictEqual(result, f.wt); // git cannot read it either
    } finally {
      fs.chmodSync(gitFile, 0o644);
    }
  });
});

test('resolveMainProjectDir: a gitdir reached through a symlink resolves a relative commondir against its realpath', () => {
  withWorktrees((f) => {
    const adminRoot = path.join(f.main, '.git', 'worktrees');
    const link = path.join(f.base, 'link');
    fs.symlinkSync(adminRoot, link);
    const name = path.basename(fs.readFileSync(path.join(f.wt, '.git'), 'utf8').trim());
    assert.strictEqual(fs.readFileSync(path.join(adminRoot, name, 'commondir'), 'utf8').trim(), '../..');
    fs.writeFileSync(path.join(f.wt, '.git'), `gitdir: ${path.join(link, name)}\n`);
    const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(f.wt));
    assert.deepStrictEqual(launches, []); // the fast path answered, no spawn
    assert.strictEqual(result, gitCommonMain(f.wt));
    assert.strictEqual(result, fs.realpathSync(f.main));
  });
});

// A submodule checkout's `.git` holds a relative `gitdir: ../.git/modules/sub`
// with no [extensions] in the config it leads to, so the fast path answers it. (A
// --relative-paths worktree has the same relative gitdir, but its main config
// carries extensions.relativeWorktrees, so the reader defers on it.)
test('commonDirFromFs: a symlink at another depth to a checkout with a relative gitdir matches git (physical resolve)', () => {
  withWorktrees((f) => {
    assert.strictEqual(fs.readFileSync(path.join(f.sub, '.git'), 'utf8').trim(), 'gitdir: ../.git/modules/sub');
    const deep = path.join(f.base, 'b', 'c');
    fs.mkdirSync(deep, { recursive: true });
    const link = path.join(deep, 'link');
    fs.symlinkSync(f.sub, link);
    // Decoy at the LEXICALLY resolved gitdir (<deep>/.git/modules/sub), shaped as a git dir.
    makeGitDirShape(path.join(deep, '.git', 'modules', 'sub'));
    assert.strictEqual(path.dirname(sl.commonDirFromFs(link)), gitCommonMain(link));
    assert.strictEqual(sl.resolveMainProjectDir(link), gitCommonMain(link));
  });
});

test('commonDirFromFs: a --relative-paths worktree defers to git (its main config carries extensions.relativeWorktrees)', (t) => {
  withWorktrees((f) => {
    if (!f.relWt) return t.skip('git lacks --relative-paths');
    assert.match(fs.readFileSync(path.join(f.base, 'rel-main', '.git', 'config'), 'utf8'), /\[extensions\]/);
    assert.strictEqual(sl.commonDirFromFs(f.relWt), null);
    const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(f.relWt));
    assert.deepStrictEqual(launches, [GIT_LAUNCH]);
    assert.strictEqual(result, gitCommonMain(f.relWt));
  });
});

test('commonDirFromFs: a gitdir that does not exist defers to git', () => {
  withGitFile('gitdir: /nonexistent/x/.git/worktrees/y\n', (dir) => assert.strictEqual(sl.commonDirFromFs(dir), null));
});

test('commonDirFromFs: an unreadable commondir defers to git', () => {
  withEisdirCommondir((dir) => assert.strictEqual(sl.commonDirFromFs(dir), null));
});

test('resolveMainProjectDir: each fallback reaches git', () => {
  const expectedLaunch = { fn: 'execFileSync', file: 'git', args: ['rev-parse', '--git-common-dir'] };
  const check = (dir) => {
    const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(dir));
    assert.deepStrictEqual(launches, [expectedLaunch]);
    assert.strictEqual(result, dir);
  };
  withGitFile('not a gitdir line\n', check);
  withGitFile('gitdir: /nonexistent/x/.git/worktrees/y\n', check);
  withEisdirCommondir(check);
  withWorktrees((f) => {
    const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(f.wt));
    assert.deepStrictEqual(launches, []);
    assert.strictEqual(result, gitCommonMain(f.wt));
  });
});

test('resolveMainProjectDir: fast:false skips the filesystem read and asks git', () => {
  withWorktrees((f) => {
    const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(f.wt, { fast: false }));
    assert.deepStrictEqual(launches, [{ fn: 'execFileSync', file: 'git', args: ['rev-parse', '--git-common-dir'] }]);
    assert.strictEqual(result, gitCommonMain(f.wt));
  });
});

test('commonDirFromFs: CRLF .git and commondir files parse the same', () => {
  withWorktrees((f) => {
    const fake = path.join(f.base, 'crlf-admin');
    fs.mkdirSync(fake);
    fs.writeFileSync(path.join(fake, 'commondir'), `${path.join(f.main, '.git')}\r\n`);
    fs.writeFileSync(path.join(fake, 'HEAD'), 'ref: refs/heads/main\n');
    const dir = path.join(f.base, 'crlf-checkout');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '.git'), `gitdir: ${fake}\r\n`);
    assert.strictEqual(path.dirname(sl.commonDirFromFs(dir)), gitCommonMain(f.wt));
  });
});

// --- originUrlFromConfig / readOriginRemote (spawn-free origin URL) ---

function gitOrigin(dir, env = process.env) {
  try {
    return execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

const LOCAL_URL = 'https://github.com/o/local.git';
const ORIGIN_LAUNCH = { fn: 'execFileSync', file: 'git', args: ['config', '--get', 'remote.origin.url'] };

// Fast-path case: the reader answers `expected`, equals git, and spawns nothing.
function assertFastOrigin(dir, expected) {
  assert.strictEqual(sl.originUrlFromConfig(dir), expected);
  assert.strictEqual(gitOrigin(dir), expected);
  const { result, launches } = recordLaunches((fresh) => fresh.readOriginRemote(dir));
  assert.strictEqual(result, expected);
  assert.deepStrictEqual(launches, []);
}

// Fallback case: the reader answers null ("ask git"), and readOriginRemote
// launches exactly one `git config --get remote.origin.url` and equals git.
function assertFallbackOrigin(dir, env) {
  assert.strictEqual(sl.originUrlFromConfig(dir, env), null);
  const { result, launches } = recordLaunches((fresh) => fresh.readOriginRemote(dir, { env }));
  assert.deepStrictEqual(launches, [ORIGIN_LAUNCH]);
  assert.strictEqual(result, gitOrigin(dir));
}

test('originUrlFromConfig: plain origin matches git config --get', () => {
  withRepo('git@github.com:owner/repo.git', (dir) => assertFastOrigin(dir, 'git@github.com:owner/repo.git'));
});

test('originUrlFromConfig: several url lines — the last wins, as git config --get does', () => {
  withRepo(LOCAL_URL, (dir) => {
    fs.appendFileSync(path.join(dir, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/o/second.git\n');
    assertFastOrigin(dir, 'https://github.com/o/second.git');
  });
});

test('originUrlFromConfig: section and key names are case-insensitive', () => {
  withRepo(LOCAL_URL, (dir) => {
    const cfg = path.join(dir, '.git', 'config');
    fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace('[remote "origin"]', '[Remote "origin"]').replace('\turl =', '\tURL ='));
    assertFastOrigin(dir, LOCAL_URL);
  });
});

test('originUrlFromConfig: CRLF config parses the same', () => {
  withRepo(LOCAL_URL, (dir) => {
    const cfg = path.join(dir, '.git', 'config');
    fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace(/\n/g, '\r\n'));
    assertFastOrigin(dir, LOCAL_URL);
  });
});

test('originUrlFromConfig: a url in another remote or section is not origin\'s', () => {
  withRepo(LOCAL_URL, (dir) => {
    fs.appendFileSync(path.join(dir, '.git', 'config'), '[remote "upstream"]\n\turl = https://github.com/o/up.git\n[core]\n\turl = https://github.com/o/core.git\n');
    assertFastOrigin(dir, LOCAL_URL);
  });
});

test('originUrlFromConfig: no origin section — null, git also answers nothing', () => {
  withRepo(null, (dir) => {
    assert.strictEqual(sl.originUrlFromConfig(dir), null);
    const { result, launches } = recordLaunches((fresh) => fresh.readOriginRemote(dir));
    assert.deepStrictEqual(launches, [ORIGIN_LAUNCH]);
    assert.strictEqual(result, gitOrigin(dir));
    assert.strictEqual(result, null);
  });
});

// Each case: a trigger appended/applied to a repo whose origin is LOCAL_URL.
// Removing the trigger's check from the reader must make it answer something
// non-null (usually the local url, which git does NOT answer), so the test goes red.
const origCfg = (dir) => path.join(dir, '.git', 'config');
const appendCfg = (dir, text) => fs.appendFileSync(origCfg(dir), text);
const ORIGIN_FALLBACKS = [
  ['an [include] after the local origin (git answers the included url)', (dir) => {
    fs.writeFileSync(path.join(dir, '.git', 'extra'), '[remote "origin"]\n\turl = https://github.com/o/included.git\n');
    appendCfg(dir, '[include]\n\tpath = extra\n');
    assert.strictEqual(gitOrigin(dir), 'https://github.com/o/included.git');
  }],
  ['an [includeIf] after the local origin (git answers the included url)', (dir) => {
    fs.writeFileSync(path.join(dir, '.git', 'extra'), '[remote "origin"]\n\turl = https://github.com/o/included.git\n');
    appendCfg(dir, '[includeIf "gitdir:**"]\n\tpath = extra\n');
    assert.strictEqual(gitOrigin(dir), 'https://github.com/o/included.git');
  }],
  ['a value containing ;', (dir) => appendCfg(dir, '[remote "origin"]\n\turl = https://github.com/o/r.git;x\n')],
  ['a value containing a backslash', (dir) => appendCfg(dir, '[remote "origin"]\n\turl = https://github.com/o/r\\.git\n')],
  ['a quoted value', (dir) => appendCfg(dir, '[remote "origin"]\n\turl = "https://github.com/o/r.git"\n')],
  ['a value containing #', (dir) => appendCfg(dir, '[remote "origin"]\n\turl = https://github.com/o/r.git # note\n')],
  ['an old-style [remote.origin] header (git answers it)', (dir) => {
    appendCfg(dir, '[remote.origin]\n\turl = https://github.com/o/old.git\n');
    assert.strictEqual(gitOrigin(dir), 'https://github.com/o/old.git');
  }],
  ['text after a section header (git answers the inline url)', (dir) => {
    appendCfg(dir, '[remote "origin"] url = https://github.com/o/inline.git\n');
    assert.strictEqual(gitOrigin(dir), 'https://github.com/o/inline.git');
  }],
  ['a trailing-backslash line that folds the next url line into it (git does not answer it)', (dir) => {
    appendCfg(dir, '[remote "origin"]\n\tfetch = x \\\n\turl = https://github.com/o/swallowed.git\n');
    assert.strictEqual(gitOrigin(dir), LOCAL_URL);
  }],
  ['an unterminated quote in another section (git rejects the whole file)', (dir) => {
    appendCfg(dir, '[alias]\n\tx = "a\n');
    assert.strictEqual(gitOrigin(dir), null);
  }],
  ['a vertical tab before = (git rejects the line)', (dir) => {
    appendCfg(dir, '[remote "origin"]\n\turl\v= https://github.com/o/vt.git\n');
    assert.strictEqual(gitOrigin(dir), null);
  }],
  ['a line starting with a form feed (git rejects the line)', (dir) => appendCfg(dir, '[core]\n\f\tbar = 1\n')],
  ['an origin url value with a trailing NBSP (git keeps it; the git path trims its output, so the reader defers)', (dir) => appendCfg(dir, '[remote "origin"]\n\turl = https://github.com/o/nb.git\u00a0\n')],
  ['an origin url value with a leading U+3000 (git keeps it; the git path trims its output, so the reader defers)', (dir) => appendCfg(dir, '[remote "origin"]\n\turl = \u3000https://github.com/o/ideo.git\n')],
  ['an origin url value with a trailing vertical tab (git keeps it; the git path trims its output, so the reader defers)', (dir) => appendCfg(dir, '[remote "origin"]\n\turl = https://github.com/o/vtab.git\v\n')],
  ['a line holding only a form feed (git allows only space and tab as blank)', (dir) => appendCfg(dir, '[core]\n\f\n')],
  ['a comment line preceded by a form feed (not a comment to git)', (dir) => appendCfg(dir, '[core]\n\f# note\n')],
  ['a section header preceded by a form feed', (dir) => appendCfg(dir, '\f[core]\n')],
  ['a section header followed by a form feed', (dir) => appendCfg(dir, '[core]\f\n')],
  ['an origin url value with a trailing form feed (git keeps it; the git path trims its output, so the reader defers)', (dir) => appendCfg(dir, '[remote "origin"]\n\turl = https://github.com/o/ff.git\f\n')],
  ['a line matching no config shape', (dir) => appendCfg(dir, '!!not config\n')],
  ['a key line before any section (git accepts it; a conservative fallback)', (dir) => {
    const cfg = origCfg(dir);
    fs.writeFileSync(cfg, `url = https://github.com/o/stray.git\n${fs.readFileSync(cfg, 'utf8')}`);
  }],
  ['a url key with no = (a valueless boolean)', (dir) => appendCfg(dir, '[remote "origin"]\n\turl\n')],
  ['a .git/config.worktree that git reads (extensions.worktreeConfig) and that overrides origin', (dir) => {
    appendCfg(dir, '[core]\n\trepositoryformatversion = 1\n[extensions]\n\tworktreeConfig = true\n');
    fs.writeFileSync(path.join(dir, '.git', 'config.worktree'), '[remote "origin"]\n\turl = https://github.com/o/wt.git\n');
    assert.strictEqual(gitOrigin(dir), 'https://github.com/o/wt.git');
  }],
  ['an [extensions] section naming an extension git does not know (git refuses the repo)', (dir) => {
    appendCfg(dir, '[core]\n\trepositoryformatversion = 1\n[extensions]\n\tnoSuchExtension = true\n');
    assert.strictEqual(gitOrigin(dir), null);
  }],
  ['an [extensions] section naming a known extension (git answers; any [extensions] section defers)', (dir) => {
    appendCfg(dir, '[core]\n\trepositoryformatversion = 1\n[extensions]\n\tobjectFormat = sha1\n');
    assert.strictEqual(gitOrigin(dir), LOCAL_URL);
  }],
  ['core.repositoryformatversion = 2 (git refuses the repo)', (dir) => {
    appendCfg(dir, '[core]\n\trepositoryformatversion = 2\n');
    assert.strictEqual(gitOrigin(dir), null);
  }],
  ['a non-numeric core.repositoryformatversion (git dies on it)', (dir) => {
    appendCfg(dir, '[Core]\n\tRepositoryFormatVersion = abc\n');
    assert.strictEqual(gitOrigin(dir), null);
  }],
  ['an origin url with an embedded NUL (git cuts the value there)', (dir) => {
    appendCfg(dir, '[remote "origin"]\n\turl = https://github.com/o/nul.git\0junk\n');
    assert.strictEqual(gitOrigin(dir), 'https://github.com/o/nul.git');
  }],
];
for (const [label, setup] of ORIGIN_FALLBACKS) {
  test(`originUrlFromConfig: ${label} defers to git`, () => {
    withRepo(LOCAL_URL, (dir) => {
      setup(dir);
      assertFallbackOrigin(dir);
    });
  });
}

test('originUrlFromConfig: an unreadable config (a directory at .git/config) defers to git and never throws', () => {
  withRepo(LOCAL_URL, (dir) => {
    fs.rmSync(origCfg(dir));
    fs.mkdirSync(origCfg(dir));
    assertFallbackOrigin(dir);
    assert.strictEqual(gitOrigin(dir), null);
  });
});

test('originUrlFromConfig: GIT_CONFIG* in the env defers to git', () => {
  withRepo(LOCAL_URL, (dir) => {
    assertFallbackOrigin(dir, { GIT_CONFIG_GLOBAL: '/dev/null' });
    assert.strictEqual(sl.originUrlFromConfig(dir, { GIT_CONFIG_COUNT: '0' }), null);
    assert.strictEqual(sl.originUrlFromConfig(dir, { GIT_CONFIG_GLOBAL: '' }), null);
  });
});

test('originUrlFromConfig: GIT_DIR in the env defers to git (even empty)', () => {
  withRepo(LOCAL_URL, (dir) => {
    assertFallbackOrigin(dir, { GIT_DIR: '/nonexistent' });
    assert.strictEqual(sl.originUrlFromConfig(dir, { GIT_DIR: '' }), null);
  });
});

test('originUrlFromConfig: GIT_COMMON_DIR in the env defers to git (git reads $GIT_COMMON_DIR/config)', () => {
  withRepo('https://github.com/o/a.git', (a) => {
    withRepo('https://github.com/o/b.git', (b) => {
      const env = { GIT_COMMON_DIR: path.join(a, '.git') };
      const real = execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: b, encoding: 'utf8', env: { ...process.env, ...env } }).trim();
      assert.strictEqual(real, 'https://github.com/o/a.git'); // git answers A, not B
      assert.strictEqual(sl.originUrlFromConfig(b, env), null);
      assert.strictEqual(sl.originUrlFromConfig(b, { GIT_COMMON_DIR: '' }), null);
    });
  });
});

test('originUrlFromConfig: an unrelated env var does not defer', () => {
  withRepo(LOCAL_URL, (dir) => assert.strictEqual(sl.originUrlFromConfig(dir, { PATH: '/x', GITHUB_TOKEN: 'y' }), LOCAL_URL));
});

test('originUrlFromConfig: a .git FILE (linked worktree) defers to git', () => {
  withWorktrees((f) => {
    assert.strictEqual(sl.originUrlFromConfig(f.wt), null);
    const { result, launches } = recordLaunches((fresh) => fresh.readOriginRemote(f.wt));
    assert.deepStrictEqual(launches, [ORIGIN_LAUNCH]);
    assert.strictEqual(result, gitOrigin(f.wt));
  });
});

test('readOriginRemote: fast:false skips the filesystem read and asks git', () => {
  withRepo(LOCAL_URL, (dir) => {
    const { result, launches } = recordLaunches((fresh) => fresh.readOriginRemote(dir, { fast: false }));
    assert.deepStrictEqual(launches, [ORIGIN_LAUNCH]);
    assert.strictEqual(result, LOCAL_URL);
  });
});

test('readOriginRemote: an existing directory that is not a repo answers null (git exits non-zero)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sl-norepo-'));
  try {
    assert.strictEqual(sl.originUrlFromConfig(dir), null);
    const { result, launches } = recordLaunches((fresh) => fresh.readOriginRemote(dir));
    assert.deepStrictEqual(launches, [ORIGIN_LAUNCH]);
    assert.strictEqual(result, null);
    assert.strictEqual(gitOrigin(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('originUrlFromConfig: a comment line ending in a backslash does not swallow the next line (git agrees)', () => {
  withRepo(LOCAL_URL, (dir) => {
    appendCfg(dir, '# note \\\n[remote "origin"]\n\turl = https://github.com/o/after.git\n');
    assertFastOrigin(dir, 'https://github.com/o/after.git');
  });
});

// --- repos git refuses to open, non-regular files, env name case (#5266 review) ---

const OWNER_OPTS = { skip: typeof process.geteuid !== 'function' && 'win32: no geteuid; git compares SIDs there and the readers skip the ownership check' };
const OTHER_UID = typeof process.geteuid === 'function' ? process.geteuid() + 1 : null;
// git's own test knob: git treats every repo as owned by someone else and refuses it.
const DIFFERENT_OWNER_ENV = { ...process.env, GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' };

test('originUrlFromConfig: a main checkout owned by another user defers to git (ensure_valid_ownership)', OWNER_OPTS, () => {
  withRepo(LOCAL_URL, (dir) => {
    assert.strictEqual(gitOrigin(dir, DIFFERENT_OWNER_ENV), null); // git really refuses it
    assert.strictEqual(sl.originUrlFromConfig(dir, {}, process.geteuid()), LOCAL_URL);
    assert.strictEqual(sl.originUrlFromConfig(dir, {}, OTHER_UID), null);
    const { result, launches } = recordLaunches((fresh) => fresh.readOriginRemote(dir, { currentUid: OTHER_UID }));
    assert.deepStrictEqual(launches, [ORIGIN_LAUNCH]);
    assert.strictEqual(result, gitOrigin(dir));
  });
});

test('commonDirFromFs: a linked worktree owned by another user defers to git (ensure_valid_ownership)', OWNER_OPTS, () => {
  withWorktrees((f) => {
    assert.throws(() => execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: f.wt, stdio: 'pipe', env: DIFFERENT_OWNER_ENV }), /dubious ownership/);
    assert.strictEqual(gitOrigin(f.wt, DIFFERENT_OWNER_ENV), null);
    assert.strictEqual(path.dirname(sl.commonDirFromFs(f.wt, {}, process.geteuid())), gitCommonMain(f.wt));
    assert.strictEqual(sl.commonDirFromFs(f.wt, {}, OTHER_UID), null);
    const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(f.wt, { currentUid: OTHER_UID }));
    assert.deepStrictEqual(launches, [GIT_LAUNCH]);
    assert.strictEqual(result, gitCommonMain(f.wt));
  });
});

// Under sudo git compares SUDO_UID; both readers defer. On a non-root host this
// cannot go red alone: with currentUid 0 the fixture's owner differs anyway.
test('both readers defer to git under sudo (euid 0 with SUDO_UID set)', () => {
  withWorktrees((f) => {
    assert.strictEqual(sl.commonDirFromFs(f.wt, { SUDO_UID: '1000' }, 0), null);
    assert.strictEqual(sl.originUrlFromConfig(f.main, { SUDO_UID: '1000' }, 0), null);
  });
});

for (const missing of ['HEAD', 'objects', 'refs']) {
  test(`originUrlFromConfig: a nested .git without ${missing} is not a repository — git answers the parent's url`, () => {
    withRepo(LOCAL_URL, (dir) => {
      const child = path.join(dir, 'child');
      const childGit = path.join(child, '.git');
      makeGitDirShape(childGit);
      fs.writeFileSync(path.join(childGit, 'config'), '[remote "origin"]\n\turl = https://github.com/o/child.git\n');
      assertFastOrigin(child, 'https://github.com/o/child.git'); // complete, it is the child's repo
      fs.rmSync(path.join(childGit, missing), { recursive: true });
      assert.strictEqual(gitOrigin(child), LOCAL_URL);
      assertFallbackOrigin(child);
    });
  });
}

test('originUrlFromConfig: GIT_OBJECT_DIRECTORY in the env defers to git (is_git_directory checks it instead of .git/objects)', () => {
  withRepo(LOCAL_URL, (dir) => {
    const env = { GIT_OBJECT_DIRECTORY: path.join(dir, 'nonexistent') };
    assert.strictEqual(gitOrigin(dir, { ...process.env, ...env }), null); // git no longer sees a repo
    assertFallbackOrigin(dir, env);
    assert.strictEqual(sl.originUrlFromConfig(dir, { GIT_OBJECT_DIRECTORY: '' }), null);
  });
});

test('commonDirFromFs: a NUL in the .git file defers to git, which reads up to it', () => {
  withWorktrees((f) => {
    const gitFile = path.join(f.wt, '.git');
    fs.writeFileSync(gitFile, `${fs.readFileSync(gitFile, 'utf8').trim()}\0junk\n`);
    assert.strictEqual(sl.commonDirFromFs(f.wt), null);
    const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(f.wt));
    assert.deepStrictEqual(launches, [GIT_LAUNCH]);
    assert.strictEqual(result, gitCommonMain(f.wt));
  });
});

// A read that blocks on a FIFO blocks the whole thread, which node:test's timeout
// cannot interrupt, so the reader runs in a child with its own timeout.
const FIFO_OPTS = { timeout: 5000, skip: process.platform === 'win32' && 'win32: no mkfifo' };
function readerInChild(call, p) {
  const script = `const sl = require(process.argv[1]); const p = process.argv[2]; process.stdout.write(JSON.stringify(${call}));`;
  return JSON.parse(execFileSync(process.execPath, ['-e', script, STATUSLINE, p], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'pipe'] }));
}

test('commonDirFromFs: a FIFO at .git returns null promptly (git refuses it as not a regular file)', FIFO_OPTS, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sl-fifo-'));
  try {
    execFileSync('mkfifo', [path.join(dir, '.git')]);
    assert.strictEqual(readerInChild('sl.commonDirFromFs(p, {})', dir), null);
    assert.throws(() => execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: dir, stdio: 'pipe' }), /not a regular file/);
    const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(dir));
    assert.deepStrictEqual(launches, [GIT_LAUNCH]);
    assert.strictEqual(result, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// git itself blocks on these two, so the git fallback is not exercised here.
test('commonDirFromFs: a FIFO at commondir returns null promptly', FIFO_OPTS, () => {
  withLaxTrap('gitdir: admin\n', (dir) => {
    const commondir = path.join(dir, 'admin', 'commondir');
    fs.rmSync(commondir);
    execFileSync('mkfifo', [commondir]);
    assert.strictEqual(readerInChild('sl.commonDirFromFs(p, {})', dir), null);
  });
});

test('originUrlFromConfig: a FIFO at .git/config returns null promptly', FIFO_OPTS, () => {
  withRepo(LOCAL_URL, (dir) => {
    fs.rmSync(origCfg(dir));
    execFileSync('mkfifo', [origCfg(dir)]);
    assert.strictEqual(readerInChild('sl.originUrlFromConfig(p, {})', dir), null);
  });
});

test('originUrlFromConfig: env names match case-insensitively, as on win32', () => {
  withRepo(LOCAL_URL, (dir) => {
    assertFallbackOrigin(dir, { git_config_global: '/x' });
    for (const name of ['git_dir', 'Git_Common_Dir', 'git_object_directory']) assertFallbackOrigin(dir, { [name]: '' });
  });
});

// A linked worktree whose main repo config git refuses: git dies, so the fast path
// must not answer the main dir.
for (const [label, text, fatal] of [
  ['version 1 with an unknown extension', '[core]\n\trepositoryformatversion = 1\n[extensions]\n\tnoSuchExtension = true\n', /unknown repository extension/],
  ['version 2', '[core]\n\trepositoryformatversion = 2\n', /Expected git repo version <= 1, found 2/],
  ['version 0 with a v1-only extension', '[extensions]\n\tobjectFormat = sha1\n', /repo version is 0, but v1-only extension found/],
]) {
  test(`commonDirFromFs: a main config git refuses (${label}) defers to git`, () => {
    withWorktrees((f) => {
      assert.deepStrictEqual(recordLaunches((fresh) => fresh.resolveMainProjectDir(f.wt)).launches, []); // fast before
      fs.appendFileSync(path.join(f.main, '.git', 'config'), text);
      assert.throws(() => execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: f.wt, stdio: 'pipe' }), fatal);
      assert.strictEqual(sl.commonDirFromFs(f.wt), null);
      const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(f.wt));
      assert.deepStrictEqual(launches, [GIT_LAUNCH]);
      assert.strictEqual(result, f.wt); // git died, so the git path answers the worktree dir
    });
  });
}

test('commonDirFromFs: a missing main config still answers fast (git accepts it and answers the same)', () => {
  withWorktrees((f) => {
    fs.rmSync(path.join(f.main, '.git', 'config'));
    const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(f.wt));
    assert.deepStrictEqual(launches, []);
    assert.strictEqual(result, gitCommonMain(f.wt));
  });
});

test('commonDirFromFs: a FIFO main config returns null promptly', FIFO_OPTS, () => {
  withWorktrees((f) => {
    const cfg = path.join(f.main, '.git', 'config');
    fs.rmSync(cfg);
    execFileSync('mkfifo', [cfg]);
    try {
      assert.strictEqual(readerInChild('sl.commonDirFromFs(p, {})', f.wt), null);
    } finally {
      fs.rmSync(cfg); // git blocks on it too, and the fixture's cleanup runs git
    }
  });
});

test('originUrlFromConfig: a .git/commondir in a main checkout defers to git (git reads the config it names)', () => {
  withRepo('https://github.com/o/other.git', (other) => {
    withRepo('https://github.com/o/self.git', (self) => {
      fs.writeFileSync(path.join(self, '.git', 'commondir'), path.join(other, '.git'));
      assert.strictEqual(gitOrigin(self), 'https://github.com/o/other.git');
      assertFallbackOrigin(self);
    });
  });
});

test('commonDirFromFs: env names match case-insensitively, as on win32', () => {
  withWorktrees((f) => {
    for (const name of ['git_dir', 'Git_Common_Dir', 'git_object_directory']) {
      assert.strictEqual(sl.commonDirFromFs(f.wt, { [name]: '' }), null, name);
      const { result, launches } = recordLaunches((fresh) => fresh.resolveMainProjectDir(f.wt, { env: { [name]: '' } }));
      assert.deepStrictEqual(launches, [GIT_LAUNCH], name);
      assert.strictEqual(result, gitCommonMain(f.wt), name);
    }
  });
});

// Fixture: a fake $HOME with a default `~/.claude/` config dir and, optionally,
// `~/.claude.json` (rootJson) and/or `~/.claude/.claude.json` (dotClaudeJson).
// Caller removes the returned home.
function makeAccountHome({ rootJson, dotClaudeJson } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sl-home-'));
  fs.mkdirSync(path.join(home, '.claude', 'projects', 'foo'), { recursive: true });
  if (rootJson !== undefined) fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify(rootJson));
  if (dotClaudeJson !== undefined) {
    fs.writeFileSync(path.join(home, '.claude', '.claude.json'), JSON.stringify(dotClaudeJson));
  }
  return home;
}

function defaultTranscript(home) {
  return path.join(home, '.claude', 'projects', 'foo', 's.jsonl');
}

test('renderAccount: extracts slug from a .claude-accounts transcript_path', () => {
  assert.strictEqual(
    sl.renderAccount(
      { transcript_path: '/Users/x/.claude-accounts/personal-gmail/projects/foo/session.jsonl' },
      { env: {}, home: '/Users/x' },
    ),
    'acct: personal-gmail',
  );
});

test('renderAccount: matches a Windows-style backslash path', () => {
  assert.strictEqual(
    sl.renderAccount(
      { transcript_path: 'C:\\Users\\x\\.claude-accounts\\work\\projects\\foo\\session.jsonl' },
      { env: {}, home: 'C:\\Users\\x' },
    ),
    'acct: work',
  );
});

test('renderAccount: any non-default config dir is labeled by its basename, not only .claude-accounts', () => {
  assert.strictEqual(
    sl.renderAccount(
      { transcript_path: '/Users/x/cfg/work-acct/projects/foo/session.jsonl' },
      { env: {}, home: '/Users/x' },
    ),
    'acct: work-acct',
  );
});

test('renderAccount: CLAUDE_CONFIG_DIR wins over transcript_path for the config dir', () => {
  assert.strictEqual(
    sl.renderAccount(
      { transcript_path: '/Users/x/.claude/projects/foo/session.jsonl' },
      { env: { CLAUDE_CONFIG_DIR: '/Users/x/.claude-accounts/memenu' }, home: '/Users/x' },
    ),
    'acct: memenu',
  );
});

test('renderAccount: default config dir (~/.claude) is labeled by the logged-in email from ~/.claude.json', () => {
  const home = makeAccountHome({ rootJson: { oauthAccount: { emailAddress: 'a@outlook.com' } } });
  try {
    assert.strictEqual(
      sl.renderAccount({ transcript_path: defaultTranscript(home) }, { env: {}, home }),
      'acct: a@outlook.com',
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('renderAccount: default config dir skips a ~/.claude/.claude.json stub without oauthAccount', () => {
  // Observed on a real machine: ~/.claude/.claude.json exists without oauthAccount while
  // ~/.claude.json holds the identity — the lookup must not stop at the stub.
  const home = makeAccountHome({
    rootJson: { oauthAccount: { emailAddress: 'a@outlook.com' } },
    dotClaudeJson: { someOtherKey: true },
  });
  try {
    assert.strictEqual(
      sl.renderAccount({ transcript_path: defaultTranscript(home) }, { env: {}, home }),
      'acct: a@outlook.com',
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('renderAccount: missing transcript_path and no CLAUDE_CONFIG_DIR resolves to the default dir', () => {
  const home = makeAccountHome({ rootJson: { oauthAccount: { emailAddress: 'a@outlook.com' } } });
  try {
    assert.strictEqual(sl.renderAccount({}, { env: {}, home }), 'acct: a@outlook.com');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('renderAccount: a transcript_path not shaped <dir>/projects/<slug>/<id>.jsonl falls back to the default dir', () => {
  const home = makeAccountHome({ rootJson: { oauthAccount: { emailAddress: 'a@outlook.com' } } });
  try {
    assert.strictEqual(
      sl.renderAccount({ transcript_path: '/some/odd/place/session.jsonl' }, { env: {}, home }),
      'acct: a@outlook.com',
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('renderAccount returns null on the default config dir with no identity file (API-key / unauthenticated)', () => {
  const home = makeAccountHome();
  try {
    assert.strictEqual(sl.renderAccount({ transcript_path: defaultTranscript(home) }, { env: {}, home }), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('renderAccount returns null when ~/.claude.json is unparseable', () => {
  const home = makeAccountHome();
  fs.writeFileSync(path.join(home, '.claude.json'), '{not json');
  try {
    assert.strictEqual(sl.renderAccount({}, { env: {}, home }), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('renderContext: uses used_percentage when provided', () => {
  const r = sl.renderContext({ context_window: { used_percentage: 18 } });
  assert.ok(r.includes('ctx: 18%'));
});

test('renderContext: falls back to token math when percentage absent', () => {
  const r = sl.renderContext({
    context_window: { total_input_tokens: 36000, context_window_size: 200000 },
  });
  assert.ok(r.includes('ctx: 18%'));
});

test('renderContext returns null on missing context_window', () => {
  assert.strictEqual(sl.renderContext({}), null);
});

test('renderEffort: hides on default/unset/missing', () => {
  assert.strictEqual(sl.renderEffort({}), null);
  assert.strictEqual(sl.renderEffort({ effort: { level: 'default' } }), null);
  assert.strictEqual(sl.renderEffort({ effort: { level: null } }), null);
  assert.strictEqual(sl.renderEffort({ effort: { level: 'high' } }), 'eff: high');
});

test('renderCost: two decimals under $10, one from $10, none from $100', () => {
  const cases = [
    [0.42, '$0.42'],
    [0.006, '$0.01'],
    [9.99, '$9.99'],
    [10, '$10.0'],
    [42.567, '$42.6'],
    [100, '$100'],
    [123.49, '$123'],
    [1234.4, '$1234'],
  ];
  for (const [usd, expected] of cases) {
    assert.strictEqual(sl.renderCost({ cost: { total_cost_usd: usd } }), expected, String(usd));
  }
});

test('renderCost: omitted when absent, zero, sub-cent, negative or not a number', () => {
  const inputs = [
    {},
    { cost: {} },
    { cost: null },
    { cost: { total_cost_usd: 0 } },
    { cost: { total_cost_usd: 0.004 } },
    { cost: { total_cost_usd: -1 } },
    { cost: { total_cost_usd: '0.42' } },
    { cost: { total_cost_usd: NaN } },
    { cost: { total_cost_usd: {} } },
  ];
  for (const input of inputs) {
    assert.strictEqual(sl.renderCost(input), null, JSON.stringify(input));
  }
});

test('renderCost: plain text, identical with and without NO_COLOR', () => {
  const orig = process.env.NO_COLOR;
  try {
    for (const set of [true, false]) {
      if (set) process.env.NO_COLOR = '1';
      else delete process.env.NO_COLOR;
      const r = sl.renderCost({ cost: { total_cost_usd: 0.42 } });
      assert.strictEqual(r, '$0.42');
      assert.ok(!r.includes('\x1b'));
    }
  } finally {
    if (orig === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = orig;
  }
});

test('renderRateLimit: formats reset countdown at minute/hour/day scales', () => {
  const now = 1_700_000_000_000;
  const sec = Math.floor(now / 1000);
  const min45 = sl.renderRateLimit('sess', { used_percentage: 50, resets_at: sec + 45 * 60 }, now);
  const hr3 = sl.renderRateLimit('sess', { used_percentage: 50, resets_at: sec + 3 * 3600 }, now);
  const d4 = sl.renderRateLimit('week', { used_percentage: 50, resets_at: sec + 4 * 86400 }, now);
  assert.match(min45, /sess: 50% \(45m\)/);
  assert.match(hr3, /sess: 50% \(3h\)/);
  assert.match(d4, /week: 50% \(4d\)/);
});

test('renderRateLimit returns null when data missing', () => {
  assert.strictEqual(sl.renderRateLimit('sess', null, Date.now()), null);
  assert.strictEqual(sl.renderRateLimit('sess', {}, Date.now()), null);
});

test('renderRateLimit omits parenthetical when reset is missing', () => {
  const now = 1_700_000_000_000;
  const r = sl.renderRateLimit('sess', { used_percentage: 42 }, now);
  assert.strictEqual(r, 'sess: 42%');
});

test('formatDuration scales correctly', () => {
  assert.strictEqual(sl.formatDuration(30), null);
  assert.strictEqual(sl.formatDuration(180), '3m');
  assert.strictEqual(sl.formatDuration(7200), '2h');
  assert.strictEqual(sl.formatDuration(2 * 86400), '2d');
});

// Regression: Math.round could round a value up past its own bucket's
// boundary (the bucket itself was chosen from the un-rounded value), so a
// value one second under an hour/day boundary used to display as a
// self-contradictory "60m"/"24h" instead of "59m"/"23h".
test('formatDuration does not round past its own bucket boundary', () => {
  assert.strictEqual(sl.formatDuration(3599), '59m');
  assert.strictEqual(sl.formatDuration(86399), '23h');
});

test('colorByPct adds ANSI red at >=90%', () => {
  const orig = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  const r = sl.colorByPct(95, 'ctx: 95%');
  assert.ok(r.includes('\x1b[31m'));
  if (orig !== undefined) process.env.NO_COLOR = orig;
});

test('colorByPct skips colors when NO_COLOR set', () => {
  const orig = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  const r = sl.colorByPct(95, 'ctx: 95%');
  assert.strictEqual(r, 'ctx: 95%');
  if (orig === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = orig;
});

// Shared temp-directory fixture scaffolding: mkdtemp, mkdir a fixture
// subdir, write files, run fn(cwd), clean up in `finally`. withLedgers and
// withSpecs below were structurally identical copies of this, differing
// only in the mkdtemp prefix and the docs/plans vs specs subpath.
function withFixtureDir(prefix, subpathSegments, files, fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dir = path.join(cwd, ...subpathSegments);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  try {
    return fn(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function withLedgers(files, fn) {
  return withFixtureDir('ct-ledger-', ['docs', 'plans'], files, fn);
}

const LEDGER_HEADER = '| # | Phase | Item | Status | Resolution |\n| --- | --- | --- | --- | --- |\n';

test('findOpenLedger returns null when no ledger files exist', () => {
  withLedgers({}, (cwd) => {
    assert.strictEqual(sl.findOpenLedger(cwd), null);
  });
});

test('findOpenLedger returns null when cwd has no docs/plans', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-noplans-'));
  try {
    assert.strictEqual(sl.findOpenLedger(cwd), null);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('findOpenLedger returns null when all rows are terminal', () => {
  withLedgers(
    {
      'a-ledger.md': `${LEDGER_HEADER}| 1 | build | item | fixed | done |\n| 2 | test | item | observation | n/a |\n`,
    },
    (cwd) => assert.strictEqual(sl.findOpenLedger(cwd), null),
  );
});

test('findOpenLedger counts open rows in a single ledger', () => {
  withLedgers(
    {
      'a-ledger.md': `${LEDGER_HEADER}| 1 | build | item | open | — |\n| 2 | test | item | fixed | done |\n`,
    },
    (cwd) => assert.match(sl.findOpenLedger(cwd), /ledger: 1 open/),
  );
});

test('findOpenLedger counts an open row whose Item carries an escaped pipe', () => {
  withLedgers(
    {
      'a-ledger.md': `${LEDGER_HEADER}| 1 | build | match a\\|b | open | — |\n| 2 | test | x\\|y | fixed | done |\n`,
    },
    (cwd) => assert.match(sl.findOpenLedger(cwd), /ledger: 1 open/),
  );
});

test('findOpenLedger sums open rows across all ledgers in cwd', () => {
  withLedgers(
    {
      'spec-1-ledger.md': `${LEDGER_HEADER}| 1 | build | item | open | — |\n`,
      'spec-2-ledger.md': `${LEDGER_HEADER}| 1 | build | item | open | — |\n| 2 | test | item | open | — |\n`,
      'spec-3-ledger.md': `${LEDGER_HEADER}| 1 | build | item | fixed | done |\n`,
    },
    (cwd) => assert.match(sl.findOpenLedger(cwd), /ledger: 3 open/),
  );
});

test('findOpenLedger colors yellow at >=3 open and red at >=10', () => {
  const orig = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  const threeRows = Array.from({ length: 3 }, (_, i) => `| ${i + 1} | build | item | open | — |`).join('\n');
  const tenRows = Array.from({ length: 10 }, (_, i) => `| ${i + 1} | build | item | open | — |`).join('\n');
  withLedgers({ 'a-ledger.md': `${LEDGER_HEADER}${threeRows}\n` }, (cwd) => {
    assert.ok(sl.findOpenLedger(cwd).includes('\x1b[33m'));
  });
  withLedgers({ 'a-ledger.md': `${LEDGER_HEADER}${tenRows}\n` }, (cwd) => {
    assert.ok(sl.findOpenLedger(cwd).includes('\x1b[31m'));
  });
  if (orig !== undefined) process.env.NO_COLOR = orig;
});

// Regression: findOpenLedger's per-file fs.readFileSync call used to live
// inside the same outer try/catch as fs.readdirSync — other claude-tweaks
// skills concurrently create/archive ledger files (e.g. /wrap-up archival),
// so one file becoming unreadable between the directory listing and this
// loop reaching it (a real race) made the whole function return null,
// discarding valid open-row counts from every other untouched ledger.
test('findOpenLedger skips a ledger file raced out between readdir and readFileSync, instead of discarding every other ledger', () => {
  withLedgers(
    {
      'a-ledger.md': `${LEDGER_HEADER}| 1 | build | item | open | — |\n`,
      'b-ledger.md': `${LEDGER_HEADER}| 1 | build | item | open | — |\n`,
    },
    (cwd) => {
      const dir = path.join(cwd, 'docs', 'plans');
      const racedPath = path.join(dir, 'b-ledger.md');
      const originalReadFileSync = fs.readFileSync;
      fs.readFileSync = (p, ...rest) => {
        if (p === racedPath) {
          fs.rmSync(racedPath);
          const err = new Error('ENOENT: no such file or directory');
          err.code = 'ENOENT';
          throw err;
        }
        return originalReadFileSync(p, ...rest);
      };
      try {
        assert.match(sl.findOpenLedger(cwd), /ledger: 1 open/);
      } finally {
        fs.readFileSync = originalReadFileSync;
      }
    },
  );
});

// Drift guard: findOpenLedger hardcodes cells[4] as the Status column of the
// 5-column `| # | Phase | Item | Status | Resolution |` table documented as
// the canonical ledger shape in skills/ledger/SKILL.md (a file this module
// never reads). If that table's column order ever changes there with no
// mechanical link back to this assumption, the statusline's ledger segment
// would silently break or miscount — this test fails loudly instead.
test('findOpenLedger cells[4] assumption matches the documented ledger table shape in skills/ledger/SKILL.md', () => {
  const skillDoc = readText(path.join(__dirname, '..', 'plugin', 'skills', 'ledger', 'SKILL.md'));
  const headerLine = skillDoc.split('\n').find((l) => {
    const t = l.trim();
    return t.startsWith('| #') && t.includes('Status');
  });
  assert.ok(headerLine, 'expected to find the "| # | Phase | Item | Status | Resolution |" header in skills/ledger/SKILL.md');
  const cells = headerLine.split('|').map((c) => c.trim());
  assert.strictEqual(cells[4], 'Status', 'findOpenLedger hardcodes cells[4] as the Status column — this must match the documented table shape');
});

function withSpecs(files, fn) {
  return withFixtureDir('ct-specs-', ['specs'], files, fn);
}

test('findActiveSpec returns spec: NNN for a specs/ file with a 3+ digit numeric prefix', () => {
  withSpecs({ '042-something.md': '# content' }, (cwd) => {
    assert.strictEqual(sl.findActiveSpec(cwd), 'spec: 042');
  });
});

test('findActiveSpec returns null when specs/ is empty', () => {
  withSpecs({}, (cwd) => {
    assert.strictEqual(sl.findActiveSpec(cwd), null);
  });
});

test('findActiveSpec returns null when specs/ does not exist', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-nospecs-'));
  try {
    assert.strictEqual(sl.findActiveSpec(cwd), null);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// Regression: findActiveSpec used to inspect only the single newest-mtime
// entry; an unrelated non-numerically-prefixed file (scratch notes, etc.)
// with a newer mtime hid an actually-active, correctly-numbered spec sitting
// right behind it instead of the function continuing down the sorted list.
test('findActiveSpec skips a newer non-numerically-prefixed file and finds an older numbered spec behind it', () => {
  withSpecs(
    {
      '042-real-feature.md': '# real spec',
      'notes.md': '# scratch notes, touched more recently',
    },
    (cwd) => {
      const dir = path.join(cwd, 'specs');
      const older = new Date(Date.now() - 60_000);
      const newer = new Date();
      fs.utimesSync(path.join(dir, '042-real-feature.md'), older, older);
      fs.utimesSync(path.join(dir, 'notes.md'), newer, newer);
      assert.strictEqual(sl.findActiveSpec(cwd), 'spec: 042');
    },
  );
});

// Regression: findActiveSpec's per-file fs.statSync call used to live inside
// the same outer try/catch as fs.readdirSync — other claude-tweaks skills
// concurrently create/archive spec files, so one file becoming unreadable
// between the directory listing and this loop reaching it (a real race)
// made the whole function return null, discarding a still-valid older spec.
test('findActiveSpec skips a file raced out between readdir and stat, instead of discarding every other entry', () => {
  withSpecs(
    {
      '010-older.md': '# older, still-valid spec',
      '099-newer.md': '# newer spec, about to be raced out mid-loop',
    },
    (cwd) => {
      const dir = path.join(cwd, 'specs');
      const racedPath = path.join(dir, '099-newer.md');
      const newer = new Date();
      const older = new Date(Date.now() - 60_000);
      fs.utimesSync(racedPath, newer, newer);
      fs.utimesSync(path.join(dir, '010-older.md'), older, older);

      const originalStatSync = fs.statSync;
      fs.statSync = (p, ...rest) => {
        if (p === racedPath) {
          fs.rmSync(racedPath);
          const err = new Error('ENOENT: no such file or directory');
          err.code = 'ENOENT';
          throw err;
        }
        return originalStatSync(p, ...rest);
      };
      try {
        assert.strictEqual(sl.findActiveSpec(cwd), 'spec: 010');
      } finally {
        fs.statSync = originalStatSync;
      }
    },
  );
});

test('end-to-end: real Claude Code schema renders model + context', () => {
  const out = runStatusline(
    {
      model: { id: 'claude-sonnet-5', display_name: 'Sonnet 5' },
      context_window: { used_percentage: 18, context_window_size: 200000 },
    },
    { NO_COLOR: '1' },
  );
  assert.ok(out.includes('Sonnet 5'), `missing model: ${out}`);
  assert.ok(out.includes('ctx: 18%'), `missing ctx: ${out}`);
});

test('end-to-end: project segment renders before model', () => {
  const out = runStatusline(
    {
      workspace: { project_dir: '/Users/x/Code/claude-tweaks' },
      model: { display_name: 'Sonnet 5' },
    },
    { NO_COLOR: '1' },
  );
  assert.ok(stripLinks(out).startsWith('claude-tweaks'), `expected project first: ${out}`);
  assert.ok(out.includes('Sonnet 5'), `missing model: ${out}`);
});

test('end-to-end: rate_limits flow through to sess/week segments', () => {
  const sec = Math.floor(Date.now() / 1000);
  const out = runStatusline(
    {
      model: { display_name: 'Sonnet 5' },
      rate_limits: {
        five_hour: { used_percentage: 42, resets_at: sec + 3 * 3600 },
        seven_day: { used_percentage: 71, resets_at: sec + 4 * 86400 },
      },
    },
    { NO_COLOR: '1' },
  );
  assert.ok(out.includes('sess: 42%'), `missing sess: ${out}`);
  assert.ok(out.includes('week: 71%'), `missing week: ${out}`);
});

test('end-to-end: effort segment renders when level is set', () => {
  const out = runStatusline(
    { model: { display_name: 'Sonnet 5' }, effort: { level: 'high' } },
    { NO_COLOR: '1' },
  );
  assert.ok(out.includes('eff: high'), `missing eff: ${out}`);
});

test('end-to-end: empty input does not crash', () => {
  const out = runStatusline({}, { NO_COLOR: '1' });
  assert.ok(typeof out === 'string');
});

test('end-to-end: project segment is always present, even with empty input', () => {
  const out = runStatusline({}, { NO_COLOR: '1' });
  // Derived independently of the implementation (not via resolveMainProjectDir)
  // so this stays a real regression check: when the test itself runs from
  // inside a linked worktree, the expected name is the main checkout's, not
  // the worktree folder's.
  const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
  const absCommonDir = path.isAbsolute(commonDir) ? commonDir : path.resolve(process.cwd(), commonDir);
  const expectedName = path.basename(path.dirname(absCommonDir));
  assert.ok(stripLinks(out).startsWith(expectedName), `expected project segment: ${out}`);
});

test('end-to-end: transcript_path under .claude-accounts renders the acct segment at the end', () => {
  const out = runStatusline(
    {
      model: { display_name: 'Sonnet 5' },
      transcript_path: '/Users/x/.claude-accounts/personal-gmail/projects/foo/session.jsonl',
    },
    { NO_COLOR: '1' },
  );
  assert.ok(out.endsWith('acct: personal-gmail'), `expected acct segment at end: ${out}`);
});

test('end-to-end: default ~/.claude layout renders the acct segment from ~/.claude.json', () => {
  const out = runStatusline(
    { model: { display_name: 'Sonnet 5' }, transcript_path: '/Users/x/.claude/projects/foo/s.jsonl' },
    { NO_COLOR: '1' },
    (home) =>
      fs.writeFileSync(
        path.join(home, '.claude.json'),
        JSON.stringify({ oauthAccount: { emailAddress: 'a@outlook.com' } }),
      ),
  );
  assert.ok(out.endsWith('acct: a@outlook.com'), `expected acct segment at end: ${out}`);
});

test('end-to-end: the cost segment sits just before acct:', () => {
  const seedHome = (home) =>
    fs.writeFileSync(
      path.join(home, '.claude.json'),
      JSON.stringify({ oauthAccount: { emailAddress: 'a@example.com' } }),
    );
  const base = { session_id: 'sess-1', transcript_path: '/Users/x/.claude/projects/foo/s.jsonl' };
  const out = runStatusline({ ...base, cost: { total_cost_usd: 0.42 } }, { NO_COLOR: '1' }, seedHome);
  assert.ok(stripLinks(out).endsWith('$0.42  acct: a@example.com'), `expected cost before acct: ${out}`);
  const zero = runStatusline({ ...base, cost: { total_cost_usd: 0 } }, { NO_COLOR: '1' }, seedHome);
  assert.ok(!zero.includes('$'), `zero cost must render nothing: ${zero}`);
});

// A per-session segment file another tool writes (cc-router's agent writes
// `hub ✓`): ~/.claude/statusline/segments/<session id>.json.
function writeSessionSegment(home, id, seg) {
  const dir = path.join(home, '.claude', 'statusline', 'segments');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), typeof seg === 'string' ? seg : JSON.stringify(seg));
}

function withSegmentHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sl-seg-'));
  try {
    return fn(home);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const SEG_AT = Date.parse('2026-11-08T12:00:00Z');
const HUB_LINK = '\x1b]8;;http://127.0.0.1:4100/s/sess-1\x1b\\hub ✓\x1b]8;;\x1b\\';

test('renderSessionSegment: shows text while at + ttl_s is in the future, stale_text after', () => {
  withSegmentHome((home) => {
    writeSessionSegment(home, 'sess-1', { text: HUB_LINK, stale_text: 'hub offline', at: '2026-11-08T12:00:00Z', ttl_s: 10 });
    const input = { session_id: 'sess-1' };
    assert.strictEqual(sl.renderSessionSegment(input, { home, now: SEG_AT + 9_999 }), HUB_LINK);
    assert.strictEqual(sl.renderSessionSegment(input, { home, now: SEG_AT + 10_000 }), 'hub offline');
  });
});

test('renderSessionSegment: absent when there is no file, no session id, or an unsafe id', () => {
  withSegmentHome((home) => {
    writeSessionSegment(home, 'sess-1', { text: 'hub off', stale_text: 'hub off', at: '2026-11-08T12:00:00Z', ttl_s: 10 });
    for (const input of [{}, { session_id: 'other' }, { session_id: '' }, { session_id: 42 }, { session_id: '../segments/sess-1' }, { session_id: 'sess-1.json' }]) {
      assert.strictEqual(sl.renderSessionSegment(input, { home, now: SEG_AT }), null, JSON.stringify(input));
    }
  });
});

test('renderSessionSegment: a malformed file renders nothing, and an unreadable at or ttl_s reads as stale', () => {
  const cases = [
    ['not json', null],
    [JSON.stringify(null), null],
    [JSON.stringify({ stale_text: 'hub offline', at: '2026-11-08T12:00:00Z', ttl_s: 10 }), null],
    [JSON.stringify({ text: 'hub ✓', at: '2026-11-08T12:00:00Z', ttl_s: 10 }), null],
    [JSON.stringify({ text: 'hub ✓', stale_text: 'hub offline', at: 'yesterday', ttl_s: 10 }), 'hub offline'],
    [JSON.stringify({ text: 'hub ✓', stale_text: 'hub offline', at: '2026-11-08T12:00:00Z', ttl_s: '10' }), 'hub offline'],
  ];
  withSegmentHome((home) => {
    for (const [body, want] of cases) {
      writeSessionSegment(home, 'sess-1', body);
      assert.strictEqual(sl.renderSessionSegment({ session_id: 'sess-1' }, { home, now: SEG_AT }), want, body);
    }
  });
});

test('renderSessionSegment: refuses text with control characters beyond OSC 8 links and SGR, or over 40 columns', () => {
  // The SGR case expects color kept, so an ambient NO_COLOR (set on the Windows runner) must not apply.
  const orig = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    withSegmentHome((home) => {
      const seg = (text) => ({ text, stale_text: 'hub offline', at: '2026-11-08T12:00:00Z', ttl_s: 10 });
      // The last two hide controls inside an OSC 8 link's body, which a terminal can read as ending the link early.
      for (const text of ['hub\x1b[2J', 'hub\r✓', 'hub\x07', 'x'.repeat(41), '\x1b]8;;\x18\u009b2J\x07x\x1b]8;;\x07', '\x1b]8;;http://h/\x1a\x07x\x1b]8;;\x07']) {
        writeSessionSegment(home, 'sess-1', seg(text));
        assert.strictEqual(sl.renderSessionSegment({ session_id: 'sess-1' }, { home, now: SEG_AT }), null, JSON.stringify(text));
      }
      for (const text of ['x'.repeat(40), '\x1b[33mhub ✓\x1b[0m', '\x1b]8;;http://h/s/1\x07hub ✓\x1b]8;;\x07']) {
        writeSessionSegment(home, 'sess-1', seg(text));
        assert.strictEqual(sl.renderSessionSegment({ session_id: 'sess-1' }, { home, now: SEG_AT }), text, JSON.stringify(text));
      }
    });
  } finally {
    if (orig !== undefined) process.env.NO_COLOR = orig;
  }
});

test('renderSessionSegment: NO_COLOR strips SGR but keeps the link', () => {
  const orig = process.env.NO_COLOR;
  try {
    process.env.NO_COLOR = '1';
    withSegmentHome((home) => {
      writeSessionSegment(home, 'sess-1', { text: `\x1b[32m${HUB_LINK}\x1b[0m`, stale_text: 'hub offline', at: '2026-11-08T12:00:00Z', ttl_s: 10 });
      assert.strictEqual(sl.renderSessionSegment({ session_id: 'sess-1' }, { home, now: SEG_AT }), HUB_LINK);
    });
  } finally {
    if (orig === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = orig;
  }
});

test('end-to-end: the session segment sits after acct:', () => {
  const seedHome = (home) => {
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'a@example.com' } }));
    writeSessionSegment(home, 'sess-1', { text: 'hub off', stale_text: 'hub off', at: new Date().toISOString(), ttl_s: 10 });
  };
  const base = { session_id: 'sess-1', transcript_path: '/Users/x/.claude/projects/foo/s.jsonl' };
  const out = runStatusline({ ...base, cost: { total_cost_usd: 0.42 } }, { NO_COLOR: '1' }, seedHome);
  assert.ok(stripLinks(out).endsWith('$0.42  acct: a@example.com  hub off'), `expected the segment after acct: ${out}`);
});

test('end-to-end: NO_COLOR strips ANSI codes even at high context', () => {
  const out = runStatusline(
    { model: { display_name: 'Sonnet 5' }, context_window: { used_percentage: 95 } },
    { NO_COLOR: '1' },
  );
  assert.doesNotMatch(out, /\x1b\[/);
});

// #1793 AC1: renderPorts and its toplevel-resolution helper.
function tmpRepoDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function writeRegistry(home, leases) {
  fs.mkdirSync(path.join(home, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude-tweaks', 'ports.json'), JSON.stringify({ version: 1, leases }));
}

test('nearestGitToplevel: walks up from a subdirectory to the nearest .git entry (dir), and returns null with none found', () => {
  const repoDir = tmpRepoDir('ct-sl-toplevel-');
  fs.mkdirSync(path.join(repoDir, '.git'));
  const sub = path.join(repoDir, 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  assert.strictEqual(sl.nearestGitToplevel(sub), repoDir);
  assert.strictEqual(sl.nearestGitToplevel(repoDir), repoDir);

  const bare = tmpRepoDir('ct-sl-nogit-');
  assert.strictEqual(sl.nearestGitToplevel(bare), null);
});

test('nearestGitToplevel: a linked worktree\'s `.git` FILE (not directory) is treated the same as a `.git` directory', () => {
  const wt = tmpRepoDir('ct-sl-wt-');
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /somewhere/.git/worktrees/wt\n');
  assert.strictEqual(sl.nearestGitToplevel(wt), wt);
});

test('renderPorts: no registry file at all -> empty string', () => {
  const home = tmpRepoDir('ct-sl-ports-home-');
  const repoDir = tmpRepoDir('ct-sl-ports-repo-');
  fs.mkdirSync(path.join(repoDir, '.git'));
  assert.strictEqual(sl.renderPorts(repoDir, { home }), '');
});

test('renderPorts: registry exists but carries no lease for this checkout -> empty string', () => {
  const home = tmpRepoDir('ct-sl-ports-home-');
  const repoDir = tmpRepoDir('ct-sl-ports-repo-');
  fs.mkdirSync(path.join(repoDir, '.git'));
  writeRegistry(home, { 20000: { path: '/some/other/checkout', project: 'x', services: ['web'], leased: 'x' } });
  assert.strictEqual(sl.renderPorts(repoDir, { home }), '');
});

// AC1
test('renderPorts: a lease for this checkout\'s toplevel renders :{base} between git and rate-limit segments', () => {
  const home = tmpRepoDir('ct-sl-ports-home-');
  const repoDir = tmpRepoDir('ct-sl-ports-repo-');
  fs.mkdirSync(path.join(repoDir, '.git'));
  const real = fs.realpathSync(repoDir);
  writeRegistry(home, { 20010: { path: real, project: 'x', services: ['web', 'api'], leased: 'x' } });
  assert.strictEqual(sl.renderPorts(repoDir, { home }), ':20010');

  // Same lease found from a subdirectory of the checkout (toplevel walk-up).
  const sub = path.join(repoDir, 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  assert.strictEqual(sl.renderPorts(sub, { home }), ':20010');
});

// AC1's linked-worktree fixture — a `.git` FILE, not directory — proving the
// toplevel resolution matches the registry's own realpath normalization.
test('renderPorts: a linked-worktree fixture (.git FILE) resolves the same lease its own realpath was registered under', () => {
  const home = tmpRepoDir('ct-sl-ports-home-');
  const wt = tmpRepoDir('ct-sl-ports-wt-');
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /somewhere/.git/worktrees/wt\n');
  const real = fs.realpathSync(wt);
  writeRegistry(home, { 20020: { path: real, project: 'x', services: ['web'], leased: 'x' } });
  assert.strictEqual(sl.renderPorts(wt, { home }), ':20020');
});

// AC1: unreadable/corrupt registry, or a missing `ports` module, degrades to
// byte-identical (empty) output — never throws.
test('renderPorts: a corrupt registry degrades to empty string rather than throwing', () => {
  const home = tmpRepoDir('ct-sl-ports-home-');
  const repoDir = tmpRepoDir('ct-sl-ports-repo-');
  fs.mkdirSync(path.join(repoDir, '.git'));
  fs.mkdirSync(path.join(home, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude-tweaks', 'ports.json'), '{ not json');
  assert.doesNotThrow(() => assert.strictEqual(sl.renderPorts(repoDir, { home }), ''));
});

test('renderPorts: no toplevel resolvable (no cwd, no ancestor .git) -> empty string', () => {
  const home = tmpRepoDir('ct-sl-ports-home-');
  const bare = tmpRepoDir('ct-sl-ports-bare-');
  assert.strictEqual(sl.renderPorts(bare, { home }), '');
});

// AC1's "between the git and rate-limit segments" placement is proven by
// construction (main()'s segments array literally inserts renderPorts(cwd)
// directly after renderGit(cwd)) rather than by an end-to-end subprocess
// spawn: the ordering is a property of main()'s segments array, not of
// anything a spawned child would add.

// --- one child process per render (#5266) ---

const STATUS_LAUNCH = { fn: 'execFileSync', file: 'git', args: ['--no-optional-locks', 'status', '--porcelain', '-b'] };

test('render launches exactly one child process — git status, no shell — in a main checkout and a linked worktree', () => {
  withRepo('git@github.com:owner/repo.git', (dir) => {
    const wt = path.join(path.dirname(dir), 'one-spawn-wt');
    execFileSync('git', ['worktree', 'add', '-q', wt, '-b', 'feature'], { cwd: dir });
    for (const where of [dir, wt]) {
      const { launches } = recordLaunches((fresh) => {
        fresh.renderProject({ workspace: { project_dir: where } }, where);
        return fresh.renderGit(where);
      });
      assert.deepStrictEqual(launches, [STATUS_LAUNCH], where);
    }
  });
});

test('renderGit: unborn branch renders its name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sl-unborn-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'trunk'], { cwd: dir });
    assert.strictEqual(renderGitPlain(dir), 'trunk');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('renderGit: detached HEAD renders nothing', () => {
  withRepo(null, (dir) => {
    execFileSync('git', ['checkout', '-q', '--detach'], { cwd: dir });
    assert.strictEqual(renderGitPlain(dir), null);
  });
});

test('renderGit: a directory that is not a repo renders nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sl-norepo-'));
  try {
    assert.strictEqual(renderGitPlain(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rendered project and git segments are byte-identical with the fast paths on and off, and nothing runs through a shell', () => {
  const GH = 'https://github.com/o/parity.git';
  const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const inTmp = (prefix, setup) => (run) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    try {
      setup(dir);
      return run(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const cases = [
    ['main checkout', (run) => withRepo(GH, run)],
    ['linked worktree', (run) => withWorktrees((f) => {
      git(['remote', 'add', 'origin', GH], f.main);
      return run(f.wt);
    })],
    // Pins the name and the link only: the project segment for a submodule checkout resolves to the superproject's .git/modules on both paths.
    ['submodule checkout', (run) => withWorktrees((f) => run(f.sub))],
    ['no origin', (run) => withRepo(null, run)],
    ['non-GitHub origin', (run) => withRepo('git@gitlab.com:o/r.git', run)],
    ['origin only in an included file', (run) => withRepo(null, (dir) => {
      fs.writeFileSync(path.join(dir, '.git', 'extra'), `[remote "origin"]\n\turl = ${GH}\n`);
      // A local non-GitHub url BEFORE the include: git answers the included GitHub url (last wins), a reader that ignores the include would answer this one.
      // The relative path resolves against .git/; an absolute win32 path would hold backslashes, which git reads as escapes.
      appendCfg(dir, '[remote "origin"]\n\turl = https://gitlab.com/o/main.git\n[include]\n\tpath = extra\n');
      return run(dir);
    })],
    ['origin with a quoted value', (run) => withRepo(null, (dir) => {
      appendCfg(dir, '[remote "origin"]\n\turl = "https://github.com/o/q.git"\n');
      return run(dir);
    })],
    ['detached HEAD', (run) => withRepo(GH, (dir) => {
      git(['checkout', '-q', '--detach'], dir);
      return run(dir);
    })],
    ['unborn branch', inTmp('ct-sl-parity-unborn-', (dir) => {
      git(['init', '-q', '-b', 'trunk'], dir);
      git(['remote', 'add', 'origin', GH], dir);
    })],
    ['dirty tree', (run) => withRepo(GH, (dir) => {
      fs.writeFileSync(path.join(dir, 'untracked.txt'), 'x\n');
      return run(dir);
    })],
    ['not a repo', inTmp('ct-sl-parity-norepo-', () => {})],
  ];
  const compared = [];
  const { launches } = recordLaunches((m) => {
    for (const [label, build] of cases) {
      build((dir) => {
        const input = { workspace: { project_dir: dir } };
        const on = `${m.renderProject(input, dir)}|${m.renderGit(dir)}`;
        // The off side runs in its own recording so each case proves it reached git for the origin url.
        const offRun = recordLaunches((fresh) => `${fresh.renderProject(input, dir, { fast: false })}|${fresh.renderGit(dir)}`);
        assert.strictEqual(on, offRun.result, label);
        assert.deepStrictEqual(offRun.launches.filter((l) => l.file === ORIGIN_LAUNCH.file && l.fn === ORIGIN_LAUNCH.fn && l.args.join(' ') === ORIGIN_LAUNCH.args.join(' ')), [ORIGIN_LAUNCH], label);
        compared.push(label);
      });
    }
  });
  assert.strictEqual(compared.length, 11);
  assert.deepStrictEqual(launches.filter((l) => l.fn === 'exec' || l.fn === 'execSync'), []);
});
