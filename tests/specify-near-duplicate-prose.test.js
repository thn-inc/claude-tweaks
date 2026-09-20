// tests/specify-near-duplicate-prose.test.js
//
// Pins record #1944's prose wiring: shaping-mode.md must run the
// near-duplicate finder before composition and route a ready+in-flight
// candidate to needs:decision; next-mode-shape.md must cite the same step
// for the headless drain; dispatch/queue-pull-script.md and SKILL.md must
// carry the cross-group warning. The mechanical half (the three signals,
// exclusions, thresholds) is pinned separately in
// tests/bin-lib/issues/near-duplicate.test.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SHAPING_MODE = read('plugin/skills/specify/shaping-mode.md');
const SHAPING_STAMPING = read('plugin/skills/specify/shaping-mode-stamping.md');
const NEXT_MODE_SHAPE = read('plugin/skills/specify/next-mode-shape.md');
const QUEUE_PULL = read('plugin/skills/dispatch/queue-pull-script.md');
const DISPATCH_SKILL = read('plugin/skills/dispatch/SKILL.md');

test('shaping-mode.md runs the near-duplicate check before composition and cites the module', () => {
  assert.match(SHAPING_MODE, /Near-duplicate candidate check \(#1944\), also before composition/);
  assert.match(SHAPING_MODE, /findNearDuplicates/);
  assert.match(SHAPING_MODE, /bin\/lib\/issues\/near-duplicate\.js/);
  const idx = SHAPING_MODE.indexOf('Near-duplicate candidate check');
  const dependencyIdx = SHAPING_MODE.indexOf('### Dependency-narration check');
  assert.ok(idx !== -1 && dependencyIdx !== -1);
  assert.ok(idx < dependencyIdx, 'near-duplicate check must land before the dependency-narration check, both before composition');
});

test('shaping-mode.md renders a three-column candidate table and appends to Related', () => {
  assert.match(SHAPING_MODE, /\|\s*Record\s*\|\s*Score\s*\|\s*Signals\s*\|/);
  assert.match(SHAPING_MODE, /\*\*Related:\*\*/);
});

test('shaping-mode.md routes a ready+in-flight candidate to needs:decision with an Absorb proposal, never composing', () => {
  assert.match(SHAPING_MODE, /stop shaping this record here/);
  assert.match(SHAPING_MODE, /needs:decision/);
  assert.match(SHAPING_MODE, /<!-- needs-decision: specify -->/);
  assert.match(SHAPING_MODE, /Absorb into #\{candidate\}/);
});

test('shaping-mode-stamping.md\'s Actions Performed outcome vocabulary includes the refusal', () => {
  assert.match(SHAPING_STAMPING, /refused — proposed Absorb into #\{candidate\}/);
});

test('next-mode-shape.md cites the near-duplicate check for the headless drain and files the refusal into the failed bucket', () => {
  assert.match(NEXT_MODE_SHAPE, /Near-duplicate candidate check also runs headlessly \(#1944\)/);
  const section = NEXT_MODE_SHAPE.slice(NEXT_MODE_SHAPE.indexOf('Near-duplicate candidate check also runs headlessly'));
  assert.match(section.slice(0, 600), /`failed`\s+bucket/);
});

test('dispatch/queue-pull-script.md runs the cross-group near-duplicate warning after the cross-PR overlap block', () => {
  assert.match(QUEUE_PULL, /#1944: cross-group near-duplicate candidate warning/);
  assert.match(QUEUE_PULL, /findNearDuplicates/);
  const crossPrIdx = QUEUE_PULL.indexOf('#1579: cross-PR root-cause overlap report');
  const nearDupIdx = QUEUE_PULL.indexOf('#1944: cross-group near-duplicate candidate warning');
  assert.ok(crossPrIdx !== -1 && nearDupIdx !== -1);
  assert.ok(crossPrIdx < nearDupIdx, 'the cross-group warning runs after the cross-PR overlap report');
  assert.match(QUEUE_PULL, /near-duplicate candidates across groups/);
});

test('dispatch/SKILL.md Step 3 documents the near-duplicate candidate warning as non-gating', () => {
  assert.match(DISPATCH_SKILL, /Near-duplicate candidate warning \(refs #1944\)/);
  assert.match(DISPATCH_SKILL, /Warning\s+only, never a gate/);
});

test('the cited module actually exports findNearDuplicates', () => {
  const mod = require('../plugin/bin/lib/issues/near-duplicate');
  assert.strictEqual(typeof mod.findNearDuplicates, 'function');
});
