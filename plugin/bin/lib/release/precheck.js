'use strict';
const { compareVersions, nextVersion } = require('../changelog.js');
const { manifestVersionAtRef, NOT_FOUND_ERROR_RE } = require('../manifest-path.js');

const VERSION_IN_TEXT = /\bv?(\d+\.\d+\.\d+)\b/g;

// Highest strict-semver token across a set of lines, via extractVersion.
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

// keySource: 'tags' — the only remaining path (release-local.js, #2254): the
// highest strict-semver v* tag raises the base, manifest reads go through the
// caller's versionAtRef, and hasOrigin:false skips the fetch and the origin
// read. #2259 retired this repo's own hand-rolled release.js and the
// docs/shipped-versions.tsv-backed 'tsv' keySource that went with it — 'tags'
// used to be one of two paths; now it's the only one, and the option stays
// only because release-local.js still passes it explicitly.
function collectClaims(deps, opts = {}) {
  const { keySource = 'tags', branch = 'main', hasOrigin = true, versionAtRef = (ref) => manifestVersionAtRef(deps, ref) } = opts;
  if (keySource !== 'tags') throw new Error(`unknown keySource: ${keySource}`);
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

  const highestTagVersion = highestTag(deps);
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

  return { originMain, localMain, worktreeBranches, planClaims, tagTip: highestTagVersion };
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
  const known = [claims.localMain, claims.originMain, claims.tagTip].filter(Boolean);
  const base = known.length ? known.sort(compareVersions).pop() : '0.0.0';
  // An explicit candidate (bin/release-local.js's --release-as, #2326) bypasses
  // nextVersion's derivation but not the collision check below — it must still
  // be ahead of the computed base, checked separately since "not ahead" is a
  // usage error (the caller picked a bad value), never a version collision.
  if (opts.releaseAs) {
    if (compareVersions(opts.releaseAs, base) <= 0) {
      return { candidate: opts.releaseAs, base, claims, result: { ok: false, usageError: true, conflicts: [], suggested: null } };
    }
    return { candidate: opts.releaseAs, base, claims, result: checkCollisions(opts.releaseAs, claims, part) };
  }
  const candidate = nextVersion(base, part);
  return { candidate, base, claims, result: checkCollisions(candidate, claims, part) };
}

module.exports = { collectClaims, checkCollisions, precheck };
