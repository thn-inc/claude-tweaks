const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { fileWriteTargets } = require('../plugin/bin/lib/hooks/git-command');

// bash: `cd> f /main` redirects stdout to f (in /r), then cd /main, so cp writes /main/g.js.
test('cd with a glued operator and a separate target word still changes to the real argument', () => {
  for (const cmd of ['cd> f /main; cp a g.js', 'cd>> f /main; cp a g.js']) {
    const files = fileWriteTargets(cmd, '/r').map((t) => t.file);
    assert.ok(files.includes(path.resolve('/main/g.js')), cmd + ' -> ' + JSON.stringify(files));
  }
});
