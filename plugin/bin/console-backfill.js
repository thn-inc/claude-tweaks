#!/usr/bin/env node
// bin/console-backfill.js — the Review Console backlog backfill (#3950): settle the
// unresolved items closed and archived runs left in their consoles. Never calls a
// model or gh — the procedure (the skill prose) dispatches the tiebreaks, files the
// records and posts the digest; this CLI lists the work, plans the dispositions and
// writes the outcomes back.
//   node bin/console-backfill.js list --main-sha <sha> [--out <path>]
//   node bin/console-backfill.js list --dry-run
//   node bin/console-backfill.js dispose --work-list <file> --verdicts <file> [--existing <issues.json>] [--digest-comments <comments.json>] [--limit <n>] --out-dir <dir>
//   node bin/console-backfill.js apply --entries <file> [--dry-run]
// list prints the work list (lib/console/backfill.js's buildWorkList) as JSON, or writes
// it to --out; list --dry-run prints the human summary and writes nothing. dispose runs
// planBatch (lib/console/backfill-dispose.js) over a work-list file: --verdicts is a JSON
// object keyed by item id (resolve-tiebreak's verdicts), --existing the
// `gh issue list --state all --json number,title,body` array, --digest-comments the digest
// issue's comment objects, --limit the batch size (default 24). Each new filing is
// written to <out-dir>/backfill-filing-{item id without `bf:`}.md (named by item, so batches
// into one directory never collide); the printed result carries that path as file[].path and
// dispositions[].proposal.path, and neither has a `text` key — no proposal body is ever printed.
// apply reads planBatch's entries (a JSON array, or an object
// with `entries`) with each `ref` filled in, routes each entry to the console of its
// run that lists its item, and rewrites that console.json (lib/console/backfill-apply.js)
// — the only write this CLI makes besides --out and --out-dir. It re-checks at apply time
// that the run is closed, and re-reads every console fresh. Prints
// { applied: [itemId], refused: [{ itemId, reason }], acknowledged: [consoleDir], written: [console.json] };
// each refusal is also one stderr line. --dry-run computes the same and writes nothing.
// Refusal reasons: apply's own (malformed, bad-outcome, bad-source, missing-ref,
// duplicate-entry, already-settled, unknown-item, ambiguous-item, stale-hash) plus run-not-anchored (the
// runDir is not {pipelines}/{run-id} or {pipelines}/archive/{run-id}), run-live,
// run-not-closed, console-unreadable and write-failed.
// Exit 0 done (refusals are per-entry results, not a failure); 2 malformed invocation or
// an unparseable input file; 3 the pipelines root is missing, or a console.json, --out or
// --out-dir could not be written. This is the Sanctioned-writer vocabulary (no exit 1).
'use strict';

const fs = require('fs');
const path = require('path');
const { buildWorkList, consoleWorkItems, consolePathsOf, enumerateRuns, readConsole, summarize } = require('./lib/console/backfill');
const { applyToConsole, entryProblem } = require('./lib/console/backfill-apply');
const { disposeItem, planBatch } = require('./lib/console/backfill-dispose');
const { runIdOf } = require('./lib/console/resolve');
const { UNRESOLVED_RESOLUTIONS } = require('./lib/console/residue');
const { RUN_ID_RE } = require('./lib/hooks/context');
const { mainCheckoutRoot } = require('./lib/hooks/worktree-detect');
const { writeFileAtomic } = require('./lib/atomic-write');

const USAGE = 'usage: console-backfill.js list --main-sha <sha> [--out <path>]\n'
  + '       console-backfill.js list --dry-run\n'
  + '       console-backfill.js dispose --work-list <file> --verdicts <file> [--existing <issues.json>] [--digest-comments <comments.json>] [--limit <n>] --out-dir <dir>\n'
  + '       console-backfill.js apply --entries <file> [--dry-run]\n'
  + '  exit 0 ok; 2 malformed invocation or unparseable input file; 3 pipelines root missing, or a console.json, --out or --out-dir unwritable\n';

const COMMANDS = {
  list: { value: { '--main-sha': 'mainSha', '--out': 'out' }, bool: ['--dry-run'] },
  dispose: {
    value: {
      '--work-list': 'workList', '--verdicts': 'verdicts', '--existing': 'existing', '--digest-comments': 'digestComments', '--out-dir': 'outDir', '--limit': 'limit',
    },
    bool: [],
  },
  apply: { value: { '--entries': 'entries' }, bool: ['--dry-run'] },
};

function parseArgs(argv) {
  const o = { command: null, help: false, dryRun: false };
  if (argv.includes('--help') || argv.includes('-h')) return { ...o, help: true };
  const [command, ...rest] = argv;
  if (!command || command.startsWith('-')) return { error: 'a subcommand (list, dispose or apply) is required' };
  if (!Object.hasOwn(COMMANDS, command)) return { error: `unknown subcommand: ${command}` };
  const spec = COMMANDS[command];
  o.command = command;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (spec.bool.includes(a)) { o.dryRun = true; continue; }
    if (!Object.hasOwn(spec.value, a)) return { error: `unknown argument for ${command}: ${a}` };
    const v = rest[++i];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} requires a value` };
    o[spec.value[a]] = v;
  }
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  now: () => Date.now(),
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  writeFile: writeFileAtomic,
  mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

const isDirectory = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// The deterministic half of a listing: every non-finding item's disposition needs no
// verdict, so the digest / dismiss / file split is known before any tiebreak runs.
function deterministicSplit(workList) {
  const split = { digest: 0, dismiss: 0, file: 0, failed: [] };
  for (const run of workList.runs) {
    for (const item of run.items) {
      if (item.kind === 'finding') continue;
      try {
        const d = disposeItem({ item, runId: runIdOf(item.consoleDir), mainSha: workList.mainSha || '' });
        split[d.action] += 1;
      } catch (err) {
        split.failed.push(`${item.itemId}: ${err && err.message}`);
      }
    }
  }
  return split;
}

const LIVE_NAMED_MAX = 10;

// Does any console of this live run hold an unresolved stored item? A run that cannot be listed or a
// console that cannot be read counts as holding: it is named rather than passed over. `scanDeps` is
// the same run-listing seam the work list uses (scanDepsOf).
function liveHoldsUnresolved(live, scanDeps) {
  let paths;
  try { paths = consolePathsOf(live.runDir, scanDeps); } catch { return true; }
  return paths.some((p) => {
    const read = readConsole(p, scanDeps);
    if (read.state === 'absent') return false;
    if (read.state === 'unreadable') return true;
    const items = Array.isArray(read.consoleJson.items) ? read.consoleJson.items : [];
    return items.some((i) => i && UNRESOLVED_RESOLUTIONS.has(i.resolution));
  });
}

function summaryLines(workList, scanDeps) {
  const s = summarize(workList);
  const split = deterministicSplit(workList);
  const lines = [
    `runs: ${s.runs} (live skipped: ${workList.live.length})`,
    `items: ${s.items} — findings ${s.byKind.finding}, no-claim ${s.byKind['no-claim']}, staged-kind ${s.byKind['staged-kind']}`,
    `deterministic: digest ${split.digest}, dismiss ${split.dismiss}, file ${split.file}`,
    `tiebreak dispatches: ${s.byKind.finding}; records filed at most: ${s.findingsMaxFiled + split.file}`,
    `consoles with items: ${s.consoles}`,
  ];
  // Most live runs hold nothing unresolved: name only those that do, capped.
  const holding = workList.live.filter((l) => liveHoldsUnresolved(l, scanDeps));
  if (holding.length) {
    lines.push(`live runs holding unresolved items (skipped): ${holding.length}`);
    for (const l of holding.slice(0, LIVE_NAMED_MAX)) lines.push(`  ${l.runDir} (${l.status})`);
    if (holding.length > LIVE_NAMED_MAX) lines.push(`  … and ${holding.length - LIVE_NAMED_MAX} more`);
  }
  for (const p of workList.unreadable) lines.push(`unreadable (no items listed): ${p}`);
  for (const f of split.failed) lines.push(`could not dispose: ${f}`);
  return lines;
}

// The run-listing seam handed to lib/console/backfill.js (a test's way to make a run dir unlistable).
const scanDepsOf = (ctx) => (ctx.deps.readdirStrict ? { readdirStrict: ctx.deps.readdirStrict } : {});

function runList(o, ctx) {
  const workList = buildWorkList({ pipelinesRoot: ctx.pipelinesRoot, mainSha: o.mainSha || null, deps: scanDepsOf(ctx) });
  if (o.dryRun) { ctx.deps.stdout(`${summaryLines(workList, scanDepsOf(ctx)).join('\n')}\n`); return 0; }
  const text = `${JSON.stringify(workList)}\n`;
  if (!o.out) { ctx.deps.stdout(text); return 0; }
  const outFile = path.resolve(ctx.cwd, o.out);
  try {
    ctx.deps.mkdir(path.dirname(outFile));
    ctx.deps.writeFile(outFile, text);
  } catch (err) {
    ctx.deps.stderr(`console-backfill.js: could not write --out ${o.out} (${err && err.message})\n`);
    return 3;
  }
  return 0;
}

// The flags a subcommand cannot run without; a message, or null.
function invocationProblem(o) {
  if (o.command === 'list') {
    if (!o.dryRun && !o.mainSha) return 'list needs --main-sha <sha>, or --dry-run';
    if (o.dryRun && (o.out || o.mainSha)) return 'list --dry-run takes neither --out nor --main-sha';
  } else if (o.command === 'dispose') {
    const missing = [['--work-list', 'workList'], ['--verdicts', 'verdicts'], ['--out-dir', 'outDir']].find(([, key]) => !o[key]);
    if (missing) return `${missing[0]} is required`;
    if (o.limit !== undefined && !/^\d+$/.test(o.limit)) return '--limit must be a non-negative integer';
  } else if (!o.entries) return '--entries <file> is required';
  return null;
}

// Reads a JSON input file; `check` returns an error string for a wrong shape.
function readJsonInput(ctx, flag, file, check) {
  let value;
  try { value = JSON.parse(ctx.deps.readFile(path.resolve(ctx.cwd, file))); } catch (err) {
    return { error: `${flag} ${file} is unreadable or not JSON (${err && err.message})` };
  }
  const problem = check(value);
  return problem ? { error: `${flag} ${file} ${problem}` } : { value };
}

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function runDispose(o, ctx) {
  const limit = o.limit === undefined ? undefined : Number(o.limit);
  const inputs = {};
  const specs = [
    ['workList', '--work-list', (v) => (isPlainObject(v) && Array.isArray(v.runs) ? null : 'must be a work list ({ runs: [...] })')],
    ['verdicts', '--verdicts', (v) => (isPlainObject(v) ? null : 'must be a JSON object keyed by item id')],
    ['existing', '--existing', (v) => (Array.isArray(v) ? null : 'must be a JSON array of { number, title, body }')],
    ['digestComments', '--digest-comments', (v) => (Array.isArray(v) ? null : 'must be a JSON array of comments')],
  ];
  for (const [key, flag, check] of specs) {
    if (!o[key]) continue;
    const r = readJsonInput(ctx, flag, o[key], check);
    if (r.error) return ctx.usageError(r.error);
    inputs[key] = r.value;
  }
  let plan;
  try {
    plan = planBatch({
      workList: inputs.workList, verdicts: inputs.verdicts, existingIssues: inputs.existing || [], digestComments: inputs.digestComments || [], ...(limit === undefined ? {} : { limit }),
    });
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    return ctx.usageError(`could not plan the batch (${err.message})`);
  }
  const outDir = path.resolve(ctx.cwd, o.outDir);
  const file = [];
  const written = new Map();
  try {
    if (plan.file.length) ctx.deps.mkdir(outDir);
    for (const f of plan.file) {
      // Named by the item, not by position, so a later batch into the same directory never overwrites this one.
      const proposal = path.join(outDir, `backfill-filing-${f.itemId.replace(/^bf:/, '').replace(/[^A-Za-z0-9_-]/g, '_')}.md`);
      ctx.deps.writeFile(proposal, f.text);
      written.set(f.itemId, proposal);
      const { text, ...rest } = f;
      file.push({ ...rest, path: proposal });
    }
  } catch (err) {
    ctx.deps.stderr(`console-backfill.js: could not write --out-dir ${o.outDir} (${err && err.message})\n`);
    return 3;
  }
  // No proposal body is printed: a batch of spec-shaped bodies can pass the Bash output limit and
  // truncate the JSON the procedure parses. A disposition keeps its fingerprint and title, plus the path when written.
  const dispositions = plan.dispositions.map((d) => {
    if (!d.proposal) return d;
    const { text, ...rest } = d.proposal;
    return { ...d, proposal: written.has(d.itemId) ? { ...rest, path: written.get(d.itemId) } : rest };
  });
  ctx.deps.stdout(`${JSON.stringify({ ...plan, dispositions, file })}\n`);
  return 0;
}

// One run's consoles, read fresh and listed: { consoles: [{ path, read, work }], unreadable }.
function readRunConsoles(runDir, scanDeps) {
  const consoles = [];
  let unreadable = false;
  let consolePaths;
  // A run dir that vanished (or cannot be listed) mid-call reads as unreadable, never as having no items.
  try { consolePaths = consolePathsOf(runDir, scanDeps); } catch { return { consoles, unreadable: true }; }
  for (const consolePath of consolePaths) {
    const read = readConsole(consolePath);
    if (read.state === 'absent') continue;
    if (read.state === 'unreadable') { unreadable = true; continue; }
    try { consoles.push({ path: consolePath, read, work: consoleWorkItems(read) }); } catch { unreadable = true; }
  }
  return { consoles, unreadable };
}

// The console an entry's item belongs to: the one whose work items list it; failing
// that, the one already holding it settled (so a re-applied entry reads as already-settled).
function routeEntry(consoles, itemId) {
  const listing = consoles.findIndex((c) => c.work.some((w) => w.itemId === itemId));
  if (listing !== -1) return listing;
  return consoles.findIndex((c) => (Array.isArray(c.read.consoleJson.items) ? c.read.consoleJson.items : [])
    .some((s) => s && s.settled && (s.id === itemId || s.backfillId === itemId)));
}

function runApply(o, ctx) {
  const r = readJsonInput(ctx, '--entries', o.entries, (v) => (Array.isArray(v) || (isPlainObject(v) && Array.isArray(v.entries)) ? null : 'must be a JSON array of entries, or an object with `entries`'));
  if (r.error) return ctx.usageError(r.error);
  const entries = Array.isArray(r.value) ? r.value : r.value.entries;
  const at = new Date(ctx.deps.now()).toISOString();
  const archiveRoot = path.join(ctx.pipelinesRoot, 'archive');
  const result = { applied: [], refused: [], acknowledged: [], written: [] };
  let writeFailed = false;
  const refuse = (entry, reason, detail) => {
    const itemId = entry && typeof entry === 'object' ? entry.itemId : undefined;
    result.refused.push({ itemId, reason });
    ctx.deps.stderr(`console-backfill.js: refused ${itemId === undefined ? '(no item id)' : itemId}: ${reason}${detail ? ` (${detail})` : ''}\n`);
  };

  const byRun = new Map();
  for (const e of entries) {
    const problem = entryProblem(e) || (typeof e.runDir === 'string' && e.runDir ? null : 'malformed');
    if (problem) { refuse(e, problem); continue; }
    const runDir = path.resolve(ctx.cwd, e.runDir);
    byRun.set(runDir, [...(byRun.get(runDir) || []), e]);
  }
  const { closed, live } = enumerateRuns(ctx.pipelinesRoot);
  const closedSet = new Set(closed);
  const liveSet = new Set(live.map((l) => l.runDir));

  for (const [runDir, runEntries] of byRun) {
    const parent = path.dirname(runDir);
    const reason = !((parent === ctx.pipelinesRoot || parent === archiveRoot) && RUN_ID_RE.test(path.basename(runDir))) ? 'run-not-anchored'
      : liveSet.has(runDir) ? 'run-live'
        : !closedSet.has(runDir) ? 'run-not-closed' : null;
    if (reason) { for (const e of runEntries) refuse(e, reason, runDir); continue; }

    const { consoles, unreadable } = readRunConsoles(runDir, scanDepsOf(ctx));
    const perConsole = consoles.map(() => []);
    for (const e of runEntries) {
      const idx = routeEntry(consoles, e.itemId);
      if (idx !== -1) perConsole[idx].push(e);
      else refuse(e, unreadable ? 'console-unreadable' : 'unknown-item', runDir);
    }
    consoles.forEach((c, idx) => {
      if (!perConsole[idx].length) return;
      const res = applyToConsole({ ...c.read, entries: perConsole[idx], at });
      for (const rf of res.refused) refuse(rf, rf.reason, c.path);
      if (res.json && !ctx.dryRun) {
        try {
          ctx.deps.writeFile(c.path, `${JSON.stringify(res.json, null, 2)}\n`);
        } catch (err) {
          writeFailed = true;
          for (const id of res.applied) refuse({ itemId: id }, 'write-failed', `${c.path}: ${err && err.message}`);
          return;
        }
        result.written.push(c.path);
      }
      result.applied.push(...res.applied);
      if (res.acknowledged) result.acknowledged.push(c.read.consoleDir);
    });
  }
  ctx.deps.stdout(`${JSON.stringify(result)}\n`);
  return writeFailed ? 3 : 0;
}

function run(argv, deps = {}) {
  const d = { ...realDeps, ...deps };
  const o = parseArgs(argv);
  const usageError = (message) => { d.stderr(`console-backfill.js: ${message}\n${USAGE}`); return 2; };
  if (o.error) return usageError(o.error);
  if (o.help) { d.stdout(USAGE); return 0; }
  const problem = invocationProblem(o);
  if (problem) return usageError(problem);
  const cwd = d.cwd();
  const ctx = { deps: d, cwd, usageError, dryRun: o.dryRun };
  if (o.command === 'dispose') return runDispose(o, ctx);
  ctx.pipelinesRoot = path.resolve(path.join(d.mainRoot || mainCheckoutRoot(cwd) || cwd, '.claude-tweaks', 'pipelines'));
  if (!isDirectory(ctx.pipelinesRoot)) {
    d.stderr(`console-backfill.js: the pipelines root does not exist: ${ctx.pipelinesRoot}\n`);
    return 3;
  }
  return o.command === 'list' ? runList(o, ctx) : runApply(o, ctx);
}

module.exports = { run, parseArgs, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
