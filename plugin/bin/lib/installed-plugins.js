'use strict';
// bin/lib/installed-plugins.js — pick which $CLAUDE_CONFIG_DIR/plugins/installed_plugins.json
// (default ~/.claude) entry of one plugin a session actually runs. readInstalledPlugins
// is the one reader of that file; both resolvers use it and share selectEntry:
//   - bin/lib/impeccable-engine/index.js;
//   - the superpowers version resolver (#3380).
//
// The rule (#3541), read from Claude Code 2.1.302: a session runs the FIRST
// applicable record in file order — array order is the only ranking, and scope is
// not ranked (a user record listed before a project record wins). A record applies
// when any of these holds:
//   - its scope is `user` or `managed`;
//   - its realpathed `projectPath` equals the realpathed session path;
//   - `canonicalGitRoot(projectPath)` equals `canonicalGitRoot(sessionPath)`, both
//     non-null — the same git checkout, so a record for a linked worktree (even a
//     deleted one) applies to a session in the main checkout and vice versa.
// A project or local record for a non-git folder therefore applies only at exactly
// that folder, never in a subfolder of it.
//
// Probe, 2026-10-19 (Claude Code 2.1.302, headless `claude -p` runs reading the
// init event's plugin list with hooks disabled; the file hash was unchanged):
//   - `impeccable@impeccable`: user 4.6.0 is first in the array, so every project's
//     session loaded user 4.6.0 even where a project record 3.0.6 exists.
//   - `superpowers@claude-plugins-official`: a session in synology-nas loaded user
//     7.0.0 at index 1; its own 6.2.0 record at index 3 is never reached.
//   - `claude-tweaks@claude-tweaks-marketplace`: a session in memenu-app loaded
//     6.113.0 from a record for a worktree directory that no longer exists, ahead of
//     memenu-app's own exact-path 6.108.0 record — only first-in-order plus
//     same-checkout produces that.
// This also explains the home-directory findings of #3380 and #3415: a home record
// is not skipped by any rule, it loses only because the user record is listed first.
//
// Not covered: Claude Code's second, Windows-only pass over these records
// (gh-74612). A future Claude Code release can change the rule; re-probe against
// `npx`-pinned builds before trusting this header on a newer version.

const path = require('path');
const { canonicalRealpath } = require('./path-guard');

// Reads the installed-plugins file of the config dir the session runs under.
// deps: { readFile(p), homedir(), env? } — `env` is the caller's view of the
// environment (never process.env here); an absent `env` means no override.
// -> { ok: true, data, file } | { ok: false, file, detail }.
function readInstalledPlugins(deps) {
  const configDir = (deps.env && deps.env.CLAUDE_CONFIG_DIR) || path.join(deps.homedir(), '.claude');
  const file = path.join(configDir, 'plugins', 'installed_plugins.json');
  let text;
  try {
    text = deps.readFile(file);
  } catch (err) {
    return { ok: false, file, detail: err.code === 'ENOENT' ? `not found: ${file}` : err.message };
  }
  try {
    return { ok: true, data: JSON.parse(text), file };
  } catch (err) {
    return { ok: false, file, detail: `malformed JSON (${err.message})` };
  }
}

// The injected deps.realpath is passed through unchanged (both resolvers inject
// `fs.realpathSync.native`; the tests inject their own), and a failure falls back
// to the input so a stale projectPath still compares lexically.
function safeRealpath(p, deps) {
  if (!deps || typeof deps.realpath !== 'function') return p;
  const r = canonicalRealpath(p, { realpath: deps.realpath });
  return r === null ? p : r;
}

// The git checkout `p` belongs to, as an absolute real path: the main checkout for a
// linked worktree, else the directory holding `.git`. Walks up from `p`, through
// components that do not exist; null when no ancestor holds a `.git`, when `p` is
// not a string, or when `deps.readFile` is absent. readFile is the only filesystem
// read here — a `.git` directory surfaces as a throw with err.code === 'EISDIR'.
function canonicalGitRoot(p, deps) {
  if (typeof p !== 'string' || !deps || typeof deps.readFile !== 'function') return null;
  let dir = path.resolve(safeRealpath(p, deps));
  for (;;) {
    let text;
    try {
      text = String(deps.readFile(path.join(dir, '.git')));
    } catch (err) {
      if (err && err.code === 'EISDIR') return safeRealpath(dir, deps);
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
      continue;
    }
    const m = /^gitdir:\s*(.+?)\s*$/.exec(text.split(/\r?\n/, 1)[0]);
    if (!m) return safeRealpath(dir, deps);
    const gitdir = path.resolve(dir, m[1]);
    let common;
    try {
      common = String(deps.readFile(path.join(gitdir, 'commondir'))).trim();
    } catch (_err) {
      return safeRealpath(dir, deps);
    }
    const commonDir = path.resolve(gitdir, common);
    return safeRealpath(path.basename(commonDir) === '.git' ? path.dirname(commonDir) : dir, deps);
  }
}

// The first entry, in array order, that applies to `projectPath` (rule and
// provenance in the header); null when none does. Non-object entries are skipped.
// deps: { realpath?, readFile? } — without readFile only exact paths match.
function selectEntry(entries, projectPath, deps) {
  const target = safeRealpath(projectPath, deps);
  const roots = new Map();
  const rootOf = (p) => {
    if (!roots.has(p)) roots.set(p, canonicalGitRoot(p, deps));
    return roots.get(p);
  };
  const applies = (entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.scope === 'user' || entry.scope === 'managed') return true;
    if (typeof entry.projectPath !== 'string') return false;
    if (safeRealpath(entry.projectPath, deps) === target) return true;
    const root = rootOf(entry.projectPath);
    return root !== null && root === rootOf(projectPath);
  };
  return entries.find(applies) || null;
}

module.exports = { readInstalledPlugins, selectEntry, safeRealpath, canonicalGitRoot };
