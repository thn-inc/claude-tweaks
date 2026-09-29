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

// Tokenizes argv into a flat raw-values object, with per-flag syntax
// validation (unknown flags, missing values, --cmd's <name>=<command>
// shape, duplicate --cmd names). This loop is the one thing all three
// modes below share — cross-mode legality is validated separately, per
// mode, once tokenizing is done (#2806).
function tokenize(argv) {
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
  return {
    cmds, json, logDir, countStamp, gitDir, stampStatus, noStamp, scope, base, integrationBranch, changedFiles, run, cwd,
  };
}

// The only check that has to run before a mode can even be picked: the two
// boolean-flag modes are mutually exclusive.
function resolveMode(raw) {
  if (raw.stampStatus && raw.changedFiles) {
    throw new UsageError('--changed-files and --stamp-status are separate modes');
  }
  if (raw.stampStatus) return 'stamp-status';
  if (raw.changedFiles) return 'changed-files';
  return 'run';
}

// --stamp-status (#1921): a read-only mode that needs no --cmd at all, and
// takes none of --scope/--base/--integration-branch/--run/--cwd (those all
// apply to an actual check run). --git-dir and --no-stamp are unrestricted.
function validateStampStatusMode(raw) {
  if (raw.cmds.length) throw new UsageError('--stamp-status takes no --cmd');
  // L12 (review, #1922): --base/--integration-branch only mean anything
  // alongside --scope, and --stamp-status is a read-only mode that takes
  // none of the three — each combination is a usage error, not a silently
  // ignored flag.
  if (raw.scope !== null || raw.base !== null || raw.integrationBranch !== null) {
    throw new UsageError('--stamp-status takes no --scope/--base/--integration-branch');
  }
  if (raw.run !== null) {
    throw new UsageError('--run applies to a check run — not to --stamp-status or --changed-files');
  }
  if (raw.cwd !== null) {
    throw new UsageError('--cwd applies to a check run — not to --stamp-status or --changed-files');
  }
}

// --changed-files (#1923): another read-only mode — no --cmd, no --scope,
// no --git-dir, no --run/--cwd (those all apply to an actual check run).
// --base/--integration-branch ARE allowed here (unlike --stamp-status):
// they steer which base the diff is taken against.
function validateChangedFilesMode(raw) {
  if (raw.cmds.length) throw new UsageError('--changed-files takes no --cmd');
  if (raw.scope !== null) throw new UsageError('--changed-files takes no --scope');
  if (raw.gitDir !== null) throw new UsageError('--changed-files takes no --git-dir');
  if (raw.run !== null) {
    throw new UsageError('--run applies to a check run — not to --stamp-status or --changed-files');
  }
  if (raw.cwd !== null) {
    throw new UsageError('--cwd applies to a check run — not to --stamp-status or --changed-files');
  }
}

// The default mode: an actual check run. Needs at least one --cmd;
// --base/--integration-branch only mean anything alongside --scope (L12,
// #1922) — --changed-files has its own independent grant for the two,
// validated above.
function validateRunMode(raw) {
  if (raw.cmds.length === 0) throw new UsageError('at least one --cmd <name>=<command> is required');
  if (!raw.scope && (raw.base !== null || raw.integrationBranch !== null)) {
    throw new UsageError('--base and --integration-branch require --scope or --changed-files');
  }
}

const MODE_VALIDATORS = {
  'stamp-status': validateStampStatusMode,
  'changed-files': validateChangedFilesMode,
  run: validateRunMode,
};

// argv = process.argv.slice(2). Throws UsageError on any malformed input —
// the CLI prints message + USAGE to stderr and exits non-zero (AC6). Each
// mode's own legality lives in its own validator above; this just tokenizes,
// picks the mode, and runs that mode's validator against the shared shape.
function parseArgs(argv) {
  const raw = tokenize(argv);
  const mode = resolveMode(raw);
  MODE_VALIDATORS[mode](raw);
  return raw;
}

module.exports = { parseArgs, UsageError, USAGE };
