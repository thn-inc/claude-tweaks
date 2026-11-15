'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { spawnCli } = require('../../helpers/run-cli');
const { sweepCli } = require('../../helpers/health-sweep-cli');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'journey-health.js');

// In-process (#5380), with the file-protocol-only git guard — see tests/helpers/health-sweep-cli.js.
const cli = (argv, opts) => sweepCli(CLI, argv, opts);

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'journey-health-cli-qa-evidence-')); }

function writeReport(root, overrides = {}) {
  const report = {
    timestamp: '2026-07-01T00:00:00.000Z',
    stories: [{ id: 'story-1', status: 'PASS' }],
    findings: [],
    ...overrides,
  };
  const file = path.join(root, 'report.json');
  fs.writeFileSync(file, JSON.stringify(report));
  return file;
}

const FIXED_NOW = String(Date.parse('2026-07-11T00:00:00.000Z'));

test('qa-evidence prints satisfied when all named stories passed', () => {
  const root = tmp();
  const reportFile = writeReport(root);
  const res = cli(['qa-evidence', reportFile, '--story-ids', 'story-1', '--now', FIXED_NOW]);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.deepStrictEqual(JSON.parse(res.stdout), { verdict: 'satisfied' });
});

test('qa-evidence prints a regression finding for a code-bug failure', () => {
  const root = tmp();
  const reportFile = writeReport(root, {
    stories: [{ id: 'story-1', status: 'FAIL' }],
    findings: [{ story_id: 'story-1', category: 'code-bug', severity: 'High', finding: 'Checkout button is missing' }],
  });
  const res = cli(['qa-evidence', reportFile, '--story-ids', 'story-1', '--now', FIXED_NOW]);
  assert.strictEqual(res.status, 0, res.stderr);
  const result = JSON.parse(res.stdout);
  assert.strictEqual(result.verdict, 'regression');
  assert.strictEqual(result.finding.severity, 'high');
});

test('qa-evidence prints inconclusive when no story ids are given', () => {
  const root = tmp();
  const reportFile = writeReport(root);
  const res = cli(['qa-evidence', reportFile, '--now', FIXED_NOW]);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(JSON.parse(res.stdout).verdict, 'inconclusive');
});

// A relative report path resolves against the injected cwd (the test process's own cwd holds no report.json).
test('qa-evidence resolves a relative report path against the injected cwd', () => {
  const root = tmp();
  writeReport(root);
  const res = cli(['qa-evidence', 'report.json', '--story-ids', 'story-1', '--now', FIXED_NOW], { cwd: root });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.deepStrictEqual(JSON.parse(res.stdout), { verdict: 'satisfied' });
});

test('qa-evidence exits non-zero for a missing report file argument', () => {
  const result = cli(['qa-evidence', '--story-ids', 'story-1']);
  assert.notStrictEqual(result.status, 0);
});

// Proves an unknown command's stdout, stderr and exit code are unchanged by the in-process
// entry conversion (#5380).
test('script entry: an unknown command exits 2 with the full usage text on stderr and nothing on stdout', () => {
  const res = spawnCli(CLI, ['no-such-command'], { env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });

  assert.strictEqual(res.code, 2);
  assert.strictEqual(res.stdout, '');
  assert.strictEqual(
    res.stderr,
    'usage: journey-health.js <command> [options]\n' +
    'commands: next-target [--target <id>] [--tier light|deep] [--budget <n>], ' +
    'validate-findings <file> [--target <id>] [--tier light|deep] [--coverage-scan] [--min-confidence low|med|high], ' +
    'qa-evidence <report.json> --story-ids <id1,id2,...> [--now <ms>], ' +
    'churn-report [--fail-on-high-churn <r>], mark <fingerprint> <declined>, ' +
    'retry-queue drain, retry-queue update <results.json>\n',
  );
});

// Proves the script entry flushes stdout on exit 0 (#5380).
test('script entry: qa-evidence exits 0 with the full verdict on stdout and nothing on stderr', () => {
  const root = tmp();
  const reportFile = writeReport(root);

  const res = spawnCli(
    CLI,
    ['qa-evidence', reportFile, '--story-ids', 'a', '--now', '0'],
    { env: { ...process.env, LC_ALL: 'C', LANG: 'C' } },
  );

  assert.strictEqual(res.code, 0);
  assert.strictEqual(res.stderr, '');
  assert.strictEqual(
    res.stdout,
    '{\n  "verdict": "inconclusive",\n  "reason": "story \\"a\\" is absent from the report or was skipped"\n}\n',
  );
});
