#!/usr/bin/env node
'use strict';
// tools/review-replay.js — replays archived review runs through the tiebreak judge and scores the agreement (#5557).
//
//   node tools/review-replay.js baseline --runs <root> [--select <name,...>]
//   node tools/review-replay.js extract --runs <root> --out <dir> --arm name=<id>,chunk=<n>,profile=<profile>[,effort=<low|medium|high|xhigh|max>],repeat=<n> ...
//
// baseline: reads every archived run directory under <root> and <root>/archive and prints one JSON object
// { runs, excluded }: per run the recorded verdicts and how they matched the findings, the review head and base, the
// lens and tiebreak agent cost. A run that cannot be replayed is listed in `excluded` with its reason, never dropped.
//
// extract: selects the replayable findings and writes trees, judge prompts per arm, manifest.json, fixture.json and
// archived-verdicts.json under <dir> (tools/review-replay/extract.js). An arm's `effort=` replaces its profile's effort.
//
// score: settles every replay judge's reply through plugin/bin/lib/tiebreak.js and prints the agreement with the archived
// verdicts and the cost per arm as one JSON object (tools/review-replay/score.js); --transcripts is the workflow's
// directory holding journal.jsonl and agent-{id}.jsonl. score checks every arm whose effort is not null (from `effort=` or
// its profile; only `fast` without `effort=` is null) against the effort each judge recorded.
//
// counterfactual: had each lens run one reviewer instead of a pair, how many confirmed findings would still have been
// raised; reads each lens agent's own findings table from --transcripts (a directory searched recursively for
// agent-{id}.jsonl). A transcript with no table is unreadable, reported and kept out of the shares
// (tools/review-replay/counterfactual.js).
//
// Exit codes (as tools/driver-merge-check-eval.js): 0 ok; 1 a runtime failure; 2 a malformed invocation; 3 not a clean
// result (extract shortfall or empty set, score with any notJudged, counterfactual with an unreadable transcript, a
// lens with one reviewer or no pair at all).
//
// Seam: run({ argv, deps }) returns the exit code. deps: fs, git(args) -> stdout (throws), writeTree(head, destDir),
// log(line), err(line), pluginRoot.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readRun, selectRuns, matchVerdicts } = require('./review-replay/archive.js');
const { extract } = require('./review-replay/extract.js');
const { score } = require('./review-replay/score.js');
const { counterfactual } = require('./review-replay/counterfactual.js');
const { VERDICT_CLASSES, RUN_RECORDS_DIR } = require('./review-replay/schema.js');

const USAGE = [
  'usage: node tools/review-replay.js baseline --runs <root> [--select <name,...>]',
  '       node tools/review-replay.js extract --runs <root> --out <dir> --arm name=<id>,chunk=<n>,profile=<profile>[,effort=<low|medium|high|xhigh|max>],repeat=<n> [--arm ...]',
  '               [--select <name,...>] [--min-runs <n>] [--min-findings <n>] [--quota <sev>=<n>,...] [--template <path>] [--dispatch-core <path>]',
  '       node tools/review-replay.js score --out <extract dir> --transcripts <workflow dir> [--reference <arm>]',
  '       node tools/review-replay.js counterfactual --runs <root> --transcripts <dir> [--select <name,...>]',
].join('\n');
const COMMAND_FLAGS = {
  baseline: new Set(['--runs', '--select']),
  extract: new Set(['--runs', '--select', '--out', '--min-runs', '--min-findings', '--quota', '--arm', '--template', '--dispatch-core']),
  score: new Set(['--out', '--transcripts', '--reference']),
  counterfactual: new Set(['--runs', '--select', '--transcripts']),
};

function defaultDeps() {
  const cwd = process.cwd(); // the repo the CLI runs in, captured once
  const git = (args) => String(execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 256 * 1024 * 1024, windowsHide: true }));
  return {
    fs,
    git,
    // The tree at `head` without the archived runs' own records (RUN_RECORDS_DIR), so a replay judge never sees them.
    writeTree: (head, destDir) => {
      fs.mkdirSync(destDir, { recursive: true });
      const archive = execFileSync('git', ['archive', head, '--', '.', `:(exclude)${RUN_RECORDS_DIR}`], { cwd, maxBuffer: 1 << 30, windowsHide: true });
      // cwd, not -C: Git's GNU tar reads a drive-letter path ("D:\...") as host:path and fails to open it on Windows.
      execFileSync('tar', ['-x', '-f', '-'], { cwd: destDir, input: archive, windowsHide: true });
    },
    log: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
    pluginRoot: path.join(__dirname, '..', 'plugin'),
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!Object.prototype.hasOwnProperty.call(COMMAND_FLAGS, command)) return { error: command ? `unknown command: ${command}` : 'a command is required' };
  const opts = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!COMMAND_FLAGS[command].has(arg)) return { error: `unknown argument: ${arg}` };
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `${arg} requires a value` };
    i += 1;
    if (arg === '--arm') opts.arms = [...(opts.arms || []), value];
    else opts[arg.slice(2)] = value;
  }
  const required = { score: ['out', 'transcripts'], counterfactual: ['runs', 'transcripts'] }[command] || ['runs'];
  for (const key of required) if (!opts[key]) return { error: `${command} requires --${key}` };
  if (opts.select !== undefined) {
    opts.select = opts.select.split(',').map((s) => s.trim()).filter(Boolean);
    if (opts.select.length === 0) return { error: '--select requires at least one run name' };
  }
  return { opts };
}

const errText = (e) => String((e && e.message) || e).split('\n')[0];

// How a run's verdict lines matched its findings, for the baseline output.
function matchSummary(r) {
  if (!r.findings) return null;
  const m = matchVerdicts(r.findings, r.verdicts, r.failedJudges);
  const matched = Object.fromEntries(VERDICT_CLASSES.map((c) => [c, 0]));
  for (const v of m.byId.values()) matched[v] += 1;
  return {
    matched, fallbackMatched: m.fallbackMatched, verdictsWithoutFinding: m.verdictsWithoutFinding,
    findingsWithoutVerdict: m.findingsWithoutVerdict, failedJudgeByReason: m.failedJudgeByReason,
  };
}

// A run in the baseline output: no findings (they carry the claim text) and no dispatch bundle text.
function baselineEntry(r) {
  const { findings, dispatchBundle, ...rest } = r;
  return { ...rest, findingCount: findings ? findings.length : null, hasDispatchBundle: dispatchBundle !== null, match: matchSummary(r) };
}

function baseline(opts, deps) {
  const { dirs, missing } = selectRuns(opts.runs, opts.select, deps.fs);
  if (missing.length > 0) {
    deps.err(`review-replay.js: no such run under ${opts.runs}: ${missing.join(', ')}`);
    return 2;
  }
  const runs = [];
  const excluded = [];
  for (const dir of dirs) {
    const r = readRun(dir, deps);
    if (r.excluded) excluded.push({ run: r.run, reason: r.excluded });
    else runs.push(baselineEntry(r));
  }
  deps.log(JSON.stringify({ runs, excluded }, null, 2));
  return 0;
}

async function run({ argv, deps } = {}) {
  const d = deps || defaultDeps();
  const parsed = parseArgs(argv || []);
  if (parsed.error) {
    d.err(`review-replay.js: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  try {
    const { command } = parsed.opts;
    if (command === 'extract') return extract(parsed.opts, d);
    if (command === 'counterfactual') return counterfactual(parsed.opts, d);
    return command === 'score' ? score(parsed.opts, d) : baseline(parsed.opts, d);
  } catch (e) {
    d.err(`review-replay.js: ${errText(e)}`);
    return 1;
  }
}

module.exports = { run, parseArgs, defaultDeps };

if (require.main === module) {
  run({ argv: process.argv.slice(2), deps: defaultDeps() }).then((code) => { process.exitCode = code; });
}
