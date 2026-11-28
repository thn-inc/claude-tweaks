const { test } = require('node:test');
const assert = require('node:assert');
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

test('AC4.1: toIssuePayloadV2 lists the anchor path under ### Key Files', () => {
  const { extractKeyFilesSection } = require('../../../plugin/bin/lib/issues/grouping');
  const { body } = toIssuePayloadV2(V2_FINDING);
  assert.ok(body.includes('### Key Files\n\n- `src/api/user.js` — address the finding at this anchor'));
  assert.deepStrictEqual(extractKeyFilesSection(body), ['src/api/user.js']);
});

test('toIssuePayloadV2 with a malformed anchor still produces a payload, omitting Technical Approach', () => {
  for (const anchor of ['#Sym', '`src/a.js`#foo', '../x.js', 'src/../x.js#foo', '/abs/x.js#foo', 'C:\\abs\\x.js']) {
    const payload = toIssuePayloadV2({ ...V2_FINDING, anchor });
    assert.ok(payload.body.includes('## Current State'), `payload missing for anchor ${anchor}`);
    assert.ok(!payload.body.includes('## Technical Approach'), `Technical Approach present for anchor ${anchor}`);
  }
});

// #6374: evidence is free text that lands unfenced in the body, so a `Blocked by: … (left for …)`
// line on its own line reaches recordPayload's withhold. The filing prose applies payload.labels
// whole (never a literal `--label ready`), so the withhold is what decides whether `ready` is filed.
test('a symbolic Blocked by line in evidence keeps ready out of payload.labels', () => {
  const { SYMBOLIC_LINE, SYMBOLIC_REF } = require('../../helpers/symbolic-blocker-fixture');
  const held = toIssuePayloadV2({ ...V2_FINDING, evidence: `${V2_FINDING.evidence}\n${SYMBOLIC_LINE}\nThe rest of the evidence.` });
  assert.ok(held.body.split('\n').includes(SYMBOLIC_LINE), 'control: the line is on its own line in the body');
  assert.deepStrictEqual(held.labels, ['by:code-health', 'risk:high', 'size:low'], 'every label but ready is kept');
  assert.ok(!held.labels.includes('ready'));
  assert.deepStrictEqual(held.readyWithheld, [SYMBOLIC_REF]);
  // the same line quoted in a code span does not hold ready
  const quoted = toIssuePayloadV2({ ...V2_FINDING, evidence: `${V2_FINDING.evidence} Quoted: \`${SYMBOLIC_LINE}\`` });
  assert.ok(quoted.labels.includes('ready'));
  assert.ok(!('readyWithheld' in quoted));
});
