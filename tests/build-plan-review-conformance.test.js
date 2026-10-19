'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets.js');
// #3377: /build's Common Step 1.6 — one Capable reviewer reads the materialized
// spec and the plan before Task 1 and routes spec gaps, undecided behaviour,
// and cross-task contract disagreements. This file pins the SKILL.md pointer
// stub and the build/plan-review.md procedure. Read live: just-shipped prose
// expected to evolve. Each pin set is a problems(text) function so every
// go-red control runs the same check on doctored text.

const ROOT = path.join(__dirname, '..');
const SKILL_PATH = path.join(ROOT, 'plugin', 'skills', 'build', 'SKILL.md');
const REVIEW_PATH = path.join(ROOT, 'plugin', 'skills', 'build', 'plan-review.md');
const HANDOFF_PATH = path.join(ROOT, 'plugin', 'skills', 'build', 'handoff-template.md');
const norm = (t) => t.replace(/\s+/g, ' ');

const STEP_HEADING = '### Common Step 1.6: Plan Review (Spec Mode only)';

function stepBody(skill) {
  const start = skill.indexOf(STEP_HEADING);
  assert.notStrictEqual(start, -1, `SKILL.md lacks "${STEP_HEADING}"`);
  const next = skill.indexOf('\n### ', start + STEP_HEADING.length);
  return next === -1 ? skill.slice(start) : skill.slice(start, next);
}

// The first fenced block after the `## Dispatch prompt` heading.
function dispatchBlock(text) {
  const start = text.indexOf('\n## Dispatch prompt');
  assert.notStrictEqual(start, -1, 'plan-review.md lacks "## Dispatch prompt"');
  const open = text.indexOf('\n```', start);
  assert.notStrictEqual(open, -1, 'no fenced block after "## Dispatch prompt"');
  const bodyStart = text.indexOf('\n', open + 1) + 1;
  const close = text.indexOf('\n```', bodyStart - 1);
  assert.notStrictEqual(close, -1, 'unterminated fenced block after "## Dispatch prompt"');
  return text.slice(bodyStart, close);
}

// A `### ` subsection, up to the next `### ` or `## ` heading.
function subsection(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  assert.notStrictEqual(start, -1, `plan-review.md lacks "${heading}"`);
  const rest = text.slice(start + 1);
  const next = rest.slice(heading.length).search(/\n#{2,3} /);
  return next === -1 ? rest : rest.slice(0, heading.length + next);
}

const doctor = (text, anchor) => text.split(anchor).join('removed');

// --- pin sets ---

const STUB_ANCHORS = ['plan-review.md', 'Spec Mode only', 'roster tag `plan-review`', 'fewer than 3 file references', 'Scope keywords:', 'SKIP', 'design mode'];
const stubProblems = (body) => STUB_ANCHORS.filter((a) => !body.includes(a));

const PROMPT_ANCHORS = [
  'spec gap',
  'undecided behaviour',
  'cross-task contract',
  "Do not repeat SDD's pre-flight conflict table",
  '| Severity | Class | Resolution | Path:Line | Finding | Evidence | Suggested resolution |',
  'No findings.',
  '+N more',
  'at most 7 rows',
  'STATUS: {DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED}',
];
const promptProblems = (block) => PROMPT_ANCHORS.filter((a) => !block.includes(a));

const BOUNDARY_ANCHORS = ['Global Constraints', 'producer/consumer'];
function boundaryProblems(block) {
  const problems = BOUNDARY_ANCHORS.filter((a) => !block.includes(a));
  if ((block.match(/example:/g) || []).length < 2) problems.push('two example: occurrences');
  return problems;
}

const ORDER_ANCHORS = ['additive', 'git commit', 'log-decision.js', 'gh issue comment', 'plan-audit.js'];
const SECTION_ANCHORS = ['never edits or loosens an existing Acceptance Criterion', 'same commit'];
function intentProblems(section) {
  const flat = norm(section);
  const problems = [...ORDER_ANCHORS, ...SECTION_ANCHORS].filter((a) => !flat.includes(a));
  const positions = ORDER_ANCHORS.filter((a) => flat.includes(a)).map((a) => flat.indexOf(a));
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] <= positions[i - 1]) { problems.push('order'); break; }
  }
  return problems;
}

const FOCUS_ANCHORS = [
  'never read as "No findings."',
  'treated as `needs-human`',
  'one `AskUserQuestion` call',
  'one comment',
  'never on Severity',
  '`low` and `info` findings are logged only',
];
const focusProblems = (text) => FOCUS_ANCHORS.filter((a) => !norm(text).includes(a));

const GATE_ANCHORS = ['<!-- HARD-GATE: plan-review-needs-human -->', 'DISPATCH_HEADLESS=1', 'dispatched: true', 'bot:blocked', 'release-claim.js', 'failed: plan-review-needs-human', 'BLOCKED'];
const gateProblems = (text) => GATE_ANCHORS.filter((a) => !norm(text).includes(a));

// --- SKILL.md pointer stub ---

test('AC1.1: Common Step 1.6 sits after 1.5 and before 1.7 and 2, names Spec Mode only, and points at plan-review.md', () => {
  const skill = readText(SKILL_PATH);
  const i15 = skill.indexOf('### Common Step 1.5: Plan Audit');
  const i16 = skill.indexOf(STEP_HEADING);
  const i17 = skill.indexOf('### Common Step 1.7:');
  const i2 = skill.indexOf('### Common Step 2: Execute the Plan');
  assert.ok(i15 !== -1 && i16 !== -1 && i17 !== -1 && i2 !== -1, 'a Common Step heading is missing');
  assert.ok(i15 < i16 && i16 < i17 && i17 < i2, 'Common Step 1.6 is out of order');
  const body = stepBody(skill);
  assert.ok(body.includes('plan-review.md'));
  assert.ok(body.includes('Spec Mode only'));
  // Pointer only: none of the procedure's own call sites appear in the stub.
  // (A byte bound would be a skill-size number outside budgets.js — decision 0024.)
  for (const procedure of ['resolve-profile.js', 'AskUserQuestion', 'gh issue comment', 'release-claim.js', '```']) {
    assert.ok(!body.includes(procedure), `step body restates the procedure: ${procedure}`);
  }
  assert.ok(!body.includes('/claude-tweaks:dispatch'), 'AC8.1: SKILL.md must not restate a skill-graph edge');
});

// The spec's 51,200-byte figure predates decision 0024, which retired the global
// ceiling for the Read-limit rail; budgets.js is the one place a size number lives.
test('AC1.1: build/SKILL.md stays within the rail', () => {
  const bytes = Buffer.byteLength(readText(SKILL_PATH));
  assert.ok(bytes <= RAIL_BYTES, `build/SKILL.md is ${bytes} bytes, rail ${RAIL_BYTES}`);
});

test('AC7.1: the stub skips on fast-lane and on a trivial plan with a SKIP entry, and never runs in design mode', () => {
  assert.deepStrictEqual(stubProblems(stepBody(readText(SKILL_PATH))), []);
});

// --- plan-review.md ---

test('AC2.1: plan-review.md names the three classes and inlines the output template and STATUS line in the dispatch prompt', () => {
  assert.deepStrictEqual(promptProblems(dispatchBlock(readText(REVIEW_PATH))), []);
});

test("AC2.1: the brief states the class boundary against SDD's pre-flight scan with one example of each", () => {
  assert.deepStrictEqual(boundaryProblems(dispatchBlock(readText(REVIEW_PATH))), []);
});

test('AC3.1 + AC3.2: the model comes from resolve-profile.js capable and no model name is hardcoded', () => {
  const text = readText(REVIEW_PATH);
  assert.ok(text.includes('"${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" capable'));
  assert.ok(text.includes('model'));
  assert.doesNotMatch(text, /\b(opus|sonnet|haiku|fable)\b/i);
});

test('AC4.1: an intent-resolvable spec gap amends, commits, logs, comments, then re-runs plan-audit, in that order', () => {
  assert.deepStrictEqual(intentProblems(subsection(readText(REVIEW_PATH), '### Spec gap — intent-resolvable')), []);
});

test('AC4.2: no gh issue edit runs against the live record and nothing is staged', () => {
  const text = norm(readText(REVIEW_PATH));
  assert.ok(text.includes('`gh issue edit` never runs against the live record'));
  assert.ok(text.includes('nothing is staged for the Review Console'));
});

test('AC4.3: standalone /build lists the amendment in the Step 7 handoff without a decision-log write', () => {
  const text = norm(readText(REVIEW_PATH));
  assert.ok(text.includes('Step 7 handoff'));
  assert.ok(text.includes('no decision-log write'));
  assert.ok(readText(HANDOFF_PATH).includes('### Plan review amendments (standalone build, if any)'));
});

test('Review Focus 1-4: unusable reply never clean; unquoted intent-resolvable is needs-human; one question set; routing never on Severity', () => {
  assert.deepStrictEqual(focusProblems(readText(REVIEW_PATH)), []);
});

test('the needs-human stop carries the HARD-GATE marker and the three presence branches', () => {
  assert.deepStrictEqual(gateProblems(readText(REVIEW_PATH)), []);
});

test('plan-review.md is within the rail', () => {
  const bytes = Buffer.byteLength(readText(REVIEW_PATH));
  assert.ok(bytes <= RAIL_BYTES, `plan-review.md is ${bytes} bytes, rail ${RAIL_BYTES}`);
});

// --- go-red controls ---

test('go-red: each pin set fails when one anchor is removed', () => {
  const text = readText(REVIEW_PATH);
  const block = dispatchBlock(text);
  const intent = subsection(text, '### Spec gap — intent-resolvable');
  const stub = stepBody(readText(SKILL_PATH));
  const cases = [
    [stubProblems, stub, STUB_ANCHORS],
    [promptProblems, block, PROMPT_ANCHORS],
    [boundaryProblems, block, BOUNDARY_ANCHORS],
    [intentProblems, norm(intent), [...ORDER_ANCHORS, ...SECTION_ANCHORS]],
    [focusProblems, norm(text), FOCUS_ANCHORS],
    [gateProblems, norm(text), GATE_ANCHORS],
  ];
  for (const [problems, source, anchors] of cases) {
    for (const anchor of anchors) {
      const doctored = doctor(source, anchor);
      assert.notStrictEqual(doctored, source, `doctoring found no anchor text for ${anchor}`);
      assert.deepStrictEqual(problems(doctored), [anchor], `removing ${anchor} did not surface exactly that anchor`);
    }
  }
});

test('go-red: the AC4.1 order check fails when two anchors swap', () => {
  const intent = norm(subsection(readText(REVIEW_PATH), '### Spec gap — intent-resolvable'));
  const swapped = intent
    .replace('gh issue comment', '@@SWAP@@')
    .replace('log-decision.js', 'gh issue comment')
    .replace('@@SWAP@@', 'log-decision.js');
  assert.deepStrictEqual(intentProblems(swapped), ['order']);
});

test('go-red: the example count fails with a single example', () => {
  const block = dispatchBlock(readText(REVIEW_PATH));
  assert.deepStrictEqual(boundaryProblems(block.replace('example:', 'removed')), ['two example: occurrences']);
});
