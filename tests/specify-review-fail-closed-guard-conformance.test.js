// tests/specify-review-fail-closed-guard-conformance.test.js
//
// Pins record #3965's prose wiring: specify/red-team.md carries a
// deterministic detection step for a prose guard that must fail closed,
// naming the three input classes (empty, unreadable, malformed), and
// review/step3-lens-dispatch.md's lens 3c asks whether an every/all
// quantifier in such a guard holds over an empty set and whether a failed
// read is a hold. Each pin has a go-red control that runs the same
// assertion against text with the sentence removed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const RED_TEAM = readText(path.join(ROOT, 'plugin/skills/specify/red-team.md'));
const LENS = readText(path.join(ROOT, 'plugin/skills/review/step3-lens-dispatch.md'));

const HEADING = '## Fail-closed guard detection (deterministic, runs before persona dispatch)';
const CLASS_BULLETS = ['- **Empty input set**', '- **Unreadable source**', '- **Malformed value**'];
const LENS_QUESTION =
  'does an `every`/`all` quantifier in its rule still hold over an empty set, and is a failed read a hold rather than a pass?';

function sliceSection(text, heading, nextMarker) {
  const start = text.indexOf(heading);
  if (start === -1) return '';
  const next = text.indexOf(nextMarker, start + heading.length);
  return text.slice(start, next === -1 ? undefined : next);
}

function assertRedTeamStep(text) {
  const body = sliceSection(text, HEADING, '\n## ');
  assert.ok(body, `heading not found: ${HEADING}`);
  assert.ok(body.includes('fail closed'), 'section must name a guard whose job is to fail closed');
  assert.ok(body.includes('## Open Questions'), 'section must allow listing a missing class as an Open Question');
  assert.ok(
    body.includes('A missing class is a `critical` finding (persona column `Fail-Closed Guard Check`)') &&
      body.includes('stage-or-ask per write-back step 5'),
    'section must route a missing class as a critical finding that stages or asks',
  );
  for (const bullet of CLASS_BULLETS) {
    assert.ok(body.includes(bullet), `section must name the input class ${JSON.stringify(bullet)}`);
  }
}

function assertLensQuestion(text) {
  const body = sliceSection(text, '### 3c: Error Handling', '\n### ');
  assert.ok(body, 'lens 3c heading not found');
  assert.ok(body.includes(LENS_QUESTION), 'lens 3c must carry the fail-closed guard question');
}

test('AC1.1: red-team.md carries the fail-closed guard detection step', () => {
  assertRedTeamStep(RED_TEAM);
});

test('AC1.1: lens 3c carries the fail-closed guard question', () => {
  assertLensQuestion(LENS);
});

test('AC2.1: the red-team step names the three input classes: empty, unreadable, malformed', () => {
  const body = sliceSection(RED_TEAM, HEADING, '\n## ').toLowerCase();
  for (const word of ['empty', 'unreadable', 'malformed']) {
    assert.ok(body.includes(word), `section must name the ${word} input class`);
  }
});

test('the detection step sits between the Cross-AC literal check and Parallel dispatch', () => {
  const crossAcIdx = RED_TEAM.indexOf('## Cross-AC literal check');
  const stepIdx = RED_TEAM.indexOf(HEADING);
  const parallelIdx = RED_TEAM.indexOf('## Parallel dispatch');
  assert.ok(crossAcIdx !== -1 && stepIdx !== -1 && parallelIdx !== -1, 'all three headings must exist');
  assert.ok(crossAcIdx < stepIdx && stepIdx < parallelIdx, 'step must follow Cross-AC check and precede Parallel dispatch');
});

test('AC1.1 go-red: removing the red-team section fails the same assertion', () => {
  const body = sliceSection(RED_TEAM, HEADING, '\n## ');
  assert.throws(() => assertRedTeamStep(RED_TEAM.replace(body, '')));
});

test('AC2.1 go-red: removing any one input-class bullet fails the same assertion', () => {
  for (const bullet of CLASS_BULLETS) {
    assert.throws(() => assertRedTeamStep(RED_TEAM.split(bullet).join('- **Removed**')), `removing ${bullet} must fail`);
  }
});

test('AC1.1 go-red: removing the severity/routing sentence fails the same assertion', () => {
  const sentence = 'A missing class is a `critical` finding (persona column `Fail-Closed Guard Check`)';
  assert.ok(RED_TEAM.includes(sentence), 'control premise: the sentence exists to be removed');
  const body = sliceSection(RED_TEAM, HEADING, '\n## ');
  assert.throws(() => assertRedTeamStep(RED_TEAM.replace(body, body.replace(sentence, 'A missing class is noted'))));
  assert.throws(() => assertRedTeamStep(RED_TEAM.replace(body, body.replace('stage-or-ask per write-back step 5', ''))));
});

test('AC1.1 go-red: removing the lens 3c question fails the same assertion', () => {
  assert.throws(() => assertLensQuestion(LENS.replace(LENS_QUESTION, '')));
});
