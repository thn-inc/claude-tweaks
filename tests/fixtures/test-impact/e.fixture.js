// Not a `*.test.js` on purpose: the real suite must never collect this. tests/test-impact-tracer.test.js
// copies this fixture project into a temp root (renaming `*.fixture.js` to `*.test.js`) and runs
// `node --test` there under tools/test-impact/tracer.js, then reads back what each test file read (#4024).
// `git grep`'s pattern is a regex, never a pathspec: both calls search the whole tree, so they record
// only `c ''` — never `c docs` or `c lib`, though `docs/.*x` looks like a glob and `lib` is a directory.
'use strict';
const { test } = require('node:test');
const { spawnSync } = require('child_process');

// Nothing is tracked in the fixture repo, so grep exits 1 (no match): the status is not the point.
const grep = (args) => spawnSync('git', ['grep', ...args], { cwd: __dirname, stdio: 'ignore' });

test('git grep patterns are not pathspecs', () => {
  grep(['docs/.*x']);
  grep(['-e', 'lib']);
});
