// bin/lib/express/eligibility.js
// Pure: the express lane's (#4025) deterministic gates — record eligibility,
// post-build diff bounds, and the merge-verification override. Prose statement
// of record is skills/_shared/express-lane.md; this module is its code twin.
// No I/O: callers resolve policy (express-lane, integration model,
// merge-sensitive-paths) and pass the values in.
'use strict';

const nodePath = require('path');
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

// Project-agnostic (never this repo's plugin/ prefix). Each family is here because
// a change to it can weaken a gate the lane merges on, which a green CI cannot
// vouch for when the change edits what CI (or the agent) runs:
//  - hook code and shared skill contracts (`skills/_shared/` is a conservative
//    superset of the spec's "multi-consumer `_shared` contract"): consumed by
//    every skill, so no single-record review covers their blast radius;
//  - CI/forge config (GitHub, GitLab, CircleCI, git hooks) and CODEOWNERS: they
//    define the CI-green gate itself;
//  - `package.json`: its scripts are what the verification runner and CI execute;
//  - the agent's own permissions and tool config (`.claude/settings*.json`,
//    `.mcp.json`) and the plugin's policy and verify-scope files.
const PROTECTED_PATH_RES = [
  /(^|\/)hooks\//,
  /(^|\/)hooks\.js$/,
  /(^|\/)skills\/_shared\//,
  /(^|\/)\.github\//,
  /(^|\/)\.gitlab-ci\.yml$/,
  /(^|\/)\.circleci\//,
  /(^|\/)\.githooks\//,
  /(^|\/)\.husky\//,
  /(^|\/)CODEOWNERS$/,
  /(^|\/)package\.json$/,
  /(^|\/)\.claude\/settings[^/]*\.json$/,
  /(^|\/)\.mcp\.json$/,
  /(^|\/)\.claude-tweaks\/policy\.yml$/,
  /(^|\/)\.claude-tweaks\/verify-scope\.json$/,
];

// A path in comparison form: `\` as `/`, `.` and `..` segments resolved, no leading `./`.
// A Key File comes from record text, so `plugin/skills/x/../_shared/a.md` must be judged
// as the file it names; git's own paths are already in this form.
function canonicalPath(p) {
  const posix = nodePath.posix.normalize(String(p).replace(/\\/g, '/'));
  return posix.startsWith('./') ? posix.slice(2) : posix;
}

function isProtectedPath(path) {
  const normalized = canonicalPath(path);
  return PROTECTED_PATH_RES.some((re) => re.test(normalized));
}

// Mirrors design-detect's layer2 (FRONTEND_SURFACES there, `terminal` included;
// only `backend` and `infra` skip): a surface the design tracks treat as a
// frontend never takes the lane, which runs no design or visual check.
const FRONTEND_SURFACES = new Set(['web', 'mobile', 'desktop', 'terminal']);
const NON_FRONTEND_SURFACES = new Set(['backend', 'infra']);

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
// Why the less obvious rules exist: the lane opens a PR and merges it, which only
// `pr-first` supports; a `type:*` label is what `compose-subject.js` needs to
// compose the merge subject; `auto:merge-pending` is a grant that matures only on
// the normal path's wrap-up.
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
    if (isSensitivePath(canonicalPath(p), sensitivePaths)) reasons.push(REASONS.sensitivePath(p));
  }
  if (!shapeGate(body).ok) reasons.push(REASONS.notShaped);
  if (escalated === true) reasons.push(REASONS.escalated);

  return { number: issue && issue.number, eligible: reasons.length === 0, reasons, keyFiles };
}

// Every changed non-test, non-pipeline-artifact path must be a Key File and
// count toward implLines. A test file's deleted lines count toward maxLines too
// (deleting tests weakens the CI-green net the lane merges on); its added lines
// stay exempt. The protected and merge-sensitive checks apply to every changed
// path, tests included, and to a rename's oldPath. A missing or non-finite
// maxLines (e.g. Number() of a malformed policy value) fails closed.
function evaluateDiffBounds(files, opts) {
  const { keyFiles = [], sensitivePaths = [], maxLines } = opts || {};
  const inputs = files || [];
  const classified = classifyDiffFiles(inputs, sensitivePaths);
  // Key Files and changed paths are compared in canonicalPath form, on both sides.
  const keySet = new Set(keyFiles.map(canonicalPath));
  const violations = [];
  let implLines = 0;
  let testDeletions = 0;

  if (classified.length === 0) violations.push('no changes');
  classified.forEach((f, i) => {
    if (!f.isPipelineArtifact) {
      if (f.isTest) {
        testDeletions += f.deletions;
      } else {
        implLines += f.additions + f.deletions;
        if (!keySet.has(canonicalPath(f.path))) violations.push(`outside Key Files: ${f.path}`);
      }
    }
    if (isProtectedPath(f.path)) violations.push(REASONS.protectedPath(f.path));
    if (f.isSensitive) violations.push(REASONS.sensitivePath(f.path));
    // classifyDiffFiles drops oldPath, so it is read from the input entry at the same
    // index (classifyDiffFiles is a 1:1, order-preserving map of its input).
    const { oldPath } = inputs[i];
    if (oldPath && oldPath !== f.path) {
      if (isProtectedPath(oldPath)) violations.push(REASONS.protectedPath(oldPath));
      if (isSensitivePath(oldPath, sensitivePaths)) violations.push(REASONS.sensitivePath(oldPath));
    }
  });
  if (!Number.isFinite(maxLines)) violations.push(`invalid maxLines: ${maxLines}`);
  else if (implLines + testDeletions > maxLines) {
    violations.push(testDeletions
      ? `${implLines} implementation lines + ${testDeletions} deleted test lines > ${maxLines}`
      : `${implLines} implementation lines > ${maxLines}`);
  }

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
