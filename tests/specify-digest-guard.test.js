'use strict';

// Prose-pin for /specify's digest-container guard (refs #4142). The guard is
// documented in prose only (skill markdown), so a later slimming pass could
// silently drop it without any test noticing — mirrors
// tests/specify-parent-guard.test.js's rationale. The next-mode.md EXCLUDE set
// is pinned here too, so the explicit-reference guard and the bare-drain
// exclusion cannot drift apart.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const readFlat = (rel) => read(rel).replace(/\s+/g, ' ');

const PARENT_GUARD = '**Parent-record guard (before the `needs:definition` check';
const DIGEST_GUARD = '**Digest-container guard (after the parent-record guard';
const REDIRECT = '**`needs:definition` redirect (single-record path only).**';

test('specify SKILL.md defines the digest-container guard after the parent-record guard and before the needs:definition redirect', () => {
  const src = readFlat('plugin/skills/specify/SKILL.md');
  const parentIdx = src.indexOf(PARENT_GUARD);
  const digestIdx = src.indexOf(DIGEST_GUARD);
  const redirectIdx = src.indexOf(REDIRECT);
  assert.ok(parentIdx !== -1, 'parent-record guard paragraph marker missing from SKILL.md case 1');
  assert.ok(digestIdx !== -1, 'digest-container guard paragraph missing from SKILL.md case 1');
  assert.ok(redirectIdx !== -1, 'needs:definition redirect paragraph missing from SKILL.md case 1');
  assert.ok(parentIdx < digestIdx && digestIdx < redirectIdx, 'digest-container guard must sit between the parent-record guard and the needs:definition redirect');
});

test('digest-container guard is a hard stop that names the digest label, cites the materiality floor, and states its residue set and scope', () => {
  const src = readFlat('plugin/skills/specify/SKILL.md');
  const start = src.indexOf(DIGEST_GUARD);
  const end = src.indexOf(REDIRECT);
  assert.ok(start !== -1 && end !== -1, 'digest-container guard or redirect marker missing — cannot slice the paragraph');
  const slice = src.slice(start, end);
  assert.ok(slice.includes('`digest`'), 'digest label missing from the digest-container guard');
  assert.ok(slice.includes('_shared/materiality-floor.md'), 'digest-container guard must cite _shared/materiality-floor.md');
  assert.ok(slice.includes('hard stop, no prompt'), 'digest-container guard hard-stop clause missing');
  assert.ok(slice.includes('`ready`, `risk:*`, `size:*`, `ceremony:*`, `solution:unjustified`'), 'exact residue-strip label set missing from the digest-container guard');
  assert.ok(slice.includes('single-record path'), 'digest-container guard scope (single record) missing');
  assert.ok(slice.includes('batch/range branch'), 'digest-container guard scope (batch/range branch) missing');
  assert.ok(slice.includes("case 5's direct-shaping branch"), 'digest-container guard scope (case 5) missing');
});

test('batch branch refuses a digest element per element and excludes it from the fail-all check', () => {
  const src = readFlat('plugin/skills/specify/SKILL.md');
  assert.ok(src.includes('A **digest element** (the digest-container guard above) is the one per-element stop: it is refused alone'), 'per-element digest refusal missing from the batch branch');
  assert.ok(src.includes('the remaining elements still shape'), 'per-element digest refusal must leave the other elements shaping');
  assert.ok(src.includes('It is not a resolution failure, so it never joins the fail-all set above'), 'digest refusal must be excluded from the fail-all set');
  assert.ok(src.includes('a batch whose every element is a digest container shapes nothing'), 'all-digest batch rule missing from the batch branch');
});

test('case 5 applies the digest-container guard by reference', () => {
  const src = readFlat('plugin/skills/specify/SKILL.md');
  assert.ok(src.includes("apply case 1's **digest-container guard** by reference"), 'case-5 digest-container guard citation missing');
});

test("next-mode.md's bare-drain EXCLUDE set includes 'digest' (parsed from the array literal)", () => {
  const src = read('plugin/skills/specify/next-mode.md');
  const literal = src.match(/const EXCLUDE = new Set\(\[([^\]]*)\]\)/);
  assert.ok(literal, 'const EXCLUDE = new Set([...]) literal not found in next-mode.md');
  const members = [...literal[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.ok(members.includes('digest'), "EXCLUDE set must include 'digest' — drifts from the explicit-reference guard otherwise");
});

test('shaping-mode-readback.md lists the digest-container refusal outcome and keeps the no-skipped rationale', () => {
  const src = readFlat('plugin/skills/specify/shaping-mode-readback.md');
  assert.ok(src.includes('`refused — digest container`'), 'refused — digest container outcome missing from Actions Performed');
  assert.ok(src.includes('no `skipped` outcome'), 'no-skipped-outcome sentence missing from shaping-mode-readback.md');
});

test('work-record-permission-matrix.md /specify row grants the residue strip from a digest-labeled record', () => {
  const src = readFlat('plugin/skills/_shared/work-record-permission-matrix.md');
  assert.ok(src.includes('a `digest`-labeled record only (case-1 digest-container guard cleanup'), 'digest-labeled residue-strip grant missing from the /specify row');
});
