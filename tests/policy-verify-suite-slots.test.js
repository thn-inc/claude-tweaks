'use strict';
// #5119: pins the verify-suite-slots policy key — the project-wide default for
// how many suites verify.js may run at once on one machine (passed to verify.js
// as --default-suite-slots by the skill prose; a declared
// concurrency.suiteSlots in verify-scope.json wins over it).
const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'resolve-policy.js');

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// A throwaway project under os.tmpdir() (outside any git repo, so the CLI reads
// the spawn cwd as the repo root, never this repo's live policy.yml).
function resolveWith(policyText) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-suite-slots-'));
  tempDirs.push(tmp);
  fs.mkdirSync(path.join(tmp, '.claude-tweaks'));
  fs.writeFileSync(path.join(tmp, '.claude-tweaks', 'policy.yml'), policyText);
  return spawnSync(process.execPath, [CLI, '--values', 'verify-suite-slots'], {
    cwd: tmp, encoding: 'utf8', windowsHide: true,
  });
}

test('AC9.1: verify-suite-slots is an advanced integer key, min 1, default 1', () => {
  const row = POLICY_KEYS.find((k) => k.key === 'verify-suite-slots');
  assert.ok(row, 'verify-suite-slots missing from POLICY_KEYS');
  assert.strictEqual(row.type, 'integer');
  assert.strictEqual(row.min, 1);
  assert.strictEqual(row.default, 1);
  assert.strictEqual(row.tier, 'advanced');
  assert.strictEqual(row.policyOnly, true, 'a run config must never set the slot count');
});

test('AC9.1: resolve-policy prints 1 for an unset verify-suite-slots', () => {
  const result = resolveWith('');
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout.trim(), '1');
});

test('AC9.1: resolve-policy prints a set positive integer, and 1 for a malformed value', () => {
  assert.strictEqual(resolveWith('verify-suite-slots: 3\n').stdout.trim(), '3');
  for (const bad of ['0', 'two']) {
    assert.strictEqual(resolveWith(`verify-suite-slots: ${bad}\n`).stdout.trim(), '1', bad);
  }
});
