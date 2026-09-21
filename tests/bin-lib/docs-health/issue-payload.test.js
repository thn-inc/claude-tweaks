const { test } = require('node:test');
const assert = require('node:assert');
const { toIssuePayload } = require('../../../plugin/bin/lib/docs-health/issue-payload');
const { extractFingerprint, extractVerifiedAsOf } = require('../../../plugin/bin/lib/issues/record');

function finding(overrides = {}) {
  return {
    id: 'docshealth-abc12345',
    target: 'decisions/0007-foo',
    assetType: 'doc',
    section: 'Freshness',
    category: 'staleness',
    misleads: 'agent',
    classification: 'restructural',
    confidence: 'high',
    reversibility: 'med',
    description: 'Stated skill count is stale',
    oldString: 'This project ships 12 skills.',
    newString: 'This project ships 14 skills.',
    reason: 'A live count of skills/*/SKILL.md returns 14, not 12.',
    ...overrides,
  };
}

test('toIssuePayload for a restructural finding maps classification to risk:medium/size:high, ready, and appends the diagnostic label last', () => {
  const payload = toIssuePayload(finding());
  assert.deepStrictEqual(payload.labels, ['by:docs-health', 'risk:medium', 'size:high', 'ready', 'docs-health:restructural']);
  assert.ok(payload.title.includes('decisions/0007-foo'));
  assert.ok(payload.body.includes('12 skills'));
  assert.ok(payload.body.includes('14 skills'));
});

test('toIssuePayload for an additive finding maps classification to risk:low/size:low', () => {
  const payload = toIssuePayload(finding({ classification: 'additive' }));
  assert.deepStrictEqual(payload.labels, ['by:docs-health', 'risk:low', 'size:low', 'ready', 'docs-health:additive']);
});

test('toIssuePayload carries type: task', () => {
  assert.strictEqual(toIssuePayload(finding()).type, 'task');
});

test('toIssuePayload body embeds the work-fingerprint marker, re-extractable with extractFingerprint', () => {
  const payload = toIssuePayload(finding());
  assert.ok(payload.body.includes('<!-- work-fingerprint: docshealth-abc12345 -->'));
  assert.strictEqual(extractFingerprint(payload.body), 'docshealth-abc12345');
});

test('toIssuePayload body starts directly with the header line', () => {
  const payload = toIssuePayload(finding());
  assert.ok(payload.body.startsWith('**Doc:**'), `expected body to start with the header line, got: ${payload.body.slice(0, 40)}`);
});

test('toIssuePayload body always includes Current State, Deliverables, Acceptance Criteria, and Release Note sections', () => {
  const payload = toIssuePayload(finding());
  assert.ok(payload.body.includes('## Current State'));
  assert.ok(payload.body.includes('## Deliverables'));
  assert.ok(payload.body.includes('## Acceptance Criteria'));
  assert.ok(payload.body.includes('## Release Note'));
});

test('toIssuePayload body Release Note is a plain "no user-visible change" phrasing (#2660)', () => {
  const payload = toIssuePayload(finding());
  assert.ok(payload.body.includes('No user-visible change — documentation accuracy fix.'));
});

test('toIssuePayload carries structured decision fields matching the input finding', () => {
  const f = finding();
  const payload = toIssuePayload(f);
  assert.strictEqual(payload.id, f.id);
  assert.strictEqual(payload.target, f.target);
  assert.strictEqual(payload.assetType, f.assetType);
  assert.strictEqual(payload.category, f.category);
  assert.strictEqual(payload.misleads, f.misleads);
  assert.strictEqual(payload.section, f.section);
  assert.strictEqual(payload.classification, f.classification);
  assert.strictEqual(payload.confidence, f.confidence);
  assert.strictEqual(payload.reversibility, f.reversibility);
});

// The patch text has exactly one carrier: payload.body's fenced Current/Proposed
// blocks (the markdown that actually ships to GitHub). Duplicating it as
// top-level fields made a payload with ~2.6 KB of patch text 38% duplicate
// bytes, uncapped across the findings array.
test('toIssuePayload does not duplicate the patch text as top-level fields', () => {
  const f = finding();
  const payload = toIssuePayload(f);
  assert.ok(!('oldString' in payload), 'oldString must not be a top-level payload field — body already carries it');
  assert.ok(!('newString' in payload), 'newString must not be a top-level payload field — body already carries it');
  // body remains the carrier, so the patch text is never actually lost.
  assert.ok(payload.body.includes(f.oldString), 'body must still carry oldString verbatim');
  assert.ok(payload.body.includes(f.newString), 'body must still carry newString verbatim');
  assert.strictEqual(
    JSON.stringify(payload).split(f.newString).length - 1, 1,
    'newString must appear exactly once in the serialized payload',
  );
});

test('toIssuePayload top-level shape matches journey-health/code-health (no patch-text fields)', () => {
  const payload = toIssuePayload(finding());
  assert.deepStrictEqual(Object.keys(payload).sort(), [
    'assetType', 'body', 'category', 'classification', 'confidence', 'id',
    'labels', 'misleads', 'relatedSections', 'reversibility', 'section',
    'target', 'title', 'type',
  ]);
});

test('toIssuePayload title reflects category and misleads', () => {
  const payload = toIssuePayload(finding({ category: 'genre-drift', misleads: 'both' }));
  assert.ok(payload.title.startsWith('Doc genre-drift:'), payload.title);
  assert.ok(payload.body.includes('human engineer'), 'misleads:both must render both personas in the body');
  assert.ok(payload.body.includes('coding agent'));
});

// ── relatedSections rendering (bundled findings) ─────────────────────────────

test('toIssuePayload body includes an "Also affects" line when relatedSections is present', () => {
  const payload = toIssuePayload(finding({ relatedSections: ['Auto-detect Patterns', 'Research Directory'] }));
  assert.ok(payload.body.includes('Also affects:'), 'missing Also affects block');
  assert.ok(payload.body.includes('`Auto-detect Patterns`'));
  assert.ok(payload.body.includes('`Research Directory`'));
});

test('toIssuePayload body omits "Also affects" when relatedSections is absent', () => {
  const payload = toIssuePayload(finding());
  assert.ok(!payload.body.includes('Also affects:'));
});

test('toIssuePayload body omits "Also affects" when relatedSections is an empty array', () => {
  const payload = toIssuePayload(finding({ relatedSections: [] }));
  assert.ok(!payload.body.includes('Also affects:'));
});

// ── fenced Current/Proposed blocks (a nested ``` in oldString/newString must
//    not prematurely close the outer fence) ─────────────────────────────────

test('toIssuePayload widens the Current/Proposed fence when oldString or newString itself contains a ``` fenced block', () => {
  const oldString = 'Example:\n```bash\necho hi\n```\nEnd.';
  const newString = 'Example:\n```bash\necho bye\n```\nEnd.';
  const payload = toIssuePayload(finding({ oldString, newString }));

  const currentMatch = payload.body.match(/\*\*Current:\*\*\n(`{4,})\n/);
  assert.ok(currentMatch, `expected a >=4-backtick opening fence around Current, got: ${payload.body.slice(0, 200)}`);
  const proposedMatch = payload.body.match(/\*\*Proposed:\*\*\n(`{4,})\n/);
  assert.ok(proposedMatch, `expected a >=4-backtick opening fence around Proposed, got: ${payload.body}`);

  assert.ok(payload.body.includes(oldString), 'oldString with its own ``` block must be preserved verbatim');
  assert.ok(payload.body.includes(newString), 'newString with its own ``` block must be preserved verbatim');
});

test('toIssuePayload uses the minimal 3-backtick fence when oldString/newString contain no backticks', () => {
  const payload = toIssuePayload(finding({ oldString: 'plain old text', newString: 'plain new text' }));
  assert.ok(payload.body.includes('**Current:**\n```\nplain old text\n```'));
  assert.ok(payload.body.includes('**Proposed:**\n```\nplain new text\n```'));
});

// ── CLASSIFICATION_SCORING lookup must degrade gracefully, not throw ────────
// Regression: an unmapped classification used to be dereferenced directly
// (scoring.risk/scoring.size), throwing a TypeError instead of degrading
// to risk/size: undefined the way harness-health/issue-payload.js's
// identical lookup already does. Unreachable through the real validated
// pipeline today (docs-health's CLASSIFICATION_VALUES matches
// CLASSIFICATION_SCORING's two keys exactly), but toIssuePayload itself must
// not crash on an out-of-map value from any caller that bypasses validation.

test('toIssuePayload does not throw for a classification absent from CLASSIFICATION_SCORING, and omits risk/size labels', () => {
  const payload = toIssuePayload(finding({ classification: 'cosmetic' }));
  assert.ok(!payload.labels.some((l) => l.startsWith('risk:')), 'risk label must be omitted, not a stale/wrong value');
  assert.ok(!payload.labels.some((l) => l.startsWith('size:')), 'size label must be omitted, not a stale/wrong value');
  assert.ok(payload.labels.includes('docs-health:cosmetic'));
});

// ── CATEGORY_LABELS must cover every CATEGORY_VALUES entry ───────────────────
// Regression: CATEGORY_LABELS previously only covered 2 of the 4 values
// validate-finding.js's CATEGORY_VALUES allows ('depth-mismatch' and
// 'findability' were missing) — a hand-maintained map silently drifted out
// of sync with its own enum. Exercises the title-generation path for every
// declared category so a future desynchronization (a new category added to
// one file but not the other) is caught here, not just by an identity
// fallback that happens to produce the same string today.

test('toIssuePayload title reflects the depth-mismatch category', () => {
  const payload = toIssuePayload(finding({ category: 'depth-mismatch' }));
  assert.ok(payload.title.startsWith('Doc depth-mismatch:'), payload.title);
});

test('toIssuePayload title reflects the findability category', () => {
  const payload = toIssuePayload(finding({ category: 'findability' }));
  assert.ok(payload.title.startsWith('Doc findability:'), payload.title);
});

// ── freshness stamp (#117) ──────────────────────────────────────────────────

test('toIssuePayload with no verifiedAsOf argument omits the stamp (existing callers unaffected)', () => {
  const payload = toIssuePayload(finding());
  assert.ok(!payload.body.includes('Verified-as-of:'));
});

test('toIssuePayload threads verifiedAsOf through to the composed body', () => {
  const payload = toIssuePayload(finding(), 'abc1234');
  assert.strictEqual(extractVerifiedAsOf(payload.body), 'abc1234');
});
