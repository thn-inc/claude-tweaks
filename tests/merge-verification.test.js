// tests/merge-verification.test.js — schema shape, PR-CI detection, the
// four-branch derivation ladder, and CLI wiring for the merge-verification
// policy key (#559). Inline/temp fixtures only — never reads this repo's live
// .claude-tweaks/policy.yml (IL-80). Fixture repos are built under os.tmpdir()
// so `git rev-parse --show-toplevel` never resolves THIS repo.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { POLICY_KEYS, resolvePolicyKeys } = require('../plugin/bin/lib/policy-schema');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'resolve-policy.js');
const REPO_ROOT = path.join(__dirname, '..');
const VALUES = ['merge-when-green', 'wait', 'off'];

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// --- Schema shape ---

test('merge-verification is registered as an enum with the three values and no static default', () => {
  const entry = POLICY_KEYS.find((e) => e.key === 'merge-verification');
  assert.ok(entry, 'merge-verification must be registered in POLICY_KEYS');
  assert.equal(entry.type, 'enum');
  assert.deepEqual(entry.values, VALUES);
  assert.equal(entry.default, undefined, 'a static default would bypass the derivation ladder entirely');
  assert.equal(entry.category, 'merge-safety');
});

test('resolvePolicyKeys stays pure for merge-verification — unset resolves to null/default, explicit value verbatim', () => {
  const unset = resolvePolicyKeys(['merge-verification'], { policyRaw: null, runConfigRaw: null });
  assert.deepEqual(unset['merge-verification'], { value: null, source: 'default' });
  const set = resolvePolicyKeys(['merge-verification'], { policyRaw: 'merge-verification: wait\n', runConfigRaw: null });
  assert.deepEqual(set['merge-verification'], { value: 'wait', source: 'policy' });
  const bad = resolvePolicyKeys(['merge-verification'], { policyRaw: 'merge-verification: sideways\n', runConfigRaw: null });
  assert.deepEqual(bad['merge-verification'], { value: null, source: 'default', invalid: true });
});

// --- PR-CI detection ---

const mv = require('../plugin/bin/lib/merge-verification');

test('workflowHasPullRequestTrigger: every legal on: shape that names pull_request(_target)', () => {
  const yes = [
    'name: a\non: pull_request\njobs: {}\n',
    'name: a\non: pull_request_target\n',
    "name: a\n'on': pull_request\n",
    'name: a\n"on": [push, pull_request]\n',
    'name: a\non: [push, pull_request]\n',
    'name: a\non: [ push , "pull_request" ]\n',
    'name: a\non:\n  push:\n    branches: [main]\n  pull_request:\n\njobs: {}\n',
    'name: a\non:\n  pull_request:\n    types: [opened]\n',
    'name: a\non:\n  - push\n  - pull_request\n',
    'name: a\non: { pull_request: { branches: [main] } }\n',
    // depth-1 key still counts alongside a nested value under a different trigger
    'name: a\non: { push: { branches: [main] }, pull_request: {} }\n',
    'name: a\n\n# comment\non:\n  # leading comment inside the block\n  pull_request_target:\n',
    // leading UTF-8 BOM must not shift the on: line-anchor regex off col 0
    '﻿name: a\non: pull_request\n',
    // a tab (not just a literal space) before the comment marker still counts as a comment start
    'name: a\non: pull_request\t# ci\n',
  ];
  for (const text of yes) assert.equal(mv.workflowHasPullRequestTrigger(text), true, JSON.stringify(text));
});

test('workflowHasPullRequestTrigger: push-only, nested-only, and no on: block do not count', () => {
  const no = [
    'name: a\non: push\n',
    'name: a\non: [push, workflow_dispatch]\n',
    'name: a\non:\n  push:\n    branches: [main]\n  schedule:\n    - cron: "0 0 * * *"\n',
    // pull_request appearing only as a NESTED key (deeper than the trigger level) is not a trigger
    'name: a\non:\n  push:\n    pull_request: nonsense\n',
    // same nesting rule inside a flow mapping: pull_request is nested inside push's value, not depth 1
    'name: a\non: { push: { pull_request: true } }\n',
    // a job step mentioning pull_request is not a trigger
    'name: a\non: push\njobs:\n  x:\n    steps:\n      - run: echo pull_request\n',
    'name: a\njobs: {}\n',
    '',
  ];
  for (const text of no) assert.equal(mv.workflowHasPullRequestTrigger(text), false, JSON.stringify(text));
});

test('hasPullRequestCi: injected reader — any workflow with a PR trigger counts; none, empty dir, or a throwing reader do not', () => {
  const two = () => [{ name: 'a.yml', text: 'on: push\n' }, { name: 'b.yaml', text: 'on: [push, pull_request]\n' }];
  assert.equal(mv.hasPullRequestCi('/nonexistent', { readWorkflows: two }), true);
  assert.equal(mv.hasPullRequestCi('/nonexistent', { readWorkflows: () => [{ name: 'a.yml', text: 'on: push\n' }] }), false);
  assert.equal(mv.hasPullRequestCi('/nonexistent', { readWorkflows: () => [] }), false);
  assert.equal(mv.hasPullRequestCi('/nonexistent', { readWorkflows: () => { throw new Error('EACCES'); } }), false, 'read failure resolves toward off');
});

test('readWorkflowFiles: reads .yml and .yaml under .github/workflows, [] when the dir is absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-mv-wf-'));
  tempDirs.push(dir);
  assert.deepEqual(mv.readWorkflowFiles(dir), []);
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'a.yml'), 'on: push\n');
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'b.yaml'), 'on: pull_request\n');
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'README.md'), 'not a workflow\n');
  const files = mv.readWorkflowFiles(dir).map((f) => f.name).sort();
  assert.deepEqual(files, ['a.yml', 'b.yaml']);
  assert.equal(mv.hasPullRequestCi(dir), true);
});

// --- Derivation ladder ---

// A lookup that must never run: records the call AND throws, so a
// non-short-circuiting ladder fails the never-called assertion even
// though the ladder swallows the throw on its way to 'off'.
function neverCalled(label) {
  const spy = () => { spy.calls += 1; throw new Error(`${label} must not be consulted`); };
  spy.calls = 0;
  return spy;
}
const prCi = () => [{ name: 'ci.yml', text: 'on: [push, pull_request]\n' }];
const pushOnly = () => [{ name: 'ci.yml', text: 'on: push\n' }];

test('branch (1): integration-model local-merge -> off, short-circuiting before any workflow read', () => {
  const wf = neverCalled('workflow reader');
  const ib = neverCalled('integration-branch lookup');
  const db = neverCalled('default-branch lookup');
  const value = mv.deriveMergeVerification('/nonexistent', {
    integrationModel: () => 'local-merge',
    readWorkflows: wf,
    integrationBranch: ib,
    defaultBranch: db,
  });
  assert.equal(value, 'off');
  assert.equal(wf.calls, 0, 'workflow reader must not be consulted');
  assert.equal(ib.calls, 0, 'integration-branch lookup must not be consulted');
  assert.equal(db.calls, 0, 'default-branch lookup must not be consulted');
});

test('branch (2): pr-first but no PR-triggered CI -> off, before any branch lookup', () => {
  const ib = neverCalled('integration-branch lookup');
  const db = neverCalled('default-branch lookup');
  const value = mv.deriveMergeVerification('/nonexistent', {
    integrationModel: () => 'pr-first',
    readWorkflows: pushOnly,
    integrationBranch: ib,
    defaultBranch: db,
  });
  assert.equal(value, 'off');
  assert.equal(ib.calls, 0, 'integration-branch lookup must not be consulted');
  assert.equal(db.calls, 0, 'default-branch lookup must not be consulted');
});

test('branch (3): pr-first + PR CI + integration branch == default branch -> merge-when-green', () => {
  const value = mv.deriveMergeVerification('/nonexistent', {
    integrationModel: () => 'pr-first',
    readWorkflows: prCi,
    integrationBranch: () => 'main',
    defaultBranch: () => 'main',
  });
  assert.equal(value, 'merge-when-green');
});

test('branch (4): pr-first + PR CI + non-default integration branch -> off', () => {
  const value = mv.deriveMergeVerification('/nonexistent', {
    integrationModel: () => 'pr-first',
    readWorkflows: prCi,
    integrationBranch: () => 'dev',
    defaultBranch: () => 'main',
  });
  assert.equal(value, 'off');
});

test('failed lookups resolve toward off: unresolvable branches, throwing branch lookup, throwing integration-model', () => {
  const throwing = () => { throw new Error('boom'); };
  const base = { integrationModel: () => 'pr-first', readWorkflows: prCi };
  assert.equal(mv.deriveMergeVerification('/x', { ...base, integrationBranch: () => null, defaultBranch: () => 'main' }), 'off');
  assert.equal(mv.deriveMergeVerification('/x', { ...base, integrationBranch: () => 'main', defaultBranch: () => null }), 'off');
  assert.equal(mv.deriveMergeVerification('/x', { ...base, integrationBranch: throwing, defaultBranch: () => 'main' }), 'off');
  assert.equal(mv.deriveMergeVerification('/x', { integrationModel: throwing, readWorkflows: prCi, integrationBranch: () => 'main', defaultBranch: () => 'main' }), 'off');
});

test('the ladder never derives wait', () => {
  const combos = [
    { integrationModel: () => 'local-merge' },
    { integrationModel: () => 'pr-first', readWorkflows: pushOnly },
    { integrationModel: () => 'pr-first', readWorkflows: prCi, integrationBranch: () => 'main', defaultBranch: () => 'main' },
    { integrationModel: () => 'pr-first', readWorkflows: prCi, integrationBranch: () => 'dev', defaultBranch: () => 'main' },
  ];
  for (const deps of combos) assert.notEqual(mv.deriveMergeVerification('/x', deps), 'wait');
});

// --- CLI (bin/resolve-policy.js) ---

// A fixture repo with one commit, an origin/HEAD symref (what a clone records,
// set locally so no network is needed), and optional policy + workflow files.
// integration-model is set EXPLICITLY in policy.yml so branch (1) never shells
// out to gh from a fixture.
function fixtureRepo({ policy = 'integration-model: pr-first\n', workflow = null, workflowName = 'ci.yml', defaultBranch = 'main' } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-mv-cli-')));
  tempDirs.push(dir);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
  git('init', '-q', '-b', defaultBranch);
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  git('update-ref', `refs/remotes/origin/${defaultBranch}`, 'HEAD');
  git('symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${defaultBranch}`);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'));
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), policy);
  if (workflow !== null) {
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'workflows', workflowName), workflow);
  }
  return dir;
}

function cli(args, cwd) {
  // The fixture repos above rely on `gh repo view` FAILING (no configured
  // remote) so branch (4)'s local origin/HEAD fallback is what answers — a
  // sandbox that exports GH_REPO/GH_HOST would make `gh` resolve a different,
  // real repo instead and silently break the fixture's assumption.
  const env = { ...process.env, GH_REPO: '', GH_HOST: '' };
  const r = spawnSync('node', [CLI, ...args], { cwd, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('CLI AC1 fixture: pull_request-triggered workflow + integration branch == default -> merge-when-green', () => {
  const dir = fixtureRepo({ workflow: 'name: ci\non:\n  push:\n    branches: [main]\n  pull_request:\njobs: {}\n' });
  assert.equal(cli(['--values', 'merge-verification'], dir).trim(), 'merge-when-green');
});

test('CLI AC2: explicit merge-verification: off wins over the derivation', () => {
  const dir = fixtureRepo({ policy: 'integration-model: pr-first\nmerge-verification: off\n', workflow: 'on: pull_request\n' });
  assert.equal(cli(['--values', 'merge-verification'], dir).trim(), 'off');
});

test('CLI AC3: integration-model local-merge -> off even with a PR workflow present', () => {
  const dir = fixtureRepo({ policy: 'integration-model: local-merge\n', workflow: 'on: pull_request\n' });
  assert.equal(cli(['--values', 'merge-verification'], dir).trim(), 'off');
});

test('CLI AC4: workflows without a pull_request trigger -> off; array form on: [push, pull_request] -> merge-when-green', () => {
  const none = fixtureRepo({ workflow: 'name: ci\non:\n  push:\n    branches: [main]\n  workflow_dispatch:\njobs: {}\n' });
  assert.equal(cli(['--values', 'merge-verification'], none).trim(), 'off');
  const arr = fixtureRepo({ workflow: 'name: ci\non: [push, pull_request]\njobs: {}\n', workflowName: 'ci.yaml' });
  assert.equal(cli(['--values', 'merge-verification'], arr).trim(), 'merge-when-green');
});

test('CLI branch (4): explicit non-default integration-branch -> off', () => {
  const dir = fixtureRepo({ policy: 'integration-model: pr-first\nintegration-branch: dev\n', workflow: 'on: pull_request\n' });
  assert.equal(cli(['--values', 'merge-verification'], dir).trim(), 'off');
});

test('CLI: no repo, no workflows -> off (fail toward the default, never toward stricter)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-mv-bare-'));
  tempDirs.push(dir);
  assert.equal(cli(['--values', 'merge-verification'], dir).trim(), 'off');
});

test('CLI JSON mode: derived value carries source "default"; explicit carries "policy"; invalid keeps invalid: true, not overwritten', () => {
  const derived = JSON.parse(cli(['merge-verification'], fixtureRepo({ workflow: 'on: pull_request\n' })));
  assert.deepEqual(derived['merge-verification'], { value: 'merge-when-green', source: 'default' });
  const explicit = JSON.parse(cli(['merge-verification'], fixtureRepo({ policy: 'integration-model: pr-first\nmerge-verification: wait\n' })));
  assert.deepEqual(explicit['merge-verification'], { value: 'wait', source: 'policy' });
  const invalid = JSON.parse(cli(['merge-verification'], fixtureRepo({ policy: 'integration-model: pr-first\nmerge-verification: sideways\n' })));
  assert.deepEqual(invalid['merge-verification'], { value: null, source: 'default', invalid: true });
});

test('CLI live smoke on this repo resolves a valid enum value (drift-sensitive by nature — the fixtures above are the durable check)', () => {
  const out = cli(['--values', 'merge-verification'], REPO_ROOT).trim();
  assert.ok(VALUES.includes(out), `got ${JSON.stringify(out)}`);
});

// #604: the CLI-level version of this test (below, superseded) exercised the
// AC1 fixture whose `integration-model` is explicit in policy.yml
// (fixtureRepo's own default), so resolveIntegrationModel short-circuited
// before detectIntegrationModel ever ran — the test passed with or without
// the dedup and never actually guarded it. A discriminating fixture needs
// integration-model UNSET so forge detection actually runs, which at the CLI
// level means a real remote + authenticated `gh` in a temp repo (the
// non-determinism this test exists to avoid) — so this exercises
// computeDerivedDefaults directly instead, injecting deps to both count the
// forge-detection call and observe whether merge-verification's derivation
// receives the already-computed value or re-derives it from scratch.
test('computeDerivedDefaults: requesting integration-model and merge-verification together reuses the already-computed integration-model instead of re-detecting it (#559 M1 / #604)', () => {
  const { computeDerivedDefaults } = require('../plugin/bin/lib/policy-derived-defaults');
  let detectCalls = 0;
  let deriveDeps = null;
  const deps = {
    detectIntegrationModel: () => { detectCalls++; return 'pr-first'; },
    deriveMergeVerification: (root, mvDeps) => { deriveDeps = mvDeps; return 'merge-when-green'; },
  };
  // integration-model UNSET (source: 'default', no policy value) — forge
  // detection must actually run for this to discriminate.
  const result = {
    'integration-model': { value: null, source: 'default' },
    'merge-verification': { value: null, source: 'default' },
  };
  const out = computeDerivedDefaults(result, ['integration-model', 'merge-verification'], '/unused-root', deps);

  assert.equal(detectCalls, 1, 'detectIntegrationModel must run exactly once when both keys are requested together');
  assert.deepEqual(out['integration-model'], { value: 'pr-first', source: 'default' });
  // The discriminating assertion: merge-verification's derivation must receive
  // the already-computed integration-model (an injected `integrationModel`
  // dep) rather than an empty deps object that would let deriveMergeVerification
  // re-run forge detection internally — reverting the dedup (passing `{}`
  // unconditionally) makes this fail even though detectCalls above still
  // reads 1, since that path never touches this module's injected stand-in.
  assert.equal(typeof deriveDeps.integrationModel, 'function', 'merge-verification derivation must receive the already-computed integration-model, not re-derive it');
  assert.equal(deriveDeps.integrationModel(), 'pr-first');
  assert.deepEqual(out['merge-verification'], { value: 'merge-when-green', source: 'default' });
});

test('computeDerivedDefaults: an mcpReachable call still reuses an already-resolved integration-model run-config pin instead of re-deriving from forge detection (whole-branch review finding, pre-v6.110.0)', () => {
  const { computeDerivedDefaults } = require('../plugin/bin/lib/policy-derived-defaults');
  let resolveModelCalls = 0;
  let deriveDeps = null;
  const deps = {
    mcpReachable: true,
    resolveIntegrationModel: () => { resolveModelCalls++; return 'pr-first'; },
    deriveMergeVerification: (root, mvDeps) => {
      deriveDeps = mvDeps;
      return mvDeps.integrationModel() === 'local-merge' ? 'off' : 'merge-when-green';
    },
  };
  // integration-model already resolved via a run-config pin (source
  // 'run-config', not 'default') — exactly what resolvePolicyConfig produces
  // for a run whose config.yml pins integration-model: local-merge.
  const result = {
    'integration-model': { value: 'local-merge', source: 'run-config' },
    'merge-verification': { value: null, source: 'default' },
  };
  const out = computeDerivedDefaults(result, ['integration-model', 'merge-verification'], '/unused-root', deps);

  assert.equal(resolveModelCalls, 0, 'a pinned integration-model must not be re-derived from scratch when mcpReachable is set');
  assert.equal(deriveDeps.integrationModel(), 'local-merge');
  assert.deepEqual(out['merge-verification'], { value: 'off', source: 'default' });
});

test('CLI --run precedence: a run-dir config.yml override wins over the derived AC1 default, and JSON mode reports source "run-config" (#559 M5)', () => {
  const dir = fixtureRepo({ workflow: 'name: ci\non:\n  push:\n    branches: [main]\n  pull_request:\njobs: {}\n' });
  // Sanity: without --run, this fixture derives merge-when-green (AC1).
  assert.equal(cli(['--values', 'merge-verification'], dir).trim(), 'merge-when-green');
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-mv-rundir-'));
  tempDirs.push(runDir);
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'merge-verification: wait\n');
  assert.equal(cli(['--run', runDir, '--values', 'merge-verification'], dir).trim(), 'wait');
  const json = JSON.parse(cli(['--run', runDir, 'merge-verification'], dir));
  assert.deepEqual(json['merge-verification'], { value: 'wait', source: 'run-config' });
});

// --- #4578: a degraded forge detection is surfaced; the merge-verification
// fallback honours the run's integration-model pin before detecting ---

const { computeDerivedDefaults: computeDerived } = require('../plugin/bin/lib/policy-derived-defaults');

const DEGRADE_TIMEOUT = { reason: 'timeout', timeoutMs: 1000, attempts: 2 };
const DEGRADE_EXIT = { reason: 'timeout-then-exit', timeoutMs: 1000, attempts: 2 };

test('computeDerivedDefaults: a degraded forge detection adds the reason-code degraded field and reports the degrade object (Q13, AC23.1)', () => {
  const detect = (root, opts) => { opts.onDegrade({ ...DEGRADE_TIMEOUT }); return 'local-merge'; };
  const fresh = () => ({ 'integration-model': { value: null, source: 'default' } });

  const seen = [];
  const out = computeDerived(fresh(), ['integration-model'], '/unused-root', {
    detectIntegrationModel: detect,
    onDegrade: (key, d) => seen.push([key, d]),
  });
  assert.deepEqual(out['integration-model'], { value: 'local-merge', source: 'default', degraded: 'timeout' });
  assert.deepEqual(seen, [['integration-model', DEGRADE_TIMEOUT]]);

  // The side channel is opt-in: no deps.onDegrade still adds the field.
  const noChannel = computeDerived(fresh(), ['integration-model'], '/unused-root', { detectIntegrationModel: detect });
  assert.deepEqual(noChannel['integration-model'], { value: 'local-merge', source: 'default', degraded: 'timeout' });

  // A throwing deps.onDegrade never escapes.
  const thrown = computeDerived(fresh(), ['integration-model'], '/unused-root', {
    detectIntegrationModel: detect,
    onDegrade: () => { throw new Error('reporter broke'); },
  });
  assert.deepEqual(thrown['integration-model'], { value: 'local-merge', source: 'default', degraded: 'timeout' });
});

test('computeDerivedDefaults: a non-degraded detection keeps the entry shape exactly { value, source }', () => {
  let called = 0;
  const out = computeDerived({ 'integration-model': { value: null, source: 'default' } }, ['integration-model'], '/unused-root', {
    detectIntegrationModel: () => 'local-merge',
    onDegrade: () => { called++; },
  });
  assert.deepEqual(out['integration-model'], { value: 'local-merge', source: 'default' });
  assert.equal(called, 0, 'deps.onDegrade is never called without a degrade');
});

test('computeDerivedDefaults: a merge-verification-only request reports a degraded fallback detection (Q7)', () => {
  const fresh = () => ({ 'merge-verification': { value: null, source: 'default' } });
  const seen = [];
  const out = computeDerived(fresh(), ['merge-verification'], '/unused-root', {
    resolveIntegrationModel: (root, opts) => { opts.onDegrade({ ...DEGRADE_EXIT }); return 'local-merge'; },
    onDegrade: (key, d) => seen.push([key, d]),
  });
  assert.deepEqual(out['merge-verification'], { value: 'off', source: 'default', degraded: 'timeout-then-exit' });
  assert.deepEqual(seen, [['merge-verification', DEGRADE_EXIT]]);

  const clean = computeDerived(fresh(), ['merge-verification'], '/unused-root', {
    resolveIntegrationModel: () => 'local-merge',
    onDegrade: () => { throw new Error('must not be called'); },
  });
  assert.deepEqual(clean['merge-verification'], { value: 'off', source: 'default' });
});

test('computeDerivedDefaults: an invalid integration-model entry requested with merge-verification re-detects with onDegrade attached (Q7)', () => {
  const seen = [];
  const out = computeDerived({
    'integration-model': { value: null, source: 'default', invalid: true },
    'merge-verification': { value: null, source: 'default' },
  }, ['integration-model', 'merge-verification'], '/unused-root', {
    resolveIntegrationModel: (root, opts) => { opts.onDegrade({ ...DEGRADE_TIMEOUT }); return 'local-merge'; },
    onDegrade: (key, d) => seen.push([key, d]),
  });
  assert.deepEqual(out['integration-model'], { value: null, source: 'default', invalid: true });
  assert.deepEqual(out['merge-verification'], { value: 'off', source: 'default', degraded: 'timeout' });
  assert.deepEqual(seen, [['merge-verification', DEGRADE_TIMEOUT]]);
});

test('computeDerivedDefaults: merge-verification reusing a degraded integration-model carries the same degraded reason, with one onDegrade call (plan review)', () => {
  const fresh = () => ({
    'integration-model': { value: null, source: 'default' },
    'merge-verification': { value: null, source: 'default' },
  });
  let resolveCalls = 0;
  const seen = [];
  const out = computeDerived(fresh(), ['integration-model', 'merge-verification'], '/unused-root', {
    detectIntegrationModel: (root, opts) => { opts.onDegrade({ ...DEGRADE_TIMEOUT }); return 'local-merge'; },
    resolveIntegrationModel: () => { resolveCalls++; return 'local-merge'; },
    onDegrade: (k) => seen.push(k),
  });
  assert.deepEqual(out['merge-verification'], { value: 'off', source: 'default', degraded: 'timeout' });
  assert.deepEqual(seen, ['integration-model']);
  assert.equal(resolveCalls, 0, 'the reuse path never calls resolveIntegrationModel');

  // control: a clean detection on the same reuse path keeps exactly { value, source }
  const clean = computeDerived(fresh(), ['integration-model', 'merge-verification'], '/unused-root', {
    detectIntegrationModel: () => 'local-merge',
    resolveIntegrationModel: () => { resolveCalls++; return 'local-merge'; },
  });
  assert.deepEqual(clean['merge-verification'], { value: 'off', source: 'default' });
});

test('computeDerivedDefaults: a merge-verification-only request honours the run\'s config.yml integration-model pin before forge detection (Q8, AC18.1, AC18.2)', () => {
  const fresh = () => ({ 'merge-verification': { value: null, source: 'default' } });
  const run = (runConfigRaw) => {
    const probe = { resolveCalls: 0, seenModel: null };
    const deps = {
      resolveIntegrationModel: () => { probe.resolveCalls++; return 'local-merge'; },
      deriveMergeVerification: (root, d) => { probe.seenModel = d.integrationModel(root); return 'merge-when-green'; },
    };
    if (runConfigRaw !== undefined) deps.runConfigRaw = runConfigRaw;
    probe.out = computeDerived(fresh(), ['merge-verification'], '/unused-root', deps);
    return probe;
  };

  const pinned = run('integration-model: pr-first\n');
  assert.equal(pinned.resolveCalls, 0);
  assert.equal(pinned.seenModel, 'pr-first');
  assert.deepEqual(pinned.out['merge-verification'], { value: 'merge-when-green', source: 'default' });

  // Controls: an invalid run value is not a pin (Q12, AC22.1); an absent runConfigRaw is no pin.
  const bogus = run('integration-model: bogus\n');
  assert.equal(bogus.resolveCalls, 1, 'an invalid run value runs detection');
  assert.equal(bogus.seenModel, 'local-merge');
  const absent = run(undefined);
  assert.equal(absent.resolveCalls, 1, 'no runConfigRaw runs detection');
  assert.equal(absent.seenModel, 'local-merge');
});
