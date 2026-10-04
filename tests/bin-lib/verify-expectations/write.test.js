'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  FILE_NAME, validateFields, mergeExpectations, writeExpectations,
} = require('../../../plugin/bin/lib/verify-expectations/write');

function tmpRunDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vexp-write-'));
}

test('mergeExpectations: an empty existing object gets the version-1 defaults', () => {
  assert.deepEqual(mergeExpectations({}, {}), { version: 1, memory: [], upstream: [] });
});

test('mergeExpectations: provided memory/upstream/deferred/issues replace, unowned fields survive', () => {
  const existing = { version: 1, memory: [{ file: 'a.md', indexFile: 'M.md' }], upstream: [], custom: 'kept', deferred: ['worktree'] };
  const out = mergeExpectations(existing, { upstream: [{ url: 'https://github.com/o/r/issues/1' }], deferred: ['design-caches', 'design-caches'], issues: [7] });
  assert.deepEqual(out.memory, [{ file: 'a.md', indexFile: 'M.md' }], 'memory not provided, so preserved');
  assert.deepEqual(out.upstream, [{ url: 'https://github.com/o/r/issues/1' }]);
  assert.deepEqual(out.deferred, ['design-caches'], 'replaced and deduplicated');
  assert.deepEqual(out.issues, [7]);
  assert.equal(out.custom, 'kept');
});

test('mergeExpectations: oversightExempt unions with the existing array, deduplicated and numerically sorted', () => {
  const out = mergeExpectations({ version: 1, memory: [], upstream: [], oversightExempt: [30, 4] }, { oversightExempt: [4, 12] });
  assert.deepEqual(out.oversightExempt, [4, 12, 30]);
});

test('validateFields: accepts the five allowed keys and rejects everything else with a named reason', () => {
  assert.equal(validateFields({}), null);
  assert.equal(validateFields({ memory: [{ file: 'a.md', indexFile: 'M.md' }], upstream: [{ url: 'u' }], deferred: ['run-dir-archival'], issues: [1], oversightExempt: [2] }), null);
  assert.match(validateFields({ version: [1] }), /unknown field "version"/);
  assert.match(validateFields({ memory: 'x' }), /"memory" must be an array/);
  assert.match(validateFields({ memory: [{ file: 'a.md' }] }), /memory\[0\] must be \{file, indexFile\}/);
  assert.match(validateFields({ upstream: [{}] }), /upstream\[0\] must be \{url\}/);
  assert.match(validateFields({ deferred: ['Bad Token'] }), /deferred\[0\]/);
  assert.match(validateFields({ issues: [0] }), /issues\[0\] must be a positive integer/);
  assert.match(validateFields({ oversightExempt: [1.5] }), /oversightExempt\[0\] must be a positive integer/);
  assert.match(validateFields([]), /must be an object/);
});

test('writeExpectations: creates the file when absent and returns its path and data', () => {
  const runDir = tmpRunDir();
  const { file, data } = writeExpectations({ runDir, fields: {} });
  assert.equal(file, path.join(runDir, FILE_NAME));
  assert.deepEqual(data, { version: 1, memory: [], upstream: [] });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), data);
  assert.deepEqual(fs.readdirSync(runDir), [FILE_NAME], 'no lock dir or tmp file is left behind');
});

test('writeExpectations: unparseable, null, or array content in the existing file is treated as empty, never thrown on', () => {
  for (const garbage of ['not json', 'null', '[1,2]']) {
    const runDir = tmpRunDir();
    fs.writeFileSync(path.join(runDir, FILE_NAME), garbage);
    const { data } = writeExpectations({ runDir, fields: { issues: [9] } });
    assert.deepEqual(data, { version: 1, memory: [], upstream: [], issues: [9] }, `content: ${garbage}`);
  }
});

test('writeExpectations: a second write preserves what the first recorded', () => {
  const runDir = tmpRunDir();
  writeExpectations({ runDir, fields: { oversightExempt: [5] } });
  writeExpectations({ runDir, fields: { oversightExempt: [5] } });
  const { data } = writeExpectations({ runDir, fields: { memory: [{ file: 'a.md', indexFile: 'M.md' }] } });
  assert.deepEqual(data.oversightExempt, [5]);
  assert.deepEqual(data.memory, [{ file: 'a.md', indexFile: 'M.md' }]);
});
