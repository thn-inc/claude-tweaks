'use strict';
// bin/lib/release-tip/check.js — the /release Step 5 reviewed-tip comparison
// as tested code (#4152), replacing execute.md's prose state machine — the
// deterministic logic that, written as prose, shipped a counting bug its pins
// could not see (IL-168). This part reads the run's decisions.md `## /release`
// block: the last full-sha `at reviewed tip`, the Step 3 review's tip, how
// many delta moves were already counted since it, and the last delta verdict
// line's `base..tip` since it (the delta whose arrived commits are folded
// into the verdict's `arrived`; a line that reads as one but does not parse comes
// back as `malformedDelta` and fails the check, never a delta skipped). Only a 40-hex sha is a tip —
// a short sha after "at reviewed tip" (e.g. "still at reviewed tip 0ecde186c")
// is prose, not a record of what was reviewed. The advance line a run-dir-only
// move writes carries the new tip but is never a counted move.
const { escapeRegExp } = require('../shared-primitives.js');
const { bumpPart } = require('../release-local/bump.js');
const { readCommits } = require('../release-local/commits.js');
const { readBumpFlags } = require('../release-local/manifest.js');

const REVIEWED_TIP_RE = /at reviewed tip ([0-9a-f]{40})(?![0-9a-f])/;
const DELTA_VERDICT_RE = /delta review base ([0-9a-f]{40})\.\.[^:\s]+: .*at reviewed tip ([0-9a-f]{40})(?![0-9a-f])/;
const STEP3_MARKER = 'whole-branch review starting';
// A line that reads as a delta verdict (it names a base and a reviewed tip) but
// fails DELTA_VERDICT_RE is skill drift, never a delta to skip silently.
const DELTA_VERDICT_HINT_RE = /delta review base .*at reviewed tip/;

function movedLineRe(branch) {
  // The lookbehind keeps a longer token that merely ends in `origin/{branch}` from counting.
  return new RegExp(`(?<![\\w./-])origin/${escapeRegExp(branch)} moved [0-9a-f]{4,40} →`);
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
  if (step3Index === -1) return { reviewedTip, step3Tip: null, priorMoves: 0, lastDelta: null, malformedDelta: null };
  const step3Match = REVIEWED_TIP_RE.exec(block[step3Index]);
  const moved = movedLineRe(branch);
  const since = block.slice(step3Index + 1);
  const priorMoves = since.filter((l) => moved.test(l)).length;
  let lastDelta = null;
  let malformedDelta = null;
  for (const line of since) {
    const m = DELTA_VERDICT_RE.exec(line);
    if (m) lastDelta = { base: m[1], tip: m[2] };
    else if (DELTA_VERDICT_HINT_RE.test(line)) malformedDelta = line;
  }
  return { reviewedTip, step3Tip: step3Match ? step3Match[1] : null, priorMoves, lastDelta, malformedDelta };
}

function advanceText({ branch, from, to, commits }) {
  return `origin/${branch} advanced ${from.slice(0, 7)} → ${to.slice(0, 7)} by run-dir-only commits (${commits} commits, nothing outside .claude-tweaks/pipelines); no review, not counted; at reviewed tip ${to}`;
}

class GitError extends Error {
  constructor(args, status, stderr) {
    super(`git ${args.join(' ')} ${status === null ? 'could not be spawned' : `exited ${status}`}: ${String(stderr ?? '').trim()}`);
    this.name = 'GitError';
    this.args = args;
    this.status = status;
    this.stderr = stderr;
  }
}

// The bump part of the commits that arrived between two tips — the same
// derivation the release engine applies (bumpPart over readCommits, flags
// from release-please-config.json at the tip), never a re-implementation.
// All parents are followed (`firstParent: false`), release-please's own range
// semantics under pr-first. `git(args)` returns { status, stdout, stderr };
// a failed `git log` throws GitError carrying git's stderr verbatim.
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

const MAX_ADVANCES = 20;
const RUN_DIR_PATHSPEC = ':!.claude-tweaks/pipelines';

// { value, source } for a readable lever, else { detail } naming the first reason it
// was not — the resolver's own stderr when it printed one.
function readBound(r) {
  if (!r) return { detail: 'resolve-policy.js produced no result' };
  if (r.status !== 0) return { detail: String(r.stderr || '').trim() || `resolve-policy.js exited ${r.status}` };
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return { detail: 'resolve-policy.js output is not JSON' };
  }
  const entry = parsed && typeof parsed === 'object' ? parsed['release-tip-moves'] : null;
  if (!entry || typeof entry !== 'object') return { detail: 'release-tip-moves is missing from the resolver output' };
  if (entry.invalid === true) return { detail: 'release-tip-moves holds an invalid value' };
  if (!Number.isInteger(entry.value) || entry.value < 0) return { detail: 'release-tip-moves is not a non-negative integer' };
  return { value: entry.value, source: typeof entry.source === 'string' ? entry.source : null };
}

// The Step 5 verdict, last before the merge: `merge` (origin/{branch} still at
// the reviewed tip, after advancing over any run-dir-only moves), `delta` (a
// code move within the release-tip-moves bound — review it), `held` (the bound
// is exceeded), or `failed` (the comparison could not run — never read as
// unmoved). `arrived` rides alongside every verdict as information, never as a
// hold: the bump part of the last delta's arrived commits, read before the
// fetch so a git failure stops first; null under `asGiven` or with no delta
// since Step 3. The skill gates a major on it once per delta. A run-dir-only
// advance is logged through `appendLog` before the loop re-compares, so a
// resume reads the advanced tip. `resolveBound()` is the raw spawn result of
// `resolve-policy.js --run <run> release-tip-moves`; no default is ever
// substituted for a bound that could not be read.
function checkReviewedTip({ decisionsText, branch, asGiven, preMajor }, { git, resolveBound, appendLog }) {
  const parsed = parseReleaseLog(decisionsText, branch);
  const state = {
    branch, reviewedTip: parsed.reviewedTip, step3Tip: parsed.step3Tip, tipSha: null, commits: null,
    move: null, bound: null, source: null, advanced: [], arrived: null, arrivedLog: null,
  };
  const out = (verdict, reason = null, detail = null) => ({ verdict, reason, detail, ...state });

  if (!state.reviewedTip || !state.step3Tip) {
    return out('failed', 'no reviewed tip recorded', 'the ## /release block has no Step 3 whole-branch-review marker line carrying a 40-hex `at reviewed tip`');
  }
  if (!asGiven && parsed.malformedDelta) return out('failed', 'delta verdict line unparseable', parsed.malformedDelta);

  if (!asGiven && parsed.lastDelta) {
    try {
      state.arrived = arrivedPart({ git, base: parsed.lastDelta.base, tip: parsed.lastDelta.tip, preMajor });
    } catch (err) {
      if (err instanceof GitError) return out('failed', 'git error', err.stderr);
      throw err;
    }
  }

  const countCommits = () => git(['rev-list', '--count', `${state.reviewedTip}..${state.tipSha}`]);
  let codeMove = false;
  for (let i = 0; i < MAX_ADVANCES && !codeMove; i += 1) {
    const fetched = git(['fetch', '--quiet', 'origin', branch]);
    if (fetched.status !== 0) return out('failed', 'fetch failed', fetched.stderr);
    const tip = git(['rev-parse', '--verify', '--end-of-options', `origin/${branch}^{commit}`]);
    if (tip.status !== 0) return out('failed', 'git error', tip.stderr);
    state.tipSha = tip.stdout.trim();
    if (state.tipSha === state.reviewedTip) return out('merge');

    const diff = git(['diff', '--quiet', state.reviewedTip, state.tipSha, '--', RUN_DIR_PATHSPEC]);
    if (diff.status === 1) {
      codeMove = true;
    } else if (diff.status === 0) {
      const counted = countCommits();
      if (counted.status !== 0) return out('failed', 'git error', counted.stderr);
      const advance = { from: state.reviewedTip, to: state.tipSha, commits: Number(counted.stdout.trim()) };
      try {
        appendLog(advanceText({ branch, ...advance }));
      } catch (err) {
        return out('failed', 'log write failed', err && err.message ? err.message : String(err));
      }
      state.advanced.push(advance);
      state.reviewedTip = state.tipSha;
    } else {
      return out('failed', 'git error', diff.stderr);
    }
  }
  if (!codeMove) return out('failed', 'run-dir-only advances did not converge');

  const bound = readBound(resolveBound());
  if (bound.value === undefined) return out('failed', 'release-tip-moves unreadable', bound.detail);
  state.bound = bound.value;
  state.source = bound.source;
  state.move = parsed.priorMoves + 1;

  if (state.move > state.bound) {
    const log = git(['log', '--first-parent', '--oneline', `${state.step3Tip}..${state.tipSha}`]);
    if (log.status !== 0) return out('failed', 'git error', log.stderr);
    state.arrivedLog = log.stdout;
    return out('held', 'integration branch kept moving');
  }

  const counted = countCommits();
  if (counted.status !== 0) return out('failed', 'git error', counted.stderr);
  state.commits = Number(counted.stdout.trim());
  return out('delta');
}

module.exports = {
  REVIEWED_TIP_RE, DELTA_VERDICT_RE, movedLineRe, releaseBlock, parseReleaseLog, advanceText, arrivedPart, GitError,
  MAX_ADVANCES, checkReviewedTip,
};
