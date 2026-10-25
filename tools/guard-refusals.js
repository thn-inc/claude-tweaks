#!/usr/bin/env node
'use strict';
// tools/guard-refusals.js — #4028: counts the Bash calls Claude Code's worktree-isolation guard refused
// ("This session is isolated in the worktree … Refusing to run it …") across the local transcript store,
// and says, for each, which refusal reason it was, which static detector shape it matches, and which
// skill fence it was copied from. It is the instrument for the per-pipeline refusal count.
//
//   node tools/guard-refusals.js [--projects-dir <dir>] [--match <slug-substring>] [--since-days <n>=14]
//                                [--until <iso>=now] [--skills-root <dir>] [--json] [--help]
//
// --projects-dir defaults to $CLAUDE_CONFIG_DIR/projects, else ~/.claude/projects. --skills-root defaults
// to this checkout's plugin/skills. The scan window is [until - since-days, until) over file mtimes.
//
// Output (--json prints it; otherwise a short table): { window, files, unreadable, calls, refusals,
// perPipeline: { runs, attributedRefusals, unattributedRefusals, mean, median }, byReason, byShape, byFence, top }.
//   calls       unique Bash + Write tool_use ids; refusals: those whose result carries the isolation refusal
//   unreadable  files, directories and JSON lines the walk could not read (a store that changes mid-walk)
//   perPipeline the measure for "guard refusals per pipeline". runs: every pipeline run whose id timestamp
//               (YYYY-MM-DDTHHMMSS, UTC) lies in the window and that a Bash or Write call in the scanned files
//               names (or that a refusal was attributed to), whether or not it was refused. attributedRefusals:
//               refusals attributed to one of those
//               runs; unattributedRefusals: the rest (no run named, or a run outside the window). mean and
//               median: attributedRefusals per run over that denominator, so a clean run counts as 0.
//               A refusal's run is the nearest run id the same file named before the call; a subagent file
//               that names none inherits its parent session's run (see transcripts.js).
//   byShape     detector ids (tools/guard-refusals/shapes.js, a command may match several) plus
//               `unclassified` for a refusal no detector flags
//   byFence     `file:line` of the skill fence a refusal's command was copied from -> refusals
//   top         up to 20 sample commands per reason, cut to 300 chars
//
// Exit codes: 0 success; 2 malformed invocation, a missing --projects-dir / --skills-root, or a
// --projects-dir / --skills-root that exists but cannot be read, up front or mid-scan.
//
// Seam: run({ argv, deps }) returns the exit code; deps holds fs, env, now, homedir, log and err.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanStore } = require('./guard-refusals/transcripts');
const { REASONS, buildFenceIndex, traceFence } = require('./guard-refusals/trace');
const { detectShapes } = require('./guard-refusals/shapes');

const USAGE = [
  'usage: node tools/guard-refusals.js [--projects-dir <dir>] [--match <slug-substring>] [--since-days <n>=14]',
  '                                    [--until <iso>=now] [--skills-root <dir>] [--json] [--help]',
].join('\n');

const DAY_MS = 86400e3;
const TOP_PER_REASON = 20;
const TOP_COMMAND_CHARS = 300;
const SPEC = {
  '--projects-dir': 'value', '--match': 'value', '--since-days': 'value', '--until': 'value',
  '--skills-root': 'value', '--json': 'bool', '--help': 'bool', '-h': 'bool',
};

function defaultDeps() {
  return {
    fs,
    env: process.env,
    now: Date.now,
    homedir: os.homedir,
    log: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  };
}

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const kind = SPEC[a];
    if (!kind) return { error: `unknown argument ${JSON.stringify(a)}` };
    if (kind === 'bool') {
      opts[a] = true;
      continue;
    }
    const v = args[++i];
    if (v === undefined || v === '' || v.startsWith('--')) return { error: `${a} needs a value` };
    opts[a] = v;
  }
  return { opts };
}

function bump(map, key, by = 1) {
  map[key] = (map[key] || 0) + by;
}

function sortedCounts(map) {
  return Object.fromEntries(Object.entries(map).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
}

// The id's own timestamp (`2026-10-24T193452-…`, UTC), in ms; NaN when it has none.
function runStartMs(id) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})-/.exec(id);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : NaN;
}

function median(sorted) {
  if (!sorted.length) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round2 = (n) => Math.round(n * 100) / 100;

function summarize({ window, scan, index }) {
  const sinceMs = Date.parse(window.since);
  const untilMs = Date.parse(window.until);
  // A run that was refused is a run, even when only an Agent prompt or an inherited parent run names it.
  const candidates = new Set([...scan.referencedRuns, ...scan.refusals.map((r) => r.runId).filter(Boolean)]);
  const perRun = Object.fromEntries([...candidates]
    .filter((id) => runStartMs(id) >= sinceMs && runStartMs(id) < untilMs)
    .map((id) => [id, 0]));
  const byReason = Object.fromEntries(REASONS.map((r) => [r, 0]));
  const byShape = {};
  const byFence = {};
  const top = {};
  let attributed = 0;
  const refusals = scan.refusals.map((r) => {
    const shapes = detectShapes(r.command, { placeholders: false }); // a transcript holds what the guard saw
    const fences = traceFence(r.command, index);
    bump(byReason, r.reason);
    for (const s of shapes.length ? shapes : ['unclassified']) bump(byShape, s);
    for (const f of fences) bump(byFence, f);
    if (r.runId && Object.hasOwn(perRun, r.runId)) {
      attributed++;
      perRun[r.runId]++;
    }
    if (!top[r.reason]) top[r.reason] = [];
    if (top[r.reason].length < TOP_PER_REASON) top[r.reason].push(r.command.slice(0, TOP_COMMAND_CHARS));
    return {
      toolUseId: r.toolUseId, file: r.file, line: r.line, tool: r.tool,
      command: r.command.slice(0, TOP_COMMAND_CHARS), reason: r.reason, runId: r.runId, shapes, fences,
    };
  });
  const counts = Object.values(perRun).sort((a, b) => a - b);
  const runs = counts.length;
  return {
    window,
    files: scan.files,
    unreadable: scan.unreadable,
    calls: scan.calls,
    refusals,
    perPipeline: {
      runs,
      attributedRefusals: attributed,
      unattributedRefusals: refusals.length - attributed,
      mean: runs ? round2(attributed / runs) : 0,
      median: round2(median(counts)),
    },
    byReason,
    byShape: sortedCounts(byShape),
    byFence: sortedCounts(byFence),
    top,
  };
}

function renderTable(out) {
  const lines = [
    `guard refusals ${out.window.since} .. ${out.window.until}`,
    `files ${out.files} (unreadable ${out.unreadable})  calls ${out.calls}  refusals ${out.refusals.length}`,
    `per pipeline: ${out.perPipeline.attributedRefusals} attributed over ${out.perPipeline.runs} run(s), mean ${out.perPipeline.mean}, median ${out.perPipeline.median}; ${out.perPipeline.unattributedRefusals} unattributed`,
    '',
    'by reason',
    ...Object.entries(out.byReason).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${String(n).padStart(6)}  ${k}`),
    '',
    'by shape',
    ...Object.entries(out.byShape).map(([k, n]) => `  ${String(n).padStart(6)}  ${k}`),
    '',
    'by fence (top 10)',
    ...Object.entries(out.byFence).slice(0, 10).map(([k, n]) => `  ${String(n).padStart(6)}  ${k}`),
  ];
  return lines.join('\n');
}

function run({ argv, deps: given = {} }) {
  const deps = { ...defaultDeps(), ...given };
  const parsed = parseArgs(argv);
  if (parsed.error) {
    deps.err(`guard-refusals.js: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const o = parsed.opts;
  if (o['--help'] || o['-h']) {
    deps.log(USAGE);
    return 0;
  }
  const days = o['--since-days'] === undefined ? 14 : Number(o['--since-days']);
  if (!Number.isFinite(days) || days <= 0) {
    deps.err(`guard-refusals.js: --since-days must be a positive number\n${USAGE}`);
    return 2;
  }
  const untilMs = o['--until'] === undefined ? deps.now() : Date.parse(o['--until']);
  if (!Number.isFinite(untilMs)) {
    deps.err(`guard-refusals.js: --until must be an ISO timestamp\n${USAGE}`);
    return 2;
  }
  const projectsDir = path.resolve(o['--projects-dir']
    || path.join(deps.env.CLAUDE_CONFIG_DIR || path.join(deps.homedir(), '.claude'), 'projects'));
  const skillsRoot = path.resolve(o['--skills-root'] || path.join(__dirname, '..', 'plugin', 'skills'));
  for (const [flag, dir] of [['--projects-dir', projectsDir], ['--skills-root', skillsRoot]]) {
    let isDir = false;
    try {
      isDir = deps.fs.statSync(dir).isDirectory();
    } catch (_) { /* a missing or unstat-able path is reported as not a directory below */ }
    if (!isDir) {
      deps.err(`guard-refusals.js: ${flag} ${dir} is not a directory\n${USAGE}`);
      return 2;
    }
    try {
      deps.fs.readdirSync(dir);
    } catch (err) {
      deps.err(`guard-refusals.js: ${flag} ${dir} cannot be read (${err.code || err.message})\n${USAGE}`);
      return 2;
    }
  }

  const sinceMs = untilMs - days * DAY_MS;
  const window = { since: new Date(sinceMs).toISOString(), until: new Date(untilMs).toISOString() };
  let scan;
  let index;
  try {
    scan = scanStore({ projectsDir, match: o['--match'] || null, since: sinceMs, until: untilMs, fs: deps.fs });
    index = buildFenceIndex(skillsRoot);
  } catch (err) {
    // A directory that passed the pre-check above can still fail mid-walk (permissions, a file removed
    // under the scan): report it like the pre-check does, never a stack trace and a half-read summary.
    deps.err(`guard-refusals.js: the scan could not read its input (${err.code || err.message})\n${USAGE}`);
    return 2;
  }
  const out = summarize({ window, scan, index });
  deps.log(o['--json'] ? JSON.stringify(out) : renderTable(out));
  return 0;
}

module.exports = { run };

if (require.main === module) {
  process.exitCode = run({ argv: process.argv.slice(2) });
}
