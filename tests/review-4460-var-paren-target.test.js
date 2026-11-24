const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { fileWriteTargets } = require('../plugin/bin/lib/hooks/git-command');

// bash: A='(x'; echo x > $A writes the file /r/(x; expansion never makes a process substitution.
test('a `(` that a variable expansion supplies is file text', () => {
  const files = fileWriteTargets("A='(x'; echo x > $A", '/r').map((t) => t.file);
  assert.ok(files.includes(path.resolve('/r/(x')), JSON.stringify(files));
});
