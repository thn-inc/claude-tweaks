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

const STUB_ANCHORS = ['plan-review.md', 'Spec Mode only', '`ceremony-profile` is `fast-lane`', 'roster tag `plan-review`', 'fewer than 3 file references', 'Scope keywords:', 'SKIP', 'design mode'];
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
  'On a needs-human row, Suggested resolution names both defensible readings: "Reading A: … / Reading B: …"',
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
  'question set as one comment',
  'never on Severity',
  '`low` and `info` findings are logged only',
];
const focusProblems = (text) => FOCUS_ANCHORS.filter((a) => !norm(text).includes(a));

// Scoped to the `### Spec gap — needs-human` subsection: the whole file carries
// DISPATCH_HEADLESS=1 and BLOCKED elsewhere, so a file-wide check could not go red.
// Settle (dispatch/settle-and-merge.md), not the build, releases the dispatched claim.
const NEEDS_HUMAN = '### Spec gap — needs-human';
const GATE_ANCHORS = ['<!-- HARD-GATE: plan-review-needs-human -->', 'DISPATCH_HEADLESS=1', 'dispatched: true', 'needs:answer', 'Settle (steps 1-2) releases the claim', 'failed: plan-review-needs-human', 'reports `BLOCKED`'];
const gateProblems = (section) => GATE_ANCHORS.filter((a) => !norm(section).includes(a));

// Exit state and transports: the exit state is scoped to the dispatched call and exact
// about teardown; local-files has no issue to comment on; the question comment names its
// transport; the comment body path is a literal, not a shell variable.
const FIX_ANCHORS = [
  '**Exit state (dispatched call)**',
  'The gate itself tears nothing down and closes no PR',
  '`dispatch/two-call-gate.md` §5',
  'needs no local state',
  'The present-human branch releases no claim',
  'Under `work-backend: local-files` there is no GitHub issue to comment on',
  'the committed `## Plan Review Clarifications` section is the trail',
  '`/claude-tweaks:dispatch` is GitHub-only',
  "same transport as the intent-resolvable step's comment",
  'take the literal path it prints',
];
const fixProblems = (text) => FIX_ANCHORS.filter((a) => !norm(text).includes(a));

// Read from the needs-human subsection: presence in multi-spec
// and parallel-wave contexts, readings as options, and the KEPT-PROMPT command.
// The headless grant removal and the conditional re-grant are retired (#5053 D3):
// the AC6 pins below assert their absence.
const FINAL_ANCHORS = [
  '${MULTISPEC_PARENT_DIR:-$PIPELINE_RUN_DIR}/run-state.json',
  'holds no `run-state.json`',
  '`MULTISPEC_PARALLEL_WAVE=1`',
  'OUTCOME: hard-gate-failed',
  'No claim release here',
  'The build releases no claim itself',
  'never by the build',
  '`Reading A: …` and `Reading B: …`, plus `Stop the build`',
  '--status KEPT-PROMPT',
  "Status semantics table",
];
const finalProblems = (section) => FINAL_ANCHORS.filter((a) => !norm(section).includes(a));

// Whole-file pins for the minors that live outside the needs-human subsection.
const FINAL_FILE_ANCHORS = [
  'a `needs-human` spec-gap row triggers the HARD-GATE at any severity',
  'the path inside the quotes',
];
const finalFileProblems = (text) => FINAL_FILE_ANCHORS.filter((a) => !norm(text).includes(a));

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
  assert.ok(text.includes("Pass the returned `model` value as the Agent tool's `model` parameter"));
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

test('the needs-human stop carries the HARD-GATE marker and the presence branches', () => {
  assert.deepStrictEqual(gateProblems(subsection(readText(REVIEW_PATH), NEEDS_HUMAN)), []);
});

test('the build never runs release-claim.js — Settle steps 1-2 release the dispatched claim', () => {
  assert.ok(!readText(REVIEW_PATH).includes('release-claim.js'), 'plan-review.md must not run release-claim.js itself');
});

test('multi-spec presence read, parallel-wave member branch, readings, KEPT-PROMPT command', () => {
  const text = readText(REVIEW_PATH);
  assert.deepStrictEqual(finalProblems(subsection(text, NEEDS_HUMAN)), []);
  assert.deepStrictEqual(finalFileProblems(text), []);
});

test("subagent-dispatch-core's Template A Used-by line names /build's plan review", () => {
  const core = readText(path.join(ROOT, 'plugin', 'skills', '_shared', 'subagent-dispatch-core.md'));
  const usedBy = core.split('\n').filter((l) => l.startsWith('**Used by:** `/review` (review angles)'));
  assert.strictEqual(usedBy.length, 1, 'expected exactly one Template A Used-by line');
  assert.ok(usedBy[0].includes('`/build` (Common Step 1.6 plan review'), 'Template A Used-by line must name /build');
});

test('dispatched-only exit state, local-files comment skip, question-comment transport, literal body path', () => {
  const text = readText(REVIEW_PATH);
  assert.deepStrictEqual(fixProblems(text), []);
  assert.ok(!text.includes('eval "$('), 'the comment body path must be a literal, not an eval-set shell variable');
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
  const needsHuman = norm(subsection(text, NEEDS_HUMAN));
  const cases = [
    [stubProblems, stub, STUB_ANCHORS],
    [promptProblems, block, PROMPT_ANCHORS],
    [boundaryProblems, block, BOUNDARY_ANCHORS],
    [intentProblems, norm(intent), [...ORDER_ANCHORS, ...SECTION_ANCHORS]],
    [focusProblems, norm(text), FOCUS_ANCHORS],
    [gateProblems, needsHuman, GATE_ANCHORS],
    [fixProblems, norm(text), FIX_ANCHORS],
    [finalProblems, needsHuman, FINAL_ANCHORS],
    [finalFileProblems, norm(text), FINAL_FILE_ANCHORS],
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

// --- #5053 AC6: the waiting label and the two answer options ---
// Each fact is read from one line of the needs-human subsection, found by its own lead. The
// frozen control is the base bytes of those lines (`git show eaa89bea31:plugin/skills/build/plan-review.md`,
// lines 164-168), committed as tests/fixtures/plan-review-needs-human-base-5053.txt; every fact
// must fail on it, and stripping (or, for an absence fact, planting) one fact's literal in the
// live text must report exactly that fact.

const BASE_NEEDS_HUMAN = readText(path.join(ROOT, 'tests', 'fixtures', 'plan-review-needs-human-base-5053.txt'));
const AC6_LINES = {
  dispatched: '- **A dispatched call** (`dispatched: true`)',
  instruction: '  The closing instruction tells the human',
  headless: '  When `DISPATCH_HEADLESS=1` was set on this Task call',
  parallel: '- **A `parallel`-wave member**',
  exit: '- **Exit state (dispatched call)**',
};
// [line, 'has' | 'lacks', literal, fact]
const AC6_FACTS = [
  ['dispatched', 'has', 'Add `needs:answer`, headless or typed:', 'AC6.1 dispatched branch adds needs:answer in any posture'],
  ['dispatched', 'has', '`gh issue edit {n} --add-label needs:answer`', 'AC6.1 dispatched branch names the add-label call'],
  ['dispatched', 'has', "read-merge-write via `mergeLabelNames` (`bin/lib/issues/label-write.js`) per `_shared/github-write-transport.md`'s Full-replace hazard", 'AC6.1 dispatched branch read-merge-writes on MCP'],
  ['parallel', 'has', 'and add `needs:answer` the same way', 'AC6.1 parallel-wave branch adds needs:answer'],
  ['parallel', 'lacks', 'No label change', 'AC6.1 parallel-wave branch still says No label change'],
  ['headless', 'lacks', 'bot:blocked', 'AC6.2 headless branch names bot:blocked'],
  ['headless', 'lacks', 'remove whichever of', 'AC6.2 headless branch removes a grant'],
  ['headless', 'has', 'the `auto:*` grants stay', 'AC6.2 headless branch keeps the grants'],
  ['instruction', 'has', 'reply with a comment whose first line starts `/answer`', 'AC6.3 instruction names the /answer reply'],
  ['instruction', 'has', "the next bare `/claude-tweaks:dispatch` folds the reply into the record's body and resumes the build", 'AC6.3 instruction names the bare-drain fold'],
  ['instruction', 'has', "add a `**Decision**` paragraph (or an Acceptance Criterion) to the record's body and run `/claude-tweaks:dispatch resume #{n}`", 'AC6.3 instruction names the body Decision and dispatch resume'],
  ['dispatched', 'has', "the closing instruction's two answer options in the `BLOCKED` reply", 'AC6.3 BLOCKED reply carries both options'],
  ['exit', 'has', 'a `/answer` reply', 'AC6.3 exit state resumes on an /answer reply'],
  ['exit', 'has', '`/claude-tweaks:dispatch resume #{n}`', 'AC6.3 exit state names dispatch resume'],
  ['exit', 'lacks', 're-grant', 'AC6.3 exit state still re-grants'],
  ['exit', 'lacks', 'the next dispatch re-materializes', 'AC6.3 exit state still says the next dispatch re-materializes'],
];

// The line starting with `lead`, or '' when there is none (the base text has no instruction line).
const ac6Line = (text, lead) => text.split('\n').find((l) => l.startsWith(lead)) || '';

function ac6Problems(text, facts = AC6_FACTS) {
  return facts.filter(([key, kind, literal]) => {
    const line = norm(ac6Line(text, AC6_LINES[key]));
    return kind === 'has' ? !line.includes(literal) : line.includes(literal);
  }).map(([, , , fact]) => fact);
}

const ac6Facts = (prefix) => AC6_FACTS.filter(([, , , fact]) => fact.startsWith(prefix));
const needsHumanLive = () => subsection(readText(REVIEW_PATH), NEEDS_HUMAN);

test('AC6 lines: each branch line the pins read occurs exactly once in the live subsection', () => {
  const section = needsHumanLive();
  for (const lead of Object.values(AC6_LINES)) {
    assert.strictEqual(section.split('\n').filter((l) => l.startsWith(lead)).length, 1, `expected one line starting ${lead}`);
  }
});

test('AC6.1: the dispatched and parallel-wave branches add needs:answer', () => {
  assert.deepStrictEqual(ac6Problems(needsHumanLive(), ac6Facts('AC6.1')), []);
});

test('AC6.2: the headless branch adds no bot:blocked and removes no auto:* label', () => {
  assert.deepStrictEqual(ac6Problems(needsHumanLive(), ac6Facts('AC6.2')), []);
});

test('AC6.3: the question instruction names the /answer reply and /claude-tweaks:dispatch resume #{n}', () => {
  assert.deepStrictEqual(ac6Problems(needsHumanLive(), ac6Facts('AC6.3')), []);
});

test('AC6.4: each AC6 pin goes red on the frozen base excerpt', () => {
  assert.ok(BASE_NEEDS_HUMAN.includes('remove whichever of'), 'frozen base excerpt lost its headless grant removal');
  assert.deepStrictEqual(ac6Problems(BASE_NEEDS_HUMAN), AC6_FACTS.map(([, , , fact]) => fact));
});

test('AC6.4: each AC6 pin goes red alone when its literal is stripped from (or planted in) the live line', () => {
  const live = needsHumanLive();
  for (const [key, kind, literal, fact] of AC6_FACTS) {
    const line = ac6Line(live, AC6_LINES[key]);
    assert.ok(line, `no live line for ${key}`);
    let doctoredLine;
    if (kind === 'has') {
      assert.strictEqual(line.split(literal).length, 2, `"${literal}" must occur exactly once on the ${key} line`);
      doctoredLine = line.replace(literal, '');
    } else {
      doctoredLine = `${line} ${literal}`;
    }
    const doctored = live.replace(line, doctoredLine);
    assert.notStrictEqual(doctored, live, `doctoring changed nothing for ${fact}`);
    assert.deepStrictEqual(ac6Problems(doctored), [fact], `doctoring ${fact} did not surface exactly that fact`);
  }
});

// --- #6051: planning-decisions pointer and the asked-classes sub-file ---
// Under the default `ask-all`, plan-review.md must stay the base bytes: the frozen fixture is
// plan-review.md at 483adc1d58 (before the pointer landed) plus #6060's `## Skip logging` edits
// and #5053's `### Spec gap — needs-human` edits (the `needs:answer` label and the answer options),
// so stripping the marker-delimited pointer from the live file must give it back byte for byte.

const { missingFactsOf, assertEachPatternGoesRed } = require('./helpers/conformance-asserts');
const { classStatementSites } = require('./helpers/planning-decisions-clauses');

const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'plan-review-ask-all-6051.txt');
const SUB_REL = 'plugin/skills/build/plan-review-asked-classes.md';
const SUB_PATH = path.join(ROOT, SUB_REL);
const POINTER_START = '<!-- planning-decisions:start -->';
const POINTER_END = '<!-- planning-decisions:end -->\n\n';

function pointerBounds(text) {
  const start = text.indexOf(POINTER_START);
  const end = text.indexOf(POINTER_END);
  if (start === -1 || end === -1 || end < start) throw new Error('pointer markers missing');
  return [start, end + POINTER_END.length];
}

// Removes the pointer from its start marker through the end marker and the blank line after it.
function stripPointer(text) {
  const [start, end] = pointerBounds(text);
  return text.slice(0, start) + text.slice(end);
}

const pointerBlock = (text) => text.slice(...pointerBounds(text));

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const factsOf = (literals) => literals.map((l) => [new RegExp(escapeRe(l)), l]);

// Every fact holds on the live text, and stripping one fact's match reports exactly that fact
// (so each literal also matches exactly once in the region).
function assertFacts(text, literals) {
  const facts = factsOf(literals);
  const missing = missingFactsOf(facts);
  assert.deepStrictEqual(missing(text), []);
  assertEachPatternGoesRed(text, facts, missing);
}

const subText = () => norm(readText(SUB_PATH));

test('AC1.1/AC9.1: with the pointer removed, plan-review.md is byte-identical to the frozen ask-all fixture', () => {
  const live = readText(REVIEW_PATH);
  const fixture = readText(FIXTURE);
  assert.strictEqual(stripPointer(live), fixture);
  // Control: one character changed inside the `## Dispatch prompt` block breaks the identity.
  const at = live.indexOf('spec gap', live.indexOf('\n## Dispatch prompt'));
  assert.notStrictEqual(at, -1, 'control anchor missing from the Dispatch prompt block');
  const doctored = live.slice(0, at) + 'S' + live.slice(at + 1);
  assert.notStrictEqual(doctored, live);
  assert.notStrictEqual(stripPointer(doctored), fixture);
});

test('stripPointer throws when a marker is absent or the two are out of order', () => {
  const live = readText(REVIEW_PATH);
  const noStart = live.replace(POINTER_START, '');
  const noEnd = live.replace(POINTER_END, '');
  assert.notStrictEqual(noStart, live);
  assert.notStrictEqual(noEnd, live);
  assert.throws(() => stripPointer(noStart), { message: 'pointer markers missing' });
  assert.throws(() => stripPointer(noEnd), { message: 'pointer markers missing' });
  assert.throws(() => stripPointer(`${POINTER_END}x${POINTER_START}`), { message: 'pointer markers missing' });
});

test('AC5.2: the pointer cites _shared/planning-decisions.md and the sub-file and resolves planning-decisions once', () => {
  assertFacts(pointerBlock(readText(REVIEW_PATH)), [
    '--values planning-decisions',
    'plan-review-asked-classes.md',
    '_shared/planning-decisions.md',
    'Any other output, or a failed call, leaves this file as written.',
  ]);
});

test('AC2.1: under asked-classes a settled row writes Settled at planning, an AUTO line and a record comment, and asks nothing', () => {
  assertFacts(subText(), [
    'Settled at planning: {finding} — chose {reading}; not {other reading}',
    'under `## Planning Decisions`',
    '--step "Common Step 1.6 (plan review)"',
    'the record comment carries that line verbatim',
    'no `AskUserQuestion`, no question comment and no `failed: plan-review-needs-human`',
    'the settled line stands in for the Evidence quote',
    'judges only the chosen reading',
    'so a blocked call still leaves its settled lines committed',
    'list only the asked rows',
  ]);
});

test('AC7.1: settling holds in every mode and in a dispatched call', () => {
  assertFacts(subText(), [
    'in every mode — `auto`, `confirm`, `interactive` and `hybrid`',
    'when every needs-human row settles, the build continues to Common Step 1.7',
  ]);
});

test('AC3.1: an asked row reaches the needs-human HARD-GATE exactly as today, recommended reading first', () => {
  assertFacts(subText(), [
    '`### Spec gap — needs-human` HARD-GATE exactly as today',
    'the recommended reading first, labelled `(Recommended)`, then the other reading, then `Stop the build`',
  ]);
});

test('AC4.1: an unflagged category adds the flag through risk-flags.js add before asking, add never drop', () => {
  assertFacts(subText(), [
    'node "${CLAUDE_PLUGIN_ROOT}/bin/risk-flags.js" add --body-file "{worktree spec}" --add {slug} --repo-root "{worktree root}"',
    'before the question is asked',
    'Add, never drop',
    'A non-zero exit still asks the question',
  ]);
});

test('asked-classes retires the converged round and the Plan Review Clarifications heading only under asked-classes', () => {
  assertFacts(subText(), [
    '`### Converged round (#4958)` does not apply',
    'instead of `## Plan Review Clarifications`',
    'never asked again',
  ]);
});

// Fix round 1: the declared set follows the shared doubt rule's control-mode rule (the one
// risk-flags.js add reads extras by), a blocking branch commits settled rows and flag additions
// early while a present human's settled rows join the post-answer sequence, and a failed add
// writes no Proof line.
test('fix round 1: step 1 reads the declared categories by the doubt rule\'s control-mode rule, built-ins only on a failed read', () => {
  assertFacts(subText(), [
    'follow `## Doubt rule`\'s control-mode rule',
    'node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values control-mode`, and only when it prints `on`',
    'When either read fails or prints nothing, the declared set is the four built-ins only.',
  ]);
});

test('fix round 1: a present human\'s mixed reply joins the post-answer sequence; only blocking branches commit early', () => {
  assertFacts(subText(), [
    'With a present human, the settled rows wait for the answers and join `plan-review.md`\'s single post-answer amendment sequence',
    'Only the branches that block — a dispatched call and a `parallel`-wave member — commit early',
    'Every non-settled amendment row in those branches stays unapplied, as today.',
  ]);
});

// Fix round 2: the early commit's condition is settled rows OR flag additions, so an all-asked
// blocking reply with an unflagged class (b) row still commits its flag edit.
test('fix round 2: a blocking reply whose rows are all asked still commits step 3\'s flag addition early', () => {
  assertFacts(subText(), [
    'whenever they hold settled rows or step 3\'s flag additions',
    'A blocking reply whose rows are all asked still gets this commit when step 3 added a flag, holding only those flag edits and their `Proof` lines.',
  ]);
});

test('fix round 1: in a blocking branch the flag addition rides the early commit, and a failed add writes no Proof line', () => {
  assertFacts(subText(), [
    'the `add` edit and its `Proof({slug}):` plan line ride in step 5\'s early commit, before the question comment is posted.',
    'A failed `add` writes no `Proof` line.',
  ]);
});

// Fix wave (final review): a blocking branch's question comment carries the flag to the record
// body (the resumed run re-materializes the spec from it), an answered round adds a flag the
// answer left off, a flag-only early commit re-audits with no record comment, and a failed
// policy read logs a SKIP.
test('fix wave: a blocking branch\'s question comment asks the answerer to add the flag to the record body', () => {
  assertFacts(subText(), [
    'the question comment for each row step 3 flagged names `{slug}` and tells the answerer to add `{slug}` to the record body\'s `Risk-flags:` line along with their `**Decision**` paragraph',
  ]);
});

test('fix wave: an answered round still runs step 3\'s add, without asking, for a declared category the spec does not keep', () => {
  assertFacts(subText(), [
    'also runs step 3\'s `risk-flags.js add` without asking, and adds its `Proof({slug}):` plan line',
    'so an answer recorded without the flag still leaves the implementing build owing that flag\'s Check G proof',
  ]);
});

test('fix wave: a flag-only early commit still re-audits and posts no amendment record comment', () => {
  assertFacts(subText(), [
    'When no settled row exists, the re-audit (`plan-audit.js … --spec`) still runs on the amended pair, and no amendment record comment is posted, because the question comment carries the flag.',
  ]);
});

test('fix wave: a failed or empty policy read in step 1 logs one SKIP', () => {
  assertFacts(subText(), [
    'A failed or empty read logs one `SKIP`',
    'condition: {control-mode|risk-categories} read failed ({reason}) → fallback: declared categories are the four built-ins',
  ]);
});

// Targeted fix: a failed answered-round add never asks the row again, and answered-round rows
// ride a blocking branch's early commit as settled rows.
test('targeted fix: a failed step-2 add writes no Proof line, asks nothing and logs its own SKIP', () => {
  assertFacts(subText(), [
    'A failed `add` here writes no `Proof` line and asks nothing',
    'decision-text-{run-id}-planning-answered-flag-{k}.md',
    'condition: risk-flags.js add exited {code} ({stderr line}) on an answered row → fallback: answered row settled without the flag',
  ]);
});

test('targeted fix: answered-round rows count as settled rows for a blocking branch\'s early commit', () => {
  assertFacts(subText(), [
    'Answered-round rows (step 2) count as settled rows for this early commit: their `Decided by the user at planning:` lines and any step-2 flag edit with its `Proof` line ride it.',
  ]);
});

test('clarification: an answered-round row also gets step 4\'s AUTO line and record comment', () => {
  assertFacts(subText(), [
    'Each answered-round row also gets step 4\'s `AUTO` line and record comment: one `AUTO` per row through the same `--text-file "{text-file}"` form, `{text-file}` holding its `Decided by the user at planning:` line',
    'decision-text-{run-id}-planning-answered-{k}.md` prints, `{k}` numbering this reply\'s answered rows from 1',
    'and that line rides the same record comment',
  ]);
});

test('clarification: {k} in both flag tmp names numbers that step\'s flagged rows in this reply from 1', () => {
  assertFacts(subText(), [
    'decision-text-{run-id}-planning-flag-{k}.md` prints (`{k}` numbering this step\'s flagged rows in this reply from 1)',
    'decision-text-{run-id}-planning-answered-flag-{k}.md` prints (`{k}` numbering this step\'s answered rows flagged in this reply from 1)',
  ]);
});

test('AC5.1: the sub-file cites the shared rule rather than restating the classes', () => {
  const text = readText(SUB_PATH);
  assert.ok(text.includes('_shared/planning-decisions.md'), 'the sub-file must cite _shared/planning-decisions.md');
  assert.deepStrictEqual(classStatementSites(new Map([[SUB_REL, text]])), []);
  // Control: the same sweep finds a class clause restated in the sub-file.
  const restated = `${text}\nNo reading keeps every Acceptance Criterion and recorded decision intact.\n`;
  assert.deepStrictEqual(classStatementSites(new Map([[SUB_REL, restated]])), [SUB_REL]);
});
