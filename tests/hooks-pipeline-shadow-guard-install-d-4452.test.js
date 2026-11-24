'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');
const pre = require('../plugin/bin/lib/hooks/pre-tool-use');
const { shellQuote } = require('./helpers/shell-quote');

const bashInput = (command, cwd) => ({ tool_name: 'Bash', tool_input: { command }, cwd });

test('#4452: install -d on an EXISTING worktree pipelines dir creates no entry and stays allowed', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const pipelines = path.join(wt, '.claude-tweaks', 'pipelines');
  fs.mkdirSync(pipelines, { recursive: true });
  // Control: mkdir -p on the same existing dir is allowed.
  const ctl = pre.run({ env: process.env, input: bashInput(`mkdir -p ${shellQuote(pipelines)}`, main), runDir: null, runState: null, cwd: main });
  assert.deepStrictEqual(ctl, {}, 'control mkdir -p unexpectedly denied: ' + JSON.stringify(ctl));
  const out = pre.run({ env: process.env, input: bashInput(`install -d ${shellQuote(pipelines)}`, main), runDir: null, runState: null, cwd: main });
  assert.deepStrictEqual(out, {}, 'install -d of an existing dir creates nothing under it, but got: ' + JSON.stringify(out));
});
