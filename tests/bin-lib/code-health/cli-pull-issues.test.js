'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'code-health.js');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codehealth-pi-'));
}

function runPullIssues(issuesFile, extraArgs = []) {
  return spawnSync('node', [CLI, 'pull-issues', '--issues', issuesFile, ...extraArgs], { encoding: 'utf8' });
}

// A current-format fixture issue — by:code-health + risk:<tier> + work-fingerprint,
// matching real toIssuePayloadV2 output. Not the legacy code-health:<severity> /
// code-health-fingerprint shape this command used to (silently, incorrectly) expect.
function fixtureIssue({ number, risk, fingerprint }) {
  return {
    number,
    title: `[code-health] finding ${number}`,
    state: 'open',
    labels: [{ name: 'by:code-health' }, { name: `risk:${risk}` }, { name: 'effort:medium' }, { name: 'ready' }],
    body: `## Current State\n...\n\n## Deliverables\n...\n\n## Acceptance Criteria\n...\n\n<!-- work-fingerprint: ${fingerprint} -->`,
  };
}

test('pull-issues: exits 2 when --issues flag is missing', () => {
  const r = spawnSync('node', [CLI, 'pull-issues', '--label', 'code-health'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2, `should exit 2 when --issues is missing, got ${r.status}. stderr: ${r.stderr}`);
});

test('pull-issues: exits 2 when --min-severity is an unrecognized value', () => {
  const root = tmp();
  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([]));
  const result = runPullIssues(issuesFile, ['--min-severity', 'hgih']);
  assert.strictEqual(result.status, 2, `expected exit 2, got ${result.status}. stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('--min-severity'), `expected --min-severity mentioned in stderr: ${result.stderr}`);
});

test('pull-issues: a recognized --min-severity value still works normally', () => {
  const root = tmp();
  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([]));
  const result = runPullIssues(issuesFile, ['--min-severity', 'high']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const briefs = JSON.parse(result.stdout);
  assert.deepStrictEqual(briefs, []);
});

// Regression: the guard used `!(value in RISK_RANK)` against the plain
// object literal { high, medium, low }. `in` walks the prototype chain, so
// an Object.prototype property name like "constructor" passed validation as
// if it were a real risk tier, silently disabling the severity filter
// instead of restricting output (or erroring, as intended).
test('pull-issues: exits 2 when --min-severity is an Object.prototype property name', () => {
  const root = tmp();
  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([]));
  const result = runPullIssues(issuesFile, ['--min-severity', 'constructor']);
  assert.strictEqual(result.status, 2, `expected exit 2, got ${result.status}. stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes('--min-severity'), `expected --min-severity mentioned in stderr: ${result.stderr}`);
});

test('pull-issues: "info" is no longer recognized — --min-severity now shares --min-risk\'s 3-tier scale', () => {
  const root = tmp();
  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([]));
  const result = runPullIssues(issuesFile, ['--min-severity', 'info']);
  assert.strictEqual(
    result.status, 2,
    `expected exit 2 (info retired along with the legacy 5-tier scale), got ${result.status}. stderr: ${result.stderr}`,
  );
});

test('pull-issues: filters a real currently-filed by:code-health/risk:<tier>/work-fingerprint fixture by --min-severity', () => {
  const root = tmp();
  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([
    fixtureIssue({ number: 101, risk: 'high', fingerprint: 'codehealth-high0001' }),
    fixtureIssue({ number: 102, risk: 'low', fingerprint: 'codehealth-low00002' }),
  ]));
  const result = runPullIssues(issuesFile, ['--min-severity', 'high']);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const briefs = JSON.parse(result.stdout);
  assert.strictEqual(briefs.length, 1);
  assert.strictEqual(briefs[0].number, 101);
  assert.strictEqual(briefs[0].severity, 'high');
  assert.strictEqual(briefs[0].fingerprint, 'codehealth-high0001');
});

test('pull-issues: default --label selects only by:code-health issues, not an unrelated by:harness-health one', () => {
  const root = tmp();
  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, JSON.stringify([
    fixtureIssue({ number: 201, risk: 'medium', fingerprint: 'codehealth-med00001' }),
    {
      number: 202,
      title: '[harness-health] drift finding',
      labels: [{ name: 'by:harness-health' }, { name: 'risk:medium' }, { name: 'ready' }],
      body: '## Current State\n...\n\n## Deliverables\n...\n\n## Acceptance Criteria\n...',
    },
  ]));
  const result = runPullIssues(issuesFile, []);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  const briefs = JSON.parse(result.stdout);
  assert.deepStrictEqual(briefs.map((b) => b.number), [201]);
});

// Real-process pin of the script entry (#5381): the refusal path's code, stdout and stderr are
// byte-identical before and after the in-process entry conversion.
test('AC5.1, AC7.1: code-health.js no-such-command exits 2 with the usage text on stderr (real process)', () => {
  const { spawnCli } = require('../../helpers/run-cli');
  const r = spawnCli(CLI, ['no-such-command'], { env: { ...process.env }, cwd: tmp() });
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(
    r.stderr,
    'usage: code-health.js <command> [options]\ncommands: validate-findings [--slice <id>], classify, next-slice, status, churn-report, pull-issues, retry-queue drain, retry-queue update <results.json>\n',
  );
});
