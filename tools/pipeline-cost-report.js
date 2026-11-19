#!/usr/bin/env node
'use strict';
// tools/pipeline-cost-report.js — what the pipeline costs and what it produces, over a UTC day window (#5914).
//
//   node tools/pipeline-cost-report.js [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] [--projects <dir>]...
//     [--pipelines <dir>] [--match <substring>] [--section spend|funnel|records|all] [--repo <owner/name>]
//     [--simulate <reason[,reason...]>]... [--json]
//
// Sections (each one object under its own key in --json, so a later section is one more entry in SECTIONS):
//   spend    prices the model requests in the Claude Code transcripts under --projects (tools/pipeline-cost-report/
//            spend.js), by session type, model, agent kind, prompt-size bucket and cache-write cause, and per merged PR.
//   funnel   asks the driver (`drive.js --check`) which open ready + auto:build records it would admit, and why not
//            (funnel.js). `checked` is every listed record, unreadable ones included.
//   records  counts records created, closed, open and deferred in the window from the forge (records.js).
// The run directories under --pipelines are counted once (runs.js); `runs.inWindow` is the runs dated in the window.
//
// The window is --since through --until, both inclusive, UTC; --until defaults to today, --since to --until minus 6
// days. --projects is repeatable (default ~/.claude/projects and every ~/.claude-accounts/*/projects); roots are
// de-duplicated by real path and a root that does not exist is skipped. --pipelines defaults to
// {main checkout}/.claude-tweaks/pipelines, the main checkout being the dirname of
// `git rev-parse --path-format=absolute --git-common-dir`. --repo defaults to `gh repo view`. The tool only reads.
//
// Exit codes: 0 rendered (unreadable files and runs are counted in `unreadable`, not a failure; a single malformed
// JSON line inside a transcript is skipped and not counted, because live transcripts routinely end mid-line;
// an unresolvable default --pipelines prints `Runs: unavailable` and leaves the code alone); 1 a forge read
// failed (that section prints `{section}: unavailable — {first line}`; JSON `{ error }`); 2 malformed invocation.
//
// Seam: run({ argv, deps }) resolves to the exit code; deps holds fs, gh(args) (stdout), check(n) (drive.js --check
// stdout), git(args, {cwd}), now(), pluginVersion(), cwd, home and the log/err line writers.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { PRICES, collectSpend } = require('./pipeline-cost-report/spend');
const { collectFunnel, defaultGh, defaultCheck, readPluginVersion } = require('./pipeline-cost-report/funnel');
const { collectRecords, countMergedPrs } = require('./pipeline-cost-report/records');
const { listRuns, isDate } = require('./pipeline-cost-report/runs');

const PLUGIN_ROOT = path.join(__dirname, '..', 'plugin');
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TYPE_NOTE = 'Session type is the first claude-tweaks skill a session invoked; a session that did several things is counted once.';

function defaultDeps() {
  return {
    fs,
    gh: defaultGh,
    check: null,
    git: (args, opts = {}) => String(execFileSync('git', args, { cwd: opts.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })),
    now: () => new Date(),
    pluginVersion: () => readPluginVersion(PLUGIN_ROOT),
    cwd: process.cwd(),
    home: os.homedir(),
    log: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  };
}

const errText = (e) => String((e && e.message) || e);
const firstLine = (e) => errText(e).split('\n')[0];

const toDate = (s) => new Date(`${s}T00:00:00Z`);
const dayString = (ms) => new Date(ms).toISOString().slice(0, 10);

const usd = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const share = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%');

// ---- sections: { key, collect(ctx) -> data (throws on a forge failure), failed(data), render(data) -> lines } ----

const SECTIONS = [
  {
    key: 'spend',
    async collect(ctx) {
      const spend = await collectSpend(
        { roots: ctx.roots, since: toDate(ctx.since), until: toDate(ctx.until), match: ctx.opts.match || null },
        { fsImpl: ctx.deps.fs },
      );
      let perMergedPr;
      try {
        const { count } = await countMergedPrs({ repo: await ctx.repo(), since: ctx.since, until: ctx.until }, { gh: ctx.deps.gh });
        const flowAndDispatch = (spend.bySessionType.flow || 0) + (spend.bySessionType.dispatch || 0);
        perMergedPr = count > 0 ? { mergedPrs: count, total: spend.total / count, build: flowAndDispatch / count } : { mergedPrs: 0, total: null, build: null };
      } catch (e) {
        perMergedPr = { error: firstLine(e) };
      }
      return { ...spend, perMergedPr };
    },
    failed: (d) => Boolean(d.perMergedPr && d.perMergedPr.error),
    unreadable: (d) => d.unreadable,
    render(d) {
      const lines = ['## Spend', '', `Total: ${usd(d.total)} over ${d.sessions} main sessions with at least one request in the window.`, ''];
      const table = (title, rows, head) => {
        lines.push(`### ${title}`, '', head, head.replace(/[^|]/g, '-'));
        for (const r of rows) lines.push(`| ${r.join(' | ')} |`);
        lines.push('');
      };
      const byUsd = (map) => Object.entries(map).sort((a, b) => b[1] - a[1]);
      table('By session type', byUsd(d.bySessionType).map(([k, v]) => [k, usd(v), share(v, d.total)]), '| Session type | Spend | Share |');
      table('By model', byUsd(d.byModel).map(([k, v]) => [k, usd(v), share(v, d.total)]), '| Model | Spend | Share |');
      table('By agent', [['main', usd(d.byAgent.main), share(d.byAgent.main, d.total)], ['subagent', usd(d.byAgent.subagent), share(d.byAgent.subagent, d.total)]], '| Agent | Spend | Share |');
      table('By prompt size (thousand tokens)', Object.entries(d.byBucket).map(([k, v]) => [k, String(v.requests), usd(v.usd), share(v.usd, d.total)]), '| Prompt | Requests | Spend | Share |');
      table('Cache re-writes by cause', Object.entries(d.cacheWrites).map(([k, v]) => [k, String(v.requests), String(v.tokens), usd(v.usd)]), '| Cause | Requests | Tokens | Spend |');
      if (d.unpriced.requests > 0) lines.push(`Unpriced: ${d.unpriced.requests} requests, ${d.unpriced.tokens} tokens (model family not in the price table).`, '');
      const p = d.perMergedPr;
      if (p.error) lines.push(`Per merged PR: unavailable — ${p.error}`);
      else if (p.mergedPrs === 0) lines.push('Per merged PR: no PR merged in the window.');
      else lines.push(`Per merged PR (${p.mergedPrs} merged): ${usd(p.total)} total, ${usd(p.build)} build (flow + dispatch).`);
      return lines;
    },
  },
  {
    key: 'funnel',
    async collect(ctx) {
      const repoRoot = ctx.deps.cwd;
      return collectFunnel(
        { repo: await ctx.repo(), simulate: ctx.opts.simulate || [] },
        { gh: ctx.deps.gh, check: ctx.deps.check || defaultCheck(PLUGIN_ROOT, repoRoot), now: ctx.deps.now, pluginVersion: ctx.deps.pluginVersion() },
      );
    },
    failed: () => false,
    unreadable: (d) => d.unreadable,
    render(d) {
      const lines = ['## Funnel', '', `Driver admission, run ${d.runDate}, plugin ${d.pluginVersion}.`, '', `Checked: ${d.checked}; admitted: ${d.admitted}; unreadable: ${d.unreadable}.`, ''];
      const reasons = Object.entries(d.reasons).sort((a, b) => b[1] - a[1]);
      if (reasons.length > 0) {
        lines.push('| Refusal reason | Records |', '|---|---|');
        for (const [k, v] of reasons) lines.push(`| ${k} | ${v} |`);
        lines.push('');
      }
      if (d.simulations.length > 0) {
        lines.push('| If these stopped refusing | Admitted |', '|---|---|');
        for (const s of d.simulations) lines.push(`| ${s.set.join(', ')} | ${s.admitted} |`);
      }
      return lines;
    },
  },
  {
    key: 'records',
    async collect(ctx) {
      return collectRecords({ repo: await ctx.repo(), since: ctx.since, until: ctx.until }, { gh: ctx.deps.gh });
    },
    failed: () => false,
    unreadable: () => 0,
    render(d) {
      const lines = ['## Records', '', `Created: ${d.created}; closed: ${d.closed}; open now: ${d.open}; deferred: ${d.deferred.total} (${d.deferred.open} open, ${d.deferred.closed} closed).`, ''];
      const reasons = Object.entries(d.byReason).sort((a, b) => b[1].open + b[1].closed - (a[1].open + a[1].closed));
      if (reasons.length > 0) {
        lines.push('| Defer reason | Open | Closed |', '|---|---|---|');
        for (const [k, v] of reasons) lines.push(`| ${k} | ${v.open} | ${v.closed} |`);
        lines.push('');
      }
      if (d.truncated.length > 0) lines.push(`Truncated: the deferral figures cover only the rows read (${d.truncated.join(', ')}).`);
      return lines;
    },
  },
];

const SECTION_KEYS = SECTIONS.map((s) => s.key);
const USAGE = `usage: node tools/pipeline-cost-report.js [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] [--projects <dir>]... [--pipelines <dir>] [--match <substring>] [--section ${[...SECTION_KEYS, 'all'].join('|')}] [--repo <owner/name>] [--simulate <reason[,reason...]>]... [--json]`;

function parseArgs(args) {
  const opts = { section: 'all', projects: [], simulate: [] };
  const value = (i, flag) => {
    const v = args[i];
    if (v === undefined || v === '' || v.startsWith('--')) return { error: `${flag} needs a value` };
    return { v };
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--since' || a === '--until') {
      const v = args[++i];
      if (!isDate(v)) return { error: `${a} needs a YYYY-MM-DD date` };
      opts[a.slice(2)] = v;
    } else if (['--projects', '--pipelines', '--match', '--repo', '--section', '--simulate'].includes(a)) {
      const r = value(++i, a);
      if (r.error) return r;
      if (a === '--projects') opts.projects.push(r.v);
      else if (a === '--simulate') opts.simulate.push(r.v.split(',').map((s) => s.trim()).filter(Boolean));
      else if (a === '--section') {
        if (r.v !== 'all' && !SECTION_KEYS.includes(r.v)) return { error: `--section must be one of ${[...SECTION_KEYS, 'all'].join('|')}` };
        opts.section = r.v;
      } else opts[a.slice(2)] = r.v;
    } else return { error: `unknown argument ${JSON.stringify(a)}` };
  }
  if (opts.simulate.some((set) => set.length === 0)) return { error: '--simulate needs at least one reason' };
  return { opts };
}

// Default roots, de-duplicated by real path; a root that does not exist is skipped.
function resolveRoots(opts, deps) {
  let candidates = opts.projects.map((p) => path.resolve(deps.cwd, p));
  if (candidates.length === 0) {
    candidates = [path.join(deps.home, '.claude', 'projects')];
    const accounts = path.join(deps.home, '.claude-accounts');
    let names = [];
    try {
      names = deps.fs.readdirSync(accounts);
    } catch {
      names = [];
    }
    for (const name of names.sort()) candidates.push(path.join(accounts, name, 'projects'));
  }
  const seen = new Set();
  const roots = [];
  for (const c of candidates) {
    let real;
    try {
      real = deps.fs.realpathSync(c);
    } catch {
      continue;
    }
    if (!seen.has(real)) {
      seen.add(real);
      roots.push(real);
    }
  }
  return roots;
}

function mainCheckoutPipelines(deps) {
  const commonDir = deps.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: deps.cwd }).trim();
  if (!commonDir) throw new Error('empty output');
  return path.join(path.dirname(commonDir), '.claude-tweaks', 'pipelines');
}

function render(report) {
  const lines = [];
  for (const s of SECTIONS) {
    if (!(s.key in report)) continue;
    const d = report[s.key];
    if (d.error) lines.push(`${s.key}: unavailable — ${d.error}`, '');
    else lines.push(...s.render(d), '');
  }
  return lines;
}

function renderMarkdown(report) {
  const { since, until } = report.window;
  const lines = [
    '# Pipeline cost report',
    '',
    `${since} to ${until}, UTC, inclusive`,
    `Prices dated ${PRICES.date}`,
    SESSION_TYPE_NOTE,
    '',
  ];
  lines.push(...render(report));
  const r = report.runs;
  if (r) {
    if (r.error) lines.push(`Runs: unavailable — ${r.error}`);
    else if (r.missing) lines.push(`not found: ${r.dir}`);
    else lines.push(`Runs: ${r.inWindow} in the window; ${r.unparsed} undated.`);
  }
  lines.push(`Unreadable: ${report.unreadable}`);
  return lines.join('\n');
}

async function run({ argv, deps: given = {} }) {
  const deps = { ...defaultDeps(), ...given };
  const parsed = parseArgs(argv);
  if (parsed.error) {
    deps.err(`pipeline-cost-report.js: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const { opts } = parsed;
  if (opts.help) {
    deps.log(USAGE);
    return 0;
  }
  const until = opts.until || deps.now().toISOString().slice(0, 10);
  const since = opts.since || dayString(toDate(until).getTime() - 6 * DAY_MS);
  if (since > until) {
    deps.err(`pipeline-cost-report.js: --since ${since} is after --until ${until}\n${USAGE}`);
    return 2;
  }

  let repoPromise = null;
  const ctx = {
    deps, opts, since, until,
    roots: resolveRoots(opts, deps),
    repo: () => {
      if (!repoPromise) repoPromise = Promise.resolve().then(() => opts.repo || String(deps.gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])).trim());
      return repoPromise;
    },
  };

  // Run directories are listed once, before the sections, so a section's collect can read ctx.runs.
  let pipelinesDir = opts.pipelines ? path.resolve(deps.cwd, opts.pipelines) : null;
  try {
    if (!pipelinesDir) pipelinesDir = mainCheckoutPipelines(deps);
    ctx.runs = { ...listRuns(pipelinesDir, deps.fs), pipelinesDir };
  } catch (e) {
    ctx.runs = { error: `cannot resolve the pipelines directory (${firstLine(e)}); pass --pipelines <dir>` };
  }

  const report = { window: { since, until } };
  let exit = 0;
  let unreadable = 0;
  for (const s of SECTIONS) {
    if (opts.section !== 'all' && opts.section !== s.key) continue;
    try {
      const data = await s.collect(ctx);
      report[s.key] = data;
      unreadable += s.unreadable(data);
      if (s.failed(data)) exit = 1;
    } catch (e) {
      report[s.key] = { error: firstLine(e) };
      exit = 1;
    }
  }

  // The `runs` entry is rendered from that same listing.
  if (ctx.runs.error) report.runs = { error: ctx.runs.error };
  else {
    unreadable += ctx.runs.unreadable;
    report.runs = {
      inWindow: ctx.runs.runs.filter((r) => r.date >= since && r.date <= until).length,
      unparsed: ctx.runs.unparsed,
      unreadable: ctx.runs.unreadable,
    };
    if (ctx.runs.missing) Object.assign(report.runs, { missing: true, dir: ctx.runs.pipelinesDir });
  }
  report.unreadable = unreadable;

  deps.log(opts.json ? JSON.stringify(report, null, 2) : renderMarkdown(report));
  return exit;
}

module.exports = { run, parseArgs, render, renderMarkdown, SECTIONS };

if (require.main === module) {
  run({ argv: process.argv.slice(2) }).then((code) => { process.exitCode = code; }).catch((e) => {
    process.stderr.write(`pipeline-cost-report.js: ${errText(e)}\n`);
    process.exitCode = 1;
  });
}
