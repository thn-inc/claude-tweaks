'use strict';
// #2053, AC2: `churn-report.js`, `mark.js`, and `retry-cli.js`'s `update` no
// longer call `process.exit()` directly -- they return a numeric code (or
// undefined) and each of the four health-suite CLIs' own `run()` returns the
// sub-command's exit code without ever setting `process.exitCode` (#5374's
// entry contract; the process-level assignment lives in the file's guard).
// This file exercises that wiring end-to-end through each CLI's real `run()`
// function -- in-process (`require` + call, not a subprocess): every row
// asserts the returned code via `returnedCode`, which also checks that
// `process.exitCode` was left untouched.
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');

const codeHealth = require(path.join(ROOT, 'plugin', 'bin', 'code-health.js'));
const harnessHealth = require(path.join(ROOT, 'plugin', 'bin', 'harness-health.js'));
const journeyHealth = require(path.join(ROOT, 'plugin', 'bin', 'journey-health.js'));
const docsHealth = require(path.join(ROOT, 'plugin', 'bin', 'docs-health.js'));

function tmpRoot(prefix) {
  return scratchDir(prefix);
}

// churn-report reads durable state (readDurableState(root).runs) BEFORE its
// own --fail-on-high-churn validation runs, and returns early ("no run logs
// found") when that array is empty -- never reaching the validation this
// test targets. So this needs a real git repo carrying at least one run on
// its `health-state` branch, not just an offline-safe empty-fetch fixture --
// same seeding technique as tests/code-health-misc/cli.test.js's
// seedDurableRuns, parameterized by each CLI's own skillName (the directory
// createDurableState(skillName, ...) reads/writes runs.json under).
function tmpGitRootWithOneRun(prefix, skillName) {
  const root = tmpRoot(prefix);
  const bareDir = scratchDir(`${prefix}bare-`);
  execFileSync('git', ['init', '--bare', '-q', bareDir]);
  const seedDir = scratchDir(`${prefix}seed-`);
  execFileSync('git', ['init', '-q', seedDir]);
  execFileSync('git', ['-C', seedDir, 'checkout', '-q', '-b', 'health-state']);
  fs.mkdirSync(path.join(seedDir, skillName), { recursive: true });
  fs.writeFileSync(
    path.join(seedDir, skillName, 'runs.json'),
    JSON.stringify([{ runId: 'r1', runAt: new Date().toISOString(), fingerprints: ['fp-a', 'fp-b'] }]),
  );
  execFileSync('git', ['-C', seedDir, 'add', '-A']);
  execFileSync(
    'git',
    ['-C', seedDir, '-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'seed'],
  );
  execFileSync('git', ['-C', seedDir, 'push', '-q', bareDir, 'health-state']);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', bareDir], { cwd: root });
  return root;
}

function captureStdio(fn) {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    return fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

// All four health CLIs (code-health.js, docs-health.js, harness-health.js, journey-health.js) are on
// the entry contract (#5380, #5381): run() returns the exit code and never sets process.exitCode,
// so their rows assert the return value and that process.exitCode is untouched.
function returnedCode(fn) {
  const original = process.exitCode;
  process.exitCode = undefined;
  try {
    const code = fn();
    assert.strictEqual(process.exitCode, undefined, 'run() must not set process.exitCode');
    return code;
  } finally {
    process.exitCode = original;
  }
}

test('harness-health.js run(): churn-report --fail-on-high-churn with a non-numeric value returns 2 (not a silently-disabled gate)', () => {
  const root = tmpGitRootWithOneRun('harness-health-churn-', 'harness-health');
  const code = returnedCode(() => captureStdio(() => harnessHealth.run(['churn-report', '--fail-on-high-churn', 'not-a-number', '--root', root])));
  assert.strictEqual(code, 2);
});

test('journey-health.js run(): churn-report --fail-on-high-churn with a non-numeric value returns 2 (not a silently-disabled gate)', () => {
  const root = tmpGitRootWithOneRun('journey-health-churn-', 'journey-health');
  const code = returnedCode(() => captureStdio(() => journeyHealth.run(['churn-report', '--fail-on-high-churn', 'not-a-number', '--root', root])));
  assert.strictEqual(code, 2);
});

test('code-health.js run(): churn-report --fail-on-high-churn with a non-numeric value returns 2 (not a silently-disabled gate)', () => {
  const root = tmpGitRootWithOneRun('code-health-churn-', 'code-health');
  const code = returnedCode(() => captureStdio(() => codeHealth.run(['churn-report', '--fail-on-high-churn', 'not-a-number', '--root', root])));
  assert.strictEqual(code, 2);
});

test('docs-health.js run(): churn-report --fail-on-high-churn with a non-numeric value returns 2 (not a silently-disabled gate)', () => {
  const root = tmpGitRootWithOneRun('docs-health-churn-', 'docs-health');
  const code = returnedCode(() => captureStdio(() => docsHealth.run(['churn-report', '--fail-on-high-churn', 'not-a-number', '--root', root])));
  assert.strictEqual(code, 2);
});

test('harness-health.js run(): mark <fingerprint> <bad-status> returns 2', () => {
  const root = tmpRoot('harness-health-mark-');
  const code = returnedCode(() => captureStdio(() => harnessHealth.run(['mark', 'some-fingerprint', 'bogus-status', '--root', root])));
  assert.strictEqual(code, 2);
});

test('journey-health.js run(): mark <fingerprint> <bad-status> returns 2', () => {
  const root = tmpRoot('journey-health-mark-');
  const code = returnedCode(() => captureStdio(() => journeyHealth.run(['mark', 'some-fingerprint', 'bogus-status', '--root', root])));
  assert.strictEqual(code, 2);
});

test('docs-health.js run(): mark <fingerprint> <bad-status> returns 2', () => {
  const root = tmpRoot('docs-health-mark-');
  const code = returnedCode(() => captureStdio(() => docsHealth.run(['mark', 'some-fingerprint', 'bogus-status', '--root', root])));
  assert.strictEqual(code, 2);
});

test('harness-health.js run(): retry-queue update with a missing results-file argument returns 2', () => {
  const root = tmpRoot('harness-health-retryq-missing-');
  const code = returnedCode(() => captureStdio(() => harnessHealth.run(['retry-queue', 'update', '--root', root])));
  assert.strictEqual(code, 2);
});

test('harness-health.js run(): retry-queue update with an unparseable results file returns 1', () => {
  const root = tmpRoot('harness-health-retryq-malformed-');
  const resultsPath = path.join(root, 'results.json');
  fs.writeFileSync(resultsPath, 'not valid json {{{');
  const code = returnedCode(() => captureStdio(() => harnessHealth.run(['retry-queue', 'update', resultsPath, '--root', root])));
  assert.strictEqual(code, 1);
});

test('journey-health.js run(): retry-queue update with a missing results-file argument returns 2', () => {
  const root = tmpRoot('journey-health-retryq-missing-');
  const code = returnedCode(() => captureStdio(() => journeyHealth.run(['retry-queue', 'update', '--root', root])));
  assert.strictEqual(code, 2);
});

test('journey-health.js run(): retry-queue update with an unparseable results file returns 1', () => {
  const root = tmpRoot('journey-health-retryq-malformed-');
  const resultsPath = path.join(root, 'results.json');
  fs.writeFileSync(resultsPath, 'not valid json {{{');
  const code = returnedCode(() => captureStdio(() => journeyHealth.run(['retry-queue', 'update', resultsPath, '--root', root])));
  assert.strictEqual(code, 1);
});

test('code-health.js run(): retry-queue update with a missing results-file argument returns 2', () => {
  const root = tmpRoot('code-health-retryq-missing-');
  const code = returnedCode(() => captureStdio(() => codeHealth.run(['retry-queue', 'update', '--root', root])));
  assert.strictEqual(code, 2);
});

test('code-health.js run(): retry-queue update with an unparseable results file returns 1', () => {
  const root = tmpRoot('code-health-retryq-malformed-');
  const resultsPath = path.join(root, 'results.json');
  fs.writeFileSync(resultsPath, 'not valid json {{{');
  const code = returnedCode(() => captureStdio(() => codeHealth.run(['retry-queue', 'update', resultsPath, '--root', root])));
  assert.strictEqual(code, 1);
});

test('docs-health.js run(): retry-queue update with a missing results-file argument returns 2', () => {
  const root = tmpRoot('docs-health-retryq-missing-');
  const code = returnedCode(() => captureStdio(() => docsHealth.run(['retry-queue', 'update', '--root', root])));
  assert.strictEqual(code, 2);
});

test('docs-health.js run(): retry-queue update with an unparseable results file returns 1', () => {
  const root = tmpRoot('docs-health-retryq-malformed-');
  const resultsPath = path.join(root, 'results.json');
  fs.writeFileSync(resultsPath, 'not valid json {{{');
  const code = returnedCode(() => captureStdio(() => docsHealth.run(['retry-queue', 'update', resultsPath, '--root', root])));
  assert.strictEqual(code, 1);
});
