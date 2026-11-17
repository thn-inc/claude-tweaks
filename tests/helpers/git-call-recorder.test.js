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

test('writes nothing without CT_TEST_GIT_CALL_LOG', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-call-rec-'));
  try {
    const r = run(null);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
