'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  premiseReadsUnresolved, defaultRunner, PREMISE_SELF_CHECK_TIMEOUT_MS,
} = require('../../../plugin/bin/lib/health-core/premise-self-check');
const { buildPremiseCheck } = require('../../../plugin/bin/lib/harness-health/issue-payload');

// Temp dir name deliberately contains a space — the composed command
// shQuotes the target path, and this proves the quoting survives a real shell.
function tmpWithSpace() { return fs.mkdtempSync(path.join(os.tmpdir(), 'premise self-check-')); }

test('exit 0 reads as unresolved (keep the line)', () => {
  assert.strictEqual(premiseReadsUnresolved('cmd', { root: '/', runner: () => 0 }), true);
});

test('a non-zero exit reads as resolved (drop the line)', () => {
  assert.strictEqual(premiseReadsUnresolved('cmd', { root: '/', runner: () => 1 }), false);
  assert.strictEqual(premiseReadsUnresolved('cmd', { root: '/', runner: () => 2 }), false);
});

test('a timeout drops the line, never keeps it', () => {
  const runner = () => { const e = new Error('spawnSync /bin/sh ETIMEDOUT'); e.code = 'ETIMEDOUT'; e.signal = 'SIGTERM'; throw e; };
  assert.strictEqual(premiseReadsUnresolved('cmd', { root: '/', runner }), false);
});

test('a spawn error drops the line, never keeps it', () => {
  const runner = () => { const e = new Error('spawnSync /bin/sh ENOENT'); e.code = 'ENOENT'; throw e; };
  assert.strictEqual(premiseReadsUnresolved('cmd', { root: '/', runner }), false);
});

test('the runner receives the command, the root as cwd, and the timeout', () => {
  const calls = [];
  premiseReadsUnresolved('echo hi', { root: '/some/root', runner: (c, o) => { calls.push([c, o]); return 0; } });
  assert.deepStrictEqual(calls, [['echo hi', { cwd: '/some/root', timeoutMs: PREMISE_SELF_CHECK_TIMEOUT_MS }]]);
});

test('the timeout matches materialize.js (5000 ms)', () => {
  assert.strictEqual(PREMISE_SELF_CHECK_TIMEOUT_MS, 5000);
});

test('real shell: an additive check whose anchor already appears in the target file is dropped', () => {
  const dir = tmpWithSpace();
  const target = path.join(dir, 'auth.md');
  fs.writeFileSync(target, '# auth\n\nSee `src/auth/session.js`.\n');
  const command = buildPremiseCheck({ kind: 'patch', newString: 'See `src/auth/session.js`.' }, target);
  assert.strictEqual(premiseReadsUnresolved(command, { root: dir }), false);
});

test('real shell: an additive check whose anchor is absent reads unresolved and is kept', () => {
  const dir = tmpWithSpace();
  const target = path.join(dir, 'auth.md');
  fs.writeFileSync(target, '# auth\n\nSee `src/auth/login.js`.\n');
  const command = buildPremiseCheck({ kind: 'patch', newString: 'See `src/auth/session.js`.' }, target);
  assert.strictEqual(premiseReadsUnresolved(command, { root: dir }), true);
});

test('real shell: a hung command is killed at the timeout and dropped', () => {
  const dir = tmpWithSpace();
  const start = Date.now();
  assert.strictEqual(premiseReadsUnresolved('sleep 5', { root: dir, timeoutMs: 100 }), false);
  assert.ok(Date.now() - start < 4000, 'must not wait for the full sleep');
});

test('defaultRunner returns the exit code of a command that ran', () => {
  assert.strictEqual(defaultRunner('exit 0', { cwd: os.tmpdir(), timeoutMs: 5000 }), 0);
  assert.strictEqual(defaultRunner('exit 3', { cwd: os.tmpdir(), timeoutMs: 5000 }), 3);
});
