'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchIssues, fetchNativeDependencies, buildRecords, buildOverlapGroups,
} = require('../../../plugin/bin/lib/preflight-records/preflight-records');

const isGraphQL = (args) => args[0] === 'api' && args[1] === 'graphql';
const isIssueView = (args, n) => args[0] === 'issue' && args[1] === 'view' && args[2] === String(n);

function issue({ number, title, body = '', labels = [] }) {
  return { number, title, body, labels };
}

// --- lib: fetchIssues -------------------------------------------------

test('fetchIssues: one gh issue view per number, ok Map keyed by number', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A' }));
    if (isIssueView(args, 721)) return JSON.stringify(issue({ number: 721, title: 'B' }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const { ok, failed } = fetchIssues({ numbers: [720, 721], runner });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['issue', 'view', '720', '--json', 'number,title,body,labels']);
  assert.equal(failed.length, 0);
  assert.equal(ok.get(720).title, 'A');
  assert.equal(ok.get(721).title, 'B');
});

test('fetchIssues: a failing record never aborts the batch — all-at-once reporting', () => {
  const runner = (args) => {
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A' }));
    if (isIssueView(args, 721)) { const e = new Error('HTTP 404: Not Found'); throw e; }
    if (isIssueView(args, 722)) return JSON.stringify(issue({ number: 722, title: 'C' }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const { ok, failed } = fetchIssues({ numbers: [720, 721, 722], runner });
  assert.equal(ok.size, 2);
  assert.deepEqual(failed.map((f) => f.number), [721]);
  assert.match(failed[0].error, /404/);
});

// --- lib: fetchNativeDependencies --------------------------------------

test('fetchNativeDependencies: one batched aliased GraphQL call, -f owner/repo/query', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    return JSON.stringify({
      data: {
        repository: {
          i720: { number: 720, blockedBy: { nodes: [{ number: 700, state: 'OPEN' }] } },
          i721: { number: 721, blockedBy: { nodes: [] } },
        },
      },
    });
  };
  const deps = fetchNativeDependencies({ numbers: [720, 721], owner: 'acme', repo: 'w', runner });
  assert.equal(calls.length, 1, 'exactly one runner call');
  const q = calls[0].join(' ');
  assert.match(q, /-f owner=acme -f repo=w/, 'already-resolved String! values → -f, never -F');
  assert.doesNotMatch(q, /-F owner=/);
  assert.match(q, /i720: issue\(number:720\)/);
  assert.match(q, /i721: issue\(number:721\)/);
  assert.deepEqual(deps.get(720), { blockedBy: [700], openBlocker: true, openBlockerIds: [700] });
  assert.deepEqual(deps.get(721), { blockedBy: [], openBlocker: false, openBlockerIds: [] });
});

// #2240: a non-github.com host threads --hostname onto this call — the only
// gh-invoking call resolve-blockers.js / preflight-records.js's native mode
// makes, so it's the flag's sole attachment point (no separate REST call).
test('#2240: fetchNativeDependencies passes --hostname on a non-github.com host, omits it for github.com/unset', () => {
  const response = () => JSON.stringify({ data: { repository: { i720: { number: 720, blockedBy: { nodes: [] } } } } });
  const ghe = []; const dotcom = []; const unset = [];
  fetchNativeDependencies({
    numbers: [720], owner: 'a', repo: 'b', host: 'ghe.example.com', runner: (args) => { ghe.push(args); return response(); },
  });
  fetchNativeDependencies({
    numbers: [720], owner: 'a', repo: 'b', host: 'github.com', runner: (args) => { dotcom.push(args); return response(); },
  });
  fetchNativeDependencies({
    numbers: [720], owner: 'a', repo: 'b', runner: (args) => { unset.push(args); return response(); },
  });
  assert.deepEqual(ghe[0].slice(-2), ['--hostname', 'ghe.example.com']);
  assert.doesNotMatch(dotcom[0].join(' '), /--hostname/);
  assert.doesNotMatch(unset[0].join(' '), /--hostname/);
});

test('fetchNativeDependencies: a closed-only blockedBy list still reports the numbers, openBlocker false', () => {
  const runner = () => JSON.stringify({
    data: { repository: { i720: { number: 720, blockedBy: { nodes: [{ number: 700, state: 'CLOSED' }] } } } },
  });
  const deps = fetchNativeDependencies({ numbers: [720], owner: 'a', repo: 'b', runner });
  assert.deepEqual(deps.get(720), { blockedBy: [700], openBlocker: false, openBlockerIds: [] });
});

// A missing `data.repository` (null, or the key absent entirely) must never
// silently yield `blockedBy: [], openBlocker: false` for every candidate —
// same "throw on a partial result rather than returning a partial map" rule
// bin/lib/issues/link.js's resolveDatabaseIds follows (#723).
test('fetchNativeDependencies: data.repository null throws, naming every candidate record', () => {
  const runner = () => JSON.stringify({ data: { repository: null } });
  assert.throws(
    () => fetchNativeDependencies({ numbers: [720, 721], owner: 'a', repo: 'b', runner }),
    /#720.*#721|#721.*#720/s,
  );
});

test('fetchNativeDependencies: data.repository absent (malformed response) throws, naming every candidate record', () => {
  const runner = () => JSON.stringify({ data: {} });
  assert.throws(
    () => fetchNativeDependencies({ numbers: [720], owner: 'a', repo: 'b', runner }),
    /#720/,
  );
});

// A missing `i{n}` alias (repository present, one candidate's field absent
// from the response) must throw naming only the affected record — a
// resolvable sibling record must never be silently dropped from the throw.
test('fetchNativeDependencies: a missing i{n} alias throws, naming just that record', () => {
  const runner = () => JSON.stringify({
    data: { repository: { i720: { number: 720, blockedBy: { nodes: [] } } } },
  });
  assert.throws(
    () => fetchNativeDependencies({ numbers: [720, 721], owner: 'a', repo: 'b', runner }),
    (err) => /#721/.test(err.message) && !/#720/.test(err.message),
  );
});

test('fetchNativeDependencies: a GraphQL errors[] array is folded into the thrown message when present', () => {
  const runner = () => JSON.stringify({
    data: { repository: null },
    errors: [{ message: 'Field "repository" must not be null' }],
  });
  assert.throws(
    () => fetchNativeDependencies({ numbers: [720], owner: 'a', repo: 'b', runner }),
    /Field "repository" must not be null/,
  );
});

// --- lib: buildRecords / buildOverlapGroups ----------------------------

const specBody = (files) => [
  '## Technical Approach',
  '### Key Files',
  ...files.map((f) => `- \`${f}\` (modify)`),
].join('\n');

test('buildRecords: body-text mode — facets/keyFiles/blockedBy from the fetched body, openBlocker null', () => {
  const issues = new Map([
    [720, issue({ number: 720, title: 'A', body: `Blocked by #700\n\n${specBody(['a.js'])}`, labels: [{ name: 'priority:high' }] })],
    [721, issue({ number: 721, title: 'B', body: specBody(['a.js', 'b.js']) })],
  ]);
  const records = buildRecords({ issues, dependencies: null });
  assert.deepEqual(records['720'].blockedBy, [700]);
  assert.equal(records['720'].openBlocker, null);
  assert.equal(records['720'].facets.priority, 'high');
  assert.deepEqual(records['720'].keyFiles, ['a.js']);
  assert.deepEqual(records['721'].keyFiles, ['a.js', 'b.js']);
  assert.equal(records['721'].blockedBy.length, 0);
});

test('buildRecords: native mode — blockedBy/openBlocker come from the resolved dependencies Map, not the body', () => {
  const issues = new Map([[720, issue({ number: 720, title: 'A', body: 'Blocked by #999 (stale body text, ignored under native)' })]]);
  const dependencies = new Map([[720, { blockedBy: [700], openBlocker: true }]]);
  const records = buildRecords({ issues, dependencies });
  assert.deepEqual(records['720'].blockedBy, [700]);
  assert.equal(records['720'].openBlocker, true);
});

test('buildOverlapGroups: records sharing a key file union into one group; items keyed on numeric item.id', () => {
  const records = {
    720: { keyFiles: ['a.js'] },
    721: { keyFiles: ['a.js', 'b.js'] },
    722: { keyFiles: ['c.js'] },
  };
  const groups = buildOverlapGroups(records);
  const sorted = groups.map((g) => [...g].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(sorted, [[720, 721], [722]]);
  // ids are numbers, not the object's string keys
  assert.ok(groups.flat().every((id) => typeof id === 'number'));
});

// --- CLI ----------------------------------------------------------------

const { run } = require('../../../plugin/bin/preflight-records');

function cliDeps({ runner, workLinks = 'body-text', remoteUrl = 'https://github.com/acme/w.git' } = {}) {
  const out = [];
  const err = [];
  return {
    deps: {
      runner,
      resolveWorkLinks: () => workLinks,
      remoteUrl: () => remoteUrl,
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    },
    out,
    err,
  };
}

test('CLI --help exits 0, prints usage, never touches gh', () => {
  const { deps, out } = cliDeps({ runner: () => { throw new Error('must not call gh'); } });
  const code = run(['--help'], deps);
  assert.equal(code, 0);
  assert.match(out.join(''), /usage: preflight-records\.js/);
});

test('(a) CLI body-text mode: two records, one gh issue view per record, NO graphql call', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A', body: `Blocked by #700\n\n${specBody(['a.js'])}` }));
    if (isIssueView(args, 721)) return JSON.stringify(issue({ number: 721, title: 'B', body: specBody(['a.js']) }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner, workLinks: 'body-text' });
  const code = run(['720', '721'], deps);
  assert.equal(code, 0);
  assert.equal(calls.filter(isGraphQL).length, 0, 'body-text mode makes no extra graphql call');
  assert.equal(calls.length, 2);
  const env = JSON.parse(out.join(''));
  assert.equal(env.workLinks, 'body-text');
  assert.deepEqual(env.records['720'].blockedBy, [700]);
  assert.equal(env.records['720'].openBlocker, null);
  assert.deepEqual(env.records['720'].keyFiles, ['a.js']);
  assert.deepEqual(env.overlapGroups.map((g) => g.sort((x, y) => x - y)), [[720, 721]]);
});

test('(b) CLI native mode: one batched graphql call, blockedBy + openBlocker mapped per alias', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A', body: specBody(['a.js']) }));
    if (isIssueView(args, 721)) return JSON.stringify(issue({ number: 721, title: 'B', body: specBody(['b.js']) }));
    if (isGraphQL(args)) {
      return JSON.stringify({
        data: {
          repository: {
            i720: { number: 720, blockedBy: { nodes: [{ number: 700, state: 'OPEN' }] } },
            i721: { number: 721, blockedBy: { nodes: [] } },
          },
        },
      });
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner, workLinks: 'native' });
  const code = run(['720', '721'], deps);
  assert.equal(code, 0);
  assert.equal(calls.filter(isGraphQL).length, 1, 'exactly one batched graphql call');
  const q = calls.find(isGraphQL).join(' ');
  assert.match(q, /-f query=.* -f owner=acme -f repo=w/s);
  const env = JSON.parse(out.join(''));
  assert.equal(env.workLinks, 'native');
  assert.deepEqual(env.records['720'].blockedBy, [700]);
  assert.equal(env.records['720'].openBlocker, true);
  assert.deepEqual(env.records['721'].blockedBy, []);
  assert.equal(env.records['721'].openBlocker, false);
});

test('(c) CLI overlapGroups: shared keyFiles union across three records', () => {
  const runner = (args) => {
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A', body: specBody(['shared.js']) }));
    if (isIssueView(args, 721)) return JSON.stringify(issue({ number: 721, title: 'B', body: specBody(['shared.js', 'other.js']) }));
    if (isIssueView(args, 722)) return JSON.stringify(issue({ number: 722, title: 'C', body: specBody(['solo.js']) }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner, workLinks: 'body-text' });
  const code = run(['720', '721', '722'], deps);
  assert.equal(code, 0);
  const env = JSON.parse(out.join(''));
  const sorted = env.overlapGroups.map((g) => [...g].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(sorted, [[720, 721], [722]]);
});

test('(d) CLI: fetch failure on one of three records exits 1, all failures named', () => {
  const runner = (args) => {
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A' }));
    if (isIssueView(args, 721)) throw new Error('HTTP 404: Not Found');
    if (isIssueView(args, 722)) throw new Error('HTTP 500: boom');
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, err, out } = cliDeps({ runner, workLinks: 'body-text' });
  const code = run(['720', '721', '722'], deps);
  assert.equal(code, 1);
  assert.equal(out.length, 0, 'no JSON printed on failure');
  const errText = err.join('');
  assert.match(errText, /#721/);
  assert.match(errText, /404/);
  assert.match(errText, /#722/);
  assert.match(errText, /500/);
});

test('CLI native mode: a missing i{n} alias in the batched graphql response exits 1, the affected record named (#723)', () => {
  const runner = (args) => {
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A', body: specBody(['a.js']) }));
    if (isIssueView(args, 721)) return JSON.stringify(issue({ number: 721, title: 'B', body: specBody(['b.js']) }));
    if (isGraphQL(args)) {
      // i721 alias is absent from the response entirely.
      return JSON.stringify({
        data: { repository: { i720: { number: 720, blockedBy: { nodes: [] } } } },
      });
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, err, out } = cliDeps({ runner, workLinks: 'native' });
  const code = run(['720', '721'], deps);
  assert.equal(code, 1);
  assert.equal(out.length, 0, 'no JSON printed on failure');
  assert.match(err.join(''), /#721/);
});

test('(e) CLI: no args exits 2', () => {
  const { deps, err } = cliDeps({ runner: () => { throw new Error('must not call gh'); } });
  const code = run([], deps);
  assert.equal(code, 2);
  assert.match(err.join(''), /usage:/);
});

test('(f) CLI: non-positive/non-numeric arguments exit 2', () => {
  const { deps, err } = cliDeps({ runner: () => { throw new Error('must not call gh'); } });
  assert.equal(run(['0'], deps), 2);
  assert.equal(run(['-5'], deps), 2);
  assert.equal(run(['abc'], deps), 2);
  assert.match(err.join(''), /positive integer/);
});

test('(g) CLI: --work-links flag overrides the deps-resolved policy value', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A', body: specBody([]) }));
    if (isGraphQL(args)) {
      return JSON.stringify({ data: { repository: { i720: { number: 720, blockedBy: { nodes: [] } } } } });
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  let resolveCalled = false;
  const { deps, out } = cliDeps({ runner, workLinks: 'body-text' });
  deps.resolveWorkLinks = () => { resolveCalled = true; return 'body-text'; };
  const code = run(['720', '--work-links', 'native'], deps);
  assert.equal(code, 0);
  assert.equal(resolveCalled, false, 'the flag short-circuits the policy lookup entirely');
  assert.equal(calls.filter(isGraphQL).length, 1, 'native mode ran despite the policy default being body-text');
  const env = JSON.parse(out.join(''));
  assert.equal(env.workLinks, 'native');
});

test('CLI: no --work-links flag falls through to deps.resolveWorkLinks()', () => {
  const runner = (args) => {
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A', body: specBody([]) }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner, workLinks: 'body-text' });
  const code = run(['720'], deps);
  assert.equal(code, 0);
  const env = JSON.parse(out.join(''));
  assert.equal(env.workLinks, 'body-text');
});

test('CLI native mode: unresolvable owner/repo (no --repo, no remote) exits 2', () => {
  const runner = (args) => {
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A', body: specBody([]) }));
    throw new Error('must not call graphql without a resolved owner/repo');
  };
  const { deps, err } = cliDeps({ runner, workLinks: 'native' });
  deps.remoteUrl = () => { throw new Error('fatal: not a git repository'); };
  const code = run(['720'], deps);
  assert.equal(code, 2);
  assert.match(err.join(''), /could not resolve owner\/repo/);
});

test('CLI: --work-links with an invalid value is a malformed invocation (exit 2)', () => {
  const { deps, err } = cliDeps({ runner: () => { throw new Error('must not call gh'); } });
  const code = run(['720', '--work-links', 'bogus'], deps);
  assert.equal(code, 2);
  assert.match(err.join(''), /must be "native" or "body-text"/);
});
