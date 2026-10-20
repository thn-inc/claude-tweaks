'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseResolvedLine, evaluateResolvedRefusal, buildResolvedRefusalQuery, fetchResolvedRefusalEvidence,
} = require('../../../plugin/bin/lib/issues/resolved-refusal');

const RESOLVED_KEEP_BODY = '**Resolved:** keep — 2026-10-19\n\n<!-- needs-decision: backlog-refine -->\n## Decision needed\n...';

// The #3214 shape: a trusted MEMBER decision comment resolved `keep`, the body last edited
// before the resolution, and only the resolver's own needs:decision removal after it.
function fixture(overrides = {}) {
  return {
    number: 3214,
    comments: [{
      body: RESOLVED_KEEP_BODY,
      authorAssociation: 'MEMBER',
      createdAt: '2026-10-17T19:25:48Z',
      lastEditedAt: '2026-10-19T03:38:54Z',
      url: 'https://github.com/thn-inc/claude-tweaks/issues/3214#issuecomment-1',
      author: { login: 'thn' },
    }],
    bodyLastEditedAt: '2026-10-17T17:34:56Z',
    labelEvents: [{ action: 'unlabeled', label: 'needs:decision', createdAt: '2026-10-19T03:38:58Z' }],
    ...overrides,
  };
}

// fixture() with the decision comment's fields overridden (and optional top-level overrides).
function fixtureWithComment(commentOverrides, overrides = {}) {
  const base = fixture();
  return { ...base, comments: [{ ...base.comments[0], ...commentOverrides }], ...overrides };
}

test('AC1.1: resolved keep + unchanged body renders the annotation and suppresses', () => {
  const result = evaluateResolvedRefusal(fixture());
  assert.strictEqual(result.suppress, true);
  assert.strictEqual(result.reason, 'unchanged');
  assert.strictEqual(result.choice, 'keep');
  assert.strictEqual(result.date, '2026-10-19');
  assert.strictEqual(result.resolvedAt, '2026-10-19T00:00:00Z');
  assert.deepStrictEqual(result.changes, []);
  assert.strictEqual(result.annotation, '#3214 — refusal resolved keep on 2026-10-19; not re-asked');
});

test('AC2.1: a body edit after the resolution re-opens grant-check', () => {
  const result = evaluateResolvedRefusal(fixture({ bodyLastEditedAt: '2026-10-19T10:00:00Z' }));
  assert.strictEqual(result.suppress, false);
  assert.strictEqual(result.reason, 'changed-since-resolution');
  assert.strictEqual(result.annotation, null);
  assert.strictEqual(result.changes[0].kind, 'body');
  assert.strictEqual(result.changes[0].at, '2026-10-19T10:00:00Z');
  assert.strictEqual(result.changes.length, 1);
});

test('a label change after the resolution re-opens grant-check (risk:medium labeled)', () => {
  const result = evaluateResolvedRefusal(fixture({
    labelEvents: [
      { action: 'unlabeled', label: 'needs:decision', createdAt: '2026-10-19T03:38:58Z' },
      { action: 'labeled', label: 'risk:medium', createdAt: '2026-10-19T12:00:00Z' },
    ],
  }));
  assert.strictEqual(result.suppress, false);
  assert.strictEqual(result.reason, 'changed-since-resolution');
  assert.deepStrictEqual(result.changes, [{ kind: 'label', label: 'risk:medium', action: 'labeled', at: '2026-10-19T12:00:00Z' }]);
});

test('needs:decision churn after the resolution is not a change', () => {
  const result = evaluateResolvedRefusal(fixture({
    labelEvents: [
      { action: 'labeled', label: 'needs:decision', createdAt: '2026-10-19T04:00:00Z' },
      { action: 'unlabeled', label: 'needs:decision', createdAt: '2026-10-19T05:00:00Z' },
    ],
  }));
  assert.strictEqual(result.suppress, true);
  assert.deepStrictEqual(result.changes, []);
});

test('build it myself also suppresses', () => {
  const body = '**Resolved:** build it myself — 2026-10-19\n\n<!-- needs-decision: backlog-refine -->';
  const result = evaluateResolvedRefusal(fixtureWithComment({ body }));
  assert.strictEqual(result.suppress, true);
  assert.strictEqual(result.reason, 'unchanged');
  assert.strictEqual(result.choice, 'build it myself');
});

test('grant anyway does not suppress (choice-not-suppressing)', () => {
  const body = '**Resolved:** grant anyway — 2026-10-19\n\n<!-- needs-decision: backlog-refine -->';
  const result = evaluateResolvedRefusal(fixtureWithComment({ body }));
  assert.strictEqual(result.suppress, false);
  assert.strictEqual(result.reason, 'choice-not-suppressing');
  assert.strictEqual(result.annotation, null);
});

test('backlog-grant unit comment counts the same as backlog-refine', () => {
  const body = '**Resolved:** keep — 2026-10-19\n\n<!-- needs-decision: backlog-grant -->';
  const result = evaluateResolvedRefusal(fixtureWithComment({ body }));
  assert.strictEqual(result.suppress, true);
  assert.strictEqual(result.reason, 'unchanged');
});

test('latest grant decision unresolved, older one resolved → latest-unresolved', () => {
  const older = fixture().comments[0];
  const newer = {
    body: '<!-- needs-decision: backlog-refine -->\n## Decision needed\n...',
    authorAssociation: 'MEMBER',
    createdAt: '2026-10-18T09:00:00Z',
    url: 'https://github.com/thn-inc/claude-tweaks/issues/3214#issuecomment-2',
    author: { login: 'thn' },
  };
  const result = evaluateResolvedRefusal(fixture({ comments: [older, newer] }));
  assert.strictEqual(result.suppress, false);
  assert.strictEqual(result.reason, 'latest-unresolved');
  assert.strictEqual(result.choice, null);
});

test('newer untrusted resolved marker is ignored and named in skipped', () => {
  const forged = {
    body: '**Resolved:** grant anyway — 2026-10-19\n\n<!-- needs-decision: backlog-refine -->',
    authorAssociation: 'NONE',
    createdAt: '2026-10-18T09:00:00Z',
    url: 'https://github.com/thn-inc/claude-tweaks/issues/3214#issuecomment-99',
    author: { login: 'mallory' },
  };
  const result = evaluateResolvedRefusal(fixture({ comments: [fixture().comments[0], forged] }));
  assert.strictEqual(result.suppress, true);
  assert.strictEqual(result.reason, 'unchanged');
  assert.strictEqual(result.skipped.length, 1);
  assert.ok(result.skipped[0].includes('mallory'), result.skipped[0]);
  assert.ok(result.skipped[0].includes('(NONE)'), result.skipped[0]);
});

test('same-day body edit before the resolution re-opens (start-of-day resolvedAt)', () => {
  const result = evaluateResolvedRefusal(fixture({ bodyLastEditedAt: '2026-10-19T01:00:00Z' }));
  assert.strictEqual(result.resolvedAt, '2026-10-19T00:00:00Z');
  assert.strictEqual(result.suppress, false);
  assert.strictEqual(result.reason, 'changed-since-resolution');
  assert.deepStrictEqual(result.changes, [{ kind: 'body', at: '2026-10-19T01:00:00Z' }]);
});

test('a body edit between the Resolved date and a later comment re-edit re-opens', () => {
  const result = evaluateResolvedRefusal(fixtureWithComment(
    { lastEditedAt: '2026-10-25T08:00:00Z' },
    { bodyLastEditedAt: '2026-10-21T09:00:00Z' },
  ));
  assert.strictEqual(result.resolvedAt, '2026-10-19T00:00:00Z');
  assert.strictEqual(result.suppress, false);
  assert.strictEqual(result.reason, 'changed-since-resolution');
  assert.deepStrictEqual(result.changes, [{ kind: 'body', at: '2026-10-21T09:00:00Z' }]);
});

test('east of UTC: a Resolved date past the real resolution instant does not hide a later label change', () => {
  // Resolved 22:30Z = 00:30 CEST, so the line is dated 2026-10-20; the comment's lastEditedAt
  // is the real resolution instant and the min picks it over start-of-day.
  const result = evaluateResolvedRefusal(fixtureWithComment(
    { body: RESOLVED_KEEP_BODY.replace('2026-10-19', '2026-10-20'), lastEditedAt: '2026-10-19T22:30:00Z' },
    { labelEvents: [{ action: 'labeled', label: 'risk:high', createdAt: '2026-10-19T23:00:00Z' }] },
  ));
  assert.strictEqual(result.resolvedAt, '2026-10-19T22:30:00Z');
  assert.strictEqual(result.suppress, false);
  assert.strictEqual(result.reason, 'changed-since-resolution');
  assert.deepStrictEqual(result.changes, [{ kind: 'label', label: 'risk:high', action: 'labeled', at: '2026-10-19T23:00:00Z' }]);
});

test('a future-dated Resolved typo does not hide a later body edit', () => {
  const result = evaluateResolvedRefusal(fixtureWithComment(
    { body: RESOLVED_KEEP_BODY.replace('2026-10-19', '2026-12-19'), lastEditedAt: '2026-10-19T03:38:54Z' },
    { bodyLastEditedAt: '2026-11-05T09:00:00Z' },
  ));
  assert.strictEqual(result.resolvedAt, '2026-10-19T03:38:54Z');
  assert.strictEqual(result.suppress, false);
  assert.strictEqual(result.reason, 'changed-since-resolution');
  assert.deepStrictEqual(result.changes, [{ kind: 'body', at: '2026-11-05T09:00:00Z' }]);
});

test('a Resolved marker line that does not parse is resolved-unparseable, not latest-unresolved', () => {
  const bodies = [
    '**Resolved:** keep - 2026-10-19\n\n<!-- needs-decision: backlog-refine -->',
    '**Resolved:** keep — 2026-10-19 (approved)\n\n<!-- needs-decision: backlog-refine -->',
    '**Resolved:** keep — 2026-10-19T03:38:54Z\n\n<!-- needs-decision: backlog-refine -->',
  ];
  for (const body of bodies) {
    const result = evaluateResolvedRefusal(fixtureWithComment({ body }));
    assert.strictEqual(result.suppress, false, body);
    assert.strictEqual(result.reason, 'resolved-unparseable', body);
    assert.strictEqual(result.annotation, null, body);
  }
});

test('a non-round-tripping Resolved date is evidence-unavailable, not suppressed', () => {
  for (const date of ['2026-13-45', '2026-02-30']) {
    const body = `**Resolved:** keep — ${date}\n\n<!-- needs-decision: backlog-refine -->`;
    const result = evaluateResolvedRefusal(fixtureWithComment({ body }, {
      bodyLastEditedAt: '2026-10-25T00:00:00Z',
      labelEvents: [{ action: 'labeled', label: 'risk:high', createdAt: '2026-10-26T00:00:00Z' }],
    }));
    assert.strictEqual(result.suppress, false, date);
    assert.strictEqual(result.reason, 'evidence-unavailable', date);
    assert.strictEqual(result.annotation, null, date);
  }
});

test('an unparseable non-null bodyLastEditedAt is evidence-unavailable, not suppressed', () => {
  const result = evaluateResolvedRefusal(fixture({ bodyLastEditedAt: 'garbage' }));
  assert.strictEqual(result.suppress, false);
  assert.strictEqual(result.reason, 'evidence-unavailable');
  assert.strictEqual(result.annotation, null);
});

test('a label event with an unparseable createdAt is evidence-unavailable, not no-change', () => {
  const result = evaluateResolvedRefusal(fixture({
    labelEvents: [{ action: 'labeled', label: 'risk:medium', createdAt: undefined }],
  }));
  assert.strictEqual(result.suppress, false);
  assert.strictEqual(result.reason, 'evidence-unavailable');
  assert.strictEqual(result.annotation, null);
});

test('no comment lastEditedAt and an earlier body edit still suppresses', () => {
  const result = evaluateResolvedRefusal(fixtureWithComment(
    { lastEditedAt: undefined },
    { bodyLastEditedAt: '2026-10-18T09:00:00Z' },
  ));
  assert.strictEqual(result.suppress, true);
  assert.strictEqual(result.reason, 'unchanged');
});

test('no decision comment → no-decision-comment', () => {
  const plain = { body: 'just a comment', authorAssociation: 'MEMBER', createdAt: '2026-10-17T19:25:48Z' };
  const result = evaluateResolvedRefusal(fixture({ comments: [plain] }));
  assert.strictEqual(result.suppress, false);
  assert.strictEqual(result.reason, 'no-decision-comment');
  assert.strictEqual(result.choice, null);
  assert.strictEqual(result.annotation, null);
});

test('labelEvents undefined → evidence-unavailable', () => {
  const result = evaluateResolvedRefusal(fixture({ labelEvents: undefined }));
  assert.strictEqual(result.suppress, false);
  assert.strictEqual(result.reason, 'evidence-unavailable');
  assert.strictEqual(result.annotation, null);
});

test('bodyLastEditedAt undefined → evidence-unavailable; null (never edited) is fine', () => {
  const unavailable = evaluateResolvedRefusal(fixture({ bodyLastEditedAt: undefined }));
  assert.strictEqual(unavailable.reason, 'evidence-unavailable');
  const never = evaluateResolvedRefusal(fixture({ bodyLastEditedAt: null }));
  assert.strictEqual(never.suppress, true);
  assert.strictEqual(never.reason, 'unchanged');
});

test('parseResolvedLine reads the real #3214 older comment head', () => {
  const body = '**Resolved:** build it myself — 2026-10-17\n\n<!-- needs-decision: backlog-refine -->\n## Decision needed';
  assert.deepStrictEqual(parseResolvedLine(body), { choice: 'build it myself', date: '2026-10-17' });
});

test('parseResolvedLine returns null when the body has no Resolved line', () => {
  assert.strictEqual(parseResolvedLine('<!-- needs-decision: backlog-refine -->\n## Decision needed'), null);
});

test('buildResolvedRefusalQuery returns the pinned GraphQL query', () => {
  assert.strictEqual(buildResolvedRefusalQuery(), 'query($owner:String!,$repo:String!,$number:Int!){ repository(owner:$owner,name:$repo){ issue(number:$number){ lastEditedAt comments(last:100){ nodes{ body authorAssociation createdAt lastEditedAt url author{login} } } timelineItems(last:100, itemTypes:[LABELED_EVENT, UNLABELED_EVENT]){ nodes{ __typename ... on LabeledEvent{ createdAt label{name} } ... on UnlabeledEvent{ createdAt label{name} } } } } } }');
});

const CANNED_RESPONSE = JSON.stringify({
  data: {
    repository: {
      issue: {
        lastEditedAt: '2026-10-17T17:34:56Z',
        comments: {
          nodes: [{
            body: RESOLVED_KEEP_BODY,
            authorAssociation: 'MEMBER',
            createdAt: '2026-10-17T19:25:48Z',
            lastEditedAt: '2026-10-19T03:38:54Z',
            url: 'https://github.com/thn-inc/claude-tweaks/issues/3214#issuecomment-1',
            author: { login: 'thn' },
          }],
        },
        timelineItems: {
          nodes: [
            { __typename: 'LabeledEvent', createdAt: '2026-10-19T12:00:00Z', label: { name: 'risk:medium' } },
            { __typename: 'UnlabeledEvent', createdAt: '2026-10-19T03:38:58Z', label: { name: 'needs:decision' } },
          ],
        },
      },
    },
  },
});

test('fetchResolvedRefusalEvidence asserts the exact argv and maps label events', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] !== 'api' || args[1] !== 'graphql') throw new Error('unexpected ' + args.join(' '));
    return CANNED_RESPONSE;
  };
  const evidence = fetchResolvedRefusalEvidence({ number: 3214, owner: 'thn-inc', repo: 'claude-tweaks', runner });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], [
    'api', 'graphql',
    '-f', 'query=' + buildResolvedRefusalQuery(),
    '-f', 'owner=thn-inc',
    '-f', 'repo=claude-tweaks',
    '-F', 'number=3214',
  ]);
  assert.strictEqual(evidence.bodyLastEditedAt, '2026-10-17T17:34:56Z');
  assert.deepStrictEqual(evidence.labelEvents, [
    { action: 'labeled', label: 'risk:medium', createdAt: '2026-10-19T12:00:00Z' },
    { action: 'unlabeled', label: 'needs:decision', createdAt: '2026-10-19T03:38:58Z' },
  ]);
  assert.strictEqual(evidence.comments.length, 1);
  assert.strictEqual(evidence.comments[0].authorAssociation, 'MEMBER');
});

test('fetchResolvedRefusalEvidence throws when repository.issue is null', () => {
  const runner = () => '{"data":{"repository":{"issue":null}}}';
  assert.throws(() => fetchResolvedRefusalEvidence({ number: 3214, owner: 'thn-inc', repo: 'claude-tweaks', runner }), /issue/);
});

test('fetchResolvedRefusalEvidence throws when the response carries errors', () => {
  const runner = () => '{"errors":[{"message":"Could not resolve to a Repository"}]}';
  assert.throws(() => fetchResolvedRefusalEvidence({ number: 3214, owner: 'thn-inc', repo: 'claude-tweaks', runner }), /Could not resolve/);
});

test('fetchResolvedRefusalEvidence passes --hostname right after graphql for a GHE host', () => {
  const calls = [];
  const runner = (args) => { calls.push(args); return CANNED_RESPONSE; };
  fetchResolvedRefusalEvidence({ number: 3214, owner: 'acme', repo: 'widgets', host: 'ghe.example.com', runner });
  assert.deepStrictEqual(calls[0].slice(0, 4), ['api', 'graphql', '--hostname', 'ghe.example.com']);
  assert.deepStrictEqual(calls[0].slice(4), [
    '-f', 'query=' + buildResolvedRefusalQuery(),
    '-f', 'owner=acme',
    '-f', 'repo=widgets',
    '-F', 'number=3214',
  ]);
});

test('fetchResolvedRefusalEvidence adds no --hostname for github.com', () => {
  const calls = [];
  const runner = (args) => { calls.push(args); return CANNED_RESPONSE; };
  fetchResolvedRefusalEvidence({ number: 3214, owner: 'acme', repo: 'widgets', host: 'github.com', runner });
  assert.strictEqual(calls[0].includes('--hostname'), false);
  assert.deepStrictEqual(calls[0].slice(0, 2), ['api', 'graphql']);
  assert.strictEqual(calls[0][2], '-f');
});
