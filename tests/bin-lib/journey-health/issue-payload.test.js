const { test } = require('node:test');
const assert = require('node:assert');
const { toIssuePayload } = require('../../../plugin/bin/lib/journey-health/issue-payload');
const { extractFingerprint, extractVerifiedAsOf } = require('../../../plugin/bin/lib/issues/record');

function finding(overrides = {}) {
  return {
    id: 'journeyhealth-abc12345',
    journey: 'checkout-flow',
    category: 'drift',
    section: 'files-frontmatter',
    description: 'files: entry no longer exists',
    reason: 'src/checkout/OldCart.tsx was deleted in a1b2c3d',
    confidence: 'high',
    severity: 'high',
    recommendation: 'Run /claude-tweaks:journeys checkout-flow',
    ...overrides,
  };
}

// ── severity -> risk axis fold (spec 15) ────────────────────────────────────

test('toIssuePayload for a drift finding (type task) maps severity high to risk:high/size:medium, ready, and appends the diagnostic label last', () => {
  const payload = toIssuePayload(finding()); // category: 'drift', severity: 'high'
  assert.deepStrictEqual(payload.labels, ['by:journey-health', 'risk:high', 'size:medium', 'ready', 'journey-health:drift']);
  assert.strictEqual(payload.type, 'task');
});

test('toIssuePayload for a regression-suspected finding (type bug) maps severity med to risk:medium/size:medium', () => {
  const payload = toIssuePayload(finding({ category: 'regression-suspected', section: 'live-check', severity: 'med' }));
  assert.deepStrictEqual(payload.labels, ['by:journey-health', 'risk:medium', 'size:medium', 'ready', 'journey-health:regression-suspected']);
  assert.strictEqual(payload.type, 'bug');
});

test('toIssuePayload maps severity low to risk:low', () => {
  const payload = toIssuePayload(finding({ severity: 'low' }));
  assert.ok(payload.labels.includes('risk:low'));
});

test('toIssuePayload types a coverage finding as task', () => {
  const payload = toIssuePayload(finding({ category: 'coverage', section: 'coverage' }));
  assert.strictEqual(payload.type, 'task');
  assert.ok(payload.labels.includes('journey-health:coverage'));
});

test('toIssuePayload always files size:medium regardless of severity', () => {
  for (const severity of ['high', 'med', 'low']) {
    assert.ok(toIssuePayload(finding({ severity })).labels.includes('size:medium'));
  }
});

test('toIssuePayload is born-ready', () => {
  assert.ok(toIssuePayload(finding()).labels.includes('ready'));
});

test('toIssuePayload never emits a journey-health:<severity> label', () => {
  const payload = toIssuePayload(finding());
  assert.ok(
    !payload.labels.some((l) => ['journey-health:high', 'journey-health:med', 'journey-health:low'].includes(l)),
    'severity must fold into risk:*, not its own journey-health:<severity> label',
  );
});

// validate-finding.js's SEVERITY_VALUES already restricts finding.severity to exactly
// high|med|low before a finding ever reaches toIssuePayload through the real
// validate-findings pipeline, so an unmapped severity is unreachable there. This documents
// the actual (non-throwing) behavior for a direct/bypassing caller: recordPayload treats
// the resulting undefined risk as "not supplied" — same as harness-health's unscored
// new-skill findings — rather than fabricating a default tier.
test('an unmapped severity omits the risk label rather than fabricating a default tier', () => {
  const payload = toIssuePayload(finding({ severity: 'critical' }));
  assert.ok(!payload.labels.some((l) => l.startsWith('risk:')), 'unmapped severity must not invent a risk label');
  assert.ok(payload.labels.includes('by:journey-health'));
  assert.ok(payload.labels.includes('ready'));
});

// ── fingerprint marker (work-fingerprint, not the legacy marker) ───────────

test('toIssuePayload body embeds the work-fingerprint marker, not the legacy journey-health-fingerprint marker', () => {
  const payload = toIssuePayload(finding());
  assert.ok(payload.body.includes('<!-- work-fingerprint: journeyhealth-abc12345 -->'));
  assert.ok(!payload.body.includes('journey-health-fingerprint'), 'legacy marker must not be emitted');
});

test('the fingerprint marker is re-extractable with extractFingerprint', () => {
  const payload = toIssuePayload(finding());
  assert.strictEqual(extractFingerprint(payload.body), 'journeyhealth-abc12345');
});

test('toIssuePayload body starts directly with the header line (no leading marker or blank line)', () => {
  const payload = toIssuePayload(finding());
  assert.ok(payload.body.startsWith('**Journey:**'), `expected body to start with the header line, got: ${payload.body.slice(0, 40)}`);
});

// ── body recomposition: Current State / Deliverables / Acceptance Criteria ─

test('toIssuePayload body carries the spec-shaped sections, not the retired ones', () => {
  const payload = toIssuePayload(finding());
  assert.ok(payload.body.includes('## Current State'));
  assert.ok(payload.body.includes('## Deliverables'));
  assert.ok(payload.body.includes('## Acceptance Criteria'));
  assert.ok(payload.body.includes('## Release Note'));
  assert.ok(!payload.body.includes('## Description'));
  assert.ok(!payload.body.includes('## Evidence'));
  assert.ok(!payload.body.includes('## Recommended Action'));
});

// ── Release Note (#2660) ────────────────────────────────────────────────────

test('toIssuePayload Release Note names the fixed journey for a regression-suspected (bug) finding', () => {
  const payload = toIssuePayload(finding({ category: 'regression-suspected', section: 'live-check' }));
  assert.ok(payload.body.includes('## Release Note\n\nFixed a broken user journey: checkout-flow.'));
});

test('toIssuePayload Release Note is a plain "no user-visible change" phrasing for drift/coverage (task) findings', () => {
  const drift = toIssuePayload(finding({ category: 'drift' }));
  assert.ok(drift.body.includes('No user-visible change — journey documentation/coverage maintenance.'));
  const coverage = toIssuePayload(finding({ category: 'coverage', section: 'coverage' }));
  assert.ok(coverage.body.includes('No user-visible change — journey documentation/coverage maintenance.'));
});

test('toIssuePayload includes description and reason under Current State, recommendation under Deliverables, in order', () => {
  const payload = toIssuePayload(finding());
  assert.ok(payload.body.includes('files: entry no longer exists'));
  assert.ok(payload.body.includes('src/checkout/OldCart.tsx was deleted in a1b2c3d'));
  assert.ok(payload.body.includes('Run /claude-tweaks:journeys checkout-flow'));

  const currentStateIdx = payload.body.indexOf('## Current State');
  const descriptionIdx = payload.body.indexOf('files: entry no longer exists');
  const reasonIdx = payload.body.indexOf('src/checkout/OldCart.tsx was deleted in a1b2c3d');
  const deliverablesIdx = payload.body.indexOf('## Deliverables');
  const recommendationIdx = payload.body.indexOf('Run /claude-tweaks:journeys checkout-flow');
  const acceptanceIdx = payload.body.indexOf('## Acceptance Criteria');

  assert.ok(currentStateIdx < descriptionIdx);
  assert.ok(descriptionIdx < reasonIdx);
  assert.ok(reasonIdx < deliverablesIdx);
  assert.ok(deliverablesIdx < recommendationIdx);
  assert.ok(recommendationIdx < acceptanceIdx);
});

test('toIssuePayload synthesizes the exact Acceptance Criteria line', () => {
  const payload = toIssuePayload(finding({ journey: 'checkout-flow' }));
  assert.ok(payload.body.includes(
    "The condition described above is resolved: a fresh `/claude-tweaks:journey-health` audit of journey 'checkout-flow' files no finding with this fingerprint.",
  ));
});

test('toIssuePayload synthesized Acceptance Criteria line uses the finding-specific journey name', () => {
  const payload = toIssuePayload(finding({ journey: 'signup-flow' }));
  assert.ok(payload.body.includes("audit of journey 'signup-flow' files no finding with this fingerprint."));
});

test('toIssuePayload keeps the footer line unchanged', () => {
  const payload = toIssuePayload(finding());
  assert.ok(payload.body.includes('_Filed by `/claude-tweaks:journey-health`. Close to resolve; label `wontfix` to suppress future reports of this finding._'));
});

// ── title formatting (unchanged) ────────────────────────────────────────────

test('toIssuePayload builds a title from category and section', () => {
  const payload = toIssuePayload(finding());
  assert.strictEqual(payload.title, 'Journey drift: checkout-flow — files-frontmatter');
});

test('toIssuePayload maps regression-suspected to the "regression" title label', () => {
  const payload = toIssuePayload(finding({ category: 'regression-suspected', section: 'live-check' }));
  assert.strictEqual(payload.title, 'Journey regression: checkout-flow — live-check');
});

// ── preserved top-level fields (producer/consumer invariant) ───────────────

test('toIssuePayload preserves top-level finding fields alongside the payload fields', () => {
  const f = finding({
    id: 'journeyhealth-deadbeef', journey: 'signup', category: 'coverage', section: 'coverage', severity: 'low', confidence: 'med',
  });
  const payload = toIssuePayload(f);
  assert.strictEqual(payload.id, 'journeyhealth-deadbeef');
  assert.strictEqual(payload.journey, 'signup');
  assert.strictEqual(payload.category, 'coverage');
  assert.strictEqual(payload.section, 'coverage');
  assert.strictEqual(payload.severity, 'low');
  assert.strictEqual(payload.confidence, 'med');
});

// ── relatedSections rendering (bundled coverage findings) ────────────────────

test('toIssuePayload body includes an "Also affects" line when relatedSections is present on a coverage finding', () => {
  const payload = toIssuePayload(finding({
    category: 'coverage', section: 'coverage',
    relatedSections: ['signup-flow: steps 2,3', 'login-flow: steps 4'],
  }));
  assert.ok(payload.body.includes('Also affects:'), 'missing Also affects block');
  assert.ok(payload.body.includes('`signup-flow: steps 2,3`'));
  assert.ok(payload.body.includes('`login-flow: steps 4`'));
});

test('toIssuePayload body omits "Also affects" when relatedSections is absent', () => {
  const payload = toIssuePayload(finding({ category: 'coverage', section: 'coverage' }));
  assert.ok(!payload.body.includes('Also affects:'));
});

test('toIssuePayload body omits "Also affects" when relatedSections is an empty array', () => {
  const payload = toIssuePayload(finding({ category: 'coverage', section: 'coverage', relatedSections: [] }));
  assert.ok(!payload.body.includes('Also affects:'));
});

test('toIssuePayload for a self-review (non-coverage) finding never renders "Also affects"', () => {
  const payload = toIssuePayload(finding());
  assert.ok(!payload.body.includes('Also affects:'));
});

// ── freshness stamp (#117) ──────────────────────────────────────────────────

test('toIssuePayload with no verifiedAsOf argument omits the stamp (existing callers unaffected)', () => {
  const payload = toIssuePayload(finding());
  assert.ok(!payload.body.includes('Verified-as-of:'));
});

test('toIssuePayload threads verifiedAsOf through to the composed body', () => {
  const payload = toIssuePayload(finding(), 'abc1234');
  assert.ok(payload.body.includes('Verified-as-of: abc1234'));
  assert.strictEqual(extractVerifiedAsOf(payload.body), 'abc1234');
});
