// tests/apply-refine-labels.test.js
//
// #844: backlog refine's paste-ready lane blocks render one gh command per
// record. bin/apply-refine-labels.js reads a JSON array of label/comment
// actions and applies the whole batch in one dispatched call. run(argv, deps)
// is directly callable (deps-injected, per gh-api-module-pattern) — these
// tests never touch real gh/git.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { run, parseArgs, validateAction } = require('../plugin/bin/apply-refine-labels');

// The CLI runs path.resolve(cwd, opts.run), so the expected runDir is resolved the same way.
const RUN_DIR = path.resolve('/repo/.claude-tweaks/pipelines/run-1');

test('parseArgs: missing actions-file argument is an error', () => {
  assert.ok(parseArgs([]).error);
  assert.ok(parseArgs(['--run', '/tmp/x']).error);
});

test('parseArgs: --help short-circuits before the positional is required', () => {
  assert.strictEqual(parseArgs(['--help']).help, true);
});

test('parseArgs: unknown flag is an error', () => {
  assert.match(parseArgs(['actions.json', '--bogus']).error, /unknown argument/);
});

test('parseArgs: --run as the last token with no value is an error, not silently omitted', () => {
  assert.match(parseArgs(['actions.json', '--run']).error, /--run requires a value/);
});

test('parseArgs: --run immediately followed by another flag is an error, not treated as its value', () => {
  assert.match(parseArgs(['actions.json', '--run', '--repo', 'acme/widgets']).error, /--run requires a value/);
});

test('parseArgs: --run "" degrades to omitted, not an error', () => {
  const opts = parseArgs(['actions.json', '--run', '']);
  assert.strictEqual(opts.error, undefined);
  assert.strictEqual(opts.run, null);
  assert.strictEqual(opts.runEmpty, true);
});

test('parseArgs: --run never passed leaves runEmpty false', () => {
  const opts = parseArgs(['actions.json']);
  assert.strictEqual(opts.run, null);
  assert.strictEqual(opts.runEmpty, false);
});

test('parseArgs: a later non-empty --run clears runEmpty set by an earlier empty --run', () => {
  const opts = parseArgs(['actions.json', '--run', '', '--run', '/repo/.claude-tweaks/pipelines/run-1']);
  assert.strictEqual(opts.error, undefined);
  assert.strictEqual(opts.run, '/repo/.claude-tweaks/pipelines/run-1');
  assert.strictEqual(opts.runEmpty, false);
});

// #1138: a whitespace-only value is the same "$PIPELINE_RUN_DIR resolved to
// nothing" shape that motivated #1173's degrade-to-omitted design — it must
// degrade the same way, not slip past the `=== ''` check and reach the
// anchoring guard as a truthy-but-blank path.
test('parseArgs: --run "   " (whitespace-only) degrades to omitted, same as "" — not an error, not passed through', () => {
  const opts = parseArgs(['actions.json', '--run', '   ']);
  assert.strictEqual(opts.error, undefined);
  assert.strictEqual(opts.run, null);
  assert.strictEqual(opts.runEmpty, true);
});

test('validateAction: rejects a non-integer issue', () => {
  assert.match(validateAction({ issue: 'x', addLabels: ['a'] }, 0), /must be a positive integer/);
});

test('validateAction: rejects an action with no add/remove/comment', () => {
  assert.match(validateAction({ issue: 1 }, 0), /must set addLabels, removeLabels, or commentFile/);
});

test('validateAction: accepts addLabels only, removeLabels only, or commentFile only', () => {
  assert.strictEqual(validateAction({ issue: 1, addLabels: ['a'] }, 0), null);
  assert.strictEqual(validateAction({ issue: 1, removeLabels: ['a'] }, 0), null);
  assert.strictEqual(validateAction({ issue: 1, commentFile: '/tmp/x.md' }, 0), null);
});

function fakeDeps(overrides = {}) {
  const calls = { gh: [], ghAvailable: 0, stderr: [], stdout: [], appendEntry: [] };
  return {
    calls,
    gh: (args) => { calls.gh.push(args); return ''; },
    ghAvailable: () => { calls.ghAvailable += 1; return true; },
    remoteUrl: () => 'https://github.com/acme/widgets.git',
    readFile: () => { throw new Error('readFile not stubbed for this test'); },
    cwd: () => '/repo',
    mainRoot: () => '/repo',
    isAnchored: () => true,
    now: () => 1700000000000,
    appendEntry: (a) => { calls.appendEntry.push(a); },
    stdout: (s) => { calls.stdout.push(s); },
    stderr: (s) => { calls.stderr.push(s); },
    ...overrides,
  };
}

test('run: actions file that fails to read exits 1', () => {
  const deps = fakeDeps({ readFile: () => { throw new Error('ENOENT'); } });
  const code = run(['missing.json'], deps);
  assert.strictEqual(code, 1);
  assert.match(deps.calls.stderr.join(''), /could not read/);
});

test('run: actions file with invalid JSON exits 1', () => {
  const deps = fakeDeps({ readFile: () => '{not json' });
  const code = run(['bad.json'], deps);
  assert.strictEqual(code, 1);
  assert.match(deps.calls.stderr.join(''), /not valid JSON/);
});

test('run: empty array exits 1', () => {
  const deps = fakeDeps({ readFile: () => '[]' });
  const code = run(['empty.json'], deps);
  assert.strictEqual(code, 1);
  assert.match(deps.calls.stderr.join(''), /non-empty JSON array/);
});

test('run: an invalid action anywhere in the array exits 1 before any gh call', () => {
  const deps = fakeDeps({ readFile: () => JSON.stringify([{ issue: 1, addLabels: ['a'] }, { issue: 2 }]) });
  const code = run(['actions.json'], deps);
  assert.strictEqual(code, 1);
  assert.strictEqual(deps.calls.gh.length, 0);
});

test('run: applies addLabels and removeLabels via one gh issue edit call, resolving repo from git remote', () => {
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 118, addLabels: ['auto:build'], removeLabels: ['bot:blocked'] }]),
  });
  const code = run(['actions.json'], deps);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(deps.calls.gh, [
    ['issue', 'edit', '118', '--repo', 'acme/widgets', '--add-label', 'auto:build', '--remove-label', 'bot:blocked'],
  ]);
  const summary = JSON.parse(deps.calls.stdout.join(''));
  assert.deepStrictEqual(summary, { ok: [118], failed: [] });
});

test('run: commentFile action calls gh issue comment --body-file', () => {
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 201, removeLabels: ['ready'], commentFile: '/tmp/backlog-refine-flagback-201.md' }]),
  });
  const code = run(['actions.json'], deps);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(deps.calls.gh, [
    ['issue', 'edit', '201', '--repo', 'acme/widgets', '--remove-label', 'ready'],
    ['issue', 'comment', '201', '--repo', 'acme/widgets', '--body-file', '/tmp/backlog-refine-flagback-201.md'],
  ]);
});

test('run: --repo flag overrides remote-derived owner/repo, and remoteUrl is never called', () => {
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 5, addLabels: ['x'] }]),
    remoteUrl: () => { throw new Error('remoteUrl should not be called when --repo is passed'); },
  });
  const code = run(['actions.json', '--repo', 'other/repo'], deps);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(deps.calls.gh[0], ['issue', 'edit', '5', '--repo', 'other/repo', '--add-label', 'x']);
});

// #2240: on a GitHub Enterprise Server remote, parseRepo now returns a non-github.com
// host, and the composed --repo flag is host-qualified (host/owner/repo) so `gh` targets
// the right instance instead of always assuming github.com.
test('run: on a GitHub Enterprise Server remote, --repo is host-qualified', () => {
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 118, addLabels: ['auto:build'] }]),
    remoteUrl: () => 'git@ghe.example.com:acme/widgets.git',
    gateDeps: { env: { GH_HOST: 'ghe.example.com' } },
  });
  const code = run(['actions.json'], deps);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(deps.calls.gh, [
    ['issue', 'edit', '118', '--repo', 'ghe.example.com/acme/widgets', '--add-label', 'auto:build'],
  ]);
});

// #2444 review fix: a caller-supplied --repo can itself already be a
// host-qualified `host/owner/repo` slug (repoSlug()'s GHE output) — before
// this fix, --repo was always prefixed with `github.com/` regardless of
// shape, producing an unparseable 4-segment string for a slug like this.
test('run: a host-qualified --repo flag value passes through unmangled (#2444)', () => {
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 118, addLabels: ['auto:build'] }]),
    remoteUrl: () => { throw new Error('remoteUrl should not be called when --repo is passed'); },
  });
  const code = run(['actions.json', '--repo', 'ghe.example.com/acme/widgets'], deps);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(deps.calls.gh, [
    ['issue', 'edit', '118', '--repo', 'ghe.example.com/acme/widgets', '--add-label', 'auto:build'],
  ]);
});

test('run: one failed gh call is isolated — other actions still apply, failure reported in the summary', () => {
  let call = 0;
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 1, addLabels: ['a'] }, { issue: 2, addLabels: ['b'] }]),
    gh: (args) => {
      call += 1;
      deps.calls.gh.push(args);
      if (call === 1) { throw new Error('HTTP 404'); }
      return '';
    },
  });
  const code = run(['actions.json'], deps);
  assert.strictEqual(code, 0);
  const summary = JSON.parse(deps.calls.stdout.join(''));
  assert.deepStrictEqual(summary.ok, [2]);
  assert.strictEqual(summary.failed.length, 1);
  assert.strictEqual(summary.failed[0].issue, 1);
  assert.match(summary.failed[0].error, /HTTP 404/);
});

test('run: no owner/repo resolvable from --repo or git remote exits 2', () => {
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 1, addLabels: ['a'] }]),
    remoteUrl: () => 'not-a-github-url',
  });
  const code = run(['actions.json'], deps);
  assert.strictEqual(code, 2);
  assert.match(deps.calls.stderr.join(''), /could not resolve owner\/repo — pass --repo \[host\/\]owner\/name/);
});

test('run: gh not available exits 2 before reading the actions file', () => {
  const deps = fakeDeps({ ghAvailable: () => false, readFile: () => { throw new Error('must not be called'); } });
  const code = run(['actions.json'], deps);
  assert.strictEqual(code, 2);
  assert.match(deps.calls.stderr.join(''), /`gh` is required/);
});

test('run: --run given logs one AUTO decisions.md line per successfully-applied action, under /backlog', () => {
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 118, addLabels: ['auto:build'], removeLabels: ['bot:blocked'] }]),
  });
  const code = run(['actions.json', '--run', '/repo/.claude-tweaks/pipelines/run-1'], deps);
  assert.strictEqual(code, 0);
  assert.strictEqual(deps.calls.appendEntry.length, 1);
  assert.strictEqual(deps.calls.appendEntry[0].runDir, RUN_DIR);
  assert.strictEqual(deps.calls.appendEntry[0].section, '/backlog');
  assert.match(deps.calls.appendEntry[0].entry, /#118: applied \+auto:build, -bot:blocked/);
});

// #1072: a failed action now logs a hand-composed FAILED line — append.js's
// STATUSES enum has no FAILED member, so this bypasses formatEntry rather
// than going through it. refine-mode.md Step 5's closing summary counts
// `FAILED` lines toward its failed tally.
test('run: --run given logs one FAILED decisions.md line per failed action, under /backlog', () => {
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 1, addLabels: ['a'], removeLabels: ['b'] }]),
    gh: () => { throw new Error('boom'); },
  });
  const code = run(['actions.json', '--run', '/repo/.claude-tweaks/pipelines/run-1'], deps);
  assert.strictEqual(code, 0);
  assert.strictEqual(deps.calls.appendEntry.length, 1);
  assert.strictEqual(deps.calls.appendEntry[0].runDir, RUN_DIR);
  assert.strictEqual(deps.calls.appendEntry[0].section, '/backlog');
  assert.match(deps.calls.appendEntry[0].entry, /^- FAILED \d{2}:\d{2}:\d{2} — apply-refine-labels: #1: \+a, -b failed: boom\.$/);
});

// #1073: edit and comment are independent steps — a comment failure after a
// successful edit must not erase the edit's own success from decisions.md.
test('run: edit succeeds but comment fails — decisions.md logs the edit AUTO line distinct from the comment FAILED line; issue lands in failed with step "comment", not in ok', () => {
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 42, addLabels: ['auto:build'], commentFile: '/tmp/note.md' }]),
    gh: (args) => {
      deps.calls.gh.push(args);
      if (args[0] === 'issue' && args[1] === 'comment') { throw new Error('comment boom'); }
      return '';
    },
  });
  const code = run(['actions.json', '--run', '/repo/.claude-tweaks/pipelines/run-1'], deps);
  assert.strictEqual(code, 0);
  const summary = JSON.parse(deps.calls.stdout.join(''));
  assert.deepStrictEqual(summary.ok, []);
  assert.strictEqual(summary.failed.length, 1);
  assert.deepStrictEqual(summary.failed[0].issue, 42);
  assert.strictEqual(summary.failed[0].step, 'comment');
  assert.match(summary.failed[0].error, /comment boom/);

  // Both gh calls were attempted — the edit was not skipped, and the edit
  // landing is what this record is about.
  assert.strictEqual(deps.calls.gh.length, 2);

  // Two decisions.md entries: the edit's own AUTO success line, distinct
  // from the comment's own FAILED line.
  assert.strictEqual(deps.calls.appendEntry.length, 2);
  const editEntry = deps.calls.appendEntry.find((c) => /applied/.test(c.entry));
  const failedEntry = deps.calls.appendEntry.find((c) => /^- FAILED/.test(c.entry));
  assert.ok(editEntry, 'expected an AUTO entry recording the edit as landed');
  assert.match(editEntry.entry, /#42: applied \+auto:build/);
  assert.ok(failedEntry, 'expected a FAILED entry for the comment step');
  assert.match(failedEntry.entry, /^- FAILED \d{2}:\d{2}:\d{2} — apply-refine-labels: #42: comment failed: .*comment boom.*\.$/);
});

test('run: edit fails — the comment call is never attempted for that action (edit failure still short-circuits)', () => {
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 7, addLabels: ['a'], commentFile: '/tmp/note.md' }]),
    gh: (args) => {
      deps.calls.gh.push(args);
      throw new Error('edit boom');
    },
  });
  const code = run(['actions.json'], deps);
  assert.strictEqual(code, 0);
  const summary = JSON.parse(deps.calls.stdout.join(''));
  assert.deepStrictEqual(summary.ok, []);
  assert.strictEqual(summary.failed.length, 1);
  assert.strictEqual(summary.failed[0].step, 'edit');
  // Only the edit gh call was attempted, never the comment.
  assert.strictEqual(deps.calls.gh.length, 1);
  assert.strictEqual(deps.calls.gh[0][1], 'edit');
});

test('run: edit and comment both succeed — issue lands in ok, and decisions.md gets both the edit AUTO line and a comment-posted AUTO line', () => {
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 9, removeLabels: ['ready'], commentFile: '/tmp/note.md' }]),
  });
  const code = run(['actions.json', '--run', '/repo/.claude-tweaks/pipelines/run-1'], deps);
  assert.strictEqual(code, 0);
  const summary = JSON.parse(deps.calls.stdout.join(''));
  assert.deepStrictEqual(summary.ok, [9]);
  assert.deepStrictEqual(summary.failed, []);
  assert.strictEqual(deps.calls.appendEntry.length, 2);
  assert.match(deps.calls.appendEntry[0].entry, /#9: applied -ready/);
  assert.match(deps.calls.appendEntry[1].entry, /#9: comment posted/);
});

test('run: commentFile-only action (no labels) that succeeds logs a "comment posted" AUTO line', () => {
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 11, commentFile: '/tmp/note.md' }]),
  });
  const code = run(['actions.json', '--run', '/repo/.claude-tweaks/pipelines/run-1'], deps);
  assert.strictEqual(code, 0);
  const summary = JSON.parse(deps.calls.stdout.join(''));
  assert.deepStrictEqual(summary.ok, [11]);
  assert.strictEqual(deps.calls.appendEntry.length, 1);
  assert.match(deps.calls.appendEntry[0].entry, /#11: comment posted/);
});

test('run: edit-only failure (no commentFile) still logs the same FAILED line shape as before #1073 (regression guard on #1072 behavior)', () => {
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 1, addLabels: ['a'], removeLabels: ['b'] }]),
    gh: () => { throw new Error('boom'); },
  });
  const code = run(['actions.json', '--run', '/repo/.claude-tweaks/pipelines/run-1'], deps);
  assert.strictEqual(code, 0);
  assert.strictEqual(deps.calls.appendEntry.length, 1);
  assert.strictEqual(deps.calls.appendEntry[0].runDir, RUN_DIR);
  assert.strictEqual(deps.calls.appendEntry[0].section, '/backlog');
  assert.match(deps.calls.appendEntry[0].entry, /^- FAILED \d{2}:\d{2}:\d{2} — apply-refine-labels: #1: \+a, -b failed: boom\.$/);
  const summary = JSON.parse(deps.calls.stdout.join(''));
  assert.strictEqual(summary.failed[0].step, 'edit');
});

test('run: --run omitted never calls appendEntry even on a failed action', () => {
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 1, addLabels: ['a'] }]),
    gh: () => { throw new Error('boom'); },
  });
  const code = run(['actions.json'], deps);
  assert.strictEqual(code, 0);
  assert.strictEqual(deps.calls.appendEntry.length, 0);
});

test('run: no --run flag never calls appendEntry', () => {
  const deps = fakeDeps({ readFile: () => JSON.stringify([{ issue: 1, addLabels: ['a'] }]) });
  const code = run(['actions.json'], deps);
  assert.strictEqual(code, 0);
  assert.strictEqual(deps.calls.appendEntry.length, 0);
});

test('run: --run "" degrades to omitted — applies the batch (exit 0), skips appendEntry, notes the skip on stderr', () => {
  const deps = fakeDeps({ readFile: () => JSON.stringify([{ issue: 118, addLabels: ['auto:build'] }]) });
  const code = run(['actions.json', '--run', ''], deps);
  assert.strictEqual(code, 0);
  assert.strictEqual(deps.calls.appendEntry.length, 0);
  assert.match(deps.calls.stderr.join(''), /--run was empty — proceeding without run-dir\/decisions\.md logging/);
  const summary = JSON.parse(deps.calls.stdout.join(''));
  assert.deepStrictEqual(summary, { ok: [118], failed: [] });
});

test('run: no --run flag at all stays silent — no empty-run stderr note', () => {
  const deps = fakeDeps({ readFile: () => JSON.stringify([{ issue: 1, addLabels: ['a'] }]) });
  const code = run(['actions.json'], deps);
  assert.strictEqual(code, 0);
  assert.doesNotMatch(deps.calls.stderr.join(''), /--run was empty/);
});

test('run: a later non-empty --run after an earlier empty --run logs normally and never prints the empty-run note', () => {
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 118, addLabels: ['auto:build'] }]),
  });
  const code = run(['actions.json', '--run', '', '--run', '/repo/.claude-tweaks/pipelines/run-1'], deps);
  assert.strictEqual(code, 0);
  assert.doesNotMatch(deps.calls.stderr.join(''), /--run was empty/);
  assert.strictEqual(deps.calls.appendEntry.length, 1);
  assert.strictEqual(deps.calls.appendEntry[0].runDir, RUN_DIR);
});

// #5902: label-protocol transitions emitted as station events after a
// successful edit, through the optional deps.stationEvent.
function stationDeps(actions, overrides = {}) {
  const events = [];
  const deps = fakeDeps({
    readFile: () => JSON.stringify(actions),
    stationEvent: (e) => { events.push(e); },
    ...overrides,
  });
  return { deps, events };
}

const triple = (e) => `${e.kind} ${e.station}${e.outcome ? ' ' + e.outcome : ''}`;

test('#5902: realDeps wires a stationEvent emitter, so the real entry point emits', () => {
  const { realDeps } = require('../plugin/bin/apply-refine-labels');
  assert.strictEqual(typeof realDeps.stationEvent, 'function', 'stationEvent is wired');
});

test('run: station events — adding auto:build records exited authorize passed + decided authorize + entered release, with the full field set', () => {
  const { deps, events } = stationDeps([{ issue: 118, addLabels: ['auto:build'] }], { sessionId: 'sess-1' });
  assert.strictEqual(run(['actions.json'], deps), 0);
  assert.deepStrictEqual(events.map(triple), ['exited authorize passed', 'decided authorize', 'entered release']);
  assert.deepStrictEqual(events[0], {
    kind: 'exited', station: 'authorize', outcome: 'passed',
    recordNumber: 118, repoName: 'acme/widgets', lane: 'unknown', runId: null, sessionId: 'sess-1',
    payload: { label: 'auto:build', direction: 'added', actor: 'person' },
    discriminator: 'refine:118:added:auto:build:2023-11-14T22:13:20.000Z',
  });
  assert.strictEqual(events[2].outcome, undefined);
});

test('authorizing writes exited passed actor person and a decided authorize via skill', () => {
  const { deps, events } = stationDeps([{ issue: 118, addLabels: ['auto:build'] }], { sessionId: 'sess-1' });
  assert.strictEqual(run(['actions.json'], deps), 0);
  assert.deepStrictEqual(events.map(triple), ['exited authorize passed', 'decided authorize', 'entered release']);
  assert.strictEqual(events[0].payload.actor, 'person');
  const { eventKey, buildLine } = require('../plugin/bin/lib/station-events/emit');
  assert.deepStrictEqual(events[1].payload, {
    decision: 'authorize', actor: 'person', via: 'skill', outcomeRef: eventKey(events[0]),
  });
  assert.strictEqual(events[1].payload.outcomeRef, buildLine(events[0]).eventKey, 'outcomeRef is the written exit line key');
  assert.strictEqual(events[1].discriminator, events[0].discriminator);
  assert.ok(buildLine(events[1]), 'the decided line is accepted');
});

test('re-authorizing (auto:build added, bot:blocked removed) also writes decision authorize', () => {
  const { deps, events } = stationDeps([{ issue: 118, addLabels: ['auto:build'], removeLabels: ['bot:blocked'] }]);
  assert.strictEqual(run(['actions.json'], deps), 0);
  const decided = events.filter((e) => e.kind === 'decided');
  assert.strictEqual(decided.length, 1);
  assert.strictEqual(decided[0].payload.decision, 'authorize');
  assert.strictEqual(decided[0].payload.actor, 'person');
});

test('a throwing exit emitter writes no decided line', () => {
  const seen = [];
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 118, addLabels: ['auto:build'] }]),
    stationEvent: (e) => { seen.push(e.kind); if (e.kind === 'exited') throw new Error('boom'); },
  });
  assert.strictEqual(run(['actions.json'], deps), 0);
  assert.deepStrictEqual(seen, ['exited', 'entered']);
});

test('an exit the emitter reports not written gets no decided line, and entered release still emits', () => {
  const seen = [];
  const deps = fakeDeps({
    readFile: () => JSON.stringify([{ issue: 118, addLabels: ['auto:build'] }]),
    stationEvent: (e) => { seen.push(e.kind); return e.kind === 'exited' ? { written: false } : { written: true }; },
  });
  assert.strictEqual(run(['actions.json'], deps), 0);
  assert.deepStrictEqual(seen, ['exited', 'entered']);
});

test('a throwing decided call still lets entered release emit, with stdout and exit unchanged', () => {
  const actions = [{ issue: 118, addLabels: ['auto:build'] }];
  const plain = fakeDeps({ readFile: () => JSON.stringify(actions) });
  const plainCode = run(['actions.json'], plain);
  const seen = [];
  const deps = fakeDeps({
    readFile: () => JSON.stringify(actions),
    stationEvent: (e) => { seen.push(e.kind); if (e.kind === 'decided') throw new Error('boom'); },
  });
  assert.strictEqual(run(['actions.json'], deps), plainCode);
  assert.deepStrictEqual(seen, ['exited', 'decided', 'entered']);
  assert.strictEqual(deps.calls.stdout.join(''), plain.calls.stdout.join(''));
});

test('run: station events — adding ready records its three transitions', () => {
  const { deps, events } = stationDeps([{ issue: 7, addLabels: ['ready'] }]);
  assert.strictEqual(run(['actions.json'], deps), 0);
  assert.deepStrictEqual(events.map(triple), ['exited intake passed', 'exited shape passed', 'entered authorize']);
  assert.ok(events.every((e) => e.sessionId === null && e.lane === 'unknown'));
});

test('run: station events — removing needs:definition records exited intake passed', () => {
  const { deps, events } = stationDeps([{ issue: 9, removeLabels: ['needs:definition'] }]);
  assert.strictEqual(run(['actions.json'], deps), 0);
  assert.deepStrictEqual(events.map(triple), ['exited intake passed']);
  assert.deepStrictEqual(events[0].payload, { label: 'needs:definition', direction: 'removed' });
  assert.strictEqual(events[0].discriminator, 'refine:9:removed:needs:definition:2023-11-14T22:13:20.000Z');
});

test('run: station events — one action adding ready and removing needs:definition exits intake once', () => {
  const { deps, events } = stationDeps([{ issue: 4, addLabels: ['ready'], removeLabels: ['needs:definition'] }]);
  assert.strictEqual(run(['actions.json'], deps), 0);
  assert.deepStrictEqual(events.map(triple), ['exited intake passed', 'exited shape passed', 'entered authorize']);
  assert.deepStrictEqual(events.map((e) => e.payload.direction), ['added', 'added', 'added']);
});

test('run: station events — two actions on one issue are not deduped against each other, and a distinct pair in one action still records both', () => {
  const { deps, events } = stationDeps([
    { issue: 4, removeLabels: ['needs:definition'] },
    { issue: 4, addLabels: ['ready'] },
    { issue: 5, addLabels: ['auto:build', 'bot:in-progress'] },
  ]);
  assert.strictEqual(run(['actions.json'], deps), 0);
  assert.deepStrictEqual(events.map((e) => `${e.recordNumber} ${triple(e)}`), [
    '4 exited intake passed',
    '4 exited intake passed', '4 exited shape passed', '4 entered authorize',
    '5 exited authorize passed', '5 decided authorize', '5 entered release', '5 exited release passed', '5 entered build',
  ]);
});

test('run: station events — a label with no table row records nothing', () => {
  const { deps, events } = stationDeps([{ issue: 3, addLabels: ['priority:high'], removeLabels: ['bot:blocked'] }]);
  assert.strictEqual(run(['actions.json'], deps), 0);
  assert.deepStrictEqual(events, []);
});

test('run: station events — a failed edit records nothing and the action lands in failed', () => {
  const { deps, events } = stationDeps([{ issue: 5, addLabels: ['auto:build'] }], {
    gh: () => { throw new Error('HTTP 502'); },
  });
  assert.strictEqual(run(['actions.json'], deps), 0);
  assert.deepStrictEqual(events, []);
  const summary = JSON.parse(deps.calls.stdout.join(''));
  assert.deepStrictEqual(summary.ok, []);
  assert.strictEqual(summary.failed[0].issue, 5);
});

test('run: station events — a throwing stationEvent leaves stdout and exit code byte-identical to a run without it', () => {
  const actions = [{ issue: 1, addLabels: ['ready'] }, { issue: 2, addLabels: ['auto:build'] }];
  const plain = fakeDeps({ readFile: () => JSON.stringify(actions) });
  const plainCode = run(['actions.json'], plain);
  let attempts = 0;
  const throwing = fakeDeps({
    readFile: () => JSON.stringify(actions),
    stationEvent: () => { attempts += 1; throw new Error('emitter boom'); },
  });
  const throwingCode = run(['actions.json'], throwing);
  assert.strictEqual(throwingCode, plainCode);
  assert.strictEqual(throwing.calls.stdout.join(''), plain.calls.stdout.join(''));
  assert.deepStrictEqual(throwing.calls.gh, plain.calls.gh);
  assert.strictEqual(attempts, 5, 'every transition of every action is still attempted');
});

test('run: station events — a recording stationEvent leaves stdout and exit code byte-identical to a run without it', () => {
  const actions = [{ issue: 1, addLabels: ['ready'] }, { issue: 2, addLabels: ['auto:build'] }];
  const plain = fakeDeps({ readFile: () => JSON.stringify(actions) });
  const plainCode = run(['actions.json'], plain);
  const { deps, events } = stationDeps(actions);
  assert.strictEqual(run(['actions.json'], deps), plainCode);
  assert.strictEqual(deps.calls.stdout.join(''), plain.calls.stdout.join(''));
  assert.strictEqual(events.length, 6, 'the recorder saw every transition');
});

test('run: station events — runId is the run dir basename with --run, and the discriminator ends with it', () => {
  const { deps, events } = stationDeps([{ issue: 118, addLabels: ['auto:build'] }]);
  assert.strictEqual(run(['actions.json', '--run', '/repo/.claude-tweaks/pipelines/run-1'], deps), 0);
  assert.ok(events.length > 0);
  assert.ok(events.every((e) => e.runId === 'run-1'));
  assert.strictEqual(events[0].discriminator, 'refine:118:added:auto:build:run-1');
});

test('run: station events — a comment failure after a successful edit still records the label transitions; the action lands in failed with step comment', () => {
  const { deps, events } = stationDeps([{ issue: 12, addLabels: ['auto:build'], commentFile: '/tmp/c.md' }], {
    gh: (args) => { if (args[1] === 'comment') throw new Error('HTTP 500'); return ''; },
  });
  assert.strictEqual(run(['actions.json'], deps), 0);
  assert.deepStrictEqual(events.map(triple), ['exited authorize passed', 'decided authorize', 'entered release']);
  const summary = JSON.parse(deps.calls.stdout.join(''));
  assert.deepStrictEqual(summary.ok, []);
  assert.deepStrictEqual(summary.failed.map((f) => [f.issue, f.step]), [[12, 'comment']]);
});

test('run: station events — a host-qualified --repo reduces to owner/name on every event', () => {
  const { deps, events } = stationDeps([{ issue: 118, addLabels: ['auto:build'] }]);
  assert.strictEqual(run(['actions.json', '--repo', 'ghe.example.com/acme/widgets'], deps), 0);
  assert.strictEqual(events.length, 3);
  assert.ok(events.every((e) => e.repoName === 'acme/widgets'));
});

test('run: station events — a --repo the CLI accepts but that is not owner/name emits nothing and still applies the edit', () => {
  const { deps, events } = stationDeps([{ issue: 118, addLabels: ['auto:build'] }]);
  assert.strictEqual(run(['actions.json', '--repo', 'ac me/widgets'], deps), 0);
  assert.deepStrictEqual(deps.calls.gh[0].slice(0, 5), ['issue', 'edit', '118', '--repo', 'ac me/widgets']);
  assert.deepStrictEqual(JSON.parse(deps.calls.stdout.join('')).ok, [118]);
  assert.deepStrictEqual(events, []);
});

test('run: station events — with no run dir the discriminator ends with the invocation start time; with --run it is clock-free', () => {
  const discs = (argv, nowMs) => {
    const { deps, events } = stationDeps([{ issue: 118, addLabels: ['auto:build'] }], { now: () => nowMs });
    assert.strictEqual(run(argv, deps), 0);
    return events.map((e) => e.discriminator);
  };
  const a = discs(['actions.json'], 1700000000000);
  const b = discs(['actions.json'], 1700000999000);
  assert.strictEqual(a[0], 'refine:118:added:auto:build:2023-11-14T22:13:20.000Z');
  assert.notDeepStrictEqual(a, b);
  const runArgv = ['actions.json', '--run', '/repo/.claude-tweaks/pipelines/run-1'];
  assert.deepStrictEqual(discs(runArgv, 1700000000000), discs(runArgv, 1700000999000));
  assert.strictEqual(discs(runArgv, 1700000000000)[0], 'refine:118:added:auto:build:run-1');
});
