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
// extract-reviews: replays the archived lens reviewers (--role lens) rather than the tiebreak judge. Reads the archived run
// directories under --runs and each lens dispatch's transcript under --transcripts (its prompt and its reply), and writes,
// under <dir>, a clean two-commit repository per run and range (repos/{run}--r{k}/repo), each slot's rewritten context
// bundle, spec and procedure copies beside it, one prompt per arm and slot, reviews-manifest.json, reviews-fixture.json
// and archived-reports.json (tools/review-replay/reviews-extract.js). The archived shas and the worktree and main-checkout
// paths in a prompt are rewritten to the replay's; a path to another run's directory in a prompt or a copy is replaced
// with [run-directory path removed] (a relative mention of another run in diff text stays), and an archived worktree,
// main-checkout or own-run path left after rewriting excludes the slot as `unrewritten-path`, as does any absolute path
// naming a `.claude/worktrees/` or `.claude-tweaks/pipelines/` directory outside --out that exists on this machine (or
// cannot be checked: only ENOENT/ENOTDIR count as absent), so a
// --runs moved away from a checkout still present (the main checkout is taken as --runs/../..) excludes every slot rather
// than leaking; a dead path, such as one in test-fixture or comment text of the diff, stays as text. No archived reply text or
// decisions.md verdict line reaches a prompt, a repository or a copy. Alongside the --arm arms, a control arm reruns the
// slots at the tier and effort they were archived at: `control` when every selected slot shares one (tier, effort),
// otherwise `control.{tier}.{effort|none}` per group. A user arm named `control` or `control.*` exits 2.
// Three branch roles replay other reviewers the same way, with the range taken from the prompt's own `Base {sha} …
// Head {sha}` pair and --lens/--max-per-lens refused (tools/review-replay/reviews-branch.js). --role task replays each
// archived `task review` dispatch, its prompt read from the file a one-line pointer prompt names when it is one
// (`prompt-file-gone` when that file no longer exists), its archived verdict and located items kept. --role whole-branch
// replays each whole-branch review dispatch (guards.js's isWholeBranch), its Critical, Important and Minor items kept.
// --role task-vs-branch replays the run's whole-branch prompt against the head each `Needs fixes` task review reviewed,
// beside a control slot at the whole-branch prompt's own head, scored on that task review's items.
//
// score-reviews: reads the Workflow's replies from --transcripts and, per arm and lens, prints the confirmed findings the
// replay reviewers raised (recall, per slot and summed, over first passes only: a slot whose `ordinal` in
// reviews-fixture.json is above 1, i.e. not the first labelled dispatch of its unit, lens and side, excluded dispatches
// counted, re-reviews a later head where the confirmed findings may already be fixed, and is tallied apart in
// `confirmedRereview`; a slot whose
// unit has no decisions.md adds to `confirmedMissingSource`, not to the recall; `rowsUnlocated` counts severity rows with
// no path:line, which cannot raise a finding), the archived reviewers' rows they raised, the rows no archived reviewer
// raised (`new`) and the reference arm's rows they also raised. `fidelity` per lens aggregates every control arm's recall of
// the archived rows, the figure an arm's numbers are read against; `fixture.byLens` repeats what the extraction selected
// and excluded per lens (tools/review-replay/reviews-score.js). A reply that is missing, recorded at another effort than its
// arm's, or not a lens report is notJudged; a `No findings` reply is a scored review with zero rows.
//
// Exit codes (as tools/driver-merge-check-eval.js): 0 ok; 1 a runtime failure; 2 a malformed invocation; 3 not a clean
// result (extract shortfall or empty set, score with any notJudged, counterfactual with an unreadable transcript, a
// lens with one reviewer or no pair at all; extract-reviews with no replayable slot or fewer than --min-reviews, and
// score-reviews with any notJudged).
//
// Seam: run({ argv, deps }) returns the exit code. deps: fs, git(args) -> stdout (throws), writeTree(head, destDir),
// writeRepo(base, head, dest, { originRefs }) -> { base, head } (makeWriteRepo(cwd): the two-commit repository),
// log(line), err(line), pluginRoot.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readRun, selectRuns, matchVerdicts } = require('./review-replay/archive.js');
const { extract } = require('./review-replay/extract.js');
const { extractReviews } = require('./review-replay/reviews-extract.js');
const { score } = require('./review-replay/score.js');
const { scoreReviews } = require('./review-replay/reviews-score.js');
const { counterfactual } = require('./review-replay/counterfactual.js');
const { VERDICT_CLASSES, RUN_RECORDS_DIR } = require('./review-replay/schema.js');

const USAGE = [
  'usage: node tools/review-replay.js baseline --runs <root> [--select <name,...>]',
  '       node tools/review-replay.js extract --runs <root> --out <dir> --arm name=<id>,chunk=<n>,profile=<profile>[,effort=<low|medium|high|xhigh|max>],repeat=<n> [--arm ...]',
  '               [--select <name,...>] [--min-runs <n>] [--min-findings <n>] [--quota <sev>=<n>,...] [--template <path>] [--dispatch-core <path>]',
  '       node tools/review-replay.js score --out <extract dir> --transcripts <workflow dir> [--reference <arm>]',
  '       node tools/review-replay.js counterfactual --runs <root> --transcripts <dir> [--select <name,...>]',
  '       node tools/review-replay.js extract-reviews --runs <root> --out <dir> --role lens|task|whole-branch|task-vs-branch --transcripts <dir> --arm name=<id>,profile=<profile>[,effort=<low|medium|high|xhigh|max>],repeat=<n> [--arm ...]',
  '               [--select <name,...>] [--lens <id,...>] [--max-per-lens <n>] (--role lens only) [--min-reviews <n>]',
  '       node tools/review-replay.js score-reviews --out <dir> --transcripts <workflow dir> [--reference <arm>]',
].join('\n');
const COMMAND_FLAGS = {
  baseline: new Set(['--runs', '--select']),
  extract: new Set(['--runs', '--select', '--out', '--min-runs', '--min-findings', '--quota', '--arm', '--template', '--dispatch-core']),
  score: new Set(['--out', '--transcripts', '--reference']),
  counterfactual: new Set(['--runs', '--select', '--transcripts']),
  'extract-reviews': new Set(['--runs', '--out', '--role', '--arm', '--select', '--lens', '--max-per-lens', '--min-reviews', '--transcripts']),
  'score-reviews': new Set(['--out', '--transcripts', '--reference']),
};

// A clean repository at `dest` holding `base` then `head` of `sourceCwd` as two commits ("base", "head") with a fixed
// identity and date, so the same pair always yields the same replay shas. Returns { base, head }, the replay shas;
// each `originRefs` name gets refs/remotes/origin/{name} at the replay base.
function makeWriteRepo(sourceCwd) {
  const FIXED = { GIT_AUTHOR_NAME: 'review-replay', GIT_AUTHOR_EMAIL: 'review-replay@localhost', GIT_COMMITTER_NAME: 'review-replay', GIT_COMMITTER_EMAIL: 'review-replay@localhost', GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' };
  return (base, head, dest, { originRefs = [] } = {}) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
    // The literal '/dev/null', not os.devNull: git cannot open Windows' "\\.\nul" as a config path (#5666).
    Object.assign(env, FIXED, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
    const git = (args) => String(execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dest, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })).trim();
    const extractTree = (rev) => {
      const archive = execFileSync('git', ['archive', rev, '--', '.', `:(exclude)${RUN_RECORDS_DIR}`], { cwd: sourceCwd, maxBuffer: 1 << 30, windowsHide: true });
      // cwd, not -C: Git's GNU tar reads a drive-letter path ("D:\...") as host:path and fails to open it on Windows.
      execFileSync('tar', ['-x', '-f', '-'], { cwd: dest, input: archive, windowsHide: true });
    };
    fs.mkdirSync(dest, { recursive: true });
    git(['init', '-q', '-b', 'replay']);
    extractTree(base);
    git(['add', '-A', '-f']);
    git(['commit', '-q', '--allow-empty', '-m', 'base']);
    const replayBase = git(['rev-parse', 'HEAD']);
    git(['rm', '-rq', '--cached', '--ignore-unmatch', '.']);
    for (const entry of fs.readdirSync(dest)) if (entry !== '.git') fs.rmSync(path.join(dest, entry), { recursive: true, force: true });
    extractTree(head);
    git(['add', '-A', '-f']);
    git(['commit', '-q', '--allow-empty', '-m', 'head']);
    const replayHead = git(['rev-parse', 'HEAD']);
    for (const name of originRefs) git(['update-ref', `refs/remotes/origin/${name}`, replayBase]);
    return { base: replayBase, head: replayHead };
  };
}

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
    writeRepo: makeWriteRepo(cwd),
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
  const required = { score: ['out', 'transcripts'], counterfactual: ['runs', 'transcripts'], 'extract-reviews': ['runs', 'out', 'role', 'transcripts'], 'score-reviews': ['out', 'transcripts'] }[command] || ['runs'];
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
    if (command === 'extract-reviews') return extractReviews(parsed.opts, d);
    if (command === 'score-reviews') return scoreReviews(parsed.opts, d);
    if (command === 'counterfactual') return counterfactual(parsed.opts, d);
    return command === 'score' ? score(parsed.opts, d) : baseline(parsed.opts, d);
  } catch (e) {
    d.err(`review-replay.js: ${errText(e)}`);
    return 1;
  }
}

module.exports = { run, parseArgs, defaultDeps, makeWriteRepo };

if (require.main === module) {
  run({ argv: process.argv.slice(2), deps: defaultDeps() }).then((code) => { process.exitCode = code; });
}
