#!/usr/bin/env node
// bin/review-routing-line.js — compose one /review Step 3 Routing line and append it to a run's decisions.md (#4488).
//   node bin/review-routing-line.js --run <run-dir> --route auto|staged|kept-prompt --severity low|medium|high|critical \
//     --category <text> --at <file:line> [--stage-path staged/review-{n}.patch|staged/review-followup-{n}.md] [--commit <sha>] [--spec <n>] [--lever "<k>=<v> (<source>)"]
//     [--rederived-onto <patch> | --conflict <patch> --conflicts-with <patch> --stack-stderr <line> | --stack-exit 2|3|4 --stack-stderr <line>] [--help]
// The last group is a staged patch's non-clean Stacked check outcome (_shared/staged-patch.md), carried on its STAGED line.
// The composer (bin/lib/log-decision/review-routing.js) fixes the text, so the literal tokens /claude-tweaks:release
// Step 3 classifies by are never hand-typed. The write is log-decision.js's, under the `## /review` section.
// Exit 0 appended (line echoed to stdout); 2 malformed invocation or an invalid route/severity/flag combination; 3 run dir
// missing or not anchored under the main checkout (a worktree-local shadow — _shared/pipeline-run-dir.md), from log-decision.js.
'use strict';

const { composeRoutingLine, ROUTING_STEP } = require('./lib/log-decision/review-routing');
const { run: logDecision } = require('./log-decision');

const USAGE = 'usage: review-routing-line.js --run <run-dir> --route auto|staged|kept-prompt --severity low|medium|high|critical --category <text> --at <file:line> [--stage-path staged/review-{n}.patch|staged/review-followup-{n}.md] [--commit <sha>] [--spec <n>] [--lever "<k>=<v> (<source>)"] [--rederived-onto <patch> | --conflict <patch> --conflicts-with <patch> --stack-stderr <line> | --stack-exit 2|3|4 --stack-stderr <line>] [--help]\n';

const FLAGS = {
  '--run': 'run',
  '--route': 'route',
  '--severity': 'severity',
  '--category': 'category',
  '--at': 'at',
  '--stage-path': 'stagePath',
  '--commit': 'commit',
  '--spec': 'spec',
  '--lever': 'lever',
  '--rederived-onto': 'rederivedOnto',
  '--conflict': 'conflict',
  '--conflicts-with': 'conflictsWith',
  '--stack-exit': 'stackExit',
  '--stack-stderr': 'stackStderr',
};

function parseArgs(argv) {
  const o = Object.fromEntries(['run', ...Object.values(FLAGS)].map((k) => [k, null]));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (!Object.hasOwn(FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[++i];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} requires a value` };
    o[FLAGS[a]] = v;
  }
  return o;
}

const realDeps = {
  now: () => Date.now(),
  cwd: () => process.cwd(),
  mainRoot: undefined,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`review-routing-line.js: ${message}\n` + USAGE); return 2; };
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (o.error) return usageError(o.error);
  if (!o.run) return usageError('--run <run-dir> is required');
  const composed = composeRoutingLine(o);
  if (composed.error) return usageError(composed.error);
  const args = ['--run', o.run, '--status', composed.status, '--step', ROUTING_STEP, '--section', '/review', '--reversibility', composed.reversibility, '--text', composed.text];
  if (o.spec !== null) args.push('--spec', o.spec);
  if (o.lever !== null) args.push('--lever', o.lever);
  return logDecision(args, deps);
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
