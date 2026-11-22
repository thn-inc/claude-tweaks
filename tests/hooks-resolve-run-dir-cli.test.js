// tests/hooks-resolve-run-dir-cli.test.js
//
// #692: CLI-level coverage for `node bin/hooks.js resolve-run-dir`, in-process
// through runCli (unlike tests/hooks-run-dir-resolve.test.js, which tests
// the pure resolver directly) — this is what proves the argv parsing, exit
// codes, and stdout/stderr split in bin/hooks.js actually work end to end,
// mirroring the acceptance-criteria commands verbatim. resolve-run-dir's
// script-entry smoke tests are in tests/hooks-js-flag-strict.test.js
// (#5376).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { gitRepo, linkedWorktreeOf, cleanGitEnv } = require('./helpers/git-fixtures');
const { runCli } = require('./helpers/run-cli');

const HOOKS_JS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

function run(args, cwd, env) {
  return runCli(HOOKS_JS, ['resolve-run-dir', ...args], { cwd, env: { ...cleanGitEnv(), ...env } });
}

function mkRunDir(main, name) {
  const dir = path.join(main, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('AC: inside a linked worktree with PIPELINE_RUN_DIR set to a worktree-local path, exits non-zero and names the shadow', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const trapped = mkRunDir(wt, '2026-01-01T000000-spec-9');
  const out = await run(['--spec-slug', 'spec-9'], wt, { PIPELINE_RUN_DIR: trapped });
  assert.notStrictEqual(out.code, 0);
  assert.strictEqual(out.stdout, '');
  assert.match(out.stderr, /shadow|linked worktree/i);
});

test('AC: PIPELINE_RUN_DIR unset, a matching main-checkout run present — prints that absolute path, exit 0', async () => {
  const main = gitRepo();
  const run_ = mkRunDir(main, '2026-01-01T000000-spec-10');
  const out = await run(['--spec-slug', 'spec-10'], main, { PIPELINE_RUN_DIR: '' });
  assert.strictEqual(out.code, 0);
  assert.strictEqual(out.stdout.trim(), run_);
});

test('nothing resolves at all: exits non-zero, never creates a directory', async () => {
  const main = gitRepo();
  const out = await run(['--spec-slug', 'spec-nope'], main, { PIPELINE_RUN_DIR: '' });
  assert.notStrictEqual(out.code, 0);
  assert.ok(!fs.existsSync(path.join(main, '.claude-tweaks')));
});

test('--create mints a run directory and prints its path, exit 0', async () => {
  const main = gitRepo();
  const out = await run(['--spec-slug', 'spec-77', '--create'], main, { PIPELINE_RUN_DIR: '' });
  assert.strictEqual(out.code, 0);
  const printed = out.stdout.trim();
  assert.ok(fs.statSync(printed).isDirectory());
  assert.match(path.basename(printed), /-spec-77$/);
});

test('#5903: --create stdout is exactly the directory path with the manifest present, exit 0', async () => {
  const main = gitRepo();
  const out = await run(['--spec-slug', 'spec-78', '--create'], main, { PIPELINE_RUN_DIR: '' });
  assert.strictEqual(out.code, 0);
  const dir = out.stdout.trim();
  assert.strictEqual(out.stdout, `${dir}\n`);
  assert.ok(path.isAbsolute(dir));
  assert.ok(fs.statSync(dir).isDirectory());
  assert.ok(fs.existsSync(path.join(dir, 'manifest.json')));
});

// #5376 injected-value proof: fails when resolve-run-dir reads process.cwd() instead of the injected cwd
test('--root-only prints the anchored main checkout root from inside a linked worktree', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const out = await run(['--root-only'], wt, {});
  assert.strictEqual(out.code, 0);
  assert.strictEqual(out.stdout.trim(), main);
});

// #4677: the CLI surface of `resolve({ archived: true })` — `--archived` must reach the resolver.
test('AC3.1 #4677: CLI --archived prints the archived run path, exit 0; the same args without --archived do not', async () => {
  const main = gitRepo();
  const archived = path.join(main, '.claude-tweaks', 'pipelines', 'archive', '2026-01-01T000000-spec-48');
  fs.mkdirSync(archived, { recursive: true });
  fs.writeFileSync(path.join(archived, 'run-state.json'), JSON.stringify({ status: 'clean', pr: { number: 12, url: 'u' } }));
  const out = await run(['--archived', '--spec-slug', 'spec-48'], main, { PIPELINE_RUN_DIR: '' });
  assert.strictEqual(out.code, 0);
  assert.strictEqual(out.stdout.trim(), archived);
  const plain = await run(['--spec-slug', 'spec-48'], main, { PIPELINE_RUN_DIR: '' });
  assert.notStrictEqual(plain.code, 0);
  assert.match(plain.stderr, /no pipeline run directory resolved/);
});
