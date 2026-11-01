// tests/resolve-policy-cli.test.js — spawn tests for bin/resolve-policy.js
// (#329). Every test builds a throwaway fixture repo under os.tmpdir() —
// NEVER inside this repo, where `git rev-parse --show-toplevel` from the
// fixture dir would resolve THIS repo's root and read the live policy.yml
// (IL-80's scheduled-failure trap) — copies frozen fixture files from
// tests/fixtures/resolve-policy/ into it, and spawns the CLI with cwd set to
// the temp dir. os.tmpdir() is outside any git repo, so the CLI's repo-root
// resolution falls back to the spawn cwd, which is exactly the fixture root.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'resolve-policy.js');
const FIXTURES = path.join(__dirname, 'fixtures', 'resolve-policy');

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// Builds a fixture repo root in a fresh temp dir. `policy` names a frozen
// fixture copied to {tmp}/.claude-tweaks/policy.yml (omit for no policy
// file). `runConfig` names one copied to {tmp}/run/config.yml; pass null to
// create the run dir WITHOUT a config.yml.
function makeFixtureRepo({ policy, runConfig } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-policy-'));
  tempDirs.push(tmp);
  if (policy) {
    fs.mkdirSync(path.join(tmp, '.claude-tweaks'));
    fs.copyFileSync(path.join(FIXTURES, policy), path.join(tmp, '.claude-tweaks', 'policy.yml'));
  }
  let runDir = null;
  if (runConfig !== undefined) {
    runDir = path.join(tmp, 'run');
    fs.mkdirSync(runDir);
    if (runConfig !== null) fs.copyFileSync(path.join(FIXTURES, runConfig), path.join(runDir, 'config.yml'));
  }
  return { tmp, runDir };
}

function runCli(args, cwd, env = process.env) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
}

// Success-path invariants asserted in one place: exit 0, silent stderr, and
// stdout that is exactly one JSON object line.
function runOk(args, cwd, env) {
  const res = runCli(args, cwd, env);
  assert.strictEqual(res.status, 0, `expected exit 0, got ${res.status}; stderr: ${res.stderr}`);
  assert.strictEqual(res.stderr, '', 'success paths write nothing to stderr');
  assert.strictEqual(res.stdout, `${res.stdout.trim()}\n`, 'stdout is one JSON line, no trailing prose');
  return JSON.parse(res.stdout);
}

test('AC 1: autonomy set in policy.yml resolves with source policy', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-basic.yml' });
  const out = runOk(['autonomy'], tmp);
  assert.deepStrictEqual(out, { autonomy: { value: 'unattended', source: 'policy' } });
});

test('AC 2: key absent from the fixture resolves to the schema default', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-empty.yml' });
  const out = runOk(['autonomy'], tmp);
  assert.deepStrictEqual(out, { autonomy: { value: 'supervised', source: 'default' } });
  assert.ok(!('invalid' in out.autonomy), 'known-but-unset carries no invalid flag');
});

test('AC 2 variant: no policy.yml at all still resolves defaults', () => {
  const { tmp } = makeFixtureRepo({});
  const out = runOk(['autonomy'], tmp);
  assert.deepStrictEqual(out, { autonomy: { value: 'supervised', source: 'default' } });
});

test('AC 3: --run overlay wins for its keys; absent keys fall to policy, then default', () => {
  const { tmp, runDir } = makeFixtureRepo({ policy: 'policy-basic.yml', runConfig: 'run-config-override.yml' });
  const out = runOk(['--run', runDir, 'dispatch-retry-ceiling', 'autonomy', 'tidy-aggressiveness'], tmp);
  assert.deepStrictEqual(out['dispatch-retry-ceiling'], { value: 7, source: 'run-config' });
  assert.deepStrictEqual(out.autonomy, { value: 'unattended', source: 'policy' });
  assert.deepStrictEqual(out['tidy-aggressiveness'], { value: 'moderate', source: 'default' });
});

test('AC 4: unknown key is a per-key error entry; siblings still resolve; exit 0', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-basic.yml' });
  const out = runOk(['made-up-lever', 'autonomy'], tmp);
  assert.deepStrictEqual(out['made-up-lever'], { error: 'unknown-key' });
  assert.ok(!('value' in out['made-up-lever']) && !('source' in out['made-up-lever']), 'error entries carry no value/source');
  assert.deepStrictEqual(out.autonomy, { value: 'unattended', source: 'policy' });
});

test('AC 5: alias-only fixture resolves dispatch-batch-size with renamed-from', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-alias.yml' });
  const out = runOk(['dispatch-batch-size'], tmp);
  assert.deepStrictEqual(out['dispatch-batch-size'], {
    value: 5,
    source: 'policy',
    'renamed-from': 'dispatch-pick-max-concurrent',
  });
});

test('AC 6: integer and boolean keys arrive as native JSON types, never strings', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-basic.yml' });
  const out = runOk(['dispatch-retry-ceiling', 'worktree-always'], tmp);
  assert.strictEqual(typeof out['dispatch-retry-ceiling'].value, 'number');
  assert.strictEqual(out['dispatch-retry-ceiling'].value, 5);
  assert.strictEqual(typeof out['worktree-always'].value, 'boolean');
  assert.strictEqual(out['worktree-always'].value, true);
});

test('AC 7: malformed value resolves to the schema default with invalid: true', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-invalid.yml' });
  const out = runOk(['trust-revert-window-days'], tmp);
  assert.deepStrictEqual(out['trust-revert-window-days'], { value: 14, source: 'default', invalid: true });
});

test('AC 8: run-config unattended-tier: off resolves autonomy to the default with renamed-from', () => {
  const { tmp, runDir } = makeFixtureRepo({ runConfig: 'run-config-unattended-tier.yml' });
  const out = runOk(['--run', runDir, 'autonomy'], tmp);
  assert.deepStrictEqual(out.autonomy, {
    value: 'supervised',
    source: 'default',
    'renamed-from': 'unattended-tier',
  });
});

test('AC 9: model-profiles absent -> null/default; present -> parsed rows with source policy', () => {
  const absent = makeFixtureRepo({ policy: 'policy-empty.yml' });
  const absentOut = runOk(['model-profiles'], absent.tmp);
  assert.deepStrictEqual(absentOut['model-profiles'], { value: null, source: 'default' });

  const present = makeFixtureRepo({ policy: 'policy-model-profiles.yml' });
  const presentOut = runOk(['model-profiles'], present.tmp);
  assert.deepStrictEqual(presentOut['model-profiles'], {
    value: { capable: { model: 'opus', effort: 'high' } },
    source: 'policy',
  });
});

test('model-profiles malformed block resolves to null/default with invalid: true', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-model-profiles-bad.yml' });
  const out = runOk(['model-profiles'], tmp);
  assert.deepStrictEqual(out['model-profiles'], { value: null, source: 'default', invalid: true });
});

test('AC 10: CLAUDE_PLUGIN_ROOT is never read — deleted env and decoy env both resolve the fixture', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-basic.yml' });
  const deleted = { ...process.env };
  delete deleted.CLAUDE_PLUGIN_ROOT;
  const out = runOk(['autonomy'], tmp, deleted);
  assert.deepStrictEqual(out, { autonomy: { value: 'unattended', source: 'policy' } });

  // Discriminating half: point the var at a decoy repo whose policy.yml holds
  // a DIFFERENT value — a CLI that read the var (even with a cwd fallback)
  // would return the decoy's value, not the fixture's.
  const decoy = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-policy-decoy-'));
  tempDirs.push(decoy);
  fs.mkdirSync(path.join(decoy, '.claude-tweaks'));
  fs.writeFileSync(path.join(decoy, '.claude-tweaks', 'policy.yml'), 'autonomy: trusted\n');
  const out2 = runOk(['autonomy'], tmp, { ...process.env, CLAUDE_PLUGIN_ROOT: decoy });
  assert.deepStrictEqual(out2, { autonomy: { value: 'unattended', source: 'policy' } });
});

test('--run pointing at a FILE (not a dir): exit 1, stderr message, no JSON', () => {
  const { tmp, runDir } = makeFixtureRepo({ policy: 'policy-basic.yml', runConfig: 'run-config-override.yml' });
  const res = runCli(['--run', path.join(runDir, 'config.yml'), 'autonomy'], tmp);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /does not exist or is not a directory/);
  assert.strictEqual(res.stdout, '');
});

test('--values: one plain value per line in request order, native rendering', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-basic.yml' });
  const res = runCli(['--values', 'autonomy', 'dispatch-retry-ceiling', 'worktree-always', 'tidy-aggressiveness'], tmp);
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stderr, '');
  assert.strictEqual(res.stdout, 'unattended\n5\ntrue\nmoderate\n');
});

test('--values: unknown key and unset no-default key each print an empty line', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-empty.yml' });
  const res = runCli(['--values', 'no-such-key', 'integration-branch', 'autonomy'], tmp);
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout, '\n\nsupervised\n');
});

test('--values: unset list-typed key ([] default) prints an empty line — empty-means-none preserved', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-empty.yml' });
  const res = runCli(['--values', 'merge-sensitive-paths', 'autonomy'], tmp);
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout, '\nsupervised\n');
});

test('--values with model-profiles: exit 1, stderr message, no output', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-model-profiles.yml' });
  const res = runCli(['--values', 'model-profiles'], tmp);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /no scalar form/);
  assert.strictEqual(res.stdout, '');
});

test('zero positional keys: exit 1, stderr usage message, no JSON on stdout', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-basic.yml' });
  const res = runCli([], tmp);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /usage/);
  assert.strictEqual(res.stdout, '');
});

test('nonexistent --run dir: exit 1, stderr message, no JSON on stdout', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-basic.yml' });
  const res = runCli(['--run', path.join(tmp, 'no-such-run'), 'autonomy'], tmp);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /does not exist/);
  assert.strictEqual(res.stdout, '');
});

test('existing --run dir WITHOUT config.yml: exit 0, no overlay', () => {
  const { tmp, runDir } = makeFixtureRepo({ policy: 'policy-basic.yml', runConfig: null });
  const out = runOk(['--run', runDir, 'autonomy'], tmp);
  assert.deepStrictEqual(out, { autonomy: { value: 'unattended', source: 'policy' } });
});

test('--all: emits every schema key, decorated with all seven metadata fields', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-basic.yml' });
  const out = runOk(['--all'], tmp);
  const expectedKeys = POLICY_KEYS.map((row) => row.key).sort();
  assert.deepStrictEqual(Object.keys(out).sort(), expectedKeys);
  const validSources = ['run-config', 'policy', 'default'];
  for (const row of POLICY_KEYS) {
    const entry = out[row.key];
    for (const field of ['value', 'source', 'summary', 'category', 'tier', 'type', 'default']) {
      assert.ok(Object.prototype.hasOwnProperty.call(entry, field), `${row.key} missing field ${field}`);
    }
    const expectedDefault = row.default === undefined ? null : row.default;
    assert.deepStrictEqual(entry.default, expectedDefault, `${row.key} default mismatch`);
    assert.ok(validSources.includes(entry.source), `${row.key} has an invalid source: ${entry.source}`);
  }
  assert.strictEqual(out['model-profiles'].type, 'map');
  assert.strictEqual(out['model-profiles'].default, null);
});

test('--all --values: mutually exclusive, exit non-zero, stderr message', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-basic.yml' });
  const res = runCli(['--all', '--values'], tmp);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /resolve-policy:/);
});

test('--all with a key argument: rejected, exit non-zero, stderr message', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-basic.yml' });
  const res = runCli(['--all', 'some-key'], tmp);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /resolve-policy:/);
});

test('--all --run <fixture-dir>: run-config overlay applies within the decorated output', () => {
  const { tmp, runDir } = makeFixtureRepo({ policy: 'policy-basic.yml', runConfig: 'run-config-scope-creep.yml' });
  const out = runOk(['--all', '--run', runDir], tmp);
  assert.strictEqual(out['scope-creep'].value, 'drop');
  assert.strictEqual(out['scope-creep'].source, 'run-config');
});

test('--all spot-check: scope-creep entry matches a plain single-key invocation in the same fixture state', () => {
  const { tmp, runDir } = makeFixtureRepo({ policy: 'policy-basic.yml', runConfig: 'run-config-scope-creep.yml' });
  const allOut = runOk(['--all', '--run', runDir], tmp);
  const singleOut = runOk(['--run', runDir, 'scope-creep'], tmp);
  assert.deepStrictEqual(
    { value: allOut['scope-creep'].value, source: allOut['scope-creep'].source },
    { value: singleOut['scope-creep'].value, source: singleOut['scope-creep'].source },
  );
});

test('comma-joined --values resolves identically to the space-separated multi-key form', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-basic.yml' });
  const commaJoined = runCli(['--values', 'autonomy,dispatch-retry-ceiling,worktree-always'], tmp);
  const spaceSeparated = runCli(['--values', 'autonomy', 'dispatch-retry-ceiling', 'worktree-always'], tmp);
  assert.strictEqual(commaJoined.status, 0);
  assert.strictEqual(commaJoined.stderr, '');
  assert.strictEqual(commaJoined.stdout, spaceSeparated.stdout);
  assert.strictEqual(commaJoined.stdout, 'unattended\n5\ntrue\n');
});

test('comma-joined default JSON-envelope mode resolves identically to the space-separated multi-key form', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-basic.yml' });
  const commaJoined = runOk(['autonomy,worktree-always'], tmp);
  const spaceSeparated = runOk(['autonomy', 'worktree-always'], tmp);
  assert.deepStrictEqual(commaJoined, spaceSeparated);
  assert.deepStrictEqual(commaJoined, {
    autonomy: { value: 'unattended', source: 'policy' },
    'worktree-always': { value: true, source: 'policy' },
  });
});

test('comma-joined list with one unknown key: that key still errors, siblings still resolve', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-basic.yml' });
  const out = runOk(['made-up-lever,autonomy'], tmp);
  assert.deepStrictEqual(out['made-up-lever'], { error: 'unknown-key' });
  assert.deepStrictEqual(out.autonomy, { value: 'unattended', source: 'policy' });
});

test('--all rejects a comma-joined key argument the same as a plain one', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-basic.yml' });
  const res = runCli(['--all', 'autonomy,worktree-always'], tmp);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /resolve-policy:/);
  assert.strictEqual(res.stdout, '');
});

test('--values with a comma-joined list containing model-profiles still trips the no-scalar-form rejection', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-basic.yml' });
  const res = runCli(['--values', 'autonomy,model-profiles'], tmp);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /no scalar form/);
  assert.strictEqual(res.stdout, '');
});

test('--values: an invalid --run value warns on stderr naming key, rejected value and default; stdout and exit unchanged', () => {
  const { tmp, runDir } = makeFixtureRepo({ runConfig: 'run-config-invalid.yml' });
  const res = runCli(['--values', '--run', runDir, 'trust-revert-window-days', 'autonomy'], tmp);
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout, '14\nsupervised\n');
  assert.strictEqual(
    res.stderr,
    'resolve-policy: warning: trust-revert-window-days has invalid value "banana" — using default "14"\n',
  );
});

test('--values with only valid keys (run-config overlay + policy): stderr is empty', () => {
  const { tmp, runDir } = makeFixtureRepo({ policy: 'policy-basic.yml', runConfig: 'run-config-override.yml' });
  const res = runCli(['--values', '--run', runDir, 'dispatch-retry-ceiling', 'autonomy'], tmp);
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout, '7\nunattended\n');
  assert.strictEqual(res.stderr, '');
});

test('--values: a key requested twice warns once per request, in request order', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-invalid.yml' });
  const res = runCli(['--values', 'trust-revert-window-days', 'trust-revert-window-days'], tmp);
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout, '14\n14\n');
  const line = 'resolve-policy: warning: trust-revert-window-days has invalid value "banana" — using default "14"\n';
  assert.strictEqual(res.stderr, line + line);
});

test('--values: an invalid derived-default key names the derived default, not the schema literal', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-invalid-derived.yml' });
  const res = runCli(['--values', 'housekeeping-auto-merge'], tmp);
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout, 'true\n');
  assert.strictEqual(res.stderr, 'resolve-policy: warning: housekeeping-auto-merge has invalid value "maybe" — using default "true"\n');
});

test('--all with an invalid value writes nothing to stderr (the flag carries it)', () => {
  const { tmp } = makeFixtureRepo({ policy: 'policy-invalid.yml' });
  const res = runCli(['--all'], tmp);
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stderr, '');
  assert.strictEqual(JSON.parse(res.stdout)['trust-revert-window-days'].invalid, true);
});

// --- #4578: a degraded forge detection (gh timed out, then failed its retry) is
// surfaced as one stderr line per key plus an additive `degraded` reason code,
// and the merge-verification fallback honours a `--run` integration-model pin
// before any forge detection. A fake `gh` (tests/helpers/fake-gh.js) stands in
// for the forge; the gh timeout is pinned to the 1000 ms floor via the env var.

const { execFileSync } = require('node:child_process');
const { STUB_SKIP } = require('./helpers/path-stub');
const { fakeGh } = require('./helpers/fake-gh');

// Built per call, after fakeGh() has put its stub dir on process.env.PATH.
const timeoutEnv = () => ({ ...process.env, CLAUDE_TWEAKS_GH_TIMEOUT_MS: '1000', GH_REPO: '', GH_HOST: '' });
const PIN_TAIL = 'resolved local-merge — pin integration-model in .claude-tweaks/policy.yml or raise gh-timeout-ms';
const TEXT_X2 = 'forge detection timed out after 1000 ms (x2)';
const TEXT_THEN_EXIT = 'forge detection timed out after 1000 ms, then gh failed on retry';
const degradedLine = (key, text) => `resolve-policy: degraded — ${key}: ${text}; ${PIN_TAIL}`;

// A real git repo with an `origin` remote (so detection reaches `gh`), optionally
// a policy.yml and a .github/workflows file.
function forgeRepo({ policy = null, workflow = null } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rp-forge-')));
  tempDirs.push(dir);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', 'https://github.com/o/n.git');
  if (policy !== null) {
    fs.mkdirSync(path.join(dir, '.claude-tweaks'));
    fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), policy);
  }
  if (workflow !== null) {
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), workflow);
  }
  return dir;
}

// A run dir outside every checkout (the anchored-or-outside guard accepts it).
function runDirWith(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rp-run-'));
  tempDirs.push(dir);
  if (config !== null) fs.writeFileSync(path.join(dir, 'config.yml'), config);
  return dir;
}

const degradedLines = (stderr) => stderr.split('\n').filter((l) => /degraded — /.test(l));

test('degraded detection: JSON mode prints local-merge, source default, a degraded field, and exactly one degraded stderr line (AC6.1)', { skip: STUB_SKIP }, () => {
  const repo = forgeRepo();
  const gh = fakeGh({ first: 'hang' });
  try {
    const res = runCli(['integration-model'], repo, timeoutEnv());
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(JSON.parse(res.stdout)['integration-model'], { value: 'local-merge', source: 'default', degraded: 'timeout' });
    assert.deepStrictEqual(degradedLines(res.stderr), [degradedLine('integration-model', TEXT_X2)]);
    assert.strictEqual(res.stderr, `${degradedLine('integration-model', TEXT_X2)}\n`);
  } finally {
    gh.restore();
  }
});

test('degraded detection: --values prints only local-merge on stdout (AC6.2)', { skip: STUB_SKIP }, () => {
  const repo = forgeRepo();
  const gh = fakeGh({ first: 'hang' });
  try {
    const res = runCli(['--values', 'integration-model'], repo, timeoutEnv());
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, 'local-merge\n');
    assert.deepStrictEqual(degradedLines(res.stderr), [degradedLine('integration-model', TEXT_X2)]);
  } finally {
    gh.restore();
  }
});

test('degraded detection: --all prints the one integration-model degraded line (merge-verification reuses that detection, carrying the field only), stdout still one JSON line', { skip: STUB_SKIP }, () => {
  const repo = forgeRepo();
  const gh = fakeGh({ first: 'hang' });
  try {
    const res = runCli(['--all'], repo, timeoutEnv());
    assert.strictEqual(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.strictEqual(parsed['integration-model'].degraded, 'timeout');
    assert.strictEqual(parsed['merge-verification'].degraded, 'timeout');
    assert.deepStrictEqual(degradedLines(res.stderr), [degradedLine('integration-model', TEXT_X2)]);
    assert.strictEqual(res.stdout, `${res.stdout.trim()}\n`);
  } finally {
    gh.restore();
  }
});

test('degraded detection: a key requested twice still prints one degraded line', { skip: STUB_SKIP }, () => {
  const repo = forgeRepo();
  const gh = fakeGh({ first: 'hang' });
  try {
    const res = runCli(['integration-model', 'integration-model'], repo, timeoutEnv());
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(degradedLines(res.stderr), [degradedLine('integration-model', TEXT_X2)]);
  } finally {
    gh.restore();
  }
});

test('degraded detection: timeout then a failed retry prints its own text (Q6, AC16.2)', { skip: STUB_SKIP }, () => {
  const repo = forgeRepo();
  const gh = fakeGh({ first: 'hang', rest: 'fail' });
  try {
    const res = runCli(['integration-model'], repo, timeoutEnv());
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(JSON.parse(res.stdout)['integration-model'].degraded, 'timeout-then-exit');
    assert.deepStrictEqual(degradedLines(res.stderr), [degradedLine('integration-model', TEXT_THEN_EXIT)]);
    assert.strictEqual(gh.count(), 2);
  } finally {
    gh.restore();
  }
});

test('degraded detection: a merge-verification-only request prints its own degraded line and field (Q7, AC17.1, AC19.1)', { skip: STUB_SKIP }, () => {
  const repo = forgeRepo();
  const gh = fakeGh({ first: 'hang' });
  try {
    const res = runCli(['merge-verification'], repo, timeoutEnv());
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(JSON.parse(res.stdout)['merge-verification'], { value: 'off', source: 'default', degraded: 'timeout' });
    assert.deepStrictEqual(degradedLines(res.stderr), [degradedLine('merge-verification', TEXT_X2)]);
    assert.strictEqual(
      degradedLines(res.stderr)[0],
      'resolve-policy: degraded — merge-verification: forge detection timed out after 1000 ms (x2); resolved local-merge — pin integration-model in .claude-tweaks/policy.yml or raise gh-timeout-ms',
    );
  } finally {
    gh.restore();
  }
});

test('degraded detection: merge-verification timeout then a failed retry prints the integration-model key\'s text (Q9, AC19.1, AC19.2)', { skip: STUB_SKIP }, () => {
  const repo = forgeRepo();
  const gh = fakeGh({ first: 'hang', rest: 'fail' });
  try {
    const res = runCli(['merge-verification'], repo, timeoutEnv());
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(JSON.parse(res.stdout)['merge-verification'].degraded, 'timeout-then-exit');
    assert.deepStrictEqual(degradedLines(res.stderr), [degradedLine('merge-verification', TEXT_THEN_EXIT)]);
    assert.doesNotMatch(res.stderr, /derived from/);
    assert.strictEqual(gh.count(), 2);
  } finally {
    gh.restore();
  }
});

test('a policy.yml pin or a --run config.yml pin never invokes gh (AC7.1)', { skip: STUB_SKIP }, () => {
  const gh = fakeGh({ first: 'hang' });
  try {
    const policyRepo = forgeRepo({ policy: 'integration-model: pr-first\n' });
    const viaPolicy = runCli(['--values', 'integration-model'], policyRepo, timeoutEnv());
    assert.strictEqual(viaPolicy.status, 0, viaPolicy.stderr);
    assert.strictEqual(viaPolicy.stdout, 'pr-first\n');
    assert.strictEqual(gh.count(), 0);

    const runRepo = forgeRepo();
    const runDir = runDirWith('integration-model: pr-first\n');
    const viaRun = runCli(['--values', '--run', runDir, 'integration-model'], runRepo, timeoutEnv());
    assert.strictEqual(viaRun.status, 0, viaRun.stderr);
    assert.strictEqual(viaRun.stdout, 'pr-first\n');
    assert.strictEqual(gh.count(), 0);
  } finally {
    gh.restore();
  }
});

test('merge-verification-only request: a --run config.yml integration-model pin never invokes gh (Q8, AC18.3)', { skip: STUB_SKIP }, () => {
  // No .github/workflows: deriveMergeVerification's ladder branch (2) answers
  // `off` before its own default-branch gh lookup, so any gh call counted here
  // is forge detection.
  const gh = fakeGh({ first: 'hang' });
  try {
    for (const pin of ['pr-first', 'local-merge']) {
      const repo = forgeRepo();
      const runDir = runDirWith(`integration-model: ${pin}\n`);
      const before = gh.count();
      const res = runCli(['--run', runDir, 'merge-verification'], repo, timeoutEnv());
      assert.strictEqual(res.status, 0, res.stderr);
      assert.deepStrictEqual(JSON.parse(res.stdout)['merge-verification'], { value: 'off', source: 'default' }, pin);
      assert.deepStrictEqual(degradedLines(res.stderr), [], pin);
      assert.strictEqual(gh.count(), before, `${pin}: a run pin short-circuits before any gh spawn`);
    }
    // Control: the same call with no --run reaches forge detection (2 invocations
    // — a timeout and its retry) and degrades, so the pinned zero is not vacuous.
    const repo = forgeRepo();
    const before = gh.count();
    const res = runCli(['merge-verification'], repo, timeoutEnv());
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(gh.count() - before, 2);
    assert.deepStrictEqual(degradedLines(res.stderr), [degradedLine('merge-verification', TEXT_X2)]);
  } finally {
    gh.restore();
  }
});
