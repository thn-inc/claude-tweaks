'use strict';
// bin/lib/release-tip/check.js — the /release Step 5 reviewed-tip comparison
// as tested code (#4152), replacing execute.md's prose state machine — the
// deterministic logic that, written as prose, shipped a counting bug its pins
// could not see (IL-168). This part reads the run's decisions.md `## /release`
// block: the last full-sha `at reviewed tip`, the Step 3 review's tip, and how
// many delta moves were already counted since it. Only a 40-hex sha is a tip —
// a short sha after "at reviewed tip" (e.g. "still at reviewed tip 0ecde186c")
// is prose, not a record of what was reviewed. The advance line a run-dir-only
// move writes carries the new tip but is never a counted move.
const { escapeRegExp } = require('../shared-primitives.js');
const { bumpPart } = require('../release-local/bump.js');
const { readCommits } = require('../release-local/commits.js');
const { readBumpFlags } = require('../release-local/manifest.js');

const REVIEWED_TIP_RE = /at reviewed tip ([0-9a-f]{40})(?![0-9a-f])/;
const STEP3_MARKER = 'whole-branch review starting';

function movedLineRe(branch) {
  return new RegExp(`origin/${escapeRegExp(branch)} moved [0-9a-f]{4,40} →`);
}

function releaseBlock(decisionsText) {
  const lines = decisionsText.split('\n');
  const start = lines.findIndex((l) => l.trimEnd() === '## /release');
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

function parseReleaseLog(decisionsText, branch) {
  const block = releaseBlock(decisionsText);
  let reviewedTip = null;
  let step3Index = -1;
  block.forEach((line, i) => {
    const m = REVIEWED_TIP_RE.exec(line);
    if (m) reviewedTip = m[1];
    if (line.includes(STEP3_MARKER)) step3Index = i;
  });
  if (step3Index === -1) return { reviewedTip, step3Tip: null, priorMoves: 0 };
  const step3Match = REVIEWED_TIP_RE.exec(block[step3Index]);
  const moved = movedLineRe(branch);
  const priorMoves = block.slice(step3Index + 1).filter((l) => moved.test(l)).length;
  return { reviewedTip, step3Tip: step3Match ? step3Match[1] : null, priorMoves };
}

function advanceText({ branch, from, to, commits }) {
  return `origin/${branch} advanced ${from.slice(0, 7)} → ${to.slice(0, 7)} by run-dir-only commits (${commits} commits, nothing outside .claude-tweaks/pipelines); no review, not counted; at reviewed tip ${to}`;
}

// The bump part of the commits that arrived between two tips — the same
// derivation the release engine applies (bumpPart over readCommits, flags
// from release-please-config.json at the tip), never a re-implementation.
// All parents are followed (`firstParent: false`), release-please's own range
// semantics under pr-first. `git(args)` returns { status, stdout, stderr };
// a failed `git log` throws GitError carrying git's stderr verbatim.
class GitError extends Error {
  constructor(args, status, stderr) {
    super(`git ${args.join(' ')} exited ${status}: ${String(stderr).trim()}`);
    this.name = 'GitError';
    this.args = args;
    this.status = status;
    this.stderr = stderr;
  }
}

function arrivedPart({ git, base, tip, preMajor }) {
  const stdoutGit = (args) => {
    const r = git(args);
    if (r.status !== 0) throw new GitError(args, r.status, r.stderr);
    return r.stdout;
  };
  const commits = readCommits(stdoutGit, base, tip, { firstParent: false });
  const flags = readBumpFlags((p) => {
    const r = git(['show', `${tip}:${p}`]);
    return r.status === 0 ? r.stdout : null;
  });
  return { base, tip, part: bumpPart(commits, { preMajor, ...flags }), shas: commits.map((c) => c.sha) };
}

module.exports = { REVIEWED_TIP_RE, movedLineRe, releaseBlock, parseReleaseLog, advanceText, arrivedPart, GitError };
