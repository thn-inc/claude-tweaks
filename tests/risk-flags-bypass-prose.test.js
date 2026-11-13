// tests/risk-flags-bypass-prose.test.js — pins #4618's rule that a record carrying a kept
// risk flag stays off the two paths with no audited proof step: the micro-plan path
// (plugin/skills/build/micro-plan.md's applicability gate) and the express lane
// (plugin/skills/_shared/express-lane.md's Eligibility section; the code twin is
// bin/lib/express/eligibility.js, pinned in tests/bin-lib/express/eligibility.test.js).
// Reads the live skill files — this pins prose we just wrote, not a third-party fact
// (skill-prose-conformance-tests' live-vs-fixture distinction). One assertion function
// runs the positive case and every go-red control; a literal scoped to a section also has
// a scoping control: the literal moved out of its section, to the end of the file, must
// still fail.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const LIVE = {
  microPlan: read('plugin/skills/build/micro-plan.md'),
  express: read('plugin/skills/_shared/express-lane.md'),
};

// The text from `start` up to the next `end` heading; '' when either is missing, so a
// literal pinned to a lost region fails by name.
function section(text, start, end) {
  const from = text.indexOf(start);
  if (from === -1) return '';
  const to = text.indexOf(end, from + start.length);
  return to === -1 ? '' : text.slice(from, to);
}

const gate = (t) => section(t.microPlan, '## Applicability gate', '## Composing the micro-plan');
const eligibility = (t) => section(t.express, '## Eligibility', '## Procedure');

// Each row: label, the region the literal must sit in, the literal.
const PINS = [
  ['micro-plan.md gate condition 4', gate, '4. The spec body does not carry a risk flag'],
  ['micro-plan.md gate condition 4', gate, '`parseRiskFlags`'],
  ['micro-plan.md gate fall-through paragraph', gate, 'a spec body that carries a risk flag'],
  ['micro-plan.md applicability gate', gate, 'All four must hold'],
  ['express-lane.md Eligibility', eligibility, 'kept risk flag'],
];

function failures(texts) {
  return PINS.filter(([, region, literal]) => !region(texts).includes(literal))
    .map(([where, , literal]) => `${where}: ${literal}`);
}

function assertBypassProse(texts) {
  const failed = failures(texts);
  assert.deepStrictEqual(failed, [], `risk-flag bypass prose is missing: ${failed.join('; ')}`);
}

const names = (label) => (err) => err.message.includes(label);

test('#4618: micro-plan.md\'s applicability gate and express-lane.md\'s Eligibility both keep a flagged record off the unaudited path', () => {
  assertBypassProse(LIVE);
});

for (const [where, , literal] of PINS) {
  test(`#4618 go-red: removing "${literal}" from ${where} fails the same assertion, naming it`, () => {
    const mutated = {
      microPlan: LIVE.microPlan.split(literal).join(''),
      express: LIVE.express.split(literal).join(''),
    };
    assert.throws(() => assertBypassProse(mutated), names(`${where}: ${literal}`));
  });
  test(`#4618 go-red: "${literal}" moved out of ${where} to the end of the file still fails`, () => {
    const moved = (text) => `${text.split(literal).join('')}\n\n${literal}\n`;
    const mutated = { microPlan: moved(LIVE.microPlan), express: moved(LIVE.express) };
    assert.throws(() => assertBypassProse(mutated), names(`${where}: ${literal}`));
  });
}

// Deleting the condition itself (its whole list item) must go red even though the
// fall-through paragraph still names a flagged record.
test('#4618 go-red: deleting micro-plan.md\'s condition 4 list item fails the condition pins', () => {
  const start = LIVE.microPlan.indexOf('4. The spec body does not carry a risk flag');
  const end = LIVE.microPlan.indexOf('\n\n', start);
  assert.ok(start !== -1 && end > start, 'condition 4 item not found');
  const mutated = { ...LIVE, microPlan: LIVE.microPlan.slice(0, start) + LIVE.microPlan.slice(end + 1) };
  assert.notStrictEqual(mutated.microPlan, LIVE.microPlan);
  assert.throws(() => assertBypassProse(mutated), names('micro-plan.md gate condition 4: `parseRiskFlags`'));
  assert.throws(() => assertBypassProse(mutated), names('micro-plan.md gate condition 4: 4. The spec body does not carry a risk flag'));
});
