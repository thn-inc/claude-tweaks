'use strict';
// tests/flow-context-handoff-conformance.test.js — #4027 Task 8: /flow's
// phase-boundary context cap check. Step 4 runs bin/context-gauge.js with
// --next-steps at a boundary that has a step left; past the cap, the next phase
// starts in a fresh agent from {run}/handoff.json. Pins the Step 4 call site,
// context-handoff.md's two branches (a dispatched call reports
// `OUTCOME: handoff` + `NEXT_STEPS:` — the contract Task 9's dispatcher reads;
// a top-level run hands off to one fresh Agent), the fail-open rule, and the
// template's verbatim copy of dispatch/task-prompt.md's async-wait item.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const FLOW = 'plugin/skills/flow/SKILL.md';
const HANDOFF = 'plugin/skills/flow/context-handoff.md';
const STEPS_AND_GATES = 'plugin/skills/flow/steps-and-gates.md';
const TASK_PROMPT = 'plugin/skills/dispatch/task-prompt.md';

// The text from `start` up to (not including) `end`; fails loudly when either
// anchor is gone, so a moved heading cannot turn an assertion vacuous.
function region(text, start, end, label) {
  const s = text.indexOf(start);
  assert.notEqual(s, -1, `${label}: start anchor ${JSON.stringify(start)} not found`);
  const e = text.indexOf(end, s + start.length);
  assert.notEqual(e, -1, `${label}: end anchor ${JSON.stringify(end)} not found`);
  return text.slice(s, e);
}

function fencedBlocks(text) {
  const blocks = [];
  const re = /^```[^\n]*\n([\s\S]*?)^```$/gm;
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  return blocks;
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();

// dispatch/task-prompt.md's Context pack item 7, from its first sentence to
// the item's end — the rule the handoff template copies in the same words.
function item7Body(text) {
  const head = '7. **Async-wait discipline** — ';
  const start = text.indexOf(head);
  assert.notEqual(start, -1, 'task-prompt.md lost its item 7 "Async-wait discipline" heading');
  const rest = text.slice(start + head.length);
  const end = rest.search(/\n(?:8\. |## )/);
  assert.notEqual(end, -1, 'task-prompt.md: no "8. " item or "## " heading follows item 7');
  return squash(rest.slice(0, end));
}

const stepFourItem = () => region(read(FLOW), '3. **Check the gate**', '**Pass context forward**', 'flow Step 4 cap-check item');

test('flow Step 4 runs context-gauge.js with --next-steps and a literal run dir, only with a step left, and points at context-handoff.md', () => {
  const r = stepFourItem();
  assert.match(r, /bin\/context-gauge\.js" --run "\/[^"$]*" --next-steps /, 'the gauge call must pass --run as a literal absolute path and --next-steps');
  assert.doesNotMatch(r, /context-gauge\.js" --run "\$/, 'the gauge call must never pass --run "$PIPELINE_RUN_DIR"');
  assert.match(r, /never `\$PIPELINE_RUN_DIR`/, 'the item must say why the run dir is spelled out');
  assert.match(r, /at least one step (?:still )?(?:left|to run|remains)/);
  assert.match(r, /`MULTISPEC_PARALLEL_WAVE=1`/);
  assert.match(r, /`context-handoff\.md`/);
  assert.match(r, /exit 2[^\n]*continue in this agent/i);
});

test('context-handoff.md states the fail-open rule: over: false, exit 2, or non-JSON output continues in this agent', () => {
  const t = read(HANDOFF);
  assert.match(t, /`over: false` means continue in this agent/);
  assert.match(t, /exit 2[^\n]*continue in this agent/i);
  assert.match(t, /non-JSON output: continue in this agent/);
  assert.match(t, /`handoff: null`/);
  assert.match(t, /never stops the run/);
});

test('context-handoff.md: a dispatched call reports OUTCOME: handoff and NEXT_STEPS: with STATUS: DONE, after the phase-exit push', () => {
  const t = read(HANDOFF);
  const d = region(t, '\n## Dispatched call', '\n## ', 'dispatched branch');
  assert.match(d, /`dispatched: true`/);
  assert.match(d, /`OUTCOME: handoff`/);
  assert.match(d, /`NEXT_STEPS: \{comma-joined remaining steps\}`/);
  assert.match(d, /`STATUS: DONE`/);
  assert.match(d, /Phase-exit push/);
  assert.match(d, /stops before the next step/);
});

test('context-handoff.md: a top-level run hands off to one fresh Agent whose template reads handoff.json first, then waits and relays', () => {
  const t = read(HANDOFF);
  const n = region(t, '## Top-level run', '\n```', 'top-level branch');
  assert.match(n, /\bone fresh `Agent`/);
  assert.match(n, /never `fork`/);
  assert.match(n, /relay/i);
  const blocks = fencedBlocks(t);
  assert.equal(blocks.length, 1, `context-handoff.md must hold exactly one fenced template, found ${blocks.length}`);
  const [tpl] = blocks;
  const readAt = tpl.indexOf('Read `{run}/handoff.json`');
  const resumeAt = tpl.indexOf('`resume`');
  assert.notEqual(readAt, -1, 'the template must tell the child to Read {run}/handoff.json');
  assert.notEqual(resumeAt, -1, "the template must tell the child to run handoff.json's resume command");
  assert.ok(readAt < resumeAt, 'the child reads handoff.json before it runs the resume command');
  assert.match(tpl, /STATUS: \{WORD\}/);
});

test("the handoff template inlines task-prompt.md's async-wait item 7 in the same words, INTERIM_STATUS rule included", () => {
  const [tpl] = fencedBlocks(read(HANDOFF));
  const body = item7Body(read(TASK_PROMPT));
  assert.match(body, /INTERIM_STATUS/, 'the source item lost its INTERIM_STATUS rule');
  assert.ok(squash(tpl).includes(body), "the template's async-wait rule drifted from dispatch/task-prompt.md's Context pack item 7");
});

test('the verbatim-copy check can go red: one changed word in the copy fails it', () => {
  const [tpl] = fencedBlocks(read(HANDOFF));
  const body = item7Body(read(TASK_PROMPT));
  const doctored = squash(tpl).replace('at most 60 (20 minutes)', 'at most 90 (30 minutes)');
  assert.notEqual(doctored, squash(tpl), 'the doctoring anchor is gone from the template');
  assert.ok(!doctored.includes(body));
});

test("steps-and-gates.md's Partial step lists: a handed-off run renders the partial note naming handoff.json", () => {
  const r = region(read(STEPS_AND_GATES), '### Partial step lists', '**Auto-insert `test`:**', 'Partial step lists');
  assert.match(r, /handed[- ]off/i);
  assert.match(r, /\{PIPELINE_RUN_DIR\}\/handoff\.json/);
  assert.match(r, /`context-handoff\.md`/);
});

// Fix round 1: the exclusions, the top-level wrap-up rule, the wait bound.
test('flow Step 4 gauges only single-spec, non-interactive runs, after build\'s automatic stories, and keeps wrap-up off a top-level --next-steps', () => {
  const r = stepFourItem();
  assert.match(r, /single-spec runs outside `interactive` only/);
  assert.match(r, /after `build`'s automatic `stories`/);
  assert.match(r, /leaves `wrap-up` out of `--next-steps`/);
  assert.match(r, /`wrap-up` is the only step left/);
});

test('context-handoff.md states the single-spec-only limit and the interactive exclusion explicitly', () => {
  const c = region(read(HANDOFF), '## The check', '## Reading the result', 'the check');
  assert.match(c, /\*\*A single-spec run\.\*\* Multi-spec handoff is not supported/);
  assert.match(c, /\*\*Not under `interactive`\.\*\*/);
});

test('context-handoff.md: an empty dispatched read lands on the top-level branch', () => {
  const r = region(read(HANDOFF), '## Reading the result', '\n## Dispatched call', 'reading the result');
  assert.match(r, /prints nothing[^\n]*Top-level run branch/);
});

test('context-handoff.md: a top-level run never hands off wrap-up, and runs wrap-up and Step 5 itself after relaying', () => {
  const n = region(read(HANDOFF), '## Top-level run', '\n```', 'top-level branch');
  assert.ok(n.includes('A top-level run never hands off `wrap-up`: its `--next-steps` stops before `wrap-up`, and with `wrap-up` the only step left it does not gauge.'));
  assert.ok(n.includes("After relaying the child's Steps Complete note, this agent runs `wrap-up` and Step 5 itself."));
  assert.ok(n.includes("A child's own handoff never carries `wrap-up` either."));
  assert.doesNotMatch(n, /as this run's result, and stop\. The child's own Step 5/);
});

test('context-handoff.md: the 20-minute wait bound binds only a subagent parent; a top-level session waits unbounded', () => {
  const n = region(read(HANDOFF), '## Top-level run', '\n```', 'top-level branch');
  assert.match(n, /only when this agent is itself a subagent/);
  assert.match(n, /A top-level session waits for the child's task-notification with no bound/);
  assert.match(n, /`_shared\/dispatch-waiting\.md`/);
  assert.match(n, /confirm the child has stopped before anyone runs `resume`/);
  assert.doesNotMatch(n, /Every hop finishes at least one step/);
  assert.match(n, /auto-inserts `test`/);
  assert.match(n, /starts well under the cap/);
});

test("steps-and-gates.md's Steps Complete note has a handed-off variant of its wrap-up-absent sentence", () => {
  const r = region(read(STEPS_AND_GATES), '**A handed-off run produces this same branch too', '**Auto-insert `test`:**', 'handed-off paragraph');
  assert.match(r, /This run is not finished — its remaining steps \{next-steps\} were handed to a fresh agent/);
});

// Fix round 2: a single step argument resumes onward (steps-and-gates.md's
// Step Arguments), so a one-entry top-level --next-steps would run wrap-up in
// the child. A top-level run gauges only with two or more steps before wrap-up.
test('a top-level run gauges only with two or more steps before wrap-up: the one-step case is excluded, the two-step case allowed', () => {
  const premise = read(STEPS_AND_GATES);
  assert.match(premise, /\| Single step \| Resume from that step onward \|/, 'the premise moved: a single step argument no longer resumes onward');
  assert.match(premise, /\| Multiple steps \(comma-separated\) \| Run exactly those steps \|/, 'the premise moved: a comma list no longer runs exactly those steps');
  const item = stepFourItem();
  assert.match(item, /gauges only when two or more steps remain before `wrap-up`/);
  assert.match(item, /a single step resumes from that step onward/);
  // Final review fix: the two-step rule is the top-level one; a dispatched call gauges with
  // one step left, because its template's stop sentence holds a one-entry `test` to `test`.
  assert.match(item, /A top-level run gauges only when two or more steps remain before `wrap-up`/);
  assert.match(item, /A dispatched call gauges with any step left, even one: its continuation template's "Stop after the test gate" sentence holds a one-entry `test` list to exactly `test`/);
  const bullet = region(read(HANDOFF), '- **Never `wrap-up` from a top-level run.**', '\n', 'top-level wrap-up bullet');
  assert.match(bullet, /gauges only when two or more steps remain before `wrap-up`/);
  assert.match(bullet, /one step left before `wrap-up`[^.]*does not gauge/);
  assert.match(bullet, /two or more[^.]*always a comma list/);
  assert.match(bullet, /a single step resumes from that step onward/);
});

test('flow/SKILL.md stays under RAIL_BYTES with the cap-check item', () => {
  const bytes = Buffer.byteLength(read(FLOW), 'utf8');
  assert.ok(bytes < RAIL_BYTES, `${FLOW} is ${bytes} B, rail ${RAIL_BYTES} B`);
});
