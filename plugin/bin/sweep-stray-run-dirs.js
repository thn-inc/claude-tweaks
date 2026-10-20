#!/usr/bin/env node
// bin/sweep-stray-run-dirs.js — one-time sweep (#593 deliverable 3) of
// top-level pipeline run directories left stray by the pre-fix, non-git-aware
// archival move: a plain fs.renameSync/mv left the git-tracked work/ (or, for
// a multi-spec parent, spec-{N}/work/) subtree registered at the old
// pre-archive path, so `git checkout`/merge kept resurrecting it there even
// after the rest of the run directory had already moved into archive/.
//
// For each stray top-level dir under .claude-tweaks/pipelines/ (not
// `archive/` itself) whose `git ls-files` shows a tracked work/*-spec.md (or
// spec-*/work/*-spec.md): moves every tracked work/ subtree into its
// archive/{run-id}/ twin via `bin/lib/reconcile/archive-merged.js`'s
// archiveRunDir (the same git-mv-then-plain-move mechanics the reconciler's
// background pass already uses — deliberately not reinvented here), folding
// this run's events.jsonl into the twin's own (append, never overwrite —
// straight concatenation is the simplest merge rule that cannot silently
// drop entries) if the twin already has a partial one from an earlier
// attempt, then commits once per directory so a crash partway through
// leaves a resumable, auditable trail — a later re-run is a safe no-op on
// whatever already succeeded (archiveRunDir's own fs.existsSync guards).
//
// A directory with no tracked work/ anywhere under it (already fully
// resolved, or gitignored-only residue with nothing to sweep) is left alone
// — this script's job is the git-tracked-resurrection bug specifically, not
// general run-dir janitorial cleanup (that's the reconciler's `archive`
// check, bin/lib/reconcile/archive-merged.js's archiveMerged()).
//
// This is explicitly a one-time cleanup per the originating issue, not new
// steady-state behavior — run once, then safe to delete (or leave under
// bin/ if the resurrection pattern recurs and this needs a repeat run).
'use strict';

const fs = require('fs');
const path = require('path');
const { runGit } = require('./lib/hooks/git-exec');
const { splitNul } = require('./lib/git-z');
const { mainCheckoutRoot } = require('./lib/hooks/worktree-detect');
const { archiveRunDir, listSpecDirs } = require('./lib/reconcile/archive-merged');

// Deliberately NOT filtered by context.js's RUN_ID_RE (`^\d{4}-\d{2}-\d{2}T`)
// — this sweep's job is the raw filesystem/index-level criterion the issue
// states ("each stray directory whose git ls-files shows a tracked
// work/*-spec.md"), not "each directory the run-tracking system currently
// recognizes as a run." A handful of the 129-and-counting strays carry a
// malformed run-id (observed live: `20260817T082334-spec-741-742-743`, no
// dashes in the date) that never matched RUN_ID_RE even before going stray —
// invisible to iterRunDirsWithState and therefore to session-start.js's
// report too, a separate latent bug this sweep is not trying to fix, but
// still a directory with genuinely resurrected tracked files sitting outside
// archive/. Excluding it here would leave `find … -type d … | wc -l` short
// of the 0 the issue's acceptance criteria ask for. archiveRunDir doesn't
// care about the naming shape either — it only ever reads `path.basename`.

function parseArgs(argv) {
  const out = { root: null, dryRun: false, logPath: null };
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === '--root' && next) { out.root = next; i += 1; continue; }
    if (argv[i] === '--dry-run') { out.dryRun = true; continue; }
    if (argv[i] === '--log' && next) { out.logPath = next; i += 1; continue; }
  }
  return out;
}

// True when `git ls-files` shows at least one tracked file under runDir's
// work/ or any spec-{N}/work/ — the scoping criterion from the issue text
// ("each stray directory whose git ls-files shows a tracked work/*-spec.md").
// A dir failing this check is left alone: nothing here is the resurrection
// bug this script targets.
function hasTrackedWork(root, runDir) {
  const rel = path.relative(root, runDir);
  const res = runGit(['ls-files', '-z', '--', rel], root);
  if (res.failure || !res.stdout) return false;
  return splitNul(res.stdout).some((p) => /(^|\/)work\//.test(p));
}

// Folds runDir's top-level events.jsonl into its archive twin's, in place,
// BEFORE archiveRunDir runs — archiveRunDir's own move loop does a plain
// fs.renameSync per gitignored file, which would silently overwrite (not
// merge) an events.jsonl the archive twin already carries from an earlier
// partial archive attempt. Concatenation (archive twin's existing content
// first, then this run's) is the simplest merge rule that cannot silently
// drop entries — both files are append-only JSON-lines logs, so order
// between the two sources doesn't change what a reader can reconstruct.
// After folding, this function removes the source events.jsonl so
// archiveRunDir's own loop finds nothing left to move for that name and
// leaves the freshly-written merge alone.
function foldEventsJsonl(runDir, archiveDir) {
  const src = path.join(runDir, 'events.jsonl');
  if (!fs.existsSync(src)) return { folded: false };
  const dest = path.join(archiveDir, 'events.jsonl');
  const srcContent = fs.readFileSync(src, 'utf8');
  let merged = srcContent;
  let hadExisting = false;
  if (fs.existsSync(dest)) {
    hadExisting = true;
    const destContent = fs.readFileSync(dest, 'utf8');
    merged = destContent.endsWith('\n') || destContent === '' ? destContent + srcContent : `${destContent}\n${srcContent}`;
  }
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(dest, merged);
  fs.unlinkSync(src);
  return { folded: true, hadExisting };
}

function listStrayRunDirs(root) {
  const base = path.join(root, '.claude-tweaks', 'pipelines');
  let entries;
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && e.name !== 'archive')
    .map((e) => path.join(base, e.name))
    .sort();
}

function appendLog(logPath, entry) {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
  } catch { /* best-effort — logging must never abort the sweep */ }
}

function sweep({ root, dryRun, logPath }) {
  const strays = listStrayRunDirs(root);
  const results = { archived: [], skipped: [], failed: [] };

  for (const runDir of strays) {
    const runId = path.basename(runDir);
    if (!fs.existsSync(runDir)) {
      // Already handled by an earlier (possibly interrupted) pass over the
      // same listing — resumable no-op.
      continue;
    }
    if (!hasTrackedWork(root, runDir)) {
      results.skipped.push({ runId, reason: 'no-tracked-work' });
      appendLog(logPath, { runId, action: 'skip', reason: 'no-tracked-work' });
      continue;
    }
    if (dryRun) {
      const specDirs = listSpecDirs(runDir);
      results.archived.push({ runId, specDirs });
      appendLog(logPath, {
        runId, action: 'would-archive', specDirs,
      });
      continue;
    }

    const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
    let eventsFold;
    try {
      eventsFold = foldEventsJsonl(runDir, archiveDir);
    } catch (err) {
      results.failed.push({ runId, reason: `events-fold-failed: ${err.message}` });
      appendLog(logPath, { runId, action: 'fail', reason: `events-fold-failed: ${err.message}` });
      continue;
    }

    const result = archiveRunDir(root, runDir);
    if (!result.ok) {
      results.failed.push({ runId, reason: result.reason });
      appendLog(logPath, { runId, action: 'fail', reason: result.reason });
      continue;
    }
    results.archived.push({ runId, eventsFolded: eventsFold.folded });
    appendLog(logPath, { runId, action: 'archived', eventsFolded: eventsFold.folded });
  }

  return results;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root ? path.resolve(args.root) : (mainCheckoutRoot(process.cwd()) || process.cwd());
  const logPath = args.logPath || path.join(root, '.claude-tweaks', 'sweep-stray-run-dirs.log');
  const result = sweep({ root, dryRun: args.dryRun, logPath });

  console.log(`root: ${root}`);
  console.log(`archived: ${result.archived.length}`);
  console.log(`skipped: ${result.skipped.length}`);
  console.log(`failed: ${result.failed.length}`);
  if (result.failed.length) {
    for (const f of result.failed) console.log(`  FAILED ${f.runId}: ${f.reason}`);
    process.exitCode = 1;
  }
  if (!args.dryRun) console.log(`log: ${logPath}`);
}

if (require.main === module) main();

module.exports = { sweep, hasTrackedWork, foldEventsJsonl, listStrayRunDirs };
