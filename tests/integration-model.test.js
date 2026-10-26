// tests/integration-model.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectIntegrationModel, resolvePolicyKeys, POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');
const { readText } = require('./helpers/read-skill');
const { pathWithOnly } = require('./helpers/path-stub');
const { toPosix } = require('../plugin/bin/lib/shared-primitives');

const RESOLVE_POLICY = path.join(__dirname, '..', 'plugin', 'bin', 'resolve-policy.js');
const REPO_ROOT = path.join(__dirname, '..');

function gitRepo({ remote } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-intmodel-')));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  if (remote) execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', remote]);
  return dir;
}

// Fakes "gh absent, git present" without an empty PATH — blanking PATH
// entirely would also break the git remote-get-url probe that must keep
// succeeding. pathWithOnly resolves git via the *current* PATH and returns
// git's own directory as the override PATH; on some machines (this repo's dev
// environment included) git and gh live in the SAME directory (e.g. both
// under /opt/homebrew/bin via Homebrew), so when that directory also holds gh
// it substitutes a scratch dir holding only a git symlink — git resolves, gh
// does not.
function ghAbsentPath() {
  return pathWithOnly(['git'], { exclude: ['gh'] });
}

function runResolvePolicy(args, { cwd, env } = {}) {
  return execFileSync(process.execPath, [RESOLVE_POLICY, ...args], { cwd, env, encoding: 'utf8' });
}

// --- Schema shape ---

test('integration-model carries no static schema default — it is deliberately computed, not a literal', () => {
  const entry = POLICY_KEYS.find((e) => e.key === 'integration-model');
  assert.ok(entry, 'integration-model must be registered in POLICY_KEYS');
  assert.strictEqual(entry.type, 'enum');
  assert.deepStrictEqual(entry.values, ['pr-first', 'local-merge']);
  assert.strictEqual(entry.default, undefined, 'a static default would bypass forge detection entirely');
});

test('resolvePolicyKeys stays pure for integration-model — unset resolves to null, no detection side effect', () => {
  // resolvePolicyKeys never shells out; only bin/resolve-policy.js's CLI layer
  // calls detectIntegrationModel. This proves the split holds.
  const result = resolvePolicyKeys(['integration-model'], { policyRaw: null, runConfigRaw: null });
  assert.deepStrictEqual(result['integration-model'], { value: null, source: 'default' });
});

test('resolvePolicyKeys returns an explicit policy.yml value verbatim', () => {
  const result = resolvePolicyKeys(['integration-model'], { policyRaw: 'integration-model: local-merge\n', runConfigRaw: null });
  assert.deepStrictEqual(result['integration-model'], { value: 'local-merge', source: 'policy' });
});

test('an invalid integration-model value degrades to default with the invalid flag intact', () => {
  const result = resolvePolicyKeys(['integration-model'], { policyRaw: 'integration-model: sideways\n', runConfigRaw: null });
  assert.deepStrictEqual(result['integration-model'], { value: null, source: 'default', invalid: true });
});

// --- detectIntegrationModel (unit) ---

test('detectIntegrationModel: no git remote at all -> local-merge, without ever invoking gh', () => {
  const dir = gitRepo();
  assert.strictEqual(detectIntegrationModel(dir), 'local-merge');
});

test('detectIntegrationModel: remote present but unreachable/non-GitHub -> local-merge (fail-open)', () => {
  const dir = gitRepo({ remote: 'https://example.invalid/nowhere/nothing.git' });
  assert.strictEqual(detectIntegrationModel(dir), 'local-merge');
});

test('detectIntegrationModel: this repo (real GitHub remote) resolves a valid enum value', () => {
  // Live-environment dependent by nature (AC1) — asserts shape, not a specific
  // value, so it stays green in a gh-absent/unauthenticated sandbox too.
  const value = detectIntegrationModel(REPO_ROOT);
  assert.ok(['pr-first', 'local-merge'].includes(value));
});

test('detectIntegrationModel: mcpReachable:true resolves pr-first for a real GitHub remote even when gh is faked absent (AC2)', () => {
  const dir = gitRepo({ remote: 'https://github.com/thomasholknielsen/claude-tweaks.git' });
  const originalPath = process.env.PATH;
  process.env.PATH = ghAbsentPath();
  try {
    assert.strictEqual(detectIntegrationModel(dir, { mcpReachable: true }), 'pr-first');
  } finally {
    process.env.PATH = originalPath;
  }
});

test('detectIntegrationModel: mcpReachable:true with no git remote still resolves local-merge — a remote is required regardless of MCP reachability', () => {
  const dir = gitRepo();
  assert.strictEqual(detectIntegrationModel(dir, { mcpReachable: true }), 'local-merge');
});

test('detectIntegrationModel: no override (undefined opts) is unchanged — gh absent still resolves local-merge (AC3)', () => {
  const dir = gitRepo({ remote: 'https://example.invalid/nowhere/nothing.git' });
  assert.strictEqual(detectIntegrationModel(dir), 'local-merge');
});

test('detectIntegrationModel: mcpReachable:false is unchanged from no-override — gh absent still resolves local-merge (AC3)', () => {
  const dir = gitRepo({ remote: 'https://example.invalid/nowhere/nothing.git' });
  assert.strictEqual(detectIntegrationModel(dir, { mcpReachable: false }), 'local-merge');
});

test('resolveIntegrationModel: forwards opts through to detectIntegrationModel', () => {
  const { resolveIntegrationModel } = require('../plugin/bin/lib/policy-schema');
  const dir = gitRepo({ remote: 'https://github.com/thomasholknielsen/claude-tweaks.git' });
  const originalPath = process.env.PATH;
  process.env.PATH = ghAbsentPath();
  try {
    assert.strictEqual(resolveIntegrationModel(dir, { mcpReachable: true }), 'pr-first');
  } finally {
    process.env.PATH = originalPath;
  }
});

// --- CLI (bin/resolve-policy.js) ---

test('CLI: fixture with no remote -> local-merge (AC2)', () => {
  const dir = gitRepo();
  const out = runResolvePolicy(['--values', 'integration-model'], { cwd: dir });
  assert.strictEqual(out.trim(), 'local-merge');
});

test('CLI: explicit policy.yml value wins outright, no detection attempted', () => {
  const dir = gitRepo({ remote: 'https://example.invalid/nowhere/nothing.git' });
  fs.mkdirSync(path.join(dir, '.claude-tweaks'));
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  const out = runResolvePolicy(['--values', 'integration-model'], { cwd: dir });
  assert.strictEqual(out.trim(), 'pr-first');
});

test('CLI: run-config value is pinned and wins over policy.yml (run-scoped stability)', () => {
  const dir = gitRepo();
  fs.mkdirSync(path.join(dir, '.claude-tweaks'));
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-model: local-merge\n');
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-intmodel-run-'));
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'integration-model: pr-first\n');
  const out = runResolvePolicy(['--values', '--run', runDir, 'integration-model'], { cwd: dir });
  assert.strictEqual(out.trim(), 'pr-first');
});

test('CLI: this repo resolves a valid enum value regardless of policy.yml state (AC1 shape)', () => {
  const out = runResolvePolicy(['--values', 'integration-model'], { cwd: REPO_ROOT });
  assert.ok(['pr-first', 'local-merge'].includes(out.trim()));
});

test('CLI: this repo pins integration-model: pr-first in policy.yml — resolves without shelling out to git/gh (AC1)', () => {
  const policyPath = path.join(REPO_ROOT, '.claude-tweaks', 'policy.yml');
  const policyRaw = readText(policyPath);
  assert.match(policyRaw, /^integration-model:\s*pr-first\s*$/m, '.claude-tweaks/policy.yml must pin integration-model: pr-first');
  const out = runResolvePolicy(['--values', 'integration-model'], { cwd: REPO_ROOT });
  assert.strictEqual(out.trim(), 'pr-first');
});

test('CLI: --mcp-reachable resolves pr-first when gh is faked absent and a real remote exists (AC4)', () => {
  const dir = gitRepo({ remote: 'https://github.com/thomasholknielsen/claude-tweaks.git' });
  const env = { ...process.env, PATH: ghAbsentPath() };
  const out = runResolvePolicy(['--values', 'integration-model', '--mcp-reachable'], { cwd: dir, env });
  assert.strictEqual(out.trim(), 'pr-first');
});

test('CLI: omitting --mcp-reachable preserves todays local-merge fail-open behavior when gh is absent (AC4)', () => {
  const dir = gitRepo({ remote: 'https://github.com/thomasholknielsen/claude-tweaks.git' });
  const env = { ...process.env, PATH: ghAbsentPath() };
  const out = runResolvePolicy(['--values', 'integration-model'], { cwd: dir, env });
  assert.strictEqual(out.trim(), 'local-merge');
});

test('CLI: --mcp-reachable forwards into merge-verification even when integration-model is NOT also requested (#1421 Finding 3)', () => {
  // A fixture repo that reaches deriveMergeVerification's branch (3)
  // (merge-when-green) only when integration-model resolves pr-first: a
  // real remote, a PR-triggered workflow, and an integration branch equal
  // to the default branch (both read off origin/HEAD).
  const dir = gitRepo({ remote: 'https://github.com/thomasholknielsen/claude-tweaks.git' });
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  const branch = git('symbolic-ref', '--short', 'HEAD').trim();
  git('update-ref', `refs/remotes/origin/${branch}`, 'HEAD');
  git('symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${branch}`);
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\non:\n  push:\n    branches: [main]\n  pull_request:\njobs: {}\n');
  const env = { ...process.env, PATH: ghAbsentPath() };

  // Without the flag: gh absent -> forge detection falls open to local-merge
  // -> branch (1) -> off.
  const withoutFlag = runResolvePolicy(['--values', 'merge-verification'], { cwd: dir, env });
  assert.strictEqual(withoutFlag.trim(), 'off');

  // With the flag, requesting ONLY merge-verification (not integration-model
  // in the same call): before the fix, the flag was silently dropped on this
  // path and the result matched the line above (off). After the fix, it
  // forwards through resolveIntegrationModel -> pr-first -> merge-when-green.
  const withFlag = runResolvePolicy(['--values', 'merge-verification', '--mcp-reachable'], { cwd: dir, env });
  assert.strictEqual(withFlag.trim(), 'merge-when-green');
});

// --- Consumer conformance ---
// Mirrors tests/integration-branch-conformance.test.js's regex-plus-allowlist
// shape: any file mentioning the resolved key routes on it and must cite the
// canonical fragment, or state why not.

const SKILLS_DIR = path.join(__dirname, '..', 'plugin', 'skills');
const FRAGMENT = '_shared/integration-model.md';
const TOKEN = /integration-model/;

const ALLOWLIST = new Map([
  ['_shared/integration-model.md', 'this is the canonical fragment itself — it cannot cite itself'],
]);

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

test('every file naming integration-model cites the shared fragment or is allowlisted', () => {
  const offenders = [];
  for (const file of walk(SKILLS_DIR)) {
    // Compared against a /-keyed allowlist, so it is a display ID (#4288).
    const rel = toPosix(path.relative(SKILLS_DIR, file));
    const text = readText(file);
    if (!TOKEN.test(text)) continue;
    if (ALLOWLIST.has(rel)) continue;
    if (text.includes(FRAGMENT)) continue;
    offenders.push(rel);
  }
  assert.deepStrictEqual(offenders, [], `these files mention integration-model without citing ${FRAGMENT}: ${offenders.join(', ')}`);
});

test('the allowlist has no stale entries', () => {
  const stale = [];
  for (const rel of ALLOWLIST.keys()) {
    const full = path.join(SKILLS_DIR, rel);
    if (!fs.existsSync(full)) { stale.push(`${rel} (file no longer exists)`); continue; }
    const text = readText(full);
    if (!TOKEN.test(text)) { stale.push(`${rel} (no longer mentions integration-model — drop the entry)`); continue; }
    if (text.includes(FRAGMENT)) stale.push(`${rel} (cites ${FRAGMENT} — the entry is redundant, drop it)`);
  }
  assert.deepStrictEqual(stale, [], `stale allowlist entries: ${stale.join(', ')}`);
});
