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

test('skill-authoring.md: Next Actions convention names the premise-verification rule for state-changing options', () => {
  assert.match(
    AUTHORING,
    /state-changing command \(a release bump, a push, a delete, a merge\) is never marked `\(recommended\)` on an unverified premise/,
  );
  assert.match(AUTHORING, /the option is omitted entirely when that check didn't run/);
});

// #2257 generalized the release row from the old ancestry-check/backfill
// shape to a single `/claude-tweaks:release` recommendation gated on the
// release-preflight pack's `unreleased` field (the `#680` rule carries
// forward unchanged: never recommend a state-changing command from an
// unverified or absent premise) — see
// tests/flow-release-row-680-gating-prose.test.js for the full pin.
test('summary-template.md: the release row is conditional on the release-preflight pack, never rendered from an unverified premise', () => {
  assert.match(SUMMARY, /Render `\/claude-tweaks:release` only when this run produced a release-preflight pack/);
  assert.match(SUMMARY, /never render from an unverified premise/);
  assert.match(SUMMARY, /omit the release row entirely/);
});

test('summary-template.md: the release row reads the release-preflight pack, never the retired release.js status subcommand', () => {
  assert.match(SUMMARY, /bin\/release-preflight\.js/);
  assert.doesNotMatch(SUMMARY, /release\.js" status/);
  assert.doesNotMatch(SUMMARY, /git merge-base --is-ancestor/);
});

test('summary-template.md: the release row is never unconditionally Recommended', () => {
  assert.match(SUMMARY, /is never marked `\(recommended\)` while `\/claude-tweaks:flow \{next spec\}` is present/);
});

test('summary-template.md: Next Actions still documents assembling only applicable lines, base 2 plus conditionals', () => {
  assert.match(SUMMARY, /the base 2 always; the four conditional lines only when their trigger condition holds/);
});
