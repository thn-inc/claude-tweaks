// tests/review-dispatched-reviewer-degrade-conformance.test.js — pins #3817: a dispatched /review
// agent's own lens dispatches degrade to the partner-died single-read treatment (#3078 gave it the
// path in review/step3-lens-dispatch.md's Foreground note). The note must name every effort tier it
// holds at, and the partner-died paragraph must state its decisions.md line shape and the
// coverage-caveat exactly once, so a reader of any tier finds one degrade, not a tier-shaped carve-out.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const PLUGIN = path.join(__dirname, '..', 'plugin');
const SKILLS = path.join(PLUGIN, 'skills');
const STEP3 = path.join(SKILLS, 'review', 'step3-lens-dispatch.md');

// A fact-list predicate: the facts whose pattern the text no longer matches.
const missingFactsOf = (patterns) => (text) => patterns.filter(([pattern]) => !pattern.test(text)).map(([, fact]) => fact);

// Per-assertion go-red proof (the 6bb1bb695 shape): strip one pattern's matched phrase from the live
// text, and the shared predicate must report exactly that one fact missing.
function assertEachPatternGoesRed(text, patterns, missingOf) {
  for (const [pattern, fact] of patterns) {
    const doctored = text.replace(pattern, '');
    assert.notEqual(doctored, text, `anchor text for "${fact}" not found — proof cannot discriminate`);
    assert.deepEqual(missingOf(doctored), [fact], `removing only "${fact}" must turn exactly that assertion red`);
  }
}

const FOREGROUND_NOTE_PREFIX = '> **Foreground Execution Discipline:**';
const PARTNER_DIED_PREFIX = '> **Reproduction-pair partner dies or is unavailable.**';
const lineStartingWith = (text, prefix) => text.split('\n').find((line) => line.startsWith(prefix)) || '';

const DEGRADE_SENTENCE = /When the reviewer is itself a dispatched agent,.*?\(findings `unconfirmed`, logged\)\./;
function degradeSentence(text) {
  const note = lineStartingWith(text, FOREGROUND_NOTE_PREFIX);
  assert.notEqual(note, '', 'the "> **Foreground Execution Discipline:**" note line was not found in step3-lens-dispatch.md');
  const found = note.match(DEGRADE_SENTENCE);
  assert.ok(found, 'the dispatched-reviewer degrade sentence was not found in the Foreground note');
  return found[0];
}

const TIERS = ['low', 'medium', 'high', 'xhigh', 'max'].map((tier) => [new RegExp('`' + tier + '`'), `the degrade names the \`${tier}\` effort tier`]);
const tiersMissing = missingFactsOf(TIERS);

test('foreground note names every effort tier on the dispatched-reviewer degrade (#3817 AC1.1)', () => {
  assert.deepEqual(tiersMissing(degradeSentence(readText(STEP3))), [], 'the degrade sentence must name every effort tier (#3817)');
});

test('the tier assertion can go red', () => {
  assertEachPatternGoesRed(degradeSentence(readText(STEP3)), TIERS, tiersMissing);
});

const LOG_LINE_LITERAL = 'Log `STAGED {HH:MM:SS} — Reproduction: lens "{lens}" {session limit twice | unavailable | timed out}; single-read coverage. Reversibility: high.` to `decisions.md`';
const CAVEAT = /carry a one-line coverage-caveat into the Step 7 summary and the PR verdict comment naming the affected lens/;
const LINE_TAIL = 'single-read coverage. Reversibility: high.';

// Paragraph present, literal present, caveat present: the facts of the partner-died line shape.
function partnerDiedMissing(text) {
  const paragraph = lineStartingWith(text, PARTNER_DIED_PREFIX);
  if (paragraph === '') return ['the partner-died paragraph'];
  const missing = [];
  if (!paragraph.includes(LOG_LINE_LITERAL)) missing.push('the exact STAGED log-line literal');
  if (!CAVEAT.test(paragraph)) missing.push('the Step 7 / PR verdict coverage-caveat');
  return missing;
}

function markdownFilesUnder(dir) {
  return fs.readdirSync(dir, { recursive: true })
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => path.join(dir, entry));
}

test('partner-died paragraph states the degrade line shape and caveat once (#3817 AC2.1)', () => {
  assert.deepEqual(partnerDiedMissing(readText(STEP3)), [], 'the partner-died paragraph must state the log line and the caveat (#3817)');

  const files = markdownFilesUnder(SKILLS);
  assert.ok(files.length > 0, 'no skill markdown found — the walk is broken');
  const carriers = files.filter((file) => readText(file).includes(LINE_TAIL));
  assert.deepEqual(carriers.map((file) => path.relative(SKILLS, file)), ['review/step3-lens-dispatch.md'], 'the degrade line shape is stated in exactly one skill file');
  assert.equal(readText(carriers[0]).split(LINE_TAIL).length - 1, 1, 'the degrade line shape occurs exactly once in that file');
});

test('removing the partner-died paragraph turns the AC2.1 pin red', () => {
  const text = readText(STEP3);
  const without = text.split('\n').filter((line) => !line.startsWith(PARTNER_DIED_PREFIX)).join('\n');
  assert.notEqual(without, text, 'anchor text for the partner-died paragraph not found — proof cannot discriminate');
  assert.notDeepEqual(partnerDiedMissing(without), [], 'removing the paragraph must turn the pin red');
});
