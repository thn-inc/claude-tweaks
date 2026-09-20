// tests/bin-lib/reconcile/issue-list-cache.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createIssueListCache } = require('../../../plugin/bin/lib/reconcile/issue-list-cache');

function countingBase(respond) {
  const calls = [];
  const base = (argv) => {
    calls.push(argv);
    return respond(argv);
  };
  return { base, calls };
}

test('createIssueListCache: two issue-list calls for the same repo hit base exactly once', () => {
  const { base, calls } = countingBase(() => '[]');
  const { runner } = createIssueListCache({ base });
  const argv = ['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'number,title,body,createdAt,state', '--limit', '10000'];
  const first = runner(argv);
  const second = runner(argv);
  assert.equal(calls.length, 1, 'the second call must be served from the memo, not re-fetched');
  assert.equal(first, '[]');
  assert.equal(second, '[]');
});

test('createIssueListCache: two different repos each get their own base call', () => {
  const { base, calls } = countingBase(() => '[]');
  const { runner } = createIssueListCache({ base });
  runner(['issue', 'list', '--repo', 'o/r1', '--state', 'all', '--json', 'x', '--limit', '10000']);
  runner(['issue', 'list', '--repo', 'o/r2', '--state', 'all', '--json', 'x', '--limit', '10000']);
  runner(['issue', 'list', '--repo', 'o/r1', '--state', 'all', '--json', 'x', '--limit', '10000']);
  assert.equal(calls.length, 2, 'one base call per distinct repo, memoized on the repeat');
  assert.deepEqual(calls.map((c) => c[c.indexOf('--repo') + 1]), ['o/r1', 'o/r2']);
});

test('createIssueListCache: a non-issue-list argv always passes through, never memoized', () => {
  const { base, calls } = countingBase(() => 'ok');
  const { runner } = createIssueListCache({ base });
  runner(['issue', 'create', '--repo', 'o/r', '--title', 't', '--body', 'b']);
  runner(['issue', 'create', '--repo', 'o/r', '--title', 't', '--body', 'b']);
  assert.equal(calls.length, 2, 'writes must never be memoized');
});

test('createIssueListCache: a base throw is never cached — the next call for the same repo retries', () => {
  let attempt = 0;
  const base = () => {
    attempt += 1;
    if (attempt === 1) throw new Error('gh: rate limited');
    return '[]';
  };
  const { runner } = createIssueListCache({ base });
  const argv = ['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'x', '--limit', '10000'];
  assert.throws(() => runner(argv));
  const result = runner(argv);
  assert.equal(result, '[]');
  assert.equal(attempt, 2, 'the failed first attempt must not have been cached');
});

test('createIssueListCache: an issue-list argv missing --repo passes through uncached (defensive)', () => {
  const { base, calls } = countingBase(() => '[]');
  const { runner } = createIssueListCache({ base });
  runner(['issue', 'list', '--state', 'all']);
  runner(['issue', 'list', '--state', 'all']);
  assert.equal(calls.length, 2);
});

test('createIssueListCache: defaults `base` to the real gh runner when omitted (smoke)', () => {
  const { runner } = createIssueListCache();
  assert.equal(typeof runner, 'function');
});

// --- #2505 review fix: write-aware behavior --------------------------------
// The cache above memoizes the PARSED issue array and applies each write's
// effect to it locally, so a read-after-write within the same pass never
// serves a stale result. These tests are the regression-proof for the
// Critical finding: a stateless "memoize the raw string" cache broke
// escalateResidue's structurally-stuck consolidation (N simultaneous
// escalations filed N separate issues instead of one) and resolveResidue's
// resolve loop (a stale body resurrected already-removed paths, so a record
// never closed).

test('createIssueListCache: a create is visible in the SAME repo\'s next list read, with zero extra base list calls', () => {
  const listCalls = [];
  const base = (argv) => {
    if (argv[0] === 'issue' && argv[1] === 'list') { listCalls.push(argv); return '[]'; }
    if (argv[0] === 'issue' && argv[1] === 'create') return 'https://github.com/o/r/issues/42\n';
    throw new Error(`unexpected argv: ${JSON.stringify(argv)}`);
  };
  const { runner } = createIssueListCache({ base });

  const first = JSON.parse(runner(['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'x', '--limit', '10000']));
  assert.deepEqual(first, []);

  runner(['issue', 'create', '--repo', 'o/r', '--title', 't1', '--body', 'b1', '--label', 'bug']);

  const second = JSON.parse(runner(['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'x', '--limit', '10000']));
  assert.equal(second.length, 1, 'the just-created issue must be visible on the next read');
  assert.equal(second[0].number, 42);
  assert.equal(second[0].title, 't1');
  assert.equal(second[0].body, 'b1');
  assert.equal(second[0].state, 'OPEN');
  assert.equal(listCalls.length, 1, 'only the FIRST read should hit base — the create must not trigger a re-fetch');
});

test('createIssueListCache: an edit updates the entry\'s body, visible on the next read, without a base list call', () => {
  const base = (argv) => {
    if (argv[0] === 'issue' && argv[1] === 'list') return JSON.stringify([{ number: 7, title: 't', body: 'original', createdAt: '2026-01-01T00:00:00Z', state: 'OPEN' }]);
    if (argv[0] === 'issue' && argv[1] === 'edit') return '';
    throw new Error(`unexpected argv: ${JSON.stringify(argv)}`);
  };
  const { runner } = createIssueListCache({ base });

  runner(['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'x', '--limit', '10000']);
  runner(['issue', 'edit', '7', '--repo', 'o/r', '--body', 'updated body']);
  const after = JSON.parse(runner(['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'x', '--limit', '10000']));

  assert.equal(after[0].body, 'updated body');
});

test('createIssueListCache: close then reopen update state, visible on later reads', () => {
  const base = (argv) => {
    if (argv[0] === 'issue' && argv[1] === 'list') return JSON.stringify([{ number: 3, title: 't', body: 'b', createdAt: '2026-01-01T00:00:00Z', state: 'OPEN' }]);
    return '';
  };
  const { runner } = createIssueListCache({ base });

  runner(['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'x', '--limit', '10000']);
  runner(['issue', 'close', '3', '--repo', 'o/r']);
  let after = JSON.parse(runner(['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'x', '--limit', '10000']));
  assert.equal(after[0].state, 'CLOSED');

  runner(['issue', 'reopen', '3', '--repo', 'o/r']);
  after = JSON.parse(runner(['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'x', '--limit', '10000']));
  assert.equal(after[0].state, 'OPEN');
});

test('createIssueListCache: a comment never changes any entry\'s state or body', () => {
  const base = (argv) => {
    if (argv[0] === 'issue' && argv[1] === 'list') return JSON.stringify([{ number: 5, title: 't', body: 'b', createdAt: '2026-01-01T00:00:00Z', state: 'OPEN' }]);
    return '';
  };
  const { runner } = createIssueListCache({ base });

  runner(['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'x', '--limit', '10000']);
  runner(['issue', 'comment', '5', '--repo', 'o/r', '--body', 'a note']);
  const after = JSON.parse(runner(['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'x', '--limit', '10000']));

  assert.equal(after[0].body, 'b');
  assert.equal(after[0].state, 'OPEN');
});

test('createIssueListCache: an edit/close/reopen for an unknown issue number is a no-op, never throws', () => {
  const base = (argv) => {
    if (argv[0] === 'issue' && argv[1] === 'list') return '[]';
    return '';
  };
  const { runner } = createIssueListCache({ base });

  runner(['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'x', '--limit', '10000']);
  assert.doesNotThrow(() => runner(['issue', 'edit', '999', '--repo', 'o/r', '--body', 'x']));
  assert.doesNotThrow(() => runner(['issue', 'close', '999', '--repo', 'o/r']));
  const after = JSON.parse(runner(['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'x', '--limit', '10000']));
  assert.deepEqual(after, []);
});

test('createIssueListCache: a write for a repo never read is a no-op (nothing in the memo to update)', () => {
  const calls = [];
  const base = (argv) => { calls.push(argv); return argv[1] === 'list' ? '[]' : 'https://github.com/o/r/issues/1\n'; };
  const { runner } = createIssueListCache({ base });

  assert.doesNotThrow(() => runner(['issue', 'create', '--repo', 'o/r', '--title', 't', '--body', 'b']));
  assert.equal(calls.length, 1, 'the create itself still executes — only the memo update is skipped');
});

test('createIssueListCache: two separate instances never share state (no cross-pass reuse)', () => {
  const calls = [];
  const base = (argv) => { calls.push(argv); return '[]'; };
  const cache1 = createIssueListCache({ base });
  const cache2 = createIssueListCache({ base });
  const argv = ['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'x', '--limit', '10000'];

  cache1.runner(argv);
  cache2.runner(argv);

  assert.equal(calls.length, 2, 'a fresh instance must never inherit a prior instance\'s memo');
});
