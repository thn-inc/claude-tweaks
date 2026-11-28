'use strict';
// Fixture for tests/helpers-run-cli.test.js: emits through the optional `stationEvent` seam it
// keeps in realDeps, inside its own try/catch as every real station-event call site does (#5902).

function run(argv, deps) {
  try { deps.stdout(`${deps.stationEvent({ kind: 'entered' })}`); } catch { /* best-effort: the emit never changes the result */ }
  return 0;
}

const realDeps = {
  stationEvent: () => 'real-station-event-reached',
  stdout: (s) => process.stdout.write(s),
};

module.exports = { run, realDeps };
