// tests/plan-authoring-portability-writer-checks-prose.test.js — pins #3773's
// three plan-authoring checks in plugin/skills/build/plan-authoring-checks.md:
// the Already-satisfied ruling check, the Consumer-portability check and the
// Real-writer fixture check. Reads the live skill file. Each paragraph is
// located by its bold label and every assertion runs on that paragraph alone.
// Two negative controls per label run the same assertion function the positive
// test runs, expecting it to throw — the go-red proof for every pin; the skill
// file is never edited and restored. The drop control removes the paragraph in
// memory (it trips the one-paragraph count check, so it proves the label pin);
// the reword control replaces one key phrase in the live text (it reaches the
// phrase assertions, so it proves the content pin).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TEXT = fs.readFileSync(
  path.join(__dirname, '..', 'plugin', 'skills', 'build', 'plan-authoring-checks.md'),
  'utf8',
);

const ALREADY_SATISFIED = '**Already-satisfied ruling check:**';
const PORTABILITY = '**Consumer-portability check:**';
const REAL_WRITER = '**Real-writer fixture check';

function splitParagraphs(text) {
  return text.split(/\r?\n\r?\n/);
}

function assertCheck(text, label, phrases) {
  const hits = splitParagraphs(text).filter((p) => p.startsWith(label));
  assert.strictEqual(hits.length, 1, `expected exactly one paragraph starting with ${label}`);
  for (const phrase of phrases) assert.ok(hits[0].includes(phrase), `${label} names: ${phrase}`);
}

function dropParagraph(text, label) {
  return splitParagraphs(text).filter((p) => !p.startsWith(label)).join('\n\n');
}

// Replaces `phrase` inside the labelled paragraph only, leaving the paragraph
// count intact so the control reaches the phrase assertions.
function rewordPhrase(text, label, phrase) {
  return splitParagraphs(text)
    .map((p) => (p.startsWith(label) ? p.split(phrase).join('REWORDED') : p))
    .join('\n\n');
}

const CHECKS = [
  {
    name: 'the Already-satisfied ruling check',
    label: ALREADY_SATISFIED,
    phrases: ['already satisfied', 'archived', '#2775'],
  },
  {
    name: 'the Consumer-portability check',
    label: PORTABILITY,
    phrases: ['plugin/**', 'non-default value', '#2733'],
  },
  {
    name: 'the Real-writer fixture check',
    label: REAL_WRITER,
    phrases: ['real writer', 'hand-written', '#3023'],
  },
];

for (const { name, label, phrases } of CHECKS) {
  test(`AC1.1 (#3773): plan-authoring-checks.md carries ${name}`, () => {
    assertCheck(TEXT, label, phrases);
  });

  test(`AC1.1 (#3773): negative control — dropping ${name} fails the pin`, () => {
    const dropped = dropParagraph(TEXT, label);
    assert.notStrictEqual(dropped, TEXT, 'control must actually remove the paragraph');
    assert.throws(() => assertCheck(dropped, label, phrases));
  });

  test(`AC1.1 (#3773): negative control — rewording a key phrase of ${name} fails the pin`, () => {
    const reworded = rewordPhrase(TEXT, label, phrases[1]);
    assert.notStrictEqual(reworded, TEXT, 'control must actually change the paragraph');
    assert.throws(() => assertCheck(reworded, label, phrases), /names:/);
  });
}
