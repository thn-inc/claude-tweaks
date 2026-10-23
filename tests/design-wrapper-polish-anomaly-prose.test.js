// tests/design-wrapper-polish-anomaly-prose.test.js — pins the #886 addition
// to skills/design-wrapper/modes/polish.md: the git-diff evidence check
// (Step 6.5) and the `result: "anomaly"` status it can emit when
// `commands_invoked` is non-empty but nothing actually landed. Reads the
// live skill file (this test pins prose WE just wrote, not a third-party
// fact — the skill-prose-conformance-tests live-vs-fixture distinction).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const POLISH_MD = path.join(__dirname, '..', 'plugin', 'skills', 'design-wrapper', 'modes', 'polish.md');

function read() {
  return readText(POLISH_MD);
}

test('polish.md header return shape includes the anomaly result value', () => {
  const text = read();
  assert.match(text, /result: "ok" \| "anomaly"/);
});

test('polish.md has a Step 6.5 verifying commands_invoked against git diff evidence', () => {
  const text = read();
  assert.match(text, /### Step 6\.5: Verify against git diff evidence/);
  assert.match(text, /git diff --stat -- <files>/);
  assert.match(text, /git diff --name-only/);
});

test('polish.md skips Step 6.5 when commands_invoked is empty or under --dry-run', () => {
  const text = read();
  const step = text.slice(text.indexOf('### Step 6.5'), text.indexOf('### Step 7'));
  assert.match(step, /Skip this step entirely when `commands_invoked` is empty.*or when running under Step 8's `--dry-run`/s);
});

test('polish.md states the anomaly rule: result becomes "anomaly", never silently "ok"', () => {
  const text = read();
  const step = text.slice(text.indexOf('### Step 6.5'), text.indexOf('### Step 7'));
  assert.match(step, /Set `result: "anomaly"` \(never `"ok"`/);
  assert.match(step, /add a top-level `anomaly` field/);
});

test('polish.md anomaly wording distinguishes legitimate no-op from an unverifiable claim', () => {
  const text = read();
  assert.match(text, /already-conformant code, a command that legitimately found nothing to change/);
  assert.match(text, /rather than a dispatch that silently no-op'd/);
});

test('polish.md degrades a failed git diff to the anomaly case rather than trusting narrated files_modified', () => {
  const text = read();
  const step = text.slice(text.indexOf('### Step 6.5'), text.indexOf('### Step 7'));
  assert.match(step, /If `git diff --stat`\/`git diff --name-only` itself fails/);
  assert.match(step, /"no evidence" must not read as "verified\."/);
});

test('polish.md Output to caller section includes a worked anomaly JSON example', () => {
  const text = read();
  assert.match(text, /"result": "anomaly"/);
  assert.match(text, /"anomaly": "commands_invoked non-empty but git diff shows zero changes/);
});

test('polish.md tells callers to render an anomaly distinctly from a clean ok result', () => {
  const text = read();
  assert.match(text, /the caller must render it distinctly from a clean `"ok"` result/);
});
