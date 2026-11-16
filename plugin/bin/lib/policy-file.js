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
// Accepted divergence: a layout whose worktree admin dir is not under
// `.git/worktrees/` (a `--separate-git-dir` main repo) resolves no main
// checkout, so it gets no fallback — today's behavior.
//
// Contract: `root` is a checkout top level. Never throws; any lookup failure
// returns the root's own path with source `checkout`. The returned `path` is a
// native fs path (never `toPosix`'d).
const path = require('path');
const { lstatType } = require('./path-guard');

const POLICY_REL_PATH = path.join('.claude-tweaks', 'policy.yml');

function defaultMainCheckoutRoot(p) {
  // Lazy: hook hot paths load this module and rarely need the fallback.
  return require('./hooks/worktree-detect').mainCheckoutRoot(p);
}

function isLinkedWorktreeRoot(root, deps = {}) {
  const { fsImpl, mainCheckoutRoot = defaultMainCheckoutRoot } = deps;
  try {
    if (typeof root !== 'string') return false;
    const opts = fsImpl ? { fsImpl } : undefined;
    if (lstatType(path.join(root, '.git'), opts).type !== 'file') return false;
    const main =mainCheckoutRoot(root);
    return typeof main === 'string' && main !== '';
  } catch (_err) {
    return false;
  }
}

function locatePolicyFile(root, deps = {}) {
  if (typeof root !== 'string') return { path: null, source: 'checkout' };
  const own = path.join(root, POLICY_REL_PATH);
  const checkout = { path: own, source: 'checkout' };
  try {
    const { fsImpl, mainCheckoutRoot = defaultMainCheckoutRoot } = deps;
    const opts = fsImpl ? { fsImpl } : undefined;
    if (lstatType(own, opts).type !== 'missing') return checkout;
    if (!isLinkedWorktreeRoot(root, { fsImpl, mainCheckoutRoot })) return checkout;
    const main = mainCheckoutRoot(root);
    if (typeof main !== 'string' || main === '') return checkout;
    const mainPolicy = path.join(main, POLICY_REL_PATH);
    if (lstatType(mainPolicy, opts).type === 'missing') return checkout;
    return { path: mainPolicy, source: 'main-checkout' };
  } catch (_err) {
    return checkout;
  }
}

module.exports = { POLICY_REL_PATH, isLinkedWorktreeRoot, locatePolicyFile };
