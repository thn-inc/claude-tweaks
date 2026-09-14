// bin/lib/hooks/run-integrity.js — run-integrity detection (inform tier, read-only).
// Distinguishes a run genuinely in progress from one whose work already shipped
// while bookkeeping stayed open (#364's failure mode). Pure read side: no writes,
// no event appends, no git mutations, no fetch (SessionStart must be offline-safe).
//
// Fail-open is per-field: every evidence field that cannot be determined is null,
// and any null forces 'in-progress'. A wrong verdict here costs one misleading
// advisory line, so every ambiguity resolves toward NOT alarming.
//
// Measured boundaries inherited from #371's ledger (see that spec's
// work/task0-findings.md): skill_invoked events exist only for MODEL-INITIATED
// Skill tool calls — a human typing /claude-tweaks:wrap-up leaves no event, and
// runs predating the ledger have none at all. Both are why the verdict requires
// at least one skill_invoked of any kind (pre-ledger precondition) and treats a
// present wrap-up event as proof the procedure ran; absence of a wrap-up event
// alone is never a verdict. Subagent Skill calls ARE visible (parent-session
// hooks, agent-tagged in the payload), so dispatch-driven wrap-ups do register.
'use strict';
const fs = require('fs');
const path = require('path');
const { runGit } = require('./git-exec');
const { parseWorktreeList, resolveIntegrationBranch, bareIntegrationName } = require('./worktree-reap');
const ctxLib = require('./context');

const NON_TERMINAL = new Set(['active', 'interrupted']);
const RUN_STATE_STATUSES = new Set(['active', 'interrupted', 'clean']);

// run dirs live at {root}/.claude-tweaks/pipelines/{run-id} by anchoring
// (_shared/pipeline-run-dir.md), so the repo root is three levels up.
function repoRootOf(runDir) {
  return path.resolve(runDir, '..', '..', '..');
}

// Field contract per [IL-123]: validate fields, not typeof object.
function readValidatedRunState(runDir) {
  let state;
  try { state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8')); } catch { return null; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  if (!RUN_STATE_STATUSES.has(state.status)) return null;
  if ('worktree' in state && (typeof state.worktree !== 'string' || state.worktree === '')) return null;
  return state;
}

// Branch from the recorded worktree PATH (run-state.json stores no branch),
// derived EXCLUSIVELY from `git worktree list --porcelain` matched by path.
// Never probe the recorded path directly with `git branch --show-current`:
// git searches UPWARD from a given directory to find the enclosing repo, so a
// stale or wrong recorded path (a plain dir inside the repo, the main
// checkout root recorded by mistake, a dangling worktree whose own `.git`
// pointer is gone) resolves to the MAIN CHECKOUT's current branch instead of
// failing — and that branch is normally the integration branch itself,
// manufacturing a false shipped-unclosed. The porcelain list has no such
// upward search: a path not literally registered in it is simply absent.
//
// The main-checkout entry and bare entries are excluded from matching (the
// same exclusion worktree-reap.js's reapWorktrees applies via `real === root`
// / `wt.bare`) so a recorded path that IS the main checkout root can never
// resolve to that checkout's own current branch either.
//
// A registered-but-dangling worktree (its linked `.git` file deleted) still
// appears in the porcelain list — git marks the stanza `prunable`, but
// parseWorktreeList doesn't surface that marker — so liveness is confirmed
// independently: a real linked worktree always has its own `.git` file.
function realpathOrSelf(p) {
  try { return fs.realpathSync(p); } catch { return p; } // keep recorded form
}

// `cache` (optional): { worktreeList: Map<root, stdout>, integrationBranch: Map<root, name|null> }
// — an explicit, opt-in, per-invocation cache threaded by session-start.js's run(ctx) to
// coalesce redundant `git worktree list`/`git rev-parse` spawns for the same repo root within
// one SessionStart. Omitted (the shape every other caller and every pre-existing test uses),
// this spawns fresh every call — byte-identical to pre-cache behavior. See #381.
// Shared by deriveBranch and worktreePathForBranch below — both read the same
// `git worktree list --porcelain` output, so the cache lookup/populate
// sequence lives here once instead of twice.
function worktreeListStdout(root, cache) {
  if (cache && cache.worktreeList.has(root)) return cache.worktreeList.get(root);
  const list = runGit(['worktree', 'list', '--porcelain'], root);
  const stdout = list.failure || list.stdout === null ? null : list.stdout;
  if (cache) cache.worktreeList.set(root, stdout);
  return stdout;
}

function deriveBranch(root, worktreePath, cache) {
  if (!worktreePath) return null;
  const stdout = worktreeListStdout(root, cache);
  if (stdout === null) return null;
  const target = realpathOrSelf(worktreePath);
  const realRoot = realpathOrSelf(root);
  for (const entry of parseWorktreeList(stdout)) {
    if (entry.bare) continue;
    const entryReal = realpathOrSelf(entry.path);
    if (entryReal === realRoot) continue; // never the main checkout
    if (entry.path !== worktreePath && entryReal !== target) continue;
    if (!fs.existsSync(path.join(entry.path, '.git'))) return null; // dangling — prunable, not live
    return entry.branch || null;
  }
  return null;
}

// The reverse of deriveBranch() above (branch -> live worktree path, instead
// of path -> branch). Used by teardown-run.js as a fallback lookup (#2362)
// when run-state.json carries no `worktree` field at all — never the main
// checkout, never a dangling (prunable) entry, matching deriveBranch's own
// liveness rule exactly.
function worktreePathForBranch(root, branch, cache) {
  if (!branch) return null;
  const stdout = worktreeListStdout(root, cache);
  if (stdout === null) return null;
  const realRoot = realpathOrSelf(root);
  for (const entry of parseWorktreeList(stdout)) {
    if (entry.bare) continue;
    if (entry.branch !== branch) continue;
    const entryReal = realpathOrSelf(entry.path);
    if (entryReal === realRoot) continue; // never the main checkout
    if (!fs.existsSync(path.join(entry.path, '.git'))) return null; // dangling — prunable, not live
    return entry.path;
  }
  return null;
}

// A branch name is only usable as evidence if it actually exists in this
// checkout. Both fallback sources below are recovered from artifacts that can
// be stale (a stamp from a run whose branch was later deleted) or imprecise (a
// prose log line) — without this check a bad name could match nothing, or
// worse, match some unrelated merged branch and manufacture a false
// 'shipped-unclosed'. This is the bound on the precision/coverage trade the
// whole fallback makes.
function branchExists(root, branch) {
  if (!branch) return false;
  const r = runGit(['rev-parse', '--verify', '--quiet', '--end-of-options', `refs/heads/${branch}`], root);
  return !r.failure && r.stdout !== null && r.stdout.trim() !== '';
}

// Source 2: the branch name from decisions.md's PR-early lifecycle log lines
// (_shared/pr-early-run-lifecycle.md Steps 2-3 make both lines mandatory, which
// is what makes this parseable at all). Read-and-catch rather than
// existsSync-then-read: a concurrent sibling archiving this run dir between the
// two calls is a live hazard here, and an unreadable file means the same thing
// as an absent one.
const DECISION_BRANCH_RES = [
  /PR-early run lifecycle: pushed (\S+) to origin/,
  /PR-early run lifecycle: opened PR #?\d+ for (\S+)/,
  /PR-early run lifecycle: push of (\S+) to origin FAILED/,
];
function branchFromDecisions(runDir) {
  let text;
  try { text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'); } catch { return null; }
  for (const re of DECISION_BRANCH_RES) {
    const m = re.exec(text);
    // The log lines these patterns match end in a sentence period with no
    // space before it (`… opened PR #42 for {branch}. Reversibility: …`), so
    // `\S+` captures the period into the name and every later ref lookup
    // fails — source 2 then silently never resolves, which is exactly the gap
    // this fallback exists to close. Stripping a trailing run of dots can
    // never truncate a real branch: git-check-ref-format forbids a ref ending
    // in `.`. Found by both agents of this review's lens-3c reproduction pair.
    if (m && m[1]) {
      const name = m[1].replace(/\.+$/, '');
      if (name) return name;
    }
  }
  return null;
}

// #1672: deriveBranch() reads `git worktree list --porcelain`, so it goes null
// the moment a finished run's worktree is torn down — which is the normal end
// state of a run that shipped. That made checkRunIntegrity fail open to
// 'in-progress' permanently for exactly the runs the shipped-unclosed advisory
// exists to catch. Two artifacts outlive the worktree; try them in the order
// the record specifies, most durable first.
function fallbackBranch(root, runDir, state) {
  const fromStamp = state && state.pr && typeof state.pr.branch === 'string' ? state.pr.branch : null;
  if (branchExists(root, fromStamp)) return fromStamp;
  const fromDecisions = branchFromDecisions(runDir);
  if (branchExists(root, fromDecisions)) return fromDecisions;
  return null;
}

// 'ancestor' | 'cherry' | false (definitively unmerged) | null (indeterminate).
// merge-base --is-ancestor answers via exit code: 0 = ancestor (success), 1 =
// not an ancestor (classified 'git-error' by runGit — the one failure kind that
// is a real answer). Indeterminate kinds (timeout/spawn/no-git) -> null.
function mergedEvidence(root, branch, integration) {
  // Belt-and-braces: deriveBranch should never hand back the integration
  // branch itself for a real worktree, but a worktree standing ON the
  // integration branch trivially satisfies `merge-base --is-ancestor X X`
  // without ever having shipped anything — never treat that as evidence.
  // #1861: `integration` can be `origin/{name}` (preferRemoteTrackingRef,
  // #1688) while `branch` is always bare, so this equality guard needs the
  // bare form -- but `integration` itself stays as resolved (possibly
  // origin/-prefixed) below, since the actual merge-base/cherry calls
  // benefit from that freshness the same way they did before #1861.
  if (branch === bareIntegrationName(integration)) return null;
  const anc = runGit(['merge-base', '--is-ancestor', branch, integration], root);
  if (!anc.failure) return 'ancestor';
  if (anc.failure !== 'git-error') return null;
  const cherry = runGit(['cherry', integration, branch], root);
  if (cherry.failure || cherry.stdout === null) return null;
  const lines = cherry.stdout.split('\n').filter(Boolean);
  // Defensive: an empty cherry list should already have been caught above —
  // if the two refs share no divergent commits, --is-ancestor would already
  // have answered 'ancestor' (or errored indeterminate) before cherry ever
  // runs. Kept as a fail-open floor in case that invariant is ever wrong.
  if (lines.length === 0) return false; // no commits to compare — never evidence
  return lines.every((l) => l.startsWith('-')) ? 'cherry' : false;
}

// Run dirs are named `{YYYY-MM-DDTHHMMSS}-{slug}` (run-dir-resolve.js's
// formatTimestamp(), always UTC). That prefix already encodes exactly the
// reference point the ancestor check needs — when this run started — so the
// corroboration below needs no new run-state.json field. Returns null for any
// name that doesn't carry a parseable canonical prefix.
const RUN_START_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})(?:-|$)/;
function runStartIso(runDir) {
  const m = RUN_START_RE.exec(path.basename(runDir));
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

// Corroboration for the 'ancestor' evidence path (#1463). `merge-base
// --is-ancestor branch integration` is trivially true for a branch that has
// never diverged from its base, so a freshly created worktree with zero
// commits of its own produces byte-identical evidence to a genuinely
// fast-forward-merged branch. Require at least one commit on the branch dated
// at or after this run's own start time before 'ancestor' counts as shipped.
//
// Fail-open, per this module's per-field contract: an unparseable run-dir name
// or an indeterminate git result returns false, resolving toward in-progress.
// `--since` filters on committer date, so a rebase/amend that rewrites
// timestamps can move a commit out of the window — an accepted edge case, not
// the freshly-created-worktree path this guards.
function hasCommitSinceRunStart(root, branch, runDir) {
  const since = runStartIso(runDir);
  if (!since) return false;
  // `--end-of-options` (not `--`) is what stops a ref name beginning with `-`
  // from being read as an option: `--` only guards the pathspec position, which
  // is a different argument slot (this repo's `gh-api-module-pattern` skill owns
  // the rule). `branch` comes from git's own porcelain output today, so this is
  // convention-adoption on new code, not an exploitable hole being closed — the
  // two pre-existing call sites in mergedEvidence() above still use the old
  // shape and migrate separately.
  const log = runGit(['log', `--since=${since}`, '--format=%H', '--max-count=1', '--end-of-options', branch, '--'], root);
  if (log.failure || log.stdout === null) return false;
  return log.stdout.trim() !== '';
}

function checkRunIntegrity(runDir, opts = {}) {
  const cache = opts.cache;
  const evidence = { branch: null, merged: null, ledgerActive: null, wrapupInvoked: null };
  const inProgress = { state: 'in-progress', evidence };
  try {
    const state = readValidatedRunState(runDir);
    if (!state || !NON_TERMINAL.has(state.status)) return inProgress;
    const root = repoRootOf(runDir);
    evidence.branch = deriveBranch(root, state.worktree || null, cache);
    // Live worktree wins; the fallback runs only when it can't answer (#1672).
    if (!evidence.branch) evidence.branch = fallbackBranch(root, runDir, state);
    if (!evidence.branch) return inProgress;
    // #1861: mergedEvidence normalizes for its own self-ancestor guard --
    // kept un-bare-ified here so a genuine cross-branch check still benefits
    // from resolveIntegrationBranch's origin/-prefixed freshness upgrade
    // (#1688), same as before #1861.
    const integration = resolveIntegrationBranch(root, cache);
    if (!integration) return inProgress;
    evidence.merged = mergedEvidence(root, evidence.branch, integration);
    if (evidence.merged !== 'ancestor' && evidence.merged !== 'cherry') return inProgress;
    // 'cherry' needs no corroboration — `git cherry` only reports commits the
    // branch actually has, so that path already implies real divergent work.
    if (evidence.merged === 'ancestor' && !hasCommitSinceRunStart(root, evidence.branch, runDir)) return inProgress;
    const events = ctxLib.scanWrapupEvents(runDir);
    if (!events) return inProgress;
    evidence.ledgerActive = events.any;
    evidence.wrapupInvoked = events.wrapup;
    if (!events.any) return inProgress;   // pre-ledger run — a log the ledger never wrote to proves nothing
    if (events.wrapup) return inProgress; // wrap-up ran; close-run lag is not drift worth alarming on
    return { state: 'shipped-unclosed', evidence };
  } catch {
    return inProgress;
  }
}

module.exports = {
  checkRunIntegrity, repoRootOf, NON_TERMINAL, deriveBranch,
  // #1544: archive-merged.js's clean-status sweep (a run dir close-run
  // already marked terminal, whose archive-run step never followed) needs
  // this same torn-down-worktree branch fallback — checkRunIntegrity itself
  // only evaluates NON_TERMINAL ('active'/'interrupted') statuses, so a
  // 'clean' dir can't reuse that entry point and needs this piece directly.
  fallbackBranch,
  worktreePathForBranch,
};
