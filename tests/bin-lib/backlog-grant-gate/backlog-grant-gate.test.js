'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  filterCandidates,
  fetchGitLog,
  computePhaseA,
  resolveSubIssueNumbers,
  computeOutlook,
} = require('../../../plugin/bin/lib/backlog-grant-gate/backlog-grant-gate');

// computeOutlook grades trust on the real clock, so a closed fixture must sit
// inside trustRows' default 30-day evaluation window to form a cell.
const CLOSED_20_DAYS_AGO = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

function issue(number, overrides = {}) {
  return {
    number, title: 'untitled', body: '', labels: [], createdAt: '2026-01-01T00:00:00Z', ...overrides,
  };
}

test('filterCandidates drops human-filed, already-granted, in-progress, and blocked-open records', () => {
  const openNumbers = new Set([50]);
  const candidates = filterCandidates([
    issue(1, { labels: ['by:code-health', 'ready'] }), // survives
    issue(2, { labels: ['ready'] }), // no by:* -> human-filed, dropped
    issue(3, { labels: ['by:code-health', 'ready', 'auto:build'] }), // already granted, dropped
    issue(4, { labels: ['by:code-health', 'ready', 'bot:in-progress'] }), // claimed, dropped
    issue(5, { labels: ['by:code-health', 'ready'], body: 'Blocked by #50' }), // open blocker, dropped
    issue(6, { labels: ['by:code-health', 'ready'], body: 'Blocked by #999' }), // closed/unknown blocker, survives
  ], openNumbers, new Map());
  assert.deepStrictEqual(candidates.map((c) => c.number), [1, 6]);
});

test('fetchGitLog parses the %x1f/%x1e-delimited dump via trust.js\'s own parseGitLog', () => {
  const raw = 'abc123\x1fFix the thing\n\nrefs #1\x1e\ndef456\x1fAnother commit\x1e';
  const gitRunner = (args) => {
    assert.deepStrictEqual(args, ['log', 'main', '--format=%H%x1f%B%x1e']);
    return raw;
  };
  const log = fetchGitLog({ integrationBranch: 'main', gitRunner });
  assert.deepStrictEqual(log, [
    { sha: 'abc123', message: 'Fix the thing\n\nrefs #1' },
    { sha: 'def456', message: 'Another commit' },
  ]);
});

test('computePhaseA runs evaluateGrantGate gates 1-3 per candidate, no grantCheck', () => {
  const candidates = [
    { number: 1, labels: ['by:code-health', 'risk:low'], body: '', facets: { origin: 'code-health', grants: { build: false, merge: false }, needsDefinition: false } },
  ];
  const policy = { ceiling: 'unattended', grantOriginationEnabled: true };
  const trustRowsArray = [{ key: 'producer:code-health|low', verdict: 'clean' }];
  const results = computePhaseA({ candidates, policy, trustRowsArray });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].number, 1);
  assert.strictEqual(results[0].result.needsGrantCheck, true);
  assert.strictEqual(results[0].result.failedKey, null);
});

test('resolveSubIssueNumbers (body-text): reads every parent-issue body\'s own task list', () => {
  const runner = (args) => {
    assert.deepStrictEqual(args, ['issue', 'list', '--label', 'parent-issue', '--state', 'all', '--json', 'number,body', '--limit', '100']);
    return JSON.stringify([
      { number: 10, body: '- [ ] #11\n- [x] #12' },
      { number: 20, body: 'no sub-issues here' },
    ]);
  };
  const nums = resolveSubIssueNumbers({ workLinks: 'body-text', limit: 100, runner });
  assert.deepStrictEqual(Array.from(nums).sort((a, b) => a - b), [11, 12]);
});

test('resolveSubIssueNumbers (native): batches fetchNativeSubIssues and REST-retries anything the batch could not resolve', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === 'issue') {
      return JSON.stringify([{ number: 10 }, { number: 20 }]);
    }
    if (args[0] === 'api' && args[1] === 'graphql') {
      const q = args.find((a) => a.startsWith('query='));
      if (q.includes('__type')) return JSON.stringify({ data: { __type: { fields: [{ name: 'subIssues' }] } } });
      return JSON.stringify({
        data: {
          repository: {
            i10: { number: 10, subIssues: { nodes: [{ number: 11 }], pageInfo: { hasNextPage: false } } },
            i20: { number: 20, subIssues: { nodes: [], pageInfo: { hasNextPage: true } } }, // truncated page -> retry
          },
        },
      });
    }
    if (args[0] === 'api' && args[1] === '--paginate') {
      assert.match(args[2], /issues\/20\/sub_issues$/);
      return '21\n22\n';
    }
    throw new Error(`unexpected call: ${JSON.stringify(args)}`);
  };
  const nums = resolveSubIssueNumbers({ workLinks: 'native', limit: 100, runner, owner: 'o', repo: 'r' });
  assert.deepStrictEqual(Array.from(nums).sort((a, b) => a - b), [11, 21, 22]);
});

// #2240: the REST retry call for a truncated batch page threads --hostname
// for a GitHub Enterprise Server host — same pattern fetch-sub-issues.js's
// own REST retry loop already applies. The batched GraphQL probe/query call
// is unchanged (matches that file's scope).
test('#2240: resolveSubIssueNumbers (native) passes --hostname on the REST retry for a non-github.com host', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === 'issue') return JSON.stringify([{ number: 20 }]);
    if (args[0] === 'api' && args[1] === 'graphql') {
      const q = args.find((a) => a.startsWith('query='));
      if (q.includes('__type')) return JSON.stringify({ data: { __type: { fields: [{ name: 'subIssues' }] } } });
      return JSON.stringify({ data: { repository: { i20: { number: 20, subIssues: { nodes: [], pageInfo: { hasNextPage: true } } } } } });
    }
    if (args[0] === 'api' && args[1] === '--paginate') return '21\n';
    throw new Error(`unexpected call: ${JSON.stringify(args)}`);
  };
  resolveSubIssueNumbers({
    workLinks: 'native', limit: 100, runner, owner: 'o', repo: 'r', host: 'ghe.example.com',
  });
  const retryCall = calls.find((a) => a[0] === 'api' && a[1] === '--paginate');
  assert.deepEqual(retryCall.slice(-2), ['--hostname', 'ghe.example.com']);
  const graphqlCall = calls.find((a) => a[0] === 'api' && a[1] === 'graphql' && a.some((v) => typeof v === 'string' && v.startsWith('query=') && !v.includes('__type')));
  assert.doesNotMatch(graphqlCall.join(' '), /--hostname/);
});

test('#2240: resolveSubIssueNumbers (native) omits --hostname for github.com or no host', () => {
  const runner = (args) => {
    if (args[0] === 'issue') return JSON.stringify([{ number: 20 }]);
    if (args[0] === 'api' && args[1] === 'graphql') {
      const q = args.find((a) => a.startsWith('query='));
      if (q.includes('__type')) return JSON.stringify({ data: { __type: { fields: [{ name: 'subIssues' }] } } });
      return JSON.stringify({ data: { repository: { i20: { number: 20, subIssues: { nodes: [], pageInfo: { hasNextPage: true } } } } } });
    }
    if (args[0] === 'api' && args[1] === '--paginate') { assert.doesNotMatch(args.join(' '), /--hostname/); return '21\n'; }
    throw new Error(`unexpected call: ${JSON.stringify(args)}`);
  };
  resolveSubIssueNumbers({
    workLinks: 'native', limit: 100, runner, owner: 'o', repo: 'r', host: 'github.com',
  });
});

// #4505 fix round 1: the parent-issue list reads cwd's own repo (`runner`); the
// owner/repo-addressed probe, batch and REST retry go through `nativeRunner`,
// where the CLI pins an explicit --repo's host.
test('#4505: resolveSubIssueNumbers (native) sends only the owner/repo calls through nativeRunner', () => {
  const plain = [];
  const native = [];
  const answer = (args) => {
    if (args[0] === 'issue') return JSON.stringify([{ number: 20 }]);
    if (args[0] === 'api' && args[1] === 'graphql') {
      const q = args.find((a) => a.startsWith('query='));
      if (q.includes('__type')) return JSON.stringify({ data: { __type: { fields: [{ name: 'subIssues' }] } } });
      return JSON.stringify({ data: { repository: { i20: { number: 20, subIssues: { nodes: [], pageInfo: { hasNextPage: true } } } } } });
    }
    if (args[0] === 'api' && args[1] === '--paginate') return '21\n';
    throw new Error(`unexpected call: ${JSON.stringify(args)}`);
  };
  const nums = resolveSubIssueNumbers({
    workLinks: 'native', limit: 100, owner: 'o', repo: 'r',
    runner: (args) => { plain.push(args.slice(0, 2).join(' ')); return answer(args); },
    nativeRunner: (args) => { native.push(args.slice(0, 2).join(' ')); return answer(args); },
  });
  assert.deepStrictEqual(Array.from(nums), [21]);
  assert.deepStrictEqual(plain, ['issue list']);
  assert.deepStrictEqual(native, ['api graphql', 'api graphql', 'api --paginate']);
});

// --- computeOutlook: the full Step 0 -> Step 2 Phase A pipeline ---

// computeOutlook's three gh fetches, keyed by args[3]. There is deliberately
// no `--state open` case: the open-issue set the Blocked-by filter reads is
// derived from the `--state all` rows' own `state` field, never a second fetch.
function ghRunner({ candidates = [], records = [], parents = [] }) {
  return (args) => {
    if (args[3] === 'ready') return JSON.stringify(candidates);
    if (args[3] === 'parent-issue') return JSON.stringify(parents);
    if (args[3] === 'all') return JSON.stringify(records);
    throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
  };
}

test('computeOutlook: ceiling gate not satisfied short-circuits before any fetch', () => {
  const out = computeOutlook({ ceiling: 'supervised', grantOriginationEnabled: false }, {});
  assert.strictEqual(out.shortcut, 'ceiling-gate');
  assert.deepStrictEqual(out.candidates, []);
  assert.deepStrictEqual(out.eligible, []);
});

test('computeOutlook: ceiling clears but zero candidates are eligible -> zero-eligible shortcut with the refusal breakdown', () => {
  const candidates = [issue(1, { labels: ['by:code-health', 'ready', 'risk:low'] })];
  // No closed records at all -> every class reads no-cell -> refused under 'trust'.
  const runner = ghRunner({ candidates });
  const gitRunner = () => '';
  const out = computeOutlook(
    { ceiling: 'unattended', grantOriginationEnabled: true, windowDays: 14 },
    { limit: 100, workLinks: 'body-text', integrationBranch: 'main', runner, gitRunner },
  );
  assert.strictEqual(out.shortcut, 'zero-eligible');
  assert.deepStrictEqual(out.eligible, []);
  assert.deepStrictEqual(out.refused, { trust: [1] });
});

test('computeOutlook: a clean-trust class produces an eligible candidate (matches machineGrantOutlook, same data)', () => {
  const candidates = [issue(1, { labels: ['by:code-health', 'ready', 'risk:low'] })];
  // 8 closed, approved, non-batch records in the same class -> clean cell
  // (trust.js: MIN_SAMPLES=8, MIN_VERDICTS=5, no changesRequested/negativeEvidence/followUps).
  const records = Array.from({ length: 8 }, (_, i) => issue(100 + i, {
    labels: ['by:code-health', 'risk:low', 'demo:approved'], state: 'CLOSED', closedAt: CLOSED_20_DAYS_AGO,
  }));
  const runner = ghRunner({ candidates, records });
  const gitRunner = () => '';
  const out = computeOutlook(
    { ceiling: 'unattended', grantOriginationEnabled: true, windowDays: 14 },
    { limit: 100, workLinks: 'body-text', integrationBranch: 'main', runner, gitRunner },
  );
  assert.strictEqual(out.shortcut, null);
  assert.deepStrictEqual(out.eligible, [1]);
  assert.deepStrictEqual(out.refused, {});
  assert.strictEqual(out.trustRows.find((r) => r.key === 'producer:code-health|low').verdict, 'clean');
  assert.strictEqual(out.phaseA[0].result.needsGrantCheck, true);
});

test('computeOutlook: a sub-issue is excluded from trustRows\' cell totals (never counted as ungraded evidence)', () => {
  const candidates = [issue(1, { labels: ['by:code-health', 'ready', 'risk:low'] })];
  // 8 real closed+approved records, plus one decomposed sub-issue that would
  // otherwise dilute/undercount the same cell if it weren't excluded.
  const graded = Array.from({ length: 8 }, (_, i) => issue(100 + i, {
    labels: ['by:code-health', 'risk:low', 'demo:approved'], state: 'CLOSED', closedAt: CLOSED_20_DAYS_AGO,
  }));
  const subIssue = issue(200, { labels: ['by:code-health', 'risk:low'], state: 'CLOSED', closedAt: CLOSED_20_DAYS_AGO });
  const records = [...graded, subIssue];
  const parents = [{ number: 300, body: '- [ ] #200' }];
  const runner = ghRunner({ candidates, records, parents });
  const gitRunner = () => '';
  const out = computeOutlook(
    { ceiling: 'unattended', grantOriginationEnabled: true, windowDays: 14 },
    { limit: 100, workLinks: 'body-text', integrationBranch: 'main', runner, gitRunner },
  );
  const row = out.trustRows.find((r) => r.key === 'producer:code-health|low');
  assert.strictEqual(row.total, 8); // #200 excluded — hasParent: true
  assert.strictEqual(row.verdict, 'clean');
  assert.deepStrictEqual(out.eligible, [1]);
});

// --- #4793: a body-declared foreign blocker ('Blocked by owner/name#N') blocks the pre-pass ---

const FOREIGN_LABELS = ['by:code-health', 'ready'];

test('#4793: filterCandidates drops a candidate whose foreign blocker is OPEN or unreadable, keeps a CLOSED one, and rejects a missing map', () => {
  const issues = [
    issue(7, { labels: FOREIGN_LABELS, body: 'Blocked by other/repo#7' }),
    issue(8, { labels: FOREIGN_LABELS, body: 'Blocked by other/repo#8' }),
    issue(9, { labels: FOREIGN_LABELS, body: 'Blocked by other/repo#9' }),
  ];
  const foreign = new Map([
    [7, [{ number: 7, repository: 'other/repo', state: 'OPEN' }]],
    [8, [{ number: 8, repository: 'other/repo', state: null }]],
    [9, [{ number: 9, repository: 'other/repo', state: 'CLOSED' }]],
  ]);
  assert.deepStrictEqual(filterCandidates(issues, new Set(), foreign).map((c) => c.number), [9]);
  assert.deepStrictEqual(filterCandidates(issues, new Set(), new Map()).map((c) => c.number), [7, 8, 9]);
  assert.throws(() => filterCandidates(issues, new Set()), { name: 'TypeError', message: /foreignByRecord must be a Map/ });
  assert.throws(() => filterCandidates(issues, new Set(), {}), { name: 'TypeError', message: /foreignByRecord must be a Map/ });
});

test('#4793: a foreign blocker never collides with this repository\'s same bare number', () => {
  const rec = issue(1, { labels: FOREIGN_LABELS, body: 'Blocked by #7\nBlocked by other/repo#7' });
  const closed = new Map([[1, [{ number: 7, repository: 'other/repo', state: 'CLOSED' }]]]);
  const open = new Map([[1, [{ number: 7, repository: 'other/repo', state: 'OPEN' }]]]);
  // This-repo #7 open, foreign other/repo#7 CLOSED: blocked by the local one only.
  assert.deepStrictEqual(filterCandidates([rec], new Set([7]), closed), []);
  // This-repo #7 not open, foreign other/repo#7 OPEN: blocked by the foreign one only.
  assert.deepStrictEqual(filterCandidates([rec], new Set(), open), []);
  // Neither blocks: this-repo #7 not open, foreign other/repo#7 CLOSED.
  assert.deepStrictEqual(filterCandidates([rec], new Set(), closed).map((c) => c.number), [1]);
});

function foreignOutlook(candidates, foreignDeps) {
  return computeOutlook(
    { ceiling: 'unattended', grantOriginationEnabled: true, windowDays: 14 },
    {
      limit: 100, workLinks: 'body-text', integrationBranch: 'main', runner: ghRunner({ candidates }), gitRunner: () => '', foreignDeps,
    },
  );
}

test('#4793: computeOutlook makes one batched foreign state lookup for several candidates, and none when no candidate declares a foreign ref', () => {
  const spawned = [];
  const spawn = (argv) => {
    spawned.push(argv);
    return { status: 0, stdout: '{"other/repo#1":"OPEN","acme/x#2":"CLOSED"}\n' };
  };
  const out = foreignOutlook([
    issue(1, { labels: FOREIGN_LABELS, body: 'Blocked by other/repo#1' }),
    issue(2, { labels: FOREIGN_LABELS, body: 'Blocked by acme/x#2' }),
    issue(3, { labels: FOREIGN_LABELS, body: 'Blocked by #50' }),
  ], { spawn, stderr: () => {} });
  assert.strictEqual(spawned.length, 1);
  assert.deepStrictEqual(out.candidates.map((c) => c.number), [2, 3]);

  const none = [];
  const plain = foreignOutlook([issue(1, { labels: FOREIGN_LABELS }), issue(2, { labels: FOREIGN_LABELS, body: 'Blocked by #50' })], {
    spawn: (argv) => { none.push(argv); return { status: 0, stdout: '{}\n' }; },
    stderr: () => {},
  });
  assert.strictEqual(none.length, 0);
  assert.deepStrictEqual(plain.candidates.map((c) => c.number), [1, 2]);
});

test('#4793: computeOutlook looks up only the foreign refs of candidates that survive the cheap label filters', () => {
  const spawned = [];
  const out = foreignOutlook([
    issue(1, { labels: ['ready'], body: 'Blocked by dropped/human#1' }), // human-filed, dropped before the lookup
    issue(2, { labels: [...FOREIGN_LABELS, 'auto:build'], body: 'Blocked by dropped/granted#2' }), // already granted
    issue(3, { labels: FOREIGN_LABELS, body: 'Blocked by kept/repo#3' }),
  ], { spawn: (argv) => { spawned.push(argv); return { status: 0, stdout: '{"kept/repo#3":"CLOSED"}\n' }; }, stderr: () => {} });
  assert.strictEqual(spawned.length, 1);
  assert.strictEqual(spawned[0][1], 'kept/repo#3');
  assert.deepStrictEqual(out.candidates.map((c) => c.number), [3]);
});

test('#4793: a candidate already blocked by an open this-repository #N makes no foreign lookup, even when its body also declares a foreign ref', () => {
  const spawned = [];
  const out = computeOutlook(
    { ceiling: 'unattended', grantOriginationEnabled: true, windowDays: 14 },
    {
      limit: 100,
      workLinks: 'body-text',
      integrationBranch: 'main',
      runner: ghRunner({
        candidates: [issue(1, { labels: FOREIGN_LABELS, body: 'Blocked by #50\nBlocked by other/repo#9' })],
        records: [issue(50, { state: 'OPEN' })],
      }),
      gitRunner: () => '',
      foreignDeps: { spawn: (argv) => { spawned.push(argv); return { status: 0, stdout: '{}\n' }; }, stderr: () => {} },
    },
  );
  assert.deepStrictEqual(out.candidates, []);
  assert.strictEqual(spawned.length, 0);
});

test('#4793: computeOutlook fails closed on a failing lookup: the candidate is excluded and one Warning line reaches stderr', () => {
  const warnings = [];
  const out = foreignOutlook(
    [issue(1, { labels: FOREIGN_LABELS, body: 'Blocked by other/repo#1' })],
    { spawn: () => ({ status: 1, stdout: '', stderr: 'boom' }), stderr: (s) => warnings.push(s) },
  );
  assert.deepStrictEqual(out.candidates, []);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /^Warning: /);
});
