// Not a `*.test.js` on purpose: the real suite must never collect this. tests/run-tests-isolation.test.js copies it
// into a fresh temp root as `leak.test.js` and runs tools/run-tests.js over that root: the suite makes three
// directories in its TMPDIR and removes none, so the runner's post-run census has something to report.
'use strict';
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('leaves three top-level entries in its TMPDIR', () => {
  for (const prefix of ['leaky-a-', 'leaky-a-', 'leaky-b-']) fs.mkdtempSync(path.join(os.tmpdir(), prefix));
});
