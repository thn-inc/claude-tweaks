'use strict';
// Fixture for tests/helpers-run-cli.test.js: echoes what it received through deps.

function run(argv, deps) {
  deps.stdout(`${JSON.stringify({ argv, cwd: deps.cwd(), x: deps.env.X ?? null, stdin: deps.stdin() })}\n`);
  deps.stderr('warn\n');
  if (argv[0] === 'undefined') return undefined;
  return Number(argv[0]) || 0;
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: () => process.cwd(),
  env: process.env,
  stdin: () => '',
};

module.exports = { run, realDeps };
