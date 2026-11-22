// bin/lib/run-manifest/facts.js
//
// The fact gatherers behind a run's manifest.json (#5903): plugin version, a hash of the resolved
// policy, the integration tip the run builds from, and the model profile. Each field is computed
// independently inside its own try/catch, so one failing source nulls that field and leaves the
// rest — gatherFacts never throws, because the mint that calls it must never fail on a manifest.
//
// No network at mint: the two policy keys whose resolution can call `gh` (forge detection) are
// excluded from the hash by FORGE_DERIVED_POLICY_KEYS. `env` is the caller's real process
// environment (the default) — never a stripped one: a stripped env has no CLAUDE_PLUGIN_ROOT and
// no PATH for git.
'use strict';
const crypto = require('crypto');
const fs = require('fs');

// The keys whose resolution may probe the forge. The one constant to edit if another key's
// resolution ever gains a network probe.
const FORGE_DERIVED_POLICY_KEYS = Object.freeze(['integration-model', 'merge-verification']);

// JSON with object keys sorted at every depth and no whitespace, so equal values hash equal
// whatever order a resolver produced them in. Arrays keep their order.
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const parts = [];
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  }
  return `{${parts.join(',')}}`;
}

// Absent file -> null (no policy is a valid policy); any other read error propagates so the
// policy fields null out instead of hashing a policy that could not be read. resolve-policy.js's
// own reader swallows every error, which would hash an unreadable policy as the defaults.
function readFileOrNull(rawRead) {
  return (filePath) => {
    try {
      return rawRead(filePath);
    } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      throw err;
    }
  };
}

// { policyHash, modelProfile } from one resolvePolicy call, or both null when it fails.
function gatherPolicyFacts({ cwd, env }, deps) {
  const { resolvePolicy, callerDeps } = require('../../resolve-policy');
  const { POLICY_KEYS } = require('../policy-schema');
  const keys = POLICY_KEYS.map((row) => row.key).filter((key) => !FORGE_DERIVED_POLICY_KEYS.includes(key));
  const policyDeps = {
    ...callerDeps({ cwd, env }),
    readFile: readFileOrNull(deps.readFile || ((p) => fs.readFileSync(p, 'utf8'))),
  };
  const out = resolvePolicy({ keys }, policyDeps);
  const values = {};
  for (const key of keys) {
    const entry = out.result[key];
    values[key] = entry && entry.value !== undefined ? entry.value : null;
  }
  const digest = crypto.createHash('sha256').update(canonicalJson(values)).digest('hex');
  return {
    policyHash: `sha256:${digest}`,
    modelProfile: { stance: values['model-stance'], ceiling: values['model-ceiling'] },
  };
}

// The 40-hex tip of the remote-tracking integration branch in the main checkout, or null. The name
// comes from the shared resolver (the policy pin, else what origin/HEAD points at) that the run's
// worktree creation uses; it can return a bare name or `origin/{name}`, and either way the commit
// read is of the remote-tracking ref — a local-only branch is not the integration tip.
function gatherBaseCommit({ cwd, env }, deps) {
  const { mainCheckoutRoot } = require('../hooks/worktree-detect');
  const root = mainCheckoutRoot(cwd);
  if (!root) return null;
  const { resolveIntegrationBranch, bareIntegrationName } = require('../hooks/worktree-reap');
  const resolveBranch = deps.resolveIntegrationBranch || resolveIntegrationBranch;
  const name = resolveBranch(root, null, { env });
  if (!name) return null;
  const bare = bareIntegrationName(name);
  const run = deps.runGit || require('../hooks/git-exec').runGit;
  const { stdout, failure } = run(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${bare}^{commit}`], root, { env });
  if (failure || !stdout) return null;
  const sha = stdout.trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

function gatherPluginVersion({ env }) {
  const { resolvePluginVersion } = require('../plugin-version');
  const version = resolvePluginVersion(env);
  return typeof version === 'string' && version ? version : null;
}

// deps (all optional, for tests): readFile(path) — the raw policy reader; runGit — git-exec's
// signature; resolveIntegrationBranch — worktree-reap's signature.
function gatherFacts({ cwd, env = process.env }, deps = {}) {
  const attempt = (fn, fallback) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  // An inherited GIT_DIR would override `git -C <cwd>` and read the wrong repo (#4178's hazard).
  const gitEnv = attempt(() => require('../hooks/git-exec').repoPinnedEnv(env), env);
  const policy = attempt(() => gatherPolicyFacts({ cwd, env: gitEnv }, deps), { policyHash: null, modelProfile: null });
  return {
    pluginVersion: attempt(() => gatherPluginVersion({ env }), null),
    policyHash: policy.policyHash,
    baseCommit: attempt(() => gatherBaseCommit({ cwd, env: gitEnv }, deps), null),
    modelProfile: policy.modelProfile,
  };
}

module.exports = { FORGE_DERIVED_POLICY_KEYS, canonicalJson, gatherFacts };
