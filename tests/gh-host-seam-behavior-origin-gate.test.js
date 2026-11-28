'use strict';
// #4933 origin-gate behavior table, second half: the CLI_TABLE rows from parent-gate.js on
// (the first rows run in gh-host-seam-behavior.test.js). Fixtures and the table live in
// helpers/gh-host-seam.js; the split only spreads the run time across CI shards.
const { CLI_TABLE, describeOriginGate } = require('./helpers/gh-host-seam');

for (const row of CLI_TABLE.slice(6)) describeOriginGate(row);
