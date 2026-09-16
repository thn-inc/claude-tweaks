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
