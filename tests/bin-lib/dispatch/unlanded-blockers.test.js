'use strict';
// #4792: the unlanded-blocker and malformed-blocker exclusion CLI. The fixture world
// answers gh the way github.com does and runs the REAL preflight-records.js, so every
// envelope and every stderr line the CLI reads is the writer's own; tests never touch
// real gh (the runner throws on anything it does not serve).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { run, parseArgs, realDeps } = require('../../../plugin/bin/dispatch-unlanded-blockers');
const lib = require('../../../plugin/bin/lib/dispatch/unlanded-blockers');
const { run: preflightRun } = require('../../../plugin/bin/preflight-records');

const {
  poolRecords, malformedRecords, nativeMissingRecords, malformedExclusion, landingExclusions, withoutExcluded,
} = lib;

// --- fixture world ----------------------------------------------------------

const isGraphQL = (args) => args[0] === 'api' && args[1] === 'graphql';
const isCompare = (args) => args[0] === 'api' && /\/compare\//.test(args[1]);
const queryOf = (args) => (args.find((a) => typeof a === 'string' && a.startsWith('query=')) || '');
const positionals = (args) => args.slice(0, args.indexOf('--prefetched-json'));
const hasPair = (args, a, b) => args.some((x, i) => x === a && args[i + 1] === b);

const closedBlocker = (oid, number = 5) => ({
  number,
  state: 'CLOSED',
  stateReason: 'COMPLETED',
  timelineItems: { nodes: [{ closer: { __typename: 'PullRequest', number: 90, merged: true, baseRefName: 'dev', mergeCommit: { oid } } }] },
  closedByPullRequestsReferences: { nodes: [] },
});
const openBlocker = (number) => ({
  number, state: 'OPEN', stateReason: null, timelineItems: { nodes: [] }, closedByPullRequestsReferences: { nodes: [] },
});

const rec = (number, body = '', extra = {}) => ({
  number, title: `T${number}`, body, labels: [{ name: 'auto:build' }], ...extra,
});
const R10 = rec(10);
const R11 = rec(11, 'Blocked by #5\n');
const R13_ZERO = rec(13, 'Blocked by #0\n');

const notFoundError = (repository, errors) => Object.assign(new Error('Command failed: gh api graphql'), {
  stdout: JSON.stringify({ data: { repository }, errors }),
});

// repository: the landing query's b{n} nodes; compare: sha -> status text (or an Error);
// native: null (the native query is unexpected) | { edges, missing, noRepository }.
function makeWorld({ repository = {}, compare = {}, native = null } = {}) {
  const calls = [];
  let nativeCalls = 0;
  const runner = (args) => {
    calls.push(args);
    if (isGraphQL(args)) {
      const q = queryOf(args);
      if (/blockedBy\(first:25\)/.test(q)) {
        if (!native) throw new Error('unexpected native query ' + args.join(' '));
        nativeCalls += 1;
        if (native.noRepository) return JSON.stringify({ data: { repository: null } });
        const missing = Array.isArray(native.missing) ? (native.missing[nativeCalls - 1] || {}) : (native.missing || {});
        const repo = {};
        const errors = [];
        for (const m of q.matchAll(/\bi(\d+): issue\(/g)) {
          const n = Number(m[1]);
          if (missing[n] === 'omit') continue;
          if (missing[n] === 'not-found') {
            repo[`i${n}`] = null;
            errors.push({ type: 'NOT_FOUND', path: ['repository', `i${n}`], message: `Could not resolve to an Issue with the number of ${n}.` });
            continue;
          }
          repo[`i${n}`] = { number: n, blockedBy: { nodes: (native.edges && native.edges[n]) || [] } };
        }
        if (errors.length) throw notFoundError(repo, errors);
        return JSON.stringify({ data: { repository: repo } });
      }
      if (/CLOSED_EVENT/.test(q)) {
        const repo = {};
        const errors = [];
        for (const m of q.matchAll(/\bb(\d+): issue\(/g)) {
          const key = `b${m[1]}`;
          if (!(key in repository)) throw new Error(`unexpected blocker ${key}`);
          repo[key] = repository[key];
          if (repository[key] === null) {
            errors.push({ type: 'NOT_FOUND', path: ['repository', key], message: `Could not resolve to an Issue with the number of ${m[1]}.` });
          }
        }
        if (errors.length) throw notFoundError(repo, errors);
        return JSON.stringify({ data: { repository: repo } });
      }
    }
    if (isCompare(args)) {
      const sha = args[1].split('...').pop();
      const v = compare[sha];
      if (v === undefined) throw new Error(`unexpected compare ${sha}`);
      if (v instanceof Error) throw v;
      return v;
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  return { runner, calls };
}

// A deps.preflight running the real preflight-records.js against the world.
function realPreflight(world) {
  const f = (args, input) => {
    f.calls.push({ args, input });
    const out = [];
    const err = [];
    const status = preflightRun(args, {
      runner: world.runner,
      resolveWorkLinks: () => 'body-text',
      remoteUrl: () => 'https://github.com/acme/w.git',
      readFile: () => { throw new Error('no file reads'); },
      readStdin: () => input,
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    });
    return { status, stdout: out.join(''), stderr: err.join('') };
  };
  f.calls = [];
  return f;
}

const unlandedWorld = (extra = {}) => makeWorld({ repository: { b5: closedBlocker('sha1') }, compare: { sha1: 'diverged\n' }, ...extra });
const UNLANDED_11 = { reason: 'unlanded-blocker', records: [11], detail: { blockers: [{ blocker: 5, commit: 'sha1' }] } };
const malformedEntry = (n, cause) => ({ reason: 'malformed-blocker', records: [n], detail: { cause } });

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unlanded-blockers-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The file parsed; null when absent; the raw text when it is not JSON (a corrupt file the writer refused).
const readJsonOrNull = (p) => {
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  try { return JSON.parse(text); } catch { return text; }
};

// Runs the CLI. `preflight` defaults to the real preflight-records.js over `world`.
function exec(t, {
  groups, groupsText, world, preflight, exclusionsText, branch = 'dev', workLinks = 'body-text', argv,
} = {}) {
  const dir = scratch(t);
  const G = path.join(dir, 'groups.json');
  const E = path.join(dir, 'exclusions.json');
  if (groupsText !== undefined) fs.writeFileSync(G, groupsText);
  else if (groups !== undefined) fs.writeFileSync(G, JSON.stringify(groups));
  if (exclusionsText !== undefined) fs.writeFileSync(E, exclusionsText);
  const pf = preflight || realPreflight(world || makeWorld());
  const out = [];
  const err = [];
  const code = run(argv ? argv(G, E) : ['--groups', G, '--exclusions', E, '--integration-branch', branch, '--work-links', workLinks], {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    preflight: pf,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  });
  const stdout = out.join('');
  return {
    code, stdout, stderr: err.join(''), outWrites: out.length, pf, exclusions: readJsonOrNull(E), groups: stdout ? JSON.parse(stdout) : null,
  };
}

// A stub deps.preflight; `calls` counts invocations.
function stub(result) {
  const f = (args, input) => {
    f.calls.push({ args, input });
    if (result instanceof Error) throw result;
    return typeof result === 'function' ? result(args, input) : result;
  };
  f.calls = [];
  return f;
}
const emptyLanding = (...numbers) => ({
  status: 0, stdout: JSON.stringify({ records: Object.fromEntries(numbers.map((n) => [String(n), { blockerLanding: [] }])) }), stderr: '',
});
const mustNotBeCalled = () => stub(new Error('must not be called'));

// --- AC3.1 ------------------------------------------------------------------

test('AC3.1: a pool with an unlanded out-of-run blocker excludes that record as unlanded-blocker, and includes it once the blocker lands (#4792)', (t) => {
  const groups = [[R10], [R11]];
  const world = unlandedWorld();
  const r1 = exec(t, { groups, world });
  assert.equal(r1.code, 0, r1.stderr);
  assert.deepEqual(r1.groups, [[R10]]);
  assert.deepEqual(r1.exclusions, [UNLANDED_11]);
  assert.match(r1.stderr, /AUTO — dispatch: #11 excluded, blocker #5 closed but its closing commit sha1 is not on origin\/dev\n/);
  const args = r1.pf.calls[0].args;
  assert.ok(hasPair(args, '--prefetched-json', '-'));
  assert.ok(args.includes('--blocker-landing'));
  assert.ok(hasPair(args, '--integration-branch', 'dev'));
  assert.ok(hasPair(args, '--work-links', 'body-text'));
  assert.equal(world.calls.filter((a) => a[0] === 'issue').length, 0, 'no gh issue view: the records were prefetched');

  const r2 = exec(t, { groups, world: makeWorld({ repository: { b5: closedBlocker('sha1') }, compare: { sha1: 'behind\n' } }) });
  assert.equal(r2.code, 0, r2.stderr);
  assert.deepEqual(r2.groups, [[R10], [R11]]);
  assert.equal(r2.exclusions, null);
});

test('AC3.1: an undetermined verdict keeps the candidate and logs one AUTO line', (t) => {
  const r = exec(t, { groups: [[R10], [R11]], world: makeWorld({ repository: { b5: closedBlocker('sha1') }, compare: { sha1: new Error('rate limited') } }) });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.groups, [[R10], [R11]]);
  assert.equal(r.exclusions, null);
  assert.match(r.stderr, /AUTO — dispatch: #11 kept — blocker #5 landing undetermined \(via probe-failed\)/);
});

test('an open blocker is left to the blocked pass', (t) => {
  const r = exec(t, { groups: [[R10], [R11]], world: makeWorld({ repository: { b5: openBlocker(5) } }) });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.groups, [[R10], [R11]]);
  assert.equal(r.exclusions, null);
});

test('a bundle keeps its other members; an all-excluded group disappears', (t) => {
  const R12 = rec(12, 'Blocked by #5\n');
  const r = exec(t, { groups: [[R10, R11], [R12]], world: unlandedWorld() });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.groups, [[R10]]);
  assert.deepEqual(r.exclusions, [UNLANDED_11, { ...UNLANDED_11, records: [12] }]);
});

test('a padded --integration-branch is forwarded to the child trimmed, matching the branch the AUTO lines name', (t) => {
  const r = exec(t, { groups: [[R10], [R11]], world: unlandedWorld(), branch: ' dev ' });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(hasPair(r.pf.calls[0].args, '--integration-branch', 'dev'), JSON.stringify(r.pf.calls[0].args));
  assert.match(r.stderr, /is not on origin\/dev\n/);
});

test('a record with two unlanded blockers is one unlanded-blocker entry carrying both, and logs one AUTO line per blocker', (t) => {
  const R15 = rec(15, 'Blocked by #5\nBlocked by #7\n');
  const world = makeWorld({ repository: { b5: closedBlocker('sha1'), b7: closedBlocker('sha2', 7) }, compare: { sha1: 'diverged\n', sha2: 'diverged\n' } });
  const r = exec(t, { groups: [[R10], [R15]], world });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.groups, [[R10]]);
  assert.deepEqual(r.exclusions, [{ reason: 'unlanded-blocker', records: [15], detail: { blockers: [{ blocker: 5, commit: 'sha1' }, { blocker: 7, commit: 'sha2' }] } }]);
  const autoLines = r.stderr.split('\n').filter((line) => /^AUTO — dispatch: #15 excluded, blocker #/.test(line));
  assert.equal(autoLines.length, 2, r.stderr);
  assert.match(autoLines[0], /blocker #5 closed but its closing commit sha1 is not on origin\/dev$/);
  assert.match(autoLines[1], /blocker #7 closed but its closing commit sha2 is not on origin\/dev$/);
});

// --- AC4: the screen --------------------------------------------------------

test('AC4.1 AC4.2 AC4.3: a Blocked by #0 record is excluded as malformed-blocker, the unlanded-blocker record is still excluded, and a clean record is kept, through the real preflight-records run (#4792)', (t) => {
  const r = exec(t, { groups: [[R10], [R11], [R13_ZERO]], world: unlandedWorld() });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.groups, [[R10]]);
  assert.deepEqual(r.exclusions, [malformedEntry(13, 'a Blocked by line names no valid issue number (#0)'), UNLANDED_11]);
  assert.match(r.stderr, /AUTO — dispatch: #13 excluded — malformed blocker declaration: a Blocked by line names no valid issue number \(#0\); the other candidates are still checked/);
  assert.doesNotMatch(r.stderr, /unlanded-blocker pass skipped —/);
  assert.equal(r.pf.calls.length, 1);
  assert.deepEqual(positionals(r.pf.calls[0].args), ['10', '11']);
  assert.deepEqual(JSON.parse(r.pf.calls[0].input).map((x) => x.number), [10, 11]);
});

test('AC4.2: unscreened, the same pool makes the real preflight-records run exit 2 — the screen is what keeps the check alive', () => {
  const groups = [[R10], [R11], [R13_ZERO]];
  const res = realPreflight(unlandedWorld())(
    ['10', '11', '13', '--prefetched-json', '-', '--blocker-landing', '--integration-branch', 'dev', '--work-links', 'body-text'],
    JSON.stringify(poolRecords(groups)),
  );
  assert.equal(res.status, 2);
  assert.match(res.stderr, /not a valid issue number: 0/);
});

const FAULTS = [
  ['a non-integer number', { number: 1.5, body: '', labels: [] }, 'its number is not a positive integer', 1.5, /every argument must be a positive integer issue number/],
  ['a non-string body', { number: 13, body: null, labels: [] }, 'its body is not a string', 13, /missing a string "body"/],
  ['non-array labels', { number: 13, body: '', labels: 'x' }, 'its labels are not an array', 13, /non-array "labels"/],
  ['Blocked by #0', { number: 13, body: 'Blocked by #0\n', labels: [] }, 'a Blocked by line names no valid issue number (#0)', 13, /not a valid issue number: 0/],
  // Blocked by #3000000000: unscreened, the real run exits 0 (undetermined), so it has no stderr regex.
  ['Blocked by #3000000000', { number: 13, body: 'Blocked by #3000000000\n', labels: [] }, 'a Blocked by line names no valid issue number (#3000000000)', 13],
];

test('AC4.3: each screened fault, unscreened, fails the whole call or reads undetermined; through the CLI it is a malformed-blocker exclusion and the rest are still checked', (t) => {
  for (const [label, bad, cause, number, stderrRe] of FAULTS) {
    const groups = [[R10], [R11], [{ title: 'Bad', ...bad }]];
    const makeWorldFor = () => makeWorld({
      repository: { b5: closedBlocker('sha1'), b3000000000: null },
      compare: { sha1: 'diverged\n' },
    });

    // Unscreened: the real run, positionals and input as the pool would give them.
    const pool = poolRecords(groups);
    const raw = realPreflight(makeWorldFor())(
      [...pool.map((r) => String(r.number)), '--prefetched-json', '-', '--blocker-landing', '--integration-branch', 'dev', '--work-links', 'body-text'],
      JSON.stringify(pool),
    );
    if (bad.body === 'Blocked by #3000000000\n') {
      assert.equal(raw.status, 0, `${label}: ${raw.stderr}`);
      assert.deepEqual(JSON.parse(raw.stdout).records['13'].blockerLanding, [
        { blocker: 3000000000, verdict: 'undetermined', commit: null, via: 'not-found' },
      ], label);
    } else {
      assert.equal(raw.status, 2, `${label}: ${raw.stderr}`);
      assert.match(raw.stderr, stderrRe, `${label}: exit 2 must come from this row's own fault`);
      // Discrimination: no other row's message regex matches this stderr, so a swapped or shared regex goes red.
      for (const other of FAULTS) {
        const otherRe = other[4];
        if (otherRe && otherRe !== stderrRe) assert.doesNotMatch(raw.stderr, otherRe, `${label}: row "${other[0]}"'s regex must not match this stderr`);
      }
    }

    // Through the CLI: one malformed-blocker entry with this row's cause; the rest checked.
    const r = exec(t, { groups, world: makeWorldFor() });
    assert.equal(r.code, 0, `${label}: ${r.stderr}`);
    assert.deepEqual(r.groups, [[R10]], label);
    assert.deepEqual(r.exclusions, [malformedEntry(number, cause), UNLANDED_11], label);
    assert.deepEqual(positionals(r.pf.calls[0].args), ['10', '11'], label);
    assert.equal(r.pf.calls.length, 1, label);
  }
});

test('a record blocked by a screened-out record reads that blocker open and is kept', (t) => {
  const R14 = rec(14, 'Blocked by #13\n');
  const r = exec(t, { groups: [[R13_ZERO], [R14]], world: makeWorld({ repository: { b13: openBlocker(13) } }) });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.groups, [[R14]]);
  assert.deepEqual(r.exclusions, [malformedEntry(13, 'a Blocked by line names no valid issue number (#0)')]);
  assert.equal(r.pf.calls.length, 1);
  assert.deepEqual(positionals(r.pf.calls[0].args), ['14']);
});

test('an all-malformed pool makes no preflight call and still excludes', (t) => {
  const pf = mustNotBeCalled();
  const r = exec(t, { groups: [[R13_ZERO]], preflight: pf });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, '[]');
  assert.deepEqual(r.exclusions, [malformedEntry(13, 'a Blocked by line names no valid issue number (#0)')]);
  assert.match(r.stderr, /AUTO — dispatch: #13 excluded — malformed blocker declaration/);
  assert.equal(pf.calls.length, 0);
});

test('AC4.3: --work-links is forwarded, and a body Blocked by #0 is screened under every work-links value, native included', (t) => {
  const groups = [[rec(11)], [R13_ZERO]];
  const cause = 'a Blocked by line names no valid issue number (#0)';
  const nativePf = stub(emptyLanding(11));
  const a = exec(t, { groups, preflight: nativePf, workLinks: 'native' });
  assert.equal(a.code, 0, a.stderr);
  assert.deepEqual(nativePf.calls[0].args.slice(-2), ['--work-links', 'native']);
  assert.deepEqual(positionals(nativePf.calls[0].args), ['11']);
  assert.deepEqual(a.exclusions, [malformedEntry(13, cause)]);
  assert.deepEqual(a.groups, [[rec(11)]]);

  const emptyPf = stub(emptyLanding(11));
  const b = exec(t, { groups, preflight: emptyPf, workLinks: '' });
  assert.equal(b.code, 0, b.stderr);
  assert.equal(emptyPf.calls[0].args.includes('--work-links'), false);
  assert.deepEqual(b.exclusions, [malformedEntry(13, cause)]);
  assert.deepEqual(b.groups, [[rec(11)]]);
});

// --- AC4.3: native-missing --------------------------------------------------

const NATIVE_EDGES = { 10: [], 11: [{ number: 5, state: 'CLOSED' }] };
const NATIVE_MISSING_ENTRY = malformedEntry(13, 'the native dependency response has no entry for it');

test('AC4.3: a candidate missing from the native dependency response is excluded as malformed-blocker and the call re-run once without it, through the real run', (t) => {
  for (const [label, how] of [['omitted from the response (gh exit 0)', 'omit'], ['NOT_FOUND with partial data (gh exit 1)', 'not-found']]) {
    const world = unlandedWorld({ native: { edges: NATIVE_EDGES, missing: { 13: how } } });
    const r = exec(t, { groups: [[R10], [R11], [rec(13)]], world, workLinks: 'native' });
    assert.equal(r.code, 0, `${label}: ${r.stderr}`);
    assert.equal(r.pf.calls.length, 2, label);
    assert.deepEqual(positionals(r.pf.calls[0].args), ['10', '11', '13'], label);
    assert.deepEqual(positionals(r.pf.calls[1].args), ['10', '11'], label);
    assert.deepEqual(r.exclusions, [NATIVE_MISSING_ENTRY, UNLANDED_11], label);
    assert.deepEqual(r.groups, [[R10]], label);
    assert.match(r.stderr, /preflight-records\.js: missing dependency data for #13/, label);
    assert.match(r.stderr, /AUTO — dispatch: #13 excluded — malformed blocker declaration: the native dependency response has no entry for it;/, label);
  }
});

test('native-missing never loops and never blames a record it cannot attribute', (t) => {
  const groups = [[R10], [R11], [rec(13)]];

  // No data.repository: nothing to pin on a record.
  const noRepo = exec(t, { groups, world: unlandedWorld({ native: { edges: NATIVE_EDGES, noRepository: true } }), workLinks: 'native' });
  assert.equal(noRepo.code, 0, noRepo.stderr);
  assert.equal(noRepo.pf.calls.length, 1);
  assert.match(noRepo.stderr, /missing repository — no dependency data for/);
  assert.match(noRepo.stderr, /Warning: unlanded-blocker pass skipped — preflight-records\.js exited 1;/);
  assert.equal(noRepo.exclusions, null);
  assert.deepEqual(noRepo.groups, groups);

  // #13 missing on the first call, #11 on the re-run: exactly two calls, no third.
  const again = exec(t, {
    groups,
    world: unlandedWorld({ native: { edges: NATIVE_EDGES, missing: [{ 13: 'omit' }, { 11: 'omit' }] } }),
    workLinks: 'native',
  });
  assert.equal(again.code, 0, again.stderr);
  assert.equal(again.pf.calls.length, 2);
  assert.deepEqual(again.exclusions, [NATIVE_MISSING_ENTRY]);
  assert.match(again.stderr, /Warning: unlanded-blocker pass skipped — preflight-records\.js exited 1;/);
  assert.deepEqual(again.groups, [[R10], [R11]]);

  // A named number that is not a candidate is not attributable.
  const pf = stub({ status: 1, stdout: '', stderr: 'preflight-records.js: missing dependency data for #99\n' });
  const foreign = exec(t, { groups, preflight: pf, workLinks: 'native' });
  assert.equal(foreign.code, 0, foreign.stderr);
  assert.equal(pf.calls.length, 1);
  assert.match(foreign.stderr, /Warning: unlanded-blocker pass skipped — preflight-records\.js exited 1;/);
  assert.equal(foreign.exclusions, null);

  // Only exit 1 is the writer's missing-data exit; the same line under another status is not read.
  const pf2 = stub({ status: 2, stdout: '', stderr: 'preflight-records.js: missing dependency data for #13\n' });
  const wrongStatus = exec(t, { groups, preflight: pf2, workLinks: 'native' });
  assert.equal(wrongStatus.code, 0, wrongStatus.stderr);
  assert.equal(pf2.calls.length, 1);
  assert.match(wrongStatus.stderr, /Warning: unlanded-blocker pass skipped — preflight-records\.js exited 2;/);
  assert.equal(wrongStatus.exclusions, null);
});

test('native-missing with every candidate missing excludes them all and makes no second call and no skip warning', (t) => {
  const r = exec(t, { groups: [[rec(13)]], world: unlandedWorld({ native: { edges: NATIVE_EDGES, missing: { 13: 'omit' } } }), workLinks: 'native' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.pf.calls.length, 1);
  assert.deepEqual(positionals(r.pf.calls[0].args), ['13']);
  assert.deepEqual(r.exclusions, [NATIVE_MISSING_ENTRY]);
  assert.deepEqual(r.groups, []);
  assert.doesNotMatch(r.stderr, /Warning: unlanded-blocker pass skipped/);
});

test('nativeMissingRecords recognises only the writer\'s whole line', () => {
  const numbers = [13, 14];
  assert.deepEqual(nativeMissingRecords('preflight-records.js: missing dependency data for #13\n', numbers), [13]);
  assert.deepEqual(nativeMissingRecords('preflight-records.js: missing dependency data for #13 (GraphQL: Could not resolve to an Issue with the number of 13.)', numbers), [13]);
  assert.deepEqual(nativeMissingRecords('preflight-records.js: missing dependency data for #14, #13', numbers), [13, 14]);
  assert.deepEqual(nativeMissingRecords('other\r\npreflight-records.js: missing dependency data for #13\r\n', numbers), [13]);
  for (const bad of [
    'preflight-records.js: missing dependency data for #13 trailing',
    'preflight-records.js: missing dependency data for #13, #',
    'preflight-records.js: missing repository — no dependency data for #13',
    'preflight-records.js: missing dependency data for #99',
    'x preflight-records.js: missing dependency data for #13',
    '',
  ]) {
    assert.equal(nativeMissingRecords(bad, numbers), null, JSON.stringify(bad));
  }
});

// --- malformedRecords -------------------------------------------------------

test('malformedRecords: each cause, in order; the 32-bit bound', () => {
  const cause = (r) => malformedRecords([r]).map((m) => m.cause);
  assert.deepEqual(cause({ number: 0, body: '', labels: [] }), ['its number is not a positive integer']);
  assert.deepEqual(cause({ number: 13, body: 5, labels: [] }), ['its body is not a string']);
  assert.deepEqual(cause({ number: 13, body: '', labels: {} }), ['its labels are not an array']);
  assert.deepEqual(cause({ number: 13, body: 'Blocked by #0\nBlocked by #4000000000', labels: [] }),
    ['a Blocked by line names no valid issue number (#0, #4000000000)']);
  // The first failing check wins: checks 1, 3 and 4 all fail below, and each pair too.
  assert.deepEqual(cause({ number: -1, body: 'Blocked by #0', labels: 'x' }), ['its number is not a positive integer']);
  assert.deepEqual(cause({ number: 13, body: 'Blocked by #0', labels: 'x' }), ['its labels are not an array']);
  assert.deepEqual(cause({ number: 13, body: null, labels: 'x' }), ['its body is not a string']);

  assert.deepEqual(malformedRecords([{ number: 13, body: 'Blocked by #0', labels: [] }]),
    [{ number: 13, cause: 'a Blocked by line names no valid issue number (#0)' }]);
  assert.deepEqual(malformedRecords([{ number: 13, body: 'Blocked by #2147483647', labels: [] }]), []);
  for (const n of ['2147483648', '3000000000', '99999999999999999999']) {
    assert.equal(malformedRecords([{ number: 13, body: `Blocked by #${n}`, labels: [] }]).length, 1, n);
  }
  assert.deepEqual(malformedRecords([{ number: 13, body: '', labels: null }, { number: 14, body: '' }]), []);
});

// --- fail open --------------------------------------------------------------

test('fail open: a whole-call failure (non-zero preflight exit) excludes no unlanded-blocker record', (t) => {
  const groups = [[R10], [R11]];
  const pf = stub({ status: 1, stdout: '', stderr: 'preflight-records.js: blocker landing query failed: x\n' });
  const r = exec(t, { groups, preflight: pf });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, JSON.stringify(groups));
  assert.match(r.stderr, /preflight-records\.js: blocker landing query failed: x\n/);
  assert.match(r.stderr, /Warning: unlanded-blocker pass skipped — preflight-records\.js exited 1; no unlanded-blocker exclusions this pull/);
  assert.equal(r.exclusions, null);
});

test('fail open: a signal, a spawn error and a thrown dep are whole-call failures too', (t) => {
  const groups = [[R10], [R11]];
  for (const [result, expected] of [
    [{ status: null, signal: 'SIGTERM', stdout: '', stderr: '' }, /exited signal SIGTERM;/],
    [{ status: null, error: new Error('spawn ETIMEDOUT'), stdout: '', stderr: '' }, /exited error \(spawn ETIMEDOUT\);/],
    [new Error('boom'), /exited error \(boom\);/],
  ]) {
    const r = exec(t, { groups, preflight: stub(result) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, JSON.stringify(groups));
    assert.match(r.stderr, expected);
    assert.equal(r.exclusions, null);
  }
});

test('a whole-call failure keeps the malformed-blocker exclusions already found', (t) => {
  const pf = stub({ status: 1, stdout: '', stderr: 'preflight-records.js: blocker landing query failed: x\n' });
  const r = exec(t, { groups: [[R11], [R13_ZERO]], preflight: pf });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.groups, [[R11]]);
  assert.deepEqual(r.exclusions, [malformedEntry(13, 'a Blocked by line names no valid issue number (#0)')]);
});

test('fail open: unparseable or envelope-less output excludes nothing', (t) => {
  const groups = [[R10], [R11]];
  for (const stdout of ['not json', '', '{"records":{}}', 'null']) {
    const r = exec(t, { groups, preflight: stub({ status: 0, stdout, stderr: '' }) });
    assert.equal(r.code, 0, `${JSON.stringify(stdout)}: ${r.stderr}`);
    assert.equal(r.stdout, JSON.stringify(groups));
    assert.match(r.stderr, /printed no usable envelope/);
    assert.equal(r.exclusions, null);
  }
});

test('fail open: an empty integration branch skips the landing call but still excludes a malformed record', (t) => {
  const pf = mustNotBeCalled();
  const clean = exec(t, { groups: [[R11]], preflight: pf, branch: '' });
  assert.equal(clean.code, 0, clean.stderr);
  assert.equal(clean.stdout, JSON.stringify([[R11]]));
  assert.match(clean.stderr, /Warning: unlanded-blocker pass skipped — no integration branch resolved; no unlanded-blocker exclusions this pull/);
  assert.equal(clean.exclusions, null);

  const withBad = exec(t, { groups: [[R11], [R13_ZERO]], preflight: pf, branch: '  ' });
  assert.equal(withBad.code, 0, withBad.stderr);
  assert.deepEqual(withBad.groups, [[R11]]);
  assert.deepEqual(withBad.exclusions, [malformedEntry(13, 'a Blocked by line names no valid issue number (#0)')]);
  assert.equal(pf.calls.length, 0);
});

test('an empty pool makes no preflight call', (t) => {
  const pf = mustNotBeCalled();
  const r = exec(t, { groups: [], preflight: pf });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, '[]');
  assert.equal(pf.calls.length, 0);
  assert.equal(r.exclusions, null);
});

// --- the writer and the invocation ------------------------------------------

test('a corrupt exclusions file stops the pass (exit 1)', (t) => {
  const unlanded = exec(t, { groups: [[R10], [R11]], world: unlandedWorld(), exclusionsText: '{ not json' });
  assert.equal(unlanded.code, 1);
  assert.match(unlanded.stderr, /appendExclusion:/);
  assert.equal(unlanded.stdout, '');
  assert.equal(unlanded.exclusions, '{ not json', 'the refused write leaves the corrupt file as it was');

  const pf = mustNotBeCalled();
  const malformedOnly = exec(t, { groups: [[R13_ZERO]], preflight: pf, exclusionsText: '{ not json' });
  assert.equal(malformedOnly.code, 1);
  assert.match(malformedOnly.stderr, /appendExclusion:/);
  assert.equal(malformedOnly.stdout, '');
  assert.equal(pf.calls.length, 0);
});

test('an unreadable --groups is exit 1; a malformed invocation is exit 2', (t) => {
  const missing = exec(t, {});
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /dispatch-unlanded-blockers\.js: cannot read --groups .*groups\.json: /);
  assert.equal(missing.stdout, '');

  for (const groupsText of ['{ not json', '{}', '[1]', '[[null]]', '[[[]]]']) {
    const r = exec(t, { groupsText });
    assert.equal(r.code, 1, groupsText);
    assert.match(r.stderr, /cannot read --groups/, groupsText);
  }

  for (const [label, argv] of [
    ['no argv', () => []],
    ['--groups with no value', () => ['--groups']],
    ['--groups followed by a flag', () => ['--groups', '--exclusions', 'e', '--integration-branch', 'dev', '--work-links', 'native']],
    ['--groups empty', () => ['--groups', '', '--exclusions', 'e', '--integration-branch', 'dev', '--work-links', 'native']],
    ['--work-links bogus', (G, E) => ['--groups', G, '--exclusions', E, '--integration-branch', 'dev', '--work-links', 'bogus']],
    ['--work-links missing', (G, E) => ['--groups', G, '--exclusions', E, '--integration-branch', 'dev']],
    ['--work-links at the end of argv', (G, E) => ['--groups', G, '--exclusions', E, '--integration-branch', 'dev', '--work-links']],
    ['--integration-branch followed by a flag', (G, E) => ['--groups', G, '--exclusions', E, '--integration-branch', '--work-links', 'native']],
    ['an unknown argument', (G, E) => ['--groups', G, '--exclusions', E, '--integration-branch', 'dev', '--work-links', 'native', '--bogus']],
    ['an inherited key', () => ['constructor', 'x']],
  ]) {
    const pf = mustNotBeCalled();
    const r = exec(t, { groups: [[R11]], preflight: pf, argv });
    assert.equal(r.code, 2, label);
    assert.match(r.stderr, /usage: dispatch-unlanded-blockers\.js --groups <path> --exclusions <path> --integration-branch <name> --work-links <native\|body-text>/, label);
    assert.equal(r.stdout, '', label);
    assert.equal(pf.calls.length, 0, label);
  }
});

test('--help and -h print the usage on stdout and exit 0 without reading the groups or calling preflight', () => {
  for (const flag of ['--help', '-h']) {
    const pf = mustNotBeCalled();
    const out = [];
    const err = [];
    const code = run([flag], {
      readFile: () => { throw new Error('--help must not read --groups'); },
      preflight: pf,
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    });
    assert.equal(code, 0, flag);
    assert.match(out.join(''), /^usage: dispatch-unlanded-blockers\.js --groups <path> --exclusions <path> --integration-branch <name> --work-links <native\|body-text>\n$/, flag);
    assert.equal(err.join(''), '', flag);
    assert.equal(pf.calls.length, 0, flag);
  }
});

test('parseArgs returns the four values', () => {
  const base = ['--groups', 'g', '--exclusions', 'e', '--integration-branch', 'main'];
  assert.deepEqual(parseArgs([...base, '--work-links', 'native']), { groups: 'g', exclusions: 'e', integrationBranch: 'main', workLinks: 'native' });
  assert.deepEqual(parseArgs([...base, '--work-links', '']), { groups: 'g', exclusions: 'e', integrationBranch: 'main', workLinks: '' });
  assert.deepEqual(parseArgs(['--groups', 'g', '--exclusions', 'e', '--integration-branch', '', '--work-links', 'body-text']),
    { groups: 'g', exclusions: 'e', integrationBranch: '', workLinks: 'body-text' });
});

test('realDeps.preflight returns the real child failure shape', () => {
  const res = realDeps.preflight(['--bogus'], '');
  assert.equal(res.status, 2);
  assert.match(res.stderr, /unknown argument: --bogus/);
});

// --- pure functions ---------------------------------------------------------

test('poolRecords dedupes and sorts across groups and projects exactly the four keys', () => {
  const pool = poolRecords([
    [{ number: 12, title: 'c', body: 'b', labels: [], extra: 1 }, { number: 10, title: 'a', body: 'x', labels: null }],
    [{ number: 12, title: 'dup', body: 'dup', labels: [] }, { number: 11, title: 'b', body: '', labels: [] }],
  ]);
  assert.deepEqual(pool, [
    { number: 10, title: 'a', body: 'x', labels: null },
    { number: 11, title: 'b', body: '', labels: [] },
    { number: 12, title: 'c', body: 'b', labels: [] },
  ]);
  assert.deepEqual(poolRecords([]), []);
});

test('landingExclusions: unlanded per requested record, undetermined listed; a missing blockerLanding throws a TypeError naming the record', () => {
  const envelope = {
    records: {
      10: { blockerLanding: [] },
      11: { blockerLanding: [
        { blocker: 5, verdict: 'unlanded', commit: 'a', via: 'closer-pr' },
        { blocker: 6, verdict: 'landed', commit: 'b', via: 'closer-pr' },
        { blocker: 7, verdict: 'unlanded', commit: 'c', via: 'closer-pr' },
        { blocker: 8, verdict: 'undetermined', commit: null, via: 'not-found' },
        { blocker: 9, verdict: 'open', commit: null, via: 'state' },
        { blocker: 4, verdict: 'not-applicable', commit: null, via: 'state-reason' },
      ] },
      12: { blockerLanding: [{ blocker: 5, verdict: 'undetermined', commit: null, via: 'probe-failed' }] },
    },
  };
  assert.deepEqual(landingExclusions(envelope, [10, 11, 12]), {
    exclusions: [{ reason: 'unlanded-blocker', records: [11], detail: { blockers: [{ blocker: 5, commit: 'a' }, { blocker: 7, commit: 'c' }] } }],
    undetermined: [{ record: 11, blocker: 8, via: 'not-found' }, { record: 12, blocker: 5, via: 'probe-failed' }],
  });
  assert.throws(() => landingExclusions({ records: { 10: { blockerLanding: [] }, 11: {} } }, [10, 11]), (err) => err instanceof TypeError && /#11/.test(err.message));
  assert.throws(() => landingExclusions(null, [11]), TypeError);
});

test('withoutExcluded leaves the input arrays unmutated', () => {
  const groups = [[{ number: 1 }, { number: 2 }], [{ number: 3 }]];
  const frozen = JSON.stringify(groups);
  assert.deepEqual(withoutExcluded(groups, new Set([2, 3])), [[{ number: 1 }]]);
  assert.equal(JSON.stringify(groups), frozen);
  assert.deepEqual(withoutExcluded(groups, new Set()), groups);
});

test('malformedExclusion shapes the entry', () => {
  assert.deepEqual(malformedExclusion({ number: 13, cause: 'c' }), { reason: 'malformed-blocker', records: [13], detail: { cause: 'c' } });
});

test('the exported constants carry the fixed literals', () => {
  assert.equal(lib.UNLANDED_REASON, 'unlanded-blocker');
  assert.equal(lib.MALFORMED_REASON, 'malformed-blocker');
  assert.equal(lib.GRAPHQL_INT_MAX, 2147483647);
  assert.equal(lib.NATIVE_MISSING_CAUSE, 'the native dependency response has no entry for it');
});
