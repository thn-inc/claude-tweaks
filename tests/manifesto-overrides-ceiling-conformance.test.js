'use strict';
// tests/manifesto-overrides-ceiling-conformance.test.js — pins that the Manifesto
// Override semantics rows for review-auto-apply-ceiling (plugin/skills/flow/
// manifesto-overrides.md) agree with the ceiling-keyed routing table in
// plugin/skills/review/step3-routing.md. The routing table is the source of truth.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const OVERRIDES_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'manifesto-overrides.md');
const ROUTING_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'review', 'step3-routing.md');
const overrides = fs.readFileSync(OVERRIDES_PATH, 'utf8');
const routing = fs.readFileSync(ROUTING_PATH, 'utf8');

function routingColumns(md) {
  const lines = md.split('\n');
  const start = lines.indexOf('| Severity | `none` | `low` | `medium` |');
  if (start === -1) throw new Error('ceiling-keyed routing table header not found in step3-routing.md');
  const names = ['none', 'low', 'medium'];
  const cols = { Critical: {}, High: {}, Medium: {}, Low: {} };
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const cells = lines[i].split('|').slice(1, -1).map((c) => c.trim());
    const sev = cells[0].replace(/\*\*/g, '');
    if (!(sev in cols)) continue;
    names.forEach((name, j) => { cols[sev][name] = cells[j + 1]; });
  }
  for (const sev of Object.keys(cols)) {
    if (cols[sev].none === undefined) throw new Error(`routing table has no ${sev} row`);
  }
  return cols;
}

function ceilingRow(md, value) {
  const line = md.split('\n').find((l) => l.startsWith(`| Review auto-apply ceiling | \`${value}\` |`));
  if (!line) throw new Error(`no "Review auto-apply ceiling" row for \`${value}\` in manifesto-overrides.md`);
  return line.split('|').slice(1, -1).map((c) => c.trim())[2];
}

function assertNoneRow(text) {
  assert.match(text, /every non-critical finding staged/i);
  assert.doesNotMatch(text, /all findings auto-applied/i);
  assert.match(text, /highest friction, lowest revert load/i);
  assert.match(text, /prose-exempt/i);
}

function assertMediumRow(text) {
  assert.doesNotMatch(text, /only HIGH prompts/i);
  assert.match(text, /LOW \+ MED auto-applied/);
  assert.match(text, /HIGH staged/);
  assert.match(text, /Critical prompts/i);
}

function assertLowRow(text) {
  assert.match(text, /LOW auto-applied/);
  assert.match(text, /MED and HIGH staged/);
  assert.match(text, /only Critical prompts/);
}

// manifesto.md's lever-7 cells restate the `low` column too (the "Effect if approved" cell and
// the Recommendation-defaults row); neither may say HIGH prompts.
function assertNoHighPrompts(text) {
  assert.doesNotMatch(text, /HIGH prompts/);
  assert.doesNotMatch(text, /prompt HIGH/);
}

const cols = routingColumns(routing);

test('premise: step3-routing none column stages every non-critical severity', () => {
  for (const sev of ['High', 'Medium', 'Low']) {
    assert.ok(cols[sev].none.startsWith('STAGED'), `${sev} under none must be STAGED, got "${cols[sev].none}"`);
  }
  assert.strictEqual(cols.Critical.none, 'KEPT-PROMPT');
});

test('premise: step3-routing medium column auto-applies Low and Medium, stages High, prompts Critical', () => {
  assert.strictEqual(cols.Low.medium, 'AUTO');
  assert.strictEqual(cols.Medium.medium, 'AUTO');
  assert.strictEqual(cols.High.medium, 'STAGED');
  assert.strictEqual(cols.Critical.medium, 'KEPT-PROMPT');
});

test('premise: step3-routing low column auto-applies Low, stages Medium and High, prompts Critical', () => {
  assert.strictEqual(cols.Low.low, 'AUTO');
  assert.strictEqual(cols.Medium.low, 'STAGED');
  assert.strictEqual(cols.High.low, 'STAGED');
  assert.strictEqual(cols.Critical.low, 'KEPT-PROMPT');
});

test('low override row exists and matches the routing table (MED and HIGH staged, only Critical prompts)', () => {
  assertLowRow(ceilingRow(overrides, 'low'));
});

test('manifesto.md lever-7 cells do not claim HIGH prompts', () => {
  const manifesto = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'manifesto.md'), 'utf8');
  const lever7 = manifesto.split('\n').filter((l) => /Review auto-apply ceiling/.test(l) && l.startsWith('|'));
  assert.ok(lever7.length >= 2, `expected the lever-7 table row and the Recommendation-defaults row, found ${lever7.length}`);
  lever7.forEach((l) => assertNoHighPrompts(l));
});

test('AC1.1 + AC2.1: none override row describes staging and names the prose-exempt exception', () => {
  assertNoneRow(ceilingRow(overrides, 'none'));
});

test('medium override row matches the routing table (HIGH staged, only Critical prompts)', () => {
  assertMediumRow(ceilingRow(overrides, 'medium'));
});

test('go-red control: the pre-#3166 none wording fails assertNoneRow', () => {
  assert.throws(() => assertNoneRow('All findings auto-applied (lowest friction, highest revert load)'));
});

test('go-red control: the pre-#3166 medium wording fails assertMediumRow', () => {
  assert.throws(() => assertMediumRow('LOW + MED auto-applied; only HIGH prompts'));
});

test('go-red control: a low row claiming HIGH prompts fails assertLowRow', () => {
  assert.throws(() => assertLowRow('LOW auto-applied; MED staged; HIGH prompts'));
});

test('go-red control: the pre-fix lever-7 wordings fail assertNoHighPrompts', () => {
  assert.throws(() => assertNoHighPrompts('`low` — LOW auto-applied, MED staged, HIGH prompts; `medium`'));
  assert.throws(() => assertNoHighPrompts('Auto LOW, stage MED, prompt HIGH; an unattended'));
});
