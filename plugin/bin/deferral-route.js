#!/usr/bin/env node
// bin/deferral-route.js — where a legitimately-deferred item goes (#5930): a
// filed record or the digest, decided in code instead of re-derived from
// _shared/materiality-floor.md's prose each time.
//   node bin/deferral-route.js --defer-reason <reason> (--agent-raised | --human)
//        [--severity <critical|high|medium|low|info>] [--size <v>] [--priority <v>]
//        [--risk <v>] [--evidence <test:path|ref:id>] [--run <dir>] [--help]
// Prints one JSON line on stdout: {verdict: file|digest|refused, rule, reason
// (refused only), input} — `input` is the inputs as given, absent ones null,
// agentRaised true for --agent-raised, false for --human, null for neither or
// both (--run and --evidence are not echoed). A refusal also prints its reason as
// one stderr line. The decision is routeDeferral (bin/lib/deferral-route/route.js,
// pure); this file parses flags, refuses parse-level and routing-level problems
// itself, reads three policy keys, keeps the run tally, and prints.
// The keys are read through bin/resolve-policy.js's resolvePolicy (policy.yml,
// overlaid by {dir}/config.yml under --run, where [] is the explicit empty list):
//   deferral-digest-reasons (#5932) — the digest list; an invalid element prints one
//     stderr line naming the key and the bad element, then routes with the empty default.
//   filed-record-evidence (#5933, policyOnly, off|required) — when required, a filed
//     record on an evidence reason needs a valid --evidence or it digests (rule no-evidence).
//   run-filed-record-cap (#5933, policyOnly, integer >= 0, no default) — the most
//     filed records one run takes; over it an agent-raised item digests (rule run-cap).
//   An invalid value of either new key prints one stderr line, then routes with its default.
//   A warning for a value the factory layer supplied (#6006) adds ` in the factory layer` after the quoted value.
// The values come from policy, never from a flag, and this file adds no policy-file
// path logic of its own.
// --evidence: `ref:{id}` is checked for form only; every other value except the exact
// lowercase `test:` prefix is invalid evidence, treated as none and never refused. A
// `test:` path resolves against `git rev-parse --show-toplevel` of the working directory
// (checkEvidence, bin/lib/deferral-route/evidence.js). When that top level cannot be
// resolved, one stderr warning is printed (only when the evidence is checked: required plus an
// evidence reason) and the test: evidence counts as invalid, exit 0;
// invalid but resolvable evidence stays silent.
// --run is anchored strictly (#5933): the directory must be a run directory under the
// main checkout's .claude-tweaks/pipelines/, checked through stage-item's resolveTarget
// (run-dir-boundary-guards shape 3's predicate). A directory outside the pipelines
// directory, outside every checkout, or a worktree-local shadow exits 1, this CLI's
// existing run-dir and policy failure code; there is no exit 3, because no caller
// branches on a run-dir code distinct from 1.
// The tally (bin/lib/deferral-route/tally.js): {run-dir}/deferral-route-tally.log, one line per
// agent-raised final `file` verdict, written only with a cap and --run — create-or-append,
// no lock, best-effort under concurrency. The cap is compared with the tally's line
// count, read only when a cap and --run are both given; a cap without --run is no cap.
// Order (#5932): a refusal wins over every exit-1 cause. Parse refusals and routing
// refusals (an unknown reason, a bad --severity, ...) exit 2 before any policy
// read and before deps.cwd() is called; only a well-formed call reaches the
// resolver.
// Exit 0 a verdict (file or digest) or --help; 1 the run directory or policy could not
// be used (the working directory could not be read, --run is missing or not a run
// directory under the main checkout's .claude-tweaks/pipelines, the resolver refused
// it, or the run tally could not be read or appended; the message on stderr, nothing
// on stdout); 2 refused, which wins over every exit-1 cause.
// Writes only the run tally (a cap and --run) and makes no gh call.
'use strict';

const path = require('path');
const { routeDeferral, EVIDENCE_REASONS } = require('./lib/deferral-route/route');
const { checkEvidence } = require('./lib/deferral-route/evidence');
const { TALLY_FILE, readTallyCount, appendTally } = require('./lib/deferral-route/tally');
const { resolvePolicy, callerDeps, EXIT_OK } = require('./resolve-policy');
const { resolveTarget } = require('./lib/stage-item/write');
const { resolveAgainst } = require('./lib/health-core/io');
const { LIST_ELEMENT_PATTERNS } = require('./lib/policy-schema');

const USAGE = 'usage: deferral-route.js --defer-reason <reason> (--agent-raised | --human) [--severity <critical|high|medium|low|info>] [--size <v>] [--priority <v>] [--risk <v>] [--evidence <test:path|ref:id>] [--run <dir>] [--help]\nexit codes: 0 a verdict (file or digest) or --help; 1 the run directory or policy could not be used (the working directory could not be read, --run is missing or not a run directory under the main checkout\'s .claude-tweaks/pipelines, the resolver refused it, or the run tally could not be read or appended; stderr only, no verdict); 2 refused, which wins over every exit-1 cause.\n';
const VALUE_FLAGS = { '--defer-reason': 'deferReason', '--severity': 'severity', '--size': 'size', '--priority': 'priority', '--risk': 'risk' };
const ACCEPTED = '--defer-reason, --severity, --size, --priority, --risk, --agent-raised, --human, --evidence, --run, --help';
const DIGEST_KEY = 'deferral-digest-reasons';
const EVIDENCE_KEY = 'filed-record-evidence';
const CAP_KEY = 'run-filed-record-cap';
const BOTH_OR_NEITHER = 'exactly one of --agent-raised or --human is required';

// Scans the whole argv: the first refusal found decides `reason`, but scanning
// continues so `input` carries every known flag as given. --help/-h counts only
// in flag position; a token swallowed as a would-be value never is one.
function parseArgs(argv) {
  const input = { deferReason: null, severity: null, size: null, priority: null, risk: null, agentRaised: null };
  const seen = new Set();
  let reason = null;
  let help = false;
  let agentRaised = false;
  let human = false;
  let runDir = null;
  let evidence = null;
  const refuse = (text) => { if (reason === null) reason = text; };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--help' || token === '-h') { help = true; continue; }
    if (token === '--run') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--') || next.trim() === '') {
        refuse('--run needs a value');
        if (next === '--help' || (next !== undefined && !next.startsWith('--'))) i++;
        continue;
      }
      i++;
      if (seen.has(token)) { refuse('--run given more than once'); continue; }
      seen.add(token);
      runDir = next;
      continue;
    }
    if (token === '--evidence') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        refuse('--evidence needs a value');
        if (next === '--help') i++;
        continue;
      }
      i++;
      if (seen.has(token)) { refuse('--evidence given more than once'); continue; }
      seen.add(token);
      evidence = next;
      continue;
    }
    if (Object.hasOwn(VALUE_FLAGS, token)) {
      const next = argv[i + 1];
      const missing = next === undefined || next.startsWith('--');
      if (missing) {
        refuse(`${token} needs a value`);
        if (next === '--help') i++;
        continue;
      }
      i++;
      if (seen.has(token)) { refuse(`${token} given more than once`); continue; }
      seen.add(token);
      input[VALUE_FLAGS[token]] = next;
      continue;
    }
    if (token === '--agent-raised' || token === '--human') {
      if (seen.has(token)) { refuse(`${token} given more than once`); continue; }
      seen.add(token);
      if (token === '--agent-raised') agentRaised = true; else human = true;
      if (agentRaised && human) refuse(BOTH_OR_NEITHER);
      continue;
    }
    refuse(`${token.startsWith('-') ? 'unknown flag' : 'unknown argument'} ${token}; accepted: ${ACCEPTED}`);
  }
  // Both origins were already refused where the second one appeared; input stays null then.
  if (agentRaised !== human) input.agentRaised = agentRaised;
  return { help, reason, input, runDir, evidence };
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: () => process.cwd(),
  env: process.env,
};

function printRefusal(result, input, deps) {
  deps.stdout(JSON.stringify({ ...result, input }) + '\n');
  deps.stderr(result.reason + '\n');
  return 2;
}

// The first trimmed comma-separated entry of the rejected raw value that the
// defer-reason pattern rejects; the whole raw value when none does.
function firstBadElement(raw) {
  const text = String(raw);
  const bad = text.split(',').map((entry) => entry.trim()).find((entry) => !LIST_ELEMENT_PATTERNS['defer-reason'].test(entry));
  return bad === undefined ? text : bad;
}

function fail(deps, text) {
  deps.stderr(`deferral-route: ${text}\n`);
  return 1;
}

// The evidence check for one --evidence value. Only the exact lowercase `test:` prefix needs the git top
// level; every other value goes to checkEvidence with none, which accepts a well-formed `ref:` and rejects
// the rest. An invalid value is treated as none, never refused.
function evidenceVerdict(evidence, { cwd, env, git, stderr }) {
  let topLevel = null;
  if (evidence.startsWith('test:')) {
    try {
      topLevel = git(['rev-parse', '--show-toplevel'], { cwd, env }).trim() || null;
    } catch {
      topLevel = null;
    }
    if (topLevel === null) stderr('deferral-route: warning: could not resolve the git top level for test: evidence — treated as invalid\n');
  }
  return checkEvidence(evidence, { topLevel }).valid === true;
}

function run(argv, deps = realDeps) {
  const parsed = parseArgs(argv);
  if (parsed.help) { deps.stdout(USAGE); return 0; }
  const { input, runDir, evidence } = parsed;
  if (parsed.reason !== null) return printRefusal({ verdict: 'refused', rule: 'refused', reason: parsed.reason }, input, deps);
  const routeInput = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === null ? undefined : v]));
  // A routing refusal is decided with no digest list, so it needs no policy read.
  const pre = routeDeferral({ ...routeInput, digestReasons: [] });
  if (pre.verdict === 'refused') return printRefusal(pre, input, deps);

  let cwd;
  let target = null;
  let out;
  let policyDeps;
  try {
    cwd = deps.cwd();
    if (runDir !== null) {
      target = resolveTarget({ runDir: resolveAgainst(cwd, runDir), cwd, mainRoot: deps.mainRoot });
      if (!target.ok) {
        return fail(deps, target.reason === 'missing'
          ? `--run dir does not exist or is not a directory: ${runDir}`
          : `--run dir is not a run directory under the main checkout's .claude-tweaks/pipelines (a worktree-local shadow, or a directory outside pipelines/): ${runDir}`);
      }
    }
    policyDeps = callerDeps({ cwd, env: deps.env });
    out = resolvePolicy({ keys: [DIGEST_KEY, EVIDENCE_KEY, CAP_KEY], runDir }, policyDeps);
  } catch (err) {
    return fail(deps, err && err.message ? err.message : err);
  }
  if (out.code !== EXIT_OK) return fail(deps, out.message);
  const entry = out.result[DIGEST_KEY];
  // The resolver returns this list key in two shapes (policy-schema.js resolveValue):
  // an array ([] when unset, invalid, or the explicit `[]` the row's emptyList
  // allows) or, for a configured list, the raw comma-separated string. Split only
  // the string; an array is already the list.
  // A rejected raw the factory layer supplied says so (#6006), the way resolve-policy's warning does.
  const where = (key) => (out.invalidFrom.get(key) === 'factory' ? ' in the factory layer' : '');
  let digestReasons = [];
  if (entry.invalid) {
    deps.stderr(`deferral-route: warning: ${DIGEST_KEY} has invalid element "${firstBadElement(out.invalidRaw.get(DIGEST_KEY))}"${where(DIGEST_KEY)} — using the default (no reasons)\n`);
  } else {
    digestReasons = Array.isArray(entry.value) ? entry.value : String(entry.value).split(',').map((reason) => reason.trim());
  }
  const evidenceEntry = out.result[EVIDENCE_KEY];
  if (evidenceEntry.invalid) {
    deps.stderr(`deferral-route: warning: ${EVIDENCE_KEY} has invalid value "${out.invalidRaw.get(EVIDENCE_KEY)}"${where(EVIDENCE_KEY)} — using the default (off)\n`);
  }
  const capEntry = out.result[CAP_KEY];
  if (capEntry.invalid) {
    deps.stderr(`deferral-route: warning: ${CAP_KEY} has invalid value "${out.invalidRaw.get(CAP_KEY)}"${where(CAP_KEY)} — using the default (no cap)\n`);
  }

  const evidenceRequired = !evidenceEntry.invalid && evidenceEntry.value === 'required';
  const evidenceValid = evidenceRequired && EVIDENCE_REASONS.includes(input.deferReason) && evidence !== null
    ? evidenceVerdict(evidence, { cwd, env: deps.env, git: policyDeps.git, stderr: deps.stderr })
    : false;

  // The cap counts only with --run: the tally lives in the run directory.
  const cap = target !== null && Number.isInteger(capEntry.value) ? capEntry.value : undefined;
  let filedCount;
  if (cap !== undefined) {
    try {
      filedCount = readTallyCount(target.dir);
    } catch (err) {
      return fail(deps, `cannot read run tally ${path.join(runDir, TALLY_FILE)}: ${err.message}`);
    }
  }

  const result = routeDeferral({ ...routeInput, digestReasons, evidenceRequired, evidenceValid, cap, filedCount });
  if (result.verdict === 'file' && input.agentRaised === true && cap !== undefined) {
    try {
      appendTally(target.dir, { reason: input.deferReason, rule: result.rule });
    } catch (err) {
      return fail(deps, `cannot append run tally ${path.join(runDir, TALLY_FILE)}: ${err.message}`);
    }
  }
  deps.stdout(JSON.stringify({ ...result, input }) + '\n');
  return 0;
}

module.exports = { run, realDeps, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
