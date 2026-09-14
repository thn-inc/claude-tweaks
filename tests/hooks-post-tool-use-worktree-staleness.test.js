// tests/hooks-post-tool-use-worktree-staleness.test.js
//
// #307's EnterWorktree staleness backstop: after a worktree is created/entered,
// warn (warn tier) if it's already behind the resolved integration branch's
// `origin/{branch}`, and log distinctly whether the check ran clean, found
// staleness, or could not run at all (a fetch/rev-list failure).
//
// Fixtures use real git repos on disk (this module's own established
// convention — see hooks-post-tool-use-plugin-version-bump.test.js and
// hooks-worktree-reap.test.js), never a real invocation of the EnterWorktree
// tool itself or live `git worktree list --porcelain` output: the tool
// result's shape and the porcelain lock-reason format are both unversioned
// implementation details this plugin doesn't own (#307's Gotchas, [IL-80]).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { execFileSync } = cp;
const post = require('../plugin/bin/lib/hooks/post-tool-use');
const { gitRepo, harnessWorktreeOf } = require('./helpers/git-fixtures');

// gitRepo() runs a bare `git init`, so the initial branch name depends on the
// machine's init.defaultBranch — resolve it rather than hardcoding "main".
const defaultBranch = (repo) =>
  execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

// A repo with `integration-branch:` pinned in policy.yml (so resolution does
// not depend on `origin/HEAD` wiring) and, optionally, a self-referencing
// `origin` remote — a linked worktree shares the main checkout's `.git`
// config, so a remote added at the main checkout is visible from any
// worktree of that same repo too. Omitting the remote is the fixture for
// "the fetch itself fails" (no such remote).
function setupProject({ withOrigin = true } = {}) {
  const main = gitRepo();
  const base = defaultBranch(main);
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), `integration-branch: ${base}\n`);
  execFileSync('git', ['add', '.claude-tweaks/policy.yml'], { cwd: main });
  execFileSync('git', ['commit', '-q', '-m', 'add policy'], { cwd: main });
  if (withOrigin) execFileSync('git', ['remote', 'add', 'origin', main], { cwd: main });
  return { main, base };
}

// Advances `main`'s own current branch by `n` commits, directly in the main
// checkout — creating a worktree via harnessWorktreeOf() does not move the
// main checkout off whatever branch it already has checked out.
function advance(main, n) {
  for (let i = 0; i < n; i += 1) {
    fs.writeFileSync(path.join(main, `advance-${i}.txt`), 'x');
    execFileSync('git', ['add', `advance-${i}.txt`], { cwd: main });
    execFileSync('git', ['commit', '-q', '-m', `advance ${i}`], { cwd: main });
  }
}

function enterWorktreeCtx(wt, { toolResponse, ownedRun, platform } = {}) {
  const input = { tool_name: 'EnterWorktree', cwd: wt };
  if (toolResponse !== undefined) input.tool_response = toolResponse;
  const ctx = { input, cwd: wt, ownedRun };
  if (platform !== undefined) ctx.platform = platform;
  return ctx;
}

function createdAt(wt, branch) {
  return {
    content: `Created worktree at ${wt} on branch ${branch}. The session is now working in the ` +
      'worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.',
  };
}

function readEvents(runDir) {
  const raw = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
  return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('warns with the commit count and a pointer to worktree-setup.md when the worktree is behind', () => {
  const { main, base } = setupProject();
  const wt = harnessWorktreeOf(main);
  advance(main, 3);
  const out = post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt, `wt-branch-${path.basename(wt)}`) }));
  assert.ok(out.json && typeof out.json.systemMessage === 'string', 'expected a systemMessage warning');
  assert.match(out.json.systemMessage, /\b3\b/);
  assert.match(out.json.systemMessage, /skills\/_shared\/worktree-setup\.md/);
  assert.match(out.json.systemMessage, new RegExp(`origin/${base}`));
});

// #1464: none of this file's other fixtures exercise resolveIntegrationBranch's
// other fallback rank — a project with no `integration-branch:` pinned in
// policy.yml relies entirely on `origin/HEAD` resolving offline. Deliberately
// does NOT use setupProject() (every one of its callers pins the policy value),
// and explicitly runs `git remote set-head origin -a` — adding the remote alone
// does not set origin/HEAD, so omitting this step would silently fall through to
// the "no integration branch resolved" no-op path and this test would prove
// nothing.
test('falls back to origin/HEAD resolution when no integration-branch policy is pinned', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  execFileSync('git', ['remote', 'add', 'origin', main], { cwd: main });
  // `set-head -a` auto-detects via the remote's own advertised HEAD, but only
  // once refs/remotes/origin/* actually exist locally — a bare `remote add`
  // does not fetch, so `-a` alone fails with "Not a valid ref" here.
  execFileSync('git', ['fetch', 'origin'], { cwd: main });
  execFileSync('git', ['remote', 'set-head', 'origin', '-a'], { cwd: main });
  const wt = harnessWorktreeOf(main);
  advance(main, 3);
  const out = post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt, `wt-branch-${path.basename(wt)}`) }));
  assert.ok(out.json && typeof out.json.systemMessage === 'string', 'expected a systemMessage warning via the origin/HEAD fallback');
  assert.match(out.json.systemMessage, /\b3\b/);
  assert.match(out.json.systemMessage, new RegExp(`origin/${base}`));
});

test('does not warn when the worktree is not behind', () => {
  const { main } = setupProject();
  const wt = harnessWorktreeOf(main);
  const out = post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt, `wt-branch-${path.basename(wt)}`) }));
  assert.deepStrictEqual(out, {});
});

test('falls back to `git worktree list --porcelain` when the tool result does not expose the path', () => {
  const { main } = setupProject();
  const wt = harnessWorktreeOf(main);
  advance(main, 2);
  // Tool result missing entirely, and a malformed one, both take the
  // fallback path — resolveCreatedWorktreePath must not throw on either.
  const outMissing = post.run(enterWorktreeCtx(wt));
  assert.ok(outMissing.json && typeof outMissing.json.systemMessage === 'string');
  assert.match(outMissing.json.systemMessage, /\b2\b/);

  const outMalformed = post.run(enterWorktreeCtx(wt, { toolResponse: { content: 'not the expected shape at all' } }));
  assert.ok(outMalformed.json && typeof outMalformed.json.systemMessage === 'string');
  assert.match(outMalformed.json.systemMessage, /\b2\b/);
});

test('recognizes "Entered worktree at" (an existing worktree), not only "Created worktree at"', () => {
  const { main } = setupProject();
  const wt = harnessWorktreeOf(main);
  advance(main, 1);
  const toolResponse = { content: `Entered worktree at ${wt} on branch whatever. The session is now working in the worktree.` };
  // ctx.cwd is deliberately NOT `wt` here (unlike every other test in this
  // file) — the `git worktree list --porcelain` fallback matches on cwd, so
  // if this test used cwd === wt, a broken "Entered" regex would still pass
  // via the fallback and this test would prove nothing. Pointing cwd at
  // `main` instead means the ONLY way to resolve `wt` is the primary
  // tool-result parse actually recognizing "Entered worktree at".
  const input = { tool_name: 'EnterWorktree', cwd: main, tool_response: toolResponse };
  const out = post.run({ input, cwd: main });
  assert.ok(out.json && typeof out.json.systemMessage === 'string');
  assert.match(out.json.systemMessage, /\b1\b/);
});

test('does not fire for a tool other than EnterWorktree', () => {
  const { main } = setupProject();
  const wt = harnessWorktreeOf(main);
  advance(main, 5);
  const out = post.run({ input: { tool_name: 'ExitWorktree', cwd: wt }, cwd: wt });
  assert.deepStrictEqual(out, {});
});

test('logs "clean" (not silently identical to a fetch failure) when the worktree is not behind', () => {
  const { main } = setupProject();
  const wt = harnessWorktreeOf(main);
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wts-run-'));
  post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt, 'x'), ownedRun: { dir: runDir } }));
  const events = readEvents(runDir).filter((e) => e.type === 'worktree-staleness');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].result, 'clean');
});

test('emits no warning but a distinct log entry when the fetch fails (no such remote)', () => {
  const { main } = setupProject({ withOrigin: false });
  const wt = harnessWorktreeOf(main);
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wts-run-'));
  const out = post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt, 'x'), ownedRun: { dir: runDir } }));
  assert.deepStrictEqual(out, {}, 'a fetch failure must never produce a warn message');
  const events = readEvents(runDir).filter((e) => e.type === 'worktree-staleness');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].result, 'check-failed');
  // The acceptance criterion this exists for: a reader of events.jsonl can
  // tell "checked, clean" apart from "check didn't run" — not just by
  // reading two different fixtures' logs in isolation, but by the field
  // value itself differing.
  assert.notStrictEqual(events[0].result, 'clean');
});

test('does not execute an injected --upload-pack value when integration-branch starts with `-` (argument-injection guard)', () => {
  // integration-branch: is hand-editable policy.yml content parsed by a regex
  // that doesn't reject a leading `-` (bin/lib/policy.js). A bare positional
  // git arg starting with `-` is parsed as an option, not a refspec, over
  // local-path/ssh transports — `--upload-pack=<program>` runs <program> as a
  // subprocess DURING the fetch attempt even though the fetch as a whole
  // still ends up failing (the substituted program doesn't speak the real
  // git pack protocol, so the handshake fails after the program already ran).
  // A test asserting only the logged outcome ('check-failed') does not
  // discriminate — that outcome is identical whether or not the injected
  // program actually executed. This test instead checks for the side effect
  // itself: does the injected program run at all?
  const { main } = setupProject();
  const markerFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wts-marker-')), 'ran.txt');
  const markerScript = path.join(path.dirname(markerFile), 'marker.sh');
  fs.writeFileSync(markerScript, `#!/bin/sh\ntouch ${markerFile}\n`);
  fs.chmodSync(markerScript, 0o755);
  // Must be committed, not just written — harnessWorktreeOf() below checks
  // out a fresh worktree from main's current commit, which would otherwise
  // still see setupProject()'s original, harmless policy.yml.
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), `integration-branch: --upload-pack=${markerScript}\n`);
  execFileSync('git', ['commit', '-q', '-am', 'poison policy.yml'], { cwd: main });
  const wt = harnessWorktreeOf(main);
  post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt, 'x') }));
  assert.ok(!fs.existsSync(markerFile), 'the injected --upload-pack program must never actually run');
});

// Not a discrimination test (IL-105's own bar): every layer this reaches —
// resolveIntegrationBranch's null-repoRoot guard, runGit's own try/catch
// around execFileSync, checkWorktreeStaleness's own try/catch — already
// fails open independently, so this input cannot be made to fail by
// reverting any single one of them. Kept anyway as a literal instance of
// this file's Deliverable 4 ("fail open on any error... never throw"),
// exercised end-to-end via post.run() rather than asserted only in prose.
test('an unusable cwd (no tool result, no resolvable worktree) never throws — returns {} rather than crashing', () => {
  const out = post.run({ input: { tool_name: 'EnterWorktree', cwd: '/this/path/does/not/exist/at/all' } });
  assert.deepStrictEqual(out, {});
});

// #1782: proactive core.longpaths nudge — win32 only, before the staleness
// fetch. Platform is injected via ctx.platform (this module's existing
// per-call ctx seam, extended with one field — there was no other
// deps-injection seam in this file to reuse) rather than stubbing
// process.platform, which is process-global and would leak across tests.
test('warns on win32 when core.longpaths is unset', () => {
  const { main } = setupProject();
  const wt = harnessWorktreeOf(main);
  const out = post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt, 'x'), platform: 'win32' }));
  assert.ok(out.json && typeof out.json.systemMessage === 'string', 'expected a core.longpaths warning');
  assert.match(out.json.systemMessage, /core\.longpaths/);
  assert.match(out.json.systemMessage, /_shared\/worktree-setup\.md/);
});

test('does not warn on win32 when core.longpaths is already true', () => {
  const { main } = setupProject();
  // Linked worktrees share the main checkout's .git/config, so setting it via
  // the main checkout is visible from the worktree created below.
  execFileSync('git', ['config', 'core.longpaths', 'true'], { cwd: main });
  const wt = harnessWorktreeOf(main);
  const out = post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt, 'x'), platform: 'win32' }));
  assert.deepStrictEqual(out, {}, 'core.longpaths already true — no nudge, and the worktree is not stale either');
});

test('does not fire on darwin or linux, even with core.longpaths unset', () => {
  const { main } = setupProject();
  const wt = harnessWorktreeOf(main);
  for (const platform of ['darwin', 'linux']) {
    const out = post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt, 'x'), platform }));
    assert.deepStrictEqual(out, {}, `platform ${platform} must never see the win32-only nudge`);
  }
});

test('never writes git config — only a read-only `config --get` reaches the exec seam on win32', (t) => {
  const { main } = setupProject();
  const wt = harnessWorktreeOf(main);
  const realExecFileSync = cp.execFileSync;
  const configCalls = [];
  t.mock.method(cp, 'execFileSync', (cmd, args, opts) => {
    if (cmd === 'git' && Array.isArray(args) && args.includes('config')) configCalls.push(args);
    return realExecFileSync(cmd, args, opts);
  });
  post.run(enterWorktreeCtx(wt, { toolResponse: createdAt(wt, 'x'), platform: 'win32' }));
  assert.ok(configCalls.length > 0, 'expected at least one `git config` read call');
  for (const args of configCalls) {
    assert.ok(args.includes('--get'), `every config call must be a --get read, never a set: ${args.join(' ')}`);
    assert.ok(!args.includes('true') && !args.includes('false'), `no config call may pass a value to set: ${args.join(' ')}`);
  }
});
