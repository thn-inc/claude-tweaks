'use strict';
// Review Step 1 judges a deliverable whose content must appear in the PR body against the live
// PR body, never the codebase; an unreadable body is unverifiable, not present and never a block.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed } = require('./helpers/conformance-asserts');

const STEPS = readText(path.join(__dirname, '..', 'plugin/skills/review/code-mode-steps.md'));
const SUBFILE = readText(path.join(__dirname, '..', 'plugin/skills/review/pr-body-deliverables.md'));

const FACTS = [
  [/\*\*PR-body deliverables\*\*/, 'item heading'],
  [/whose content must appear in the PR body \(or PR description\), such as "the PR body reports X"/, 'trigger is required body content'],
  [/judged against the live PR body, never the codebase, per `pr-body-deliverables\.md` in this skill's directory/, 'evidence source and sub-file'],
  [/items 1 and 2 skip it/, 'items 1 and 2 defer to item 6'],
  [/Mark it `missing` when the body lacks it, `partial` when it carries part/, 'missing / partial verdicts'],
  [/no PR or a failed read is `unverifiable`, which never blocks/, 'unverifiable never blocks'],
];

const SUB_FACTS = [
  [/does not qualify, however often it says "PR body": items 1 and 2 judge it in the codebase/, 'code-deliverable exclusion'],
  [/`pr\.number` in `run-state\.json` \(a bundle's parent run dir\)/, 'PR source'],
  [/`gh pr view --json number` with no number/, 'no-number gh lookup'],
  [/`mcp__github__list_pull_requests` \(open PRs\) filtered to the one whose head is the current branch/, 'gh-absent lookup'],
  [/`gh pr view \{pr\} --json body -q \.body`, or, without `gh`, `mcp__github__pull_request_read` \(`get`\)/, 'body read'],
  [/- `done` — the body carries everything the item requires/, 'done verdict'],
  [/- `partial` — it carries part of it/, 'partial verdict'],
  [/- `missing` — the body was read and lacks it/, 'missing verdict'],
  [/- `unverifiable` — no PR was found, or the read failed/, 'unverifiable verdict'],
  [/never counted as present and never blocks/, 'unverifiable never blocks'],
  [/A build decision line claiming the body carries the item is not evidence; only the body is/, 'decision line is not evidence'],
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

const GATE_ROW = /\| Minor gaps \(1-2 partial items, or any `unverifiable` ones\) \|/;

function gateTable(text) {
  const start = text.indexOf('### Gate:', text.indexOf('## Step 1: Spec Compliance Check'));
  const end = text.indexOf('> **Why this is Step 1:**', start);
  assert.ok(start >= 0 && end > start, 'Step 1 Gate table must precede the Why-this-is-Step-1 note');
  return text.slice(start, end);
}

function assertGateCountsUnverifiable(text) {
  assert.match(gateTable(text), GATE_ROW, 'Gate Minor gaps row must count unverifiable items');
}

test('the Gate counts any unverifiable item as a minor gap', () => {
  assertGateCountsUnverifiable(STEPS);
  const old = STEPS.replace('| Minor gaps (1-2 partial items, or any `unverifiable` ones) |', '| Minor gaps (1-2 partial or `unverifiable` items) |');
  assert.notEqual(old, STEPS);
  assert.throws(() => assertGateCountsUnverifiable(old), /Gate Minor gaps row must count unverifiable items/);
});

test('grep for "PR body" names the check in Step 1', () => {
  const s = step1(STEPS);
  const hits = STEPS.split('\n').filter((l) => /PR body/i.test(l));
  assert.ok(hits.some((l) => s.includes(l) && l.includes('PR-body deliverables')));
});

test('the pr-body-deliverables sub-file states every fact', () => {
  assert.deepEqual(missingFactsOf(SUB_FACTS)(SUBFILE), []);
});

test('each sub-file fact can go red', () => {
  assertEachPatternGoesRed(SUBFILE, SUB_FACTS, missingFactsOf(SUB_FACTS));
});
