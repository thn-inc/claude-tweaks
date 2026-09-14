#!/usr/bin/env node
// bin/compose-subject.js — thin wrapper over bin/lib/compose-subject.js
// (#2251): the one shell command every merge site calls to get a Conventional-Commits
// merge subject + body for a record (or a bundle). See that module's header for usage,
// output forms, and the exit-code contract.
'use strict';
const { run, realDeps } = require('./lib/compose-subject');

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
