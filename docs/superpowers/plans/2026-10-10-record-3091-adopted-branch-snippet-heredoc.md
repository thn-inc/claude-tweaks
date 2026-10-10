# Adopted-branch collision check snippet expands the plugin root (#3091) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The runnable command in `plugin/skills/build/adopted-branch-collision-check.md` resolves the collision module when `${CLAUDE_PLUGIN_ROOT}` is left to the shell, and a test runs that exact snippet so a regression cannot silently fail open.

**Architecture:** One-token prose fix — the heredoc delimiter goes from quoted `<<'EOF'` (no shell expansion inside the body) to unquoted `<<NODE_EVAL_EOF`, the form every sibling `node-eval-file.js` site uses (`plugin/skills/dispatch/next-ranking.md:28`, `plugin/skills/dispatch/queue-pull-script.md:15`). A new extract-and-run test (pattern: `tests/dispatch-not-spec-shaped-exclusion-fixture.test.js`) extracts the fenced block verbatim and runs it with `bash -c` against real git fixture repos (pattern: `tests/bin-lib/worktree/remote-branch-collision.test.js`'s `makeRepos`).

**Tech Stack:** Markdown skill prose; `node --test`; real `git` fixtures; `bash`.

**Spec:** `.claude-tweaks/pipelines/2026-10-10T111228-record-3091/work/3091-spec.md`

## Global Constraints

- The snippet's JS body must contain no `$` other than the two `${CLAUDE_PLUGIN_ROOT}` references, because an unquoted heredoc expands every `$` (verified at plan time: the body's only `$` uses are `${CLAUDE_PLUGIN_ROOT}`).
- Close the heredoc with the matching `NODE_EVAL_EOF` line.
- Tests pass `CLAUDE_PLUGIN_ROOT` with forward slashes (a win32 backslash path inside a JS string literal reads as escapes — the sibling fixture test's own comment).
- Commit style: `{Verb} {what} — {detail}`; end commit messages with the `Claude-Session:` trailer.

## Review Focus

- The snippet run verbatim with `CLAUDE_PLUGIN_ROOT` exported must print exactly one parseable JSON line — pinned by every test case parsing stdout.
- `foreign` must carry the stop `card` naming the branch — pinned.
- `absent` and `mine` must carry no `card` — pinned.
- The test must fail on the quoted-heredoc text (MODULE_NOT_FOUND → empty stdout → JSON.parse throws) — pinned by Step 2's expected FAIL.
- `gh repo view` against a non-GitHub fixture origin must not hang or break the run — the snippet already redirects its stderr and treats an empty repo as `prLookup: null`.

---

### Task 1: Unquote the collision-check heredoc and pin the snippet with an extract-and-run test

**Files:**
- Modify: `plugin/skills/build/adopted-branch-collision-check.md:33` (opening heredoc line) and `:42` (closing `EOF` line)
- Test: `tests/adopted-branch-collision-snippet-fixture.test.js` (create)

**Interfaces:**
- Consumes: none.
- Produces: none (prose + test).

- [ ] **Step 1: Write the failing test** — create `tests/adopted-branch-collision-snippet-fixture.test.js`:

```js
// tests/adopted-branch-collision-snippet-fixture.test.js — #3091.
//
// Extract-and-run (skill-prose-conformance-tests): runs the *actual* fenced bash block
// build/adopted-branch-collision-check.md ships, not a re-implementation. Before #3091 the block
// used a quoted heredoc (<<'EOF'), so the `${CLAUDE_PLUGIN_ROOT}` inside its require() was never
// shell-expanded: with the variable left to the shell the require threw, stdout was empty, and the
// skill's prose read that as `unreachable`/`no-output` — failing open, the silent pass #2844
// exists to prevent. Fixture repos follow tests/bin-lib/worktree/remote-branch-collision.test.js's
// makeRepos; extraction follows tests/dispatch-not-spec-shaped-exclusion-fixture.test.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const CHECK = readText(path.join(ROOT, 'plugin', 'skills', 'build', 'adopted-branch-collision-check.md'));
const PLUGIN_ROOT = path.join(ROOT, 'plugin').split(path.sep).join('/');

const START_ANCHOR = '```bash\nnode "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$(git branch --show-current)"';

function extractSnippet() {
  const start = CHECK.indexOf(START_ANCHOR);
  assert.notStrictEqual(start, -1, 'snippet start anchor not found in adopted-branch-collision-check.md -- extraction is out of sync with the live file');
  const bodyStart = start + '```bash\n'.length;
  const end = CHECK.indexOf('\n```', bodyStart);
  assert.notStrictEqual(end, -1, 'snippet closing fence not found -- extraction is out of sync with the live file');
  return CHECK.slice(bodyStart, end);
}

function makeRepos() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adopted-branch-snippet-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const other = path.join(root, 'other');
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  };
  const run = (cwd, args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const commit = (cwd, name) => {
    fs.writeFileSync(path.join(cwd, name), name);
    run(cwd, ['add', name]);
    run(cwd, ['commit', '-q', '-m', name]);
  };
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env });
  for (const dir of [work, other]) {
    execFileSync('git', ['init', '-q', '-b', 'main', dir], { env });
    run(dir, ['remote', 'add', 'origin', origin]);
  }
  commit(work, 'base');
  run(work, ['push', '-q', 'origin', 'main']);
  run(other, ['pull', '-q', 'origin', 'main']);
  return { root, work, other, env, run, commit };
}

function runSnippet(r) {
  const stdout = execFileSync('bash', ['-c', extractSnippet()], {
    cwd: r.work,
    timeout: 60000,
    encoding: 'utf8',
    env: { ...r.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
  });
  const lines = stdout.trim().split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1, `snippet must print exactly one JSON line, got: ${JSON.stringify(stdout)}`);
  return JSON.parse(lines[0]);
}

test('the collision-check snippet, run verbatim with CLAUDE_PLUGIN_ROOT left to the shell, classifies absent / mine / foreign (#3091)', (t) => {
  const r = makeRepos();
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/adopted-branch-collision-snippet-fixture.test.js`
Expected: FAIL — on today's `<<'EOF'` text the `require('${CLAUDE_PLUGIN_ROOT}/...')` is passed to node unexpanded, node prints `Cannot find module '${CLAUDE_PLUGIN_ROOT}/bin/lib/worktree/remote-branch-collision.js'` to stderr, and the first `runSnippet` either throws on the non-zero exit or fails the one-JSON-line assertion.

- [ ] **Step 3: Edit the snippet's heredoc delimiters**

In `plugin/skills/build/adopted-branch-collision-check.md`, change the opening line's trailing `<<'EOF'` to `<<NODE_EVAL_EOF` (the rest of that line unchanged), and change the closing line `EOF` (the line immediately before the closing ```` ``` ```` fence of that block) to `NODE_EVAL_EOF`. No other line in the file changes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/adopted-branch-collision-snippet-fixture.test.js tests/adopted-branch-collision-prose-conformance.test.js tests/bin-lib/worktree/remote-branch-collision.test.js`
Expected: PASS (all tests in all three files).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/adopted-branch-collision-check.md tests/adopted-branch-collision-snippet-fixture.test.js
git commit -m "Unquote the adopted-branch collision check heredoc — the plugin root now expands, so the check no longer fails open (#3091)"
```
