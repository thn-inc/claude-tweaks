'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', 'tools', 'review-replay');
const schema = require(path.join(root, 'schema.js'));
const counterfactual = require(path.join(root, 'counterfactual.js'));
const score = require(path.join(root, 'score.js'));
const extract = require(path.join(root, 'extract.js'));
const archive = require(path.join(root, 'archive.js'));

const prompt = { file: '/x.md', name: 'r/3a-a', run: 'r', lens: '3a', side: 'a', repo: '/repo' };
const arm = { name: 'a', profile: 'fast', model: 'haiku', effort: null, repeat: 1, prompts: [prompt] };
const manifest = (over = {}) => ({ schemaVersion: 1, kind: 'reviews', arms: [arm], ...over });

test('validateReviewsManifest accepts a well-formed manifest', () => {
  assert.deepStrictEqual(schema.validateReviewsManifest(manifest()), []);
});

test('validateReviewsManifest names the wrong kind', () => {
  assert.ok(schema.validateReviewsManifest(manifest({ kind: 'tiebreak' })).some((p) => p.includes('kind must be "reviews"')));
});

test('validateReviewsManifest names a prompt missing lens', () => {
  const { lens, ...noLens } = prompt;
  const problems = schema.validateReviewsManifest(manifest({ arms: [{ ...arm, prompts: [noLens] }] }));
  assert.ok(problems.some((p) => p.includes('missing key lens')), problems.join('\n'));
});

test('validateReviewsManifest rejects repeat 0 and a non-array prompts', () => {
  assert.ok(schema.validateReviewsManifest(manifest({ arms: [{ ...arm, repeat: 0 }] })).some((p) => p.includes('repeat must be a positive integer')));
  assert.ok(schema.validateReviewsManifest(manifest({ arms: [{ ...arm, prompts: 'x' }] })).some((p) => p.includes('prompts must be an array')));
});

test('validateReviewsManifest reports a missing kind once, a fractional repeat and non-object arms or prompts', () => {
  const { kind, ...noKind } = manifest();
  const missing = schema.validateReviewsManifest(noKind).filter((p) => p.includes('missing key kind'));
  assert.strictEqual(missing.length, 1);
  assert.ok(schema.validateReviewsManifest(manifest({ arms: [{ ...arm, repeat: 1.5 }] })).some((p) => p.includes('repeat must be a positive integer')));
  assert.ok(schema.validateReviewsManifest(manifest({ arms: [null] })).some((p) => p.includes('arms[0]: not an object')));
  assert.ok(schema.validateReviewsManifest(manifest({ arms: [{ ...arm, prompts: [null] }] })).some((p) => p.includes('prompts[0]: not an object')));
});

test('isControlArm matches control and control.* only', () => {
  assert.strictEqual(schema.isControlArm('control'), true);
  assert.strictEqual(schema.isControlArm('control.standard.medium'), true);
  assert.strictEqual(schema.isControlArm('controls'), false);
});

test('the shared constants carry the contract values', () => {
  assert.strictEqual(schema.REVIEWS_MANIFEST_FILE, 'reviews-manifest.json');
  assert.strictEqual(schema.REVIEWS_FIXTURE_FILE, 'reviews-fixture.json');
  assert.strictEqual(schema.REPORTS_FILE, 'archived-reports.json');
  assert.strictEqual(schema.REVIEWS_KIND, 'reviews');
  assert.strictEqual(schema.CONTROL_ARM, 'control');
  assert.deepStrictEqual(schema.REVIEWS_MANIFEST_KEYS, ['schemaVersion', 'kind', 'arms']);
  assert.deepStrictEqual(schema.REVIEWS_ARM_KEYS, ['name', 'profile', 'model', 'effort', 'repeat', 'prompts']);
  assert.deepStrictEqual(schema.REVIEWS_PROMPT_KEYS, ['file', 'name', 'run', 'lens', 'side', 'repo']);
  assert.strictEqual(schema.REVIEW_EXCLUSION_REASONS.length, 14);
});

test('the reused names are exported', () => {
  for (const [mod, names] of [
    [counterfactual, ['parseFindings', 'near', 'NEAR_LINES', 'lastAssistantText', 'indexTranscripts']],
    [score, ['transcriptCost', 'readJournal', 'identifyAgents']],
    [extract, ['parseArm']],
    [archive, ['LENS_RE', 'SIDE_RE']],
  ]) {
    for (const n of names) assert.notStrictEqual(typeof mod[n], 'undefined', n);
  }
});
