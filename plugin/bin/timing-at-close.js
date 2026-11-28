#!/usr/bin/env node
// bin/timing-at-close.js — the background token pass for an archived run's timing.json (#5555).
//   node bin/timing-at-close.js --run <run-dir> [--help]
// The reconciler's archive path writes phase rows synchronously, then starts this CLI detached
// (lib/timing/at-close.js's spawnTokenPass) to add token totals from the run's own transcript (a dispatched run also counts the Task-call transcripts naming it).
// The same pass also fills the run's manifest.json (#6009): closedAt, minutes and the list-price cost group.
// Sanctioned-writer exit codes: 0 timing.json written or kept (its path on stdout; a spec-N
// child of a multi-record run gets a one-line note instead — the parent's file covers it);
// 2 malformed invocation; 3 the run dir is missing, not a directory, or not anchored under the
// main checkout (a worktree-local shadow, or a directory outside pipelines/, [IL-127]: refused before any write, like the other
// sanctioned writers), or timing.json could not be written (the run's decisions.md already holds
// the SKIP line). No 1 at all.
'use strict';

const path = require('path');
const { resolveAgainst } = require('./lib/health-core/io');
const { lstatType } = require('./lib/path-guard');
const { resolveTarget } = require('./lib/stage-item/write');
const { writeTimingAtClose } = require('./lib/timing/at-close');

const USAGE = 'usage: timing-at-close.js --run <run-dir> [--help]\n';

function parseArgs(argv) {
  const o = { run: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run') {
      const v = argv[++i];
      // A flag in place of the value (`--run --help`) is a missing value, not a run dir named "--help".
      if (v === undefined || v === '' || v.startsWith('--')) return { error: '--run requires a <run-dir> argument' };
      o.run = v;
    } else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: () => process.cwd(),
  mainRoot: undefined, // resolved from cwd by resolveTarget; a test injects it
  env: process.env,
  homeDir: () => require('os').homedir(),
};

async function run(argv, deps = {}) {
  deps = { ...realDeps, ...deps };
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`timing-at-close.js: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) { deps.stderr(`timing-at-close.js: --run <run-dir> is required\n${USAGE}`); return 2; }
  const runDir = resolveAgainst(deps.cwd(), o.run);
  // lstat, deliberately: a symlinked run dir exits 3 too. The token pass is spawned with the
  // archive's real directory, so a link here is never followed into wherever it points.
  if (lstatType(runDir).type !== 'directory') {
    deps.stderr(`timing-at-close.js: run dir does not exist or is not a directory: ${o.run}\n`);
    return 3;
  }
  let target;
  try { target = resolveTarget({ runDir, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) {
    deps.stderr(`timing-at-close.js: ${err && err.message}\n`);
    return 3;
  }
  if (!target.ok) {
    deps.stderr(`timing-at-close.js: run dir is not anchored under the main checkout's .claude-tweaks/pipelines (a worktree-local shadow, or a directory outside pipelines/): ${o.run} — pass the main-checkout path (_shared/pipeline-run-dir.md's Anchoring section)\n`);
    return 3;
  }
  const r = await writeTimingAtClose(runDir, { tokens: true, env: deps.env, homeDir: deps.homeDir });
  if (r.status === 'written' || r.status === 'kept') {
    deps.stdout(path.join(runDir, 'timing.json') + '\n');
    return 0;
  }
  if (r.status === 'not-top-level') {
    deps.stdout(`timing-at-close.js: ${runDir} is a spec-N child of a multi-record run — nothing written, the parent run's timing.json covers it\n`);
    return 0;
  }
  deps.stderr(`timing-at-close.js: could not write timing.json in ${runDir}${r.skip ? ` — ${r.skip}` : ''}\n`);
  return 3;
}

module.exports = { run, parseArgs, realDeps };

if (require.main === module) run(process.argv.slice(2), realDeps).then((c) => { process.exitCode = c; });
