'use strict';
// Wrap-up's pre-merge move of a run's tracked spec header (#3976).
//
// A run's spec header is committed live, at `.claude-tweaks/pipelines/{run-id}/work/`
// (and `.../spec-{N}/work/` for a multi-spec run), and reaches `main` by merge. Left
// there, every merged run adds a live directory that only a later post-merge commit on
// `main` (reconcile's `archiveRunDir`) relocates. `archiveRunHeader` does the relocation
// first, on the run branch, in one commit — so the merge itself lands the header already
// at `.claude-tweaks/pipelines/archive/{run-id}/...`, with the same layout beneath it.
// `archiveRunDir` stays the post-merge fallback for every run that did not go through
// this move (a non-wrap-up merge site, a header materialized after the move); it is not
// replaced. Readers go through run-header.js, which already reads either location.
//
// archiveRunHeader({ worktree, runId, specDir = null, env, git = runGit })
//   -> { outcome: 'moved' | 'noop' | 'refused', reason?, detail?, commit?, moved: string[] }
//   `moved` lists the POSIX repo-relative live paths moved (or removed as identical
//   twins), in `git ls-files` order. `specDir` ('spec-{N}') limits the move to that
//   spec's `work/`; null moves `{live}/work` and every `{live}/spec-*/work`. Only
//   `git ls-files`-tracked files move, one `git mv` each: untracked siblings under
//   `work/` stay where they are (a whole-directory `git mv` would take them along).
//   - noop: nothing is tracked under the live header paths (never materialized, or the
//     move already happened on this branch).
//   - refused, with `reason`: `missing-worktree`, `dirty-index` (any staged change — the
//     commit must contain only the move), `archived-copy-differs` (a destination already
//     holds different bytes, tracked or not), `git-mv-failed`, `commit-failed`,
//     `git-failed` (a probe git could not answer). Every refusal leaves the worktree and
//     index as it found them: planning refusals return before any mutation, and a
//     failure after the first mutation reverts every staged op LIFO.
//   A destination byte-identical to its live copy (a resumed move, or an earlier
//   fallback leaving a twin) is resolved by `git rm` of the live copy (tracked twin) or
//   `git mv -f` over it (untracked twin), not refused.
//   The commit names every source and destination path explicitly after `--`; an empty
//   pathspec would commit the whole index. It takes `env`'s identity and runs its hooks.
//   Throws a TypeError for a `runId` or `specDir` that is not shaped like one: a
//   caller bug, never a repo state.
//
// pushRunBranch({ worktree, env, git = runGit })
//   -> { pushed: boolean, branch?, reason?: 'detached-head' | 'invalid-branch' | 'push-failed', detail? }
//   Pushes `refs/heads/{branch}:refs/heads/{branch}` to `origin` (never force).
//
// `git` is the injectable runner (default hooks/git-exec.js's runGit); every call is
// `git(args, worktree, { env, ... })`. `env` defaults to the inherited environment.

const fs = require('node:fs');
const path = require('node:path');
const { runGit } = require('./hooks/git-exec');
const { RUN_ID_RE } = require('./hooks/run-dir-resolve');
const { lstatType } = require('./path-guard');
const { splitNul } = require('./git-z');
const { runRelDirs } = require('./run-header');

const SPEC_DIR_RE = /^spec-[1-9]\d*$/;
// A commit runs the repo's hooks and a push talks to a remote; both may outlast runGit's 10s default.
const COMMIT_TIMEOUT_MS = 120000;
const PUSH_TIMEOUT_MS = 120000;

function ARCHIVE_HEADER_SUBJECT(runId) {
  return `Archive run ${runId} spec header — moved to archive/ before merge`;
}

function refused(reason, detail, moved = []) {
  return { outcome: 'refused', reason, ...(detail ? { detail } : {}), moved };
}

function failDetail(res) {
  return (res && (res.stderr || res.failureStdout || res.failure)) || 'unknown git failure';
}

function validRunId(runId) {
  return typeof runId === 'string' && RUN_ID_RE.test(runId) && !/[\\/]/.test(runId) && !runId.includes('..');
}

// The `work/` directory above a live header path: `{live}/work` or `{live}/spec-N/work`.
function workRootOf(rel, liveDir) {
  const m = /^(spec-[^/]+\/)?work\//.exec(rel.slice(liveDir.length + 1));
  return m ? `${liveDir}/${m[0].slice(0, -1)}` : null;
}

// Removes the directories a moved file left empty, up to and including its `work/`.
// Best effort: a directory still holding an untracked file stays (rmdir refuses).
function pruneEmptyDirs(worktree, rel, liveDir) {
  const root = workRootOf(rel, liveDir);
  if (!root) return;
  let dir = path.posix.dirname(rel);
  while (dir.length >= root.length) {
    try { fs.rmdirSync(path.join(worktree, dir)); } catch { return; }
    dir = path.posix.dirname(dir);
  }
}

function archiveRunHeader({ worktree, runId, specDir = null, env, git = runGit } = {}) {
  if (!validRunId(runId)) throw new TypeError(`archiveRunHeader: not a run id: ${String(runId)}`);
  if (specDir !== null && !SPEC_DIR_RE.test(String(specDir))) {
    throw new TypeError(`archiveRunHeader: not a spec dir: ${String(specDir)}`);
  }
  const g = (args, opts = {}) => git(args, worktree, { env, ...opts });

  // (1) The worktree must be a directory (or a link to one).
  const wt = typeof worktree === 'string' && worktree ? lstatType(worktree).type : 'missing';
  if (wt !== 'directory' && wt !== 'symlink') return refused('missing-worktree', `no worktree at ${String(worktree)}`);

  // (2) Tracked files under the live header paths; none means nothing to do.
  const [liveDir, archivedDir] = runRelDirs(runId);
  const specs = specDir
    ? [`${liveDir}/${specDir}/work`]
    : [`${liveDir}/work`, `${liveDir}/spec-*/work/*`];
  const listed = g(['ls-files', '-z', '--', ...specs], { raw: true });
  if (listed.failure) return refused('git-failed', failDetail(listed));
  // `spec-*` in a pathspec also crosses `/`; keep only `{live}/work/...` and `{live}/spec-X/work/...`.
  const live = splitNul(listed.stdout).filter((rel) => workRootOf(rel, liveDir) !== null
    && (!specDir || rel.startsWith(`${liveDir}/${specDir}/work/`)));
  if (live.length === 0) return { outcome: 'noop', moved: [] };

  // (3) The commit must hold only the move.
  const cached = g(['diff', '--cached', '--quiet']);
  if (cached.failure) {
    return cached.failure === 'git-error' && cached.exitCode === 1
      ? refused('dirty-index', 'the index holds staged changes')
      : refused('git-failed', failDetail(cached));
  }

  // (4) Plan every pair before touching anything.
  const tracked = g(['ls-files', '-z', '--', archivedDir], { raw: true });
  if (tracked.failure) return refused('git-failed', failDetail(tracked));
  const trackedDest = new Set(splitNul(tracked.stdout));
  const plan = [];
  for (const src of live) {
    const dest = archivedDir + src.slice(liveDir.length);
    const srcBlob = g(['rev-parse', `:${src}`]);
    if (srcBlob.failure) return refused('git-failed', failDetail(srcBlob));
    if (trackedDest.has(dest)) {
      const destBlob = g(['rev-parse', `:${dest}`]);
      if (destBlob.failure) return refused('git-failed', failDetail(destBlob));
      if (destBlob.stdout !== srcBlob.stdout) return refused('archived-copy-differs', `${dest} is tracked with different bytes`);
      plan.push({ op: 'rm', src, dest });
      continue;
    }
    const onDisk = lstatType(path.join(worktree, ...dest.split('/')));
    if (onDisk.type === 'missing') {
      plan.push({ op: 'mv', src, dest });
    } else if (onDisk.type !== 'file') {
      return refused('archived-copy-differs', `${dest} exists and is not a regular file`);
    } else {
      const destHash = g(['hash-object', '--', dest]);
      if (destHash.failure) return refused('git-failed', failDetail(destHash));
      if (destHash.stdout !== srcBlob.stdout) return refused('archived-copy-differs', `${dest} exists untracked with different bytes`);
      plan.push({ op: 'mv-force', src, dest });
    }
  }

  // (5) Mutate, recording each op so a failure can unwind it.
  const done = [];
  const revert = () => {
    for (const { op, src, dest } of done.reverse()) {
      try {
        if (op === 'rm') {
          g(['--literal-pathspecs', 'reset', '-q', '--', src]);
          g(['--literal-pathspecs', 'checkout', '--', src]);
        } else {
          fs.mkdirSync(path.dirname(path.join(worktree, ...src.split('/'))), { recursive: true });
          g(['mv', '--', dest, src]);
          // `git mv -f` overwrote an untracked destination holding these same bytes: put it back.
          if (op === 'mv-force') fs.copyFileSync(path.join(worktree, ...src.split('/')), path.join(worktree, ...dest.split('/')));
        }
      } catch { /* best effort: keep unwinding the remaining ops */ }
    }
  };
  for (const step of plan) {
    let res;
    try {
      if (step.op === 'rm') {
        res = g(['--literal-pathspecs', 'rm', '-q', '--', step.src]);
      } else {
        fs.mkdirSync(path.dirname(path.join(worktree, ...step.dest.split('/'))), { recursive: true });
        res = g(step.op === 'mv-force' ? ['mv', '-f', '--', step.src, step.dest] : ['mv', '--', step.src, step.dest]);
      }
    } catch (err) {
      res = { failure: 'git-error', stderr: String(err && err.message) };
    }
    if (res.failure) {
      revert();
      return refused('git-mv-failed', `${step.op} ${step.src}: ${failDetail(res)}`);
    }
    done.push(step);
  }

  // (6) One commit, explicit pathspec: every source and destination path.
  const subject = ARCHIVE_HEADER_SUBJECT(runId);
  const paths = plan.flatMap((s) => [s.src, s.dest]);
  const committed = g(['--literal-pathspecs', 'commit', '-q', '-m', subject, '--', ...paths], { timeoutMs: COMMIT_TIMEOUT_MS });
  if (committed.failure) {
    // (7) Unwind: the staged moves go back, so the branch is as it was.
    revert();
    return refused('commit-failed', failDetail(committed));
  }

  // (8) Report; drop the live dirs the move emptied.
  const moved = live;
  for (const rel of live) pruneEmptyDirs(worktree, rel, liveDir);
  const sha = g(['rev-parse', 'HEAD']);
  if (sha.failure) return { outcome: 'moved', detail: `committed, but HEAD unreadable: ${failDetail(sha)}`, moved };
  return { outcome: 'moved', commit: sha.stdout, moved };
}

function pushRunBranch({ worktree, env, git = runGit } = {}) {
  const g = (args, opts = {}) => git(args, worktree, { env, ...opts });
  const head = g(['symbolic-ref', '-q', '--short', 'HEAD']);
  if (head.failure) {
    return head.failure === 'git-error' && head.exitCode === 1
      ? { pushed: false, reason: 'detached-head' }
      : { pushed: false, reason: 'push-failed', detail: failDetail(head) };
  }
  const branch = head.stdout;
  if (!branch || branch.startsWith('-')) return { pushed: false, reason: 'invalid-branch', branch };
  const pushed = git(['push', '-q', 'origin', `refs/heads/${branch}:refs/heads/${branch}`], worktree, {
    // A credential prompt has no terminal to answer it: fail fast instead of hanging.
    env: { ...(env || process.env), GIT_TERMINAL_PROMPT: '0' },
    timeoutMs: PUSH_TIMEOUT_MS,
  });
  return pushed.failure
    ? { pushed: false, reason: 'push-failed', branch, detail: failDetail(pushed) }
    : { pushed: true, branch };
}

module.exports = { ARCHIVE_HEADER_SUBJECT, archiveRunHeader, pushRunBranch };
