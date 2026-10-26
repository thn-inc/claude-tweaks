'use strict';
// A `node -r` preload for tests/run-tests-isolation.test.js: makes tools/run-tests.js's main
// block see a win32 platform on Node 22, so its Windows command-line bound runs for real.
// child_process.spawn is replaced with a stub before run-tests.js destructures it: the stub
// reports the argv `node --test` would have received and exits 0, so nothing is ever launched.
Object.defineProperty(process, 'platform', { value: 'win32' });
Object.defineProperty(process, 'versions', { value: { ...process.versions, node: '22.0.0' } });
const childProcess = require('child_process');
childProcess.spawn = (_execPath, args) => {
  process.stderr.write(`SPAWN-ARGS: ${JSON.stringify(args)}\n`);
  process.exit(0);
};
