'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBlockerLandingQuery, candidateCommits, reachabilityFromStatus, compareArgs,
  classifyBlocker, undeterminedAll, classifyFromState, fetchBlockerLanding,
} = require('../../../plugin/bin/lib/preflight-records/blocker-landing');

const isGraphQL = (a) => a[0] === 'api' && a[1] === 'graphql';
const isCompare = (a) => a[0] === 'api' && /\/compare\//.test(a[1]);

const pr = (number, oid, { merged = true, base = 'production' } = {}) => ({
  number, merged, baseRefName: base, mergeCommit: oid ? { oid } : null,
});
function closed({ reason = 'COMPLETED', closer = null, refs = [] } = {}) {
  return {
    number: 0,
    state: 'CLOSED',
    stateReason: reason,
    timelineItems: { nodes: [{ closer }] },
    closedByPullRequestsReferences: { nodes: refs },
  };
}
const open = () => ({ number: 0, state: 'OPEN', stateReason: null, timelineItems: { nodes: [] }, closedByPullRequestsReferences: { nodes: [] } });

// repository: the data.repository object to answer; statuses: sha -> compare
// stdout, or an Error to throw. Records every argv; asserts happen after.
function fakeRunner({ repository, statuses = {}, graphql } = {}) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isGraphQL(args)) {
      if (graphql) return graphql(args);
      return JSON.stringify({ data: { repository } });
    }
    if (isCompare(args)) {
      const sha = args[1].split('...').pop();
      const s = statuses[sha];
      if (s instanceof Error) throw s;
      if (s === undefined) throw new Error(`unexpected compare ${sha}`);
      return s;
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  runner.calls = calls;
  runner.compares = () => calls.filter(isCompare);
  return runner;
}
const base = { owner: 'acme', repo: 'w', integrationBranch: 'dev' };

test('AC1.1: incident — closer PR merged into production, compare diverged → unlanded with that merge commit', () => {
  const runner = fakeRunner({
    repository: { b5: closed({ closer: { __typename: 'PullRequest', ...pr(90, 'aaa111') }, refs: [pr(90, 'aaa111')] }) },
    statuses: { aaa111: 'diverged\n' },
  });
  const { results, error } = fetchBlockerLanding({ ...base, blockers: [5], runner });
  assert.equal(error, null);
  assert.deepEqual(results.get(5), { blocker: 5, verdict: 'unlanded', commit: 'aaa111', via: 'closer-pr' });
  assert.equal(runner.compares().length, 1);
  assert.deepEqual(runner.compares()[0], ['api', 'repos/acme/w/compare/dev...aaa111', '--jq', '.status']);
});

test('AC2.1: closer merge commit behind or identical → landed', () => {
  for (const status of ['behind', 'identical']) {
    const runner = fakeRunner({
      repository: { b5: closed({ closer: { __typename: 'PullRequest', ...pr(90, 'aaa111') } }) },
      statuses: { aaa111: `${status}\n` },
    });
    const { results } = fetchBlockerLanding({ ...base, blockers: [5], runner });
    assert.deepEqual(results.get(5), { blocker: 5, verdict: 'landed', commit: 'aaa111', via: 'closer-pr' }, status);
  }
});

test('AC2.2: NOT_PLANNED and DUPLICATE → not-applicable, no compare call', () => {
  for (const reason of ['NOT_PLANNED', 'DUPLICATE']) {
    const runner = fakeRunner({
      repository: { b5: closed({ reason, closer: { __typename: 'PullRequest', ...pr(90, 'aaa111') } }) },
    });
    const { results } = fetchBlockerLanding({ ...base, blockers: [5], runner });
    assert.deepEqual(results.get(5), { blocker: 5, verdict: 'not-applicable', commit: null, via: 'state-reason' }, reason);
    assert.equal(runner.compares().length, 0, reason);
  }
});

test('AC2.3: COMPLETED, null closer, no merged closing PR → undetermined no-candidate', () => {
  const runner = fakeRunner({ repository: { b5: closed({ refs: [{ number: 91, merged: false, mergeCommit: null }] }) } });
  const { results } = fetchBlockerLanding({ ...base, blockers: [5], runner });
  assert.deepEqual(results.get(5), { blocker: 5, verdict: 'undetermined', commit: null, via: 'no-candidate' });
  assert.equal(runner.compares().length, 0);
});

test('AC10.1: null closer falls back to a merged closing-PR reference', () => {
  const runner = fakeRunner({ repository: { b5: closed({ refs: [pr(92, 'bbb222', { base: 'dev' })] }) }, statuses: { bbb222: 'behind' } });
  const { results } = fetchBlockerLanding({ ...base, blockers: [5], runner });
  assert.deepEqual(results.get(5), { blocker: 5, verdict: 'landed', commit: 'bbb222', via: 'closing-pr-ref' });
});

test('AC10.1, AC10.2, AC10.3: mixed candidates — closer diverged, second merged reference behind → landed (union, any-candidate rule)', () => {
  const runner = fakeRunner({
    repository: { b5: closed({ closer: { __typename: 'PullRequest', ...pr(90, 'aaa111') }, refs: [pr(90, 'aaa111'), pr(93, 'ccc333', { base: 'dev' })] }) },
    statuses: { aaa111: 'diverged', ccc333: 'behind' },
  });
  const { results } = fetchBlockerLanding({ ...base, blockers: [5], runner });
  assert.deepEqual(results.get(5), { blocker: 5, verdict: 'landed', commit: 'ccc333', via: 'closing-pr-ref' });
  assert.equal(runner.compares().length, 2);
});

test('closer Commit object → candidate via closer-commit', () => {
  const node = closed({ closer: { __typename: 'Commit', oid: 'ddd444' }, refs: [pr(94, 'eee555')] });
  assert.deepEqual(candidateCommits(node), [
    { sha: 'ddd444', via: 'closer-commit' },
    { sha: 'eee555', via: 'closing-pr-ref' },
  ]);
  const runner = fakeRunner({ repository: { b5: node }, statuses: { ddd444: 'identical', eee555: 'diverged' } });
  const { results } = fetchBlockerLanding({ ...base, blockers: [5], runner });
  assert.deepEqual(results.get(5), { blocker: 5, verdict: 'landed', commit: 'ddd444', via: 'closer-commit' });
});

test('compare-API error → undetermined probe-failed; ahead → unlanded; unknown status → undetermined', () => {
  const node = () => closed({ closer: { __typename: 'PullRequest', ...pr(90, 'aaa111') } });
  let runner = fakeRunner({ repository: { b5: node() }, statuses: { aaa111: new Error('HTTP 404: Not Found') } });
  assert.deepEqual(fetchBlockerLanding({ ...base, blockers: [5], runner }).results.get(5),
    { blocker: 5, verdict: 'undetermined', commit: 'aaa111', via: 'probe-failed' });
  runner = fakeRunner({ repository: { b5: node() }, statuses: { aaa111: 'ahead\n' } });
  assert.deepEqual(fetchBlockerLanding({ ...base, blockers: [5], runner }).results.get(5),
    { blocker: 5, verdict: 'unlanded', commit: 'aaa111', via: 'closer-pr' });
  runner = fakeRunner({ repository: { b5: node() }, statuses: { aaa111: 'weird\n' } });
  assert.deepEqual(fetchBlockerLanding({ ...base, blockers: [5], runner }).results.get(5),
    { blocker: 5, verdict: 'undetermined', commit: 'aaa111', via: 'probe-failed' });
  assert.equal(reachabilityFromStatus(' behind\n'), 'reachable');
  assert.equal(reachabilityFromStatus('identical'), 'reachable');
  assert.equal(reachabilityFromStatus('ahead'), 'unreachable');
  assert.equal(reachabilityFromStatus('diverged'), 'unreachable');
  assert.equal(reachabilityFromStatus(''), 'error');
  assert.equal(reachabilityFromStatus(undefined), 'error');
  // An absent reach entry is a probe that never answered, not a landed commit.
  assert.deepEqual(classifyBlocker(5, node(), new Map()), { blocker: 5, verdict: 'undetermined', commit: 'aaa111', via: 'probe-failed' });
});

test('a closing-PR read cut at first:10 never claims unlanded — undetermined references-truncated; a reachable candidate still lands it', () => {
  const cut = (extra = {}) => ({
    ...closed({ closer: { __typename: 'PullRequest', ...pr(90, 'aaa111') } }),
    closedByPullRequestsReferences: { pageInfo: { hasNextPage: true }, nodes: [pr(90, 'aaa111')] },
    ...extra,
  });
  let runner = fakeRunner({ repository: { b5: cut() }, statuses: { aaa111: 'diverged' } });
  assert.deepEqual(fetchBlockerLanding({ ...base, blockers: [5], runner }).results.get(5),
    { blocker: 5, verdict: 'undetermined', commit: 'aaa111', via: 'references-truncated' });
  runner = fakeRunner({ repository: { b5: cut() }, statuses: { aaa111: 'behind' } });
  assert.deepEqual(fetchBlockerLanding({ ...base, blockers: [5], runner }).results.get(5),
    { blocker: 5, verdict: 'landed', commit: 'aaa111', via: 'closer-pr' });
  // The same diverged closer with no further page stays the incident's unlanded verdict.
  runner = fakeRunner({
    repository: { b5: cut({ closedByPullRequestsReferences: { pageInfo: { hasNextPage: false }, nodes: [pr(90, 'aaa111')] } }) },
    statuses: { aaa111: 'diverged' },
  });
  assert.deepEqual(fetchBlockerLanding({ ...base, blockers: [5], runner }).results.get(5),
    { blocker: 5, verdict: 'unlanded', commit: 'aaa111', via: 'closer-pr' });
});

test('probing stops at a blocker\'s first reachable candidate; a thrown compare call is reported in probeErrors with its cause', () => {
  const node = closed({ closer: { __typename: 'PullRequest', ...pr(90, 'aaa111') }, refs: [pr(93, 'ccc333', { base: 'dev' }), pr(94, 'ddd444', { base: 'dev' })] });
  let runner = fakeRunner({ repository: { b5: node }, statuses: { aaa111: 'behind', ccc333: 'behind', ddd444: 'behind' } });
  let out = fetchBlockerLanding({ ...base, blockers: [5], runner });
  assert.equal(runner.compares().length, 1, 'the closer is reachable, so the two references are never probed');
  assert.deepEqual(out.results.get(5), { blocker: 5, verdict: 'landed', commit: 'aaa111', via: 'closer-pr' });
  assert.deepEqual(out.probeErrors, []);

  runner = fakeRunner({ repository: { b5: node }, statuses: { aaa111: new Error('HTTP 404: Not Found'), ccc333: 'behind', ddd444: 'behind' } });
  out = fetchBlockerLanding({ ...base, blockers: [5], runner });
  assert.equal(runner.compares().length, 2, 'a failed closer probe does not stop the next candidate; the first reachable one does');
  assert.deepEqual(out.results.get(5), { blocker: 5, verdict: 'landed', commit: 'ccc333', via: 'closing-pr-ref' });
  assert.equal(out.probeErrors.length, 1);
  assert.equal(out.probeErrors[0].sha, 'aaa111');
  assert.match(out.probeErrors[0].message, /404/);
});

test('open blocker → open, no compare call', () => {
  const runner = fakeRunner({ repository: { b5: open() } });
  const { results } = fetchBlockerLanding({ ...base, blockers: [5], runner });
  assert.deepEqual(results.get(5), { blocker: 5, verdict: 'open', commit: null, via: 'state' });
  assert.equal(runner.compares().length, 0);
});

// The live-probed shape: gh api graphql exits 1 on any unresolved alias, but
// still prints the partial data on stdout.
function notFoundThrow({ errors, repository }) {
  return () => {
    throw Object.assign(new Error('gh: Could not resolve to an Issue with the number of 999999.'), {
      stdout: JSON.stringify({ data: { repository }, errors }),
    });
  };
}
const recoveredRepo = () => ({ b5: closed({ closer: { __typename: 'PullRequest', ...pr(90, 'aaa111') } }), b999999: null });

test('Review Focus 1: NOT_FOUND-only GraphQL error is recovered — the missing alias reads undetermined not-found, the others classify', () => {
  const runner = fakeRunner({
    graphql: notFoundThrow({ repository: recoveredRepo(), errors: [{ type: 'NOT_FOUND', path: ['repository', 'b999999'] }] }),
    statuses: { aaa111: 'behind' },
  });
  const { results, error } = fetchBlockerLanding({ ...base, blockers: [5, 999999], runner });
  assert.equal(error, null);
  assert.deepEqual(results.get(999999), { blocker: 999999, verdict: 'undetermined', commit: null, via: 'not-found' });
  assert.deepEqual(results.get(5), { blocker: 5, verdict: 'landed', commit: 'aaa111', via: 'closer-pr' });
});

test('AC9.1: a NOT_FOUND mixed with another error type is a whole-query failure', () => {
  const runner = fakeRunner({
    graphql: notFoundThrow({
      repository: recoveredRepo(),
      errors: [{ type: 'NOT_FOUND', path: ['repository', 'b999999'] }, { type: 'FORBIDDEN', path: ['repository', 'b999999'] }],
    }),
    statuses: { aaa111: 'behind' },
  });
  const { results, error } = fetchBlockerLanding({ ...base, blockers: [5, 999999], runner });
  assert.equal(results, null);
  assert.ok(error && error.length > 0);
  assert.equal(runner.compares().length, 0);
});

test('AC9.1: a NOT_FOUND on an unrequested alias path is a whole-query failure', () => {
  // Every requested alias resolves, so only the requested-alias check can reject this.
  const runner = fakeRunner({
    graphql: notFoundThrow({
      repository: { b5: closed({ closer: { __typename: 'PullRequest', ...pr(90, 'aaa111') } }) },
      errors: [{ type: 'NOT_FOUND', path: ['repository', 'b777'] }],
    }),
    statuses: { aaa111: 'behind' },
  });
  const { results, error } = fetchBlockerLanding({ ...base, blockers: [5], runner });
  assert.equal(results, null);
  assert.ok(error && error.length > 0);
  assert.equal(runner.compares().length, 0);
  // A thrown call whose stdout carries an empty errors array is not a NOT_FOUND recovery either.
  const emptyErrors = fakeRunner({
    graphql: notFoundThrow({ repository: { b5: closed({ closer: { __typename: 'PullRequest', ...pr(90, 'aaa111') } }) }, errors: [] }),
    statuses: { aaa111: 'behind' },
  });
  const thrown = fetchBlockerLanding({ ...base, blockers: [5], runner: emptyErrors });
  assert.equal(thrown.results, null, 'empty errors is not a recovery');
  assert.equal(emptyErrors.compares().length, 0);
});

test('AC9.1: a null or absent b{n} alias that no NOT_FOUND error names is a whole-query failure, zero compare calls', () => {
  const resolved = () => closed({ closer: { __typename: 'PullRequest', ...pr(90, 'aaa111') } });
  const cases = {
    'null alias, no errors': [[5, 6], () => JSON.stringify({ data: { repository: { b5: resolved(), b6: null } } })],
    'absent alias, no errors': [[5, 6], () => JSON.stringify({ data: { repository: { b5: resolved() } } })],
    // The recovery covers only the alias its NOT_FOUND names: b6 is null with no error of its own.
    'recovered throw, a second null alias unnamed': [[5, 6, 999999], notFoundThrow({
      repository: { b5: resolved(), b6: null, b999999: null },
      errors: [{ type: 'NOT_FOUND', path: ['repository', 'b999999'] }],
    })],
  };
  for (const [name, [blockers, graphql]] of Object.entries(cases)) {
    const runner = fakeRunner({ graphql, statuses: { aaa111: 'behind' } });
    const { results, error } = fetchBlockerLanding({ ...base, blockers, runner });
    assert.equal(results, null, name);
    assert.match(error, /\bb6\b/, `${name}: the error names the missing alias`);
    assert.equal(runner.compares().length, 0, name);
  }
});

test('AC9.1: a b{n} alias that is not a plain object (falsy, scalar, array) is a whole-query failure unless a NOT_FOUND names it', () => {
  const resolved = () => closed({ closer: { __typename: 'PullRequest', ...pr(90, 'aaa111') } });
  for (const value of [false, 0, '', 'x', 7, []]) {
    const label = JSON.stringify(value);
    const runner = fakeRunner({ repository: { b5: resolved(), b6: value }, statuses: { aaa111: 'behind' } });
    const { results, error } = fetchBlockerLanding({ ...base, blockers: [5, 6], runner });
    assert.equal(results, null, label);
    assert.match(error, /\bb6\b/, `${label}: the error names the malformed alias`);
    assert.equal(runner.compares().length, 0, label);
  }
  // Named by a NOT_FOUND, a malformed alias is the recovered not-found case.
  const runner = fakeRunner({
    graphql: notFoundThrow({ repository: { b5: resolved(), b6: [] }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'b6'] }] }),
    statuses: { aaa111: 'behind' },
  });
  const { results, error } = fetchBlockerLanding({ ...base, blockers: [5, 6], runner });
  assert.equal(error, null);
  assert.deepEqual(results.get(6), { blocker: 6, verdict: 'undetermined', commit: null, via: 'not-found' });
  assert.deepEqual(results.get(5), { blocker: 5, verdict: 'landed', commit: 'aaa111', via: 'closer-pr' });
});

test('Review Focus 1: a NOT_FOUND-only errors array on exit-0 stdout is accepted like the thrown-stdout recovery', () => {
  const runner = fakeRunner({
    graphql: () => JSON.stringify({ data: { repository: recoveredRepo() }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'b999999'] }] }),
    statuses: { aaa111: 'behind' },
  });
  const { results, error } = fetchBlockerLanding({ ...base, blockers: [5, 999999], runner });
  assert.equal(error, null);
  assert.deepEqual(results.get(999999), { blocker: 999999, verdict: 'undetermined', commit: null, via: 'not-found' });
  assert.deepEqual(results.get(5), { blocker: 5, verdict: 'landed', commit: 'aaa111', via: 'closer-pr' });
});

test('AC9.1: a NOT_FOUND whose path is longer than [repository, b{n}], or not rooted at repository, is a whole-query failure', () => {
  for (const path of [['repository', 'b5', 'x'], ['viewer', 'b5']]) {
    const runner = fakeRunner({
      graphql: notFoundThrow({ repository: { b5: closed({ closer: { __typename: 'PullRequest', ...pr(90, 'aaa111') } }) }, errors: [{ type: 'NOT_FOUND', path }] }),
      statuses: { aaa111: 'behind' },
    });
    const { results, error } = fetchBlockerLanding({ ...base, blockers: [5], runner });
    assert.equal(results, null, JSON.stringify(path));
    assert.ok(typeof error === 'string' && error.length > 0, JSON.stringify(path));
    assert.equal(runner.compares().length, 0, JSON.stringify(path));
  }
});

test('buildBlockerLandingQuery throws on a blocker that is not a positive safe integer; fetchBlockerLanding returns it as a whole-query failure with zero runner calls', () => {
  for (const bad of [0, -1, 1.5, '5', NaN, 2 ** 53, null]) {
    assert.throws(() => buildBlockerLandingQuery([5, bad]), /blocker/, String(bad));
    const runner = fakeRunner({ repository: { b5: open() } });
    let out;
    assert.doesNotThrow(() => { out = fetchBlockerLanding({ ...base, blockers: [5, bad], runner }); }, String(bad));
    assert.equal(out.results, null, String(bad));
    assert.ok(typeof out.error === 'string' && out.error.length > 0, String(bad));
    assert.equal(runner.calls.length, 0, String(bad));
  }
});

test('AC9.1: GraphQL throw with no parseable stdout, unparseable stdout, and data.repository null → whole-query failure, zero compare calls', () => {
  const cases = {
    'throw, no stdout': () => { throw new Error('HTTP 502'); },
    'throw, garbage stdout': () => { throw Object.assign(new Error('HTTP 502'), { stdout: '<html>' }); },
    'unparseable stdout': () => 'not json',
    'data.repository null': () => JSON.stringify({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', path: ['repository'] }] }),
    'non-NOT_FOUND errors on success': () => JSON.stringify({ data: { repository: recoveredRepo() }, errors: [{ type: 'RATE_LIMITED', message: 'slow down' }] }),
  };
  for (const [name, graphql] of Object.entries(cases)) {
    const runner = fakeRunner({ graphql, statuses: { aaa111: 'behind' } });
    const { results, error } = fetchBlockerLanding({ ...base, blockers: [5], runner });
    assert.equal(results, null, name);
    assert.ok(typeof error === 'string' && error.length > 0, name);
    assert.equal(runner.compares().length, 0, name);
  }
});

test('unmerged closer PR contributes no candidate', () => {
  const node = closed({ closer: { __typename: 'PullRequest', ...pr(90, null, { merged: false }) } });
  assert.deepEqual(candidateCommits(node), []);
  // merged:false with a stray mergeCommit still contributes nothing.
  assert.deepEqual(candidateCommits(closed({ closer: { __typename: 'PullRequest', ...pr(90, 'aaa111', { merged: false }) } })), []);
  const runner = fakeRunner({ repository: { b5: node } });
  assert.deepEqual(fetchBlockerLanding({ ...base, blockers: [5], runner }).results.get(5),
    { blocker: 5, verdict: 'undetermined', commit: null, via: 'no-candidate' });
  assert.equal(runner.compares().length, 0);
});

test('two blockers closed by the same PR cost one compare call', () => {
  const node = () => closed({ closer: { __typename: 'PullRequest', ...pr(90, 'aaa111') }, refs: [pr(90, 'aaa111')] });
  const runner = fakeRunner({ repository: { b5: node(), b6: node() }, statuses: { aaa111: 'behind' } });
  const { results } = fetchBlockerLanding({ ...base, blockers: [5, 6], runner });
  assert.equal(runner.compares().length, 1);
  assert.equal(results.get(5).verdict, 'landed');
  assert.equal(results.get(6).verdict, 'landed');
  assert.deepEqual(candidateCommits(node()), [{ sha: 'aaa111', via: 'closer-pr' }]);
});

test('empty blockers → zero runner calls', () => {
  const runner = fakeRunner({});
  const out = fetchBlockerLanding({ ...base, blockers: [], runner });
  assert.equal(out.error, null);
  assert.ok(out.results instanceof Map);
  assert.equal(out.results.size, 0);
  assert.equal(runner.calls.length, 0);
});

test('graphql argv: -f query/owner/repo, --hostname right after graphql only for a non-github.com host', () => {
  for (const [host, hostArgs] of [[undefined, []], ['github.com', []], ['ghe.example.com', ['--hostname', 'ghe.example.com']]]) {
    const runner = fakeRunner({ repository: { b5: open() } });
    fetchBlockerLanding({ ...base, host, blockers: [5], runner });
    assert.equal(runner.calls.length, 1, String(host));
    assert.deepEqual(runner.calls[0], [
      'api', 'graphql', ...hostArgs,
      '-f', `query=${buildBlockerLandingQuery([5])}`, '-f', 'owner=acme', '-f', 'repo=w',
    ], String(host));
  }
});

test('compareArgs encodes the integration branch per segment and adds --hostname for GHE', () => {
  const a = compareArgs({ owner: 'acme', repo: 'w', integrationBranch: 'release/v1#x', sha: 'aaa111' });
  assert.deepEqual(a, ['api', 'repos/acme/w/compare/release/v1%23x...aaa111', '--jq', '.status']);
  const ghe = compareArgs({ owner: 'acme', repo: 'w', host: 'ghe.example.com', integrationBranch: 'dev', sha: 'aaa111' });
  assert.deepEqual(ghe.slice(-2), ['--hostname', 'ghe.example.com']);
  const dotcom = compareArgs({ owner: 'acme', repo: 'w', host: 'github.com', integrationBranch: 'dev', sha: 'aaa111' });
  assert.ok(!dotcom.includes('--hostname'));
  for (const argv of [a, ghe, dotcom]) assert.ok(!argv.includes('-f') && !argv.includes('-F'), 'a compare read passes no field (would flip to POST)');
  for (const bad of [{ owner: '..' }, { owner: '.' }, { repo: '..' }, { repo: '.' }]) {
    assert.throws(() => compareArgs({ owner: 'acme', repo: 'w', integrationBranch: 'dev', sha: 'aaa111', ...bad }), JSON.stringify(bad));
  }
  // The fetch refuses a dot-segment owner before any call, as a whole-query failure.
  const runner = fakeRunner({ repository: { b5: open() } });
  const out = fetchBlockerLanding({ ...base, owner: '..', blockers: [5], runner });
  assert.equal(out.results, null);
  assert.ok(out.error);
  assert.equal(runner.calls.length, 0);
});

test('buildBlockerLandingQuery: null for [] and non-array; one b{n} alias per blocker with stateReason, CLOSED_EVENT last:1, closedByPullRequestsReferences includeClosedPrs:true', () => {
  assert.equal(buildBlockerLandingQuery([]), null);
  assert.equal(buildBlockerLandingQuery(undefined), null);
  assert.equal(buildBlockerLandingQuery('5'), null);
  const q = buildBlockerLandingQuery([5, 12]);
  assert.match(q, /^query\(\$owner:String!,\$repo:String!\)\{ repository\(owner:\$owner,name:\$repo\)\{/);
  for (const n of [5, 12]) {
    assert.ok(q.includes(
      `b${n}: issue(number:${n}){ number state stateReason timelineItems(itemTypes:[CLOSED_EVENT], last:1){ nodes{ ... on ClosedEvent { closer { __typename ... on PullRequest { number merged baseRefName mergeCommit{ oid } } ... on Commit { oid } } } } } closedByPullRequestsReferences(first:10, includeClosedPrs:true){ pageInfo{ hasNextPage } nodes{ number merged baseRefName mergeCommit{ oid } } } }`,
    ), `alias b${n}`);
  }
  assert.equal(q.match(/\bb\d+: issue\(/g).length, 2);
});

test('undeterminedAll: one undetermined result per blocker with the given via', () => {
  assert.deepEqual(undeterminedAll([5, 6], 'records-json'), [
    { blocker: 5, verdict: 'undetermined', commit: null, via: 'records-json' },
    { blocker: 6, verdict: 'undetermined', commit: null, via: 'records-json' },
  ]);
});

test('AC6.1 (gh-absent): classifyFromState — open/OPEN → open; closed not_planned/DUPLICATE (either key spelling) → not-applicable; closed completed/null → undetermined; non-object or unknown state → null', () => {
  for (const state of ['open', 'OPEN']) {
    assert.deepEqual(classifyFromState(5, { state }), { blocker: 5, verdict: 'open', commit: null, via: 'records-json' }, state);
  }
  for (const entry of [
    { state: 'closed', stateReason: 'not_planned' },
    { state: 'CLOSED', state_reason: 'DUPLICATE' },
    { state: 'closed', state_reason: 'NOT_PLANNED' },
    { state: 'Closed', stateReason: 'duplicate' },
  ]) {
    assert.deepEqual(classifyFromState(5, entry), { blocker: 5, verdict: 'not-applicable', commit: null, via: 'state-reason' }, JSON.stringify(entry));
  }
  for (const entry of [{ state: 'closed', stateReason: 'completed' }, { state: 'CLOSED', state_reason: null }, { state: 'closed' }]) {
    assert.deepEqual(classifyFromState(5, entry), { blocker: 5, verdict: 'undetermined', commit: null, via: 'records-json' }, JSON.stringify(entry));
  }
  for (const entry of [null, undefined, 'open', 7, [], {}, { state: 'merged' }, { state: null }]) {
    assert.equal(classifyFromState(5, entry), null, JSON.stringify(entry));
  }
});
