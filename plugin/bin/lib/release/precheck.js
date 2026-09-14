'use strict';
const { compareVersions } = require('../changelog.js');
const { nextVersion } = require('./compose.js');
const { manifestVersionAtRef, NOT_FOUND_ERROR_RE } = require('../manifest-path.js');

const VERSION_IN_TEXT = /\bv?(\d+\.\d+\.\d+)\b/g;

// keySource: 'tsv' — this repo's own release.js path (docs/shipped-versions.tsv
// tombstones raise the base, manifest reads at plugin/.claude-plugin/plugin.json);
// 'tags' — release-local.js (#2254): the highest strict-semver v* tag raises
// the base instead, manifest reads go through the caller's versionAtRef, and
// hasOrigin:false skips the fetch and the origin read. One keySource per call —
// never both in one check (spec Gotchas).
// Highest strict-semver token across a set of lines, via `extractVersion` —
// shared by the tag tip (`tag -l v*`) and the shipped-versions tsv tip below.
function highestVersion(lines, extractVersion) {
  let tip = null;
  for (const line of lines) {
    const v = extractVersion(line);
    if (/^\d+\.\d+\.\d+$/.test(v) && (!tip || compareVersions(v, tip) > 0)) tip = v;
  }
  return tip;
}

function highestTag(deps) {
  return highestVersion(deps.git(['tag', '-l', 'v*']).split('\n'), (line) => line.trim().replace(/^v/, ''));
}

function tsvTip(deps) {
  // The tsv's own tip participates in the base: a version can be documented
  // (a wip-never-shipped tombstone line) without the manifest ever reaching it,
  // and deriving the candidate from the manifest alone then lands exactly on
  // the burned number — compose's duplicate-heading guard aborts, and no
  // renumber suggestion ever fires because the tombstone is not a "claim".
  // Observed live releasing after 6.75.0's reverted premature bump. A missing
  // tsv (a repo predating it) contributes nothing rather than aborting.
  try {
    const tsv = deps.git(['show', 'main:docs/shipped-versions.tsv']);
    return highestVersion(tsv.split('\n'), (line) => line.split('\t')[0]);
  } catch (err) {
    if (!NOT_FOUND_ERROR_RE.test(String(err.message))) {
      throw new Error(`pre-check could not read docs/shipped-versions.tsv: ${err.message}`);
    }
    return null;
  }
}

function collectClaims(deps, opts = {}) {
  const { keySource = 'tsv', branch = 'main', hasOrigin = true, versionAtRef = (ref) => manifestVersionAtRef(deps, ref) } = opts;
  if (keySource !== 'tsv' && keySource !== 'tags') throw new Error(`unknown keySource: ${keySource}`);
  const localMain = versionAtRef(branch);
  const originMain = hasOrigin ? versionAtRef(`origin/${branch}`) : localMain;

  const worktreeBranches = [];
  const porcelain = deps.git(['worktree', 'list', '--porcelain']);
  for (const line of porcelain.split('\n')) {
    const m = /^branch refs\/heads\/(.+)$/.exec(line.trim());
    if (!m || m[1] === branch) continue;
    let version;
    try {
      version = versionAtRef(m[1]);
    } catch (err) {
      // Only a genuinely absent manifest is "not a claim" — any other failure
      // (git error, malformed manifest JSON) aborts rather than silently weakening the check.
      if (NOT_FOUND_ERROR_RE.test(String(err.message))) {
        continue;
      }
      throw new Error(`pre-check could not read ${m[1]}'s manifest: ${err.message}`);
    }
    if (version !== null && version !== localMain) worktreeBranches.push({ branch: m[1], version });
  }

  const highestTagVersion = keySource === 'tags' ? highestTag(deps) : null;
  const shippedTsvTip = keySource === 'tsv' ? tsvTip(deps) : null;
  // Same-major only: a plan naming v20.12.0 in a repo at 6.x is citing a
  // dependency's version, not claiming a future plugin number.
  const reference = originMain || localMain || highestTagVersion || '0.0.0';
  const planClaims = [];
  const referenceMajor = reference.split('.')[0];
  for (const file of deps.listPlanFiles()) {
    const text = deps.readFile(file);
    for (const match of text.matchAll(VERSION_IN_TEXT)) {
      if (match[1].split('.')[0] === referenceMajor && compareVersions(match[1], reference) > 0) {
        planClaims.push({ file, version: match[1] });
      }
    }
  }

  return { originMain, localMain, worktreeBranches, planClaims, tsvTip: shippedTsvTip, tagTip: highestTagVersion };
}

function checkCollisions(candidate, claims, part) {
  const conflicts = [];
  for (const wt of claims.worktreeBranches) {
    if (compareVersions(wt.version, candidate) >= 0) {
      conflicts.push({ source: 'worktree-branch', detail: wt.branch, version: wt.version });
    }
  }
  for (const claim of claims.planClaims) {
    if (compareVersions(claim.version, candidate) >= 0) {
      conflicts.push({ source: 'plan-claim', detail: claim.file, version: claim.version });
    }
  }
  let suggested = candidate;
  if (conflicts.length) {
    const highest = conflicts.map((c) => c.version).sort(compareVersions).pop();
    suggested = nextVersion(highest, part || (candidate.endsWith('.0') ? 'minor' : 'patch'));
  }
  return { ok: conflicts.length === 0, conflicts, suggested };
}

function precheck(deps, part, opts = {}) {
  const branch = opts.branch || 'main';
  if (opts.hasOrigin !== false) deps.git(['fetch', 'origin', branch]);
  const claims = collectClaims(deps, opts);
  const known = [claims.localMain, claims.originMain, claims.tsvTip, claims.tagTip].filter(Boolean);
  const base = known.length ? known.sort(compareVersions).pop() : '0.0.0';
  const candidate = nextVersion(base, part);
  return { candidate, claims, result: checkCollisions(candidate, claims, part) };
}

module.exports = { collectClaims, checkCollisions, precheck };
