'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'build-review-context.js');

// In-process call with its own TMPDIR parent so every mint's review-ctx-* dir is cleaned up.
// Maps the helper's `code` onto `status`, the field the assertions read.
function inProcess(t, argv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-ctx-exit-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // Both variables, so the platform's own os.tmpdir() order (TMPDIR on POSIX, TEMP on win32) reads tmp.
  const r = runCliSync(CLI, argv, { env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmp, TEMP: tmp } });
  return { status: r.code, stdout: r.stdout, stderr: r.stderr, tmp };
}

test('mint with no --run exits 0 and prints a JSON line with a dir key', (t) => {
  // real process: proves the script entry and exit code 0
  const result = spawnCli(CLI, ['mint']);
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(typeof parsed.dir, 'string');
  t.after(() => fs.rmSync(parsed.dir, { recursive: true, force: true }));
});

test('unknown command exits 2 and prints usage to stderr', () => {
  // real process: proves the script entry and exit code 2
  const result = spawnCli(CLI, ['bogus-command']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /unknown command: bogus-command/);
});

test('mint --print-dir prints exactly the path and a newline', (t) => {
  const result = inProcess(t, ['mint', '--print-dir']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.endsWith('\n'), true);
  const printed = result.stdout.slice(0, -1);
  assert.equal(printed.includes('\n'), false);
  assert.throws(() => JSON.parse(printed), 'a bare path is not JSON');
});

test('mint without --print-dir still prints the JSON line', (t) => {
  const result = inProcess(t, ['mint']);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(typeof parsed.dir, 'string');
});

test('--print-dir on build is rejected with the usage error', (t) => {
  const result = inProcess(t, ['build', '--base', 'main', '--branch', 'HEAD', '--print-dir']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--print-dir is mint-only/);
});

test('AC6.1: mint with no --run creates its dir under the injected TMPDIR', (t) => {
  const result = inProcess(t, ['mint']);
  assert.equal(result.status, 0);
  const { dir } = JSON.parse(result.stdout.trim());
  assert.notEqual(result.tmp, os.tmpdir());
  assert.equal(path.dirname(dir), result.tmp);
});

test('envTmpdir resolves the way os.tmpdir does, per platform', () => {
  const { envTmpdir } = require('../../../plugin/bin/lib/review-context/build');
  assert.equal(envTmpdir({ TMPDIR: '/p/tmp', TEMP: 'C:\\t' }, 'win32'), 'C:\\t', 'win32 ignores TMPDIR');
  assert.equal(envTmpdir({ TMP: 'C:\\m\\' }, 'win32'), 'C:\\m', 'win32 strips one trailing backslash');
  assert.equal(envTmpdir({ TEMP: 'C:\\' }, 'win32'), 'C:\\', 'win32 keeps a drive root');
  assert.equal(envTmpdir({ SystemRoot: 'C:\\Windows' }, 'win32'), 'C:\\Windows\\temp');
  assert.equal(envTmpdir({ TMPDIR: '/p/tmp/', TEMP: '/x' }, 'linux'), '/p/tmp', 'POSIX strips a trailing slash');
  assert.equal(envTmpdir({ TMP: '/m', TEMP: '/x' }, 'linux'), '/m');
  assert.equal(envTmpdir({}, 'linux'), '/tmp');
  assert.equal(envTmpdir({ TMPDIR: '/' }, 'linux'), '/', 'a root is not stripped');
  assert.equal(envTmpdir(undefined, 'linux'), os.tmpdir());
});

test('a throw inside build maps to exit 1 with a build-review-context.js: stderr line', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-ctx-throw-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const result = runCliSync(CLI, ['build', '--base', 'main', '--branch', 'HEAD', '--dir', tmp], {
    deps: {
      buildContext: () => {
        throw new Error('boom');
      },
    },
  });
  assert.equal(result.code, 1);
  assert.equal(result.stderr, 'build-review-context.js: boom\n');
});
