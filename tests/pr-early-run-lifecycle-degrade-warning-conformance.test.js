// tests/pr-early-run-lifecycle-degrade-warning-conformance.test.js — pins #838's fix: a
// `pr-first` build whose initial push (Step 2) or draft-PR-open (Step 3) fails must always
// write a degrade-warning line to decisions.md, and a transient-looking (5xx/timeout) failure
// gets one bounded retry before that degrade path is reached. Run `2026-08-17T164729-record-81`
// left `run-state.json` with no `pr` object and no warning line at all — this suite freezes the
// corrected prose so that gap can't silently reopen.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const FILE = path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'pr-early-run-lifecycle.md');
const read = () => readText(FILE);

function step(text, heading) {
  const start = text.indexOf(heading);
  assert.ok(start !== -1, `heading not found: ${heading}`);
  const next = text.indexOf('\n### ', start + heading.length);
  return next === -1 ? text.slice(start) : text.slice(start, next);
}

// Markdown source hand-wraps prose at ~90-100 columns, so a multi-word phrase can straddle a
// line break in the file even though it reads as one continuous phrase. Collapse all
// whitespace runs (including newlines) to a single space before matching so a wrap point never
// makes an otherwise-present phrase invisible to the regex.
const flatten = (s) => s.replace(/\s+/g, ' ');

test('Step 2 (push) failure path states the degrade-warning log line is mandatory', () => {
  const step2 = flatten(step(read(), '### Step 2: Push the branch'));
  assert.match(step2, /mandatory, not optional/);
  assert.match(step2, /AUTO \{time\} — PR-early run lifecycle: push of \{branch\} to origin FAILED/);
});

test('Step 2 (push) retries once on a transient-looking (5xx/timeout) failure before degrading', () => {
  const step2 = flatten(step(read(), '### Step 2: Push the branch'));
  assert.match(step2, /transient-looking failure/);
  assert.match(step2, /retry \*\*once\*\* after a 15-second wait/);
});

test('Step 3 (gh pr create) failure path states the degrade-warning log line is mandatory', () => {
  const text = read();
  const start = text.indexOf('### Step 3: Compose the body and create the draft PR');
  assert.ok(start !== -1, 'Step 3 heading not found');
  const next = text.indexOf('\n### Step 4', start);
  const step3 = flatten(next === -1 ? text.slice(start) : text.slice(start, next));
  assert.match(step3, /mandatory, not optional/);
  assert.match(step3, /wait 15 seconds first when the failure looks transient/);
});

test('the Skip / degrade behavior table documents the transient-retry row', () => {
  assert.match(flatten(read()), /Push or `gh pr create` fails with a transient-looking \(5xx\/timeout\) signature/);
});

// --- Go-red proof: these checks can actually fail (per skill-prose-conformance-tests'
// go-red guidance) — reworked against a stripped-down synthetic copy of the prose shape. ---

test('go-red proof: a copy missing the mandatory-log language fails the same assertion', () => {
  const withoutMandate = flatten(`### Step 2: Push the branch\n\n**On failure**: stop here. Log to decisions.md:\n\n\`AUTO {time} — PR-early run lifecycle: push of {branch} to origin FAILED ({reason}); run proceeds local-only, no PR opened. Reversibility: n/a.\`\n`);
  assert.throws(() => assert.match(withoutMandate, /mandatory, not optional/));
});

test('go-red proof: a copy missing the transient-retry language fails the same assertion', () => {
  const withoutRetry = flatten(`### Step 2: Push the branch\n\n**On failure**: stop here. Log to decisions.md.\n`);
  assert.throws(() => assert.match(withoutRetry, /retry \*\*once\*\* after a 15-second wait/));
});
