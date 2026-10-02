'use strict';
// tests/reflect-wrap-up-insights-staging-conformance.test.js — pins #2547: a
// standalone wrap-up run under `--source wrap-up` no longer calls two
// AskUserQuestion stops that decide the same thing (reflect's own Step 3
// routing question, then the Review Console's terminal approval). Reflect
// stages its Reflection Insights table instead of asking under that signal;
// the console's own "On approval" step applies the staged rows. The
// standalone / `--source review` path is unaffected — it keeps asking.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const FULL_MODE = read('plugin', 'skills', 'reflect', 'full-mode.md');
const CONSOLE = read('plugin', 'skills', 'wrap-up', 'review-console.md');
const CONSOLE_INTERACTIVE = read('plugin', 'skills', 'wrap-up', 'review-console-interactive.md');

function section(text, heading, nextPrefix) {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, `missing section: ${heading}`);
  const next = text.indexOf(nextPrefix, start + heading.length);
  return next === -1 ? text.slice(start) : text.slice(start, next);
}

test('full-mode.md: the --source wrap-up branch skips AskUserQuestion and stages the table instead', () => {
  assert.match(
    FULL_MODE,
    /Under `--source wrap-up` \(#2547\) — stage instead of asking/,
  );
  assert.match(
    FULL_MODE,
    /skip the `AskUserQuestion` call below entirely/,
  );
  assert.match(
    FULL_MODE,
    /write the composed table.*to `\{run-dir\}\/staged\/wrap-up-reflect-insights\.md`/s,
  );
});

test('full-mode.md: the --source wrap-up branch does not apply any outcome itself — Implement now, Defer/Capture, and Don\'t capture are all left unapplied', () => {
  const branch = section(FULL_MODE, 'Under `--source wrap-up` (#2547)', '\n\nOtherwise');
  assert.match(branch, /Do not apply any "Implement now" insight/);
  assert.match(branch, /do\s+not file any Defer\/Capture record/);
  assert.match(branch, /do not record a Don't-capture decline yet/);
});

test('full-mode.md: the --source wrap-up branch leaves D4/D5 gated exclusively by the console\'s own M#/U# rows', () => {
  const branch = section(FULL_MODE, 'Under `--source wrap-up` (#2547)', '\n\nOtherwise');
  assert.match(branch, /listed in the staged file for\s+visibility only/);
  assert.match(branch, /`review-console-interactive\.md`'s "a different table's approval never satisfies this\s+gate" rule/);
});

test('full-mode.md: the standalone / --source review path is explicitly unaffected and still asks', () => {
  assert.match(
    FULL_MODE,
    /Otherwise — standalone, or `--source review` — immediately below the table, call\s*\n`AskUserQuestion` with:/,
  );
});

test('full-mode.md: the --source review signal is explicitly excluded from the staging branch', () => {
  const branch = section(FULL_MODE, 'Under `--source wrap-up` (#2547)', '\n\nOtherwise');
  assert.match(branch, /this branch is `--source wrap-up` only, never `--source review`/);
});

test('review-console.md: "On approval" has a Reflection insights step that applies the staged file\'s rows', () => {
  assert.match(CONSOLE, /\*\*Reflection insights \(#2547\)\.\*\* When `staged\/wrap-up-reflect-insights\.md` exists/);
  assert.match(CONSOLE, /Approve all applies each insight's own recommended destination exactly as reflect's own "Apply all" would have/);
});

test('review-console.md: the Reflection insights step keeps D4/Memory and D5/Upstream gated exclusively by the console\'s own M#/U# rows', () => {
  const step = section(CONSOLE, '**Reflection insights (#2547).**', '\n11.');
  assert.match(step, /D4 \(Memory\) and D5 \(Upstream\) rows in this table are informational only/);
  assert.match(step, /approving this step never writes a memory file or files upstream feedback on its own/);
});

test('review-console.md: the "On approval" numbered procedure stays sequential 1-13 with no duplicate numbers', () => {
  const onApproval = section(CONSOLE, '## On approval (option 1)', '\nFor "On override"');
  const numbers = [...onApproval.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  assert.deepEqual(numbers, Array.from({ length: numbers.length }, (_, i) => i + 1));
});

test('review-console-interactive.md: the never-satisfies-this-gate rule still names the Reflection Insights batch explicitly', () => {
  assert.match(
    CONSOLE_INTERACTIVE,
    /not the Reflection Insights batch, not the Skill Updates batch, not any other/,
  );
});
