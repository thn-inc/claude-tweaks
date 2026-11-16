// tests/review-reproduction-call-conformance.test.js — #5595 AC10/AC11: /review Step 3's reproduction
// prose names the logging calls and carries no pair-line template. The seven lines are composed by
// plugin/bin/lib/reproduction-log.js and written by `categorise-reproduction --run` and
// `log-reproduction-judgment`; the prose keeps only what the reader must do, and the order code cannot
// enforce: the absence-claim check runs before the `--only unconfirmed` call, and at `medium` that call
// (forms 3 and 4) waits for the cross-lens corroboration pass.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const FILE = path.join(__dirname, '..', 'plugin', 'skills', 'review', 'step3-lens-dispatch.md');
const read = () => readText(FILE);

const CALL_HEAD = 'categorise-reproduction "{path-A}" "{path-B}"';
// Each flag with its value: a pin stopping at the flag name stays green when the value is dropped.
const CALL_FLAGS = ['--lens "{lens}"', '--run "$PIPELINE_RUN_DIR"', '--only confirmed'];
const ABSENCE_FIRST = 'run the absence-claim ground-truth check';
const UNCONFIRMED_CALL = '--only unconfirmed';
// An empty `unconfirmed` is the all-confirmed case, whose lens 3f vacuity check and `severityContested`/`nearLocation`
// routing still run, so the prose may skip only the second call there, never end the pair.
const EMPTY_UNCONFIRMED_ENDS_PAIR = /\bwhen `?unconfirmed`? is empty\b[^.]*\b(?:done|finished|complete|over|ends?)\b/i;
const NO_SECOND_CALL = 'When `unconfirmed` is empty no second call is needed.';
const MEDIUM_WAIT = "At `medium`, make the `--only unconfirmed` call (the `not reproduced` and share-a-location lines) only after `step3-cross-lens-corroboration.md`'s pass has run";
// One distinctive phrase per base-commit template (AC10's grep); the composer is their only home.
const TEMPLATE_PHRASES = [
  'reproduced. Confirmed. Reversibility',
  'not reproduced. Staged to Review Console',
  'share a location but not substance; both staged',
  'refuted by ground-truth check (',
  'downgraded to unconfirmed — reproduction agreement overridden',
  're-confirmed by executed run:',
  'severity contested (took the lower of the two). Confirmed',
];

const collapse = (s) => s.replace(/\s+/g, ' ');

function reproductionProblems(text) {
  const problems = [];
  const calls = text.split(/\r?\n/).filter((l) => l.includes(CALL_HEAD));
  if (calls.length !== 1) problems.push(`expected one categorise-reproduction call line, found ${calls.length}`);
  else for (const flag of CALL_FLAGS) if (!calls[0].includes(flag)) problems.push(`call line lacks ${flag}`);
  const flat = collapse(text);
  const absence = flat.indexOf(ABSENCE_FIRST);
  const unconfirmed = flat.indexOf(UNCONFIRMED_CALL);
  if (absence === -1) problems.push('the absence check is not stated');
  else if (unconfirmed === -1) problems.push('no --only unconfirmed call is named');
  else if (absence > unconfirmed) problems.push('the absence check comes after the first --only unconfirmed mention');
  if (EMPTY_UNCONFIRMED_ENDS_PAIR.test(flat)) problems.push('the prose ends the pair when unconfirmed is empty');
  if (!flat.includes(MEDIUM_WAIT)) problems.push('forms 3 and 4 are not held at medium');
  for (const phrase of TEMPLATE_PHRASES) if (flat.includes(collapse(phrase))) problems.push(`template phrase still in the prose: ${phrase}`);
  return problems;
}

function doctor(text, from, to) {
  const out = text.replace(from, to);
  assert.notEqual(out, text, `anchor not found: ${from}`);
  return out;
}

test('AC11.1: the call line names --lens, --run and --only; the absence check precedes --only unconfirmed; forms 3 and 4 wait at medium', () => {
  assert.deepEqual(reproductionProblems(read()), []);
});

test('AC10.1: none of the seven template phrases occurs in step3-lens-dispatch.md', () => {
  const problems = reproductionProblems(read()).filter((p) => p.startsWith('template phrase'));
  assert.deepEqual(problems, []);
});

test('AC11.1 holds on a CRLF checkout', () => {
  assert.deepEqual(reproductionProblems(read().replace(/\n/g, '\r\n')), []);
});

test('AC11.2 go-red: dropping a flag from the call line names that flag', () => {
  const live = read();
  for (const flag of CALL_FLAGS) {
    const callLine = live.split('\n').find((l) => l.includes(CALL_HEAD));
    const mutated = doctor(live, callLine, callLine.replace(` ${flag}`, ''));
    assert.deepEqual(reproductionProblems(mutated), [`call line lacks ${flag}`], flag);
  }
});

test('AC11.2 go-red: dropping the absence check, or moving it after the --only unconfirmed call, is caught', () => {
  const live = read();
  assert.deepEqual(reproductionProblems(doctor(live, ABSENCE_FIRST, 'skip the check')), ['the absence check is not stated']);
  // Permutation: the same sentence, placed after the first --only unconfirmed mention.
  const moved = doctor(doctor(live, ABSENCE_FIRST, 'skip the check'), UNCONFIRMED_CALL, `${UNCONFIRMED_CALL} (${ABSENCE_FIRST} first)`);
  assert.deepEqual(reproductionProblems(moved), ['the absence check comes after the first --only unconfirmed mention']);
});

test('AC11.2 go-red: dropping the medium wait is caught', () => {
  const live = read();
  assert.deepEqual(reproductionProblems(doctor(live, MEDIUM_WAIT, 'Make the `--only unconfirmed` call')), ['forms 3 and 4 are not held at medium']);
});

test('AC10.1 go-red: a template phrase planted back in the prose is caught', () => {
  for (const phrase of TEMPLATE_PHRASES) {
    assert.deepEqual(reproductionProblems(`${read()}\n> Write \`AUTO {HH:MM:SS} — Reproduction: ${phrase}\`.\n`), [`template phrase still in the prose: ${phrase}`], phrase);
  }
});

test('#5595 go-red: saying the pair is done when unconfirmed is empty is caught', () => {
  const live = read();
  for (const end of ['the pair is done', 'the pair is finished', "the pair's handling is complete"]) {
    assert.deepEqual(reproductionProblems(doctor(live, NO_SECOND_CALL, `When \`unconfirmed\` is empty ${end}.`)), ['the prose ends the pair when unconfirmed is empty'], end);
  }
});
