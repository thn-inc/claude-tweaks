#!/usr/bin/env node
'use strict';
// tools/guard-refusals.js — #4028: counts the Bash calls Claude Code's worktree-isolation guard refused
// ("This session is isolated in the worktree … Refusing to run it …") across the local transcript store,
// and says, for each, which refusal reason it was, which static detector shape it matches, and which
// skill fence it was copied from. It is the instrument for the per-pipeline refusal count.
//
//   node tools/guard-refusals.js [--projects-dir <dir>] [--match <slug-substring>] [--since-days <n>=14]
//                                [--until <iso>=now] [--skills-root <dir>] [--replay [--shape-patterns <file>]]
//                                [--json] [--help]
//
// --replay (#5590) replays each refused read against this checkout's guard (tools/guard-refusals/replay.js)
// and, with --json, appends a final `replay` key: { dispositions, writeTargetsMoved, writeTargetsRespelled, writeTargetsLost,
// writeTargetsChecked, writeTargetsSkipped, notReplayed, ruleNotApplied, byClass, byPattern }; the default keys are unchanged. --shape-patterns <file> (requires
// --replay) is a JSON array of { id, pattern } (a JS RegExp source; extra fields are ignored) counted in
// replay.byPattern; a malformed file or pattern exits 2.
//
// --projects-dir defaults to $CLAUDE_CONFIG_DIR/projects, else ~/.claude/projects. --skills-root defaults
// to this checkout's plugin/skills. The scan window is [until - since-days, until) over file mtimes.
//
// Output (--json prints it; otherwise a short table): { window, files, unreadable, calls, refusals,
// perPipeline: { runs, attributedRefusals, unattributedRefusals, mean, median }, byReason, byShape, byFence, top,
// guards, byEffect, byReadClass, byRewrite, rows }.
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
//   rows        one per guarded call, whatever the guard: { toolUseId, file, line, tool, guard, command (the whole
//               stored command, up to the scan's cap), truncated, reason (harness-command rows only), effect, why,
//               readClass, rewrite, runId, ts }. Each `refusals` entry gains guard, effect, why, readClass, rewrite, ts.
//   guards      rows per guard: harness-command, harness-file, plugin:<gate>, plugin:other
//   byEffect    rows per effect: read, write or unknown (tools/guard-refusals/effect.js; a file tool is write, a
//               truncated Bash command is unknown, never read, since its cut tail may hold a writer)
//   byReadClass harness-command rows whose effect is read: other-checkout (the reason is git-redirect-shared,
//               cd-shared or other-worktree-cwd: the command reached another checkout) or shape (any other reason:
//               the guard could not verify a command that only reads)
//   byRewrite   harness-command Bash rows: one count per rewriter rule id that changes the command, `unchanged`
//               when no rule does, `no-cwd` when the row records no absolute working directory (missing or
//               relative), `truncated` when the stored command was cut at the scan's cap. `rewrite` is the rules
//               in THIS checkout's guard-rewrite.js applied to the stored text (worktree and realpath probes
//               stubbed; the plugin-root probe reads this checkout); it says what the rules would change today,
//               never that the hook ran in that session.
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
const { classifyEffect } = require('./guard-refusals/effect');
const { rewriteForGuard } = require('../plugin/bin/lib/hooks/guard-rewrite');
const { REWRITE_DEPS, replay } = require('./guard-refusals/replay');

const USAGE = [
  'usage: node tools/guard-refusals.js [--projects-dir <dir>] [--match <slug-substring>] [--since-days <n>=14]',
  '                                    [--until <iso>=now] [--skills-root <dir>] [--replay [--shape-patterns <file>]]',
  '                                    [--json] [--help]',
].join('\n');

const DAY_MS = 86400e3;
const TOP_PER_REASON = 20;
const TOP_COMMAND_CHARS = 300;
const SPEC = {
  '--projects-dir': 'value', '--match': 'value', '--since-days': 'value', '--until': 'value',
  '--skills-root': 'value', '--shape-patterns': 'value', '--replay': 'bool', '--json': 'bool', '--help': 'bool', '-h': 'bool',
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

// Reasons that mean the command reached a checkout other than the worktree (not a shape the scanner could not read).
const OTHER_CHECKOUT_REASONS = new Set(['git-redirect-shared', 'cd-shared', 'other-worktree-cwd']);
const FILE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

function rowEffect(r) {
  if (r.tool === 'Bash') {
    if (r.truncated) return { effect: 'unknown', why: 'truncated' };
    // One command the classifier cannot take must not abort the summary of every other row.
    try { return classifyEffect(r.command); } catch { return { effect: 'unknown', why: 'classifier failed' }; }
  }
  if (FILE_TOOLS.has(r.tool)) return { effect: 'write', why: 'file tool' };
  return { effect: 'unknown', why: `${r.tool} tool` };
}

// null for a truncated command or without an absolute cwd; the applied rule ids at this checkout's HEAD
// otherwise ([] when nothing changes). An exception caught inside a rule still reads as [].
function rewriteRules(r) {
  if (r.truncated || typeof r.cwd !== 'string' || !path.isAbsolute(r.cwd)) return null;
  const res = rewriteForGuard({ command: r.command, cwd: r.cwd, deps: REWRITE_DEPS });
  return res ? res.applied : [];
}

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
  const guards = {};
  const byEffect = { read: 0, write: 0, unknown: 0 };
  const byReadClass = { 'other-checkout': 0, shape: 0 };
  const byRewrite = {};
  const rowByUse = new Map();
  const rows = scan.rows.map((r) => {
    const { effect, why } = rowEffect(r);
    const readClass = r.guard === 'harness-command' && effect === 'read'
      ? (OTHER_CHECKOUT_REASONS.has(r.reason) ? 'other-checkout' : 'shape')
      : null;
    const rewrite = r.guard === 'harness-command' && r.tool === 'Bash' ? rewriteRules(r) : null;
    bump(guards, r.guard);
    bump(byEffect, effect);
    if (readClass) bump(byReadClass, readClass);
    if (r.guard === 'harness-command' && r.tool === 'Bash') {
      if (rewrite === null) bump(byRewrite, r.truncated ? 'truncated' : 'no-cwd');
      else if (!rewrite.length) bump(byRewrite, 'unchanged');
      else for (const id of rewrite) bump(byRewrite, id);
    }
    const row = {
      toolUseId: r.toolUseId, file: r.file, line: r.line, tool: r.tool, guard: r.guard,
      command: r.command, truncated: r.truncated, reason: r.reason,
      effect, why, readClass, rewrite, runId: r.runId, ts: r.ts,
    };
    rowByUse.set(r.toolUseId, row);
    return row;
  });
  const refusals = scan.refusals.map((r) => {
    const row = rowByUse.get(r.toolUseId);
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
      guard: r.guard, effect: row.effect, why: row.why, readClass: row.readClass, rewrite: row.rewrite, ts: r.ts,
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
    guards: sortedCounts(guards),
    byEffect: sortedCounts(byEffect),
    byReadClass: sortedCounts(byReadClass),
    byRewrite: sortedCounts(byRewrite),
    rows,
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
    '',
    'by guard',
    ...Object.entries(out.guards).map(([k, n]) => `  ${String(n).padStart(6)}  ${k}`),
    '',
    'by effect',
    ...Object.entries(out.byEffect).map(([k, n]) => `  ${String(n).padStart(6)}  ${k}`),
  ];
  return lines.join('\n');
}

function renderReplay(r) {
  const n = (v) => String(v).padStart(6);
  const d = r.dispositions;
  const lines = ['', 'replay', '  plugin reads', ...Object.entries(d.plugin).map(([k, v]) => `  ${n(v)}  ${k}`),
    '  harness reads', ...Object.entries(d.harness).map(([k, v]) => `  ${n(v)}  ${k}`)];
  const byShape = Object.entries(d.refusedShapeById || {});
  if (byShape.length) lines.push('  refused-shape by detector', ...byShape.map(([k, v]) => `  ${n(v)}  ${k}`));
  const byReason = Object.entries(d.unexplainedByReason || {});
  if (byReason.length) lines.push('  unexplained by reason', ...byReason.map(([k, v]) => `  ${n(v)}  ${k}`));
  lines.push(`  writeTargetsMoved ${r.writeTargetsMoved} of ${r.writeTargetsChecked} (respelled ${r.writeTargetsRespelled}, lost ${r.writeTargetsLost}, skipped ${r.writeTargetsSkipped})`);
  const unreplayed = Object.entries(r.notReplayed || {});
  if (unreplayed.length) lines.push('  not replayed (no rewrite tried)', ...unreplayed.map(([k, v]) => `  ${n(v)}  ${k}`));
  lines.push(`  rule-not-applied ${r.ruleNotApplied.total}`);
  for (const [rule, e] of Object.entries(r.ruleNotApplied.byRule)) {
    lines.push(`    ${rule}  total ${e.total}`);
    for (const [v, c] of Object.entries(e.byVersion)) lines.push(`    ${rule}  ${v}  main ${c.main}  subagent ${c.subagent}`);
  }
  lines.push('  by class');
  for (const [k, e] of Object.entries(r.byClass)) lines.push(`    ${k}  total ${e.total}  unknown-version ${e.unknownVersion}`);
  if (r.byPattern) {
    lines.push('  by pattern');
    for (const [id, e] of Object.entries(r.byPattern)) lines.push(e && e.error ? `    ${id}  ${e.error}` : `    ${id}  count ${e.count}  rewritten ${e.rewritten}`);
  }
  return lines.join('\n');
}

// { list } when the file is valid; else { error } with the message for an exit-2. Reads through deps.fs, before any scan.
function loadPatterns(file, deps) {
  let text;
  try {
    text = deps.fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { error: `--shape-patterns ${file} cannot be read (${err.code || err.message})` };
  }
  let list;
  try {
    list = JSON.parse(text);
  } catch (_) {
    return { error: `--shape-patterns ${file} is not valid JSON` };
  }
  if (!Array.isArray(list)) return { error: `--shape-patterns ${file} must be a JSON array of { id, pattern }` };
  const seen = new Set();
  for (const e of list) {
    if (!e || typeof e.id !== 'string' || !e.id || typeof e.pattern !== 'string') {
      return { error: `--shape-patterns ${file}: every entry needs a string id and pattern` };
    }
    if (seen.has(e.id)) return { error: `--shape-patterns ${file}: duplicate id "${e.id}"` };
    seen.add(e.id);
    try {
      new RegExp(e.pattern); // eslint-disable-line no-new
    } catch (_) {
      return { error: `--shape-patterns ${file}: the pattern for "${e.id}" is not a valid regular expression` };
    }
  }
  return { list };
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
  if (o['--shape-patterns'] !== undefined && !o['--replay']) {
    deps.err(`guard-refusals.js: --shape-patterns requires --replay\n${USAGE}`);
    return 2;
  }
  let patterns = null;
  if (o['--shape-patterns'] !== undefined) {
    const loaded = loadPatterns(o['--shape-patterns'], deps);
    if (loaded.error) {
      deps.err(`guard-refusals.js: ${loaded.error}\n${USAGE}`);
      return 2;
    }
    patterns = loaded.list;
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
  if (o['--replay']) {
    const cwdByUse = new Map(scan.rows.map((r) => [r.toolUseId, r.cwd]));
    const rows = out.rows.map((r) => ({ ...r, cwd: cwdByUse.get(r.toolUseId) }));
    out.replay = replay(rows, patterns ? { patterns } : {});
  }
  deps.log(o['--json'] ? JSON.stringify(out) : `${renderTable(out)}${out.replay ? `\n${renderReplay(out.replay)}` : ''}`);
  return 0;
}

module.exports = { run };

if (require.main === module) {
  process.exitCode = run({ argv: process.argv.slice(2) });
}
