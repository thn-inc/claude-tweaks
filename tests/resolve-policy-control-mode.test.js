// tests/resolve-policy-control-mode.test.js — #4609: the thirteen flat
// control-mode policy keys, the `element` list validation they introduced, and
// isControlModeOn. Every test builds a throwaway fixture repo under
// os.tmpdir() (never inside this repo — IL-80), writes policy.yml into it, and
// spawns bin/resolve-policy.js with cwd set there. The keys are inert: nothing
// reads them yet, so this file pins only resolution and validation.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolvePolicyKeys } = require('../plugin/bin/lib/policy-schema');
const { isControlModeOn } = require('../plugin/bin/lib/policy');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'resolve-policy.js');

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function makeRepo(policy) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-policy-control-'));
  tempDirs.push(tmp);
  spawnSync('git', ['init', '-q'], { cwd: tmp });
  if (policy !== undefined) {
    fs.mkdirSync(path.join(tmp, '.claude-tweaks'));
    fs.writeFileSync(path.join(tmp, '.claude-tweaks', 'policy.yml'), policy);
  }
  return tmp;
}

function values(policy, ...keys) {
  const res = spawnSync(process.execPath, [CLI, '--values', ...keys], { cwd: makeRepo(policy), encoding: 'utf8' });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status };
}

function json(policy, ...keys) {
  const res = spawnSync(process.execPath, [CLI, ...keys], { cwd: makeRepo(policy), encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `expected exit 0, got ${res.status}; stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

test('AC1.1: with no keys set, control-mode, acceptance-target and deploy-reach print their defaults', () => {
  const res = values(undefined, 'control-mode', 'acceptance-target', 'deploy-reach');
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout, 'off\nlocal\nnone\n');
  assert.strictEqual(res.stderr, '');
});

test('AC1.2: each empty list key prints one empty line and exits 0, like merge-sensitive-paths', () => {
  for (const key of ['owned-owners', 'trusted-authors', 'risk-categories', 'merge-sensitive-paths']) {
    const res = values(undefined, key);
    assert.strictEqual(res.status, 0, key);
    assert.strictEqual(res.stdout, '\n', key);
  }
});

test('AC1.4: deploy-wait-seconds prints 900 and deploy-poll-seconds prints 30', () => {
  const res = values(undefined, 'deploy-wait-seconds', 'deploy-poll-seconds');
  assert.strictEqual(res.stdout, '900\n30\n');
});

test('AC1.5: deploy-wait-seconds -1, deploy-poll-seconds 0 and non-integers take the invalid-value path', () => {
  const cases = [
    ['deploy-wait-seconds', '-1', 900],
    ['deploy-wait-seconds', '1.5', 900],
    ['deploy-wait-seconds', 'soon', 900],
    ['deploy-poll-seconds', '0', 30],
    ['deploy-poll-seconds', '2.5', 30],
    ['deploy-poll-seconds', 'often', 30],
  ];
  for (const [key, raw, dflt] of cases) {
    const out = json(`${key}: ${raw}\n`, key);
    assert.deepStrictEqual(out[key], { value: dflt, source: 'default', invalid: true }, `${key}: ${raw}`);
  }
  // The boundary values stay valid: wait 0 disables the wait, poll 1 is the floor.
  assert.deepStrictEqual(json('deploy-wait-seconds: 0\n', 'deploy-wait-seconds')['deploy-wait-seconds'], { value: 0, source: 'policy' });
  assert.deepStrictEqual(json('deploy-poll-seconds: 1\n', 'deploy-poll-seconds')['deploy-poll-seconds'], { value: 1, source: 'policy' });
});

test('AC2.1: control-mode: on prints on', () => {
  const res = values('control-mode: on\n', 'control-mode');
  assert.strictEqual(res.stdout, 'on\n');
  assert.strictEqual(res.stderr, '');
});

test('AC2.2: control-mode: maybe resolves off, flagged invalid, with one stderr warning, never on', () => {
  const out = json('control-mode: maybe\n', 'control-mode');
  assert.deepStrictEqual(out['control-mode'], { value: 'off', source: 'default', invalid: true });
  const res = values('control-mode: maybe\n', 'control-mode');
  assert.strictEqual(res.stdout, 'off\n');
  assert.strictEqual(res.stderr.trim().split('\n').length, 1, 'exactly one warning line');
  assert.match(res.stderr, /control-mode has invalid value "maybe"/);
  // The same path as the pre-existing autonomy lever.
  const autonomy = json('autonomy: maybe\n', 'autonomy');
  assert.deepStrictEqual(autonomy.autonomy, { value: 'supervised', source: 'default', invalid: true });
  // A capital spelling is invalid too, never read as on.
  assert.deepStrictEqual(json('control-mode: ON\n', 'control-mode')['control-mode'], { value: 'off', source: 'default', invalid: true });
});

test('AC3.1: acceptance-target: dev resolves', () => {
  const out = json('acceptance-target: dev\n', 'acceptance-target');
  assert.deepStrictEqual(out['acceptance-target'], { value: 'dev', source: 'policy' });
});

test('AC3.2: acceptance-target: staging is rejected', () => {
  const out = json('acceptance-target: staging\n', 'acceptance-target');
  assert.deepStrictEqual(out['acceptance-target'], { value: 'local', source: 'default', invalid: true });
});

test('every string key returns its value; whitespace-allowed keys keep spaces and drop one matched pair of quotes', () => {
  const policy = [
    'deploy-command: "npm run deploy:dev"',
    'deploy-live-workflow: Deploy to dev',
    'dev-test-account: dev smoke user',
    'dev-base-url: https://dev.example.com',
    'deploy-version-url: https://dev.example.com/version',
    '',
  ].join('\n');
  const res = values(policy, 'deploy-command', 'deploy-live-workflow', 'dev-test-account', 'dev-base-url', 'deploy-version-url');
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stderr, '');
  assert.strictEqual(res.stdout, [
    'npm run deploy:dev',
    'Deploy to dev',
    'dev smoke user',
    'https://dev.example.com',
    'https://dev.example.com/version',
    '',
  ].join('\n'));
  // deploy-reach takes all three of its values.
  for (const reach of ['on-merge', 'command', 'none']) {
    assert.strictEqual(values(`deploy-reach: ${reach}\n`, 'deploy-reach').stdout, `${reach}\n`);
  }
});

test('AC4.6: owned-owners and trusted-authors round-trip a populated list in the raw comma-separated contract form, casing preserved', () => {
  for (const key of ['owned-owners', 'trusted-authors']) {
    const res = values(`${key}: Thn-Inc,acme\n`, key);
    assert.strictEqual(res.stdout, 'Thn-Inc,acme\n', key);
    assert.strictEqual(res.stderr, '', key);
  }
});

test('AC4.7: list elements failing the login rule are rejected', () => {
  const bad = ['""', '@acme', 'acme/repo', 'has space', '{a: 1}', '[Thn-Inc, acme]', 'a,', 'a,,b', ', a'];
  for (const key of ['owned-owners', 'trusted-authors']) {
    for (const raw of bad) {
      const out = json(`${key}: ${raw}\n`, key);
      assert.deepStrictEqual(out[key], { value: [], source: 'default', invalid: true }, `${key}: ${raw}`);
    }
  }
});

test('login rule accepts a bot login and an underscore login', () => {
  for (const login of ['dependabot[bot]', 'user_corp', 'a', '9lives', 'Thn-Inc, acme']) {
    const out = json(`owned-owners: ${login}\n`, 'owned-owners');
    assert.deepStrictEqual(out['owned-owners'], { value: login, source: 'policy' }, login);
  }
});

test('AC4.8: isControlModeOn is true only for the exact string on', () => {
  assert.strictEqual(isControlModeOn('on'), true);
  for (const v of ['ON', 'On', 'yes', 'off', '', ' on', undefined, null, true, 1]) {
    assert.strictEqual(isControlModeOn(v), false, String(v));
  }
});

test('risk-categories accepts extra slugs and rejects a non-slug', () => {
  const ok = json('risk-categories: data-export,pii\n', 'risk-categories');
  assert.deepStrictEqual(ok['risk-categories'], { value: 'data-export,pii', source: 'policy' });
  for (const raw of ['Data_Export', 'Auth', '-lead', 'pii,', 'has space']) {
    const out = json(`risk-categories: ${raw}\n`, 'risk-categories');
    assert.deepStrictEqual(out['risk-categories'], { value: [], source: 'default', invalid: true }, raw);
  }
});

test('deploy-command is cut at a # like every flat value', () => {
  const res = values('deploy-command: curl https://x/#y\n', 'deploy-command');
  assert.strictEqual(res.stdout, 'curl https://x/\n');
});

test('URL keys require http(s) and reject a quoted value', () => {
  for (const key of ['dev-base-url', 'deploy-version-url']) {
    for (const ok of ['https://dev.example.com', 'http://localhost:3000']) {
      assert.deepStrictEqual(json(`${key}: ${ok}\n`, key)[key], { value: ok, source: 'policy' }, `${key}: ${ok}`);
    }
    for (const bad of ['"https://x"', 'not-a-url', 'has space', 'ftp://x']) {
      const out = json(`${key}: ${bad}\n`, key);
      assert.deepStrictEqual(out[key], { value: null, source: 'default', invalid: true }, `${key}: ${bad}`);
    }
  }
});

// Characterization (pre-existing behavior, unchanged): a list row with no
// `element` accepts any text, and a string row with no `pattern` keeps its
// non-blank / whitespace-free rule.
test('a list row without element and a string row without pattern behave as before', () => {
  const resolve = (key, raw) => resolvePolicyKeys([key], { policyRaw: `${key}: ${raw}\n`, runConfigRaw: null })[key];
  for (const raw of ['[a, b]', '@x,,y,', 'has space/{}']) {
    assert.deepStrictEqual(resolve('merge-sensitive-paths', raw), { value: raw, source: 'policy' }, raw);
    assert.deepStrictEqual(resolve('experiment-flag-patterns', raw), { value: raw, source: 'policy' }, raw);
  }
  assert.deepStrictEqual(resolve('integration-branch', 'develop'), { value: 'develop', source: 'policy' });
  assert.deepStrictEqual(resolve('integration-branch', 'not-a-url'), { value: 'not-a-url', source: 'policy' });
  assert.deepStrictEqual(resolve('integration-branch', 'dev branch'), { value: null, source: 'default', invalid: true });
  assert.deepStrictEqual(resolve('release-hook', 'npm run publish'), { value: 'npm run publish', source: 'policy' });
});
