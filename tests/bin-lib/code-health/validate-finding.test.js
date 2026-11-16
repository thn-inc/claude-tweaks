'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// ── v2 Finding shape ───────────────────────────────────────────────────────

const { validateFindingV2 } = require('../../../plugin/bin/lib/code-health/validate-finding');

function validV2Finding(overrides = {}) {
  return {
    criterion: 'simplification',
    areaId: 'src/api',
    anchor: 'src/api/user.js#getUser',
    severity: 'medium',
    confidence: 'high',
    likelihood: 'medium',
    effort: 'medium',
    title: 'getUser is a passthrough to the repository',
    evidence: 'src/api/user.js#getUser delegates directly to UserRepository.find with no added logic.',
    suggestedApproach: 'Inline the call at the call site, or add caching/auth in this method.',
    acceptance: 'getUser adds caching, authorization, or enrichment; or is removed and callers use the repository directly.',
    ...overrides,
  };
}

test('validateFindingV2: a complete v2 finding passes', () => {
  const result = validateFindingV2(validV2Finding());
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.errors, []);
});

test('validateFindingV2: missing required field fails with a named error', () => {
  const f = validV2Finding();
  delete f.anchor;
  const result = validateFindingV2(f);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('anchor')), result.errors.join('; '));
});

test('validateFindingV2: suggestedApproach is required (not suggestion)', () => {
  const f = validV2Finding();
  delete f.suggestedApproach;
  const result = validateFindingV2(f);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('suggestedApproach')), result.errors.join('; '));
});

test('validateFindingV2: unknown criterion id fails', () => {
  const result = validateFindingV2(validV2Finding({ criterion: 'not-a-real-criterion' }));
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('criterion') && e.includes('unknown')), result.errors.join('; '));
});

test('AC9.1: validateFindingV2 rejects a finding with a missing or blank criterion — the only guard in front of fingerprint() (#5536)', () => {
  const missing = validV2Finding();
  delete missing.criterion;
  for (const [label, finding] of [
    ['missing criterion', missing],
    ['blank criterion', validV2Finding({ criterion: '   ' })],
  ]) {
    const result = validateFindingV2(finding);
    assert.strictEqual(result.ok, false, `${label}: expected ok:false`);
    assert.ok(result.errors.some((e) => e.startsWith('criterion: required non-empty string')), `${label}: ${result.errors.join('; ')}`);
  }
});

test('validateFindingV2: bad severity enum fails', () => {
  const result = validateFindingV2(validV2Finding({ severity: 'urgent' }));
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('severity')));
});

test('validateFindingV2: bad confidence enum fails', () => {
  const result = validateFindingV2(validV2Finding({ confidence: 'med' }));
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('confidence')));
});

test('validateFindingV2: accumulates all errors in one pass', () => {
  const result = validateFindingV2({ severity: 'urgent', confidence: 'med' });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.length >= 5, `got ${result.errors.length}: ${result.errors.join('; ')}`);
});

test('validateFindingV2: valid result carries the original fields', () => {
  const f = validV2Finding();
  const result = validateFindingV2(f);
  assert.strictEqual(result.value.criterion, 'simplification');
  assert.strictEqual(result.value.anchor, 'src/api/user.js#getUser');
  assert.strictEqual(result.value.suggestedApproach, f.suggestedApproach);
  assert.strictEqual(result.value.acceptance, f.acceptance);
});

// ── relatedAnchors (bundled findings) ────────────────────────────────────────

test('validateFindingV2: relatedAnchors is optional — absent is valid', () => {
  const result = validateFindingV2(validV2Finding());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.value.relatedAnchors, undefined);
});

test('validateFindingV2: relatedAnchors accepted when present as an array of non-empty strings', () => {
  const result = validateFindingV2(validV2Finding({
    relatedAnchors: ['src/api/other.js#getOther', 'src/api/third.js#getThird'],
  }));
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.value.relatedAnchors, ['src/api/other.js#getOther', 'src/api/third.js#getThird']);
});

test('validateFindingV2: relatedAnchors fails when not an array', () => {
  const result = validateFindingV2(validV2Finding({ relatedAnchors: 'src/api/other.js#getOther' }));
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('relatedAnchors')), result.errors.join('; '));
});

test('validateFindingV2: relatedAnchors fails when it contains an empty string', () => {
  const result = validateFindingV2(validV2Finding({ relatedAnchors: ['src/a.js#a', ''] }));
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('relatedAnchors')), result.errors.join('; '));
});

test('validateFindingV2: relatedAnchors fails when it contains a non-string entry', () => {
  const result = validateFindingV2(validV2Finding({ relatedAnchors: ['src/a.js#a', 42] }));
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('relatedAnchors')), result.errors.join('; '));
});

// ── likelihood / effort (schema unification) ────────────────────────────────

test('validateFindingV2: bad severity enum "critical" fails (dropped from the schema)', () => {
  const result = validateFindingV2(validV2Finding({ severity: 'critical' }));
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('severity')), result.errors.join('; '));
});

test('validateFindingV2: likelihood is required', () => {
  const f = validV2Finding();
  delete f.likelihood;
  const result = validateFindingV2(f);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('likelihood')), result.errors.join('; '));
});

test('validateFindingV2: bad likelihood enum fails', () => {
  const result = validateFindingV2(validV2Finding({ likelihood: 'certain' }));
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('likelihood')), result.errors.join('; '));
});

test('validateFindingV2: effort is required', () => {
  const f = validV2Finding();
  delete f.effort;
  const result = validateFindingV2(f);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('effort')), result.errors.join('; '));
});

test('validateFindingV2: bad effort enum fails', () => {
  const result = validateFindingV2(validV2Finding({ effort: 'huge' }));
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('effort')), result.errors.join('; '));
});

test('validateFindingV2: valid result carries likelihood and effort', () => {
  const result = validateFindingV2(validV2Finding({ likelihood: 'high', effort: 'low' }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.value.likelihood, 'high');
  assert.strictEqual(result.value.effort, 'low');
});

// REGRESSION: severity/confidence/likelihood/effort must all validate over
// the identical tier vocabulary — they used to be four separately hand-typed
// `new Set([...])` literals (one even in a different member order), which
// could silently drift apart if only one was updated for a future tier
// change. Deriving all four from one shared TIER_VALUES array keeps them
// permanently in sync.
test('SEVERITY_VALUES, CONFIDENCE_VALUES, LIKELIHOOD_VALUES, EFFORT_VALUES, and TIER_VALUES all contain the exact same members', () => {
  const {
    TIER_VALUES, SEVERITY_VALUES, CONFIDENCE_VALUES, LIKELIHOOD_VALUES, EFFORT_VALUES,
  } = require('../../../plugin/bin/lib/code-health/validate-finding');
  const expected = [...TIER_VALUES].sort();
  for (const [name, set] of [
    ['SEVERITY_VALUES', SEVERITY_VALUES],
    ['CONFIDENCE_VALUES', CONFIDENCE_VALUES],
    ['LIKELIHOOD_VALUES', LIKELIHOOD_VALUES],
    ['EFFORT_VALUES', EFFORT_VALUES],
  ]) {
    assert.deepStrictEqual([...set].sort(), expected, `${name} must match TIER_VALUES exactly`);
  }
});
