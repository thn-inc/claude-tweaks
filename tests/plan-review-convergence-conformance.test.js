'use strict';
// #4958: plan review converges after one answered needs-human round. Read live —
// just-shipped prose; each go-red control runs the same check over the bytes the
// change replaced, frozen below as string literals (never a read of history).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const norm = (t) => t.replace(/\s+/g, ' ');
const REVIEW = read('plugin', 'skills', 'build', 'plan-review.md');
const TEMPLATE = read('plugin', 'skills', 'specify', 'spec-template.md');
const CONTRACT = read('plugin', 'skills', '_shared', 'auto-mode-contract.md');
// readText, never a raw fs read: tests/raw-markdown-read-conformance.test.js (#3922) forbids
// raw text-mode reads, and readText's CRLF normalization keeps AC5.1 green on a Windows checkout.
// A deliberate reviewer-prompt change regenerates this fixture from the new block (same slicing as dispatchBlock) in the same commit.
const FROZEN_PROMPT = readText(path.join(__dirname, 'fixtures', 'plan-review-dispatch-prompt-4958.txt'));

// Pre-change bytes, copied from `git show 7a2152c9c:<path>` (origin/main before #4958).
// plugin/skills/build/plan-review.md: the `### Undecided behaviour …` subsection, adjacent to
// `### Spec gap — needs-human` and its opening paragraph — no Converged subsection between.
const FROZEN_BOUNDARY = "\n### Undecided behaviour, cross-task contract, missing-review-risk, mischaracterized-role\n\nAmend the plan file — a task step, a test, an Interfaces line, or (for the two #3378 classes) the task's own `**Review risk:** high` line (add it) or `**Role:**` line (correct it to `integration` or `judgment` per the finding's Evidence) — commit, log the same `AUTO` entry, and re-run `plan-audit.js` once as above (pass `--task-markers` too when either #3378 class fired, so the corrected markers are confirmed before dispatch). When a spec-gap amendment also exists, these share its single commit, log line, and audit re-run. No record comment: the plan is not the record's contract.\n\n### Spec gap — needs-human\n\nThe HARD-GATE: this plan-review needs-human spec gap is registered in `_shared/auto-mode-contract.md`'s HARD-GATE / BLOCKED / STOP row — a deliberate stop before Task 1 that `auto` never silences. Every needs-human finding in the reply is handled together, as one question set. Branch on whether this session can ask — it cannot when the call is dispatched or is a `parallel`-wave member, and **it cannot whenever `AskUserQuestion` is not a tool this session holds** (a Task subagent has none): that session takes the dispatched-call branch below even when the `run-state.json` read below came back empty, because an unreadable marker must not send a subagent to a question it cannot ask. A dispatched Task call is identified the way `flow/SKILL.md` Step 1 rung 2 identifies it — `run-state.json` carrying `dispatched: true` (that rung's fail-open read) — read from `${MULTISPEC_PARENT_DIR:-$PIPELINE_RUN_DIR}/run-state.json`: in a multi-spec run `$PIPELINE_RUN_DIR` is the per-spec `{parent}/spec-{N}/`, which holds no `run-state.json`, and `MULTISPEC_PARENT_DIR` is the parent run directory `/flow` exports (`flow/multi-spec.md`). A `parallel`-wave member carries `MULTISPEC_PARALLEL_WAVE=1` and always runs inside an `Agent` subagent (`flow/multispec-parallel-waves.md`).";
// plugin/skills/specify/spec-template.md: the State-Classification paragraph the Closed-rule sentence extends.
const FROZEN_CLOSED_RULE_PARAGRAPH = "Without it, every state the list leaves out is a gap whose settlement alters an observable contract, which `build/plan-review.md` classifies `needs-human` — so each review pass finds new ones and stops the build. #4588's eligibility verdict stopped four times on the `plan-review-needs-human` HARD-GATE until its spec added this rule; the next pass applied it to a newly found state and the build proceeded.";
// plugin/skills/_shared/auto-mode-contract.md: the HARD-GATE row's plan-review entry, before its qualifier.
const FROZEN_CONTRACT_FRAGMENT = "plan-review needs-human spec gap (`build/plan-review.md`, #3377):";

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

const CONVERGED = '### Converged round (#4958)';
const NEEDS_HUMAN = '### Spec gap — needs-human';
const problems = (anchors, text) => anchors.filter((a) => !norm(text).includes(a));

const SIGNAL_ANCHORS = [
  'trusted `<!-- plan-review-question -->` comment',
  "the record's body was edited after the newest such comment",
  "`lastEditedAt` is later than that comment's `createdAt`",
  'lastEditedAt comments(last:100){nodes{body authorAssociation createdAt url}}',
  'whose body starts with that marker and whose `authorAssociation` is trusted',
  "Trusted authors — `OWNER`, `MEMBER`, `COLLABORATOR`)",
  'Decided by the user at plan review:',
  'counts as **not converged**',
  'A missing `lastEditedAt`, or a failed or unreadable read, counts as **not converged**',
  'When `gh` is absent this signal reads as not converged',
  'Under `work-backend: local-files` only the spec-line signal applies',
];
const RULE_ANCHORS = [
  'stays needs-human only when settling it would alter or loosen an existing Acceptance Criterion, or contradict a recorded decision, under every available reading',
  'a `**Decision**` paragraph in the spec, or a Closed rule',
  'one the promotion rule in Reading the reply marked',
  'never asked',
  'the reading that keeps the criterion as written',
  'Among the readings that keep every existing Acceptance Criterion and recorded decision intact',
  'through the intent-resolvable sequence above',
  'blocks, nothing is applied, settled rows included',
  'logs no `AUTO` entry for a settled row, and the question comment lists only the surviving rows',
];
const TRAIL_ANCHORS = [
  'Settled by plan review after an answered round:',
  'names the reading not taken',
  '--status AUTO',
  '--text-file "{text-file}"',
  'settled after an answered round: {finding} — chose {reading taken}; not {reading not taken}',
  '--reversibility high',
  '### Plan review amendments (standalone build, if any)',
  "`{k}` numbers this reply's settled rows from 1",
  'so a settled row is logged twice: once in that count and once on its own line',
];
const FIRST_ROUND = '**On a first round** (neither signal), routing is unchanged: every needs-human row reaches the HARD-GATE below.';
const GATE_SENTENCE = 'In a converged round, only the rows that survive the convergence rule above reach this gate; on a first round every needs-human row does.';
const READING_QUALIFIER = 'In a converged round, only a row that survives the convergence rule reaches it (`### Converged round (#4958)` below).';

const gateSaysSurvivingOnly = (text) => norm(subsection(text, NEEDS_HUMAN)).includes(GATE_SENTENCE);

// The Converged round subsection sits after the plan-amendment subsection and before the gate.
function convergedBetween(text) {
  const amend = text.indexOf('\n### Undecided behaviour');
  const converged = text.indexOf('\n' + CONVERGED + '\n');
  const gate = text.indexOf('\n' + NEEDS_HUMAN + '\n');
  return amend !== -1 && converged !== -1 && gate !== -1 && amend < converged && converged < gate;
}

test('AC1.1: a converged round is defined by exactly the two signals, and a missing edit time or failed read is not converged', () => {
  assert.deepStrictEqual(problems(SIGNAL_ANCHORS, subsection(REVIEW, CONVERGED)), []);
});

test('AC2.1, AC2.2: in a converged round only a criterion or recorded-decision conflict stays needs-human; the rest are settled, never asked', () => {
  assert.deepStrictEqual(problems(RULE_ANCHORS, subsection(REVIEW, CONVERGED)), []);
});

test('AC3.1: a settled row carries the attribution, names the reading not taken, and logs one AUTO entry (or a handoff line standalone)', () => {
  assert.deepStrictEqual(problems(TRAIL_ANCHORS, subsection(REVIEW, CONVERGED)), []);
});

test('AC4.1: a first round routes unchanged, and the gate and Reading the reply say only surviving rows reach it', () => {
  assert.ok(norm(subsection(REVIEW, CONVERGED)).includes(FIRST_ROUND));
  assert.ok(gateSaysSurvivingOnly(REVIEW));
  assert.ok(norm(REVIEW).includes(READING_QUALIFIER));
  // go-red: the same check fails on the pre-change gate paragraph, which carries the
  // heading and the sentences around the new one.
  assert.ok(!gateSaysSurvivingOnly(FROZEN_BOUNDARY));
});

test('AC4.1: the Converged round subsection sits after the plan-amendment subsection and before the needs-human gate', () => {
  assert.ok(convergedBetween(REVIEW));
  // go-red: the pre-change boundary has the two headings adjacent.
  assert.ok(!convergedBetween(FROZEN_BOUNDARY));
  // go-red (order, not presence): the live text with the Converged subsection moved above
  // the plan-amendment subsection.
  const block = subsection(REVIEW, CONVERGED);
  const without = REVIEW.replace(block, '');
  const permuted = without.replace('\n### Undecided behaviour', '\n' + block + '### Undecided behaviour');
  assert.notStrictEqual(permuted, REVIEW);
  assert.ok(permuted.includes('\n' + CONVERGED + '\n'));
  assert.ok(!convergedBetween(permuted));
});

test('AC5.1: the reviewer Dispatch prompt block is byte-identical to origin/main', () => {
  assert.ok(FROZEN_PROMPT.length > 1000);
  assert.strictEqual(dispatchBlock(REVIEW), FROZEN_PROMPT);
});

test('AC7.1 go-red: each anchor set fails on the pre-change boundary, and a one-byte prompt edit breaks AC5.1', () => {
  for (const set of [SIGNAL_ANCHORS, RULE_ANCHORS, TRAIL_ANCHORS]) {
    assert.deepStrictEqual(problems(set, FROZEN_BOUNDARY), set);
  }
  assert.notStrictEqual(dispatchBlock(REVIEW).replace('spec gap', 'spec-gap'), FROZEN_PROMPT);
});

test('plan-review.md stays within the rail', () => {
  assert.ok(Buffer.byteLength(REVIEW) <= RAIL_BYTES);
});

const CLOSED_RULE_SENTENCE = "The rule still matters on a record's first plan-review round; after one answered round, later rounds converge under `build/plan-review.md`'s convergence rule anyway, which treats a Closed rule as a recorded decision.";
const CONTRACT_QUALIFIER = 'plan-review needs-human spec gap (`build/plan-review.md`, #3377; after one answered round, only a gap no reading settles without altering a criterion or contradicting a recorded decision, #4958)';

function closedRuleSection(text) {
  const start = text.indexOf('## State-Classification Deliverables\n');
  assert.notStrictEqual(start, -1);
  return text.slice(start, text.indexOf('\n## ', start));
}
const contractRow = () => CONTRACT.split('\n').find((l) => l.startsWith('| HARD-GATE / BLOCKED / STOP conditions'));
const namesConvergence = (text) => norm(text).includes(CLOSED_RULE_SENTENCE);
const qualifiesGate = (text) => text.includes(CONTRACT_QUALIFIER);

test('AC6.1: the Closed rule section names the convergence rule', () => {
  assert.ok(namesConvergence(closedRuleSection(TEMPLATE)));
  // go-red: the same check fails on the pre-change paragraph the sentence extends.
  assert.ok(!namesConvergence(FROZEN_CLOSED_RULE_PARAGRAPH));
});

test('the HARD-GATE row limits the plan-review gate to first rounds and converged-round contradictions', () => {
  assert.ok(qualifiesGate(contractRow()));
  // go-red: the same check fails on the pre-change row fragment, which carries the entry without its qualifier.
  assert.ok(!qualifiesGate(FROZEN_CONTRACT_FRAGMENT));
});

test('auto-mode-contract.md stays within the rail', () => {
  assert.ok(Buffer.byteLength(CONTRACT) <= RAIL_BYTES);
});
