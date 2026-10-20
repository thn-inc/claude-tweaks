// tests/plan-authoring-ac-evidence-prose.test.js — pins #3079's plan-authoring
// rule: plugin/skills/build/plan-authoring-checks.md tells plan authors that a
// task verifying an acceptance criterion only with a scratch (uncommitted)
// check names that check's run-dir evidence destination (an AC evidence entry
// in decisions.md, plus an always-written evidence/ log), never a
// conversational build handoff. Reads the live skill file. The paragraph is
// located by its bold label and every assertion runs on that paragraph alone.
// Both negative controls run the same assertion function the positive test
// runs and expect it to throw: one against the pre-change file shape
// (paragraph absent), one with the code-vs-result distinction reworded.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TEXT = fs.readFileSync(
  path.join(__dirname, '..', 'plugin', 'skills', 'build', 'plan-authoring-checks.md'),
  'utf8',
);

const LABEL = '**AC-evidence persistence check:**';
const KEY_PHRASE = "governs whether a check's *code* is committed, not whether its *result* is recorded";
const COMMAND =
  '`node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence"`';

function assertAcEvidenceCheck(text) {
  const hits = text.split(/\r?\n\r?\n/).filter((p) => p.startsWith(LABEL));
  assert.strictEqual(hits.length, 1, 'expected exactly one AC-evidence persistence check paragraph');
  const p = hits[0];
  assert.ok(p.includes('scratch (uncommitted) check'), 'names the scratch-check trigger');
  assert.ok(p.includes('never a conversational build handoff'), 'forbids a conversational build handoff');
  assert.ok(p.includes(COMMAND), 'names the log-decision.js command literal with step "AC evidence"');
  for (const item of ['the criterion it covers', 'the exact command shape', 'the pass/fail counts']) {
    assert.ok(p.includes(item), `entry carries: ${item}`);
  }
  assert.ok(p.includes('$PIPELINE_RUN_DIR/evidence/'), 'names the evidence/ log path');
  assert.ok(p.includes('cites that path in the same entry'), 'cites the evidence path in the same entry');
  assert.ok(p.includes('plain Bash redirect'), 'writes the log with a plain Bash redirect');
  assert.ok(p.includes('mkdir -p'), 'creates the evidence directory first');
  assert.ok(p.includes('single-quoted'), 'passes --text single-quoted');
  assert.ok(
    p.includes('contains a single quote closes the quoting, writes `\\\'`, and reopens it'),
    'covers a command shape that itself contains a single quote',
  );
  assert.ok(p.includes(KEY_PHRASE), 'separates the check code from its recorded result');
  assert.ok(p.includes('no run directory'), 'names the no-run-directory design-mode fallback');
  assert.ok(p.includes('review/code-mode-steps.md'), 'names the review consumer');
  assert.ok(p.includes('#3079'), 'cites #3079');
}

test('AC1.1 (#3079): plan-authoring-checks.md carries the AC-evidence persistence check', () => {
  assertAcEvidenceCheck(TEXT);
});

test('AC1.1 (#3079): negative control — the pre-change file (paragraph absent) fails the pin', () => {
  const preChange = TEXT.split(/\r?\n\r?\n/).filter((p) => !p.startsWith(LABEL)).join('\n\n');
  assert.notStrictEqual(preChange, TEXT, 'control must actually remove the paragraph');
  assert.throws(() => assertAcEvidenceCheck(preChange));
});

test('AC1.1 (#3079): negative control — rewording the code-vs-result distinction fails the pin', () => {
  const mutated = TEXT.replace(KEY_PHRASE, "governs both a check's code and its result");
  assert.notStrictEqual(mutated, TEXT, 'control must actually reword the phrase');
  assert.throws(() => assertAcEvidenceCheck(mutated));
});
