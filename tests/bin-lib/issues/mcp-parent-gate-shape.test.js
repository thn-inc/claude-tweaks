'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  FACTS_KEYS, FactsError, normalizeMcpFacts, withIdempotenceReads,
} = require('../../../plugin/bin/lib/issues/mcp-parent-gate-shape');
const { needsIdempotenceReads } = require('../../../plugin/bin/lib/issues/parent-gate');

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
  // The two idempotence reads are not touched here: withIdempotenceReads completes them.
  assert.deepEqual(idempotence, { state: 'OPEN', stateReason: '' });
  assert.deepEqual(withIdempotenceReads(mcpFacts(), idempotence), {
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
  const viaGh = normalizeMcpFacts(ghTwin(), NATIVE_PARENT);
  const viaMcp = normalizeMcpFacts(mcpFacts(), NATIVE_PARENT);
  assert.deepEqual(viaGh, viaMcp);
  assert.deepEqual(withIdempotenceReads(ghTwin(), viaGh.idempotence), withIdempotenceReads(mcpFacts(), viaMcp.idempotence));
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

test("body-text: a Parent line the parent's task list omits resolves no parent (Reading B)", () => {
  const facts = {
    subIssueGet: issue(11, { body: 'Parent: #10' }),
    parentGet: issue(10, { state: 'open', state_reason: null, body: '- [ ] #12' }),
  };
  const got = normalizeMcpFacts(facts, { subIssue: 11, workLinks: 'body-text' });
  assert.deepEqual(got, { gate: { parent: null, parentLabels: [], subIssues: [] }, idempotence: null });
  // Only the sub-issue side and only body-text: a given parent, or a native list that omits the sub-issue, still resolves.
  const given = normalizeMcpFacts({ ...facts, subIssueGets: { 12: issue(12) } }, { parent: 10, workLinks: 'body-text' });
  assert.equal(given.gate.parent, 10);
  const native = mcpFacts();
  native.subIssueList = [{ number: 12 }];
  native.subIssueGets = { 12: native.subIssueGets[12] };
  assert.equal(normalizeMcpFacts(native, { subIssue: 11, workLinks: 'native' }).gate.parent, 10);
});

test('body-text: a parent with no task list keeps the parent (an empty list is not an omission)', () => {
  for (const body of ['', null, 'Just prose, no task list.']) {
    const facts = {
      subIssueGet: issue(11, { body: 'Parent: #10' }),
      parentGet: issue(10, { state: 'open', state_reason: null, labels: [{ name: 'parent-issue' }], body }),
      subIssueGets: {},
    };
    const got = normalizeMcpFacts(facts, { subIssue: 11, workLinks: 'body-text' });
    assert.deepEqual(got, {
      gate: { parent: 10, parentLabels: ['parent-issue'], subIssues: [] },
      idempotence: { state: 'OPEN', stateReason: '' },
    }, JSON.stringify(body));
  }
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
    ['subIssueGets.11', (f) => { f.subIssueGets[11].title = 7; }],
    ['subIssueGets.11', (f) => { f.subIssueGets[11].body = 7; }],
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
  // A present body of the wrong type fails; an error object has no number.
  const body = factsError(() => normalizeMcpFacts({ subIssueGet: issue(11, { body: 7 }) }, { subIssue: 11, workLinks: 'body-text' }));
  assert.equal(body.exit, 3);
  assert.equal(body.key, 'subIssueGet');
  const parentBody = mcpFacts();
  parentBody.parentGet.body = ['- [ ] #11'];
  const wrongParentBody = factsError(() => normalizeMcpFacts(parentBody, { parent: 10, workLinks: 'body-text' }));
  assert.equal(wrongParentBody.exit, 3);
  assert.equal(wrongParentBody.key, 'parentGet');
  assert.equal(factsError(() => normalizeMcpFacts({ subIssueGet: { message: 'Not Found' } }, { subIssue: 11, workLinks: 'body-text' })).exit, 3);
});

test('an absent or null body, labels, title or closed_by_pull_requests normalizes to empty', () => {
  for (const missing of [undefined, null]) {
    const facts = mcpFacts();
    facts.parentGet.labels = missing;
    facts.subIssueGets[11].labels = missing;
    facts.subIssueGets[11].title = missing;
    facts.subIssueGets[11].closed_by_pull_requests = missing;
    facts.subIssueGets[12].closedByPullRequestsReferences = missing;
    delete facts.subIssueGets[12].closed_by_pull_requests;
    const { gate } = normalizeMcpFacts(facts, NATIVE_PARENT);
    assert.deepEqual(gate.parentLabels, []);
    assert.deepEqual(gate.subIssues[0], {
      number: 11, title: '', state: 'CLOSED', stateReason: 'COMPLETED', labels: [], closedBy: [],
    });
    assert.deepEqual(gate.subIssues[1].closedBy, []);
  }
  // REST returns body: null for an empty issue: no parent line, no task list.
  for (const body of [undefined, null, '']) {
    const sub = normalizeMcpFacts({ subIssueGet: issue(11, { body }) }, { subIssue: 11, workLinks: 'body-text' });
    assert.equal(sub.gate.parent, null);
    const facts = { parentGet: issue(10, { state: 'open', body }), subIssueGets: {} };
    const parent = normalizeMcpFacts(facts, { parent: 10, workLinks: 'body-text' });
    assert.deepEqual(parent.gate.subIssues, []);
  }
});

test('a task list enumerates positive integers only, as the gh path does', () => {
  const facts = mcpFacts();
  facts.parentGet.body = '- [ ] #0\n- [x] #11\n- [ ] #12\n- [ ] #11\n';
  const { gate } = normalizeMcpFacts(facts, { parent: 10, workLinks: 'body-text' });
  assert.deepEqual(gate.subIssues.map((s) => s.number), [11, 12]);
  const nativeFacts = mcpFacts();
  nativeFacts.subIssueList = [{ number: 11 }, { number: 12 }];
  assert.deepEqual(normalizeMcpFacts(nativeFacts, NATIVE_PARENT).gate.subIssues.map((s) => s.number), [11, 12]);
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

test('comments are guarded and me is required only for an open, non-reopened parent', () => {
  const open = { state: 'OPEN', stateReason: '' };
  // Absent -> exit 1, naming the key.
  const noComments = factsError(() => withIdempotenceReads({ me: { login: 'bot' } }, open));
  assert.equal(noComments.exit, 1);
  assert.equal(noComments.key, 'parentComments');
  const noMe = factsError(() => withIdempotenceReads({ parentComments: [] }, open));
  assert.equal(noMe.exit, 1);
  assert.equal(noMe.key, 'me');
  // Present but failing its guard -> exit 3.
  const guards = [
    ['parentComments', { parentComments: { message: 'Not Found' }, me: { login: 'bot' } }],
    ['parentComments.0', { parentComments: [{ message: 'Not Found' }], me: { login: 'bot' } }],
  ];
  for (const [key, raw] of guards) {
    const err = factsError(() => withIdempotenceReads(raw, open));
    assert.equal(err.exit, 3, key);
    assert.equal(err.key, key);
  }
  // A CLOSED or REOPENED parent never reads them: even an error object there is ignored.
  const junk = { parentComments: { message: 'Not Found' }, me: { message: 'x' } };
  assert.deepEqual(withIdempotenceReads(junk, { state: 'CLOSED', stateReason: 'COMPLETED' }), { state: 'CLOSED', stateReason: 'COMPLETED' });
  assert.deepEqual(withIdempotenceReads({}, { state: 'OPEN', stateReason: 'REOPENED' }), { state: 'OPEN', stateReason: 'REOPENED' });
  // Complete -> the gh idempotence shape.
  const done = withIdempotenceReads({ parentComments: [], me: { login: 'bot' } }, open);
  assert.deepEqual(done, { state: 'OPEN', stateReason: '', comments: [], login: 'bot' });
});

test("#4770 withIdempotenceReads reads any login-less me as login ''", () => {
  const open = { state: 'OPEN', stateReason: '' };
  for (const me of [null, { login: '' }, { login: '  ' }, { login: 123 }, { message: 'Bad credentials' }, [], 'x']) {
    assert.deepEqual(withIdempotenceReads({ parentComments: [], me }, open), { state: 'OPEN', stateReason: '', comments: [], login: '' }, JSON.stringify(me));
  }
});

test('withIdempotenceReads reads comments and me exactly where needsIdempotenceReads says, as the gh gather does', () => {
  for (const state of ['OPEN', 'CLOSED']) {
    for (const stateReason of ['', 'COMPLETED', 'NOT_PLANNED', 'REOPENED']) {
      const out = withIdempotenceReads({ parentComments: [], me: { login: 'bot' } }, { state, stateReason });
      assert.equal('login' in out, needsIdempotenceReads(state, stateReason), `${state}/${stateReason}`);
    }
  }
});

test('FACTS_KEYS lists the seven keys', () => {
  assert.deepEqual(FACTS_KEYS, ['parentLink', 'subIssueGet', 'subIssueList', 'parentGet', 'subIssueGets', 'parentComments', 'me']);
});
