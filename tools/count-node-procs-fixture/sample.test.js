'use strict';
// tools/count-node-procs-fixture/sample.test.js — the fixture for tests/count-node-procs.test.js's
// AC10.1 real-run test (#5844). It sits outside tests/ so a default suite run does not discover it.
// It starts exactly one git process and exactly one child node process (a side-effect-free
// plugin/bin CLI's --help), and nothing else.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('fixture starts one git process and one node CLI child', () => {
  execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true });
  const cli = path.join(__dirname, '..', '..', 'plugin', 'bin', 'compose-record.js');
  const out = execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', windowsHide: true });
  assert.match(out, /usage:/);
});
