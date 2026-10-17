'use strict';
// A `node -r` preload for tests/package-json-test-script.test.js: makes
// tools/run-tests.js's main block see a win32 platform on Node 20, so its
// buildTestArgs error path runs for real. child_process.spawnSync is replaced
// with a tripwire before run-tests.js destructures it, so a regression that
// reaches the spawn writes a marker and never launches the suite.
Object.defineProperty(process, 'platform', { value: 'win32' });
Object.defineProperty(process, 'versions', { value: { ...process.versions, node: '20.0.0' } });
require('child_process').spawnSync = () => {
  process.stderr.write('PRELOAD-TRIPWIRE: spawnSync called\n');
  return { status: 99 };
};
