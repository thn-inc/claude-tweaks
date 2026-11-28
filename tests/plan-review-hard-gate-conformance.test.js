'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');
const { ASKED_CLASSES_TEXT } = require('./helpers/planning-decisions-clauses');
// #3377: /build Common Step 1.6 (build/plan-review.md) adds a HARD-GATE — a
// plan-review needs-human spec gap stops before Task 1 in every mode. A
// HARD-GATE `auto` never silences must be registered in the contract's
// HARD-GATE / BLOCKED / STOP row, and every file that restates that row's
// gate families must name it too, or the restatement reads as the complete
// list and the new stop looks like an invented mid-flow stop. Read live: the
// row grows with every registered gate.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const CONTRACT = path.join('plugin', 'skills', '_shared', 'auto-mode-contract.md');
const CARD = path.join('plugin', 'skills', '_shared', 'auto-mode-card.md');
const ROSTER = path.join('plugin', 'skills', '_shared', 'ceremony-profile.md');
const CONSUMERS = [CARD, ROSTER, 'CLAUDE.md'];
const PHRASE = 'plan-review needs-human spec gap';

const ANCHORS = [
  '`build/plan-review.md`',
  PHRASE,
  'in every mode',
  'DISPATCH_HEADLESS=1',
  // #5053 D3: the stop waits on `needs:answer` and keeps the grants, in any posture
  'adds `needs:answer`, keeping every `auto:*` grant',
  'claim is released',
  'worktree and draft PR are left in place',
  // anchored on the report, not the bare word: the row's own name carries BLOCKED
  'reports `BLOCKED`',
  // the two answer paths: a reply the bare drain folds in, or a body Decision and a typed resume
  'a reply on the question comment',
  '/claude-tweaks:dispatch resume #{n}',
  // Settle releases the dispatched claim; a parallel-wave
  // member reports to its orchestrator
  "Settle steps 1-2, never by the build",
  '`parallel`-wave member reports `hard-gate-failed`',
  'the grants were never removed',
];

function rowProblems(row) {
  return ANCHORS.filter((a) => !row.includes(a));
}

// The plan-review clauses #5053 retired from the row, frozen from eaa89bea31's row.
const RETIRED_ROW_CLAUSES = [
  'the record goes `bot:blocked` with the question posted on it',
  'every `auto:*` grant removed',
  're-grants `auto:build` at `/claude-tweaks:backlog refine` when the headless block removed it',
];
const FROZEN_ROW_FRAGMENT = "when `DISPATCH_HEADLESS=1`, the record goes `bot:blocked` with the question posted on it (issue comment, `bot:blocked`, every `auto:*` grant removed — the transport `/claude-tweaks:dispatch` uses for blocked records, without the retry-ceiling count). Exit state (dispatched call): … resume: a human answers on the record, re-grants `auto:build` at `/claude-tweaks:backlog refine` when the headless block removed it, and the next dispatch re-materializes from the answered record.";
const retiredClauses = (row) => RETIRED_ROW_CLAUSES.filter((c) => row.includes(c));

test('#5053: the HARD-GATE row no longer blocks a headless plan-review stop or asks for a re-grant', () => {
  assert.deepStrictEqual(retiredClauses(contractRow()), []);
  // go-red: the frozen pre-change fragment carries every retired clause.
  assert.deepStrictEqual(retiredClauses(FROZEN_ROW_FRAGMENT), RETIRED_ROW_CLAUSES);
});

function contractRow() {
  const rows = read(CONTRACT).split('\n').filter((l) => l.startsWith('| HARD-GATE / BLOCKED / STOP conditions'));
  assert.strictEqual(rows.length, 1, 'expected exactly one HARD-GATE / BLOCKED / STOP row');
  return rows[0];
}

function walkMarkdown(rel, skip) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const child = path.join(rel, entry.name);
    if (skip(child)) continue;
    if (entry.isDirectory()) out.push(...walkMarkdown(child, skip));
    else if (entry.name.endsWith('.md')) out.push(child);
  }
  return out;
}

test('AC5.1: the contract\'s HARD-GATE row names the plan-review needs-human spec gap, both behaviours, the exit state and the resume path', () => {
  assert.deepStrictEqual(rowProblems(contractRow()), []);
});

test('AC5.2: every consumer that restates the HARD-GATE families cites the new gate', () => {
  for (const file of CONSUMERS) {
    const lines = read(file).split('\n').filter((l) => l.includes('plan validation'));
    assert.ok(lines.length > 0, `${file}: no line restates the HARD-GATE families (no "plan validation")`);
    for (const line of lines) {
      assert.ok(line.includes(PHRASE), `${file}: the HARD-GATE restatement does not cite "${PHRASE}": ${line}`);
    }
  }
});

test('AC5.2: the consumer list is complete', () => {
  // docs/superpowers (plans/specs) and docs/plans (run ledgers) are pipeline
  // working state that quotes contract text, not consumers that restate it.
  const skipped = new Set([path.join('docs', 'superpowers'), path.join('docs', 'plans')]);
  const files = [
    ...walkMarkdown('plugin', () => false),
    ...walkMarkdown('docs', (p) => skipped.has(p)),
    'CLAUDE.md',
    'README.md',
  ];
  const known = new Set([CONTRACT, ...CONSUMERS]);
  const restating = files.filter((f) => read(f).split('\n')
    .some((l) => l.includes('plan validation') || l.includes('plan-audit hard-fail')));
  assert.ok(restating.length >= known.size, 'the walk found fewer restating files than the known set');
  for (const f of restating) {
    assert.ok(known.has(f), `${f} restates the HARD-GATE families but is not a pinned consumer — cite "${PHRASE}" there and add it to CONSUMERS`);
  }
});

// The bare clause text is what the pin matches; the full clause adds the `; ` separator, so the control can cut it whole.
const ASKED_CLASSES_CLAUSE = `; ${ASKED_CLASSES_TEXT}`;
const NARROWING_MSG = 'the HARD-GATE row lacks the asked-classes narrowing clause (#6051)';
const narrowsUnderAskedClasses = (row) => row.includes(ASKED_CLASSES_TEXT);

test('the HARD-GATE row narrows the plan-review gate under asked-classes by pointing at _shared/planning-decisions.md (#6051)', () => {
  assert.ok(narrowsUnderAskedClasses(contractRow()), NARROWING_MSG);
  // control: the row with the clause removed fails the same assertion with its own message.
  const doctored = contractRow().split(ASKED_CLASSES_CLAUSE).join(')');
  assert.throws(() => assert.ok(narrowsUnderAskedClasses(doctored), NARROWING_MSG), { message: NARROWING_MSG });
});

test('go-red: rowProblems flags each removed anchor', () => {
  const row = contractRow();
  for (const anchor of ANCHORS) {
    const doctored = row.split(anchor).join('');
    assert.deepStrictEqual(rowProblems(doctored), [anchor], `removing ${anchor} was not flagged alone`);
  }
});

test('grown _shared files stay within the rail', () => {
  for (const file of [CONTRACT, CARD, ROSTER]) {
    const bytes = Buffer.byteLength(read(file), 'utf8');
    assert.ok(bytes <= RAIL_BYTES, `${file} is ${bytes} B, over the ${RAIL_BYTES} B rail`);
  }
});
