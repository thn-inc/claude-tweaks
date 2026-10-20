// bin/lib/hooks/worktree-detect.js — mechanical check for "is this path
// already inside an isolated git worktree?" Ports the same
// GIT_DIR != GIT_COMMON + submodule-guard heuristic
// superpowers:using-git-worktrees Step 0 uses, so the hook and the skill
// never disagree about what counts as isolated.
'use strict';
const fs = require('fs');
const path = require('path');
const { runGit, isIndeterminate } = require('./git-exec');

// Returns null (not the original, unresolved path) on failure. This
// project's fail-open invariant ("a recorded worktree whose path no longer
// exists resolves to allow") depends on unresolvable paths being falsy;
// returning the raw path here would let repoInfo() below hand back a
// truthy-looking-but-unverified repoRoot/isLinkedWorktree if a directory is
// torn down between the `git rev-parse` call and this realpath call.
function safeReal(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

function nearestExistingDir(p) {
  let dir = path.resolve(p);
  try {
    if (fs.statSync(dir).isFile()) dir = path.dirname(dir);
  } catch {
    /* dir may not exist yet; fall through to the walk-up loop */
  }
  while (dir && !fs.existsSync(dir)) {
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return dir;
}

// A linked worktree's `.git` is a plain FILE containing
// `gitdir: <main>/.git/worktrees/<name>`; the main checkout's is a directory.
// That difference resolves the main checkout with zero subprocesses, which
// matters because context.js's run-dir enumeration runs on every hook
// invocation — including bin/hooks.js argument parsing, which happens before
// repoInfo() spawns anything.
//
// Returns null whenever the answer isn't certain (no .git found, unreadable or
// unparseable .git file, or a gitdir pointing somewhere other than
// .git/worktrees/ — notably a submodule's .git/modules/<name>, where the
// superproject root is NOT the right anchor). Callers fall back to their
// existing cwd-relative behavior on null rather than guessing.
const WORKTREE_ADMIN_MARKER = `${path.sep}.git${path.sep}worktrees${path.sep}`;

function mainCheckoutRoot(p) {
  let dir = nearestExistingDir(p);
  while (dir) {
    const gitPath = path.join(dir, '.git');
    let st = null;
    try {
      st = fs.statSync(gitPath);
    } catch (e) {
      // ENOENT is the ordinary walk-up case: no .git here, look one level up.
      // Anything else (EACCES on an unreadable directory, ELOOP, EIO) means we
      // could not LOOK, which is not the same fact — continuing the walk past
      // it can hand back an ANCESTOR repository's root, and the reaper then
      // enumerates and removes worktrees belonging to that repo. Unknown
      // resolves to null, the value every caller already treats as "fall back
      // to cwd-relative behavior" rather than acting on.
      if (!e || e.code !== 'ENOENT') return null;
    }
    if (st && st.isDirectory()) return safeReal(dir);
    if (st && st.isFile()) {
      let raw;
      try { raw = fs.readFileSync(gitPath, 'utf8'); } catch { return null; }
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(raw);
      if (!m) return null;
      const admin = path.resolve(dir, m[1]);
      const idx = admin.indexOf(WORKTREE_ADMIN_MARKER);
      if (idx === -1) return null;
      return safeReal(admin.slice(0, idx));
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// Single git subprocess spawn querying toplevel + git-dir + git-common-dir +
// superproject in one invocation instead of four separate spawns — every
// caller of this module needs both the repo root and the linked-worktree
// check, back to back, for the same path (pre-tool-use.js's
// worktree-required gate on every Edit/Write/NotebookEdit/commit,
// session-start.js's advisory nudge). `git rev-parse` accepts multiple query
// flags in one invocation; each prints one line, in order, except
// --show-superproject-working-tree which prints nothing at all when the
// path isn't a submodule — always requested last here so its absence never
// shifts the other three lines' positions.
// Returns { repoRoot, isLinkedWorktree, indeterminate }.
//
// `indeterminate` is the third state this function used to collapse into the
// second (#134). A null `repoRoot` previously meant BOTH "git answered, and the
// answer is: not a git repo" (permanent, knowable) and "git never answered"
// (transient — a timeout under load, a refused fork). Callers gating on
// `!repoRoot` therefore treated a load spike identically to a definitive
// negative, which is how the worktree-always gate came to stop enforcing while
// the machine was busy.
//
//   indeterminate: false -> repoRoot is trustworthy (a path, or null meaning
//                           git genuinely says this is not a repo)
//   indeterminate: true  -> repoRoot is null because the question went
//                           unanswered; it carries NO information either way
// opts is forwarded verbatim to runGit — tests use { timeoutMs } to force the
// indeterminate branch deterministically. Production callers omit it.
function repoInfo(p, opts = {}) {
  const dir = nearestExistingDir(p);
  // A path with no existing ancestor is a definitive negative, not a failure to
  // look: there is nothing on disk to be a repo.
  if (!dir) return { repoRoot: null, isLinkedWorktree: false, indeterminate: false };
  const { stdout: out, failure } = runGit(
    ['rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir', '--show-superproject-working-tree'],
    dir,
    opts,
  );
  if (failure) {
    // git-error == git ran and said "not a git repository": a real answer.
    // timeout/spawn/no-git == we never got one.
    return { repoRoot: null, isLinkedWorktree: false, indeterminate: isIndeterminate(failure) };
  }
  const [top, gitDir, gitCommon, superproject] = out.split('\n');
  // Exit 0 but missing lines: git answered something we cannot parse. Treat as
  // unanswered rather than as a negative — we have no basis for a negative.
  if (!top || !gitDir || !gitCommon) {
    return { repoRoot: null, isLinkedWorktree: false, indeterminate: true };
  }
  const isLinked = superproject
    ? false // submodule -> not an isolated worktree
    : safeReal(path.resolve(dir, gitDir)) !== safeReal(path.resolve(dir, gitCommon));
  const repoRoot = safeReal(top);
  // The second, independent route to a null repoRoot: git answered fine, but
  // realpath on its answer failed (the directory went away between the two
  // calls). Also a failure to determine, not a negative.
  if (!repoRoot) return { repoRoot: null, isLinkedWorktree: false, indeterminate: true };
  return { repoRoot, isLinkedWorktree: isLinked, indeterminate: false };
}

// fs-only walk-up looking for a .claude-tweaks/policy.yml, so callers can
// check "is there even a policy file to care about" WITHOUT forking git.
// Returns the directory containing the policy file, or null if none is
// found anywhere up the ancestor chain.
function findPolicyFile(p) {
  let dir = nearestExistingDir(p);
  while (dir) {
    if (fs.existsSync(path.join(dir, '.claude-tweaks', 'policy.yml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// Structural anchoring check: is `p`'s nearest `.git` ancestor a DIRECTORY
// (a real checkout, not a linked worktree/submodule `.git` FILE pointer)
// whose resolved path equals `root`? A path-prefix check alone can't tell
// "a subdirectory of the main checkout's own working tree" apart from "a
// linked worktree nested under it" — both domains (ADR-0004: `.claude/worktrees/`
// and `.worktrees/`) live physically on disk under the main checkout root, so
// `p.startsWith(root)` is true for both even though only the former is
// actually anchored. Walking up to the nearest `.git` and checking file-vs-
// directory is what distinguishes them.
function isAnchoredUnderRoot(p, root) {
  if (!root) return false;
  let dir = nearestExistingDir(p);
  while (dir) {
    let st;
    try { st = fs.statSync(path.join(dir, '.git')); } catch { st = null; }
    if (st) {
      if (!st.isDirectory()) return false; // .git FILE => linked worktree/submodule, never anchored
      return safeReal(dir) === root;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
  return false;
}

// Anchored-or-outside classification for a --run-dir/--run CLI argument
// (#1065, the resolver-CLI half of the [IL-127] CLI-argument-boundary guard;
// the pipeline-owned binaries above use the stricter main-checkout-only rule).
// A resolved candidate lying inside ANY git checkout must be anchored under
// the main checkout resolved from `cwd`; a candidate outside any checkout
// (journey/demo dirs under /tmp, tmp-root test fixtures) is accepted as-is.
//
// The inside-a-checkout test is "the walk-up found any `.git` entry, file or
// directory, regardless of parseability" — deliberately NOT
// `mainCheckoutRoot(resolved) !== null`, whose null conflates "no repo" with
// "unparseable .git" (submodule pointer, unreadable ancestor) and would
// silently ACCEPT a shadow path. "Outside" requires a completed walk to the
// filesystem root finding no .git and no error; any walk error fails closed
// to a rejection. The candidate is realpath'd via its nearest existing
// ancestor first, so a symlinked alias (macOS /tmp -> /private/tmp) is
// classified by its real location.
function scanForGitAncestor(p) {
  let dir = nearestExistingDir(p);
  if (!dir) return 'error';
  while (dir) {
    let st = null;
    try {
      st = fs.statSync(path.join(dir, '.git'));
    } catch (e) {
      if (!e || e.code !== 'ENOENT') return 'error';
    }
    if (st) return 'found';
    const parent = path.dirname(dir);
    if (parent === dir) return 'none';
    dir = parent;
  }
  return 'none';
}

function checkRunDirAnchoredOrOutside(candidate, cwd) {
  const resolvedRaw = path.resolve(cwd, candidate);
  const near = nearestExistingDir(resolvedRaw);
  const nearReal = near ? safeReal(near) : null;
  if (!nearReal) return { ok: false, reason: 'no-repo-root', resolved: resolvedRaw };
  const resolved = path.join(nearReal, path.relative(near, resolvedRaw));
  const mainRoot = mainCheckoutRoot(cwd);
  if (mainRoot && isAnchoredUnderRoot(resolved, mainRoot)) return { ok: true, resolved };
  const scan = scanForGitAncestor(resolved);
  if (scan === 'none') return { ok: true, resolved };
  if (scan === 'found' && mainRoot) return { ok: false, reason: 'foreign-checkout', resolved, mainRoot };
  return { ok: false, reason: 'no-repo-root', resolved };
}

// The two --run-dir/--run anchoring-guard error strings, shared by every call
// site that pairs a mainCheckoutRoot()/isAnchoredUnderRoot() check with a
// diagnostic (hooks.js's resolveRunArg, materialize.js, wrap-up-engine.js,
// apply-refine-labels.js, and — via checkRunDirAnchoredOrOutside's
// anchored-or-outside rule — resolve-profile.js and resolve-policy.js) —
// extracted after the same two strings were verbatim-duplicated across all
// three, a drift risk this project's own IL-93 already names for guards of
// this shape (review finding). Pure — no I/O of their own, so each caller's
// own I/O/deps-injection seam for testability is untouched; callers still
// resolve `mainRoot`/`isAnchored` themselves and prefix the returned string
// with their own program name / candidate-path framing.
function unanchoredRunDirNoRepoMessage(cwd) {
  return `could not determine the git repository root from ${cwd} — not a git repo, or git/the .git file could not be read`;
}
function unanchoredRunDirShadowMessage(runDirArg, mainRoot, flag = '--run-dir') {
  return `${flag} ${runDirArg} resolves outside the main checkout (${mainRoot}) — refusing a worktree-relative shadow run dir; see resolve-run-dir`;
}

module.exports = {
  nearestExistingDir, repoInfo, findPolicyFile, safeReal, mainCheckoutRoot, isAnchoredUnderRoot,
  checkRunDirAnchoredOrOutside, unanchoredRunDirNoRepoMessage, unanchoredRunDirShadowMessage,
};
