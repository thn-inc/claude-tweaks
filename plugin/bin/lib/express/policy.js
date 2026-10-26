// bin/lib/express/policy.js — the express lane's (#4025) policy-read seam: the real
// git/file/policy readers and the merge-sensitive-paths list parse that cli.js (the
// verbs) and queue.js (dispatch's queue-pull) both need. Kept out of cli.js so the
// queue-pull path loads this small module, not the whole CLI graph.
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const { resolvePolicyConfig } = require('../policy-schema');
const { computeDerivedDefaults } = require('../policy-derived-defaults');
// Read through the module at call time: GIT_TIMEOUT_MS is a lazy getter (a policy read).
const sharedPrimitives = require('../shared-primitives');

// The resolved `merge-sensitive-paths` entry -> a list of globs (an array as-is, else a
// comma-separated string). `lib/blast-radius-cli.js`'s resolveBlastRadiusConfig applies
// the same parse to the same key.
function sensitivePathsOf(entry) {
  const raw = entry && entry.value;
  return Array.isArray(raw) ? raw : String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function defaultGit(args, opts = {}) {
  return execFileSync('git', args, { cwd: opts.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: sharedPrimitives.GIT_TIMEOUT_MS, windowsHide: true });
}

// The file's text, or null when it does not exist.
function defaultReadFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// keys -> { [key]: { value, source } } with derived defaults (an unpinned
// integration-model costs a `git remote get-url` + `gh repo view` probe, so callers on a
// hot path request only the keys they need).
function defaultResolvePolicy(keys, { runDir = null } = {}) {
  const { root, result } = resolvePolicyConfig({ git: defaultGit, readFile: defaultReadFile, runDir, keys });
  return computeDerivedDefaults(result, keys, root);
}

module.exports = { sensitivePathsOf, defaultGit, defaultReadFile, defaultResolvePolicy };
