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
//   - refused, with `reason`: `missing-worktree`, `dirty-index` (any staged change, or an
//     unstaged edit — including a deletion — to a file about to move or to a tracked
//     identical-twin destination the commit will carry: the commit takes working-tree
//     content and must contain only the move), `archived-copy-differs` (a destination already
//     holds different bytes, tracked or not), `git-mv-failed`, `commit-failed`,
//     `git-failed` (a probe git could not answer). Every refusal leaves the worktree and
//     index as it found them: planning refusals return before any mutation, and a
//     failure after the first mutation reverts every staged op LIFO and removes the
//     directories this call created. When that unwind itself fails, the reason is
//     suffixed `-partial-revert` (`git-mv-failed-partial-revert`,
//     `commit-failed-partial-revert`, as in archive-merged.js) and `detail` lists what
//     could not be undone — a caller must not read those as a clean refusal.
//   A destination byte-identical to its live copy (a resumed move, or an earlier
//   fallback leaving a twin) is resolved by `git rm` of the live copy (tracked twin) or
//   `git mv -f` over it (untracked twin), not refused.
//   The commit names every source and destination path explicitly after `--`, each as a
//   `:(literal)` pathspec; an empty pathspec would commit the whole index. It takes `env`'s identity and runs its hooks.
//   Throws a TypeError for a `runId` (a run-id segment with no glob or path characters) or
//   `specDir` that is not shaped like one: a
//   caller bug, never a repo state; its `code` is ARGS_ERROR_CODE ('ERR_RUN_HEADER_ARGS'). `validRunId(runId)` and `SPEC_DIR_RE` are those two checks,
//   exported so a CLI refuses a malformed value (bin/archive-run-header.js, exit 2) before the call.
//
// The move never pushes: the caller's own push (phase-exit.js, or the merge path's own push call)
// publishes the commit before the merge.
//
// `git` is the injectable runner (default hooks/git-exec.js's runGit); every call is
// `git(args, worktree, { env: repoPinnedEnv(env), ... })`, so an inherited GIT_DIR, GIT_WORK_TREE or
// GIT_INDEX_FILE never overrides the worktree (#4178). `env` defaults to the inherited environment.

const fs = require('node:fs');
const path = require('node:path');
const { runGit, repoPinnedEnv } = require('./hooks/git-exec');
const { RUN_ID_RE } = require('./hooks/run-dir-resolve');
const { lstatType } = require('./path-guard');
const { splitNul } = require('./git-z');
const { runRelDirs, SPEC_DIR_RE } = require('./run-header');

const SAFE_RUN_ID_RE = /^\d{4}-\d{2}-\d{2}T[0-9A-Za-z._-]+$/;
// A commit runs the repo's hooks, which may outlast runGit's 10s default.
const COMMIT_TIMEOUT_MS = 120000;
// The `code` on the TypeError a bad `runId`/`specDir` throws, so a caller tells it from a bug inside the move.
const ARGS_ERROR_CODE = 'ERR_RUN_HEADER_ARGS';

function ARCHIVE_HEADER_SUBJECT(runId) {
  return `Archive run ${runId} spec header — moved to archive/ before merge`;
}

function refused(reason, detail, moved = []) {
  return { outcome: 'refused', reason, ...(detail ? { detail } : {}), moved };
}

function failDetail(res) {
  return (res && (res.stderr || res.failureStdout || res.failure)) || 'unknown git failure';
}

// A run id is a path segment and part of git pathspecs: only characters that are neither a glob
// metacharacter nor a path separator, so every pathspec built from it names the run and nothing else.
function validRunId(runId) {
  return typeof runId === 'string' && RUN_ID_RE.test(runId) && SAFE_RUN_ID_RE.test(runId) && !runId.includes('..');
}

// `:(literal)` makes git read a path as itself, not as a glob (a file under work/ may be named `a*.md`).
// Per path, never the global --literal-pathspecs flag, which also exports GIT_LITERAL_PATHSPECS to hooks.
function lit(rel) {
  return `:(literal)${rel}`;
}

// The `work/` directory above a live header path: `{live}/work` or `{live}/spec-N/work`.
function workRootOf(rel, liveDir) {
  if (!rel.startsWith(`${liveDir}/`)) return null;
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

function argsError(message) {
  return Object.assign(new TypeError(message), { code: ARGS_ERROR_CODE });
}

function archiveRunHeader({ worktree, runId, specDir = null, env, git = runGit } = {}) {
  if (!validRunId(runId)) throw argsError(`archiveRunHeader: not a run id: ${String(runId)}`);
  if (specDir !== null && !SPEC_DIR_RE.test(String(specDir))) {
    throw argsError(`archiveRunHeader: not a spec dir: ${String(specDir)}`);
  }
  // Pinned: an inherited GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE would override `-C worktree` and could commit elsewhere (#4178).
  const g = (args, opts = {}) => git(args, worktree, { env: repoPinnedEnv(env), ...opts });

  // (1) The worktree must be a directory (or a link to one).
  const wt = typeof worktree === 'string' && worktree ? lstatType(worktree).type : 'missing';
  if (wt !== 'directory' && wt !== 'symlink') return refused('missing-worktree', `no worktree at ${String(worktree)}`);

  // (2) Tracked files under the live header paths; none means nothing to do.
  const [liveDir, archivedDir] = runRelDirs(runId);
  const specs = specDir
    ? [lit(`${liveDir}/${specDir}/work`)]
    : [lit(`${liveDir}/work`), `${liveDir}/spec-*/work/*`]; // the run id is glob-free (validRunId); only `spec-*` is a pattern
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
  const tracked = g(['ls-files', '-z', '--', lit(archivedDir)], { raw: true });
  if (tracked.failure) return refused('git-failed', failDetail(tracked));
  const trackedDest = new Set(splitNul(tracked.stdout));
  const plan = [];
  // The commit takes working-tree content (--only) for every path it names, so an unstaged edit to
  // a source or to a tracked destination would ride along into the move commit.
  const unstagedRefusal = (rel) => {
    const edited = g(['diff', '--quiet', '--', lit(rel)]);
    if (!edited.failure) return null;
    return edited.failure === 'git-error' && edited.exitCode === 1
      ? refused('dirty-index', `${rel} has unstaged changes`)
      : refused('git-failed', failDetail(edited));
  };
  for (const src of live) {
    const dest = archivedDir + src.slice(liveDir.length);
    const srcEdited = unstagedRefusal(src);
    if (srcEdited) return srcEdited;
    const srcBlob = g(['rev-parse', `:${src}`]);
    if (srcBlob.failure) return refused('git-failed', failDetail(srcBlob));
    if (trackedDest.has(dest)) {
      const destBlob = g(['rev-parse', `:${dest}`]);
      if (destBlob.failure) return refused('git-failed', failDetail(destBlob));
      if (destBlob.stdout !== srcBlob.stdout) return refused('archived-copy-differs', `${dest} is tracked with different bytes`);
      const destEdited = unstagedRefusal(dest); // the commit pathspec carries dest too
      if (destEdited) return destEdited;
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

  // (5) Mutate, recording each op (and each directory this call creates) so a failure can unwind it.
  const done = [];
  const createdDirs = [];
  const ensureDir = (relDir) => {
    const missing = [];
    for (let d = relDir; d && d !== '.' && lstatType(path.join(worktree, ...d.split('/'))).type === 'missing'; d = path.posix.dirname(d)) missing.push(d);
    fs.mkdirSync(path.join(worktree, ...relDir.split('/')), { recursive: true });
    createdDirs.push(...missing); // deepest first
  };
  // Returns what could not be undone; an empty list is a clean unwind.
  const revert = () => {
    const failures = [];
    const note = (what, res) => { if (res && res.failure) failures.push(`${what}: ${failDetail(res)}`); };
    for (const { op, src, dest } of done.reverse()) {
      try {
        if (op === 'rm') {
          note(`reset ${src}`, g(['reset', '-q', '--', lit(src)]));
          note(`checkout ${src}`, g(['checkout', '--', lit(src)]));
        } else {
          fs.mkdirSync(path.dirname(path.join(worktree, ...src.split('/'))), { recursive: true });
          const back = g(['mv', '--', dest, src]);
          note(`mv ${dest} back`, back);
          // `git mv -f` overwrote an untracked destination holding these same bytes: put it back.
          if (op === 'mv-force' && !back.failure) fs.copyFileSync(path.join(worktree, ...src.split('/')), path.join(worktree, ...dest.split('/')));
        }
      } catch (err) {
        failures.push(`${op} ${src}: ${String(err && err.message)}`);
      }
    }
    // Only the directories this call created, deepest first; one a file still sits in stays.
    for (const d of [...createdDirs].sort((a, b) => b.length - a.length)) {
      try { fs.rmdirSync(path.join(worktree, ...d.split('/'))); } catch { /* not empty, or already gone */ }
    }
    return failures;
  };
  // A refusal after the first mutation: honest about whether the unwind finished.
  const refuseAfterMutation = (reason, detail) => {
    const failures = revert();
    return failures.length === 0
      ? refused(reason, detail)
      : refused(`${reason}-partial-revert`, `${detail}; the unwind did not finish, check git status — ${failures.join('; ')}`);
  };
  for (const step of plan) {
    let res;
    try {
      if (step.op === 'rm') {
        res = g(['rm', '-q', '--', lit(step.src)]);
      } else {
        ensureDir(path.posix.dirname(step.dest));
        res = g(step.op === 'mv-force' ? ['mv', '-f', '--', step.src, step.dest] : ['mv', '--', step.src, step.dest]);
      }
    } catch (err) {
      res = { failure: 'git-error', stderr: String(err && err.message) };
    }
    if (res.failure) return refuseAfterMutation('git-mv-failed', `${step.op} ${step.src}: ${failDetail(res)}`);
    done.push(step);
  }

  // (6) One commit, explicit pathspec: every source and destination path.
  const subject = ARCHIVE_HEADER_SUBJECT(runId);
  const paths = plan.flatMap((s) => [lit(s.src), lit(s.dest)]);
  const committed = g(['commit', '-q', '-m', subject, '--', ...paths], { timeoutMs: COMMIT_TIMEOUT_MS });
  // (7) A failed commit unwinds: the staged moves go back, so the branch is as it was.
  if (committed.failure) return refuseAfterMutation('commit-failed', failDetail(committed));

  // (8) Report; drop the live dirs the move emptied.
  for (const rel of live) pruneEmptyDirs(worktree, rel, liveDir);
  const sha = g(['rev-parse', 'HEAD']);
  if (sha.failure) return { outcome: 'moved', detail: `committed, but HEAD unreadable: ${failDetail(sha)}`, moved: live };
  return { outcome: 'moved', commit: sha.stdout, moved: live };
}

module.exports = { ARCHIVE_HEADER_SUBJECT, ARGS_ERROR_CODE, SPEC_DIR_RE, archiveRunHeader, validRunId };
