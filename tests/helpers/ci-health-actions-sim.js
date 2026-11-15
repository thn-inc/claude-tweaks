'use strict';
// A fake `gh api repos/{o}/{r}/actions/runs` over a pool of runs, answering the way GitHub does
// (probed live for #5161): the `created` filter is `>=X` or an `a..b` range inclusive at both ends,
// each end a date or a full timestamp; matching runs come newest first; one query yields at most
// CAP results, so a page past the cap is empty; `per_page` and `page` page that list. `served`
// records each answered call's created value, page and returned run ids.
const DAY_MS = 24 * 60 * 60 * 1000;
const CAP = 1000;

const field = (args, key) => {
  const arg = args.find((a) => a.startsWith(`${key}=`));
  return arg === undefined ? undefined : arg.slice(key.length + 1);
};

// A date-only end covers its whole UTC day; a timestamp is exact to the second.
function endMs(value, upper) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T00:00:00Z`) + (upper ? DAY_MS - 1000 : 0);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`unparsable created bound ${JSON.stringify(value)}`);
  return ms;
}

function bounds(created) {
  if (created.startsWith('>=')) return [endMs(created.slice(2), false), Infinity];
  const parts = created.split('..');
  if (parts.length !== 2) throw new Error(`unparsable created filter ${JSON.stringify(created)}`);
  return [endMs(parts[0], false), endMs(parts[1], true)];
}

function actionsRunsSim(pool) {
  const served = [];
  const answer = (args) => {
    const created = field(args, 'created');
    const perPage = Number(field(args, 'per_page'));
    const page = Number(field(args, 'page'));
    if (created === undefined || !(perPage > 0) || !(page > 0)) throw new Error('unexpected ' + args.join(' '));
    const [lo, hi] = bounds(created);
    const matching = pool
      .filter((run) => { const t = Date.parse(run.created_at); return t >= lo && t <= hi; })
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
    const body = matching.slice(0, CAP).slice((page - 1) * perPage, page * perPage);
    served.push({ created, page, ids: body.map((run) => run.id) });
    return { total_count: matching.length, workflow_runs: body };
  };
  return { answer, served };
}

module.exports = { actionsRunsSim };
