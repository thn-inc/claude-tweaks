'use strict';
// learned-skills-pr land + stage (#5290): captured patches ride one plumbing commit each onto
// learned-skills/{run-id} behind a ready, never-armed PR; anything that cannot ride is staged.
// Real git against a bare origin; `gh` is a fake that records argv + stdin and throws on anything unhandled.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { capture, readManifest, realDeps } = require('../../../plugin/bin/lib/learned-skills/learned-skills.js');
const { land, stage } = require('../../../plugin/bin/lib/learned-skills/land.js');
const cli = require('../../../plugin/bin/learned-skills-pr.js');

// land's plumbing calls inherit process.env (the temp index rides GIT_INDEX_FILE added on top of it).
Object.assign(process.env, {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
});

const X = '.claude/skills/x/SKILL.md';
const Z = '.claude/skills/z/SKILL.md';
const BODY = '# s\n\nline one\nline two\nline three\nline four\nline five\nline six\nline seven\n';
const RUN_ID = '2026-11-13T000000-spec-1';
const BRANCH = `learned-skills/${RUN_ID}`;
const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);

function sh(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}
function write(repo, rel, text) {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
}

// origin (bare) + a clone with main pushed, two skill files, a run dir, and one captured patch per file.
function fixture(t, { capturedTargets = [X, Z] } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-land-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'wt');
  sh(root, ['init', '-q', '--bare', '-b', 'main', origin]);
  fs.mkdirSync(repo);
  sh(repo, ['init', '-q', '-b', 'main']);
  sh(repo, ['remote', 'add', 'origin', origin]);
  write(repo, X, BODY.replace('# s', '# x'));
  write(repo, Z, BODY.replace('# s', '# z'));
  sh(repo, ['add', '-A']);
  sh(repo, ['commit', '-q', '-m', 'base']);
  sh(repo, ['push', '-q', 'origin', 'main']);
  const runDir = path.join(repo, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  const mergeBase = sh(repo, ['rev-parse', 'HEAD']).trim();
  const f = { root, origin, repo, runDir, mergeBase, mainTip: mergeBase };
  for (const target of capturedTargets) {
    write(repo, target, fs.readFileSync(path.join(repo, target), 'utf8') + `learned: note for ${path.basename(path.dirname(target))}\n`);
    const res = capture({ runDir, worktree: repo, mergeBase, target, summary: 'adds a note' }, { now: () => NOW });
    assert.equal(res.route, 'captured');
  }
  return f;
}

// A gh fake. State: the open PR list. Throws on any argv it does not handle.
function fakeGh({ prs = [], createThrows = null } = {}) {
  const calls = [];
  const state = { prs: [...prs] };
  const gh = (args, input) => {
    calls.push({ args, input });
    if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(state.prs);
    if (args[0] === 'pr' && args[1] === 'create') {
      if (createThrows) throw new Error(createThrows);
      state.prs = [{ number: 77, url: 'https://github.com/o/r/pull/77', state: 'OPEN' }];
      return 'https://github.com/o/r/pull/77\n';
    }
    throw new Error('unexpected ' + args.join(' '));
  };
  return { calls, state, gh };
}

function deps(gh) {
  const gitCalls = [];
  return {
    gitCalls,
    deps: {
      gh,
      now: () => NOW,
      git: (args, opts) => { gitCalls.push({ args, opts }); return realDeps.git(args, opts); },
    },
  };
}

const landArgs = (f, extra = {}) => ({
  runDir: f.runDir, worktree: f.repo, record: 5290, integrationBranch: 'main', mergeBase: f.mergeBase, ...extra,
});
const remoteBranch = (f) => sh(f.repo, ['ls-remote', 'origin', `refs/heads/${BRANCH}`]).trim().split(/\s+/)[0] || null;
const decisions = (f) => fs.readFileSync(path.join(f.runDir, 'decisions.md'), 'utf8');
const pushes = (gitCalls) => gitCalls.filter((c) => c.args.includes('push'));

test('lands one commit per patch on learned-skills/{run-id}', (t) => {
  const f = fixture(t);
  const headBefore = sh(f.repo, ['rev-parse', 'HEAD']).trim();
  const gh = fakeGh();
  const { deps: d } = deps(gh.gh);
  const res = land(landArgs(f), d);

  const sha = remoteBranch(f);
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(res.branch, BRANCH);
  assert.equal(res.landed.length, 2);
  assert.deepEqual(res.staged, []);
  assert.equal(res.pr.number, 77);
  const commits = sh(f.origin, ['rev-list', '--reverse', `main..${sha}`]).trim().split('\n');
  assert.equal(commits.length, 2);
  assert.equal(sh(f.origin, ['rev-parse', `${commits[0]}^`]).trim(), f.mainTip, 'the chain is based on origin/main');
  assert.deepEqual(sh(f.origin, ['diff', '--name-only', 'main', sha]).trim().split('\n').sort(), [X, Z]);
  assert.deepEqual(res.landed.map((l) => l.commit).sort(), [...commits].sort());
  const message = sh(f.origin, ['log', '-1', '--format=%B', commits[0]]);
  assert.match(message, /^Add learned skill update to \.claude\/skills\/[xz]\/SKILL\.md — from #5290's wrap-up\n\nLearned-Skills-Run: 2026-11-13T000000-spec-1\n/);

  // The worktree's branch, index and files are untouched; no temp index is left behind.
  assert.equal(sh(f.repo, ['rev-parse', 'HEAD']).trim(), headBefore);
  assert.equal(sh(f.repo, ['status', '--porcelain', '--untracked-files=all', '--', '.claude/skills']).trim(), '');
  assert.equal(fs.existsSync(path.join(f.runDir, 'learned-skills', 'index.tmp')), false);
  const manifest = readManifest(f.runDir);
  assert.deepEqual(manifest.map((m) => m.status), ['landed', 'landed']);
  assert.deepEqual(manifest.map((m) => m.pr.number), [77, 77]);
  assert.ok(manifest.every((m) => /^[0-9a-f]{40}$/.test(m.commit)));
});

test('opens a ready unarmed PR with the marker and refs-only link', (t) => {
  const f = fixture(t);
  const gh = fakeGh();
  land(landArgs(f), deps(gh.gh).deps);

  const create = gh.calls.findIndex((c) => c.args[0] === 'pr' && c.args[1] === 'create');
  assert.ok(create >= 0);
  const argv = gh.calls[create].args;
  assert.equal(argv[argv.indexOf('--base') + 1], 'main');
  assert.equal(argv[argv.indexOf('--head') + 1], BRANCH);
  assert.equal(argv.includes('--draft'), false);
  assert.equal(argv[argv.indexOf('--body-file') + 1], '-');
  const body = gh.calls[create].input;
  assert.ok(body.includes('<!-- wrap-up-skills-pr -->'));
  assert.ok(body.includes('refs #5290'));
  assert.doesNotMatch(body, /<!-- claude-tweaks-run:/);
  assert.doesNotMatch(body, /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#\d/i);
  assert.equal(gh.calls.some((c) => c.args[0] === 'pr' && c.args[1] === 'merge'), false, 'never armed');
  const confirm = gh.calls.findIndex((c, i) => i > create && c.args[0] === 'pr' && c.args[1] === 'list'
    && c.args.includes('--head') && c.args.includes(BRANCH) && c.args[c.args.indexOf('--state') + 1] === 'open');
  assert.ok(confirm > create, 'a confirming open-PR read follows the create');
});

test('a summary carrying a closing phrase is neutralized in the PR body', (t) => {
  const f = fixture(t, { capturedTargets: [] });
  write(f.repo, X, fs.readFileSync(path.join(f.repo, X), 'utf8') + 'a line\n');
  capture({ runDir: f.runDir, worktree: f.repo, mergeBase: f.mergeBase, target: X, summary: 'fixes #12 in the trigger' }, { now: () => NOW });
  const gh = fakeGh();
  land(landArgs(f), deps(gh.gh).deps);
  const body = gh.calls.find((c) => c.args[1] === 'create').input;
  assert.doesNotMatch(body, /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#\d/i);
  assert.match(body, /fixes issue #12/);
});

test('multi-record land refs every member', (t) => {
  const f = fixture(t);
  const gh = fakeGh();
  const res = land(landArgs(f, { record: [5290, 5291] }), deps(gh.gh).deps);
  const body = gh.calls.find((c) => c.args[1] === 'create').input;
  assert.ok(body.includes('refs #5290'));
  assert.ok(body.includes('refs #5291'));
  assert.doesNotMatch(body, /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#\d/i);
  const sha = remoteBranch(f);
  const message = sh(f.origin, ['log', '-1', '--format=%B', sha]);
  assert.match(message, /from #5290, #5291's wrap-up/);
  assert.equal(res.landed.length, 2);
});

test('logs the AUTO line per landed patch', (t) => {
  const f = fixture(t);
  const res = land(landArgs(f), deps(fakeGh().gh).deps);
  const text = decisions(f);
  for (const [label, l] of [['x/SKILL.md', res.landed[0]], ['z/SKILL.md', res.landed[1]]]) {
    const line = text.split('\n').find((ln) => ln.includes(`update to ${label} `));
    assert.ok(line, `an AUTO line for ${label}`);
    assert.match(line, /^- AUTO \d\d:\d\d:\d\d — Skills row: applied additive update to [xz]\/SKILL\.md \(adds a note\) on learned-skills PR #77\. Reversibility: high; commit: [0-9a-f]{7,}\.$/);
    const short = /commit: ([0-9a-f]+)\./.exec(line)[1];
    assert.ok(l.commit.startsWith(short), `${short} is the short hash of ${l.commit}`);
  }
});

test('resumed land is idempotent', (t) => {
  const f = fixture(t);
  const gh = fakeGh();
  const first = deps(gh.gh);
  land(landArgs(f), first.deps);
  const shaBefore = remoteBranch(f);
  const second = deps(gh.gh);
  const ghCallsBefore = gh.calls.length;
  const res = land(landArgs(f), second.deps);
  assert.deepEqual(res.landed, []);
  assert.deepEqual(res.staged, []);
  assert.equal(res.pr.number, 77, 'the PR is reported because this call read it open');
  assert.deepEqual(gh.calls.slice(ghCallsBefore).map((c) => c.args.slice(0, 2).join(' ')), ['pr list'], 'one read, no create');
  assert.deepEqual(pushes(second.gitCalls), []);
  assert.equal(remoteBranch(f), shaBefore);
});

test('resume after a lost manifest write reuses the pushed commits and the open PR', (t) => {
  const f = fixture(t);
  const gh = fakeGh();
  const first = land(landArgs(f), deps(gh.gh).deps);
  const shaBefore = remoteBranch(f);
  // The run died after the push and PR but before the manifest write.
  const manifestFile = path.join(f.runDir, 'learned-skills', 'manifest.json');
  const reset = readManifest(f.runDir).map(({ commit, pr, ...rest }) => ({ ...rest, status: 'captured' }));
  fs.writeFileSync(manifestFile, JSON.stringify(reset, null, 2));
  const createsBefore = gh.calls.filter((c) => c.args[1] === 'create').length;
  const second = deps(gh.gh);
  const res = land(landArgs(f), second.deps);
  assert.equal(res.landed.length, 2);
  assert.deepEqual(res.landed.map((l) => l.commit).sort(), first.landed.map((l) => l.commit).sort());
  assert.equal(remoteBranch(f), shaBefore, 'no duplicate commit');
  assert.deepEqual(pushes(second.gitCalls), []);
  assert.equal(gh.calls.filter((c) => c.args[1] === 'create').length, createsBefore, 'the open PR is reused');
  assert.deepEqual(readManifest(f.runDir).map((m) => m.status), ['landed', 'landed']);
});

test('apply-check failure stages that patch only', (t) => {
  const f = fixture(t);
  // Another session changes the same target on origin/main after capture.
  const other = path.join(f.root, 'other');
  sh(f.root, ['clone', '-q', f.origin, other]);
  write(other, X, '# x\n\nline one\nline two\nline three\nline four\nCHANGED five\nCHANGED six\nCHANGED seven\n');
  sh(other, ['commit', '-q', '-am', 'conflicting change']);
  sh(other, ['push', '-q', 'origin', 'main']);

  const gh = fakeGh();
  const res = land(landArgs(f), deps(gh.gh).deps);
  assert.equal(res.staged.length, 1);
  assert.equal(res.staged[0].target, X);
  assert.match(res.staged[0].reason, /git apply --check/);
  assert.deepEqual(res.landed.map((l) => l.target), [Z]);
  assert.equal(res.pr.number, 77);

  const staged = fs.readFileSync(res.staged[0].stagePath);
  assert.equal(path.basename(res.staged[0].stagePath), 'wrap-up-skill-1.md');
  const head = staged.toString('utf8').split('\n');
  assert.match(head[0], /^Target: /);
  assert.match(head[1], /^Invariant: /);
  assert.match(head[2], /^Finding: /);
  assert.match(head[3], /^Staged-at: /);
  assert.equal(head[4], '');
  const patch = fs.readFileSync(readManifest(f.runDir).find((m) => m.target === X).patch);
  assert.ok(staged.subarray(staged.length - patch.length).equals(patch), 'patch bytes are byte-identical');
  assert.match(decisions(f), /^- STAGED \d\d:\d\d:\d\d — Skills row: skill update for x\/SKILL\.md \(adds a note\) could not ride a learned-skills PR \(.*git apply --check.*\); staged instead\. Reversibility: high \(stage path: staged\/wrap-up-skill-1\.md\)\.$/m);
  assert.deepEqual(readManifest(f.runDir).map((m) => m.status), ['staged', 'landed']);
});

test('an unreachable origin stages every patch with no gh call', (t) => {
  const f = fixture(t);
  sh(f.repo, ['remote', 'set-url', 'origin', path.join(f.root, 'missing.git')]);
  const gh = fakeGh();
  const res = land(landArgs(f), deps(gh.gh).deps);
  assert.equal(res.staged.length, 2);
  assert.deepEqual(res.landed, []);
  assert.equal(res.pr, null);
  assert.equal(gh.calls.length, 0);
  assert.deepEqual(readManifest(f.runDir).map((m) => m.status), ['staged', 'staged']);
});

test('push failure stages every patch', (t) => {
  const f = fixture(t);
  const hook = path.join(f.origin, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const gh = fakeGh();
  const res = land(landArgs(f), deps(gh.gh).deps);
  assert.equal(res.staged.length, 2);
  assert.match(res.staged[0].reason, /push of learned-skills\//);
  assert.equal(res.pr, null);
  assert.equal(gh.calls.length, 0, 'no PR work after a failed push');
  assert.equal(remoteBranch(f), null);
});

test('PR create failure stages every patch and takes the new branch down', (t) => {
  const f = fixture(t);
  const gh = fakeGh({ createThrows: 'HTTP 502 from the forge' });
  const res = land(landArgs(f), deps(gh.gh).deps);
  assert.equal(res.staged.length, 2);
  assert.deepEqual(res.landed, []);
  assert.equal(res.pr, null);
  assert.match(res.staged[0].reason, /gh pr create failed \(HTTP 502/);
  assert.equal(remoteBranch(f), null, 'a branch only this call created is deleted, so staged patches are not delivered twice');
  assert.equal(gh.calls.some((c) => c.args[1] === 'merge'), false);
});

// The run branch carries the captured edit (capture's bothInTree/stuck leave this shape): the patch is
// applied to the worktree and committed on the run branch.
function commitCapturedOnRunBranch(f, target) {
  const entry = readManifest(f.runDir).find((e) => e.target === target);
  sh(f.repo, ['apply', '--', entry.patch]);
  sh(f.repo, ['commit', '-q', '-am', 'record carries the edit']);
}

test('a captured entry the run branch already carries is superseded, not delivered twice', (t) => {
  const f = fixture(t);
  commitCapturedOnRunBranch(f, X);
  const gh = fakeGh();
  const res = land(landArgs(f), deps(gh.gh).deps);
  assert.deepEqual(res.landed.map((l) => l.target), [Z]);
  assert.deepEqual(res.superseded.map((s) => s.target), [X]);
  assert.deepEqual(res.staged, []);
  const m = readManifest(f.runDir);
  assert.equal(m.find((e) => e.target === X).status, 'superseded');
  assert.match(m.find((e) => e.target === X).reason, /run branch/);
  const sha = remoteBranch(f);
  assert.deepEqual(sh(f.origin, ['diff', '--name-only', 'main', sha]).trim().split('\n'), [Z]);
  assert.match(decisions(f), /^- SKIP \d\d:\d\d:\d\d — Skills row: skill update for x\/SKILL\.md/m);

  // The stage verb applies the same check.
  const f2 = fixture(t);
  commitCapturedOnRunBranch(f2, X);
  const s = stage({ runDir: f2.runDir, worktree: f2.repo, reason: 'no forge', mergeBase: f2.mergeBase }, { now: () => NOW });
  assert.deepEqual(s.staged.map((x) => x.target), [Z]);
  assert.deepEqual(s.superseded.map((x) => x.target), [X]);
});

test('a target the run branch changed WITHOUT carrying the captured edit is not dropped', (t) => {
  const f = fixture(t);
  write(f.repo, X, '# x\n\nrecord edit near the top\nline one\nline two\nline three\nline four\nline five\nline six\nline seven\n');
  sh(f.repo, ['commit', '-q', '-am', 'a different record edit']);
  const res = land(landArgs(f), deps(fakeGh().gh).deps);
  assert.equal(res.superseded, undefined);
  assert.deepEqual(res.landed.map((l) => l.target).sort(), [X, Z]);
  assert.equal(readManifest(f.runDir).find((e) => e.target === X).status, 'landed');

  const f2 = fixture(t);
  write(f2.repo, X, '# x\n\nrecord edit near the top\nline one\nline two\nline three\nline four\nline five\nline six\nline seven\n');
  sh(f2.repo, ['commit', '-q', '-am', 'a different record edit']);
  const s = stage({ runDir: f2.runDir, worktree: f2.repo, reason: 'no forge', mergeBase: f2.mergeBase }, { now: () => NOW });
  assert.equal(s.superseded, undefined);
  assert.equal(s.staged.length, 2);
});

test('land and stage require a merge base', (t) => {
  const f = fixture(t);
  assert.throws(() => land(landArgs(f, { mergeBase: undefined }), deps(fakeGh().gh).deps), /mergeBase must be a commit id/);
  assert.throws(() => stage({ runDir: f.runDir, worktree: f.repo, reason: 'r' }, { now: () => NOW }), /mergeBase must be a commit id/);
  const err = [];
  const io = { stdout: () => {}, stderr: (s) => err.push(s), mainRoot: f.repo, lib: deps(fakeGh().gh).deps };
  assert.equal(cli.run(['land', '--run', f.runDir, '--worktree', f.repo, '--record', '5290', '--integration-branch', 'main'], io), 2);
  assert.equal(cli.run(['stage', '--run', f.runDir, '--worktree', f.repo, '--reason', 'r'], io), 2);
  assert.equal((err.join('').match(/--merge-base is required/g) || []).length, 2);
  assert.deepEqual(readManifest(f.runDir).map((m) => m.status), ['captured', 'captured']);
});

// A later edit to a target whose first edit already landed is a new manifest entry with the same
// subject line. It must be delivered (or staged) on its own, never matched to the first entry's commit.
function captureMore(f, target, edit, summary = 'second finding') {
  write(f.repo, target, edit(fs.readFileSync(path.join(f.repo, target), 'utf8')));
  const res = capture({ runDir: f.runDir, worktree: f.repo, mergeBase: f.mergeBase, target, summary }, { now: () => NOW });
  assert.equal(res.route, 'captured');
  return res;
}
const atTop = (b) => b.replace('# x\n', '# x\nsecond edit at the top\n');

test('a re-captured edit on an already-landed target lands as its own commit, never reusing the first', (t) => {
  const f = fixture(t, { capturedTargets: [X] });
  const gh = fakeGh();
  const first = land(landArgs(f), deps(gh.gh).deps);
  const tip1 = remoteBranch(f);
  captureMore(f, X, atTop);
  const second = deps(gh.gh);
  const res = land(landArgs(f), second.deps);
  assert.equal(res.landed.length, 1);
  assert.equal(res.landed[0].id, '2');
  assert.notEqual(res.landed[0].commit, first.landed[0].commit, 'not the first entry\'s commit');
  const tip2 = remoteBranch(f);
  assert.notEqual(tip2, tip1);
  assert.equal(tip2, res.landed[0].commit);
  assert.equal(sh(f.origin, ['rev-parse', `${tip2}^`]).trim(), tip1);
  const onBranch = sh(f.origin, ['show', `${tip2}:${X}`]);
  assert.ok(onBranch.includes('second edit at the top') && onBranch.includes('learned: note for x'), 'both edits are on the branch');
  assert.match(sh(f.origin, ['log', '-1', '--format=%B', tip2]), /Learned-Skills-Entry: 2/);
});

test('resume matches a pushed commit to its own entry id even under a different record set', (t) => {
  const f = fixture(t);
  const gh = fakeGh();
  const first = land(landArgs(f), deps(gh.gh).deps);
  const manifestFile = path.join(f.runDir, 'learned-skills', 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify(readManifest(f.runDir).map(({ commit, pr, ...rest }) => ({ ...rest, status: 'captured' })), null, 2));
  const res = land(landArgs(f, { record: [5290, 5291] }), deps(gh.gh).deps);
  assert.deepEqual(res.landed.map((l) => l.commit).sort(), first.landed.map((l) => l.commit).sort());
});

test('an existing branch with an open PR is the base: a later capture adds one commit on the old tip', (t) => {
  const f = fixture(t, { capturedTargets: [X] });
  const gh = fakeGh();
  land(landArgs(f), deps(gh.gh).deps);
  const tip1 = remoteBranch(f);
  captureMore(f, Z, (b) => b + 'z second\n', 'z finding');
  const again = deps(gh.gh);
  const createsBefore = gh.calls.filter((c) => c.args[1] === 'create').length;
  const res = land(landArgs(f), again.deps);
  assert.equal(res.landed.length, 1);
  assert.equal(res.landed[0].target, Z);
  const tip2 = remoteBranch(f);
  assert.equal(sh(f.origin, ['rev-parse', `${tip2}^`]).trim(), tip1, 'built on the old tip');
  assert.equal(sh(f.origin, ['rev-list', '--count', `main..${tip2}`]).trim(), '2', 'one commit per patch, none duplicated');
  const push = pushes(again.gitCalls);
  assert.equal(push.length, 1);
  assert.ok(push[0].args.includes(`${tip2}:refs/heads/${BRANCH}`));
  assert.equal(gh.calls.filter((c) => c.args[1] === 'create').length, createsBefore, 'the open PR is reused');
  assert.equal(res.pr.number, 77);
});

test('an existing branch with no open PR is not reused as a base: new patches are staged, naming the branch', (t) => {
  const f = fixture(t, { capturedTargets: [X] });
  const gh = fakeGh();
  land(landArgs(f), deps(gh.gh).deps);
  const tip1 = remoteBranch(f);
  gh.state.prs = []; // a human closed the PR
  captureMore(f, Z, (b) => b + 'z second\n', 'z finding');
  const again = deps(gh.gh);
  const createsBefore = gh.calls.filter((c) => c.args[1] === 'create').length;
  const res = land(landArgs(f), again.deps);
  assert.deepEqual(res.landed, []);
  assert.equal(res.staged.length, 1);
  assert.match(res.staged[0].reason, new RegExp(`${BRANCH} already exists on origin with no open PR`));
  assert.equal(res.pr, null);
  assert.deepEqual(pushes(again.gitCalls), []);
  assert.equal(gh.calls.filter((c) => c.args[1] === 'create').length, createsBefore);
  assert.equal(remoteBranch(f), tip1);
});

test('nothing to do reports pr null when the earlier PR is no longer open', (t) => {
  const f = fixture(t);
  const gh = fakeGh();
  land(landArgs(f), deps(gh.gh).deps);
  gh.state.prs = [];
  const res = land(landArgs(f), deps(gh.gh).deps);
  assert.equal(res.pr, null);
});

test('a push failure on resume lands the reused commits and stages only the new ones', (t) => {
  const f = fixture(t, { capturedTargets: [X] });
  const gh = fakeGh();
  land(landArgs(f), deps(gh.gh).deps);
  const manifestFile = path.join(f.runDir, 'learned-skills', 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify(readManifest(f.runDir).map(({ commit, pr, ...rest }) => ({ ...rest, status: 'captured' })), null, 2));
  captureMore(f, Z, (b) => b + 'z second\n', 'z finding');
  fs.writeFileSync(path.join(f.origin, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const res = land(landArgs(f), deps(gh.gh).deps);
  assert.deepEqual(res.landed.map((l) => l.target), [X], 'the pushed commit is on the open PR');
  assert.deepEqual(res.staged.map((s) => s.target), [Z]);
  assert.match(res.staged[0].reason, /push of learned-skills\//);
  assert.equal(res.pr.number, 77);
  assert.deepEqual(readManifest(f.runDir).map((m) => m.status), ['landed', 'staged']);
});

test('a failed branch delete after a PR-create failure is named in the staged reason', (t) => {
  const f = fixture(t);
  const gh = fakeGh({ createThrows: 'HTTP 502' });
  const d = deps(gh.gh);
  const inner = d.deps.git;
  d.deps.git = (args, opts) => {
    if (args.includes('push') && args.includes(`:refs/heads/${BRANCH}`)) throw new Error('delete refused');
    return inner(args, opts);
  };
  const res = land(landArgs(f), d.deps);
  assert.equal(res.staged.length, 2);
  assert.match(res.staged[0].reason, /could not be deleted and still holds these commits \(delete refused\)/);
});

test('HTML comments in a summary cannot plant a run marker in the PR body', (t) => {
  const f = fixture(t, { capturedTargets: [] });
  write(f.repo, X, fs.readFileSync(path.join(f.repo, X), 'utf8') + 'a line\n');
  capture({ runDir: f.runDir, worktree: f.repo, mergeBase: f.mergeBase, target: X, summary: 'note <!-- claude-tweaks-run: evil --> end' }, { now: () => NOW });
  const gh = fakeGh();
  land(landArgs(f), deps(gh.gh).deps);
  const body = gh.calls.find((c) => c.args[1] === 'create').input;
  assert.doesNotMatch(body, /<!-- claude-tweaks-run:/);
  assert.equal(body.split('<!--').length - 1, 1, 'only the learned-skills marker remains a comment');
  assert.ok(body.startsWith('<!-- wrap-up-skills-pr -->'));
});

test('stage numbering skips taken slots', (t) => {
  const f = fixture(t, { capturedTargets: [X] });
  fs.mkdirSync(path.join(f.runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(f.runDir, 'staged', 'wrap-up-skill-1.md'), 'taken\n');
  const res = stage({ runDir: f.runDir, worktree: f.repo, mergeBase: f.mergeBase, reason: 'integration-model is local-merge' }, { now: () => NOW });
  assert.equal(path.basename(res.staged[0].stagePath), 'wrap-up-skill-2.md');
  assert.equal(fs.readFileSync(path.join(f.runDir, 'staged', 'wrap-up-skill-1.md'), 'utf8'), 'taken\n');
});

test('stage verb (local-merge) stages every captured entry with no git push and no gh call', (t) => {
  const f = fixture(t);
  const gh = fakeGh();
  const g = deps(gh.gh);
  const res = stage({ runDir: f.runDir, worktree: f.repo, mergeBase: f.mergeBase, reason: 'integration-model is local-merge' }, g.deps);
  assert.equal(res.staged.length, 2);
  assert.ok(res.staged.every((s) => s.reason === 'integration-model is local-merge'));
  assert.equal(gh.calls.length, 0);
  assert.deepEqual(pushes(g.gitCalls), []);
  assert.equal(g.gitCalls.some((c) => c.args.includes('fetch') || c.args.includes('ls-remote')), false);
  assert.deepEqual(readManifest(f.runDir).map((m) => m.status), ['staged', 'staged']);
  assert.match(decisions(f), /could not ride a learned-skills PR \(integration-model is local-merge\); staged instead/);
  // A second call has nothing captured left.
  assert.deepEqual(stage({ runDir: f.runDir, worktree: f.repo, mergeBase: f.mergeBase, reason: 'again' }, g.deps), { staged: [] });
});

test('every remote-contacting git call is bounded and no plumbing call touches the real index', (t) => {
  const f = fixture(t);
  const g = deps(fakeGh().gh);
  land(landArgs(f), g.deps);
  for (const c of g.gitCalls.filter((x) => x.args.some((a) => ['fetch', 'ls-remote', 'push'].includes(a)))) {
    assert.ok(Number.isInteger(c.opts && c.opts.timeout) && c.opts.timeout > 0, `bounded: ${c.args.join(' ')}`);
  }
  const plumbing = g.gitCalls.filter((c) => c.args.some((a) => ['read-tree', 'write-tree', 'commit-tree'].includes(a))
    || (c.args.includes('apply') && c.args.includes('--cached')));
  assert.ok(plumbing.length >= 8);
  for (const c of plumbing) assert.match(c.opts.env.GIT_INDEX_FILE, /index\.tmp$/, c.args.join(' '));
  for (const c of g.gitCalls.filter((x) => !plumbing.includes(x))) assert.equal(c.opts && c.opts.env && c.opts.env.GIT_INDEX_FILE, undefined);
});

test('CLI land and stage print one JSON line; a missing --record exits 2', (t) => {
  const f = fixture(t);
  const gh = fakeGh();
  const out = [];
  const err = [];
  const io = { stdout: (s) => out.push(s), stderr: (s) => err.push(s), mainRoot: f.repo, lib: deps(gh.gh).deps };
  assert.equal(cli.run(['land', '--run', f.runDir, '--worktree', f.repo, '--integration-branch', 'main', '--merge-base', f.mergeBase], io), 2);
  assert.match(err.join(''), /--record is required/);
  const code = cli.run(['land', '--run', f.runDir, '--worktree', f.repo, '--record', '5290', '--record', '5291', '--integration-branch', 'main', '--merge-base', f.mergeBase], io);
  assert.equal(code, 0);
  const lines = out.join('').trim().split('\n');
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.landed.length, 2);
  assert.equal(parsed.pr.number, 77);

  const f2 = fixture(t);
  const out2 = [];
  const code2 = cli.run(['stage', '--run', f2.runDir, '--worktree', f2.repo, '--reason', 'integration-model is local-merge', '--merge-base', f2.mergeBase], {
    stdout: (s) => out2.push(s), stderr: () => {}, mainRoot: f2.repo, lib: { now: () => NOW },
  });
  assert.equal(code2, 0);
  assert.equal(JSON.parse(out2.join('')).staged.length, 2);
});
