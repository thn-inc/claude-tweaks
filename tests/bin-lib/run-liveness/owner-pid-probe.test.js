'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('../../helpers/read-skill');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../../helpers/strip-comments');
const FILE = path.join(__dirname, '../../../plugin/bin/lib/run-liveness/owner-pid-probe.js');

test('owner-pid-probe.js is a leaf module: it requires nothing, so hooks/context.js can require it without a cycle (#4153)', () => {
  const raw = readText(FILE);
  const src = stripComments(raw);
  const verdict = stripperVerdict(raw, src);
  assert.strictEqual(verdict, 'ok', STRIPPER_VERDICT_MESSAGES[verdict]);
  assert.doesNotMatch(src, /\brequire\s*\(/);
  const m = require(FILE);
  assert.deepStrictEqual(Object.keys(m).sort(), ['MAX_PID', 'call', 'errorMessage', 'probeOwnerPid']);
});
