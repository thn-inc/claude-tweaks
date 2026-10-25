// A `--require` preload loaded before tools/test-impact/tracer.js by the trace-write failure tests in
// tests/test-impact-cli.test.js and tests/test-impact-tracer.test.js (#4158): it makes fs.appendFileSync
// throw ENOSPC when a `.trace` file takes the read of lib/y.js, so the tracer's trace write fails. With
// FAIL_TRACE_APPEND=all it throws for every `.trace` and `.lost` file, so the loss marker cannot land either.
'use strict';
const fs = require('fs');
const appendFileSync = fs.appendFileSync;
fs.appendFileSync = function (file, data, ...rest) {
  const name = String(file);
  const all = process.env.FAIL_TRACE_APPEND === 'all' && (name.endsWith('.trace') || name.endsWith('.lost'));
  const y = name.endsWith('.trace') && String(data).includes('"lib/y.js"');
  if (all || y) throw Object.assign(new Error(`ENOSPC: no space left on device, write '${name}'`), { code: 'ENOSPC' });
  return appendFileSync.call(this, file, data, ...rest);
};
