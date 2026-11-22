'use strict';

// A `node --test` custom reporter that writes `tools/test-durations.json`, the per-file weights
// `tools/run-tests.js --shard` balances CI's parallel jobs by. `node tools/run-tests.js
// --record-durations tools/test-durations.json` loads it beside the normal reporter.
//
// A file's weight is the `duration_ms` of the per-file `test:summary` event node's runner emits when
// that file's process finishes, attributed to the test file that ran (process startup is not in it;
// run-tests.js adds a fixed per-file cost when it balances). Per-test events are not used: their
// `file` is where `test()` was called, which is a shared helper module whenever a helper declares
// the tests. Paths are written relative to the run's cwd (the repo
// root run-tests.js spawns from) with `/` separators, sorted, so a refresh diffs cleanly. A run that
// produced no per-file summary (a node too old to emit them) fails instead of writing an empty file.

const path = require('path');

// Adds one reporter event to `totals` (Map: absolute file -> ms). Pure apart from mutating `totals`.
// The run-wide summary has no `file` and is skipped.
function addEvent(totals, event) {
  if (!event || event.type !== 'test:summary') return;
  const data = event.data || {};
  if (!data.file || typeof data.duration_ms !== 'number') return;
  totals.set(data.file, (totals.get(data.file) || 0) + data.duration_ms);
}

// Renders `totals` as the durations file's JSON text, paths relative to `cwd`.
function renderDurations(totals, cwd) {
  if (totals.size === 0) throw new Error('test-durations-reporter: the run emitted no per-file test:summary event, so there is nothing to record');
  const files = {};
  const entries = [...totals.entries()]
    .map(([file, ms]) => [path.relative(cwd, file).split(path.sep).join('/'), Math.round(ms)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [file, ms] of entries) files[file] = ms;
  const doc = {
    comment: 'Per-file test time in ms, for tools/run-tests.js --shard. Refresh: node tools/run-tests.js --record-durations tools/test-durations.json',
    files,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

async function* testDurationsReporter(source) {
  const totals = new Map();
  for await (const event of source) addEvent(totals, event);
  yield renderDurations(totals, process.cwd());
}

module.exports = testDurationsReporter;
module.exports.addEvent = addEvent;
module.exports.renderDurations = renderDurations;
