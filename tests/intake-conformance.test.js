// tests/intake-conformance.test.js
// Pins plugin/skills/intake/SKILL.md's structural conventions (#1704): the
// verdict table's shape and order, the Decisions section's fixed language,
// Step 6's writer calls, the Carry-over/Dropped report sections, and the
// no-bare-skill-reference rule. Each assertion is a live-corpus pin, proven
// discriminating by temporarily editing the pinned text and reverting via
// `git checkout -- <file>`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const SKILL_PATH = path.join(REPO_ROOT, 'plugin', 'skills', 'intake', 'SKILL.md');
const DUMP_PATH = path.join(REPO_ROOT, 'tests', 'fixtures', 'intake-sample-dump.md');
const EXPECTED_PATH = path.join(REPO_ROOT, 'tests', 'fixtures', 'intake-sample-dump.expected.md');

const read = (p) => fs.readFileSync(p, 'utf8');
const SKILL = read(SKILL_PATH);

const VERDICT_ORDER = ['drop', 'shipped', 'absorb:#N', 'upstream', 'upstream:<owner/name>', 'remember', 'file', 'nudge', 'not-here'];

// --- (a) verdict table: exactly nine rows, in the designed order ---

test('the verdict table has exactly nine `| `verdict` |` rows in the designed order', () => {
  const tableStart = SKILL.indexOf('| Verdict | Meaning |');
  const tableEnd = SKILL.indexOf('\n\n', tableStart);
  const table = SKILL.slice(tableStart, tableEnd);
  const rows = [...table.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(rows, VERDICT_ORDER);
});

// --- (b) "first match wins" precedes the table ---

test('"first match wins" precedes the verdict table', () => {
  const firstMatch = SKILL.indexOf('first match wins');
  const tableStart = SKILL.indexOf('| Verdict | Meaning |');
  assert.ok(firstMatch >= 0, '"first match wins" must appear');
  assert.ok(tableStart >= 0, 'verdict table must appear');
  assert.ok(firstMatch < tableStart, '"first match wins" must precede the table');
});

// --- (c) Decisions section carries the fixed language ---

test('the Decisions section states no-auto-mode, never-in-flow, and the maintenance rule', () => {
  const decisions = SKILL.slice(SKILL.indexOf('## Decisions'));
  assert.ok(decisions.includes('No `auto` mode'), 'no auto mode');
  assert.ok(decisions.includes('never inside `/flow`'), 'never inside /flow');
  assert.ok(decisions.includes('re-runs the graded dogfood check'), 'maintenance rule');
});

// --- (d) Step 6 writer calls ---

test('Step 6 carries the --batch, --route=keep, and --route=absorb:N writer calls', () => {
  assert.ok(SKILL.includes('--batch'), '--batch');
  assert.ok(SKILL.includes('--route=keep --source intake'), '--route=keep --source intake');
  assert.ok(SKILL.includes('--route=absorb:N --source intake'), '--route=absorb:N --source intake');
});

// --- (e) Step 6 names /claude-tweaks:feedback and never --pre-confirmed ---

test('Step 6 calls claude-tweaks:feedback and never uses --pre-confirmed', () => {
  assert.ok(SKILL.includes('claude-tweaks:feedback'), 'claude-tweaks:feedback');
  assert.ok(!SKILL.includes('--pre-confirmed'), '--pre-confirmed must not appear');
});

// --- (f) the one-nudge-round sentence ---

test('the literal "One nudge round, never a loop." appears', () => {
  assert.ok(SKILL.includes('One nudge round, never a loop.'));
});

// --- (g) Step 7 report sections ---

test('Step 7 carries ### Carry-over and ### Dropped', () => {
  assert.ok(SKILL.includes('### Carry-over'));
  assert.ok(SKILL.includes('### Dropped'));
});

// --- (h) every /claude-tweaks: reference inside Step bodies and Next Actions is fully qualified ---

test('no bare /capture, /feedback, /specify, /backlog, or /tidy reference outside a table cell in Step bodies or Next Actions', () => {
  const lines = SKILL.split('\n');
  const bareRe = /(?<!claude-tweaks:)\/(capture|feedback|specify|backlog|tidy)\b/g;
  let inScope = false;
  const offenders = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^## Step \d/.test(line) || /^## Next Actions/.test(line)) inScope = true;
    else if (/^## /.test(line)) inScope = false;
    if (inScope && !line.trim().startsWith('|') && bareRe.test(line)) offenders.push(`${i + 1}: ${line}`);
    bareRe.lastIndex = 0;
  }
  assert.deepEqual(offenders, []);
});

// --- (i) fixture pair exists and lines up ---

test('both fixture files exist, the dump has >= 12 non-empty lines, and the expected file has one row per non-empty dump line', () => {
  assert.ok(fs.existsSync(DUMP_PATH), 'sample dump fixture must exist');
  assert.ok(fs.existsSync(EXPECTED_PATH), 'expected fixture must exist');
  const dumpLines = read(DUMP_PATH).split('\n').filter((l) => l.trim() !== '');
  assert.ok(dumpLines.length >= 12, `dump has ${dumpLines.length} non-empty lines, want >= 12`);
  const expectedRows = [...read(EXPECTED_PATH).matchAll(/^\| \d+ \|/gm)];
  assert.equal(expectedRows.length, dumpLines.length, 'one expected-table row per non-empty dump line');
});

// --- (j) failure semantics ---

test('Step 6 carries the literal "continues with the next fragment"', () => {
  assert.ok(SKILL.includes('continues with the next fragment'));
});

// --- (k) Step 1 self-reference read, Step 3 self-reference collapse ---

test('Step 1 reads git remote get-url origin; Step 3 states the self-reference collapse', () => {
  const step1 = SKILL.slice(SKILL.indexOf('## Step 1'), SKILL.indexOf('## Step 2'));
  const step3 = SKILL.slice(SKILL.indexOf('## Step 3'), SKILL.indexOf('## Step 4'));
  assert.ok(step1.includes('git remote get-url origin'), 'Step 1');
  assert.ok(step3.includes('removed from the set for the whole run'), 'Step 3');
});

// --- (l) absorb ambiguity nudges ---

test('Step 3 states the two-or-more-candidates absorb nudge', () => {
  const step3 = SKILL.slice(SKILL.indexOf('## Step 3'), SKILL.indexOf('## Step 4'));
  assert.ok(step3.includes('Two or more qualifying candidates') || step3.toLowerCase().includes('two or more qualifying candidates'));
});

// --- (m) empty-input prompt wording ---

test('the Input section contains the empty-input prompt wording', () => {
  const input = SKILL.slice(SKILL.indexOf('## Input'), SKILL.indexOf('## Step 1'));
  assert.ok(input.includes('Paste the dump here'));
});
