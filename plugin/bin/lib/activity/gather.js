// plugin/bin/lib/activity/gather.js — the deterministic half of /claude-tweaks:activity (#2757).
// All `gh` calls live here; no narration, no judgment. `gather()` runs the six queries in
// QUERY_KEYS once per repo through `deps.runner(args, { timeout })` (argv array, never a shell
// string — .claude/skills/gh-api-module-pattern), each call independently try/caught into
// `facts.failures[]` (per-call fail-safe batching), and returns the facts.json object.
//
// Minimum gh: 2.40 (`api --paginate --slurp`); `search prs --updated <from>..<to>` with `--repo`
// scoping verified on gh 2.92.0 (Task 0 live probe, 2026-09-22).
//
// Standing caveats the report footer restates:
//  - Search-index lag: `--search` and `search prs` ride GitHub's search index, which lags fresh
//    writes by minutes. Acceptable for a period report; never "fixed" by whole-repo list scans.
//  - `reviews_given` is a proxy: `--updated` filters on the PR's last update, not the review's
//    own timestamp, so a review on a PR untouched since falls out and an old review on a
//    recently-updated PR falls in. Own-authored PRs are dropped client-side.
//  - Commit identity: commits are matched by GitHub login via the API's `author=` parameter; a
//    commit authored with an email not linked to that account never appears. An empty
//    `commits[]` beside non-empty actor arrays is a footer note, not a failure.
//  - `closed_issues` = closed in the window with the actor as author or assignee (`role`,
//    author wins); issues the actor closed during triage without either role are out of scope.
//  - Rename redirects: the search API does not follow a repository rename, so callers must pass
//    canonical `owner/name` slugs (activity-gather.js canonicalizes via `gh repo view`).
'use strict';

// Wider than the shared 5 s GH_TIMEOUT_MS (bin/lib/shared-primitives.js) because the commits
// query is `--paginate` — one call, several pages — and a 200-row search is not a 5 s call on a
// busy repo either. Stated here so the widening is deliberate, not copied.
const ACTIVITY_GH_TIMEOUT_MS = 15000;

const PRESETS = { '1d': 1, '7d': 7, '14d': 14, month: 30, quarter: 90 };
const ACCEPTED_FORMS = '1d|7d|14d|month|quarter|<from>..<to> (YYYY-MM-DD..YYYY-MM-DD)';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QUERY_KEYS = ['merged_prs', 'closed_issues', 'issues_raised', 'commits', 'reviews_given', 'in_flight'];

class PeriodError extends Error {
  constructor(message) { super(message); this.name = 'PeriodError'; }
}

const isoDate = (d) => d.toISOString().slice(0, 10);

// A calendar-date string is valid only if it round-trips through Date.UTC — this rejects
// rollovers like `2026-02-30` (which Date.parse silently normalizes to March 2) and
// `2026-13-01` (month 13), which DATE_RE's shape check alone lets through.
function isCalendarDate(str) {
  if (!DATE_RE.test(str)) return false;
  const [y, mo, day] = str.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1, day));
  return d.getUTCFullYear() === y && d.getUTCMonth() === mo - 1 && d.getUTCDate() === day;
}

function resolvePeriod(spec, now = new Date()) {
  const s = String(spec ?? '').trim();
  if (Object.prototype.hasOwnProperty.call(PRESETS, s)) {
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const from = new Date(to.getTime() - PRESETS[s] * 86400000);
    return { from: isoDate(from), to: isoDate(to), preset: s };
  }
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(s);
  if (m) {
    const [, from, to] = m;
    if (!isCalendarDate(from) || !isCalendarDate(to)) throw new PeriodError(`invalid date in period "${s}" — accepted forms: ${ACCEPTED_FORMS}`);
    if (from > to) throw new PeriodError(`period "${s}": <from> must be on or before <to> — accepted forms: ${ACCEPTED_FORMS}`);
    return { from, to, preset: null };
  }
  throw new PeriodError(`unrecognized period "${s}" — accepted forms: ${ACCEPTED_FORMS}`);
}

function buildQueries({ login, slug, from, to }) {
  return [
    { key: 'merged_prs', args: ['pr', 'list', '--repo', slug, '--state', 'merged', '--search', `author:${login} merged:${from}..${to}`, '--limit', '200', '--json', 'number,title,url,mergedAt,additions,deletions,labels'] },
    { key: 'closed_issues', args: ['issue', 'list', '--repo', slug, '--state', 'closed', '--search', `closed:${from}..${to}`, '--limit', '200', '--json', 'number,title,url,closedAt,labels,author,assignees'] },
    { key: 'issues_raised', args: ['issue', 'list', '--repo', slug, '--state', 'all', '--search', `author:${login} created:${from}..${to}`, '--limit', '200', '--json', 'number,title,url,createdAt,state'] },
    { key: 'commits', args: ['api', `repos/${slug}/commits?since=${from}T00:00:00Z&until=${to}T23:59:59Z&author=${login}&per_page=100`, '--paginate', '--slurp'] },
    { key: 'reviews_given', args: ['search', 'prs', '--repo', slug, '--reviewed-by', login, '--updated', `${from}..${to}`, '--limit', '200', '--json', 'number,title,url,updatedAt,author'] },
    { key: 'in_flight', args: ['pr', 'list', '--repo', slug, '--state', 'open', '--search', `author:${login}`, '--limit', '100', '--json', 'number,title,url,isDraft,updatedAt'] },
  ];
}

const labelNames = (labels) => (Array.isArray(labels) ? labels.map((l) => (typeof l === 'string' ? l : l && l.name)).filter(Boolean) : []);
const loginOf = (u) => (u && typeof u === 'object' ? u.login : u) || null;

// Per-key shaping of gh's raw JSON into facts.json rows. Each returns an array.
const SHAPERS = {
  merged_prs: (rows, { slug }) => rows.map((r) => ({ repo: slug, number: r.number, title: r.title, url: r.url, mergedAt: r.mergedAt, additions: r.additions, deletions: r.deletions, labels: labelNames(r.labels) })),
  closed_issues: (rows, { slug, login }) => rows.flatMap((r) => {
    const isAuthor = loginOf(r.author) === login;
    const isAssignee = Array.isArray(r.assignees) && r.assignees.some((a) => loginOf(a) === login);
    if (!isAuthor && !isAssignee) return [];
    return [{ repo: slug, number: r.number, title: r.title, url: r.url, closedAt: r.closedAt, labels: labelNames(r.labels), role: isAuthor ? 'author' : 'assignee' }];
  }),
  issues_raised: (rows, { slug }) => rows.map((r) => ({ repo: slug, number: r.number, title: r.title, url: r.url, createdAt: r.createdAt, state: r.state })),
  // `--paginate --slurp` returns an array of pages; each page is an array of commit objects.
  commits: (pages, { slug }) => pages.flat().map((c) => ({ repo: slug, sha: c.sha, subject: String((c.commit && c.commit.message) || '').split('\n')[0], date: c.commit && c.commit.author && c.commit.author.date, url: c.html_url })),
  reviews_given: (rows, { slug, login }) => rows.filter((r) => loginOf(r.author) !== login).map((r) => ({ repo: slug, number: r.number, title: r.title, url: r.url, updatedAt: r.updatedAt })),
  in_flight: (rows, { slug }) => rows.map((r) => ({ repo: slug, number: r.number, title: r.title, url: r.url, isDraft: r.isDraft, updatedAt: r.updatedAt })),
};

function errorText(err) {
  const parts = [err && err.message, err && err.stderr, err && err.stdout].filter((p) => p && String(p).trim());
  return parts.length ? parts.map((p) => String(p).trim()).join(' | ') : String(err);
}

// { period, repos, actor }, deps -> facts.json object. Pure over deps: `deps.runner` is the
// only side effect; `deps.now` (a Date) pins the clock for tests.
function gather({ period, repos, actor }, deps) {
  const now = deps.now || new Date();
  const resolved = resolvePeriod(period, now);
  const facts = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    actor,
    period: resolved,
    repos: [...repos],
    merged_prs: [], closed_issues: [], issues_raised: [], commits: [], reviews_given: [], in_flight: [],
    failures: [],
  };
  for (const slug of repos) {
    for (const { key, args } of buildQueries({ login: actor, slug, from: resolved.from, to: resolved.to })) {
      try {
        const parsed = JSON.parse(deps.runner(args, { timeout: ACTIVITY_GH_TIMEOUT_MS }));
        if (!Array.isArray(parsed)) throw new Error(`expected a JSON array from gh ${args.slice(0, 2).join(' ')}`);
        facts[key].push(...SHAPERS[key](parsed, { slug, login: actor }));
      } catch (err) {
        facts.failures.push({ query: key, repo: slug, error: errorText(err) });
      }
    }
  }
  return facts;
}

module.exports = { resolvePeriod, PeriodError, buildQueries, gather, ACTIVITY_GH_TIMEOUT_MS, QUERY_KEYS, PRESETS };
