// tests/dispatch-shipped-candidate-prose.test.js
//
// Pins record #1984's prose wiring: queue-pull-script.md must classify
// shipped candidates (title-only first pass, capped files-based upgrade
// second pass, staged Close proposal) after the #1224 open-PR exclusion and
// before the #1579 cross-PR overlap report; SKILL.md must state the
// False-positive posture and the accepted false negative, and report the
// exclusion the same non-gating way as its siblings. The mechanical half
// (the strong/weak/none tiering, the timeline-mentions extension) is pinned
// separately in tests/bin-lib/issues/shipped-candidate.test.js and
// tests/bin-lib/issues/linked-prs.test.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const QUEUE_PULL = read('plugin/skills/dispatch/queue-pull-script.md');
const DISPATCH_SKILL = read('plugin/skills/dispatch/SKILL.md');

test('queue-pull-script.md classifies shipped candidates after the #1224 exclusion and before the #1579 report', () => {
  const openPrIdx = QUEUE_PULL.indexOf('#1224: open-linked-PR exclusion');
  const shippedIdx = QUEUE_PULL.indexOf('#1984: shipped-candidate classification');
  const crossPrIdx = QUEUE_PULL.indexOf('#1579: cross-PR root-cause overlap report');
  assert.ok(openPrIdx !== -1 && shippedIdx !== -1 && crossPrIdx !== -1);
  assert.ok(openPrIdx < shippedIdx, 'shipped-candidate classification runs after the open-PR exclusion');
  assert.ok(shippedIdx < crossPrIdx, 'shipped-candidate classification runs before the cross-PR overlap report');
  assert.match(QUEUE_PULL, /classifyShipped/);
});

test('queue-pull-script.md caps the live gh pr view files probe at 5 per pull', () => {
  const section = QUEUE_PULL.slice(QUEUE_PULL.indexOf('#1984: shipped-candidate classification'));
  assert.match(section.slice(0, 4000), /\.slice\(0, 5\)/);
  assert.match(section.slice(0, 4000), /gh pr view "\$PR" --json files/);
});

test('queue-pull-script.md excludes strong-tier candidates from DISPATCH_GROUPS and logs AUTO, weak stays eligible with its own log line', () => {
  assert.match(QUEUE_PULL, /excluded, shipped by merged PR/);
  assert.match(QUEUE_PULL, /without a closing keyword; dispatching anyway/);
});

test('queue-pull-script.md stages a Close proposal for a strong exclusion rather than closing directly', () => {
  const section = QUEUE_PULL.slice(QUEUE_PULL.indexOf('#1984: shipped-candidate classification'));
  assert.match(section, /stage-item\.js/);
  assert.match(section, /## Close \(GitHub\)/);
  assert.doesNotMatch(section.slice(0, section.indexOf('stage-item.js')), /gh issue close \$/);
});

test('SKILL.md states the two-independent-signal false-positive posture and the accepted false negative', () => {
  assert.match(DISPATCH_SKILL, /False-positive posture \(#1984\)/);
  assert.match(DISPATCH_SKILL, /two independent signals, never one alone/);
  assert.match(DISPATCH_SKILL, /residual false negative/);
});

test('SKILL.md queue definition names the shipped-candidate exclusion, and reports it the same non-gating way as its siblings', () => {
  assert.match(DISPATCH_SKILL, /not already shipped by a `strong`-tier merged-PR mention \(#1984\)/);
  assert.match(DISPATCH_SKILL, /Shipped-candidate exclusion report \(refs #1984\)/);
});

test('the cited modules actually export classifyShipped and the extended fetchLinkedPRs', () => {
  const shipped = require('../plugin/bin/lib/issues/shipped-candidate');
  assert.strictEqual(typeof shipped.classifyShipped, 'function');
  const linkedPrs = require('../plugin/bin/lib/issues/linked-prs');
  assert.strictEqual(typeof linkedPrs.fetchLinkedPRs, 'function');
});
