'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  FACTS_KEYS, FactsError, normalizeMcpFacts, requireIdempotenceReads,
} = require('../../../plugin/bin/lib/issues/mcp-parent-gate-shape');

// One MCP `issue_read` get result, written unreshaped: lowercase enums, label objects, snake_case.
const issue = (n, over = {}) => ({
  number: n, title: ` Title ${n} `, state: 'closed', state_reason: 'completed', labels: [{ name: 'risk:low' }], ...over,
});

// Parent 10 with sub-issues 11 and 12, as the agent would write it.
const mcpFacts = () => ({
  parentLink: { number: 10 },
  subIssueList: [{ number: 12 }, { number: 11 }, { number: 11 }],
  parentGet: issue(10, { state: 'open', state_reason: null, labels: [{ name: 'parent-issue' }, { name: 'needs:review' }] }),
  subIssueGets: {
    11: issue(11, { closed_by_pull_requests: [{ number: 40 }] }),
    12: issue(12, { state_reason: 'not_planned', closed_by_pull_requests: { references: [{ number: 41 }, { number: 42 }] } }),
  },
  parentComments: [
    { body: '## Closed below the oversight floor\n', user: { login: 'stranger' }, author_association: 'NONE', html_url: 'u-1' },
  ],
  me: { login: 'bot' },
});

// The same world as `gh --json` shapes it: uppercase enums, label names, camelCase.
const ghIssue = (n, over = {}) => ({
  number: n, title: ` Title ${n} `, state: 'CLOSED', stateReason: 'COMPLETED', labels: ['risk:low'], ...over,
});
const ghTwin = () => ({
  parentLink: { number: 10 },
  subIssueList: [{ number: 11 }, { number: 12 }],
  parentGet: ghIssue(10, { state: 'OPEN', stateReason: '', labels: ['parent-issue', 'needs:review'] }),
  subIssueGets: {
    11: ghIssue(11, { closedByPullRequestsReferences: [{ number: 40 }] }),
    12: ghIssue(12, { stateReason: 'NOT_PLANNED', closedByPullRequestsReferences: [{ number: 41 }, { number: 42 }] }),
  },
  parentComments: [
    {
      body: '## Closed below the oversight floor\n', author: { login: 'stranger' }, authorAssociation: 'NONE', url: 'u-1',
    },
  ],
  me: { login: 'bot' },
});

const NATIVE_PARENT = { parent: 10, workLinks: 'native' };

test('normalizes the MCP shape', () => {
  const { gate, idempotence } = normalizeMcpFacts(mcpFacts(), NATIVE_PARENT);
  assert.deepEqual(gate, {
    parent: 10,
    parentLabels: ['parent-issue', 'needs:review'],
    subIssues: [
      {
        number: 11, title: 'Title 11', state: 'CLOSED', stateReason: 'COMPLETED', labels: ['risk:low'], closedBy: [40],
      },
      {
        number: 12, title: 'Title 12', state: 'CLOSED', stateReason: 'NOT_PLANNED', labels: ['risk:low'], closedBy: [41, 42],
      },
    ],
  });
  assert.deepEqual(idempotence, {
    state: 'OPEN',
    stateReason: '',
    comments: [{
      body: '## Closed below the oversight floor\n', author: { login: 'stranger' }, authorAssociation: 'NONE', url: 'u-1',
    }],
    login: 'bot',
  });
  const reopened = mcpFacts();
  reopened.parentGet.state_reason = 'reopened';
  assert.equal(normalizeMcpFacts(reopened, NATIVE_PARENT).idempotence.stateReason, 'REOPENED');
  const camel = mcpFacts();
  camel.subIssueGets[12].stateReason = 'not_planned';
  delete camel.subIssueGets[12].state_reason;
  assert.equal(normalizeMcpFacts(camel, NATIVE_PARENT).gate.subIssues[1].stateReason, 'NOT_PLANNED');
});

test('is a no-op on a gh-shaped entry', () => {
  assert.deepEqual(normalizeMcpFacts(ghTwin(), NATIVE_PARENT), normalizeMcpFacts(mcpFacts(), NATIVE_PARENT));
});

test('a sub-issue entry resolves its parent natively or from the body', () => {
  const native = normalizeMcpFacts(mcpFacts(), { subIssue: 11, workLinks: 'native' });
  assert.equal(native.gate.parent, 10);
  const none = normalizeMcpFacts({ parentLink: null }, { subIssue: 11, workLinks: 'native' });
  assert.deepEqual(none, { gate: { parent: null, parentLabels: [], subIssues: [] }, idempotence: null });

  const body = mcpFacts();
  delete body.parentLink;
  body.subIssueGet = issue(11, { body: 'Intro\n\nParent: #10\n' });
  body.parentGet.body = '- [ ] #11\n- [x] #12\n';
  delete body.subIssueList;
  const text = normalizeMcpFacts(body, { subIssue: 11, workLinks: 'body-text' });
  assert.equal(text.gate.parent, 10);
  assert.deepEqual(text.gate.subIssues.map((s) => s.number), [11, 12]);
  const orphan = normalizeMcpFacts({ subIssueGet: issue(11, { body: 'no parent line' }) }, { subIssue: 11, workLinks: 'body-text' });
  assert.equal(orphan.gate.parent, null);
});

function factsError(fn) {
  try { fn(); } catch (err) { return err; }
  return assert.fail('expected a FactsError');
}

test('an error object recorded as data is exit 3, named', () => {
  const cases = [
    ['subIssueGets.12', (f) => { f.subIssueGets[12] = { message: 'Not Found' }; }],
    ['parentGet', (f) => { f.parentGet = issue(99, { state: 'open' }); }],
    ['parentGet', (f) => { f.parentGet = { message: 'Not Found', status: '404' }; }],
    ['subIssueList.1', (f) => { f.subIssueList = [{ number: 11 }, { message: 'Not Found' }]; }],
    ['subIssueList', (f) => { f.subIssueList = { message: 'Not Found' }; }],
    ['parentComments', (f) => { f.parentComments = { message: 'Not Found' }; }],
    ['parentComments.0', (f) => { f.parentComments = [{ message: 'Not Found' }]; }],
    ['me', (f) => { f.me = { message: 'Bad credentials' }; }],
    ['subIssueGets.11', (f) => { f.subIssueGets[11].labels = [{ id: 1 }]; }],
    ['subIssueGets.11', (f) => { f.subIssueGets[11].closed_by_pull_requests = 'none'; }],
    ['subIssueGets.11', (f) => { f.subIssueGets[11].closed_by_pull_requests = [{ id: 7 }]; }],
    ['subIssueGets.12', (f) => { f.subIssueGets[12].state_reason = { x: 1 }; }],
    ['subIssueGets', (f) => { f.subIssueGets = [issue(11), issue(12)]; }],
    ['parentLink', (f) => { f.parentLink = { message: 'Not Found' }; }],
  ];
  for (const [key, mutate] of cases) {
    const facts = mcpFacts();
    mutate(facts);
    const err = factsError(() => normalizeMcpFacts(facts, key === 'parentLink' ? { subIssue: 11, workLinks: 'native' } : NATIVE_PARENT));
    assert.ok(err instanceof FactsError, key);
    assert.equal(err.exit, 3, key);
    assert.equal(err.key, key);
    assert.ok(err.message.length > 0, key);
  }
  const body = factsError(() => normalizeMcpFacts({ subIssueGet: issue(11) }, { subIssue: 11, workLinks: 'body-text' }));
  assert.equal(body.exit, 3);
  assert.equal(body.key, 'subIssueGet');
});

test('a missing or unrequested key is exit 1', () => {
  const cases = [
    ['subIssueGets.12', (f) => { delete f.subIssueGets[12]; }],
    ['subIssueGets.13', (f) => { f.subIssueGets[13] = issue(13); }],
    ['parentGet', (f) => { delete f.parentGet; }],
    ['subIssueList', (f) => { delete f.subIssueList; }],
    ['subIssueGets', (f) => { delete f.subIssueGets; }],
  ];
  for (const [key, mutate] of cases) {
    const facts = mcpFacts();
    mutate(facts);
    const err = factsError(() => normalizeMcpFacts(facts, NATIVE_PARENT));
    assert.ok(err instanceof FactsError, key);
    assert.equal(err.exit, 1, key);
    assert.equal(err.key, key);
  }
  for (const top of [null, [], 'text', 7]) {
    const err = factsError(() => normalizeMcpFacts(top, NATIVE_PARENT));
    assert.equal(err.exit, 1);
    assert.match(err.message, /JSON object/);
  }
  const noLink = factsError(() => normalizeMcpFacts({}, { subIssue: 11, workLinks: 'native' }));
  assert.equal(noLink.exit, 1);
  assert.equal(noLink.key, 'parentLink');
  const noBody = factsError(() => normalizeMcpFacts({}, { subIssue: 11, workLinks: 'body-text' }));
  assert.equal(noBody.key, 'subIssueGet');
});

test('comments and me are optional until an open parent needs them', () => {
  const facts = mcpFacts();
  delete facts.parentComments;
  delete facts.me;
  const { idempotence } = normalizeMcpFacts(facts, NATIVE_PARENT);
  assert.equal(idempotence.comments, undefined);
  assert.equal(idempotence.login, undefined);
  assert.equal(factsError(() => requireIdempotenceReads(idempotence)).key, 'parentComments');
  assert.equal(factsError(() => requireIdempotenceReads({ ...idempotence, comments: [] })).key, 'me');
  assert.equal(factsError(() => requireIdempotenceReads(idempotence)).exit, 1);
  assert.doesNotThrow(() => requireIdempotenceReads({ ...idempotence, comments: [], login: 'bot' }));
  assert.doesNotThrow(() => requireIdempotenceReads({ state: 'CLOSED', stateReason: 'COMPLETED' }));
  assert.doesNotThrow(() => requireIdempotenceReads({ state: 'OPEN', stateReason: 'REOPENED' }));
});

test('FACTS_KEYS lists the seven keys', () => {
  assert.deepEqual(FACTS_KEYS, ['parentLink', 'subIssueGet', 'subIssueList', 'parentGet', 'subIssueGets', 'parentComments', 'me']);
});
