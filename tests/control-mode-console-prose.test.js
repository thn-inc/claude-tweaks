'use strict';
// #4620: the Review Console's short-circuit pre-check resolves the ceiling through
// `console-resolve.js --ceiling`. Reads live prose: the section is the declared contract
// console-resolve.js executes, so editing it is the intended response to a contract change
// (the [IL-80] carve-out). Each assertion is proved red on a mutated copy of the live text.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const REVIEW_CONSOLE = readText(path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up', 'review-console.md'));
const HEADING = '## Auto-resolution short-circuit';

function section(text) {
  const start = text.indexOf(`\n${HEADING}`);
  assert.notStrictEqual(start, -1, `heading not found: ${HEADING}`);
  const end = text.indexOf('\n## ', start + HEADING.length + 1);
  assert.notStrictEqual(end, -1, `no section after: ${HEADING}`);
  return text.slice(start, end);
}

// `--ceiling` leads the flags so the one-`console-resolve.js" --run` pin in console-resolve-conformance.test.js still holds.
const NEW_COMMAND = 'console-resolve.js" --ceiling --run "$PIPELINE_RUN_DIR"';
const OLD_COMMAND = 'resolve-policy.js" --values --run "$PIPELINE_RUN_DIR" autonomy';

function ceilingProblems(text) {
  const s = section(text);
  const problems = [];
  if (!s.includes(NEW_COMMAND)) problems.push('the short-circuit pre-check does not resolve the ceiling through console-resolve.js --ceiling');
  if (s.includes(OLD_COMMAND)) problems.push('the short-circuit pre-check still resolves the ceiling through resolve-policy.js autonomy');
  return problems;
}

test('AC1.1: the short-circuit pre-check resolves the ceiling through console-resolve.js --ceiling', () => {
  assert.deepStrictEqual(ceilingProblems(REVIEW_CONSOLE), []);
});

test('AC1.1 go-red: dropping the new command is caught with its own message', () => {
  const mutated = REVIEW_CONSOLE.split(NEW_COMMAND).join('console-resolve.js" --policy console-auto --run "$PIPELINE_RUN_DIR"');
  assert.deepStrictEqual(ceilingProblems(mutated), ['the short-circuit pre-check does not resolve the ceiling through console-resolve.js --ceiling']);
});

test('AC1.1 go-red: restoring the old command is caught with its own message', () => {
  const mutated = REVIEW_CONSOLE.replace(HEADING, `${HEADING}\n\n\`${OLD_COMMAND}\``);
  assert.deepStrictEqual(ceilingProblems(mutated), ['the short-circuit pre-check still resolves the ceiling through resolve-policy.js autonomy']);
});
