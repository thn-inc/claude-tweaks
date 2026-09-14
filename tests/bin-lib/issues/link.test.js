'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveDatabaseIds, linkSubIssues, linkBlockedBy, isAlreadyLinkedError,
} = require('../../../plugin/bin/lib/issues/link');

// Fake runners are lazy functions inspecting `args` only when called (CLAUDE.md's eager-IIFE ban).
const isGraphQL = (args) => args[0] === 'api' && args[1] === 'graphql';
const isPost = (args, path) => args[0] === 'api' && args[1] === '-X' && args[2] === 'POST' && args[3] === path;
const fieldOf = (args, name) => { const all = []; for (let k = 0; k < args.length; k++) if (args[k] === '-F') all.push(args[k + 1]); const hit = all.find((v) => v.startsWith(name + '=')); return hit ? hit.slice(name.length + 1) : undefined; };

function graphqlJSON(map) {
  const repository = {};
  for (const [n, id] of Object.entries(map)) repository[`i${n}`] = id == null ? null : { databaseId: id };
  return JSON.stringify({ data: { repository } });
}

test('resolveDatabaseIds: one GraphQL call with one alias per number, returns a Map', () => {
  const calls = [];
  const runner = (args) => { calls.push(args); if (isGraphQL(args)) return graphqlJSON({ 595: 5164237962, 597: 5164238330, 592: 5164219255 }); throw new Error('unexpected'); };
  const ids = resolveDatabaseIds({ owner: 'acme', repo: 'w', numbers: [595, 597, 592], runner });
  assert.equal(calls.length, 1, 'exactly one runner call');
  const q = calls[0].join(' ');
  assert.match(q, /i595: issue\(number:595\)\{ databaseId \}/);
  assert.match(q, /i597: issue\(number:597\)\{ databaseId \}/);
  assert.match(q, /i592: issue\(number:592\)\{ databaseId \}/);
  assert.match(q, /-f owner=acme -f repo=w/, 'owner/repo are resolved values → -f (raw string); -F would type-coerce numeric names');
  assert.doesNotMatch(q, /-F owner=/, 'never -F for a resolved owner value');
  assert.equal(ids.get(595), 5164237962);
  assert.equal(ids.get(592), 5164219255);
});

test('resolveDatabaseIds: dedupes numbers and throws on any missing id (never a partial map)', () => {
  const runner = (args) => { if (isGraphQL(args)) return graphqlJSON({ 595: 1, 597: null }); throw new Error('unexpected'); };
  assert.throws(
    () => resolveDatabaseIds({ owner: 'a', repo: 'b', numbers: [595, 597, 595], runner }),
    /missing databaseId for #597/,
  );
});

test('linkSubIssues: one POST per sub with the databaseId (never the number); one failure leaves siblings in ok', () => {
  const ids = new Map([[595, 111], [597, 222]]);
  const runner = (args) => {
    if (isPost(args, 'repos/acme/w/issues/592/sub_issues')) {
      const v = fieldOf(args, 'sub_issue_id');
      if (v === '222') throw new Error('HTTP 500 boom');
      return '{}';
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  const r = linkSubIssues({ owner: 'acme', repo: 'w', parent: 592, subs: [595, 597], ids, runner });
  assert.deepEqual(r.ok.map((o) => o.number), [595]);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].number, 597);
  assert.match(r.failed[0].error, /boom/);
});

test('linkSubIssues: never sends the issue number as sub_issue_id', () => {
  const ids = new Map([[595, 111]]);
  const seen = [];
  const runner = (args) => { seen.push(fieldOf(args, 'sub_issue_id')); return '{}'; };
  linkSubIssues({ owner: 'a', repo: 'b', parent: 592, subs: [595], ids, runner });
  assert.deepEqual(seen, ['111']);
});

test('linkBlockedBy: POST on the dependent with the blocker databaseId; 422 already-exists lands in ok with already:true', () => {
  const ids = new Map([[608, 10], [610, 20]]);
  const runner = (args) => {
    if (isPost(args, 'repos/acme/w/issues/610/dependencies/blocked_by')) {
      assert.equal(fieldOf(args, 'issue_id'), '10');
      const e = new Error('HTTP 422: Validation Failed'); e.stderr = '{"message":"Issue is already blocked by this issue"}'; throw e;
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  const r = linkBlockedBy({ owner: 'acme', repo: 'w', edges: [{ dependent: 610, blocker: 608 }], ids, runner });
  assert.equal(r.failed.length, 0);
  assert.deepEqual(r.ok, [{ dependent: 610, blocker: 608, already: true }]);
});

test('isAlreadyLinkedError: only a 422 whose message mentions already', () => {
  const e1 = new Error('HTTP 422'); e1.stderr = '{"message":"already a sub-issue"}';
  const e2 = new Error('HTTP 422'); e2.stderr = '{"message":"Validation Failed"}';
  const e3 = new Error('HTTP 500'); e3.stderr = '{"message":"already"}';
  assert.equal(isAlreadyLinkedError(e1), true);
  assert.equal(isAlreadyLinkedError(e2), false);
  assert.equal(isAlreadyLinkedError(e3), false);
});

const { run } = require('../../../plugin/bin/link-records');

function cliDeps({ runner, ghAvailable = true, remoteUrl = 'https://github.com/acme/w.git' } = {}) {
  const out = []; const err = []; const invalidateCalls = [];
  return {
    deps: {
      runner,
      ghAvailable: () => ghAvailable,
      remoteUrl: () => remoteUrl,
      invalidateSnapshot: (sessionId) => invalidateCalls.push(sessionId),
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    },
    out,
    err,
    invalidateCalls,
  };
}

test('link-records CLI: --help exits 0 and prints usage', () => {
  const { deps, out } = cliDeps({ runner: () => { throw new Error('must not call gh'); } });
  const code = run(['--help'], deps);
  assert.equal(code, 0);
  assert.match(out.join(''), /--parent <n> --subs <n,n,\.\.\.>/);
});

test('link-records CLI: gh absent exits 2 and names the body-text fallback', () => {
  const { deps, err } = cliDeps({ runner: () => { throw new Error('must not call gh'); }, ghAvailable: false });
  const code = run(['--parent', '592', '--subs', '595'], deps);
  assert.equal(code, 2);
  assert.match(err.join(''), /work-links: body-text/);
});

test('link-records CLI: happy path — 1 GraphQL + 1 sub_issues + 1 blocked_by, numeric ids in bodies, envelope printed', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isGraphQL(args)) return graphqlJSON({ 592: 1, 595: 2, 598: 3 });
    if (isPost(args, 'repos/acme/w/issues/592/sub_issues')) { assert.equal(fieldOf(args, 'sub_issue_id'), '2'); return '{}'; }
    if (isPost(args, 'repos/acme/w/issues/598/dependencies/blocked_by')) { assert.equal(fieldOf(args, 'issue_id'), '2'); return '{}'; }
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out, invalidateCalls } = cliDeps({ runner });
  const code = run(['--parent', '592', '--subs', '595', '--blocked-by', '598:595'], deps);
  assert.equal(code, 0);
  assert.equal(calls.filter(isGraphQL).length, 1);
  assert.equal(calls.filter((a) => a[1] === '-X').length, 2);
  const env = JSON.parse(out.join(''));
  assert.equal(env.repo, 'acme/w');
  assert.deepEqual(env.subIssues.ok.map((o) => o.number), [595]);
  assert.deepEqual(env.blockedBy.ok.map((o) => o.dependent), [598]);
  // #1097: a successful sub_issues link write must invalidate the session-scoped
  // sub-issues snapshot _shared/trust-table.md's native branch caches, or a
  // pre-existing issue linked mid-session stays invisible for the rest of the TTL.
  assert.equal(invalidateCalls.length, 1, 'expected one invalidateSnapshot call after a non-empty subIssues.ok write');
});

test('link-records CLI: blocked-by-only invocation (no sub_issues write) does not invalidate the snapshot', () => {
  const runner = (args) => {
    if (isGraphQL(args)) return graphqlJSON({ 598: 3, 595: 2 });
    if (isPost(args, 'repos/acme/w/issues/598/dependencies/blocked_by')) return '{}';
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, invalidateCalls } = cliDeps({ runner });
  const code = run(['--blocked-by', '598:595'], deps);
  assert.equal(code, 0);
  assert.equal(invalidateCalls.length, 0, 'a blocked-by-only write (no sub_issues.ok entries) must not invalidate the sub-issues snapshot');
});

test('link-records CLI: id resolution failure exits 1', () => {
  const runner = (args) => (isGraphQL(args) ? graphqlJSON({ 592: 1, 595: null }) : '{}');
  const { deps, err } = cliDeps({ runner });
  const code = run(['--parent', '592', '--subs', '595'], deps);
  assert.equal(code, 1);
  assert.match(err.join(''), /missing databaseId for #595/);
});

test('link-records CLI: partial write failure still exits 0 with failed populated', () => {
  const runner = (args) => {
    if (isGraphQL(args)) return graphqlJSON({ 592: 1, 595: 2, 597: 3 });
    if (isPost(args, 'repos/acme/w/issues/592/sub_issues') && fieldOf(args, 'sub_issue_id') === '3') throw new Error('HTTP 500');
    return '{}';
  };
  const { deps, out } = cliDeps({ runner });
  const code = run(['--parent', '592', '--subs', '595,597'], deps);
  assert.equal(code, 0);
  const env = JSON.parse(out.join(''));
  assert.equal(env.subIssues.failed.length, 1);
  assert.equal(env.subIssues.failed[0].number, 597);
});

test('link-records CLI: negative or zero numbers are a malformed invocation (exit 2)', () => {
  const { deps, err } = cliDeps({ runner: () => { throw new Error('must not call gh'); } });
  assert.equal(run(['--parent', '-5', '--subs', '595'], deps), 2);
  assert.equal(run(['--parent', '592', '--subs', '0'], deps), 2);
  assert.match(err.join(''), /usage:/);
});

test('link-records CLI: a blocked-by pair with a missing side is a malformed invocation (exit 2)', () => {
  const { deps, err } = cliDeps({ runner: () => { throw new Error('must not call gh'); } });
  assert.equal(run(['--parent', '592', '--subs', '595', '--blocked-by', '598:'], deps), 2);
  assert.match(err.join(''), /malformed --blocked-by pair/);
});

test('parseRepo: dotted repo names survive; only a trailing .git is stripped', () => {
  const { parseRepo } = require('../../../plugin/bin/link-records');
  assert.deepEqual(parseRepo('https://github.com/owner/my.repo.git'), { host: 'github.com', owner: 'owner', repo: 'my.repo' });
  assert.deepEqual(parseRepo('https://github.com/owner/my.repo'), { host: 'github.com', owner: 'owner', repo: 'my.repo' });
  assert.deepEqual(parseRepo('git@github.com:owner/repo.git'), { host: 'github.com', owner: 'owner', repo: 'repo' });
  assert.deepEqual(parseRepo('https://github.com/owner/repo/'), { host: 'github.com', owner: 'owner', repo: 'repo' });
  // #2240: parseRepo now widens to an arbitrary host (GitHub Enterprise Server support) —
  // a non-github.com host is no longer rejected, it's captured.
  assert.deepEqual(parseRepo('https://gitlab.com/owner/repo'), { host: 'gitlab.com', owner: 'owner', repo: 'repo' });
});

test('link-records CLI: blocked-by-only invocation is valid (no --parent/--subs)', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isGraphQL(args)) return graphqlJSON({ 598: 3, 595: 2 });
    if (isPost(args, 'repos/acme/w/issues/598/dependencies/blocked_by')) return '{}';
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner });
  const code = run(['--blocked-by', '598:595'], deps);
  assert.equal(code, 0);
  assert.equal(calls.filter(isGraphQL).length, 1);
  assert.equal(calls.filter((a) => a[1] === '-X').length, 1);
  const env = JSON.parse(out.join(''));
  assert.deepEqual(env.subIssues, { ok: [], failed: [] });
  assert.deepEqual(env.blockedBy.ok.map((o) => o.dependent), [598]);
});

test('link-records CLI: neither link kind given is a malformed invocation (exit 2)', () => {
  const { deps, err } = cliDeps({ runner: () => { throw new Error('must not call gh'); } });
  assert.equal(run(['--repo', 'acme/w'], deps), 2);
  assert.match(err.join(''), /at least one of/);
});

test('link-records CLI: --repo with no value is a malformed invocation (exit 2)', () => {
  const { deps, err } = cliDeps({ runner: () => { throw new Error('must not call gh'); } });
  assert.equal(run(['--parent', '592', '--subs', '595', '--repo'], deps), 2);
  assert.match(err.join(''), /missing value for --repo/);
});

test('link-records CLI: --repo owner/.. is rejected before any gh call (#1443: parseRepo accepts ".." segments)', () => {
  const { deps, err } = cliDeps({ runner: () => { throw new Error('must not call gh'); } });
  const code = run(['--parent', '592', '--subs', '595', '--repo', 'owner/..'], deps);
  assert.equal(code, 2);
  assert.match(err.join(''), /invalid --repo value/);
});

test('link-records CLI: --repo ../evil is rejected before any gh call', () => {
  const { deps, err } = cliDeps({ runner: () => { throw new Error('must not call gh'); } });
  const code = run(['--parent', '592', '--subs', '595', '--repo', '../evil'], deps);
  assert.equal(code, 2);
  assert.match(err.join(''), /invalid --repo value/);
});

test('resolveDatabaseIds: GraphQL errors[] surface in the missing-id message', () => {
  const runner = (args) => (isGraphQL(args) ? JSON.stringify({ data: { repository: null }, errors: [{ message: 'Could not resolve to a Repository' }] }) : '{}');
  assert.throws(
    () => resolveDatabaseIds({ owner: 'a', repo: 'b', numbers: [595], runner }),
    /missing databaseId for #595 \(GraphQL: Could not resolve to a Repository\)/,
  );
});

test('link-records CLI: a throwing remoteUrl (outside a git repo) is the friendly exit 2, not a crash', () => {
  const { deps, err } = cliDeps({ runner: () => { throw new Error('must not call gh'); } });
  deps.remoteUrl = () => { throw new Error('fatal: not a git repository'); };
  const code = run(['--parent', '592', '--subs', '595'], deps);
  assert.equal(code, 2);
  assert.match(err.join(''), /could not resolve owner\/repo — pass --repo/);
});

test('errorText fallback: a runner throwing a non-Error still yields a non-empty failed[].error', () => {
  const ids = new Map([[595, 111]]);
  // eslint-disable-next-line no-throw-literal
  const runner = () => { throw 'socket hang up'; };
  const r = linkSubIssues({ owner: 'a', repo: 'b', parent: 592, subs: [595], ids, runner });
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].error, 'socket hang up');
});

test('resolveDatabaseIds: non-JSON runner output throws a parse error (surfaced by the CLI as exit 1)', () => {
  const runner = () => 'gh: not logged in';
  assert.throws(() => resolveDatabaseIds({ owner: 'a', repo: 'b', numbers: [595], runner }), SyntaxError);
});

test('resolveDatabaseIds: repository null with no errors[] throws the plain missing-id message', () => {
  const runner = (args) => (isGraphQL(args) ? JSON.stringify({ data: { repository: null } }) : '{}');
  assert.throws(
    () => resolveDatabaseIds({ owner: 'a', repo: 'b', numbers: [595], runner }),
    (e) => /missing databaseId for #595$/.test(e.message),
  );
});

test('linkBlockedBy: a blocker absent from the ids map lands in failed, no POST attempted', () => {
  const calls = [];
  const runner = (args) => { calls.push(args); return '{}'; };
  const r = linkBlockedBy({ owner: 'a', repo: 'b', edges: [{ dependent: 610, blocker: 999 }], ids: new Map(), runner });
  assert.equal(calls.length, 0);
  assert.deepEqual(r.failed, [{ dependent: 610, blocker: 999, error: 'no databaseId resolved' }]);
});
