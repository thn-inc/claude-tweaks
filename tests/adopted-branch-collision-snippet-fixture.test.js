// tests/adopted-branch-collision-snippet-fixture.test.js — #3091.
//
// Extract-and-run (skill-prose-conformance-tests): runs the *actual* fenced bash block
// build/adopted-branch-collision-check.md ships, not a re-implementation. Before #3091 the block
// used a quoted heredoc (<<'EOF'), so the `${CLAUDE_PLUGIN_ROOT}` inside its require() was never
// shell-expanded: with the variable left to the shell the require threw, stdout was empty, and the
// skill's prose read that as `unreachable`/`no-output` — failing open, the silent pass #2844
// exists to prevent. Fixture repos come from tests/helpers/git-fixtures.js's originWithTwoClones
// (shared with tests/bin-lib/worktree/remote-branch-collision.test.js); extraction follows
// tests/dispatch-not-spec-shaped-exclusion-fixture.test.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { originWithTwoClones } = require('./helpers/git-fixtures');
const { detectShapes } = require('../tools/guard-refusals/shapes.js');

const ROOT = path.join(__dirname, '..');
const CHECK = readText(path.join(ROOT, 'plugin', 'skills', 'build', 'adopted-branch-collision-check.md'));
const PLUGIN_ROOT = path.join(ROOT, 'plugin').split(path.sep).join('/');

// #4028: {branch} and {repo} are plain-call results the agent pastes in (the worktree guard refuses
// git inside $(...)), so the test substitutes them the same way before it runs the fence.
const START_ANCHOR = '```bash\nnode "${CLAUDE_PLUGIN_ROOT}/bin/remote-branch-collision.js" --branch "{branch}" --repo "{repo}" --records "{records}"';

function extractSnippet() {
  const start = CHECK.indexOf(START_ANCHOR);
  assert.notStrictEqual(start, -1, 'snippet start anchor not found in adopted-branch-collision-check.md -- extraction is out of sync with the live file');
  const bodyStart = start + '```bash\n'.length;
  const end = CHECK.indexOf('\n```', bodyStart);
  assert.notStrictEqual(end, -1, 'snippet closing fence not found -- extraction is out of sync with the live file');
  return CHECK.slice(bodyStart, end);
}

// Pastes the plain-call values in. `repo` defaults to '' — what the fixture's `gh repo view`
// (no GitHub remote) yields, the fail-open path that skips the PR lookup; `records` defaults to ''
// too (the value the skill tells the agent to paste when the run has no record numbers).
function fill(snippet, { branch, repo = '', records = '' }) {
  for (const placeholder of ['"{branch}"', '"{repo}"', '"{records}"']) {
    assert.strictEqual(snippet.split(placeholder).length - 1, 1, `the snippet must carry ${placeholder} exactly once`);
  }
  return snippet.replace('"{branch}"', JSON.stringify(branch)).replace('"{repo}"', JSON.stringify(repo))
    .replace('"{records}"', JSON.stringify(records));
}

const currentBranch = (r) => r.run(r.work, ['branch', '--show-current']).trim();

function runSnippet(r) {
  const stdout = execFileSync('bash', ['-c', fill(extractSnippet(), { branch: currentBranch(r) })], {
    cwd: r.work,
    timeout: 60000,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...r.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
  });
  const lines = stdout.trim().split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1, `snippet must print exactly one JSON line, got: ${JSON.stringify(stdout)}`);
  return JSON.parse(lines[0]);
}

test('the collision-check snippet, run verbatim with CLAUDE_PLUGIN_ROOT left to the shell, classifies absent / mine / foreign (#3091)', (t) => {
  const r = originWithTwoClones('adopted-branch-snippet-');
  t.after(() => fs.rmSync(r.root, { recursive: true, force: true }));

  r.run(r.work, ['checkout', '-q', '-b', 'worktree-record-1']);
  const absent = runSnippet(r);
  assert.strictEqual(absent.state, 'absent');
  assert.strictEqual(absent.card, undefined, 'absent must not carry a stop card');

  r.commit(r.work, 'materialize');
  r.run(r.work, ['push', '-q', 'origin', 'worktree-record-1']);
  r.commit(r.work, 'more-work');
  const mine = runSnippet(r);
  assert.strictEqual(mine.state, 'mine');
  assert.strictEqual(mine.card, undefined, 'this run\'s own earlier push must not carry a stop card');

  r.run(r.other, ['checkout', '-q', '-b', 'worktree-record-1']);
  r.commit(r.other, 'someone-elses-stale-work');
  r.run(r.other, ['push', '-q', '--force', 'origin', 'worktree-record-1']);
  const foreign = runSnippet(r);
  assert.strictEqual(foreign.state, 'foreign');
  assert.strictEqual(foreign.remoteSha, r.run(r.other, ['rev-parse', 'HEAD']).trim());
  assert.match(foreign.card, /worktree-record-1/, 'foreign must carry the stop card naming the branch');
});

const PINNED_SHA = 'c19a97b7a4ff1b8e9ff51f5834326eaabbd189b5';

// A stub plugin root: the real bin/remote-branch-collision.js (copied) over the real
// checkAdoptedBranch composition, with only its two process seams pinned — `gh` answers `prs` and,
// when `gitFake` is set, `git` answers a pinned unreachable shape (ls-remote returns a sha,
// merge-base and fetch exit 128 → `fetch-failed`; or ls-remote itself exits 128 →
// `ls-remote-failed`), the one state a fixture repo cannot produce on demand. With `gitFake` null
// git is the real one the fixture's cwd runs. The CLI's other ./lib requires are re-exported from
// the real tree rather than copying their dependency chain.
// #4058: `comments` / `readOk` pin the issue-comment read findPriorAttemptPr makes for tombstone evidence.
function stubPluginRoot(t, gitFake, prs = [], comments = [], readOk = true) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'adopted-branch-stub-root-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'bin', 'lib', 'worktree'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'plugin', 'bin', 'remote-branch-collision.js'), path.join(dir, 'bin', 'remote-branch-collision.js'));
  for (const mod of ['shared-primitives', 'repo-resolve']) {
    fs.writeFileSync(path.join(dir, 'bin', 'lib', `${mod}.js`),
      `module.exports = require(${JSON.stringify(path.join(ROOT, 'plugin', 'bin', 'lib', `${mod}.js`).split(path.sep).join('/'))});`);
  }
  const real = path.join(ROOT, 'plugin', 'bin', 'lib', 'worktree', 'remote-branch-collision.js').split(path.sep).join('/');
  const pinnedGit = [
    'const fail = (status) => Object.assign(new Error("pinned git failure"), { status });',
    `const git = (args) => { if (args[0] === 'ls-remote') { if (${JSON.stringify(gitFake)} === 'ls-remote-failed') throw fail(128); return ${JSON.stringify(PINNED_SHA)} + '\\t' + args[3] + '\\n'; } throw fail(128); };`,
  ];
  fs.writeFileSync(path.join(dir, 'bin', 'lib', 'worktree', 'remote-branch-collision.js'), [
    `const real = require(${JSON.stringify(real)});`,
    ...(gitFake ? pinnedGit : []),
    `const gh = (args) => { if (args[0] === 'issue') { if (!${JSON.stringify(readOk)}) throw new Error('pinned comment read failure'); return ${JSON.stringify(JSON.stringify({ comments }))}; } return ${JSON.stringify(JSON.stringify(prs))}; };`,
    `module.exports = { ...real, checkAdoptedBranch: (o) => real.checkAdoptedBranch({ ...o, ${gitFake ? 'git, ' : ''}gh }) };`,
  ].join('\n'));
  return dir.split(path.sep).join('/');
}

test('the snippet prints the unknown-relation card for unreachable with remoteSha set, and no card without one (#3093)', (t) => {
  const r = originWithTwoClones('adopted-branch-unreachable-');
  t.after(() => fs.rmSync(r.root, { recursive: true, force: true }));
  r.run(r.work, ['checkout', '-q', '-b', 'worktree-record-2']);
  const run = (gitFake) => {
    const stdout = execFileSync('bash', ['-c', fill(extractSnippet(), { branch: currentBranch(r) })], {
      cwd: r.work, timeout: 60000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...r.env, CLAUDE_PLUGIN_ROOT: stubPluginRoot(t, gitFake) },
    });
    return JSON.parse(stdout.trim());
  };
  const known = run('fetch-failed');
  assert.strictEqual(known.state, 'unreachable');
  assert.strictEqual(known.reason, 'fetch-failed');
  assert.strictEqual(known.remoteSha, PINNED_SHA);
  assert.match(known.card, /`worktree-record-2` already exists on `origin` at `c19a97b7a`/);
  assert.match(known.card, /could not be determined \(`fetch-failed`\)/);
  assert.doesNotMatch(known.card, /is not in this worktree's history/);
  const unknown = run('ls-remote-failed');
  assert.strictEqual(unknown.card, undefined, 'unreachable without a remoteSha fails open — no stop card');
});

// #3887: a dispatched retry's fresh same-name branch is `foreign` by ancestry; the snippet tells this record's
// own closed prior attempt apart from a genuinely unrelated branch by the PR lookup plus the run's record numbers.
// #4058: a closed PR is this record's own tombstone only with a trusted `Attempt N failed` issue comment
// in the window before its `closedAt` (the shape dispatch/settle-and-merge.md Step 6 step 5 leaves).
const CLOSED_AT = '2026-10-21T12:00:00Z';
const TOMBSTONE_COMMENT = {
  body: 'Attempt 1 failed: tests red. Claim released, will retry.',
  authorAssociation: 'MEMBER',
  createdAt: '2026-10-21T11:59:55Z',
};

// The #3887 fixture: a record-1 retry whose branch meets its own earlier closed attempt on origin.
function priorAttemptFixture(t, prefix) {
  const r = originWithTwoClones(prefix);
  t.after(() => fs.rmSync(r.root, { recursive: true, force: true }));
  const branch = 'worktree-record-1';

  // First attempt: pushed, its PR closed, then a later commit landed on the branch.
  r.run(r.other, ['checkout', '-q', '-b', branch]);
  r.commit(r.other, 'plan');
  r.run(r.other, ['push', '-q', 'origin', branch]);
  const closedHead = r.run(r.other, ['rev-parse', 'HEAD']).trim();
  r.commit(r.other, 'post-close-plan');
  r.run(r.other, ['push', '-q', 'origin', branch]);
  // The retry: a fresh same-name branch from main.
  r.run(r.work, ['checkout', '-q', '-b', branch]);

  const pr = {
    number: 9,
    url: 'https://example.test/pr/9',
    state: 'CLOSED',
    isDraft: false,
    isCrossRepository: false,
    closedAt: CLOSED_AT,
    headRefOid: closedHead,
    closingIssuesReferences: [{ number: 1, repository: { name: 'r', owner: { login: 'o' } } }],
    body: '<!-- claude-tweaks-run: 2026-10-21T000000-record-1 -->\nclaude-tweaks-run: 2026-10-21T000000-record-1\n\nFixes #1\n',
  };
  const snippet = extractSnippet();
  assert.strictEqual(snippet.split('"{records}"').length - 1, 1, 'the snippet must carry the "{records}" placeholder exactly once');
  const exec = (script, comments = [TOMBSTONE_COMMENT], readOk = true) => execFileSync('bash', ['-c', script], {
    cwd: r.work, timeout: 60000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...r.env, CLAUDE_PLUGIN_ROOT: stubPluginRoot(t, null, [pr], comments, readOk) },
  });
  const run = (script, comments, readOk) => JSON.parse(exec(script, comments, readOk).trim());
  const withRecords = (records) => fill(snippet, { branch, repo: 'o/r', records });
  return { snippet, exec, run, withRecords, branch };
}

test('AC1.1: the snippet adopts this record\'s own prior attempt instead of carding it (#3887)', (t) => {
  const { snippet, exec, run, withRecords, branch } = priorAttemptFixture(t, 'adopted-branch-prior-attempt-');

  const own = run(withRecords('1'));
  assert.strictEqual(own.state, 'prior-attempt');
  assert.strictEqual(own.pr.number, 9);
  assert.strictEqual(own.card, undefined, 'an own prior attempt must not carry a stop card');

  const other = run(withRecords('2'));
  assert.strictEqual(other.state, 'foreign', 'a different record\'s PR is not this run\'s prior attempt (AC2.1)');
  assert.match(other.card, /worktree-record-1/);

  const bundle = run(withRecords('7,1'));
  assert.strictEqual(bundle.state, 'prior-attempt', 'a bundle run matches any of its records');

  // The unsubstituted {records} placeholder is a malformed call: exit 2, usage on stderr, no stdout.
  const verbatimScript = snippet.replace('"{branch}"', JSON.stringify(branch)).replace('"{repo}"', '"o/r"');
  assert.ok(verbatimScript.includes('"{records}"'), 'the verbatim control must leave the {records} placeholder in place');
  assert.throws(() => exec(verbatimScript), (err) => err.status === 2 && err.stdout === '',
    'the unsubstituted placeholder must exit 2 with empty stdout');
});

// #5589 AC5.1: the point of the CLI is a fence the worktree guard accepts.
// The structural rules shared by the live fence and its go-red control: one plain line, no heredoc,
// no command substitution. The shape catalogue has no row for the heredoc shape yet (#5590), so this
// is the assertion that discriminates the old fence.
function assertPlainOneLineCommand(text) {
  assert.ok(!text.trim().includes('\n'), 'the fence must be a single line');
  assert.ok(!text.includes('<<'), 'the fence must carry no heredoc');
  assert.ok(!text.includes('$('), 'the fence must carry no command substitution');
}

test('AC5.1: the fence carries no shape the worktree guard is known to refuse', () => {
  const snippet = extractSnippet();
  const filled = fill(snippet, { branch: 'worktree-record-1', repo: 'o/r', records: '1,2' });
  assertPlainOneLineCommand(snippet);
  assertPlainOneLineCommand(filled);
  // Regression floor only: detectShapes is non-discriminating for the heredoc shape until #5590 adds that row.
  assert.deepEqual(detectShapes(snippet), []);
  assert.deepEqual(detectShapes(filled), []);
});

test('AC5.1 go-red: the same structural assertion throws on the pre-#5589 heredoc fence', () => {
  const oldFence = [
    'node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "{branch}" "{repo}" "{records}" <<NODE_EVAL_EOF',
    'const x = 1;',
    'NODE_EVAL_EOF',
  ].join('\n');
  assert.throws(() => assertPlainOneLineCommand(oldFence), /the fence must be a single line/);
  assert.throws(() => assertPlainOneLineCommand(oldFence.split('\n').join(' ')), /the fence must carry no heredoc/);
});

test('#4058 AC1.2: the snippet stops with the foreign card on a closed PR that has no tombstone evidence', (t) => {
  const { run, withRecords } = priorAttemptFixture(t, 'adopted-branch-no-evidence-');
  const result = run(withRecords('1'), []);
  assert.strictEqual(result.state, 'foreign');
  assert.match(result.card, /closed PR #9/);
  assert.match(result.card, /worktree-record-1/);
});

test('#4058 AC1.2: a failed comment read stops with the same foreign card', (t) => {
  const { run, withRecords } = priorAttemptFixture(t, 'adopted-branch-read-failed-');
  const result = run(withRecords('1'), [TOMBSTONE_COMMENT], false);
  assert.strictEqual(result.state, 'foreign');
  assert.match(result.card, /closed PR #9/);
});
