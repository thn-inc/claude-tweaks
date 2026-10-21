// plugin/bin/lib/plan-audit/args.js — argv parsing for bin/plan-audit.js (#903).
// Pure: no fs, no process access; the CLI entry owns stderr/exit codes.
'use strict';

class UsageError extends Error {}

const USAGE = 'usage: plan-audit.js <plan-file> [--repo-root <dir>] [--spec <spec-file>] [--count-tasks] [--bytes]';

// argv = process.argv.slice(2). Throws UsageError on any malformed input —
// the CLI prints message + USAGE to stderr and exits non-zero.
function parseArgs(argv) {
  let planFile = null;
  let repoRoot = null;
  let spec = null;
  let countTasks = false;
  let bytes = false;
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
    if (flag.startsWith('--')) throw new UsageError(`unknown flag: ${flag}`);
    if (planFile !== null) throw new UsageError(`unexpected extra positional argument: ${flag}`);
    planFile = flag;
  }
  if (planFile === null) throw new UsageError('plan-file is required');
  // #3099: --spec feeds Checks E and F (#3602), which only the full audit runs — beside a
  // single-purpose verb it would be silently ignored, so refuse the pairing.
  if (spec !== null && (countTasks || bytes)) {
    throw new UsageError('--spec cannot be combined with --count-tasks or --bytes');
  }
  return {
    planFile, repoRoot, spec, countTasks, bytes,
  };
}

module.exports = { parseArgs, UsageError, USAGE };
