// Project a finding into a GitHub issue payload. Emit-only: this never calls
// the network. The skill hands the payload to the gh CLI itself.
// Body is /specify-shaped so promotion to a spec is near-zero translation, and
// carries a hidden fingerprint marker the dedup step re-extracts.
const { recordPayload, specShapedBody } = require('../issues/record');
const { buildRelatedBlocks } = require('../issues/related-blocks');

// legacy: v1, frozen. Not called by bin/code-health.js (which uses toIssuePayloadV2
// exclusively) — kept only so its own test file can assert this historical shape
// never regresses. Do not update this function's footer/labels/marker to match v2.
function toIssuePayload(finding) {
  const marker = `<!-- code-health-fingerprint: ${finding.id} -->`;
  const files = finding.files || [];
  const filesLine = files.length > 0 ? files.join(', ') : '(no specific file)';
  const body = [
    marker,
    '',
    `**Lens:** ${finding.lens} | **Severity:** ${finding.severity} | **Confidence:** ${finding.confidence} | **Area:** ${finding.area}`,
    '',
    '## Current State',
    '',
    `Files: ${filesLine}`,
    '',
    finding.evidence,
    '',
    '## Deliverables',
    '',
    finding.suggestion,
    '',
    '## Acceptance Criteria',
    '',
    finding.acceptance,
    '',
    '_Filed by `/code-health`. Close to resolve; label `wontfix` to suppress future reports of this finding._',
  ].join('\n');

  return {
    title: finding.title,
    body,
    labels: ['code-health', `code-health:${finding.severity}`],
  };
}

// v2: body uses anchor (Current State), suggestedApproach (Deliverables), acceptance (Acceptance Criteria).
// The criterion is not a label — it's already in the body's header line; nothing reads
// it back off a label, and per-criterion labels are the class that hit GitHub's 100-char cap.
// Label/marker/type assembly delegates to recordPayload (bin/lib/issues/record.js) — the
// shared work-record taxonomy (skills/_shared/work-record.md): origin by:code-health,
// colon-form risk:*/size:* scoring, born-ready, Type task, work-fingerprint marker.
// verifiedAsOf (#117): the sha the sweep read this repo at, resolved ONCE per
// run by the caller (bin/code-health.js, via health-core/read-commit.js) and
// threaded through here — never resolved inside this function. See
// specShapedBody's own verifiedAsOf doc in record.js for why.
function toIssuePayloadV2(finding, verifiedAsOf) {
  // Same "Also affects: ..." bundler the other three health producers use — this
  // file's finding vocabulary names the bundled items relatedAnchors rather than
  // relatedSections, but the rendered block is identical.
  const relatedBlocks = buildRelatedBlocks(finding.relatedAnchors);
  const body = specShapedBody({
    header: `**Criterion:** ${finding.criterion} | **Risk:** ${finding.risk} | **Severity:** ${finding.severity} | **Likelihood:** ${finding.likelihood} | **Effort:** ${finding.effort} | **Confidence:** ${finding.confidence} | **Area:** ${finding.areaId}`,
    currentState: [`Anchor: \`${finding.anchor}\``, ...relatedBlocks, finding.evidence],
    deliverables: finding.suggestedApproach,
    acceptanceCriteria: finding.acceptance,
    // Code-health findings are internal code-quality/maintainability issues in
    // this repo's own source, never a shipped end-user-facing feature — so
    // every finding gets the same plain "no user-visible change" phrasing
    // (#2660) rather than a per-finding derivation the judge output doesn't
    // carry data for.
    releaseNote: 'No user-visible change — internal code-quality fix.',
    filedBy: '/claude-tweaks:code-health',
    verifiedAsOf,
  });

  // No spread after this call — recordPayload's return is the payload verbatim.
  return recordPayload({
    title: finding.title,
    body,
    type: 'task',
    origin: 'code-health',
    risk: finding.risk,
    // The record facet is `size` (renamed from effort, #217). finding.effort is
    // code-health's own judge-output vocabulary and is deliberately NOT renamed
    // — only the record side moved, so the value crosses here.
    size: finding.effort,
    ready: true,
    fingerprint: finding.id,
  });
}

module.exports = { toIssuePayload, toIssuePayloadV2 };
