'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #680: a Next Actions option carrying a runnable, state-changing command
// (a release bump) was marked (recommended) for work a prior release had
// already carried — the recommendation rested on a premise nobody checked.
// Pin both the summary-template.md release row's premise-verification rule
// and the general skill-authoring.md convention sentence it derives from.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const SUMMARY = read('plugin', 'skills', 'flow', 'summary-template.md');
const AUTHORING = read('docs', 'skill-authoring.md');
const GATE = read('plugin', 'skills', '_shared', 'release-recommendation-gate.md');

test('skill-authoring.md: Next Actions convention names the premise-verification rule for state-changing options', () => {
  assert.match(
    AUTHORING,
    /state-changing command \(a release bump, a push, a delete, a merge\) is never marked `\(recommended\)` on an unverified premise/,
  );
  assert.match(AUTHORING, /the option is omitted entirely when that check didn't run/);
});

// #2257: the release row's own gating moved from summary-template.md's inline
// ancestry-check prose to the shared `_shared/release-recommendation-gate.md`
// file (byte-budget pressure on summary-template.md and reuse across
// flow/multispec-summary.md and wrap-up/SKILL.md) — pin the gate file itself
// for the premise-verification substance, and summary-template.md only for
// citing it.

test('summary-template.md: the release row cites the shared gate file, never rendering from an unverified premise itself', () => {
  assert.match(SUMMARY, /_shared\/release-recommendation-gate\.md/);
});

test('release-recommendation-gate.md: gates on the preflight pack\'s unreleased field, never an unverified premise', () => {
  assert.match(GATE, /release-preflight\.json/);
  assert.match(GATE, /unreleased/);
  assert.match(GATE, /#680/);
  assert.match(GATE, /never recommend from an unverified premise/);
  assert.match(GATE, /no preflight pack was produced for this run/);
});

test('release-recommendation-gate.md: a degraded (ok: false) unreleased field omits the row, distinct from an empty commits array', () => {
  assert.match(GATE, /\{ok: false, error: \.\.\.\}.*Omit/);
  assert.match(GATE, /\{ok: true, value: \{commits: \[\]\}\}.*Omit/);
});

test('summary-template.md: the release row is never unconditionally Recommended', () => {
  assert.match(SUMMARY, /is never marked `\(recommended\)` while `\/claude-tweaks:flow \{next spec\}` is present/);
});

test('summary-template.md: Next Actions still documents assembling only applicable lines, base 2 plus conditionals', () => {
  assert.match(SUMMARY, /the base 2 always; the four conditional lines only when their trigger condition holds/);
});
