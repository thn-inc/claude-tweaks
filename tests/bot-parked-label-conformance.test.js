// tests/bot-parked-label-conformance.test.js — pins #605's split: bot:blocked is
// retry-ceiling-only; a merge-verification park (red/timed-out PR check) writes the
// distinct bot:parked label instead, leaving auto:* grants intact. Mirrors the shape of
// tests/merge-verification-gate-conformance.test.js and
// tests/work-record-needs-decision-conformance.test.js's label-taxonomy checks.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (...p) => fs.readFileSync(path.join(SKILLS, ...p), 'utf8');
const readFlat = (...p) => read(...p).replace(/\s+/g, ' ');

test('label-bootstrap.md carries bot:parked in the canonical LABELS_JSON, and bot:blocked no longer mentions merge-verification', () => {
  const flat = readFlat('_shared', 'label-bootstrap.md');
  assert.ok(flat.includes('["bot:parked",'), 'bot:parked missing from LABELS_JSON');
  assert.ok(!/\["bot:blocked",\s*"[^"]*merge-verification/i.test(read('_shared', 'label-bootstrap.md')), 'bot:blocked description must no longer describe the merge-verification park (that is bot:parked now)');
});

test('bot:parked label description fits GitHub\'s 100-char cap', () => {
  const { ensureLabelPayload } = require('../plugin/bin/lib/issues/labels.js');
  const match = read('_shared', 'label-bootstrap.md').match(/\["bot:parked",\s*"([^"]*)"\]/);
  assert.ok(match, 'could not locate the bot:parked LABELS_JSON row');
  assert.doesNotThrow(() => ensureLabelPayload('bot:parked', match[1]));
});

test('work-record.md documents bot:parked in the Bot state axis and label taxonomy table', () => {
  const flat = readFlat('_shared', 'work-record.md');
  assert.ok(flat.includes('`bot:parked`'), 'bot:parked missing from work-record.md');
  assert.ok(/Bot state.*`bot:in-progress`,\s*`bot:blocked`,\s*`bot:parked`/.test(flat), 'Bot state axis row must list all three labels');
});

test('pr-first-merge.md Step 2.5 red path writes bot:parked, not bot:blocked', () => {
  const gate = read('_shared', 'pr-first-merge.md');
  const step25 = gate.indexOf('## Step 2.5: Merge-verification gate');
  const step3 = gate.indexOf('## Step 3:');
  const section = gate.slice(step25, step3);
  assert.ok(section.includes('bot:parked'), 'red path must apply bot:parked');
  assert.ok(!/bootstrap-then-add `bot:blocked`/.test(section), 'red path must no longer bootstrap-then-add bot:blocked');
});

test('work-record-permission-matrix.md attributes the Executors/wrap-up merge-verification-park write to bot:parked', () => {
  const flat = readFlat('_shared', 'work-record-permission-matrix.md');
  assert.ok(/Executors.*`bot:parked`.*merge-verification park only/.test(flat), 'Executors row must write bot:parked for the merge-verification park');
});

const { parseRecordFacets } = require('../plugin/bin/lib/issues/record.js');
const { isBotBlocked, isBotParked } = require('../plugin/bin/lib/issues/record-buckets.js');

test('parseRecordFacets + record-buckets: bot:blocked and bot:parked are mutually exclusive facets', () => {
  const blocked = { facets: parseRecordFacets(['bot:blocked']) };
  const parked = { facets: parseRecordFacets(['bot:parked']) };
  assert.equal(isBotBlocked(blocked), true);
  assert.equal(isBotParked(blocked), false);
  assert.equal(isBotBlocked(parked), false);
  assert.equal(isBotParked(parked), true);
});
