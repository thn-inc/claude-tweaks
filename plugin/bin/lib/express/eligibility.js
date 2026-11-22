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
const { parseRiskFlags } = require('../issues/record-risk-flags');
const { fileMatchesFrontendPredicate } = require('../design-detect/index');
const { classifyDiffFiles, isSensitivePath } = require('../issues/blast-radius');
const { CEREMONY_TIERS } = require('../issues/record-vocabulary');

const EXPRESS_MAX_KEY_FILES = 3;

// A label name exactly `ceremony:{tier}` for a recognised tier (case-sensitive, like the vocabulary).
function isCeremonyTierName(n) {
  return n.startsWith('ceremony:') && CEREMONY_TIERS.includes(n.slice('ceremony:'.length));
}

// The size labels each ceiling accepts. The express lane is fixed at `low`; the pipeline
// driver lane (#5224) may pass `medium`.
const SIZE_CEILINGS = Object.freeze({ low: Object.freeze(['low']), medium: Object.freeze(['low', 'medium']) });

// The risk labels each ceiling accepts (#6018). The express lane is fixed at `low`; the pipeline
// driver may pass `medium` or `high` (policy `express-driver-max-risk`).
const RISK_CEILINGS = Object.freeze({
  low: Object.freeze(['low']),
  medium: Object.freeze(['low', 'medium']),
  high: Object.freeze(['low', 'medium', 'high']),
});

// The driver lane's bound values as eligibility reads them: a ceiling is an own key of SIZE_CEILINGS
// (`toString` is not one), and a Key File limit is a safe integer of at least 1.
function isReadableSizeCeiling(v) {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SIZE_CEILINGS, v);
}
function isReadableRiskCeiling(v) {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(RISK_CEILINGS, v);
}
function isReadableKeyFileLimit(v) {
  return Number.isSafeInteger(v) && v >= 1;
}

// Beyond the express bounds: a size label that is not `low`, or more than EXPRESS_MAX_KEY_FILES Key
// Files. A `keyFiles` that is not an array counts as beyond.
function isBeyondExpressBounds({ size, keyFiles } = {}) {
  return size !== 'low' || !Array.isArray(keyFiles) || keyFiles.length > EXPRESS_MAX_KEY_FILES;
}

// The two driver-lane bound comparisons, stated once: eligibility refuses on each, and admission's
// reviewer rule composes them as isInsideLaneBounds. Callers check readability first.
function sizeWithinCeiling(size, sizeCeiling) {
  return SIZE_CEILINGS[sizeCeiling].includes(size);
}
function keyFilesWithinLimit(keyFiles, maxKeyFiles) {
  return keyFiles.length <= maxKeyFiles;
}
// Inside the driver's lane bounds ({ sizeCeiling, maxKeyFiles }, both readable).
function isInsideLaneBounds({ size, keyFiles, bounds }) {
  return sizeWithinCeiling(size, bounds.sizeCeiling) && keyFilesWithinLimit(keyFiles, bounds.maxKeyFiles);
}

// Reasons for the three bounds the driver lane can widen (risk, size, Key Files). REASONS.risk,
// REASONS.size and REASONS.tooManyKeyFiles are built from these at the express defaults, so the express
// strings cannot drift from the parameterised ones.
const BOUND_REASONS = Object.freeze({
  risk: (ceiling) => (isReadableRiskCeiling(ceiling)
    ? `risk is not ${RISK_CEILINGS[ceiling].join(' or ')}`
    : BOUND_REASONS.riskCeilingUnreadable(ceiling)),
  riskCeilingUnreadable: (v) => `risk ceiling unreadable: ${String(v)}`,
  // A ceiling that is not a RISK_CEILINGS / SIZE_CEILINGS key gets the unreadable reason, never a throw.
  size: (ceiling) => (isReadableSizeCeiling(ceiling)
    ? `size is not ${SIZE_CEILINGS[ceiling].join(' or ')}`
    : BOUND_REASONS.sizeCeilingUnreadable(ceiling)),
  tooManyKeyFiles: (limit) => `more than ${limit} Key Files`,
  sizeCeilingUnreadable: (v) => `size ceiling unreadable: ${String(v)}`,
  keyFileLimitUnreadable: (v) => `Key File limit unreadable: ${String(v)}`,
});

// Wire contract: callers and reports match these verbatim — never paraphrase.
const REASONS = Object.freeze({
  disabled: 'express-lane disabled',
  notPrFirst: 'integration-model is not pr-first',
  risk: BOUND_REASONS.risk('low'),
  size: BOUND_REASONS.size('low'),
  ceremony: 'ceremony is not fast-lane',
  type: 'no type:* label',
  mergePending: 'auto:merge-pending grant matures only on the normal path',
  noKeyFiles: 'no Key Files',
  tooManyKeyFiles: BOUND_REASONS.tooManyKeyFiles(EXPRESS_MAX_KEY_FILES),
  frontend: 'frontend surface',
  notShaped: 'not spec-shaped',
  escalated: 'already escalated in this run',
  riskFlags: 'record carries a kept risk flag',
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
// Harm model (#6019): the CI/forge, git-hook, `package.json` and agent-config families act at push or
// build time, before any merge, so no merge-time review can vouch for them (BUILD_TIME_PROTECTED_RES).
// The rest (hook code, `skills/_shared/`, CODEOWNERS, policy, verify-scope) act only once merged, so the
// driver may take them behind its reviewer; the express lane never does.
const PROTECTED_PATH_RES = [
  /(^|\/)hooks\//,
  /(^|\/)hooks\.js$/,
  /(^|\/)hooks\.sh$/,
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

// The PROTECTED_PATH_RES families that act before a merge (#6019); each is the same regex as its
// PROTECTED_PATH_RES entry (a test pins the sources equal), applied only to a path also protected.
const BUILD_TIME_PROTECTED_RES = Object.freeze([
  /(^|\/)\.github\//,
  /(^|\/)\.gitlab-ci\.yml$/,
  /(^|\/)\.circleci\//,
  /(^|\/)\.githooks\//,
  /(^|\/)\.husky\//,
  /(^|\/)package\.json$/,
  /(^|\/)\.claude\/settings[^/]*\.json$/,
  /(^|\/)\.mcp\.json$/,
]);

function isBuildTimeProtectedPath(path) {
  if (!isProtectedPath(path)) return false;
  const normalized = canonicalPath(path);
  return BUILD_TIME_PROTECTED_RES.some((re) => re.test(normalized));
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
// the normal path's wrap-up; a kept risk flag (#4618) needs a plan step proving it, and
// the lane composes no plan — parseRiskFlags reads a malformed line as every category
// flagged, so an unreadable line is ineligible too. sizeCeiling and maxKeyFiles exist for
// the pipeline driver lane (#5224; its admission is ../driver/admission.js) — every express
// caller omits them, and an unreadable value refuses rather than falls back. riskCeiling and
// allowAnyCeremony (#6018) are driver-only too: riskCeiling admits risk labels up to the ceiling
// (an unreadable one refuses), and allowAnyCeremony === true admits any recognised ceremony:* tier.
// protectedPathsNeedReviewer (#6019) is driver-only: only a literal true stops refusing a protected
// Key File that is not build-time (isBuildTimeProtectedPath); the merge-sensitive check is unchanged.
function evaluateRecordEligibility(issue, opts) {
  const {
    enabled, integrationModel, sensitivePaths = [], escalated = false, allowAbsentCeremony = false,
    sizeCeiling, maxKeyFiles, riskCeiling, allowAnyCeremony = false, protectedPathsNeedReviewer = false,
  } = opts || {};
  const body = (issue && issue.body) || '';
  const labels = (issue && issue.labels) || [];
  const facets = parseRecordFacets(labels);
  const keyFiles = extractKeyFiles({ body, labels });
  const reasons = [];

  if (enabled !== true) reasons.push(REASONS.disabled);
  if (integrationModel !== 'pr-first') reasons.push(REASONS.notPrFirst);
  if (riskCeiling === undefined) {
    if (facets.risk !== 'low') reasons.push(REASONS.risk);
  } else if (!isReadableRiskCeiling(riskCeiling)) {
    reasons.push(BOUND_REASONS.riskCeilingUnreadable(riskCeiling));
  } else if (!RISK_CEILINGS[riskCeiling].includes(facets.risk)) {
    reasons.push(BOUND_REASONS.risk(riskCeiling));
  }
  if (sizeCeiling === undefined) {
    if (facets.size !== 'low') reasons.push(REASONS.size);
  } else if (!isReadableSizeCeiling(sizeCeiling)) {
    reasons.push(BOUND_REASONS.sizeCeilingUnreadable(sizeCeiling));
  } else if (!sizeWithinCeiling(facets.size, sizeCeiling)) {
    reasons.push(BOUND_REASONS.size(sizeCeiling));
  }
  // allowAbsentCeremony relaxes only this rule, for the pipeline driver lane (#5216; its
  // admission is ../driver/admission.js): no ceremony:* label at all passes, since the lane's
  // other gates (risk, size, type, Key Files, shape) still apply. It reads raw label names, any
  // spelling, because facets.ceremony is null for an unrecognised label (ceremony:fastlane,
  // Ceremony:fast-lane) as well as an absent one, and an unrecognised label must still refuse.
  // allowAnyCeremony (#6018) also passes a record whose every ceremony:* label is a recognised tier
  // spelled exactly (at least one present), so a stray ceremony:fastlane beside ceremony:standard refuses.
  const ceremonyNames = normalizeLabelNames(labels).filter((n) => /^ceremony:/i.test(n));
  const ceremonyOk = facets.ceremony === 'fast-lane'
    || (allowAbsentCeremony === true && ceremonyNames.length === 0)
    || (allowAnyCeremony === true && ceremonyNames.length > 0 && ceremonyNames.every(isCeremonyTierName));
  if (!ceremonyOk) reasons.push(REASONS.ceremony);
  if (!typeOf(issue || {})) reasons.push(REASONS.type);
  if (normalizeLabelNames(labels).includes('auto:merge-pending')) reasons.push(REASONS.mergePending);
  if (keyFiles.length === 0) reasons.push(REASONS.noKeyFiles);
  if (maxKeyFiles === undefined) {
    if (keyFiles.length > EXPRESS_MAX_KEY_FILES) reasons.push(REASONS.tooManyKeyFiles);
  } else if (!isReadableKeyFileLimit(maxKeyFiles)) {
    reasons.push(BOUND_REASONS.keyFileLimitUnreadable(maxKeyFiles));
  } else if (!keyFilesWithinLimit(keyFiles, maxKeyFiles)) {
    reasons.push(BOUND_REASONS.tooManyKeyFiles(maxKeyFiles));
  }
  if (isFrontend(body, keyFiles)) reasons.push(REASONS.frontend);
  for (const p of keyFiles) {
    if (protectedPathsNeedReviewer === true ? isBuildTimeProtectedPath(p) : isProtectedPath(p)) reasons.push(REASONS.protectedPath(p));
    if (isSensitivePath(canonicalPath(p), sensitivePaths)) reasons.push(REASONS.sensitivePath(p));
  }
  if (!shapeGate(body).ok) reasons.push(REASONS.notShaped);
  if (escalated === true) reasons.push(REASONS.escalated);
  if (parseRiskFlags(body).flags.length > 0) reasons.push(REASONS.riskFlags);

  return { number: issue && issue.number, eligible: reasons.length === 0, reasons, keyFiles };
}

// Which of the driver's two widened rules a record actually relies on (#6018): 'risk' when a label
// names risk:medium or risk:high under a readable ceiling, 'ceremony' when anyCeremony === true and a
// label names a recognised tier other than fast-lane, and 'protected-path' (#6019, last) when
// protectedPathsNeedReviewer === true and some Key File in the keyFiles array is protected. It scans every label name, never the parsed
// facets (which keep only the last match), so a dual-labelled record answers the same in any order.
// Pure: the driver steps, merge.js and the queue pull call it; admission and review read its result.
function widenings({ labels, riskCeiling, anyCeremony, keyFiles, protectedPathsNeedReviewer } = {}) {
  const names = normalizeLabelNames(labels || []);
  const out = [];
  if (isReadableRiskCeiling(riskCeiling) && names.some((n) => n === 'risk:medium' || n === 'risk:high')) out.push('risk');
  if (anyCeremony === true && names.some((n) => isCeremonyTierName(n) && n !== 'ceremony:fast-lane')) out.push('ceremony');
  if (protectedPathsNeedReviewer === true && Array.isArray(keyFiles) && keyFiles.some(isProtectedPath)) out.push('protected-path');
  return out;
}

// Every changed non-test, non-pipeline-artifact path must be a Key File and
// count toward implLines. A test file's deleted lines count toward maxLines too
// (deleting tests weakens the CI-green net the lane merges on); its added lines
// stay exempt. The protected and merge-sensitive checks apply to every changed
// path, tests included, and to a rename's oldPath. A missing or non-finite
// maxLines (e.g. Number() of a malformed policy value) fails closed. reportProtectedPaths === true
// (#6019, driver only) moves a protected path (or a rename's protected oldPath) that is neither build-time
// nor merge-sensitive out of violations into the result's protectedPaths (encounter order, no
// duplicates); the key is absent otherwise, so the express return shape is unchanged.
function evaluateDiffBounds(files, opts) {
  const { keyFiles = [], sensitivePaths = [], maxLines, reportProtectedPaths } = opts || {};
  const report = reportProtectedPaths === true;
  const protectedPaths = [];
  const noteProtected = (p) => { if (!protectedPaths.includes(p)) protectedPaths.push(p); };
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
    if (isProtectedPath(f.path)) {
      if (report && !isBuildTimeProtectedPath(f.path) && !f.isSensitive) noteProtected(f.path);
      else violations.push(REASONS.protectedPath(f.path));
    }
    if (f.isSensitive) violations.push(REASONS.sensitivePath(f.path));
    // classifyDiffFiles drops oldPath, so it is read from the input entry at the same
    // index (classifyDiffFiles is a 1:1, order-preserving map of its input).
    const { oldPath } = inputs[i];
    if (oldPath && oldPath !== f.path) {
      const oldSensitive = isSensitivePath(oldPath, sensitivePaths);
      if (isProtectedPath(oldPath)) {
        if (report && !isBuildTimeProtectedPath(oldPath) && !oldSensitive) noteProtected(oldPath);
        else violations.push(REASONS.protectedPath(oldPath));
      }
      if (oldSensitive) violations.push(REASONS.sensitivePath(oldPath));
    }
  });
  if (!Number.isFinite(maxLines)) violations.push(`invalid maxLines: ${maxLines}`);
  else if (implLines + testDeletions > maxLines) {
    violations.push(testDeletions
      ? `${implLines} implementation lines + ${testDeletions} deleted test lines > ${maxLines}`
      : `${implLines} implementation lines > ${maxLines}`);
  }

  const out = { withinBounds: violations.length === 0, violations, implLines, changedFiles: classified.map((f) => f.path) };
  if (report) out.protectedPaths = protectedPaths;
  return out;
}

// The express lane merges on green by construction: a resolved `off` (or
// anything but an explicit `wait`) never disables its merge.
function expressMergeVerification(resolved) {
  return resolved === 'wait' ? 'wait' : 'merge-when-green';
}

module.exports = {
  EXPRESS_MAX_KEY_FILES, isBeyondExpressBounds, isInsideLaneBounds, isReadableSizeCeiling, isReadableKeyFileLimit, SIZE_CEILINGS,
  RISK_CEILINGS, isReadableRiskCeiling, widenings,
  BOUND_REASONS, REASONS, isProtectedPath, BUILD_TIME_PROTECTED_RES, isBuildTimeProtectedPath, evaluateRecordEligibility, evaluateDiffBounds, expressMergeVerification,
};
