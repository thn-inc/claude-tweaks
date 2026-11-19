#!/usr/bin/env node
// bin/deferral-route.js — where a legitimately-deferred item goes (#5930): a
// filed record or the digest, decided in code instead of re-derived from
// _shared/materiality-floor.md's prose each time.
//   node bin/deferral-route.js --defer-reason <reason> (--agent-raised | --human)
//        [--severity <critical|high|medium|low|info>] [--size <v>] [--priority <v>]
//        [--risk <v>] [--run <dir>] [--help]
// Prints one JSON line on stdout: {verdict: file|digest|refused, rule, reason
// (refused only), input} — `input` is the inputs as given, absent ones null,
// agentRaised true for --agent-raised, false for --human, null for neither or
// both (--run is not echoed). A refusal also prints its reason as one stderr
// line. The decision is routeDeferral (bin/lib/deferral-route/route.js, pure);
// this file parses flags, refuses parse-level and routing-level problems itself,
// reads policy key deferral-digest-reasons, and prints.
// The key is read through bin/resolve-policy.js's resolvePolicy (policy.yml,
// overlaid by {dir}/config.yml under --run, where [] is the explicit empty list):
// the digest list comes from policy, never from a flag, and this file adds no
// policy-file path logic of its own. An invalid value (an element that is not a
// Defer-reason) prints one stderr line naming the key and the bad element, then
// routes with the empty default.
// Order (#5932): a refusal wins over a --run failure. Parse refusals and routing
// refusals (an unknown reason, a bad --severity, ...) exit 2 before any policy
// read and before deps.cwd() is called; only a well-formed call reaches the
// resolver.
// Exit 0 a verdict (file or digest) or --help; 1 the policy read failed (the
// resolver refused --run, or the working directory could not be read; the message
// on stderr, nothing on stdout); 2 refused.
// Writes nothing and makes no gh call.
'use strict';

const { routeDeferral } = require('./lib/deferral-route/route');
const { resolvePolicy, callerDeps, EXIT_OK } = require('./resolve-policy');
const { LIST_ELEMENT_PATTERNS } = require('./lib/policy-schema');

const USAGE = 'usage: deferral-route.js --defer-reason <reason> (--agent-raised | --human) [--severity <critical|high|medium|low|info>] [--size <v>] [--priority <v>] [--risk <v>] [--run <dir>] [--help]\nexit codes: 0 a verdict (file or digest) or --help; 1 the policy read failed (the resolver refused --run, or the working directory could not be read; stderr only, no verdict); 2 refused, which wins over a --run failure.\n';
const VALUE_FLAGS = { '--defer-reason': 'deferReason', '--severity': 'severity', '--size': 'size', '--priority': 'priority', '--risk': 'risk' };
const ACCEPTED = '--defer-reason, --severity, --size, --priority, --risk, --agent-raised, --human, --run, --help';
const DIGEST_KEY = 'deferral-digest-reasons';
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
  return { help, reason, input, runDir };
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

function run(argv, deps = realDeps) {
  const parsed = parseArgs(argv);
  if (parsed.help) { deps.stdout(USAGE); return 0; }
  const { input, runDir } = parsed;
  if (parsed.reason !== null) return printRefusal({ verdict: 'refused', rule: 'refused', reason: parsed.reason }, input, deps);
  const routeInput = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === null ? undefined : v]));
  // A routing refusal is decided with no digest list, so it needs no policy read.
  const pre = routeDeferral({ ...routeInput, digestReasons: [] });
  if (pre.verdict === 'refused') return printRefusal(pre, input, deps);

  let out;
  try {
    out = resolvePolicy({ keys: [DIGEST_KEY], runDir }, callerDeps({ cwd: deps.cwd(), env: deps.env }));
  } catch (err) {
    deps.stderr(`deferral-route: ${err && err.message ? err.message : err}\n`);
    return 1;
  }
  if (out.code !== EXIT_OK) {
    deps.stderr(`deferral-route: ${out.message}\n`);
    return 1;
  }
  const entry = out.result[DIGEST_KEY];
  // The resolver returns this list key in two shapes (policy-schema.js resolveValue):
  // an array ([] when unset, invalid, or the explicit `[]` the row's emptyList
  // allows) or, for a configured list, the raw comma-separated string. Split only
  // the string; an array is already the list.
  let digestReasons = [];
  if (entry.invalid) {
    deps.stderr(`deferral-route: warning: ${DIGEST_KEY} has invalid element "${firstBadElement(out.invalidRaw.get(DIGEST_KEY))}" — using the default (no reasons)\n`);
  } else {
    digestReasons = Array.isArray(entry.value) ? entry.value : String(entry.value).split(',').map((reason) => reason.trim());
  }
  const result = routeDeferral({ ...routeInput, digestReasons });
  deps.stdout(JSON.stringify({ ...result, input }) + '\n');
  return 0;
}

module.exports = { run, realDeps, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
