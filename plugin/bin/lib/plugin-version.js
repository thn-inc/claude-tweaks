// bin/lib/plugin-version.js
// Pure(ish) — one filesystem read, no network. Reads
// CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json, parses it, extracts the
// version and fails toward undefined. Shared by bin/lib/hooks/session-start.js's
// resolveBuildLine, bin/harness-health.js and bin/materialize.js (#1837), so no
// bin/*.js reimplements the read. Every caller wants the bare version string; a
// caller wanting a formatted line (like session-start.js's own "claude-tweaks
// v{version} @ {root}" diagnostic) composes it from this function's return value
// rather than this module owning any particular presentation.
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
