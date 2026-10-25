// bin/lib/express/eligibility.js
// Pure: the express lane's (#4025) deterministic gates — record eligibility,
// post-build diff bounds, and the merge-verification override. Prose statement
// of record is skills/_shared/express-lane.md; this module is its code twin.
// No I/O: callers resolve policy (express-lane, integration model,
// merge-sensitive-paths) and pass the values in.
'use strict';

const { extractKeyFiles } = require('../issues/grouping');
const { normalizeLabelNames, parseRecordFacets, typeOf } = require('../issues/record');
const { shapeGate, liftMetadata } = require('../issues/materialize-format');
const { fileMatchesFrontendPredicate } = require('../design-detect/index');
const { classifyDiffFiles, isSensitivePath } = require('../issues/blast-radius');

const EXPRESS_MAX_KEY_FILES = 3;

// Wire contract: callers and reports match these verbatim — never paraphrase.
const REASONS = Object.freeze({
  disabled: 'express-lane disabled',
  notPrFirst: 'integration-model is not pr-first',
  risk: 'risk is not low',
  size: 'size is not low',
  ceremony: 'ceremony is not fast-lane',
  type: 'no type:* label',
  mergePending: 'auto:merge-pending grant matures only on the normal path',
  noKeyFiles: 'no Key Files',
  tooManyKeyFiles: `more than ${EXPRESS_MAX_KEY_FILES} Key Files`,
  frontend: 'frontend surface',
  notShaped: 'not spec-shaped',
  escalated: 'already escalated in this run',
  protectedPath: (p) => `protected path: ${p}`,
  sensitivePath: (p) => `merge-sensitive path: ${p}`,
});

// Project-agnostic (never this repo's plugin/ prefix): hook code, shared skill
// contracts, CI/forge config, and the policy file itself.
const PROTECTED_PATH_RES = [
  /(^|\/)hooks\//,
  /(^|\/)hooks\.js$/,
  /(^|\/)skills\/_shared\//,
  /(^|\/)\.github\//,
  /(^|\/)\.claude-tweaks\/policy\.yml$/,
];

function isProtectedPath(path) {
  const normalized = String(path).replace(/\\/g, '/');
  return PROTECTED_PATH_RES.some((re) => re.test(normalized));
}

const FRONTEND_SURFACES = new Set(['web', 'mobile', 'desktop']);
const NON_FRONTEND_SURFACES = new Set(['backend', 'infra', 'terminal']);

// A declared Surface: wins over the file sniff (matching design-detect's layer2
// skip); absent or unrecognized falls back to the sniff over the Key Files.
function isFrontend(body, keyFiles) {
  let surface = (liftMetadata(body).surface || '').toLowerCase();
  if (surface === 'frontend') surface = 'web';
  if (FRONTEND_SURFACES.has(surface)) return true;
  if (NON_FRONTEND_SURFACES.has(surface)) return false;
  return keyFiles.some(fileMatchesFrontendPredicate);
}

// Collects every failing reason (never short-circuits) so a report names them all.
function evaluateRecordEligibility(issue, opts) {
  const { enabled, integrationModel, sensitivePaths = [], escalated = false } = opts || {};
  const body = (issue && issue.body) || '';
  const labels = (issue && issue.labels) || [];
  const facets = parseRecordFacets(labels);
  const keyFiles = extractKeyFiles({ body, labels });
  const reasons = [];

  if (enabled !== true) reasons.push(REASONS.disabled);
  if (integrationModel !== 'pr-first') reasons.push(REASONS.notPrFirst);
  if (facets.risk !== 'low') reasons.push(REASONS.risk);
  if (facets.size !== 'low') reasons.push(REASONS.size);
  if (facets.ceremony !== 'fast-lane') reasons.push(REASONS.ceremony);
  if (!typeOf(issue || {})) reasons.push(REASONS.type);
  if (normalizeLabelNames(labels).includes('auto:merge-pending')) reasons.push(REASONS.mergePending);
  if (keyFiles.length === 0) reasons.push(REASONS.noKeyFiles);
  if (keyFiles.length > EXPRESS_MAX_KEY_FILES) reasons.push(REASONS.tooManyKeyFiles);
  if (isFrontend(body, keyFiles)) reasons.push(REASONS.frontend);
  for (const p of keyFiles) {
    if (isProtectedPath(p)) reasons.push(REASONS.protectedPath(p));
    if (isSensitivePath(p, sensitivePaths)) reasons.push(REASONS.sensitivePath(p));
  }
  if (!shapeGate(body).ok) reasons.push(REASONS.notShaped);
  if (escalated === true) reasons.push(REASONS.escalated);

  return { number: issue && issue.number, eligible: reasons.length === 0, reasons, keyFiles };
}

// Every changed non-test, non-pipeline-artifact path must be a Key File and
// count toward implLines; the protected and merge-sensitive checks apply to
// every changed path, tests included.
function evaluateDiffBounds(files, opts) {
  const { keyFiles = [], sensitivePaths = [], maxLines } = opts || {};
  const classified = classifyDiffFiles(files, sensitivePaths);
  const keySet = new Set(keyFiles);
  const violations = [];
  let implLines = 0;

  if (classified.length === 0) violations.push('no changes');
  for (const f of classified) {
    if (!f.isTest && !f.isPipelineArtifact) {
      implLines += f.additions + f.deletions;
      if (!keySet.has(f.path)) violations.push(`outside Key Files: ${f.path}`);
    }
    if (isProtectedPath(f.path)) violations.push(REASONS.protectedPath(f.path));
    if (f.isSensitive) violations.push(REASONS.sensitivePath(f.path));
  }
  if (implLines > maxLines) violations.push(`${implLines} implementation lines > ${maxLines}`);

  return { withinBounds: violations.length === 0, violations, implLines, changedFiles: classified.map((f) => f.path) };
}

// The express lane merges on green by construction: a resolved `off` (or
// anything but an explicit `wait`) never disables its merge.
function expressMergeVerification(resolved) {
  return resolved === 'wait' ? 'wait' : 'merge-when-green';
}

module.exports = {
  EXPRESS_MAX_KEY_FILES, REASONS, isProtectedPath, evaluateRecordEligibility, evaluateDiffBounds, expressMergeVerification,
};
