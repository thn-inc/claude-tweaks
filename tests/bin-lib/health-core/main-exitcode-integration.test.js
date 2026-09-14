'use strict';
// #2053, AC2: `churn-report.js`, `mark.js`, and `retry-cli.js`'s `update` no
// longer call `process.exit()` directly -- they return a numeric code (or
// undefined) and each of the four health-suite CLIs' own `main()` applies
// that return value to `process.exitCode`, mirroring every other branch in
// the same `main()`. This file exercises that wiring end-to-end through each
// CLI's real `main()` function -- in-process (`require` + call, not a
// subprocess), so `process.exitCode` is asserted directly rather than a
// subprocess's own exit status.
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');

const codeHealth = require(path.join(ROOT, 'plugin', 'bin', 'code-health.js'));
const harnessHealth = require(path.join(ROOT, 'plugin', 'bin', 'harness-health.js'));
const journeyHealth = require(path.join(ROOT, 'plugin', 'bin', 'journey-health.js'));
const docsHealth = require(path.join(ROOT, 'plugin', 'bin', 'docs-health.js'));

function tmpRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
  const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}bare-`));
  execFileSync('git', ['init', '--bare', '-q', bareDir]);
  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}seed-`));
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

// Runs `fn`, then reports whatever process.exitCode it left behind and
// restores the original -- calling main() directly (not a subprocess) means
// a set exitCode would otherwise leak into this test file's own eventual
// exit code.
function withExitCode(fn) {
  const original = process.exitCode;
  process.exitCode = undefined;
  try {
    fn();
    return process.exitCode;
  } finally {
    process.exitCode = original;
  }
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

const CHURN_REPORT_CLIS = [
  ['code-health', codeHealth],
  ['harness-health', harnessHealth],
  ['journey-health', journeyHealth],
  ['docs-health', docsHealth],
];

for (const [name, mod] of CHURN_REPORT_CLIS) {
  test(`${name}.js main(): churn-report --fail-on-high-churn with a non-numeric value sets process.exitCode 2 (not a silently-disabled gate)`, () => {
    const root = tmpGitRootWithOneRun(`${name}-churn-`, name);
    const exitCode = withExitCode(() => {
      captureStdio(() => mod.main(['churn-report', '--fail-on-high-churn', 'not-a-number', '--root', root]));
    });
    assert.strictEqual(exitCode, 2);
  });
}

const MARK_CLIS = [
  ['harness-health', harnessHealth],
  ['journey-health', journeyHealth],
  ['docs-health', docsHealth],
  // code-health.js has no `mark` command (confirmed: cmdMark is not
  // required/dispatched there) -- deliberately excluded, per the record's
  // own Gotcha.
];

for (const [name, mod] of MARK_CLIS) {
  test(`${name}.js main(): mark <fingerprint> <bad-status> sets process.exitCode 2`, () => {
    const root = tmpRoot(`${name}-mark-`);
    const exitCode = withExitCode(() => {
      captureStdio(() => mod.main(['mark', 'some-fingerprint', 'bogus-status', '--root', root]));
    });
    assert.strictEqual(exitCode, 2);
  });
}

const ALL_CLIS = [
  ['code-health', codeHealth],
  ['harness-health', harnessHealth],
  ['journey-health', journeyHealth],
  ['docs-health', docsHealth],
];

for (const [name, mod] of ALL_CLIS) {
  test(`${name}.js main(): retry-queue update with a missing results-file argument sets process.exitCode 2`, () => {
    const root = tmpRoot(`${name}-retryq-missing-`);
    const exitCode = withExitCode(() => {
      captureStdio(() => mod.main(['retry-queue', 'update', '--root', root]));
    });
    assert.strictEqual(exitCode, 2);
  });

  test(`${name}.js main(): retry-queue update with an unparseable results file sets process.exitCode 1`, () => {
    const root = tmpRoot(`${name}-retryq-malformed-`);
    const resultsPath = path.join(root, 'results.json');
    fs.writeFileSync(resultsPath, 'not valid json {{{');
    const exitCode = withExitCode(() => {
      captureStdio(() => mod.main(['retry-queue', 'update', resultsPath, '--root', root]));
    });
    assert.strictEqual(exitCode, 1);
  });
}
