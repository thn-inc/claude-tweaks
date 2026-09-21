#!/usr/bin/env node
// bin/hooks.js — single dispatcher for all claude-tweaks hook registrations.
// Cardinal invariant: never break a session. Every path — including a
// PreToolUse deny — exits 0; no module ever sets a non-zero `exit`. A deny
// is communicated entirely via `hookSpecificOutput.permissionDecision:
// 'deny'` in the stdout JSON (see pre-tool-use.js's own header comment for
// why: exit 2 is a cruder, stderr-only mechanism that would silently drop
// the custom permissionDecisionReason). This corrects an earlier version of
// this comment ("the only deliberate non-zero exit is the pre-tool-use
// deny") that never actually matched pre-tool-use.js's real behavior.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const ctxLib = require('./lib/hooks/context');
const siblingSessions = require('./lib/hooks/sibling-sessions');
const specStatusLib = require('./lib/flow/manifest');
const resumeFreshness = require('./lib/hooks/resume-freshness');
const stagedInventory = require('./lib/hooks/staged-inventory');
const wtDetect = require('./lib/hooks/worktree-detect');
const { closeRunState } = require('./lib/hooks/close-run-state');
const { teardownRun } = require('./lib/hooks/teardown-run');
const { deriveBranch, repoRootOf } = require('./lib/hooks/run-integrity');

const EVENTS = ['session-start', 'session-end', 'pre-compact', 'pre-tool-use', 'post-tool-use', 'subagent-stop'];

// The write-only, janitorial half of reconcile/index.js's ALL_CHECKS — run
// by the `reconcile-background` subcommand below, off session-start.js's hot
// path (#820, D8). Exported (alongside session-start.js's own FAST_CHECKS
// export) so a test can assert the two lists partition ALL_CHECKS exactly —
// no overlap, nothing silently dropped when a check is added to one list and
// not the other.
const BACKGROUND_CHECKS = ['release', 'archive', 'archive-branches', 'remote-prune', 'reap'];

// String-literal per-event requires — not a computed `require('./lib/hooks/' +
// event)` — so every `bin/lib/hooks/*.js` module resolves statically inside
// `plugin/` (payload-boundary test #419, assertion (b): a dynamic require() is
// itself a failure, not an accepted blind spot). `event` is already gated to
// one of `EVENTS` by this function's one call site before it's ever reached
// here, so the lookup table's keys are exactly — and only — that fixed set.
const EVENT_MODULES = {
  'session-start': () => require('./lib/hooks/session-start'),
  'session-end': () => require('./lib/hooks/session-end'),
  'pre-compact': () => require('./lib/hooks/pre-compact'),
  'pre-tool-use': () => require('./lib/hooks/pre-tool-use'),
  'post-tool-use': () => require('./lib/hooks/post-tool-use'),
  'subagent-stop': () => require('./lib/hooks/subagent-stop'),
};

function loadModule(event) {
  const load = EVENT_MODULES[event];
  if (!load) return null;
  try { return load(); } catch { return null; }
}

// Matches lib/hooks/pre-tool-use.js's pluginRoot() convention (also used
// inline in session-start.js): resolve the real path when a session has it,
// otherwise fall back to the unexpanded env-var literal so the printed
// command text is still copy-pasteable in whatever shell reads it.
function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT || '${CLAUDE_PLUGIN_ROOT}';
}

// #1143: usage strings for every documented `hooks.js` subcommand (the
// dispatch table's own record-worktree/close-run/teardown-run/archive-run/
// resolve-run-dir/record-pr/spec-status/check-resume-freshness/check-staged-
// inventory/check-sibling-sessions/sweep-shadow/adopt-run-dir/reconcile/
// reconcile-background/reconcile-summary set — see docs/plugin-structure.md's
// hooks.js line). Doubles as the membership table for the `--help`/`-h` intercept
// below: a verb absent from this map gets no guard, by design — the six
// EVENTS names are invoked by the harness via stdin JSON, never probed with
// a `--help` flag, and never fell through to the implicit-run-dir-guess
// hazard this record closes. record-pr's and spec-status's own internal
// "usage:" error strings (printed on malformed non-help args) reuse these
// same entries rather than a second, driftable copy of the same text.
const USAGE = {
  'record-worktree': 'record-worktree --run <dir> <worktree-path>',
  'resolve-run-dir': 'resolve-run-dir [--spec-slug <slug>] [--mode <mode>] [--standalone <value>] [--create] [--root-only]',
  'sweep-shadow': 'sweep-shadow [--run <dir>] [--worktree <path>]',
  'adopt-run-dir': 'adopt-run-dir --run <main-checkout-run-dir> --worktree <worktree-path>',
  'record-pr': 'record-pr [--run <dir>] <number> <url>',
  'spec-status': 'spec-status --run <parent-dir> --spec <n> --status <pending|running|complete|failed|not-run> --phase <phase>',
  'close-run': 'close-run [--run <dir>]',
  'teardown-run': 'teardown-run [--run <dir>] [--merged|--abandoned]',
  'archive-run': 'archive-run [--run <dir>]',
  'resolve-console': 'resolve-console --run <dir> [--approve <id,id,...>] [--decline <id,id,...>]',
  'check-resume-freshness': 'check-resume-freshness [--run <dir>]',
  'check-staged-inventory': 'check-staged-inventory [--run <dir>]',
  'check-sibling-sessions': 'check-sibling-sessions --record <id-or-slug>',
  reconcile: 'reconcile [--dry-run] [--json] [--mcp-reachable] [--checks <c1,c2,...>]',
  'reconcile-summary': 'reconcile-summary',
  'reconcile-background': 'reconcile-background',
};

const HELP_FLAGS = new Set(['--help', '-h']);

// #1012: declared-flag sets for the five mutating run-state verbs
// (close-run, record-worktree, record-pr, spec-status, teardown-run) —
// consulted by the unknown-flag guard below (which supersedes HELP_FLAGS for
// exactly these five: `--help`/`-h` are simply never declared, so they fall
// out as "unknown" the same as a genuine typo) and by resolveRunArg's
// unambiguousOnly resolution path further down. Every other resolveRunArg
// caller (archive-run, check-resume-freshness, check-staged-inventory) has
// no entry here and keeps today's HELP_FLAGS-only guard and
// ctxLib.resolveRunDir fallback, unchanged.
const KNOWN_FLAGS = {
  'close-run': ['--run'],
  'record-worktree': ['--run'],
  'record-pr': ['--run'],
  'spec-status': ['--run', '--spec', '--status', '--phase', '--now'],
  'teardown-run': ['--run', '--merged', '--abandoned'],
  'resolve-console': ['--run', '--approve', '--decline'],
};

// Declared flags that consume the following token as a value — the
// unknown-flag scan below must skip that token rather than risk misreading
// it as a flag itself (an argument value could itself start with "--").
const VALUE_FLAGS = new Set(['--run', '--spec', '--status', '--phase', '--now', '--approve', '--decline']);

// First `--*`-shaped token in `args` that isn't declared for this verb, or
// null when every `--*` token is declared (or there are none). Scans the
// FULL argument list, not just a fixed position, matching #1143's own
// "anywhere in the argument list" guarantee for --help.
function firstUnknownFlag(knownFlags, args) {
  const known = new Set(knownFlags);
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (typeof a !== 'string' || !a.startsWith('--')) continue;
    if (!known.has(a)) return a;
    if (VALUE_FLAGS.has(a)) i += 1; // skip this flag's own value
  }
  return null;
}

// Shared by the resolve-run-dir and spec-status subcommands below — each
// previously defined its own identical `--flag value` lookup closure over a
// different local array (`args` vs `rest`); one function taking the array
// explicitly instead of two copies that could drift.
function flagVal(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
}

function isDirectory(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// #1586: minimal Levenshtein distance, used only to suggest the closest
// known subcommand on an unrecognized one (main()'s final EVENTS.includes
// fallthrough below). Small inputs only (verb names, a handful of
// characters each) — no need for a shared/optimized implementation.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}

// Nearest known verb by edit distance, for the unrecognized-subcommand error
// below — `null` when nothing is close enough to be a useful suggestion
// (arbitrarily far off, e.g. blank/empty cmd or a completely unrelated word).
function closestVerb(cmd, candidates) {
  if (!cmd) return null;
  let best = null;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const dist = levenshtein(cmd, candidate);
    if (dist < bestDist) { bestDist = dist; best = candidate; }
  }
  return bestDist <= Math.max(3, Math.ceil(cmd.length / 2)) ? best : null;
}

// #1452: `mainArchivedCandidate` below is only ever the run's OWN
// archive/{run-id} path — the one location archive-merged.js's archiveRunDir
// writes a `{status: 'archiving'}` claim stub to (writeRunState, before it
// ever attempts the git mv that can fail and leave that stub behind with
// nothing to clean it up). A plain `isDirectory` twin check can't tell that
// stub apart from a genuinely completed archive, so a single failed archival
// attempt on a worktree-local-fallback-eligible run dir permanently defeats
// this file's own #280/#1183/#1299 twin check afterward — every later retry
// reads the stub as "already archived elsewhere" and is refused as a shadow,
// even long after the claim's own TTL (context.js's ARCHIVE_CLAIM_TTL_MS)
// would let archive-merged.js's own decideArchive treat it as abandoned and
// retry. Mirrors that exact staleness rule here so the two callers agree.
function isLiveArchiveTwin(p) {
  if (!isDirectory(p)) return false;
  const state = ctxLib.readRunState(p);
  if (state && state.status === 'archiving' && ctxLib.isStaleClaim(state)) return false;
  return true;
}

// #280: the one signal that distinguishes "harness-isolation left a real run
// dir trapped in this worktree" from "an ordinary stray directory that
// happens to sit under .claude-tweaks/pipelines/". A bare `mkdir` produces a
// directory too — that must never match — so the bar is that a pipeline step
// actually WROTE to it: one of the three files every initialized run dir
// carries at least one of (decisions.md from Manifesto/standalone-fallback
// init, run-state.json from a hook write, config.yml from the Manifesto).
function isInitializedRunDir(dir) {
  return ['decisions.md', 'run-state.json', 'config.yml']
    .some((marker) => fs.existsSync(path.join(dir, marker)));
}

// Shared by every #280/#1183/#1299/#1566 shape check below (whole-branch
// review finding — this used to be hand-copied at each call site): true when
// `resolved`, relative to `root`'s own .claude-tweaks/pipelines/, has a
// run-id-shaped LEADING segment — either directly, or one level deeper under
// archive/ (an archive/{id} shadow's run-id segment is relParts[1]; every
// other shape's is relParts[0]). Deliberately leading-segment-only, not
// length-exact: a multi-spec shadow (pipelines/{parent}/spec-N) is two
// segments deep and is still a legitimate run-dir shape (#1183) — only the
// leading segment needs to be run-id-shaped, whatever's nested beneath it.
// `root` must already be realpath'd if `resolved` is (callers pass matching
// pairs).
function pipelinesRunIdShape(root, resolved) {
  const relFromPipelines = path.relative(path.join(root, '.claude-tweaks', 'pipelines'), resolved);
  const inPipelines = !relFromPipelines.startsWith('..') && !path.isAbsolute(relFromPipelines);
  const relParts = inPipelines ? relFromPipelines.split(path.sep) : [];
  const isArchiveShape = relParts[0] === 'archive';
  const runIdSegment = isArchiveShape ? relParts[1] : relParts[0];
  const runIdShaped = !!runIdSegment && ctxLib.RUN_ID_RE.test(runIdSegment);
  return {
    relFromPipelines, inPipelines, isArchiveShape, runIdSegment, runIdShaped,
  };
}

// Resolves an explicit `--run <path>` argument, validating it's a real
// directory, or falls back to ctxLib.resolveRunDir when --run is absent.
// Shared by record-worktree and close-run below so a future change to what
// counts as a valid --run path (e.g. also rejecting a directory that exists
// but isn't a real run dir, or resolving symlinks first) only needs to land
// once. `args` is the command's own argument list (cmd already stripped);
// when --run is found, its two-element span is spliced out of the returned
// `rest` so a caller with its own positional args (record-worktree's
// worktree path) can still find them regardless of flag placement. `resolveOpts`
// forwards unchanged to the implicit-fallback ctxLib.resolveRunDir call
// (used by every caller) — close-run passes
// { includeWorktreeForeign: true } so its fallback can still find and report
// a run bound to a different, still-live worktree (whole-branch review
// finding, pre-v6.110.0); every other caller omits it and keeps #1410's
// worktree-safe fallback.
// `resolveOpts.allowUninitialized` (#1566) is consulted by the plain
// anchored-directory branch below only (not the #280 worktree-local-fallback
// branch, which already requires initialization unconditionally): a real,
// anchored `--run` directory carrying none of decisions.md/run-state.json/
// config.yml is rejected unless the caller opts in. record-worktree is the
// sole legitimate first-writer in the dispatch mint-then-claim handoff
// (dispatch/SKILL.md Step 4 mkdir-only mints a run dir, flow/steps-and-gates.md
// case 2 adopts it with no config.yml yet, worktree-setup.md Step 4.5's
// record-worktree call performs the actual first write) — it opts in.
// archive-run also opts in: its own downstream logic gives a specific,
// more useful diagnostic (the orphaned-mint sweep) for a stale, never-claimed
// mint than a generic rejection here would. Every other of the 8 shared
// callers always targets an already-initialized run dir in real use.
// #1012: unambiguous-only implicit resolution for the five mutating verbs
// (resolveRunArg's `resolveOpts.unambiguousOnly`) — replaces the old
// "newest non-terminal run" guess (ctxLib.resolveRunDir) with a
// composite-identity-aware order:
//   1. PIPELINE_RUN_DIR env — resolved as-is, UNFILTERED (the write-time
//      ownership guard downstream is what protects this arm; an inherited
//      env var reaching a foreign run is a documented pollution vector,
//      #1038, and only an explicit --run may override a foreign verdict).
//   2. cwd-binding reverse lookup (ctxLib.findRunByWorktreePath) — a run
//      whose recorded worktree IS the caller's own cwd is provably this
//      caller's own run, even with N siblings live.
//   3. Otherwise, scan every non-terminal run dir and exclude any whose
//      classifyOwnership verdict against this caller is 'foreign' ('mine'
//      and 'indeterminate' both remain actionable — an unbound run may
//      still be the caller's, the same fail-open asymmetry resolveRun's own
//      fallback preserves). Exactly one survivor -> act on it.
//   4. Two or more survivors, or zero survivors among one-or-more total
//      candidates -> refuse, returning every non-terminal candidate
//      (annotated foreign/not) so the caller can render one paste-ready
//      `--run` line per candidate. Genuinely zero candidates system-wide
//      returns `candidates: null` instead, so the caller falls back to its
//      existing "no pipeline run dir found" message rather than an empty
//      refusal listing.
function resolveImplicitRunUnambiguous(cwd, env, callerIdentity) {
  if (env && env.PIPELINE_RUN_DIR) {
    try {
      if (fs.statSync(env.PIPELINE_RUN_DIR).isDirectory()) {
        return { runDir: env.PIPELINE_RUN_DIR, candidates: null };
      }
    } catch { /* fall through */ }
  }
  const boundHit = ctxLib.findRunByWorktreePath(cwd, cwd);
  if (boundHit && boundHit.state && boundHit.state.status !== 'clean') {
    return { runDir: boundHit.runDir, candidates: null };
  }
  const all = ctxLib.listRunDirsWithState(cwd); // already newest-first, terminal runs excluded
  if (all.length === 0) return { runDir: null, candidates: null };
  const annotated = all.map(({ dir, state }) => ({
    dir,
    foreign: ctxLib.classifyOwnership(callerIdentity, state) === 'foreign',
  }));
  const survivors = annotated.filter((c) => !c.foreign);
  if (survivors.length === 1) return { runDir: survivors[0].dir, candidates: null };
  return { runDir: null, candidates: annotated };
}

// Shared refusal-listing renderer for the five mutating verbs' unambiguous-
// only resolution (#1012's Data / API Surface): one paste-ready `--run` line
// per non-terminal candidate, foreign ones annotated so the operator sees
// why they were excluded. `verb` is the literal subcommand name (e.g.
// 'close-run') so the printed line is directly copy-pasteable.
function renderCandidateRefusal(verb, candidates) {
  const lead = candidates.length >= 2
    ? 'claude-tweaks: multiple candidate runs — pass --run explicitly:'
    : 'claude-tweaks: the only candidate run(s) are recorded by another session/worktree — pass --run explicitly to act on one:';
  const lines = candidates.map(
    (c) => `  node "${pluginRoot()}/bin/hooks.js" ${verb} --run "${c.dir}"${c.foreign ? ' (recorded by another session/worktree)' : ''}`,
  );
  return [lead, ...lines].join('\n');
}

function resolveRunArg(args, cwd, env, resolveOpts) {
  const flagIdx = args.indexOf('--run');
  if (flagIdx === -1) {
    if (resolveOpts && resolveOpts.unambiguousOnly) {
      const { runDir, candidates } = resolveImplicitRunUnambiguous(cwd, env, resolveOpts.callerIdentity);
      return {
        runDir, invalidRunArg: null, rest: args, explicit: false, candidates,
      };
    }
    return { runDir: ctxLib.resolveRunDir(cwd, env, undefined, resolveOpts), invalidRunArg: null, rest: args, explicit: false };
  }
  const rest = args.slice();
  const rawCandidate = rest[flagIdx + 1];
  // An empty or whitespace-only value (the shape an unset $PIPELINE_RUN_DIR
  // expands to in shell) must never reach the guards/statSync/path-composition
  // below as a blank path (#1138) — reject it here, at the earliest parse
  // point, before any of that runs.
  const candidate = (rawCandidate && rawCandidate.trim() !== '') ? rawCandidate : null;
  rest.splice(flagIdx, 2);
  if (rawCandidate !== undefined && candidate === null) {
    return { runDir: null, invalidRunArg: '--run requires a value', rest, explicit: true };
  }
  // An explicit --run must resolve to a real directory — falling back to
  // resolveRunDir's "newest non-terminal run" scan on a bad path would
  // silently record against the WRONG run, defeating the reason --run
  // exists at all. Resolved once, against the `cwd` PARAMETER (not
  // process.cwd()) — every current caller happens to pass process.cwd() as
  // `cwd`, but the anchoring check below must honor the parameter it's
  // actually given, not assume the two are always the same value.
  const resolved = candidate ? path.resolve(cwd, candidate) : null;
  const isRealDir = resolved ? isDirectory(resolved) : false;
  if (isRealDir) {
    // #790/[IL-127]: a real directory is not enough — it must also resolve
    // under the main checkout, never a worktree-relative shadow copy. Mirrors
    // run-dir-resolve.js's identical adoption-time check for PIPELINE_RUN_DIR.
    const mainRoot = wtDetect.mainCheckoutRoot(cwd);
    if (!mainRoot) {
      // Distinct from the anchoring-rejection case below: mainCheckoutRoot()
      // returning null means no git repo could be determined at all (not a
      // repo, an unreadable ancestor, an unparseable .git file) — a
      // different failure than "exists, but resolves outside a KNOWN main
      // checkout". Mislabeling it as a worktree-shadow rejection would send
      // a reader hunting for the wrong problem.
      return {
        runDir: null,
        invalidRunArg: `${candidate} (${wtDetect.unanchoredRunDirNoRepoMessage(cwd)})`,
        rest,
        explicit: true,
      };
    }
    if (!wtDetect.isAnchoredUnderRoot(resolved, mainRoot)) {
      // #280/#1183: the general case above (a bare or stray worktree-local
      // directory) stays rejected — that's the [IL-96]/[IL-127] shadow this
      // anchoring check exists to prevent. The one narrow exception: a
      // session whose harness refused every write to the main checkout for
      // the whole session has no anchored copy to name at all, so its run
      // dir was legitimately initialized worktree-local as the only
      // available option (the incident #280 documents). Adopt it ONLY when
      // ALL of:
      //   (a) resolved sits inside a linked worktree of THIS SAME repo — not
      //       an arbitrary directory, and not an unrelated repo's checkout
      //       (#1183: the old check never verified this at all — any
      //       directory carrying a stray marker file was adopted);
      //   (b) that path, relative to the worktree's own
      //       .claude-tweaks/pipelines/, has a run-id-shaped leading segment
      //       (the same `RUN_ID_RE` shape context.js's own run-dir
      //       enumeration, iterRunDirsWithState, uses to distinguish a real
      //       pipeline run dir from an arbitrary directory);
      //   (c) it is already an INITIALIZED run dir — not merely a directory
      //       that exists, the same bar isInitializedRunDir states; and
      //   (d) no same-named run dir already exists at the SAME
      //       pipelines-relative path under the main checkout, which would
      //       make that copy the authoritative one instead — and, for an
      //       archive/{id} shadow specifically, no LIVE (non-archived) run
      //       dir exists under that same id either, since a run can be live
      //       under one id while a worktree-local session independently
      //       archived its own local copy under the same id (#1183 fix-wave);
      //       the mirror also holds for a LIVE-shape shadow: no ARCHIVED run
      //       dir exists under that same id at the main checkout either (#1299).
      // #1183: (d) used to join only path.basename(resolved), so a nested
      // multi-spec shadow (pipelines/{parent}/spec-N) or an archived shadow
      // (pipelines/archive/{id}) computed the wrong main-checkout candidate
      // (pipelines/spec-N, pipelines/{id} — neither ever exists) and was
      // adopted even though the anchored copy existed at the correct
      // nested/archived path. Comparing the full pipelines-relative path
      // fixes both shapes without special-casing either — an archive/{id}
      // shadow's run-id segment is relParts[1] (the archived run keeps its
      // original run-id-shaped directory name one level deeper); every
      // other shape's run-id segment is relParts[0].
      const candidateRepo = wtDetect.repoInfo(resolved);
      // #1183 fix-wave: repoInfo's repoRoot is realpath'd internally (safeReal),
      // but `resolved` above is not — a symlinked path component (macOS /tmp is
      // the common case) then makes the relative-path comparison below compare
      // a canonical root against a lexical path, producing a spurious `..`
      // prefix and wrongly rejecting a legitimate candidate. Realpath resolved
      // here too, mirroring pre-tool-use.js's shadowPipelineRunDir
      // (`const real = realTarget(resolved) || resolved;`). Only used for this
      // comparison — `runDir` below still returns the unresolved `resolved`,
      // matching isAnchoredUnderRoot(resolved, mainRoot) above.
      const realResolved = wtDetect.safeReal(resolved) || resolved;
      const sameRepo = !candidateRepo.indeterminate && candidateRepo.repoRoot && candidateRepo.isLinkedWorktree
        && wtDetect.mainCheckoutRoot(candidateRepo.repoRoot) === mainRoot;
      const {
        relFromPipelines, inPipelines, isArchiveShape, runIdSegment, runIdShaped,
      } = sameRepo
        ? pipelinesRunIdShape(candidateRepo.repoRoot, realResolved)
        : {
          relFromPipelines: null, inPipelines: false, isArchiveShape: false, runIdSegment: null, runIdShaped: false,
        };
      const mainCandidate = inPipelines ? path.join(mainRoot, '.claude-tweaks', 'pipelines', relFromPipelines) : null;
      // #1183 fix-wave: an archive/{id} shadow must also be checked against a LIVE
      // (non-archived) copy of the same run-id under the main checkout — a run can be
      // live under one id while a worktree-local session independently archived its own
      // local copy under the same id; checking only the archive/{id} path would miss that.
      const mainLiveCandidate = (inPipelines && isArchiveShape && runIdSegment)
        ? path.join(mainRoot, '.claude-tweaks', 'pipelines', runIdSegment)
        : null;
      // #1299: the mirror direction — a LIVE-shape shadow (relParts[0] !==
      // 'archive') must also be checked against an ARCHIVED copy of the same
      // run-id under the main checkout. A run can be archived under one id at
      // the main checkout while a worktree-local session independently kept
      // (or re-created) a live copy under the same id; checking only the
      // live/live path (mainCandidate) would miss that, mirroring the exact
      // gap #1183 closed for the opposite (archive-shape) direction above.
      const mainArchivedCandidate = (inPipelines && !isArchiveShape && runIdSegment)
        ? path.join(mainRoot, '.claude-tweaks', 'pipelines', 'archive', runIdSegment)
        : null;
      // isDirectory/isLiveArchiveTwin already fail closed (try/catch) on a
      // null path, so no separate truthiness guard is needed for
      // mainLiveCandidate/mainArchivedCandidate — mirrors how mainCandidate
      // above is passed through unguarded. mainArchivedCandidate uses the
      // staleness-aware check (see isLiveArchiveTwin above, #1452) — the
      // other two are never where archiveRunDir writes its 'archiving' claim
      // stub, so a plain existence check is correct for them.
      const twinExists = isDirectory(mainCandidate) || isDirectory(mainLiveCandidate)
        || isLiveArchiveTwin(mainArchivedCandidate);
      // `inPipelines` is provably implied by `runIdShaped` here (relParts, and so
      // runIdSegment, is only ever populated when inPipelines is true) — kept explicit
      // anyway as a self-documenting invariant a future edit to relParts/runIdSegment's
      // derivation could otherwise silently break without either variable's own name
      // signaling that it depends on the other.
      if (sameRepo && inPipelines && runIdShaped && isInitializedRunDir(resolved) && !twinExists) {
        return {
          runDir: resolved, invalidRunArg: null, rest, explicit: true, worktreeLocalFallback: true,
        };
      }
      return {
        runDir: null,
        invalidRunArg: `${candidate} (exists, but not anchored under the main checkout at ${mainRoot} — refusing a worktree-relative shadow run dir; see resolve-run-dir)`,
        rest,
        explicit: true,
      };
    }
    // #1566 whole-branch-review follow-up: every real run dir lives under
    // .claude-tweaks/pipelines/ by construction, so this shape bar applies
    // unconditionally — not just inside the allowUninitialized branch below.
    // Without it, an anchored-but-arbitrary directory elsewhere under the
    // main checkout that happened to carry a file literally named
    // decisions.md/run-state.json/config.yml would satisfy isInitializedRunDir
    // and sail straight through to the `return` below untouched, reopening a
    // narrower variant of the exact vulnerability the isInitializedRunDir
    // gate exists to close. mainRoot is realpath'd (mainCheckoutRoot's own
    // safeReal), `resolved` is not — realpath it for this comparison only,
    // mirroring the #1183 fix-wave's identical treatment of realResolved
    // above, or a symlinked path component (macOS /tmp, most test sandboxes)
    // produces a spurious `..` prefix and wrongly rejects a legitimate run dir.
    const shape = pipelinesRunIdShape(mainRoot, wtDetect.safeReal(resolved) || resolved);
    if (!shape.inPipelines || !shape.runIdShaped) {
      return {
        runDir: null,
        invalidRunArg: `${candidate} (exists under the main checkout, but is not a run-id-shaped directory under .claude-tweaks/pipelines/ — refusing to treat an arbitrary anchored directory as a run dir; see resolve-run-dir)`,
        rest,
        explicit: true,
      };
    }
    // isInitializedRunDir is the same bar #280's fallback branch above
    // already applies to its own narrower case. Unlike that branch,
    // record-worktree's fresh-mint pattern (dispatch's mkdir-only mint,
    // adopted with no config.yml by flow's case 2) means an uninitialized
    // target is sometimes legitimate here — resolveOpts.allowUninitialized
    // is the caller's explicit opt-in for that (see this function's header).
    // The pipelines-shape check above already confirmed this is a
    // run-id-shaped directory, not an arbitrary anchored one (#1566's bare
    // `--run .` repro), so allowUninitialized only ever licenses a genuine
    // fresh-mint pipeline run dir.
    if (!isInitializedRunDir(resolved) && !(resolveOpts && resolveOpts.allowUninitialized)) {
      return {
        runDir: null,
        invalidRunArg: `${candidate} (exists under the main checkout, but is not an initialized run dir — carries none of decisions.md/run-state.json/config.yml; see resolve-run-dir)`,
        rest,
        explicit: true,
      };
    }
    return { runDir: resolved, invalidRunArg: null, rest, explicit: true };
  }
  return { runDir: null, invalidRunArg: candidate || '(missing value)', rest, explicit: true };
}

// #280: prints the worktree-local-fallback disclosure resolveRunArg's
// `worktreeLocalFallback` flag calls for — shared by every call site so a
// future one can't silently omit it the way six of the seven did before this
// fix (review finding: the disclosure was wired only at record-worktree).
function reportWorktreeLocalFallback(runDir, worktreeLocalFallback) {
  if (!worktreeLocalFallback) return;
  process.stdout.write(`claude-tweaks: --run ${runDir} resolved via the worktree-local fallback (#280) — no anchored copy exists under the main checkout; this run's state lives only in this worktree until merge.\n`);
}

// #2409: copies exactly `decisions.md`, `report.md` (each if present), and
// `staged/` (recursively, if present and non-empty) from `runDir` into
// `destDir` — nothing else, and never fabricated: whatever is on disk at
// `runDir` is copied byte-for-byte. Returns the list of names actually
// copied, in this fixed order, for adopt-run-dir's one-line-per-file
// confirmation. `destDir` is only ever created (mkdirSync recursive) when
// there is at least one file to place in it — an empty destination tree is
// never created pointlessly (mirrors bin/stage-item.js's own "nothing to
// do" posture).
function copyRunDirAuditFiles(runDir, destDir) {
  const copied = [];
  let destReady = false;
  const ensureDest = () => {
    if (!destReady) { fs.mkdirSync(destDir, { recursive: true }); destReady = true; }
  };
  const decisionsSrc = path.join(runDir, 'decisions.md');
  if (fs.existsSync(decisionsSrc)) {
    ensureDest();
    fs.copyFileSync(decisionsSrc, path.join(destDir, 'decisions.md'));
    copied.push('decisions.md');
  }
  const reportSrc = path.join(runDir, 'report.md');
  if (fs.existsSync(reportSrc)) {
    ensureDest();
    fs.copyFileSync(reportSrc, path.join(destDir, 'report.md'));
    copied.push('report.md');
  }
  const stagedSrc = path.join(runDir, 'staged');
  if (fs.existsSync(stagedSrc) && fs.readdirSync(stagedSrc).length > 0) {
    ensureDest();
    fs.cpSync(stagedSrc, path.join(destDir, 'staged'), { recursive: true });
    copied.push('staged/');
  }
  return copied;
}

async function main(argv) {
  const cmd = argv[2];
  // #1143: dumb, verb-agnostic --help/-h intercept — ahead of every branch
  // below, before any lib call or resolveRunArg scan. Every subcommand here
  // (other than record-worktree, hardened separately by #1124) previously
  // fell through to its normal dispatch on a stray --help, and several of
  // those paths implicitly guess a target run dir (resolveRunDir's "newest
  // non-terminal run") when --run is absent — the exact cross-session
  // corruption hazard observed 2026-08-20 (see the now-removed docs/donts.md
  // bridging rule). Checked against the USAGE table, not a hardcoded verb
  // list, so a verb with no usage entry gets no guard by design.
  // #1012: for the five mutating verbs, ANY undeclared --* argument (--help
  // included — it is never declared) intercepts here, before resolveRunArg
  // or any lib call ever runs. Every other USAGE-table verb keeps the
  // narrower HELP_FLAGS-only guard unchanged.
  if (KNOWN_FLAGS[cmd]) {
    // -h is a single-dash short flag, so firstUnknownFlag's `--`-prefixed
    // scan never sees it as a token to classify — checked separately here,
    // same as --help itself (also never declared for any of these five
    // verbs, so it always falls out as "unknown" via the scan below too).
    const argsAfterCmd = argv.slice(3);
    if (argsAfterCmd.includes('-h') || firstUnknownFlag(KNOWN_FLAGS[cmd], argsAfterCmd)) {
      process.stdout.write(`claude-tweaks: usage: ${USAGE[cmd]}\n`);
      return 0;
    }
  } else if (USAGE[cmd] && argv.slice(3).some((a) => HELP_FLAGS.has(a))) {
    process.stdout.write(`claude-tweaks: usage: ${USAGE[cmd]}\n`);
    return 0;
  }
  if (cmd === 'record-worktree') {
    // --run <path> pins the target run dir explicitly, mirroring close-run
    // below — without it, this always fell through to resolveRunDir's
    // "newest non-terminal run" fallback, which a stale never-closed run
    // could win over the run genuinely making this call.
    const {
      runDir, invalidRunArg, rest, worktreeLocalFallback, explicit,
    } = resolveRunArg(argv.slice(3), process.cwd(), process.env, { allowUninitialized: true });
    const worktreeArg = rest[0];
    // #1124: every real caller already passes --run explicitly (build's
    // worktree-setup.md Step 4.5, the run-resume-freshness re-stamp, the
    // subagent-output-contract re-stamp) — nothing legitimate depends on the
    // implicit fallback below. An invocation that omits --run previously fell
    // through to resolveRunDir's "newest non-terminal run" GUESS and could
    // silently clobber a DIFFERENT live session's run-state.json (reproduced
    // 3x independently on 2026-08-20, across three different dispatched
    // subagents). Never guess here: refuse loudly, before this handler ever
    // gets a chance to WRITE anything — a true no-op, non-zero exit. (A bare
    // or malformed `--help` no longer reaches this branch at all — #1143's
    // dedicated guard above intercepts it first, before `resolveRunArg` ever
    // runs. `resolveRunArg` itself still runs unconditionally on every other
    // no-`--run` path below, and still calls `ctxLib.resolveRunDir` — a real
    // scan of sibling run-state.json files — whose result this branch simply
    // discards; the guarantee here is "no write," not "no read.")
    if (!explicit) {
      process.stdout.write('claude-tweaks: record-worktree requires --run — worktree not recorded\n');
      return 1;
    }
    reportWorktreeLocalFallback(runDir, worktreeLocalFallback);
    if (invalidRunArg) {
      process.stdout.write(`claude-tweaks: --run path rejected: ${invalidRunArg} — worktree not recorded\n`);
    } else if (worktreeArg && worktreeArg.startsWith('-')) {
      // An unrecognized flag landing in the worktree-path position must
      // never be treated as a literal path — this is the exact shape every
      // observed incident hit (a stray --help specifically no longer reaches
      // this far — #1143's dedicated guard above intercepts it first).
      process.stdout.write(`claude-tweaks: unrecognized argument ${worktreeArg} — worktree not recorded\n`);
      return 1;
    } else if (runDir && worktreeArg) {
      // Stamp the owning session so E1 can scope enforcement to it. Absent env
      // var: omit the key rather than write null — an env-less re-record must
      // not clobber a previous stamp.
      const patch = { worktree: path.resolve(worktreeArg), status: 'active' };
      if (process.env.CLAUDE_CODE_SESSION_ID) patch.sessionId = process.env.CLAUDE_CODE_SESSION_ID;
      const result = ctxLib.writeRunState(runDir, patch);
      if (result) {
        process.stdout.write(`claude-tweaks: worktree recorded for ${path.basename(runDir)}\n`);
      } else {
        process.stdout.write(`claude-tweaks: failed to record worktree for ${path.basename(runDir)} — run-state.json could not be written\n`);
      }
    } else {
      // runDir resolved but worktreeArg is falsy — the only remaining case
      // in this chain (with --run now required above, invalidRunArg is
      // falsy here only when runDir already resolved to a real directory —
      // see resolveRunArg: runDir is null iff invalidRunArg is truthy).
      // Without this branch, a call that omits the worktree positional
      // (e.g. "record-worktree --run <dir>" with nothing after)
      // printed nothing and exited 0, indistinguishable from success.
      process.stdout.write(`claude-tweaks: no worktree path given for ${path.basename(runDir)} — worktree not recorded\n`);
    }
    return 0;
  }
  if (cmd === 'resolve-run-dir') {
    // #692: the tool _shared/pipeline-run-dir.md's Anchoring section points
    // callers at, so a skill step gets the anchored $RUN_ROOT/run directory
    // as one command instead of composing `git rev-parse --git-common-dir`
    // inline — the composition that produced the worktree-local shadow
    // ([IL-127]) this command exists to stop happening again. Unlike every
    // other subcommand in this dispatcher, this one has a genuine non-zero
    // exit code: it is invoked directly from skill prose (never as a hook
    // event), and a skill step needs a real signal to branch on when nothing
    // resolves or an inherited PIPELINE_RUN_DIR turns out to be a shadow.
    const args = argv.slice(3);
    let result;
    try {
      result = require('./lib/hooks/run-dir-resolve').resolve({
        cwd: process.cwd(),
        env: process.env,
        specSlug: flagVal(args, '--spec-slug'),
        mode: flagVal(args, '--mode'),
        standalone: flagVal(args, '--standalone'),
        create: args.includes('--create'),
        rootOnly: args.includes('--root-only'),
      });
    } catch (e) {
      process.stderr.write(`claude-tweaks: resolve-run-dir: unexpected error — ${e && e.message ? e.message : e}\n`);
      return 1;
    }
    if (result.ok) {
      process.stdout.write(result.path + '\n');
      return 0;
    }
    process.stderr.write(`claude-tweaks: resolve-run-dir: ${result.message}\n`);
    return 1;
  }
  if (cmd === 'sweep-shadow') {
    // Promotes curation-engine.md §4's post-fan-out shadow sweep from an
    // inline bash snippet to this verb (#738). --run/--worktree are the raw
    // PIPELINE_RUN_DIR/WORKTREE values as a judge dispatch would set them —
    // sweepShadow() itself does the `pwd -P`-style normalization and the
    // anchoring/same-path checks, so unlike record-worktree/record-pr/
    // close-run this does NOT go through resolveRunArg: --worktree is
    // legitimately a linked worktree, which resolveRunArg's anchoring check
    // would reject outright, and --run's own "is it under the main
    // checkout" question is exactly the sweep's own diagnostic, not a
    // separate gate ahead of it.
    const args = argv.slice(3);
    const runArg = flagVal(args, '--run');
    const worktreeArg = flagVal(args, '--worktree');
    const mainRoot = wtDetect.mainCheckoutRoot(process.cwd());
    if (!mainRoot) {
      process.stdout.write(`sweep: ${wtDetect.unanchoredRunDirNoRepoMessage(process.cwd())} — not swept\n`);
      return 1;
    }
    const { sweepShadow } = require('./lib/hooks/sweep-shadow');
    const result = sweepShadow({
      runRoot: mainRoot,
      pipelineRunDir: runArg ? path.resolve(process.cwd(), runArg) : runArg,
      worktree: worktreeArg ? path.resolve(process.cwd(), worktreeArg) : worktreeArg,
    });
    for (const line of result.lines) process.stdout.write(line + '\n');
    return result.diagnostic ? 1 : 0;
  }
  if (cmd === 'adopt-run-dir') {
    // #2409: copies a run dir's decisions.md/report.md/staged/** from the
    // main checkout into a worktree's own copy of that path — the
    // sanctioned procedure tidy/step-7-5-worktree-always.md's
    // copy-then-commit paragraph documents (mirroring work/{n}-spec.md's
    // exception, _shared/pipeline-run-dir.md's Anchoring section). Exists
    // because checkPipelineShadowGuard (the PreToolUse guard refusing to
    // CREATE a new top-level pipeline run dir inside a linked worktree)
    // pattern-matches literal mkdir/cp/redirect shell syntax in a Bash
    // command's text — a plain Node CLI whose own invocation carries none
    // of those tokens sidesteps that guard the same way bin/log-decision.js/
    // bin/stage-item.js/bin/set-config.js already do, without special-
    // casing this procedure inside the guard itself. Unlike those three
    // (anchored --run only), this verb also validates --worktree is a real
    // linked worktree of THIS repo (worktree-detect.js's repoInfo(),
    // _shared/worktree-setup.md's "Adopt-or-create" section), which is why
    // it lives here as a hooks.js subcommand rather than a fourth
    // standalone sibling CLI (docs/hooks.md's "state genuinely coupled to
    // hook enforcement itself" carve-out).
    //
    // Exit codes mirror bin/log-decision.js's scheme (2 malformed
    // invocation, 3 run dir/worktree invalid), not the six EVENTS' own
    // always-exit-0 invariant: like resolve-run-dir above, this verb is
    // invoked directly from skill prose, never as a harness-dispatched hook
    // event, so a real, meaningful non-zero exit is safe here.
    const args = argv.slice(3);
    const runArg = flagVal(args, '--run');
    const worktreeArg = flagVal(args, '--worktree');
    if (!runArg || !worktreeArg) {
      process.stderr.write(`claude-tweaks: usage: ${USAGE['adopt-run-dir']}\n`);
      return 2;
    }
    let target;
    try {
      // mainRoot: null deliberately bypasses resolveTarget's own cwd-derived
      // domain match (it would otherwise anchor against process.cwd()'s repo,
      // which is not necessarily either side of the --worktree/--run pairing
      // this verb actually compares) while still enforcing its structural
      // check: a `.git` FILE ancestor (a linked worktree/submodule) is always
      // refused, never adopted as if it were the main checkout.
      target = require('./lib/log-decision/append').resolveTarget({ runDir: runArg, cwd: process.cwd(), mainRoot: null });
    } catch (err) {
      process.stderr.write(`claude-tweaks: adopt-run-dir: ${err && err.message}\n`);
      return 3;
    }
    if (!target.ok) {
      if (target.reason === 'missing') {
        process.stderr.write(`claude-tweaks: adopt-run-dir: run dir does not exist: ${runArg}\n`);
      } else {
        process.stderr.write(`claude-tweaks: adopt-run-dir: run dir is not anchored under the main checkout (a worktree-local shadow): ${runArg} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
      }
      return 3;
    }
    const runDir = path.dirname(target.file);
    // Derived from the run dir itself, not process.cwd(): "this repo" for the
    // --worktree domain-match below must be the run dir's own repo, so a
    // caller invoked from an unrelated cwd (or from a foreign worktree) still
    // gets a correct verdict rather than one that accidentally reflects cwd's
    // repo instead. Guaranteed non-null: target.ok above already proved the
    // nearest .git ancestor of runDir is a DIRECTORY (not a worktree/submodule
    // file pointer), and mainCheckoutRoot's walk-up hits that exact same
    // directory first.
    const mainRoot = wtDetect.mainCheckoutRoot(runDir);
    const resolvedWorktree = path.resolve(process.cwd(), worktreeArg);
    if (!isDirectory(resolvedWorktree)) {
      process.stderr.write(`claude-tweaks: adopt-run-dir: --worktree does not exist or is not a directory: ${worktreeArg}\n`);
      return 3;
    }
    const info = wtDetect.repoInfo(resolvedWorktree);
    if (info.indeterminate || !info.isLinkedWorktree || wtDetect.mainCheckoutRoot(resolvedWorktree) !== mainRoot) {
      process.stderr.write(`claude-tweaks: adopt-run-dir: --worktree ${worktreeArg} is not a linked git worktree of this repo\n`);
      return 3;
    }
    const destDir = path.join(resolvedWorktree, '.claude-tweaks', 'pipelines', path.basename(runDir));
    const copied = copyRunDirAuditFiles(runDir, destDir);
    if (copied.length === 0) {
      process.stdout.write(`claude-tweaks: adopt-run-dir: nothing to copy for ${path.basename(runDir)} (no decisions.md, report.md, or staged/ present)\n`);
      return 0;
    }
    for (const name of copied) process.stdout.write(`copied: ${name}\n`);
    return 0;
  }
  if (cmd === 'record-pr') {
    // Mirrors record-worktree's shape: --run <path> pins the target run dir
    // explicitly (falls back to #1012's unambiguous-only resolution when
    // absent), positional args after it are the PR number and URL.
    // run-state.json is written only through hooks.js verbs (CLAUDE.md's
    // write-ownership rule) — this is the sanctioned verb for the pr-early
    // run lifecycle's { number, url } field (#409).
    const callerIdentity = { sessionId: process.env.CLAUDE_CODE_SESSION_ID, cwd: process.cwd() };
    const {
      runDir, invalidRunArg, rest, worktreeLocalFallback, explicit, candidates,
    } = resolveRunArg(argv.slice(3), process.cwd(), process.env, { unambiguousOnly: true, callerIdentity });
    reportWorktreeLocalFallback(runDir, worktreeLocalFallback);
    const numberArg = rest[0];
    const urlArg = rest[1];
    const number = Number(numberArg);
    // #1012: an implicit resolution (no --run) whose resolved run still
    // classifies 'foreign' (only reachable via the env-var arm — steps 2/3
    // already exclude foreign candidates by construction) refuses the write.
    // Explicit --run always bypasses this, same as close-run's advisory.
    const implicitForeign = !explicit && runDir
      && ctxLib.classifyOwnership(callerIdentity, ctxLib.readRunState(runDir)) === 'foreign';
    if (invalidRunArg) {
      process.stdout.write(`claude-tweaks: --run path rejected: ${invalidRunArg} — PR not recorded\n`);
    } else if (candidates) {
      process.stdout.write(`${renderCandidateRefusal('record-pr', candidates)}\nPR not recorded.\n`);
    } else if (!runDir) {
      process.stdout.write('claude-tweaks: no pipeline run dir found — PR not recorded\n');
    } else if (implicitForeign) {
      process.stdout.write(`claude-tweaks: run ${path.basename(runDir)} was recorded by another session/worktree — refusing to record a PR against it without an explicit --run\n`);
    } else if (!numberArg || !Number.isInteger(number) || number <= 0 || !urlArg) {
      process.stdout.write(`claude-tweaks: usage: ${USAGE['record-pr']} — PR not recorded\n`);
    } else {
      // Record the branch alongside the PR while the worktree is still live —
      // this is the one moment it is reliably knowable. run-integrity.js's
      // torn-down-worktree fallback (#1672) reads it back later, when
      // `git worktree list` no longer has an entry to derive it from.
      // Best-effort: a run with no recorded worktree, or a derivation that
      // comes back null, simply records {number, url} as before.
      // Guarded because this is the first external-process call in a verb that
      // previously had none: main()'s own `.catch(() => process.exit(0))` would
      // swallow a throw here and skip writeRunState entirely, exiting 0 with no
      // output — the PR silently never recorded, while every other failure
      // branch in this verb prints a "not recorded" notice. Degrading to the
      // pre-#1672 {number, url} write is the correct best-effort outcome.
      let prBranch = null;
      try {
        prBranch = deriveBranch(repoRootOf(runDir), ctxLib.readRunState(runDir)?.worktree || null);
      } catch { prBranch = null; }
      const prField = prBranch ? { number, url: urlArg, branch: prBranch } : { number, url: urlArg };
      const result = ctxLib.writeRunState(runDir, { pr: prField });
      if (result) {
        process.stdout.write(`claude-tweaks: PR #${number} recorded for ${path.basename(runDir)}\n`);
      } else {
        process.stdout.write(`claude-tweaks: failed to record PR for ${path.basename(runDir)} — run-state.json could not be written\n`);
      }
    }
    return 0;
  }
  if (cmd === 'spec-status') {
    // Couples a multi-spec manifest.yml status transition to the
    // `## Flow: Running ...` progress banner (#690) — one call does both,
    // so a phase transition can't happen without the banner (and vice
    // versa). --run mirrors record-worktree/record-pr's shape: it names
    // the multi-spec PARENT run dir (where manifest.yml lives — see
    // multi-spec.md's "Run directory layout"), never a per-spec
    // PIPELINE_RUN_DIR subdirectory.
    const callerIdentity = { sessionId: process.env.CLAUDE_CODE_SESSION_ID, cwd: process.cwd() };
    const {
      runDir, invalidRunArg, rest, worktreeLocalFallback, explicit, candidates,
    } = resolveRunArg(argv.slice(3), process.cwd(), process.env, { unambiguousOnly: true, callerIdentity });
    reportWorktreeLocalFallback(runDir, worktreeLocalFallback);
    const specArg = flagVal(rest, '--spec');
    const statusArg = flagVal(rest, '--status');
    const phaseArg = flagVal(rest, '--phase');
    const nowArg = flagVal(rest, '--now'); // test-only clock override; real callers omit it
    // #1012: see record-pr's identical guard above.
    const implicitForeign = !explicit && runDir
      && ctxLib.classifyOwnership(callerIdentity, ctxLib.readRunState(runDir)) === 'foreign';
    if (invalidRunArg) {
      process.stdout.write(`claude-tweaks: --run path rejected: ${invalidRunArg} — spec status not recorded\n`);
    } else if (candidates) {
      process.stdout.write(`${renderCandidateRefusal('spec-status', candidates)}\nSpec status not recorded.\n`);
    } else if (!runDir) {
      process.stdout.write('claude-tweaks: no pipeline run dir found — spec status not recorded\n');
    } else if (implicitForeign) {
      process.stdout.write(`claude-tweaks: run ${path.basename(runDir)} was recorded by another session/worktree — refusing to record spec status against it without an explicit --run\n`);
    } else if (!specArg || !statusArg || !phaseArg) {
      process.stdout.write(`claude-tweaks: usage: ${USAGE['spec-status']} — spec status not recorded\n`);
    } else {
      const result = specStatusLib.transitionSpec({
        runDir, specId: specArg, status: statusArg, phase: phaseArg,
        now: nowArg ? new Date(nowArg) : new Date(),
      });
      if (!result.ok) {
        process.stdout.write(`claude-tweaks: spec status not recorded for spec #${specArg} (${result.reason}) — no manifest.yml at ${path.basename(runDir)}, or spec/status/phase invalid\n`);
      } else {
        process.stdout.write(result.banner + '\n');
        if (result.summaryLine) process.stdout.write(result.summaryLine + '\n');
      }
    }
    return 0;
  }
  if (cmd === 'close-run') {
    // #1012: unambiguousOnly replaces the old includeWorktreeForeign
    // opt-out — that existed only so a bare close-run could still FIND a
    // worktree-foreign run in order to report it via closeRunState's own
    // foreignOwner advisory. The new resolution already reports exactly
    // that: when the only candidate is foreign, it refuses and lists it
    // (annotated) rather than silently resolving into it.
    const callerIdentity = { sessionId: process.env.CLAUDE_CODE_SESSION_ID, cwd: process.cwd() };
    const {
      runDir, invalidRunArg, explicit, worktreeLocalFallback, candidates,
    } = resolveRunArg(argv.slice(3), process.cwd(), process.env, { unambiguousOnly: true, callerIdentity });
    reportWorktreeLocalFallback(runDir, worktreeLocalFallback);
    if (invalidRunArg) {
      process.stdout.write(`claude-tweaks: --run path rejected: ${invalidRunArg} — run not closed\n`);
    } else if (candidates) {
      process.stdout.write(`${renderCandidateRefusal('close-run', candidates)}\nRun not closed.\n`);
    } else if (runDir) {
      const r = closeRunState(runDir, { explicit, callerIdentity });
      if (r.status === 'refused-foreign') {
        process.stdout.write(`claude-tweaks: run ${path.basename(runDir)} was recorded by another session — refusing to close it without an explicit --run\n`);
        return 0;
      }
      if (r.status === 'refused-live-worktree') {
        process.stdout.write(`claude-tweaks: run ${path.basename(runDir)} still has a live worktree on disk — refusing to close it without an explicit --run\n`);
        return 0;
      }
      if (r.foreignOwner) {
        process.stdout.write(`claude-tweaks: closing run ${path.basename(runDir)} recorded by another session\n`);
      }
      if (!r.wrapupSeen) {
        process.stdout.write(
          `claude-tweaks: closing run ${path.basename(runDir)} with no recorded wrap-up invocation — ` +
          'expected if wrap-up was run manually (typed slash commands leave no ledger event); ' +
          'otherwise consider /claude-tweaks:wrap-up before closing. Event recorded: close-without-wrapup.\n',
        );
      }
      if (r.notYetArchived) {
        process.stdout.write(
          `claude-tweaks: run ${path.basename(runDir)} still holds un-archived work/ content — ` +
          'expected at this point in the normal wrap-up sequence (close-run always runs before archive-run); ' +
          'archival is still pending and will happen via the next routine reconcile pass, or you can archive it now: ' +
          `node "${pluginRoot()}/bin/hooks.js" archive-run --run "${runDir}"\n`,
        );
      }
      if (!r.writeOk) {
        process.stdout.write(`claude-tweaks: failed to close run ${path.basename(runDir)} — run-state.json could not be written\n`);
      }
    } else {
      // No --run was given (or it resolved to nothing) and resolveRunDir's
      // fallback also found no run dir — the only remaining case in this
      // chain. Without this branch, a call that can't resolve any run dir
      // printed nothing and exited 0, indistinguishable from success.
      process.stdout.write('claude-tweaks: no pipeline run dir found — run not closed\n');
    }
    return 0;
  }
  if (cmd === 'teardown-run') {
    const callerIdentity = { sessionId: process.env.CLAUDE_CODE_SESSION_ID, cwd: process.cwd() };
    const { runDir, invalidRunArg, worktreeLocalFallback, candidates } = resolveRunArg(
      argv.slice(3), process.cwd(), process.env, { unambiguousOnly: true, callerIdentity },
    );
    reportWorktreeLocalFallback(runDir, worktreeLocalFallback);
    const mode = argv.includes('--merged') ? 'merged' : (argv.includes('--abandoned') ? 'abandoned' : null);
    if (invalidRunArg) {
      process.stdout.write(`claude-tweaks: --run path rejected: ${invalidRunArg} — run not torn down\n`);
    } else if (candidates) {
      process.stdout.write(`${renderCandidateRefusal('teardown-run', candidates)}\nRun not torn down.\n`);
    } else if (runDir) {
      const result = teardownRun(runDir, { mode, sessionId: process.env.CLAUDE_CODE_SESSION_ID, cwd: process.cwd() });
      process.stdout.write(`claude-tweaks: teardown-run ${path.basename(runDir)}\n${result.lines.map((l) => `  ${l}`).join('\n')}\n`);
    } else {
      process.stdout.write('claude-tweaks: no pipeline run dir found — run not torn down\n');
    }
    return 0;
  }
  if (cmd === 'archive-run') {
    const { archiveRunDir, readConsoleState, listSpecDirs } = require('./lib/reconcile/archive-merged');
    const { NON_TERMINAL } = require('./lib/hooks/run-integrity');
    const { runDir, invalidRunArg, worktreeLocalFallback } = resolveRunArg(
      argv.slice(3), process.cwd(), process.env, { allowUninitialized: true },
    );
    reportWorktreeLocalFallback(runDir, worktreeLocalFallback);
    if (invalidRunArg) {
      process.stdout.write(`claude-tweaks: --run path rejected: ${invalidRunArg} — run not archived\n`);
      return 0;
    }
    if (!runDir) {
      process.stdout.write('claude-tweaks: no pipeline run dir found — run not archived\n');
      return 0;
    }
    const state = ctxLib.readRunState(runDir);
    if (!state) {
      process.stdout.write(
        `claude-tweaks: ${path.basename(runDir)} has no readable run-state.json — not archived; ` +
        'a state-less dir is reconcile\'s orphaned-mint sweep\'s job (archiveOrphanedMint, or archiveRunDir when it still holds tracked content — #2227), not this verb\'s\n',
      );
      return 0;
    }
    if (NON_TERMINAL.has(state.status)) {
      process.stdout.write(
        `claude-tweaks: ${path.basename(runDir)} is ${state.status} — not archived; ` +
        'run close-run first (or let the owning session finish)\n',
      );
      return 0;
    }
    // #1130 AC4: same console gate decideArchive enforces on the reconcile
    // path. 'none' stays allowed here — terminal status means close-run ran,
    // i.e. wrap-up's own flow (incl. the empty-console fast path) completed;
    // only a rendered-but-unanswered console blocks a direct archival.
    if (readConsoleState(runDir) === 'unresolved') {
      process.stdout.write('claude-tweaks: archival refused — console-unresolved (console.json rendered but not resolved; answer or resolve the console first)\n');
      return 0;
    }
    const mainRoot = wtDetect.mainCheckoutRoot(process.cwd());
    if (!mainRoot) {
      process.stdout.write('claude-tweaks: could not resolve the main checkout root — run not archived\n');
      return 0;
    }
    // #1452: a worktree-local-fallback resolved runDir has no anchored copy
    // under mainRoot (reportWorktreeLocalFallback's own message says so).
    // archiveRunDir's work/ move is a `git -C mainRoot mv <src> <dest>` —
    // src pointing at a path inside a *different* worktree's working tree is
    // structurally invisible to that git invocation (separate index, separate
    // working directory, same object store), so the mv deterministically
    // fails every time work/ is git-tracked (materialize.md: always, for any
    // real pipeline run). Detecting that in advance and refusing here with a
    // distinct, correctly-scoped message avoids running (and reporting) a
    // doomed git mv as if it were a genuine, actionable 'git-mv-failed' —
    // the transient condition self-resolves once this run's branch merges
    // and the content becomes reachable from mainRoot's own working tree.
    if (worktreeLocalFallback) {
      const hasTrackedWork = fs.existsSync(path.join(runDir, 'work'))
        || listSpecDirs(runDir).some((spec) => fs.existsSync(path.join(runDir, spec, 'work')));
      if (hasTrackedWork) {
        process.stdout.write(
          `claude-tweaks: archival deferred — ${path.basename(runDir)}'s tracked work/ content lives only in ` +
          'this worktree, not yet reachable from the main checkout; `git mv` cannot move it across worktree ' +
          'boundaries. Merge this run\'s branch first — reconcile\'s routine sweep (or a direct archive-run from ' +
          'the main checkout, once merged) will archive it automatically.\n',
        );
        return 0;
      }
    }
    // Output below is informational human text, never parsed by any caller
    // (skills/flow/multispec-review-console.md's parent-dir archival is a
    // future caller of this verb, not a consumer of this stdout format).
    // The "moved:" lines are read from archiveRunDir's own movedEntries
    // return value — never a hardcoded guess at the run dir's shape, which
    // is the exact fixed-list drift this whole record eliminates.
    const result = archiveRunDir(mainRoot, runDir);
    if (!result.ok) {
      // #1982: every refusal reason carries its own recovery `hint`
      // (co-located with the detector in archive-merged.js's `refusal()`
      // constructor) — this branch is now a generic reader of `reason`/
      // `hint`, never a string match against a specific reason code.
      const hintSuffix = typeof result.hint === 'string' && result.hint.length ? ` — ${result.hint}` : '';
      process.stdout.write(`claude-tweaks: archival refused — ${result.reason}${hintSuffix}\n`);
      return 0;
    }
    for (const name of result.movedEntries) {
      process.stdout.write(`moved: ${name}\n`);
    }
    process.stdout.write(`claude-tweaks: archived ${path.basename(runDir)}\n`);
    return 0;
  }
  if (cmd === 'resolve-console') {
    // #2568: --run is required, no implicit "newest non-terminal run"
    // fallback — same discipline record-worktree already enforces (a
    // guessed run dir here could resolve/execute a DIFFERENT console than
    // the one the calling session actually answered).
    const {
      runDir, invalidRunArg, worktreeLocalFallback, explicit,
    } = resolveRunArg(argv.slice(3), process.cwd(), process.env);
    if (!explicit) {
      process.stdout.write(`claude-tweaks: ${USAGE['resolve-console']} — --run is required, console not resolved\n`);
      return 1;
    }
    reportWorktreeLocalFallback(runDir, worktreeLocalFallback);
    if (invalidRunArg) {
      process.stdout.write(`claude-tweaks: --run path rejected: ${invalidRunArg} — console not resolved\n`);
      return 1;
    }
    if (!runDir) {
      process.stdout.write('claude-tweaks: no pipeline run dir found — console not resolved\n');
      return 1;
    }
    const splitIds = (raw) => (raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []);
    const approve = splitIds(flagVal(argv.slice(3), '--approve'));
    const decline = splitIds(flagVal(argv.slice(3), '--decline'));

    const mainRoot = wtDetect.mainCheckoutRoot(process.cwd()) || process.cwd();
    const execFileAsync = promisify(execFile);
    const RESOLVE_CONSOLE_GH_TIMEOUT_MS = 15000;
    const deps = {
      now: () => Date.now(),
      writeFile: (p, content) => fs.writeFileSync(p, content),
      gh: async (args) => {
        const { stdout } = await execFileAsync('gh', args, {
          cwd: mainRoot, encoding: 'utf8', timeout: RESOLVE_CONSOLE_GH_TIMEOUT_MS, windowsHide: true,
        });
        return stdout;
      },
    };
    const { resolveConsoleExecution } = require('./lib/reconcile/console-execute');
    const result = await resolveConsoleExecution(runDir, { approve, decline }, deps);
    if (result.status === 'executed') {
      const summary = result.outcomes.map((o) => `${o.id}:${o.outcome}`).join(', ');
      process.stdout.write(
        `claude-tweaks: console resolved for ${path.basename(runDir)} (PR #${result.prNumber}) — ${summary}`
        + `${result.resolved ? '' : ' — Resolve left unticked (not every item cleared)'}\n`,
      );
      return 0;
    }
    if (result.status === 'noop') {
      process.stdout.write(`claude-tweaks: console already ${result.reason === 'claimed' ? 'claimed by another execution' : 'resolved'} for ${path.basename(runDir)} — nothing written\n`);
      return 0;
    }
    if (result.reason === 'unknown-item-ids') {
      process.stdout.write(`claude-tweaks: unknown item id(s) ${result.ids.join(', ')} — no matching console-item row found, console not resolved\n`);
      return 1;
    }
    process.stdout.write(`claude-tweaks: console resolution failed for ${path.basename(runDir)} — ${result.reason}${result.error ? `: ${result.error}` : ''}\n`);
    return 1;
  }
  if (cmd === 'check-resume-freshness') {
    // Read-only: never writes run-state.json. Skills call this immediately
    // before any of the three resume paths' safe-to-resume ruling
    // (skills/_shared/run-resume-freshness.md).
    const { runDir, invalidRunArg, worktreeLocalFallback } = resolveRunArg(argv.slice(3), process.cwd(), process.env);
    reportWorktreeLocalFallback(runDir, worktreeLocalFallback);
    if (invalidRunArg) {
      process.stdout.write(`claude-tweaks: --run path rejected: ${invalidRunArg} — resume freshness not checked\n`);
      return 0;
    }
    if (!runDir) {
      process.stdout.write('claude-tweaks: no pipeline run dir found — resume freshness not checked\n');
      return 0;
    }
    const result = resumeFreshness.checkResumeFreshness(runDir, {
      sessionId: process.env.CLAUDE_CODE_SESSION_ID,
    });
    const runId = path.basename(runDir);
    if (result.safe) {
      process.stdout.write(`claude-tweaks: resume freshness OK for ${runId} (${result.verdict})\n`);
    } else {
      process.stdout.write(`claude-tweaks: resume freshness BLOCKED for ${runId} — run appears actively owned (${result.reason})\n`);
    }
    return 0;
  }
  if (cmd === 'check-staged-inventory') {
    // Read-only, non-blocking companion to check-resume-freshness: reports
    // whether decisions.md's STAGED entries all have a backing staged/
    // file, but never gates a resume (#1269).
    const { runDir, invalidRunArg, worktreeLocalFallback } = resolveRunArg(argv.slice(3), process.cwd(), process.env);
    reportWorktreeLocalFallback(runDir, worktreeLocalFallback);
    if (invalidRunArg) {
      process.stdout.write(`claude-tweaks: --run path rejected: ${invalidRunArg} — staged inventory not checked\n`);
      return 0;
    }
    if (!runDir) {
      process.stdout.write('claude-tweaks: no pipeline run dir found — staged inventory not checked\n');
      return 0;
    }
    const result = stagedInventory.checkStagedInventory(runDir);
    const runId = path.basename(runDir);
    if (result.missing.length === 0) {
      process.stdout.write(`claude-tweaks: staged inventory OK for ${runId} (${result.checked} STAGED entries)\n`);
    } else {
      process.stdout.write(`claude-tweaks: staged inventory MISMATCH for ${runId} — ${result.missing.length} of ${result.checked} STAGED entries missing from staged/: ${result.missing.join(', ')}\n`);
    }
    return 0;
  }
  if (cmd === 'check-sibling-sessions') {
    // [IL-107]: before claiming a record, enumerate live worktrees and their
    // lock-owning pids, not just branches/claims/labels — those are the
    // signals that stayed silent while a sibling session sat eleven commits
    // deep in an unpushed worktree. This fails OPEN by construction: an
    // unresolvable --record, an unparseable lock, or a dead pid all read as
    // "no conflict", never as a block with no way forward (see
    // sibling-sessions.js's own header comment).
    const args = argv.slice(3);
    const flagIdx = args.indexOf('--record');
    const recordRef = flagIdx !== -1 ? args[flagIdx + 1] : null;
    if (!recordRef) {
      process.stdout.write('claude-tweaks: --record <id-or-slug> is required — sibling-session check not run\n');
      return 0;
    }
    const match = siblingSessions.findConflictingSession(recordRef, { cwd: process.cwd() });
    if (match) {
      process.stdout.write(
        `claude-tweaks: sibling session may already hold record ${recordRef} — ` +
        `worktree ${match.path} (branch ${match.branch || '(none)'}, pid ${match.pid}) is in use by a live session; ` +
        `verify before claiming\n`,
      );
    } else {
      process.stdout.write(`claude-tweaks: no sibling-session conflict found for record ${recordRef}\n`);
    }
    return 0;
  }
  if (cmd === 'reconcile') {
    // Thin wrapper over bin/lib/reconcile's one exported entry point —
    // session-start.js calls reconcile() the same way, in-process (#408),
    // so both surfaces are guaranteed to behave identically by construction
    // rather than by a parity test re-deriving the same logic twice.
    const args = argv.slice(3);
    // #1558: --mcp-reachable asserts the CALLER (an agent, inside its own
    // turn) has already confirmed GitHub reachability via its own MCP probe
    // (mcp-transport.md's Preflight probe) — same contract as
    // resolve-policy.js's own --mcp-reachable flag. Forwards into
    // reconcile()'s integration-model resolution so a gh-absent-but-MCP-
    // reachable sandbox doesn't silently downgrade to local-merge.
    // #1543: --checks narrows the sweep to a caller-chosen subset of
    // ALL_CHECKS (a full sweep dominated by remote-prune's --prune all-refs
    // fetch is what tripped the harness's default command timeout twice per
    // dispatch firing) — a thin pass-through to reconcile()'s existing
    // `opts.checks` seam (already used internally, e.g. reconcile-summary's
    // own `checks: ['mirror']` call). A missing/empty/all-whitespace value
    // yields `undefined`, and reconcile() itself already falls back to
    // ALL_CHECKS on any non-array or empty array — no validation needed here
    // beyond producing that safe shape.
    const checksRaw = flagVal(args, '--checks');
    const checksList = typeof checksRaw === 'string'
      ? checksRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const opts = {
      dryRun: args.includes('--dry-run'),
      cwd: process.cwd(),
      mcpReachable: args.includes('--mcp-reachable'),
      checks: checksList.length ? checksList : undefined,
    };
    const jsonOut = args.includes('--json');
    let out;
    try {
      out = await require('./lib/reconcile').reconcile(opts);
    } catch {
      out = { mirror: null, redTip: null, worktrees: null, claims: null, runs: null, branches: null, remoteBranches: null, console: null, skipped: [{ check: 'all', reason: 'reconcile-threw' }] };
    }
    if (jsonOut) {
      // Unchanged from before #638 — byte-for-byte, so bin/lib/reconcile's
      // existing JSON consumers (dispatch/tidy reading `console.ready` off
      // this) don't move.
      process.stdout.write(JSON.stringify(out) + '\n');
    } else {
      // New default (#638): a compact human-readable summary instead of the
      // full per-item census — see format-summary.js for the aggregation.
      process.stdout.write(require('./lib/reconcile/format-summary').formatSummary(out) + '\n');
    }
    return 0;
  }
  if (cmd === 'reconcile-summary') {
    // #644 Deliverable 3 — the plain one-line residue summary
    // `/claude-tweaks:flow`'s closing report shells out for. Composed
    // without re-running the background checks (release/archive/
    // archive-branches/remote-prune/reap already ran off the hot path via
    // `reconcile-background`, most recently under `session-start.js`) —
    // this reads that persisted `summary.archived` count plus the residue
    // cache both `archive`/`reap` already maintain (Deliverable 2), and
    // runs only the cheap, git-only `mirror` check fresh (mirror-ff.js
    // never shells to `gh` — see index.js's own preflight comment on why
    // it's excluded from the gh-health gate), since mirror's own RESULT
    // never persists anywhere (it only ever runs inline at SessionStart —
    // see that file's FAST_CHECKS comment). The call itself still reaches
    // reconcile()'s end-of-pass freshness stamp, though, which is a
    // DIFFERENT persistence path this call must opt out of — see
    // `skipCacheStamp` below.
    const cwd = process.cwd();
    const root = wtDetect.mainCheckoutRoot(cwd) || cwd;
    const statusPath = path.join(root, '.claude-tweaks', 'reconcile-background-status.json');
    let archivedCount = 0;
    try {
      const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
      archivedCount = (status.summary && typeof status.summary.archived === 'number') ? status.summary.archived : 0;
    } catch { /* no background pass has completed yet — 0 archived is accurate */ }

    let mirror = null;
    try {
      // skipCacheStamp: true — this narrow mirror-only probe must not stamp
      // the shared reconcile-cache.json `lastRunAt` session-start.js's own
      // FAST_CHECKS call gates its `skipIfFresh` freshness check on; doing
      // so would make the next SessionStart within DEFAULT_TTL_MS believe
      // its own mirror/red-tip/console pass already ran and skip it,
      // silently suppressing red-tip's CI-failure surfacing after every
      // successful `/claude-tweaks:flow` completion (see index.js's own
      // comment on this option).
      const mirrorResult = await require('./lib/reconcile').reconcile({ cwd, checks: ['mirror'], skipCacheStamp: true });
      mirror = mirrorResult.mirror;
    } catch { /* best-effort — mirror shows n/a rather than blocking this summary */ }

    const { formatReconcileSummary } = require('./lib/reconcile/residue-summary');
    process.stdout.write(formatReconcileSummary(root, { archivedCount, mirror }) + '\n');
    return 0;
  }
  if (cmd === 'reconcile-background') {
    // Detached-process counterpart to the `reconcile` subcommand above:
    // session-start.js's fast path spawns this (see that file's own header
    // comment on the fast/background split, #820 D8) to run only the
    // write-only janitorial checks off the hot path. Never a session-
    // blocking failure — this process is detached (spawn'd with
    // `detached: true, stdio: 'ignore'` and unref'd) and nothing reads its
    // exit code or stdout, so every path below returns 0 and best-effort
    // swallows its own errors rather than surfacing them anywhere.
    const cwd = process.cwd();
    const { reconcile } = require('./lib/reconcile');
    const { mainCheckoutRoot } = require('./lib/hooks/worktree-detect');
    const { isFresh } = require('./lib/reconcile/cache');
    const { QUIET_SKIP_REASONS } = require('./lib/hooks/worktree-reap');
    const root = mainCheckoutRoot(cwd) || cwd;
    // #1687: session-start.js's spawn site now threads the spawning session's
    // id into this dedicated env var (never `CLAUDE_CODE_SESSION_ID` — see
    // that file's own comment on why). `|| undefined` rather than `|| null`
    // matches reconcile()'s own opts contract (`sessionId?: string`) and lets
    // archiveMerged's destructuring default apply the same way an omitted key
    // would. Absent (no spawning session id was ever known) leaves this
    // exactly as unresolvable as before this fix — the other two gates
    // (24h staleness, shipped-unclosed evidence) still govern alone.
    const sessionId = process.env.CLAUDE_TWEAKS_SESSION_ID || undefined;
    const statusPath = path.join(root, '.claude-tweaks', 'reconcile-background-status.json');

    // Freshness is decided from THIS status file's own `completedAt` —
    // deliberately NOT reconcile()'s shared reconcile-cache.json `lastRunAt`
    // stamp. That stamp fires unconditionally at the end of ANY
    // fully-completed pr-first pass regardless of which `checks` subset ran,
    // so session-start.js's own FAST_CHECKS call (mirror/red-tip/console)
    // also stamps it moments before this process starts — reusing it here
    // would make this process (and the spawn-gate that decided to launch it)
    // see a false "fresh" from a pass that never touched
    // release/archive/archive-branches/remote-prune/reap, and the
    // background checks would never run. Caught by task review against a
    // real pr-first remote (#820 Task 10 fix-up); reconcile()'s own
    // lastRunAt/cache.js contract is untouched by this fix.
    let existingStatus = null;
    try { existingStatus = JSON.parse(fs.readFileSync(statusPath, 'utf8')); } catch { /* none yet */ }
    const alreadyFresh = isFresh(
      { lastRunAt: existingStatus && typeof existingStatus.completedAt === 'number' ? existingStatus.completedAt : null },
      Date.now(),
    );
    if (alreadyFresh) {
      // A very recent background pass already ran — do nothing, not even a
      // status-file touch (surfaced/completedAt are left exactly as they
      // are), since nothing new happened. Same stdout line as a completed
      // run: nothing reads this detached process's stdout or exit code, so
      // there is no caller to distinguish the two for.
      process.stdout.write('claude-tweaks: reconcile-background complete\n');
      return 0;
    }

    // Mutex — session-start.js's spawn-decision TTL gate is best-effort, not
    // a lock, and can still let two sessions starting within the same short
    // window each spawn a background pass (review finding). Only one
    // process may actually run reconcile() at a time; a losing process does
    // nothing, not even a status-file touch — the winner's write already
    // covers this window and a losing process has nothing new to report.
    const { acquireBackgroundLock, releaseBackgroundLock } = require('./lib/reconcile/background-lock');
    const lock = acquireBackgroundLock(root);
    if (!lock) {
      process.stdout.write('claude-tweaks: reconcile-background complete (already running)\n');
      return 0;
    }

    let summary = {};
    try {
      const r = await reconcile({ cwd, checks: BACKGROUND_CHECKS, sessionId });
      summary = {
        released: (r.claims || []).filter((c) => c.action === 'released').length,
        archived: (r.runs || []).filter((x) => x.action === 'archived').length,
        archivedBranches: (r.branches || []).filter((b) => b.kind === 'branch' && (b.action === 'delete' || b.action === 'tag-and-delete')).length,
        prunedRemote: (r.remoteBranches || []).filter((b) => b.action === 'delete').length,
        reaped: (r.worktrees || []).filter((w) => w.action === 'reaped').length,
        // Individually-named worktrees left in place and why — a more
        // granular signal than the check-level `skipped` array below.
        // Restores the pre-#820-D8 inline block's diagnostic, filtered the
        // same way that block filtered it (routine/expected skip reasons
        // stay quiet — see worktree-reap.js's QUIET_SKIP_REASONS).
        notableWorktrees: (r.worktrees || [])
          .filter((w) => w.action === 'skipped' && !QUIET_SKIP_REASONS.has(w.reason))
          .map((w) => ({ path: w.path, reason: w.reason })),
        skipped: r.skipped || [],
      };
    } catch {
      summary = { failed: true };
    } finally {
      releaseBackgroundLock(lock);
    }
    try {
      fs.mkdirSync(path.dirname(statusPath), { recursive: true });
      fs.writeFileSync(statusPath, JSON.stringify({ completedAt: Date.now(), summary, surfaced: false }));
    } catch { /* best-effort — this process is detached and unwatched either way */ }
    process.stdout.write('claude-tweaks: reconcile-background complete\n');
    return 0;
  }
  if (!EVENTS.includes(cmd)) {
    // #1586: every recognized subcommand above already returned before this
    // point — reaching here means `cmd` is neither a hook event (EVENTS) nor
    // any of the named subcommands (USAGE's keys). This used to silently
    // exit 0 with no output, which is exactly what let `log-decision` (not a
    // hooks.js subcommand at all — the correct tool is the separate
    // bin/log-decision.js CLI, a different script entirely that only
    // name-collides with the intended verb) no-op instead of erroring.
    // EVENTS members are invoked by the harness via stdin JSON and never hit
    // this branch with a truthy, unmatched `cmd` in practice, so a non-zero
    // exit here is safe — this is the same class of direct, skill-invoked
    // CLI call as resolve-run-dir's own non-zero exit above, not a
    // harness-dispatched hook the "never break a session" invariant covers.
    // Deliberately written with the string literal first (reversed operand
    // order) — hooks-help-guard.test.js's coverage test scans main() for the
    // literal source shape "cmd ===" followed by a quoted verb and requires a
    // matching USAGE entry for every hit; this verb deliberately has none (it
    // isn't a real hooks.js subcommand — that's the whole point of this
    // branch), so the comparison must not match that scan pattern.
    if ('log-decision' === cmd) {
      process.stderr.write(
        'claude-tweaks: hooks.js has no \'log-decision\' subcommand — did you mean the separate '
        + `bin/log-decision.js CLI? Run: node "${pluginRoot()}/bin/log-decision.js" --run <dir> --status <status> --reversibility <level> --text "..."\n`,
      );
      return 1;
    }
    const known = [...Object.keys(USAGE), ...EVENTS];
    if (!cmd) {
      process.stderr.write(`claude-tweaks: no hooks.js subcommand given — known subcommands: ${known.join(', ')}\n`);
      return 1;
    }
    const suggestion = closestVerb(cmd, known);
    const hint = suggestion ? ` — did you mean '${suggestion}'?` : ` — known subcommands: ${known.join(', ')}`;
    process.stderr.write(`claude-tweaks: unrecognized hooks.js subcommand '${cmd}'${hint}\n`);
    return 1;
  }
  const mod = loadModule(cmd);
  if (!mod || typeof mod.run !== 'function') return 0;
  const input = ctxLib.parseInput(ctxLib.readStdin());
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  // Two views of the same runs, because enforcement and bookkeeping want
  // different things (#62).
  //
  // `runDir`/`runState` stay owner-UNFILTERED — the newest non-terminal run
  // regardless of who owns it (the one exception: unadopted mints — bare
  // mkdir'd dirs with neither run-state.json nor decisions.md — are skipped
  // by resolveRun's fallback since #721, so a mint can no longer shadow an
  // older adopted run and accidentally suppress E1's bystander warning). E1's
  // working-directory gate is about this checkout, not about who owns the run:
  // its whole foreign-session branch exists to warn a bystander that the
  // checkout belongs to somebody else's worktree, which it can only do by
  // resolving a run it does not own.
  //
  // `ownedRun` is scoped to the calling session and is what may be WRITTEN to.
  // The session id comes off the hook payload, not the environment: hook
  // processes are spawned with the harness's own env, so CLAUDE_CODE_SESSION_ID
  // is not reliably present here even though `record-worktree` (a Bash-invoked
  // subcommand, not a hook) can read it.
  const runDir = ctxLib.resolveRunDir(cwd, process.env);
  const runState = runDir ? ctxLib.readRunState(runDir) : null;
  const ownedRun = ctxLib.resolveRun(cwd, process.env, input.session_id);
  const out = (await mod.run({ input, runDir, runState, ownedRun, cwd })) || {};
  if (out.json) fs.writeSync(1, JSON.stringify(out.json));
  return typeof out.exit === 'number' ? out.exit : 0;
}

if (require.main === module) {
  main(process.argv).then((code) => process.exit(code)).catch(() => process.exit(0));
}

// USAGE exported so tests/hooks-help-guard.test.js's table-driven suite
// iterates the SAME verb list this dispatcher's --help/-h guard checks
// membership against, rather than a second, driftable copy of it.
module.exports = { main, BACKGROUND_CHECKS, USAGE };
