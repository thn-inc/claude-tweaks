# #2757 — `/claude-tweaks:activity` period-scoped what-shipped report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/claude-tweaks:activity`: a `gh`-only gather CLI that writes `facts.json`, a skill that narrates between gather and render, and a render CLI that validates every citation against the facts and drops any that is not present — so a hallucinated issue number is structurally unpublishable.

**Architecture:** Three components with a hard boundary. `plugin/bin/lib/activity/gather.js` (+ `plugin/bin/activity-gather.js`) makes six `gh` calls per repo through an injectable runner, each independently fail-safe into `facts.failures[]`. `plugin/skills/activity/SKILL.md` reads the facts and writes `narratives.json`. `plugin/bin/lib/activity/render.js` (+ `plugin/bin/activity-render.js`) validates `refs[]` against the citable set and renders markdown. Everything under `plugin/bin/` follows `.claude/skills/gh-api-module-pattern` (argv-array runner, bounded remote calls, `run(argv, deps)`, `process.exitCode`, Split-1/2 exit vocabulary). Task 0's live probes ran already (results below) and pin the argv.

**Tech Stack:** Node 18+ built-ins only (`child_process`, `fs`, `path`); `node --test`; `gh` 2.92.0 at runtime.

**Spec:** `.claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2757/work/2757-spec.md`

## Global Constraints

- Exit vocabulary *Split-1/2* for both CLIs: `0` success (a partial gather with `failures[]` populated is still `0`), `1` malformed invocation, `2` missing dependency (`gh` absent, `gh auth status` fails) or unresolvable owner/repo, `3` the remote call itself failed (gather: **every** query failed). `activity-render.js` uses `0`/`1`/`2` only (`2` = facts or narratives file unreadable or failing schema validation).
- `require.main === module` guards set `process.exitCode = run(process.argv.slice(2), realDeps)` — never `process.exit` (`tests/bin-lib/exit-code-conformance.test.js` walks every `plugin/bin/**/*.js`). `--help` short-circuits before any availability probe.
- Every `gh` call goes through `deps.runner(args, { timeout: ACTIVITY_GH_TIMEOUT_MS })` with `ACTIVITY_GH_TIMEOUT_MS = 15000` and a comment stating why it is wider than the shared 5 s `GH_TIMEOUT_MS` (`--paginate` on commits is a multi-page call). Argv arrays only, never shell strings.
- Every `deps` call that can throw (`remoteUrl` outside a git repo, `runner`) is try/caught into the exit-code contract.
- `facts.json` and `narratives.json` both carry `schemaVersion: 1`; the renderer rejects any other value in either file (exit 2 from the CLI, a thrown `SchemaError` from the module). Refs come only from `refs[]` — the renderer never scans `text` for `#123`.
- Exact warning strings: `warning: dropped citation {owner/repo}#{N} — not present in facts.json` (also for `{owner/repo}@{prefix}` with no matching commit) and `warning: ambiguous citation {owner/repo}@{prefix} — matches {k} commits`.
- Citable ref grammar: `{owner/name}#{N}` resolves against the union of `number` over `merged_prs`, `closed_issues`, `issues_raised`, `reviews_given`, `in_flight` for that repo; `{owner/name}@{sha7+}` (7-40 hex chars, case-insensitive) resolves by prefix against `commits[].sha` and must match exactly one commit.
- Rendered markdown: `# Activity — {from} to {to} ({register})`, one `## {heading}` per non-empty section with `- {text} ({ref links})` bullets (each ref a markdown link `[{owner/repo}#{N}]({url})` / `[{owner/repo}@{sha7}]({url})`), a `## Partial gather` section listing `failures[]` verbatim when non-empty, and a `## Notes` footer with counts plus the three standing caveats. Empty period (every facts array empty AND `narratives.sections` empty or all items empty): `# Activity — {from} to {to} ({register})` then a blank line then exactly `No activity found for {from}..{to} in {repos}.` — no other headings, no footer.
- Presets are rolling day counts ending today (`to` = today's UTC date): `1d`=1, `7d`=7, `14d`=14, `month`=30, `quarter`=90; `from` = `to` minus N days. `<from>..<to>` (both `YYYY-MM-DD`) is inclusive of both days. Any other spec throws a `PeriodError` naming the accepted forms; the CLI maps it to exit 1.
- The skill: defaults `--period 7d`, `--register retro`; runs `activity-gather.js` to a session-scoped `activity-facts.json`; writes `activity-narratives.json` with the Write tool; runs `activity-render.js`; the report shown is always the renderer's output; every render warning is relayed verbatim; then exactly one `AskUserQuestion` for the save location. It carries the sentence **never invent PRs, issues, numbers, dates, or people** verbatim, names no write destination under `.claude-tweaks/artifacts/`, defaults the archive path to `docs/reports/activity-{from}-{to}.md`, and contains no `git commit`/`git add` instruction.
- **Ruled premise corrections** (spec vs repo at base `6d0f768a4`, `[IL-71]`): (a) the spec asks for "the canonical Interaction-style directive" in `SKILL.md`; since #1909 that directive is injected by the SessionStart hook and `tests/skill-conventions.test.js` FAILS any skill carrying an inline copy — the skill therefore carries **no** directive line. (b) `docs/reports/` does not exist; the skill's `Archive path` option creates it on save. (c) The `reviews_given` proxy on a single-maintainer repo drops every PR the actor authored, so the live 7-day probe below yields an empty array — expected, not a failure.
- Multi-spec shared worktree: the five registration files (`docs/skill-graph.md`, `plugin/skills/help/reference-card.md`, `plugin/skills/help/context-flow.md`, `docs/getting-started.md`, `docs/plugin-structure.md`) are also edited by #2758 later in this run — edit in place, never rewrite them.
- Commit message style `{Verb} {what} — {detail}`, each commit ending with `Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj`. Worktree Bash guard: one plain command per Bash call; no heredocs, no `$(...)` feeding git, no redirection outside the worktree; author files with the Write tool; `git -C "<worktree>" …` for every git call.
- Pre-existing failures on this Windows box (run ledger #2 baseline, 103 files) are not this record's; a **new** failing file, or a failing test naming a file this plan creates, is a regression. `tests/bin-lib/skill-audit/anti-patterns.test.js` pins the repo-wide Anti-Patterns row count at `412` today; Task 6 bumps it by re-running the parser, never by arithmetic.

## Task 0 evidence (already executed live, 2026-09-22, read-only)

`gh --version` → `gh version 2.92.0 (2026-04-28)`. Actor `gh api user -q .login` → `thomasholknielsen`. Repo `thn-inc/claude-tweaks` (the `origin` remote still names `thomasholknielsen/claude-tweaks`; GitHub redirects and `gh repo view` reports `thn-inc/claude-tweaks`). Window `2026-09-15..2026-09-22`. Every query below ran with the spec's argv **unchanged** — no reshaping needed, no flag rejected:

| facts key | argv (as run) | first result row (verbatim, truncated) |
|---|---|---|
| `merged_prs` | `pr list --repo thn-inc/claude-tweaks --state merged --search "author:thomasholknielsen merged:2026-09-15..2026-09-22" --limit 200 --json number,title,url,mergedAt,additions,deletions,labels` | `{"additions":13,"deletions":1,"labels":[],"mergedAt":"2026-09-21T16:44:09Z","number":2754,"title":"Restore browser OS-dependency install in the cloud Setup script","url":"https://github.com/thn-inc/claude-tweaks/pull/2754"}` |
| `closed_issues` | `issue list --repo thn-inc/claude-tweaks --state closed --search "closed:2026-09-15..2026-09-22" --limit 200 --json number,title,url,closedAt,labels,author,assignees` | `{"assignees":[],"author":{"id":"MDQ6VXNlcjI2NTExMTc5","is_bot":false,"login":"thomasholknielsen","name":"Thomas Holk Nielsen"},"closedAt":"2026-09-21T03:23:29Z","labels":[{"name":"ready",…}],…}` |
| `issues_raised` | `issue list --repo thn-inc/claude-tweaks --state all --search "author:thomasholknielsen created:2026-09-15..2026-09-22" --limit 200 --json number,title,url,createdAt,state` | `{"createdAt":"2026-09-21T21:18:20Z","number":2759,"state":"OPEN","title":"Feedback: draft-only --upstream <owner/name> path …","url":"https://github.com/thn-inc/claude-tweaks/issues/2759"}` |
| `commits` | `api "repos/thn-inc/claude-tweaks/commits?since=2026-09-15T00:00:00Z&until=2026-09-22T23:59:59Z&author=thomasholknielsen&per_page=100" --paginate --slurp` | `[[{"sha":"ee9629425cad9881b7ea8479815b91df26edbda5",…,"commit":{"author":{"name":"Thomas Holk Nielsen","email":"…","date":"2026-09-21T16:48:19Z"},…,"message":"chore(main): release 6.129.0 (#2753)",…` — note `--slurp` yields an **array of pages** (each page an array); flatten |
| `reviews_given` | `search prs --repo thn-inc/claude-tweaks --reviewed-by thomasholknielsen --updated 2026-09-15..2026-09-22 --limit 200 --json number,title,url,updatedAt,author` | `{"author":{"login":"thomasholknielsen",…},"number":2536,"title":"agent-browser: locator clicks can dispatch …","updatedAt":"2026-09-21T15:58:12Z","url":"https://github.com/thn-inc/claude-tweaks/pull/2536"}` — authored by the actor, so the client-side drop leaves `reviews_given` empty here |
| `in_flight` | `pr list --repo thn-inc/claude-tweaks --state open --search "author:thomasholknielsen" --limit 100 --json number,title,url,isDraft,updatedAt` | `{"isDraft":true,"number":2760,"title":"…/demo and /feedback SKILL.md files load their full body … (#2697)","updatedAt":"2026-09-21T23:17:39Z","url":"https://github.com/thn-inc/claude-tweaks/pull/2760"}` |

Minimum `gh` version: `--paginate --slurp` needs gh ≥ 2.40; `search prs --updated <from>..<to>` and `--repo` scoping are accepted on 2.92.0 (no positional-qualifier fallback needed). Record this table in `gather.js`'s header (version floor + lag/proxy/identity notes) — Task 1 — and in the record body's `## Gotchas` — Task 0.

---

### Task 0: Record the live-probe evidence in the materialized record

**Files:**
- Modify: `.claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2757/work/2757-spec.md` (append to `## Gotchas`)

- [ ] **Step 1: Append the evidence**

Use the Edit tool: after the last existing Gotchas bullet (`- The five docs registration files are also edited by the sibling walkthrough record …`), append:

```markdown
- **Task 0 live probe (2026-09-22, gh version 2.92.0 (2026-04-28), actor `thomasholknielsen`, repo `thn-inc/claude-tweaks`, window `2026-09-15..2026-09-22`):** every query in the Technical Approach table ran with its argv unchanged — no flag was rejected, so no reshaping and no fallback form. First rows: `merged_prs` → #2754 "Restore browser OS-dependency install in the cloud Setup script" (mergedAt 2026-09-21T16:44:09Z); `closed_issues` → an issue closed 2026-09-21T03:23:29Z authored by the actor with no assignees; `issues_raised` → #2759 (created 2026-09-21T21:18:20Z, OPEN); `commits` → `--paginate --slurp` returns an array of pages, first sha `ee9629425cad9881b7ea8479815b91df26edbda5` ("chore(main): release 6.129.0 (#2753)"); `reviews_given` → PR #2536, authored by the actor, so the client-side own-PR drop empties this array on a single-maintainer repo; `in_flight` → #2760 (draft). Minimum gh: 2.40 for `--paginate --slurp`; `search prs --updated <from>..<to>` with `--repo` scoping accepted on 2.92.0.
```

- [ ] **Step 2: Commit**

```bash
git add .claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2757/work/2757-spec.md
```
```bash
git commit -m "Record #2757's Task 0 live gh probes in the materialized spec — every query argv accepted unchanged on gh 2.92.0" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 1: `plugin/bin/lib/activity/gather.js` — period resolution, query table, fail-safe gather

**Files:**
- Create: `plugin/bin/lib/activity/gather.js`
- Test: `tests/bin-lib/activity/gather.test.js`

**Interfaces:**
- Produces (exports): `resolvePeriod(spec, now = new Date())` → `{ from, to, preset }` or throws `PeriodError`; `PeriodError` (class, `.name === 'PeriodError'`); `buildQueries({ login, slug, from, to })` → array of six `{ key, args }` in the order `merged_prs, closed_issues, issues_raised, commits, reviews_given, in_flight`; `gather({ period, repos, actor }, deps)` → the `facts.json` object; `ACTIVITY_GH_TIMEOUT_MS = 15000`; `QUERY_KEYS`.
- `deps.runner(args, { timeout })` returns stdout (a JSON string); a throw is a failed call. `deps.now` (optional `Date`) for tests.

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/activity/gather.test.js`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/activity/gather.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/activity/gather'`.

- [ ] **Step 3: Write `plugin/bin/lib/activity/gather.js`**

```js
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
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new PeriodError(`invalid date in period "${s}" — accepted forms: ${ACCEPTED_FORMS}`);
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
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/bin-lib/activity/gather.test.js`
Expected: PASS, 9/9.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/activity/gather.js tests/bin-lib/activity/gather.test.js
```
```bash
git commit -m "Add activity gather module — six pinned gh queries per repo, per-call fail-safe, rolling-period resolution (#2757)" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 2: `plugin/bin/activity-gather.js` — the gather CLI

**Files:**
- Create: `plugin/bin/activity-gather.js`
- Test: `tests/bin-lib/activity/gather-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `gather`, `PeriodError`; `plugin/bin/lib/repo-resolve.js`'s `parseRepo`, `ghAvailable`, `remoteUrl`, `repoSlug`.
- Produces: `run(argv, deps)` and `realDeps`; `deps` = `{ runner, ghAvailable, ghAuthOk, remoteUrl, writeFile, stdout, stderr, now }`. Exit vocabulary Split-1/2 as in Global Constraints.

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/activity/gather-cli.test.js`:

```js
'use strict';
// tests/bin-lib/activity/gather-cli.test.js — #2757: activity-gather.js's exit-code contract
// via run(argv, deps), with every side effect injected.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../../plugin/bin/activity-gather');

const NOW = new Date('2026-09-22T10:00:00Z');

function deps(overrides = {}) {
  const out = { stdout: [], stderr: [], written: {} };
  const d = {
    runner: (args) => {
      if (args[0] === 'api' && args[1] === 'user') return 'octocat\n';
      if (args[0] === 'api') return '[[]]';
      return '[]';
    },
    ghAvailable: () => true,
    ghAuthOk: () => true,
    remoteUrl: () => 'https://github.com/acme/widgets.git\n',
    writeFile: (p, text) => { out.written[p] = text; },
    stdout: (s) => out.stdout.push(s),
    stderr: (s) => out.stderr.push(s),
    now: NOW,
    ...overrides,
  };
  return { d, out };
}

test('--help exits 0 before any probe', () => {
  const { d, out } = deps({ ghAvailable: () => { throw new Error('must not probe'); } });
  assert.equal(run(['--help'], d), 0);
  assert.match(out.stdout.join(''), /usage: activity-gather\.js/);
});

test('happy path: resolves actor and repo, writes facts.json, exits 0', () => {
  const { d, out } = deps();
  assert.equal(run(['--period', '7d', '--out', 'facts.json'], d), 0);
  const facts = JSON.parse(out.written['facts.json']);
  assert.equal(facts.actor, 'octocat');
  assert.deepEqual(facts.repos, ['acme/widgets']);
  assert.deepEqual(facts.period, { from: '2026-09-15', to: '2026-09-22', preset: '7d' });
  assert.deepEqual(facts.failures, []);
});

test('exit 1: missing --out, missing --period, unknown flag, bad period, host-qualified --repo', () => {
  for (const argv of [['--period', '7d'], ['--out', 'f.json'], ['--period', '7d', '--out', 'f.json', '--bogus'],
    ['--period', 'yesterday', '--out', 'f.json'], ['--period', '7d', '--out', 'f.json', '--repo', 'ghe.example.com/acme/widgets']]) {
    const { d, out } = deps();
    assert.equal(run(argv, d), 1, argv.join(' '));
    assert.ok(out.stderr.join('').length > 0);
  }
  const { d, out } = deps();
  run(['--period', 'yesterday', '--out', 'f.json'], d);
  assert.match(out.stderr.join(''), /1d\|7d\|14d\|month\|quarter\|<from>\.\.<to>/);
});

test('exit 2: gh absent relays the probe message; gh auth failure relays stderr verbatim', () => {
  const a = deps({ ghAvailable: () => false });
  assert.equal(run(['--period', '7d', '--out', 'f.json'], a.d), 2);
  assert.match(a.out.stderr.join(''), /gh is not installed/);
  const b = deps({ ghAuthOk: () => { const e = new Error('auth failed'); e.stderr = 'You are not logged into any GitHub hosts.'; throw e; } });
  assert.equal(run(['--period', '7d', '--out', 'f.json'], b.d), 2);
  assert.match(b.out.stderr.join(''), /You are not logged into any GitHub hosts\./);
});

test('exit 2: no --repo and origin unreadable or unparsable', () => {
  const a = deps({ remoteUrl: () => { throw new Error('fatal: not a git repository'); } });
  assert.equal(run(['--period', '7d', '--out', 'f.json'], a.d), 2);
  const b = deps({ remoteUrl: () => 'garbage\n' });
  assert.equal(run(['--period', '7d', '--out', 'f.json'], b.d), 2);
});

test('exit 3 only when every query failed; a partial gather exits 0 with failures[] populated', () => {
  const allFail = deps({ runner: (args) => { if (args[0] === 'api' && args[1] === 'user') return 'octocat'; throw new Error('boom'); } });
  assert.equal(run(['--period', '7d', '--out', 'f.json'], allFail.d), 3);
  const partial = deps({ runner: (args) => {
    if (args[0] === 'api' && args[1] === 'user') return 'octocat';
    if (args[0] === 'pr' && args.includes('merged')) throw new Error('HTTP 503');
    if (args[0] === 'api') return '[[]]';
    return '[]';
  } });
  assert.equal(run(['--period', '7d', '--out', 'f.json'], partial.d), 0);
  const facts = JSON.parse(partial.out.written['f.json']);
  assert.deepEqual(facts.failures.map((f) => f.query), ['merged_prs']);
});

test('--actor and --repo overrides skip the user probe and origin read', () => {
  const { d, out } = deps({ remoteUrl: () => { throw new Error('must not read origin'); }, runner: (args) => {
    if (args[0] === 'api' && args[1] === 'user') throw new Error('must not probe user');
    if (args[0] === 'api') return '[[]]';
    return '[]';
  } });
  assert.equal(run(['--period', '2026-09-01..2026-09-14', '--out', 'f.json', '--actor', 'hubot', '--repo', 'acme/a,acme/b'], d), 0);
  const facts = JSON.parse(out.written['f.json']);
  assert.equal(facts.actor, 'hubot');
  assert.deepEqual(facts.repos, ['acme/a', 'acme/b']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/activity/gather-cli.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/activity-gather'`.

- [ ] **Step 3: Write `plugin/bin/activity-gather.js`**

```js
#!/usr/bin/env node
// bin/activity-gather.js — thin CLI over bin/lib/activity/gather.js (#2757). Writes facts.json;
// nothing else. Logic lives in run(argv, deps); every side effect (runner, ghAvailable,
// ghAuthOk, remoteUrl, writeFile, stdout, stderr) is injected so tests never touch gh.
//
// Usage: activity-gather.js --period <1d|7d|14d|month|quarter|<from>..<to>>
//        [--repo <owner/name>[,<owner/name>...]] [--actor <login>] --out <facts.json path> [--help]
// Exit codes (Split-1/2, the resolve-blockers.js / fetch-sub-issues.js vocabulary):
//   0 success — including a PARTIAL gather (some queries failed; facts.failures[] names them)
//   1 malformed invocation (missing --period/--out, unknown flag, unrecognized period form,
//     a host-qualified --repo entry — every entry must live on gh's default github.com host)
//   2 missing dependency or unresolvable owner/repo (gh absent, `gh auth status` failing —
//     gh's own stderr relayed verbatim — or no --repo and no readable/parsable origin remote)
//   3 the remote calls themselves failed — EVERY query, across every repo
// Actor defaults to `gh api user -q .login`; repo defaults to the origin remote via
// bin/lib/repo-resolve.js. Every gh call passes an explicit 15 s timeout (gather.js states why).
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const { gather, PeriodError, ACTIVITY_GH_TIMEOUT_MS } = require('./lib/activity/gather');
const { parseRepo, ghAvailable, remoteUrl, repoSlug } = require('./lib/repo-resolve');

const USAGE = 'usage: activity-gather.js --period <1d|7d|14d|month|quarter|<from>..<to>> [--repo <owner/name>[,<owner/name>...]] [--actor <login>] --out <facts.json path> [--help]\n';

function parseArgs(argv) {
  const o = { period: null, repo: null, actor: null, out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) return null; i += 1; return v; };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--period') { o.period = next(); if (o.period === null) return { error: '--period requires a value' }; }
    else if (a === '--repo') { o.repo = next(); if (o.repo === null) return { error: '--repo requires a value' }; }
    else if (a === '--actor') { o.actor = next(); if (o.actor === null) return { error: '--actor requires a value' }; }
    else if (a === '--out') { o.out = next(); if (o.out === null) return { error: '--out requires a value' }; }
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

function errorText(err) {
  const parts = [err && err.message, err && err.stderr, err && err.stdout].filter((p) => p && String(p).trim());
  return parts.length ? parts.map((p) => String(p).trim()).join('\n') : String(err);
}

const realDeps = {
  runner: (args, opts) => execFileSync('gh', args, { encoding: 'utf8', ...opts }),
  ghAvailable: () => ghAvailable(),
  ghAuthOk: () => execFileSync('gh', ['auth', 'status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: ACTIVITY_GH_TIMEOUT_MS }),
  remoteUrl: () => remoteUrl(),
  writeFile: (p, text) => fs.writeFileSync(p, text),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  now: null,
};

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`activity-gather.js: ${message}\n${USAGE}`); return 1; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.period) return usageError('--period is required');
  if (!o.out) return usageError('--out is required');

  let repos;
  if (o.repo) {
    repos = o.repo.split(',').map((s) => s.trim()).filter(Boolean);
    for (const r of repos) {
      const parts = r.split('/');
      if (parts.length !== 2 || !parts[0] || !parts[1]) return usageError(`--repo entry "${r}" must be owner/name on gh's default host (github.com) — a host-qualified name is not supported`);
    }
  }

  if (!deps.ghAvailable()) { deps.stderr('activity-gather.js: gh is not installed or not on PATH — install GitHub CLI (https://cli.github.com) and run `gh auth login`\n'); return 2; }
  try { deps.ghAuthOk(); } catch (err) { deps.stderr(`activity-gather.js: gh auth status failed:\n${errorText(err)}\n`); return 2; }

  if (!repos) {
    let url;
    try { url = deps.remoteUrl(); } catch (err) { deps.stderr(`activity-gather.js: no --repo and origin remote unreadable: ${errorText(err)}\n`); return 2; }
    const spec = parseRepo(url);
    if (!spec) { deps.stderr(`activity-gather.js: no --repo and origin remote is not a GitHub URL: ${String(url).trim()}\n`); return 2; }
    repos = [repoSlug({ owner: spec.owner, repo: spec.repo })];
  }

  let actor = o.actor;
  if (!actor) {
    try { actor = String(deps.runner(['api', 'user', '-q', '.login'], { timeout: ACTIVITY_GH_TIMEOUT_MS })).trim(); } catch (err) {
      deps.stderr(`activity-gather.js: could not resolve the actor (gh api user): ${errorText(err)}\n`); return 2;
    }
    if (!actor) { deps.stderr('activity-gather.js: gh api user returned an empty login\n'); return 2; }
  }

  let facts;
  try {
    facts = gather({ period: o.period, repos, actor }, { runner: deps.runner, now: deps.now || undefined });
  } catch (err) {
    if (err instanceof PeriodError) return usageError(err.message);
    throw err;
  }
  const attempted = repos.length * 6;
  if (facts.failures.length === attempted) {
    deps.stderr(`activity-gather.js: every query failed (${attempted}/${attempted}); first: ${facts.failures[0].error}\n`);
    return 3;
  }
  try { deps.writeFile(o.out, JSON.stringify(facts, null, 2) + '\n'); } catch (err) {
    deps.stderr(`activity-gather.js: could not write ${o.out}: ${errorText(err)}\n`); return 1;
  }
  for (const f of facts.failures) deps.stderr(`activity-gather.js: partial gather — ${f.query} on ${f.repo} failed: ${f.error}\n`);
  deps.stdout(JSON.stringify({ out: o.out, actor, repos, period: facts.period, failures: facts.failures.length }) + '\n');
  return 0;
}

module.exports = { run, parseArgs, realDeps, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/bin-lib/activity/gather-cli.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS (7/7 new; exit-code conformance still green — the guard sets `process.exitCode`).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/activity-gather.js tests/bin-lib/activity/gather-cli.test.js
```
```bash
git commit -m "Add activity-gather CLI — Split-1/2 exit vocabulary, actor/repo resolution, partial gathers exit 0 (#2757)" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 3: `plugin/bin/lib/activity/render.js` — citation validation and markdown

**Files:**
- Create: `plugin/bin/lib/activity/render.js`
- Test: `tests/bin-lib/activity/render.test.js`

**Interfaces:**
- Produces (exports): `citableRefs(facts)` → `{ numbers: Map<repo, Map<number, url>>, commits: Map<repo, Array<{sha, url}>> }`; `validateFacts(facts)` and `validateNarratives(narratives)` → `{ ok, errors: [{ path, message }] }`; `SchemaError` (thrown by `render` on invalid inputs, `.errors` attached); `render(facts, narratives)` → `{ markdown, warnings }`; `REGISTERS = ['retro', 'standup', 'manager']`.

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/activity/render.test.js`:

```js
'use strict';
// tests/bin-lib/activity/render.test.js — #2757: the renderer trusts facts.json only. A ref
// absent from the facts is dropped with the exact warning; an ambiguous commit prefix is
// dropped; schemaVersion != 1 on either side is rejected; an empty period renders the honest
// one-line report; refs: [] renders unchanged.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render, validateFacts, validateNarratives, citableRefs, SchemaError } = require('../../../plugin/bin/lib/activity/render');

const R = 'acme/widgets';
function facts(overrides = {}) {
  return {
    schemaVersion: 1, generatedAt: '2026-09-22T10:00:00Z', actor: 'octocat',
    period: { from: '2026-09-15', to: '2026-09-22', preset: '7d' }, repos: [R],
    merged_prs: [{ repo: R, number: 10, title: 'Merged one', url: 'https://x/pull/10', mergedAt: '', additions: 1, deletions: 0, labels: [] }],
    closed_issues: [], issues_raised: [], reviews_given: [], in_flight: [],
    commits: [
      { repo: R, sha: 'abc1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', subject: 'One', date: '', url: 'https://x/c/1' },
      { repo: R, sha: 'abc1234bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', subject: 'Two', date: '', url: 'https://x/c/2' },
      { repo: R, sha: 'def5678cccccccccccccccccccccccccccccccccc', subject: 'Three', date: '', url: 'https://x/c/3' },
    ],
    failures: [],
    ...overrides,
  };
}
function narratives(items, register = 'retro') {
  return { schemaVersion: 1, register, sections: [{ heading: 'Shipped', items }] };
}

test('AC5: an absent ref is dropped with the exact warning and the item text survives', () => {
  const { markdown, warnings } = render(facts(), narratives([{ text: 'Did a thing', refs: ['acme/widgets#9999'] }]));
  assert.ok(markdown.includes('Did a thing'));
  assert.equal(markdown.includes('#9999'), false);
  assert.deepEqual(warnings, ['warning: dropped citation acme/widgets#9999 — not present in facts.json']);
});

test('AC5: an ambiguous commit prefix is dropped with the ambiguous-citation warning', () => {
  const { markdown, warnings } = render(facts(), narratives([{ text: 'Committed', refs: ['acme/widgets@abc1234'] }]));
  assert.deepEqual(warnings, ['warning: ambiguous citation acme/widgets@abc1234 — matches 2 commits']);
  assert.equal(markdown.includes('abc1234'), false);
});

test('a present number ref and a unique commit prefix render as markdown links to the fact url', () => {
  const { markdown, warnings } = render(facts(), narratives([{ text: 'Shipped it', refs: ['acme/widgets#10', 'acme/widgets@def5678'] }]));
  assert.deepEqual(warnings, []);
  assert.ok(markdown.includes('- Shipped it ([acme/widgets#10](https://x/pull/10), [acme/widgets@def5678](https://x/c/3))'));
  assert.ok(markdown.startsWith('# Activity — 2026-09-15 to 2026-09-22 (retro)\n'));
  assert.ok(markdown.includes('\n## Shipped\n'));
  assert.ok(markdown.includes('\n## Notes\n'));
});

test('refs come only from refs[]: a #123 typed inside text is prose and is left as-is', () => {
  const { markdown, warnings } = render(facts(), narratives([{ text: 'Mentioned #123 in passing', refs: [] }]));
  assert.ok(markdown.includes('- Mentioned #123 in passing\n'));
  assert.deepEqual(warnings, []);
});

test('AC6: an empty period renders the one-line empty report with no section headings', () => {
  const empty = facts({ merged_prs: [], commits: [] });
  const { markdown, warnings } = render(empty, { schemaVersion: 1, register: 'retro', sections: [] });
  assert.equal(markdown, '# Activity — 2026-09-15 to 2026-09-22 (retro)\n\nNo activity found for 2026-09-15..2026-09-22 in acme/widgets.\n');
  assert.deepEqual(warnings, []);
});

test('a failures[] entry renders a Partial gather section verbatim', () => {
  const f = facts({ failures: [{ query: 'merged_prs', repo: R, error: 'HTTP 503: No server is currently available' }] });
  const { markdown } = render(f, narratives([]));
  assert.ok(markdown.includes('\n## Partial gather\n'));
  assert.ok(markdown.includes('- merged_prs on acme/widgets: HTTP 503: No server is currently available'));
});

test('AC7 (module half): schemaVersion other than 1 is rejected on either side, and a non-string ref names its path', () => {
  assert.throws(() => render(facts({ schemaVersion: 2 }), narratives([])), (e) => e instanceof SchemaError && /facts\.schemaVersion/.test(e.message));
  assert.throws(() => render(facts(), { schemaVersion: '1', register: 'retro', sections: [] }), (e) => e instanceof SchemaError && /narratives\.schemaVersion/.test(e.message));
  const bad = validateNarratives({ schemaVersion: 1, register: 'retro', sections: [{ heading: 'S', items: [{ text: 't', refs: ['ok#1', 42] }] }] });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map((e) => e.path), ['sections[0].items[0].refs[1]']);
  assert.deepEqual(validateFacts(facts()), { ok: true, errors: [] });
  assert.equal(validateNarratives({ schemaVersion: 1, register: 'boss', sections: [] }).ok, false);
});

test('citableRefs unions every numbered array per repo and lists commits per repo', () => {
  const f = facts({ in_flight: [{ repo: R, number: 50, title: 't', url: 'https://x/pull/50', isDraft: false, updatedAt: '' }] });
  const refs = citableRefs(f);
  assert.deepEqual([...refs.numbers.get(R).keys()].sort((a, b) => a - b), [10, 50]);
  assert.equal(refs.commits.get(R).length, 3);
});

test('the footer notes the empty-commits case only when other actor arrays are non-empty', () => {
  const withoutCommits = render(facts({ commits: [] }), narratives([])).markdown;
  assert.ok(withoutCommits.includes('no commits were matched'));
  const withCommits = render(facts(), narratives([])).markdown;
  assert.equal(withCommits.includes('no commits were matched'), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/activity/render.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/activity/render'`.

- [ ] **Step 3: Write `plugin/bin/lib/activity/render.js`**

```js
// plugin/bin/lib/activity/render.js — the renderer half of /claude-tweaks:activity (#2757).
// Trusts facts.json (which only gh wrote) and never the narrative: every refs[] entry is
// validated against the citable set derived from the facts and dropped with a warning when
// absent or ambiguous. Refs come ONLY from refs[] — a `#123` typed inside an item's text is
// prose, not a citation, and is left exactly as written. Both inputs must carry
// schemaVersion: 1; anything else is rejected (never guessed across versions).
'use strict';

const NUMBERED = ['merged_prs', 'closed_issues', 'issues_raised', 'reviews_given', 'in_flight'];
const REGISTERS = ['retro', 'standup', 'manager'];
const NUMBER_REF_RE = /^([^\s/#@]+\/[^\s/#@]+)#(\d+)$/;
const COMMIT_REF_RE = /^([^\s/#@]+\/[^\s/#@]+)@([0-9a-fA-F]{7,40})$/;

class SchemaError extends Error {
  constructor(errors) {
    super(errors.map((e) => `${e.path}: ${e.message}`).join('; '));
    this.name = 'SchemaError';
    this.errors = errors;
  }
}

function validateFacts(facts) {
  const errors = [];
  if (!facts || typeof facts !== 'object') return { ok: false, errors: [{ path: 'facts', message: 'not an object' }] };
  if (facts.schemaVersion !== 1) errors.push({ path: 'facts.schemaVersion', message: `must be the number 1 (got ${JSON.stringify(facts.schemaVersion)})` });
  if (!facts.period || typeof facts.period.from !== 'string' || typeof facts.period.to !== 'string') errors.push({ path: 'facts.period', message: 'must carry from/to strings' });
  if (!Array.isArray(facts.repos)) errors.push({ path: 'facts.repos', message: 'must be an array' });
  for (const key of [...NUMBERED, 'commits', 'failures']) {
    if (!Array.isArray(facts[key])) errors.push({ path: `facts.${key}`, message: 'must be an array' });
  }
  return { ok: errors.length === 0, errors };
}

function validateNarratives(n) {
  const errors = [];
  if (!n || typeof n !== 'object') return { ok: false, errors: [{ path: 'narratives', message: 'not an object' }] };
  if (n.schemaVersion !== 1) errors.push({ path: 'narratives.schemaVersion', message: `must be the number 1 (got ${JSON.stringify(n.schemaVersion)})` });
  if (!REGISTERS.includes(n.register)) errors.push({ path: 'narratives.register', message: `must be one of ${REGISTERS.join('|')}` });
  if (!Array.isArray(n.sections)) { errors.push({ path: 'narratives.sections', message: 'must be an array' }); return { ok: false, errors }; }
  n.sections.forEach((s, i) => {
    if (!s || typeof s.heading !== 'string') errors.push({ path: `sections[${i}].heading`, message: 'must be a string' });
    if (!s || !Array.isArray(s.items)) { errors.push({ path: `sections[${i}].items`, message: 'must be an array' }); return; }
    s.items.forEach((it, j) => {
      if (!it || typeof it.text !== 'string') errors.push({ path: `sections[${i}].items[${j}].text`, message: 'must be a string' });
      if (!it || !Array.isArray(it.refs)) { errors.push({ path: `sections[${i}].items[${j}].refs`, message: 'must be an array of strings' }); return; }
      it.refs.forEach((r, k) => { if (typeof r !== 'string') errors.push({ path: `sections[${i}].items[${j}].refs[${k}]`, message: 'must be a string' }); });
    });
  });
  return { ok: errors.length === 0, errors };
}

// facts -> { numbers: Map<repo, Map<number, url>>, commits: Map<repo, [{sha, url}]> }
function citableRefs(facts) {
  const numbers = new Map();
  const commits = new Map();
  for (const key of NUMBERED) {
    for (const row of facts[key]) {
      if (!numbers.has(row.repo)) numbers.set(row.repo, new Map());
      if (!numbers.get(row.repo).has(row.number)) numbers.get(row.repo).set(row.number, row.url);
    }
  }
  for (const c of facts.commits) {
    if (!commits.has(c.repo)) commits.set(c.repo, []);
    commits.get(c.repo).push({ sha: String(c.sha), url: c.url });
  }
  return { numbers, commits };
}

// ref string + citable set -> { link } | { warning }
function resolveRef(ref, citable) {
  let m = NUMBER_REF_RE.exec(ref);
  if (m) {
    const url = citable.numbers.get(m[1]) && citable.numbers.get(m[1]).get(Number(m[2]));
    return url ? { link: `[${m[1]}#${m[2]}](${url})` } : { warning: `warning: dropped citation ${ref} — not present in facts.json` };
  }
  m = COMMIT_REF_RE.exec(ref);
  if (m) {
    const prefix = m[2].toLowerCase();
    const hits = (citable.commits.get(m[1]) || []).filter((c) => c.sha.toLowerCase().startsWith(prefix));
    if (hits.length === 1) return { link: `[${m[1]}@${prefix.slice(0, 7)}](${hits[0].url})` };
    if (hits.length === 0) return { warning: `warning: dropped citation ${ref} — not present in facts.json` };
    return { warning: `warning: ambiguous citation ${m[1]}@${m[2]} — matches ${hits.length} commits` };
  }
  return { warning: `warning: dropped citation ${ref} — not present in facts.json` };
}

function isEmptyPeriod(facts, narratives) {
  const noFacts = [...NUMBERED, 'commits'].every((k) => facts[k].length === 0);
  const noItems = narratives.sections.every((s) => s.items.length === 0);
  return noFacts && noItems;
}

function render(facts, narratives) {
  const fv = validateFacts(facts);
  const nv = validateNarratives(narratives);
  const errors = [...fv.errors, ...nv.errors];
  if (errors.length) throw new SchemaError(errors);

  const { from, to } = facts.period;
  const title = `# Activity — ${from} to ${to} (${narratives.register})`;
  if (isEmptyPeriod(facts, narratives)) {
    return { markdown: `${title}\n\nNo activity found for ${from}..${to} in ${facts.repos.join(', ')}.\n`, warnings: [] };
  }

  const citable = citableRefs(facts);
  const warnings = [];
  const lines = [title, ''];
  for (const section of narratives.sections) {
    if (section.items.length === 0) continue;
    lines.push(`## ${section.heading}`, '');
    for (const item of section.items) {
      const links = [];
      for (const ref of item.refs) {
        const r = resolveRef(ref, citable);
        if (r.link) links.push(r.link); else warnings.push(r.warning);
      }
      lines.push(links.length ? `- ${item.text} (${links.join(', ')})` : `- ${item.text}`);
    }
    lines.push('');
  }
  if (facts.failures.length) {
    lines.push('## Partial gather', '');
    for (const f of facts.failures) lines.push(`- ${f.query} on ${f.repo}: ${f.error}`);
    lines.push('');
  }
  const counts = [...NUMBERED, 'commits'].map((k) => `${k}: ${facts[k].length}`).join(', ');
  lines.push('## Notes', '', `- Counts — ${counts}.`,
    '- Search-index lag: `--search` and `search prs` ride GitHub\'s search index, which lags fresh writes by minutes.',
    '- `reviews_given` is a proxy: PRs the actor reviewed whose last update falls in the window; the review\'s own timestamp is not consulted, and own-authored PRs are excluded.',
    '- Commits are matched by linked GitHub login; a commit authored with an unlinked email never appears.');
  const otherActivity = NUMBERED.some((k) => facts[k].length > 0);
  if (facts.commits.length === 0 && otherActivity) lines.push('- Note: no commits were matched for this actor in the window while other activity exists — check the commit email is linked to the GitHub account.');
  lines.push('');
  return { markdown: lines.join('\n'), warnings };
}

module.exports = { render, validateFacts, validateNarratives, citableRefs, SchemaError, REGISTERS, NUMBER_REF_RE, COMMIT_REF_RE };
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/bin-lib/activity/render.test.js`
Expected: PASS, 9/9.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/activity/render.js tests/bin-lib/activity/render.test.js
```
```bash
git commit -m "Add activity render module — refs validated against facts, absent/ambiguous citations dropped with warnings (#2757)" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 4: `plugin/bin/activity-render.js` — the render CLI

**Files:**
- Create: `plugin/bin/activity-render.js`
- Test: `tests/bin-lib/activity/render-cli.test.js`

**Interfaces:**
- Consumes: Task 3's `render`, `SchemaError`.
- Produces: `run(argv, deps)`, `realDeps`; `deps` = `{ readFile, writeFile, stdout, stderr }`. Exit `0` rendered (warnings on stderr, one per line), `1` malformed invocation, `2` facts/narratives unreadable or failing schema validation (errors on stderr naming each path).

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/activity/render-cli.test.js`:

```js
'use strict';
// tests/bin-lib/activity/render-cli.test.js — #2757: activity-render.js exit contract.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../../plugin/bin/activity-render');

const FACTS = JSON.stringify({ schemaVersion: 1, generatedAt: 'x', actor: 'octocat', period: { from: '2026-09-15', to: '2026-09-22', preset: '7d' }, repos: ['acme/widgets'],
  merged_prs: [{ repo: 'acme/widgets', number: 10, title: 't', url: 'https://x/pull/10', mergedAt: '', additions: 0, deletions: 0, labels: [] }],
  closed_issues: [], issues_raised: [], reviews_given: [], in_flight: [], commits: [], failures: [] });
const NARR = JSON.stringify({ schemaVersion: 1, register: 'retro', sections: [{ heading: 'Shipped', items: [{ text: 'Did it', refs: ['acme/widgets#10', 'acme/widgets#11'] }] }] });

function deps(files, overrides = {}) {
  const out = { stdout: [], stderr: [], written: {} };
  const d = {
    readFile: (p) => { if (!(p in files)) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; } return files[p]; },
    writeFile: (p, t) => { out.written[p] = t; },
    stdout: (s) => out.stdout.push(s), stderr: (s) => out.stderr.push(s), ...overrides,
  };
  return { d, out };
}
const ARGS = ['--facts', 'f.json', '--narratives', 'n.json', '--out', 'r.md'];

test('--help exits 0; missing flags and unknown flags exit 1', () => {
  assert.equal(run(['--help'], deps({}).d), 0);
  for (const argv of [['--facts', 'f.json'], ['--facts', 'f.json', '--narratives', 'n.json'], [...ARGS, '--bogus']]) {
    const { d } = deps({});
    assert.equal(run(argv, d), 1, argv.join(' '));
  }
});

test('renders, writes the report, exits 0, and prints one warning line per dropped ref', () => {
  const { d, out } = deps({ 'f.json': FACTS, 'n.json': NARR });
  assert.equal(run(ARGS, d), 0);
  assert.ok(out.written['r.md'].includes('[acme/widgets#10](https://x/pull/10)'));
  assert.deepEqual(out.stderr, ['warning: dropped citation acme/widgets#11 — not present in facts.json\n']);
});

test('AC7: exit 2 on an unreadable file, on schemaVersion != 1 in either file, and on a non-string ref, naming the path', () => {
  assert.equal(run(ARGS, deps({ 'n.json': NARR }).d), 2);
  const badFacts = deps({ 'f.json': FACTS.replace('"schemaVersion":1', '"schemaVersion":2'), 'n.json': NARR });
  assert.equal(run(ARGS, badFacts.d), 2);
  assert.match(badFacts.out.stderr.join(''), /facts\.schemaVersion/);
  const badNarr = deps({ 'f.json': FACTS, 'n.json': NARR.replace('"schemaVersion":1', '"schemaVersion":"1"') });
  assert.equal(run(ARGS, badNarr.d), 2);
  assert.match(badNarr.out.stderr.join(''), /narratives\.schemaVersion/);
  const nonString = deps({ 'f.json': FACTS, 'n.json': NARR.replace('"acme/widgets#11"', '11') });
  assert.equal(run(ARGS, nonString.d), 2);
  assert.match(nonString.out.stderr.join(''), /sections\[0\]\.items\[0\]\.refs\[1\]/);
  const notJson = deps({ 'f.json': '{', 'n.json': NARR });
  assert.equal(run(ARGS, notJson.d), 2);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/activity/render-cli.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/activity-render'`.

- [ ] **Step 3: Write `plugin/bin/activity-render.js`**

```js
#!/usr/bin/env node
// bin/activity-render.js — thin CLI over bin/lib/activity/render.js (#2757). Reads facts.json
// (gh's truth) and narratives.json (the skill's prose), renders markdown, and prints one
// warning line per dropped or ambiguous citation. Logic lives in run(argv, deps).
//
// Usage: activity-render.js --facts <path> --narratives <path> --out <report.md path> [--help]
// Exit codes:
//   0 rendered (warnings on stderr, one per line — exact forms in render.js)
//   1 malformed invocation (missing --facts/--narratives/--out, unknown flag)
//   2 facts or narratives file unreadable, not JSON, or failing schema validation (a
//     missing/unrecognized schemaVersion in either file, a refs entry that is not a string —
//     every failing path is named on stderr)
'use strict';

const fs = require('fs');
const { render, SchemaError } = require('./lib/activity/render');

const USAGE = 'usage: activity-render.js --facts <path> --narratives <path> --out <report.md path> [--help]\n';

function parseArgs(argv) {
  const o = { facts: null, narratives: null, out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) return null; i += 1; return v; };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--facts') { o.facts = next(); if (o.facts === null) return { error: '--facts requires a value' }; }
    else if (a === '--narratives') { o.narratives = next(); if (o.narratives === null) return { error: '--narratives requires a value' }; }
    else if (a === '--out') { o.out = next(); if (o.out === null) return { error: '--out requires a value' }; }
    else return { error: `unknown argument: ${a}` };
  }
  return o;
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  writeFile: (p, t) => fs.writeFileSync(p, t),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function loadJson(deps, label, p) {
  let raw;
  try { raw = deps.readFile(p); } catch (err) { throw new SchemaError([{ path: label, message: `could not read ${p}: ${err && err.message}` }]); }
  try { return JSON.parse(raw); } catch (err) { throw new SchemaError([{ path: label, message: `${p} is not valid JSON: ${err && err.message}` }]); }
}

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`activity-render.js: ${message}\n${USAGE}`); return 1; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  for (const k of ['facts', 'narratives', 'out']) if (!o[k]) return usageError(`--${k} is required`);

  let result;
  try {
    const facts = loadJson(deps, 'facts', o.facts);
    const narratives = loadJson(deps, 'narratives', o.narratives);
    result = render(facts, narratives);
  } catch (err) {
    if (err instanceof SchemaError) {
      for (const e of err.errors) deps.stderr(`activity-render.js: ${e.path}: ${e.message}\n`);
      return 2;
    }
    throw err;
  }
  try { deps.writeFile(o.out, result.markdown); } catch (err) { deps.stderr(`activity-render.js: could not write ${o.out}: ${err && err.message}\n`); return 1; }
  for (const w of result.warnings) deps.stderr(`${w}\n`);
  deps.stdout(JSON.stringify({ out: o.out, warnings: result.warnings.length }) + '\n');
  return 0;
}

module.exports = { run, parseArgs, realDeps, USAGE };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/bin-lib/activity/render-cli.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS (3/3 new; exit-code conformance green).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/activity-render.js tests/bin-lib/activity/render-cli.test.js
```
```bash
git commit -m "Add activity-render CLI — schema failures exit 2 naming each path, warnings one per line (#2757)" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 5: `plugin/skills/activity/SKILL.md` + the never-invent conformance test

**Files:**
- Create: `tests/activity-never-invent-conformance.test.js`
- Create: `plugin/skills/activity/SKILL.md`
- Test: `tests/activity-never-invent-conformance.test.js`, `tests/skill-conventions.test.js`

**Interfaces:**
- Produces: the skill file whose frontmatter `argument-hint` is byte-identical to `"[--period <1d|7d|14d|month|quarter|<from>..<to>>] [--register <manager|standup|retro>] [--repo <owner/name>[,...]]"` (Task 6's reference-card row copies it verbatim, with `|` escaped as `\|` inside the table cell).

- [ ] **Step 1: Write the failing conformance test**

`tests/activity-never-invent-conformance.test.js`:

```js
'use strict';
// tests/activity-never-invent-conformance.test.js — #2757: /claude-tweaks:activity's
// anti-fabrication rule and its mandatory render step, pinned in the live skill prose (the
// convention-enforcement row of .claude/skills/skill-prose-conformance-tests — read live,
// never frozen, because a future edit weakening either is exactly what this must catch).
// Go-red proof: the skill file did not exist at base 6d0f768a4, so every literal below was
// absent there; each assertion is additionally proven against a hand-doctored copy.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'activity', 'SKILL.md');
const skill = fs.readFileSync(SKILL_PATH, 'utf8').replace(/\r\n/g, '\n');
const collapse = (s) => s.replace(/\s+/g, ' ');

const NEVER_INVENT = 'never invent PRs, issues, numbers, dates, or people';

test('the never-invent sentence is present verbatim, once, in bold', () => {
  const flat = collapse(skill);
  assert.ok(flat.includes(`**${NEVER_INVENT}**`), 'never-invent sentence missing or not bold');
  assert.equal(flat.split(NEVER_INVENT).length - 1, 1, 'the sentence must appear exactly once');
  const doctored = collapse(skill.replace(NEVER_INVENT, 'be careful with numbers'));
  assert.equal(doctored.includes(NEVER_INVENT), false, 'doctored control must lose the sentence (proves go-red)');
});

test('the render step is mandatory: the report shown is always the renderer output, never optional', () => {
  const flat = collapse(skill);
  assert.ok(/always the renderer's output, never the skill's own prose/.test(flat), 'mandatory-render sentence missing');
  const renderStep = flat.slice(flat.indexOf('activity-render.js'));
  assert.equal(/\b(optional|may skip|can skip|if desired)\b/i.test(renderStep.slice(0, 1200)), false, 'the render step must not be described as optional');
  const doctored = collapse(skill.replace('always the renderer\'s output', 'optionally the renderer\'s output'));
  assert.equal(/always the renderer's output, never the skill's own prose/.test(doctored), false, 'doctored control must fail (proves go-red)');
});

test('AC9: no artifacts write destination, docs/reports default, no git commit/add instruction', () => {
  assert.equal(skill.includes('.claude-tweaks/artifacts/'), false);
  assert.ok(skill.includes('docs/reports/activity-{from}-{to}.md'));
  assert.equal(/git (commit|add)\b/.test(skill), false, 'the skill must never commit on the user\'s behalf');
});

test('the skill runs gather and render through the plugin root, never a repo-relative path', () => {
  assert.ok(skill.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/activity-gather.js"'));
  assert.ok(skill.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/activity-render.js"'));
  assert.equal(/node plugin\/bin\/activity-/.test(skill), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/activity-never-invent-conformance.test.js`
Expected: FAIL — `ENOENT … plugin/skills/activity/SKILL.md`.

- [ ] **Step 3: Write `plugin/skills/activity/SKILL.md`**

Use the Write tool. Content (no Interaction-style directive line — see Global Constraints (a)):

````markdown
---
name: activity
description: Use for a period-scoped "what shipped" markdown report — merged PRs, closed issues, commits, issues raised, reviews given, in flight — narrated for a retro, standup, or manager with citation-validated refs. Keywords - activity report, what did I ship, last week, retro, standup, accomplishments.
argument-hint: "[--period <1d|7d|14d|month|quarter|<from>..<to>>] [--register <manager|standup|retro>] [--repo <owner/name>[,...]]"
---

# Activity — Period-scoped "what shipped" report

Answers "what did I ship over the last N days?" for a human reader: a markdown report over merged PRs, closed issues, commits, issues raised, reviews given, and what is still in flight, aggregated over a period and narrated in a chosen register. Utility skill — no fixed lifecycle position:

```
gather (gh → facts.json)  →  narrate (this skill → narratives.json)  →  render (facts ⨯ narratives → report.md)
        deterministic                 judgment                         deterministic, citation-validated
```

Gathering and rendering are two separate programs, and the skill writes narration *between* them. The renderer never trusts the narrative; it trusts `facts.json`, which only `gh` wrote, and drops every citation it cannot find there — with a warning. A hallucinated issue number is structurally unpublishable.

## When to Use

- A retro, a standup, a 1:1, or release notes need prose over a period — not the state-now dashboard `/claude-tweaks:help` renders, and not one run's summary from `/claude-tweaks:flow`.
- "What did I do last week / this month / this quarter?"
- You want a paste-ready markdown summary of your GitHub activity for one or more repos.

Not for: reporting how the harness itself performed (`/claude-tweaks:feedback`'s session judge owns that), HTML output, cross-organization aggregation, or anything on a host other than the one `gh` is authenticated to by default.

## Input

`$ARGUMENTS` is parsed as `[--period <1d|7d|14d|month|quarter|<from>..<to>>] [--register <manager|standup|retro>] [--repo <owner/name>[,...]]`:

| Argument | Default | Behavior |
|---|---|---|
| `--period` | `7d` | Presets are rolling day counts ending today (`1d`=1, `7d`=7, `14d`=14, `month`=30, `quarter`=90 — never calendar-aligned); `<from>..<to>` (`YYYY-MM-DD..YYYY-MM-DD`) is inclusive of both days. Any other form stops with the gather CLI's own message naming the accepted forms. |
| `--register` | `retro` | Changes tone and detail, never facts: `retro` is terse and technical for the person who did the work; `standup` names mechanisms for teammates who know the codebase, refs on everything; `manager` is plain business language with no commit-speak. |
| `--repo` | the `origin` remote | One or more `owner/name` slugs, comma-joined, all on `gh`'s default host; a host-qualified name stops with exit 1. |

## Step 1: Gather the facts

Resolve this run's session-scoped temp paths (`_shared/session-tmp-root.md`), then run the gather CLI — the only place `gh` is called:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" ACTIVITY_FACTS=activity-facts.json ACTIVITY_NARRATIVES=activity-narratives.json ACTIVITY_REPORT=activity-report.md)"
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/activity-gather.js" --period {period} --out "$ACTIVITY_FACTS"
```

Add `--repo {owner/name}[,...]` when `--repo` was given. Branch on the exit code: `0` → read `$ACTIVITY_FACTS`; its `failures[]` is non-empty on a partial gather — carry on, the renderer prints them as a **Partial gather** section. `1` → relay the CLI's message (an unrecognized period, a host-qualified repo) and stop. `2` → `gh` is absent or unauthenticated, or no repo resolved: relay the CLI's stderr verbatim and stop — there is no MCP fallback for this skill. `3` → every query failed: relay the first error and stop.

Read the facts file in full before narrating. Note the three standing caveats the file's producer documents (search-index lag; `reviews_given` is an updated-in-window proxy that also drops your own PRs; commits are matched by linked GitHub login) — the renderer restates them in the report footer, so you never have to.

## Step 2: Narrate

Write `$ACTIVITY_NARRATIVES` with the Write tool (never `echo` — zsh mangles `\n`), in this shape:

```json
{
  "schemaVersion": 1,
  "register": "retro",
  "sections": [
    { "heading": "Shipped", "items": [{ "text": "…", "refs": ["owner/name#123", "owner/name@abc1234"] }] },
    { "heading": "Reviewed", "items": [] },
    { "heading": "In flight", "items": [] }
  ]
}
```

Narration rules:

- **never invent PRs, issues, numbers, dates, or people** — every claim traces to a row in `$ACTIVITY_FACTS`, and every item carries `refs` naming the rows it rests on (`{owner/name}#{N}` for a PR or issue, `{owner/name}@{sha7+}` for a commit). A ref the renderer cannot find in the facts is dropped from the report with a warning you relay; it is not a typo to fix by hand — re-read the facts and re-cite.
- The register changes tone and detail, never facts. `manager` prose names outcomes, not commits; `standup` and `retro` name mechanisms and cite every item.
- Group by the three headings above; drop a heading's items to `[]` when the period has nothing for it. Never pad an empty period — the renderer produces the honest one-line empty report on its own.
- Refs live in `refs[]` only. A `#123` typed inside `text` is prose to the renderer and stays unlinked and unvalidated.

## Step 3: Render — mandatory

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/activity-render.js" --facts "$ACTIVITY_FACTS" --narratives "$ACTIVITY_NARRATIVES" --out "$ACTIVITY_REPORT"
```

The report shown to the user is always the renderer's output, never the skill's own prose — read `$ACTIVITY_REPORT` back and show it verbatim. Relay every `warning:` line the CLI printed on stderr, verbatim, above the report; each names a citation that was dropped (absent from the facts) or ambiguous (a commit prefix matching more than one sha). Exit `2` means the narratives file failed schema validation (the path is named on stderr) — fix the narratives file and re-run this step; exit `1` is a malformed invocation to correct.

## Step 4: Save location

After showing the report, call `AskUserQuestion` once — `question`: `"Where should this report go?"`, `header`: `"Save report"`, `multiSelect`: `false`:

- Option 1 — `label`: `"Archive path (Recommended)"`, `description`: `"Write to docs/reports/activity-{from}-{to}.md (creates docs/reports/ if absent)"`
- Option 2 — `label`: `"Current directory"`, `description`: `"Write to ./activity-{from}-{to}.md"`
- Option 3 — `label`: `"Don't save"`, `description`: `"Keep it in this conversation only — nothing written"`

An explicit path comes through `Other`. `{from}`/`{to}` are the facts file's `period.from`/`period.to`. Copy `$ACTIVITY_REPORT` to the chosen path with the Write tool. Nothing is written into the repository without this choice, nothing is ever committed on the user's behalf, and nothing lands under the disposable `.claude-tweaks/` artifact tree — a report the user asked to keep must live where `/claude-tweaks:tidy` will not prune it. This question runs even inside a pipeline: the report is user-facing output, not a decision `auto` mode may silence.

**Edits.** "Make it shorter", "switch to manager register", "drop the reviews section" re-run Step 2 and Step 3 only, against the same `$ACTIVITY_FACTS`. A different period or repo set is a new run from Step 1 — never an edit.

## Next Actions

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:activity --period {period} --register {other register}`** — the same period in another register (recommended when the user asked for a second audience)
`/claude-tweaks:activity --period 14d` — widen the window
`/claude-tweaks:help` — full pipeline status

## Component-Skill Contract

`/claude-tweaks:activity` is a **standalone-only** skill — no lifecycle skill invokes it. There is no `PIPELINE_RUN_DIR` signal to check; the `## Next Actions` block always renders, and Step 4's save-location question always runs.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Showing your own prose instead of the renderer's output | Only the renderer validated the citations — prose that skipped it can carry a number nothing backs |
| "Fixing" a dropped-citation warning by retyping the number | The warning means the facts do not contain it; re-read the facts and cite a row that exists, or drop the claim |
| Switching to whole-repo `--state all` list scans to catch a just-merged PR the search index has not indexed yet | Blows the 200-row cap on a busy repo; the footer already states the lag |
| Writing the report under `.claude-tweaks/artifacts/` or committing it | That tree is disposable by declaration, and nothing is committed on the user's behalf in any mode |
````

- [ ] **Step 4: Run the tests**

Run: `node --test tests/activity-never-invent-conformance.test.js tests/skill-conventions.test.js tests/skill-prose-plugin-root-invocations.test.js`
Expected: PASS — the conformance suite 4/4; skill-conventions green (no inline directive); the plugin-root invocation sweep green.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/activity/SKILL.md tests/activity-never-invent-conformance.test.js
```
```bash
git commit -m "Add the /claude-tweaks:activity skill — gather, narrate, mandatory render, one save-location question (#2757)" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 6: Registration on the five surfaces and the Anti-Patterns pin

**Files:**
- Modify: `docs/skill-graph.md` (new `## activity` section, inserted in alphabetical position — before `## assess-agent-autonomy`)
- Modify: `plugin/skills/help/reference-card.md` (new row in the `## Utility` table, after the `/claude-tweaks:demo` row)
- Modify: `plugin/skills/help/context-flow.md` (new row in the "What Each Skill Reads and Writes" table, after the `/visualize` row)
- Modify: `docs/getting-started.md` (new paragraph in `### Utility skills`, after the `/claude-tweaks:demo` paragraph)
- Modify: `docs/plugin-structure.md` (the `**Utility:**` list line gains `activity`; two `## Commands` lines after the `fetch-sub-issues.js` line)
- Modify: `tests/bin-lib/skill-audit/anti-patterns.test.js` (the row-count pin and its comment ledger)
- Test: `tests/skill-catalog-completeness.test.js`, `tests/reference-card-argument-hint.test.js`, `tests/bin-lib/skill-audit/anti-patterns.test.js`, `tests/bin-lib/skill-audit/house-structure.test.js`

- [ ] **Step 1: `docs/skill-graph.md`**

Insert before the line `## assess-agent-autonomy`:

```markdown
## activity

| Target | Relationship |
|---|---|
| `/help` | `/help` lists `/activity` as a utility skill (reference card, context flow). `/help` is state-now; `/activity` is what-shipped over a period — neither replaces the other. |
| `_shared/session-tmp-root.md` | Step 1 resolves `activity-facts.json`, `activity-narratives.json`, and `activity-report.md` under the session-scoped temp root via `bin/session-tmp-resolve.js` — never a literal `/tmp/` path. |
| `bin/lib/repo-resolve.js` | `bin/activity-gather.js` reuses `parseRepo`/`ghAvailable`/`remoteUrl`/`repoSlug` for its default-repo resolution and `gh` probe — read-only reuse, no change to the module. |

```

- [ ] **Step 2: `plugin/skills/help/reference-card.md`**

After the `| \`/claude-tweaks:demo\` | …` row in the `## Utility` table, add:

```markdown
| `/claude-tweaks:activity` | Period-scoped "what shipped" markdown report — merged PRs, closed issues, commits, issues raised, reviews given, in flight — narrated for a retro/standup/manager; the renderer validates every citation against `gh`'s own facts and drops any it cannot find | `[--period <1d\|7d\|14d\|month\|quarter\|<from>..<to>>] [--register <manager\|standup\|retro>] [--repo <owner/name>[,...]]` |
```

(Every `|` inside the Takes cell is escaped as `\|`; `tests/reference-card-argument-hint.test.js` unescapes and compares byte-for-byte to the frontmatter.)

- [ ] **Step 3: `plugin/skills/help/context-flow.md`**

After the `| \`/visualize\` | …` row, add:

```markdown
| `/activity` | `gh` (via `bin/activity-gather.js` — merged PRs, closed issues, commits, issues raised, reviews given, in flight over a period), the session-scoped `activity-facts.json` it wrote | Session-scoped `activity-narratives.json` and `activity-report.md`; the chosen report path only (default `docs/reports/activity-{from}-{to}.md`, never committed) | — |
```

- [ ] **Step 4: `docs/getting-started.md`**

After the `**\`/claude-tweaks:demo\`**` paragraph in `### Utility skills`, add:

```markdown
**`/claude-tweaks:activity`** — A period-scoped "what shipped" report: merged PRs, closed issues, commits, issues raised, reviews given, and what is still in flight, narrated for a `retro` (default), `standup`, or `manager` reader and rendered to markdown. Gathering (`bin/activity-gather.js`, `gh`-only, writes `facts.json`) and rendering (`bin/activity-render.js`) are separate programs; the skill narrates between them and the renderer validates every citation against the gathered facts, dropping any it cannot find with a warning — a hallucinated issue number is structurally unpublishable. `--period` takes `1d`/`7d`/`14d`/`month`/`quarter` (rolling day counts) or `<from>..<to>`; `--repo` names one or more `owner/name` slugs. One question at the end picks where the report is saved (default `docs/reports/`); nothing is committed on your behalf.
```

- [ ] **Step 5: `docs/plugin-structure.md`**

Change the `**Utility:**` line to end `…, backlog, dispatch, demo, sweep, activity`. After the `node plugin/bin/fetch-sub-issues.js …` line in `## Commands`, add:

```markdown
node plugin/bin/activity-gather.js --period <1d|7d|14d|month|quarter|<from>..<to>> [--repo <owner/name>[,...]] [--actor <login>] --out <facts.json>   # Activity-gather CLI (#2757) — six pinned `gh` queries per repo (merged PRs, closed issues, issues raised, commits via `api --paginate --slurp`, reviews given, in flight) through an injectable runner with a 15 s per-call bound, each independently fail-safe into `facts.failures[]`; writes facts.json (`schemaVersion: 1`); exit 0 success (a partial gather still exits 0), 1 malformed invocation or unrecognized period, 2 `gh` absent/unauthenticated or owner/repo unresolvable, 3 every query failed (`plugin/bin/lib/activity/gather.js`; tests in `tests/bin-lib/activity/gather.test.js`, `gather-cli.test.js`)
node plugin/bin/activity-render.js --facts <path> --narratives <path> --out <report.md>   # Activity-render CLI (#2757) — validates every `refs[]` citation against the facts' citable set (`owner/name#N` over the five numbered arrays; `owner/name@sha7+` by unique prefix over `commits[]`), drops absent/ambiguous refs with an exact warning per line, renders `# Activity — {from} to {to} ({register})` markdown or the one-line empty report; exit 0 rendered, 1 malformed invocation, 2 facts/narratives unreadable or failing schema validation (`plugin/bin/lib/activity/render.js`; tests in `tests/bin-lib/activity/render.test.js`, `render-cli.test.js`)
```

- [ ] **Step 6: Bump the Anti-Patterns row-count pin by measurement**

Run: `node --test tests/bin-lib/skill-audit/anti-patterns.test.js`
Expected: FAIL on the final cardinality assertion with the measured total (the new `SKILL.md` adds 4 rows; expect `416`, but take the number from the failure's `actual`, never from arithmetic). Then edit the `assert.strictEqual(total, 412)` line to the measured value and append to the comment ledger directly above it:

```
  //   412 -> 416, /claude-tweaks:activity (#2757). Four rows ADDED with the new
  //   plugin/skills/activity/SKILL.md, none evicted anywhere else. Evidence:
  //   `git diff 6d0f768a4...HEAD -- 'plugin/skills/*/SKILL.md' | grep -E '^[-+]\|'`
  //   lists exactly these four `+|` rows for activity/SKILL.md (demo's and feedback's
  //   #2697 edits touched no Anti-Patterns row). Measured by running this parser, not
  //   by adding 4.
```

Run the same grep the comment cites and confirm it lists exactly the four new rows (the #2697 edits earlier on this branch touched no Anti-Patterns table).

- [ ] **Step 7: Run the registration suites**

Run: `node --test tests/skill-catalog-completeness.test.js tests/reference-card-argument-hint.test.js tests/bin-lib/skill-audit/anti-patterns.test.js tests/bin-lib/skill-audit/house-structure.test.js tests/skill-conventions.test.js tests/activity-never-invent-conformance.test.js`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add docs/skill-graph.md plugin/skills/help/reference-card.md plugin/skills/help/context-flow.md docs/getting-started.md docs/plugin-structure.md tests/bin-lib/skill-audit/anti-patterns.test.js
```
```bash
git commit -m "Register /claude-tweaks:activity on the skill graph, reference card, context flow, getting-started, and plugin-structure; bump the Anti-Patterns pin (#2757)" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 7: One real run against this repository (`--period 7d`)

**Files:**
- Create (scratch, gitignored run-dir mirror — never committed): `.claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2757/activity-facts.json`, `activity-narratives.json`, `activity-report.md`

**Interfaces:**
- Consumes: the two CLIs from Tasks 2 and 4, exactly as the skill's Steps 1-3 invoke them.
- Produces: the rendered report and its warning lines, quoted in the task report; the controller quotes them into PR #2760's body.

- [ ] **Step 1: Gather, live**

Run: `node plugin/bin/activity-gather.js --period 7d --out .claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2757/activity-facts.json`
Expected: exit 0; stdout one JSON line with `actor: "thomasholknielsen"`, `repos: ["thn-inc/claude-tweaks"]` (the origin remote names `thomasholknielsen/claude-tweaks`, which GitHub redirects — either slug is acceptable; state which one landed), `failures: 0`. Read the file: every `merged_prs[]`/`closed_issues[]`/`issues_raised[]`/`reviews_given[]`/`in_flight[]` entry carries `repo, number, title, url`; every `commits[]` entry carries `repo, sha, subject, date, url` (AC1). `reviews_given` is expected to be `[]` (Global Constraints (c)).

- [ ] **Step 2: Narrate, as the skill would**

Write `activity-narratives.json` (Write tool) in `retro` register: 3-6 items under `Shipped` citing real `thn-inc/claude-tweaks#N` numbers and at least one `thn-inc/claude-tweaks@sha7` from the facts; `Reviewed` empty; `In flight` citing the open PRs. Add **one deliberate bad ref** on the last Shipped item (`thn-inc/claude-tweaks#999999`) so the live run demonstrates the drop.

- [ ] **Step 3: Render**

Run: `node plugin/bin/activity-render.js --facts .claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2757/activity-facts.json --narratives .claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2757/activity-narratives.json --out .claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2757/activity-report.md`
Expected: exit 0; stderr exactly one line `warning: dropped citation thn-inc/claude-tweaks#999999 — not present in facts.json`; the report opens `# Activity — {from} to {to} (retro)` and ends with the `## Notes` footer. Quote the full report and the warning line verbatim in the task report (they go into the PR body).

- [ ] **Step 4: No commit** — the three files are scratch in the gitignored run-dir mirror. Confirm `git -C "<worktree>" status --porcelain` is empty.

---

## Self-review

- **Spec coverage.** Task 0 → Task 0 (evidence recorded). `gather.js` → Task 1 (queries, fail-safe, `resolvePeriod`, header notes). `activity-gather.js` → Task 2 (Split-1/2, actor/repo resolution, exit 2/3 rules). `render.js` → Task 3 (validation, warnings, empty report, `schemaVersion`). `activity-render.js` → Task 4. `SKILL.md` → Task 5 (all bullets; the directive omission is a ruled premise correction). Registration → Task 6 (all five surfaces plus the pin). Tests → Tasks 1-5 (each red-then-green; AC8's conformance test in Task 5). One real run → Task 7. AC1-AC10 map: AC1 Task 7 Step 1; AC2/AC3 Task 2 tests; AC4 Task 1 + Task 2 tests; AC5/AC6 Task 3 tests; AC7 Task 4 test; AC8 Task 5 test; AC9 Task 5 test; AC10 `/build` Common Step 5 (this host's baseline adjudication applies).
- **Placeholder scan.** No TBD/TODO; every code step carries its full code; the skill body is complete.
- **Consistency.** `ACTIVITY_GH_TIMEOUT_MS = 15000` (Tasks 1, 2); warning strings identical in Task 3's module, tests, and Task 4's tests; `argument-hint` byte-identical between Task 5's frontmatter and Task 6's reference-card row (escaped); the `run(argv, deps)` deps names match between each CLI and its test; `QUERY_KEYS` order matches `buildQueries` and the facts key order.
