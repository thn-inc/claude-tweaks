'use strict';
// bin/lib/superpowers-version.js — which superpowers version a session would
// run, and the one-line notice when it is older than the version claude-tweaks
// is verified against (#3380).
//
// "Effective" here means: the installed_plugins.json entry the session resolves
// to (see selectEntry), with a readable install artifact whose plugin.json
// carries a strict x.y.z version. `enabledPlugins` is NOT consulted — a plugin
// that is installed but disabled still resolves; the notice describes the stale
// install, which is a true fact, rather than claiming the session loaded it.
//
// Probe results (headless `claude -p` init events, verified 2026-10-17):
//   - Confirmed: a project-scope entry applies to its `projectPath` and to every
//     directory below it, including a worktree of that project.
//   - Reversed: a project-scope entry whose `projectPath` is the home directory
//     never applies — `~`, `~/Code Workspaces` and an ad-hoc directory all loaded
//     the user-scope install. That is why selectEntry is called with
//     `excludeHome: true`.
//   - Observed, not encoded: two projects with exact-match project entries
//     (6.2.0 and 6.3.0) loaded the user-scope 7.0.0. Both lack
//     `claude-plugins-official` in the project's `extraKnownMarketplaces`. This is
//     unexplained, so the resolver still matches such entries; the notice states
//     the stale install, not that the session runs it.
//
// Placement: the SessionStart hook's inform tier. That hook already assembles
// the inform-tier banners and has the cwd, and one small synchronous read fits
// its inline block. This module is pure of the hook: every failure — an absent
// or malformed plugins file, an unreadable artifact, an injected dep that
// throws — returns null, so a session never breaks on it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { selectEntry, safeRealpath } = require('./installed-plugins');

// The last verified pin in tools/upstream-drift/manifest.yml. A future
// superpowers re-pin deliberately raises the notice threshold for every project
// still on the previous version. The parity test lives in
// tests/bin-lib/superpowers-version.test.js.
const SUPERPOWERS_FLOOR = '7.0.0';

function parseVersion(s) {
  if (typeof s !== 'string') return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isOlder(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i];
  }
  return false;
}

function defaultDeps() {
  return {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    realpath: fs.realpathSync,
    homedir: os.homedir,
    env: process.env,
  };
}

// overrides: test-only seam over { readFile, realpath, homedir, env }.
function effectiveSuperpowersVersion(projectDir, overrides = {}) {
  try {
    const deps = { ...defaultDeps(), ...overrides };
    const configDir = deps.env.CLAUDE_CONFIG_DIR || path.join(deps.homedir(), '.claude');
    const file = path.join(configDir, 'plugins', 'installed_plugins.json');
    const parsed = JSON.parse(deps.readFile(file));
    const plugins = parsed && parsed.plugins;
    if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return null;

    const flat = [];
    for (const key of Object.keys(plugins)) {
      const m = /^superpowers@(.+)$/.exec(key);
      if (!m || !Array.isArray(plugins[key])) continue;
      for (const e of plugins[key]) {
        if (!e || typeof e !== 'object') continue;
        if (e.scope !== 'user' && e.scope !== 'project') continue;
        flat.push({ ...e, marketplace: m[1] });
      }
    }
    // Latest first, so equal-length project matches (and the user fallback)
    // resolve to the most recently updated install.
    const stamp = (e) => (typeof e.lastUpdated === 'string' ? e.lastUpdated : '');
    flat.sort((a, b) => (stamp(a) < stamp(b) ? 1 : stamp(a) > stamp(b) ? -1 : 0));

    const chosen = selectEntry(flat, projectDir, deps, { excludeHome: true });
    if (!chosen || typeof chosen.installPath !== 'string') return null;

    const pkg = JSON.parse(deps.readFile(path.join(chosen.installPath, '.claude-plugin', 'plugin.json')));
    const version = pkg && pkg.version;
    if (parseVersion(version) === null) return null;
    return {
      version,
      scope: chosen.scope,
      marketplace: chosen.marketplace,
      projectPath: chosen.projectPath,
      installPath: chosen.installPath,
    };
  } catch {
    return null;
  }
}

function superpowersNotice({ effective, floor, projectDir }) {
  if (!effective || !isOlder(effective.version, floor)) return null;
  let suffix = '';
  if (effective.scope === 'project' && typeof effective.projectPath === 'string') {
    const deps = { realpath: fs.realpathSync };
    if (safeRealpath(effective.projectPath, deps) !== safeRealpath(projectDir, deps)) {
      suffix = ` (run from ${effective.projectPath}, the project this install belongs to)`;
    }
  }
  return `claude-tweaks: superpowers ${effective.version} is older than ${floor}, the version claude-tweaks is verified against — ` +
    `update with: claude plugin update superpowers@${effective.marketplace} --scope ${effective.scope}${suffix}; ` +
    `if it reports already at the latest, run claude plugin marketplace update ${effective.marketplace} first` +
    ' — tell the user once, in your first reply; never run the update yourself';
}

module.exports = { SUPERPOWERS_FLOOR, parseVersion, isOlder, effectiveSuperpowersVersion, superpowersNotice };
