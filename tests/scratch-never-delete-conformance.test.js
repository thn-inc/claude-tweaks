'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const read = (...p) => readText(path.join(__dirname, '..', 'plugin', 'skills', ...p));

test('the contract Scratch rule names the never-delete scope (#4472)', () => {
  const t = read('_shared', 'subagent-output-contract.md');
  assert.match(t, /never a recursive delete of a parent, of the session scratchpad or temp root, or of any path not textually under the `SCRATCH:` path/);
});

for (const [file, min] of [['step3-lens-dispatch.md', 1], ['step3-debate-and-refutation.md', 2]]) {
  test(`${file} SCRATCH: lines carry the never-delete prohibition (#4472)`, () => {
    const t = read('review', file);
    const re = /ever delete a parent, the session scratchpad or temp root, or any path outside that exact SCRATCH: path\./g;
    assert.ok((t.match(re) || []).length >= min, `${file} must carry the prohibition ${min}x`);
  });
}
