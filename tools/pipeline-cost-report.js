#!/usr/bin/env node
'use strict';
// tools/pipeline-cost-report.js — what the pipeline costs and what it produces, over a UTC day window (#5914).
//
//   node tools/pipeline-cost-report.js [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] [--projects <dir>]...
//     [--pipelines <dir>] [--match <substring> | --all-projects] [--section spend|funnel|records|guards|reviews|all]
//     [--split <YYYY-MM-DD>] [--runs <n>] [--repo <owner/name>] [--simulate <reason[,reason...]>]... [--json]
//
// Spend scope: merged PRs and records are this repository's, so by default only transcripts whose working directory is
// the main checkout or under it (its worktrees) are priced. `--match <substring>` replaces that with a substring of the
// working-directory path; `--all-projects` prices every transcript under --projects. The effective scope is printed as
// a `Match:` line and is `window.match` ({ kind: path|substring|all, value }) in --json.
//
// Sections (each one object under its own key in --json, so a later section is one more entry in SECTIONS):
//   spend    prices the model requests in the Claude Code transcripts under --projects (tools/pipeline-cost-report/
//            spend.js), by session type, model, agent kind, prompt-size bucket and cache-write cause, and per merged PR.
//   funnel   asks the driver (`drive.js --check`) which open ready + auto:build records it would admit, and why not
//            (funnel.js). `checked` is every listed record, unreadable ones included. It also counts the driver's activity
//            over the window: `driverRuns` (run directories holding driver-events.jsonl, split into dispatch-routed — a
//            manifest with lane driver, a run not named -drive-N — and standalone, with the latest run date) and
//            `dispatchFirings` (main transcripts whose first claude-tweaks skill is dispatch, how many reached the driver
//            route, by plugin version), the latter under the same scope as spend. When records are admitted yet no run was
//            dispatch-routed, a flag line says admitted records were not driven. Unreadable run dirs and transcripts add
//            to the report's `unreadable`, not the funnel's own.
//   records  counts records created, closed, open and deferred in the window from the forge (records.js).
//   guards   three quality guards over two columns of pipeline runs, the last --runs (default 20) dated before --split
//            and the first --runs dated on or after it, independent of the window (guards.js): the share of whole-branch
//            reviews that found a Critical or Important issue, the share of tasks needing no re-review (by first
//            implementer tier), and bug records filed within 14 days of a merge touching their Key Files. Each figure
//            carries its `unparsed` count. --split is required for --section guards; --section all without it skips guards
//            (`{ skipped }`, exit unaffected). A guard 3 forge failure marks only that cell and exits 1.
//   reviews  what the review steps found, read from the runs dated in the window (reviews.js): task reviews by model tier
//            (verdict, items by severity, Minor-only), plan reviews (share with a finding, findings by kind, runs that
//            stopped to ask a human), lens reviewers by tier and by lens, the lens verdicts (confirmed by a pair or a
//            tiebreak, refuted, can't tell) per run and per lens, and what became of the confirmed locations. It reads each
//            run's timing.json, the subagents' transcripts and decisions.md; a multi-spec run's dispatches come from its
//            parent and its verdict figures count once per spec member. The lens yield (confirmed per agent) is the
//            exception to the window: it takes the last --runs (default 20) runs per lens dated on or before --until,
//            whatever --since says. Every figure carries its `unparsed` count.
// The run directories under --pipelines are counted once (runs.js); `runs.inWindow` is the runs dated in the window.
//
// The window is --since through --until, both inclusive, UTC; --until defaults to today, --since to --until minus 6
// days. --projects is repeatable (default ~/.claude/projects, $CLAUDE_CONFIG_DIR/projects and every
// ~/.claude-accounts/*/projects); roots are de-duplicated by real path, a default root that does not exist is skipped and
// an explicit --projects root that cannot be resolved is counted in `unreadable`.
// --pipelines defaults to {main checkout}/.claude-tweaks/pipelines, the main checkout being the dirname of
// `git rev-parse --path-format=absolute --git-common-dir`. --repo defaults to `gh repo view`. The funnel always asks
// `drive.js --check` about the current checkout's repository, so a `--section funnel|all` run whose --repo differs from
// the current checkout's `gh repo view` answer is refused (exit 2). The tool only reads.
//
// Exit codes: 0 rendered (unreadable files and runs are counted in `unreadable`, not a failure; the report's total is the
// sum of each section's own figure, so one transcript both spend and the funnel read counts once per section; a single malformed
// JSON line inside a transcript is skipped and not counted, because live transcripts routinely end mid-line, but a
// transcript with no parseable line at all is counted once;
// an unresolvable default --pipelines prints `Runs: unavailable` and leaves the code alone); 1 a section failed —
// a forge read failed, or spend could not resolve the main checkout (that section prints
// `{section}: unavailable — {first line}`; JSON `{ error }`) — with --split set that includes a pipelines listing
// failure (`guards: unavailable —`, though the Runs line still leaves the code alone) and a guard 3 forge failure (only
// that cell reads unavailable) — and a pipelines listing failure under `--section reviews` (under `--section all` it
// prints `reviews: unavailable —` and leaves the code alone, like `Runs: unavailable`); 2 malformed invocation,
// --section guards without --split included.
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
const { collectGuards } = require('./pipeline-cost-report/guards');
const { PLAN_KINDS, collectReviews, compareStrings } = require('./pipeline-cost-report/reviews');

const pct = (s) => (s === null ? 'none' : `${Math.round(s * 100)}%`);
const DEFAULT_RUNS = 20;
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
    env: process.env,
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

// The message for a scope whose main checkout did not resolve, or null when it did.
const scopeErrorText = (scope) => (scope.kind === 'path' && !scope.value ? `cannot resolve the main checkout (${scope.error}); pass --match <substring> or --all-projects` : null);

// X.Y.Z numerically; any other key (`unknown`) after every version, ties by text.
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
function compareVersions(a, b) {
  const pa = VERSION_RE.exec(a);
  const pb = VERSION_RE.exec(b);
  if (pa && pb) {
    for (let i = 1; i <= 3; i++) {
      if (pa[i] !== pb[i]) return Number(pa[i]) - Number(pb[i]);
    }
  }
  if (Boolean(pa) !== Boolean(pb)) return pa ? -1 : 1;
  return compareStrings(a, b);
}

// The driver's activity over the window, and the flag line when admitted records exist but nothing was routed to it.
function driverActivityLines(d) {
  const { driverRuns: r, dispatchFirings: f } = d;
  const lines = [''];
  lines.push(r.error ? `Driver runs: unavailable — ${r.error}` : `Driver runs: ${r.total} (${r.dispatchRouted} dispatch-routed, ${r.standalone} standalone); last ${r.last || 'none'}; unreadable: ${r.unreadable}.`);
  if (f.error) lines.push(`Dispatch firings: unavailable — ${f.error}`);
  else {
    const versions = Object.entries(f.byPluginVersion).sort((a, b) => compareVersions(a[0], b[0])).map(([v, n]) => `${v} ${n}`).join(', ') || 'none';
    lines.push(`Dispatch firings: ${f.total}; reached the driver route: ${f.reachedRoute}; by plugin version: ${versions}; unreadable: ${f.unreadable}.`);
  }
  if (d.admitted > 0 && !r.error && !f.error && r.dispatchRouted === 0) lines.push('', `Admitted records were not driven: ${f.total} dispatch firings in the window, ${f.reachedRoute} reached the driver route.`);
  return lines;
}

const SECTIONS = [
  {
    key: 'spend',
    async collect(ctx) {
      const { scope } = ctx;
      const scopeError = scopeErrorText(scope);
      if (scopeError) throw new Error(scopeError);
      const spend = await collectSpend(
        {
          roots: ctx.roots,
          since: toDate(ctx.since),
          until: toDate(ctx.until),
          match: scope.kind === 'substring' ? scope.value : null,
          root: scope.kind === 'path' ? scope.value : null,
        },
        { fsImpl: ctx.deps.fs, pluginRoot: PLUGIN_ROOT, transcriptCache: ctx.transcriptCache },
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
      table('Cache writes by cause', Object.entries(d.cacheWrites).map(([k, v]) => [k, String(v.requests), v.tokens.toLocaleString('en-US'), usd(v.usd)]), '| Cause | Requests | Tokens | Spend |');
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
      const { scope } = ctx;
      return collectFunnel(
        {
          repo: await ctx.repo(),
          simulate: ctx.opts.simulate || [],
          runs: ctx.runs,
          roots: ctx.roots,
          since: ctx.since,
          until: ctx.until,
          match: scope.kind === 'substring' ? scope.value : null,
          root: scope.kind === 'path' ? scope.value : null,
          scopeError: scopeErrorText(scope),
        },
        { gh: ctx.deps.gh, check: ctx.deps.check || defaultCheck(PLUGIN_ROOT, repoRoot), now: ctx.deps.now, pluginVersion: ctx.deps.pluginVersion(), fsImpl: ctx.deps.fs, transcriptCache: ctx.transcriptCache },
      );
    },
    failed: () => false,
    unreadable: (d) => d.unreadable + (d.driverRuns?.unreadable || 0) + (d.dispatchFirings?.unreadable || 0),
    render(d) {
      const lines = ['## Funnel', '', `Driver admission, run ${d.runDate}, plugin ${d.pluginVersion}.`, '', `Checked: ${d.checked}; admitted: ${d.admitted}; unreadable: ${d.unreadable}.`];
      if (d.driverRuns) lines.push(...driverActivityLines(d));
      lines.push('');
      const reasons = Object.entries(d.reasons).sort((a, b) => b[1] - a[1]);
      if (reasons.length > 0) {
        lines.push('| Refusal reason | Records |', '|---|---|');
        for (const [k, v] of reasons) lines.push(`| ${k} | ${v} |`);
        lines.push('');
      }
      if (d.simulations.length > 0) {
        lines.push('| If these stopped refusing | Admitted |', '|---|---|');
        const bySet = [...d.simulations].sort((a, b) => b.admitted - a.admitted || a.set.join(', ').localeCompare(b.set.join(', ')));
        for (const s of bySet) {
          const unseenNote = s.unseen && s.unseen.length > 0 ? ` (not seen: ${s.unseen.join(', ')})` : '';
          lines.push(`| ${s.set.join(', ')}${unseenNote} | ${s.admitted} |`);
        }
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
  {
    key: 'guards',
    async collect(ctx) {
      if (!ctx.opts.split) return { skipped: '--split not given' };
      if (ctx.runs.error) throw new Error(ctx.runs.error);
      return collectGuards(
        { runs: ctx.runs.runs, split: ctx.opts.split, n: ctx.opts.runs || DEFAULT_RUNS, roots: ctx.roots, repo: ctx.repo },
        { fsImpl: ctx.deps.fs, gh: ctx.deps.gh },
      );
    },
    failed: (d) => Boolean(d.before && d.after && (d.before.postMergeBugs.error || d.after.postMergeBugs.error)),
    unreadable: () => 0,
    render(d) {
      if (d.skipped) return ['Guards: not run — --split <YYYY-MM-DD> not given.'];
      const mean = (v) => v.toFixed(2);
      const head = (label, c) => {
        if (c.runCount === 0) return `${label} (0 runs)`;
        const missing = c.noTiming > 0 ? `, ${c.noTiming} without timing.json` : '';
        return `${label} (${c.runCount} runs${missing}, ${c.from} to ${c.to})`;
      };
      const whole = (c) => {
        const w = c.wholeBranch;
        return w.n > 0 ? `${pct(w.share)} of ${w.n}; mean ${mean(w.meanCritical)} critical, ${mean(w.meanImportant)} important; ${w.unparsed} unparsed` : `none of 0; ${w.unparsed} unparsed`;
      };
      const first = (c) => `${pct(c.firstPass.share)} of ${c.firstPass.n}; ${c.firstPass.unparsed} unparsed`;
      const bugs = (c) => {
        const b = c.postMergeBugs;
        if (b.error) return `unavailable — ${b.error}`;
        return `${b.count} over ${b.mergedPrs} merged PRs (${b.perPr === null ? 'none' : mean(b.perPr)} per PR); ${b.unparsed} unparsed`;
      };
      const lines = ['## Guards', '', `Split ${d.split}; up to ${d.runs} runs per column.`, '', `| Guard | ${head('Before', d.before)} | ${head('After', d.after)} |`, '|---|---|---|'];
      lines.push(`| Whole-branch reviews with a Critical or Important issue | ${whole(d.before)} | ${whole(d.after)} |`);
      lines.push(`| Tasks with no re-review | ${first(d.before)} | ${first(d.after)} |`);
      lines.push(`| Bug records within 14 days of a merge touching its Key Files | ${bugs(d.before)} | ${bugs(d.after)} |`, '');
      const tiers = [...new Set([...Object.keys(d.before.firstPass.byTier), ...Object.keys(d.after.firstPass.byTier)])].sort();
      if (tiers.length > 0) {
        const cell = (c, tier) => (c.firstPass.byTier[tier] ? `${pct(c.firstPass.byTier[tier].share)} of ${c.firstPass.byTier[tier].n}` : 'none');
        lines.push('| First implementer tier | Before | After |', '|---|---|---|');
        for (const tier of tiers) lines.push(`| ${tier} | ${cell(d.before, tier)} | ${cell(d.after, tier)} |`);
      }
      return lines;
    },
  },
  {
    key: 'reviews',
    async collect(ctx) {
      if (ctx.runs.error) {
        // --section all leaves the exit code alone, like `Runs: unavailable`; --section reviews fails.
        if (ctx.opts.section === 'all') return { error: ctx.runs.error };
        throw new Error(ctx.runs.error);
      }
      return collectReviews(
        { runs: ctx.runs.runs, since: ctx.since, until: ctx.until, n: ctx.opts.runs || DEFAULT_RUNS, roots: ctx.roots },
        { fsImpl: ctx.deps.fs },
      );
    },
    failed: () => false,
    unreadable: () => 0,
    render(d) {
      const mean = (v) => (v === null || v === undefined ? 'none' : v.toFixed(2));
      const TIER_ORDER = ['fast', 'standard', 'capable', 'frontier'];
      const byTierOrder = (a, b) => {
        const ia = TIER_ORDER.indexOf(a);
        const ib = TIER_ORDER.indexOf(b);
        if (ia >= 0 || ib >= 0) return (ia < 0 ? TIER_ORDER.length : ia) - (ib < 0 ? TIER_ORDER.length : ib);
        return compareStrings(a, b);
      };
      const lines = [];
      // A table with no rows prints `none.` in place of the table.
      const table = (head, rows) => {
        if (rows.length === 0) {
          lines.push('none.', '');
          return;
        }
        lines.push(head, head.replace(/[^|]/g, '-'));
        for (const r of rows) lines.push(`| ${r.join(' | ')} |`);
        lines.push('');
      };
      const w = d.window;
      lines.push('## Reviews', '', `${w.runs} runs dated ${w.since} to ${w.until} (${w.units} run units: a multi-spec run counts once per spec member for the verdict figures); ${w.noTiming} without a timing.json, ${w.timingUnparsed} with an unreadable one.`, '');

      const t = d.taskReview;
      lines.push('### Task review', '', "The task-review tier follows the plan's review-risk flag, so the capable tier reviews the riskier tasks; the tiers are printed side by side, not compared.", '');
      table(
        '| Tier | Reviews | Approved | Needs fixes | Critical | Important | Minor | Minor only | Unparsed |',
        Object.keys(t.byTier).sort(byTierOrder).map((k) => {
          const x = t.byTier[k];
          return [k, String(x.n), pct(x.approved), pct(x.needsFixes), String(x.items.critical), String(x.items.important), String(x.items.minor), `${x.minorOnly.count} of ${x.minorOnly.of}`, `${x.unparsed}; items ${x.items.unparsed}`];
        }),
      );
      const rr = Object.keys(t.reReviews.byTier).sort(byTierOrder).map((k) => `${k} ${t.reReviews.byTier[k]}`);
      lines.push(`Re-reviews (not in the table): ${t.reReviews.n}${rr.length > 0 ? ` (${rr.join(', ')})` : ''}.`, '');

      const p = d.planReview;
      lines.push('### Plan review', '', `Reviews: ${p.reviews}; with a finding: ${pct(p.withFindings)}; findings per review: ${mean(p.findingsPerReview)}; unparsed: ${p.unparsed}.`, `Stopped to ask a human: ${p.humanStops.runs} of ${p.humanStops.planReviewUnits} run units with a plan review (${p.humanStops.n} readable, ${p.humanStops.unparsed} unparsed).`, '');
      table('| Kind | Findings |', [...PLAN_KINDS, 'other'].filter((k) => k in p.byKind).map((k) => [k, String(p.byKind[k])]));

      const l = d.lens;
      const lensHead = (first) => `| ${first} | Agents | No finding | Findings per agent | Critical | High | Medium | Low | Info | Overflow | Unparsed |`;
      const lensRows = (map, order) => Object.keys(map).sort(order).map((k) => {
        const x = map[k];
        const a = x.perAgent;
        return [k, String(x.agents), pct(x.noFinding), mean(a && a.total), mean(a && a.critical), mean(a && a.high), mean(a && a.medium), mean(a && a.low), mean(a && a.info), mean(a && a.overflow), String(x.unparsed)];
      });
      lines.push('### Lens review by tier', '', 'Each lens runs on one fixed model profile, so this table compares lenses, not models.', '', `${l.unreadable} runs with unreadable lens dispatches, counted in no lens figure.`, '');
      table(lensHead('Tier'), lensRows(l.byTier, byTierOrder));
      lines.push('### Lens review by lens', '');
      table(lensHead('Lens'), lensRows(l.byLens, compareStrings));

      const verdictHead = (first) => `| ${first} | Confirmed | Both reviewers | Tiebreak | Refuted | Can't tell |`;
      const verdictRow = (name, x) => [name, String(x.confirmed), String(x.pair), String(x.tiebreak), String(x.refuted), String(x.cantTell)];
      lines.push('### Lens verdicts', '', '"Confirmed" is the tiebreak judge\'s verdict or a pair\'s agreement, not ground truth.', '');
      table(verdictHead('Run'), l.perRun.rows.map((r) => verdictRow(r.run, r)));
      table(verdictHead('Lens'), Object.keys(l.perRun.byLens).sort(compareStrings).map((k) => verdictRow(k, l.perRun.byLens[k])));
      lines.push(`Run units read: ${l.perRun.n}; unparsed: ${l.perRun.unparsed}.`, '');

      const o = l.outcomes;
      const shares = (s) => ['fixed', 'dismissed', 'staged', 'deferred'].map((k) => `${k} ${pct(s[k])}`).join(', ');
      lines.push('### Lens outcomes', '', `Of ${o.n} routed confirmed locations: ${shares(o)}; ${o.unrouted} unrouted (left out of the shares); ${o.unparsed} run units unparsed.`, `Of ${o.allRouted.n} routed locations, refuted ones included (the 2026-11-18 measurement's division): ${shares(o.allRouted)}.`, '');

      lines.push('### Lens yield', '', `Up to ${l.yield.runs} most recent runs per lens dated on or before ${w.until}, whatever --since says.`, 'A run with no recorded verdict line (a fully clean review included) takes no slot and is counted unparsed.', '');
      table('| Lens | Runs | Agents | Confirmed | Confirmed per agent | Unparsed |', Object.keys(l.yield.byLens).sort(compareStrings).map((k) => {
        const x = l.yield.byLens[k];
        return [k, String(x.runs), String(x.agents), String(x.confirmed), mean(x.rate), String(x.unparsed)];
      }));
      return lines;
    },
  },
];

const SECTION_KEYS = SECTIONS.map((s) => s.key);
const USAGE = `usage: node tools/pipeline-cost-report.js [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>] [--projects <dir>]... [--pipelines <dir>] [--match <substring> | --all-projects] [--section ${[...SECTION_KEYS, 'all'].join('|')}] [--split <YYYY-MM-DD>] [--runs <n>] [--repo <owner/name>] [--simulate <reason[,reason...]>]... [--json]
  spend and the funnel's dispatch firings cover the main checkout and its worktrees unless --match or --all-projects widens it; the funnel always checks the current checkout's repository, so --repo must match it for --section funnel|all
  guards compares the last --runs (default ${DEFAULT_RUNS}) pipeline runs dated before --split with the first --runs on or after it; --section guards needs --split, and --section all without it skips guards
  reviews reads the review results of the runs dated in the window; --runs (default ${DEFAULT_RUNS}) sets only its lens yield, which takes the latest runs per lens dated on or before --until whatever --since says`;

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
    else if (a === '--all-projects') opts.allProjects = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--since' || a === '--until') {
      const v = args[++i];
      if (!isDate(v)) return { error: `${a} needs a YYYY-MM-DD date` };
      opts[a.slice(2)] = v;
    } else if (a === '--split') {
      const v = args[++i];
      if (!isDate(v)) return { error: '--split needs a YYYY-MM-DD date' };
      opts.split = v;
    } else if (a === '--runs') {
      const v = args[++i];
      if (!/^[1-9]\d*$/.test(v || '')) return { error: '--runs needs a positive integer' };
      opts.runs = Number(v);
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
  if (opts.allProjects && opts.match) return { error: '--match and --all-projects cannot be combined' };
  if (opts.section === 'guards' && !opts.split) return { error: '--section guards needs --split <YYYY-MM-DD>' };
  return { opts };
}

// Roots, de-duplicated by real path. A default root that does not exist is skipped; an explicit --projects root that
// cannot be resolved is counted in `unresolved` (a typo must not read as an empty window).
function resolveRoots(opts, deps) {
  const explicit = opts.projects.length > 0;
  let candidates = opts.projects.map((p) => path.resolve(deps.cwd, p));
  if (!explicit) {
    candidates = [path.join(deps.home, '.claude', 'projects')];
    const configDir = deps.env && deps.env.CLAUDE_CONFIG_DIR;
    if (configDir) candidates.push(path.join(path.resolve(deps.cwd, configDir), 'projects'));
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
  let unresolved = 0;
  for (const c of candidates) {
    let real;
    try {
      real = deps.fs.realpathSync(c);
    } catch {
      if (explicit) unresolved += 1;
      continue;
    }
    if (!seen.has(real)) {
      seen.add(real);
      roots.push(real);
    }
  }
  return { roots, unresolved };
}

function mainCheckoutRoot(deps) {
  const commonDir = deps.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: deps.cwd }).trim();
  if (!commonDir) throw new Error('empty output');
  return path.resolve(path.dirname(commonDir));
}

function mainCheckoutPipelines(deps) {
  return path.join(mainCheckoutRoot(deps), '.claude-tweaks', 'pipelines');
}

// The effective spend filter: --all-projects, else --match, else the main checkout (and so its worktrees).
function resolveScope(opts, deps) {
  if (opts.allProjects) return { kind: 'all', value: null };
  if (opts.match) return { kind: 'substring', value: opts.match };
  try {
    return { kind: 'path', value: mainCheckoutRoot(deps) };
  } catch (e) {
    return { kind: 'path', value: null, error: firstLine(e) };
  }
}

function scopeLine({ kind, value }) {
  if (kind === 'all') return 'Match: all projects';
  if (kind === 'substring') return `Match: working directory contains "${value}"`;
  return value ? `Match: ${value} and its worktrees` : 'Match: unresolved (main checkout not found)';
}

function render(report) {
  const lines = [];
  for (const s of SECTIONS) {
    if (!(s.key in report)) continue;
    const d = report[s.key];
    if (d.error) lines.push(`${s.key}: unavailable — ${d.error}`, '');
    else {
      // one blank line between sections, whether or not a section's own lines end in one
      const body = s.render(d);
      while (body.length > 0 && body[body.length - 1] === '') body.pop();
      lines.push(...body, '');
    }
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
    ...(report.window.match ? [scopeLine(report.window.match)] : []),
    SESSION_TYPE_NOTE,
    '',
  ];
  lines.push(...render(report));
  const r = report.runs;
  if (r) {
    if (r.error) lines.push(`Runs: unavailable — ${r.error}`);
    else if (r.missing) lines.push(`Runs: not found: ${r.dir}`);
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

  const wants = (key) => opts.section === 'all' || opts.section === key;
  let repoPromise = null;
  const repoOf = () => {
    if (!repoPromise) repoPromise = Promise.resolve().then(() => opts.repo || String(deps.gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])).trim());
    return repoPromise;
  };

  // The funnel checks the current checkout's repository whatever --repo says, so a different --repo is refused.
  if (opts.repo && wants('funnel')) {
    let current;
    try {
      current = String(deps.gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])).trim();
    } catch (e) {
      deps.err(`pipeline-cost-report.js: cannot confirm --repo against the current checkout (${firstLine(e)})`);
      return 1;
    }
    if (current.toLowerCase() !== opts.repo.toLowerCase()) {
      deps.err(`pipeline-cost-report.js: --repo ${opts.repo} is not this checkout's repository (${current}); the funnel always checks the current checkout's repository. Run it from a checkout of ${opts.repo}, or use --section spend|records\n${USAGE}`);
      return 2;
    }
  }

  const scope = wants('spend') || wants('funnel') ? resolveScope(opts, deps) : null;
  const { roots, unresolved } = resolveRoots(opts, deps);
  const ctx = {
    deps, opts, since, until, scope,
    roots,
    repo: repoOf,
    // One projection per main transcript, shared by spend and the funnel so `--section all` scans each once.
    transcriptCache: new Map(),
  };

  // Run directories are listed once, before the sections, so a section's collect can read ctx.runs.
  let pipelinesDir = opts.pipelines ? path.resolve(deps.cwd, opts.pipelines) : null;
  try {
    if (!pipelinesDir) pipelinesDir = mainCheckoutPipelines(deps);
    ctx.runs = { ...listRuns(pipelinesDir, deps.fs), pipelinesDir };
  } catch (e) {
    ctx.runs = { error: `cannot resolve the pipelines directory (${firstLine(e)}); pass --pipelines <dir>` };
  }

  const report = { window: { since, until, ...(scope ? { match: scope.error ? { kind: scope.kind, value: null, error: scope.error } : { kind: scope.kind, value: scope.value } } : {}) }, priceTableDate: PRICES.date };
  let exit = 0;
  let unreadable = wants('spend') || wants('funnel') ? unresolved : 0;
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
