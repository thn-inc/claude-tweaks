'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CLOSE_HEADING, VERDICT_FIELDS, IDEMPOTENCE_VALUES, VALID_RISK_FLOORS, GhFailure, ghCaller,
  enumerateSubIssues, gatherGateFacts, gatherIdempotenceFacts, evaluateParentGate,
  evaluateIdempotence, evaluateGateWithIdempotence, needsIdempotenceReads, parseClosingTokens, positive,
  listOmitsSubIssue,
} = require('../../../plugin/bin/lib/issues/parent-gate');
const { run: runFetchSubIssues, EXIT_SUBISSUES_UNAVAILABLE } = require('../../../plugin/bin/fetch-sub-issues');
const { buildNativeParentQuery, buildNativeSubIssuesQuery } = require('../../../plugin/bin/lib/issues/record');

// The eight gh call shapes (Global Constraints), owner/repo o/r.
const SHAPE = {
  body: (n) => ['issue', 'view', String(n), '--repo', 'o/r', '--json', 'body', '-q', '.body'],
  parent: (n) => ['api', 'graphql', '-f', `query=${buildNativeParentQuery([n])}`, '-f', 'owner=o', '-f', 'repo=r'],
  probe: () => ['api', 'graphql', '-f', 'query={ __type(name: "Issue") { fields { name } } }'],
  page: (p) => ['api', 'graphql', '-f', `query=${buildNativeSubIssuesQuery([p])}`, '-f', 'owner=o', '-f', 'repo=r'],
  rest: (p) => ['api', '--paginate', `repos/o/r/issues/${p}/sub_issues`, '--jq', '.[].number'],
  sub: (n) => ['issue', 'view', String(n), '--repo', 'o/r', '--json', 'state,stateReason,labels,title,closedByPullRequestsReferences'],
  labels: (p) => ['issue', 'view', String(p), '--repo', 'o/r', '--json', 'labels', '-q', '[.labels[].name]'],
  live: (p) => ['issue', 'view', String(p), '--repo', 'o/r', '--json', 'state,stateReason,comments'],
  login: () => ['api', 'user', '--jq', '.login'],
};

// A fake gh answering by exact argv; anything else throws. `world`:
//   parentOf {sub: parent}, parentNoRepo, bodies {n: text}, probeFields [names],
//   subs {parent: [n]}, hasNextPage {parent: bool}, rest {parent: [n]},
//   issues {n: {state, stateReason, labels, title, refs}}, garbled {n: text},
//   parentLabels {parent: [names]}, labelsRaw {parent: text}, parentLive {parent: {...}}, liveRaw {parent: text},
//   login, throwWhen(key).
function makeGh(world) {
  const calls = [];
  const same = (args, want) => args.length === want.length && args.every((a, i) => a === want[i]);
  const gh = (args) => {
    calls.push({ args });
    const key = args.join(' ');
    if (world.throwWhen && world.throwWhen(key)) throw new Error(`boom: ${key}`);
    if (args[0] === 'api' && args[1] === 'graphql') {
      const q = String(args[3]);
      if (q.startsWith('query={ __type') && same(args, SHAPE.probe())) {
        const names = world.probeFields || ['subIssues', 'blockedBy'];
        return JSON.stringify({ data: { __type: { fields: names.map((name) => ({ name })) } } });
      }
      const n = Number((/i(\d+):/.exec(q) || [])[1]);
      if (q.includes('subIssues(first:100)') && same(args, SHAPE.page(n))) {
        const subs = (world.subs || {})[n] || [];
        const hasNextPage = Boolean((world.hasNextPage || {})[n]);
        return JSON.stringify({ data: { repository: { [`i${n}`]: { number: n, subIssues: { nodes: subs.map((number) => ({ number })), pageInfo: { hasNextPage } } } } } });
      }
      if (q.includes('parent{') && same(args, SHAPE.parent(n))) {
        if (world.parentNoRepo) return JSON.stringify({ data: { repository: null } });
        const parent = (world.parentOf || {})[n];
        return JSON.stringify({ data: { repository: { [`i${n}`]: { number: n, parent: parent ? { number: parent } : null } } } });
      }
    }
    let m = /^api --paginate repos\/o\/r\/issues\/(\d+)\/sub_issues --jq \.\[\]\.number$/.exec(key);
    if (m) return `${((world.rest || world.subs || {})[m[1]] || []).join('\n')}\n`;
    m = /^issue view (\d+) --repo o\/r --json body -q \.body$/.exec(key);
    if (m) return (world.bodies || {})[m[1]] || '';
    m = /^issue view (\d+) --repo o\/r --json state,stateReason,labels,title,closedByPullRequestsReferences$/.exec(key);
    if (m) {
      if (world.garbled && m[1] in world.garbled) return world.garbled[m[1]];
      const i = (world.issues || {})[m[1]] || { state: 'CLOSED', stateReason: 'COMPLETED' };
      return JSON.stringify({
        state: i.state, stateReason: i.stateReason || '', title: 'title' in i ? i.title : `Title ${m[1]}`,
        labels: (i.labels || ['risk:low']).map((name) => ({ name })),
        closedByPullRequestsReferences: (i.refs || []).map((number) => ({ number })),
      });
    }
    m = /^issue view (\d+) --repo o\/r --json labels -q \[\.labels\[\]\.name\]$/.exec(key);
    if (m && world.labelsRaw && m[1] in world.labelsRaw) return world.labelsRaw[m[1]];
    if (m) return JSON.stringify((world.parentLabels || {})[m[1]] || ['parent-issue']);
    m = /^issue view (\d+) --repo o\/r --json state,stateReason,comments$/.exec(key);
    if (m && world.liveRaw && m[1] in world.liveRaw) return world.liveRaw[m[1]];
    if (m) return JSON.stringify((world.parentLive || {})[m[1]] || { state: 'OPEN', stateReason: '', comments: [] });
    if (key === 'api user --jq .login') return `${world.login || 'bot'}\n`;
    throw new Error(`unexpected gh call: ${key}`);
  };
  return { gh, calls, caller: ghCaller(gh) };
}

const sub = (number, over = {}) => ({
  number, title: `T${number}`, state: 'CLOSED', stateReason: 'COMPLETED', labels: ['risk:low'], closedBy: [], ...over,
});

// Parent 10 (parent-issue), sub-issues 11 and 12 CLOSED/COMPLETED risk:low, floor high.
const facts = (over = {}) => ({
  parent: 10, parentLabels: ['parent-issue'], subIssues: [sub(11), sub(12)], riskFloor: 'high', ...over,
});

const OR = { owner: 'o', repo: 'r' };
const NATIVE = { ...OR, workLinks: 'native' };
const argvOf = (calls) => calls.map((c) => c.args);
const ghFailure = (pattern) => (err) => {
  assert.ok(err instanceof GhFailure, `GhFailure expected, got ${err && err.constructor && err.constructor.name}: ${err && err.message}`);
  if (typeof pattern === 'string') assert.ok(err.message.startsWith(pattern), err.message);
  else assert.match(err.message, pattern);
  return true;
};

// --- evaluateParentGate ---

test('AC1.2: all sub-issues closed not-planned close the parent as not planned', () => {
  const v = evaluateParentGate(facts({ subIssues: [sub(11, { stateReason: 'NOT_PLANNED' }), sub(12, { stateReason: 'NOT_PLANNED' })] }));
  assert.equal(v.state, 'due');
  assert.equal(v.exceeds, false);
  assert.equal(v.closeReason, 'not planned');
});

test('AC1.2: one completed sub-issue closes the parent completed', () => {
  const v = evaluateParentGate(facts({ subIssues: [sub(11, { stateReason: 'NOT_PLANNED' }), sub(12, { stateReason: 'COMPLETED' })] }));
  assert.equal(v.state, 'due');
  assert.equal(v.closeReason, 'completed');
});

test('closing member counts CLOSED and completed', () => {
  const v = evaluateParentGate(facts({
    subIssues: [sub(11, { stateReason: 'NOT_PLANNED' }), sub(12, { state: 'OPEN', stateReason: '' })],
    closingSet: [12],
  }));
  assert.equal(v.state, 'due');
  assert.equal(v.closeReason, 'completed');
  assert.equal(v.subIssues[1].state, 'CLOSED');
  assert.equal(v.subIssues[1].stateReason, 'COMPLETED');
});

test('selfInclude: false judges a closing member by its live state', () => {
  const v = evaluateParentGate(facts({
    subIssues: [sub(11, { stateReason: 'NOT_PLANNED' }), sub(12, { state: 'OPEN', stateReason: '' })],
    closingSet: [12],
    selfInclude: false,
  }));
  assert.equal(v.state, 'incomplete');
  assert.equal(v.exceeds, null);
  assert.equal(v.closeReason, null);
});

test('closing set never adds sub-issues', () => {
  const v = evaluateParentGate(facts({ subIssues: [sub(11), sub(12, { state: 'OPEN', stateReason: '' })], closingSet: [99] }));
  assert.equal(v.state, 'incomplete');
  assert.equal(v.subIssues.length, 2);
  assert.deepEqual(v.subIssues.map((s) => s.number), [11, 12]);
});

test('AC1.5: a parent without parent-issue is reported, not skipped', () => {
  const v = evaluateParentGate(facts({ parentLabels: ['needs:decision'] }));
  assert.equal(v.parentIssue, false);
  assert.deepEqual(v.needs, ['needs:decision']);
  assert.equal(v.state, 'due');
  assert.equal(evaluateParentGate(facts()).parentIssue, true);
});

test('unscored sibling fails closed', () => {
  const v = evaluateParentGate(facts({ subIssues: [sub(11), sub(12, { labels: [] })] }));
  assert.equal(v.state, 'due');
  assert.equal(v.maxTier, null);
  assert.equal(v.exceeds, true);
  assert.equal(v.closeReason, null);
});

test('above-floor risk exceeds', () => {
  const v = evaluateParentGate(facts({ subIssues: [sub(11), sub(12, { labels: ['risk:high'] })] }));
  assert.equal(v.exceeds, true);
  assert.equal(v.maxTier, 'high');
  assert.equal(v.closeReason, null);
});

test('gated and resolved parents are no-ops', () => {
  const gated = evaluateParentGate(facts({ parentLabels: ['parent-issue', 'accept:pending'] }));
  assert.equal(gated.state, 'gated');
  assert.equal(gated.exceeds, null);
  assert.equal(gated.closeReason, null);
  const resolved = evaluateParentGate(facts({ parentLabels: ['parent-issue', 'demo:approved'] }));
  assert.equal(resolved.state, 'resolved');
  assert.equal(resolved.exceeds, null);
  assert.equal(resolved.closeReason, null);
});

test('held lists enumerated held sub-issues only', () => {
  assert.deepEqual(evaluateParentGate(facts({ held: [12, 99] })).held, [12]);
  assert.deepEqual(evaluateParentGate(facts()).held, []);
});

test('pr prefers the merging PR for closing members, else the last reference, else null', () => {
  const v = evaluateParentGate(facts({ subIssues: [sub(11, { closedBy: [5, 7] }), sub(12)], closingSet: [12], mergingPr: 40 }));
  assert.equal(v.subIssues[0].pr, 7);
  assert.equal(v.subIssues[1].pr, 40);
  const none = evaluateParentGate(facts({ subIssues: [sub(11), sub(12, { closedBy: [] })], closingSet: [12], mergingPr: null }));
  assert.equal(none.subIssues[1].pr, null);
});

test('no parent yields the no-parent verdict', () => {
  const v = evaluateParentGate({ parent: null, parentLabels: [], subIssues: [], riskFloor: 'high' });
  assert.deepEqual(v, {
    parent: null,
    state: 'no-parent',
    exceeds: null,
    closeReason: null,
    idempotence: null,
    maxTier: null,
    riskFloor: 'high',
    parentIssue: null,
    needs: [],
    held: [],
    subIssues: [],
    skipped: [],
  });
});

test('the verdict carries VERDICT_FIELDS in order', () => {
  assert.deepEqual(VERDICT_FIELDS, [
    'parent', 'state', 'exceeds', 'closeReason', 'idempotence', 'maxTier', 'riskFloor', 'parentIssue', 'needs', 'held', 'subIssues', 'skipped',
  ]);
  const due = evaluateParentGate(facts());
  assert.deepEqual(Object.keys(due), VERDICT_FIELDS);
  assert.deepEqual(Object.keys(evaluateParentGate({ parent: null, parentLabels: [], subIssues: [], riskFloor: 'high' })), VERDICT_FIELDS);
  assert.deepEqual(due.subIssues[0], { number: 11, title: 'T11', state: 'CLOSED', stateReason: 'COMPLETED', pr: null });
  assert.equal(due.idempotence, null);
  assert.deepEqual(due.skipped, []);
  assert.equal(due.riskFloor, 'high');
});

test('an invalid risk floor throws', () => {
  for (const riskFloor of [null, undefined, '', 'critical']) {
    assert.throws(() => evaluateParentGate(facts({ riskFloor })), TypeError, String(riskFloor));
  }
  for (const riskFloor of VALID_RISK_FLOORS) {
    assert.doesNotThrow(() => evaluateParentGate(facts({ riskFloor })), riskFloor);
  }
});

// --- evaluateIdempotence ---

const headingComment = (over = {}) => ({
  body: `intro\n${CLOSE_HEADING}\n`, authorAssociation: 'MEMBER', author: { login: 'someone' }, url: 'u0', ...over,
});

test('AC1.4: a human-reopened parent is never re-closed', () => {
  assert.deepEqual(
    evaluateIdempotence({ state: 'OPEN', stateReason: 'REOPENED', comments: [], login: 'bot' }),
    { idempotence: 'reopened', skipped: [] },
  );
});

test("AC1.4: a reopen holds over the bot's own close marker, checked before the comment scan", () => {
  // A trusted marker (would count: close-only) beside an untrusted one (would be named in
  // skipped): a reopened check after the scan, or a counted marker returned first, goes red.
  const comments = [headingComment(), headingComment({ authorAssociation: 'NONE', author: { login: 'stranger' }, url: 'u4' })];
  assert.deepEqual(
    evaluateIdempotence({ state: 'OPEN', stateReason: 'REOPENED', comments, login: 'bot' }),
    { idempotence: 'reopened', skipped: [] },
  );
});

test('an already-closed parent is a no-op, checked before reopened', () => {
  assert.deepEqual(
    evaluateIdempotence({ state: 'CLOSED', stateReason: 'REOPENED', comments: [], login: null }),
    { idempotence: 'already-closed', skipped: [] },
  );
});

test('trusted heading comment means close only', () => {
  assert.deepEqual(
    evaluateIdempotence({ state: 'OPEN', stateReason: '', comments: [headingComment({ body: 'intro\n## Closed below the oversight floor\n' })], login: 'bot' }),
    { idempotence: 'close-only', skipped: [] },
  );
});

test('own-login heading comment counts', () => {
  const comment = headingComment({ authorAssociation: 'NONE', author: { login: 'bot' } });
  assert.deepEqual(evaluateIdempotence({ state: 'OPEN', stateReason: '', comments: [comment], login: 'bot' }), { idempotence: 'close-only', skipped: [] });
});

test('untrusted heading comment is skipped and named', () => {
  const comment = headingComment({ authorAssociation: 'CONTRIBUTOR', author: { login: 'stranger' }, url: 'u1' });
  const out = evaluateIdempotence({ state: 'OPEN', stateReason: '', comments: [comment], login: 'bot' });
  assert.equal(out.idempotence, 'comment-and-close');
  assert.equal(out.skipped.length, 1);
  assert.ok(out.skipped[0].includes('u1'), out.skipped[0]);
});

test('a heading mentioned mid-line does not count', () => {
  const comment = headingComment({ body: 'see ## Closed below the oversight floor' });
  assert.deepEqual(evaluateIdempotence({ state: 'OPEN', stateReason: '', comments: [comment], login: 'bot' }), { idempotence: 'comment-and-close', skipped: [] });
});

test('a counted heading comment still names an untrusted one beside it', () => {
  const planted = headingComment({ authorAssociation: 'NONE', author: { login: 'stranger' }, url: 'u2' });
  // The counted comment comes first, so a note dropped once a count is found goes red.
  const out = evaluateIdempotence({ state: 'OPEN', stateReason: '', comments: [headingComment(), planted], login: 'bot' });
  assert.equal(out.idempotence, 'close-only');
  assert.equal(out.skipped.length, 1);
  assert.ok(out.skipped[0].includes('u2'), out.skipped[0]);
});

test('the local-files body variant ignores comments', () => {
  const untrusted = headingComment({ authorAssociation: 'CONTRIBUTOR', url: 'u3' });
  const body = { source: 'body' };
  assert.deepEqual(
    evaluateIdempotence({ state: 'OPEN', body: 'x\n## Closed below the oversight floor\n', comments: [untrusted] }, body),
    { idempotence: 'close-only', skipped: [] },
  );
  assert.deepEqual(evaluateIdempotence({ state: 'CLOSED', body: 'x' }, body), { idempotence: 'already-closed', skipped: [] });
  assert.deepEqual(evaluateIdempotence({ state: 'OPEN', body: 'x' }, body), { idempotence: 'comment-and-close', skipped: [] });
});

test('the facts shape is the explicit source, never sniffed from a body field', () => {
  // The default source reads comments even when a body string is present.
  const facts = { state: 'OPEN', stateReason: '', body: `x\n${CLOSE_HEADING}\n`, comments: [], login: 'bot' };
  assert.deepEqual(evaluateIdempotence(facts), { idempotence: 'comment-and-close', skipped: [] });
  assert.deepEqual(evaluateIdempotence(facts, { source: 'comments' }), { idempotence: 'comment-and-close', skipped: [] });
  assert.deepEqual(evaluateIdempotence(facts, { source: 'body' }), { idempotence: 'close-only', skipped: [] });
  for (const source of ['Body', 'local-files', '', null]) {
    assert.throws(() => evaluateIdempotence(facts, { source }), TypeError, String(source));
  }
});

test('needsIdempotenceReads: only a parent neither CLOSED nor REOPENED reads comments and login', () => {
  assert.equal(needsIdempotenceReads('OPEN', ''), true);
  assert.equal(needsIdempotenceReads('OPEN', 'COMPLETED'), true);
  assert.equal(needsIdempotenceReads('CLOSED', ''), false);
  assert.equal(needsIdempotenceReads('CLOSED', 'COMPLETED'), false);
  assert.equal(needsIdempotenceReads('OPEN', 'REOPENED'), false);
  assert.equal(needsIdempotenceReads('CLOSED', 'REOPENED'), false);
});

// --- evaluateGateWithIdempotence ---

// A reader that records each verdict it is handed and returns `out`.
const reader = (out) => {
  const seen = [];
  const read = (verdict) => { seen.push(verdict); return out; };
  return { read, seen };
};
const OPEN_FACTS = { state: 'OPEN', stateReason: '', comments: [], login: 'bot' };

test('evaluateGateWithIdempotence: without the flag it is evaluateParentGate, and reads nothing', () => {
  const r = reader(OPEN_FACTS);
  assert.deepEqual(evaluateGateWithIdempotence(facts(), { readIdempotenceFacts: r.read }), evaluateParentGate(facts()));
  assert.deepEqual(evaluateGateWithIdempotence(facts()), evaluateParentGate(facts()));
  assert.equal(r.seen.length, 0);
});

test('evaluateGateWithIdempotence reads only for a parent due below the floor', () => {
  const notDue = [
    facts({ subIssues: [sub(11), sub(12, { state: 'OPEN', stateReason: '' })] }),
    facts({ subIssues: [sub(11), sub(12, { labels: ['risk:high'] })] }),
    facts({ parentLabels: ['parent-issue', 'accept:pending'] }),
    facts({ parent: null, parentLabels: [], subIssues: [] }),
  ];
  for (const input of notDue) {
    const r = reader(OPEN_FACTS);
    const v = evaluateGateWithIdempotence(input, { idempotence: true, readIdempotenceFacts: r.read });
    assert.deepEqual(v, evaluateParentGate(input), JSON.stringify(input));
    assert.equal(r.seen.length, 0, JSON.stringify(input));
  }
  // Without a reader too: nothing is read, so nothing is missing.
  assert.equal(evaluateGateWithIdempotence(notDue[1], { idempotence: true }).exceeds, true);
});

test('evaluateGateWithIdempotence merges the idempotence check into a due-below-floor verdict', () => {
  const planted = { body: `x\n${CLOSE_HEADING}\n`, authorAssociation: 'NONE', author: { login: 'stranger' }, url: 'u-planted' };
  const r = reader({ ...OPEN_FACTS, comments: [planted] });
  const v = evaluateGateWithIdempotence(facts(), { idempotence: true, readIdempotenceFacts: r.read });
  const plain = evaluateParentGate(facts());
  assert.deepEqual(r.seen, [plain]);
  assert.equal(v.idempotence, 'comment-and-close');
  assert.equal(v.skipped.length, 1);
  assert.deepEqual({ ...v, idempotence: null, skipped: [] }, plain);
  assert.deepEqual(Object.keys(v), VERDICT_FIELDS);
});

test("evaluateGateWithIdempotence passes `source` through: the local-files body shape", () => {
  const body = { state: 'OPEN', body: `x\n${CLOSE_HEADING}\n` };
  assert.equal(evaluateGateWithIdempotence(facts(), { idempotence: true, readIdempotenceFacts: () => body, source: 'body' }).idempotence, 'close-only');
  // The same facts under the default source read comments, of which there are none.
  assert.equal(evaluateGateWithIdempotence(facts(), { idempotence: true, readIdempotenceFacts: () => body }).idempotence, 'comment-and-close');
  assert.throws(() => evaluateGateWithIdempotence(facts(), { idempotence: true, readIdempotenceFacts: () => body, source: 'local-files' }), TypeError);
});

test("evaluateGateWithIdempotence propagates the reader's throw and needs a reader where it reads", () => {
  const failing = () => { throw new GhFailure('gh issue view 10: boom'); };
  assert.throws(() => evaluateGateWithIdempotence(facts(), { idempotence: true, readIdempotenceFacts: failing }), ghFailure('gh issue view 10: boom'));
  assert.throws(() => evaluateGateWithIdempotence(facts(), { idempotence: true }), TypeError);
});

test('IDEMPOTENCE_VALUES lists the four values in check order', () => {
  assert.deepEqual(IDEMPOTENCE_VALUES, ['already-closed', 'reopened', 'close-only', 'comment-and-close']);
});

// --- parseClosingTokens ---

test('AC1.3: parseClosingTokens drops a cross-repo closing reference', () => {
  assert.deepEqual(parseClosingTokens(['12', 'other/r#11', 'O/R#13'], { owner: 'o', repo: 'r' }), { numbers: [12, 13] });
  for (const bad of ['0', '', '#5', 'a/b#x']) {
    const out = parseClosingTokens([bad], { owner: 'o', repo: 'r' });
    assert.equal(typeof out.error, 'string', JSON.stringify(bad));
    assert.ok(!('numbers' in out), JSON.stringify(bad));
  }
  const local = parseClosingTokens(['o/r#3'], { owner: null, repo: null });
  assert.equal(typeof local.error, 'string');
});

test('parseClosingTokens de-duplicates and sorts the union', () => {
  assert.deepEqual(parseClosingTokens(['13', 'o/r#12', '12', 'o/r#13'], { owner: 'o', repo: 'r' }), { numbers: [12, 13] });
  assert.deepEqual(parseClosingTokens([], { owner: 'o', repo: 'r' }), { numbers: [] });
});

test('parseClosingTokens keeps an unqualified token with no owner/repo (local-files)', () => {
  assert.deepEqual(parseClosingTokens(['7'], { owner: null, repo: null }), { numbers: [7] });
});

test('positive takes a digit string only', () => {
  assert.equal(positive('5'), 5);
  assert.equal(positive('4603'), 4603);
  for (const text of ['', ' 5', '5 ', '0x5', '0', '00', '-1', '1e3', '5.0', '9007199254740993']) {
    assert.equal(positive(text), null, JSON.stringify(text));
  }
});

// --- gathers ---

test('gatherGateFacts (native, from a sub-issue) makes the call shapes in order', () => {
  const { calls, caller } = makeGh({
    parentOf: { 11: 10 },
    subs: { 10: [12, 11] },
    issues: {
      11: { state: 'closed', stateReason: 'completed', title: '  Eleven  ', labels: ['risk:low'], refs: [5, 7] },
      12: { state: 'CLOSED', stateReason: 'NOT_PLANNED', title: 'Twelve', labels: ['risk:medium', 'bug'] },
    },
  });
  const got = gatherGateFacts({ subIssue: 11, ...NATIVE, caller });
  assert.deepEqual(argvOf(calls), [SHAPE.parent(11), SHAPE.probe(), SHAPE.page(10), SHAPE.sub(11), SHAPE.sub(12), SHAPE.labels(10)]);
  assert.ok(calls[2].args[3].includes('subIssues(first:100)'));
  assert.deepEqual(got, {
    parent: 10,
    parentLabels: ['parent-issue'],
    subIssues: [
      { number: 11, title: 'Eleven', state: 'CLOSED', stateReason: 'COMPLETED', labels: ['risk:low'], closedBy: [5, 7] },
      { number: 12, title: 'Twelve', state: 'CLOSED', stateReason: 'NOT_PLANNED', labels: ['risk:medium', 'bug'], closedBy: [] },
    ],
  });
});

test('AC1.1: 35 sub-issues arrive in one fetcher page', () => {
  const subs = Array.from({ length: 35 }, (_, i) => 11 + i);
  const { calls, caller } = makeGh({ subs: { 10: subs } });
  assert.deepEqual(enumerateSubIssues({ parent: 10, ...NATIVE, caller }), subs);
  assert.ok(!calls.some((c) => c.args[1] === '--paginate'), 'no 4c call');
  const got = gatherGateFacts({ parent: 10, ...NATIVE, caller: makeGh({ subs: { 10: subs } }).caller });
  assert.equal(got.subIssues.length, 35);
  const v = evaluateParentGate({ ...got, riskFloor: 'high' });
  assert.equal(v.state, 'due');
  assert.equal(v.subIssues.length, 35);
  assert.equal(v.closeReason, 'completed');
});

test('AC1.1: a parent past the 100 page size goes through the --paginate ladder', () => {
  const page = Array.from({ length: 100 }, (_, i) => 100 + i);
  const all = Array.from({ length: 120 }, (_, i) => 100 + i);
  const { calls, caller } = makeGh({ subs: { 10: page }, hasNextPage: { 10: true }, rest: { 10: all } });
  assert.deepEqual(enumerateSubIssues({ parent: 10, ...NATIVE, caller }), all);
  const rest = SHAPE.rest(10);
  assert.equal(calls.filter((c) => c.args.length === rest.length && c.args.every((a, i) => a === rest[i])).length, 1);
});

test("the probe's unavailable answer takes the one REST call", () => {
  const { calls, caller } = makeGh({ probeFields: ['title'], rest: { 10: [12, 11, 12] } });
  assert.deepEqual(enumerateSubIssues({ parent: 10, ...NATIVE, caller }), [11, 12]);
  assert.deepEqual(argvOf(calls), [SHAPE.probe(), SHAPE.rest(10)]);
  assert.ok(!calls.some((c) => String(c.args[3]).includes('subIssues(first:100)')), 'no 4b call');
});

test('a failing fetcher read is a GhFailure naming the fetcher', () => {
  const { caller } = makeGh({ subs: { 10: [11] }, throwWhen: (k) => k.includes('subIssues(first:100)') });
  assert.throws(() => enumerateSubIssues({ parent: 10, ...NATIVE, caller }), (err) => {
    ghFailure('fetch-sub-issues.js exit 3:')(err);
    assert.ok(err.message.includes('boom: api graphql'), err.message);
    return true;
  });
});

test('an exit-0 fetcher answer that is unparseable or lacks the parent key is a GhFailure', () => {
  const { calls, caller } = makeGh({});
  const fetcherPrinting = (text) => (argv, deps) => { deps.stdout(text); return 0; };
  assert.throws(
    () => enumerateSubIssues({ parent: 10, ...NATIVE, caller, fetcher: fetcherPrinting('<html>502</html>') }),
    ghFailure(/^fetch-sub-issues\.js: unparseable output/),
  );
  for (const text of [`${JSON.stringify({ byParent: { 11: [12] }, retry: [] })}\n`, `${JSON.stringify({ retry: [10] })}\n`, 'null\n']) {
    assert.throws(
      () => enumerateSubIssues({ parent: 10, ...NATIVE, caller, fetcher: fetcherPrinting(text) }),
      ghFailure('fetch-sub-issues.js: no sub-issue list for #10'),
      text,
    );
  }
  assert.equal(calls.length, 0, 'the injected fetcher made every read');
});

test('the fetcher is given the parent, --repo and --resolve-retries, and its byParent list is read', () => {
  const seen = [];
  const { caller } = makeGh({});
  const fetcher = (argv, deps) => { seen.push(argv); deps.stdout(`${JSON.stringify({ byParent: { 10: [12, 11] }, retry: [] })}\n`); return 0; };
  assert.deepEqual(enumerateSubIssues({ parent: 10, ...NATIVE, caller, fetcher }), [11, 12]);
  assert.deepEqual(seen, [['10', '--repo', 'o/r', '--resolve-retries']]);
});

test('EXIT_SUBISSUES_UNAVAILABLE is 4 and is the code fetch-sub-issues returns for an unavailable field', () => {
  assert.equal(EXIT_SUBISSUES_UNAVAILABLE, 4);
  const { gh } = makeGh({ probeFields: ['title'] });
  const deps = { ghAvailable: () => true, remoteUrl: () => null, runner: gh, stdout: () => {}, stderr: () => {} };
  assert.equal(runFetchSubIssues(['10', '--repo', 'o/r'], deps), EXIT_SUBISSUES_UNAVAILABLE);
});

test("gatherGateFacts (body-text) reads the Parent line and the parent's task list", () => {
  const { calls, caller } = makeGh({ bodies: { 11: 'Intro\n\nParent: #10\n', 10: '- [ ] #11\n- [x] #12\n' } });
  const got = gatherGateFacts({ subIssue: 11, owner: 'o', repo: 'r', workLinks: 'body-text', caller });
  assert.deepEqual(argvOf(calls), [SHAPE.body(11), SHAPE.body(10), SHAPE.sub(11), SHAPE.sub(12), SHAPE.labels(10)]);
  assert.equal(got.parent, 10);
  assert.deepEqual(got.subIssues.map((s) => s.number), [11, 12]);
});

test('gatherGateFacts with no resolvable parent stops after resolution', () => {
  const native = makeGh({ parentOf: {} });
  assert.deepEqual(gatherGateFacts({ subIssue: 11, ...NATIVE, caller: native.caller }), { parent: null, parentLabels: [], subIssues: [] });
  assert.equal(native.calls.length, 1);
  const bodyText = makeGh({ bodies: { 11: 'no parent line' } });
  assert.deepEqual(gatherGateFacts({ subIssue: 11, owner: 'o', repo: 'r', workLinks: 'body-text', caller: bodyText.caller }), { parent: null, parentLabels: [], subIssues: [] });
  assert.equal(bodyText.calls.length, 1);
});

test("gatherGateFacts body-text: a Parent line the parent's task list omits resolves no parent (Reading B)", () => {
  const { calls, caller } = makeGh({ bodies: { 11: 'Parent: #10\n', 10: '- [ ] #12\n' } });
  const got = gatherGateFacts({ subIssue: 11, owner: 'o', repo: 'r', workLinks: 'body-text', caller });
  assert.deepEqual(got, { parent: null, parentLabels: [], subIssues: [] });
  assert.deepEqual(argvOf(calls), [SHAPE.body(11), SHAPE.body(10)], 'no shape 5 or 6 read');
  // Only the sub-issue side: the same unlisted record, named as the parent's own `parent`, is gathered as before.
  const fromParent = gatherGateFacts({ parent: 10, owner: 'o', repo: 'r', workLinks: 'body-text', caller: makeGh({ bodies: { 10: '- [ ] #12\n' } }).caller });
  assert.equal(fromParent.parent, 10);
  assert.deepEqual(fromParent.subIssues.map((s) => s.number), [12]);
});

test("gatherGateFacts body-text: a parent with no task list keeps the parent (an empty list is not an omission)", () => {
  for (const parentBody of ['', 'Just prose, no task list.\n']) {
    const { calls, caller } = makeGh({ bodies: { 11: 'Parent: #10\n', 10: parentBody } });
    const got = gatherGateFacts({ subIssue: 11, owner: 'o', repo: 'r', workLinks: 'body-text', caller });
    assert.deepEqual(got, { parent: 10, parentLabels: ['parent-issue'], subIssues: [] }, JSON.stringify(parentBody));
    assert.deepEqual(argvOf(calls), [SHAPE.body(11), SHAPE.body(10), SHAPE.labels(10)], JSON.stringify(parentBody));
  }
});

test("gatherGateFacts native: a sub-issue list omitting the sub-issue keeps the parent (Reading B is body-text only)", () => {
  const { caller } = makeGh({ parentOf: { 11: 10 }, subs: { 10: [12] } });
  const got = gatherGateFacts({ subIssue: 11, ...NATIVE, caller });
  assert.equal(got.parent, 10);
  assert.deepEqual(got.subIssues.map((s) => s.number), [12]);
});

test('gatherGateFacts from a parent skips resolution', () => {
  const { calls, caller } = makeGh({ subs: { 10: [11, 12] } });
  const got = gatherGateFacts({ parent: 10, ...NATIVE, caller });
  assert.deepEqual(calls[0].args, SHAPE.probe());
  assert.equal(got.parent, 10);
  assert.deepEqual(got.subIssues.map((s) => s.number), [11, 12]);
});

test('gatherGateFacts takes exactly one of subIssue and parent', () => {
  for (const args of [{ subIssue: 11, parent: 10 }, {}, { subIssue: null, parent: undefined }]) {
    const { calls, caller } = makeGh({ parentOf: { 11: 10 }, subs: { 10: [11] } });
    assert.throws(() => gatherGateFacts({ ...args, ...NATIVE, caller }), TypeError, JSON.stringify(args));
    assert.equal(calls.length, 0, `no gh call: ${JSON.stringify(args)}`);
  }
});

// Each callJson read names the JSON container it expects; any other answer is a GhFailure, never a TypeError.
test('shape 5: a sub-issue read that is not a JSON object is a GhFailure', () => {
  for (const text of ['null', '42', '"text"', '[]', '[{"state":"CLOSED"}]']) {
    const { caller } = makeGh({ parentOf: { 11: 10 }, subs: { 10: [11, 12] }, garbled: { 12: text } });
    assert.throws(() => gatherGateFacts({ subIssue: 11, ...NATIVE, caller }), ghFailure(/^gh issue view 12: unexpected output \(not a JSON object/), text);
  }
});

test('shape 5: a closedByPullRequestsReferences that is present, non-null and not an array is a GhFailure', () => {
  const answer = (refs) => JSON.stringify({ state: 'CLOSED', stateReason: 'COMPLETED', title: 'T', labels: [], closedByPullRequestsReferences: refs });
  for (const refs of [{ number: 5 }, 'PR #5', 5, true]) {
    const { caller } = makeGh({ parentOf: { 11: 10 }, subs: { 10: [11, 12] }, garbled: { 12: answer(refs) } });
    assert.throws(() => gatherGateFacts({ subIssue: 11, ...NATIVE, caller }), ghFailure(/^gh issue view 12: unexpected output \(closedByPullRequestsReferences is not an array/), JSON.stringify(refs));
  }
  // An element that is not a { number } reference fails too, never silently dropped.
  for (const refs of [[null], [5], [{}], [{ number: '5' }], [{ number: 0 }], [{ number: 5 }, { state: 'MERGED' }]]) {
    const { caller } = makeGh({ parentOf: { 11: 10 }, subs: { 10: [11, 12] }, garbled: { 12: answer(refs) } });
    assert.throws(() => gatherGateFacts({ subIssue: 11, ...NATIVE, caller }), ghFailure(/^gh issue view 12: unexpected output \(closedByPullRequestsReferences holds an element that is not a \{ number \} reference/), JSON.stringify(refs));
  }
  // Absent or null is no closing PR, never a failure.
  for (const text of [answer(null), JSON.stringify({ state: 'CLOSED', stateReason: 'COMPLETED', title: 'T', labels: [] })]) {
    const { caller } = makeGh({ parentOf: { 11: 10 }, subs: { 10: [11, 12] }, garbled: { 12: text } });
    assert.deepEqual(gatherGateFacts({ subIssue: 11, ...NATIVE, caller }).subIssues[1].closedBy, [], text);
  }
});

test('shape 6: a parent-labels read that is not a JSON array is a GhFailure', () => {
  for (const text of ['null', '42', '"parent-issue"', '{}', '{"labels":[]}']) {
    const { caller } = makeGh({ parentOf: { 11: 10 }, subs: { 10: [11, 12] }, labelsRaw: { 10: text } });
    assert.throws(() => gatherGateFacts({ subIssue: 11, ...NATIVE, caller }), ghFailure(/^gh issue view 10: unexpected output \(not a JSON array/), text);
  }
});

test('shape 7: a parent live read that is not a JSON object is a GhFailure', () => {
  for (const text of ['null', '42', '"text"', '[]']) {
    const { caller } = makeGh({ liveRaw: { 10: text } });
    assert.throws(() => gatherIdempotenceFacts({ parent: 10, ...OR, caller }), ghFailure(/^gh issue view 10: unexpected output \(not a JSON object/), text);
  }
});

// Read as '' or [], each of these would make an open parent comment-and-close: a duplicate public comment.
test('shape 7: a malformed state, stateReason or comments is a GhFailure naming the field', () => {
  const cases = [
    [{ stateReason: '', comments: [] }, 'state is not a string: undefined'],
    [{ state: null, stateReason: '', comments: [] }, 'state is not a string: null'],
    [{ state: 7, stateReason: '', comments: [] }, 'state is not a string: 7'],
    [{ state: 'OPEN', stateReason: 5, comments: [] }, 'stateReason is not a string: 5'],
    [{ state: 'OPEN', stateReason: '', comments: 'not-an-array' }, 'comments is not an array: "not-an-array"'],
    [{ state: 'OPEN', stateReason: '' }, 'comments is not an array: undefined'],
    [{ state: 'OPEN', stateReason: '', comments: { nodes: [] } }, 'comments is not an array: {"nodes":[]}'],
  ];
  for (const [live, field] of cases) {
    const gh = makeGh({ parentLive: { 10: live } });
    assert.throws(() => gatherIdempotenceFacts({ parent: 10, ...OR, caller: gh.caller }), ghFailure(`gh issue view 10: unexpected output (${field})`), JSON.stringify(live));
    assert.deepEqual(argvOf(gh.calls), [SHAPE.live(10)], `no login read: ${JSON.stringify(live)}`);
  }
  // A valid read is unchanged: state and stateReason uppercased, a null stateReason read as ''.
  const comments = [headingComment()];
  const gh = makeGh({ parentLive: { 10: { state: 'open', stateReason: null, comments } } });
  assert.deepEqual(gatherIdempotenceFacts({ parent: 10, ...OR, caller: gh.caller }), { state: 'OPEN', stateReason: '', comments, login: 'bot' });
  assert.deepEqual(argvOf(gh.calls), [SHAPE.live(10), SHAPE.login()]);
});

test('a failing or unparseable read throws GhFailure', () => {
  const world = { parentOf: { 11: 10 }, subs: { 10: [11, 12] } };
  let { caller } = makeGh({ ...world, throwWhen: (k) => k.startsWith('issue view 12 --repo') });
  assert.throws(() => gatherGateFacts({ subIssue: 11, ...NATIVE, caller }), ghFailure('gh issue view 12:'));
  ({ caller } = makeGh({ ...world, garbled: { 12: '<html>502</html>' } }));
  assert.throws(() => gatherGateFacts({ subIssue: 11, ...NATIVE, caller }), ghFailure(/unparseable output/));
  ({ caller } = makeGh({ ...world, parentNoRepo: true }));
  assert.throws(() => gatherGateFacts({ subIssue: 11, ...NATIVE, caller }), ghFailure('gh api graphql (parent):'));
});

test('gatherIdempotenceFacts reads the login only for an open, non-reopened parent', () => {
  const comments = [headingComment()];
  let gh = makeGh({ parentLive: { 10: { state: 'OPEN', stateReason: '', comments } } });
  assert.deepEqual(gatherIdempotenceFacts({ parent: 10, ...OR, caller: gh.caller }), { state: 'OPEN', stateReason: '', comments, login: 'bot' });
  assert.deepEqual(argvOf(gh.calls), [SHAPE.live(10), SHAPE.login()]);

  gh = makeGh({ parentLive: { 10: { state: 'CLOSED', stateReason: 'COMPLETED', comments: [] } } });
  assert.equal(gatherIdempotenceFacts({ parent: 10, ...OR, caller: gh.caller }).login, null);
  assert.deepEqual(argvOf(gh.calls), [SHAPE.live(10)]);

  gh = makeGh({ parentLive: { 10: { state: 'OPEN', stateReason: 'REOPENED', comments: 'not-an-array' } } });
  const reopened = gatherIdempotenceFacts({ parent: 10, ...OR, caller: gh.caller });
  assert.equal(reopened.login, null);
  assert.deepEqual(reopened.comments, []);
  assert.deepEqual(argvOf(gh.calls), [SHAPE.live(10)]);
});

// --- the origin host (GitHub Enterprise Server) ---

const GHE = 'ghe.example.com';
// A github.com argv as the gate sends it to GHE: `--repo` host-qualified, every `gh api` read `--hostname`d.
const onGhe = (args) => (args[0] === 'api' ? [...args, '--hostname', GHE] : args.map((a) => (a === 'o/r' ? `${GHE}/o/r` : a)));
// fetch-sub-issues.js sends its GraphQL reads (4a, 4b) with the host right after `graphql`.
const graphqlOnGhe = (args) => ['api', 'graphql', '--hostname', GHE, ...args.slice(2)];
// makeGh's world reached through GHE argv: the fake takes the host back off before answering,
// so a read missing it, or carrying it twice, still shows in the recorded argv.
function makeGheGh(world) {
  const inner = makeGh(world);
  const calls = [];
  const gh = (args) => {
    calls.push({ args });
    const n = args.length;
    const gqlHost = args[0] === 'api' && args[1] === 'graphql' && args[2] === '--hostname' && args[3] === GHE;
    const plain = gqlHost
      ? ['api', 'graphql', ...args.slice(4)]
      : args[0] === 'api' && args[n - 2] === '--hostname' && args[n - 1] === GHE
        ? args.slice(0, -2)
        : args.map((a) => (a === `${GHE}/o/r` ? 'o/r' : a));
    return inner.gh(plain);
  };
  return { calls, caller: ghCaller(gh) };
}
const NATIVE_WORLD = { parentOf: { 11: 10 }, subs: { 10: [12, 11] } };
const BODY_WORLD = { bodies: { 11: 'Intro\n\nParent: #10\n', 10: '- [ ] #11\n- [x] #12\n' } };

test('with an Enterprise host every read carries the host-qualified slug or --hostname', () => {
  let gh = makeGheGh(NATIVE_WORLD);
  assert.deepEqual(gatherGateFacts({ subIssue: 11, ...NATIVE, host: GHE, caller: gh.caller }).subIssues.map((s) => s.number), [11, 12]);
  assert.deepEqual(argvOf(gh.calls), [onGhe(SHAPE.parent(11)), graphqlOnGhe(SHAPE.probe()), graphqlOnGhe(SHAPE.page(10)), onGhe(SHAPE.sub(11)), onGhe(SHAPE.sub(12)), onGhe(SHAPE.labels(10))]);

  gh = makeGheGh(BODY_WORLD);
  assert.equal(gatherGateFacts({ subIssue: 11, ...OR, workLinks: 'body-text', host: GHE, caller: gh.caller }).parent, 10);
  assert.deepEqual(argvOf(gh.calls), [SHAPE.body(11), SHAPE.body(10), SHAPE.sub(11), SHAPE.sub(12), SHAPE.labels(10)].map(onGhe));

  // 4c: fetch-sub-issues.js adds its own --hostname to the REST ladder; it is not added twice.
  const page = Array.from({ length: 100 }, (_, i) => 100 + i);
  gh = makeGheGh({ subs: { 10: page }, hasNextPage: { 10: true }, rest: { 10: [...page, 200] } });
  assert.equal(enumerateSubIssues({ parent: 10, ...NATIVE, host: GHE, caller: gh.caller }).length, 101);
  assert.deepEqual(argvOf(gh.calls), [graphqlOnGhe(SHAPE.probe()), graphqlOnGhe(SHAPE.page(10)), onGhe(SHAPE.rest(10))]);

  // 4d, sent by the gather itself.
  gh = makeGheGh({ probeFields: ['title'], rest: { 10: [11] } });
  assert.deepEqual(enumerateSubIssues({ parent: 10, ...NATIVE, host: GHE, caller: gh.caller }), [11]);
  assert.deepEqual(argvOf(gh.calls), [graphqlOnGhe(SHAPE.probe()), onGhe(SHAPE.rest(10))]);

  const seen = [];
  const fetcher = (argv, deps) => { seen.push(argv); deps.stdout(`${JSON.stringify({ byParent: { 10: [11] }, retry: [] })}\n`); return 0; };
  enumerateSubIssues({ parent: 10, ...NATIVE, host: GHE, caller: makeGheGh({}).caller, fetcher });
  assert.deepEqual(seen, [['10', '--repo', `${GHE}/o/r`, '--resolve-retries']]);

  gh = makeGheGh({});
  assert.equal(gatherIdempotenceFacts({ parent: 10, ...OR, host: GHE, caller: gh.caller }).login, 'bot');
  assert.deepEqual(argvOf(gh.calls), [SHAPE.live(10), SHAPE.login()].map(onGhe));
});

test('with no host, or github.com, the argv is the github.com argv', () => {
  for (const host of [undefined, null, 'github.com']) {
    let gh = makeGh(NATIVE_WORLD);
    gatherGateFacts({ subIssue: 11, ...NATIVE, host, caller: gh.caller });
    assert.deepEqual(argvOf(gh.calls), [SHAPE.parent(11), SHAPE.probe(), SHAPE.page(10), SHAPE.sub(11), SHAPE.sub(12), SHAPE.labels(10)], String(host));

    gh = makeGh(BODY_WORLD);
    gatherGateFacts({ subIssue: 11, ...OR, workLinks: 'body-text', host, caller: gh.caller });
    assert.deepEqual(argvOf(gh.calls), [SHAPE.body(11), SHAPE.body(10), SHAPE.sub(11), SHAPE.sub(12), SHAPE.labels(10)], String(host));

    gh = makeGh({ probeFields: ['title'], rest: { 10: [11] } });
    enumerateSubIssues({ parent: 10, ...NATIVE, host, caller: gh.caller });
    assert.deepEqual(argvOf(gh.calls), [SHAPE.probe(), SHAPE.rest(10)], String(host));

    gh = makeGh({});
    gatherIdempotenceFacts({ parent: 10, ...OR, host, caller: gh.caller });
    assert.deepEqual(argvOf(gh.calls), [SHAPE.live(10), SHAPE.login()], String(host));
  }
});

test('closeBelowFloorParents composes the shared core (one implementation)', () => {
  const file = require.resolve('../../../plugin/bin/lib/issues/below-floor-parent-close');
  const closer = require(file);
  const core = require('../../../plugin/bin/lib/issues/parent-gate');
  assert.strictEqual(closer.isCloseMarkerComment, core.isCloseMarkerComment);
  assert.equal(closer.CLOSE_HEADING, core.CLOSE_HEADING);
  const source = require('fs').readFileSync(file, 'utf8');
  assert.ok(source.includes("require('./parent-gate')"), 'requires the shared core');
  for (const gone of ["require('./acceptance')", "require('./oversight-floor')", "require('./native-dependencies')", "require('./comment-trust')", 'sub_issues']) {
    assert.ok(!source.includes(gone), `no longer carries ${gone}`);
  }
});

test("listOmitsSubIssue: only a non-empty list that lacks the sub-issue is an omission", () => {
  assert.equal(listOmitsSubIssue([12, 30], 20), true);
  assert.equal(listOmitsSubIssue([12, 20], 20), false);
  assert.equal(listOmitsSubIssue([], 20), false, "an empty list keeps the parent");
});
