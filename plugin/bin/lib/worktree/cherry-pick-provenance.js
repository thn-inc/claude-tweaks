// bin/lib/worktree/cherry-pick-provenance.js — detection logic for the
// build-time guard that warns before a build session ships a cherry-picked
// commit whose source branch already backs a still-open PR (#1957, closing
// #1821's incident: a build cherry-picked 1893db5b7 from
// origin/worktree-record-1224 believing it abandoned, but that branch backed
// PR #1852 — still open, review-passed — producing two open PRs with
// byte-identical implementation).
//
// Mirrors `build/worktree-setup.md`'s Step 1.6 (Remote-only stale branch
// check) shape for a different trigger condition: same fail-open-on-lookup-
// failure posture, same "stop card, not a silenceable auto-mode lever"
// disposition. See that file's new "Cherry-pick source-branch PR check"
// section for the full procedure this module's exports are invoked from.
//
// Deliberately narrow trigger: only a `git cherry-pick -x` trailer is
// detected. A manual port, or a `cherry-pick` without `-x`, leaves no
// git-native signal and is not caught here — an accepted limitation stated
// in worktree-setup.md, not an oversight (see this record's Non-Goals).
'use strict';

const { execFileSync } = require('child_process');

// Bound per gh-api-module-pattern: gh pr list is a network call. `git branch
// -r --contains` is a local-only read of already-fetched remote-tracking
// refs (no network round trip), so it is intentionally left unbounded, same
// as that skill's `branch -r --merged` example.
const GH_TIMEOUT_MS = 5000;

const TRAILER_RE = /\(cherry picked from commit ([0-9a-f]{7,40})\)/i;

// Returns the source sha from a `(cherry picked from commit {sha})` trailer,
// or null when the message carries no such trailer (AC3: an ordinary
// authored commit is never scanned further than this call).
function parseCherryPickTrailer(message) {
  if (typeof message !== 'string') return null;
  const m = TRAILER_RE.exec(message);
  return m ? m[1] : null;
}

function defaultGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function defaultGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', timeout: GH_TIMEOUT_MS });
}

// Resolves every remote branch containing `sha`, excluding `ownBranch` (this
// record's own branch always contains its own cherry-picked commit and is
// never itself the collision). `git branch -r --contains` can return
// multiple branches (Gotchas: a shared ancestor, or the source merged into
// others) — every one is returned, not just the first.
function findContainingBranches({ sha, ownBranch, git = defaultGit }) {
  let out;
  try {
    out = git(['branch', '-r', '--contains', sha]);
  } catch (err) {
    return { ok: false, error: err };
  }
  const branches = out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes('->')) // e.g. "origin/HEAD -> origin/main"
    .map((line) => line.replace(/^origin\//, ''))
    .filter((name) => name && name !== ownBranch);
  return { ok: true, branches: Array.from(new Set(branches)) };
}

// Checks each branch for an open PR. A per-branch lookup failure degrades
// that branch's result distinctly from "confirmed no open PR" (mirrors Step
// 1.6's fail-open-but-distinct-log posture) and sets the overall `degraded`
// flag — never silently treated as "no PR found" on the whole batch.
function findOpenPrsForBranches({ branches, repo, gh = defaultGh }) {
  const results = [];
  let degraded = false;
  for (const branch of branches) {
    try {
      const out = gh([
        'pr', 'list', '--repo', repo, '--head', branch, '--state', 'open',
        '--json', 'number,url,isDraft',
      ]);
      const prs = JSON.parse(out || '[]');
      results.push({ branch, ok: true, prs });
    } catch (err) {
      degraded = true;
      results.push({ branch, ok: false, error: err, prs: [] });
    }
  }
  return { results, degraded };
}

// Full orchestration for one commit message. Returns:
//   { scanned: false }                                    — no cherry-pick trailer (AC3)
//   { scanned: true, sha, degraded: true, ... }            — a lookup itself failed (fail-open)
//   { scanned: true, sha, trigger: false, ... }             — trailer found, no open PR anywhere (AC2)
//   { scanned: true, sha, trigger: true, openPrBranches }   — trailer found, an open PR exists (AC1)
function checkCherryPickProvenance({ message, ownBranch, repo, git = defaultGit, gh = defaultGh }) {
  const sha = parseCherryPickTrailer(message);
  if (!sha) return { scanned: false };

  const containing = findContainingBranches({ sha, ownBranch, git });
  if (!containing.ok) {
    return {
      scanned: true,
      sha,
      degraded: true,
      degradeReason: 'branch-contains-lookup-failed',
      branches: [],
      openPrBranches: [],
      trigger: false,
    };
  }
  if (containing.branches.length === 0) {
    return { scanned: true, sha, degraded: false, branches: [], openPrBranches: [], trigger: false };
  }

  const { results, degraded } = findOpenPrsForBranches({ branches: containing.branches, repo, gh });
  const openPrBranches = results
    .filter((r) => r.ok && r.prs.length > 0)
    .map((r) => ({ branch: r.branch, prs: r.prs }));

  return {
    scanned: true,
    sha,
    degraded,
    degradeReason: degraded ? 'pr-list-lookup-failed' : undefined,
    branches: containing.branches,
    openPrBranches,
    trigger: openPrBranches.length > 0,
  };
}

// Renders the stop card — mirrors Step 1.6's card shape/options exactly,
// adapted for this trigger condition (see worktree-setup.md).
function formatStopCard({ sha, openPrBranches }) {
  const branchDescs = openPrBranches
    .map(({ branch, prs }) =>
      prs.map((pr) => `\`${branch}\` (open PR #${pr.number} — ${pr.url})`).join(', '),
    )
    .join(', ');
  return [
    "## Build: Cherry-picked commit reused from another record's open-PR branch",
    '',
    `Commit \`${sha}\` carries a \`(cherry picked from commit ${sha})\` trailer. Its source ` +
      `commit is also reachable from: ${branchDescs}.`,
    '',
    'Options: (1) stop and route to the existing PR (reuse/resume that prior work instead of ' +
      'duplicating it), (2) proceed anyway, explicitly choosing to duplicate the implementation ' +
      '(record this choice in `decisions.md`).',
  ].join('\n');
}

module.exports = {
  parseCherryPickTrailer,
  findContainingBranches,
  findOpenPrsForBranches,
  checkCherryPickProvenance,
  formatStopCard,
  GH_TIMEOUT_MS,
};
