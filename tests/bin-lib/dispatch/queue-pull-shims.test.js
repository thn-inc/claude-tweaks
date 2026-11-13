'use strict';
// #5366: the fast tests for the queue-pull oracle's PATH shims (tests/bin-lib/dispatch/
// queue-pull-oracle.js): the NUL-framed shim log and its reader here, with no sandbox and no
// bash oracle run. The parity suite (queue-pull.test.js) holds the slow, whole-fence tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { appendShimRecord, readShimLog, SHIM_LOGS } = require('./queue-pull-oracle');

const tmpLogs = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qp-shims-'));

test('readShimLog round-trips awkward argv', () => {
  const dir = tmpLogs();
  const awkward = ['api', 'graphql', '-f', 'query=query{ a: issue(number:1){ x } }\n"q" $HOME `id` \'s\'', ''];
  const plain = ['issue', 'view', '1'];
  appendShimRecord(path.join(dir, SHIM_LOGS.gh), { tag: 'ok', argv: awkward });
  appendShimRecord(path.join(dir, SHIM_LOGS.gh), { tag: 'UNHANDLED', argv: plain });
  assert.deepEqual(readShimLog(dir, 'gh'), [{ tag: 'ok', argv: awkward }, { tag: 'UNHANDLED', argv: plain }]);
});

test('readShimLog keeps cwd and why for git', () => {
  const dir = tmpLogs();
  appendShimRecord(path.join(dir, SHIM_LOGS.git), { tag: 'REFUSED', why: 'unknown global option --bare', cwd: '/a/b', argv: ['--bare', 'status'] });
  appendShimRecord(path.join(dir, SHIM_LOGS.git), { tag: 'delegated', cwd: '/c', argv: ['status'] });
  const [first, second] = readShimLog(dir, 'git');
  assert.deepEqual(first, { tag: 'REFUSED', why: 'unknown global option --bare', cwd: '/a/b', argv: ['--bare', 'status'] });
  assert.deepEqual(second, { tag: 'delegated', cwd: '/c', argv: ['status'] });
  assert.equal('why' in second, false);
});

test('readShimLog throws on a truncated record', () => {
  const dir = tmpLogs();
  fs.writeFileSync(path.join(dir, SHIM_LOGS.gh), 'ok\0\0\0' + '3\0a\0');
  assert.throws(() => readShimLog(dir, 'gh'), /malformed record/);
  fs.writeFileSync(path.join(dir, SHIM_LOGS.gh), 'ok\0\0\0x\0');
  assert.throws(() => readShimLog(dir, 'gh'), /malformed record/);
});

test('an absent log reads as []', () => {
  assert.deepEqual(readShimLog(tmpLogs(), 'gh'), []);
  assert.deepEqual(readShimLog(tmpLogs(), 'git'), []);
});
