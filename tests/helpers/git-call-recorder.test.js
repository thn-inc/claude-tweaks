'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HELPER = path.join(__dirname, 'git-call-recorder.js');
const { readGitCalls } = require(HELPER);

const SCRIPT = `
const { execFileSync } = require('child_process');
execFileSync('git', ['--version'], { windowsHide: true });
execFileSync(process.execPath, ['-e', '0'], { windowsHide: true });
`;

function run(logDir) {
  const env = { ...process.env };
  delete env.CT_TEST_GIT_CALL_LOG;
  if (logDir) env.CT_TEST_GIT_CALL_LOG = logDir;
  return spawnSync(process.execPath, ['--require', HELPER, '-e', SCRIPT], { env, encoding: 'utf8', windowsHide: true });
}

test('records one git event then one spawn event, in order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-call-rec-'));
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    const procs = readGitCalls(dir);
    assert.equal(procs.length, 1);
    const [a, b] = procs[0].events;
    assert.equal(procs[0].events.length, 2);
    assert.equal(a.kind, 'git');
    assert.deepEqual(a.args, ['--version']);
    assert.equal(a.cwd, process.cwd());
    assert.equal(typeof a.env, 'string');
    assert.deepEqual(b, { kind: 'spawn', cmd: process.execPath });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patches nothing without CT_TEST_GIT_CALL_LOG', () => {
  // A wrapper is the helper's own closure; the real functions never mention record(.
  const probe = `const cp = require('child_process');
    const patched = ['execFileSync', 'execFile', 'spawnSync', 'spawn'].filter((n) => String(cp[n]).includes('record('));
    process.stdout.write(JSON.stringify(patched));`;
  const env = { ...process.env };
  delete env.CT_TEST_GIT_CALL_LOG;
  const r = spawnSync(process.execPath, ['--require', HELPER, '-e', probe], { env, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), []);
  const onDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-call-rec-'));
  const on = spawnSync(process.execPath, ['--require', HELPER, '-e', probe], {
    env: { ...env, CT_TEST_GIT_CALL_LOG: onDir }, encoding: 'utf8', windowsHide: true,
  });
  fs.rmSync(onDir, { recursive: true, force: true });
  assert.equal(JSON.parse(on.stdout).length, 4, 'the probe must see the wrappers when the variable is set');
});

test('readGitCalls skips a truncated line and orders pid files numerically', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-call-rec-'));
  try {
    fs.writeFileSync(path.join(dir, '100.jsonl'), '{"kind":"argv","argv":["b"],"cwd":"/"}\n');
    fs.writeFileSync(path.join(dir, '9.jsonl'), '{"kind":"argv","argv":["a"],"cwd":"/"}\n{"kind":"spawn","cmd":"x"}\n{"kind":"gi');
    const procs = readGitCalls(dir);
    assert.deepEqual(procs.map((p) => p.pid), [9, 100]);
    assert.deepEqual(procs[0].events, [{ kind: 'spawn', cmd: 'x' }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
