// tests/hooks-resolve-console.test.js — #2568: hooks.js's `resolve-console`
// CLI dispatch (the --run-required discipline, USAGE/KNOWN_FLAGS wiring).
// The gh-calling happy path is covered directly against
// resolveConsoleExecution in tests/resolve-console.test.js with a fake
// runner — this file only exercises the CLI-level gates that fire before
// any gh call would ever be made.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

function runHook(args, { cwd } = {}) {
  try {
    const stdout = execFileSync('node', [HOOKS, ...args], {
      cwd: cwd || fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resolve-console-cli-')),
      encoding: 'utf8',
      env: { ...process.env, PIPELINE_RUN_DIR: '' },
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '' };
  }
}

test('resolve-console --help prints usage and exits 0, no --run required', () => {
  const result = runHook(['resolve-console', '--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /resolve-console --run <dir>/);
});

test('resolve-console without --run exits non-zero with a usage message, performs zero writes', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resolve-console-norun-'));
  const result = runHook(['resolve-console', '--approve', '1'], { cwd: runDir });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--run is required/);
  assert.equal(fs.readdirSync(runDir).length, 0, 'nothing should be written when --run is omitted');
});

// Unknown-flag interception is verb-agnostic and, per this dispatcher's own
// "never break a session" cardinal invariant, always exits 0 — the usage
// line itself is the rejection signal, not the exit code (same convention
// every other KNOWN_FLAGS verb in this file already follows).
test('resolve-console with an unrecognized flag prints usage instead of silently proceeding', () => {
  const result = runHook(['resolve-console', '--run', '/tmp', '--bogus', 'x']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /usage: resolve-console --run <dir>/);
});

test('resolve-console with a --run path that is not a real directory is rejected', () => {
  const result = runHook(['resolve-console', '--run', '/definitely/not/a/real/path/xyz']);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--run path rejected/);
});
