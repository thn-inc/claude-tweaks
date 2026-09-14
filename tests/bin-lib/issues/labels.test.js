// tests/bin-lib/issues/labels.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ensureLabelPayload } = require('../../../plugin/bin/lib/issues/labels');
const { LABELS } = require('../../../plugin/bin/lib/issues/record');

test('returns { name, description, color } for a valid description and color', () => {
  assert.deepStrictEqual(
    ensureLabelPayload('by:capture', 'Origin: filed via /capture', 'BFD4F2'),
    { name: 'by:capture', description: 'Origin: filed via /capture', color: 'BFD4F2' },
  );
});

test('accepts a description of exactly 100 characters', () => {
  const d = 'x'.repeat(100);
  assert.deepStrictEqual(ensureLabelPayload('x', d, 'AABBCC'), { name: 'x', description: d, color: 'AABBCC' });
});

test('throws for a description of 101 characters', () => {
  const d = 'x'.repeat(101);
  assert.throws(() => ensureLabelPayload('x', d, 'AABBCC'), /100 chars/);
});

test('throws when description is not a string', () => {
  assert.throws(() => ensureLabelPayload('x', undefined, 'AABBCC'), /must be a string/);
  assert.throws(() => ensureLabelPayload('x', 42, 'AABBCC'), /must be a string/);
});

test('error message names the label', () => {
  assert.throws(() => ensureLabelPayload('code-health:review-quality', 'x'.repeat(101), 'AABBCC'), /code-health:review-quality/);
});

// #1873: color is a required third field — six hex digits, no leading #.
test('throws when color is missing', () => {
  assert.throws(() => ensureLabelPayload('x', 'd'), /color is required/);
});

test('throws when color is malformed (wrong length, non-hex, or a leading #)', () => {
  assert.throws(() => ensureLabelPayload('x', 'd', 'ABC'), /six hex digits/);
  assert.throws(() => ensureLabelPayload('x', 'd', 'GGGGGG'), /six hex digits/);
  assert.throws(() => ensureLabelPayload('x', 'd', '#AABBCC'), /six hex digits/);
  assert.throws(() => ensureLabelPayload('x', 'd', 'AABBCCDD'), /six hex digits/);
});

test('lowercase-normalizes color to uppercase', () => {
  assert.strictEqual(ensureLabelPayload('x', 'd', 'aabbcc').color, 'AABBCC');
});

test('solution:unjustified is bootstrappable with a description within the cap', () => {
  // Read the description/color from the canonical fence (see
  // canonicalLabelsFromBootstrapDoc below) instead of hand-copying it, so a
  // future edit to that source that pushes the description over the cap (or
  // drops the color) fails here rather than drifting silently.
  const row = canonicalLabelsFromBootstrapDoc().find(([name]) => name === 'solution:unjustified');
  assert.ok(row, 'label-bootstrap.md must carry solution:unjustified in LABELS_JSON');
  const [, description, color] = row;
  const payload = ensureLabelPayload('solution:unjustified', description, color);
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
  const [, description, color] = row;
  const payload = ensureLabelPayload('breaking', description, color);
  assert.strictEqual(payload.name, 'breaking');
  assert.ok(payload.description.length <= 100);
  assert.strictEqual(LABELS.BREAKING, 'breaking');
});

// #1873: every canonical LABELS_JSON entry is a [name, description, color]
// triple with a valid color, and the graded dimensions (risk/priority/size)
// follow the stated red -> amber -> green / dark -> light order.
test('every canonical LABELS_JSON entry is a triple with a valid six-hex-digit color', () => {
  const COLOR_RE = /^[0-9A-Fa-f]{6}$/;
  for (const row of canonicalLabelsFromBootstrapDoc()) {
    assert.strictEqual(row.length, 3, `expected a [name, description, color] triple, got ${JSON.stringify(row)}`);
    const [name, , color] = row;
    assert.match(color, COLOR_RE, `${name}: color "${color}" must be six hex digits, no leading #`);
  }
});

test('the graded risk/priority/size families follow the stated convention order and reuse the medium amber (#1873)', () => {
  const byName = Object.fromEntries(canonicalLabelsFromBootstrapDoc().map(([n, , c]) => [n, c]));
  assert.strictEqual(byName['risk:high'], 'D93F0B');
  assert.strictEqual(byName['risk:medium'], 'FBCA04');
  assert.strictEqual(byName['risk:low'], '0E8A16');
  assert.strictEqual(byName['priority:high'], 'B60205');
  assert.strictEqual(byName['priority:medium'], 'FBCA04');
  assert.strictEqual(byName['priority:low'], 'C2E0C6');
  assert.strictEqual(byName['size:high'], '5319E7');
  assert.strictEqual(byName['size:medium'], '8B5CF6');
  assert.strictEqual(byName['size:low'], 'D4C5F9');
  // risk:medium and priority:medium share the exact amber — a deliberate
  // cross-family reuse for the "medium" semantic, not an oversight.
  assert.strictEqual(byName['risk:medium'], byName['priority:medium']);
});

// Reads skills/_shared/label-bootstrap.md's own "Canonical LABELS_JSON" fence live, so this
// test can never silently drift from the descriptions/colors every real `gh label create`
// bootstrap flow actually uses (see the [reuse] finding this replaces — 7 of these rows used to
// be hand-copied verbatim from that file instead of read from it).
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
// diagnostic labels below are not part of that shared taxonomy (never bootstrapped through this
// module's color-carrying loop — they're applied directly on issue creation, see
// bin/lib/code-health/issue-payload.js) and stay hand-typed here; a placeholder color is
// supplied only so this cap-coverage check can call ensureLabelPayload's now-3-arg signature.
const REAL_LABEL_DESCRIPTIONS = [
  ['code-health', 'Filed by the code-health engine — a systematic maintainability finding', 'EDEDED'],
  ['harness-health', 'Filed by the harness-health engine — a plugin harness maintenance finding', 'EDEDED'],
  ['harness-health:additive', 'Safe, mechanical patch — additive change with no removed behavior', 'EDEDED'],
  ['harness-health:restructural', 'Structural change requiring human review before applying', 'EDEDED'],
  ['harness-health:new-skill', 'Proposes a new skill candidate surfaced by harness-health', 'EDEDED'],
  ...canonicalLabelsFromBootstrapDoc(),
];

test('every real label description used across the skill tree stays under the cap', () => {
  for (const [name, description, color] of REAL_LABEL_DESCRIPTIONS) {
    assert.doesNotThrow(() => ensureLabelPayload(name, description, color), `${name}: "${description}" (${description.length} chars)`);
  }
});
