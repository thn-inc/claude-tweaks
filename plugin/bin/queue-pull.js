#!/usr/bin/env node
// bin/queue-pull.js — the dispatch queue pull and the `next` ranking as one CLI (#5227).
//   node bin/queue-pull.js --transport gh|files [--queue-raw <p>] [--dep-freshness <p>] [--open-numbers <p>]
//                          [--verified-open-deps <p>] [--in-flight-raw <p>] [--in-flight-claims <p>] [--foreign-states <p>]
//   node bin/queue-pull.js --rank [--priority high|medium|low]
//   node bin/queue-pull.js --help
// A thin wrapper over lib/dispatch/queue-pull.js: `queuePull` runs the pull the fenced script in
// skills/dispatch/queue-pull-script.md runs (every pass, in registry order), and `--rank` runs
// `rankFromFiles` (next-ranking.md's pick, written to dispatch-next-pick.json). The session id
// comes from CLAUDE_CODE_SESSION_ID; every file lands at the session-scoped path the script's
// `session-tmp-resolve.js --value` calls resolve.
//
// `--rank` prints nothing on stdout (the pick lives in the file). A caller with no priority filter
// omits `--priority` rather than passing an empty value: the script tolerates an empty
// $PRIORITY_FILTER, this CLI's empty-value rule exits 1. A repeated value flag exits 1 too.
//
// Transports. `gh` pulls through the gh CLI. `files` makes zero gh calls: the calling skill fetched
// the records (mcp-transport.md) and the input-path flags name its files; each defaults to the
// session path the script reads. The input-path flags are valid only with `--transport files`.
// `--transport` is always explicit: with `gh` and no gh on PATH the CLI exits 2 and names the
// `files` transport. It never falls back to it silently.
//   The claims file (--in-flight-claims, default DISPATCH_IN_FLIGHT_CLAIMS) must hold an entry for
// every claim the neighbour-in-flight pass reads: each record in the pool file (--in-flight-raw,
// DISPATCH_IN_FLIGHT_RAW) that neighbours a candidate, the set mcp-transport.md's Step 2 prints
// with neighbourClaimTargets over the groups left at that pass. Unlike the script, this CLI prints
// no targets list, and the caller writes the file before the pull has built those groups, so it
// reads the claim of every record in the pool file. That set covers any targets list, and a list
// computed over the queue instead is not safe: a queued record that an earlier pass drops becomes a
// neighbour, never a candidate. A number left out reads as a failed claim read: the pass prints the
// AUTO claim-read line and counts that record as not in flight.
//
// Exit codes (Split-1/2 base, plus 4 for a pull that stopped; one vocabulary, never mixed):
//   0  success: the pull ran to the end (or the pick was written, `null` when nothing is eligible)
//   1  malformed invocation: an unknown flag or argument, a value flag with no value, an empty,
//      blank or dash-leading value, a bad --transport or --priority value, no mode, or flags
//      from two modes together. The usage text is printed on stderr.
//   2  missing dependency: `--transport gh` and gh is not available (or could not be probed).
//      The message names `--transport files`.
//   3  a remote call failed. RESERVED, never produced: every remote failure either takes its
//      pass's fail-open path (a Warning or AUTO line, exit 0) or ends in a stop (exit 4), exactly
//      as in the script.
//   4  the pull stopped, with the cause on stderr: a QueuePullStopped (the stop line the script
//      prints, byte for byte), or ANY other throw from the module, printed as
//      `queue-pull: <message>`, so an internal error is distinguishable from the two named stops.
//      The fence stops with exit 1 on any failed node block, so a throw means the run cannot
//      vouch for the files it left; the CLI reports that rather than returning 0 over them (Q19).
//      --rank maps a throw the same way (a missing or malformed dispatch-groups.json).
// --help (or -h) prints the usage on stdout and exits 0 before anything is probed (gh, git, policy)
// and before any other argument is read; it wins over every mode.
//
// Decision (R4): 3 stays in the vocabulary but nothing produces it, and 4 is the only code above
// the base. The caller that branches on 4 is the cutover unit's Step 2 prose (the dispatch skill's
// queue pull), which stops and reports on 4 and switches to `--transport files` on 2. Reopen
// when the cutover has landed: nothing then branches on 4 differently from 1, so 4 folds into the
// base codes unless a caller wants a stop reported apart from a bad call.
//
// Departure (R5) from .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md's "gh-absent
// caller hands the CLI already-fetched records" rules (1) and (2): on `files` the module makes
// zero gh calls and this CLI never probes for gh (rule 1 holds), but it still spawns the CLIs the
// script's MCP path runs as written (resolve-linked-prs.js, resolve-blockers.js under native,
// dispatch-unlanded-blockers.js), whose own gh calls fail the way mcp-transport.md documents. And
// a problem with an input file does not land on the malformed-invocation code (rule 2): it takes
// the script's outcome, a stop (exit 4) or the documented fail-open or fail-closed line.
'use strict';

const path = require('node:path');

const EXIT = { OK: 0, USAGE: 1, MISSING_DEPENDENCY: 2, REMOTE_FAILED: 3, STOPPED: 4 };

const { PRIORITIES } = require('./lib/issues/record-vocabulary'); // pure; safe before --help
// 'high, medium or low'
const PRIORITY_LIST = `${PRIORITIES.slice(0, -1).join(', ')} or ${PRIORITIES[PRIORITIES.length - 1]}`;

const USAGE = `usage:
  queue-pull.js --transport gh|files [--queue-raw <p>] [--dep-freshness <p>] [--open-numbers <p>]
                [--verified-open-deps <p>] [--in-flight-raw <p>] [--in-flight-claims <p>] [--foreign-states <p>]
  queue-pull.js --rank [--priority ${PRIORITIES.join('|')}]
  queue-pull.js --help
--transport gh pulls through gh; --transport files reads the files the agent fetched through MCP
(the input-path flags, valid only with it, default to the session-scoped paths). --rank picks the
next group and writes dispatch-next-pick.json (stdout stays empty). Omit --priority when no
filter is set: an empty value exits 1. A value flag may be given only once.
The --in-flight-claims file must cover the claim of every record in the --in-flight-raw file:
the pull prints no claim-targets list (mcp-transport.md Step 2's neighbourClaimTargets), and a
number left out reads as a failed claim read (an AUTO line; that record counts as not in flight).
exit codes:
  0  success
  1  malformed invocation (usage printed)
  2  missing dependency: --transport gh and gh is not available (re-run with --transport files)
  3  a remote call failed (reserved; every remote failure fails open or stops with 4)
  4  the pull stopped: a QueuePullStopped line, or any other throw as "queue-pull: <message>"
`;

const TRANSPORTS = ['files', 'gh'];
// flag -> key of the module's options.inputs
const INPUT_FLAGS = {
  '--queue-raw': 'queueRaw',
  '--dep-freshness': 'depFreshness',
  '--open-numbers': 'openNumbers',
  '--verified-open-deps': 'verifiedOpenDeps',
  '--in-flight-raw': 'inFlightRaw',
  '--in-flight-claims': 'inFlightClaims',
  '--foreign-states': 'foreignStates',
};
const VALUE_FLAGS = new Set(['--transport', '--priority', ...Object.keys(INPUT_FLAGS)]);

// -> { help: true } | { error } | { mode: 'pull'|'rank', transport, priority, inputs }
function parseArgs(argv) {
  if (argv.some((a) => a === '--help' || a === '-h')) return { help: true };
  const out = { mode: null, transport: null, priority: null, inputs: {} };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--rank') { out.mode = 'rank'; continue; }
    if (!VALUE_FLAGS.has(arg)) return { error: `unknown argument: ${arg}` };
    const value = argv[i + 1];
    // A value flag as the last argument reads undefined; an empty, blank or dash-leading value
    // is refused too, because the module forwards inputs to children as paths.
    if (typeof value !== 'string' || !value.trim() || value.startsWith('-')) return { error: `${arg} needs a value` };
    i += 1;
    // A repeated value flag is refused, never last-wins: `--transport gh --transport files` must
    // not quietly run the files transport.
    if (seen.has(arg)) return { error: `${arg} given more than once` };
    seen.add(arg);
    if (arg === '--transport') {
      if (!TRANSPORTS.includes(value)) return { error: `--transport must be gh or files, got: ${value}` };
      out.transport = value;
    } else if (arg === '--priority') {
      if (!PRIORITIES.includes(value)) return { error: `--priority must be ${PRIORITY_LIST}, got: ${value}` };
      out.priority = value;
    } else {
      out.inputs[INPUT_FLAGS[arg]] = value;
    }
  }
  if (out.mode === 'rank') {
    if (out.transport || Object.keys(out.inputs).length) return { error: '--rank takes no --transport or input-path flags' };
    return out;
  }
  if (!out.transport) return { error: 'no mode: pass --transport gh|files or --rank' };
  if (out.priority) return { error: '--priority applies only to --rank' };
  if (out.transport !== 'files' && Object.keys(out.inputs).length) return { error: 'the input-path flags are valid only with --transport files' };
  out.mode = 'pull';
  return out;
}

function realDeps() {
  const lib = require('./lib/dispatch/queue-pull');
  return {
    env: process.env,
    cwd: process.cwd(),
    ghAvailable: () => require('./lib/repo-resolve').ghAvailable(),
    queuePull: lib.queuePull,
    rankFromFiles: lib.rankFromFiles,
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
}

// Every deps member is read lazily, so --help never touches one that is not a plain output.
function run(argv, deps = {}) {
  let defaults = null;
  const dep = (key) => {
    if (deps[key] !== undefined) return deps[key];
    if (!defaults) defaults = realDeps();
    return defaults[key];
  };
  const out = (s) => (deps.stdout !== undefined ? deps.stdout(s) : process.stdout.write(s));
  const err = (s) => (deps.stderr !== undefined ? deps.stderr(s) : process.stderr.write(s));

  const args = parseArgs(argv);
  if (args.help) {
    out(USAGE);
    return EXIT.OK;
  }
  if (args.error) {
    err(`queue-pull.js: ${args.error}\n${USAGE}`);
    return EXIT.USAGE;
  }

  // Every throwing deps call below is caught into the documented codes (the cli-wrapper contract).
  const stopped = (e) => {
    if (e && e.name === 'QueuePullStopped' && typeof e.line === 'string') err(e.line.endsWith('\n') ? e.line : `${e.line}\n`);
    else err(`queue-pull: ${e && e.message !== undefined ? e.message : e}\n`);
    return EXIT.STOPPED;
  };

  try {
    const env = dep('env') || {};
    const sessionId = env.CLAUDE_CODE_SESSION_ID;

    if (args.mode === 'rank') {
      // Prints nothing: next-ranking.md redirects node's output into the pick file, and the pick
      // is a whole group of full records, which must not reach the agent's context.
      dep('rankFromFiles')({ sessionId, priority: args.priority || undefined });
      return EXIT.OK;
    }

    if (args.transport === 'gh') {
      let available = false;
      try {
        available = dep('ghAvailable')() === true;
      } catch {
        available = false;
      }
      if (!available) {
        err('queue-pull.js: gh is not available (or could not be probed); --transport gh needs it. '
          + 'Fetch the records through MCP and re-run with --transport files. It never falls back to files silently.\n');
        return EXIT.MISSING_DEPENDENCY;
      }
    }

    const cwd = dep('cwd') || process.cwd();
    const inputs = {};
    for (const [key, value] of Object.entries(args.inputs)) inputs[key] = path.resolve(cwd, value);
    dep('queuePull')({ transport: args.transport, sessionId, cwd, env, inputs, omit: [] }, { stdout: out, stderr: err });
    return EXIT.OK;
  } catch (e) {
    // QueuePullStopped is thrown without printing, so the CLI prints its stop line here. Any other
    // throw is the run's own internal failure: also a stop (Q19), prefixed so it reads differently.
    return stopped(e);
  }
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}

module.exports = { run, parseArgs, USAGE, EXIT };
