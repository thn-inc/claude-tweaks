// tests/flow-cleanup-only-conformance.test.js — #298: pins both halves of the `cleanup-only`
// fix so either regressing independently fails a test. Live-reads the two prose files rather
// than a frozen fixture — both are current, actively-maintained skill docs, not historical
// snapshots — per the skill-prose-conformance-tests convention.
//
// #1766 extended this: two-call-gate.md §5's teardown command no longer routes through
// `/claude-tweaks:flow` at all -- it calls `/claude-tweaks:wrap-up {target} cleanup-only`
// directly, because `/flow` Step 1.5's materialize hard gate runs unconditionally, before
// Step 5's ledger gate this file's `cleanup-only` exception was originally built to skip, and
// has no matching `cleanup-only` exception of its own. Routing a materialize-gate-originated
// failure's teardown through `/flow` reproduced the identical STOP instead of reaching
// cleanup. The tests below pin the direct-call literal and the rationale text explaining why.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const TWO_CALL_GATE = readText(path.join(__dirname, '..', 'plugin', 'skills', 'dispatch', 'two-call-gate.md'));
const STEPS_AND_GATES = readText(path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'steps-and-gates.md'));
const TASK_PROMPT = readText(path.join(__dirname, '..', 'plugin', 'skills', 'dispatch', 'task-prompt.md'));

test('two-call-gate.md §5\'s teardown command literal invokes wrap-up directly, not via /flow', () => {
  assert.match(
    TWO_CALL_GATE,
    /PIPELINE_RUN_DIR="\{run-dir\}" CLAIM_RUN_ID="\{RUN_ID\}" \/claude-tweaks:wrap-up \{target\} cleanup-only/,
  );
});

test('two-call-gate.md\'s fenced command block no longer routes through /claude-tweaks:flow (#1766)', () => {
  const fenced = TWO_CALL_GATE.match(/```[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/);
  assert.ok(fenced, 'two-call-gate.md must have a fenced teardown-command block');
  assert.doesNotMatch(
    fenced[1],
    /\/claude-tweaks:flow/,
    'the literal teardown invocation must not route through /flow -- Step 1.5\'s materialize gate has no cleanup-only exception',
  );
  assert.match(fenced[1], /\/claude-tweaks:wrap-up \{target\} cleanup-only/);
});

test('two-call-gate.md names #1766 and the materialize-gate rationale for the direct call', () => {
  assert.match(TWO_CALL_GATE, /#1766/);
  assert.match(TWO_CALL_GATE, /materialize/i);
});

test('two-call-gate.md no longer narrates the ledger-gate stall as an open, accepted risk', () => {
  assert.strictEqual((TWO_CALL_GATE.match(/Accepted, tracked risk/g) || []).length, 0);
});

test('task-prompt.md\'s two teardown-call references also invoke wrap-up directly, not via /flow', () => {
  assert.strictEqual(
    (TASK_PROMPT.match(/\/claude-tweaks:flow \{target\} wrap-up cleanup-only/g) || []).length,
    0,
  );
  assert.match(TASK_PROMPT, /\/claude-tweaks:wrap-up \{target\}\s*\n?\s*cleanup-only/);
});

test("steps-and-gates.md's Partial step lists section names the cleanup-only skip condition", () => {
  assert.match(
    STEPS_AND_GATES,
    /`cleanup-only` produces this same branch even when `wrap-up` IS in the step list/,
  );
  assert.match(STEPS_AND_GATES, /render the identical `## Flow: Steps Complete` note/);
});

test("steps-and-gates.md documents why dispatch's teardown call moved off /flow (#1766)", () => {
  assert.match(STEPS_AND_GATES, /#1766/);
  assert.match(STEPS_AND_GATES, /materialize gate/i);
});

test("flow/SKILL.md's cleanup-only row documents the Step 1.5 materialize-gate exemption gap", () => {
  const FLOW_SKILL = readText(path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'SKILL.md'));
  assert.match(FLOW_SKILL, /Does not exempt Step 1\.5/);
  assert.match(FLOW_SKILL, /#1766/);
});
