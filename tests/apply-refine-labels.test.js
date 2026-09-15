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
const { run, parseArgs, validateAction } = require('../plugin/bin/apply-refine-labels');

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
  });
  const code = run(['actions.json'], deps);
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
  assert.match(deps.calls.stderr.join(''), /could not resolve owner\/repo/);
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
  assert.strictEqual(deps.calls.appendEntry[0].runDir, '/repo/.claude-tweaks/pipelines/run-1');
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
  assert.strictEqual(deps.calls.appendEntry[0].runDir, '/repo/.claude-tweaks/pipelines/run-1');
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
  assert.strictEqual(deps.calls.appendEntry[0].runDir, '/repo/.claude-tweaks/pipelines/run-1');
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
  assert.strictEqual(deps.calls.appendEntry[0].runDir, '/repo/.claude-tweaks/pipelines/run-1');
});
