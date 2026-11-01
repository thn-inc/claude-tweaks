// tests/integration-model.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  detectIntegrationModel, resolveIntegrationModel, resolveForgeProbeTimeoutMs, formatForgeDegrade, resolvePolicyKeys, POLICY_KEYS,
} = require('../plugin/bin/lib/policy-schema');
const { readText } = require('./helpers/read-skill');
const { pathWithOnly, STUB_SKIP } = require('./helpers/path-stub');
const { fakeGh } = require('./helpers/fake-gh');
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

// --- gh timeout ladder, retry-once, degrade callback (#4578) ---

const GH_REMOTE = 'https://github.com/o/n.git';
const TIMEOUT_ENV = 'CLAUDE_TWEAKS_GH_TIMEOUT_MS';

// Runs fn with CLAUDE_TWEAKS_GH_TIMEOUT_MS set to `value` (undefined -> deleted),
// then restores the original — deleted when it was originally unset.
function withTimeoutEnv(value, fn) {
  const original = process.env[TIMEOUT_ENV];
  if (value === undefined) delete process.env[TIMEOUT_ENV];
  else process.env[TIMEOUT_ENV] = value;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env[TIMEOUT_ENV];
    else process.env[TIMEOUT_ENV] = original;
  }
}

function writePolicy(dir, text) {
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), text);
}

test('detectIntegrationModel: gh-timeout-ms 20000 in policy.yml outlasts an 8 s gh -> pr-first (AC1.1, AC1.2)', { skip: STUB_SKIP }, () => {
  const dir = gitRepo({ remote: GH_REMOTE });
  writePolicy(dir, 'gh-timeout-ms: 20000\n');
  const gh = fakeGh({ first: { slow: 8 } });
  try {
    withTimeoutEnv(undefined, () => {
      assert.strictEqual(detectIntegrationModel(dir), 'pr-first');
    });
    assert.strictEqual(gh.count(), 1);
  } finally {
    gh.restore();
  }
});

test('detectIntegrationModel: CLAUDE_TWEAKS_GH_TIMEOUT_MS=20000 with no policy key outlasts an 8 s gh -> pr-first (AC2.1)', { skip: STUB_SKIP }, () => {
  const dir = gitRepo({ remote: GH_REMOTE });
  const gh = fakeGh({ first: { slow: 8 } });
  try {
    withTimeoutEnv('20000', () => {
      assert.strictEqual(detectIntegrationModel(dir), 'pr-first');
    });
    assert.strictEqual(gh.count(), 1);
  } finally {
    gh.restore();
  }
});

test('detectIntegrationModel: explicit opts.timeoutMs 1000 beats env 20000 -> degraded local-merge after two attempts (AC2.2)', { skip: STUB_SKIP }, () => {
  const dir = gitRepo({ remote: GH_REMOTE });
  const gh = fakeGh({ first: { slow: 8 } });
  const seen = [];
  try {
    withTimeoutEnv('20000', () => {
      assert.strictEqual(detectIntegrationModel(dir, { timeoutMs: 1000, onDegrade: (d) => seen.push(d) }), 'local-merge');
    });
    assert.strictEqual(gh.count(), 2);
    assert.deepStrictEqual(seen, [{ reason: 'timeout', timeoutMs: 1000, attempts: 2 }]);
  } finally {
    gh.restore();
  }
});

test('detectIntegrationModel: timeout on the first call, success on the second -> pr-first, two invocations, no degrade (AC3.1)', { skip: STUB_SKIP }, () => {
  const dir = gitRepo({ remote: GH_REMOTE });
  const gh = fakeGh({ first: 'hang', rest: 'ok' });
  const seen = [];
  try {
    withTimeoutEnv(undefined, () => {
      assert.strictEqual(detectIntegrationModel(dir, { timeoutMs: 1000, onDegrade: (d) => seen.push(d) }), 'pr-first');
    });
    assert.strictEqual(gh.count(), 2);
    assert.deepStrictEqual(seen, []);
  } finally {
    gh.restore();
  }
});

test('detectIntegrationModel: timeout then non-zero exit on retry -> degraded local-merge, two invocations, one degrade (AC14.1, AC14.2)', { skip: STUB_SKIP }, () => {
  const dir = gitRepo({ remote: GH_REMOTE });
  const gh = fakeGh({ first: 'hang', rest: 'fail' });
  const seen = [];
  try {
    withTimeoutEnv(undefined, () => {
      assert.strictEqual(detectIntegrationModel(dir, { timeoutMs: 1000, onDegrade: (d) => seen.push(d) }), 'local-merge');
    });
    assert.strictEqual(gh.count(), 2);
    assert.deepStrictEqual(seen, [{ reason: 'timeout-then-exit', timeoutMs: 1000, attempts: 2 }]);
  } finally {
    gh.restore();
  }
});

test('detectIntegrationModel: immediate non-zero gh exit -> local-merge, one invocation, no degrade (AC4.1)', { skip: STUB_SKIP }, () => {
  const dir = gitRepo({ remote: GH_REMOTE });
  const gh = fakeGh({ first: 'fail' });
  const seen = [];
  try {
    withTimeoutEnv(undefined, () => {
      assert.strictEqual(detectIntegrationModel(dir, { timeoutMs: 1000, onDegrade: (d) => seen.push(d) }), 'local-merge');
    });
    assert.strictEqual(gh.count(), 1);
    assert.deepStrictEqual(seen, []);
  } finally {
    gh.restore();
  }
});

test('detectIntegrationModel: a throwing onDegrade never escapes -> local-merge', { skip: STUB_SKIP }, () => {
  const dir = gitRepo({ remote: GH_REMOTE });
  const gh = fakeGh({ first: 'hang' });
  try {
    withTimeoutEnv(undefined, () => {
      const result = detectIntegrationModel(dir, { timeoutMs: 1000, onDegrade: () => { throw new Error('boom'); } });
      assert.strictEqual(result, 'local-merge');
    });
    assert.strictEqual(gh.count(), 2);
  } finally {
    gh.restore();
  }
});

test('detectIntegrationModel: gh absent with a remote -> local-merge, no degrade (AC5.1)', () => {
  const dir = gitRepo({ remote: GH_REMOTE });
  const originalPath = process.env.PATH;
  process.env.PATH = ghAbsentPath();
  const seen = [];
  try {
    assert.strictEqual(detectIntegrationModel(dir, { timeoutMs: 1000, onDegrade: (d) => seen.push(d) }), 'local-merge');
    assert.deepStrictEqual(seen, []);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('resolveIntegrationModel: a policy.yml pin never invokes gh (AC7.1)', { skip: STUB_SKIP }, () => {
  const dir = gitRepo({ remote: GH_REMOTE });
  writePolicy(dir, 'integration-model: pr-first\n');
  const gh = fakeGh({ first: 'hang' });
  try {
    assert.strictEqual(resolveIntegrationModel(dir), 'pr-first');
    assert.strictEqual(gh.count(), 0);
  } finally {
    gh.restore();
  }
});

test('resolveForgeProbeTimeoutMs: explicit > valid env > policy > 5000; invalid env falls through to policy', () => {
  const bare = gitRepo();
  const withPolicy = gitRepo();
  writePolicy(withPolicy, 'gh-timeout-ms: 7000\n');
  const outOfRange = gitRepo();
  writePolicy(outOfRange, 'gh-timeout-ms: 90000\n');

  assert.strictEqual(withTimeoutEnv(undefined, () => resolveForgeProbeTimeoutMs(bare)), 5000);
  assert.strictEqual(withTimeoutEnv(undefined, () => resolveForgeProbeTimeoutMs(withPolicy)), 7000);
  assert.strictEqual(withTimeoutEnv('9000', () => resolveForgeProbeTimeoutMs(withPolicy)), 9000);
  for (const bad of ['abc', '0', '90000']) {
    assert.strictEqual(withTimeoutEnv(bad, () => resolveForgeProbeTimeoutMs(withPolicy)), 7000, `env ${bad} falls through to policy`);
  }
  assert.strictEqual(withTimeoutEnv(undefined, () => resolveForgeProbeTimeoutMs(outOfRange)), 5000);
  assert.strictEqual(withTimeoutEnv('9000', () => resolveForgeProbeTimeoutMs(withPolicy, { timeoutMs: 1234 })), 1234);
  for (const bad of [0, -1, 'x', 1.5, null, undefined]) {
    assert.strictEqual(withTimeoutEnv('9000', () => resolveForgeProbeTimeoutMs(withPolicy, { timeoutMs: bad })), 9000, `opts.timeoutMs ${String(bad)} ignored`);
  }
  assert.strictEqual(withTimeoutEnv(undefined, () => resolveForgeProbeTimeoutMs(withPolicy, { timeoutMs: 0 })), 7000);
});

test('resolveForgeProbeTimeoutMs: a non-string repoRoot resolves the default instead of throwing', () => {
  for (const bad of [undefined, null, 42]) {
    assert.strictEqual(withTimeoutEnv(undefined, () => resolveForgeProbeTimeoutMs(bad)), 5000, `repoRoot ${String(bad)}`);
    assert.strictEqual(withTimeoutEnv('9000', () => resolveForgeProbeTimeoutMs(bad)), 9000, `env still wins for ${String(bad)}`);
  }
});

test('the gh probe bound is documented as the resolved gh-timeout-ms, not a fixed 5 s (#4578 AC)', () => {
  const FIXED_5S = /\b5\s?s(?:ec(?:onds?)?)?\s+timeout|timeout of 5\s?s\b|under a 5\s?s\b/i;
  const schemaText = readText(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'policy-schema.js'));
  const at = schemaText.indexOf('function detectIntegrationModel(');
  assert.ok(at > 0, 'detectIntegrationModel must exist');
  // The header comment: the contiguous `//` block directly above the function.
  const linesAbove = schemaText.slice(0, at).trimEnd().split('\n');
  const headerLines = [];
  for (let i = linesAbove.length - 1; i >= 0 && /^\s*\/\//.test(linesAbove[i]); i -= 1) headerLines.unshift(linesAbove[i]);
  const header = headerLines.join('\n');
  assert.match(header, /gh-timeout-ms/, 'the header must name the timeout source');
  assert.doesNotMatch(header, FIXED_5S, 'the header must not state a fixed 5 s timeout');
  const doc = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'forge-detection.md'));
  const twin = doc.slice(doc.indexOf('**Code twin.**'), doc.indexOf('**Dispatcher-inlining note'));
  assert.ok(twin.length > 0, 'the Code twin paragraph must exist');
  assert.match(twin, /gh-timeout-ms/, 'the Code twin paragraph must name the timeout source');
  assert.doesNotMatch(twin, FIXED_5S, 'the Code twin paragraph must not state a fixed 5 s timeout');
  // Go-red control: the pre-#4578 header sentence is exactly what the matcher must flag.
  assert.match('Each check runs under a 5s timeout.', FIXED_5S);
});

test('formatForgeDegrade renders both exact degraded strings', () => {
  assert.strictEqual(
    formatForgeDegrade({ reason: 'timeout', timeoutMs: 1000, attempts: 2 }),
    'forge detection timed out after 1000 ms (x2)',
  );
  assert.strictEqual(
    formatForgeDegrade({ reason: 'timeout-then-exit', timeoutMs: 1000, attempts: 2 }),
    'forge detection timed out after 1000 ms, then gh failed on retry',
  );
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
