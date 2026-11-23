// bin/lib/express/policy.js — the express lane's (#4025) policy-read seam: the real
// git/file/policy readers and the merge-sensitive-paths list parse that cli.js (the
// verbs) and queue.js (dispatch's queue-pull) both need, and the `protected-paths` read from
// the main checkout. Kept out of cli.js so the queue-pull path loads this small module, not the
// whole CLI graph.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolvePolicyConfig, LIST_ELEMENT_PATTERNS } = require('../policy-schema');
const { mainCheckoutRoot } = require('../hooks/worktree-detect');
const { SHIPPED_PROTECTED_PATHS } = require('./eligibility');
const { computeDerivedDefaults } = require('../policy-derived-defaults');
const { modelProfilesEntry } = require('../model-profiles/policy-fragment');
// Read through the module at call time: GIT_TIMEOUT_MS is a lazy getter (a policy read).
const sharedPrimitives = require('../shared-primitives');

// The resolved `merge-sensitive-paths` entry -> a list of globs (an array as-is, else a
// comma-separated string). `lib/blast-radius-cli.js`'s resolveBlastRadiusConfig applies
// the same parse to the same key.
function sensitivePathsOf(entry) {
  const raw = entry && entry.value;
  return Array.isArray(raw) ? raw : String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// The resolved `protected-paths` entry -> the glob list the eligibility predicates take. The decision keys
// on `invalid` / `source` / `error`, never on the value's emptiness: an explicit `[]` (source 'policy') is the
// project's empty list, while an unset, malformed or unreadable entry falls back to the shipped list. Elements
// are re-validated against the key's own glob pattern, so a hand-built entry cannot smuggle a bad glob in.
function protectedPathGlobsOf(entry) {
  if (!entry || typeof entry !== 'object' || entry.invalid === true || 'error' in entry || entry.source === 'default') return SHIPPED_PROTECTED_PATHS;
  const ok = (g) => typeof g === 'string' && LIST_ELEMENT_PATTERNS.glob.test(g);
  const { value } = entry;
  if (Array.isArray(value)) return value.every(ok) ? value : SHIPPED_PROTECTED_PATHS;
  if (typeof value === 'string') {
    const parts = value.split(',').map((s) => s.trim());
    return parts.every(ok) ? parts : SHIPPED_PROTECTED_PATHS;
  }
  return SHIPPED_PROTECTED_PATHS;
}

// The express gate's record options from the resolved express-lane, integration-model,
// merge-sensitive-paths and protected-paths entries: cli.js's gate verb and the plan-lane predicate
// (driver/plan-lane.js) read the express bounds from here, so a new bound reaches both.
function expressGateOptions(policy) {
  return {
    enabled: policy['express-lane'].value === true,
    integrationModel: policy['integration-model'].value,
    sensitivePaths: sensitivePathsOf(policy['merge-sensitive-paths']),
    protectedPathGlobs: protectedPathGlobsOf(policy['protected-paths']),
  };
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

// `protected-paths` is read from the MAIN checkout's policy.yml, never the cwd's: a record builds in a linked
// worktree whose own policy.yml it can edit, and a list read there would let a record shrink its own protected
// set. A `.git` file that is not a linked worktree's (a --separate-git-dir checkout, a submodule) leaves
// mainCheckoutRoot null, and the main checkout is then found through git: its toplevel when the git dir equals
// the common dir (a non-linked checkout), or, from a linked worktree, the `core.worktree` a submodule records
// in the common dir's config. A linked worktree of a --separate-git-dir checkout records no work-tree path, so
// it is never read: the entry is invalid (-> the shipped list) with one stderr warning, as it is when git
// fails; a fresh object each time.
function fallbackMainRoot(cwd) {
  const [gitDir, commonDir, top] = defaultGit(['rev-parse', '--git-dir', '--git-common-dir', '--show-toplevel'], { cwd }).split('\n').map((s) => s.trim());
  if (!gitDir || !commonDir) return null;
  const common = path.resolve(cwd, commonDir);
  if (path.resolve(cwd, gitDir) === common) return top || null;
  let configured = '';
  try { configured = defaultGit(['config', '--get', 'core.worktree'], { cwd }).trim(); } catch { return null; }
  return configured ? path.resolve(common, configured) : null;
}

function gitFailure(err) {
  const first = String((err && err.stderr) || '').split('\n').map((s) => s.trim()).find(Boolean);
  if (first) return first;
  if (err && err.status != null) return `git exited ${err.status}`;
  return (err && (err.code || err.message)) || 'error';
}

function resolveProtectedPathsEntry(cwd = process.cwd()) {
  const invalid = (why) => {
    process.stderr.write(`express-policy: protected-paths not read (${why}) — shipped list applies\n`);
    return { value: [], source: 'default', invalid: true };
  };
  try {
    const main = mainCheckoutRoot(cwd) || fallbackMainRoot(cwd);
    if (!main) return invalid('no main checkout resolved');
    return resolvePolicyConfig({ git: (args) => defaultGit(args, { cwd: main }), readFile: defaultReadFile, keys: ['protected-paths'], cwd: main }).result['protected-paths'];
  } catch (err) {
    return invalid(`read failed: ${gitFailure(err)}`);
  }
}

// keys -> { [key]: { value, source } } with derived defaults (an unpinned
// integration-model costs a `git remote get-url` + `gh repo view` probe, so callers on a
// hot path request only the keys they need).
function defaultResolvePolicy(keys, { runDir = null } = {}) {
  if (keys.includes('protected-paths')) {
    const rest = keys.filter((k) => k !== 'protected-paths');
    const resolved = rest.length > 0 ? defaultResolvePolicy(rest, { runDir }) : {};
    resolved['protected-paths'] = resolveProtectedPathsEntry(process.cwd());
    return resolved;
  }
  const { root, policyRaw, runConfigRaw, factoryRaw, result } = resolvePolicyConfig({ git: defaultGit, readFile: defaultReadFile, runDir, keys });
  const resolved = computeDerivedDefaults(result, keys, root, { runConfigRaw });
  // model-profiles is a policy-only block the flat resolver cannot read (#5917).
  if (keys.includes('model-profiles')) resolved['model-profiles'] = modelProfilesEntry(policyRaw, factoryRaw);
  return resolved;
}

module.exports = { sensitivePathsOf, protectedPathGlobsOf, resolveProtectedPathsEntry, expressGateOptions, defaultGit, defaultReadFile, defaultResolvePolicy };
