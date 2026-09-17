#!/usr/bin/env node
// bin/check-pr-bookkeeping.js -- phase-boundary bookkeeping precondition
// check: does this run comply with its pr-first bookkeeping contract
// (record-worktree stamped, and under integration-model: pr-first, either a
// recorded PR, a durable prExempt, or a logged PR-early-lifecycle FAILED
// degrade line)?
//
// Complements pre-tool-use.js's checkBookkeepingStampsGate (per-tool-call
// enforcement keyed off an ambiguously-resolved ctx.runDir) with an explicit
// check at a KNOWN run dir, callable at a pipeline phase boundary
// (/claude-tweaks:test's entry, where $PIPELINE_RUN_DIR is already known
// rather than resolved ambiguously) -- #2472.
//
//   node bin/check-pr-bookkeeping.js --run <run-dir> [--help]
//
// Exit 0 ok (compliant, or nothing to check yet); 2 malformed invocation;
// 3 run dir missing OR not anchored under the main checkout (a worktree-local
// shadow -- _shared/pipeline-run-dir.md's Anchoring section, [IL-127]); 4
// bookkeeping precondition violated (HARD-GATE finding -- the caller should
// stop the pipeline and surface stderr verbatim).
'use strict';

const { checkPrBookkeepingPrecondition } = require('./lib/pr-bookkeeping/precondition');
const { resolveTarget } = require('./lib/log-decision/append');

const USAGE = 'usage: check-pr-bookkeeping.js --run <run-dir> [--help]\n';

function parseArgs(argv) {
  const o = { run: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run') o.run = next();
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`check-pr-bookkeeping.js: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) { deps.stderr(`check-pr-bookkeeping.js: --run <run-dir> is required\n${USAGE}`); return 2; }
  const target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot });
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`check-pr-bookkeeping.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`check-pr-bookkeeping.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }
  const result = checkPrBookkeepingPrecondition({ runDir: o.run, cwd: deps.cwd() });
  if (result.ok) {
    deps.stdout(`check-pr-bookkeeping.js: ok (${result.reason})\n`);
    return 0;
  }
  deps.stderr(`check-pr-bookkeeping.js: ${result.message}\n`);
  return 4;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
