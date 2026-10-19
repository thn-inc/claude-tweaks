// tests/specify-red-team-cross-ac-literal-check.test.js
//
// Pins record #3463's prose wiring: red-team.md must carry a deterministic
// cross-AC literal check between the path/URI guard scan and the persona
// dispatch, testing every negative-grep/sweep pattern in one AC against the
// literal strings the other ACs require. The fixture test shows the
// pattern/literal pair the section describes is a real conflict shape (#3311).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RED_TEAM = fs.readFileSync(path.join(ROOT, 'plugin/skills/specify/red-team.md'), 'utf8');

const HEADING = '## Cross-AC literal check (deterministic, runs before persona dispatch)';

test('AC1.1: red-team.md names the Cross-AC literal check', () => {
  const start = RED_TEAM.indexOf(HEADING);
  assert.notStrictEqual(start, -1, `heading not found: ${HEADING}`);
  const next = RED_TEAM.indexOf('\n## ', start + HEADING.length);
  const section = RED_TEAM.slice(start, next === -1 ? undefined : next);
  for (const phrase of ['negative grep', 'sweep', 'every literal string', 'other ACs', '## Open Questions']) {
    assert.ok(section.includes(phrase), `section must contain ${JSON.stringify(phrase)}`);
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

// Fixture modeled on #3311: AC1's negative sweep pattern matches the literal
// AC2 mandates.
const CONFLICT_FIXTURE = [
  '- AC1: No file under `plugin/` matches `grep -rn "CEILING_BYTES"`.',
  '- AC2: The guard\'s self-test fixture contains `const FOO_CEILING_BYTES = 30 * 1024`.',
].join('\n');

function extractPatternAndLiteral(spec) {
  const [ac1, ac2] = spec.split('\n');
  const pattern = /grep -rn "([^"]+)"/.exec(ac1)[1];
  const literal = /contains `([^`]+)`/.exec(ac2)[1];
  return { pattern, literal };
}

test('AC2.1: fixture spec trips its own sibling sweep', () => {
  const { pattern, literal } = extractPatternAndLiteral(CONFLICT_FIXTURE);
  assert.strictEqual(pattern, 'CEILING_BYTES');
  assert.strictEqual(literal, 'const FOO_CEILING_BYTES = 30 * 1024');
  assert.ok(new RegExp(pattern).test(literal), 'the sweep pattern must match the sibling AC literal');
});

test('AC2.1 control: a non-conflicting sibling literal does not trip the sweep', () => {
  const control = CONFLICT_FIXTURE.replace('FOO_CEILING_BYTES = 30 * 1024', 'FOO_LIMIT = 30 * 1024');
  const { pattern, literal } = extractPatternAndLiteral(control);
  assert.strictEqual(literal, 'const FOO_LIMIT = 30 * 1024');
  assert.ok(!new RegExp(pattern).test(literal), 'the control literal must not match the sweep pattern');
});
