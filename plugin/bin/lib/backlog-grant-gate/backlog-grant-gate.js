// bin/lib/backlog-grant-gate/backlog-grant-gate.js
//
// Behind bin/backlog-grant-gate.js — mechanizes skills/backlog/refine-headless.md's
// Step 0 (ceiling gate) through Step 2 Phase A (gates 1-3, pure) as one
// invocation, reusing evaluateGrantGate/trustRows/machineGrantOutlook
// directly instead of requiring an agent to hand-compose the ~40-step Bash
// pipeline those prose sections used to document (#1384's Current State).
//
// Runner contract mirrors bin/lib/preflight-records/preflight-records.js and
// bin/fetch-sub-issues.js: `runner(args)` is invoked as if `gh ${args.join(' ')}`
// and returns stdout; a throw is a failed call. `gitRunner(args)` is the same
// shape for `git`. Every fetch is injectable so tests never touch a real
// process. The historical `--state all` record fetch reads through the
// session-scoped snapshot (`../issues/record-snapshot.js`,
// `_shared/record-queue-fetch.md`) the same way every other scan in this
// plugin does — only the ready-labeled and parent-issue `--label` fetches
// stay outside it, per that file's own dedicated-call exemption.
'use strict';

const { parseRecordFacets, parseDependencies, parseSubIssues } = require('../issues/record');
const { evaluateGrantGate } = require('../issues/grant-gate');
const { trustRows, parseGitLog } = require('../issues/trust');
const { machineGrantOutlook } = require('../issues/backlog');
const { fetchNativeSubIssues } = require('../issues/native-dependencies');
const { probeSchemaStrict } = require('../issues/capabilities-probe');
const recordSnapshot = require('../issues/record-snapshot');

const CANDIDATE_FIELDS = 'number,title,body,labels,createdAt';

function jsonOut(runner, args) {
  return JSON.parse(runner(args));
}

// { limit, runner } -> the ready-labeled candidate pool, gh issue view shape
// (refine-headless.md Step 1's ready fetch). A dedicated, server-side-filtered
// `--label` fetch — deliberately outside the session-scoped snapshot below,
// the same "stays a dedicated call" exemption `_shared/record-queue-fetch.md`
// documents for every other `--label`-filtered consumer.
function fetchReadyCandidates({ limit, runner }) {
  return jsonOut(runner, ['issue', 'list', '--label', 'ready', '--state', 'open', '--json', CANDIDATE_FIELDS, '--limit', String(limit)]);
}

// (issues, openNumbers) -> candidates surviving refine-headless.md Step 1's cheap
// pre-pass: agent-filed origin, no existing grant, not already claimed, no
// open 'Blocked by #N'. Each candidate carries its own parsed `facets`.
function filterCandidates(issues, openNumbers) {
  return issues
    .map((i) => ({ ...i, facets: parseRecordFacets(i.labels) }))
    .filter((i) => i.facets.origin !== null)
    .filter((i) => !i.facets.grants.build && !i.facets.grants.merge)
    .filter((i) => !i.facets.bot.inProgress)
    .filter((i) => parseDependencies(i.body).every((d) => !openNumbers.has(d)));
}

// { limit, runner, sessionId, ttlSeconds, now? } -> the whole historical
// record set (all states) trustRows grades cells from —
// _shared/trust-table.md's Fetch section, itself a citer of
// _shared/record-queue-fetch.md's "Session-scoped record snapshot": read
// `bin/lib/issues/record-snapshot.js`'s cache when fresh (the same file
// `/help`, `/tidy`, `/backlog overview`/`refine`, `/capture`, `/specify`, and
// the trust-table fragment itself all read through, so one continuous
// session pulling the whole issue set independently per skill invocation
// doesn't burn a round-trip per call for identical data), else fetch live via
// `UNION_FIELDS` and write the snapshot back for the next reader.
function fetchAllRecords({ limit, runner, sessionId, ttlSeconds, now = Date.now() }) {
  const snapPath = recordSnapshot.snapshotPath(sessionId);
  if (snapPath && recordSnapshot.isFresh(snapPath, ttlSeconds, now)) {
    return recordSnapshot.readSnapshot(snapPath);
  }
  const records = jsonOut(runner, ['issue', 'list', '--state', 'all', '--json', recordSnapshot.UNION_FIELDS, '--limit', String(limit)]);
  if (snapPath) recordSnapshot.writeSnapshot(snapPath, records);
  return records;
}

// { workLinks, limit, runner, owner, repo, host, probeFn } -> Set<number> of every
// closed record that is a decomposed sub-issue (trust.js's `hasParent`
// input) — _shared/trust-table.md's `work-links` branch. `body-text` reads
// every parent-issue's own task list with no extra network shape beyond the
// one list call; `native` batches the sub_issues GraphQL probe
// (fetchNativeSubIssues) with a per-parent REST retry for anything the batch
// couldn't resolve in one page, mirroring that file's retry ladder. `host`
// (optional, omitted/`github.com` = no flag) threads `--hostname` onto the
// REST retry's `gh api` call — #2240, the same GitHub Enterprise Server
// pattern fetch-sub-issues.js's own REST retry loop already applies; the
// batched GraphQL probe above is unchanged, matching that file's scope.
function resolveSubIssueNumbers({
  workLinks, limit, runner, owner, repo, host, probeFn = probeSchemaStrict,
}) {
  if (workLinks === 'native') {
    const parents = jsonOut(runner, ['issue', 'list', '--label', 'parent-issue', '--state', 'all', '--json', 'number', '--limit', String(limit)]);
    const numbers = parents.map((p) => p.number);
    if (numbers.length === 0) return new Set();
    const schema = probeFn(runner);
    const all = new Set();
    const retryParents = [];
    if (schema.subIssues) {
      for (let i = 0; i < numbers.length; i += 50) {
        const chunk = numbers.slice(i, i + 50);
        const res = fetchNativeSubIssues({ numbers: chunk, owner, repo, runner });
        for (const subs of res.byParent.values()) subs.forEach((n) => all.add(n));
        retryParents.push(...res.retry);
      }
    } else {
      retryParents.push(...numbers);
    }
    for (const parentNumber of retryParents) {
      const apiArgs = ['api', '--paginate', `repos/${owner}/${repo}/issues/${parentNumber}/sub_issues`, '--jq', '.[].number'];
      if (host && host !== 'github.com') apiArgs.push('--hostname', host);
      const out = runner(apiArgs);
      out.trim().split('\n').filter(Boolean).forEach((n) => all.add(Number(n)));
    }
    return all;
  }
  // body-text: the parent body's own task list, no extra call.
  const parents = jsonOut(runner, ['issue', 'list', '--label', 'parent-issue', '--state', 'all', '--json', 'number,body', '--limit', String(limit)]);
  const all = new Set();
  for (const p of parents) parseSubIssues(p.body).forEach((n) => all.add(n));
  return all;
}

// { integrationBranch, gitRunner } -> parsed git log ([{sha, message}]) —
// _shared/trust-table.md's git-log dump, parsed with trust.js's own
// parseGitLog so this CLI can never disagree with any other trustRows caller
// about the same evidence ([IL-32]).
function fetchGitLog({ integrationBranch, gitRunner }) {
  const raw = gitRunner(['log', integrationBranch, '--format=%H%x1f%B%x1e']);
  return parseGitLog(raw);
}

// candidates (each already carrying `facets`) + policy + trustRowsArray ->
// [{ number, result }] — refine-headless.md Step 2 Phase A's exact per-candidate
// evaluateGrantGate call (gates 1-3, pure — grantCheck omitted).
function computePhaseA({ candidates, policy, trustRowsArray }) {
  const trustVerdicts = new Map((trustRowsArray || []).map((row) => [row.key, row]));
  return candidates.map((c) => ({
    number: c.number,
    result: evaluateGrantGate({
      record: { number: c.number, labels: c.labels, body: c.body, facets: c.facets },
      policy,
      trustVerdicts,
    }),
  }));
}

// The full Step 0 -> Step 2 Phase A pipeline, one call. `policy` is
// { ceiling, grantOriginationEnabled, riskFloor, sizeFloor, windowDays } —
// already resolved by the caller (the CLI resolves it from
// .claude-tweaks/policy.yml before calling in). `fetch` bundles every
// injectable I/O dependency: { limit, workLinks, integrationBranch, owner,
//   repo, runner, gitRunner, probeFn?, sessionId?, ttlSeconds? } — the last
//   two feed the session-scoped record-snapshot cache (fetchAllRecords
//   above); omitted or unresolvable, the cache is simply never fresh and
//   every call fetches live, same as before this cache existed.
//
// Returns the full envelope the CLI prints, and the exact shape
// skills/backlog/refine-headless.md's Step 1 / Step 2 Phase A tmp files need
// (candidates, trustRows, phaseA) plus the machineGrantOutlook-derived
// eligible/refused breakdown and a `shortcut` verdict:
//   - shortcut: 'ceiling-gate'   — Step 0 never cleared; nothing else ran.
//   - shortcut: 'zero-eligible'  — Step 0 cleared but Phase A found zero
//     candidates with needsGrantCheck: true; the caller's own Phase B/C loop
//     never needs to run this firing (#1384's Deliverable 2).
//   - shortcut: null             — at least one candidate is eligible; the
//     caller proceeds to Phase B for `eligible`.
function computeOutlook(policy, fetch) {
  const pol = policy || {};
  if (pol.ceiling !== 'unattended' || pol.grantOriginationEnabled !== true) {
    return {
      ceiling: pol.ceiling || null,
      grantOriginationEnabled: pol.grantOriginationEnabled === true,
      shortcut: 'ceiling-gate',
      candidates: [],
      trustRows: [],
      phaseA: [],
      eligible: [],
      refused: {},
    };
  }

  const {
    limit, workLinks, integrationBranch, owner, repo, host, runner, gitRunner, probeFn, sessionId, ttlSeconds,
  } = fetch;

  // One `--state all` fetch (session-cached) supplies both this run's
  // open-issue set (for the Blocked-by filter below) and the historical
  // record set trustRows grades — the same single-fetch shape refine-headless.md
  // originally derived openNumbers from, never a second bare `--state open`
  // call of its own.
  const allRecords = fetchAllRecords({ limit, runner, sessionId, ttlSeconds });
  const openNumbers = new Set(allRecords.filter((r) => r.state === 'OPEN').map((r) => r.number));

  const readyIssues = fetchReadyCandidates({ limit, runner });
  const candidates = filterCandidates(readyIssues, openNumbers);

  const subIssueNumbers = resolveSubIssueNumbers({
    workLinks, limit, runner, owner, repo, host, probeFn,
  });
  const gitLog = fetchGitLog({ integrationBranch, gitRunner });
  const records = allRecords.map((r) => ({
    ...r,
    labels: r.labels.map((l) => (typeof l === 'string' ? l : l.name)),
    hasParent: subIssueNumbers.has(r.number),
  }));
  const rows = trustRows(records, gitLog, Date.now(), { 'trust-revert-window-days': pol.windowDays });

  const phaseA = computePhaseA({ candidates, policy: pol, trustRowsArray: rows });
  const { eligible, refused } = machineGrantOutlook(candidates, pol, rows);

  return {
    ceiling: pol.ceiling,
    grantOriginationEnabled: true,
    shortcut: eligible.length === 0 ? 'zero-eligible' : null,
    candidates,
    trustRows: rows,
    phaseA,
    eligible,
    refused,
  };
}

module.exports = {
  CANDIDATE_FIELDS,
  fetchReadyCandidates,
  filterCandidates,
  fetchAllRecords,
  resolveSubIssueNumbers,
  fetchGitLog,
  computePhaseA,
  computeOutlook,
};
