const { test } = require('node:test');
const assert = require('node:assert');
const { toIssuePayload } = require('../../../plugin/bin/lib/code-health/issue-payload');

const FINDING = {
  id: 'codehealth-abc12345',
  title: 'Oversized file: big.js (700 lines)',
  lens: 'oversized-file',
  category: 'architecture',
  severity: 'high',
  confidence: 'high',
  area: 'apps/web',
  files: ['apps/web/big.js'],
  evidence: 'apps/web/big.js has 700 lines, exceeding the 300-line threshold.',
  suggestion: 'Break big.js into smaller modules.',
  acceptance: 'No module exceeds 300 lines, or the threshold is documented.',
};

test('labels are code-health + code-health:<severity>', () => {
  assert.deepStrictEqual(toIssuePayload(FINDING).labels, ['code-health', 'code-health:high']);
});

test('title is the finding title', () => {
  assert.strictEqual(toIssuePayload(FINDING).title, 'Oversized file: big.js (700 lines)');
});

test('body embeds the fingerprint marker so it can be re-extracted for dedup', () => {
  const { body } = toIssuePayload(FINDING);
  assert.ok(body.includes('<!-- code-health-fingerprint: codehealth-abc12345 -->'));
});

test('body carries /specify-shaped sections sourced from the finding', () => {
  const { body } = toIssuePayload(FINDING);
  assert.ok(body.includes('## Current State'));
  assert.ok(body.includes('apps/web/big.js'));                 // files
  assert.ok(body.includes('has 700 lines'));                   // evidence
  assert.ok(body.includes('## Deliverables'));
  assert.ok(body.includes('Break big.js into smaller modules.')); // suggestion
  assert.ok(body.includes('## Acceptance Criteria'));
  assert.ok(body.includes('No module exceeds 300 lines'));     // acceptance
});

// The marker is the dedup contract: the skill reads issue bodies and matches this.
test('the fingerprint can be re-extracted from the body with a stable regex', () => {
  const { body } = toIssuePayload(FINDING);
  const m = body.match(/<!--\s*code-health-fingerprint:\s*(codehealth-[0-9a-f]{8})\s*-->/);
  assert.strictEqual(m[1], 'codehealth-abc12345');
});

// ── v2 issue payload ───────────────────────────────────────────────────────

const { toIssuePayloadV2 } = require('../../../plugin/bin/lib/code-health/issue-payload');

const V2_FINDING = {
  id: 'codehealth-ab12cd34',
  criterion: 'simplification',
  areaId: 'src/api',
  anchor: 'src/api/user.js#getUser',
  severity: 'medium',
  confidence: 'high',
  likelihood: 'high',
  effort: 'low',
  risk: 'high',
  title: 'getUser is a passthrough to the repository',
  evidence: 'src/api/user.js#getUser delegates directly to UserRepository.find with no added logic.',
  suggestedApproach: 'Inline the call at the call site, or add caching/auth in this method.',
  acceptance: 'getUser adds caching, authorization, or enrichment; or is removed.',
};

test('v2 labels are by:code-health + risk:<tier> + size:<tier> + ready (no per-criterion label)', () => {
  assert.deepStrictEqual(
    toIssuePayloadV2(V2_FINDING).labels,
    ['by:code-health', 'risk:high', 'size:low', 'ready'],
  );
});

test('v2 payload carries type: task', () => {
  assert.strictEqual(toIssuePayloadV2(V2_FINDING).type, 'task');
});

test('v2 body header line shows severity, likelihood, effort, risk, and confidence', () => {
  const { body } = toIssuePayloadV2(V2_FINDING);
  assert.ok(body.includes('**Risk:** high'), 'risk missing from body header');
  assert.ok(body.includes('**Severity:** medium'), 'severity missing from body header');
  assert.ok(body.includes('**Likelihood:** high'), 'likelihood missing from body header');
  assert.ok(body.includes('**Effort:** low'), 'effort missing from body header');
  assert.ok(body.includes('**Confidence:** high'), 'confidence missing from body header');
});

test('v2 title is the finding title', () => {
  assert.strictEqual(toIssuePayloadV2(V2_FINDING).title, V2_FINDING.title);
});

test('v2 body embeds the work-fingerprint marker (not the legacy code-health-fingerprint marker)', () => {
  const { body } = toIssuePayloadV2(V2_FINDING);
  assert.ok(body.includes('<!-- work-fingerprint: codehealth-ab12cd34 -->'), 'marker missing');
  assert.ok(!body.includes('code-health-fingerprint'), 'legacy marker must not be emitted');
});

test('v2 body starts directly with the header line (no leading marker or blank line)', () => {
  const { body } = toIssuePayloadV2(V2_FINDING);
  assert.ok(body.startsWith('**Criterion:**'), `body should start with the header line, got: ${body.slice(0, 50)}`);
});

test('v2 body has ## Current State containing anchor and evidence', () => {
  const { body } = toIssuePayloadV2(V2_FINDING);
  assert.ok(body.includes('## Current State'), '## Current State missing');
  assert.ok(body.includes('src/api/user.js#getUser'), 'anchor missing');
  assert.ok(body.includes('delegates directly to UserRepository.find'), 'evidence missing');
});

test('v2 body has ## Deliverables containing suggestedApproach', () => {
  const { body } = toIssuePayloadV2(V2_FINDING);
  assert.ok(body.includes('## Deliverables'), '## Deliverables missing');
  assert.ok(body.includes('Inline the call at the call site'), 'suggestedApproach missing');
});

test('v2 body has ## Release Note with a plain "no user-visible change" phrasing (#2660)', () => {
  const { body } = toIssuePayloadV2(V2_FINDING);
  assert.ok(body.includes('## Release Note'), '## Release Note missing');
  assert.ok(body.includes('No user-visible change — internal code-quality fix.'), 'release note text missing');
});

test('v2 body has ## Acceptance Criteria containing acceptance', () => {
  const { body } = toIssuePayloadV2(V2_FINDING);
  assert.ok(body.includes('## Acceptance Criteria'), '## Acceptance Criteria missing');
  assert.ok(body.includes('adds caching, authorization'), 'acceptance missing');
});

test('v2 fingerprint marker is re-extractable with extractFingerprint', () => {
  const { extractFingerprint } = require('../../../plugin/bin/lib/issues/record');
  const { body } = toIssuePayloadV2(V2_FINDING);
  assert.strictEqual(extractFingerprint(body), 'codehealth-ab12cd34');
});

test('toIssuePayload (v1) still works after extending the module', () => {
  // Guard: existing v1 export must be unaffected.
  const { toIssuePayload: v1 } = require('../../../plugin/bin/lib/code-health/issue-payload');
  const FINDING = {
    id: 'codehealth-abc12345', title: 'T', lens: 'oversized-file', category: 'architecture',
    severity: 'high', confidence: 'high', area: 'apps/web',
    files: ['apps/web/big.js'], evidence: 'E', suggestion: 'S', acceptance: 'A',
  };
  const p = v1(FINDING);
  assert.ok(p.body.includes('<!-- code-health-fingerprint: codehealth-abc12345 -->'));
  assert.deepStrictEqual(p.labels, ['code-health', 'code-health:high']);
});

// legacy: v1's footer is frozen — this documents the contract, not a live convention.
test('toIssuePayload (v1) footer stays the unqualified legacy form', () => {
  const { body } = toIssuePayload(FINDING);
  assert.ok(body.includes('_Filed by `/code-health`.'), 'v1 footer must stay unqualified (frozen legacy behavior)');
});

test('v2 footer cites the fully-qualified command name', () => {
  const { body } = toIssuePayloadV2(V2_FINDING);
  assert.ok(body.includes('_Filed by `/claude-tweaks:code-health`.'), 'v2 footer must use the qualified command name');
});

// ── relatedAnchors rendering (bundled findings) ──────────────────────────────

test('v2 body includes an "Also affects" line when relatedAnchors is present', () => {
  const finding = { ...V2_FINDING, relatedAnchors: ['src/api/other.js#getOther', 'src/api/third.js#getThird'] };
  const { body } = toIssuePayloadV2(finding);
  assert.ok(body.includes('Also affects:'), 'missing Also affects block');
  assert.ok(body.includes('`src/api/other.js#getOther`'));
  assert.ok(body.includes('`src/api/third.js#getThird`'));
});

test('v2 body omits "Also affects" when relatedAnchors is absent', () => {
  const { body } = toIssuePayloadV2(V2_FINDING);
  assert.ok(!body.includes('Also affects:'));
});

test('v2 body omits "Also affects" when relatedAnchors is an empty array', () => {
  const { body } = toIssuePayloadV2({ ...V2_FINDING, relatedAnchors: [] });
  assert.ok(!body.includes('Also affects:'));
});

// ── freshness stamp (#117) ──────────────────────────────────────────────────

test('toIssuePayloadV2 with no verifiedAsOf argument omits the stamp (existing callers unaffected)', () => {
  const { body } = toIssuePayloadV2(V2_FINDING);
  assert.ok(!body.includes('Verified-as-of:'));
});

test('toIssuePayloadV2 threads verifiedAsOf through to the composed body', () => {
  const { extractVerifiedAsOf } = require('../../../plugin/bin/lib/issues/record');
  const { body } = toIssuePayloadV2(V2_FINDING, 'abc1234');
  assert.strictEqual(extractVerifiedAsOf(body), 'abc1234');
});

test('legacy toIssuePayload (v1) never carries a verifiedAsOf param — frozen shape unaffected', () => {
  // v1 is a historical fixed shape (see the frozen-legacy comment at its
  // definition) — it is not called by bin/code-health.js and must not gain
  // this feature, so this only proves it still ignores an extra argument
  // rather than throwing.
  const { toIssuePayload } = require('../../../plugin/bin/lib/code-health/issue-payload');
  const { body } = toIssuePayload(FINDING);
  assert.ok(!body.includes('Verified-as-of:'));
});
