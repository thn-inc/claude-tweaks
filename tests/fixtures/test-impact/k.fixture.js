// Not a `*.test.js` on purpose: the real suite must never collect this. tests/test-impact-tracer.test.js
// copies this fixture project into a temp root (renaming `*.fixture.js` to `*.test.js`) and runs
// `node --test` there under tools/test-impact/tracer.js, then reads back what each test file read (#4024).
// A node child whose env no longer carries the trace cannot trace itself: this file records `c ''`.
// The way the trace is dropped here, `env --unset=NODE_OPTIONS`, is the only one in this file (see i.fixture.js).
'use strict';
const { test } = require('node:test');
const { spawnSync } = require('child_process');

// macOS's env has no --unset=, so the status is ignored: the tracer records before the spawn.
test('env --unset=NODE_OPTIONS node', { skip: process.platform === 'win32' && 'win32: no env' }, () => {
  spawnSync('env', ['--unset=NODE_OPTIONS', process.execPath, '-e', '0'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
});
