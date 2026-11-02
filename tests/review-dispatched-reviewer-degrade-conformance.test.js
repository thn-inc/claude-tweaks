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
const { toPosix } = require('../plugin/bin/lib/shared-primitives');

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
  assert.deepEqual(carriers.map((file) => toPosix(path.relative(SKILLS, file))), ['review/step3-lens-dispatch.md'], 'the degrade line shape is stated in exactly one skill file');
  assert.equal(readText(carriers[0]).split(LINE_TAIL).length - 1, 1, 'the degrade line shape occurs exactly once in that file');
});

test('removing the partner-died paragraph turns the AC2.1 pin red', () => {
  const text = readText(STEP3);
  const without = text.split('\n').filter((line) => !line.startsWith(PARTNER_DIED_PREFIX)).join('\n');
  assert.notEqual(without, text, 'anchor text for the partner-died paragraph not found — proof cannot discriminate');
  assert.notDeepEqual(partnerDiedMissing(without), [], 'removing the paragraph must turn the pin red');
});

// The caveat's render slots (#3817): the summary template (compact + full), the PR verdict comment, and
// dispatch's task-prompt item 7 all cite the partner-died paragraph instead of restating its line shape.
const SUMMARY_TEMPLATE = path.join(SKILLS, 'review', 'review-summary-template.md');
const CODE_MODE_STEPS = path.join(SKILLS, 'review', 'code-mode-steps.md');
const TASK_PROMPT = path.join(SKILLS, 'dispatch', 'task-prompt.md');
const RESTATED_TAIL = 'single-read coverage. Reversibility';

const SLOT = [
  [/\*\*Coverage caveat:\*\*/, 'the form renders a "**Coverage caveat:**" slot'],
  [/`step3-lens-dispatch\.md`'s partner-died paragraph:\}/, "the slot's condition cites step3-lens-dispatch.md's partner-died paragraph"],
];
const slotMissing = missingFactsOf(SLOT);

function summaryForms(text) {
  const split = text.indexOf('## Full template');
  assert.notEqual(split, -1, 'review-summary-template.md lost its "## Full template" heading');
  return { compact: text.slice(0, split), full: text.slice(split) };
}

test('summary template carries a Coverage caveat slot in the compact and full forms (#3817)', () => {
  const { compact, full } = summaryForms(readText(SUMMARY_TEMPLATE));
  assert.deepEqual(slotMissing(compact), [], 'the compact form must carry the Coverage caveat slot (#3817)');
  assert.deepEqual(slotMissing(full), [], 'the full template must carry the Coverage caveat slot (#3817)');
  assert.ok(!compact.includes(RESTATED_TAIL), 'the compact form must cite the degrade line shape, not restate it (#3817)');
  assert.ok(!full.includes(RESTATED_TAIL), 'the full template must cite the degrade line shape, not restate it (#3817)');
});

test('the summary slot assertions can go red', () => {
  const { compact, full } = summaryForms(readText(SUMMARY_TEMPLATE));
  assertEachPatternGoesRed(compact, SLOT, slotMissing);
  assertEachPatternGoesRed(full, SLOT, slotMissing);
});

// The compact form's eligibility list must say the caveat is informational, like the skill load delta (3j).
const COMPACT_ELIGIBLE = [[/A Coverage caveat \(`step3-lens-dispatch\.md`'s partner-died single-read degrade\) is informational and does not disqualify the compact form either\./, 'the compact eligibility list says a Coverage caveat does not disqualify the compact form']];
const compactEligibleMissing = missingFactsOf(COMPACT_ELIGIBLE);

test('a Coverage caveat does not disqualify the compact form (#3817)', () => {
  const { compact } = summaryForms(readText(SUMMARY_TEMPLATE));
  assert.deepEqual(compactEligibleMissing(compact), [], 'the compact eligibility list must say a Coverage caveat is informational (#3817)');
});

test('the compact-eligibility assertion can go red', () => {
  assertEachPatternGoesRed(summaryForms(readText(SUMMARY_TEMPLATE)).compact, COMPACT_ELIGIBLE, compactEligibleMissing);
});

const VERDICT_PREFIX = '**Verdict comment (';
const VERDICT_COPY = [[/Coverage caveat:\*\* line verbatim/, "the verdict comment copies the summary's Coverage caveat line verbatim"]];
const verdictMissing = missingFactsOf(VERDICT_COPY);

function verdictParagraph(text) {
  const start = text.indexOf(VERDICT_PREFIX);
  assert.notEqual(start, -1, 'code-mode-steps.md lost its "**Verdict comment (" paragraph');
  const end = text.indexOf('\n\n', start);
  assert.notEqual(end, -1, 'no blank line follows the Verdict comment paragraph — its boundary is unknown');
  return text.slice(start, end);
}

test("verdict comment copies the summary's Coverage caveat line (#3817)", () => {
  assert.deepEqual(verdictMissing(verdictParagraph(readText(CODE_MODE_STEPS))), [], 'the verdict comment must copy the Coverage caveat line (#3817)');
});

test('the verdict-comment assertion can go red', () => {
  assertEachPatternGoesRed(verdictParagraph(readText(CODE_MODE_STEPS)), VERDICT_COPY, verdictMissing);
});

// Copied from tests/foreground-execution-instruction.test.js (item7Block): item 7 runs to the next item or heading.
function item7Block(text) {
  const start = text.indexOf('7. **Async-wait discipline**');
  assert.notEqual(start, -1, 'task-prompt.md lost its item 7 "Async-wait discipline" heading');
  const next = text.slice(start + 1).search(/\n(?:8\. |## )/);
  assert.notEqual(next, -1, 'task-prompt.md: no "8. " item or "## " heading follows item 7 — its boundary is unknown');
  return text.slice(start, start + 1 + next);
}

const ITEM7_XREF = [
  [/`\/claude-tweaks:review`/, 'item 7 names the `/claude-tweaks:review` lens unit'],
  [/`review\/step3-lens-dispatch\.md`/, "item 7 cites review/step3-lens-dispatch.md's partner-died paragraph"],
];
const item7XrefMissing = missingFactsOf(ITEM7_XREF);

test('task-prompt item 7 cross-references the review degrade (#3817)', () => {
  const item7 = item7Block(readText(TASK_PROMPT));
  assert.deepEqual(item7XrefMissing(item7), [], 'item 7 must point a review lens unit at the partner-died degrade (#3817)');
  assert.ok(!item7.includes(RESTATED_TAIL), 'item 7 must cite the degrade line shape, not restate it (#3817)');
});

test('the item-7 cross-reference assertions can go red', () => {
  assertEachPatternGoesRed(item7Block(readText(TASK_PROMPT)), ITEM7_XREF, item7XrefMissing);
});

// #4555: a run-level "no Agent tool in this host" probe at Step 3 start, one run-level SKIP line, and an
// "Independence: degraded" caveat the summary renders and the verdict comment copies. The per-lens
// single-read lines and the tiebreak's inline lines are unchanged (they write alongside, never replaced).
const RUN_LEVEL_PREFIX = '> **No `Agent` tool in this host (run-level, #4555).**';
const RUN_LEVEL_FACTS = [
  [/When Step 3 starts, probe once with `_shared\/subagent-dispatch-core\.md`'s no-`Agent` probe/, 'AC6.1: run-level probe at Step 3 start'],
  [/--run "\$PIPELINE_RUN_DIR" --section "\/review" --step "Step 3 lens dispatch \(degraded\)" /, 'AC6.1: the SKIP line carries the canonical --section and --step flags'],
  [/--status SKIP --text "condition: no Agent tool in this host → fallback: every lens and tiebreak judged by the reviewer itself"/, 'AC6.1: one run-level log line'],
  [/render `review-summary-template\.md`'s \*\*Independence: degraded\*\* line, which the PR verdict comment copies/, 'AC6.1: caveat reaches summary and verdict comment'],
  [/The per-lens single-read lines below and the tiebreak's ` Mode: inline\.`\/`Tiebreak caveat:` lines still write, unchanged/, 'AC6.2: per-lens and tiebreak lines unchanged'],
  [/Same session as build is known only inside one `\/claude-tweaks:flow` call that ran `build` too/, 'D5: same-session detection scope'],
  [/effectively unreachable, since flow and build stop a no-dispatch host before building; no session stamp/, 'D5: states it is effectively unreachable, no stamp'],
  [/\(standalone: one line in the report\)/, 'AC6.1: a standalone review reports the run-level line in its report, not a run directory'],
];
const runLevelMissing = missingFactsOf(RUN_LEVEL_FACTS);
const INDEPENDENCE_SLOT = [
  [/\{only when Step 3 found no Agent tool — `step3-lens-dispatch\.md`'s run-level no-Agent note:\}/, 'the slot cites the run-level note'],
  [/\*\*Independence: degraded\*\* — no Agent tool in this host; every lens and tiebreak was judged by the reviewer itself/, 'AC6.1: the spec caveat text'],
  [/\{only when this review runs in the same `\/claude-tweaks:flow` call whose step list also ran `build` \(omitted when that is unknown, e\.g\. a standalone review\), append "; the reviewer is the same session that ran this build's implementation"\}/, 'AC6.1: same-session clause with its detection signal and unknown-case omission'],
];
const independenceSlotMissing = missingFactsOf(INDEPENDENCE_SLOT);
const VERDICT_INDEPENDENCE = [[/then its \*\*Independence: degraded\*\* line verbatim when it rendered/, 'AC6.1: verdict comment copies the Independence line']];
const verdictIndependenceMissing = missingFactsOf(VERDICT_INDEPENDENCE);
const COMPACT_INDEPENDENCE = [[/An \*\*Independence: degraded\*\* line is informational the same way\./, 'the compact eligibility list says an Independence line does not disqualify the compact form']];
const compactIndependenceMissing = missingFactsOf(COMPACT_INDEPENDENCE);

function runLevelNote(text) {
  const note = lineStartingWith(text, RUN_LEVEL_PREFIX);
  assert.notEqual(note, '', 'the run-level "> **No `Agent` tool in this host (run-level, #4555).**" note line was not found in step3-lens-dispatch.md');
  return note;
}

test('AC6.1 AC6.2 AC13.1: step3-lens-dispatch.md states the run-level no-Agent note (#4555)', () => {
  assert.deepEqual(runLevelMissing(runLevelNote(readText(STEP3))), [], 'the run-level no-Agent note must state its probe, SKIP line, caveat and unchanged per-lens lines (#4555)');
});

test('the run-level note assertions can go red', () => {
  assertEachPatternGoesRed(runLevelNote(readText(STEP3)), RUN_LEVEL_FACTS, runLevelMissing);
});

test('AC6.1: summary template carries the Independence slot in compact and full forms (#4555)', () => {
  const { compact, full } = summaryForms(readText(SUMMARY_TEMPLATE));
  assert.deepEqual(independenceSlotMissing(compact), [], 'the compact form must carry the Independence slot (#4555)');
  assert.deepEqual(independenceSlotMissing(full), [], 'the full template must carry the Independence slot (#4555)');
});

test('the Independence slot assertions can go red', () => {
  const { compact, full } = summaryForms(readText(SUMMARY_TEMPLATE));
  assertEachPatternGoesRed(compact, INDEPENDENCE_SLOT, independenceSlotMissing);
  assertEachPatternGoesRed(full, INDEPENDENCE_SLOT, independenceSlotMissing);
});

test('AC6.1: verdict comment copies the Independence line (#4555)', () => {
  assert.deepEqual(verdictIndependenceMissing(verdictParagraph(readText(CODE_MODE_STEPS))), [], 'the verdict comment must copy the Independence line (#4555)');
});

test('the verdict-comment Independence assertion can go red', () => {
  assertEachPatternGoesRed(verdictParagraph(readText(CODE_MODE_STEPS)), VERDICT_INDEPENDENCE, verdictIndependenceMissing);
});

test('the compact form says an Independence line does not disqualify it (#4555)', () => {
  assert.deepEqual(compactIndependenceMissing(summaryForms(readText(SUMMARY_TEMPLATE)).compact), [], 'the compact eligibility list must say an Independence line is informational (#4555)');
});

test('the compact-Independence assertion can go red', () => {
  assertEachPatternGoesRed(summaryForms(readText(SUMMARY_TEMPLATE)).compact, COMPACT_INDEPENDENCE, compactIndependenceMissing);
});

const TIEBREAK_CAVEAT_LINE = '{only when a verdict was read inline — `step3-tiebreak.md`\'s Dispatched reviewer section:} **Tiebreak caveat:** {n} verdict(s) read inline by the reviewer, not an independent agent ({reason, e.g. no `Agent` tool, timed out})';
const COVERAGE_CAVEAT_LINE = '**Coverage caveat:** {every affected lens with its reason, e.g. 3b (timed out), 3c (unavailable)} — single-read coverage, findings unconfirmed';

function unchangedCaveatLinesMissing(text) {
  const missing = [];
  if (!text.includes(TIEBREAK_CAVEAT_LINE)) missing.push('the Tiebreak caveat slot line');
  if (text.split(COVERAGE_CAVEAT_LINE).length - 1 !== 2) missing.push('both Coverage caveat slot lines');
  return missing;
}

test('AC6.2: the per-lens and tiebreak caveat lines are unchanged (#4555)', () => {
  assert.deepEqual(unchangedCaveatLinesMissing(readText(SUMMARY_TEMPLATE)), [], 'the Tiebreak and Coverage caveat slot lines must survive byte-for-byte alongside the Independence line (#4555)');
});

test('the unchanged-caveat-lines assertion can go red', () => {
  const text = readText(SUMMARY_TEMPLATE);
  const noTiebreak = text.replace(TIEBREAK_CAVEAT_LINE, '');
  assert.notEqual(noTiebreak, text, 'anchor text for the Tiebreak caveat line not found — proof cannot discriminate');
  assert.deepEqual(unchangedCaveatLinesMissing(noTiebreak), ['the Tiebreak caveat slot line']);
  const oneCoverage = text.replace(COVERAGE_CAVEAT_LINE, '');
  assert.notEqual(oneCoverage, text, 'anchor text for the Coverage caveat line not found — proof cannot discriminate');
  assert.deepEqual(unchangedCaveatLinesMissing(oneCoverage), ['both Coverage caveat slot lines']);
});
