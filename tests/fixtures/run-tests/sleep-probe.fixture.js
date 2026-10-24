// Not a `*.test.js` on purpose (see tmpdir-probe.fixture.js). tests/run-tests-isolation.test.js
// copies it in as `sleep.test.js`: it writes its pid to `process.env.CT_PROBE_OUT` once started, then
// sleeps far longer than any bound the test puts on the runner, so a runner that waits for it to finish
// is caught, and a worker orphaned by a signalled runner is still findable by pid (#3969).
'use strict';
const { test } = require('node:test');
const fs = require('fs');

test('signals it started, then sleeps', async () => {
  fs.writeFileSync(process.env.CT_PROBE_OUT, String(process.pid));
  await new Promise((resolve) => setTimeout(resolve, 60000));
});
