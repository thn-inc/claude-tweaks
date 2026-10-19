// tests/specify-red-team-cross-ac-literal-check.test.js
//
// Pins record #3463's prose wiring: red-team.md must carry a deterministic
// cross-AC literal check between the path/URI guard scan and the persona
// dispatch, testing every negative-grep/sweep pattern in one AC against the
// literal strings the other ACs require. The fixture test is bound to the
// section's own #3311 example, so deleting the section turns it red.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const RED_TEAM = readText(path.join(ROOT, 'plugin/skills/specify/red-team.md'));

const HEADING = '## Cross-AC literal check (deterministic, runs before persona dispatch)';

function section() {
  const start = RED_TEAM.indexOf(HEADING);
  if (start === -1) return '';
  const next = RED_TEAM.indexOf('\n## ', start + HEADING.length);
  return RED_TEAM.slice(start, next === -1 ? undefined : next);
}

test('AC1.1: red-team.md names the Cross-AC literal check', () => {
  assert.notStrictEqual(RED_TEAM.indexOf(HEADING), -1, `heading not found: ${HEADING}`);
  const body = section();
  for (const phrase of ['negative grep', 'sweep', 'every literal string', 'other ACs', '## Open Questions']) {
    assert.ok(body.includes(phrase), `section must contain ${JSON.stringify(phrase)}`);
  }
});

test('the Cross-AC literal check sits between the path/URI guard scan and Parallel dispatch', () => {
  const guardIdx = RED_TEAM.indexOf('## Path/URI/hostname/identity-guard detection');
  const crossAcIdx = RED_TEAM.indexOf(HEADING);
  const parallelIdx = RED_TEAM.indexOf('## Parallel dispatch');
  assert.ok(guardIdx !== -1 && crossAcIdx !== -1 && parallelIdx !== -1, 'all three headings must exist');
  assert.ok(guardIdx < crossAcIdx, 'cross-AC check must follow the path/URI guard scan');
  assert.ok(crossAcIdx < parallelIdx, 'cross-AC check must precede Parallel dispatch');
});

test('the scan rules are stated in the section\'s own wording', () => {
  const body = section();
  assert.match(body, /as a literal substring, and, when the pattern is a regex, as a regex/);
  assert.match(body, /An AC is never tested against its own literals/);
  assert.match(body, /every literal string the other ACs require to exist/);
  assert.match(body, /not a string an AC forbids/);
});

// The section quotes #3311 as its example: AC1's sweep pattern, and the
// fixture literal AC3 mandates.
function extractSectionExample(text) {
  const pattern = /AC1's `([^`]+)` sweep/.exec(text);
  const literal = /fixtures \(`([^`]+)`\)/.exec(text);
  assert.ok(pattern && literal, 'the section must quote the #3311 example: AC1\'s sweep pattern and AC3\'s fixture literal');
  return { pattern: pattern[1], literal: literal[1] };
}

function buildFixture({ pattern, literal }) {
  return [
    `- AC1: No file under \`plugin/\` matches \`grep -rn "${pattern}"\`.`,
    `- AC2: The guard's self-test fixture contains \`${literal}\`.`,
  ].join('\n');
}

function extractPatternAndLiteral(spec) {
  const [ac1, ac2] = spec.split('\n');
  const pattern = /grep -rn "([^"]+)"/.exec(ac1)[1];
  const literal = /contains `([^`]+)`/.exec(ac2)[1];
  return { pattern, literal };
}

test('AC2.1: the section\'s #3311 example trips its own sibling sweep', () => {
  const example = extractSectionExample(section());
  const { pattern, literal } = extractPatternAndLiteral(buildFixture(example));
  assert.ok(new RegExp(pattern).test(literal), `sweep ${pattern} must match sibling literal ${literal}`);
});

test('AC2.1 control: the same example with the pattern stripped from its literal does not trip the sweep', () => {
  const example = extractSectionExample(section());
  const control = { pattern: example.pattern, literal: example.literal.replace(example.pattern, 'LIMIT') };
  const { pattern, literal } = extractPatternAndLiteral(buildFixture(control));
  assert.ok(!literal.includes(pattern), 'control literal must not contain the pattern');
  assert.ok(!new RegExp(pattern).test(literal), 'the control literal must not match the sweep pattern');
});
