'use strict';
// Fixture for tests/helpers-run-cli.test.js: ok-cli.js with a script entry, so
// spawnCli and runCliSync can be compared on the same file.
const fs = require('fs');

function run(argv, deps) {
  deps.stdout(`${JSON.stringify({ argv, cwd: deps.cwd(), x: deps.env.X ?? null, stdin: deps.stdin() })}\n`);
  deps.stderr('warn\n');
  return Number(argv[0]) || 0;
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: () => process.cwd(),
  env: process.env,
  stdin: () => fs.readFileSync(0, 'utf8'),
};

module.exports = { run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
