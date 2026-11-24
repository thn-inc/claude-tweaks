'use strict';
// #4259: friction-events, calibration and phase-timing's guard-cost figure share one
// `test: true` exclusion (isTestTaggedEvent, bin/lib/friction-lens-vocab.js). One fixture
// events.jsonl, read through each consumer's own reader, must yield the same real-only count.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { scratchDir } = require('./helpers/tmp-dir');
const { readEvents: readFrictionEvents } = require('../plugin/bin/friction-events');
const { readEventsKinds } = require('../plugin/bin/lib/calibration/events-reader');
const { readEvents: readTimingEvents } = require('../plugin/bin/lib/timing/run-timing');
const { countGuardEvents } = require('../plugin/bin/lib/timing/derive');

function fixtureRunDir() {
  const dir = scratchDir('ct-test-tag-parity-');
  fs.writeFileSync(path.join(dir, 'events.jsonl'), [
    '{"type":"gate-denial","ts":"t1","tool":"Write","test":true}',
    '{"type":"gate-denial","ts":"t2","tool":"Edit"}',
    '{"type":"wd-guard-refusal","ts":"t3","test":true}',
    '{"type":"gate-exempt-gitignored","ts":"t4","test":true}',
    '{"type":"gate-exempt-gitignored","ts":"t5"}',
  ].join('\n') + '\n');
  return dir;
}

test('#4259 AC1: one test-tagged and one real gate-denial yield the same real-only count from every consumer', () => {
  const dir = fixtureRunDir();
  const friction = readFrictionEvents(dir, 'primary').filter((e) => e.type === 'gate-denial');
  const calibration = readEventsKinds(path.join(dir, 'events.jsonl')).counts['gate-denial'];
  const timing = readTimingEvents(path.join(dir, 'events.jsonl'));
  assert.equal(timing.ok, true);
  const guard = countGuardEvents(timing.events);

  assert.equal(friction.length, 1, 'friction-events keeps only the real gate-denial');
  assert.equal(friction[0].tool, 'Edit');
  assert.equal(calibration, 1, 'calibration counts only the real gate-denial');
  assert.equal(guard.gateDenial, 1, "phase-timing's guard-cost figure counts only the real gate-denial");
});

test('#4259: calibration drops a test-tagged gate-exempt-gitignored event and keeps the real one', () => {
  const { counts } = readEventsKinds(path.join(fixtureRunDir(), 'events.jsonl'));
  assert.equal(counts['gate-exempt-gitignored'], 1);
  assert.equal(counts['wd-guard-refusal'], undefined);
});
