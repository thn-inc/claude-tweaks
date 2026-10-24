// bin/lib/issues/record-vocabulary.js
// Pure: label/facet vocabulary and label-string parsing — one of record.js's
// four split boundaries (#2805). ORIGINS/TYPES/TIERS/PRIORITIES/CEREMONY_TIERS,
// the LABELS name table, TYPE_LABELS metadata, the closed-vocabulary label
// regexes, normalizeLabelNames, typeOf, and parseRecordFacets — the label ->
// facet decode direction. The write direction (facet values -> emitted
// labels) lives in record-payload.js's recordPayload, which imports LABELS
// and the vocabulary arrays from here. No network.
'use strict';

const { sharedFacetDefaults } = require('./facet-shape');

const ORIGINS = ['code-health', 'harness-health', 'journey-health', 'docs-health', 'capture', 'dispatch'];
const TYPES = ['bug', 'feature', 'task'];
const TIERS = ['low', 'medium', 'high'];
const PRIORITIES = ['high', 'medium', 'low'];
const CEREMONY_TIERS = ['fast-lane', 'standard'];

const LABELS = {
  READY: 'ready',
  PARKED: 'parked',
  AUTO_BUILD: 'auto:build',
  AUTO_MERGE: 'auto:merge',
  BOT_IN_PROGRESS: 'bot:in-progress',
  BOT_BLOCKED: 'bot:blocked',
  BOT_PARKED: 'bot:parked',
  WONTFIX: 'wontfix',
  SOLUTION_UNJUSTIFIED: 'solution:unjustified',
  // Read-side legacy fallback — PERMANENT cross-project support (other repos' records keep framing:baked labels, pre-rename); removable only at a major version that drops pre-rename repo support. [IL-85] Never emitted.
  FRAMING_BAKED: 'framing:baked',
  NEEDS_DEFINITION: 'needs:definition',
  // Compatibility axis (#2251) — presence-only, like SOLUTION_UNJUSTIFIED. Read by
  // bin/lib/release/subject.js's merge-subject composer (! suffix + BREAKING CHANGE footer).
  BREAKING: 'breaking',
  DEMO_PENDING: 'demo:pending',
  DEMO_APPROVED: 'demo:approved',
  DEMO_CHANGES_REQUESTED: 'demo:changes-requested',
  PARENT_ISSUE: 'parent-issue',
  SHAPED_HEADLESS: 'shaped:headless',
};

// F8 from the program promise register — type:* label descriptions home
// (each <= 100 chars; used only when work-types: labels is configured).
// #1873: colors reuse GitHub's own defaults for bug/enhancement/chore, so
// the convention reads without a legend for anyone used to GitHub's stock
// palette — stated once in _shared/work-record.md's label-family table.
const TYPE_LABELS = [
  ['type:bug', 'Type: a defect in existing behavior', 'D73A4A'],
  ['type:feature', 'Type: new capability or enhancement', 'A2EEEF'],
  ['type:task', 'Type: maintenance, refactor, docs, or chore work', 'EDEDED'],
];

const BY_RE = /^by:(.+)$/;
const RISK_LABEL_RE = /^risk:(.+)$/;
const SIZE_LABEL_RE = /^size:(.+)$/;
// Read-side effort:* fallback — PERMANENT cross-project support (other repos' records keep effort:* labels); removable only at a major version that drops pre-rename repo support. [IL-85]
const EFFORT_LABEL_RE = /^effort:(.+)$/;
const PRIORITY_LABEL_RE = /^priority:(.+)$/;
const CEREMONY_LABEL_RE = /^ceremony:(.+)$/;

// The colon-form value labels parseRecordFacets reads straight into a facet:
// the regex that recognizes one, the facet key it sets, and the vocabulary its
// value must belong to. A value outside that vocabulary is ignored entirely
// (the facet keeps its default) rather than stored. Every prefix here is
// distinct, so one label name can match at most one row and evaluation order
// carries no meaning. effort:* is deliberately absent — it is the one value
// label that does NOT write its facet directly (see parseRecordFacets).
const VALUE_FACETS = [
  [BY_RE, 'origin', ORIGINS],
  [RISK_LABEL_RE, 'risk', TIERS],
  [SIZE_LABEL_RE, 'size', TIERS],
  [CEREMONY_LABEL_RE, 'ceremony', CEREMONY_TIERS],
  [PRIORITY_LABEL_RE, 'priority', PRIORITIES],
];

// classification -> risk/size scoring axis fold, shared by every health
// producer's issue-payload.js (docs-health, harness-health; journey-health
// uses its own severity-based fold instead, see journey-health/issue-payload.js):
// additive is a safe, mechanical patch (low risk, small change); restructural
// needs human review and is a bigger change. A finding kind that's deliberately
// unscored (e.g. harness-health's "new-skill") looks this map up and gets
// `undefined` back rather than consulting it at all — callers gate that
// themselves, this map has no "unscored" entry.
const CLASSIFICATION_SCORING = {
  additive: { risk: 'low', size: 'low' },
  restructural: { risk: 'medium', size: 'high' },
};

// Accepts either bare label-name strings or {name} objects (gh's own shape).
function normalizeLabelNames(labels) {
  return (labels || []).map((l) => (typeof l === 'string' ? l : l && l.name)).filter(Boolean);
}

// { labels, issueType } -> 'bug' | 'feature' | 'task' | null. Native Issue Type
// (facets don't carry this) takes precedence over a type:* label, since a
// project could carry a stale label after switching work-types: native.
// Shared behind compose-subject.js's and record-graph/encode.js's own
// independent copies (#2251 review row 19) — both consumers' RECOGNIZED_TYPES
// derivations are pinned equal to this module's own TYPES
// (tests/bin-lib/compose-subject.test.js's "Type vocabulary has one source of
// truth" test), so unifying on TYPES here changes neither consumer's output.
function typeOf(record) {
  const native = record.issueType;
  if (native && typeof native === 'object' && typeof native.name === 'string') {
    const name = native.name.toLowerCase();
    return TYPES.includes(name) ? name : null;
  }
  const names = normalizeLabelNames(record.labels);
  for (const t of TYPES) if (names.includes(`type:${t}`)) return t;
  return null;
}

// labels (string[] | {name}[]) -> the full record-facet shape. Explicit false/null
// defaults are set first and only ever flipped/assigned as matching labels are found
// in a single pass over the normalized names — never inferred from truthiness. Stage
// precedence is ready > parked > backlog regardless of array order or malformed
// combinations (e.g. both 'ready' and 'parked' present resolves to 'ready').
// Acceptance has no such precedence — the three demo:* labels are mutually exclusive
// by construction, so a plain last-match-in-array-wins assignment (same style as
// origin/risk/size/priority below) is enough.
// The size facet is the one exception to last-match-in-array-wins: size:* always
// beats a pre-rename effort:* label whichever order they appear in, so the effort
// value is only held aside during the pass and applied afterward, and never when a
// size:* label was found.
// Shared-key defaults come from facet-shape.js — local-store.js's defaultFacets
// builds on the same shape (plus its own local-only keys). Add a new shared
// facet key there, not independently here — the sanctioned exception is a key
// with no meaning on the other driver, declared driver-locally instead (see
// shapedHeadless immediately below, the GitHub-only counterpart to
// local-store.js's parent/blockedBy/unsynced keys).
function parseRecordFacets(labels) {
  const names = normalizeLabelNames(labels);

  const facets = sharedFacetDefaults();
  facets.shapedHeadless = false; // GitHub-only facet (headless `next` is github-issues only) — deliberately not in the shared facet-shape.js, so the local-files driver carries no meaningless default for it.
  let effortFallback = null;

  for (const name of names) {
    if (name === LABELS.READY) {
      facets.stage = 'ready';
      continue;
    }
    if (name === LABELS.PARKED) {
      if (facets.stage !== 'ready') facets.stage = 'parked';
      continue;
    }
    if (name === LABELS.AUTO_BUILD) {
      facets.grants.build = true;
      continue;
    }
    if (name === LABELS.AUTO_MERGE) {
      facets.grants.merge = true;
      continue;
    }
    if (name === LABELS.BOT_IN_PROGRESS) {
      facets.bot.inProgress = true;
      continue;
    }
    if (name === LABELS.BOT_BLOCKED) {
      facets.bot.blocked = true;
      continue;
    }
    if (name === LABELS.BOT_PARKED) {
      facets.bot.parked = true;
      continue;
    }
    if (name === LABELS.WONTFIX) {
      facets.notPlanned = true;
      continue;
    }
    if (name === LABELS.DEMO_PENDING) {
      facets.acceptance = 'pending';
      continue;
    }
    if (name === LABELS.DEMO_APPROVED) {
      facets.acceptance = 'approved';
      continue;
    }
    if (name === LABELS.DEMO_CHANGES_REQUESTED) {
      facets.acceptance = 'changes-requested';
      continue;
    }
    // solution:unjustified — or its pre-rename spelling framing:baked (permanent read-side fallback, [IL-85]).
    if (name === LABELS.SOLUTION_UNJUSTIFIED || name === LABELS.FRAMING_BAKED) {
      facets.solutionUnjustified = true;
      continue;
    }
    if (name === LABELS.NEEDS_DEFINITION) {
      facets.needsDefinition = true;
      continue;
    }
    if (name === LABELS.BREAKING) {
      facets.breaking = true;
      continue;
    }
    if (name === LABELS.PARENT_ISSUE) {
      facets.isParentIssue = true;
      continue;
    }
    if (name === LABELS.SHAPED_HEADLESS) {
      facets.shapedHeadless = true;
      continue;
    }
    // Read-side family:parent fallback — PERMANENT cross-project support (other repos' records keep family:parent labels); removable only at a major version that drops pre-rename repo support. [IL-85]
    if (name === 'family:parent') {
      facets.isParentIssue = true;
      continue;
    }

    // Read-side effort:* fallback — PERMANENT cross-project support (other repos' records keep effort:* labels); removable only at a major version that drops pre-rename repo support. [IL-85]
    // Last such label wins among repeats, matching the VALUE_FACETS pass just below and the pre-rename effort parse this replaces.
    const effort = EFFORT_LABEL_RE.exec(name);
    if (effort && TIERS.includes(effort[1])) {
      effortFallback = effort[1];
      continue;
    }

    for (const [labelRe, key, vocabulary] of VALUE_FACETS) {
      const match = labelRe.exec(name);
      if (match && vocabulary.includes(match[1])) {
        facets[key] = match[1];
        break;
      }
    }
  }

  if (facets.size === null) facets.size = effortFallback;

  return facets;
}

module.exports = {
  ORIGINS, TYPES, TIERS, PRIORITIES, CEREMONY_TIERS, LABELS, TYPE_LABELS,
  CLASSIFICATION_SCORING, normalizeLabelNames, parseRecordFacets, typeOf,
};
