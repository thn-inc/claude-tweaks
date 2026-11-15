#!/usr/bin/env node
// bin/visual-decide.js — zero-dependency local server primitive for browser-based
// decision capture. `start --dir <content> --state <state-dir> [--port <n>]
// [--idle-minutes <n=240>]`, `stop --state <state-dir>`, `status --state <state-dir>`.
// See plugin/bin/lib/visual-decide/ for the implementation (#1202). Exports
// { run, realDeps }: the entry contract is
// .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md.
'use strict';

const { run, realDeps } = require('./lib/visual-decide/cli.js');

module.exports = { run, realDeps };

if (require.main === module) run(process.argv.slice(2), realDeps).then((code) => { process.exitCode = code; });
