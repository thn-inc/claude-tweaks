// Not a `*.test.js` on purpose: the real suite must never collect this. tests/test-impact-tracer.test.js
// copies this fixture project into a temp root (renaming `*.fixture.js` to `*.test.js`) and runs
// `node --test` there under tools/test-impact/tracer.js, then reads back what each test file read (#4024).
// Node children whose env no longer carries the trace cannot trace themselves, so their reads are unknown:
// this file records `c ''` (h.fixture.js, whose git calls each stay narrower than the root, must not).
// One way of dropping the trace per file (j-m.fixture.js hold the others): every file records the same
// `c ''`, so a file with two ways could not show that either one alone is recognised.
'use strict';
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const quiet = (cwd) => ({ cwd, stdio: ['ignore', 'pipe', 'pipe'] });
const skip = { skip: process.platform === 'win32' && 'win32: no bash/sh/env' };

// `env -i` strips NODE_OPTIONS and CT_TRACE_* (and PATH, hence the absolute execPath). `node -e 0` ignores
// the extra argv, so the path argument is still recorded beside the fail-closed `c ''`.
test('env -i node', skip, () => {
  execFileSync('env', ['-i', process.execPath, '-e', '0', 'docs/note.md'], quiet(__dirname));
});
