'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'release-bootstrap.js');
function run(args) { return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }); }

test('CLI: fresh local-merge root prints the JSON envelope and exits 0', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-cli-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x"}');
  const r = run(['--root', root, '--integration-model', 'local-merge', '--branch', 'main']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdict, 'fresh');
  assert.equal(out.releaseType, 'node');
  assert.deepEqual(out.written, ['release-please-config.json', '.release-please-manifest.json']);
  assert.equal(out.policyRows.length, 2);
});

test('CLI: conflict is an outcome (exit 0, verdict in JSON), missing --integration-model is usage (exit 2)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-cli-'));
  fs.mkdirSync(path.join(root, '.changeset'));
  const r = run(['--root', root, '--integration-model', 'pr-first']);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).verdict, 'conflict');
  const u = run(['--root', root]);
  assert.equal(u.status, 2);
  assert.match(u.stderr, /--integration-model/);
  const unk = run(['--root', root, '--integration-model', 'pr-first', '--bogus']);
  assert.equal(unk.status, 2);
});

test('CLI: --dry-run reports the plan without writing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-cli-'));
  fs.writeFileSync(path.join(root, 'go.mod'), 'module x\n');
  const r = run(['--root', root, '--integration-model', 'pr-first', '--dry-run']);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.releaseType, 'go');
  assert.equal(out.written.length, 3);
  assert.equal(fs.existsSync(path.join(root, 'release-please-config.json')), false);
});

test('CLI: a mistyped --root fails loud rather than springing into existence (F2)', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-cli-'));
  const missing = path.join(parent, 'nope');
  const r = run(['--root', missing, '--integration-model', 'pr-first']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /root is not a directory: .*nope/);
  assert.equal(fs.existsSync(missing), false);
});

test('CLI: a value-expecting flag with a missing or flag-shaped next token is a usage error naming the flag (F2)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-cli-'));
  const r1 = run(['--root', '--integration-model', 'pr-first']);
  assert.equal(r1.status, 2);
  assert.match(r1.stderr, /--root/);
  const r2 = run(['--root', root, '--integration-model', 'pr-first', '--branch']);
  assert.equal(r2.status, 2);
  assert.match(r2.stderr, /--branch/);
});

test('CLI: --integration-model only accepts pr-first, local-merge, or unresolved (F2)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-cli-'));
  const bogus = run(['--root', root, '--integration-model', 'bogus']);
  assert.equal(bogus.status, 2);
  assert.match(bogus.stderr, /--integration-model/);
  const unresolved = run(['--root', root, '--integration-model', 'unresolved']);
  assert.equal(unresolved.status, 0);
  assert.equal(JSON.parse(unresolved.stdout).verdict, 'skipped');
});

test('CLI: --branch must be a valid git branch name — usage exit 2 naming the flag; the default main is unaffected (ledger row 34)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-cli-'));
  const r = run(['--root', root, '--integration-model', 'pr-first', '--branch', 'a b']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--branch/);
});
