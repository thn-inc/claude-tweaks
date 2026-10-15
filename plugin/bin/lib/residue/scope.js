// bin/lib/residue/scope.js — resolve what "this work" covers.
//
// The base is a commit-ish supplied by the caller (the same base the State
// block prints), so a wrong base is visible in the output rather than
// silently narrowing the window. Every field is present even when the scope
// could not be resolved; `ran: false` plus a reason is how that is reported —
// an empty branch list must never be confusable with an unrun scan.
'use strict';

const { execFileSync } = require('node:child_process');

function defaultRunner(cwd) {
  return (args) => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
    } catch {
      return null;
    }
  };
}

function parseWorktrees(porcelain) {
  const out = [];
  let current = null;
  for (const line of String(porcelain).split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), branch: null, locked: false, lockReason: null };
      out.push(current);
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (current && (line === 'locked' || line.startsWith('locked '))) {
      // The locked line carries a reason payload when one was given
      // ("locked claude session … (pid …)") and is bare otherwise. Matching
      // only the bare token reports every live worktree as unlocked.
      current.locked = true;
      current.lockReason = line === 'locked' ? null : line.slice('locked '.length);
    }
  }
  return out;
}

function resolveScope({ base, cwd, run } = {}) {
  if (!base) throw new Error('resolveScope: base is required');
  const git = run || defaultRunner(cwd);
  const empty = { ran: false, reason: null, base, branches: [], worktrees: [], headBranch: null };

  if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') {
    return { ...empty, reason: 'not a git repository' };
  }
  if (!git(['rev-parse', '--verify', base])) {
    return { ...empty, reason: `base is not a resolvable commit-ish: ${base}` };
  }

  const merged = git(['branch', '--format=%(refname:short)', '--merged', 'HEAD']);
  const worktrees = git(['worktree', 'list', '--porcelain']);
  return {
    ran: true,
    reason: null,
    base,
    branches: merged ? merged.split('\n').filter(Boolean) : [],
    worktrees: worktrees ? parseWorktrees(worktrees) : [],
    headBranch: git(['branch', '--show-current']) || null,
  };
}

module.exports = { resolveScope, parseWorktrees };
