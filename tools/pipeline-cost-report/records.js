'use strict';
// tools/pipeline-cost-report/records.js — forge counts for the cost report (#5914).
//
// Counts come from the search API's exact `total_count`, never from a list length: search-backed lists return at
// most 1,000 rows. The deferral subset reads the created records' bodies; when that list is shorter than the created
// `total_count`, `truncated` names `created` and the deferral figures cover only the rows read. A `gh` throw
// propagates to the caller (the CLI turns it into a section error).
//
// `gh` is `(args: string[]) => stdout string` — the same runner shape as funnel.js's defaultGh.

// A deferred record carries `Defer-reason: {word}` on any line, in any markup (`- **Defer-reason:** x`,
// `` (`Defer-reason: x`) ``, `file.js:93 — Defer-reason: x`).
const DEFER_RE = /Defer-reason:[`*]*[ \t]*[`*]*([A-Za-z][A-Za-z-]*)?/;

// The first word after the first `Defer-reason:`; `unnamed` when no word follows; null when the body has none.
function deferReasonOf(body) {
  if (typeof body !== 'string') return null;
  const m = DEFER_RE.exec(body);
  if (!m) return null;
  return m[1] || 'unnamed';
}

function searchCount(gh, repo, qualifiers) {
  const out = gh(['api', `search/issues?q=repo:${repo}+${qualifiers}&per_page=1`, '-q', '.total_count']);
  const text = String(out).trim();
  const n = text === '' ? NaN : Number(text);
  if (!Number.isInteger(n) || n < 0) throw new Error(`gh search returned no total_count for ${qualifiers}`);
  return n;
}

async function collectRecords({ repo, since, until }, { gh }) {
  const window = `${since}..${until}`;
  const created = searchCount(gh, repo, `is:issue+created:${window}`);
  const closed = searchCount(gh, repo, `is:issue+closed:${window}`);
  const open = searchCount(gh, repo, 'is:issue+is:open');

  const rows = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'all', '--search', `created:${window}`, '--limit', '1000', '--json', 'number,state,body']));

  const deferred = { total: 0, open: 0, closed: 0 };
  const byReason = {};
  for (const row of rows) {
    const reason = deferReasonOf(row.body);
    if (reason === null) continue;
    const side = String(row.state).toUpperCase() === 'OPEN' ? 'open' : 'closed';
    deferred.total++;
    deferred[side]++;
    if (!byReason[reason]) byReason[reason] = { open: 0, closed: 0 };
    byReason[reason][side]++;
  }

  return { created, closed, open, deferred, byReason, truncated: rows.length < created ? ['created'] : [] };
}

async function countMergedPrs({ repo, since, until }, { gh }) {
  return { count: searchCount(gh, repo, `is:pr+is:merged+merged:${since}..${until}`) };
}

module.exports = { deferReasonOf, collectRecords, countMergedPrs };
