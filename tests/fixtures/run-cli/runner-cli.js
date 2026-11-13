'use strict';
// Fixture for tests/helpers-run-cli.test.js: calls the runner seam it keeps in realDeps.

function run(argv, deps) {
  deps.stdout(deps.runner());
  return 0;
}

const realDeps = {
  runner: () => 'real-runner-reached',
  stdout: (s) => process.stdout.write(s),
};

module.exports = { run, realDeps };
