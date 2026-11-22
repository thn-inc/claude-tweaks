#!/usr/bin/env node
// bin/archive-run-header.js -- wrap-up's pre-merge move of a run's tracked spec header (#3976).
// The run's `.claude-tweaks/pipelines/{run-id}/work/` (and `spec-{N}/work/`) headers are committed
// live on the run branch; this moves them to `.claude-tweaks/pipelines/archive/{run-id}/` in one
// commit before the merge, so the merge lands them already archived. The git work lives in
// lib/run-header-archive.js (`archiveRunHeader`); this shell parses args, finds the run branch's
// worktree, prints the envelope and writes the decisions.md trail. It never pushes: the caller's own
// push (phase-exit.js, or the merge path's push call) publishes the move commit before the merge.
// reconcile's `archiveRunDir` stays the post-merge fallback for every run this move did not reach.
//
//   node bin/archive-run-header.js --run <run-dir> [--worktree <path>] [--section </skill>] [--help]
//
// `--run` is the main checkout's run dir: `{main}/.claude-tweaks/pipelines/{run-id}`, a multi-spec
// per-spec dir `.../{run-id}/spec-{N}` (only that spec's header moves), or an `archive/{run-id}` dir
// (the top-level run id is read from the path). The worktree is `--worktree`, else run-state.json's
// `worktree`, else `worktreeAtClose` (what `hooks.js close-run` leaves), else the parent run dir's
// `worktreeAtClose`. `--section` is the decisions.md section the entry lands under (default /wrap-up).
//
// Prints exactly one JSON line:
//   {outcome, reason?, detail?, commit?, moved, logged, logError?}
// outcome moved | noop | refused. `moved` is the POSIX repo-relative live paths moved. `reason` (refused):
// the library's own (missing-worktree, dirty-index, archived-copy-differs, git-mv-failed, commit-failed,
// the two *-partial-revert forms, git-failed -- a partial-revert reason is not a clean refusal: `detail`
// lists what could not be undone) or this CLI's no-worktree / not-a-linked-worktree.
//
// Self-logging (_shared/auto-decision-log.md's roster): moved -> one AUTO line, a refusal -> one SKIP
// naming the fallback, noop -> nothing. `logged` means every line the outcome owes is in decisions.md,
// so a noop (which owes none) reports `logged: true`; it is `false` only when the append failed. That
// never changes the exit code: `logged: false`, `logError` and one stderr line
// `could not append the decisions.md entry`; the caller hand-logs only then.
//
// Status is data: exit 0 whenever an envelope was printed, whatever its outcome or reason.
// 2 malformed invocation (a missing or option-shaped value, an unknown flag, a --run that is not under
//   `.claude-tweaks/pipelines/` or whose run id or spec segment is not shaped like one; the move's own
//   argument error, ERR_RUN_HEADER_ARGS); git is never spawned for a malformed --run.
// 3 run dir missing or not anchored under the main checkout's .claude-tweaks/pipelines (a worktree-local shadow, or a directory outside pipelines/ --
//   _shared/pipeline-run-dir.md, [IL-127]); an archive/{run-id} dir in the main checkout is anchored.
//   Checked before any git call. Same vocabulary as post-merge-run.js (the Sanctioned-writer family).
// An unexpected exception from the move propagates as exit 1 with nothing logged; the caller's
// other-exit branch logs the SKIP.
'use strict';

const path = require('path');
const {
  archiveRunHeader, validRunId, SPEC_DIR_RE, ARGS_ERROR_CODE,
} = require('./lib/run-header-archive');
const { resolveTarget, formatEntry, appendEntries } = require('./lib/log-decision/append');
const { readRunStateWithParent, readRunState, priorWorktree } = require('./lib/hooks/context');
const { mainCheckoutRoot, safeReal } = require('./lib/hooks/worktree-detect');

const NAME = 'archive-run-header.js';
const STEP = 'Archive spec header';
const DEFAULT_SECTION = '/wrap-up';
const FALLBACK = "header left live; reconcile's archiveRunDir archives it after the merge";
const PARTIAL_REVERT_TAIL = 'the unwind did not finish: staged renames may remain in the run worktree index; check git status there before any whole-index commit';
const DETAIL_MAX = 200;

const USAGE = `usage: ${NAME} --run <run-dir> [--worktree <path>] [--section </skill>] [--help]\n`
  + '  moves the run\'s tracked spec header to .claude-tweaks/pipelines/archive/{run-id}/ in one commit on the run branch\n'
  + '  prints {outcome, reason?, detail?, commit?, moved, logged, logError?}; outcome: moved | noop | refused\n'
  + `  logs one AUTO (moved) or SKIP (refused) line under ${DEFAULT_SECTION} unless --section names another; noop logs nothing and reports logged: true\n`
  + '  exit 0 an envelope was printed (every outcome and reason is data)\n'
  + '       2 malformed invocation\n'
  + '       3 run dir missing or not anchored under the main checkout\'s .claude-tweaks/pipelines\n';

const VALUE_FLAGS = { '--run': 'run', '--worktree': 'worktree', '--section': 'section' };

function parseArgs(argv) {
  const o = { run: null, worktree: null, section: DEFAULT_SECTION, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      o.help = true;
    } else if (Object.hasOwn(VALUE_FLAGS, a)) {
      const v = argv[++i];
      // A trailing bare flag reads undefined; a value starting `-` is the next option, or reaches git as one.
      if (typeof v !== 'string' || !v.trim() || v.startsWith('-')) return { error: `${a} needs a value` };
      o[VALUE_FLAGS[a]] = v;
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  env: process.env,
  mainRoot: (cwd) => mainCheckoutRoot(cwd),
  now: () => new Date(),
  archiveRunHeader,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// `{main}/.claude-tweaks/pipelines/[archive/]{run-id}[/spec-{N}]` -> { runId, specDir } | { error }.
function runIdentity(mainRoot, runDir) {
  const rel = path.relative(mainRoot, runDir);
  const segs = rel.split(path.sep);
  if (path.isAbsolute(rel) || segs[0] !== '.claude-tweaks' || segs[1] !== 'pipelines') {
    return { error: `--run is not under .claude-tweaks/pipelines/ of the main checkout: ${runDir}` };
  }
  const rest = segs.slice(2);
  if (rest[0] === 'archive') rest.shift();
  const [runId, ...tail] = rest;
  if (!runId || !validRunId(runId)) {
    return { error: `--run does not name a run id (a pipelines/ or pipelines/archive/ child shaped like 2026-01-02T030405-...): ${runDir}` };
  }
  if (tail.length > 1 || (tail.length === 1 && !SPEC_DIR_RE.test(tail[0]))) {
    return { error: `--run holds more than a run id and one spec-{N} segment: ${runDir}` };
  }
  return { runId, specDir: tail.length ? tail[0] : null };
}

// --worktree, else the run's recorded worktree (own or the multi-spec parent's), else worktreeAtClose
// (own, then the parent's: close-run does not copy it down).
function recordedWorktree(runDir) {
  const { state, parentRunDir } = readRunStateWithParent(runDir);
  const own = priorWorktree(state);
  if (own) return own;
  const parent = parentRunDir ? readRunState(parentRunDir) : null;
  const fromParent = parent && parent.worktreeAtClose;
  return typeof fromParent === 'string' && fromParent ? fromParent : null;
}

function oneLine(s) {
  const flat = String(s).replace(/\s+/g, ' ').trim();
  return flat.length > DETAIL_MAX ? `${flat.slice(0, DETAIL_MAX)}...` : flat;
}

// A `*-partial-revert` refusal left staged renames behind (the unwind itself failed), so the header is NOT
// cleanly "left live": the entry says the tree needs a look instead of promising the fallback.
function refusedText(reason, detail) {
  const tail = reason.endsWith('-partial-revert') ? PARTIAL_REVERT_TAIL : `fallback: ${FALLBACK}`;
  return `condition: ${reason}${detail ? ` (${oneLine(detail)})` : ''} → ${tail}`;
}

// The decisions.md entries one result owes: moved -> AUTO, refused -> SKIP, noop -> none.
function entriesFor({ result, runId, now }) {
  if (result.outcome === 'refused') {
    return [formatEntry({ status: 'SKIP', now, step: STEP, text: refusedText(result.reason, result.detail) })];
  }
  if (result.outcome !== 'moved') return [];
  const sha = result.commit ? result.commit.slice(0, 7) : 'an unreadable HEAD';
  return [formatEntry({
    status: 'AUTO',
    now,
    step: STEP,
    text: `moved ${result.moved.length} file(s) to archive/${runId}/ in ${sha}`,
    reversibility: 'high (git revert)',
  })];
}

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const usageError = (message) => { deps.stderr(`${NAME}: ${message}\n${USAGE}`); return 2; };
  const unanchored = (message) => { deps.stderr(`${NAME}: ${message}\n`); return 3; };

  // 1. Parse / validate. --help answers before any probe.
  const o = parseArgs(argv);
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) return usageError('--run <run-dir> is required');

  // 2. The run dir must be the main checkout's (or its archive/), never a worktree-local shadow. Before any git call.
  let cwd;
  let mainRoot;
  try {
    cwd = deps.cwd();
    mainRoot = deps.mainRoot(cwd);
  } catch (e) {
    return unanchored(`could not resolve the main checkout: ${(e && e.message) || e}`);
  }
  if (!mainRoot) return unanchored(`could not resolve the main checkout from ${cwd} -- run from inside the repository`);
  const target = resolveTarget({ runDir: path.resolve(cwd, o.run), cwd, mainRoot });
  if (!target.ok) {
    return unanchored(target.reason === 'missing'
      ? `run dir does not exist: ${o.run}`
      : `run dir is not anchored under the main checkout's .claude-tweaks/pipelines (a worktree-local shadow, or a directory outside pipelines/): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path`);
  }
  // The validated real path: what the identity is read from and what the entry is logged under.
  const runDir = path.dirname(target.file);

  // 3. Which run, which spec; a malformed one is refused before git (the library throws on it).
  const identity = runIdentity(mainRoot, runDir);
  if (identity.error) return usageError(identity.error);
  const { runId, specDir } = identity;

  // 4. The move: refused without a usable worktree, else the library's own answer.
  const worktree = o.worktree ? path.resolve(cwd, o.worktree) : recordedWorktree(runDir);
  let result;
  if (!worktree) {
    result = { outcome: 'refused', reason: 'no-worktree', detail: 'run-state.json records no worktree and --worktree was not given', moved: [] };
  } else if (safeReal(worktree) === mainRoot) {
    result = { outcome: 'refused', reason: 'not-a-linked-worktree', detail: `${worktree} is the main checkout`, moved: [] };
  } else {
    try {
      result = deps.archiveRunHeader({ worktree, runId, specDir, env: deps.env });
    } catch (e) {
      // The checks above are the library's own, so its argument error is a caller bug, never a repo state: exit 2.
      // Matched by code, never by type: a TypeError from inside the move may follow a mutation and must surface.
      if (e && e.code === ARGS_ERROR_CODE) { deps.stderr(`${NAME}: the move refused its arguments: ${e.message}\n`); return 2; }
      throw e;
    }
  }

  // 5. The audit line(s); a failed append is data, never an exit code.
  const body = {
    outcome: result.outcome,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.detail ? { detail: result.detail } : {}),
    ...(result.commit ? { commit: result.commit } : {}),
    moved: result.moved,
    logged: true,
  };
  const entries = entriesFor({ result, runId, now: deps.now() });
  if (entries.length) {
    try {
      appendEntries({ runDir, items: entries.map((entry) => ({ section: o.section, entry })) });
    } catch (e) {
      body.logged = false;
      body.logError = String((e && e.message) || e);
      deps.stderr(`${NAME}: could not append the decisions.md entry: ${body.logError}\n`);
    }
  }
  deps.stdout(`${JSON.stringify(body)}\n`);
  return 0;
}

module.exports = { run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
