'use strict';
// #4958: plan review converges after one answered needs-human round. Read live —
// just-shipped prose; go-red controls mutate the live text in memory, and the
// gate sentence is checked against the frozen pre-change excerpt.
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
const FROZEN_PROMPT = readText(path.join(__dirname, 'fixtures', 'plan-review-dispatch-prompt-4958.txt'));

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
  'Decided by the user at plan review:',
  'counts as **not converged**',
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

test('AC1.1: a converged round is defined by exactly the two signals, and a failed comment read is not converged', () => {
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
  // go-red: the same check fails once the sentence is removed from the gate subsection in memory.
  assert.ok(REVIEW.includes(GATE_SENTENCE), 'control precondition: the sentence is in the live text verbatim');
  assert.ok(!gateSaysSurvivingOnly(REVIEW.split(GATE_SENTENCE).join('')));
});

test('AC4.1: the Converged round subsection sits after the plan-amendment subsection and before the needs-human gate', () => {
  const amend = REVIEW.indexOf('\n### Undecided behaviour');
  const converged = REVIEW.indexOf('\n' + CONVERGED + '\n');
  const gate = REVIEW.indexOf('\n' + NEEDS_HUMAN + '\n');
  assert.ok(amend !== -1 && converged !== -1 && gate !== -1);
  assert.ok(amend < converged && converged < gate);
});

test('AC5.1: the reviewer Dispatch prompt block is byte-identical to origin/main', () => {
  assert.ok(FROZEN_PROMPT.length > 1000);
  assert.strictEqual(dispatchBlock(REVIEW), FROZEN_PROMPT);
});

test('AC7.1 go-red: each anchor set fails when one anchor is removed, and a one-byte prompt edit breaks AC5.1', () => {
  const sub = norm(subsection(REVIEW, CONVERGED));
  for (const set of [SIGNAL_ANCHORS, RULE_ANCHORS, TRAIL_ANCHORS]) {
    for (const anchor of set) {
      const doctored = sub.split(anchor).join('removed');
      assert.notDeepStrictEqual(problems(set, doctored), [], `removing "${anchor}" must fail`);
    }
  }
  assert.notStrictEqual(dispatchBlock(REVIEW).replace('spec gap', 'spec-gap'), FROZEN_PROMPT);
});

test('plan-review.md stays within the rail', () => {
  assert.ok(Buffer.byteLength(REVIEW) <= RAIL_BYTES);
});

const CLOSED_RULE_SENTENCE = "The rule still matters on a record's first plan-review round; after one answered round, later rounds converge under `build/plan-review.md`'s convergence rule anyway, which treats a Closed rule as a recorded decision.";
const CONTRACT_QUALIFIER = 'plan-review needs-human spec gap (`build/plan-review.md`, #3377; after one answered round, only a gap contradicting a criterion or recorded decision, #4958)';

function closedRuleSection(text) {
  const start = text.indexOf('## State-Classification Deliverables\n');
  assert.notStrictEqual(start, -1);
  return text.slice(start, text.indexOf('\n## ', start));
}
const contractRow = () => CONTRACT.split('\n').find((l) => l.startsWith('| HARD-GATE / BLOCKED / STOP conditions'));

test('AC6.1: the Closed rule section names the convergence rule', () => {
  const section = closedRuleSection(TEMPLATE);
  assert.ok(norm(section).includes(CLOSED_RULE_SENTENCE));
  // go-red: the same check fails on the section with the sentence removed.
  assert.ok(!norm(section).split(CLOSED_RULE_SENTENCE).join('').includes(CLOSED_RULE_SENTENCE));
});

test('the HARD-GATE row limits the plan-review gate to first rounds and converged-round contradictions', () => {
  assert.ok(contractRow().includes(CONTRACT_QUALIFIER));
  // go-red: the qualifier fails once the record tag is removed.
  assert.ok(!contractRow().replace('#4958', '').includes(CONTRACT_QUALIFIER));
});

test('auto-mode-contract.md stays within the rail', () => {
  assert.ok(Buffer.byteLength(CONTRACT) <= RAIL_BYTES);
});
