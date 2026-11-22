#!/usr/bin/env node
// bin/accept-entry.js — the CLI /claude-tweaks:accept's entries call (#4613): read a
// record's acceptance packet, decide the automatic entry's label, classify the packet's
// state, refresh a stale packet, and compute a verdict's label edits. The decisions live
// in bin/lib/issues/accept-entry.js; this file reads the inputs and picks the exit code.
// It never posts or labels: the skill applies what it prints.
//
// Exit vocabulary, Payload-1/Invocation-2 as in bin/acceptance-packet.js:
//   0 success; one JSON line on stdout.
//   1 a well-formed call whose input failed: an unreadable or wrong-shaped --labels-json,
//     --packet-file or --deploy-json (its `ref` must be a deployed commit's sha, lowercase hex
//     of 7 to 64 characters, packet-contract.js's isDeployRef), a failed `gh` read (never
//     reported as `none`), or an unwritable --out. On a non-zero exit, read and refresh remove an earlier --out, so a
//     stale packet file is not there to read.
//   2 a malformed invocation: an unknown subcommand or flag, a missing value, both or neither
//     of --labels-json / --acceptance-facet, an unknown --acceptance-facet, --verdict or
//     --packet-status value, a --packet-status that contradicts --packet-file, a refresh --out
//     that is the --packet-file (same path, symlink or case alias) or whose identity cannot be
//     read, or a malformed --record or --repo.
//
// `read` wraps packet-gather.js's readPacket: the earliest trusted packet comment wins,
// untrusted copies are skipped, and a non-current schema is `unreadable`. It writes the found
// or unreadable comment's body to --out and nothing for `none`.
//
// --acceptance-facet is the local-files input: the record's `acceptance:` facet value, read as
// the one label `accept:{value}` (empty → no labels).
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseRepo, ghOptions, injectedGhDeps, pinExplicitRepoHost } = require('./lib/repo-resolve');
const { GH_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');
const {
  automaticLabelAction, packetStateOf, refreshPacket, verdictLabelEdits, VERDICTS,
} = require('./lib/issues/accept-entry');
const { readPacket } = require('./lib/wrap-up/packet-gather');
const { isDeployRef } = require('./lib/wrap-up/packet-contract');
const { readComments } = require('./lib/wrap-up/packet-post');

const USAGE = [
  'usage: accept-entry.js read --record <n> --out <file> [--repo <owner/repo>]',
  '       accept-entry.js auto-label (--labels-json <file> | --acceptance-facet <value>)',
  '       accept-entry.js state (--labels-json <file> | --acceptance-facet <value>) [--packet-file <file>] [--packet-status none|found|unreadable]',
  '       accept-entry.js refresh --packet-file <file> --out <file> [--deploy-json <file>]',
  '       accept-entry.js labels --labels-json <file> --verdict approved|changes-requested|skip [--batch]',
  '  exit 0 ok; 1 unreadable input, failed gh read or unwritable --out; 2 malformed invocation',
  '',
].join('\n');

const LABEL_INPUTS = ['--labels-json', '--acceptance-facet'];
const SUBCOMMANDS = Object.freeze({
  read: { required: ['--record', '--out'], optional: ['--repo'] },
  'auto-label': { required: [], optional: LABEL_INPUTS },
  state: { required: [], optional: [...LABEL_INPUTS, '--packet-file', '--packet-status'] },
  refresh: { required: ['--packet-file', '--out'], optional: ['--deploy-json'] },
  labels: { required: ['--labels-json', '--verdict'], optional: [], booleans: ['--batch'] },
});
const INTEGER_FLAGS = Object.freeze(['--record']);
// Flags whose value may be the empty string: an empty acceptance facet is "no labels".
const EMPTY_OK_FLAGS = Object.freeze(['--acceptance-facet']);
const ACCEPTANCE_FACETS = Object.freeze(['', 'pending', 'approved', 'changes-requested']);
const PACKET_STATUSES = Object.freeze(['none', 'found', 'unreadable']);

const flagKey = (flag) => flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const messageOf = (err) => (err && err.message ? err.message : String(err));
const isAbsentError = (err) => err?.code === 'ENOENT' || err?.code === 'ENOTDIR';

class UsageError extends Error {}
class InputError extends Error {}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command === '--help' || command === '-h') return { help: true };
  if (command === undefined) return { error: 'a subcommand is required' };
  if (!Object.hasOwn(SUBCOMMANDS, command)) return { error: `unknown subcommand: ${command}` };
  const { required, optional, booleans = [] } = SUBCOMMANDS[command];
  const valueFlags = [...required, ...optional];
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (!valueFlags.includes(flag) && !booleans.includes(flag)) return { error: `unknown argument: ${flag}` };
    const key = flagKey(flag);
    if (Object.hasOwn(opts, key)) return { error: `${flag} given more than once` };
    if (booleans.includes(flag)) {
      opts[key] = true;
      continue;
    }
    const value = rest[++i];
    const emptyOk = EMPTY_OK_FLAGS.includes(flag) && value === '';
    if (typeof value !== 'string' || (!emptyOk && !value.trim()) || value.startsWith('--')) return { error: `${flag} requires a value` };
    if (INTEGER_FLAGS.includes(flag)) {
      if (!/^[1-9][0-9]*$/.test(value)) return { error: `${flag} must be a positive integer, got: ${value}` };
      opts[key] = Number(value);
    } else {
      opts[key] = value;
    }
  }
  const missing = required.find((flag) => !Object.hasOwn(opts, flagKey(flag)));
  if (missing) return { error: `${missing} is required` };
  return { command, opts };
}

const QUIET = ['ignore', 'pipe', 'pipe'];

const realDeps = {
  cwd: () => process.cwd(),
  get env() { return process.env; },
  homeDir: () => os.homedir(),
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  writeFile: (p, s) => fs.writeFileSync(p, s),
  removeFile: (p) => fs.unlinkSync(p),
  // A file's identity (device and inode, as bigints so a large inode stays exact), or null when
  // absent. Any other failure throws.
  fileId: (p) => {
    try {
      const { dev, ino } = fs.statSync(p, { bigint: true });
      return `${dev}:${ino}`;
    } catch (err) {
      if (isAbsentError(err)) return null;
      throw err;
    }
  },
  // `{ cwd, env, stderr, homeDir }` is the caller's injected process context; absent, gh inherits the real one.
  gh: (args, { cwd, env, stderr, homeDir } = {}) => execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', windowsHide: true, stdio: QUIET, timeout: GH_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES,
    ...(cwd ? { cwd } : {}),
    ...(env ? { env } : {}),
  }, injectedGhDeps({ env, stderr, homeDir }))),
  pinGhHost: (repoSpec, { env, cwd } = {}) => pinExplicitRepoHost(repoSpec, { env, cwd }),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

const print = (deps, value) => deps.stdout(`${JSON.stringify(value)}\n`);

// A file already gone is the goal. Any other failure is stated: the file is still there.
function removeIfPresent(deps, file) {
  try {
    deps.removeFile(file);
  } catch (err) {
    if (!isAbsentError(err)) deps.stderr(`accept-entry.js: could not remove ${file} (${messageOf(err)})\n`);
  }
}

function readInput(deps, flag, file) {
  try {
    return deps.readFile(file);
  } catch (err) {
    throw new InputError(`could not read ${flag} ${file} (${messageOf(err)})`);
  }
}

function readJsonInput(deps, flag, file) {
  const text = readInput(deps, flag, file);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new InputError(`${flag} ${file} is not JSON (${messageOf(err)})`);
  }
}

// `gh issue view --json labels` output ({labels:[{name}]}) or a bare name array.
function labelsFromJson(deps, file) {
  const value = readJsonInput(deps, '--labels-json', file);
  const entries = isObject(value) ? value.labels : value;
  if (!Array.isArray(entries)) throw new InputError(`--labels-json ${file} holds no label list`);
  return entries.map((entry) => {
    const name = typeof entry === 'string' ? entry : entry?.name;
    if (typeof name !== 'string') throw new InputError(`--labels-json ${file} has a label with no name`);
    return name;
  });
}

function labelsOf(opts, deps) {
  const hasJson = opts.labelsJson !== undefined;
  const hasFacet = opts.acceptanceFacet !== undefined;
  if (hasJson === hasFacet) throw new UsageError('exactly one of --labels-json or --acceptance-facet is required');
  if (hasJson) return labelsFromJson(deps, opts.labelsJson);
  if (!ACCEPTANCE_FACETS.includes(opts.acceptanceFacet)) {
    throw new UsageError(`--acceptance-facet must be one of pending, approved, changes-requested or empty, got: ${opts.acceptanceFacet}`);
  }
  return opts.acceptanceFacet === '' ? [] : [`accept:${opts.acceptanceFacet}`];
}

// ---- read ----

function runRead(opts, deps) {
  let repoSpec = null;
  if (opts.repo !== undefined) {
    // Bare `owner/name` means github.com; `host/owner/name` keeps its host.
    repoSpec = parseRepo(opts.repo.split('/').length >= 3 ? opts.repo : `github.com/${opts.repo}`);
    if (!repoSpec) throw new UsageError(`malformed --repo: ${opts.repo}`);
  }
  let packet;
  try {
    if (repoSpec) deps.pinGhHost(repoSpec);
    const gh = (args) => deps.gh(opts.repo ? [...args, '--repo', opts.repo] : args);
    packet = readPacket(readComments(gh, opts.record));
  } catch (err) {
    throw new InputError(`could not read the comments of #${opts.record}: ${messageOf(err)}`);
  }
  if (packet.status === 'none') {
    removeIfPresent(deps, opts.out);
  } else {
    try {
      deps.writeFile(opts.out, packet.comment.body);
    } catch (err) {
      throw new InputError(`could not write --out ${opts.out} (${messageOf(err)})`);
    }
  }
  print(deps, {
    status: packet.status,
    url: packet.comment === null ? null : String(packet.comment.url || packet.comment.html_url || packet.comment.id),
    extras: packet.extras,
    skipped: packet.skipped,
  });
}

// ---- auto-label ----

function runAutoLabel(opts, deps) {
  print(deps, { action: automaticLabelAction(labelsOf(opts, deps)) });
}

// ---- state ----

function packetInput(opts, deps) {
  const status = opts.packetStatus ?? (opts.packetFile === undefined ? null : 'found');
  if (status === null) throw new UsageError('--packet-status or --packet-file is required');
  if (!PACKET_STATUSES.includes(status)) throw new UsageError(`--packet-status must be one of ${PACKET_STATUSES.join(', ')}, got: ${status}`);
  if (status === 'found' && opts.packetFile === undefined) throw new UsageError('--packet-status found needs --packet-file');
  if (status === 'none' && opts.packetFile !== undefined) throw new UsageError('--packet-status none contradicts --packet-file');
  return opts.packetFile === undefined ? { status } : { status, body: readInput(deps, '--packet-file', opts.packetFile) };
}

function runState(opts, deps) {
  const labels = labelsOf(opts, deps);
  print(deps, packetStateOf({ packet: packetInput(opts, deps), labels }));
}

// ---- refresh ----

const optionalString = (value) => value === undefined || typeof value === 'string';

function deploySource(deps, file) {
  if (file === undefined) return null;
  const value = readJsonInput(deps, '--deploy-json', file);
  const valid = isObject(value) && isDeployRef(value.ref) && typeof value.text === 'string'
    && optionalString(value.devBaseUrl) && optionalString(value.recordingUrl);
  if (!valid) throw new InputError(`--deploy-json ${file} needs a ref (a lowercase hex sha, 7-64 characters) and string text, and string devBaseUrl / recordingUrl when present`);
  return value;
}

const resolvedPath = (deps, p) => (path.isAbsolute(p) ? path.resolve(p) : path.resolve(deps.cwd(), p));

// A failed refresh removes --out, which would then be the input itself. The spellings catch an
// --out not yet written; the file identities catch a symlink or a case alias of an existing one.
// An identity that cannot be read refuses too (a UsageError removes nothing).
function sameFile(opts, deps) {
  if (resolvedPath(deps, opts.out) === resolvedPath(deps, opts.packetFile)) return true;
  let outId;
  let inId;
  try {
    outId = deps.fileId(opts.out);
    inId = deps.fileId(opts.packetFile);
  } catch (err) {
    throw new UsageError(`could not tell whether --out is the --packet-file (${messageOf(err)})`);
  }
  return outId !== null && outId === inId;
}

function runRefresh(opts, deps) {
  if (sameFile(opts, deps)) throw new UsageError('--out must not be the --packet-file');
  let result;
  try {
    const body = readInput(deps, '--packet-file', opts.packetFile);
    result = refreshPacket(body, deploySource(deps, opts.deployJson));
  } catch (err) {
    // refreshPacket throws only on a URL it cannot parse.
    throw err instanceof InputError ? err : new InputError(`could not refresh the packet: ${messageOf(err)}`);
  }
  try {
    deps.writeFile(opts.out, result.body);
  } catch (err) {
    throw new InputError(`could not write --out ${opts.out} (${messageOf(err)})`);
  }
  print(deps, { refreshed: result.refreshed, unverified: result.unverified });
}

// ---- labels ----

function runLabels(opts, deps) {
  if (!VERDICTS.includes(opts.verdict)) throw new UsageError(`--verdict must be one of ${VERDICTS.join(', ')}, got: ${opts.verdict}`);
  const labels = labelsFromJson(deps, opts.labelsJson);
  print(deps, verdictLabelEdits(labels, opts.verdict, { batch: opts.batch === true }));
}

// The deps members whose first argument is a file path: a relative one is the caller's, so it
// resolves against deps.cwd() rather than the real working directory.
const PATH_SEAMS = ['readFile', 'writeFile', 'removeFile', 'fileId'];
// The subcommands that write --out, so an earlier one is removed on a failure.
const WRITES_OUT = new Set(['read', 'refresh']);

const HANDLERS = Object.freeze({
  read: runRead, 'auto-label': runAutoLabel, state: runState, refresh: runRefresh, labels: runLabels,
});

function run(argv, overrides = {}) {
  const deps = { ...realDeps, ...overrides };
  const { gh, pinGhHost: pinGhHostIn } = deps;
  deps.gh = (args) => gh(args, { cwd: deps.cwd(), env: deps.env, stderr: deps.stderr, homeDir: deps.homeDir });
  deps.pinGhHost = (repoSpec) => pinGhHostIn(repoSpec, { env: deps.env, cwd: deps.cwd() });
  for (const seam of PATH_SEAMS) {
    const inner = deps[seam];
    deps[seam] = (p, ...rest) => inner(typeof p === 'string' && !path.isAbsolute(p) ? path.resolve(deps.cwd(), p) : p, ...rest);
  }
  const parsed = parseArgs(argv);
  if (parsed.error) {
    deps.stderr(`accept-entry.js: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  if (parsed.help) {
    deps.stdout(USAGE);
    return 0;
  }
  try {
    HANDLERS[parsed.command](parsed.opts, deps);
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      deps.stderr(`accept-entry.js: ${err.message}\n${USAGE}`);
      return 2;
    }
    if (WRITES_OUT.has(parsed.command)) removeIfPresent(deps, parsed.opts.out);
    deps.stderr(`accept-entry.js: ${messageOf(err)}\n`);
    return 1;
  }
}

module.exports = { run, parseArgs, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
