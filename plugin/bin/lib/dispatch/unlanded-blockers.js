// bin/lib/dispatch/unlanded-blockers.js — the pure half of
// bin/dispatch-unlanded-blockers.js (#4792). No I/O: it projects the queue
// pull's candidate pool to preflight-records.js's --prefetched-json shape, names
// the records whose blocker declaration cannot be checked (so the CLI excludes
// them as `malformed-blocker` and keeps them out of the landing call), turns the
// call's --blocker-landing envelope into `unlanded-blocker` exclusions, and drops
// the excluded members from the groups.
'use strict';

const { parseDependencies } = require('../issues/record-dependencies');

const UNLANDED_REASON = 'unlanded-blocker';
const MALFORMED_REASON = 'malformed-blocker';

// GraphQL's Int is 32-bit. github.com answers `issue(number:3000000000)` with a
// NOT_FOUND on that alias (observed 2026-11-03), which the landing check reads as
// undetermined/not-found, so an unscreened record naming such a blocker would be
// kept and dispatched; a host that enforces the limit would fail the whole query.
const GRAPHQL_INT_MAX = 2147483647;

const NATIVE_MISSING_CAUSE = 'the native dependency response has no entry for it';

// The line preflight-records.js prints when work-links: native's dependency call
// names candidates the response has no entry for. Writer: the throw in
// plugin/bin/lib/issues/native-dependencies.js (`missing dependency data for #a, #b`,
// then ` (GraphQL: …)` when the response carried errors), printed as
// `preflight-records.js: {message}` by plugin/bin/preflight-records.js. Linear:
// matched per line (no `g`, no `m`), anchored at `^`, one `#\d+(?:, #\d+)*` run with
// no lazy group, and the end anchored to the writer's two shapes, so each line
// costs one attempt and a tail-carrying or truncated line fails rather than
// naming a record.
const NATIVE_MISSING_LINE = /^preflight-records\.js: missing dependency data for (#\d+(?:, #\d+)*)(?: \(GraphQL: |$)/;

const isPositiveInteger = (n) => Number.isInteger(n) && n > 0;

// groups (arrays of {number, title, body, labels, …}) -> the pool as the landing
// call's --prefetched-json input: the four keys, deduped by number, ascending.
function poolRecords(groups) {
  const byNumber = new Map();
  for (const r of groups.flat()) {
    if (byNumber.has(r.number)) continue;
    byNumber.set(r.number, {
      number: r.number, title: r.title, body: r.body, labels: r.labels,
    });
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

// pool -> [{ number, cause }] in pool order: one entry per record whose blocker
// declaration cannot be checked, the first failing check winning. Each of these
// would otherwise make the whole preflight-records.js call exit 2 (checks 1-3 and
// a `Blocked by #0`-style number) or leave the record kept and dispatchable
// (a number above GRAPHQL_INT_MAX), so one bad record would switch the check off
// for the pool (Q3) or ship (Q4). The body check runs under every work-links
// value: the spec's AC carries no work-links condition.
function malformedRecords(pool) {
  const out = [];
  for (const r of pool) {
    let cause = null;
    if (!isPositiveInteger(r.number)) cause = 'its number is not a positive integer';
    else if (typeof r.body !== 'string') cause = 'its body is not a string';
    else if (r.labels != null && !Array.isArray(r.labels)) cause = 'its labels are not an array';
    else {
      const invalid = parseDependencies(r.body).filter((n) => !(isPositiveInteger(n) && n <= GRAPHQL_INT_MAX));
      if (invalid.length) cause = `a Blocked by line names no valid issue number (#${invalid.join(', #')})`;
    }
    if (cause) out.push({ number: r.number, cause });
  }
  return out;
}

// The child's stderr, the call's candidate numbers -> the candidates the native
// dependency response lacked (ascending, deduped), or null when this exit cannot be
// pinned on records: no line matches, or a named number is not a candidate of the
// call. Never [].
function nativeMissingRecords(stderr, numbers) {
  const named = new Set();
  for (const raw of String(stderr).split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const m = NATIVE_MISSING_LINE.exec(line);
    if (!m) continue;
    for (const token of m[1].split(', ')) named.add(Number(token.slice(1)));
  }
  if (named.size === 0) return null;
  const known = new Set(numbers);
  for (const n of named) if (!known.has(n)) return null;
  return [...named].sort((a, b) => a - b);
}

const malformedExclusion = ({ number, cause }) => ({ reason: MALFORMED_REASON, records: [number], detail: { cause } });

// The landing call's envelope, the requested numbers -> { exclusions, undetermined }.
// One `unlanded-blocker` exclusion per requested record with an `unlanded` verdict
// (blockers in blockerLanding order); `undetermined` lists every undetermined
// verdict, which the CLI keeps and logs. `open` is the blocked pass's, and `landed`
// and `not-applicable` contribute nothing. A cross-repository `undetermined` is a
// CLOSED foreign blocker, which /dispatch does not count as blocking (#4793); its
// entry carries the verdict's `repository` so the CLI names it owner/name#N. Throws a
// TypeError naming the record when its blockerLanding is not an array: the call
// printed an envelope it did not mean.
function landingExclusions(envelope, numbers) {
  const exclusions = [];
  const undetermined = [];
  for (const n of numbers) {
    const rec = envelope && envelope.records && envelope.records[String(n)];
    const landing = rec && rec.blockerLanding;
    if (!Array.isArray(landing)) throw new TypeError(`#${n} has no blockerLanding array`);
    const blockers = [];
    for (const v of landing) {
      if (v.verdict === 'unlanded') blockers.push({ blocker: v.blocker, commit: v.commit });
      else if (v.verdict === 'undetermined') undetermined.push({ record: n, blocker: v.blocker, via: v.via, ...(v.repository ? { repository: v.repository } : {}) });
    }
    if (blockers.length) exclusions.push({ reason: UNLANDED_REASON, records: [n], detail: { blockers } });
  }
  return { exclusions, undetermined };
}

// groups, Set<number> -> new groups without the excluded members; a group left
// empty disappears (a fast-lane bundle keeps its other members).
function withoutExcluded(groups, numbers) {
  return groups.map((g) => g.filter((r) => !numbers.has(r.number))).filter((g) => g.length > 0);
}

module.exports = {
  UNLANDED_REASON,
  MALFORMED_REASON,
  GRAPHQL_INT_MAX,
  NATIVE_MISSING_CAUSE,
  poolRecords,
  malformedRecords,
  nativeMissingRecords,
  malformedExclusion,
  landingExclusions,
  withoutExcluded,
};
