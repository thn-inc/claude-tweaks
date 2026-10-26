'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const { shellQuote } = require('./helpers/shell-quote');

test('#4281: shellQuote yields a word whose bash value is the input', () => {
  assert.strictEqual(shellQuote('D:\\a\\_temp\\x'), "'D:\\a\\_temp\\x'");
  assert.strictEqual(shellQuote("it's"), "'it'\\''s'");
});

test('#4281: shellQuote is compose-subject.js\'s own, not a second copy', () => {
  assert.strictEqual(shellQuote, require('../plugin/bin/lib/compose-subject').shellQuote);
});

test('#4281: shellQuote round-trips through real bash', { skip: process.platform === 'win32' && 'no /bin/bash on win32' }, () => {
  for (const v of ['D:\\a\\_temp\\x', "it's", '/tmp/a b', 'x$y`z']) {
    const out = spawnSync('/bin/bash', ['-c', `printf %s ${shellQuote(v)}`]).stdout.toString();
    assert.strictEqual(out, v);
  }
});
