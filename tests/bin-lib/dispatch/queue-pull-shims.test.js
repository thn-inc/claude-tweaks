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

// A fresh logs dir, removed when the test ends.
const tmpLogs = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-shims-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('readShimLog round-trips awkward argv', (t) => {
  const dir = tmpLogs(t);
  const awkward = ['api', 'graphql', '-f', 'query=query{ a: issue(number:1){ x } }\n"q" $HOME `id` \'s\'', ''];
  const plain = ['issue', 'view', '1'];
  appendShimRecord(path.join(dir, SHIM_LOGS.gh), { tag: 'ok', argv: awkward });
  appendShimRecord(path.join(dir, SHIM_LOGS.gh), { tag: 'UNHANDLED', argv: plain });
  assert.deepEqual(readShimLog(dir, 'gh'), [{ tag: 'ok', argv: awkward }, { tag: 'UNHANDLED', argv: plain }]);
});

test('readShimLog keeps cwd and why for git', (t) => {
  const dir = tmpLogs(t);
  appendShimRecord(path.join(dir, SHIM_LOGS.git), { tag: 'REFUSED', why: 'unknown global option --bare', cwd: '/a/b', argv: ['--bare', 'status'] });
  appendShimRecord(path.join(dir, SHIM_LOGS.git), { tag: 'delegated', cwd: '/c', argv: ['status'] });
  const [first, second] = readShimLog(dir, 'git');
  assert.deepEqual(first, { tag: 'REFUSED', why: 'unknown global option --bare', cwd: '/a/b', argv: ['--bare', 'status'] });
  assert.deepEqual(second, { tag: 'delegated', cwd: '/c', argv: ['status'] });
  assert.equal('why' in second, false);
});

test('readShimLog throws on a truncated record', (t) => {
  const dir = tmpLogs(t);
  // The detail is pinned too: the header-cut case would otherwise throw on its missing argc anyway.
  const cases = [
    ['ok\0\0\0' + '3\0a\0', /malformed record.*ends after 1 argument/],
    ['ok\0\0\0x\0', /malformed record.*argc is not a decimal integer/],
    ['ok\0\0', /malformed record.*file ends mid-record/],
    ['ok\0\0\0' + '1\0a', /malformed record.*file ends mid-field/],
  ];
  for (const [bytes, expected] of cases) {
    fs.writeFileSync(path.join(dir, SHIM_LOGS.gh), bytes);
    assert.throws(() => readShimLog(dir, 'gh'), expected, JSON.stringify(bytes));
  }
});

test('an absent log reads as []', (t) => {
  assert.deepEqual(readShimLog(tmpLogs(t), 'gh'), []);
  assert.deepEqual(readShimLog(tmpLogs(t), 'git'), []);
});
