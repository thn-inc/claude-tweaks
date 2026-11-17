'use strict';
// #5599: /claude-tweaks:review Step 3's opt-in workflow lens dispatch. step3-lens-dispatch.md gains one
// pointer paragraph that names the workflow `claude-tweaks:review-lens-fanout` and reads
// step3-workflow-dispatch.md only when `review-lens-dispatch` resolves `workflow` (spec AC7, AC8's 600-byte
// cap); the sub-file lists the five fallback conditions and the SKIP line, settles with settle-lens-replies
// (`--only confirmed` first), and states the wait bound, the run-file path and the scratch rule.
// Both texts are new in this change, so every go-red control mutates the live text in memory and matches the
// throw to its own message (skill-prose-conformance-tests: "New prose has no pre-change bytes").
// "The Task path is unchanged around the pointer" (AC8) is a git diff against origin/main, run as a verification
// command at build time, never committed here: it would break once this branch merges.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, sectionOf } = require('./helpers/conformance-asserts');
const { rowWithContinuations } = require('./helpers/plugin-structure-entry');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const LENS_DISPATCH = 'plugin/skills/review/step3-lens-dispatch.md';
const SUB_FILE = 'plugin/skills/review/step3-workflow-dispatch.md';

// ---- the pointer in step3-lens-dispatch.md ----

const POINTER_ANCHOR = '> **Workflow dispatch (opt-in, #5599).**';
const POINTER_MAX_BYTES = 600;

// The paragraph opening with the anchor, up to the next blank line (a bare `>` inside a blockquote).
function pointerParagraph(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(POINTER_ANCHOR));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^>?\s*$/.test(lines[end])) end++;
  return lines.slice(start, end).join('\n');
}

// [needle, message]: each one the pointer must carry.
const POINTER_NEEDLES = [
  [/`claude-tweaks:review-lens-fanout`/, 'pointer must name the workflow claude-tweaks:review-lens-fanout'],
  [/`step3-workflow-dispatch\.md`/, 'pointer must name step3-workflow-dispatch.md'],
  [/resolve-policy\.js" --values review-lens-dispatch`/, 'pointer must resolve review-lens-dispatch with resolve-policy.js --values'],
  [/only when[^.]*`workflow`/, 'pointer must read the sub-file only when the key resolves `workflow`'],
];

function checkPointer(text) {
  const paragraph = pointerParagraph(text);
  assert.ok(paragraph !== null, 'pointer paragraph missing');
  const bytes = Buffer.byteLength(paragraph);
  assert.ok(bytes <= POINTER_MAX_BYTES, `pointer paragraph is ${bytes} bytes, over ${POINTER_MAX_BYTES}`);
  for (const [needle, message] of POINTER_NEEDLES) assert.match(paragraph, needle, message);
}

// ---- the sub-file ----

const LABELS = [
  'no Workflow tool',
  'refused or failed before a reviewer starts',
  'started: false',
  'ended with no result',
  'result unreadable',
];
// Each condition is one numbered item of the Fallback section, opening with its label.
const labelItem = (label) => new RegExp(`^\\d\\. \`${label}\` —`, 'm');
const SKIP_LINE = '`SKIP {HH:MM:SS} — Step 3 lens dispatch (workflow fallback): condition: {condition} → fallback: Task lens dispatch. Reversibility: n/a.`';

const SETTLE_CONFIRMED = 'settle-lens-replies "{run-file}" --ctx-id "{ctx-id}" --run "$PIPELINE_RUN_DIR" --only confirmed';
const SETTLE_UNCONFIRMED = 'settle-lens-replies "{run-file}" --ctx-id "{ctx-id}" --run "$PIPELINE_RUN_DIR" --only unconfirmed';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// [pattern, fact]: each must match exactly once in the sub-file (assertEachPatternGoesRed proves it).
const FACTS = [
  [/log-decision\.js" --run "\$PIPELINE_RUN_DIR" --section "\/review" --status SKIP --step "Step 3 lens dispatch \(workflow fallback\)" --text-file "\{path-S\}" --reversibility n\/a/, 'the SKIP line is written through log-decision.js --text-file'],
  [new RegExp(esc(SETTLE_CONFIRMED)), 'settle-lens-replies --only confirmed'],
  [new RegExp(esc(SETTLE_UNCONFIRMED)), 'settle-lens-replies --only unconfirmed'],
  [/^## `needsSession`$/m, 'a needsSession section'],
  [/^\*\*`single-reviewer`\.\*\*/m, 'the single-reviewer reason'],
  [/^\*\*`reviewer-unusable`\.\*\*/m, 'the reviewer-unusable reason'],
  [/wait at most 30 minutes/, 'the 30-minute wait bound'],
  [/When that Task re-dispatch itself fails[^.]*`step3-tier-variants\.md`'s partner-died/, 'a failed re-dispatch takes the partner-died rule'],
  [/three directories above `transcriptDir`, then `workflows\/\{runId\}\.json`/, 'the run file path from transcriptDir'],
  [/mktemp -d \{ctx-dir\}\/agent-scratch\/\{lens\}-XXXXXX/, 'the mktemp -d SCRATCH directory'],
  [/Lens 3h is never sent through the script/, 'lens 3h never goes through the script'],
];
const missingFacts = missingFactsOf(FACTS);

function checkSubFile(text) {
  const fallback = sectionOf(text, '## Fallback');
  for (const label of LABELS) assert.match(fallback, labelItem(label), `fallback condition missing: ${label}`);
  assert.ok(fallback.includes(SKIP_LINE), 'SKIP line missing from the Fallback section');
  assert.deepEqual(missingFacts(text), [], 'sub-file facts missing');
  const confirmed = text.indexOf(SETTLE_CONFIRMED);
  const unconfirmed = text.indexOf(SETTLE_UNCONFIRMED);
  assert.ok(confirmed !== -1 && unconfirmed !== -1, 'settle-lens-replies marker missing');
  assert.ok(confirmed < unconfirmed, '--only confirmed must come before --only unconfirmed');
}

// ---- positive tests ----

test('step3-lens-dispatch.md carries the workflow pointer (AC7, AC8 cap)', () => {
  checkPointer(read(LENS_DISPATCH));
});

test('step3-workflow-dispatch.md states the fallbacks, the SKIP line and the settle order (AC7)', () => {
  checkSubFile(read(SUB_FILE));
});

function checkStructureRow(text) {
  const row = rowWithContinuations(text, '| review |');
  assert.ok(row.includes('step3-tier-variants.md, step3-workflow-dispatch.md,'), 'review row file list must name step3-workflow-dispatch.md');
  assert.match(row, /step3-workflow-dispatch\.md holds/, 'review row must say what step3-workflow-dispatch.md holds');
}

test('docs/plugin-structure.md lists step3-workflow-dispatch.md in the review row', () => {
  checkStructureRow(read('docs/plugin-structure.md'));
});

test('go-red: a review row without the sub-file in its list, or without its description, fails', () => {
  const live = read('docs/plugin-structure.md');
  const unlisted = live.replace('step3-tier-variants.md, step3-workflow-dispatch.md,', 'step3-tier-variants.md,');
  assert.notEqual(unlisted, live);
  assert.throws(() => checkStructureRow(unlisted), { message: /file list must name step3-workflow-dispatch\.md/ });
  const undescribed = live.replace('step3-workflow-dispatch.md holds', 'it holds');
  assert.notEqual(undescribed, live);
  assert.throws(() => checkStructureRow(undescribed), { message: /say what step3-workflow-dispatch\.md holds/ });
});

// ---- go-red controls: the pointer ----

test('go-red: step3-lens-dispatch.md without the pointer paragraph fails', () => {
  const live = read(LENS_DISPATCH);
  const paragraph = pointerParagraph(live);
  assert.ok(paragraph !== null);
  const mutated = live.replace(paragraph, '');
  assert.notEqual(mutated, live);
  assert.throws(() => checkPointer(mutated), { message: /pointer paragraph missing/ });
});

test('go-red: a pointer paragraph over 600 bytes fails', () => {
  const live = read(LENS_DISPATCH);
  const paragraph = pointerParagraph(live);
  const mutated = live.replace(paragraph, `${paragraph} ${'x'.repeat(POINTER_MAX_BYTES)}`);
  assert.notEqual(mutated, live);
  assert.throws(() => checkPointer(mutated), { message: /bytes, over 600/ });
});

test('go-red: a pointer without each needle fails with that needle\'s message', () => {
  const live = read(LENS_DISPATCH);
  const paragraph = pointerParagraph(live);
  for (const [needle, message] of POINTER_NEEDLES) {
    const global = new RegExp(needle.source, 'g');
    const mutated = live.replace(paragraph, paragraph.replace(global, ''));
    assert.notEqual(mutated, live, `needle not found in the pointer: ${message}`);
    assert.throws(() => checkPointer(mutated), { message: new RegExp(esc(message)) });
  }
});

// ---- go-red controls: the sub-file ----

test('go-red: the sub-file without each fallback condition item fails with that condition\'s message', () => {
  const live = read(SUB_FILE);
  for (const label of LABELS) {
    const mutated = live.replace(labelItem(label), '1. removed —');
    assert.notEqual(mutated, live, `item not found: ${label}`);
    assert.throws(() => checkSubFile(mutated), { message: new RegExp(`fallback condition missing: ${esc(label)}`) });
  }
});

test('go-red: a fallback condition item moved out of the Fallback section fails', () => {
  const live = read(SUB_FILE);
  for (const label of LABELS) {
    const item = live.split('\n').find((line) => labelItem(label).test(line));
    assert.ok(item, `item not found: ${label}`);
    const mutated = `${live.replace(item, '1. moved —')}\n## Elsewhere\n\n${item}\n`;
    assert.throws(() => checkSubFile(mutated), { message: new RegExp(`fallback condition missing: ${esc(label)}`) });
  }
});

test('go-red: the sub-file without the SKIP line fails', () => {
  const live = read(SUB_FILE);
  const mutated = live.split(SKIP_LINE).join('the line');
  assert.notEqual(mutated, live);
  assert.throws(() => checkSubFile(mutated), { message: /SKIP line missing/ });
});

test('go-red: each sub-file fact goes red alone when its text is removed', () => {
  assertEachPatternGoesRed(read(SUB_FILE), FACTS, missingFacts);
});

test('go-red: --only unconfirmed placed before --only confirmed fails the order check', () => {
  const live = read(SUB_FILE);
  const swapped = live.replace(SETTLE_CONFIRMED, '\u0000').replace(SETTLE_UNCONFIRMED, SETTLE_CONFIRMED).replace('\u0000', SETTLE_UNCONFIRMED);
  assert.notEqual(swapped, live);
  assert.throws(() => checkSubFile(swapped), { message: /--only confirmed must come before --only unconfirmed/ });
});
