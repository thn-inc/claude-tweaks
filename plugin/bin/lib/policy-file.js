'use strict';
// bin/lib/policy-file.js — locate a project's `.claude-tweaks/policy.yml`.
//
// #4492: a linked git worktree of a project that gitignores policy.yml has no
// copy of it, so a reader that looks only under its own checkout sees no
// policy. This locator falls back to the main checkout's file in exactly that
// case, and every policy reader routes through it.
//
// The main checkout is found the way `$RUN_ROOT` is: run-dir-resolve.js
// (plugin/bin/lib/hooks/run-dir-resolve.js) resolves `$RUN_ROOT` via
// worktree-detect.js's `mainCheckoutRoot`, and this module reuses that same
// function rather than a second detector.
//
// Deliberate divergence from `mainCheckoutRoot`: that function accepts any
// `gitdir:` containing `/.git/worktrees/`, which also matches a submodule
// initialized inside a linked worktree (`<main>/.git/worktrees/<wt>/modules/
// <name>`) and would hand back the superproject. This locator additionally
// requires the root's admin dir to sit exactly one level under
// `<main>/.git/worktrees/`, so a submodule keeps its own policy and is not a
// linked worktree. `mainCheckoutRoot` itself is unchanged; the same misanchoring
// there for `$RUN_ROOT` is #5728 — once it is fixed at the source, this extra
// check is redundant and goes with it.
//
// Accepted divergence: a layout whose worktree admin dir is not under
// `.git/worktrees/` (a `--separate-git-dir` main repo) resolves no main
// checkout, so it gets no fallback — today's behavior.
//
// Contract: `root` is a checkout top level. Never throws; any lookup failure
// returns the root's own path with source `checkout`. The returned `path` is a
// native fs path (never `toPosix`'d).
const fs = require('fs');
const path = require('path');
const { lstatType, canonicalRealpath } = require('./path-guard');

const POLICY_REL_PATH = path.join('.claude-tweaks', 'policy.yml');

function defaultMainCheckoutRoot(p) {
  // Lazy: hook hot paths load this module and rarely need the fallback.
  return require('./hooks/worktree-detect').mainCheckoutRoot(p);
}

// True when `root`'s `.git` file names an admin dir exactly one level under
// `<main>/.git/worktrees/` (a linked worktree, not a submodule's modules dir).
function adminDirIsWorktreeOf(root, main, fsImpl) {
  const raw = fsImpl.readFileSync(path.join(root, '.git'), 'utf8');
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(raw);
  if (!m) return false;
  const admin = path.resolve(root, m[1]);
  const opts = { fsImpl };
  const parent = canonicalRealpath(path.dirname(admin), opts);
  const expected = canonicalRealpath(path.join(main, '.git', 'worktrees'), opts);
  return parent !== null && expected !== null && parent === expected;
}

// The main checkout root when `root` is a linked worktree (its .git is a file,
// mainCheckoutRoot resolves, and its admin dir is a direct child of the main
// checkout's .git/worktrees), else null. Never throws.
function linkedMainRoot(root, deps) {
  try {
    if (typeof root !== 'string') return null;
    const { fsImpl, mainCheckoutRoot = defaultMainCheckoutRoot } = deps;
    const opts = fsImpl ? { fsImpl } : undefined;
    if (lstatType(path.join(root, '.git'), opts).type !== 'file') return null;
    const main = mainCheckoutRoot(root);
    if (typeof main !== 'string' || main === '') return null;
    return adminDirIsWorktreeOf(root, main, fsImpl || fs) ? main : null;
  } catch (_err) {
    return null;
  }
}

function isLinkedWorktreeRoot(root, deps = {}) {
  return linkedMainRoot(root, deps) !== null;
}

function locatePolicyFile(root, deps = {}) {
  if (typeof root !== 'string') return { path: null, source: 'checkout' };
  const own = path.join(root, POLICY_REL_PATH);
  const checkout = { path: own, source: 'checkout' };
  try {
    const opts = deps.fsImpl ? { fsImpl: deps.fsImpl } : undefined;
    if (lstatType(own, opts).type !== 'missing') return checkout;
    const main = linkedMainRoot(root, deps);
    if (main === null) return checkout;
    const mainPolicy = path.join(main, POLICY_REL_PATH);
    if (lstatType(mainPolicy, opts).type === 'missing') return checkout;
    return { path: mainPolicy, source: 'main-checkout' };
  } catch (_err) {
    return checkout;
  }
}

module.exports = { POLICY_REL_PATH, isLinkedWorktreeRoot, locatePolicyFile };
