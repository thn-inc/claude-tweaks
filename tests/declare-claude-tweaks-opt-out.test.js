'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { POLICY_KEYS, resolveValue } = require('../plugin/bin/lib/policy-schema');

const ROOT = path.join(__dirname, '..');
const RESOLVER = path.join(ROOT, 'plugin', 'bin', 'resolve-policy.js');

function resolveIn(policyText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'declare-ct-'));
  if (policyText !== null) {
    fs.mkdirSync(path.join(dir, '.claude-tweaks'));
    fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), policyText);
  }
  return execFileSync(process.execPath, [RESOLVER, '--values', 'declare-claude-tweaks'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

test('AC1.2: declare-claude-tweaks is a boolean row defaulting true', () => {
  const row = POLICY_KEYS.find((r) => r.key === 'declare-claude-tweaks');
  assert.ok(row, 'declare-claude-tweaks missing from POLICY_KEYS');
  assert.strictEqual(row.type, 'boolean');
  assert.strictEqual(row.default, true);
  assert.strictEqual(row.tier, 'advanced');
  assert.strictEqual(resolveValue('declare-claude-tweaks', undefined), true);
});

test('AC1.2: unset resolves true, false resolves false, malformed resolves true', () => {
  assert.strictEqual(resolveIn(null), 'true');
  assert.strictEqual(resolveIn('declare-claude-tweaks: false\n'), 'false');
  assert.strictEqual(resolveIn('declare-claude-tweaks: off\n'), 'true');
});
