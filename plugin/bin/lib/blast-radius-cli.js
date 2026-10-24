'use strict';
// The gather half of assess-agent-autonomy's merge-check mode, as one process
// (#888): merge-base resolution, numstat parsing, policy-config resolution, and
// classification via bin/lib/issues/blast-radius.js. Hard-fails (throws
// BlastRadiusError) when the base cannot be resolved — a zero-file summary from
// a resolution failure is structurally impossible, which is the whole point:
// the retired prose choreography could silently read `git diff ""..HEAD` as an
// empty diff and clear every auto-merge threshold.
//
// Two consumers share gatherDiffFiles (the merge-base + numstat gather):
// computeBlastRadius here (blast-radius.js, #888) adds policy config and
// classification, and bin/diff-facts.js (#3955) feeds the same file list to
// computeDiffFacts.
//
// Injectable seams (deps.git, deps.readFile) follow the same fake-runner test
// convention as the gh-shelling modules (see the gh-api-module-pattern skill).
const fs = require('fs');
const { execFileSync } = require('child_process');
const { classifyDiffFiles, blastRadiusSummary } = require('./issues/blast-radius.js');
const { resolvePolicyConfig } = require('./policy-schema.js');
const { parseNumstatZ } = require('./git-z.js');

class BlastRadiusError extends Error {
  constructor(...args) {
    super(...args);
    this.name = 'BlastRadiusError';
  }
}

function defaultGit(args) {
  return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true });
}

function defaultReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function resolveConfig({ git, readFile, runDir }) {
  let resolved;
  try {
    ({ result: resolved } = resolvePolicyConfig({
      git,
      readFile,
      runDir,
      keys: ['merge-sensitive-paths', 'auto-merge-max-lines', 'auto-merge-max-files'],
    }));
  } catch (err) {
    throw new BlastRadiusError(`failed to read policy config: ${err.message}`);
  }
  const rawPaths = resolved['merge-sensitive-paths'].value;
  const mergeSensitivePaths = Array.isArray(rawPaths)
    ? rawPaths
    : String(rawPaths || '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    mergeSensitivePaths,
    autoMergeMaxLines: Number(resolved['auto-merge-max-lines'].value),
    autoMergeMaxFiles: Number(resolved['auto-merge-max-files'].value),
  };
}

// #1592: a bare integration-branch name (e.g. "main") resolves against the
// *local* ref, which goes stale in a long-lived shared checkout — merge-base
// against a stale local main can land many commits behind origin/main and
// inflate the blast radius with already-landed, unrelated commits. When the
// name is bare and a same-named remote-tracking origin/{name} ref exists,
// prefer it; every caller (merge-check.md included) gets the fix without
// having to fetch-and-prefer-origin at each call site individually. The
// `refs/remotes/` prefix makes the verify lookup safe even for a name that
// starts with "-" — the full arg never begins with "-", so it cannot be
// misread as a flag.
function preferOriginRef(git, integrationBranch) {
  if (integrationBranch.startsWith('origin/')) return integrationBranch;
  const candidate = `origin/${integrationBranch}`;
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/remotes/${candidate}`]);
    return candidate;
  } catch {
    return integrationBranch;
  }
}

// A caller-supplied --base is verified as a commit rather than trusted; otherwise
// the base is derived from the integration branch. --end-of-options keeps a ref
// beginning with "-" from being read as a git flag. Either path throws rather than
// returning an unusable base — an empty one would diff as a zero-file radius.
function resolveMergeBase(git, { base, integrationBranch }) {
  if (base) {
    try {
      return git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
    } catch (err) {
      throw new BlastRadiusError(`--base "${base}" does not resolve to a commit: ${err.message}`);
    }
  }
  const ref = preferOriginRef(git, integrationBranch);
  try {
    return git(['merge-base', '--end-of-options', ref, 'HEAD']).trim();
  } catch (err) {
    throw new BlastRadiusError(`could not resolve merge base of "${ref}" and HEAD: ${err.message}`);
  }
}

// The merge-base + numstat gather both consumers share: no policy-config read,
// no classification. Returns {mergeBase, files} with files in parseNumstatZ's
// [{path, additions, deletions}] shape.
function gatherDiffFiles(opts = {}, deps = {}) {
  const git = deps.git || defaultGit;
  const { base, integrationBranch } = opts;

  if (!base && !integrationBranch) {
    throw new BlastRadiusError('one of --base or --integration-branch is required');
  }

  const mergeBase = resolveMergeBase(git, { base, integrationBranch });
  if (!mergeBase) {
    throw new BlastRadiusError('merge-base resolution returned an empty value');
  }

  let diffRaw;
  try {
    diffRaw = git(['diff', '--no-renames', '--numstat', '-z', '--end-of-options', `${mergeBase}..HEAD`]);
  } catch (err) {
    throw new BlastRadiusError(`git diff --numstat failed: ${err.message}`);
  }
  return { mergeBase, files: parseNumstatZ(diffRaw) };
}

function computeBlastRadius(opts = {}, deps = {}) {
  const git = deps.git || defaultGit;
  const readFile = deps.readFile || defaultReadFile;
  const { runDir = null } = opts;

  const { mergeBase, files } = gatherDiffFiles(opts, deps);
  const config = resolveConfig({ git, readFile, runDir });
  const summary = blastRadiusSummary(classifyDiffFiles(files, config.mergeSensitivePaths));
  return { mergeBase, config, summary };
}

module.exports = {
  computeBlastRadius, gatherDiffFiles, BlastRadiusError, preferOriginRef,
};
