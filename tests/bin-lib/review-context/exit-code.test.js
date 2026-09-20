'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'build-review-context.js');

test('mint with no --run exits 0 and prints a JSON line with a dir key', () => {
  const result = spawnSync(process.execPath, [CLI, 'mint'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(typeof parsed.dir, 'string');
});

test('unknown command exits 2 and prints usage to stderr', () => {
  const result = spawnSync(process.execPath, [CLI, 'bogus-command'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown command: bogus-command/);
});

test('mint --print-dir prints exactly the path and a newline', () => {
  const result = spawnSync(process.execPath, [CLI, 'mint', '--print-dir'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.endsWith('\n'), true);
  const printed = result.stdout.slice(0, -1);
  assert.equal(printed.includes('\n'), false);
  assert.throws(() => JSON.parse(printed), 'a bare path is not JSON');
});

test('mint without --print-dir still prints the JSON line', () => {
  const result = spawnSync(process.execPath, [CLI, 'mint'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(typeof parsed.dir, 'string');
});

test('--print-dir on build is rejected with the usage error', () => {
  const result = spawnSync(
    process.execPath,
    [CLI, 'build', '--base', 'main', '--branch', 'HEAD', '--print-dir'],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--print-dir is mint-only/);
});
