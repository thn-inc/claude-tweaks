// tests/hooks-post-tool-use-closing-keyword.test.js
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const post = require('../plugin/bin/lib/hooks/post-tool-use');

// Every temp tree this file's tests create, removed once they have run.
const TMP_DIRS = [];
after(() => { for (const dir of TMP_DIRS) fs.rmSync(dir, { recursive: true, force: true }); });
const tmpDir = (prefix, { real = false } = {}) => {
  const made = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dir = real ? fs.realpathSync(made) : made;
  TMP_DIRS.push(dir);
  return dir;
};

function gitRepoWithMessage(message, dateOverride) {
  const dir = tmpDir('ct-ck-');
  execFileSync('git', ['-C', dir, 'init', '-q']);
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  if (dateOverride) {
    env.GIT_AUTHOR_DATE = dateOverride;
    env.GIT_COMMITTER_DATE = dateOverride;
  }
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', message, '-q'], { env });
  return fs.realpathSync(dir);
}

function runPostToolUse(repo, runDir = null) {
  return post.run({
    input: { tool_name: 'Bash', tool_input: { command: 'git commit -m "..."' }, cwd: repo },
    runDir,
    runState: null,
    cwd: repo,
  });
}

test('warns when a commit references an issue without a recognized closing keyword', () => {
  const repo = gitRepoWithMessage('Addresses #306, #305, #304 — bounded-concurrency fixes');
  const out = runPostToolUse(repo);
  assert.ok(out.json && typeof out.json.systemMessage === 'string', 'expected a systemMessage warning');
  assert.match(out.json.systemMessage, /closing keyword/i);
});

test('does not warn when the commit uses "Fixes"', () => {
  const repo = gitRepoWithMessage('Fixes #42');
  assert.deepStrictEqual(runPostToolUse(repo), {});
});

test('does not warn when the commit uses "Closes" or "Resolves" case-insensitively', () => {
  const repo1 = gitRepoWithMessage('closes #5');
  assert.deepStrictEqual(runPostToolUse(repo1), {});
  const repo2 = gitRepoWithMessage('RESOLVES #5');
  assert.deepStrictEqual(runPostToolUse(repo2), {});
});

test('does not warn when the commit has no issue reference at all', () => {
  const repo = gitRepoWithMessage('Just a normal commit with no issue mention');
  assert.deepStrictEqual(runPostToolUse(repo), {});
});

test('fires with no runDir set, unlike E2\'s breadcrumb logic', () => {
  const repo = gitRepoWithMessage('Addresses #7');
  const out = runPostToolUse(repo, null);
  assert.match(out.json.systemMessage, /closing keyword/i);
});

test('fires even when a runDir IS set (both checks run independently)', () => {
  const repo = gitRepoWithMessage('Addresses #7');
  const runDir = tmpDir('ct-ck-run-');
  const out = post.run({
    input: { tool_name: 'Bash', tool_input: { command: 'git commit -m "..."' }, cwd: repo },
    runDir, runState: { status: 'active' }, ownedRun: { dir: runDir, attribution: 'session' }, cwd: repo,
  });
  assert.match(out.json.systemMessage, /closing keyword/i);
  // E2's breadcrumb still logs independently, unaffected by the new check:
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(events[0].type, 'commit');
});

test('does not warn when the Bash command is not a git commit', () => {
  const repo = gitRepoWithMessage('Addresses #7'); // real repo state irrelevant — command isn't a commit
  const out = post.run({
    input: { tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: repo },
    runDir: null, runState: null, cwd: repo,
  });
  assert.deepStrictEqual(out, {});
});

test('warns on a comma-separated trailing ref with no keyword of its own ("Fixes #100, #200" only closes #100)', () => {
  // GitHub requires the keyword immediately before EACH ref it closes; a bare trailing
  // ref after a comma is a well-known gotcha this check exists to catch — the naive
  // "does a keyword appear anywhere in the lookback window" check would wrongly treat
  // #200 as closed here, since "Fixes #100" sits within the window before it.
  const repo = gitRepoWithMessage('Fixes #100, #200');
  const out = runPostToolUse(repo);
  assert.match(out.json.systemMessage, /closing keyword/i);
});

test('does not warn when every ref has its own keyword ("Fixes #100, fixes #200")', () => {
  const repo = gitRepoWithMessage('Fixes #100, fixes #200');
  assert.deepStrictEqual(runPostToolUse(repo), {});
});

test('does not warn when the same issue is cited twice, once bare and once with a keyword (finding 1 regression)', () => {
  // A repeated identical ref used to break the "before" slice: message.indexOf(ref)
  // always resolves to the FIRST occurrence, so both the bare mention and the
  // properly-closed mention were tested against the same (bare) slice, producing
  // a false "unclosed" warning even though the issue is legitimately closed.
  const repo = gitRepoWithMessage('See #100 for context. Fixes #100.');
  assert.deepStrictEqual(runPostToolUse(repo), {});
});

test('warns when a word merely ENDS in a closing-keyword suffix, glued to a disqualifying prefix, with a long gap before the ref (fixed-lookback-window regression)', () => {
  // "unresolved" ends in "resolved" (a recognized keyword), and enough
  // whitespace separates it from the ref that a fixed 20-char lookback
  // window slices the "un" prefix off entirely — leaving just "resolved"
  // at the very start of the truncated slice, where JS regex's \b wrongly
  // treats that truncation point as a real word boundary. The real message
  // has no genuine closing keyword here at all.
  const repo = gitRepoWithMessage('This is unresolved            #123');
  const out = runPostToolUse(repo);
  assert.ok(out.json && typeof out.json.systemMessage === 'string', 'expected a systemMessage warning — "unresolved" is not a real closing keyword');
  assert.match(out.json.systemMessage, /closing keyword/i);
});

test('two real commits to the SAME dir in one Bash invocation are each evaluated on their OWN message, not both against current HEAD (finding regression)', () => {
  // Previously, checkClosingKeyword re-read `git log -1` for EVERY
  // commit-action target sharing a dir — always returning the SAME
  // (current-HEAD, i.e. the LAST) commit's message. An earlier commit in
  // the same compound command with its own unclosed ref was never actually
  // evaluated at all.
  const repo = gitRepoWithMessage('Addresses #100 — no closing keyword'); // the OLDER commit
  execFileSync('git', ['-C', repo, 'commit', '--allow-empty', '-q', '-m', 'Fixes #200'], {
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  }); // the NEWER commit — fully closes its own ref, but must not mask the older one's
  const out = post.run({
    input: { tool_name: 'Bash', tool_input: { command: 'git commit -m "a" && git commit --allow-empty -m "b"' }, cwd: repo },
    runDir: null, runState: null, cwd: repo,
  });
  assert.ok(out.json && typeof out.json.systemMessage === 'string',
    'the older commit (#100, no closing keyword) must still be caught even though the newer commit in the same invocation properly closes its own ref');
  assert.match(out.json.systemMessage, /closing keyword/i);
});

// #4303: past the shell scanner's cwd cap the walk has lost the cwd bash is in, so the git
// command's dir is only the walk's start (marked `lost`). From a worktree nested at M/.claude/worktrees/x,
// with no worktree-always policy, `G20 cd ../../..; git commit -qm "work on #12"` (20 groups
// `{ cd /tmp/ct-4303-nK; }`, every cd failing): bash 3.2 and 5 commit in M. Base d9aa6b82d read M's
// commit and warned; an earlier revision of this branch read the worktree's HEAD and missed it.
// A lost commit target is now looked for in every candidate checkout. The fixture makes the commit
// bash makes (the hook runs after it); the init commit is old, so only that one is fresh.
const groups4303 = (n) => Array.from({ length: n }, (_, i) => `{ cd /tmp/ct-4303-n${i}; }; `).join('');
test('#4303: a commit past the cwd cap that lands in the main checkout is still checked for a closing keyword', () => {
  const main = gitRepoWithMessage('init', '2020-01-01T00:00:00');
  const wt = path.join(main, '.claude', 'worktrees', 'x');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt]);
  execFileSync('git', ['-C', main, 'commit', '--allow-empty', '-qm', 'work on #12'], {
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
  const out = post.run({
    input: { tool_name: 'Bash', tool_input: { command: `${groups4303(20)}cd ../../..; git commit --allow-empty -qm "work on #12"` }, cwd: wt },
    runDir: null, runState: null, cwd: wt,
  });
  assert.ok(out.json && typeof out.json.systemMessage === 'string', 'expected the closing-keyword warning');
  assert.match(out.json.systemMessage, /closing keyword/i);
});

// #4303: the candidates include every worktree of the main checkout, since the lost cwd may have
// been any of them. From the main checkout, 16 `cd /tmp/ct-4303-aK &&` (every aK present, each cd
// succeeding), then `cd wt/sub; git commit -qm "work on #12"`: bash 3.2 and 5 commit in the nested
// worktree wt. The list's end joins past the cap and drops the absolute `cd`, so the walk's start
// (the main checkout) is the only path it has. Base d9aa6b82d warns; earlier revisions of this
// branch missed it. Skipped on win32: the command splices the native temp path.
test('#4303: a commit past the cwd cap that lands in a linked worktree is still checked for a closing keyword', {
  skip: process.platform === 'win32' && 'win32: the command splices a native temp path, whose backslashes the scanner reads as escapes',
}, () => {
  const main = gitRepoWithMessage('init', '2020-01-01T00:00:00');
  const wt = path.join(main, '.claude', 'worktrees', 'x');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt]);
  execFileSync('git', ['-C', wt, 'commit', '--allow-empty', '-qm', 'work on #12'], {
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
  const chain = Array.from({ length: 16 }, (_, i) => `cd /tmp/ct-4303-a${i + 1} && `).join('');
  const out = post.run({
    input: { tool_name: 'Bash', tool_input: { command: `${chain}cd ${wt}/sub; git commit --allow-empty -qm "work on #12"` }, cwd: main },
    runDir: null, runState: null, cwd: main,
  });
  assert.ok(out.json && typeof out.json.systemMessage === 'string', 'expected the closing-keyword warning');
  assert.match(out.json.systemMessage, /closing keyword/i);
});

// #4303: only the command's own commit is judged. A second worktree w2 holds a fresh commit
// "sibling work on #99" (another session's, within the freshness window), and from wt
// `G20 git commit -qm "Fixes #12"` (every cd failing): bash 3.2 and 5 commit "Fixes #12" in wt.
// An earlier revision of this branch judged every candidate's fresh commits and warned about w2's;
// base d9aa6b82d judged wt's alone and did not. The lost commit is matched to the fresh
// commit whose subject is its own `-m` text (wt's), so w2's is never judged.
test('#4303: a commit past the cwd cap is not warned about for another checkout\'s fresh commit', () => {
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const main = gitRepoWithMessage('init', '2020-01-01T00:00:00');
  const wt = path.join(main, '.claude', 'worktrees', 'x');
  const w2 = path.join(main, '.claude', 'worktrees', 'y');
  for (const w of [wt, w2]) execFileSync('git', ['-C', main, 'worktree', 'add', '-q', w]);
  execFileSync('git', ['-C', w2, 'commit', '--allow-empty', '-qm', 'sibling work on #99'], { env });
  execFileSync('git', ['-C', wt, 'commit', '--allow-empty', '-qm', 'Fixes #12'], { env });
  const out = post.run({
    input: { tool_name: 'Bash', tool_input: { command: `${groups4303(20)}git commit --allow-empty -qm "Fixes #12"` }, cwd: wt },
    runDir: null, runState: null, cwd: wt,
  });
  assert.ok(!(out.json && /closing keyword/i.test(String(out.json.systemMessage))), JSON.stringify(out));
});

// #4303: from a cwd outside any repo there is no main checkout to look in, but the cwds the
// collapse dropped name one. 16 `cd /tmp/ct-4303-aK &&` (every aK present, each cd succeeding),
// then `cd wt/sub; git commit -qm "work on #12"`: bash 3.2 and 5 commit in the nested worktree wt.
// The list's end joins past the cap. Earlier revisions of this branch missed the warning (one of
// them denied the command outright, citing a policy no repo here has); base d9aa6b82d warns. The
// && chain is the walk's own branching (base took every cd to succeed and never collapsed there),
// so base's own reading of the command names wt/sub, and the lost commit is looked for in its
// checkout too. wt/sub exists, as it does for bash. Skipped on win32: the command splices the
// native temp path.
test('#4303: a commit past the cwd cap from outside any repo is still checked in the checkout the collapse dropped', {
  skip: process.platform === 'win32' && 'win32: the command splices a native temp path, whose backslashes the scanner reads as escapes',
}, () => {
  const main = gitRepoWithMessage('init', '2020-01-01T00:00:00');
  const wt = path.join(main, '.claude', 'worktrees', 'x');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt]);
  fs.mkdirSync(path.join(wt, 'sub'));
  execFileSync('git', ['-C', wt, 'commit', '--allow-empty', '-qm', 'work on #12'], {
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
  const outside = tmpDir('ct-4303-out-', { real: true });
  const chain = Array.from({ length: 16 }, (_, i) => `cd /tmp/ct-4303-a${i + 1} && `).join('');
  const out = post.run({
    input: { tool_name: 'Bash', tool_input: { command: `${chain}cd ${wt}/sub; git commit --allow-empty -qm "work on #12"` }, cwd: outside },
    runDir: null, runState: null, cwd: outside,
  });
  assert.ok(out.json && typeof out.json.systemMessage === 'string', 'expected the closing-keyword warning');
  assert.match(out.json.systemMessage, /closing keyword/i);
});

// #4303: the same with the other session's commit in the main checkout, which the candidate list
// names before the worktrees. From x, `G20 cd ../y; git commit -qm "Fixes #12"`: bash 3.2 and 5
// commit "Fixes #12" in y, while M holds a fresh "other session on #99". An earlier revision of this
// branch warned about M's; base d9aa6b82d did not.
test('#4303: a commit past the cwd cap is not warned about for the main checkout\'s fresh commit either', () => {
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const main = gitRepoWithMessage('init', '2020-01-01T00:00:00');
  const wt = path.join(main, '.claude', 'worktrees', 'x');
  const w2 = path.join(main, '.claude', 'worktrees', 'y');
  for (const w of [wt, w2]) execFileSync('git', ['-C', main, 'worktree', 'add', '-q', w]);
  execFileSync('git', ['-C', main, 'commit', '--allow-empty', '-qm', 'other session on #99'], { env });
  execFileSync('git', ['-C', w2, 'commit', '--allow-empty', '-qm', 'Fixes #12'], { env });
  const out = post.run({
    input: { tool_name: 'Bash', tool_input: { command: `${groups4303(20)}cd ../y; git commit --allow-empty -qm "Fixes #12"` }, cwd: wt },
    runDir: null, runState: null, cwd: wt,
  });
  assert.ok(!(out.json && /closing keyword/i.test(String(out.json.systemMessage))), JSON.stringify(out));
});

// #4303: the same when this command's own commit does not land. From wt (nested at
// M/.claude/worktrees/x), `G20 git commit -qm "Fixes #12"` with nothing staged: bash 3.2 and 5 make
// no commit anywhere. w2 or the main checkout holds another session's fresh
// "… on #99", the one fresh commit the candidates offer. Earlier revisions of this branch took it
// for this command's, warned about it and logged it as this command's breadcrumb; base d9aa6b82d
// did neither. Its subject is not this command's `-m` text, so it is neither judged nor logged.
for (const [holder, otherAt] of [['another worktree', 'w2'], ['the main checkout', 'main']]) {
  test(`#4303: a commit past the cwd cap that does not land is not matched to a fresh commit of another session in ${holder}`, () => {
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
    const main = gitRepoWithMessage('init', '2020-01-01T00:00:00');
    const wt = path.join(main, '.claude', 'worktrees', 'x');
    const w2 = path.join(main, '.claude', 'worktrees', 'y');
    for (const w of [wt, w2]) execFileSync('git', ['-C', main, 'worktree', 'add', '-q', w]);
    const other = otherAt === 'w2' ? w2 : main;
    execFileSync('git', ['-C', other, 'commit', '--allow-empty', '-qm', 'other session on #99'], { env });
    const runDir = tmpDir('ct-4303-run-');
    const out = post.run({
      input: { tool_name: 'Bash', tool_input: { command: `${groups4303(20)}git commit -qm "Fixes #12"` }, cwd: wt },
      runDir, runState: { status: 'active' }, ownedRun: { dir: runDir, attribution: 'session' }, cwd: wt,
    });
    assert.ok(!(out.json && /closing keyword/i.test(String(out.json.systemMessage))), JSON.stringify(out));
    let events = [];
    try { events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { /* none logged */ }
    const dirs = events.filter((e) => e.type === 'commit').map((e) => path.resolve(e.dir));
    assert.ok(![wt, w2, main].some((d) => dirs.includes(d)), JSON.stringify(dirs));
  });
}

// #4303: two checkouts offering a fresh commit with the command's own subject leave which one is
// this command's unknowable. From wt (nested at M/.claude/worktrees/x), w2 holding another session's
// fresh "work on #12" and `G20 cd ../../..; git commit -qm "work on #12"`: bash 3.2 and 5 commit in
// M. An earlier revision of this branch took neither commit (two offered) but logged wt's HEAD, the
// walk's start, as this command's breadcrumb; a target that took the first offer would log w2's commit. Neither checkout is
// logged.
test('#4303: a commit past the cwd cap whose subject two checkouts offer logs neither', () => {
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const main = gitRepoWithMessage('init', '2020-01-01T00:00:00');
  const wt = path.join(main, '.claude', 'worktrees', 'x');
  const w2 = path.join(main, '.claude', 'worktrees', 'y');
  for (const w of [wt, w2]) execFileSync('git', ['-C', main, 'worktree', 'add', '-q', w]);
  // w2's commit sits on a commit of its own, so the two are not one object.
  execFileSync('git', ['-C', w2, 'commit', '--allow-empty', '-qm', 'other session'], { env });
  for (const d of [w2, main]) execFileSync('git', ['-C', d, 'commit', '--allow-empty', '-qm', 'work on #12'], { env });
  const runDir = tmpDir('ct-4303-run-');
  post.run({
    input: { tool_name: 'Bash', tool_input: { command: `${groups4303(20)}cd ../../..; git commit --allow-empty -qm "work on #12"` }, cwd: wt },
    runDir, runState: { status: 'active' }, ownedRun: { dir: runDir, attribution: 'session' }, cwd: wt,
  });
  let events = [];
  try { events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { /* none logged */ }
  const dirs = events.filter((e) => e.type === 'commit').map((e) => path.resolve(e.dir));
  assert.ok(![wt, w2, main].some((d) => dirs.includes(d)), JSON.stringify(dirs));
});

// #4303: with no `-m` text to match (`-F`), the lost commit takes a fresh commit only when the
// candidates offer exactly one. From wt (nested at M/.claude/worktrees/x), with M/msg holding
// "work on #12", `G20 cd ../../..; git commit -qF msg`: bash 3.2 and 5 commit "work on #12" in M,
// and base d9aa6b82d warns (an earlier revision of this branch did not).
test('#4303: a commit past the cwd cap whose message is read from a file is still checked', () => {
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const main = gitRepoWithMessage('init', '2020-01-01T00:00:00');
  const wt = path.join(main, '.claude', 'worktrees', 'x');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt]);
  execFileSync('git', ['-C', main, 'commit', '--allow-empty', '-qm', 'work on #12'], { env });
  const out = post.run({
    input: { tool_name: 'Bash', tool_input: { command: `${groups4303(20)}cd ../../..; git commit --allow-empty -qF msg` }, cwd: wt },
    runDir: null, runState: null, cwd: wt,
  });
  assert.ok(out.json && /closing keyword/i.test(String(out.json.systemMessage)), JSON.stringify(out));
});

// #4303: a lost commit is also looked for where base's reading (the scanner marks it `reading: true`)
// puts it. From a cwd beside a main checkout and its linked worktree wt,
// `G16 git -C ../wt commit -qm "work on #12"` (every cd failing): bash 3.2 and 5 commit in wt.
// Earlier revisions of this branch missed the warning (no checkout above the cwd to look in); base
// d9aa6b82d warns.
test('#4303: a commit past the cwd cap behind a relative git -C is checked where base reads it', () => {
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const parent = tmpDir('ct-4303-p3-', { real: true });
  const main = path.join(parent, 'main');
  fs.mkdirSync(main);
  execFileSync('git', ['-C', main, 'init', '-q']);
  execFileSync('git', ['-C', main, 'commit', '--allow-empty', '-qm', 'init'], { env: { ...env, GIT_AUTHOR_DATE: '2020-01-01T00:00:00', GIT_COMMITTER_DATE: '2020-01-01T00:00:00' } });
  const wt = path.join(parent, 'wt');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt]);
  execFileSync('git', ['-C', wt, 'commit', '--allow-empty', '-qm', 'work on #12'], { env });
  const outside = path.join(parent, 'a0');
  fs.mkdirSync(outside);
  const out = post.run({
    input: { tool_name: 'Bash', tool_input: { command: `${groups4303(16)}git -C ../wt commit --allow-empty -qm "work on #12"` }, cwd: outside },
    runDir: null, runState: null, cwd: outside,
  });
  assert.ok(out.json && /closing keyword/i.test(String(out.json.systemMessage)), JSON.stringify(out));
});

// #4303: a lost commit's candidates can name one checkout twice (the session cwd wt/sub and wt from
// `git worktree list`); one commit offered by both is one commit, not two. From wt/sub,
// `G20 git commit -qm "work on #12"`: bash 3.2 and 5 commit in wt, and every version warns.
test('#4303: a commit past the cwd cap from a subdirectory of the worktree is still checked', () => {
  const main = gitRepoWithMessage('init', '2020-01-01T00:00:00');
  const wt = path.join(main, '.claude', 'worktrees', 'x');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt]);
  fs.mkdirSync(path.join(wt, 'sub'));
  execFileSync('git', ['-C', wt, 'commit', '--allow-empty', '-qm', 'work on #12'], {
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
  const cwd = path.join(wt, 'sub');
  const out = post.run({ input: { tool_name: 'Bash', tool_input: { command: `${groups4303(20)}git commit --allow-empty -qm "work on #12"` }, cwd }, runDir: null, runState: null, cwd });
  assert.ok(out.json && /closing keyword/i.test(String(out.json.systemMessage)), JSON.stringify(out));
});

// #4303: a commit another target in the command already holds is not offered to a lost one. From a
// worktree nested at M/.claude/worktrees/x, `git commit -qm a; G20 cd ../../..; git commit -qm
// "work on #12"`: bash 3.2 and 5 commit `a` in x and "work on #12" in M, both fresh. The lost commit
// is M's alone, and base d9aa6b82d warns (an earlier revision of this branch did not).
test('#4303: a commit past the cwd cap is checked even beside the command\'s own earlier commit', () => {
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const main = gitRepoWithMessage('init', '2020-01-01T00:00:00');
  const wt = path.join(main, '.claude', 'worktrees', 'x');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt]);
  execFileSync('git', ['-C', wt, 'commit', '--allow-empty', '-qm', 'a'], { env });
  execFileSync('git', ['-C', main, 'commit', '--allow-empty', '-qm', 'work on #12'], { env });
  const out = post.run({
    input: { tool_name: 'Bash', tool_input: { command: `git commit --allow-empty -qm a; ${groups4303(20)}cd ../../..; git commit --allow-empty -qm "work on #12"` }, cwd: wt },
    runDir: null, runState: null, cwd: wt,
  });
  assert.ok(out.json && /closing keyword/i.test(String(out.json.systemMessage)), JSON.stringify(out));
});

test('does not evaluate a stale HEAD left over from a git commit that never landed (finding 2 regression)', () => {
  // Simulates a rejected/failed `git commit` attempt: PostToolUse still fires, but
  // HEAD is an old, unrelated commit rather than anything the just-attempted Bash
  // command actually created. Without a freshness check, reading this stale HEAD
  // back (message has a bare ref, no closing keyword) would fire a warning that's
  // misattributed to the current tool call.
  const repo = gitRepoWithMessage('Addresses #999 — old, unrelated commit', '2020-01-01T00:00:00');
  assert.deepStrictEqual(runPostToolUse(repo), {});
});
