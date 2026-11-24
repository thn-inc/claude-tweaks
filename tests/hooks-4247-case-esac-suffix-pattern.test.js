const { test } = require('node:test');
const assert = require('node:assert');
const { fileWriteTargets } = require('../plugin/bin/lib/hooks/git-command');

test('#4247 review: a case pattern ending in .esac does not close "$(case …)" early', () => {
  const command = 'echo "$(case $f in *.esac) echo "p>q";; esac)"';
  assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], command);
});
