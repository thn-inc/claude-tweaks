// plugin/bin/lib/verify/args.js — argv parsing for bin/verify.js (#892).
// Pure: no fs, no process access; the CLI entry owns stderr/exit codes.
'use strict';

class UsageError extends Error {}

const USAGE =
  'usage: verify.js --cmd <name>=<command> [--cmd <name>=<command> ...] '
  + '[--cmd-env <name>=<KEY=VALUE> ...] [--cmd-timeout <name>=<ms> ...] [--json <path>] '
  + '[--log-dir <dir>] [--count-stamp <path>] [--no-stamp] [--git-dir <dir>] [--run <dir>] '
  + '[--cwd <dir>] '
  + '[--baseline <ref> --baseline-cmd <name>=<template-with-{file}> ...] '
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

const VALUE_FLAGS = new Set(['--cmd', '--cmd-env', '--cmd-timeout', '--json', '--log-dir', '--count-stamp', '--git-dir', '--scope', '--base', '--integration-branch', '--run', '--cwd', '--baseline', '--baseline-cmd']);

// --cmd-env (#2779): <check-name>=<KEY=VALUE>, repeatable. Split on the first
// two `=` only, so VALUE keeps any later `=` intact.
function parseCmdEnv(value) {
  const eq = value.indexOf('=');
  if (eq <= 0) throw new UsageError(`--cmd-env value must be <check-name>=<KEY=VALUE>, got: ${value}`);
  const name = value.slice(0, eq);
  const pair = value.slice(eq + 1);
  const pairEq = pair.indexOf('=');
  if (pairEq === -1) throw new UsageError(`--cmd-env ${name} must carry KEY=VALUE, got: ${pair}`);
  const key = pair.slice(0, pairEq);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new UsageError(`--cmd-env ${name} variable name must match [A-Za-z_][A-Za-z0-9_]*, got: ${key}`);
  }
  return { name, key, value: pair.slice(pairEq + 1) };
}

// --cmd-timeout (#3063): <check-name>=<ms>, repeatable (one per check). Split
// on the first `=` only, so a future non-numeric suffix can't hide a typo.
function parseCmdTimeout(value) {
  const eq = value.indexOf('=');
  if (eq <= 0) throw new UsageError(`--cmd-timeout value must be <check-name>=<ms>, got: ${value}`);
  const name = value.slice(0, eq);
  const msText = value.slice(eq + 1);
  if (!/^[1-9][0-9]*$/.test(msText)) {
    throw new UsageError(`--cmd-timeout ${name} must be a positive integer millisecond value, got: ${msText}`);
  }
  return { name, ms: Number(msText) };
}

// #2806: parseArgs covers four distinct CLI modes (a normal check run,
// --stamp-status, --changed-files, and --scope's sub-variant of the check
// run) that used to share one function with roughly ten interleaved
// cross-mode incompatibility checks. It is now a shared tokenizer (below)
// feeding three per-mode validate functions — each mode's own rules live
// together, and a mode's validator never inspects another mode's flags
// except to reject them. `parseArgs` itself only resolves which mode applies
// and dispatches.

// Shared flag-tokenizing loop: splits argv into typed buckets, with
// per-flag validation (malformed values, duplicate --cmd names, unknown
// flags). No cross-flag or cross-mode validation happens here — that is
// each mode's own job below. argv = process.argv.slice(2).
function tokenize(argv) {
  const cmds = [];
  const cmdEnvs = [];
  const cmdTimeouts = [];
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
  let baseline = null;
  const baselineCmds = [];
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
      if (flag === '--baseline') {
        // An unset shell variable would otherwise switch adjudication off without a word.
        if (value === '') throw new UsageError('--baseline needs a ref, got an empty value');
        baseline = value;
        continue;
      }
      if (flag === '--baseline-cmd') {
        // #3043: split on the first `=` only, so the template keeps later `=` intact.
        const eq = value.indexOf('=');
        if (eq <= 0) throw new UsageError(`--baseline-cmd value must be <name>=<template-with-{file}>, got: ${value}`);
        baselineCmds.push({ name: value.slice(0, eq), template: value.slice(eq + 1) });
        continue;
      }
      if (flag === '--cmd-env') { cmdEnvs.push(parseCmdEnv(value)); continue; }
      if (flag === '--cmd-timeout') { cmdTimeouts.push(parseCmdTimeout(value)); continue; }
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
    cmds, cmdEnvs, cmdTimeouts, json, logDir, countStamp, gitDir, stampStatus, noStamp, scope, base, integrationBranch,
    changedFiles, run, cwd, baseline, baselineCmds,
  };
}

// --cmd-env/--cmd-timeout naming a check no --cmd declared is a UsageError
// in every mode — a read-only mode forces cmds empty before this would ever
// resolve a match, so it fires there too. Shared rather than duplicated,
// since the message/logic is identical in each mode.
function rejectUndeclaredCmdEnvAndTimeout(raw) {
  const declared = () => raw.cmds.map((c) => c.name).join(', ') || 'none';
  const undeclaredEnv = raw.cmdEnvs.find((e) => !raw.cmds.some((c) => c.name === e.name));
  if (undeclaredEnv) {
    throw new UsageError(`--cmd-env "${undeclaredEnv.name}" names no declared --cmd (declared: ${declared()})`);
  }
  const undeclaredTimeout = raw.cmdTimeouts.find((t) => !raw.cmds.some((c) => c.name === t.name));
  if (undeclaredTimeout) {
    throw new UsageError(`--cmd-timeout "${undeclaredTimeout.name}" names no declared --cmd (declared: ${declared()})`);
  }
}

// cmdEnvs/cmdTimeouts are intermediate tokenizer buckets only — by the time
// a mode validator returns, their contents are either attached onto the
// matching `cmds` entry (as `.env`/`.timeout`) or have already thrown, so
// the public result never carries them as top-level keys.
function toResult(raw) {
  const {
    cmds, json, logDir, countStamp, gitDir, stampStatus, noStamp, scope, base, integrationBranch, changedFiles, run,
    cwd, baseline, baselineCmds,
  } = raw;
  return {
    cmds, json, logDir, countStamp, gitDir, stampStatus, noStamp, scope, base, integrationBranch, changedFiles, run,
    cwd, baseline, baselineCmds,
  };
}

const BASELINE_MODE_CONFLICT = '--baseline/--baseline-cmd apply to a check run — not to --stamp-status or --changed-files';
const RUN_MODE_CONFLICT = '--run applies to a check run — not to --stamp-status or --changed-files';
const CWD_MODE_CONFLICT = '--cwd applies to a check run — not to --stamp-status or --changed-files';

// --stamp-status (#1921): a read-only mode needing no --cmd at all. Every
// run-scoped flag is a usage error here, not a silently ignored one.
function validateStampStatus(raw) {
  rejectUndeclaredCmdEnvAndTimeout(raw);
  // #3043: checked first so a read-only mode carrying a baseline flag gets
  // this message, not the generic --cmd one below.
  if (raw.baseline !== null || raw.baselineCmds.length) throw new UsageError(BASELINE_MODE_CONFLICT);
  if (raw.cmds.length) throw new UsageError('--stamp-status takes no --cmd');
  // L12 (review, #1922): --base/--integration-branch only mean anything
  // alongside --scope, and --stamp-status takes none of the three — each
  // combination is a usage error, not a silently ignored flag.
  if (raw.scope !== null || raw.base !== null || raw.integrationBranch !== null) {
    throw new UsageError('--stamp-status takes no --scope/--base/--integration-branch');
  }
  if (raw.run !== null) throw new UsageError(RUN_MODE_CONFLICT);
  if (raw.cwd !== null) throw new UsageError(CWD_MODE_CONFLICT);
  return toResult(raw);
}

// --changed-files (#1923): a read-only mode needing no --cmd/--scope, but
// (unlike --stamp-status) --base/--integration-branch are meaningful here.
function validateChangedFiles(raw) {
  rejectUndeclaredCmdEnvAndTimeout(raw);
  if (raw.baseline !== null || raw.baselineCmds.length) throw new UsageError(BASELINE_MODE_CONFLICT);
  if (raw.cmds.length) throw new UsageError('--changed-files takes no --cmd');
  if (raw.scope !== null) throw new UsageError('--changed-files takes no --scope');
  if (raw.gitDir !== null) throw new UsageError('--changed-files takes no --git-dir');
  if (raw.run !== null) throw new UsageError(RUN_MODE_CONFLICT);
  if (raw.cwd !== null) throw new UsageError(CWD_MODE_CONFLICT);
  return toResult(raw);
}

// The default mode: one or more --cmd checks, plus --cmd-env/--cmd-timeout/
// --baseline/--scope — none of which mean anything in the two read-only
// modes above, so they're validated only here.
function validateCheckRun(raw) {
  if (raw.cmds.length === 0) throw new UsageError('at least one --cmd <name>=<command> is required');
  // #2779: resolved after tokenizing so --cmd-env may precede its --cmd. A
  // check carries an `env` key only when a --cmd-env named it — a --cmd-only
  // invocation parses to exactly the shape it did before the flag existed.
  // Object.fromEntries defines own properties, so a variable literally named
  // __proto__ stays data rather than touching the prototype.
  for (const c of raw.cmds) {
    const mine = raw.cmdEnvs.filter((e) => e.name === c.name);
    if (mine.length === 0) continue;
    const keys = mine.map((e) => e.key);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup !== undefined) throw new UsageError(`duplicate --cmd-env variable for ${c.name}: ${dup}`);
    c.env = Object.fromEntries(mine.map((e) => [e.key, e.value]));
  }
  rejectUndeclaredCmdEnvAndTimeout(raw);
  // #3063: resolved the same way as --cmd-env above, but scalar per check —
  // a check carries a `timeout` key only when a --cmd-timeout named it.
  for (const c of raw.cmds) {
    const mine = raw.cmdTimeouts.filter((t) => t.name === c.name);
    if (mine.length === 0) continue;
    if (mine.length > 1) throw new UsageError(`duplicate --cmd-timeout for ${c.name}`);
    c.timeout = mine[0].ms;
  }
  if (raw.baseline !== null && raw.baselineCmds.length === 0) throw new UsageError('--baseline requires at least one --baseline-cmd');
  if (raw.baseline === null && raw.baselineCmds.length) throw new UsageError('--baseline-cmd requires --baseline');
  const seenBaselineNames = new Set();
  for (const b of raw.baselineCmds) {
    if (!raw.cmds.some((c) => c.name === b.name)) {
      throw new UsageError(`--baseline-cmd "${b.name}" names no declared --cmd (declared: ${raw.cmds.map((c) => c.name).join(', ') || 'none'})`);
    }
    if (!b.template.includes('{file}')) throw new UsageError(`--baseline-cmd ${b.name} template must contain {file}, got: ${b.template}`);
    if (seenBaselineNames.has(b.name)) throw new UsageError(`duplicate --baseline-cmd name: ${b.name}`);
    seenBaselineNames.add(b.name);
  }
  // --base/--integration-branch only mean anything alongside --scope in this
  // mode (--changed-files has its own, unconditional, allowance for both).
  if (!raw.scope && (raw.base !== null || raw.integrationBranch !== null)) {
    throw new UsageError('--base and --integration-branch require --scope or --changed-files');
  }
  return toResult(raw);
}

// argv = process.argv.slice(2). Throws UsageError on any malformed input —
// the CLI prints message + USAGE to stderr and exits non-zero (AC6).
// Resolves which of the three modes applies, then dispatches entirely to
// that mode's own validator — see the #2806 note above tokenize().
function parseArgs(argv) {
  const raw = tokenize(argv);
  if (raw.stampStatus && raw.changedFiles) {
    throw new UsageError('--changed-files and --stamp-status are separate modes');
  }
  if (raw.stampStatus) return validateStampStatus(raw);
  if (raw.changedFiles) return validateChangedFiles(raw);
  return validateCheckRun(raw);
}

module.exports = { parseArgs, UsageError, USAGE };
