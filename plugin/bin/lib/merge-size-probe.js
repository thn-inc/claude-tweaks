'use strict';
// The gather half of #641's merge-induced ceiling check: predicts, via
// `git merge-tree --write-tree`, the post-merge byte size of every
// branch-touched `skills/_shared/*.md` / `SKILL.md` file against an
// integration branch (default `main`) -- catching an overflow that only
// shows up once two concurrent branches' additions to the same shared file
// land together, which the working-tree-only checks in
// skill-audit/context-cost.js cannot see (each branch is green alone).
//
// Injectable seam (deps.git) follows the same fake-runner convention as
// bin/lib/blast-radius-cli.js (see the gh-api-module-pattern skill) --
// argv array only, never a shell string.
//
// Scope note (record #641 Gotchas): this is a prediction against the
// integration branch as of probe time. A sibling branch that merges after
// the probe runs but before this branch merges can still produce a fresh
// overflow the probe never saw -- it narrows the race, it does not close it.
const { execFileSync } = require('child_process');
const { CEILING_BYTES } = require('./skill-audit/context-cost.js');

class MergeSizeProbeError extends Error {
  constructor(...args) {
    super(...args);
    this.name = 'MergeSizeProbeError';
  }
}

function defaultGit(args) {
  return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true });
}

// Ceiling-eligible: a SKILL.md at any depth, or any *.md directly under a
// skills/_shared/ directory -- the same corpus context-cost.js measures.
const CEILING_ELIGIBLE = /(^|\/)SKILL\.md$|\/_shared\/[^/]+\.md$/;

function eligiblePaths(paths) {
  return paths.filter((p) => CEILING_ELIGIBLE.test(p));
}

// git diff --name-only over the branch's own changes relative to the merge
// base with integrationBranch -- triple-dot, so a sibling's unrelated
// commits already on integrationBranch never appear as "touched by us".
function touchedFiles(git, integrationBranch, headRef) {
  let raw;
  try {
    raw = git(['diff', '--no-renames', '--name-only', `${integrationBranch}...${headRef}`]);
  } catch (err) {
    throw new MergeSizeProbeError(`git diff --name-only failed: ${err.message}`);
  }
  return raw.split('\n').filter(Boolean);
}

function writeMergeTree(git, integrationBranch, headRef) {
  let raw;
  try {
    raw = git(['merge-tree', '--write-tree', '--end-of-options', integrationBranch, headRef]);
  } catch (err) {
    throw new MergeSizeProbeError(
      `git merge-tree --write-tree failed (a real merge conflict is the merge sequence's own `
      + `problem to surface, not this probe's): ${err.message}`
    );
  }
  // --write-tree prints the resulting tree OID as its first line on a clean
  // merge; a conflicted merge exits non-zero above, so a throw already
  // covers that case and this is always the OID line.
  const tree = raw.split('\n')[0].trim();
  if (!tree) throw new MergeSizeProbeError('merge-tree --write-tree returned an empty tree OID');
  return tree;
}

// git show exits 128 with a "does not exist in" stderr message when a path is
// absent from the given tree -- the one failure mode this function treats as
// "not a ceiling concern" rather than a probe failure (review #641: a bare
// catch here previously swallowed every git-show error, including a real one
// unrelated to deletion, as a silent false "nothing to measure").
const PATH_NOT_IN_TREE = /does not exist/;

function measureAtTree(git, tree, filePath) {
  try {
    const content = git(['show', `${tree}:${filePath}`]);
    return Buffer.byteLength(content, 'utf8');
  } catch (err) {
    // Deleted by the merge (e.g. this branch removed the file) -- not a
    // ceiling concern, so it's simply absent from `measured`, not an error.
    if (PATH_NOT_IN_TREE.test(err.stderr || err.message || '')) return null;
    throw new MergeSizeProbeError(`git show ${tree}:${filePath} failed: ${err.message}`);
  }
}

// opts: { integrationBranch = 'main', headRef = 'HEAD', paths } -- `paths`
// overrides auto-discovery (used by the CLI's --paths flag and by tests that
// want to bypass the diff step). deps: { git }.
function computeMergeSizeOverflow(opts = {}, deps = {}) {
  const git = deps.git || defaultGit;
  const integrationBranch = opts.integrationBranch || 'main';
  const headRef = opts.headRef || 'HEAD';

  const candidates = eligiblePaths(
    Array.isArray(opts.paths) ? opts.paths : touchedFiles(git, integrationBranch, headRef)
  );
  if (candidates.length === 0) {
    return { mergedTree: null, measured: [], overflow: [] };
  }

  const mergedTree = writeMergeTree(git, integrationBranch, headRef);
  const measured = [];
  for (const filePath of candidates) {
    const bytes = measureAtTree(git, mergedTree, filePath);
    if (bytes === null) continue;
    measured.push({ path: filePath, bytes });
  }
  const overflow = measured
    .filter((m) => m.bytes > CEILING_BYTES)
    .map((m) => ({ ...m, over: m.bytes - CEILING_BYTES }));

  return { mergedTree, measured, overflow };
}

module.exports = { computeMergeSizeOverflow, MergeSizeProbeError, CEILING_ELIGIBLE };
