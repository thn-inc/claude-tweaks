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
// Which record runs is the first applicable one in file order — the rule, and
// the Claude Code 2.1.302 probe of 2026-10-19 behind it, are in
// installed-plugins.js. Records keep their file order and are never sorted
// (lastUpdated does not rank them). Which of several `superpowers@{marketplace}`
// keys loads is unsettled, so the keys flatten in `Object.keys` order and the
// notice states the stale install, not that the session runs it.
//
// The missing-path remedy (a project or local record whose projectPath is gone)
// rests on the Claude Code 2.1.302 probe of 2026-10-20: `update` (explicit
// `--scope project`/`local`, or auto scope) from the main checkout updates the
// first applicable record in file order; `uninstall --scope project`/`local`
// from the main checkout removes the main checkout's own record (exact
// `projectPath` match); after `mkdir -p` of the deleted path, `uninstall` run
// from inside it removes the stale record; `uninstall --scope local` against
// project records fails with "installed in project scope, not local".
//
// Placement: the SessionStart hook's inform tier. That hook already assembles
// the inform-tier banners and has the cwd, and one small synchronous read fits
// its inline block. This module is pure of the hook: every failure — an absent
// or malformed plugins file, an unreadable artifact, an injected dep that
// throws — returns null, so a session never breaks on it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readInstalledPlugins, selectEntry, safeRealpath } = require('./installed-plugins');
const { lstatType } = require('./path-guard');

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

// A marketplace name is rendered into a runnable command, and a projectPath
// into the same model-directed line: either one malformed means no notice.
const MARKETPLACE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

function defaultDeps() {
  return {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    // The native realpath canonicalizes case on a case-insensitive volume (the
    // JS one echoes the input's casing), so a mis-cased cwd or projectPath still
    // compares equal to its own project.
    realpath: fs.realpathSync.native,
    homedir: os.homedir,
    env: process.env,
  };
}

// overrides: test-only seam over { readFile, realpath, homedir, env }.
function effectiveSuperpowersVersion(projectDir, overrides = {}) {
  try {
    const deps = { ...defaultDeps(), ...overrides };
    const read = readInstalledPlugins(deps);
    if (!read.ok) return null;
    const parsed = read.data;
    const plugins = parsed && parsed.plugins;
    if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return null;

    const flat = [];
    for (const key of Object.keys(plugins)) {
      const m = /^superpowers@(.+)$/.exec(key);
      if (!m || !MARKETPLACE_RE.test(m[1]) || !Array.isArray(plugins[key])) continue;
      for (const e of plugins[key]) {
        if (!e || typeof e !== 'object') continue;
        if (e.scope !== 'user' && e.scope !== 'managed' && e.scope !== 'project' && e.scope !== 'local') continue;
        if (typeof e.projectPath === 'string' && CONTROL_CHAR_RE.test(e.projectPath)) continue;
        flat.push({ ...e, marketplace: m[1] });
      }
    }
    const chosen = selectEntry(flat, projectDir, deps);
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
  if ((effective.scope === 'project' || effective.scope === 'local') && typeof effective.projectPath === 'string') {
    const deps = { realpath: fs.realpathSync.native };
    if (lstatType(effective.projectPath).type === 'missing') {
      // The record applies here only because its path belongs to this git checkout;
      // never name a gone directory as the place to run from; the remedy recreates it first.
      suffix = ` (this install is recorded for ${effective.projectPath}, which no longer exists; it applies here because that path belongs to the same git checkout; the update command above, run in this checkout, updates that record; to remove it instead, run mkdir -p "${effective.projectPath}", then claude plugin uninstall superpowers@${effective.marketplace} --scope ${effective.scope} from inside that directory, then delete the directory — running that uninstall from this checkout removes this checkout's own record, not the stale one; never run these removal steps yourself)`;
    } else if (safeRealpath(effective.projectPath, deps) !== safeRealpath(projectDir, deps)) {
      suffix = ` (run from ${effective.projectPath}, the project this install belongs to)`;
    }
  }
  return `claude-tweaks: superpowers ${effective.version} is older than ${floor}, the version claude-tweaks is verified against — ` +
    `update with: claude plugin update superpowers@${effective.marketplace} --scope ${effective.scope}${suffix}; ` +
    `if it reports already at the latest, run claude plugin marketplace update ${effective.marketplace} first` +
    ' — tell the user once, in your first reply; never run the update yourself';
}

module.exports = { SUPERPOWERS_FLOOR, parseVersion, isOlder, effectiveSuperpowersVersion, superpowersNotice };
