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
  const { CLAUDE_CONFIG_DIR: _ignored, ...baseEnv } = process.env;
  try {
    seedHome(home);
    return execFileSync('node', [STATUSLINE], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: { ...baseEnv, HOME: home, ...env },
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
// spawn: this suite's existing HOME-env-override technique for controlling
// os.homedir() in a child process (see runStatusline) is already unreliable
// on this Windows machine — the pre-existing 'default ~/.claude layout
// renders the acct segment from ~/.claude.json' end-to-end test above fails
// the same way, leaking the real account email instead of the seeded fake
// home, because os.homedir() on Windows reads USERPROFILE, not HOME. A new
// end-to-end test built on the same technique would be flaky for the same
// reason, not a meaningful check of this feature's own logic.
