// bin/lib/accept/reentry.js
// /accept's re-entry into a parked record (#4615): a fresh worktree from the PR branch's tip, the
// head and tree checks that prove the human accepted what was parked, and the removal after the
// verdict. Every external call goes through the injected `git(args)` / `gh(args)` runners; `git`
// receives its full argv (the `-C <dir>` included) and returns stdout, throwing on a failure.
// The only fs touch is the path-guard lstat that refuses a pre-existing accept directory.
'use strict';

const path = require('path');
const { lstatType, canonicalRealpath } = require('../path-guard');

const HEX_RE = /^[0-9a-f]{7,64}$/;
const POSITIVE_RE = /^[1-9][0-9]*$/;

const worktreePathOf = (repoRoot, record) => path.join(repoRoot, '.claude', 'worktrees', `accept-${record}`);

// Two heads name one commit when they are equal or the shorter (7+ hex) is a prefix of the longer:
// a park head recorded abbreviated must not read as a moved PR.
function sameCommit(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!HEX_RE.test(x) || !HEX_RE.test(y)) return false;
  return x.startsWith(y) || y.startsWith(x);
}

function staleDirError(worktree, type) {
  return Object.assign(new Error(`stale accept directory (${type}): ${worktree} — remove it or pass a different record; it is never reused`), { code: 'stale-dir' });
}

// -> { worktree, headRefName, prHead, parkHead, moved, head }. `parkHead` is the packet's
// `park-head:` (absent or null counts as moved). Throws Error{code:'stale-dir'} before any git call.
function reenter({ record, pr, repoRoot, parkHead = null, git, gh, lstat = lstatType } = {}) {
  if (!POSITIVE_RE.test(String(record))) throw new TypeError(`reenter: record must be a positive integer, got: ${record}`);
  if (!POSITIVE_RE.test(String(pr))) throw new TypeError(`reenter: pr must be a positive integer, got: ${pr}`);
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) throw new TypeError('reenter: repoRoot must be an absolute path');
  const worktree = worktreePathOf(repoRoot, record);
  const present = lstat(worktree);
  if (present.type !== 'missing') throw staleDirError(worktree, present.type);

  const view = JSON.parse(gh(['pr', 'view', String(pr), '--json', 'headRefName,headRefOid']));
  const { headRefName, headRefOid: prHead } = view;
  if (typeof headRefName !== 'string' || !headRefName.trim() || /[\r\n]/.test(headRefName)) throw new Error(`reenter: PR #${pr} has no usable headRefName`);
  if (typeof prHead !== 'string' || !HEX_RE.test(prHead)) throw new Error(`reenter: PR #${pr} has no usable headRefOid`);

  git(['-C', repoRoot, 'fetch', '--end-of-options', 'origin', headRefName]);
  git(['-C', repoRoot, 'worktree', 'add', '--detach', '--end-of-options', worktree, `origin/${headRefName}`]);
  const head = git(['-C', worktree, 'rev-parse', 'HEAD']).trim();
  return {
    worktree, headRefName, prHead,
    parkHead: typeof parkHead === 'string' && parkHead ? parkHead : null,
    moved: !sameCommit(parkHead, prHead),
    head,
  };
}

// -> { ok, head, dirty }. ok iff HEAD is the expected commit and no tracked file differs
// (untracked and ignored files, build artifacts, do not count).
function reenterCheck({ worktree, expectHead, git } = {}) {
  const head = git(['-C', worktree, 'rev-parse', 'HEAD']).trim();
  const porcelain = git(['-C', worktree, '--no-optional-locks', 'status', '--porcelain', '--untracked-files=no']);
  const dirty = porcelain.split('\n').filter((line) => line.trim() !== '').map((line) => line.slice(3));
  return { ok: sameCommit(head, expectHead) && dirty.length === 0, head, dirty };
}

// -> { removed }. false when git no longer lists the worktree (already gone); a git failure throws.
// --force is for ignored build artifacts only: reenterCheck has already proved no tracked change.
function reenterRemove({ worktree, repoRoot, git, realpath = (p) => canonicalRealpath(p) } = {}) {
  const canonical = (p) => {
    const own = realpath(p);
    if (own) return own;
    const parent = realpath(path.dirname(p));
    return parent ? path.join(parent, path.basename(p)) : p;
  };
  const key = (p) => (path.sep === '\\' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const wanted = key(canonical(worktree));
  const listed = git(['-C', repoRoot, 'worktree', 'list', '--porcelain'])
    .split('\n').filter((line) => line.startsWith('worktree ')).map((line) => key(line.slice('worktree '.length)));
  if (!listed.includes(wanted)) return { removed: false };
  git(['-C', repoRoot, 'worktree', 'remove', '--force', '--end-of-options', worktree]);
  return { removed: true };
}

module.exports = { reenter, reenterCheck, reenterRemove, worktreePathOf, sameCommit };
