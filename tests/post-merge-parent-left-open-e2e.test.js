'use strict';
// #4798 end to end: a real postMerge run whose Step 4.0b hit a gh failure on a parent travels
// through the real `reconcile-background` summary and the real SessionStart render, and the parent
// is named at the end, never reported as a clean run. Only the I/O edges are stubbed: PR state, the
// in-process closing-links core (#4781) and the parent closer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { postMerge, classifyEntry } = require('../plugin/bin/lib/reconcile/post-merge');

const STATUS_FILENAME = 'reconcile-background-status.json';
const NO_INSTALL = { readFile: () => { throw Object.assign(new Error('no install (test)'), { code: 'ENOENT' }); } };

function git(root, ...args) {
  cp.execFileSync('git', args, { cwd: root, stdio: 'ignore', windowsHide: true });
}

const roots = [];
test.after(() => { for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true }); });

test('AC1.1: a real postMerge run whose Step 4.0b hit gh-failed reaches SessionStart naming the parent, never as a clean ran (#4798)', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'post-merge-e2e-')));
  roots.push(root);
  git(root, 'init', '-q');
  git(root, 'remote', 'add', 'origin', 'git@github.com:acme/w.git');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '## Work records\n\nwork-backend: github-issues\n');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-10-30T090000-spec-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'in-progress', pr: { number: 11 } }));

  const NOW = Date.now();
  const mergedAt = new Date(NOW - 60 * 60 * 1000).toISOString();
  const closingLinks = () => ({
    code: 0,
    envelope: { action: 'nothing-closed', pr: 11, closingSet: [101], reopened: [], pendingClose: [], failed: [] },
  });
  const closeParents = () => ({ closed: [], skipped: [{ parent: 100, reason: 'gh-failed', detail: 'HTTP 502' }] });

  let entries;
  const reconcileMod = require('../plugin/bin/lib/reconcile');
  const originalReconcile = reconcileMod.reconcile;
  const originalWrite = process.stdout.write;
  const originalCwd = process.cwd();
  reconcileMod.reconcile = async () => {
    const result = await postMerge({
      cwd: root,
      prStates: { byNumberAsync: async () => ({ number: 11, state: 'MERGED', mergedAt }) },
      now: () => NOW,
      deps: { gh: () => '', closingLinks, closeParents },
    });
    entries = result.entries;
    return { postMerge: entries };
  };
  process.stdout.write = () => true;
  try {
    process.chdir(root);
    const { main } = require('../plugin/bin/hooks');
    assert.equal(await main(['node', 'hooks.js', 'reconcile-background']), 0);
  } finally {
    process.chdir(originalCwd);
    reconcileMod.reconcile = originalReconcile;
    process.stdout.write = originalWrite;
  }

  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, 'ran');
  assert.deepEqual(entries[0].parentFailures, [{ parent: 100, reason: 'gh-failed', detail: 'HTTP 502' }]);
  assert.equal(classifyEntry(entries[0]).verdict, 'failed');

  const summary = JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', STATUS_FILENAME), 'utf8')).summary;
  assert.equal(summary.postMergeRan, 0);
  assert.equal(summary.postMergeFailed, 1);
  assert.deepEqual(summary.postMergeParentsLeftOpen, [{ pr: 11, parent: 100, reason: 'gh-failed' }]);

  // No origin: SessionStart's inline FAST_CHECKS then do no network I/O.
  git(root, 'remote', 'remove', 'origin');
  const out = await require('../plugin/bin/lib/hooks/session-start').run({
    input: {}, runDir: null, runState: null, cwd: root, superpowersDeps: NO_INSTALL,
  });
  const context = out.json.hookSpecificOutput.additionalContext;
  assert.match(context, /post-merge steps failed for 1 merged run\(s\)/);
  assert.match(context, /post-merge Step 4\.0b left parent record\(s\) open: #100 \(gh-failed, PR #11\) — tidy's parent-gate backstop recovers them/);
  assert.doesNotMatch(context, /post-merge steps ran for/);
});
