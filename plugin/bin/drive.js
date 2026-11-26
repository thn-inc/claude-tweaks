#!/usr/bin/env node
// bin/drive.js — the pipeline driver (#5218): takes each named record, one at a time and
// in order, from admission to a draft PR with CI read. A program owns every step; a
// headless worker only writes the change. A record merges only when it carries auto:merge and
// auto:build and the judgment supplier (#5228; bin/lib/driver/judgments.js, its merge-check
// and acceptance workers) clears it for the merge step (#5226, bin/lib/driver/merge.js);
// otherwise nothing merges, and a run that gets that far ends at pending-review, as in
// Phase 1. A thin entry: the loop, the step table, USAGE and realDeps live in
// bin/lib/driver/ (run.js, steps.js, events.js, merge.js).
//
//   Usage: drive.js #N [#M…]
//          drive.js --help | -h
//          drive.js --no-settle #N [#M…]   (the caller settles stops: the final line carries settle: left-to-caller and the stop object)
//          drive.js [--no-settle] --budget <n|all>   (picks records from the dispatch queue and drives up to n of them, or all that are admitted; --no-settle applies to each driven record; each record's merge step holds the merge when a PR this run opened earlier is still open and shares a changed path or closes a near-duplicate partner (the loop's own list, dispatch-drain-prs.json in the run's session temp directory, plus the latest pull's dispatch-near-dup-pairs.json))
//          drive.js --check #N   (prints the admission verdict as one JSON line; no write of any kind)
//          drive.js #N [--in-flight-prs <file>] [--near-dup-pairs <file>]   (holds the merge before mark-ready on a shared changed path with a PR in the JSON list <file>, or when such a PR closes a strong near-duplicate partner of the record named by the pairs <file>; an unreadable file or PR holds too; not with --budget or --check, where the loop builds both inputs itself)
//          drive.js #N --run <dir> --no-settle   (adopts the run directory <dir> and the linked worktree it is run from, minting and creating neither; requires --no-settle and one record)
//
// --in-flight-prs is the one flag whose absence takes the unsafe route, on purpose (spec AC9): with it
// absent no overlap hold is applied to a named record, which is the standalone case of one record at a
// time. The callers that run a drain apply it: dispatch's driver route passes the list, and --budget
// builds its own (the PRs this run opened, dispatch-drain-prs.json in the session temp directory); a list
// either caller cannot read or build holds the merge, never lets it through. Under --run a merged record
// keeps the adopted worktree and local branch (the caller owns them); the remote branch is still deleted
// and the run closed.
//
// One JSON event line per step on stdout (and, once the run directory exists, in
// {run-dir}/driver-events.jsonl); each record's final line carries its outcome word.
// Exit codes (Combined-2, as bin/link-records.js):
//   0  every named record reached its final event, whatever its outcome (outcomes are data); with --budget, the loop ended normally (budget spent, queue exhausted, a claim stop on claim-targets.js exit 2, 6 or 7, or express-driver off), whatever each record's outcome
//   1  when the policy, or the run's repository or integration branch, cannot be resolved and no further record is attempted; under --run, also an adopted worktree on the integration branch itself (the policy step refuses it before the claim, nothing written); with --budget, also a failed queue pull
//   2 malformed invocation (no record reference, a non-numeric one) or gh or git absent, or an internal error (run itself failed); a bad or repeated --budget value, or --budget with a named record; a missing, empty or repeated --run value, or --run without --no-settle, with more than one record, or with --budget or --check; with --in-flight-prs or --near-dup-pairs, a missing, empty, flag-shaped or repeated value, --budget or --check beside either, or --near-dup-pairs without --in-flight-prs
//      (exit 2 is overloaded on purpose; revisit if a caller needs to retry an internal error
//      differently from a usage error)
//   3  --run refused: the run directory is missing or not a run directory under the main checkout, or the working directory is not a linked worktree of it, or the run directory's run-state.json does not name that worktree, or the worktree has no branch; nothing written
//      (a per-CLI code above Combined-2, as log-decision.js and express-lane.js use 3 for an unanchored run directory; no caller
//      branches on it differently: /claude-tweaks:dispatch's driver route reads every non-zero exit as blocked)
// --check exit codes: 0 a verdict was printed (admitted or not); 1 no verdict could be computed (nothing on stdout); 2 malformed (anything but exactly one record reference).
// --help (or -h) exits 0 before any probe of gh, git or policy.
'use strict';

const { run, realDeps } = require('./lib/driver/run');

// Sets proc.exitCode from run(). A rejected run() is a bug, not an outcome: it is exit 2
// with the message on stderr, never Node's unhandled-rejection exit 1, which would read
// as the documented exit 1. Never process.exit: a pending stdout write must flush.
function main(argv, deps, proc = process) {
  return run(argv, deps)
    .then((code) => { proc.exitCode = code; })
    .catch((err) => {
      proc.stderr.write(`drive.js: internal error: ${(err && err.message) || String(err)}\n`);
      proc.exitCode = 2;
    });
}

module.exports = { run, main };

if (require.main === module) main(process.argv.slice(2), realDeps);
