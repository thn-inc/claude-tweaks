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
  runner, workLinks = 'body-text', remoteUrl = 'https://github.com/acme/w.git', files = {},
} = {}) {
  const out = [];
  const err = [];
  return {
    deps: {
      runner,
      resolveWorkLinks: () => workLinks,
      remoteUrl: () => remoteUrl,
      readFile: (p) => { if (!(p in files)) throw new Error(`ENOENT: ${p}`); return files[p]; },
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
  assert.deepEqual(Object.keys(JSON.parse(plain.out.join(''))).sort(), ['overlapGroups', 'records', 'workLinks']);
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
