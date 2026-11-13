// plugin/bin/lib/plan-audit/args.js — argv parsing for bin/plan-audit.js (#903).
// Pure: no fs, no process access; the CLI entry owns stderr/exit codes.
'use strict';

class UsageError extends Error {}

const USAGE = 'usage: plan-audit.js <plan-file> [--repo-root <dir>] [--spec <spec-file>] [--count-tasks] [--bytes] [--task-markers] [--risk-proofs]';

// argv = process.argv.slice(2). Throws UsageError on any malformed input —
// the CLI prints message + USAGE to stderr and exits non-zero.
function parseArgs(argv) {
  let planFile = null;
  let repoRoot = null;
  let spec = null;
  let countTasks = false;
  let bytes = false;
  let taskMarkers = false;
  let riskProofs = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--repo-root') {
      const value = argv[i + 1];
      i++;
      if (value === undefined) throw new UsageError('--repo-root requires a value');
      repoRoot = value;
      continue;
    }
    if (flag === '--spec') {
      const value = argv[i + 1];
      i++;
      if (value === undefined) throw new UsageError('--spec requires a value');
      spec = value;
      continue;
    }
    if (flag === '--count-tasks') { countTasks = true; continue; }
    if (flag === '--bytes') { bytes = true; continue; }
    if (flag === '--task-markers') { taskMarkers = true; continue; }
    if (flag === '--risk-proofs') { riskProofs = true; continue; }
    if (flag.startsWith('--')) throw new UsageError(`unknown flag: ${flag}`);
    if (planFile !== null) throw new UsageError(`unexpected extra positional argument: ${flag}`);
    planFile = flag;
  }
  if (planFile === null) throw new UsageError('plan-file is required');
  // #4618: --risk-proofs runs Check G alone (a read-only verb reading --spec), so it is refused
  // beside the other read-only verbs and without the spec it reads. --spec stays allowed beside
  // it, and beside no other read-only verb (below).
  if (riskProofs && (countTasks || bytes || taskMarkers)) {
    throw new UsageError('--risk-proofs cannot be combined with --count-tasks, --bytes, or --task-markers');
  }
  if (riskProofs && spec === null) throw new UsageError('--risk-proofs requires --spec');
  // #3099: --spec feeds Checks E and F (#3602) and G (#4618), which only the full audit runs
  // (and --risk-proofs, for G) — beside any other single-purpose verb it would be silently
  // ignored, so refuse the pairing.
  // #3378: --task-markers is the same kind of single-purpose verb.
  if (spec !== null && (countTasks || bytes || taskMarkers)) {
    throw new UsageError('--spec cannot be combined with --count-tasks, --bytes, or --task-markers');
  }
  return {
    planFile, repoRoot, spec, countTasks, bytes, taskMarkers, riskProofs,
  };
}

module.exports = { parseArgs, UsageError, USAGE };
