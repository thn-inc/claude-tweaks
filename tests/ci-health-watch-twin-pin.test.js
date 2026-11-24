// tests/ci-health-watch-twin-pin.test.js
//
// #5161: the merge-verification gate's bounded watch (900 s) has one code definition,
// plugin/bin/lib/ci-health/constants.js's MERGE_GATE_WATCH_SECONDS, which /harness-health's CI
// health check compares workflow p90 durations against. The gate's shell keeps its literal `900`
// (an agent runs that fence; it cannot require the module), so the two are a prose-code twin and
// this suite pins them equal.
//
// [IL-80] carve-out: this suite reads plugin/skills/_shared/pr-first-merge.md live rather than a
// frozen fixture, because the gate prose is the declared contract: the `DEADLINE=` line is what an
// agent executes, and the heading's minutes and the park reason's `{n}m` are what it reports. A
// fixture would pin a copy that can drift from the file agents actually read.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');
const { MERGE_GATE_WATCH_SECONDS } = require('../plugin/bin/lib/ci-health/constants');

const GATE = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'pr-first-merge.md'));

// The bounded-watch section: from its bold heading through the end of the first `bash` fence after
// it. Each anchor is asserted found before slicing, so a renamed heading or fence fails loud instead
// of yielding an empty slice every assertion runs over. Tolerates CRLF line endings.
function watchSection(text) {
  const start = text.indexOf('**Bounded watch (');
  assert.ok(start !== -1, 'bounded-watch heading not found');
  const open = text.indexOf('```bash', start);
  assert.ok(open !== -1, 'bounded-watch bash fence not found');
  const rest = text.slice(open + 7);
  const m = /\r?\n```/.exec(rest);
  const close = m ? open + 7 + m.index : -1;
  assert.ok(close !== -1, 'bounded-watch bash fence close not found');
  return text.slice(start, close);
}

function assertWatchTwin(text, seconds) {
  const section = watchSection(text);
  const deadlines = [...section.matchAll(/DEADLINE=\$\(\( \$\(date \+%s\) \+ (\d+) \)\)/g)];
  assert.equal(deadlines.length, 1, `expected exactly one DEADLINE= line, found ${deadlines.length}`);
  assert.equal(Number(deadlines[0][1]), seconds, 'DEADLINE= literal differs from the watch constant');
  assert.ok(section.includes('`MERGE_GATE_WATCH_SECONDS`'), 'watch section does not name `MERGE_GATE_WATCH_SECONDS`');
  assert.ok(section.includes('bin/lib/ci-health/constants.js'), 'watch section does not cite bin/lib/ci-health/constants.js');
  const heading = /— (\d+) minutes, fixed\.\*\*/.exec(section);
  assert.ok(heading, 'heading minutes not found');
  assert.equal(Number(heading[1]) * 60, seconds, 'heading minutes differ from the watch constant');
  const park = /checks still pending after (\d+)m/.exec(text);
  assert.ok(park, 'park reason minutes not found');
  assert.equal(Number(park[1]) * 60, seconds, 'park reason minutes differ from the watch constant');
}

test('AC9.1: constants.js exports MERGE_GATE_WATCH_SECONDS = 900 and the gate prose names it beside an equal literal', () => {
  assert.strictEqual(MERGE_GATE_WATCH_SECONDS, 900);
  assertWatchTwin(GATE, MERGE_GATE_WATCH_SECONDS);
  assertWatchTwin(GATE.replace(/\n/g, '\r\n'), MERGE_GATE_WATCH_SECONDS);
});

test('AC9.2: changing either side alone fails', () => {
  assert.throws(
    () => assertWatchTwin(GATE.replace('+ 900 ))', '+ 1800 ))'), MERGE_GATE_WATCH_SECONDS),
    /DEADLINE= literal differs/,
  );
  assert.throws(() => assertWatchTwin(GATE, 1800), /DEADLINE= literal differs/);
  assert.throws(
    () => assertWatchTwin(GATE.replace('`MERGE_GATE_WATCH_SECONDS`', '`WATCH`'), MERGE_GATE_WATCH_SECONDS),
    /does not name `MERGE_GATE_WATCH_SECONDS`/,
  );
  // The helper's other four assertions, each given its own go-red control so a dropped check fails.
  assert.throws(
    () => assertWatchTwin(GATE.replace('+ 900 ))', '+ 900 ))\nDEADLINE=$(( $(date +%s) + 1800 ))'), MERGE_GATE_WATCH_SECONDS),
    /expected exactly one DEADLINE= line, found 2/,
  );
  assert.throws(
    () => assertWatchTwin(GATE.replace('bin/lib/ci-health/constants.js', 'bin/lib/constants.js'), MERGE_GATE_WATCH_SECONDS),
    /does not cite bin\/lib\/ci-health\/constants\.js/,
  );
  assert.throws(
    () => assertWatchTwin(GATE.replace('— 15 minutes, fixed.**', '— 30 minutes, fixed.**'), MERGE_GATE_WATCH_SECONDS),
    /heading minutes differ/,
  );
  assert.throws(
    () => assertWatchTwin(GATE.replace('checks still pending after 15m', 'checks still pending after 30m'), MERGE_GATE_WATCH_SECONDS),
    /park reason minutes differ/,
  );
});
