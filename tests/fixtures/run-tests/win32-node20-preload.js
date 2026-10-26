'use strict';
// A `node -r` preload for tests/package-json-test-script.test.js: makes
// tools/run-tests.js's main block see a win32 platform on Node 20, so its
// buildTestArgs error path runs for real. child_process.spawnSync and spawn are
// replaced with tripwires before run-tests.js destructures them, so a regression
// that reaches either spawn writes a marker and never launches the suite.
Object.defineProperty(process, 'platform', { value: 'win32' });
Object.defineProperty(process, 'versions', { value: { ...process.versions, node: '20.0.0' } });
const childProcess = require('child_process');
for (const name of ['spawnSync', 'spawn']) {
  childProcess[name] = () => {
    process.stderr.write(`PRELOAD-TRIPWIRE: ${name} called\n`);
    process.exit(99);
  };
}
