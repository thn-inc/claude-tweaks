'use strict';

// Project a finding into a GitHub issue payload. Emit-only — never calls
// the network. The skill hands the payload to the gh CLI itself.
// Label/marker/type assembly delegates to recordPayload
// (bin/lib/issues/record.js) — the shared work-record taxonomy
// (skills/_shared/work-record.md): origin by:docs-health, colon-form
// risk:*/size:* scoring, born-ready, Type task, work-fingerprint marker.
// fenceFor/fencedBlock (GitHub-fence-safe code-block wrapper) and
// CLASSIFICATION_SCORING (classification -> risk/size fold) also live in
// record.js — shared with harness-health/issue-payload.js rather than
// copy-pasted.
const {
  recordPayload, specShapedBody, CLASSIFICATION_SCORING, fencedBlock,
} = require('../issues/record');
const { buildRelatedBlocks } = require('../issues/related-blocks');

const CATEGORY_LABELS = {
  'genre-drift': 'genre-drift', staleness: 'staleness', 'depth-mismatch': 'depth-mismatch', findability: 'findability',
};

const MISLEADS_LABELS = {
  human: 'human engineer',
  agent: 'coding agent',
  both: 'human engineer + coding agent',
};

// verifiedAsOf (#117): the sha the sweep read this repo at, resolved ONCE per
// run by the caller (bin/docs-health.js, via health-core/read-commit.js) and
// threaded through here — never resolved inside this function. See
// specShapedBody's own verifiedAsOf doc in record.js for why.
function toIssuePayload(finding, verifiedAsOf) {
  const categoryLabel = CATEGORY_LABELS[finding.category] || finding.category;
  const misleadsLabel = MISLEADS_LABELS[finding.misleads] || finding.misleads;

  const kindLine = `**Doc:** ${finding.target} | **Section:** ${finding.section} | **Category:** ${finding.category} | **Misleads:** ${misleadsLabel} | **Classification:** ${finding.classification} | **Confidence:** ${finding.confidence}`;

  const deliverables = `**Current:**\n${fencedBlock(finding.oldString || '(N/A — new content)')}\n\n**Proposed:**\n${fencedBlock(finding.newString)}`;

  // Only ever populated when multiple findings in one doc audit share the same
  // root cause — see the "Bundling rule" in skills/docs-health/SKILL.md Step 3.
  const relatedBlocks = buildRelatedBlocks(finding.relatedSections);

  const body = specShapedBody({
    header: kindLine,
    currentState: [...relatedBlocks, finding.reason],
    deliverables,
    acceptanceCriteria: finding.description,
    // docs-health audits this repo's own documentation accuracy — never a
    // shipped end-user-facing feature — so every finding gets the same plain
    // "no user-visible change" phrasing (#2660) rather than a per-finding
    // derivation the judge output doesn't carry data for.
    releaseNote: 'No user-visible change — documentation accuracy fix.',
    filedBy: '/claude-tweaks:docs-health',
    verifiedAsOf,
  });

  const title = `Doc ${categoryLabel}: ${finding.target} — ${finding.section}`;
  const diagnosticLabel = `docs-health:${finding.classification}`;
  // Guard with optional chaining, matching harness-health/issue-payload.js's
  // identical CLASSIFICATION_SCORING lookup — an unmapped classification
  // (a future value added to docs-health's own CLASSIFICATION_VALUES without
  // a matching CLASSIFICATION_SCORING entry) must degrade to risk/size:
  // undefined (recordPayload's `if (risk !== undefined)` guard simply omits
  // the label), not throw and abort the whole validate-findings batch.
  const scoring = CLASSIFICATION_SCORING[finding.classification];
  const risk = scoring?.risk;
  // The record facet is `size` (renamed from effort, #217), and
  // CLASSIFICATION_SCORING's second axis moved with it. Only the record side
  // was renamed — each health skill's own finding vocabulary is untouched
  // (docs-health folds `classification`; code-health's judge still emits
  // `finding.effort`, which its call site passes through as `size`).
  const size = scoring?.size;

  const payload = recordPayload({
    title,
    body,
    type: 'task',
    origin: 'docs-health',
    risk,
    size,
    ready: true,
    fingerprint: finding.id,
  });

  return {
    id: finding.id,
    target: finding.target,
    assetType: finding.assetType,
    category: finding.category,
    misleads: finding.misleads,
    section: finding.section,
    classification: finding.classification,
    confidence: finding.confidence,
    reversibility: finding.reversibility,
    // oldString/newString are deliberately NOT surfaced as top-level payload
    // fields: `body` already carries both verbatim via the fenced
    // Current/Proposed blocks composed above, and that markdown is what
    // actually ships to GitHub. Carrying them twice made a payload with
    // ~2.6 KB of patch text 38% duplicate bytes, uncapped across the findings
    // array. Matches journey-health/code-health, which never duplicated them.
    // Anything needing the patch text reads it out of `body`.
    relatedSections: finding.relatedSections,
    title: payload.title,
    body: payload.body,
    labels: [...payload.labels, diagnosticLabel],
    type: payload.type,
  };
}

module.exports = { toIssuePayload };
