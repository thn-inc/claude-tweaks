// tests/pr-early-run-lifecycle-step1-logging-conformance.test.js — pins #1800's fix: Step 1
// of pr-early-run-lifecycle.md must log a `PR-early run lifecycle:` line on every outcome
// (no-match, reuse-open, reopen), not just the reopen path, so the bookkeeping-stamps gate's
// tightened #989 exemption (pre-tool-use.js's hasLoggedPrEarlyStep1) can tell "Step 1 ran and
// found nothing" from "Step 1 never ran" — the exact gap #903's stale-PR collision fell through.
// Also pins the two sibling log lines the same record adds: review/code-mode-steps.md's
// ledger-absence SKIP line, and flow/SKILL.md Step 1.8's ledger-creation log line.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LIFECYCLE_FILE = path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'pr-early-run-lifecycle.md');
const CODE_MODE_STEPS_FILE = path.join(__dirname, '..', 'plugin', 'skills', 'review', 'code-mode-steps.md');
const FLOW_SKILL_FILE = path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'SKILL.md');

const read = (file) => fs.readFileSync(file, 'utf8');

// Markdown source hand-wraps prose at ~90-100 columns, so a multi-word phrase can straddle a
// line break in the file even though it reads as one continuous phrase. Collapse all
// whitespace runs (including newlines) to a single space before matching so a wrap point never
// makes an otherwise-present phrase invisible to the regex — same helper as
// pr-early-run-lifecycle-degrade-warning-conformance.test.js.
const flatten = (s) => s.replace(/\s+/g, ' ');

test('pr-early-run-lifecycle.md Step 1 no-match outcome logs a PR-early run lifecycle line naming {branch}', () => {
  const text = flatten(read(LIFECYCLE_FILE));
  assert.match(text, /No match.*: fall through to creation/);
  assert.match(text, /PR-early run lifecycle: no existing PR for \{branch\}; creating\. Reversibility: n\/a\./);
});

test('pr-early-run-lifecycle.md Step 1 reuse-open outcome logs a PR-early run lifecycle line naming {branch}', () => {
  const text = flatten(read(LIFECYCLE_FILE));
  assert.match(text, /A match with `state: OPEN`/);
  assert.match(text, /PR-early run lifecycle: reusing open PR #\{number\} for \{branch\}\. Reversibility: high\./);
});

test('pr-early-run-lifecycle.md Step 1 reopen outcome logs a PR-early run lifecycle line naming {branch}, not just {number}', () => {
  const text = flatten(read(LIFECYCLE_FILE));
  assert.match(text, /Reopen succeeds:/);
  assert.match(text, /PR-early run lifecycle: reopened PR #\{number\} for \{branch\}/);
});

test('all three Step 1 outcome lines are documented as mandatory, referencing #1800', () => {
  const text = flatten(read(LIFECYCLE_FILE));
  const mandatoryCount = (text.match(/mandatory, not optional/g) || []).length;
  // Step 2's push-failure line and Step 3's gh-pr-create-failure line each already
  // carry their own "mandatory, not optional" language (pinned by
  // pr-early-run-lifecycle-degrade-warning-conformance.test.js) -- this record adds three
  // more (no-match, reuse-open, reopen), for five total in the file.
  assert.ok(mandatoryCount >= 5, `expected at least 5 "mandatory, not optional" occurrences, found ${mandatoryCount}`);
  assert.match(text, /#1800/);
});

test('review/code-mode-steps.md documents the ledger-absence SKIP line', () => {
  const text = flatten(read(CODE_MODE_STEPS_FILE));
  assert.match(text, /No ledger file found for the spec's `\{feature\}`/);
  assert.match(
    text,
    /SKIP \{time\} — review: no open-items ledger found for \{feature\} and no logged creation\/skip; QA entries could not be merged\. Reversibility: n\/a\./,
  );
  assert.match(text, /No open-items ledger found for this spec — QA entries could not be merged/);
});

test('flow/SKILL.md Step 1.8 documents the ledger-creation log line', () => {
  const text = flatten(read(FLOW_SKILL_FILE));
  assert.match(text, /Create the open items ledger/);
  assert.match(text, /AUTO \{time\} — flow: created open-items ledger \{path\}\. Reversibility: n\/a\./);
});

// --- Go-red proof: these checks can actually fail (per skill-prose-conformance-tests'
// go-red guidance) — reworked against a stripped-down synthetic copy of the prose shape. ---

test('go-red proof: a Step 1 no-match copy missing the log line fails the same assertion', () => {
  const withoutLine = flatten('- **No match**: fall through to creation.\n');
  assert.throws(() => assert.match(withoutLine, /PR-early run lifecycle: no existing PR for \{branch\}; creating\. Reversibility: n\/a\./));
});

test('go-red proof: a code-mode-steps.md copy missing the SKIP line fails the same assertion', () => {
  const withoutLine = flatten('### QA Ledger Check\n\nAfter confirming TEST_PASSED, read the ledger.\n');
  assert.throws(() => assert.match(
    withoutLine,
    /SKIP \{time\} — review: no open-items ledger found for \{feature\} and no logged creation\/skip; QA entries could not be merged\. Reversibility: n\/a\./,
  ));
});

test('go-red proof: a flow/SKILL.md copy missing the creation log line fails the same assertion', () => {
  const withoutLine = flatten('8. **Create the open items ledger** using /claude-tweaks:ledger\'s create operation.\n');
  assert.throws(() => assert.match(withoutLine, /AUTO \{time\} — flow: created open-items ledger \{path\}\. Reversibility: n\/a\./));
});
