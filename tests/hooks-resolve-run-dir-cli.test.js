// tests/hooks-resolve-run-dir-cli.test.js
//
// #692: CLI-level coverage for `node bin/hooks.js resolve-run-dir`, spawning
// the real process (unlike tests/hooks-run-dir-resolve.test.js, which tests
// the pure resolver directly) — this is what proves the argv parsing, exit
// codes, and stdout/stderr split in bin/hooks.js actually work end to end,
// mirroring the acceptance-criteria commands verbatim.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');

const HOOKS_JS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

function run(args, cwd, env) {
  try {
    const stdout = execFileSync('node', [HOOKS_JS, 'resolve-run-dir', ...args], {
      cwd, env: { ...process.env, ...env }, timeout: 15000,
    });
    return { code: 0, stdout: stdout.toString('utf8'), stderr: '' };
  } catch (e) {
    return {
      code: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout ? e.stdout.toString('utf8') : '',
      stderr: e.stderr ? e.stderr.toString('utf8') : '',
    };
  }
}

function mkRunDir(main, name) {
  const dir = path.join(main, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('AC: inside a linked worktree with PIPELINE_RUN_DIR set to a worktree-local path, exits non-zero and names the shadow', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const trapped = mkRunDir(wt, '2026-01-01T000000-spec-9');
  const out = run(['--spec-slug', 'spec-9'], wt, { PIPELINE_RUN_DIR: trapped });
  assert.notStrictEqual(out.code, 0);
  assert.strictEqual(out.stdout, '');
  assert.match(out.stderr, /shadow|linked worktree/i);
});

test('AC: PIPELINE_RUN_DIR unset, a matching main-checkout run present — prints that absolute path, exit 0', () => {
  const main = gitRepo();
  const run_ = mkRunDir(main, '2026-01-01T000000-spec-10');
  const out = run(['--spec-slug', 'spec-10'], main, { PIPELINE_RUN_DIR: '' });
  assert.strictEqual(out.code, 0);
  assert.strictEqual(out.stdout.trim(), run_);
});

test('nothing resolves at all: exits non-zero, never creates a directory', () => {
  const main = gitRepo();
  const out = run(['--spec-slug', 'spec-nope'], main, { PIPELINE_RUN_DIR: '' });
  assert.notStrictEqual(out.code, 0);
  assert.ok(!fs.existsSync(path.join(main, '.claude-tweaks')));
});

test('--create mints a run directory and prints its path, exit 0', () => {
  const main = gitRepo();
  const out = run(['--spec-slug', 'spec-77', '--create'], main, { PIPELINE_RUN_DIR: '' });
  assert.strictEqual(out.code, 0);
  const printed = out.stdout.trim();
  assert.ok(fs.statSync(printed).isDirectory());
  assert.match(path.basename(printed), /-spec-77$/);
});

test('--root-only prints the anchored main checkout root from inside a linked worktree', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const out = run(['--root-only'], wt, {});
  assert.strictEqual(out.code, 0);
  assert.strictEqual(out.stdout.trim(), main);
});

// #4677: the CLI surface of `resolve({ archived: true })` — `--archived` must reach the resolver.
test('AC3.1 #4677: CLI --archived prints the archived run path, exit 0; the same args without --archived do not', () => {
  const main = gitRepo();
  const archived = path.join(main, '.claude-tweaks', 'pipelines', 'archive', '2026-01-01T000000-spec-48');
  fs.mkdirSync(archived, { recursive: true });
  fs.writeFileSync(path.join(archived, 'run-state.json'), JSON.stringify({ status: 'clean', pr: { number: 12, url: 'u' } }));
  const out = run(['--archived', '--spec-slug', 'spec-48'], main, { PIPELINE_RUN_DIR: '' });
  assert.strictEqual(out.code, 0);
  assert.strictEqual(out.stdout.trim(), archived);
  const plain = run(['--spec-slug', 'spec-48'], main, { PIPELINE_RUN_DIR: '' });
  assert.notStrictEqual(plain.code, 0);
  assert.match(plain.stderr, /no pipeline run directory resolved/);
});
