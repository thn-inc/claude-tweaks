'use strict';
// Review Step 1 checks a deliverable that names the PR body against the live
// PR body, never the codebase; an unreadable body is unverifiable, not present.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed } = require('./helpers/conformance-asserts');

const STEPS = readText(path.join(__dirname, '..', 'plugin/skills/review/code-mode-steps.md'));

const FACTS = [
  [/\*\*PR-body deliverables\*\*/, 'item heading'],
  [/names the PR body \(or PR description\)/, 'PR body or PR description triggers the check'],
  [/against the live body of the run's PR, never the codebase/, 'evidence is the live PR body, not the codebase'],
  [/\(item 1 skips it\)/, 'item 6 replaces item 1 for these'],
  [/`gh pr view \{pr\} --json body`/, 'read command'],
  [/`mcp__github__pull_request_read` without `gh`/, 'gh-absent read'],
  [/`\{pr\}` is `pr\.number` in `run-state\.json` \(a bundle's parent run dir\), else the current branch's PR/, 'PR source, run, bundle and standalone'],
  [/Mark it `missing` when the body lacks it, `partial` when it carries part/, 'missing / partial verdicts'],
  [/no PR or a failed read is `unverifiable`, a partial gap, never present/, 'unreadable is unverifiable, not present, not a block'],
];

function step1(text) {
  const start = text.indexOf('## Step 1: Spec Compliance Check');
  const end = text.indexOf('### Gate:', start);
  assert.ok(start >= 0 && end > start, 'code-mode-steps.md must have Step 1 followed by its Gate table');
  return text.slice(start, end);
}

test('Step 1 states every PR-body fact', () => {
  assert.deepEqual(missingFactsOf(FACTS)(step1(STEPS)), []);
});

test('each PR-body fact can go red', () => {
  assertEachPatternGoesRed(step1(STEPS), FACTS, missingFactsOf(FACTS));
});

test('the PR-body item is read from Step 1, not file-wide', () => {
  const lines = STEPS.split('\n');
  const itemIdx = lines.findIndex((l) => l.includes('**PR-body deliverables**'));
  assert.ok(itemIdx >= 0, 'item 6 line must exist');
  const [item] = lines.splice(itemIdx, 1);
  const gateIdx = lines.findIndex((l, i) => i >= itemIdx && l.startsWith('### Gate:'));
  assert.ok(gateIdx > 0, 'Step 1 Gate heading must follow');
  lines.splice(gateIdx + 1, 0, item);
  const moved = lines.join('\n');
  assert.notEqual(moved, STEPS);
  assert.ok(moved.includes('**PR-body deliverables**'));
  assert.deepEqual(missingFactsOf(FACTS)(step1(moved)), FACTS.map(([, f]) => f));
});

const GATE_ROW = /\| Minor gaps \(1-2 partial or `unverifiable` items\) \|/;

function gateTable(text) {
  const start = text.indexOf('### Gate:', text.indexOf('## Step 1: Spec Compliance Check'));
  const end = text.indexOf('> **Why this is Step 1:**', start);
  assert.ok(start >= 0 && end > start, 'Step 1 Gate table must precede the Why-this-is-Step-1 note');
  return text.slice(start, end);
}

function assertGateCountsUnverifiable(text) {
  assert.match(gateTable(text), GATE_ROW, 'Gate Minor gaps row must count unverifiable items');
}

test('the Gate counts unverifiable as a minor gap', () => {
  assertGateCountsUnverifiable(STEPS);
  const old = STEPS.replace('| Minor gaps (1-2 partial or `unverifiable` items) |', '| Minor gaps (1-2 partial items) |');
  assert.notEqual(old, STEPS);
  assert.throws(() => assertGateCountsUnverifiable(old), /Gate Minor gaps row must count unverifiable items/);
});

test('grep for "PR body" names the check in Step 1', () => {
  const s = step1(STEPS);
  const hits = STEPS.split('\n').filter((l) => /PR body/i.test(l));
  assert.ok(hits.some((l) => s.includes(l) && l.includes('PR-body deliverables')));
});
