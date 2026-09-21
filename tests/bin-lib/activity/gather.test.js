'use strict';
// tests/bin-lib/activity/gather.test.js — #2757: the gather module's period resolution,
// exact per-query argv (pinned to Task 0's live probe), per-call fail-safe batching, and
// the closed_issues role tagging. Fake runner only — never real `gh`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePeriod, PeriodError, buildQueries, gather, ACTIVITY_GH_TIMEOUT_MS, QUERY_KEYS,
} = require('../../../plugin/bin/lib/activity/gather');

const NOW = new Date('2026-09-22T10:00:00Z');
const LOGIN = 'octocat';
const SLUG = 'acme/widgets';

test('resolvePeriod: presets are rolling day counts ending today (UTC)', () => {
  assert.deepEqual(resolvePeriod('1d', NOW), { from: '2026-09-21', to: '2026-09-22', preset: '1d' });
  assert.deepEqual(resolvePeriod('7d', NOW), { from: '2026-09-15', to: '2026-09-22', preset: '7d' });
  assert.deepEqual(resolvePeriod('14d', NOW), { from: '2026-09-08', to: '2026-09-22', preset: '14d' });
  assert.deepEqual(resolvePeriod('month', NOW), { from: '2026-08-23', to: '2026-09-22', preset: 'month' });
  assert.deepEqual(resolvePeriod('quarter', NOW), { from: '2026-06-24', to: '2026-09-22', preset: 'quarter' });
});

test('resolvePeriod: explicit from..to is inclusive and carries no preset', () => {
  assert.deepEqual(resolvePeriod('2026-09-01..2026-09-14', NOW), { from: '2026-09-01', to: '2026-09-14', preset: null });
});

test('resolvePeriod: rejects unknown forms with a PeriodError naming the accepted forms', () => {
  assert.throws(() => resolvePeriod('yesterday', NOW), (err) => err instanceof PeriodError
    && /1d\|7d\|14d\|month\|quarter\|<from>\.\.<to>/.test(err.message));
  assert.throws(() => resolvePeriod('2026-09-14..2026-09-01', NOW), (err) => err instanceof PeriodError && /before/.test(err.message));
});

test('buildQueries: six queries, exact argv pinned to the Task 0 live probe', () => {
  const q = buildQueries({ login: LOGIN, slug: SLUG, from: '2026-09-15', to: '2026-09-22' });
  assert.deepEqual(q.map((x) => x.key), QUERY_KEYS);
  assert.deepEqual(QUERY_KEYS, ['merged_prs', 'closed_issues', 'issues_raised', 'commits', 'reviews_given', 'in_flight']);
  const byKey = Object.fromEntries(q.map((x) => [x.key, x.args]));
  assert.deepEqual(byKey.merged_prs, ['pr', 'list', '--repo', SLUG, '--state', 'merged', '--search',
    'author:octocat merged:2026-09-15..2026-09-22', '--limit', '200', '--json', 'number,title,url,mergedAt,additions,deletions,labels']);
  assert.deepEqual(byKey.closed_issues, ['issue', 'list', '--repo', SLUG, '--state', 'closed', '--search',
    'closed:2026-09-15..2026-09-22', '--limit', '200', '--json', 'number,title,url,closedAt,labels,author,assignees']);
  assert.deepEqual(byKey.issues_raised, ['issue', 'list', '--repo', SLUG, '--state', 'all', '--search',
    'author:octocat created:2026-09-15..2026-09-22', '--limit', '200', '--json', 'number,title,url,createdAt,state']);
  assert.deepEqual(byKey.commits, ['api',
    'repos/acme/widgets/commits?since=2026-09-15T00:00:00Z&until=2026-09-22T23:59:59Z&author=octocat&per_page=100',
    '--paginate', '--slurp']);
  assert.deepEqual(byKey.reviews_given, ['search', 'prs', '--repo', SLUG, '--reviewed-by', LOGIN, '--updated',
    '2026-09-15..2026-09-22', '--limit', '200', '--json', 'number,title,url,updatedAt,author']);
  assert.deepEqual(byKey.in_flight, ['pr', 'list', '--repo', SLUG, '--state', 'open', '--search', 'author:octocat',
    '--limit', '100', '--json', 'number,title,url,isDraft,updatedAt']);
});

// One fake runner answering every query with a small, realistic payload.
function happyRunner(calls) {
  return (args, opts) => {
    calls.push({ args, opts });
    const s = args.join(' ');
    if (s.startsWith('pr list') && s.includes('--state merged')) return JSON.stringify([
      { number: 10, title: 'Merged one', url: 'https://x/pull/10', mergedAt: '2026-09-20T00:00:00Z', additions: 3, deletions: 1, labels: [{ name: 'bug' }] },
    ]);
    if (s.startsWith('issue list') && s.includes('--state closed')) return JSON.stringify([
      { number: 20, title: 'Closed as author+assignee', url: 'https://x/issues/20', closedAt: '2026-09-19T00:00:00Z', labels: [], author: { login: LOGIN }, assignees: [{ login: LOGIN }] },
      { number: 21, title: 'Closed by someone else', url: 'https://x/issues/21', closedAt: '2026-09-19T00:00:00Z', labels: [], author: { login: 'other' }, assignees: [] },
      { number: 22, title: 'Assigned only', url: 'https://x/issues/22', closedAt: '2026-09-19T00:00:00Z', labels: [], author: { login: 'other' }, assignees: [{ login: LOGIN }] },
    ]);
    if (s.startsWith('issue list') && s.includes('--state all')) return JSON.stringify([
      { number: 30, title: 'Raised', url: 'https://x/issues/30', createdAt: '2026-09-18T00:00:00Z', state: 'OPEN' },
    ]);
    if (s.startsWith('api repos/')) return JSON.stringify([[
      { sha: 'abcdef1234567890abcdef1234567890abcdef12', html_url: 'https://x/commit/abcdef1', commit: { message: 'First line\n\nbody', author: { date: '2026-09-17T00:00:00Z' } } },
    ], []]);
    if (s.startsWith('search prs')) return JSON.stringify([
      { number: 40, title: 'Reviewed', url: 'https://x/pull/40', updatedAt: '2026-09-16T00:00:00Z', author: { login: 'other' } },
      { number: 41, title: 'My own PR', url: 'https://x/pull/41', updatedAt: '2026-09-16T00:00:00Z', author: { login: LOGIN } },
    ]);
    if (s.startsWith('pr list') && s.includes('--state open')) return JSON.stringify([
      { number: 50, title: 'Open', url: 'https://x/pull/50', isDraft: true, updatedAt: '2026-09-21T00:00:00Z' },
    ]);
    throw new Error('unexpected ' + s);
  };
}

test('gather: every call carries the 15 s timeout and the facts shape is complete', () => {
  const calls = [];
  const facts = gather({ period: '7d', repos: [SLUG], actor: LOGIN }, { runner: happyRunner(calls), now: NOW });
  assert.equal(calls.length, 6);
  for (const c of calls) assert.deepEqual(c.opts, { timeout: ACTIVITY_GH_TIMEOUT_MS });
  assert.equal(ACTIVITY_GH_TIMEOUT_MS, 15000);
  assert.equal(facts.schemaVersion, 1);
  assert.equal(facts.actor, LOGIN);
  assert.deepEqual(facts.period, { from: '2026-09-15', to: '2026-09-22', preset: '7d' });
  assert.deepEqual(facts.repos, [SLUG]);
  assert.deepEqual(facts.merged_prs, [{ repo: SLUG, number: 10, title: 'Merged one', url: 'https://x/pull/10', mergedAt: '2026-09-20T00:00:00Z', additions: 3, deletions: 1, labels: ['bug'] }]);
  assert.deepEqual(facts.issues_raised, [{ repo: SLUG, number: 30, title: 'Raised', url: 'https://x/issues/30', createdAt: '2026-09-18T00:00:00Z', state: 'OPEN' }]);
  assert.deepEqual(facts.commits, [{ repo: SLUG, sha: 'abcdef1234567890abcdef1234567890abcdef12', subject: 'First line', date: '2026-09-17T00:00:00Z', url: 'https://x/commit/abcdef1' }]);
  assert.deepEqual(facts.reviews_given, [{ repo: SLUG, number: 40, title: 'Reviewed', url: 'https://x/pull/40', updatedAt: '2026-09-16T00:00:00Z' }]);
  assert.deepEqual(facts.in_flight, [{ repo: SLUG, number: 50, title: 'Open', url: 'https://x/pull/50', isDraft: true, updatedAt: '2026-09-21T00:00:00Z' }]);
  assert.deepEqual(facts.failures, []);
  assert.match(facts.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('gather: closed_issues keeps author-or-assignee only, author role wins, one entry per issue', () => {
  const facts = gather({ period: '7d', repos: [SLUG], actor: LOGIN }, { runner: happyRunner([]), now: NOW });
  assert.deepEqual(facts.closed_issues, [
    { repo: SLUG, number: 20, title: 'Closed as author+assignee', url: 'https://x/issues/20', closedAt: '2026-09-19T00:00:00Z', labels: [], role: 'author' },
    { repo: SLUG, number: 22, title: 'Assigned only', url: 'https://x/issues/22', closedAt: '2026-09-19T00:00:00Z', labels: [], role: 'assignee' },
  ]);
});

test('gather: one throwing query lands in failures[] while the others populate', () => {
  const calls = [];
  const base = happyRunner(calls);
  const runner = (args, opts) => {
    if (args.includes('merged') && args[0] === 'pr') throw new Error('HTTP 503: No server is currently available');
    return base(args, opts);
  };
  const facts = gather({ period: '7d', repos: [SLUG], actor: LOGIN }, { runner, now: NOW });
  assert.deepEqual(facts.failures, [{ query: 'merged_prs', repo: SLUG, error: 'HTTP 503: No server is currently available' }]);
  assert.deepEqual(facts.merged_prs, []);
  assert.equal(facts.closed_issues.length, 2);
  assert.equal(facts.in_flight.length, 1);
});

test('gather: a non-JSON runner reply is a failure for that query only', () => {
  const runner = (args, opts) => (args[0] === 'search' ? 'not json' : happyRunner([])(args, opts));
  const facts = gather({ period: '7d', repos: [SLUG], actor: LOGIN }, { runner, now: NOW });
  assert.equal(facts.failures.length, 1);
  assert.equal(facts.failures[0].query, 'reviews_given');
  assert.deepEqual(facts.reviews_given, []);
});

test('gather: runs the query set once per repo, tagging each entry with its repo', () => {
  const calls = [];
  const facts = gather({ period: '7d', repos: [SLUG, 'acme/gadgets'], actor: LOGIN }, { runner: happyRunner(calls), now: NOW });
  assert.equal(calls.length, 12);
  assert.deepEqual(facts.merged_prs.map((x) => x.repo), [SLUG, 'acme/gadgets']);
});
