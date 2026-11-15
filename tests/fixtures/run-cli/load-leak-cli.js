'use strict';
// Fixture for tests/helpers-run-cli.test.js: sets process.exitCode while the module loads, and
// its run itself touches nothing.

process.exitCode = 5;

function run() {
  return 0;
}

const realDeps = {};

module.exports = { run, realDeps };
