'use strict';
// tests/build-micro-plan-code-twin.test.js — #6053 AC4: micro-plan.md's applicability gate cites
// plugin/bin/lib/issues/micro-plan-gate.js instead of restating its implementation-file count.
// The numbered conditions are parsed row-for-row against MICRO_PLAN_CONDITIONS; the count and
// the counting rule are absent from the prose (they live in the module's header comment).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { MICRO_PLAN_CONDITIONS } = require('../plugin/bin/lib/issues/micro-plan-gate');

const MICRO_PLAN = readText(path.join(__dirname, '..', 'plugin', 'skills', 'build', 'micro-plan.md'));
// A restated count in any of its usual spellings: one / 1 / a single, at most / no more than, two / 2 or more.
const BANNED = [
  /\b(?:at most|no more than|up to)\s+(?:one|1|a single)\s+implementation files?\b/i,
  /\b(?:two|2)\s+or\s+more\s+implementation files?\b/i,
  /\ba single implementation file\b/i,
  /<=\s*1 implementation/i,
];

function gateSection(text) {
  const start = text.indexOf('## Applicability gate');
  const end = text.indexOf('**Any other header shape**');
  assert.ok(start !== -1 && end > start, 'gate section bounds not found');
  return text.slice(start, end);
}

// Every positive and absence assertion lives here so go-red controls can call it on mutated text.
function assertMicroPlanCitesCode(text) {
  const gate = gateSection(text);
  const items = gate.split('\n').filter((l) => /^\d+\.\s/.test(l));
  assert.equal(items.length, MICRO_PLAN_CONDITIONS.length, 'numbered gate items vs MICRO_PLAN_CONDITIONS');
  // an item runs from its number line to the next one (or section end)
  const starts = gate.split('\n').map((l, i) => (/^\d+\.\s/.test(l) ? i : -1)).filter((i) => i >= 0);
  const lines = gate.split('\n');
  starts.forEach((s, i) => {
    const item = lines.slice(s, starts[i + 1] ?? lines.length).join(' ').replace(/\s+/g, ' ');
    // Each item carries its own id and none of the others': a swap or a stray id fails here.
    MICRO_PLAN_CONDITIONS.forEach((id, j) => {
      const carries = item.includes(`(\`${id}\`)`);
      if (j === i) assert.ok(carries, `item ${i + 1} must carry (\`${id}\`)`);
      else assert.ok(!carries, `item ${i + 1} must not carry item ${j + 1}'s (\`${id}\`)`);
    });
  });
  const flat = gate.replace(/\s+/g, ' ');
  for (const name of ['bin/lib/issues/micro-plan-gate.js', 'MAX_IMPLEMENTATION_FILES', 'countImplementationFiles', 'evaluateMicroPlanGate', '`ceremony`', '`size`']) {
    assert.ok(flat.includes(name), `gate section must name ${name}`);
  }
  const whole = text.replace(/\s+/g, ' ');
  for (const re of BANNED) assert.ok(!re.test(whole), `micro-plan.md must not match ${re}`);
}

test('AC4.1: micro-plan.md cites micro-plan-gate.js and restates no count', () => {
  assertMicroPlanCitesCode(MICRO_PLAN);
});

test('AC4.1 go-red: a restated count, a dropped id, a dropped citation and a dropped item each fail', () => {
  assert.throws(() => assertMicroPlanCitesCode(MICRO_PLAN.replace('## Composing', 'names at most one implementation file.\n\n## Composing')));
  assert.throws(() => assertMicroPlanCitesCode(MICRO_PLAN.replace('than condition 3 allows', 'than two or more implementation\nfiles allow')));
  for (const restated of ['names at most 1 implementation file.', 'names a single implementation file.', 'names no more than one implementation file.']) {
    assert.throws(() => assertMicroPlanCitesCode(MICRO_PLAN.replace('## Composing', `${restated}\n\n## Composing`)), restated);
  }
  assert.throws(() => assertMicroPlanCitesCode(MICRO_PLAN.replace('(`implementation-file-limit`)', '')));
  assert.throws(() => assertMicroPlanCitesCode(MICRO_PLAN.replaceAll('countImplementationFiles', 'countFiles')));
  assert.throws(() => assertMicroPlanCitesCode(MICRO_PLAN.replace(/\n4\. The spec body[\s\S]*?(?=\n\*\*Any other)/, '')));
});

test('AC4.1 go-red: two ids swapped between items, or one item carrying another item\'s id, each fail', () => {
  const swapped = MICRO_PLAN.replace('(`low-size`)', '(`SWAP`)').replace('(`no-risk-flag`)', '(`low-size`)').replace('(`SWAP`)', '(`no-risk-flag`)');
  assert.notEqual(swapped, MICRO_PLAN, 'the swap control changed the text');
  assert.throws(() => assertMicroPlanCitesCode(swapped), /item 2 must/);
  const stray = MICRO_PLAN.replace('(`low-size`)', '(`low-size`) (`no-risk-flag`)');
  assert.notEqual(stray, MICRO_PLAN, 'the stray-id control changed the text');
  assert.throws(() => assertMicroPlanCitesCode(stray), /item 2 must not carry item 4's/);
});
