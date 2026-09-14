// plugin/bin/lib/verify/args.js — argv parsing for bin/verify.js (#892).
// Pure: no fs, no process access; the CLI entry owns stderr/exit codes.
'use strict';

class UsageError extends Error {}

const USAGE =
  'usage: verify.js --cmd <name>=<command> [--cmd <name>=<command> ...] [--json <path>] '
  + '[--log-dir <dir>] [--count-stamp <path>] [--no-stamp] [--git-dir <dir>] [--run <dir>] '
  + '[--cwd <dir>] '
  + '[--scope <path> [--base <ref>] [--integration-branch <name>]] '
  + '| verify.js --stamp-status [--git-dir <dir>] '
  + '| verify.js --changed-files [--base <ref>] [--integration-branch <name>]\n'
  // #2341: exactly one --cmd name ("types", alongside "lint") gets the
  // fail-fast-before-tests tier — a monorepo with N independent typecheck
  // commands should either combine them into one compound
  // --cmd types="a && b && c", or give each its own verify.js invocation,
  // rather than naming them types-a/types-b/types-c (those run in the
  // "any other name" tier, serially after tests, and get skipped whenever
  // tests fails for an unrelated reason).
  + '\nnote: only one --cmd name, "types", joins the reserved fail-fast-before-tests tier '
  + '(alongside "lint"); a monorepo with several independent typecheck commands should '
  + 'combine them (--cmd types="tsc -p a && tsc -p b") or run each through its own '
  + 'verify.js invocation — a differently-named check (types-a, types-b, …) runs in the '
  + '"any other name" tier, serially after tests, and is skipped on an unrelated tests failure.';

const VALUE_FLAGS = new Set(['--cmd', '--json', '--log-dir', '--count-stamp', '--git-dir', '--scope', '--base', '--integration-branch', '--run', '--cwd']);

// argv = process.argv.slice(2). Throws UsageError on any malformed input —
// the CLI prints message + USAGE to stderr and exits non-zero (AC6).
// --stamp-status (#1921) is a read-only mode: it needs no --cmd at all.
function parseArgs(argv) {
  const cmds = [];
  let json = null;
  let logDir = null;
  let countStamp = null;
  let gitDir = null;
  let stampStatus = false;
  let noStamp = false;
  let scope = null;
  let base = null;
  let integrationBranch = null;
  let changedFiles = false;
  let run = null;
  let cwd = null;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--stamp-status') { stampStatus = true; continue; }
    if (flag === '--no-stamp') { noStamp = true; continue; }
    if (flag === '--changed-files') { changedFiles = true; continue; }
    if (VALUE_FLAGS.has(flag)) {
      const value = argv[i + 1];
      i++;
      if (value === undefined) throw new UsageError(`${flag} requires a value`);
      if (flag === '--json') { json = value; continue; }
      if (flag === '--log-dir') { logDir = value; continue; }
      if (flag === '--count-stamp') { countStamp = value; continue; }
      if (flag === '--git-dir') { gitDir = value; continue; }
      if (flag === '--scope') { scope = value; continue; }
      if (flag === '--base') { base = value; continue; }
      if (flag === '--integration-branch') { integrationBranch = value; continue; }
      if (flag === '--run') { run = value; continue; }
      if (flag === '--cwd') { cwd = value; continue; }
      const eq = value.indexOf('=');
      if (eq === -1) throw new UsageError(`--cmd value must be <name>=<command>, got: ${value}`);
      if (eq === 0) throw new UsageError(`--cmd value has an empty name: ${value}`);
      const name = value.slice(0, eq);
      if (!/^[A-Za-z0-9_-]+$/.test(name)) {
        throw new UsageError(`--cmd name must match [A-Za-z0-9_-]+, got: ${name}`);
      }
      const command = value.slice(eq + 1);
      if (command === '') throw new UsageError(`--cmd ${name} has an empty command`);
      if (cmds.some((c) => c.name === name)) throw new UsageError(`duplicate --cmd name: ${name}`);
      cmds.push({ name, command });
      continue;
    }
    throw new UsageError(`unknown flag: ${flag}`);
  }
  if (cmds.length === 0 && !stampStatus && !changedFiles) throw new UsageError('at least one --cmd <name>=<command> is required');
  if (stampStatus && cmds.length) throw new UsageError('--stamp-status takes no --cmd');
  if (changedFiles && cmds.length) throw new UsageError('--changed-files takes no --cmd');
  if (changedFiles && scope !== null) throw new UsageError('--changed-files takes no --scope');
  if (changedFiles && gitDir !== null) throw new UsageError('--changed-files takes no --git-dir');
  if (changedFiles && stampStatus) throw new UsageError('--changed-files and --stamp-status are separate modes');
  // L12 (review, #1922): --base/--integration-branch only mean anything
  // alongside --scope, and --stamp-status is a read-only mode that takes
  // none of the three — each combination is a usage error, not a silently
  // ignored flag.
  if (stampStatus && (scope !== null || base !== null || integrationBranch !== null)) {
    throw new UsageError('--stamp-status takes no --scope/--base/--integration-branch');
  }
  if (!scope && !changedFiles && (base !== null || integrationBranch !== null)) {
    throw new UsageError('--base and --integration-branch require --scope or --changed-files');
  }
  if (run !== null && (stampStatus || changedFiles)) {
    throw new UsageError('--run applies to a check run — not to --stamp-status or --changed-files');
  }
  if (cwd !== null && (stampStatus || changedFiles)) {
    throw new UsageError('--cwd applies to a check run — not to --stamp-status or --changed-files');
  }
  return {
    cmds, json, logDir, countStamp, gitDir, stampStatus, noStamp, scope, base, integrationBranch, changedFiles, run, cwd,
  };
}

module.exports = { parseArgs, UsageError, USAGE };
