#!/usr/bin/env node
// bin/express-lane.js — the express lane's (#4025) gate, post-build check, escalation
// writer, artifact verifier and post-merge review sampler. A thin entry: the verbs,
// USAGE and exit-code contract live in bin/lib/express/cli.js.
'use strict';

const { run, realDeps } = require('./lib/express/cli');

module.exports = { run };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
