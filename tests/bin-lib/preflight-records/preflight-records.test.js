'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchIssues, fetchNativeDependencies, buildRecords, buildOverlapGroups, outOfRunBlockers,
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

// #2538: on a GitHub Enterprise remote, gh issue view has no repo context to
// resolve unless --repo is threaded explicitly.
test('fetchIssues: threads --repo {host/}owner/repo onto every call when owner/repo are given', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    return JSON.stringify(issue({ number: 720, title: 'A' }));
  };
  fetchIssues({
    numbers: [720], owner: 'acme', repo: 'widgets', host: 'ghe.example.com', runner,
  });
  assert.deepEqual(calls[0], ['issue', 'view', '720', '--json', 'number,title,body,labels', '--repo', 'ghe.example.com/acme/widgets']);
});

test('fetchIssues: a github.com owner/repo resolves to the bare slug, not host-qualified', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    return JSON.stringify(issue({ number: 720, title: 'A' }));
  };
  fetchIssues({
    numbers: [720], owner: 'acme', repo: 'widgets', host: 'github.com', runner,
  });
  assert.deepEqual(calls[0], ['issue', 'view', '720', '--json', 'number,title,body,labels', '--repo', 'acme/widgets']);
});

test('fetchIssues: no owner/repo given omits --repo entirely — unchanged legacy shape', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    return JSON.stringify(issue({ number: 720, title: 'A' }));
  };
  fetchIssues({ numbers: [720], runner });
  assert.deepEqual(calls[0], ['issue', 'view', '720', '--json', 'number,title,body,labels']);
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

test('buildRecords: native mode — a cross-repository blocker leaves blockedBy and rides on crossRepoBlockers', () => {
  const issues = new Map([[11, issue({ number: 11, title: 'E' })], [12, issue({ number: 12, title: 'T' })]]);
  const dependencies = new Map([
    [11, { blockedBy: [5, 6, 5], openBlocker: false, openBlockerIds: [], crossRepoBlockers: [{ number: 5, repository: 'other/repo', state: 'CLOSED' }] }],
    [12, { blockedBy: [6], openBlocker: false, openBlockerIds: [] }],
  ]);
  const records = buildRecords({ issues, dependencies });
  assert.deepEqual(records['11'].blockedBy, [6, 5]);
  assert.deepEqual(records['11'].crossRepoBlockers, [{ number: 5, repository: 'other/repo', state: 'CLOSED' }]);
  assert.equal('crossRepoBlockers' in records['12'], false);
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

function cliDeps({
  runner, workLinks = 'body-text', remoteUrl = 'https://github.com/acme/w.git', files = {}, stdin,
} = {}) {
  const out = [];
  const err = [];
  return {
    deps: {
      runner,
      resolveWorkLinks: () => workLinks,
      remoteUrl: () => remoteUrl,
      readFile: (p) => { if (!(p in files)) throw new Error(`ENOENT: ${p}`); return files[p]; },
      readStdin: () => { if (stdin === undefined) throw new Error('EAGAIN: no stdin'); return stdin; },
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

// #2538: previously, repo/host resolution only ran under work-links: native
// (AFTER fetchIssues already made its unqualified gh issue view calls) — a
// GitHub Enterprise remote's body-text mode never got any --repo threaded
// at all. Now resolution runs once, before fetchIssues, in every mode.
test('#2538: body-text mode on a GitHub Enterprise remote threads --repo onto every gh issue view call', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A', body: specBody(['a.js']) }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, err } = cliDeps({ runner, workLinks: 'body-text', remoteUrl: 'https://ghe.example.com/acme/widgets.git' });
  deps.gateDeps = { env: { GH_HOST: 'ghe.example.com' } }; // #4933: an unknown origin host is opted in by GH_HOST
  const code = run(['720'], deps);
  assert.equal(code, 0);
  assert.deepEqual(calls[0], ['issue', 'view', '720', '--json', 'number,title,body,labels', '--repo', 'ghe.example.com/acme/widgets']);
  assert.match(err.join(''), /resolved repo ghe\.example\.com\/acme\/widgets \(host: ghe\.example\.com\)/, 'a resolved non-github.com host is visible on stderr');
});

test('#2538: a plain github.com remote prints nothing on stderr (success path stays silent)', () => {
  const runner = (args) => {
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A', body: specBody(['a.js']) }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, err } = cliDeps({ runner, workLinks: 'body-text' });
  const code = run(['720'], deps);
  assert.equal(code, 0);
  assert.equal(err.length, 0, 'the ordinary github.com case must stay silent on stderr');
});

// #2444 review fix: a caller-supplied --repo can itself already be a
// host-qualified `host/owner/repo` slug (repoSlug()'s GHE output) — before
// this fix, --repo was always prefixed with `github.com/` regardless of
// shape, producing an unparseable 4-segment string for a slug like this.
// Only native-mode's GraphQL call actually consults owner/repo/host.
test('#2444 fix: native mode with a host-qualified --repo slug threads --hostname onto the graphql call', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A', body: specBody(['a.js']) }));
    if (isGraphQL(args)) {
      return JSON.stringify({ data: { repository: { i720: { number: 720, blockedBy: { nodes: [] } } } } });
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner, workLinks: 'native', remoteUrl: () => { throw new Error('remoteUrl should not be called when --repo is passed'); } });
  const code = run(['720', '--repo', 'ghe.example.com/acme/widgets'], deps);
  assert.equal(code, 0);
  const q = calls.find(isGraphQL).join(' ');
  assert.match(q, /-f owner=acme -f repo=widgets/);
  assert.match(q, /--hostname ghe\.example\.com/);
  const env = JSON.parse(out.join(''));
  assert.equal(env.workLinks, 'native');
});

test('#2444 fix: native mode with a bare --repo owner/repo still resolves to github.com (unchanged)', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A', body: specBody(['a.js']) }));
    if (isGraphQL(args)) {
      return JSON.stringify({ data: { repository: { i720: { number: 720, blockedBy: { nodes: [] } } } } });
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner, workLinks: 'native', remoteUrl: () => { throw new Error('remoteUrl should not be called when --repo is passed'); } });
  const code = run(['720', '--repo', 'acme/widgets'], deps);
  assert.equal(code, 0);
  const q = calls.find(isGraphQL).join(' ');
  assert.match(q, /-f owner=acme -f repo=widgets/);
  assert.doesNotMatch(q, /--hostname/);
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

test('CLI directOverlaps: a chain A-B, B-C keeps one transitive group but lists only the direct pairs (#3278)', () => {
  const runner = (args) => {
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A', body: specBody(['x.js']) }));
    if (isIssueView(args, 721)) return JSON.stringify(issue({ number: 721, title: 'B', body: specBody(['x.js', 'y.js']) }));
    if (isIssueView(args, 722)) return JSON.stringify(issue({ number: 722, title: 'C', body: specBody(['y.js']) }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner, workLinks: 'body-text' });
  const code = run(['722', '720', '721'], deps);
  assert.equal(code, 0);
  const env = JSON.parse(out.join(''));
  assert.deepEqual(env.overlapGroups.map((g) => [...g].sort((a, b) => a - b)), [[720, 721, 722]]);
  assert.deepEqual(env.directOverlaps, [
    { a: 720, b: 721, files: ['x.js'] },
    { a: 721, b: 722, files: ['y.js'] },
  ]);
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

test('#2733: --merge-gate adds mergeGate to the envelope; without it the envelope keys are unchanged', () => {
  const runner = (args) => {
    if (isIssueView(args, 2670)) return JSON.stringify(issue({ number: 2670, title: 'P', body: specBody(['a.js']) }));
    if (isIssueView(args, 2682)) return JSON.stringify(issue({ number: 2682, title: 'D', body: `Blocked by #2670\n\n## Deliverables\n- [ ] confirm \`#2670\` is actually merged\n\n${specBody(['b.js'])}` }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const gated = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['2670', '2682', '--merge-gate'], gated.deps), 0);
  const env = JSON.parse(gated.out.join(''));
  assert.deepEqual(env.mergeGate.deferred, [2682]);
  assert.deepEqual(env.mergeGate.kept, [2670]);
  assert.equal(env.mergeGate.rerun, '/claude-tweaks:flow #2682');

  const plain = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['2670', '2682'], plain.deps), 0);
  assert.deepEqual(Object.keys(JSON.parse(plain.out.join(''))).sort(), ['directOverlaps', 'overlapGroups', 'records', 'workLinks']);
});

// AC2.1
test('AC2.1: --merge-gate --integration-branch master defers a record whose Deliverables line says "#2670 is merged into master"', () => {
  const runner = (args) => {
    if (isIssueView(args, 2670)) return JSON.stringify(issue({ number: 2670, title: 'P', body: specBody(['a.js']) }));
    if (isIssueView(args, 2682)) return JSON.stringify(issue({ number: 2682, title: 'D', body: `Blocked by #2670\n\n## Deliverables\n- [ ] confirm \`#2670\` is merged into master\n\n${specBody(['b.js'])}` }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner, workLinks: 'body-text' });
  const code = run(['2670', '2682', '--merge-gate', '--integration-branch', 'master'], deps);
  assert.equal(code, 0);
  const env = JSON.parse(out.join(''));
  assert.deepEqual(env.mergeGate.deferred, [2682]);
  assert.deepEqual(env.mergeGate.kept, [2670]);
});

test('--integration-branch with a trailing bare flag, or an empty value, exits 2 with no stdout and no gh call', () => {
  const runner = () => { throw new Error('must not call gh'); };

  const trailing = cliDeps({ runner });
  const trailingCode = run(['2670', '--merge-gate', '--integration-branch'], trailing.deps);
  assert.equal(trailingCode, 2);
  assert.equal(trailing.out.length, 0);
  assert.match(trailing.err.join(''), /missing value for --integration-branch/);

  const empty = cliDeps({ runner });
  const emptyCode = run(['2670', '--merge-gate', '--integration-branch', ''], empty.deps);
  assert.equal(emptyCode, 2);
  assert.equal(empty.out.length, 0);
  assert.match(empty.err.join(''), /missing value for --integration-branch/);
});

test('AC2.1, AC4.1: --waves adds a waves plan; without it the envelope has no waves key (#2677)', () => {
  const runner = (args) => {
    if (isIssueView(args, 801)) return JSON.stringify(issue({ number: 801, title: 'A', body: specBody(['a.js']) }));
    if (isIssueView(args, 802)) return JSON.stringify(issue({ number: 802, title: 'B', body: specBody(['b.js']) }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const withFlag = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['801', '802', '--waves'], withFlag.deps), 0);
  assert.deepEqual(JSON.parse(withFlag.out.join('')).waves, { waves: [[801, 802]], parallel: true });

  const without = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['801', '802'], without.deps), 0);
  assert.equal('waves' in JSON.parse(without.out.join('')), false);
});

test('--waves on a dependency cycle exits 2 naming the cycle, no stdout (#2677)', () => {
  const runner = (args) => {
    if (isIssueView(args, 811)) return JSON.stringify(issue({ number: 811, title: 'A', body: `Blocked by #812\n\n${specBody(['a.js'])}` }));
    if (isIssueView(args, 812)) return JSON.stringify(issue({ number: 812, title: 'B', body: `Blocked by #811\n\n${specBody(['b.js'])}` }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out, err } = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['811', '812', '--waves'], deps), 2);
  assert.equal(out.length, 0);
  assert.match(err.join(''), /dependency cycle through #81[12]/);
});

// --- CLI: --records-json (#3351) ----------------------------------------

const noGh = () => { throw new Error('must not call gh'); };

test('AC1.1: --records-json under body-text yields the gh-path envelope and never calls the runner', () => {
  const issues = [
    issue({ number: 720, title: 'A', body: `Blocked by #700\n\n${specBody(['a.js'])}` }),
    issue({ number: 721, title: 'B', body: specBody(['a.js']) }),
  ];
  const ghRunner = (args) => {
    const hit = issues.find((i) => isIssueView(args, i.number));
    if (hit) return JSON.stringify(hit);
    throw new Error('unexpected ' + args.join(' '));
  };
  const viaGh = cliDeps({ runner: ghRunner, workLinks: 'body-text' });
  assert.equal(run(['720', '721'], viaGh.deps), 0);

  let calls = 0;
  const viaFile = cliDeps({
    runner: () => { calls++; throw new Error('must not call gh'); },
    workLinks: 'body-text',
    files: { '/r.json': JSON.stringify(issues) },
  });
  assert.equal(run(['720', '721', '--records-json', '/r.json'], viaFile.deps), 0);
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(viaFile.out.join('')), JSON.parse(viaGh.out.join('')));
});

test('AC2.1: --records-json under native makes zero runner calls, reads blockedBy from bodies, flags nativeLinksUnchecked', () => {
  let calls = 0;
  const { deps, out, err } = cliDeps({
    runner: () => { calls++; throw new Error('must not call gh'); },
    workLinks: 'body-text',
    files: {
      '/r.json': JSON.stringify([
        issue({ number: 720, title: 'A', body: `Blocked by #700\n\n${specBody(['a.js'])}` }),
        issue({ number: 721, title: 'B', body: specBody(['b.js']) }),
      ]),
    },
  });
  assert.equal(run(['720', '721', '--work-links', 'native', '--records-json', '/r.json'], deps), 0);
  assert.equal(calls, 0);
  const env = JSON.parse(out.join(''));
  assert.equal(env.workLinks, 'body-text');
  assert.equal(env.nativeLinksUnchecked, true);
  assert.deepEqual(env.records['720'].blockedBy, [700]);
  assert.match(err.join(''), /native blocked-by links unchecked/);
});

test('AC2.2: a gh-path envelope carries no nativeLinksUnchecked key', () => {
  const runner = (args) => {
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A', body: specBody(['a.js']) }));
    if (isGraphQL(args)) {
      return JSON.stringify({ data: { repository: { i720: { number: 720, blockedBy: { nodes: [] } } } } });
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  const native = cliDeps({ runner, workLinks: 'native' });
  assert.equal(run(['720'], native.deps), 0);
  assert.equal('nativeLinksUnchecked' in JSON.parse(native.out.join('')), false);

  const bodyText = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['720'], bodyText.deps), 0);
  assert.equal('nativeLinksUnchecked' in JSON.parse(bodyText.out.join('')), false);
});

test('AC3.1: --records-json with --merge-gate and --waves computes mergeGate and waves from the file', () => {
  const { deps, out } = cliDeps({
    runner: noGh,
    files: {
      '/r.json': JSON.stringify([
        issue({ number: 720, title: 'A', body: specBody(['a.js']) }),
        issue({ number: 721, title: 'B', body: `Blocked by #720\n\n## Deliverables\n- #720 must be merged to \`main\` first\n\n${specBody(['b.js'])}` }),
      ]),
    },
  });
  assert.equal(run(['720', '721', '--records-json', '/r.json', '--merge-gate', '--waves', '--integration-branch', 'main'], deps), 0);
  const env = JSON.parse(out.join(''));
  assert.ok(env.mergeGate.deferred.includes(721));
  assert.ok(Array.isArray(env.waves.waves));
});

test('AC4.1: each malformed --records-json input exits 2, names the problem, never calls the runner', () => {
  const good = (n) => issue({ number: n, title: `T${n}`, body: specBody(['a.js']) });
  const cases = [
    ['missing file', {}, /cannot read --records-json/],
    ['unparseable', { '/r.json': '{' }, /not valid JSON/],
    ['non-array', { '/r.json': '{}' }, /must be a JSON array/],
    ['entry without number', { '/r.json': JSON.stringify([good(720), { title: 'x', body: '' }]) }, /missing a numeric "number"/],
    ['entry without body', { '/r.json': JSON.stringify([good(720), { number: 721, title: 'x' }]) }, /missing a string "body"/],
    ['string labels', { '/r.json': JSON.stringify([good(720), { ...good(721), labels: 'ready' }]) }, /non-array "labels"/],
    ['object labels', { '/r.json': JSON.stringify([good(720), { ...good(721), labels: { name: 'x' } }]) }, /non-array "labels"/],
    ['duplicate number', { '/r.json': JSON.stringify([good(720), good(721), good(721)]) }, /more than once/],
    ['requested number absent', { '/r.json': JSON.stringify([good(720)]) }, /missing requested #721/],
    ['extra number', { '/r.json': JSON.stringify([good(720), good(721), good(722)]) }, /not requested/],
  ];
  for (const [label, files, pattern] of cases) {
    const path = label === 'missing file' ? '/nope.json' : '/r.json';
    const { deps, out, err } = cliDeps({ runner: noGh, files });
    assert.equal(run(['720', '721', '--records-json', path], deps), 2, label);
    assert.equal(out.length, 0, label);
    assert.match(err.join(''), pattern, label);
  }
});

test('AC5.1: a trailing bare --records-json exits 2', () => {
  const trailing = cliDeps({ runner: noGh });
  assert.equal(run(['720', '--records-json'], trailing.deps), 2);
  assert.equal(trailing.out.length, 0);
  assert.match(trailing.err.join(''), /missing value for --records-json/);

  const flagNext = cliDeps({ runner: noGh });
  assert.equal(run(['720', '--records-json', '--waves'], flagNext.deps), 2);
  assert.equal(flagNext.out.length, 0);
  assert.match(flagNext.err.join(''), /missing value for --records-json/);
});

test('--records-json accepts bare-string labels', () => {
  const envFor = (labels) => {
    const { deps, out } = cliDeps({
      runner: noGh,
      files: { '/r.json': JSON.stringify([issue({ number: 720, title: 'A', body: specBody(['a.js']), labels })]) },
    });
    assert.equal(run(['720', '--records-json', '/r.json'], deps), 0);
    return JSON.parse(out.join(''));
  };
  const bare = envFor(['ready', 'risk:low']);
  const objs = envFor([{ name: 'ready' }, { name: 'risk:low' }]);
  assert.deepEqual(bare.records['720'].facets, objs.records['720'].facets);
  assert.equal(bare.records['720'].facets.stage, 'ready');
});

test('--records-json never resolves the origin remote — a sandbox with no origin still runs', () => {
  for (const workLinks of ['body-text', 'native']) {
    const { deps, out } = cliDeps({
      runner: noGh,
      workLinks,
      files: { '/r.json': JSON.stringify([issue({ number: 720, title: 'A', body: specBody(['a.js']) })]) },
    });
    let remoteCalls = 0;
    deps.remoteUrl = () => { remoteCalls += 1; throw new Error('fatal: No such remote \'origin\''); };
    assert.equal(run(['720', '--records-json', '/r.json'], deps), 0, workLinks);
    assert.equal(remoteCalls, 0, `${workLinks}: remoteUrl must not be called on the records-json path`);
    assert.ok(JSON.parse(out.join('')).records['720'], workLinks);
  }
});

test('--records-json accepts an unlabelled record — labels missing or null, as gh reports it', () => {
  for (const [label, entry] of [
    ['missing', { number: 720, title: 'A', body: specBody(['a.js']) }],
    ['null', { number: 720, title: 'A', body: specBody(['a.js']), labels: null }],
  ]) {
    const { deps, out, err } = cliDeps({ runner: noGh, files: { '/r.json': JSON.stringify([entry]) } });
    assert.equal(run(['720', '--records-json', '/r.json'], deps), 0, `${label}: ${err.join('')}`);
    assert.ok(JSON.parse(out.join('')).records['720'], label);
  }
});

test('--records-json --waves plans from the file records — independent records share one wave', () => {
  const { deps, out } = cliDeps({
    runner: noGh,
    files: {
      '/r.json': JSON.stringify([
        issue({ number: 720, title: 'A', body: specBody(['a.js']) }),
        issue({ number: 721, title: 'B', body: specBody(['b.js']) }),
      ]),
    },
  });
  assert.equal(run(['720', '721', '--records-json', '/r.json', '--waves'], deps), 0);
  assert.deepEqual(JSON.parse(out.join('')).waves.waves, [[720, 721]]);
});

test('--records-json with a --waves dependency cycle exits 2', () => {
  const { deps, out, err } = cliDeps({
    runner: noGh,
    files: {
      '/r.json': JSON.stringify([
        issue({ number: 720, title: 'A', body: `Blocked by #721\n\n${specBody(['a.js'])}` }),
        issue({ number: 721, title: 'B', body: `Blocked by #720\n\n${specBody(['b.js'])}` }),
      ]),
    },
  });
  assert.equal(run(['720', '721', '--records-json', '/r.json', '--waves'], deps), 2);
  assert.equal(out.length, 0);
  assert.match(err.join(''), /dependency cycle/);
});

// --- CLI: --blocker-landing (#4553) -------------------------------------

test('defaultRunner bounds its gh call (the compare fan-out and the batched GraphQL reads run through it) — source pin, an unbounded execFileSync hangs pre-flight', () => {
  const src = require('node:fs').readFileSync(require.resolve('../../../plugin/bin/lib/preflight-records/preflight-records'), 'utf8');
  const body = (src.match(/function defaultRunner\(args\) \{([\s\S]*?)\n\}/) || [])[1] || '';
  assert.match(body, /execFileSync\('gh', args, (?:ghOptions\(args, )?\{[^}]*timeout: sharedPrimitives\.GH_BATCH_TIMEOUT_MS[^}]*\}\)?\)/);
  assert.doesNotMatch(src, /timeout: \d+/, 'no retyped literal bound');
  assert.ok(require('../../../plugin/bin/lib/shared-primitives').GH_BATCH_TIMEOUT_MS >= 30000, 'a stated bound, wider than the 5s single-call default');
});

const isCompare = (args) => args[0] === 'api' && /\/compare\//.test(args[1]);
const gqlQuery = (args) => (args.find((a) => typeof a === 'string' && a.startsWith('query=')) || '');

const closedBlocker = (oid, { reason = 'COMPLETED', number = 90 } = {}) => ({
  number: 0,
  state: 'CLOSED',
  stateReason: reason,
  timelineItems: { nodes: [{ closer: { __typename: 'PullRequest', number, merged: true, baseRefName: 'dev', mergeCommit: { oid } } }] },
  closedByPullRequestsReferences: { nodes: [] },
});

// Records 10 (no edges) and 11 (blocked by in-run #10 and out-of-run #5).
function landingFixture({ repository, statuses = { eee555: 'behind\n' }, extra = {} } = {}) {
  const calls = [];
  const issues = {
    10: issue({ number: 10, title: 'Ten', body: specBody(['a.js']) }),
    11: issue({ number: 11, title: 'Eleven', body: `Blocked by #10\nBlocked by #5\n\n${specBody(['b.js'])}` }),
    ...extra,
  };
  const runner = (args) => {
    calls.push(args);
    const hit = Object.values(issues).find((i) => isIssueView(args, i.number));
    if (hit) return JSON.stringify(hit);
    if (isGraphQL(args) && /CLOSED_EVENT/.test(gqlQuery(args))) return JSON.stringify({ data: { repository } });
    if (isCompare(args)) {
      const sha = args[1].split('...').pop();
      if (!(sha in statuses)) throw new Error(`unexpected compare ${sha}`);
      return statuses[sha];
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  return { runner, calls };
}

// Native-mode landing fixture: each record's native blockers given as [number, repo, state].
// `bodies` (record number -> body text) overrides a record's default body.
function nativeLandingFixture(blockersByRecord, { repository = {}, statuses = {}, bodies = {} } = {}) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    for (const n of Object.keys(blockersByRecord)) {
      if (isIssueView(args, Number(n))) return JSON.stringify(issue({ number: Number(n), title: `R${n}`, body: bodies[n] ?? specBody([`f${n}.js`]) }));
    }
    if (isGraphQL(args) && /CLOSED_EVENT/.test(gqlQuery(args))) return JSON.stringify({ data: { repository } });
    if (isGraphQL(args)) {
      const repo = {};
      for (const [n, blockers] of Object.entries(blockersByRecord)) {
        repo[`i${n}`] = { number: Number(n), repository: { nameWithOwner: 'acme/w' }, blockedBy: { nodes: blockers.map(([number, r, state]) => ({ number, state, repository: { nameWithOwner: r } })) } };
      }
      return JSON.stringify({ data: { repository: repo } });
    }
    if (isCompare(args)) {
      const sha = args[1].split('...').pop();
      if (!(sha in statuses)) throw new Error(`unexpected compare ${sha}`);
      return statuses[sha];
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  return { runner, calls };
}
const nativeArgs = (...nums) => [...nums, '--blocker-landing', '--repo', 'acme/w'];
const landingQueries = (calls) => calls.filter((a) => isGraphQL(a) && /CLOSED_EVENT/.test(gqlQuery(a))).map(gqlQuery);

test('AC1.1: a CLOSED native blocker in another repository is never queried by number here — undetermined cross-repository; this repository\'s blocker is still judged', () => {
  const { runner, calls } = nativeLandingFixture({ 11: [[5, 'other/repo', 'CLOSED'], [6, 'acme/w', 'CLOSED']] }, { repository: { b5: closedBlocker('eee555'), b6: closedBlocker('fff666') }, statuses: { eee555: 'behind\n', fff666: 'behind\n' } });
  const d = cliDeps({ runner, workLinks: 'native' });
  assert.equal(run(nativeArgs('11'), d.deps), 0);
  const env = JSON.parse(d.out.join(''));
  assert.deepEqual(env.records['11'].blockerLanding, [
    { blocker: 6, verdict: 'landed', commit: 'fff666', via: 'closer-pr' },
    { blocker: 5, verdict: 'undetermined', commit: null, via: 'cross-repository', repository: 'other/repo' },
  ]);
  assert.deepEqual(env.records['11'].blockedBy, [6]);
  const queries = landingQueries(calls);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /b6: issue\(number:6\)/);
  assert.doesNotMatch(queries[0], /b5: issue/);
});

test('AC1.1: an OPEN native blocker in another repository reads open from its native state — no blocker-landing query and no compare call', () => {
  const { runner, calls } = nativeLandingFixture({ 11: [[5, 'other/repo', 'OPEN']] });
  const d = cliDeps({ runner, workLinks: 'native' });
  assert.equal(run(nativeArgs('11'), d.deps), 0);
  const env = JSON.parse(d.out.join(''));
  assert.deepEqual(env.records['11'].blockerLanding, [{ blocker: 5, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' }]);
  assert.equal(landingQueries(calls).length, 0);
  assert.equal(calls.filter(isCompare).length, 0);
});

test('Q5: a native blocker in another repository with no readable state reads open — fail closed, no lookup', () => {
  const { runner, calls } = nativeLandingFixture({ 11: [[5, 'other/repo', null]] });
  const d = cliDeps({ runner, workLinks: 'native' });
  assert.equal(run(nativeArgs('11'), d.deps), 0);
  const env = JSON.parse(d.out.join(''));
  assert.deepEqual(env.records['11'].blockerLanding, [{ blocker: 5, verdict: 'open', commit: null, via: 'cross-repository-state-unreadable', repository: 'other/repo' }]);
  assert.equal(landingQueries(calls).length, 0);
});

test('this repository\'s #5 and another repository\'s #5 both blocking: the local one is judged, the foreign one is reported apart', () => {
  const { runner } = nativeLandingFixture({ 11: [[5, 'acme/w', 'CLOSED'], [5, 'other/repo', 'OPEN']] }, { repository: { b5: closedBlocker('eee555') }, statuses: { eee555: 'diverged\n' } });
  const d = cliDeps({ runner, workLinks: 'native' });
  assert.equal(run(nativeArgs('11'), d.deps), 0);
  const env = JSON.parse(d.out.join(''));
  assert.deepEqual(env.records['11'].blockerLanding, [
    { blocker: 5, verdict: 'unlanded', commit: 'eee555', via: 'closer-pr' },
    { blocker: 5, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' },
  ]);
});

test('a foreign blocker whose number is an in-run record is judged as foreign, not dropped as in-run', () => {
  const { runner } = nativeLandingFixture({ 10: [], 11: [[10, 'other/repo', 'OPEN']] });
  const d = cliDeps({ runner, workLinks: 'native' });
  assert.equal(run(nativeArgs('10', '11'), d.deps), 0);
  const env = JSON.parse(d.out.join(''));
  assert.deepEqual(env.records['11'].blockedBy, []);
  assert.deepEqual(env.records['11'].blockerLanding, [{ blocker: 10, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' }]);
});

// --- body-declared foreign blockers (#4793, Plan Review Clarifications) ---------------------------

const isStateQuery = (args) => isGraphQL(args) && /c0: repository\(owner:\$o0,name:\$n0\)/.test(gqlQuery(args));
const stateQueries = (calls) => calls.filter(isStateQuery);
const flagValue = (args, name) => { const a = args.find((x) => x.startsWith(`${name}=`)); return a && a.slice(name.length + 1); };

// Records keyed by number -> body; `states` maps 'owner/name#N' -> 'OPEN'|'CLOSED' (absent = no readable issue).
// `stateAnswer(args)` overrides the state query's answer (return a JSON string, or throw).
function bodyForeignFixture(bodies, { states = {}, stateAnswer } = {}) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    for (const [n, body] of Object.entries(bodies)) {
      if (isIssueView(args, Number(n))) return JSON.stringify(issue({ number: Number(n), title: `R${n}`, body: `${body}\n\n${specBody([`f${n}.js`])}` }));
    }
    if (isStateQuery(args)) {
      if (stateAnswer) return stateAnswer(args);
      const data = {};
      for (const [, i, num] of gqlQuery(args).matchAll(/c(\d+): repository\(owner:\$o\d+,name:\$n\d+\)\{ issue\(number:(\d+)\)/g)) {
        const state = states[`${flagValue(args, `o${i}`)}/${flagValue(args, `n${i}`)}#${num}`];
        data[`c${i}`] = state ? { issue: { state } } : null;
      }
      return JSON.stringify({ data });
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  return { runner, calls };
}
const bodyArgs = (...nums) => [...nums, '--blocker-landing', '--repo', 'acme/w'];

test('Plan Review Clarifications: a body-declared OPEN foreign blocker reads open under body-text — no landing query, no compare call', () => {
  const { runner, calls } = bodyForeignFixture({ 11: 'Blocked by other/repo#5' }, { states: { 'other/repo#5': 'OPEN' } });
  const d = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(bodyArgs('11'), d.deps), 0);
  const env = JSON.parse(d.out.join(''));
  assert.deepEqual(env.records['11'].blockerLanding, [{ blocker: 5, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' }]);
  assert.deepEqual(env.records['11'].blockedBy, []);
  assert.equal(landingQueries(calls).length, 0);
  assert.equal(calls.filter(isCompare).length, 0);
  assert.equal(stateQueries(calls).length, 1);
  assert.equal(d.err.join(''), '');
});

test('a body-declared CLOSED foreign blocker reads undetermined cross-repository', () => {
  const { runner } = bodyForeignFixture({ 11: 'Blocked by other/repo#5' }, { states: { 'other/repo#5': 'CLOSED' } });
  const d = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(bodyArgs('11'), d.deps), 0);
  const env = JSON.parse(d.out.join(''));
  assert.deepEqual(env.records['11'].blockerLanding, [{ blocker: 5, verdict: 'undetermined', commit: null, via: 'cross-repository', repository: 'other/repo' }]);
});

test('a body-declared foreign blocker the lookup cannot read reads open, state unreadable', () => {
  const { runner } = bodyForeignFixture({ 11: 'Blocked by other/repo#5' }, { stateAnswer: () => JSON.stringify({ data: {} }) });
  const d = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(bodyArgs('11'), d.deps), 0);
  const env = JSON.parse(d.out.join(''));
  assert.deepEqual(env.records['11'].blockerLanding, [{ blocker: 5, verdict: 'open', commit: null, via: 'cross-repository-state-unreadable', repository: 'other/repo' }]);
  // Only a whole-call failure prints the fail-closed line; the ref's own `via` diagnoses a missing alias.
  assert.doesNotMatch(d.err.join(''), /foreign blocker state lookup/);
});

test('a failed state lookup fails closed and says so', () => {
  const { runner } = bodyForeignFixture({ 11: 'Blocked by other/repo#5' }, { stateAnswer: () => { throw new Error('HTTP 502: bad gateway'); } });
  const d = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(bodyArgs('11'), d.deps), 0);
  const env = JSON.parse(d.out.join(''));
  assert.deepEqual(env.records['11'].blockerLanding, [{ blocker: 5, verdict: 'open', commit: null, via: 'cross-repository-state-unreadable', repository: 'other/repo' }]);
  assert.match(d.err.join(''), /foreign blocker state lookup failed: .* other\/repo#5 read as state unreadable \(fail closed\)/);
});

test('under --records-json a body-declared foreign blocker reads state unreadable with no gh call', () => {
  let calls = 0;
  const d = cliDeps({
    runner: () => { calls++; throw new Error('must not call gh'); },
    workLinks: 'body-text',
    files: { '/r.json': JSON.stringify([issue({ number: 11, title: 'Eleven', body: `Blocked by other/repo#5\n\n${specBody(['b.js'])}` })]) },
  });
  assert.equal(run(['11', '--blocker-landing', '--records-json', '/r.json'], d.deps), 0);
  assert.equal(calls, 0);
  const env = JSON.parse(d.out.join(''));
  assert.deepEqual(env.records['11'].blockerLanding, [{ blocker: 5, verdict: 'open', commit: null, via: 'cross-repository-state-unreadable', repository: 'other/repo' }]);
  assert.match(d.err.join(''), /foreign blocker state lookup skipped under --records-json — other\/repo#5 read as state unreadable \(fail closed\)/);
});

test('--prefetched-json (the dispatch unlanded-blocker path) runs the gh lookup, reads a body-declared foreign blocker, and fails closed with the diagnostic line', () => {
  const prefetched = JSON.stringify([issue({ number: 11, title: 'Eleven', body: `Blocked by other/repo#5\n\n${specBody(['b.js'])}` })]);
  const args = [...bodyArgs('11'), '--prefetched-json', '/p.json'];

  const ok = bodyForeignFixture({}, { states: { 'other/repo#5': 'OPEN' } });
  const read = cliDeps({ runner: ok.runner, workLinks: 'body-text', files: { '/p.json': prefetched } });
  assert.equal(run(args, read.deps), 0);
  assert.deepEqual(JSON.parse(read.out.join('')).records['11'].blockerLanding, [{ blocker: 5, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' }]);
  assert.equal(stateQueries(ok.calls).length, 1);
  assert.equal(ok.calls.filter((a) => a[0] === 'issue').length, 0, 'the records are prefetched — no gh issue view');
  assert.equal(read.err.join(''), '');

  const down = bodyForeignFixture({}, { stateAnswer: () => { throw new Error('HTTP 502: bad gateway'); } });
  const failed = cliDeps({ runner: down.runner, workLinks: 'body-text', files: { '/p.json': prefetched } });
  assert.equal(run(args, failed.deps), 0);
  assert.deepEqual(JSON.parse(failed.out.join('')).records['11'].blockerLanding, [{ blocker: 5, verdict: 'open', commit: null, via: 'cross-repository-state-unreadable', repository: 'other/repo' }]);
  assert.match(failed.err.join(''), /foreign blocker state lookup failed: .* — other\/repo#5 read as state unreadable \(fail closed\)/);
});

test('a foreign blocker linked natively and declared in the body is judged once, with no state query', () => {
  const { runner, calls } = nativeLandingFixture({ 11: [[5, 'other/repo', 'OPEN']] }, { bodies: { 11: `Blocked by Other/Repo#5\n\n${specBody(['f11.js'])}` } });
  const d = cliDeps({ runner, workLinks: 'native' });
  assert.equal(run(nativeArgs('11'), d.deps), 0);
  const env = JSON.parse(d.out.join(''));
  assert.deepEqual(env.records['11'].blockerLanding, [{ blocker: 5, verdict: 'open', commit: null, via: 'cross-repository', repository: 'other/repo' }]);
  assert.equal(stateQueries(calls).length, 0);
});

test('under native a body-declared foreign blocker is judged after the native ones, and one state call covers every record', () => {
  const { runner, calls } = nativeLandingFixture({ 10: [], 11: [[5, 'other/repo', 'OPEN']] }, { bodies: { 10: `Blocked by third/repo#7\n\n${specBody(['f10.js'])}`, 11: `Blocked by third/repo#7\nBlocked by other/repo#5\n\n${specBody(['f11.js'])}` } });
  const d = cliDeps({
    runner: (args) => {
      if (!isStateQuery(args)) return runner(args);
      calls.push(args);
      return JSON.stringify({ data: { c0: { issue: { state: 'CLOSED' } } } });
    },
    workLinks: 'native',
  });
  assert.equal(run(nativeArgs('10', '11'), d.deps), 0);
  const env = JSON.parse(d.out.join(''));
  assert.deepEqual(env.records['10'].blockerLanding, [{ blocker: 7, verdict: 'undetermined', commit: null, via: 'cross-repository', repository: 'third/repo' }]);
  assert.deepEqual(env.records['11'].blockerLanding.map((e) => `${e.repository}#${e.blocker}:${e.verdict}`), ['other/repo#5:open', 'third/repo#7:undetermined']);
  assert.equal(stateQueries(calls).length, 1);
  assert.match(gqlQuery(stateQueries(calls)[0]), /c0: repository/);
  assert.doesNotMatch(gqlQuery(stateQueries(calls)[0]), /c1:/);
});

test('without --blocker-landing a body-declared foreign blocker triggers no state lookup and no new key', () => {
  const { runner, calls } = bodyForeignFixture({ 11: 'Blocked by other/repo#5' }, { states: { 'other/repo#5': 'OPEN' } });
  const d = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['11', '--repo', 'acme/w'], d.deps), 0);
  assert.equal(stateQueries(calls).length, 0);
  assert.doesNotMatch(d.out.join(''), /crossRepoBlockers|blockerLanding/);
});

test('AC4.1: without --blocker-landing the envelope is byte-identical and no extra call is made', () => {
  const { runner, calls } = landingFixture({ repository: { b5: closedBlocker('eee555') } });
  const plain = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['10', '11'], plain.deps), 0);
  const text = plain.out.join('');
  assert.doesNotMatch(text, /blockerLanding/);
  // Fully literal: nothing below is read back from the output under test.
  const facets = () => ({
    origin: null,
    risk: null,
    size: null,
    ceremony: null,
    solutionUnjustified: false,
    breaking: false,
    needsDefinition: false,
    priority: null,
    stage: 'backlog',
    grants: { build: false, merge: false },
    bot: { inProgress: false, blocked: false, parked: false },
    acceptance: null,
    isParentIssue: false,
    notPlanned: false,
    shapedHeadless: false,
  });
  const expected = {
    records: {
      10: {
        title: 'Ten', facets: facets(), blockedBy: [], openBlocker: null, keyFiles: ['a.js'], fingerprint: null,
      },
      11: {
        title: 'Eleven', facets: facets(), blockedBy: [10, 5], openBlocker: null, keyFiles: ['b.js'], fingerprint: null,
      },
    },
    overlapGroups: [[10], [11]],
    directOverlaps: [],
    workLinks: 'body-text',
  };
  assert.equal(text, `${JSON.stringify(expected, null, 2)}\n`);
  assert.equal(calls.filter(isGraphQL).length, 0);
  assert.equal(calls.filter(isCompare).length, 0);
});

test('AC3.1, AC3.2: 10 11 --blocker-landing --integration-branch dev — landing for out-of-run #5 only, in-run #10 never appears', () => {
  const { runner, calls } = landingFixture({ repository: { b5: closedBlocker('eee555') } });
  const plain = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['10', '11'], plain.deps), 0);
  const plainEnv = JSON.parse(plain.out.join(''));
  calls.length = 0;

  const { deps, out } = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['10', '11', '--blocker-landing', '--integration-branch', 'dev'], deps), 0);
  const env = JSON.parse(out.join(''));
  assert.deepEqual(env.records['11'].blockerLanding, [{ blocker: 5, verdict: 'landed', commit: 'eee555', via: 'closer-pr' }]);
  assert.deepEqual(env.records['10'].blockerLanding, []);
  const queries = calls.filter(isGraphQL).map(gqlQuery);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /b5: issue\(number:5\)/);
  assert.doesNotMatch(queries[0], /b10/);
  const compares = calls.filter(isCompare);
  assert.equal(compares.length, 1);
  assert.match(compares[0][1], /compare\/dev\.\.\.eee555/);
  // Only the blockerLanding key is added to each record; nothing else moves.
  for (const n of ['10', '11']) {
    const { blockerLanding, ...rest } = env.records[n];
    assert.ok(Array.isArray(blockerLanding));
    assert.deepEqual(rest, plainEnv.records[n]);
  }
  assert.deepEqual({ ...env, records: undefined }, { ...plainEnv, records: undefined });
});

test('--blocker-landing: --integration-branch defaults to main in the compare path', () => {
  const { runner, calls } = landingFixture({ repository: { b5: closedBlocker('eee555') } });
  const { deps } = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['10', '11', '--blocker-landing'], deps), 0);
  assert.match(calls.find(isCompare)[1], /compare\/main\.\.\.eee555/);
});

test('--blocker-landing: a blocker shared by two records is queried once and reported on both, in blockedBy order', () => {
  const { runner, calls } = landingFixture({
    repository: { b5: closedBlocker('eee555'), b6: closedBlocker('fff666') },
    statuses: { eee555: 'behind\n', fff666: 'diverged\n' },
    extra: { 12: issue({ number: 12, title: 'Twelve', body: `Blocked by #6\nBlocked by #5\n\n${specBody(['c.js'])}` }) },
  });
  const { deps, out } = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['10', '11', '12', '--blocker-landing'], deps), 0);
  const env = JSON.parse(out.join(''));
  assert.deepEqual(env.records['12'].blockerLanding.map((r) => [r.blocker, r.verdict]), [[6, 'unlanded'], [5, 'landed']]);
  assert.deepEqual(env.records['11'].blockerLanding.map((r) => [r.blocker, r.verdict]), [[5, 'landed']]);
  const queries = calls.filter(isGraphQL).map(gqlQuery);
  assert.equal(queries.length, 1);
  assert.equal((queries[0].match(/b5: issue/g) || []).length, 1);
});

test('AC11.2: a native-mode record with no out-of-run blockers makes no blocker-landing query and no compare call', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A', body: specBody(['a.js']) }));
    if (isGraphQL(args)) return JSON.stringify({ data: { repository: { i720: { number: 720, blockedBy: { nodes: [] } } } } });
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner });
  assert.equal(run(['720', '--blocker-landing', '--work-links', 'native', '--repo', 'acme/w'], deps), 0);
  assert.deepEqual(JSON.parse(out.join('')).records['720'].blockerLanding, []);
  const graphql = calls.filter(isGraphQL);
  assert.equal(graphql.length, 1, 'only the native dependency call');
  assert.ok(graphql.every((a) => !/CLOSED_EVENT/.test(gqlQuery(a))));
  assert.equal(calls.filter(isCompare).length, 0);
});

test('AC9.1: --blocker-landing GraphQL failure exits 1 naming the failed query, prints no envelope', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isIssueView(args, 10)) return JSON.stringify(issue({ number: 10, title: 'Ten', body: specBody(['a.js']) }));
    if (isIssueView(args, 11)) return JSON.stringify(issue({ number: 11, title: 'Eleven', body: `Blocked by #5\n\n${specBody(['b.js'])}` }));
    if (isGraphQL(args) && /CLOSED_EVENT/.test(gqlQuery(args))) throw new Error('HTTP 502: Bad Gateway');
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out, err } = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['10', '11', '--blocker-landing'], deps), 1);
  assert.equal(out.length, 0);
  assert.match(err.join(''), /preflight-records\.js: blocker landing query failed: .*502/);
  assert.equal(calls.filter(isCompare).length, 0);
});

test('AC9.1: a blocker-query failure prints ONE stderr line even when the runner error spans many lines (the exec message embeds the whole query)', () => {
  const longQuery = `query($owner:String!,$repo:String!){ ${'b5: issue(number:5){ number state } '.repeat(40)} }`;
  const runner = (args) => {
    if (isIssueView(args, 11)) return JSON.stringify(issue({ number: 11, title: 'Eleven', body: `Blocked by #5\n\n${specBody(['b.js'])}` }));
    if (isGraphQL(args)) {
      const e = new Error(`Command failed: gh api graphql -f query=${longQuery}\nline two\r\nline three`);
      e.stderr = 'gh: Resource not accessible\nby integration (HTTP 403)\n';
      e.stdout = '{\n  "data": null\n}\n';
      throw e;
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out, err } = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['11', '--blocker-landing'], deps), 1);
  assert.equal(out.length, 0);
  const text = err.join('');
  assert.match(text, /^preflight-records\.js: blocker landing query failed: [^\n]+\n$/, 'exactly one line');
  assert.ok(text.length < 1000, `bounded, got ${text.length} chars`);
  assert.match(text, /403/, 'the diagnostic tail (gh stderr) survives the truncation');
  assert.match(text, /Command failed: gh api graphql/, 'the head survives too');
});

test('AC9.1: --blocker-landing with no resolvable repo and an out-of-run blocker exits 2 before any blocker call; with an empty blocker set it exits 0', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isIssueView(args, 10)) return JSON.stringify(issue({ number: 10, title: 'Ten', body: specBody(['a.js']) }));
    if (isIssueView(args, 11)) return JSON.stringify(issue({ number: 11, title: 'Eleven', body: `Blocked by #5\n\n${specBody(['b.js'])}` }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const blocked = cliDeps({ runner, workLinks: 'body-text' });
  blocked.deps.remoteUrl = () => { throw new Error("fatal: No such remote 'origin'"); };
  assert.equal(run(['11', '--blocker-landing'], blocked.deps), 2);
  assert.equal(blocked.out.length, 0);
  assert.match(blocked.err.join(''), /could not resolve owner\/repo for --blocker-landing — pass --repo owner\/name/);
  assert.deepEqual(calls.filter((a) => !isIssueView(a, 11)), [], 'no runner call past the issue fetch');

  calls.length = 0;
  const free = cliDeps({ runner, workLinks: 'body-text' });
  free.deps.remoteUrl = () => { throw new Error("fatal: No such remote 'origin'"); };
  assert.equal(run(['10', '--blocker-landing'], free.deps), 0);
  assert.deepEqual(JSON.parse(free.out.join('')).records['10'].blockerLanding, []);
  assert.deepEqual(calls.filter((a) => !isIssueView(a, 10)), []);
});

test('--blocker-landing: a Blocked by number that is no valid issue number exits 2 before any blocker call (a fixed input, so no retry would help)', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isIssueView(args, 11)) return JSON.stringify(issue({ number: 11, title: 'Eleven', body: `Blocked by #0\n\n${specBody(['b.js'])}` }));
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out, err } = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['11', '--blocker-landing'], deps), 2);
  assert.equal(out.length, 0);
  assert.match(err.join(''), /preflight-records\.js: --blocker-landing: not a valid issue number: 0/);
  assert.deepEqual(calls.filter((a) => !isIssueView(a, 11)), [], 'no GraphQL, no compare call');
});

test('--blocker-landing: a compare call that throws leaves the blocker undetermined/probe-failed, exits 0, and prints one stderr line carrying the cause', () => {
  const { runner } = landingFixture({ repository: { b5: closedBlocker('eee555') }, statuses: {} });
  const { deps, out, err } = cliDeps({ runner, workLinks: 'body-text' });
  assert.equal(run(['10', '11', '--blocker-landing', '--integration-branch', 'dev'], deps), 0);
  assert.deepEqual(JSON.parse(out.join('')).records['11'].blockerLanding,
    [{ blocker: 5, verdict: 'undetermined', commit: 'eee555', via: 'probe-failed' }]);
  const text = err.join('');
  assert.match(text, /^preflight-records\.js: blocker landing compare failed for eee555: [^\n]*unexpected compare eee555[^\n]*\n$/, 'exactly one line, with the cause');
});

test('AC7.1: --blocker-landing under --records-json: every out-of-run blocker undetermined/records-json, one stderr line, no runner call, exit 0', () => {
  let calls = 0;
  const { deps, out, err } = cliDeps({
    runner: () => { calls++; throw new Error('must not call gh'); },
    files: {
      '/r.json': JSON.stringify([
        issue({ number: 10, title: 'Ten', body: specBody(['a.js']) }),
        issue({ number: 11, title: 'Eleven', body: `Blocked by #10\nBlocked by #5\nBlocked by #4\n\n${specBody(['b.js'])}` }),
      ]),
    },
  });
  assert.equal(run(['10', '11', '--records-json', '/r.json', '--blocker-landing'], deps), 0);
  assert.equal(calls, 0);
  const env = JSON.parse(out.join(''));
  assert.deepEqual(env.records['11'].blockerLanding, [
    { blocker: 5, verdict: 'undetermined', commit: null, via: 'records-json' },
    { blocker: 4, verdict: 'undetermined', commit: null, via: 'records-json' },
  ]);
  assert.deepEqual(env.records['10'].blockerLanding, []);
  assert.equal(err.join(''), 'preflight-records.js: --records-json makes no gh call — blocker landing undetermined for #4, #5 (pass --blocker-states-json to judge open blockers)\n');
});

test('AC7.1: --records-json with --blocker-landing and no out-of-run blocker prints no degrade line', () => {
  const { deps, out, err } = cliDeps({
    runner: noGh,
    files: { '/r.json': JSON.stringify([issue({ number: 10, title: 'Ten', body: specBody(['a.js']) })]) },
  });
  assert.equal(run(['10', '--records-json', '/r.json', '--blocker-landing'], deps), 0);
  assert.deepEqual(JSON.parse(out.join('')).records['10'].blockerLanding, []);
  assert.equal(err.join(''), '');
});

test('AC6.1 (gh-absent): --records-json --blocker-states-json — an open out-of-run blocker reads open, a closed COMPLETED one undetermined, a NOT_PLANNED one not-applicable; zero runner calls', () => {
  let calls = 0;
  const { deps, out, err } = cliDeps({
    runner: () => { calls++; throw new Error('must not call gh'); },
    files: {
      '/r.json': JSON.stringify([
        issue({ number: 11, title: 'Eleven', body: `Blocked by #5\nBlocked by #6\nBlocked by #7\n\n${specBody(['b.js'])}` }),
      ]),
      '/s.json': JSON.stringify({
        5: { state: 'OPEN' },
        6: { state: 'closed', state_reason: 'completed' },
        7: { state: 'CLOSED', stateReason: 'NOT_PLANNED' },
        99: { state: 'OPEN' },
      }),
    },
  });
  assert.equal(run(['11', '--records-json', '/r.json', '--blocker-landing', '--blocker-states-json', '/s.json'], deps), 0);
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(out.join('')).records['11'].blockerLanding, [
    { blocker: 5, verdict: 'open', commit: null, via: 'records-json' },
    { blocker: 6, verdict: 'undetermined', commit: null, via: 'records-json' },
    { blocker: 7, verdict: 'not-applicable', commit: null, via: 'state-reason' },
  ]);
  assert.equal(err.join(''), '', 'a supplied states file means no degrade line');
});

test('--blocker-states-json input problems exit 2 with no stdout and no runner call', () => {
  const records = JSON.stringify([issue({ number: 11, title: 'Eleven', body: `Blocked by #5\nBlocked by #6\n\n${specBody(['b.js'])}` })]);
  const cases = [
    ['a union blocker missing from the file', { '/s.json': JSON.stringify({ 5: { state: 'OPEN' } }) }, /no usable state for #6/],
    ['an entry with an unknown state', { '/s.json': JSON.stringify({ 5: { state: 'OPEN' }, 6: { state: 'merged' } }) }, /no usable state for #6/],
    ['several unusable entries are all named', { '/s.json': '{}' }, /no usable state for #5, #6/],
    ['non-JSON', { '/s.json': '{' }, /--blocker-states-json \/s\.json is not valid JSON/],
    ['a JSON array', { '/s.json': '[]' }, /--blocker-states-json must be a JSON object/],
    ['JSON null', { '/s.json': 'null' }, /--blocker-states-json must be a JSON object/],
    ['an unreadable file', {}, /cannot read --blocker-states-json \/s\.json/],
  ];
  for (const [label, extraFiles, pattern] of cases) {
    const { deps, out, err } = cliDeps({ runner: noGh, files: { '/r.json': records, ...extraFiles } });
    assert.equal(run(['11', '--records-json', '/r.json', '--blocker-landing', '--blocker-states-json', '/s.json'], deps), 2, label);
    assert.equal(out.length, 0, label);
    assert.match(err.join(''), pattern, label);
  }
});

test('--blocker-states-json without both --records-json and --blocker-landing is a malformed invocation (exit 2, usage on stderr)', () => {
  const files = { '/r.json': JSON.stringify([issue({ number: 11, title: 'Eleven', body: specBody(['b.js']) })]), '/s.json': '{}' };
  for (const [label, argv] of [
    ['neither', ['11', '--blocker-states-json', '/s.json']],
    ['no --records-json', ['11', '--blocker-landing', '--blocker-states-json', '/s.json']],
    ['no --blocker-landing', ['11', '--records-json', '/r.json', '--blocker-states-json', '/s.json']],
    ['bare flag', ['11', '--records-json', '/r.json', '--blocker-landing', '--blocker-states-json']],
    ['flag-looking value', ['11', '--records-json', '/r.json', '--blocker-landing', '--blocker-states-json', '--waves']],
  ]) {
    const { deps, out, err } = cliDeps({ runner: noGh, files });
    assert.equal(run(argv, deps), 2, label);
    assert.equal(out.length, 0, label);
    assert.match(err.join(''), /usage:/, label);
  }
});

test('--help usage names --blocker-landing and --blocker-states-json', () => {
  const { deps, out } = cliDeps({ runner: noGh });
  assert.equal(run(['--help'], deps), 0);
  assert.match(out.join(''), /\[--blocker-landing\] \[--blocker-states-json <path>\]/);
});

// --- lib: outOfRunBlockers (#4553) ---------------------------------------

test('outOfRunBlockers: drops in-run numbers, keeps blockedBy order, union deduped ascending', () => {
  const records = {
    10: { blockedBy: [] },
    11: { blockedBy: [10, 9, 5, 12] },
    12: { blockedBy: [5, 3, 11] },
  };
  const { byRecord, union } = outOfRunBlockers(records, [10, 11, 12]);
  assert.deepEqual([...byRecord.entries()], [[10, []], [11, [9, 5]], [12, [5, 3]]]);
  assert.deepEqual(union, [3, 5, 9]);
});

test('outOfRunBlockers: no out-of-run blockers → empty union', () => {
  const { byRecord, union } = outOfRunBlockers({ 10: { blockedBy: [] }, 11: { blockedBy: [10] } }, [10, 11]);
  assert.deepEqual(union, []);
  assert.deepEqual([...byRecord.entries()], [[10, []], [11, []]]);
});

// --- CLI: --prefetched-json (#4792) -----------------------------------------
// Records the caller already fetched over gh: only fetchIssues is skipped.

const prefetchedIssues = () => [
  issue({ number: 10, title: 'Ten', body: specBody(['a.js']) }),
  issue({ number: 11, title: 'Eleven', body: `Blocked by #10\nBlocked by #5\n\n${specBody(['b.js'])}` }),
];
const issueViewCalls = (calls) => calls.filter((a) => a[0] === 'issue' && a[1] === 'view');

test('AC3.1: --prefetched-json - reads the records from stdin and makes no gh issue view call; the envelope equals the gh-fetched one', () => {
  const viaGh = landingFixture({ repository: {} });
  const gh = cliDeps({ runner: viaGh.runner, workLinks: 'body-text' });
  assert.equal(run(['10', '11'], gh.deps), 0);
  assert.equal(issueViewCalls(viaGh.calls).length, 2, 'control: the plain gh path fetches each record');

  const prefetched = landingFixture({ repository: {} });
  const pre = cliDeps({ runner: prefetched.runner, workLinks: 'body-text', stdin: JSON.stringify(prefetchedIssues()) });
  assert.equal(run(['10', '11', '--prefetched-json', '-'], pre.deps), 0);
  assert.equal(issueViewCalls(prefetched.calls).length, 0);
  assert.equal(prefetched.calls.length, 0);
  assert.equal(pre.out.join(''), gh.out.join(''));
});

test('AC3.1: --prefetched-json with --blocker-landing still judges landing over gh', () => {
  const { runner, calls } = landingFixture({ repository: { b5: closedBlocker('eee555') }, statuses: { eee555: 'diverged\n' } });
  const { deps, out } = cliDeps({ runner, workLinks: 'body-text', stdin: JSON.stringify(prefetchedIssues()) });
  assert.equal(run(['10', '11', '--prefetched-json', '-', '--blocker-landing', '--integration-branch', 'dev'], deps), 0);
  const env = JSON.parse(out.join(''));
  assert.deepEqual(env.records['11'].blockerLanding, [{ blocker: 5, verdict: 'unlanded', commit: 'eee555', via: 'closer-pr' }]);
  assert.equal(calls.filter(isGraphQL).length, 1);
  const compares = calls.filter(isCompare);
  assert.equal(compares.length, 1);
  assert.match(compares[0][1], /compare\/dev\.\.\.eee555/);
  assert.equal(issueViewCalls(calls).length, 0);
});

test('--prefetched-json <path> reads the named file', () => {
  const viaStdin = landingFixture({ repository: {} });
  const a = cliDeps({ runner: viaStdin.runner, stdin: JSON.stringify(prefetchedIssues()) });
  assert.equal(run(['10', '11', '--prefetched-json', '-'], a.deps), 0);

  const viaFile = landingFixture({ repository: {} });
  const b = cliDeps({ runner: viaFile.runner, files: { '/p.json': JSON.stringify(prefetchedIssues()) } });
  assert.equal(run(['10', '11', '--prefetched-json', '/p.json'], b.deps), 0);
  assert.equal(viaFile.calls.length, 0);
  assert.equal(b.out.join(''), a.out.join(''));
});

test('--prefetched-json under work-links: native still makes the native dependency call', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (isGraphQL(args) && !/CLOSED_EVENT/.test(gqlQuery(args))) {
      return JSON.stringify({ data: { repository: { i10: { number: 10, blockedBy: { nodes: [] } }, i11: { number: 11, blockedBy: { nodes: [{ number: 5, state: 'OPEN' }] } } } } });
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  const { deps, out } = cliDeps({ runner, workLinks: 'native', stdin: JSON.stringify(prefetchedIssues()) });
  assert.equal(run(['10', '11', '--repo', 'acme/w', '--prefetched-json', '-'], deps), 0);
  assert.equal(calls.filter(isGraphQL).length, 1);
  assert.equal(issueViewCalls(calls).length, 0);
  const env = JSON.parse(out.join(''));
  assert.equal(env.workLinks, 'native');
  assert.equal('nativeLinksUnchecked' in env, false);
  assert.deepEqual(env.records['11'].blockedBy, [5]);
  assert.equal(env.records['11'].openBlocker, true);
});

test('--prefetched-json input problems are exit 2, naming the flag', () => {
  const [ten, eleven] = prefetchedIssues();
  const cases = [
    ['an unreadable path', { files: {} }, /cannot read --prefetched-json \/p\.json/],
    ['stdin that cannot be read', { argvValue: '-' }, /cannot read --prefetched-json -/],
    ['not JSON', { files: { '/p.json': '{' } }, /--prefetched-json \/p\.json is not valid JSON/],
    ['not an array', { files: { '/p.json': '{}' } }, /--prefetched-json must be a JSON array/],
    ['a requested number missing', { files: { '/p.json': JSON.stringify([ten]) } }, /--prefetched-json is missing requested #11/],
    ['an extra number', { files: { '/p.json': JSON.stringify([ten, eleven, issue({ number: 12, title: 'x', body: '' })]) } }, /--prefetched-json lists #12, which was not requested/],
    ['a duplicated number', { files: { '/p.json': JSON.stringify([ten, ten, eleven]) } }, /--prefetched-json lists #10 more than once/],
  ];
  for (const [label, { files = {}, argvValue = '/p.json' }, pattern] of cases) {
    const { deps, out, err } = cliDeps({ runner: noGh, files });
    assert.equal(run(['10', '11', '--prefetched-json', argvValue], deps), 2, label);
    assert.equal(out.length, 0, label);
    const text = err.join('');
    assert.match(text, pattern, label);
    assert.match(text, /--prefetched-json/, label);
    assert.doesNotMatch(text, /--records-json/, label);
  }
});

test('--prefetched-json and --records-json together are a malformed invocation', () => {
  let calls = 0;
  const { deps, out, err } = cliDeps({
    runner: () => { calls++; throw new Error('must not call gh'); },
    files: { '/r.json': JSON.stringify(prefetchedIssues()) },
    stdin: JSON.stringify(prefetchedIssues()),
  });
  assert.equal(run(['10', '11', '--records-json', '/r.json', '--prefetched-json', '-'], deps), 2);
  assert.equal(out.length, 0);
  assert.equal(calls, 0);
  assert.match(err.join(''), /--prefetched-json and --records-json are mutually exclusive/);
});

test('--prefetched-json with no value is a malformed invocation', () => {
  for (const argv of [['10', '--prefetched-json'], ['10', '--prefetched-json', '--waves']]) {
    const { deps, out, err } = cliDeps({ runner: noGh, stdin: '[]' });
    assert.equal(run(argv, deps), 2, argv.join(' '));
    assert.equal(out.length, 0);
    assert.match(err.join(''), /missing value for --prefetched-json/);
  }
});

test('--help usage names --prefetched-json', () => {
  const { deps, out } = cliDeps({ runner: noGh });
  assert.equal(run(['--help'], deps), 0);
  assert.match(out.join(''), /\[--records-json <path>\] \[--prefetched-json <path>\]/);
  assert.match(out.join(''), /\[--blocker-landing\] \[--blocker-states-json <path>\]/);
});

test('issuesFromRecordsJson keeps its --records-json messages by default and names the given flag', () => {
  const { issuesFromRecordsJson } = require('../../../plugin/bin/lib/preflight-records/preflight-records');
  assert.equal(issuesFromRecordsJson({}, [1]).error, '--records-json must be a JSON array');
  assert.equal(issuesFromRecordsJson({}, [1], '--prefetched-json').error, '--prefetched-json must be a JSON array');
  const bad = [[{ body: '' }], [{ number: 1 }], [{ number: 1, body: '', labels: 'x' }], [{ number: 1, body: '' }, { number: 1, body: '' }], [{ number: 2, body: '' }]];
  for (const raw of bad) {
    const named = issuesFromRecordsJson(raw, [1], '--prefetched-json').error;
    assert.match(named, /^--prefetched-json /);
    assert.equal(named, issuesFromRecordsJson(raw, [1]).error.replace('--records-json', '--prefetched-json'));
  }
  assert.match(issuesFromRecordsJson([], [1], '--prefetched-json').error, /^--prefetched-json is missing requested #1$/);
});

// --- native-missing naming (#4792) ------------------------------------------

const nativeNotFound = (alias, message) => JSON.stringify({
  data: { repository: { i720: { number: 720, blockedBy: { nodes: [] } }, [alias]: null } },
  errors: [{ type: 'NOT_FOUND', path: ['repository', alias], message }],
});

function nativeThrowFixture(throwOnNative) {
  const runner = (args) => {
    if (isIssueView(args, 720)) return JSON.stringify(issue({ number: 720, title: 'A', body: specBody(['a.js']) }));
    if (isIssueView(args, 721)) return JSON.stringify(issue({ number: 721, title: 'B', body: specBody(['b.js']) }));
    if (isGraphQL(args)) throw throwOnNative;
    throw new Error('unexpected ' + args.join(' '));
  };
  return cliDeps({ runner, workLinks: 'native' });
}

test('AC4.3: native mode names a candidate gh reported NOT_FOUND (exit 1 with partial data) as missing dependency data (#4792)', () => {
  const thrown = Object.assign(new Error('Command failed: gh api graphql -f query=…'), {
    stdout: nativeNotFound('i721', 'Could not resolve to an Issue with the number of 721.'),
  });
  const { deps, out, err } = nativeThrowFixture(thrown);
  assert.equal(run(['720', '721'], deps), 1);
  assert.equal(out.length, 0);
  assert.match(err.join(''), /^preflight-records\.js: missing dependency data for #721 \(GraphQL: Could not resolve to an Issue with the number of 721\.\)$/m);
});

test('a native-call throw that is not NOT_FOUND-only is rethrown unchanged', () => {
  const cases = [
    ['an error with no stdout', new Error('Command failed: boom-no-stdout')],
    ['a non-NOT_FOUND error', Object.assign(new Error('Command failed: boom-forbidden'), {
      stdout: JSON.stringify({ data: { repository: { i720: { number: 720, blockedBy: { nodes: [] } }, i721: null } }, errors: [{ type: 'FORBIDDEN', path: ['repository', 'i721'] }] }),
    })],
    ['a NOT_FOUND on an alias outside the request', Object.assign(new Error('Command failed: boom-outside'), {
      stdout: nativeNotFound('i999', 'Could not resolve to an Issue with the number of 999.'),
    })],
  ];
  for (const [label, thrown] of cases) {
    const { deps, out, err } = nativeThrowFixture(thrown);
    assert.equal(run(['720', '721'], deps), 1, label);
    assert.equal(out.length, 0, label);
    assert.ok(err.join('').includes(thrown.message), label);
    assert.doesNotMatch(err.join(''), /missing dependency data/, label);
  }
});

test('blocker-landing NOT_FOUND recovery returns the parsed response for a b{n} alias and null for an i{n} alias', () => {
  const { recoveredResponse } = require('../../../plugin/bin/lib/preflight-records/blocker-landing');
  const err = Object.assign(new Error('Command failed'), {
    stdout: JSON.stringify({ data: { repository: { b5: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'b5'] }] }),
  });
  assert.deepEqual(recoveredResponse(err, ['b5']), JSON.parse(err.stdout));
  assert.equal(recoveredResponse(err, ['i5']), null);
});
