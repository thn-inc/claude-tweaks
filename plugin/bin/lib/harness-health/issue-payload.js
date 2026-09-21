'use strict';

// Project a finding into a GitHub issue payload. Emit-only — never calls the
// network. The skill hands the payload to the gh CLI itself.
// Label/marker/type assembly delegates to recordPayload (bin/lib/issues/record.js) — the
// shared work-record taxonomy (skills/_shared/work-record.md): origin by:harness-health,
// colon-form risk:*/size:* scoring, born-ready, Type task, work-fingerprint marker.
// fenceFor/fencedBlock (GitHub-fence-safe code-block wrapper) and
// CLASSIFICATION_SCORING (classification -> risk/size fold) also live in
// record.js — shared with docs-health/issue-payload.js rather than
// copy-pasted. kind: 'new-skill' never consults CLASSIFICATION_SCORING — it
// stays deliberately unscored (see below).
const {
  recordPayload, specShapedBody, CLASSIFICATION_SCORING, fencedBlock,
} = require('../issues/record');
const { buildRelatedBlocks } = require('../issues/related-blocks');

const ASSET_TYPE_LABELS = { skill: 'Skill', rule: 'Rule', 'claude-md': 'CLAUDE.md', 'design-artifact': 'Design Context', memory: 'Memory' };
const CATEGORY_LABELS = { drift: 'drift', 'template-conformance': 'structure', 'best-practice': 'best-practice' };

// verifiedAsOf (#117): the sha the sweep read this repo at, resolved ONCE per
// run by the caller (bin/harness-health.js, via health-core/read-commit.js)
// and threaded through here — never resolved inside this function. See
// specShapedBody's own verifiedAsOf doc in record.js for why.
function toIssuePayload(finding, verifiedAsOf) {
  const isNewSkill = finding.kind === 'new-skill';
  const assetLabel = ASSET_TYPE_LABELS[finding.assetType] || finding.assetType;
  const categoryLabel = CATEGORY_LABELS[finding.category] || finding.category;

  const kindLine = isNewSkill
    ? `**New skill candidate** | **Confidence:** ${finding.confidence}`
    : `**${assetLabel}:** ${finding.target} | **Section:** ${finding.section} | **Category:** ${finding.category} | **Classification:** ${finding.classification} | **Confidence:** ${finding.confidence}`;

  // A removal has an empty newString by contract, so rendering it as a
  // "Proposed:" block would show an empty fence and read as a broken finding
  // rather than an intentional deletion. Name the action instead.
  const isRemoval = finding.intent === 'remove';
  let deliverables;
  if (isNewSkill) {
    deliverables = `Proposed new skill \`${finding.target}\`:\n\n${finding.proposedBody}`;
  } else if (isRemoval) {
    deliverables = `**Remove this content:**\n${fencedBlock(finding.oldString)}\n\n**Proposed:** delete it — nothing replaces it.`;
  } else {
    deliverables = `**Current:**\n${fencedBlock(finding.oldString || '(N/A — new content)')}\n\n**Proposed:**\n${fencedBlock(finding.newString)}`;
  }

  // Only ever populated for kind: "patch" findings — new-skill candidates have
  // no section to bundle by, so finding.relatedSections is always absent there.
  const relatedBlocks = buildRelatedBlocks(finding.relatedSections);

  const body = specShapedBody({
    header: kindLine,
    currentState: [...relatedBlocks, finding.reason],
    deliverables,
    acceptanceCriteria: finding.description,
    // harness-health audits this repo's own agent-harness assets (skills,
    // rules, CLAUDE.md, design context, memory) — never a shipped
    // end-user-facing feature — so every finding, new-skill candidates
    // included, gets the same plain "no user-visible change" phrasing
    // (#2660) rather than a per-finding derivation the judge output doesn't
    // carry data for.
    releaseNote: 'No user-visible change — agent harness reliability fix.',
    filedBy: '/claude-tweaks:harness-health',
    verifiedAsOf,
  });

  let title;
  if (isNewSkill) {
    title = `New skill candidate: ${finding.target}`;
  } else if (isRemoval) {
    title = `${assetLabel} ${categoryLabel}: retire dead content in ${finding.target} — ${finding.section}`;
  } else {
    title = `${assetLabel} ${categoryLabel}: ${finding.target} — ${finding.section}`;
  }

  const diagnosticLabel = isNewSkill ? 'harness-health:new-skill' : `harness-health:${finding.classification}`;
  // new-skill is unscored by design (no risk/size) — the gate flags "needs scoring"
  // rather than inheriting a guessed tier from a kind that carries no evidence for one.
  const scoring = isNewSkill ? undefined : CLASSIFICATION_SCORING[finding.classification];
  const risk = scoring?.risk;
  // The record facet is `size` (renamed from effort, #217), and
  // CLASSIFICATION_SCORING's second axis moved with it. Only the record side
  // was renamed — each health skill's own finding vocabulary is untouched
  // (harness-health folds `classification`; code-health's judge still emits
  // `finding.effort`, which its call site passes through as `size`).
  const size = scoring?.size;

  // No spread after this call — the final return below picks fields explicitly.
  const payload = recordPayload({
    title,
    body,
    type: 'task',
    origin: 'harness-health',
    risk,
    size,
    ready: true,
    fingerprint: finding.id,
  });

  return {
    id: finding.id,
    kind: finding.kind,
    target: finding.target,
    assetType: finding.assetType,
    category: finding.category,
    section: finding.section,
    classification: finding.classification,
    confidence: finding.confidence,
    reversibility: finding.reversibility,
    // oldString/newString are deliberately NOT surfaced as top-level payload
    // fields: for kind "patch", `body` already carries both verbatim via the
    // fenced Current/Proposed (or Remove-this-content) blocks composed above,
    // and that markdown is what actually ships to GitHub. Carrying them twice
    // made a payload with ~2.6 KB of patch text 38% duplicate bytes, uncapped
    // across the findings array. Matches docs-health/journey-health/code-health.
    // Anything needing the patch text reads it out of `body`. (kind "new-skill"
    // never had them — it carries proposedBody in the body instead.)
    //
    // intent stays: it is a 1-word classification, not duplicated content, and
    // it is the ONLY top-level signal distinguishing a deletion from a
    // replacement now that newString is gone — a consumer can no longer infer
    // "removal" from an empty newString, so dropping this too would lose
    // information rather than just de-duplicate it.
    intent: finding.intent,
    relatedSections: finding.relatedSections,
    title: payload.title,
    body: payload.body,
    labels: [...payload.labels, diagnosticLabel],
    type: payload.type,
  };
}

module.exports = { toIssuePayload };
