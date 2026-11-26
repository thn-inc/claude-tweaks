'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRecordCommentsQuery, fetchRecordComments } = require('../../../plugin/bin/lib/issues/record-comments');

const resp = (repository) => JSON.stringify({ data: { repository } });
const node = (body, assoc = 'MEMBER') => ({ body, authorAssociation: assoc, url: 'https://github.com/o/r/issues/1#c1', author: { login: 'tom' } });

test('buildRecordCommentsQuery: null for an empty list, one aliased issue per number otherwise', () => {
  assert.equal(buildRecordCommentsQuery([]), null);
  const q = buildRecordCommentsQuery([11, 22]);
  assert.match(q, /query\(\$owner:String!,\$repo:String!\)/);
  assert.match(q, /i11: issue\(number: ?11\)/);
  assert.match(q, /i22: issue\(number: ?22\)/);
  assert.match(q, /comments\(last: ?100\)/);
  assert.match(q, /totalCount/);
  assert.match(q, /body authorAssociation url author ?\{ ?login ?\}/);
});

test('fetchRecordComments: a complete record keeps the comment nodes verbatim; an over-100 record is incomplete', () => {
  const marker = node('<!-- driver-escalation -->', 'MEMBER');
  const runner = () => resp({
    i11: { comments: { totalCount: 1, nodes: [marker] } },
    i22: { comments: { totalCount: 150, nodes: Array.from({ length: 100 }, () => node('x')) } },
  });
  const out = fetchRecordComments({ numbers: [11, 22], owner: 'o', repo: 'r', runner });
  assert.deepEqual(out.get(11), { comments: [marker], complete: true });
  assert.equal(out.get(22).complete, false);
  assert.equal(out.get(22).comments.length, 100);
});

test('fetchRecordComments: a missing alias leaves that number out of the Map', () => {
  const runner = () => resp({ i11: { comments: { totalCount: 0, nodes: [] } }, i22: null });
  const out = fetchRecordComments({ numbers: [11, 22], owner: 'o', repo: 'r', runner });
  assert.equal(out.has(11), true);
  assert.equal(out.has(22), false);
  assert.deepEqual(out.get(11), { comments: [], complete: true });
});

test('fetchRecordComments: a null repository throws, naming the numbers', () => {
  const runner = () => resp(null);
  assert.throws(() => fetchRecordComments({ numbers: [11, 22], owner: 'o', repo: 'r', runner }), /#11, #22/);
});

test('fetchRecordComments: argv carries -f owner= and -f repo=, --hostname only for a GHE host', () => {
  const seen = [];
  const runner = (args) => { seen.push(args); return resp({ i1: { comments: { totalCount: 0, nodes: [] } } }); };
  fetchRecordComments({ numbers: [1], owner: 'o', repo: 'r', runner });
  fetchRecordComments({ numbers: [1], owner: 'o', repo: 'r', host: 'github.com', runner });
  fetchRecordComments({ numbers: [1], owner: 'o', repo: 'r', host: 'ghe.example.com', runner });
  for (const args of seen) {
    assert.deepEqual(args.slice(0, 2), ['api', 'graphql']);
    assert.ok(args.includes('owner=o') && args[args.indexOf('owner=o') - 1] === '-f');
    assert.ok(args.includes('repo=r') && args[args.indexOf('repo=r') - 1] === '-f');
  }
  assert.equal(seen[0].includes('--hostname'), false);
  assert.equal(seen[1].includes('--hostname'), false);
  assert.deepEqual(seen[2].slice(-2), ['--hostname', 'ghe.example.com']);
});

test('fetchRecordComments: an empty number list makes no call', () => {
  const out = fetchRecordComments({ numbers: [], owner: 'o', repo: 'r', runner: () => { throw new Error('no call'); } });
  assert.equal(out.size, 0);
});
