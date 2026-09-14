// tests/bin-lib/hooks/sweep-shadow.test.js
//
// #1171: a mid-sweep throw (e.g. a permission-denied shadow staged/ dir,
// or a read/write failure on the shadow decisions.md) used to propagate
// past sweepShadow() entirely, hitting hooks.js's blanket
// `.catch(() => process.exit(0))` — a failed partial sweep was silent and
// indistinguishable from a clean no-op sweep. Also: the old read/append/
// unlink order for decisions.md could append successfully, then fail to
// unlink, duplicating the same entries into the anchored decisions.md on
// the next sweep.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sweepShadow } = require('../../../plugin/bin/lib/hooks/sweep-shadow');
const { skipUnderRoot } = require('../../helpers/root');

const REL = path.join('.claude-tweaks', 'pipelines', 'testrun');

function tmpDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// Sets up a main-checkout root with an anchored run dir, and a separate
// worktree with a shadow copy of the same relative run-dir path.
function setup() {
  const root = tmpDir('ct-sweep-shadow-root-');
  const runDir = path.join(root, REL);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# Decisions log\n');

  const wt = tmpDir('ct-sweep-shadow-wt-');
  const shadow = path.join(wt, REL);
  fs.mkdirSync(shadow, { recursive: true });

  return { root, runDir, wt, shadow };
}

test('read-only shadow staged/ dir produces a failure diagnostic, not a clean-sweep report', skipUnderRoot('root ignores directory permissions'), () => {
  const { root, runDir, wt, shadow } = setup();
  const shadowStaged = path.join(shadow, 'staged');
  fs.mkdirSync(shadowStaged, { recursive: true });
  fs.writeFileSync(path.join(shadowStaged, 'reflect-1.md'), 'content');
  fs.chmodSync(shadowStaged, 0o000);
  try {
    const result = sweepShadow({ runRoot: root, pipelineRunDir: runDir, worktree: wt });
    assert.equal(result.diagnostic, true, 'a permission-denied readdir must surface as a diagnostic, not a clean sweep');
    assert.ok(
      result.lines.some((l) => l.startsWith('sweep: failed to read shadow staged/')),
      `expected a "failed to read shadow staged/" line, got: ${JSON.stringify(result.lines)}`,
    );
  } finally {
    fs.chmodSync(shadowStaged, 0o755);
  }
});

test('unreadable shadow decisions.md produces a failure diagnostic, not silence', skipUnderRoot('root ignores file permissions'), () => {
  const { root, runDir, wt, shadow } = setup();
  const shadowDecisions = path.join(shadow, 'decisions.md');
  fs.writeFileSync(shadowDecisions, '# Decisions\n- an entry\n');
  fs.chmodSync(shadowDecisions, 0o000);
  try {
    const result = sweepShadow({ runRoot: root, pipelineRunDir: runDir, worktree: wt });
    assert.equal(result.diagnostic, true, 'an unreadable shadow decisions.md must surface as a diagnostic');
    assert.ok(
      result.lines.some((l) => l.startsWith('sweep: failed to relocate shadow decisions.md')),
      `expected a "failed to relocate shadow decisions.md" line, got: ${JSON.stringify(result.lines)}`,
    );
    // The shadow file is untouched — readFileSync threw before unlinkSync ran.
    assert.ok(fs.existsSync(shadowDecisions), 'shadow decisions.md must survive a read failure, not be silently consumed');
  } finally {
    fs.chmodSync(shadowDecisions, 0o644);
  }
});

test('a clean sweep relocates shadow decisions.md entries exactly once — a second run over the same shadow is a no-op, no duplication', () => {
  const { root, runDir, wt, shadow } = setup();
  const shadowDecisions = path.join(shadow, 'decisions.md');
  fs.writeFileSync(shadowDecisions, '# Decisions\n- first entry\n- second entry\n');

  const first = sweepShadow({ runRoot: root, pipelineRunDir: runDir, worktree: wt });
  assert.equal(first.diagnostic, false, `first sweep should be clean: ${JSON.stringify(first.lines)}`);
  assert.ok(first.lines.includes('relocated: decisions.md (entries appended)'));
  assert.ok(!fs.existsSync(shadowDecisions), 'shadow decisions.md is consumed by a successful relocation');

  const anchored = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  const firstCount = (anchored.match(/- first entry/g) || []).length;
  const secondCount = (anchored.match(/- second entry/g) || []).length;
  assert.equal(firstCount, 1, 'first entry appears exactly once after the first sweep');
  assert.equal(secondCount, 1, 'second entry appears exactly once after the first sweep');

  // Re-run over the same (now-empty-of-decisions.md) shadow — nothing left to relocate.
  const second = sweepShadow({ runRoot: root, pipelineRunDir: runDir, worktree: wt });
  assert.equal(second.diagnostic, false);
  assert.ok(!second.lines.some((l) => l.startsWith('relocated: decisions.md')), 'nothing to relocate on the second run');

  const anchoredAfterSecond = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.equal((anchoredAfterSecond.match(/- first entry/g) || []).length, 1, 'still exactly one copy after a second run');
  assert.equal((anchoredAfterSecond.match(/- second entry/g) || []).length, 1, 'still exactly one copy after a second run');
});

test('#1305: permission-denied PARENT dir (not the target) at the staged/ entry gate produces a diagnostic, not a silent clean sweep', skipUnderRoot('root ignores directory permissions'), () => {
  const { root, runDir, wt, shadow } = setup();
  // Deny traversal into `shadow` itself — the PARENT of `shadow/staged` —
  // rather than chmod-ing `shadow/staged` directly (that exercises the
  // readdir failure covered above, not this stat() entry gate).
  fs.chmodSync(shadow, 0o000);
  try {
    const result = sweepShadow({ runRoot: root, pipelineRunDir: runDir, worktree: wt });
    assert.equal(result.diagnostic, true, 'a permission-denied parent dir must surface as a diagnostic, not a clean sweep');
    assert.ok(
      result.lines.some((l) => l.startsWith('sweep: failed to check for shadow staged/')),
      `expected a "failed to check for shadow staged/" line, got: ${JSON.stringify(result.lines)}`,
    );
  } finally {
    fs.chmodSync(shadow, 0o755);
  }
});

test('#1305: permission-denied PARENT dir (not the target) at the decisions.md entry gate produces a diagnostic, not a silent clean sweep', skipUnderRoot('root ignores directory permissions'), () => {
  const { root, runDir, wt, shadow } = setup();
  // Same PARENT-directory denial as above, for the decisions.md gate.
  fs.chmodSync(shadow, 0o000);
  try {
    const result = sweepShadow({ runRoot: root, pipelineRunDir: runDir, worktree: wt });
    assert.equal(result.diagnostic, true, 'a permission-denied parent dir must surface as a diagnostic, not a clean sweep');
    assert.ok(
      result.lines.some((l) => l.startsWith('sweep: failed to check for shadow decisions.md')),
      `expected a "failed to check for shadow decisions.md" line, got: ${JSON.stringify(result.lines)}`,
    );
  } finally {
    fs.chmodSync(shadow, 0o755);
  }
});

test('#1305: a genuinely absent shadow (no staged/, no decisions.md) is still a clean no-op — ENOENT unaffected', () => {
  const { root, runDir, wt } = setup();
  // `shadow` exists (created by setup()) but is empty — both gates hit a
  // genuine ENOENT on their respective targets, not a parent-permission
  // failure. Must remain a clean, diagnostic-free sweep.
  const result = sweepShadow({ runRoot: root, pipelineRunDir: runDir, worktree: wt });
  assert.equal(result.diagnostic, false, `genuine ENOENT must stay a clean no-op: ${JSON.stringify(result.lines)}`);
  assert.deepEqual(result.lines, []);
});

test('#1493: a *-tidy-standalone* run dir is exempt — its worktree copy of staged/decisions.md is never swept back', () => {
  const root = tmpDir('ct-sweep-shadow-root-');
  const rel = path.join('.claude-tweaks', 'pipelines', '2026-08-30T090000-tidy-standalone');
  const runDir = path.join(root, rel);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# Decisions log\n');

  const wt = tmpDir('ct-sweep-shadow-wt-');
  const shadow = path.join(wt, rel);
  const shadowStaged = path.join(shadow, 'staged');
  fs.mkdirSync(shadowStaged, { recursive: true });
  fs.writeFileSync(path.join(shadowStaged, 'proposal.md'), 'content');
  fs.writeFileSync(path.join(shadow, 'decisions.md'), '# Decisions\n- an entry\n');

  const result = sweepShadow({ runRoot: root, pipelineRunDir: runDir, worktree: wt });
  assert.equal(result.diagnostic, false, 'a tidy-standalone shadow is a clean no-op, not a diagnostic');
  assert.deepEqual(result.lines, []);
  assert.ok(fs.existsSync(path.join(shadowStaged, 'proposal.md')), 'the worktree copy of staged/ must survive untouched');
  assert.ok(fs.existsSync(path.join(shadow, 'decisions.md')), 'the worktree copy of decisions.md must survive untouched');
});

test('#1494: a *-sweep-standalone* run dir is exempt the same way a *-tidy-standalone* one is — tidy runs inside sweep\'s shared run dir', () => {
  const root = tmpDir('ct-sweep-shadow-root-');
  const rel = path.join('.claude-tweaks', 'pipelines', '2026-08-30T120000-sweep-standalone');
  const runDir = path.join(root, rel);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# Decisions log\n');

  const wt = tmpDir('ct-sweep-shadow-wt-');
  const shadow = path.join(wt, rel);
  const shadowStaged = path.join(shadow, 'staged');
  fs.mkdirSync(shadowStaged, { recursive: true });
  fs.writeFileSync(path.join(shadowStaged, 'proposal.md'), 'content');
  fs.writeFileSync(path.join(shadow, 'decisions.md'), '# Decisions\n- an entry\n');

  const result = sweepShadow({ runRoot: root, pipelineRunDir: runDir, worktree: wt });
  assert.equal(result.diagnostic, false, 'a sweep-standalone shadow is a clean no-op, not a diagnostic');
  assert.deepEqual(result.lines, []);
  assert.ok(fs.existsSync(path.join(shadowStaged, 'proposal.md')), 'the worktree copy of staged/ must survive untouched');
  assert.ok(fs.existsSync(path.join(shadow, 'decisions.md')), 'the worktree copy of decisions.md must survive untouched');
});

test('unlink-before-append: a shadow decisions.md with no "- " entry lines is dropped and unlinked, not left behind', () => {
  const { root, runDir, wt, shadow } = setup();
  const shadowDecisions = path.join(shadow, 'decisions.md');
  fs.writeFileSync(shadowDecisions, '# Decisions log — spec 1171\n');

  const result = sweepShadow({ runRoot: root, pipelineRunDir: runDir, worktree: wt });
  // "had no entries — dropped" is `sweep:`-prefixed by existing convention
  // (every such line is what curation-engine.md §4 logs distinctly), so
  // `diagnostic` is true here even though nothing failed.
  assert.equal(result.diagnostic, true);
  assert.ok(result.lines.includes('sweep: shadow decisions.md had no entries — dropped'));
  assert.ok(!fs.existsSync(shadowDecisions), 'a headers-only shadow file is still consumed (unlinked)');
});
