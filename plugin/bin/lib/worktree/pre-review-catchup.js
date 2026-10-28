// Pre-review integration catch-up (#4304): before the whole-branch review, merge
// any origin/{integration-branch} commits that touch files this branch changed,
// so the review judges the tree the branch will actually land as. Git only -- no
// decisions.md writes here; bin/pre-review-catchup.js owns the log append and
// feeds formatLine's {status, text, reversibility} to log-decision's formatEntry.
//
// runCatchup({ integrationBranch }, { git }) -> body. `git(args)` returns stdout
// (a string) or throws an error carrying `.stderr`, bound to the build checkout
// (makeGit below is the real one). Outcomes (OUTCOMES, the one list):
//   not-applicable    the build branch IS the integration branch -- nothing to do
//   fetch-failed      git fetch failed (not a long-path failure): fail open, no merge
//   windows-longpath  fetch or merge failed with `Filename too long`: a fixable
//                     misconfiguration (_shared/worktree-setup-windows-longpath.md),
//                     never the fail-open path; `reason` is `fetch` or `merge` (a
//                     merge that left MERGE_HEAD behind is aborted, best effort)
//   dirty-tree        uncommitted tracked changes: nothing merged, `reason` names a path
//   no-overlap        upstream moved but touches none of the branch's files: no merge
//   merged            the overlapping upstream commits were merged in
//   conflict          the merge conflicted and is left in progress (conflictFiles)
// A git error outside the fetch, or a failed merge with no unmerged paths, is not
// an outcome: runCatchup rethrows it.
//
// File lists come from `diff --name-only -z --no-renames`, so a rename counts as a
// delete of the old path plus an add of the new one and an upstream edit to the old
// path overlaps. `reviewBase` is the merge base after a merge (what the review
// should diff against) or the original merge base when nothing was merged; null
// when no merge base is trustworthy (conflict, and every pre-scan outcome).
'use strict';

const { execFileSync } = require('child_process');

const OUTCOMES = Object.freeze(['not-applicable', 'fetch-failed', 'windows-longpath', 'dirty-tree', 'no-overlap', 'merged', 'conflict']);

// A once-per-build CLI budget (precedent: lib/flow/preflight.js's PROBE_TIMEOUT_MS), not
// reconcile/classify.js's 5 s hook hot-path value, which would turn an ordinary slow fetch
// into a silent fail-open that skips the overlap check this exists to run.
const FETCH_TIMEOUT_MS = 60000;
const REMOTE = 'origin';
const LONGPATH = 'Filename too long';
const MAX_REASON = 200;
const MAX_FILES = 5;
const SHA_LEN = 9;

// `opts` (the fetch's { timeout, env }) is spread last; every other call runs unbounded.
function makeGit(cwd) {
  return (args, opts = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...opts });
}

// A stalled network or an HTTPS credential prompt (git reads /dev/tty, not stdin) must
// not block the build with no outcome: the fetch is bounded by the same budget the
// reconcile mirror fetch uses, and may not prompt, so either failure lands in fetch-failed.
const FETCH_OPTS = () => ({ timeout: FETCH_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });

// Best effort: a merge that died with a long-path error can leave MERGE_HEAD behind, and
// the dirty-tree pre-check guarantees there were no uncommitted tracked changes to lose.
// A failed abort never changes the outcome.
function abortPartialMerge(git) {
  try { git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']); } catch { return; }
  try { git(['merge', '--abort']); } catch { /* best effort */ }
}

const errText = (e) => `${(e && e.stderr) || ''}\n${(e && e.message) || ''}`;
const nulList = (out) => String(out).split('\0').filter(Boolean);

// Count the commits in a `log --format=%x01%H -z --name-only` read that touch any file
// in `files`. Each commit is a `\x01{sha}` token followed by its paths, NUL-separated;
// git puts one `\n` in front of a commit's first path. A merge commit lists no paths
// (its parents' commits are in the range and count themselves).
const COMMIT_TOKEN = /^\x01[0-9a-f]{40,64}$/;

function countTouching(log, files) {
  let count = 0;
  let touched = false;
  let afterSha = false;
  for (const token of String(log).split('\0')) {
    if (COMMIT_TOKEN.test(token)) {
      if (touched) count++;
      touched = false;
      afterSha = true;
      continue;
    }
    const file = afterSha ? token.replace(/^\n/, '') : token;
    if (file) afterSha = false;
    if (files.has(file)) touched = true;
  }
  return touched ? count + 1 : count;
}

function blankBody(integrationBranch) {
  return {
    outcome: null,
    integrationBranch,
    before: null,
    after: null,
    mergeBase: null,
    reviewBase: null,
    upstreamCommits: null,
    branchFileCount: null,
    overlapCommits: null,
    overlapFiles: [],
    conflictFiles: [],
    reason: null,
  };
}

function firstLine(e) {
  const lines = errText(e).split('\n').map((l) => l.trim()).filter(Boolean);
  return (lines[0] || 'unknown error').slice(0, MAX_REASON);
}

function runCatchup({ integrationBranch }, { git }) {
  const body = blankBody(integrationBranch);
  const upstream = `${REMOTE}/${integrationBranch}`;
  const done = (outcome, extra) => Object.assign(body, { outcome }, extra);

  if (git(['branch', '--show-current']).trim() === integrationBranch) return done('not-applicable');

  try {
    git(['fetch', '--end-of-options', REMOTE, integrationBranch], FETCH_OPTS());
  } catch (e) {
    if (errText(e).includes(LONGPATH)) return done('windows-longpath', { reason: 'fetch' });
    return done('fetch-failed', { reason: firstLine(e) });
  }

  const dirty = nulList(git(['--no-optional-locks', 'status', '--porcelain', '-z', '--untracked-files=no']))[0];
  if (dirty) return done('dirty-tree', { reason: dirty.slice(3) });

  const before = git(['rev-parse', 'HEAD']).trim();
  const mergeBase = git(['merge-base', 'HEAD', upstream]).trim();
  const upstreamCommits = Number(git(['rev-list', '--count', `${mergeBase}..${upstream}`]).trim());
  const branchFiles = nulList(git(['diff', '--name-only', '-z', '--no-renames', '--end-of-options', mergeBase, 'HEAD']));
  const upstreamFiles = new Set(nulList(git(['diff', '--name-only', '-z', '--no-renames', '--end-of-options', mergeBase, upstream])));
  const overlapFiles = [...new Set(branchFiles.filter((f) => upstreamFiles.has(f)))].sort();
  Object.assign(body, { before, mergeBase, upstreamCommits, branchFileCount: branchFiles.length, overlapFiles });

  if (!overlapFiles.length) return done('no-overlap', { reviewBase: mergeBase, overlapCommits: 0 });

  // One log read, counted in JS: the overlap paths never ride a command line (ARG_MAX).
  const upstreamLog = git(['log', '--format=%x01%H', '-z', '--name-only', '--no-renames', '--end-of-options', `${mergeBase}..${upstream}`]);
  body.overlapCommits = countTouching(upstreamLog, new Set(overlapFiles));

  try {
    git(['merge', '--no-edit', upstream]);
  } catch (e) {
    if (errText(e).includes(LONGPATH)) {
      abortPartialMerge(git);
      return done('windows-longpath', { reason: 'merge' });
    }
    const conflictFiles = nulList(git(['diff', '--name-only', '-z', '--diff-filter=U', '--end-of-options']));
    if (!conflictFiles.length) throw e;
    return done('conflict', { conflictFiles });
  }
  return done('merged', {
    after: git(['rev-parse', 'HEAD']).trim(),
    reviewBase: git(['merge-base', 'HEAD', upstream]).trim(),
  });
}

const sha = (s) => String(s).slice(0, SHA_LEN);

function fileList(files) {
  return files.length > MAX_FILES ? `${files.slice(0, MAX_FILES).join(', ')}, …` : files.join(', ');
}

// body -> { status, text, reversibility }: the decisions.md entry parts (the shell
// passes them to log-decision's formatEntry under step `Pre-review catch-up`).
function formatLine(body) {
  const b = body.integrationBranch;
  switch (body.outcome) {
    case 'merged':
      return {
        status: 'AUTO',
        text: `worktree branch advanced from ${sha(body.before)} to ${sha(body.after)} (${body.upstreamCommits} commit(s) from ${REMOTE}/${b}; ${body.overlapCommits} touching ${body.overlapFiles.length} file(s) this branch changed: ${fileList(body.overlapFiles)}) — re-run the suite before the whole-branch review`,
        reversibility: "med (merge commit on top of the build's own commits)",
      };
    case 'windows-longpath':
      return {
        status: 'SKIP',
        text: `condition: git ${body.reason} failed with Filename too long → fallback: none yet; apply _shared/worktree-setup-windows-longpath.md and re-run before the whole-branch review`,
        reversibility: 'n/a',
      };
    case 'no-overlap':
      return {
        status: 'SCANNED',
        text: `${REMOTE}/${b} has ${body.upstreamCommits} commit(s) since merge base ${sha(body.mergeBase)}, none touching the ${body.branchFileCount} file(s) this branch changed — no merge`,
        reversibility: 'n/a',
      };
    case 'conflict':
      return {
        status: 'SCANNED',
        text: `merging ${REMOTE}/${b} (${body.overlapCommits} overlapping commit(s)) conflicted on ${fileList(body.conflictFiles)} — merge left in progress; resolve it before the whole-branch review`,
        reversibility: 'n/a',
      };
    case 'fetch-failed':
      return {
        status: 'SKIP',
        text: `condition: git fetch ${REMOTE} ${b} failed (${body.reason}) → fallback: no pre-review catch-up; the whole-branch review runs on the unchecked tree`,
        reversibility: 'n/a',
      };
    case 'not-applicable':
      return {
        status: 'SKIP',
        text: `condition: build branch is the integration branch ${b} → fallback: nothing to catch up`,
        reversibility: 'n/a',
      };
    case 'dirty-tree':
      return {
        status: 'SKIP',
        text: `condition: uncommitted changes (${body.reason}) → fallback: no merge yet; commit them and re-run before the whole-branch review`,
        reversibility: 'n/a',
      };
    default:
      throw new Error(`unknown outcome: ${body.outcome}`);
  }
}

module.exports = { OUTCOMES, FETCH_TIMEOUT_MS, runCatchup, formatLine, makeGit };
