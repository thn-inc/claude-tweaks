// tests/hooks-adopt-run-dir.test.js
//
// #2409: `bin/hooks.js adopt-run-dir --run <main-checkout-run-dir> --worktree
// <worktree-path>` copies a run dir's decisions.md/report.md/staged/** into
// the worktree's own copy of that path — the sanctioned CLI
// tidy/step-7-5-worktree-always.md's copy-then-commit paragraph now invokes,
// replacing a raw mkdir/cp the PreToolUse shadow guard (checkPipelineShadowGuard)
// refuses from inside a linked worktree when the run-id directory doesn't
// already exist there. This suite spawns the real binary (like
// tests/hooks-dispatcher.test.js) against real git fixtures — never a
// this-repo run dir.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');
const { USAGE } = require('../plugin/bin/hooks.js');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

function runHook(args, { input = '', cwd, env = {} } = {}) {
  try {
    const stdout = execFileSync('node', [HOOKS, ...args], {
      input, cwd, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1', ...env },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

// A run dir under `main`'s own .claude-tweaks/pipelines/ — the anchored,
// real-content side of every test below. `files` may set `decisions`,
// `report` (string content) and `staged` (a { name: content } map); any
// omitted key means that file/dir is absent from the fixture entirely.
function makeRunDir(main, runId, files = {}) {
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  if (files.decisions !== undefined) fs.writeFileSync(path.join(runDir, 'decisions.md'), files.decisions);
  if (files.report !== undefined) fs.writeFileSync(path.join(runDir, 'report.md'), files.report);
  if (files.staged) {
    fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
    for (const [name, content] of Object.entries(files.staged)) {
      fs.writeFileSync(path.join(runDir, 'staged', name), content);
    }
  } else if (files.emptyStagedDir) {
    fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  }
  return runDir;
}

function destDirFor(wt, runId) {
  return path.join(wt, '.claude-tweaks', 'pipelines', runId);
}

test('usage error: --run or --worktree missing exits 2 with usage text on stderr', () => {
  const main = gitRepo();
  let r = runHook(['adopt-run-dir', '--worktree', '/tmp/x'], { cwd: main });
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.stderr, `claude-tweaks: usage: ${USAGE['adopt-run-dir']}\n`);

  r = runHook(['adopt-run-dir', '--run', '/tmp/x'], { cwd: main });
  assert.strictEqual(r.code, 2);

  r = runHook(['adopt-run-dir'], { cwd: main });
  assert.strictEqual(r.code, 2);
});

test('--help intercepts before any validation and exits 0', () => {
  const main = gitRepo();
  const r = runHook(['adopt-run-dir', '--help'], { cwd: main });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, `claude-tweaks: usage: ${USAGE['adopt-run-dir']}\n`);
});

test('anchoring: a --run path that does not exist exits 3', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const missing = path.join(main, '.claude-tweaks', 'pipelines', 'nope');
  const r = runHook(['adopt-run-dir', '--run', missing, '--worktree', wt], { cwd: wt });
  assert.strictEqual(r.code, 3);
  assert.match(r.stderr, /run dir does not exist/);
});

test('anchoring: a --run path that resolves inside the linked worktree itself (a shadow) exits 3', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const shadow = makeRunDir(wt, '2026-01-01T000000-spec-1', { decisions: '# log\n' });
  const r = runHook(['adopt-run-dir', '--run', shadow, '--worktree', wt], { cwd: wt });
  assert.strictEqual(r.code, 3);
  assert.match(r.stderr, /not anchored under the main checkout/);
});

test('worktree validation: a --worktree path that does not exist exits 3', () => {
  const main = gitRepo();
  const runDir = makeRunDir(main, '2026-01-01T000000-spec-2', { decisions: '# log\n' });
  const r = runHook(['adopt-run-dir', '--run', runDir, '--worktree', path.join(main, 'no-such-dir')], { cwd: main });
  assert.strictEqual(r.code, 3);
  assert.match(r.stderr, /--worktree does not exist/);
});

test('worktree validation: a --worktree that is the main checkout itself (not a linked worktree) exits 3', () => {
  const main = gitRepo();
  const runDir = makeRunDir(main, '2026-01-01T000000-spec-3', { decisions: '# log\n' });
  const r = runHook(['adopt-run-dir', '--run', runDir, '--worktree', main], { cwd: main });
  assert.strictEqual(r.code, 3);
  assert.match(r.stderr, /is not a linked git worktree/);
});

test('worktree validation: a --worktree that is a linked worktree of a DIFFERENT repo exits 3', () => {
  const main = gitRepo();
  const runDir = makeRunDir(main, '2026-01-01T000000-spec-4', { decisions: '# log\n' });
  const other = gitRepo();
  const otherWt = linkedWorktreeOf(other);
  const r = runHook(['adopt-run-dir', '--run', runDir, '--worktree', otherWt], { cwd: otherWt });
  assert.strictEqual(r.code, 3);
  assert.match(r.stderr, /is not a linked git worktree of this repo/);
});

test('copy behavior: decisions.md, report.md, and a non-empty staged/ are all copied byte-for-byte, in order', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const runId = '2026-01-01T000000-spec-5';
  const runDir = makeRunDir(main, runId, {
    decisions: '- AUTO 00:00:00 — one\n',
    report: '# Report\n',
    staged: { 'review-1.patch': 'diff --git a/x b/x\n' },
  });
  const r = runHook(['adopt-run-dir', '--run', runDir, '--worktree', wt], { cwd: wt });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, 'copied: decisions.md\ncopied: report.md\ncopied: staged/\n');

  const dest = destDirFor(wt, runId);
  assert.strictEqual(fs.readFileSync(path.join(dest, 'decisions.md'), 'utf8'), '- AUTO 00:00:00 — one\n');
  assert.strictEqual(fs.readFileSync(path.join(dest, 'report.md'), 'utf8'), '# Report\n');
  assert.strictEqual(fs.readFileSync(path.join(dest, 'staged', 'review-1.patch'), 'utf8'), 'diff --git a/x b/x\n');
});

test('copy behavior: only decisions.md present copies only decisions.md', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const runId = '2026-01-01T000000-spec-6';
  const runDir = makeRunDir(main, runId, { decisions: '- AUTO 00:00:00 — solo\n' });
  const r = runHook(['adopt-run-dir', '--run', runDir, '--worktree', wt], { cwd: wt });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, 'copied: decisions.md\n');
  const dest = destDirFor(wt, runId);
  assert.ok(fs.existsSync(path.join(dest, 'decisions.md')));
  assert.ok(!fs.existsSync(path.join(dest, 'report.md')));
  assert.ok(!fs.existsSync(path.join(dest, 'staged')));
});

test('nothing-to-copy: a run dir with none of the three present exits 0, reports nothing to copy, and never creates the destination directory', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const runId = '2026-01-01T000000-spec-7';
  const runDir = makeRunDir(main, runId); // only run-state.json
  const r = runHook(['adopt-run-dir', '--run', runDir, '--worktree', wt], { cwd: wt });
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /nothing to copy/);
  assert.ok(!fs.existsSync(destDirFor(wt, runId)), 'must not create an empty destination tree');
});

test('nothing-to-copy: an empty staged/ directory (no files) does not count as present', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const runId = '2026-01-01T000000-spec-8';
  const runDir = makeRunDir(main, runId, { emptyStagedDir: true });
  const r = runHook(['adopt-run-dir', '--run', runDir, '--worktree', wt], { cwd: wt });
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /nothing to copy/);
  assert.ok(!fs.existsSync(destDirFor(wt, runId)));
});

test('idempotent re-run: running twice never fails, overwrites changed content, and merges new staged files without duplicating old ones', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const runId = '2026-01-01T000000-spec-9';
  const runDir = makeRunDir(main, runId, {
    decisions: '- AUTO 00:00:00 — first\n',
    staged: { 'a.patch': 'a-v1\n' },
  });
  const first = runHook(['adopt-run-dir', '--run', runDir, '--worktree', wt], { cwd: wt });
  assert.strictEqual(first.code, 0);

  // Source changes between runs: decisions.md gains a line, staged/ gains a
  // second file — the second run must pick both up.
  fs.appendFileSync(path.join(runDir, 'decisions.md'), '- AUTO 00:00:01 — second\n');
  fs.writeFileSync(path.join(runDir, 'staged', 'b.patch'), 'b-v1\n');

  const second = runHook(['adopt-run-dir', '--run', runDir, '--worktree', wt], { cwd: wt });
  assert.strictEqual(second.code, 0, 'a re-run over an existing worktree copy must not fail');
  assert.strictEqual(second.stdout, 'copied: decisions.md\ncopied: staged/\n');

  const dest = destDirFor(wt, runId);
  assert.strictEqual(
    fs.readFileSync(path.join(dest, 'decisions.md'), 'utf8'),
    '- AUTO 00:00:00 — first\n- AUTO 00:00:01 — second\n',
    'the second run must overwrite, not append to or duplicate, the destination copy',
  );
  assert.strictEqual(fs.readFileSync(path.join(dest, 'staged', 'a.patch'), 'utf8'), 'a-v1\n');
  assert.strictEqual(fs.readFileSync(path.join(dest, 'staged', 'b.patch'), 'utf8'), 'b-v1\n');
});
