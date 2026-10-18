'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  resolvePrState, resolvePrStateAsync, resolvePrStatesBulk, resolvePrStateByNumber, resolveIssueStateByNumber, resolvePrStateByNumberAsync, BULK_CHUNK,
} = require('../../../plugin/bin/lib/reconcile/pr-state');

// resolvePrState/resolvePrStateAsync both shell to `gh pr list` — neither is
// injectable (mirrors the module's pre-existing design), so tests intercept
// at the process-spawn boundary via a `gh` wrapper placed first on PATH,
// same technique tests/bin-lib/reconcile/prune-remote.test.js already uses
// for `git` (#820 review — pr-state.js had no test file at all before this).
function installGhWrapper(jsonOrScript) {
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-state-ghwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  const body = typeof jsonOrScript === 'string' && jsonOrScript.startsWith('#!')
    ? jsonOrScript
    : `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify(jsonOrScript)}\nEOF\n`;
  fs.writeFileSync(wrapperPath, body);
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  return { restore: () => { process.env.PATH = originalPath; } };
}

test('resolvePrState/resolvePrStateAsync: no branch -> null, no gh call', async () => {
  assert.equal(resolvePrState('/tmp', null), null);
  assert.equal(await resolvePrStateAsync('/tmp', null), null);
});

test('resolvePrState/resolvePrStateAsync: merged PR wins over other PRs for the same branch', async () => {
  const prs = [
    { number: 1, state: 'CLOSED', mergedAt: null, updatedAt: '2026-01-01T00:00:00Z' },
    { number: 2, state: 'MERGED', mergedAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
  ];
  const wrapper = installGhWrapper(prs);
  try {
    assert.equal(resolvePrState('/tmp', 'some-branch').number, 2);
    assert.equal((await resolvePrStateAsync('/tmp', 'some-branch')).number, 2);
  } finally {
    wrapper.restore();
  }
});

test('resolvePrState/resolvePrStateAsync: no merged PR -> most recently updated governs', async () => {
  const prs = [
    { number: 1, state: 'OPEN', mergedAt: null, updatedAt: '2026-01-01T00:00:00Z' },
    { number: 2, state: 'CLOSED', mergedAt: null, updatedAt: '2026-01-03T00:00:00Z' },
  ];
  const wrapper = installGhWrapper(prs);
  try {
    assert.equal(resolvePrState('/tmp', 'some-branch').number, 2);
    assert.equal((await resolvePrStateAsync('/tmp', 'some-branch')).number, 2);
  } finally {
    wrapper.restore();
  }
});

test('resolvePrState/resolvePrStateAsync: no PRs for the branch -> null', async () => {
  const wrapper = installGhWrapper([]);
  try {
    assert.equal(resolvePrState('/tmp', 'some-branch'), null);
    assert.equal(await resolvePrStateAsync('/tmp', 'some-branch'), null);
  } finally {
    wrapper.restore();
  }
});

test('resolvePrState/resolvePrStateAsync: gh absent -> gh-absent, no throw', async () => {
  const originalPath = process.env.PATH;
  process.env.PATH = '/nonexistent-path-with-no-gh';
  try {
    assert.equal(resolvePrState('/tmp', 'some-branch'), 'gh-absent');
    assert.equal(await resolvePrStateAsync('/tmp', 'some-branch'), 'gh-absent');
  } finally {
    process.env.PATH = originalPath;
  }
});

test('resolvePrState/resolvePrStateAsync: malformed gh output -> network-failure, no throw', async () => {
  const wrapper = installGhWrapper('#!/bin/sh\necho "not json"\n');
  try {
    assert.equal(resolvePrState('/tmp', 'some-branch'), 'network-failure');
    assert.equal(await resolvePrStateAsync('/tmp', 'some-branch'), 'network-failure');
  } finally {
    wrapper.restore();
  }
});

test('resolvePrStateAsync: does not block the event loop (real concurrency, not execFileSync in disguise)', async () => {
  // If resolvePrStateAsync were secretly synchronous (execFileSync under an
  // `async` wrapper), the three calls below could never run concurrently:
  // JS is single-threaded, so the second/third call's spawn literally cannot
  // start until the first call's blocking execFileSync returns — their
  // spawned `gh` processes' lifetimes would never overlap. A real
  // non-blocking execFile starts all three near-simultaneously, so their
  // lifetimes DO overlap (#820 review — this is exactly the property
  // Phase 1.5's runWithConcurrency pooling in release-merged.js depends on).
  //
  // #1127 then #1404: a fixed wall-clock margin ("< 400ms"), and later a
  // concurrent-vs-sequential wall-clock RATIO ("< 0.9x"), both flaked under
  // real sibling-session CPU load — any assertion built on *aggregate
  // elapsed time* is exactly what shared-machine scheduler noise perturbs,
  // regardless of where the margin is set. This version drops wall-clock
  // comparison entirely and asserts a structural fact instead: each spawned
  // `gh` process drops a marker file for its own lifetime and repeatedly
  // snapshots how many marker files coexist. Genuine concurrency makes 2+
  // files coexist no matter how fast or slow the machine is right now,
  // because it's an existence check, not a duration; a blocking regression
  // can never produce more than 1, for the single-threaded reason above.
  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-state-overlap-'));
  const observationsPath = path.join(markerDir, 'observations');
  const wrapperScript = [
    '#!/bin/sh',
    `MYFILE="${markerDir}/m.$$"`,
    ': > "$MYFILE"',
    'i=0',
    'while [ $i -lt 6 ]; do',
    `  ls "${markerDir}"/m.* 2>/dev/null | wc -l >> "${observationsPath}"`,
    '  sleep 0.025',
    '  i=$((i+1))',
    'done',
    'rm -f "$MYFILE"',
    'echo "[]"',
    '',
  ].join('\n');
  const wrapper = installGhWrapper(wrapperScript);
  try {
    await Promise.all([
      resolvePrStateAsync('/tmp', 'branch-a'),
      resolvePrStateAsync('/tmp', 'branch-b'),
      resolvePrStateAsync('/tmp', 'branch-c'),
    ]);
    const observations = fs.readFileSync(observationsPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((n) => parseInt(n, 10));
    const maxConcurrent = Math.max(0, ...observations);
    assert.ok(
      maxConcurrent >= 2,
      `expected at least 2 spawned gh processes to coexist (real concurrency); observed max ${maxConcurrent} across ${observations.length} samples: [${observations.join(',')}]`,
    );
  } finally {
    wrapper.restore();
    fs.rmSync(markerDir, { recursive: true, force: true });
  }
});

// Shared fixture for the recurring "MERGED #10 vs. newer OPEN #11" scenario
// exercised (in various shapes) by several tests below.
const PR_MERGED_10 = { number: 10, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
const PR_OPEN_11 = { number: 11, state: 'OPEN', mergedAt: null, updatedAt: '2026-02-01T00:00:00Z' };

test('preferOpen: an OPEN PR outranks a MERGED PR for destructive callers, whichever is newer', async () => {
  // #664 / #570 review scenario: branch reused after its first PR merged.
  const openNewer = [PR_MERGED_10, PR_OPEN_11];
  const openOlder = [
    { number: 12, state: 'OPEN', mergedAt: null, updatedAt: '2026-01-01T00:00:00Z' },
    { number: 13, state: 'MERGED', mergedAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
  ];
  for (const [prs, expectedOpen] of [[openNewer, 11], [openOlder, 12]]) {
    const wrapper = installGhWrapper(prs);
    try {
      assert.equal(resolvePrState('/tmp', 'some-branch', { preferOpen: true }).number, expectedOpen);
    } finally {
      wrapper.restore();
    }
  }
});

test('read-mostly consumers (no opts): MERGED still wins over a newer OPEN PR — explicit regression proof for reap/archive/release', async () => {
  const prs = [PR_MERGED_10, PR_OPEN_11];
  const wrapper = installGhWrapper(prs);
  try {
    assert.equal(resolvePrState('/tmp', 'some-branch').number, 10);
    assert.equal((await resolvePrStateAsync('/tmp', 'some-branch')).number, 10);
  } finally {
    wrapper.restore();
  }
});

test('preferOpen with no OPEN PR in the set: behavior unchanged (MERGED wins)', () => {
  const prs = [
    { number: 1, state: 'CLOSED', mergedAt: null, updatedAt: '2026-01-03T00:00:00Z' },
    { number: 2, state: 'MERGED', mergedAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
  ];
  const wrapper = installGhWrapper(prs);
  try {
    assert.equal(resolvePrState('/tmp', 'some-branch', { preferOpen: true }).number, 2);
  } finally {
    wrapper.restore();
  }
});

// Build a canned GraphQL response for a chunk's branches: entries maps
// alias index -> { prs: [...] } (ref exists) or null (no ref).
function graphqlResponse(entries) {
  const repository = {};
  entries.forEach((e, i) => {
    repository['b' + i] = e === null
      ? null
      : { associatedPullRequests: { nodes: e.prs, pageInfo: { hasNextPage: !!e.hasNextPage } } };
  });
  return JSON.stringify({ data: { repository } });
}

test('resolvePrStatesBulk: complete map, tie-break parity with resolvePrState (preferOpen both ways)', () => {
  const calls = [];
  const runner = (args) => { calls.push(args); return graphqlResponse([{ prs: [PR_MERGED_10, PR_OPEN_11] }, { prs: [PR_MERGED_10] }, null]); };
  const r = resolvePrStatesBulk('/tmp', ['reused', 'merged-only', 'gone'], { preferOpen: true, runner, repoSlug: 'o/r' });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('-f') && calls[0].includes('owner=o') && calls[0].includes('name=r'), 'owner/name must travel via -f (never -F: #610 type-coercion)');
  assert.ok(!calls[0].includes('-F'), 'no -F flags in the bulk GraphQL argv');
  const queryArg = calls[0].find((a) => a.startsWith('query='));
  assert.match(queryArg, /"refs\/heads\/reused"/);
  assert.equal(r.get('reused').number, 11);        // preferOpen: OPEN governs
  assert.equal(r.get('merged-only').number, 10);   // MERGED wins with no OPEN
  assert.equal(r.get('gone'), null);               // deleted/never-pushed ref -> null, still present in map
  assert.equal(r.size, 3);
});

test('resolvePrStatesBulk: default tie-break (no preferOpen) matches resolvePrState — MERGED wins over newer OPEN', () => {
  const runner = () => graphqlResponse([{ prs: [PR_MERGED_10, PR_OPEN_11] }]);
  const r = resolvePrStatesBulk('/tmp', ['reused'], { runner, repoSlug: 'o/r' });
  assert.equal(r.get('reused').number, 10);
});

test('resolvePrStatesBulk: chunking at BULK_CHUNK with sequential short-circuit on chunk failure', () => {
  const branches = Array.from({ length: BULK_CHUNK * 2 + 20 }, (_, i) => 'br-' + i);
  let call = 0;
  const runner = () => {
    call += 1;
    if (call === 2) { const e = new Error('boom'); e.code = 'ETIMEDOUT'; throw e; }
    return graphqlResponse(Array.from({ length: BULK_CHUNK }, () => null));
  };
  const r = resolvePrStatesBulk('/tmp', branches, { runner, repoSlug: 'o/r' });
  assert.equal(r, 'network-failure');
  assert.equal(call, 2); // chunk 3 never issued — short-circuit
});

test('resolvePrStatesBulk: degraded responses classify network-failure; missing gh classifies gh-absent; empty set spawns nothing', () => {
  const errResp = JSON.stringify({ data: { repository: { b0: null } }, errors: [{ message: 'partial' }] });
  assert.equal(resolvePrStatesBulk('/tmp', ['a'], { runner: () => errResp, repoSlug: 'o/r' }), 'network-failure');
  assert.equal(resolvePrStatesBulk('/tmp', ['a'], { runner: () => 'not json', repoSlug: 'o/r' }), 'network-failure');
  const enoent = () => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; };
  assert.equal(resolvePrStatesBulk('/tmp', ['a'], { runner: enoent, repoSlug: 'o/r' }), 'gh-absent');
  let spawned = 0;
  assert.equal(resolvePrStatesBulk('/tmp', [], { runner: () => { spawned += 1; return '{}'; }, repoSlug: 'o/r' }).size, 0);
  assert.equal(spawned, 0);
});

// Review finding (whole-branch review, e90376a4..HEAD): buildBulkQuery's associatedPullRequests
// had no pageInfo/hasNextPage guard, unlike the sibling sub-issues query — a branch with more
// than 10 associated PRs got a silently truncated (and therefore possibly wrong) governing-PR
// screen instead of a loud failure. The query now requests pageInfo{hasNextPage} and the whole
// call fails closed ('network-failure') when any alias reports it, the same posture already
// used for a missing alias key.
test('resolvePrStatesBulk: a branch whose associatedPullRequests page is truncated (hasNextPage) fails the whole call closed', () => {
  const runner = () => graphqlResponse([{ prs: [PR_MERGED_10], hasNextPage: true }]);
  const r = resolvePrStatesBulk('/tmp', ['many-prs'], { runner, repoSlug: 'o/r' });
  assert.equal(r, 'network-failure');
});

test('resolvePrStatesBulk: hasNextPage:false (the normal case) still resolves the map — the guard does not misfire', () => {
  const runner = () => graphqlResponse([{ prs: [PR_MERGED_10], hasNextPage: false }]);
  const r = resolvePrStatesBulk('/tmp', ['few-prs'], { runner, repoSlug: 'o/r' });
  assert.equal(r.get('few-prs').number, 10);
});

test('resolvePrStatesBulk: response missing an alias key classifies network-failure — never a silent null', () => {
  const oneOfTwo = JSON.stringify({ data: { repository: { b0: null } } }); // b1 absent
  assert.equal(resolvePrStatesBulk('/tmp', ['a', 'b'], { runner: () => oneOfTwo, repoSlug: 'o/r' }), 'network-failure');
});

// #1962: archive-merged.js's sweep falls back to this when a run dir's
// stamped worktree is gone AND its branch has since been deleted (no branch
// left for resolvePrState's `--head` query) — `run-state.json`'s `pr.number`
// still names the PR, so probe it directly.
test('resolvePrStateByNumber: no number -> null, no gh call', () => {
  assert.equal(resolvePrStateByNumber('/tmp', null), null);
  assert.equal(resolvePrStateByNumber('/tmp', undefined), null);
});

test('resolvePrStateByNumber: resolves the single PR by number (no tie-break needed)', () => {
  const pr = { number: 42, state: 'CLOSED', mergedAt: null, updatedAt: '2026-01-01T00:00:00Z', mergeCommit: null };
  const wrapper = installGhWrapper(pr);
  try {
    const result = resolvePrStateByNumber('/tmp', 42);
    assert.equal(result.number, 42);
    assert.equal(result.state, 'CLOSED');
  } finally {
    wrapper.restore();
  }
});

test('resolvePrStateByNumber: gh absent -> gh-absent, no throw', () => {
  const originalPath = process.env.PATH;
  process.env.PATH = '/nonexistent-path-with-no-gh';
  try {
    assert.equal(resolvePrStateByNumber('/tmp', 42), 'gh-absent');
  } finally {
    process.env.PATH = originalPath;
  }
});

test('resolvePrStateByNumber: malformed gh output -> network-failure, no throw', () => {
  const wrapper = installGhWrapper('#!/bin/sh\necho "not json"\n');
  try {
    assert.equal(resolvePrStateByNumber('/tmp', 42), 'network-failure');
  } finally {
    wrapper.restore();
  }
});

// #2367: the pending-review staleness check reuses resolvePrStateByNumber
// rather than adding a third PR-state-reading code path — it needs
// mergeable/mergeStateStatus on the returned shape.
test('resolvePrStateByNumber: requests and returns mergeable/mergeStateStatus (#2367)', () => {
  const pr = {
    number: 42, state: 'OPEN', mergedAt: null, updatedAt: '2026-01-01T00:00:00Z', mergeCommit: null, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY',
  };
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-state-ghwrap-argv-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  const argvLog = path.join(wrapperDir, 'argv.log');
  fs.writeFileSync(wrapperPath, `#!/bin/sh\necho "$@" > "${argvLog}"\ncat <<'EOF'\n${JSON.stringify(pr)}\nEOF\n`);
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  try {
    const result = resolvePrStateByNumber('/tmp', 42);
    assert.equal(result.mergeStateStatus, 'DIRTY');
    assert.equal(result.mergeable, 'CONFLICTING');
    const argv = fs.readFileSync(argvLog, 'utf8');
    assert.match(argv, /mergeable/);
    assert.match(argv, /mergeStateStatus/);
    assert.match(argv, /closingIssuesReferences/);
  } finally {
    process.env.PATH = originalPath;
  }
});

// #1811: resolveIssueStateByNumber — archive-merged.js's no-run-state.json
// terminal path needs an ISSUE's state by number (not a PR's), a distinct
// `gh` object with its own subcommand (`issue view`, not `pr view`).
test('resolveIssueStateByNumber: no number -> null, no gh call', () => {
  assert.equal(resolveIssueStateByNumber('/tmp', null), null);
  assert.equal(resolveIssueStateByNumber('/tmp', undefined), null);
});

test('resolveIssueStateByNumber: resolves the issue state by number', () => {
  const wrapper = installGhWrapper({ state: 'CLOSED' });
  try {
    const result = resolveIssueStateByNumber('/tmp', 1811);
    assert.equal(result.state, 'CLOSED');
  } finally {
    wrapper.restore();
  }
});

test('resolveIssueStateByNumber: requests `issue view`, not `pr view`', () => {
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-state-ghwrap-issueview-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  const argvLog = path.join(wrapperDir, 'argv.log');
  fs.writeFileSync(wrapperPath, `#!/bin/sh\necho "$@" > "${argvLog}"\ncat <<'EOF'\n${JSON.stringify({ state: 'OPEN' })}\nEOF\n`);
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  try {
    resolveIssueStateByNumber('/tmp', 1811);
    const argv = fs.readFileSync(argvLog, 'utf8');
    assert.match(argv, /^issue view 1811/);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('resolveIssueStateByNumber: gh absent -> gh-absent, no throw', () => {
  const originalPath = process.env.PATH;
  process.env.PATH = '/nonexistent-path-with-no-gh';
  try {
    assert.equal(resolveIssueStateByNumber('/tmp', 1811), 'gh-absent');
  } finally {
    process.env.PATH = originalPath;
  }
});

test('resolveIssueStateByNumber: malformed gh output -> network-failure, no throw', () => {
  const wrapper = installGhWrapper('#!/bin/sh\necho "not json"\n');
  try {
    assert.equal(resolveIssueStateByNumber('/tmp', 1811), 'network-failure');
  } finally {
    wrapper.restore();
  }
});

// #3029: a misordered/object-shaped/non-numeric call is a programming error,
// not a transport failure — it must read 'invalid-arguments', never
// 'network-failure', and never throw (archive-merged.js's sweep and
// github-pr-scan.md's forEach both rely on these resolvers never throwing).
function installArgvSpy(json) {
  const argvLog = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pr-state-ghwrap-guard-')), 'argv.log');
  const wrapper = installGhWrapper(`#!/bin/sh\necho "$@" >> "${argvLog}"\ncat <<'EOF'\n${JSON.stringify(json)}\nEOF\n`);
  return { called: () => fs.existsSync(argvLog), restore: wrapper.restore };
}

test('by-number resolvers: misordered/object-shaped calls -> invalid-arguments, no gh call, no throw (#3029)', () => {
  const spy = installArgvSpy({ number: 42, state: 'OPEN' });
  try {
    assert.equal(resolvePrStateByNumber(4242, { cwd: '/tmp', repo: 'o/r' }), 'invalid-arguments');
    assert.equal(resolveIssueStateByNumber(4343, { cwd: '/tmp' }), 'invalid-arguments');
    assert.equal(spy.called(), false);
  } finally {
    spy.restore();
  }
});

test('by-number resolvers: non-numeric, negative, and fractional numbers -> invalid-arguments, no gh call (#3029)', () => {
  const spy = installArgvSpy({ number: 42, state: 'OPEN' });
  try {
    for (const bad of ['abc', -5, 3.5, '042', '4 2', {}, Object.create(null)]) {
      assert.equal(resolvePrStateByNumber('/tmp', bad), 'invalid-arguments', `pr: ${JSON.stringify(bad)}`);
      assert.equal(resolveIssueStateByNumber('/tmp', bad), 'invalid-arguments', `issue: ${JSON.stringify(bad)}`);
    }
    assert.equal(spy.called(), false);
  } finally {
    spy.restore();
  }
});

test('by-number resolvers: falsy number still short-circuits to null before the guard (#3029)', () => {
  for (const fn of [resolvePrStateByNumber, resolveIssueStateByNumber]) {
    assert.equal(fn('/tmp', 0), null);
    assert.equal(fn('/tmp', undefined), null);
    assert.equal(fn(4242, null), null);
  }
});

test('by-number resolvers: a positive-integer string passes the guard and reaches gh (#3029)', () => {
  const spy = installArgvSpy({ number: 42, state: 'MERGED' });
  try {
    assert.equal(resolvePrStateByNumber('/tmp', '42').state, 'MERGED');
    assert.equal(resolveIssueStateByNumber('/tmp', '42').state, 'MERGED');
    assert.equal(spy.called(), true);
  } finally {
    spy.restore();
  }
});

// A missing cwd and a missing gh binary both surface as ENOENT; a stale or
// mistyped checkout path must not be reported as "gh is not installed".
test('by-number resolvers: a non-existent repoRoot -> invalid-arguments, not gh-absent (#3029)', () => {
  const wrapper = installGhWrapper({ number: 42, state: 'MERGED' });
  try {
    assert.equal(resolvePrStateByNumber('/definitely/not/here', 42), 'invalid-arguments');
    assert.equal(resolveIssueStateByNumber('/definitely/not/here', 42), 'invalid-arguments');
  } finally {
    wrapper.restore();
  }
});

test('resolvePrStatesBulk: unresolvable repo slug classifies network-failure (fail closed, no spawn)', () => {
  let spawned = 0;
  const r = resolvePrStatesBulk('/tmp/definitely-not-a-repo-xyz', ['a'], { runner: () => { spawned += 1; return '{}'; } });
  assert.equal(r, 'network-failure');
  assert.equal(spawned, 0);
});

test('resolvePrStateByNumberAsync: no number -> null, no gh call', async () => {
  assert.equal(await resolvePrStateByNumberAsync('/tmp', null), null);
  assert.equal(await resolvePrStateByNumberAsync('/tmp', undefined), null);
});

test('resolvePrStateByNumberAsync: resolves the single PR by number (no tie-break needed)', async () => {
  const pr = { number: 42, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', mergeCommit: { oid: 'a'.repeat(40) } };
  const wrapper = installGhWrapper(pr);
  try {
    const result = await resolvePrStateByNumberAsync('/tmp', 42);
    assert.equal(result.number, 42);
    assert.equal(result.state, 'MERGED');
  } finally {
    wrapper.restore();
  }
});

test('resolvePrStateByNumberAsync: gh absent -> gh-absent, no throw', async () => {
  const originalPath = process.env.PATH;
  process.env.PATH = '/nonexistent-path-with-no-gh';
  try {
    assert.equal(await resolvePrStateByNumberAsync('/tmp', 42), 'gh-absent');
  } finally {
    process.env.PATH = originalPath;
  }
});

test('resolvePrStateByNumberAsync: malformed gh output -> network-failure, no throw', async () => {
  const wrapper = installGhWrapper('#!/bin/sh\necho "not json"\n');
  try {
    assert.equal(await resolvePrStateByNumberAsync('/tmp', 42), 'network-failure');
  } finally {
    wrapper.restore();
  }
});

test('resolvePrStateByNumberAsync: malformed/misordered call -> invalid-arguments, no gh call (#3029 shape)', async () => {
  assert.equal(await resolvePrStateByNumberAsync(4242, { cwd: '/tmp' }), 'invalid-arguments');
  assert.equal(await resolvePrStateByNumberAsync('/tmp', -1), 'invalid-arguments');
  assert.equal(await resolvePrStateByNumberAsync('/tmp', '4.2'), 'invalid-arguments');
});

// #3412: release-merged must decide whether a MERGED PR actually closes the
// record's issue, so every resolver requests `closingIssuesReferences` and
// hands it through on the returned PR object (pickGoverningPr passes PR
// objects through untouched). The fixed-output gh wrapper ignores argv, so
// the argv.log match is the discriminating assertion.
const MERGED_PR_WITH_CLOSING_REFS = {
  number: 9, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', closingIssuesReferences: [{ number: 3412, repository: { name: 'w', owner: { login: 'acme' } } }],
};

function installArgvLoggingGhWrapper(json) {
  const argvLog = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pr-state-ghwrap-closing-')), 'argv.log');
  const { restore } = installGhWrapper(`#!/bin/sh\necho "$@" > "${argvLog}"\ncat <<'EOF'\n${JSON.stringify(json)}\nEOF\n`);
  return { argvLog, restore };
}

test('resolvePrState/resolvePrStateAsync: request closingIssuesReferences in the --json field list (#3412)', async () => {
  const wrapper = installArgvLoggingGhWrapper([MERGED_PR_WITH_CLOSING_REFS]);
  try {
    assert.equal(resolvePrState('/tmp', 'b').closingIssuesReferences[0].number, 3412);
    assert.match(fs.readFileSync(wrapper.argvLog, 'utf8'), /closingIssuesReferences/);
    fs.rmSync(wrapper.argvLog);
    assert.equal((await resolvePrStateAsync('/tmp', 'b')).closingIssuesReferences[0].number, 3412);
    assert.match(fs.readFileSync(wrapper.argvLog, 'utf8'), /closingIssuesReferences/);
  } finally {
    wrapper.restore();
  }
});

test('resolvePrStateByNumber/resolvePrStateByNumberAsync: request closingIssuesReferences (#3412)', async () => {
  const wrapper = installArgvLoggingGhWrapper(MERGED_PR_WITH_CLOSING_REFS);
  try {
    assert.equal(resolvePrStateByNumber('/tmp', 9).closingIssuesReferences[0].number, 3412);
    assert.match(fs.readFileSync(wrapper.argvLog, 'utf8'), /closingIssuesReferences/);
    fs.rmSync(wrapper.argvLog);
    assert.equal((await resolvePrStateByNumberAsync('/tmp', 9)).closingIssuesReferences[0].number, 3412);
    assert.match(fs.readFileSync(wrapper.argvLog, 'utf8'), /closingIssuesReferences/);
  } finally {
    wrapper.restore();
  }
});
