#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { readTsv } = require('./lib/calibration/tsv-reader.js');
const { readEventsKinds } = require('./lib/calibration/events-reader.js');
const { aggregate } = require('./lib/calibration/aggregate.js');
const { ROW_IDS } = require('./lib/wrap-up/registry.js');
const { lstatType } = require('./lib/path-guard/index.js');
const { resolveAgainst } = require('./lib/health-core/io.js');
const { resolvePolicy, callerDeps, scalarValue, warningLines, EXIT_OK } = require('./resolve-policy');

// -> { runs, json, root, displayRoot } or { error }. `root` is what the reads use
// (a relative --root resolved against cwd); `displayRoot` is the spelling the
// "no telemetry yet" line prints (the --root value as given, else cwd).
function parseArgs(argv, cwd) {
  const out = { runs: 20, json: false, root: cwd, displayRoot: cwd };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') {
      const raw = argv[++i];
      const parsed = Number(raw);
      // A non-numeric or missing value must fail loudly, not silently widen
      // the window: aggregate()'s `slice(-windowN)` treats NaN as 0, which
      // Array.prototype.slice reads as "the whole array" — so an unvalidated
      // typo like `--runs abc` would silently report over unlimited history
      // instead of the requested window. Review finding #901.
      if (raw === undefined || !Number.isFinite(parsed) || parsed <= 0) {
        return { error: `--runs requires a positive number, got: ${raw}` };
      }
      out.runs = parsed;
    } else if (a === '--json') out.json = true;
    else if (a === '--root') {
      // A missing value used to reach resolveAgainst(cwd, undefined) and throw
      // an uncaught TypeError (exit 1); refuse it like --runs does.
      if (argv[i + 1] === undefined) return { error: '--root requires a value' };
      out.displayRoot = argv[++i];
      out.root = resolveAgainst(cwd, out.displayRoot);
    } else return { error: `unknown flag: ${a}` };
  }
  return out;
}

function readDecisionLines(decisionsPath) {
  try {
    return fs.readFileSync(decisionsPath, 'utf8').split('\n').filter(Boolean);
  } catch {
    // Missing, or unreadable due to a TOCTOU race with a concurrent archive
    // job — review finding #901, same rationale as tsv-reader.js/readTsv.
    return [];
  }
}

function loadRuns(root) {
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive');
  if (!fs.existsSync(archiveDir)) return null;
  const runIds = fs.readdirSync(archiveDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  return runIds.map((runId) => {
    const dir = path.join(archiveDir, runId);
    const decisionLines = readDecisionLines(path.join(dir, 'decisions.md'));
    const events = readEventsKinds(path.join(dir, 'events.jsonl')) || { counts: {} };
    return { runId, decisionLines, events };
  });
}

// A finished run still awaiting archival has a live dir under
// pipelines/{runId}/ — load it so the newest runs aren't empty stubs. Only a
// single path segment is a dir name, and lstat (not stat) keeps a symlink at
// pipelines/{runId} from redirecting the read; anything else stays an empty stub.
function loadLiveRun(root, runId) {
  const emptyRun = { runId, decisionLines: [], events: { counts: {} } };
  const isDirName = /^[^/\\]+$/.test(runId) && runId !== '.' && runId !== '..';
  if (!isDirName) return emptyRun;
  const liveDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  if (lstatType(liveDir).type !== 'directory') return emptyRun;
  return {
    runId,
    decisionLines: readDecisionLines(path.join(liveDir, 'decisions.md')),
    events: readEventsKinds(path.join(liveDir, 'events.jsonl')) || { counts: {} },
  };
}

// The policy core resolves its project root via `git rev-parse --show-toplevel`
// at the cwd it is given (never from a run value — its `--run` names a pipeline
// run directory's config.yml overlay, a different concept entirely), so `root`
// is passed as that cwd to read `root`'s own policy.yml. In-process, so no
// child process: whatever the spawned `--values autonomy` call forwarded to
// the parent's stderr (library notes, then the invalid-value warning) goes to
// deps.stderr.
function resolveAutonomyCeiling(root, deps) {
  try {
    const keys = ['autonomy'];
    const out = deps.resolvePolicy({ keys }, callerDeps({ cwd: root, env: deps.env, homeDir: deps.homeDir, stderr: deps.stderr }));
    if (out.code !== EXIT_OK) return 'unknown';
    for (const line of warningLines({ keys, ...out }, { values: true })) deps.stderr(line);
    return scalarValue(out.result.autonomy);
  } catch {
    return 'unknown';
  }
}

function renderText(result, ceiling) {
  const lines = [];
  lines.push('## Calibration read-out');
  lines.push('');
  const { excluded } = result.window;
  const excludedNote = excluded > 0
    ? `; ${excluded} run id${excluded === 1 ? '' : 's'} without a timestamp excluded`
    : '';
  lines.push(`Window: last ${result.window.runIds.length} archived run(s)${excludedNote}.`);
  lines.push('');
  lines.push('### Per-registry-row finding rate');
  for (const [rowId, v] of Object.entries(result.perRow)) {
    lines.push(v === 'no runs in window' ? `- ${rowId}: no runs in window` : `- ${rowId}: ${v.findings} findings across ${v.appearances} runs`);
  }
  lines.push('');
  lines.push('### Console terminal-decision distribution');
  for (const [k, v] of Object.entries(result.consoleDist)) lines.push(`- ${k}: ${v}`);
  lines.push('');
  lines.push('### Reversibility distribution');
  for (const [k, v] of Object.entries(result.reversibilityDist)) lines.push(`- ${k}: ${v}`);
  lines.push('');
  lines.push('### Friction events');
  if (Object.keys(result.frictionCounts).length === 0) lines.push('- none');
  for (const [k, v] of Object.entries(result.frictionCounts)) lines.push(`- ${k}: ${v}`);
  lines.push('');
  lines.push(`### Refused proposals: ${result.refusedCount}`);
  lines.push('');
  lines.push(`### Failed writes: ${result.failedCount}`);
  lines.push('');
  if (result.narrowingSignal && result.narrowingSignal.length) {
    for (const rowId of result.narrowingSignal) {
      lines.push(`Consider narrowing the gate for row "${rowId}" (0 findings, ${result.perRow[rowId].appearances} runs).`);
      lines.push(`node "${path.join(__dirname, 'calibration-report.js')}" --runs 50`);
    }
  }
  if (!result.suppressions.ceiling && result.consoleDist['approve-all'] > 0 &&
      (result.consoleDist['approve-all'] / Math.max(1, Object.entries(result.consoleDist).filter(([k]) => k !== 'unlogged').reduce((s, [, v]) => s + v, 0))) === 1 &&
      ceiling === 'supervised') {
    lines.push('Consider raising autonomy from supervised to trusted (ceiling read at report time — stops earlier in the window may predate the current setting).');
    lines.push(
      'node -e "const fs=require(\'fs\');const p=\'.claude-tweaks/policy.yml\';' +
      'let t=fs.existsSync(p)?fs.readFileSync(p,\'utf8\'):\'\';' +
      't=/^autonomy:/m.test(t)?t.replace(/^autonomy:.*$/m,\'autonomy: trusted\'):t+\'autonomy: trusted\\n\';' +
      'fs.writeFileSync(p,t)"',
    );
  }
  if (result.suppressions.narrowing.length) {
    lines.push(`(Suppressed narrowing signals — under 10 appearances: ${result.suppressions.narrowing.join(', ')})`);
  }
  if (result.suppressions.ceiling) {
    lines.push('(Ceiling signal suppressed — fewer than 10 console stops in this window.)');
  }
  return lines.join('\n') + '\n';
}

function run(argv, deps) {
  const args = parseArgs(argv, deps.cwd());
  if (args.error !== undefined) {
    deps.stderr(`${args.error}\n`);
    return 2;
  }
  const tsvPath = path.join(args.root, '.claude-tweaks', 'wrap-up-outcomes.tsv');
  const tsv = readTsv(tsvPath);
  if (!tsv) {
    deps.stdout(`no telemetry yet (${path.join(args.displayRoot, '.claude-tweaks', 'wrap-up-outcomes.tsv')} absent)\n`);
    return 0;
  }
  const loaded = loadRuns(args.root);
  // No archive dir yet is a normal state (a project's first run awaits its
  // first archival): live-dir stubs below still apply, so only an empty
  // result after them is "no archived runs".
  const archiveAbsent = loaded === null;
  const runs = loaded || [];
  if (tsv.rows.length > 0) {
    // #917: a partially-pruned archive (older run dirs archived-then-deleted
    // while wrap-up-outcomes.tsv persists) must not silently drop TSV rows
    // whose runId has no matching archived dir. Synthesize a stub for every
    // TSV runId missing from the loaded archive, not just the all-empty case
    // — this subsumes the pre-#917 all-empty branch (existingRunIds is empty
    // there, so every TSV runId gets a stub, same as before).
    const existingRunIds = new Set(runs.map((r) => r.runId));
    const tsvRunIds = new Set(tsv.rows.map((r) => r.runId));
    for (const runId of tsvRunIds) {
      if (!existingRunIds.has(runId)) {
        runs.push(loadLiveRun(args.root, runId));
      }
    }
  }
  if (archiveAbsent && runs.length === 0) {
    deps.stdout('no archived runs found\n');
    return 0;
  }
  const result = aggregate({ tsv, runs, rowIds: ROW_IDS, windowN: args.runs });
  const ceiling = resolveAutonomyCeiling(args.root, deps);
  if (args.json) deps.stdout(JSON.stringify(result) + '\n');
  else deps.stdout(renderText(result, ceiling));
  return 0;
}

const realDeps = {
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  cwd: () => process.cwd(),
  env: process.env,
  homeDir: () => os.homedir(),
  resolvePolicy,
};

module.exports = { run, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
