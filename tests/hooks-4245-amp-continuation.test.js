'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { gitTargets, fileWriteTargets } = require('../plugin/bin/lib/hooks/git-command');

// bash removes backslash-newline before tokenizing, so `&\<nl>&` is the `&&` operator.
test('#4245: gitTargets sees git after an && split by a backslash-newline', () => {
  assert.deepStrictEqual(gitTargets('cd /M &\\\n& git commit -m x', '/r'), [{ action: 'commit', dir: path.resolve('/M') }]);
});

test('#4245: fileWriteTargets sees cp after an && split by a backslash-newline', () => {
  assert.deepStrictEqual(fileWriteTargets('cd /M &\\\n& cp x b', '/r'), [{ action: 'copy', file: path.resolve('/M/b') }]);
});
