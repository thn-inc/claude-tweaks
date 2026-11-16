// bin/lib/accept/reentry.js
// /accept's re-entry into a parked record (#4615): a fresh worktree from the PR branch's tip, the
// head and tree checks that prove the human accepted what was parked, and the removal after the
// verdict. Every external call goes through the injected `git(args)` / `gh(args)` runners; `git`
// receives its full argv (the `-C <dir>` included) and returns stdout, throwing on a failure.
// The only fs touch is the path-guard lstat that refuses a pre-existing accept directory.
'use strict';

const path = require('path');
const { lstatType, canonicalRealpath } = require('../path-guard');
const { parseWorktreeList, findWorktreeEntry } = require('../hooks/worktree-reap');

const HEX_RE = /^[0-9a-f]{7,64}$/;
const ACCEPT_DIR_RE = /^accept-[0-9]+$/;
const POSITIVE_RE = /^[1-9][0-9]*$/;

const worktreePathOf = (repoRoot, record) => path.join(repoRoot, '.claude', 'worktrees', `accept-${record}`);

// The canonical path git lists: the path's own realpath, else its parent's plus the leaf (a
// deleted directory), else as given.
function canonicalOf(p, realpath) {
  const own = realpath(p);
  if (own) return own;
  const parent = realpath(path.dirname(p));
  return parent ? path.join(parent, path.basename(p)) : p;
}

const isListed = (git, repoRoot, worktree, realpath) => findWorktreeEntry(
  parseWorktreeList(git(['-C', repoRoot, 'worktree', 'list', '--porcelain'])), canonicalOf(worktree, realpath),
) !== null;

function staleDirError(worktree, what) {
  return Object.assign(new Error(`stale accept directory (${what}): ${worktree} — clear it with reenter-remove --worktree, or remove it; it is never reused`), { code: 'stale-dir' });
}

// -> { worktree, headRefName, prHead, parkHead, moved, head }. `parkHead` is the packet's
// `park-head:`, short or full: it is resolved to a full oid after the fetch and compared with the
// PR head; absent, unresolvable or different counts as moved. Throws Error{code:'stale-dir'} before
// any gh call or worktree add when the accept directory exists or git still lists it.
function reenter({ record, pr, repoRoot, parkHead = null, git, gh, lstat = lstatType, realpath = (p) => canonicalRealpath(p) } = {}) {
  if (!POSITIVE_RE.test(String(record))) throw new TypeError(`reenter: record must be a positive integer, got: ${record}`);
  if (!POSITIVE_RE.test(String(pr))) throw new TypeError(`reenter: pr must be a positive integer, got: ${pr}`);
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) throw new TypeError('reenter: repoRoot must be an absolute path');
  const worktree = worktreePathOf(repoRoot, record);
  const present = lstat(worktree);
  if (present.type !== 'missing') throw staleDirError(worktree, present.type);
  // A registration whose directory was deleted: `worktree add` would fail on it, unclassified.
  if (isListed(git, repoRoot, worktree, realpath)) throw staleDirError(worktree, 'registered with git, directory missing');

  const view = JSON.parse(gh(['pr', 'view', String(pr), '--json', 'headRefName,headRefOid']));
  const { headRefName, headRefOid: prHead } = view;
  if (typeof headRefName !== 'string' || !headRefName.trim() || /[\r\n]/.test(headRefName)) throw new Error(`reenter: PR #${pr} has no usable headRefName`);
  if (typeof prHead !== 'string' || !HEX_RE.test(prHead)) throw new Error(`reenter: PR #${pr} has no usable headRefOid`);

  git(['-C', repoRoot, 'fetch', '--end-of-options', 'origin', headRefName]);
  const parkFull = resolveParkHead(git, repoRoot, parkHead);
  git(['-C', repoRoot, 'worktree', 'add', '--detach', '--end-of-options', worktree, `origin/${headRefName}`]);
  let head;
  try {
    head = git(['-C', worktree, 'rev-parse', 'HEAD']).trim();
  } catch (err) {
    // Never leave the worktree this call made behind.
    try {
      git(['-C', repoRoot, 'worktree', 'remove', '--force', '--end-of-options', worktree]);
    } catch { /* best effort: the original failure is the one reported */ }
    throw err;
  }
  return {
    worktree, headRefName, prHead,
    parkHead: typeof parkHead === 'string' && parkHead ? parkHead : null,
    moved: parkFull === null || parkFull !== prHead.toLowerCase(),
    head,
  };
}

// The park head as a full lowercase commit oid, null when absent, malformed or not a commit here.
function resolveParkHead(git, repoRoot, parkHead) {
  if (typeof parkHead !== 'string' || !HEX_RE.test(parkHead)) return null;
  try {
    const oid = git(['-C', repoRoot, 'rev-parse', '--verify', '--end-of-options', `${parkHead}^{commit}`]).trim().toLowerCase();
    return HEX_RE.test(oid) ? oid : null;
  } catch {
    return null;
  }
}

// -> { ok, head, dirty }. ok iff HEAD is exactly the expected full oid and no tracked file differs
// (untracked and ignored files, build artifacts, do not count). No prefix tolerance: the caller
// holds the full head `reenter` printed.
function reenterCheck({ worktree, expectHead, git } = {}) {
  const head = git(['-C', worktree, 'rev-parse', 'HEAD']).trim();
  const porcelain = git(['-C', worktree, '--no-optional-locks', 'status', '--porcelain', '--untracked-files=no']);
  const dirty = porcelain.split('\n').filter((line) => line.trim() !== '').map((line) => line.slice(3));
  const same = typeof expectHead === 'string' && head.toLowerCase() === expectHead.trim().toLowerCase();
  return { ok: same && dirty.length === 0, head, dirty };
}

// -> { removed }. Only a direct child of {repoRoot}/.claude/worktrees named accept-<digits> is
// removable (Error{code:'not-accept-worktree'} otherwise). false when git no longer lists it; a
// git failure throws. --force is for ignored build artifacts only: reenterCheck has already
// proved no tracked change. It also clears the registration of a deleted directory.
function reenterRemove({ worktree, repoRoot, git, realpath = (p) => canonicalRealpath(p) } = {}) {
  const key = (p) => (path.sep === '\\' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const parent = key(canonicalOf(path.join(repoRoot, '.claude', 'worktrees'), realpath));
  const canonical = canonicalOf(worktree, realpath);
  if (!ACCEPT_DIR_RE.test(path.basename(canonical)) || key(path.dirname(canonical)) !== parent) {
    throw Object.assign(new Error(`reenter-remove: ${worktree} is not an accept-<n> worktree under ${path.join(repoRoot, '.claude', 'worktrees')}`), { code: 'not-accept-worktree' });
  }
  if (!isListed(git, repoRoot, worktree, realpath)) return { removed: false };
  git(['-C', repoRoot, 'worktree', 'remove', '--force', '--end-of-options', worktree]);
  return { removed: true };
}

module.exports = { reenter, reenterCheck, reenterRemove, worktreePathOf };
