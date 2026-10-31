// tests/untrusted-text-into-command-conformance.test.js
//
// Pins record #4595's rule: docs/skill-authoring.md carries the "Untrusted text into a shell or
// paste command" section (the class, the Write / process.argv fix, the exact-grammar rule for a
// rendered paste command, and both worked fixes, #4465 and #4423), and
// review/step3-lens-dispatch.md's lens 3b carries the bullet that asks whether that class reaches
// a command. Every pin except the section-ordering check has a go-red control that runs the same
// assertion against text with the pinned phrase removed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const AUTHORING = readText(path.join(ROOT, 'docs/skill-authoring.md'));
const LENS = readText(path.join(ROOT, 'plugin/skills/review/step3-lens-dispatch.md'));

const HEADING = '## Untrusted text into a shell or paste command';
const PREV_HEADING = '## Reading a marker comment back from GitHub';
const NEXT_HEADING = '## Deriving a CLI argument from earlier prose';
const CLASS_PHRASE = 'never reaches a shell command line';
const PROCESS_ARGV_PHRASE = 'through `process.argv`';
const WRITE_PHRASE = '`Write` it to a file and feed that file on stdin or as a path argument';
const EXACT_GRAMMAR_PHRASE = "matches the composer's exact grammar";
const FALLBACK_PHRASE = 'falls back to a non-command line';
// Each phrase occurs once in the section, so removing it from the section fails its own assertion.
const RULE_PINS = [
  { phrase: CLASS_PHRASE, message: `section must name the class ${JSON.stringify(CLASS_PHRASE)}` },
  { phrase: PROCESS_ARGV_PHRASE, message: `section must name the process.argv fix ${JSON.stringify(PROCESS_ARGV_PHRASE)}` },
  { phrase: WRITE_PHRASE, message: `section must name the Write-produced file fix ${JSON.stringify(WRITE_PHRASE)}` },
  { phrase: EXACT_GRAMMAR_PHRASE, message: `section must require a rendered paste command to match an exact grammar ${JSON.stringify(EXACT_GRAMMAR_PHRASE)}` },
  { phrase: FALLBACK_PHRASE, message: `section must name the non-command fallback ${JSON.stringify(FALLBACK_PHRASE)}` },
];
const RECORD_REFS = ['#4465', '#4423'];
// Both fixes landed in one squash commit on the integration branch (#4423's); the pre-squash branch commits do not resolve in a fresh clone.
const FIX_SHAS = ['9d59ce045'];
const LENS_HEADING = '### 3b: Security';
const LENS_PHRASE = 'untrusted text interpolated into a shell or paste command';

function sliceSection(text, heading, nextMarker) {
  const start = text.indexOf(heading);
  if (start === -1) return '';
  const next = text.indexOf(nextMarker, start + heading.length);
  // A missing end anchor would widen the slice to the rest of the file, so a presence assertion
  // could match later text and stay green after the real section lost its sentence.
  assert.notEqual(next, -1, `end anchor ${JSON.stringify(nextMarker)} not found after ${JSON.stringify(heading)}`);
  return text.slice(start, next);
}

function assertRuleSection(text) {
  const body = sliceSection(text, HEADING, '\n## ');
  assert.ok(body, `heading not found: ${HEADING}`);
  for (const pin of RULE_PINS) {
    assert.ok(body.includes(pin.phrase), pin.message);
  }
  for (const ref of RECORD_REFS) {
    assert.ok(body.includes(ref), `section must cite record ${ref}`);
  }
  for (const sha of FIX_SHAS) {
    assert.ok(body.includes(sha), `section must cite fix SHA ${sha}`);
  }
}

function assertLensBullet(text) {
  const body = sliceSection(text, LENS_HEADING, '\n### ');
  assert.ok(body, 'lens 3b heading not found');
  assert.ok(body.includes(LENS_PHRASE), 'lens 3b must carry the untrusted-text-into-command check');
}

test('the rule section names the class, both fixes, the fallback, and both record refs and SHAs', () => {
  assertRuleSection(AUTHORING);
});

test('lens 3b carries the untrusted-text-into-command check', () => {
  assertLensBullet(LENS);
});

test('the rule section sits between the marker-comment and CLI-argument sections', () => {
  const prevIdx = AUTHORING.indexOf(PREV_HEADING);
  const stepIdx = AUTHORING.indexOf(HEADING);
  const nextIdx = AUTHORING.indexOf(NEXT_HEADING);
  assert.ok(prevIdx !== -1 && stepIdx !== -1 && nextIdx !== -1, 'all three headings must exist');
  assert.ok(prevIdx < stepIdx && stepIdx < nextIdx, 'section must follow the marker-comment section and precede the CLI-argument section');
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

// Function-form replacement, so a `$&`- or `$'`-style sequence in the mutated text is never read as
// a String.prototype.replace pattern.
function mutateSection(text, heading, nextMarker, from, to) {
  const body = sliceSection(text, heading, nextMarker);
  assert.ok(body.includes(from), `control premise: the section holds ${JSON.stringify(from)}`);
  return text.replace(body, () => body.replace(from, to));
}

test('sliceSection refuses a section whose end anchor is missing instead of widening to end of file', () => {
  const intact = '## A\nbody\n## B\nrest';
  assert.equal(sliceSection(intact, '## A', '\n## '), '## A\nbody');
  assert.throws(() => sliceSection('## A\nbody and no later heading', '## A', '\n## '), /end anchor/);
});

test('rule section go-red: removing the section fails the same assertion', () => {
  const body = sliceSection(AUTHORING, HEADING, '\n## ');
  expectRed(assertRuleSection, AUTHORING, AUTHORING.replace(body, () => ''), 'heading not found');
});

test('rule section go-red: removing any one rule phrase fails its own assertion', () => {
  for (const pin of RULE_PINS) {
    expectRed(
      assertRuleSection,
      AUTHORING,
      mutateSection(AUTHORING, HEADING, '\n## ', pin.phrase, 'REMOVED'),
      pin.message,
    );
  }
});

test('rule section go-red: removing either record ref fails the same assertion', () => {
  for (const ref of RECORD_REFS) {
    expectRed(
      assertRuleSection,
      AUTHORING,
      mutateSection(AUTHORING, HEADING, '\n## ', ref, 'REMOVED'),
      `section must cite record ${ref}`,
    );
  }
});

test('rule section go-red: removing either fix SHA fails the same assertion', () => {
  for (const sha of FIX_SHAS) {
    expectRed(
      assertRuleSection,
      AUTHORING,
      mutateSection(AUTHORING, HEADING, '\n## ', sha, 'REMOVED'),
      `section must cite fix SHA ${sha}`,
    );
  }
});

test('lens 3b go-red: removing the lens phrase fails the same assertion', () => {
  expectRed(
    assertLensBullet,
    LENS,
    mutateSection(LENS, LENS_HEADING, '\n### ', LENS_PHRASE, 'a different check'),
    'lens 3b must carry the untrusted-text-into-command check',
  );
});
