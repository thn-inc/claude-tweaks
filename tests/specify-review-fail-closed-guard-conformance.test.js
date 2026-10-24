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
const SEVERITY_SENTENCE = 'A missing class is a `critical` finding (persona column `Fail-Closed Guard Check`)';
const ROUTING_CLAUSE = 'stage-or-ask per write-back step 5';
const LENS_QUESTION =
  'does an `every`/`all` quantifier in its rule still hold over an empty set, and is a failed read a hold rather than a pass?';

function sliceSection(text, heading, nextMarker) {
  const start = text.indexOf(heading);
  if (start === -1) return '';
  const next = text.indexOf(nextMarker, start + heading.length);
  // A missing end anchor would widen the slice to the rest of the file, so a presence assertion
  // could match later text and stay green after the real section lost its sentence.
  assert.notEqual(next, -1, `end anchor ${JSON.stringify(nextMarker)} not found after ${JSON.stringify(heading)}`);
  return text.slice(start, next);
}

function assertRedTeamStep(text) {
  const body = sliceSection(text, HEADING, '\n## ');
  assert.ok(body, `heading not found: ${HEADING}`);
  assert.ok(body.includes('fail closed'), 'section must name a guard whose job is to fail closed');
  assert.ok(body.includes('## Open Questions'), 'section must allow listing a missing class as an Open Question');
  assert.ok(body.includes(SEVERITY_SENTENCE), 'section must rate a missing class a critical Fail-Closed Guard Check finding');
  assert.ok(body.includes(ROUTING_CLAUSE), 'section must route a missing class to stage-or-ask per write-back step 5');
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

// Go-red controls mutate the live text in memory (the pinned prose is new in this change, so
// there is no pre-change excerpt), and each must fail with its own assertion's message: a bare
// assert.throws is satisfied by whichever assertion fails first. The notEqual guard stops a
// replace that matched nothing from passing as a control.
function expectRed(assertFn, original, mutated, messagePart) {
  assert.notEqual(mutated, original, 'mutation matched nothing — the control would pass vacuously');
  assert.throws(
    () => assertFn(mutated),
    (err) => err.message.includes(messagePart),
    `expected the assertion to fail with a message containing ${JSON.stringify(messagePart)}`,
  );
}

function mutateSection(text, from, to) {
  const body = sliceSection(text, HEADING, '\n## ');
  assert.ok(body.includes(from), `control premise: the section holds ${JSON.stringify(from)}`);
  return text.replace(body, body.replace(from, to));
}

test('sliceSection refuses a section whose end anchor is missing instead of widening to end of file', () => {
  const intact = '## A\nbody\n## B\nrest';
  assert.equal(sliceSection(intact, '## A', '\n## '), '## A\nbody');
  assert.throws(() => sliceSection('## A\nbody and no later heading', '## A', '\n## '), /end anchor/);
});

test('AC1.1 go-red: removing the red-team section fails the same assertion', () => {
  const body = sliceSection(RED_TEAM, HEADING, '\n## ');
  expectRed(assertRedTeamStep, RED_TEAM, RED_TEAM.replace(body, ''), 'heading not found');
});

test('AC2.1 go-red: removing any one input-class bullet fails the same assertion', () => {
  for (const bullet of CLASS_BULLETS) {
    expectRed(assertRedTeamStep, RED_TEAM, mutateSection(RED_TEAM, bullet, '- **Removed**'), `must name the input class ${JSON.stringify(bullet)}`);
  }
});

test('AC1.1 go-red: removing the severity sentence fails the same assertion', () => {
  expectRed(assertRedTeamStep, RED_TEAM, mutateSection(RED_TEAM, SEVERITY_SENTENCE, 'A missing class is noted'), 'critical Fail-Closed Guard Check finding');
});

test('AC1.1 go-red: removing the routing clause fails the same assertion', () => {
  expectRed(assertRedTeamStep, RED_TEAM, mutateSection(RED_TEAM, ROUTING_CLAUSE, 'resolve it'), 'stage-or-ask per write-back step 5');
});

test('AC1.1 go-red: removing the lens 3c question fails the same assertion', () => {
  expectRed(assertLensQuestion, LENS, LENS.replace(LENS_QUESTION, ''), 'lens 3c must carry the fail-closed guard question');
});
