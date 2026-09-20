'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeDiffFacts, deriveCeremonyProfile, shouldDerive } = require('../../../plugin/bin/lib/dispatch/ceremony-derive');

// #1545 evidence shape: a +75/-2 test file plus its own materialized
// work/{n}-spec.md doc — a mix of test + docs files, zero production files.
const EVIDENCE_DIFF = [
  { path: 'tests/wrap-up-registry-pin.test.js', additions: 75, deletions: 2 },
  { path: '.claude-tweaks/pipelines/2026-08-26T000000-spec-1/work/1-spec.md', additions: 40, deletions: 0 },
];

test('AC1: the #1545 evidence diff (test file + materialized spec doc, zero production files) is assigned fast-lane, not standard', () => {
  assert.equal(deriveCeremonyProfile(EVIDENCE_DIFF, 'standard'), 'fast-lane');
});

test('computeDiffFacts: the evidence diff is lowSurface but strictly neither testOnly nor docsOnly (a mix)', () => {
  const facts = computeDiffFacts(EVIDENCE_DIFF);
  assert.equal(facts.lowSurface, true);
  assert.equal(facts.testOnly, false);
  assert.equal(facts.docsOnly, false);
  assert.equal(facts.implFiles, 0);
});

test('computeDiffFacts: a pure test-only diff classifies as testOnly and lowSurface', () => {
  const facts = computeDiffFacts([{ path: 'tests/foo.test.js', additions: 10, deletions: 1 }]);
  assert.equal(facts.testOnly, true);
  assert.equal(facts.lowSurface, true);
});

test('computeDiffFacts: a pure docs-only diff classifies as docsOnly and lowSurface', () => {
  const facts = computeDiffFacts([{ path: 'docs/plugin-structure.md', additions: 5, deletions: 0 }]);
  assert.equal(facts.docsOnly, true);
  assert.equal(facts.lowSurface, true);
});

// The Gotcha this issue names explicitly: a test file plus a SMALL amount of
// production code must NOT be misclassified as low-surface — a real
// behavioral change riding along with its own regression test must still
// default to standard.
test('AC2 (gotcha): a test file plus one line of production code is disqualified — never fast-lane', () => {
  const files = [
    { path: 'plugin/bin/lib/foo.js', additions: 1, deletions: 0 },
    { path: 'tests/foo.test.js', additions: 20, deletions: 0 },
  ];
  const facts = computeDiffFacts(files);
  assert.equal(facts.lowSurface, false, `a diff touching production code must never be lowSurface: ${JSON.stringify(facts)}`);
  assert.equal(deriveCeremonyProfile(files, 'standard'), 'standard');
});

test('deriveCeremonyProfile: a purely backend/production diff stays standard', () => {
  const files = [{ path: 'plugin/bin/lib/reconcile/archive-merged.js', additions: 40, deletions: 5 }];
  assert.equal(deriveCeremonyProfile(files, 'standard'), 'standard');
});

// The other half of the gotcha: never downgrade a profile already set to
// standard by an upstream decision -- but an already-fast-lane current value
// is passed through untouched (nothing to narrow further), never re-derived
// downward to standard by this function.
test('deriveCeremonyProfile: an already-fast-lane current value is never touched, regardless of diff content', () => {
  const bigProductionDiff = [{ path: 'plugin/bin/lib/reconcile/archive-merged.js', additions: 500, deletions: 200 }];
  assert.equal(deriveCeremonyProfile(bigProductionDiff, 'fast-lane'), 'fast-lane');
});

test('deriveCeremonyProfile: an empty diff leaves the current value unchanged', () => {
  assert.equal(deriveCeremonyProfile([], 'standard'), 'standard');
  assert.equal(deriveCeremonyProfile([], 'fast-lane'), 'fast-lane');
});

test('shouldDerive: only an auto-mode run whose profile is still standard derives (#1932 AC1)', () => {
  assert.strictEqual(shouldDerive({ mode: 'auto', ceremonyProfile: 'standard' }), true);
  for (const mode of ['confirm', 'hybrid', 'interactive', undefined, null, '']) {
    assert.strictEqual(shouldDerive({ mode, ceremonyProfile: 'standard' }), false, `mode ${mode} never derives`);
  }
  assert.strictEqual(shouldDerive({ mode: 'auto', ceremonyProfile: 'fast-lane' }), false, 'already fast-lane: nothing to narrow');
  assert.strictEqual(shouldDerive({}), false, 'no config at all (standalone wrap-up) never derives');
});
