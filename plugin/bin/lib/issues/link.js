// bin/lib/issues/link.js
// Native linking for /specify Step 4 (work-backend: github-issues, work-links:
// native): resolve every needed integer databaseId in ONE aliased GraphQL call,
// then issue the two REST writes GitHub exposes for issue relationships —
//   POST repos/{o}/{r}/issues/{parent}/sub_issues            -F sub_issue_id=<databaseId>
//   POST repos/{o}/{r}/issues/{dependent}/dependencies/blocked_by -F issue_id=<databaseId>
// Both endpoints take the target issue's integer database ID in the body, never
// its issue number (#608). The parent / dependent appear only as numbers in the
// path. Each write is independently try/caught into {ok, failed} so one failed
// edge never aborts the rest — the same "a failed link gets noted and the pass
// continues" rule record-creation.md Step 4 states. A 422 whose message says
// "already …" is a re-run, not a failure: it lands in ok with already:true.
// The runner is injectable (never the real `gh` in tests): runner(args) is
// invoked as if `gh ${args.join(' ')}` and returns stdout — the same contract
// as capabilities-probe.js. These two endpoints have no GitHub MCP equivalent,
// so this module requires `gh`; the CLI wrapper names the work-links: body-text
// fallback when it is absent.
'use strict';

const { execFileSync } = require('child_process');

// 30s bound: shared by resolveDatabaseIds' aliased GraphQL batch (same
// shape as fetch-sub-issues.js's 50-alias query) and the per-edge REST
// POSTs below, which complete well under it (#1154 — gh-api-module-pattern's
// "bound every remote-contacting call on the seam" rule).
function defaultRunner(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
}

function errorText(err) {
  const parts = [err && err.message, err && err.stderr, err && err.stdout].filter(Boolean).map(String);
  // A runner may throw a non-Error (string, object, undefined) — never let the
  // envelope's failed[].error come back as '' with the reason swallowed.
  return parts.length ? parts.join(' ') : String(err);
}

// A 422 whose message says the relationship already exists — a re-run, not a failure.
// Heuristic: matches "422" and "already" anywhere across message/stderr/stdout. Confirmed
// against a live duplicate blocked_by POST (2026-08-16): GitHub answers HTTP 422 with
// "Validation failed: Target issue has already been taken" — both regexes match. Fails
// safe either way: a false negative reports a real duplicate under `failed` (visible,
// harmless on re-run).
function isAlreadyLinkedError(err) {
  const text = errorText(err);
  return /\b422\b/.test(text) && /already/i.test(text);
}

// { owner, repo, host, numbers, runner } -> Map<number, databaseId>. One GraphQL call,
// one `i{N}` alias per distinct number; throws when any number resolves to no
// databaseId (a partial map would let a caller POST sub_issue_id=undefined).
// `host` is optional — omitted or 'github.com' means no --hostname flag (#2240:
// a GitHub Enterprise Server host threads --hostname the same way
// fetch-sub-issues.js's REST retry loop does).
function resolveDatabaseIds({
  owner, repo, host, numbers, runner = defaultRunner,
}) {
  const distinct = [...new Set(numbers.map(Number))].filter((n) => Number.isInteger(n) && n > 0);
  if (distinct.length === 0) return new Map();
  const fields = distinct.map((n) => `i${n}: issue(number:${n}){ databaseId }`).join(' ');
  const query = `query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){ ${fields} } }`;
  // -f (raw string), NOT -F: these are already-resolved values bound to String! variables —
  // -F would type-coerce an all-numeric owner/repo (e.g. "2048") to an Int and GraphQL rejects it.
  // (-F is only right for gh's literal `{owner}`/`{repo}` placeholder substitution, which is not
  // in play here — see #608 vs #610.)
  const args = ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`];
  if (host && host !== 'github.com') args.push('--hostname', host);
  const out = runner(args);
  const parsed = JSON.parse(out);
  const repository = parsed && parsed.data && parsed.data.repository;
  const ids = new Map();
  const missing = [];
  for (const n of distinct) {
    const node = repository ? repository[`i${n}`] : null;
    const id = node && Number.isInteger(node.databaseId) ? node.databaseId : null;
    if (id === null) missing.push(n);
    else ids.set(n, id);
  }
  if (missing.length) {
    const errs = Array.isArray(parsed && parsed.errors) ? parsed.errors.map((e) => e && e.message).filter(Boolean) : [];
    const suffix = errs.length ? ` (GraphQL: ${errs.join('; ')})` : '';
    throw new Error(`missing databaseId for ${missing.map((n) => `#${n}`).join(', ')}${suffix}`);
  }
  return ids;
}

function post({
  runner, path, field, value, host,
}) {
  const args = ['api', '-X', 'POST', path, '-F', `${field}=${value}`];
  if (host && host !== 'github.com') args.push('--hostname', host);
  return runner(args);
}

// { owner, repo, host, parent, subs, ids, runner } -> { ok: [{number, already}], failed: [{number, error}] }
function linkSubIssues({
  owner, repo, host, parent, subs, ids, runner = defaultRunner,
}) {
  const ok = [];
  const failed = [];
  for (const sub of subs) {
    const id = ids.get(Number(sub));
    if (id === undefined) { failed.push({ number: sub, error: 'no databaseId resolved' }); continue; }
    try {
      post({
        runner, path: `repos/${owner}/${repo}/issues/${parent}/sub_issues`, field: 'sub_issue_id', value: id, host,
      });
      ok.push({ number: sub, already: false });
    } catch (err) {
      if (isAlreadyLinkedError(err)) ok.push({ number: sub, already: true });
      else failed.push({ number: sub, error: errorText(err) });
    }
  }
  return { ok, failed };
}

// { owner, repo, host, edges: [{dependent, blocker}], ids, runner } -> same shape, keyed by edge
function linkBlockedBy({
  owner, repo, host, edges, ids, runner = defaultRunner,
}) {
  const ok = [];
  const failed = [];
  for (const { dependent, blocker } of edges) {
    const id = ids.get(Number(blocker));
    if (id === undefined) { failed.push({ dependent, blocker, error: 'no databaseId resolved' }); continue; }
    try {
      post({
        runner, path: `repos/${owner}/${repo}/issues/${dependent}/dependencies/blocked_by`, field: 'issue_id', value: id, host,
      });
      ok.push({ dependent, blocker, already: false });
    } catch (err) {
      if (isAlreadyLinkedError(err)) ok.push({ dependent, blocker, already: true });
      else failed.push({ dependent, blocker, error: errorText(err) });
    }
  }
  return { ok, failed };
}

module.exports = { resolveDatabaseIds, linkSubIssues, linkBlockedBy, isAlreadyLinkedError, defaultRunner };
