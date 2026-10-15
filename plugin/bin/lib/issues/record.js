// bin/lib/issues/record.js
// Pure: the unified work-record taxonomy and payload assembly — the code twin of
// skills/_shared/work-record.md. Every label-string literal used by the health
// skills, /capture, /specify, /backlog, and /dispatch lives here; other modules
// import from this file rather than re-declaring their own copies. No network.
//
// #2805: split into four cohesive sub-modules — this file is now a thin
// aggregator that re-exports the exact same public API from them, so every
// existing `require('./record')`/`require('../issues/record')` call site
// (or a re-require of this same path from any depth) keeps working unchanged:
//   - record-vocabulary.js  — label/facet vocabulary and parsing
//   - record-payload.js     — recordPayload/specShapedBody composition
//   - record-fingerprint.js — fingerprint handling
//   - record-dependencies.js — dependency/blocker/sub-issue query building
// New code that only needs one boundary's exports may require that
// sub-module directly instead of this aggregator; both are equally valid.
'use strict';

const {
  ORIGINS, TYPES, TIERS, PRIORITIES, LABELS, TYPE_LABELS,
  CLASSIFICATION_SCORING, normalizeLabelNames, parseRecordFacets, typeOf,
} = require('./record-vocabulary');

const {
  DEFER_REASONS, recordPayload, specShapedBody,
  extractVerifiedAsOf, extractPremiseCheck, extractTemplateStamp,
  fenceFor, fencedBlock, extractSection,
} = require('./record-payload');

const {
  FP_RE_WORK, FP_RE_LEGACY, FP_RE_WORK_PLAIN, extractFingerprint, checkFingerprint, recordFingerprint,
} = require('./record-fingerprint');

const {
  parseDependencies, parseDependencyAssumptions, buildNativeDependencyQuery,
  hasOpenNativeBlocker, parseSubIssues, buildNativeSubIssuesQuery, buildNativeParentQuery,
  partitionByOpenBodyBlockers, partitionByOpenNativeBlockers, buildLinkedPRQuery, partitionByOpenLinkedPR,
} = require('./record-dependencies');

module.exports = {
  ORIGINS, TYPES, TIERS, PRIORITIES, DEFER_REASONS, LABELS, TYPE_LABELS, recordPayload, specShapedBody,
  FP_RE_WORK, FP_RE_LEGACY, FP_RE_WORK_PLAIN, extractFingerprint, checkFingerprint, recordFingerprint, extractVerifiedAsOf, extractPremiseCheck, extractTemplateStamp, normalizeLabelNames, parseRecordFacets,
  parseDependencies, parseDependencyAssumptions, buildNativeDependencyQuery,
  hasOpenNativeBlocker, CLASSIFICATION_SCORING, fenceFor, fencedBlock, parseSubIssues,
  buildNativeSubIssuesQuery, buildNativeParentQuery, partitionByOpenBodyBlockers, partitionByOpenNativeBlockers,
  buildLinkedPRQuery, partitionByOpenLinkedPR, typeOf, extractSection,
};
