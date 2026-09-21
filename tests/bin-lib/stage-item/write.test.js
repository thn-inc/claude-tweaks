'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveTarget, sanitizeId, writeStagedItem, writeStagedSidecar } = require('../../../plugin/bin/lib/stage-item/write');

test('sanitizeId: accepts kind-n shapes and safe stems, rejects path traversal and separators', () => {
  assert.equal(sanitizeId('review-2'), 'review-2');
  assert.equal(sanitizeId('leftover-my-slug'), 'leftover-my-slug');
  assert.equal(sanitizeId('polish-suggestion-3'), 'polish-suggestion-3');
  assert.equal(sanitizeId('../../etc/passwd'), null);
  assert.equal(sanitizeId('a/b'), null);
  assert.equal(sanitizeId(''), null);
  assert.equal(sanitizeId(null), null);
  assert.equal(sanitizeId('.hidden'), null);
});

test('resolveTarget: run dir under mainRoot ok; linked-worktree shadow not-anchored; missing dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'si-'));
  const main = path.join(root, 'main');
  const wt = path.join(main, '.claude', 'worktrees', 'wt');
  const good = path.join(main, '.claude-tweaks', 'pipelines', 'run-a');
  const shadow = path.join(wt, '.claude-tweaks', 'pipelines', 'run-a');
  fs.mkdirSync(good, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ../../../.git/worktrees/wt\n');
  assert.equal(resolveTarget({ runDir: good, mainRoot: main }).ok, true);
  const bad = resolveTarget({ runDir: shadow, mainRoot: main });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'not-anchored');
  assert.deepEqual(resolveTarget({ runDir: path.join(main, 'nope'), mainRoot: main }), { ok: false, reason: 'missing' });
});

test('writeStagedItem: creates staged/ and writes <id><ext> from the source extension', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-run-'));
  const r = writeStagedItem({ runDir, id: 'review-2', sourcePath: '/tmp/whatever.patch', content: 'diff --git a b\n' });
  assert.equal(r.file, path.join(runDir, 'staged', 'review-2.patch'));
  assert.equal(fs.readFileSync(r.file, 'utf8'), 'diff --git a b\n');
});

test('writeStagedSidecar: creates staged/ and writes <id>.json regardless of the sibling item extension', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-sidecar-'));
  const r = writeStagedSidecar({ runDir, id: 'tidy-claim-releases-1', content: '[{"tag":"claim"}]' });
  assert.equal(r.file, path.join(runDir, 'staged', 'tidy-claim-releases-1.json'));
  assert.equal(fs.readFileSync(r.file, 'utf8'), '[{"tag":"claim"}]');
});

test('writeStagedItem: no extension on source writes id with no extension; overwrite replaces content', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-run2-'));
  writeStagedItem({ runDir, id: 'leftover-my-slug', sourcePath: '/tmp/body', content: 'first\n' });
  const r = writeStagedItem({ runDir, id: 'leftover-my-slug', sourcePath: '/tmp/body', content: 'second\n' });
  assert.equal(r.file, path.join(runDir, 'staged', 'leftover-my-slug'));
  assert.equal(fs.readFileSync(r.file, 'utf8'), 'second\n');
});

// With `mainRoot: null` passed *explicitly* (not `undefined`), `resolveTarget`'s
// `if (mainRoot)` guard is falsy, so the `rootReal !== gitRoot` domain comparison
// never runs — the `.git`-is-a-FILE check on its own is the only thing standing
// between a linked-worktree (or submodule) run dir and a false `ok: true`.
test('resolveTarget: with mainRoot explicitly null, the .git-is-a-FILE check alone gates a linked worktree', () => {
  const wtRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'si-nullroot-wt-'));
  const wt = path.join(wtRoot, '.claude', 'worktrees', 'wt');
  const wtRun = path.join(wt, '.claude-tweaks', 'pipelines', 'run-a');
  fs.mkdirSync(wtRun, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ../../../.git/worktrees/wt\n');
  assert.deepEqual(resolveTarget({ runDir: wtRun, mainRoot: null }), { ok: false, reason: 'not-anchored' });

  const mainTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-nullroot-main-'));
  const main = path.join(mainTmp, 'main');
  const mainRun = path.join(main, '.claude-tweaks', 'pipelines', 'run-b');
  fs.mkdirSync(mainRun, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  assert.equal(resolveTarget({ runDir: mainRun, mainRoot: null }).ok, true);

  const orphanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'si-nullroot-orphan-'));
  const orphanRun = path.join(orphanRoot, 'run-c');
  fs.mkdirSync(orphanRun, { recursive: true });
  assert.deepEqual(resolveTarget({ runDir: orphanRun, mainRoot: null }), { ok: false, reason: 'not-anchored' });
});
