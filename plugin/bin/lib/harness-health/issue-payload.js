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

// Shell single-quote escape: wraps `str` in single quotes, closing/
// reopening the quote around an escaped literal `'`. Single-quoted content
// has no metacharacter interpretation at all in POSIX sh, so this is immune
// to shell injection regardless of what the string contains (backticks, $,
// ", spaces) — the one thing it can't hold safely is a literal newline,
// filtered out separately in buildPremiseCheck below.
function shQuote(str) {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

// Anchor-length ceiling: keeps the composed `grep -F` pattern well clear of
// a real command-line limit and avoids anchoring on a huge, more likely
// non-unique substring. Not tied to any other constant in this codebase —
// chosen generously above the size of a typical oldString/newString (a
// sentence or a few lines of prose/code).
const MAX_PREMISE_ANCHOR_LENGTH = 400;

// Builds a Premise-check: command (#1829/#2621) for a mechanically
// re-checkable patch finding. Additive intent (the common case) checks for
// the proposed string's absence in the target file — exit 0 while absent
// (finding still unresolved), non-zero once present (finding resolved),
// mirroring claude-md-curation.md's existing wc -l-over-budget shape's
// polarity. A removal checks the opposite way against the string being
// removed — exit 0 while it's still present (unresolved), non-zero once
// it's gone (resolved). Returns undefined — never a wrong command — when:
// the finding isn't a patch (new-skill candidates have no existing content
// to check against), no targetPath was resolved for it, or the anchor
// string can't be safely anchored (empty, multi-line, or over the length
// ceiling above). materialize.js's own "no Premise-check: line" fallback
// handles the undefined case.
//
// Fail-safe when the target file can't be read at check time (#2621): this
// command can run on a different machine/sandbox than the one that resolved
// targetPath (a scheduled cloud Routine vs. a build checkout), so the
// baked-in absolute path may not exist there. Empirically (see
// final-fix-report.md): a bare `grep` on a missing file exits 2, and a
// missing-file exit 2 is non-zero — for the removal polarity (a bare grep,
// no `!`), that reads as "resolved" (false auto-close risk) when it should
// read as "can't tell, still unresolved." The `! test -r ... ||` guard
// short-circuits to exit 0 ("unresolved") whenever the file isn't a
// readable regular file, and is a no-op (same exit code as the bare grep)
// whenever it is — verified below. The additive branch needs no such guard:
// `! grep -qF x /missing/path` exits 0 empirically (negating grep's exit 2),
// which already reads as "unresolved" — the correct fail-safe answer for
// that polarity, with no change needed.
function buildPremiseCheck(finding, targetPath) {
  if (finding.kind !== 'patch' || !targetPath) return undefined;
  const isRemoval = finding.intent === 'remove';
  const anchor = isRemoval ? finding.oldString : finding.newString;
  if (!anchor || anchor.includes('\n') || anchor.length > MAX_PREMISE_ANCHOR_LENGTH) return undefined;
  const grep = `grep -qF -- ${shQuote(anchor)} ${shQuote(targetPath)}`;
  return isRemoval ? `! test -r ${shQuote(targetPath)} || ${grep}` : `! ${grep}`;
}

// verifiedAsOf (#117): the sha the sweep read this repo at, resolved ONCE per
// run by the caller (bin/harness-health.js, via health-core/read-commit.js)
// and threaded through here — never resolved inside this function. See
// specShapedBody's own verifiedAsOf doc in record.js for why.
// pluginVersion (#1840, optional): the running plugin's own version
// (`.claude-plugin/plugin.json` under CLAUDE_PLUGIN_ROOT), resolved ONCE per
// run by the same caller — same non-resolved-here convention as
// verifiedAsOf. Only ever combined with finding.templateSource, which the
// judge sets for a template-derived claude-md/rule finding in the
// template-conformance/best-practice categories; every other finding (a
// skill drift finding, a new-skill candidate) carries no templateSource and
// this parameter is simply unused for it.
function toIssuePayload(finding, verifiedAsOf, pluginVersion) {
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

  // #1840: a template-derived finding's Proposed block is a filing-time
  // snapshot of the origin template — nothing tells a builder that literally
  // by itself. When the judge set templateSource AND the caller supplied a
  // pluginVersion to stamp it at, name both in a Template: metadata line
  // (same convention as Verified-as-of) and open Deliverables with one
  // sentence saying so. Absent either input, behavior is byte-identical to
  // before this record (a skill drift finding never carries templateSource
  // at all, so it is never affected).
  const templateStamp = finding.templateSource && pluginVersion
    ? `${finding.templateSource} @ ${pluginVersion}`
    : undefined;
  if (templateStamp) {
    const snapshotSentence = `The Proposed block below is a snapshot of \`${finding.templateSource}\` as rendered at plugin version ${pluginVersion} — at build time, re-derive the replacement from the *installed* template and treat this fence as the intended shape, not the bytes.`;
    deliverables = `${snapshotSentence}\n\n${deliverables}`;
  }

  // Only ever populated for kind: "patch" findings — new-skill candidates have
  // no section to bundle by, so finding.relatedSections is always absent there.
  const relatedBlocks = buildRelatedBlocks(finding.relatedSections);

  const premiseCheck = buildPremiseCheck(finding, finding.path);

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
    premiseCheck,
    templateStamp,
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

module.exports = { toIssuePayload, buildPremiseCheck };
