// bin/lib/plugin-version.js
// Pure(ish) — one filesystem read, no network. #1837 review finding: this
// exact "read CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json, parse, extract
// version, fail toward undefined" logic existed independently in
// bin/lib/hooks/session-start.js's resolveBuildLine (pre-existing),
// bin/harness-health.js's own resolvePluginVersion, and
// bin/materialize.js's installedPluginVersion deps entry — CLAUDE.md's own
// Structure section states bin/*.js should be thin wrappers over
// bin/lib/** modules, not reimplement this per call site. Every caller
// wants the bare version string; a caller wanting a formatted line (like
// session-start.js's own "claude-tweaks v{version} @ {root}" diagnostic)
// composes it from this function's return value rather than this module
// owning any particular presentation.
'use strict';

const fs = require('fs');
const path = require('path');

// env is injectable for tests; production omits it (defaults to
// process.env, the same convention every caller this replaces already
// used).
function resolvePluginVersion(env = process.env) {
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) return undefined;
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
  } catch {
    return undefined;
  }
  return pkg && typeof pkg.version === 'string' && pkg.version ? pkg.version : undefined;
}

module.exports = { resolvePluginVersion };
