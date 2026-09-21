'use strict';

// Project a finding into a GitHub issue payload. Emit-only — never calls the
// network. The skill hands the payload to the gh CLI itself.
// Label/marker/type assembly delegates to recordPayload (bin/lib/issues/record.js) — the
// shared work-record taxonomy (skills/_shared/work-record.md): origin by:journey-health,
// colon-form risk:*/size:medium scoring, born-ready, Type bug|task, work-fingerprint marker.
const { recordPayload, specShapedBody } = require('../issues/record');
const { buildRelatedBlocks } = require('../issues/related-blocks');

const CATEGORY_LABELS = { drift: 'drift', coverage: 'coverage', 'regression-suspected': 'regression' };

// severity -> risk axis fold (spec 15): journey-health's severity vocabulary (high/med/low)
// folds onto the shared risk tier vocabulary (high/medium/low) — 'med' is the one spelling
// difference. validate-finding.js's SEVERITY_VALUES already restricts finding.severity to
// exactly these three keys before a finding ever reaches this function through the real
// validate-findings pipeline, so a lookup miss is unreachable there. For a direct/bypassing
// caller, a lookup miss resolves to `undefined`, which recordPayload treats as "risk not
// supplied" (same as harness-health's unscored new-skill findings) rather than throwing —
// there is no local pre-validation or default fallback here on purpose.
const SEVERITY_TO_RISK = { high: 'high', med: 'medium', low: 'low' };

// verifiedAsOf (#117): the sha the sweep read this repo at, resolved ONCE per
// run by the caller (bin/journey-health.js, via health-core/read-commit.js)
// and threaded through here — never resolved inside this function. See
// specShapedBody's own verifiedAsOf doc in record.js for why.
function toIssuePayload(finding, verifiedAsOf) {
  const categoryLabel = CATEGORY_LABELS[finding.category] || finding.category;

  // Only ever populated for category: "coverage" findings — the other three
  // sections each emit at most one finding per violation and have nothing to bundle.
  const relatedBlocks = buildRelatedBlocks(finding.relatedSections);

  // Release-note rule mirrors the type rule below (#2660): a
  // regression-suspected finding names a real broken user-facing journey —
  // the release note says so, generically (the judge output has no clean
  // per-finding user-facing phrasing to lift). drift/coverage findings are
  // documentation/coverage maintenance with nothing that shipped to change.
  const releaseNote = finding.category === 'regression-suspected'
    ? `Fixed a broken user journey: ${finding.journey}.`
    : 'No user-visible change — journey documentation/coverage maintenance.';

  const body = specShapedBody({
    header: `**Journey:** ${finding.journey} | **Section:** ${finding.section} | **Category:** ${finding.category} | **Severity:** ${finding.severity} | **Confidence:** ${finding.confidence}`,
    currentState: [...relatedBlocks, finding.description, finding.reason],
    deliverables: finding.recommendation,
    acceptanceCriteria: `The condition described above is resolved: a fresh \`/claude-tweaks:journey-health\` audit of journey '${finding.journey}' files no finding with this fingerprint.`,
    releaseNote,
    filedBy: '/claude-tweaks:journey-health',
    verifiedAsOf,
  });

  const title = `Journey ${categoryLabel}: ${finding.journey} — ${finding.section}`;
  // Type rule: a regression-suspected finding means the journey/story text is accurate and
  // the implementation broke (a defect); drift/coverage findings are documentation/coverage
  // maintenance, not a defect.
  const type = finding.category === 'regression-suspected' ? 'bug' : 'task';
  const diagnosticLabel = `journey-health:${finding.category}`;

  // No spread after this call — the final return below picks fields explicitly.
  const payload = recordPayload({
    title,
    body,
    type,
    origin: 'journey-health',
    risk: SEVERITY_TO_RISK[finding.severity],
    // The record facet is `size` (renamed from effort, #217). Only the record
    // side was renamed — journey-health's own finding vocabulary (severity;
    // it has no effort field) is untouched, and every finding still scores the
    // same fixed tier.
    size: 'medium',
    ready: true,
    fingerprint: finding.id,
  });

  return {
    id: finding.id,
    journey: finding.journey,
    category: finding.category,
    section: finding.section,
    severity: finding.severity,
    confidence: finding.confidence,
    relatedSections: finding.relatedSections,
    title: payload.title,
    body: payload.body,
    labels: [...payload.labels, diagnosticLabel],
    type: payload.type,
  };
}

module.exports = { toIssuePayload };
