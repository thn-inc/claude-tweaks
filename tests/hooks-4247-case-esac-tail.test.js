const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { fileWriteTargets } = require('../plugin/bin/lib/hooks/git-command');

test('#4247 review: a quoted $(case …) with commands after esac still closes, so a later redirect resolves', () => {
  const command = 'echo "$(case $x in a) echo hi;; esac; true)" && echo y > o.js';
  assert.deepStrictEqual(fileWriteTargets(command, '/r'), [{ action: 'write', file: path.resolve('/r', 'o.js') }], command);
});

test('#4247 review: a quoted $(case …) piped after esac still closes, so a later redirect resolves', () => {
  const command = 'echo "$(case $x in a) echo hi;; esac | tr a b)" && echo y > o.js';
  assert.deepStrictEqual(fileWriteTargets(command, '/r'), [{ action: 'write', file: path.resolve('/r', 'o.js') }], command);
});
