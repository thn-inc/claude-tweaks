'use strict';
// Fixture for tests/helpers-run-cli.test.js: an async run.

async function run(argv, deps) {
  await new Promise((r) => setTimeout(r, 20));
  deps.stdout('done\n');
  return 3;
}

const realDeps = { stdout: (s) => process.stdout.write(s) };

module.exports = { run, realDeps };
