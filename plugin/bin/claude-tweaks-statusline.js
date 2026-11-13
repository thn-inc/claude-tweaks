#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { execSync, execFileSync } = require('child_process');
const color = require('./lib/color');
const { splitLedgerRow } = require('./lib/wrap-up/ledger-cells');

const SEPARATOR = '  ';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    const onData = (chunk) => (data += chunk);
    // finish() is reached either by stdin actually ending, or by the 50ms
    // fallback timer. Either way it must detach every listener and pause the
    // stream — without this, a harness that doesn't promptly close the write
    // end of piped stdin leaves data/end/error listeners attached, which
    // keeps the stream (and the event loop) referenced forever even though
    // the process already wrote its output and has nothing left to do.
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', finish);
      process.stdin.removeListener('error', finish);
      if (typeof process.stdin.pause === 'function') process.stdin.pause();
      resolve(data);
    };
    const timer = setTimeout(finish, 50);
    process.stdin.on('data', onData);
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}

function formatDuration(seconds) {
  // Math.floor (not round): the bucket itself is already chosen from the
  // raw, un-rounded `seconds` value, so a rounded-up display can overshoot
  // its own bucket's boundary — e.g. formatDuration(3599) would round to
  // "60m" despite being selected by the `< 3600` (minutes) branch. Flooring
  // guarantees the displayed number can never reach the next unit's
  // boundary, since `seconds` is strictly less than that boundary by
  // construction of the if-chain above.
  if (seconds < 60) return null;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function colorByPct(pct, text) {
  if (pct >= 90) return color.red(text);
  if (pct >= 75) return color.yellow(text);
  return text;
}

function renderModel(input) {
  const m = input.model;
  if (!m) return null;
  if (typeof m === 'string') return m;
  return m.display_name || m.id || null;
}

// EnterWorktree pivots a session's workspace.project_dir to the worktree's
// own path once inside it, so the naive basename shows the worktree folder
// instead of the real project. A linked worktree's `.git` is a plain text
// file (`gitdir: ...`), not a directory — that's how git itself tells a
// worktree checkout apart from the main one, with no `git` invocation
// needed for the common (non-worktree) case.
//
// commonDirFromFs reads that file the way git does (`.git` -> `gitdir:` ->
// `commondir`) so a linked worktree costs no spawn. It returns the realpath of
// the common dir — what `git rev-parse --git-common-dir` prints — or null
// meaning "ask git": GIT_DIR / GIT_COMMON_DIR set (even empty) redirect git's
// own lookup, and any file that is missing, unparseable or unreadable could
// mean a shape this reader does not model.
//
// The parse mirrors git: read_gitfile strips only trailing \n / \r from the
// whole file, requires it to start with exactly `gitdir: `, and resolves a
// relative path against the PHYSICAL directory holding the file;
// get_common_dir_noenv strips only trailing \n / \r from `commondir` (spaces
// are part of the path). Git also refuses a gitfile whose target is not a valid
// repository (is_git_directory: HEAD in the gitdir, objects/ and refs/ in the
// common dir), an empty path, and a zero-byte commondir. Each is null here, so
// git decides.
function commonDirFromFs(dir, env = process.env) {
  if (env.GIT_DIR !== undefined || env.GIT_COMMON_DIR !== undefined || env.GIT_OBJECT_DIRECTORY !== undefined) return null;
  try {
    const gitFile = fs.readFileSync(path.join(dir, '.git'), 'utf8').replace(/[\r\n]+$/, '');
    if (!gitFile.startsWith('gitdir: ')) return null;
    const target = gitFile.slice('gitdir: '.length);
    if (!target || target.includes('\n')) return null;
    // read_gitfile returns the REALPATH of the gitdir; a relative commondir
    // resolves against that, not against a symlinked spelling of it.
    const gitdir = fs.realpathSync(path.resolve(fs.realpathSync(dir), target));
    let common;
    try {
      const content = fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').replace(/[\r\n]+$/, '');
      if (!content) return null; // a zero-byte commondir makes git die
      common = path.resolve(gitdir, content);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') return null;
      common = gitdir;
    }
    // Plain JS realpath, never .native / canonicalRealpath: git resolves
    // symlinks but keeps the input's letter case, as this does.
    const real = fs.realpathSync(common);
    // is_git_directory, as read_gitfile applies it: a valid HEAD in the gitdir
    // and searchable objects/ + refs/ directories in the common dir, else git
    // refuses the gitfile ("does not point to a valid repository") — so git
    // decides.
    if (!isValidHead(path.join(gitdir, 'HEAD'))) return null;
    if (!isSearchableDir(path.join(real, 'objects'))) return null;
    if (!isSearchableDir(path.join(real, 'refs'))) return null;
    return real;
  } catch {
    return null;
  }
}

// validate_headref: a regular file (not a symlink) whose content, minus
// trailing \r / \n, is `ref: refs/...` or a full lowercase hex object id.
function isValidHead(file) {
  try {
    if (!fs.lstatSync(file).isFile()) return false;
    const head = fs.readFileSync(file, 'utf8').replace(/[\r\n]+$/, '');
    return head.startsWith('ref: refs/') || /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head);
  } catch {
    return false;
  }
}

// git checks objects/ and refs/ with access(X_OK).
function isSearchableDir(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function resolveMainProjectDir(dir, opts = {}) {
  let stat;
  try {
    stat = fs.statSync(path.join(dir, '.git'));
  } catch {
    return dir;
  }
  if (stat.isDirectory()) return dir;
  if (opts.fast !== false) {
    const common = commonDirFromFs(dir, opts.env);
    if (common) return path.dirname(common);
  }
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      cwd: dir,
      windowsHide: true,
    }).trim();
    if (!commonDir) return dir;
    const absCommonDir = path.isAbsolute(commonDir) ? commonDir : path.resolve(dir, commonDir);
    return path.dirname(absCommonDir);
  } catch {
    return dir;
  }
}

// Normalizes an origin remote URL to the repo's browse URL — the three forms
// git actually stores (scp-like ssh, ssh://, https), with or without the
// `.git` suffix. Anything not github.com, or not owner/repo shaped, is null:
// the glyph's presence is the "GitHub connected" indicator, so a non-GitHub
// remote must render nothing rather than a dead link.
function githubRepoUrl(remoteUrl) {
  if (typeof remoteUrl !== 'string') return null;
  const trimmed = remoteUrl.trim();
  const m =
    trimmed.match(/^git@github\.com:(.+?)(?:\.git)?\/?$/) ||
    trimmed.match(/^ssh:\/\/git@github\.com\/(.+?)(?:\.git)?\/?$/) ||
    trimmed.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?\/?$/);
  if (!m) return null;
  const repoPath = m[1];
  if (repoPath.split('/').length !== 2 || repoPath.split('/').some((p) => !p)) return null;
  return `https://github.com/${repoPath}`;
}

// originUrlFromConfig answers `git config --get remote.origin.url` from the
// repo-local .git/config alone, no spawn. It returns the last origin `url`, or
// null meaning "ask git": anything that could make git's answer differ from this
// plain read — an env that redirects git's config or repo lookup, an include, a
// config.worktree, a header or key line shape this parser does not model (git
// allows only space and tab as whitespace there), a value with quote or escape
// syntax anywhere, an origin url with comment syntax, an unreadable config (which
// is also what a `.git` that is not a directory yields) — is null, as is a config
// with no origin url.
function originUrlFromConfig(mainDir, env = process.env) {
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_CONFIG')) return null;
  }
  if (env.GIT_DIR !== undefined) return null;
  if (env.GIT_COMMON_DIR !== undefined) return null;
  try {
    const gitDir = path.join(mainDir, '.git');
    try {
      fs.statSync(path.join(gitDir, 'config.worktree'));
      return null;
    } catch {
      // absent — the common case
    }
    let url = null;
    let inOrigin = false;
    let inSection = false;
    for (const line of fs.readFileSync(path.join(gitDir, 'config'), 'utf8').split(/\r?\n/)) {
      if (/^[ \t]*$/.test(line) || /^[ \t]*[#;]/.test(line)) continue;
      const header = line.match(/^[ \t]*\[([^\]]*)\][ \t]*(.*)$/);
      if (header) {
        if (header[2]) return null;
        const inside = header[1].match(/^([A-Za-z0-9-]+)(?:[ \t]+"([^"\\]*)")?$/);
        if (!inside) return null;
        const name = inside[1].toLowerCase();
        if (name === 'include') return null;
        if (name === 'includeif') return null;
        inSection = true;
        inOrigin = name === 'remote' && inside[2] === 'origin';
        continue;
      }
      const kv = line.match(/^[ \t]*([A-Za-z][A-Za-z0-9-]*)[ \t]*(?:=[ \t]*(.*))?$/);
      if (!kv) return null;
      // git accepts a key line before any section; ask git anyway (conservative).
      if (!inSection) return null;
      // Any value, in any section: git rejects a bad quote or escape for the whole
      // file, and trims trailing \v / \f that this reader would keep.
      if (kv[2] !== undefined && /["\\\v\f]/.test(kv[2])) return null;
      if (!inOrigin || kv[1].toLowerCase() !== 'url') continue;
      if (kv[2] === undefined) return null;
      if (/[#;]/.test(kv[2])) return null;
      url = kv[2].replace(/[ \t]+$/, '');
    }
    return url || null;
  } catch {
    return null;
  }
}

function readOriginRemote(dir, opts = {}) {
  if (opts.fast !== false) {
    const fast = originUrlFromConfig(dir, opts.env);
    if (fast) return fast;
  }
  try {
    const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      cwd: dir,
      windowsHide: true,
    }).trim();
    return url || null;
  } catch {
    return null;
  }
}

// U+F09B, the Nerd Font octocat — written as an escape because the literal
// is invisible in most editors. Renders as a tofu box in unpatched fonts —
// a deliberate trade for the real GitHub mark on Nerd Font terminals.
const GITHUB_GLYPH = '\uf09b';

// Cmd/Ctrl+click targets: the name opens the project folder in Finder/Explorer
// (pathToFileURL handles this host's path shape, Windows drive letters
// included), the glyph — present only when origin is a GitHub remote — opens
// the repo page. Both resolve against the main checkout, matching the name.
function renderProject(input, fallbackCwd) {
  const ws = input.workspace || {};
  const dir = ws.project_dir || ws.current_dir || input.cwd || fallbackCwd;
  if (!dir || typeof dir !== 'string') return null;
  const mainDir = resolveMainProjectDir(dir);
  const name = path.basename(mainDir);
  if (!name) return null;
  let linked = name;
  try {
    // Trailing slash matters: a directory file:// URL without it makes macOS
    // reveal the folder selected in its parent window instead of opening the
    // folder itself.
    linked = color.link(`${pathToFileURL(mainDir).href}/`, name);
  } catch {
    /* unconvertible path — keep the plain name */
  }
  const repoUrl = githubRepoUrl(readOriginRemote(mainDir));
  return repoUrl ? `${linked} ${color.link(repoUrl, GITHUB_GLYPH)}` : linked;
}

function renderContext(input) {
  const cw = input.context_window;
  if (!cw) return null;
  let pct = cw.used_percentage;
  if (typeof pct !== 'number') {
    const used = cw.total_input_tokens;
    const total = cw.context_window_size;
    if (typeof used === 'number' && typeof total === 'number' && total > 0) {
      pct = (used / total) * 100;
    } else {
      return null;
    }
  }
  const rounded = Math.round(pct);
  return colorByPct(pct, `ctx: ${rounded}%`);
}

function renderEffort(input) {
  const level = input.effort && input.effort.level;
  if (!level || level === 'default' || level === 'unset') return null;
  return `eff: ${level}`;
}

// The figure is Claude Code's own list-price estimate from stdin (not a bill;
// it resets on /clear). Thresholds are decided on the raw value, not the rounded one.
function renderCost(input) {
  const usd = input.cost && input.cost.total_cost_usd;
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0.005) return null;
  if (usd < 10) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(1)}`;
  return `$${usd.toFixed(0)}`;
}

// `git --no-optional-locks status --porcelain -b` returns the branch and dirty
// status in one call instead of two separate `symbolic-ref` + `status
// --porcelain` spawns.
// Header line shapes: "## main", "## main...origin/main [ahead 1]",
// "## No commits yet on main" (fresh repo, no commits), "## HEAD (no
// branch)" (detached HEAD — no branch to report, matching the old
// symbolic-ref failure behavior). `--no-optional-locks` keeps this read-only
// probe from rewriting the index under `index.lock`, which otherwise races the
// session's own `git add`/`commit`.
function parseStatusBranch(output) {
  const lines = output.split('\n').filter((l) => l.length > 0);
  if (!lines.length || !lines[0].startsWith('## ')) return { branch: null, dirty: false };
  const header = lines[0].slice(3);
  let branch;
  if (header.startsWith('HEAD (no branch)')) {
    branch = null;
  } else if (header.startsWith('No commits yet on ')) {
    branch = header.slice('No commits yet on '.length).split(' ')[0];
  } else {
    branch = header.split('...')[0].split(' ')[0];
  }
  return { branch: branch || null, dirty: lines.length > 1 };
}

function renderGit(cwd) {
  try {
    const output = execSync('git --no-optional-locks status --porcelain -b', { // git-path-read: not a path list (branch and dirty flag only)
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      cwd,
      windowsHide: true,
    });
    const { branch, dirty } = parseStatusBranch(output);
    if (!branch) return null;
    return dirty ? `${branch}${color.yellow('●')}` : branch;
  } catch {
    return null;
  }
}

// Spawn-free git-toplevel walk: the nearest ancestor (including `dir`
// itself) carrying a `.git` entry, file or directory alike — a linked
// worktree's `.git` is a FILE pointing at the real gitdir, but the toplevel
// is still the directory CONTAINING that file, not anything derived from
// where it points. This intentionally does NOT resolve to the main
// checkout (unlike bin/lib/hooks/worktree-detect.js's mainCheckoutRoot): a
// port lease is keyed by each checkout's OWN toplevel — main or worktree
// alike — since that's the same path `git rev-parse --show-toplevel`
// resolves to, and therefore what registry.allocate keys leases on.
function nearestGitToplevel(dir) {
  let cur = path.resolve(dir);
  for (;;) {
    let exists = false;
    try {
      fs.statSync(path.join(cur, '.git'));
      exists = true;
    } catch { /* not here — keep walking up */ }
    if (exists) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

// Renders `:{base}` for the port block leased to this cwd's checkout, `''`
// when there is none (or none can be determined). No `execFileSync` for
// git, no lock acquisition — the statusline runs on every prompt render, so
// this must stay spawn-free and side-effect-free beyond what the file
// already does. The whole thing — including the `require` itself, so an
// older wrapper install missing the ports module degrades identically to a
// present-but-unreadable registry — is one try/catch.
function renderPorts(cwd, { home = os.homedir() } = {}) {
  try {
    const toplevel = nearestGitToplevel(cwd);
    if (!toplevel) return '';
    const real = fs.realpathSync(toplevel);
    // eslint-disable-next-line global-require
    const { readRegistry } = require('./lib/ports/registry');
    const registry = readRegistry({ home });
    const entry = Object.entries((registry && registry.leases) || {}).find(([, lease]) => lease.path === real);
    return entry ? `:${entry[0]}` : '';
  } catch {
    return '';
  }
}

function renderRateLimit(label, period, now) {
  if (!period) return null;
  const pct = period.used_percentage;
  if (typeof pct !== 'number') return null;
  const reset = period.resets_at;
  const remaining = reset ? Math.max(0, reset - Math.floor(now / 1000)) : null;
  const dur = remaining ? formatDuration(remaining) : null;
  const rounded = Math.round(pct);
  const text = dur ? `${label}: ${rounded}% (${dur})` : `${label}: ${rounded}%`;
  return colorByPct(pct, text);
}

function findActiveSpec(cwd) {
  const dir = path.join(cwd, 'specs');
  let dirents;
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md'));
  } catch {
    return null;
  }
  const entries = [];
  for (const e of dirents) {
    try {
      // Per-file stat, not part of the outer try/catch: other claude-tweaks
      // skills concurrently create/archive spec files, so a file that
      // existed at readdir time can legitimately be gone by the time we
      // stat it. Skip that one file instead of discarding every other
      // still-valid entry already collected.
      const stat = fs.statSync(path.join(dir, e.name));
      entries.push({ name: e.name, mtime: stat.mtimeMs });
    } catch {
      continue;
    }
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  // Walk the whole sorted list, not just the newest entry — an unrelated
  // non-numerically-prefixed file (scratch notes, README, etc.) with a
  // newer mtime must not hide an actually-active, correctly-numbered spec
  // sitting right behind it.
  for (const entry of entries) {
    const match = entry.name.match(/^(\d{3,})/);
    if (match) return `spec: ${match[1]}`;
  }
  return null;
}

// cells[4] assumes the 5-column `| # | Phase | Item | Status | Resolution |`
// table documented as the canonical ledger shape in skills/ledger/SKILL.md
// (declared there twice) — this file never reads that doc, so the two are
// linked only by convention. tests/statusline.test.js's own drift-detection
// test reads skills/ledger/SKILL.md directly to catch this assumption going
// stale if that table's column order ever changes.
function findOpenLedger(cwd) {
  const dir = path.join(cwd, 'docs', 'plans');
  let ledgers;
  try {
    ledgers = fs.readdirSync(dir).filter((f) => f.endsWith('-ledger.md'));
  } catch {
    return null;
  }
  if (ledgers.length === 0) return null;
  let openCount = 0;
  for (const f of ledgers) {
    let content;
    try {
      // Per-file read, not part of the outer try/catch: other claude-tweaks
      // skills concurrently create/archive ledger files (e.g. /wrap-up
      // archival), so a file listed by readdir can legitimately be gone by
      // the time we read it. Skip that one file instead of discarding every
      // other still-valid ledger's already-counted rows.
      content = fs.readFileSync(path.join(dir, f), 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      if (!line.startsWith('|')) continue;
      const cells = splitLedgerRow(line).map((c) => c.trim());
      if (cells.length >= 5 && cells[4] === 'open') openCount += 1;
    }
  }
  if (openCount === 0) return null;
  const text = `ledger: ${openCount} open`;
  if (openCount >= 10) return color.red(text);
  if (openCount >= 3) return color.yellow(text);
  return text;
}

// Which config home this session runs from. Claude Code's statusline JSON has
// no account field, so this is inferred: `CLAUDE_CONFIG_DIR` (documented, and
// inherited by the statusline process) wins; else the transcript lives at
// `<config-dir>/projects/<slug>/<id>.jsonl` (either separator); else the
// default `~/.claude`. Returns the dir as written — no normalization, since a
// Windows-shaped path from a Windows session may not resolve on this host.
function resolveConfigDir(input, env, home) {
  const fromEnv = env.CLAUDE_CONFIG_DIR;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.replace(/[\\/]+$/, '');
  const tp = input.transcript_path;
  if (typeof tp === 'string') {
    const match = tp.match(/^(.+?)[\\/]+projects[\\/]+[^\\/]+[\\/]+[^\\/]+\.jsonl$/);
    if (match) return match[1];
  }
  return path.join(home, '.claude');
}

function readOauthEmail(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const email = parsed && parsed.oauthAccount && parsed.oauthAccount.emailAddress;
    return typeof email === 'string' && email ? email : null;
  } catch {
    return null;
  }
}

// Every account gets a label, so a missing segment means "couldn't determine"
// rather than doubling as "you're on the default account". A non-default
// config dir (`CLAUDE_CONFIG_DIR`, `~/.claude-accounts/<slug>`, anything not
// named `.claude`) is labeled by its basename — the user's own chosen name.
// The default `~/.claude` has no such name, so it's labeled by the logged-in
// email from `.claude.json` (looked up in the config dir first, then $HOME —
// observed: `~/.claude/.claude.json` can exist as a stub without
// `oauthAccount` while `~/.claude.json` carries it). No email (API key,
// Bedrock/Vertex, logged out) → null, never a guess.
function renderAccount(input, { env = process.env, home = os.homedir() } = {}) {
  const configDir = resolveConfigDir(input, env, home);
  const slug = configDir.split(/[\\/]+/).filter(Boolean).pop() || '';
  if (slug !== '.claude') return `acct: ${slug}`;
  const email = readOauthEmail(path.join(configDir, '.claude.json')) || readOauthEmail(path.join(home, '.claude.json'));
  return email ? `acct: ${email}` : null;
}

// A generic extension point: another tool can show one segment for a session
// by writing `~/.claude/statusline/segments/<session id>.json`, shaped
// `{ text, stale_text, at, ttl_s }` (cc-router's agent writes `hub ✓` there).
// `text` shows while `at` + `ttl_s` seconds is in the future and `stale_text`
// after, so a writer that stops reads as stale rather than frozen. Always
// the user's home, never CLAUDE_CONFIG_DIR: one writer serves every account.
// The file is untrusted, so the text may hold only OSC 8 links and SGR codes
// and at most 40 visible characters; anything else renders nothing. No file,
// no segment.
const SESSION_SEGMENT_COLS = 40;
const SESSION_ID_SAFE = /^[A-Za-z0-9_-]+$/;
// The link's body may hold no control at all: a terminal can read CAN, SUB or
// C1 CSI there as ending the link early, and the CONTROL check below never sees
// a body this strips.
// eslint-disable-next-line no-control-regex
const OSC8 = /\x1b\]8;[^\x00-\x1f\x7f-\x9f]*(?:\x07|\x1b\\)/g;
const SGR = /\x1b\[[0-9;:]*m/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f-\x9f]/;

function renderSessionSegment(input, { home = os.homedir(), now = Date.now() } = {}) {
  const id = input.session_id;
  if (typeof id !== 'string' || !SESSION_ID_SAFE.test(id)) return null;
  let seg;
  try {
    seg = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'statusline', 'segments', `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
  if (!seg || typeof seg.text !== 'string' || typeof seg.stale_text !== 'string') return null;
  const at = Date.parse(seg.at);
  const fresh = Number.isFinite(at) && typeof seg.ttl_s === 'number' && now < at + seg.ttl_s * 1000;
  let text = fresh ? seg.text : seg.stale_text;
  if (!color.colorEnabled()) text = text.replace(SGR, '');
  const visible = text.replace(OSC8, '').replace(SGR, '');
  if (!visible || CONTROL.test(visible) || Array.from(visible).length > SESSION_SEGMENT_COLS) return null;
  return text;
}

async function main() {
  const raw = await readStdin();
  let input = {};
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    /* empty input is fine */
  }

  const cwd = (input.workspace && input.workspace.current_dir) || input.cwd || process.cwd();
  const now = Date.now();
  const rateLimits = input.rate_limits || {};

  const segments = [
    renderProject(input, cwd),
    renderModel(input),
    renderContext(input),
    renderEffort(input),
    renderGit(cwd),
    renderPorts(cwd),
    renderRateLimit('sess', rateLimits.five_hour, now),
    renderRateLimit('week', rateLimits.seven_day, now),
    findActiveSpec(cwd),
    findOpenLedger(cwd),
    renderCost(input),
    renderAccount(input),
    renderSessionSegment(input, { now }),
  ].filter((s) => s !== null && s !== undefined && s !== '');

  process.stdout.write(segments.join(SEPARATOR));
}

if (require.main === module) {
  main().catch(() => process.stdout.write(''));
}

module.exports = {
  main,
  commonDirFromFs,
  resolveMainProjectDir,
  originUrlFromConfig,
  readOriginRemote,
  renderModel,
  renderProject,
  githubRepoUrl,
  renderContext,
  renderEffort,
  renderCost,
  renderGit,
  renderPorts,
  nearestGitToplevel,
  renderRateLimit,
  findActiveSpec,
  findOpenLedger,
  renderAccount,
  renderSessionSegment,
  formatDuration,
  colorByPct,
  parseStatusBranch,
  readStdin,
};
