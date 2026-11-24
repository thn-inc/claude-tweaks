'use strict';
// Fixture for tests/helpers-run-cli.test.js: calls the runner seam it keeps in realDeps.
// Kind `catch` swallows the runner's error, as a per-call fail-safe CLI does.

function run([kind], deps) {
  if (kind === 'catch') {
    try { deps.stdout(deps.runner()); } catch { /* fail-safe: degrade, keep going */ }
    return 0;
  }
  deps.stdout(deps.runner());
  return 0;
}

const realDeps = {
  runner: () => 'real-runner-reached',
  stdout: (s) => process.stdout.write(s),
};

module.exports = { run, realDeps };
