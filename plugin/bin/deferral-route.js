#!/usr/bin/env node
// bin/deferral-route.js — where a legitimately-deferred item goes (#5930): a
// filed record or the digest, decided in code instead of re-derived from
// _shared/materiality-floor.md's prose each time.
//   node bin/deferral-route.js --defer-reason <reason> (--agent-raised | --human)
//        [--severity <critical|high|medium|low|info>] [--size <v>] [--priority <v>]
//        [--risk <v>] [--help]
// Prints one JSON line on stdout: {verdict: file|digest|refused, rule, reason
// (refused only), input} — `input` is the inputs as given, absent ones null,
// agentRaised true for --agent-raised, false for --human, null for neither or
// both. A refusal also prints its reason as one stderr line. The decision is
// routeDeferral (bin/lib/deferral-route/route.js, pure); this file only parses
// flags, refuses parse-level problems itself, and prints.
// Exit 0 a verdict (file or digest) or --help; 2 refused. There is no exit 1.
// Writes nothing and makes no gh call.
'use strict';

const { routeDeferral } = require('./lib/deferral-route/route');

const USAGE = 'usage: deferral-route.js --defer-reason <reason> (--agent-raised | --human) [--severity <critical|high|medium|low|info>] [--size <v>] [--priority <v>] [--risk <v>] [--help]\n';
const VALUE_FLAGS = { '--defer-reason': 'deferReason', '--severity': 'severity', '--size': 'size', '--priority': 'priority', '--risk': 'risk' };
const ACCEPTED = '--defer-reason, --severity, --size, --priority, --risk, --agent-raised, --human, --help';
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
  const refuse = (text) => { if (reason === null) reason = text; };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--help' || token === '-h') { help = true; continue; }
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
  return { help, reason, input };
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const parsed = parseArgs(argv);
  if (parsed.help) { deps.stdout(USAGE); return 0; }
  const { input } = parsed;
  const result = parsed.reason !== null
    ? { verdict: 'refused', rule: 'refused', reason: parsed.reason }
    : routeDeferral(Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === null ? undefined : v])));
  deps.stdout(JSON.stringify({ ...result, input }) + '\n');
  if (result.verdict === 'refused') { deps.stderr(result.reason + '\n'); return 2; }
  return 0;
}

module.exports = { run, realDeps, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
