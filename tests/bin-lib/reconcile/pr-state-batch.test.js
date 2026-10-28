'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  buildBatchQuery, parseBatchResponse, fetchBatch, BATCH_CHUNK,
} = require('../../../plugin/bin/lib/reconcile/pr-state-batch');
const { prClosesIssue } = require('../../../plugin/bin/lib/reconcile/release-merged');

// Real response shapes from the 2026-10-24 live read-only probe (#4032 Task 4c).
const MERGED_3992 = {
  number: 3992,
  state: 'MERGED',
  mergedAt: '2026-10-24T16:42:21Z',
  updatedAt: '2026-10-24T16:42:21Z',
  mergeCommit: { oid: '6510874174729159ee6f724f746a5c5dd208843a' },
  closingIssuesReferences: {
    nodes: [{ number: 3816, repository: { name: 'claude-tweaks', owner: { login: 'thn-inc' } } }],
    pageInfo: { hasNextPage: false },
  },
  mergeable: 'UNKNOWN',
  mergeStateStatus: 'UNKNOWN',
};
const OPEN_4145 = {
  number: 4145,
  state: 'OPEN',
  mergedAt: null,
  updatedAt: '2026-10-24T17:00:00Z',
  mergeCommit: null,
  closingIssuesReferences: { nodes: [], pageInfo: { hasNextPage: false } },
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
};
const headNode = (number, state, updatedAt, mergedAt = null) => ({
  number,
  state,
  mergedAt,
  updatedAt,
  mergeCommit: state === 'MERGED' ? { oid: 'a'.repeat(40) } : null,
  closingIssuesReferences: { nodes: [], pageInfo: { hasNextPage: false } },
});
const body = (repository, errors) => JSON.stringify(errors ? { data: { repository }, errors } : { data: { repository } });

test('buildBatchQuery: aliases, typed variables, escaped heads', () => {
  const q = buildBatchQuery({ numbers: [4145], heads: ['a"b'] });
  assert.ok(q.includes('n0: pullRequest(number:4145)'), q);
  assert.ok(q.includes('h0: pullRequests(headRefName:"a\\"b", first:10, states:[OPEN,CLOSED,MERGED], orderBy:{field:CREATED_AT,direction:DESC})'), q);
  assert.ok(q.includes('$owner:String!,$name:String!'), q);
  assert.ok(q.includes('repository(owner:$owner,name:$name)'), q);
  assert.ok(!q.includes('thn-inc') && !q.includes('claude-tweaks'), 'owner/repo travel as variables, never spliced');
  assert.ok(q.includes('mergeable mergeStateStatus'), 'by-number selection carries the merge fields');
  assert.ok(q.includes('closingIssuesReferences(first:20)'), q);
});

test('#3977 buildBatchQuery selects isDraft and parseBatchResponse carries it', () => {
  const q = buildBatchQuery({ numbers: [4145], heads: ['x'] });
  assert.ok(q.includes('number state isDraft mergedAt'), q);
  const { byNumber } = parseBatchResponse(body({ n0: { ...OPEN_4145, isDraft: true } }), { numbers: [4145], heads: [] });
  assert.equal(byNumber.get(4145).isDraft, true);
});

test('buildBatchQuery: a non-integer number is never spliced into the query', () => {
  const q = buildBatchQuery({ numbers: ['1) { x } #', 7], heads: [] });
  assert.ok(!q.includes('x }'), q);
  assert.ok(q.includes('pullRequest(number:7)'), q);
});

test('parseBatchResponse: reshapes a merged PR like gh pr view', () => {
  const { byNumber } = parseBatchResponse(body({ n0: MERGED_3992 }), { numbers: [3992], heads: [] });
  const want = {
    ...MERGED_3992,
    isDraft: false,
    closingIssuesReferences: [{ number: 3816, repository: { name: 'claude-tweaks', owner: { login: 'thn-inc' } } }],
  };
  assert.deepEqual(byNumber.get(3992), want);
  assert.equal(prClosesIssue(byNumber.get(3992), 3816, 'thn-inc/claude-tweaks'), true);
});

test('parseBatchResponse: head with no PRs is null, head picks merged-wins', () => {
  const stdout = body({
    h0: { nodes: [], pageInfo: { hasNextPage: false } },
    h1: {
      nodes: [
        headNode(11, 'OPEN', '2026-10-24T12:00:00Z'),
        headNode(10, 'MERGED', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z'),
      ],
      pageInfo: { hasNextPage: false },
    },
  });
  const { byHead } = parseBatchResponse(stdout, { numbers: [], heads: ['none', 'both'] });
  assert.equal(byHead.has('none'), true);
  assert.equal(byHead.get('none'), null);
  const picked = byHead.get('both');
  assert.equal(picked.number, 10);
  assert.equal(picked.state, 'MERGED');
  assert.deepEqual(picked.closingIssuesReferences, []);
  assert.equal('mergeable' in picked, false, 'a head answer matches gh pr list --head, which has no merge fields');
});

test('parseBatchResponse: two MERGED nodes given newest-created-first -> the first wins (gh pr list order)', () => {
  const stdout = body({
    h0: {
      nodes: [
        headNode(20, 'MERGED', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z'),
        headNode(19, 'MERGED', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      ],
      pageInfo: { hasNextPage: false },
    },
  });
  assert.equal(parseBatchResponse(stdout, { numbers: [], heads: ['reused'] }).byHead.get('reused').number, 20);
});

test('parseBatchResponse: head without a merged PR picks the most recently updated', () => {
  const stdout = body({
    h0: {
      nodes: [headNode(1, 'CLOSED', '2026-01-01T00:00:00Z'), headNode(2, 'OPEN', '2026-03-01T00:00:00Z')],
      pageInfo: { hasNextPage: false },
    },
  });
  assert.equal(parseBatchResponse(stdout, { numbers: [], heads: ['x'] }).byHead.get('x').number, 2);
});

test('parseBatchResponse: a NOT_FOUND alias is absent, the rest survive', () => {
  const stdout = body({ n0: null, n1: OPEN_4145 }, [
    { type: 'NOT_FOUND', path: ['repository', 'n0'], message: 'Could not resolve to a PullRequest with the number of 4032.' },
  ]);
  const { byNumber } = parseBatchResponse(stdout, { numbers: [4032, 4145], heads: [] });
  assert.equal(byNumber.has(4032), false);
  assert.equal(byNumber.get(4145).state, 'OPEN');
  assert.equal(byNumber.get(4145).mergeable, 'MERGEABLE');
});

test('parseBatchResponse: any other error empties the result', () => {
  const stdout = body({ n0: OPEN_4145 }, [{ type: 'FORBIDDEN', path: ['repository'], message: 'nope' }]);
  const out = parseBatchResponse(stdout, { numbers: [4145], heads: [] });
  assert.equal(out.byNumber.size, 0);
  assert.equal(out.byHead.size, 0);
  // A NOT_FOUND at a path that is not one of this query's aliases is also "other".
  const stray = body({ n0: OPEN_4145 }, [{ type: 'NOT_FOUND', path: ['repository', 'n9'] }]);
  assert.equal(parseBatchResponse(stray, { numbers: [4145], heads: [] }).byNumber.size, 0);
  // A NOT_FOUND on the repository itself is not an alias miss.
  const repoGone = body({ n0: OPEN_4145 }, [{ type: 'NOT_FOUND', path: ['repository'] }]);
  assert.equal(parseBatchResponse(repoGone, { numbers: [4145], heads: [] }).byNumber.size, 0);
});

test('parseBatchResponse: unparseable stdout and a missing repository empty the result', () => {
  for (const stdout of ['', 'not json', '{"data":{"repository":null}}', '{"data":null}', '{}', 'null']) {
    const out = parseBatchResponse(stdout, { numbers: [1], heads: ['h'] });
    assert.equal(out.byNumber.size + out.byHead.size, 0, `stdout ${JSON.stringify(stdout)}`);
  }
});

test('parseBatchResponse: a truncated page is absent', () => {
  const truncatedRefs = { ...OPEN_4145, closingIssuesReferences: { nodes: [], pageInfo: { hasNextPage: true } } };
  const stdout = body({
    n0: truncatedRefs,
    n1: OPEN_4145,
    h0: { nodes: [headNode(1, 'OPEN', '2026-01-01T00:00:00Z')], pageInfo: { hasNextPage: true } },
    h1: { nodes: [], pageInfo: { hasNextPage: false } },
  });
  const { byNumber, byHead } = parseBatchResponse(stdout, { numbers: [900, 4145], heads: ['more', 'empty'] });
  assert.equal(byNumber.has(900), false);
  assert.equal(byNumber.has(4145), true);
  assert.equal(byHead.has('more'), false);
  assert.equal(byHead.get('empty'), null);
});

test('parseBatchResponse: a governing head PR with truncated closing refs makes the head absent', () => {
  const node = headNode(5, 'MERGED', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');
  node.closingIssuesReferences = { nodes: [], pageInfo: { hasNextPage: true } };
  const stdout = body({ h0: { nodes: [node], pageInfo: { hasNextPage: false } } });
  assert.equal(parseBatchResponse(stdout, { numbers: [], heads: ['x'] }).byHead.has('x'), false);
});

test('parseBatchResponse: a missing alias and a missing pageInfo are absent', () => {
  const noPage = { ...OPEN_4145, closingIssuesReferences: { nodes: [] } };
  const { byNumber } = parseBatchResponse(body({ n1: noPage }), { numbers: [1, 4145], heads: [] });
  assert.equal(byNumber.size, 0);
});

// ---- fetchBatch ----

const SLUG_REPO = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-pr-state-batch-'));
  execFileSync('git', ['init', '-q'], { cwd: dir, windowsHide: true });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/thn-inc/claude-tweaks.git'], { cwd: dir, windowsHide: true });
  return dir;
})();

function aliasCount(query) {
  return (query.match(/\b[nh]\d+:/g) || []).length;
}

test('fetchBatch: 120 keys make 3 chunks, pass typed -f variables, and a failed chunk leaves only its keys absent', async () => {
  const numbers = Array.from({ length: 70 }, (_, i) => 1000 + i);
  const heads = Array.from({ length: 50 }, (_, i) => `feat-${i}`);
  const calls = [];
  const runner = async (args) => {
    calls.push(args);
    const query = args[args.length - 1];
    const repo = {};
    for (const m of query.matchAll(/n(\d+): pullRequest\(number:(\d+)\)/g)) repo[`n${m[1]}`] = { ...OPEN_4145, number: Number(m[2]) };
    for (const m of query.matchAll(/h(\d+): pullRequests/g)) repo[`h${m[1]}`] = { nodes: [], pageInfo: { hasNextPage: false } };
    if (calls.length === 2) throw new Error('chunk 2 exploded');
    return JSON.stringify({ data: { repository: repo } });
  };
  const out = await fetchBatch(SLUG_REPO, { numbers, heads }, { runner });
  assert.equal(calls.length, 3);
  for (const args of calls) {
    assert.deepEqual(args.slice(0, 4), ['api', 'graphql', '--hostname', 'github.com'], 'pinned to github.com so GH_HOST cannot redirect the query');
    assert.ok(args.includes('owner=thn-inc') && args.includes('name=claude-tweaks'), args.join(' '));
    assert.equal(args.filter((a) => a === '-F').length, 0, 'String! variables travel with -f, never -F');
    const query = args[args.length - 1];
    assert.ok(query.startsWith('query='), query.slice(0, 20));
    assert.ok(aliasCount(query) <= BATCH_CHUNK);
  }
  assert.equal(out.byNumber.size + out.byHead.size, 120 - 50, 'the failed chunk (50 keys) is the only absence');
});

test('fetchBatch: reads the body off a rejection that carries stdout (gh exits 1 with errors present)', async () => {
  const runner = async () => {
    const e = new Error('exit 1');
    e.stdout = body({ n0: null, n1: OPEN_4145 }, [{ type: 'NOT_FOUND', path: ['repository', 'n0'] }]);
    throw e;
  };
  const out = await fetchBatch(SLUG_REPO, { numbers: [4032, 4145], heads: [] }, { runner });
  assert.equal(out.byNumber.has(4032), false);
  assert.equal(out.byNumber.get(4145).state, 'OPEN');
});

test('fetchBatch: no keys spawns nothing; no origin slug returns empty maps without spawning', async () => {
  let spawned = 0;
  const runner = async () => { spawned += 1; return '{}'; };
  const none = await fetchBatch(SLUG_REPO, { numbers: [], heads: [] }, { runner });
  assert.equal(none.byNumber.size + none.byHead.size, 0);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-pr-state-batch-bare-'));
  execFileSync('git', ['init', '-q'], { cwd: bare, windowsHide: true });
  const noSlug = await fetchBatch(bare, { numbers: [1], heads: ['b'] }, { runner });
  assert.equal(noSlug.byNumber.size + noSlug.byHead.size, 0);
  assert.equal(spawned, 0);
});

test('fetchBatch: an origin off github.com (or unparseable) makes zero runner calls', async () => {
  for (const url of ['https://ghe.example.com/thn-inc/claude-tweaks.git', 'git@ghe.example.com:thn-inc/claude-tweaks.git', 'ssh://git@github.com/thn-inc/claude-tweaks.git']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-pr-state-batch-host-'));
    execFileSync('git', ['init', '-q'], { cwd: dir, windowsHide: true });
    execFileSync('git', ['remote', 'add', 'origin', url], { cwd: dir, windowsHide: true });
    let spawned = 0;
    const out = await fetchBatch(dir, { numbers: [1], heads: ['b'] }, { runner: async () => { spawned += 1; return '{}'; } });
    assert.equal(spawned, 0, url);
    assert.equal(out.byNumber.size + out.byHead.size, 0, url);
  }
  // Control: an ssh-form github.com origin still batches.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-pr-state-batch-host-'));
  execFileSync('git', ['init', '-q'], { cwd: dir, windowsHide: true });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: dir, windowsHide: true });
  const seen = [];
  await fetchBatch(dir, { numbers: [1], heads: [] }, { runner: async (args) => { seen.push(args); return '{}'; } });
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes('owner=acme') && seen[0].includes('name=w'));
});

test('fetchBatch: never throws, even when the runner throws synchronously or returns garbage', async () => {
  const sync = await fetchBatch(SLUG_REPO, { numbers: [1], heads: [] }, { runner: () => { throw new Error('sync'); } });
  assert.equal(sync.byNumber.size, 0);
  const garbage = await fetchBatch(SLUG_REPO, { numbers: [1], heads: [] }, { runner: async () => 'garbage' });
  assert.equal(garbage.byNumber.size, 0);
});

test('fetchBatch: at most 4 chunks run at once', async () => {
  const numbers = Array.from({ length: BATCH_CHUNK * 7 }, (_, i) => i + 1);
  let inFlight = 0;
  let peak = 0;
  const runner = async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight -= 1;
    return '{}';
  };
  await fetchBatch(SLUG_REPO, { numbers, heads: [] }, { runner });
  assert.equal(peak, 4);
});
