'use strict';
// #5757: pins the ci-health-thresholds policy key — the `id=value,id=value` text
// /ci-health hands to `ci-audit.js gather --thresholds`. The resolver only carries
// the text; parseThresholds (ci-audit/checks.js) owns every rejection.
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');
const { parseThresholds } = require('../plugin/bin/lib/ci-audit/checks');
const { runCliSync } = require('./helpers/run-cli');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'resolve-policy.js');

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// A throwaway project under os.tmpdir() (outside any git repo, so the CLI reads
// the spawn cwd as the repo root, never this repo's live policy.yml).
function resolveWith(policyText) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-ci-thresholds-'));
  tempDirs.push(tmp);
  fs.mkdirSync(path.join(tmp, '.claude-tweaks'));
  fs.writeFileSync(path.join(tmp, '.claude-tweaks', 'policy.yml'), policyText);
  const r = runCliSync(CLI, ['--values', 'ci-health-thresholds'], { cwd: tmp, env: { ...process.env } });
  return { status: r.code, stdout: r.stdout, stderr: r.stderr };
}

test('ci-health-thresholds is an advanced string key with no default', () => {
  const row = POLICY_KEYS.find((k) => k.key === 'ci-health-thresholds');
  assert.ok(row, 'ci-health-thresholds missing from POLICY_KEYS');
  assert.strictEqual(row.type, 'string');
  assert.strictEqual(row.tier, 'advanced');
  assert.strictEqual(row.default, undefined);
});

test('resolve-policy prints an empty line for an unset ci-health-thresholds', () => {
  const result = resolveWith('');
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout.trim(), '');
});

test('resolve-policy prints the configured text, which parseThresholds accepts', () => {
  const result = resolveWith('ci-health-thresholds: queue-wait=0.5,shard-skew=2\n');
  assert.strictEqual(result.status, 0, result.stderr);
  const printed = result.stdout.trim();
  assert.strictEqual(printed, 'queue-wait=0.5,shard-skew=2');
  assert.deepStrictEqual(parseThresholds(printed), { ok: true, values: { 'queue-wait': 0.5, 'shard-skew': 2 } });
});

test('a value with spaces around `=` resolves empty with a warning — the documented defaults-in-force fallback', () => {
  const result = resolveWith('ci-health-thresholds: queue-wait = 0.5\n');
  assert.strictEqual(result.stdout.trim(), '');
  assert.match(result.stderr, /ci-health-thresholds/);
});

test('a floor id is carried like a threshold id and parseThresholds accepts it', () => {
  const result = resolveWith('ci-health-thresholds: queue-wait-floor-ms=10000,missing-timeout-floor-ms=600000\n');
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(parseThresholds(result.stdout.trim()),
    { ok: true, values: { 'queue-wait-floor-ms': 10000, 'missing-timeout-floor-ms': 600000 } });
});

test('a malformed threshold text is printed verbatim — parseThresholds owns the rejection', () => {
  const result = resolveWith('ci-health-thresholds: bogus=1,queue-wait=abc\n');
  assert.strictEqual(result.status, 0, result.stderr);
  const printed = result.stdout.trim();
  assert.strictEqual(printed, 'bogus=1,queue-wait=abc');
  assert.strictEqual(parseThresholds(printed).ok, false);
});
