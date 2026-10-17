// bin/lib/preflight-records/preflight-records.js
// Pure(ish) helpers behind bin/preflight-records.js — the record pre-flight
// JSON CLI that mechanizes skills/flow/materialize.md's Resolution + the
// blocked-by bullet and skills/flow/multi-spec.md's Validation steps 1-5
// (Prerequisites + Cross-spec conflict detection). Fetches N records
// (`gh issue view`) — or takes them already fetched from a `--records-json`
// file via issuesFromRecordsJson, the gh-free path (#3351) — derives their
// facets/keyFiles/fingerprint, resolves
// each record's blockedBy either from body text (work-links: body-text, no
// extra call) or one batched aliased GraphQL call (work-links: native), and
// groups records that share key files via bin/lib/issues/grouping.js's
// groupByFileOverlap. The runner is injectable, same contract as
// bin/lib/issues/link.js / capabilities-probe.js: runner(args) is invoked
// as if `gh ${args.join(' ')}` and returns stdout; a throw is a failed call.
'use strict';

const { execFileSync } = require('child_process');
const {
  parseRecordFacets, parseDependencies, extractFingerprint,
} = require('../issues/record');
const { extractKeyFiles, groupByFileOverlap, directOverlaps } = require('../issues/grouping');
const { fetchNativeDependencies: sharedFetchNativeDependencies } = require('../issues/native-dependencies');
const { repoSlug } = require('../repo-resolve');

function defaultRunner(args) {
  return execFileSync('gh', args, { encoding: 'utf8', windowsHide: true });
}

// A runner may throw a non-Error (string, object, undefined) — never let a
// failed[]/error message come back empty. Same shape as link.js's own copy.
function errorText(err) {
  const parts = [err && err.message, err && err.stderr, err && err.stdout].filter(Boolean).map(String);
  return parts.length ? parts.join(' ') : String(err);
}

// numbers: number[] -> { ok: Map<number, issue>, failed: [{number, error}] }.
// issue is shaped { number, title, body, labels } (gh issue view --json
// number,title,body,labels output). Each fetch is independently try/caught —
// one failing record never aborts the batch; the caller (the CLI) decides
// whether any `failed` entries abort the whole run. All-at-once reporting:
// every record is attempted regardless of earlier failures.
//
// #2538: `owner`/`repo`/`host` (optional — a caller with no resolvable repo
// spec, e.g. body-text mode with no readable origin remote, omits all
// three) thread `--repo {host/}owner/repo` onto every call, mirroring
// materialize.js's `ghView`/`fetchNativeDependencies`'s own `--hostname`
// convention rather than relying on `gh`'s own cwd-derived auto-detection —
// the same explicit-over-implicit posture #2240/#2425 already established
// for this codebase's other gh-issue/gh-graphql call sites. `repoSlug`
// resolves to bare `owner/repo` on github.com (a true no-op there — see
// this record's own Gotchas) and `host/owner/repo` on a GitHub Enterprise
// Server host, where a `gh` call cannot otherwise resolve the target
// repository at all.
function fetchIssues({
  numbers, owner, repo, host, runner = defaultRunner,
} = {}) {
  const ok = new Map();
  const failed = [];
  const repoArgs = owner && repo ? ['--repo', repoSlug({ host, owner, repo })] : [];
  for (const n of numbers) {
    try {
      const out = runner(['issue', 'view', String(n), '--json', 'number,title,body,labels', ...repoArgs]);
      ok.set(n, JSON.parse(out));
    } catch (err) {
      failed.push({ number: n, error: errorText(err) });
    }
  }
  return { ok, failed };
}

// #3351: the gh-free input — the caller (a gh-absent cloud sandbox) fetched
// the records through another transport and hands them over as parsed JSON.
// raw: unknown (the JSON.parse output), numbers: number[] (the requested
// records) -> { ok: Map<number, issue> } | { error: string } — `ok` is the
// same Map shape fetchIssues returns, so everything downstream is shared.
// Strict by design: a record the file lacks, repeats, or adds beyond the
// request is a caller bug, never silently reconciled (a missing record would
// otherwise shrink the cross-spec checks without a trace).
function issuesFromRecordsJson(raw, numbers) {
  if (!Array.isArray(raw)) return { error: '--records-json must be a JSON array' };
  const ok = new Map();
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== 'object' || !Number.isInteger(entry.number)) {
      return { error: `--records-json entry ${i} is missing a numeric "number"` };
    }
    if (typeof entry.body !== 'string') {
      return { error: `--records-json entry #${entry.number} is missing a string "body"` };
    }
    // A missing (or null) labels is an unlabelled issue, as gh reports it; any
    // other non-array would crash parseRecordFacets downstream.
    if (entry.labels != null && !Array.isArray(entry.labels)) {
      return { error: `--records-json entry #${entry.number} has non-array "labels"` };
    }
    if (ok.has(entry.number)) return { error: `--records-json lists #${entry.number} more than once` };
    ok.set(entry.number, entry);
  }
  for (const n of numbers) {
    if (!ok.has(n)) return { error: `--records-json is missing requested #${n}` };
  }
  for (const n of ok.keys()) {
    if (!numbers.includes(n)) return { error: `--records-json lists #${n}, which was not requested` };
  }
  return { ok };
}

// fetchNativeDependencies({ numbers, owner, repo, runner }) -> Map<number,
// {blockedBy: number[], openBlocker: boolean, openBlockerIds: number[]}>.
// Executes the batched, aliased GraphQL call (bin/lib/issues/record.js's
// buildNativeDependencyQuery) and parses the response — moved to
// bin/lib/issues/native-dependencies.js (#538) so this CLI's call site and
// bin/resolve-blockers.js's single-record CLI share one implementation instead
// of two copies of the same GraphQL-call-and-parse logic. Re-exported here
// (with the same default-runner convenience this module's other fetchers use)
// for this module's existing callers/tests. `runner` defaults to
// `defaultRunner` (execFileSync('gh', ...)) the same way `fetchIssues` above
// does; native-dependencies.js itself takes no default so its behavior stays
// fully injectable for every caller.
function fetchNativeDependencies({
  numbers, owner, repo, host, runner = defaultRunner,
} = {}) {
  return sharedFetchNativeDependencies({
    numbers, owner, repo, host, runner,
  });
}

// issues: Map<number, issue>, dependencies: Map<number, {blockedBy, openBlocker}> | null
// -> { "<n>": { title, facets, blockedBy, openBlocker, keyFiles, fingerprint } }.
// dependencies is null under work-links: body-text — blockedBy is read straight
// off the record's own body (parseDependencies) instead, with no extra call;
// that driver has no open/closed signal for a blocker (parseDependencies only
// ever returns blocker *numbers*, never state), so openBlocker is null there —
// "undetermined by this driver", never a false claim of "checked, not open".
function buildRecords({ issues, dependencies = null } = {}) {
  const records = {};
  for (const [n, issue] of issues) {
    const dep = dependencies ? dependencies.get(n) : null;
    records[String(n)] = {
      title: issue.title,
      facets: parseRecordFacets(issue.labels),
      blockedBy: dep ? dep.blockedBy : parseDependencies(issue.body),
      openBlocker: dep ? dep.openBlocker : null,
      keyFiles: extractKeyFiles(issue),
      fingerprint: extractFingerprint(issue.body),
    };
  }
  return records;
}

// records (the buildRecords output, keyed by string number) -> overlapGroups:
// [[n,...], ...] per groupByFileOverlap, which unions on item.id — ids are
// coerced back to Number so a group's members match the input record numbers,
// not their string keys.
function buildOverlapGroups(records) {
  const items = Object.entries(records).map(([n, r]) => ({ id: Number(n), keyFiles: r.keyFiles }));
  return groupByFileOverlap(items);
}

// records -> directOverlaps (#3278): the non-transitive companion to
// buildOverlapGroups. Every pair of records sharing a linking file, once, as
// [{a, b, files}] with a < b, sorted by a then b. Same record mapping and hub
// rule as buildOverlapGroups; groupByFileOverlap's transitive groups stay as-is.
function buildDirectOverlaps(records) {
  const items = Object.entries(records).map(([n, r]) => ({ id: Number(n), keyFiles: r.keyFiles }));
  const pairs = [];
  for (const [a, neighbours] of directOverlaps(items)) {
    for (const { id: b, files } of neighbours) {
      if (a < b) pairs.push({ a, b, files });
    }
  }
  return pairs.sort((x, y) => x.a - y.a || x.b - y.b);
}

module.exports = {
  defaultRunner, errorText, fetchIssues, issuesFromRecordsJson, fetchNativeDependencies, buildRecords, buildOverlapGroups, buildDirectOverlaps,
};
