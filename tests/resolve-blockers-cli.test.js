// tests/resolve-blockers-cli.test.js — in-process tests for
// bin/resolve-blockers.js's run(argv, deps), mirroring
// tests/materialize-run-dir-anchoring.test.js's deps-injection style (never
// tests/resolve-policy-cli.test.js's spawnSync-a-real-process style, since
// this CLI's whole point is a `gh api graphql` call that must never be live
// in a test — a fake runner in deps.runner stands in for it). Argument
// parsing and repo resolution are tested once in
// `tests/bin-lib/number-list-cli.test.js` (the shared `makeNumberListCli`
// scaffold); this file keeps only this CLI's usage name, its `gh` argv
// (`-f owner=`/`-f repo=`, `--hostname`), its output shapes and its GraphQL
// failure. The GraphQL query-building logic itself
// (buildNativeDependencyQuery) already has coverage in
// tests/bin-lib/issues/record.test.js and is not re-verified here.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../plugin/bin/resolve-blockers');

function fakeDeps(overrides = {}) {
  const calls = { runner: [], stdout: [], stderr: [] };
  return {
    calls,
    ghAvailable: () => true,
    remoteUrl: () => 'https://github.com/acme/widgets.git',
    runner: (args) => {
      calls.runner.push(args);
      return JSON.stringify({
        data: {
          repository: {
            i720: { number: 720, blockedBy: { nodes: [{ number: 700, state: 'OPEN' }] } },
          },
        },
      });
    },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
    ...overrides,
  };
}

// --- argument parsing ---------------------------------------------------

test('missing <n> is a malformed invocation — exit 1, usage on stderr, gh never probed', () => {
  const deps = fakeDeps({ ghAvailable: () => { throw new Error('should not be called'); } });
  const code = run([], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /missing <n> argument/);
  assert.match(deps.calls.stderr.join(''), /usage: resolve-blockers\.js/);
});

test('--help prints usage and exits 0 without touching gh/git', () => {
  const deps = fakeDeps({
    ghAvailable: () => { throw new Error('should not be called'); },
    remoteUrl: () => { throw new Error('should not be called'); },
  });
  const code = run(['--help'], deps);
  assert.equal(code, 0);
  assert.match(deps.calls.stdout.join(''), /usage: resolve-blockers\.js/);
});

// --- gh / repo resolution ------------------------------------------------

test('--repo owner/name overrides the git remote', () => {
  const deps = fakeDeps({ remoteUrl: () => { throw new Error('should not be called'); } });
  const code = run(['720', '--repo', 'someone/else'], deps);
  assert.equal(code, 0);
  const q = deps.calls.runner[0].join(' ');
  assert.match(q, /-f owner=someone -f repo=else/);
});

// #2240: a GitHub Enterprise Server origin remote threads --hostname onto
// the one gh call this CLI makes (the --repo flag always resolves against
// github.com by this codebase's existing convention — only the auto-detected
// remote can carry a non-github.com host).
test('#2240: a GitHub Enterprise Server origin remote passes --hostname on the graphql call', () => {
  const deps = fakeDeps({ remoteUrl: () => 'https://ghe.example.com/acme/widgets.git', gateDeps: { env: { GH_HOST: 'ghe.example.com' } } });
  const code = run(['720'], deps);
  assert.equal(code, 0);
  const q = deps.calls.runner[0];
  assert.deepEqual(q.slice(-2), ['--hostname', 'ghe.example.com']);
});

test('#2240: a plain github.com remote omits --hostname', () => {
  const deps = fakeDeps();
  const code = run(['720'], deps);
  assert.equal(code, 0);
  assert.doesNotMatch(deps.calls.runner[0].join(' '), /--hostname/);
});

// --- success / output shape ----------------------------------------------

test('success: one runner call, a number-keyed JSON line on stdout, exit 0', () => {
  const deps = fakeDeps();
  const code = run(['720'], deps);
  assert.equal(code, 0);
  assert.equal(deps.calls.runner.length, 1, 'exactly one gh api graphql call');
  assert.equal(deps.calls.stderr.length, 0, 'success path writes nothing to stderr');
  assert.equal(deps.calls.stdout.length, 1, 'exactly one stdout write');
  assert.deepEqual(JSON.parse(deps.calls.stdout[0]), { 720: { blockedBy: [700], openBlocker: true, openBlockerIds: [700] } });
});

test('success: owner/repo parsed from the origin remote when --repo is absent', () => {
  const deps = fakeDeps();
  run(['720'], deps);
  const q = deps.calls.runner[0].join(' ');
  assert.match(q, /-f owner=acme -f repo=widgets/);
});

test('success: no open blockers reports openBlocker false, blockedBy []', () => {
  const deps = fakeDeps({
    runner: (args) => JSON.stringify({
      data: { repository: { i720: { number: 720, blockedBy: { nodes: [] } } } },
    }),
  });
  const code = run(['720'], deps);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(deps.calls.stdout[0]), { 720: { blockedBy: [], openBlocker: false, openBlockerIds: [] } });
});

test('success: a comma list of numbers resolves in ONE runner call, one key per requested number', () => {
  const deps = fakeDeps();
  deps.runner = (args) => {
    deps.calls.runner.push(args);
    return JSON.stringify({
      data: {
        repository: {
          i720: { number: 720, blockedBy: { nodes: [{ number: 700, state: 'OPEN' }] } },
          i730: { number: 730, blockedBy: { nodes: [] } },
        },
      },
    });
  };
  const code = run(['720,730'], deps);
  assert.equal(code, 0);
  assert.equal(deps.calls.runner.length, 1, 'one aliased call covers the whole list, never one call per number');
  assert.deepEqual(JSON.parse(deps.calls.stdout[0]), {
    720: { blockedBy: [700], openBlocker: true, openBlockerIds: [700] },
    730: { blockedBy: [], openBlocker: false, openBlockerIds: [] },
  });
});

// --- GraphQL failure propagation -----------------------------------------

test('a thrown GraphQL failure (missing data.repository) surfaces as exit 3, not a crash', () => {
  const deps = fakeDeps({ runner: () => JSON.stringify({ data: { repository: null } }) });
  const code = run(['720'], deps);
  assert.equal(code, 3);
  assert.match(deps.calls.stderr.join(''), /missing repository/);
  assert.equal(deps.calls.stdout.length, 0);
});

// --- blocker snapshot (#5902) ---------------------------------------------

const { makeBlockerSnapshotSink } = require('../plugin/bin/lib/station-events/blockers');
const { buildLine } = require('../plugin/bin/lib/station-events/emit');

// #12 has a same-repository blocker plus one in another repository; #13 has none.
const twelveThirteen = () => JSON.stringify({
  data: {
    repository: {
      i12: { number: 12, repository: { nameWithOwner: 'acme/widgets' }, blockedBy: { nodes: [
        { number: 5, state: 'OPEN', repository: { nameWithOwner: 'other/repo' } },
        { number: 6, state: 'CLOSED', repository: { nameWithOwner: 'acme/widgets' } },
      ] } },
      i13: { number: 13, repository: { nameWithOwner: 'acme/widgets' }, blockedBy: { nodes: [] } },
    },
  },
});

function snapshotRecorder() {
  const seen = [];
  return { seen, onSnapshot: (n, entry, meta) => seen.push({ n, entry, meta }) };
}

test('#5902: onSnapshot sees 12 then 13, and stdout and exit code match the call without it', () => {
  const plain = fakeDeps({ runner: twelveThirteen });
  const plainCode = run(['12,13'], plain);
  const { seen, onSnapshot } = snapshotRecorder();
  const withSink = fakeDeps({ runner: twelveThirteen, onSnapshot });
  const code = run(['12,13'], withSink);
  assert.deepEqual(seen.map((s) => s.n), [12, 13]);
  assert.equal(seen[0].meta.owner, 'acme');
  assert.equal(seen[0].meta.repo, 'widgets');
  assert.equal(code, plainCode);
  assert.equal(code, 0);
  assert.deepEqual(withSink.calls.stdout, plain.calls.stdout);
  assert.deepEqual(withSink.calls.stderr, plain.calls.stderr);
});

test('#5902: a blocker in another repository reaches the snapshot entry\'s crossRepoBlockers', () => {
  const { seen, onSnapshot } = snapshotRecorder();
  run(['12,13'], fakeDeps({ runner: twelveThirteen, onSnapshot }));
  assert.deepEqual(seen[0].entry.crossRepoBlockers, [{ number: 5, repository: 'other/repo', state: 'OPEN' }]);
  assert.equal('crossRepoBlockers' in seen[1].entry, false);
});

test('#5902: a throwing onSnapshot leaves stdout and exit code unchanged', () => {
  const plain = fakeDeps({ runner: twelveThirteen });
  const plainCode = run(['12,13'], plain);
  let thrown = 0;
  const throwing = fakeDeps({ runner: twelveThirteen, onSnapshot: () => { thrown += 1; throw new Error('sink boom'); } });
  const code = run(['12,13'], throwing);
  assert.equal(code, plainCode);
  assert.deepEqual(throwing.calls.stdout, plain.calls.stdout);
  assert.deepEqual(throwing.calls.stderr, plain.calls.stderr);
  assert.equal(thrown, 2, 'the sink was reached for both numbers');
});

test('#5902: a GraphQL failure (exit 3) records no snapshot, even for a number that did come back', () => {
  const { seen, onSnapshot } = snapshotRecorder();
  const partial = () => JSON.stringify({
    data: { repository: { i12: { number: 12, blockedBy: { nodes: [] } } } },
  });
  const deps = fakeDeps({ runner: partial, onSnapshot });
  assert.equal(run(['12,13'], deps), 3);
  assert.deepEqual(seen, []);
});

test('#5902: makeBlockerSnapshotSink wired as onSnapshot yields two valid blockers events, 12 and 13', () => {
  const events = [];
  const onSnapshot = makeBlockerSnapshotSink({ stationEvent: (e) => events.push(e), sessionId: 's-1', runId: null });
  assert.equal(run(['12,13'], fakeDeps({ runner: twelveThirteen, onSnapshot })), 0);
  assert.deepEqual(events.map((e) => [e.kind, e.recordNumber]), [['blockers', 12], ['blockers', 13]]);
  for (const e of events) {
    const line = buildLine(e);
    assert.notEqual(line, null);
    assert.equal(line.kind, 'blockers');
    assert.equal(line.repoName, 'acme/widgets');
  }
});

test('#5902: realDeps wires a stationEvent emitter, so the real entry point emits', () => {
  const { realDeps } = require('../plugin/bin/resolve-blockers');
  assert.equal(typeof realDeps.stationEvent, 'function', 'stationEvent is wired');
  assert.equal(typeof realDeps.runner, 'function', 'the number-list scaffold deps are still carried');
});

test('#5902: run builds the blocker sink from deps.stationEvent when no onSnapshot is passed', () => {
  const events = [];
  const deps = fakeDeps({ runner: twelveThirteen, stationEvent: (e) => events.push(e) });
  assert.equal(run(['12,13'], deps), 0);
  assert.deepEqual(events.map((e) => [e.kind, e.recordNumber, e.repoName]), [
    ['blockers', 12, 'acme/widgets'], ['blockers', 13, 'acme/widgets'],
  ]);
});

test('an unchanged snapshot is not appended through run', () => {
  const events = [];
  const last = (repo, n) => (n === 13 ? { blockedBy: [], openBlockerIds: [], crossRepoBlockers: [], fetchedAt: 'old' } : null);
  const deps = fakeDeps({ runner: twelveThirteen, stationEvent: (e) => events.push(e), lastPayload: last });
  assert.equal(run(['12,13'], deps), 0);
  assert.deepEqual(events.map((e) => e.recordNumber), [12]);
});

test('#5902: an explicit onSnapshot wins over deps.stationEvent', () => {
  const events = [];
  const { seen, onSnapshot } = snapshotRecorder();
  assert.equal(run(['12,13'], fakeDeps({ runner: twelveThirteen, onSnapshot, stationEvent: (e) => events.push(e) })), 0);
  assert.deepEqual(seen.map((s) => s.n), [12, 13]);
  assert.deepEqual(events, []);
});
