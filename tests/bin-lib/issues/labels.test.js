// tests/bin-lib/issues/labels.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ensureLabelPayload } = require('../../../plugin/bin/lib/issues/labels');
const { LABELS } = require('../../../plugin/bin/lib/issues/record');

test('returns { name, description } for a valid description', () => {
  assert.deepStrictEqual(
    ensureLabelPayload('by:capture', 'Origin: filed via /capture'),
    { name: 'by:capture', description: 'Origin: filed via /capture' },
  );
});

test('accepts a description of exactly 100 characters', () => {
  const d = 'x'.repeat(100);
  assert.deepStrictEqual(ensureLabelPayload('x', d), { name: 'x', description: d });
});

test('throws for a description of 101 characters', () => {
  const d = 'x'.repeat(101);
  assert.throws(() => ensureLabelPayload('x', d), /100 chars/);
});

test('throws when description is not a string', () => {
  assert.throws(() => ensureLabelPayload('x', undefined), /must be a string/);
  assert.throws(() => ensureLabelPayload('x', 42), /must be a string/);
});

test('error message names the label', () => {
  assert.throws(() => ensureLabelPayload('code-health:review-quality', 'x'.repeat(101)), /code-health:review-quality/);
});

test('solution:unjustified is bootstrappable with a description within the cap', () => {
  // Read the description from the canonical fence (see canonicalLabelsFromBootstrapDoc
  // below) instead of hand-copying it, so a future edit to that source that pushes the
  // description over the cap fails here rather than drifting silently.
  const row = canonicalLabelsFromBootstrapDoc().find(([name]) => name === 'solution:unjustified');
  assert.ok(row, 'label-bootstrap.md must carry solution:unjustified in LABELS_JSON');
  const [, description] = row;
  const payload = ensureLabelPayload('solution:unjustified', description);
  assert.strictEqual(payload.name, 'solution:unjustified');
  assert.ok(payload.description.length <= 100);
});

test('framing:baked is no longer in the canonical bootstrap set (record #677 rename)', () => {
  assert.ok(!canonicalLabelsFromBootstrapDoc().some(([name]) => name === 'framing:baked'));
});

test('solution:unjustified is exported as a LABELS constant; framing:baked stays as the read-side legacy constant', () => {
  assert.strictEqual(LABELS.SOLUTION_UNJUSTIFIED, 'solution:unjustified');
  assert.strictEqual(LABELS.FRAMING_BAKED, 'framing:baked');
});

test('parent-issue is exported as a LABELS constant matching the canonical bootstrap row', () => {
  assert.strictEqual(LABELS.PARENT_ISSUE, 'parent-issue');
  assert.ok(
    canonicalLabelsFromBootstrapDoc().some(([name]) => name === LABELS.PARENT_ISSUE),
    'parent-issue must carry a canonical LABELS_JSON row so `gh label create` bootstraps it',
  );
});

test('breaking is bootstrappable with a description within the cap and exported as LABELS.BREAKING (#2251)', () => {
  const row = canonicalLabelsFromBootstrapDoc().find(([name]) => name === 'breaking');
  assert.ok(row, 'label-bootstrap.md must carry breaking in LABELS_JSON');
  const [, description] = row;
  const payload = ensureLabelPayload('breaking', description);
  assert.strictEqual(payload.name, 'breaking');
  assert.ok(payload.description.length <= 100);
  assert.strictEqual(LABELS.BREAKING, 'breaking');
});

// Reads skills/_shared/label-bootstrap.md's own "Canonical LABELS_JSON" fence live, so this
// test can never silently drift from the descriptions every real `gh label create` bootstrap
// flow actually uses (see the [reuse] finding this replaces — 7 of these rows used to be
// hand-copied verbatim from that file instead of read from it).
function canonicalLabelsFromBootstrapDoc() {
  const docPath = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', '_shared', 'label-bootstrap.md');
  const md = fs.readFileSync(docPath, 'utf8');
  const match = md.match(/## Canonical LABELS_JSON[\s\S]*?```js\n([\s\S]*?)\n```/);
  assert.ok(match, `labels.test.js: could not locate the Canonical LABELS_JSON fence in ${docPath}`);
  return JSON.parse(match[1]);
}

// Every real label description this plan introduces or keeps must pass — a single place
// that would have caught the bot:in-progress (commit 54ab897) and code-health:*
// criterion (this plan's Task 3) 100-char overruns before they shipped.
// The by:*/risk:*/size:*/ceremony:*/parked/ready/auto:*/bot:*/demo:*/wontfix/priority:*
// rows come from label-bootstrap.md's live canonical LABELS_JSON below — that supersedes the
// six retired code-health:risk-*/code-health:effort-* rows this array used to hand-check
// (no code anywhere emits those anymore; see the [cross-file] finding this replaces) and adds
// the risk:*/size:*/by:* cap coverage those retired rows never carried. The health-engine
// diagnostic labels below are not part of that shared taxonomy and stay hand-typed here.
const REAL_LABEL_DESCRIPTIONS = [
  ['code-health', 'Filed by the code-health engine — a systematic maintainability finding'],
  ['harness-health', 'Filed by the harness-health engine — a plugin harness maintenance finding'],
  ['harness-health:additive', 'Safe, mechanical patch — additive change with no removed behavior'],
  ['harness-health:restructural', 'Structural change requiring human review before applying'],
  ['harness-health:new-skill', 'Proposes a new skill candidate surfaced by harness-health'],
  ...canonicalLabelsFromBootstrapDoc(),
];

test('every real label description used across the skill tree stays under the cap', () => {
  for (const [name, description] of REAL_LABEL_DESCRIPTIONS) {
    assert.doesNotThrow(() => ensureLabelPayload(name, description), `${name}: "${description}" (${description.length} chars)`);
  }
});
