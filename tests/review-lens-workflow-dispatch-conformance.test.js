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

// Final review m4: the pointer opens the blockquote whose Task dispatch prose it overrides.
const PARALLEL_ANCHOR = '> **Parallel execution (conditional):**';

function checkPointer(text) {
  const paragraph = pointerParagraph(text);
  assert.ok(paragraph !== null, 'pointer paragraph missing');
  const bytes = Buffer.byteLength(paragraph);
  assert.ok(bytes <= POINTER_MAX_BYTES, `pointer paragraph is ${bytes} bytes, over ${POINTER_MAX_BYTES}`);
  for (const [needle, message] of POINTER_NEEDLES) assert.match(paragraph, needle, message);
  assert.ok(text.includes(`${paragraph}\n>\n${PARALLEL_ANCHOR}`), 'pointer must sit immediately before the Parallel execution paragraph');
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

// The 30-minute bound needs something to wake the session: a background timer started in `## Start` (fix round 1, I1).
const TIMER_COMMAND = 'node -e "setTimeout(()=>{},1800000)"';
// Fix round 2: an abandoned run is stopped (n3), and a post-launch fallback keeps the 3h already dispatched (n1+n2).
const STOP_RUN = "stop the run with `TaskStop` on the launch result's `taskId`";
const AFTER_LAUNCH_SCOPE = 'under conditions 3–5 (taken after launch) it dispatches the agent lenses 3a–3g only';
// Fix round 3: the stop covers condition 5 too (p1); the launch order and the "Then dispatch" scope are pinned (p2).
const STOP_BOTH = 'before taking condition 4 or 5';
const LAUNCH_ALONE = 'Make one `Workflow` call, alone in its message';
const NEXT_MESSAGE = 'in the next message, start one timer';
const WITH_3H = 'together with it dispatch lens 3h';
const THEN_SCOPE = 'lenses 3a–3g only under conditions 3–5';
// Final review: the dontAsk allow rule (m1), the settle exits (m3) and the re-dispatch's own step label (m5).
const ALLOW_RULE = '`Workflow(claude-tweaks:review-lens-fanout)`';
// Residual fix r1/r2: a settle exit 3 is never a fallback condition (the fallback's own writes would exit 3 too).
const CONDITION_5_SCOPE = 'the first (or, standalone, the only) `settle-lens-replies` call exits 2 on the run file.';
const EXIT_3 = 're-run this first call once, and when it exits 3 again, never take the fallback — re-run the call standalone (no `--run`, `--only` or `--hold`; nothing is logged), continue with its output, and name in the review summary that the run directory was unusable and the pair lines were not logged';
const EXIT_3_SECOND = 'An exit 3 on this second call is not condition 5 either: re-resolve `$PIPELINE_RUN_DIR` per `_shared/pipeline-run-dir.md` and re-run this call once, and when it exits 3 again, never take the fallback — carry each settled lens\'s `unconfirmed` list from the first call\'s output on to Step 3.7 and name the unlogged `--only unconfirmed` lines in the review summary.';
const REDISPATCH_STEP = '--step "Step 3 lens dispatch (reviewer re-dispatch)"';

function checkSubFile(text) {
  assert.ok(sectionOf(text, '## Availability').includes(ALLOW_RULE), 'Availability must name the dontAsk allow rule');
  assert.ok(sectionOf(text, '## Settle').includes(EXIT_3), 'Settle must handle a settle call\'s exit 3');
  assert.ok(sectionOf(text, '## Settle').includes(EXIT_3_SECOND), 'Settle must keep the second call\'s exit 3 off the fallback');
  assert.ok(sectionOf(text, '## `needsSession`').includes(REDISPATCH_STEP), 'needsSession must log the re-dispatch under its own step label');
  const start = sectionOf(text, '## Start');
  assert.ok(start.includes(TIMER_COMMAND), 'Start must start the 1800000 ms setTimeout timer');
  assert.match(start, /`run_in_background` Bash call/, 'Start must run the timer as a run_in_background Bash call');
  assert.ok(start.includes(STOP_RUN), 'Start must stop an abandoned run by its launch taskId');
  assert.ok(start.includes(STOP_BOTH), 'Start must stop the run before condition 4 or 5');
  assert.ok(start.includes(LAUNCH_ALONE), 'Start must make the Workflow call alone in its message');
  assert.ok(start.includes(NEXT_MESSAGE), 'Start must start the timer in the next message');
  assert.ok(start.includes(WITH_3H), 'Start must dispatch lens 3h together with the timer');
  assert.ok(start.indexOf(LAUNCH_ALONE) < start.indexOf(NEXT_MESSAGE), 'the Workflow call must come before the timer message');
  const fallback = sectionOf(text, '## Fallback');
  assert.ok(fallback.includes(AFTER_LAUNCH_SCOPE), 'Fallback must dispatch only 3a–3g after launch');
  assert.ok(fallback.includes(THEN_SCOPE), 'Fallback\'s Then-dispatch sentence must scope 3a–3g to conditions 3–5');
  for (const label of LABELS) assert.match(fallback, labelItem(label), `fallback condition missing: ${label}`);
  assert.ok(fallback.includes(CONDITION_5_SCOPE), 'condition 5 must scope exit 2 to the first settle call and name no exit 3');
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

test('go-red: the pointer moved back after the Task dispatch prose fails', () => {
  const live = read(LENS_DISPATCH);
  const paragraph = pointerParagraph(live);
  const placed = `${paragraph}\n>\n${PARALLEL_ANCHOR}`;
  assert.ok(live.includes(placed), 'pointer not found before the Parallel execution paragraph');
  const moved = live.replace(placed, PARALLEL_ANCHOR).replace('> **Output template (each agent must follow exactly):**', `${paragraph}\n>\n> **Output template (each agent must follow exactly):**`);
  assert.notEqual(moved, live);
  assert.throws(() => checkPointer(moved), { message: /pointer must sit immediately before the Parallel execution paragraph/ });
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

test('go-red: a Start section without the timer command, or without run_in_background, fails', () => {
  const live = read(SUB_FILE);
  const noTimer = live.split(TIMER_COMMAND).join('a timer');
  assert.notEqual(noTimer, live);
  assert.throws(() => checkSubFile(noTimer), { message: /Start must start the 1800000 ms setTimeout timer/ });
  const noBackground = live.split('`run_in_background` Bash call').join('Bash call');
  assert.notEqual(noBackground, live);
  assert.throws(() => checkSubFile(noBackground), { message: /Start must run the timer as a run_in_background Bash call/ });
});

test('go-red: the timer sentence moved out of the Start section fails', () => {
  const live = read(SUB_FILE);
  const sentence = live.split('\n').find((line) => line.includes(TIMER_COMMAND));
  assert.ok(sentence, 'timer line not found');
  const mutated = `${live.replace(sentence, 'Wait for the notification.')}\n## Elsewhere\n\n${sentence}\n`;
  assert.notEqual(mutated, live);
  assert.throws(() => checkSubFile(mutated), { message: /Start must start the 1800000 ms setTimeout timer/ });
});

test('go-red: a Start without the abandoned-run stop, or a Fallback without the 3a–3g scope, fails', () => {
  const live = read(SUB_FILE);
  const noStop = live.split(STOP_RUN).join('carry on');
  assert.notEqual(noStop, live);
  assert.throws(() => checkSubFile(noStop), { message: /Start must stop an abandoned run by its launch taskId/ });
  const noScope = live.split(AFTER_LAUNCH_SCOPE).join('under conditions 3–5 it dispatches every lens');
  assert.notEqual(noScope, live);
  assert.throws(() => checkSubFile(noScope), { message: /Fallback must dispatch only 3a–3g after launch/ });
});

test('go-red: each launch-order and stop pin goes red with its own message', () => {
  const live = read(SUB_FILE);
  const cases = [
    [STOP_BOTH, 'before taking condition 4', /Start must stop the run before condition 4 or 5/],
    [LAUNCH_ALONE, 'Make one `Workflow` call', /Start must make the Workflow call alone in its message/],
    [NEXT_MESSAGE, 'start one timer', /Start must start the timer in the next message/],
    [WITH_3H, 'dispatch lens 3h', /Start must dispatch lens 3h together with the timer/],
    [THEN_SCOPE, 'every lens under conditions 3–5', /Then-dispatch sentence must scope 3a–3g to conditions 3–5/],
  ];
  for (const [literal, replacement, message] of cases) {
    const mutated = live.split(literal).join(replacement);
    assert.notEqual(mutated, live, `literal not found: ${literal}`);
    assert.throws(() => checkSubFile(mutated), { message });
  }
});

test('go-red: each final-review pin (allow rule, condition 5, exit 3, re-dispatch label) goes red with its own message', () => {
  const live = read(SUB_FILE);
  const cases = [
    [ALLOW_RULE, 'an allow rule', /Availability must name the dontAsk allow rule/],
    [CONDITION_5_SCOPE, 'the first `settle-lens-replies` call (`--only confirmed`) exits 2 on the run file', /condition 5 must scope exit 2 to the first settle call/],
    [CONDITION_5_SCOPE, 'the first (or, standalone, the only) `settle-lens-replies` call exits 2 on the run file, or exits 3 again after Settle\'s one re-run.', /condition 5 must scope exit 2 to the first settle call and name no exit 3/],
    [EXIT_3, 're-run this first call once, and when it exits 3 again, take condition 5', /Settle must handle a settle call's exit 3/],
    [EXIT_3_SECOND, 'An exit 3 on this second call is condition 5.', /Settle must keep the second call's exit 3 off the fallback/],
    [REDISPATCH_STEP, '--step "Step 3 lens dispatch (workflow fallback)"', /needsSession must log the re-dispatch under its own step label/],
  ];
  for (const [literal, replacement, message] of cases) {
    const mutated = live.split(literal).join(replacement);
    assert.notEqual(mutated, live, `literal not found: ${literal}`);
    assert.throws(() => checkSubFile(mutated), { message });
  }
});

test('go-red: a final-review pin moved out of its section fails', () => {
  const live = read(SUB_FILE);
  const cases = [
    [ALLOW_RULE, /Availability must name the dontAsk allow rule/],
    [EXIT_3, /Settle must handle a settle call's exit 3/],
    [EXIT_3_SECOND, /Settle must keep the second call's exit 3 off the fallback/],
    [REDISPATCH_STEP, /needsSession must log the re-dispatch under its own step label/],
  ];
  for (const [literal, message] of cases) {
    assert.ok(live.includes(literal), `literal not found: ${literal}`);
    const mutated = `${live.split(literal).join('moved')}\n## Elsewhere\n\n${literal}\n`;
    assert.throws(() => checkSubFile(mutated), { message });
  }
});

test('go-red: the timer message placed before the Workflow call fails the launch-order check', () => {
  const live = read(SUB_FILE);
  const swapped = live.replace(LAUNCH_ALONE, '\u0000').replace(NEXT_MESSAGE, LAUNCH_ALONE).replace('\u0000', NEXT_MESSAGE);
  assert.notEqual(swapped, live);
  assert.throws(() => checkSubFile(swapped), { message: /the Workflow call must come before the timer message/ });
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
