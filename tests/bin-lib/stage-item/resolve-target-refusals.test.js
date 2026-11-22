'use strict';
// Characterization of resolveTarget's refusals that plugin/bin/ci-gate-record.js
// relies on to anchor its --run argument (#5160 AC4). The AC4 probe also ran
// three cases the anchor check alone did not refuse: C3a/C3b (a `..` spelling,
// un-normalized and normalized, that lands on main/docs — inside the main
// checkout, outside .claude-tweaks/pipelines/) and C4 (a look-alike
// main/x.claude-tweaks/pipelines-copy/<id> dir). Each resolved { ok: true }
// until #5830 added the run-dir guard (plugin/bin/lib/run-dir-guard.js): they
// are now refused as 'not-a-run-dir'.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveTarget } = require('../../../plugin/bin/lib/stage-item/write');

const RUN_ID = '2026-11-12T102742-record-5160';
const { sep } = path;

// Same anchoring fixture shape as tests/bin-lib/run-artifact/cli.test.js: a
// fake main checkout (.git directory) holding the real run dir, plus a linked
// worktree (.git FILE) carrying a worktree-local shadow. `worktree` is the cwd
// of the simulated worktree-isolated session; mainRoot is omitted (computed).
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolvetarget-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const main = path.join(root, 'main');
  const singleDir = path.join(main, '.claude-tweaks', 'pipelines', RUN_ID);
  const worktree = path.join(main, '.claude', 'worktrees', 'flow-5160');
  const shadow = path.join(worktree, '.claude-tweaks', 'pipelines', RUN_ID);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(singleDir, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(main, 'docs'));
  const lookAlike = path.join(main, 'x.claude-tweaks', 'pipelines-copy', RUN_ID);
  fs.mkdirSync(lookAlike, { recursive: true });
  const pipelines = path.join(main, '.claude-tweaks', 'pipelines');
  const siblingPrefix = path.join(main, '.claude-tweaks', 'pipelines-copy', RUN_ID);
  fs.mkdirSync(siblingPrefix, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: ../../../.git/worktrees/flow-5160\n');
  return { main, pipelines, singleDir, worktree, shadow, outside, lookAlike, siblingPrefix };
}

// `..` spellings are built by concatenation, never path.join (which normalizes).
const up = (n) => Array(n).fill('..').join(sep);

function assertRefused(r, reason) {
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.reason, reason, JSON.stringify(r));
}

test('AC4 probe control: the real main-checkout run dir resolves ok', (t) => {
  const { singleDir, worktree } = fixture(t);
  const r = resolveTarget({ runDir: singleDir, cwd: worktree });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.dir, fs.realpathSync(singleDir));
});

test('AC4 probe C1: resolveTarget refuses the worktree-local shadow as not-anchored', (t) => {
  const { shadow, worktree } = fixture(t);
  assertRefused(resolveTarget({ runDir: shadow, cwd: worktree }), 'not-anchored');
});

test('AC4 probe C2a: resolveTarget refuses an un-normalized .. escape out of the checkout', (t) => {
  const { singleDir, worktree } = fixture(t);
  const runDir = singleDir + sep + up(4) + sep + 'outside';
  assertRefused(resolveTarget({ runDir, cwd: worktree }), 'not-anchored');
});

test('AC4 probe C2b: resolveTarget refuses the normalized .. escape out of the checkout', (t) => {
  const { singleDir, worktree } = fixture(t);
  const runDir = path.normalize(singleDir + sep + up(4) + sep + 'outside');
  assertRefused(resolveTarget({ runDir, cwd: worktree }), 'not-anchored');
});

test('AC4 probe C3a: resolveTarget refuses an un-normalized .. spelling that lands on main/docs as not-a-run-dir', (t) => {
  const { singleDir, worktree } = fixture(t);
  const runDir = singleDir + sep + up(3) + sep + 'docs';
  assertRefused(resolveTarget({ runDir, cwd: worktree }), 'not-a-run-dir');
});

test('AC4 probe C3b: resolveTarget refuses the normalized .. spelling that lands on main/docs as not-a-run-dir', (t) => {
  const { singleDir, worktree } = fixture(t);
  const runDir = path.normalize(singleDir + sep + up(3) + sep + 'docs');
  assertRefused(resolveTarget({ runDir, cwd: worktree }), 'not-a-run-dir');
});

test('AC4 probe C4: resolveTarget refuses the look-alike main/x.claude-tweaks/pipelines-copy/<id> dir as not-a-run-dir', (t) => {
  const { lookAlike, worktree } = fixture(t);
  assertRefused(resolveTarget({ runDir: lookAlike, cwd: worktree }), 'not-a-run-dir');
});

test('resolveTarget refuses the sibling main/.claude-tweaks/pipelines-copy/<id> dir (a string-prefix match of pipelines) as not-a-run-dir', (t) => {
  const { siblingPrefix, worktree } = fixture(t);
  assertRefused(resolveTarget({ runDir: siblingPrefix, cwd: worktree }), 'not-a-run-dir');
});

test('resolveTarget refuses the pipelines directory itself as not-a-run-dir', (t) => {
  const { pipelines, worktree } = fixture(t);
  assertRefused(resolveTarget({ runDir: pipelines, cwd: worktree }), 'not-a-run-dir');
});

test('resolveTarget accepts an archived and a nested multi-spec run dir under pipelines/', (t) => {
  const { pipelines, worktree } = fixture(t);
  const archived = path.join(pipelines, 'archive', RUN_ID);
  const nested = path.join(pipelines, 'parent-run', 'spec-1');
  fs.mkdirSync(archived, { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  for (const runDir of [archived, nested]) {
    const r = resolveTarget({ runDir, cwd: worktree });
    assert.equal(r.ok, true, JSON.stringify(r));
  }
});

test('resolveTarget refuses a pipelines/ symlink pointing at main/docs as not-a-run-dir', { skip: process.platform === 'win32' && 'win32: creating a directory symlink needs elevated rights' }, (t) => {
  const { main, pipelines, worktree } = fixture(t);
  const link = path.join(pipelines, 'link');
  fs.symlinkSync(path.join(main, 'docs'), link, 'dir');
  assertRefused(resolveTarget({ runDir: link, cwd: worktree }), 'not-a-run-dir');
});

test('AC4 probe C5a: resolveTarget refuses an unanchored dir spelled with a trailing separator', (t) => {
  const { outside, worktree } = fixture(t);
  assertRefused(resolveTarget({ runDir: outside + sep, cwd: worktree }), 'not-anchored');
});

test('AC4 probe C5b: resolveTarget refuses the shadow spelled with a trailing separator', (t) => {
  const { shadow, worktree } = fixture(t);
  assertRefused(resolveTarget({ runDir: shadow + sep, cwd: worktree }), 'not-anchored');
});

// The `missing` outcome comes from safeReal resolving the relative URL-shaped value
// against process.cwd() (no such directory there), not against the fixture's `cwd` argument.
test('AC4 probe C6: resolveTarget refuses a URL-shaped run dir as missing', (t) => {
  const { worktree } = fixture(t);
  const runDir = `https://example.com/.claude-tweaks/pipelines/${RUN_ID}`;
  assertRefused(resolveTarget({ runDir, cwd: worktree }), 'missing');
});
