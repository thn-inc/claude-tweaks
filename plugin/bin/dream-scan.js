#!/usr/bin/env node
// bin/dream-scan.js — cross-session self-healing pass (#2691).
//   node bin/dream-scan.js --run-dir <dir> [--config-dir <dir>] [--window-days N]
//     [--min-sessions N] [--max-proposals N] [--help]
//
// Scans this account's own Claude Code session transcripts
// (`{config-dir}/projects/*/*.jsonl`, default config-dir: $CLAUDE_CONFIG_DIR
// or ~/.claude) for tool-call failures whose signature repeats across two or
// more DISTINCT sessions within a bounded recent window, and stages one
// propose-only markdown writeup per qualifying pattern under
// `{run-dir}/staged/`, with quoted evidence from each contributing session.
//
// Exit 0: scan completed (zero or more proposals staged — zero is a normal,
//   reportable outcome, not a failure). Exit 2: malformed invocation,
//   including `--min-sessions` below the two-session floor — that floor is
//   not configurable downward, by design (the record's own Gotchas: a
//   single-session anomaly must never produce a proposal). Exit 3: --run-dir
//   missing or not anchored under the main checkout (same anchoring rule as
//   stage-item.js / log-decision.js — see _shared/pipeline-run-dir.md).
//
// Structural propose-only guarantee: this CLI's only writes are (a) the two
// already-sanctioned run-dir writers it imports (stage-item's
// writeStagedItem, log-decision's appendEntry — both confined to the
// resolved run dir) and (b) its own report.md, written at a fixed path
// (`{run-dir}/report.md`) it composes itself. There is no flag or code path
// here that accepts an arbitrary output path, so this tool cannot reach
// CLAUDE.md or any plugin/skills/**/*.md file even on a bug.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveTarget: resolveStageTarget, writeStagedItem,
} = require('./lib/stage-item/write');
const { run: logDecision } = require('./log-decision');
const {
  DEFAULT_WINDOW_DAYS, MIN_SESSIONS_FLOOR, runScan, composeProposalMarkdown, composeReportMarkdown,
} = require('./lib/dream/scan');

const USAGE = 'usage: dream-scan.js --run-dir <dir> [--config-dir <dir>] [--window-days N] [--min-sessions N] [--max-proposals N] [--help]\n';
const DEFAULT_MAX_PROPOSALS = 10;

function parseArgs(argv) {
  const o = {
    runDir: null, configDir: null, windowDays: DEFAULT_WINDOW_DAYS, minSessions: MIN_SESSIONS_FLOOR, maxProposals: DEFAULT_MAX_PROPOSALS, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? null;
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--run-dir') o.runDir = next();
    else if (a === '--config-dir') o.configDir = next();
    else if (a === '--window-days') o.windowDays = Number(next());
    else if (a === '--min-sessions') o.minSessions = Number(next());
    else if (a === '--max-proposals') o.maxProposals = Number(next());
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  now: () => Date.now(),
  configDir: () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  writeFileSync: (p, c) => fs.writeFileSync(p, c),
  logDecision,
  writeStagedItem,
  resolveStageTarget,
  runScan,
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`dream-scan.js: ${message}\n${USAGE}`); return 2; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.runDir) return usageError('--run-dir <dir> is required');
  if (!Number.isFinite(o.windowDays) || o.windowDays <= 0) return usageError('--window-days must be a positive number');
  if (!Number.isFinite(o.minSessions) || o.minSessions < MIN_SESSIONS_FLOOR) {
    return usageError(`--min-sessions must be >= ${MIN_SESSIONS_FLOOR} — the two-session evidence bar is a floor, not a configurable default (a single-session anomaly must never produce a proposal)`);
  }
  if (!Number.isFinite(o.maxProposals) || o.maxProposals <= 0) return usageError('--max-proposals must be a positive number');

  let target;
  try { target = deps.resolveStageTarget({ runDir: o.runDir, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) {
    deps.stderr(`dream-scan.js: ${err && err.message}\n`);
    return 3;
  }
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`dream-scan.js: run dir does not exist: ${o.runDir}\n`);
    else deps.stderr(`dream-scan.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.runDir} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }
  const runDir = target.dir;
  const configDir = o.configDir || deps.configDir();

  const {
    scannedFiles, groups, qualifying,
  } = deps.runScan({
    configDir, windowDays: o.windowDays, minSessions: o.minSessions, now: deps.now(),
  });

  const proposals = [];
  for (const group of qualifying.slice(0, o.maxProposals)) {
    const content = composeProposalMarkdown(group, { windowDays: o.windowDays });
    let staged;
    try {
      staged = deps.writeStagedItem({
        runDir, id: 'dream-proposal-1', sourcePath: 'dream-proposal.md', content, allocate: true,
      });
    } catch (err) {
      deps.stderr(`dream-scan.js: could not stage proposal (${err && err.message})\n`);
      return 3;
    }
    proposals.push({ id: staged.id, group });
    const sessionList = [...group.sessionIds].slice(0, 3).join(', ');
    deps.logDecision([
      '--run', runDir, '--status', 'STAGED', '--section', '/dream-scan', '--step', `Pattern ${staged.id}`,
      '--text', `${group.toolName}/${group.commandVerb} recurred across ${group.sessionIds.size} sessions (${sessionList}${group.sessionIds.size > 3 ? ', …' : ''}). Staged at staged/${staged.id}.md for human review.`,
      '--reversibility', 'n/a',
    ], deps);
  }

  const report = composeReportMarkdown({
    scannedFiles, windowDays: o.windowDays, minSessions: o.minSessions, groupsConsidered: groups.length, proposals,
  });
  try {
    deps.writeFileSync(path.join(runDir, 'report.md'), report);
  } catch (err) {
    deps.stderr(`dream-scan.js: could not write report.md (${err && err.message})\n`);
    return 3;
  }

  deps.stdout(`dream-scan.js: scanned ${scannedFiles} file(s), ${groups.length} distinct signature(s), ${proposals.length} proposal(s) staged (of ${qualifying.length} qualifying).\n`);
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
