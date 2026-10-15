#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { execSync } = require('child_process');
const color = require('./lib/color');

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
function resolveMainProjectDir(dir) {
  let stat;
  try {
    stat = fs.statSync(path.join(dir, '.git'));
  } catch {
    return dir;
  }
  if (stat.isDirectory()) return dir;
  try {
    const commonDir = execSync('git rev-parse --git-common-dir', {
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

function readOriginRemote(dir) {
  try {
    const url = execSync('git config --get remote.origin.url', {
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

// `git status --porcelain -b` returns the branch and dirty status in one
// call instead of two separate `symbolic-ref` + `status --porcelain` spawns.
// Header line shapes: "## main", "## main...origin/main [ahead 1]",
// "## No commits yet on main" (fresh repo, no commits), "## HEAD (no
// branch)" (detached HEAD — no branch to report, matching the old
// symbolic-ref failure behavior).
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
    const output = execSync('git status --porcelain -b', {
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
      const cells = line.split('|').map((c) => c.trim());
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
    renderAccount(input),
  ].filter((s) => s !== null && s !== undefined && s !== '');

  process.stdout.write(segments.join(SEPARATOR));
}

if (require.main === module) {
  main().catch(() => process.stdout.write(''));
}

module.exports = {
  main,
  renderModel,
  renderProject,
  githubRepoUrl,
  renderContext,
  renderEffort,
  renderGit,
  renderPorts,
  nearestGitToplevel,
  renderRateLimit,
  findActiveSpec,
  findOpenLedger,
  renderAccount,
  formatDuration,
  colorByPct,
  parseStatusBranch,
  readStdin,
};
