// tests/hooks-run-dir-resolve.test.js
//
// #692: bin/lib/hooks/run-dir-resolve.js — the pure resolver behind
// `node bin/hooks.js resolve-run-dir`. Implements _shared/run-dir-resolution.md's
// resolution order (env var with adoption-time anchoring check -> newest
// matching dir -> standalone fallback) on top of worktree-detect.js's
// mainCheckoutRoot(), so a skill step can get the anchored $RUN_ROOT/run
// directory without ever composing it from a relative path inside whatever
// worktree happens to be cwd ([IL-127]).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { gitRepo, linkedWorktreeOf, harnessWorktreeOf } = require('./helpers/git-fixtures');
const { resolve, formatTimestamp, isDeadRunDir } = require('../plugin/bin/lib/hooks/run-dir-resolve');

function mkRunDir(main, name) {
  const dir = path.join(main, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRunState(dir, state) {
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify(state));
}

test('main-checkout cwd, spec-slug matches an existing run: resolves that run\'s absolute path', () => {
  const main = gitRepo();
  const run = mkRunDir(main, '2026-01-01T000000-spec-42');
  const out = resolve({ cwd: main, env: {}, specSlug: 'spec-42' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.path, run);
  assert.strictEqual(out.created, false);
});

test('linked-worktree cwd, no env var: still resolves a matching run under the MAIN checkout, not the worktree', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const run = mkRunDir(main, '2026-01-01T000000-spec-99');
  const out = resolve({ cwd: wt, env: {}, specSlug: 'spec-99' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.path, run);
});

test('env var pointing into a linked worktree is rejected, not adopted', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const trapped = mkRunDir(wt, '2026-01-01T000000-spec-7'); // lives in the WORKTREE, not main
  const out = resolve({ cwd: wt, env: { PIPELINE_RUN_DIR: trapped }, specSlug: 'spec-7' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.path, null);
  assert.match(out.message, /shadow|linked worktree/i);
  assert.match(out.message, new RegExp(trapped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('env var pointing into a linked worktree NESTED inside the main checkout (.claude/worktrees/<name>) is rejected, not adopted by a path-prefix false positive', () => {
  const main = gitRepo();
  const wt = harnessWorktreeOf(main, 'nested-wt');
  const trapped = mkRunDir(wt, '2026-01-01T000000-spec-8'); // physically under `main` on disk, but inside the linked worktree's own checkout
  const out = resolve({ cwd: wt, env: { PIPELINE_RUN_DIR: trapped }, specSlug: 'spec-8' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.path, null);
  assert.match(out.message, /shadow|linked worktree/i);
});

test('env var anchored under the main checkout is accepted, even when invoked from a worktree', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const run = mkRunDir(main, '2026-01-01T000000-spec-5');
  const out = resolve({ cwd: wt, env: { PIPELINE_RUN_DIR: run }, specSlug: 'spec-5' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.path, run);
});

test('env var pointing at a directory that does not exist on disk falls through silently to step 2', () => {
  const main = gitRepo();
  const run = mkRunDir(main, '2026-01-01T000000-spec-11');
  const missing = path.join(main, '.claude-tweaks', 'pipelines', 'does-not-exist');
  const out = resolve({ cwd: main, env: { PIPELINE_RUN_DIR: missing }, specSlug: 'spec-11' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.path, run);
});

test('nothing resolves and --create is not passed: exits non-zero (ok:false), never creates a directory', () => {
  const main = gitRepo();
  const out = resolve({ cwd: main, env: {}, specSlug: 'spec-no-match' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.created, false);
  const pipelinesDir = path.join(main, '.claude-tweaks', 'pipelines');
  assert.ok(!fs.existsSync(pipelinesDir), 'must never create .claude-tweaks/pipelines/ as a side effect of a failed resolution');
});

test('newest match wins when multiple directories match the spec-slug', () => {
  const main = gitRepo();
  mkRunDir(main, '2026-01-01T000000-spec-3');
  const newer = mkRunDir(main, '2026-06-01T000000-spec-3');
  const out = resolve({ cwd: main, env: {}, specSlug: 'spec-3' });
  assert.strictEqual(out.path, newer);
});

// #1962: a matching run dir left behind by an abandoned prior attempt (its
// PR closed unmerged, the reconciler's archive sweep skipped it with
// reason no-branch) must never be silently adopted by step 2's slug match —
// it would inherit a closed PR number, a stale config.yml, stale staged/
// items, and a foreign claim runId (this record's own Current State).
test('#1962: step 2 skips a matching run dir whose run-state.json status is interrupted, falling through to create', () => {
  const main = gitRepo();
  const stale = mkRunDir(main, '2026-01-01T000000-record-1302');
  writeRunState(stale, { status: 'interrupted', worktree: null, pr: { number: 42, branch: 'worktree-record-1302' } });
  const out = resolve({
    cwd: main, env: {}, specSlug: 'record-1302', create: true,
    now: new Date('2026-06-01T12:00:00Z'),
  });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.created, true);
  assert.notStrictEqual(out.path, stale);
});

test('#1962: step 2 skips a matching run dir whose status is active but the stamped worktree no longer exists on disk', () => {
  const main = gitRepo();
  const stale = mkRunDir(main, '2026-01-01T000000-record-733');
  writeRunState(stale, { status: 'active', worktree: path.join(main, '.claude', 'worktrees', 'gone-record-733') });
  const out = resolve({ cwd: main, env: {}, specSlug: 'record-733', create: true, now: new Date('2026-06-01T00:00:00Z') });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.created, true);
  assert.notStrictEqual(out.path, stale);
});

test('#1962: step 2 still adopts a matching run dir that is genuinely active with a live worktree', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const live = mkRunDir(main, '2026-01-01T000000-record-1442');
  writeRunState(live, { status: 'active', worktree: wt });
  const out = resolve({ cwd: main, env: {}, specSlug: 'record-1442' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.created, false);
  assert.strictEqual(out.path, live);
});

test('#1962: step 2 falls through to the next-newest match when the newest is dead', () => {
  const main = gitRepo();
  const older = mkRunDir(main, '2026-01-01T000000-record-91');
  const newer = mkRunDir(main, '2026-06-01T000000-record-91');
  writeRunState(newer, { status: 'interrupted' });
  const out = resolve({ cwd: main, env: {}, specSlug: 'record-91' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.created, false);
  assert.strictEqual(out.path, older);
});

test('isDeadRunDir: no run-state.json at all (a bare mkdir-only mint) is never dead', () => {
  const main = gitRepo();
  const bare = mkRunDir(main, '2026-01-01T000000-record-1');
  assert.strictEqual(isDeadRunDir(bare), false);
});

test('isDeadRunDir: malformed run-state.json fails open (not dead) rather than throwing', () => {
  const main = gitRepo();
  const dir = mkRunDir(main, '2026-01-01T000000-record-2');
  fs.writeFileSync(path.join(dir, 'run-state.json'), '{not json');
  assert.strictEqual(isDeadRunDir(dir), false);
});

test('standalone fallback with --create mints a directory with decisions.md and staged/, matching the reference snippet', () => {
  const main = gitRepo();
  const out = resolve({
    cwd: main, env: {}, standalone: 'tidy', create: true,
    now: new Date('2026-03-04T05:06:07Z'),
  });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.created, true);
  assert.strictEqual(path.basename(out.path), '2026-03-04T050607-tidy-standalone');
  assert.ok(fs.statSync(out.path).isDirectory());
  assert.ok(fs.statSync(path.join(out.path, 'staged')).isDirectory());
  assert.ok(fs.existsSync(path.join(out.path, 'decisions.md')));
});

// #848: record #764's run dir was minted as `20260817T173343-spec-764` — no
// dashes — invisible to context.js's RUN_ID_RE-filtered enumeration.
// formatTimestamp is the one implementation every one of the three mint
// sites (flow/claim-targets.md Step 2.8, flow/manifesto.md, dispatch/SKILL.md
// Step 4) now reaches through `resolve-run-dir --create`, so pinning its
// output shape here — rather than only the mint sites' own prose citation —
// mechanically guarantees AC1 at the one place the format is actually
// produced, regardless of what any given skill's prose says.
test('formatTimestamp always produces a dash-containing YYYY-MM-DDTHHMMSS timestamp (#848)', () => {
  assert.strictEqual(formatTimestamp(new Date('2026-03-04T05:06:07Z')), '2026-03-04T050607');
  // Single-digit month/day/hour/minute/second all zero-pad — the exact seam
  // a hand-typed `date -u +%Y%m%dT%H%M%S` (dashes dropped) could otherwise
  // diverge from without a caller noticing.
  assert.strictEqual(formatTimestamp(new Date('2026-01-02T03:04:05Z')), '2026-01-02T030405');
  assert.match(formatTimestamp(new Date('2026-08-17T17:33:43Z')), /^\d{4}-\d{2}-\d{2}T\d{6}$/);
});

test('plain spec-slug fallback with --create mkdir-only mints a bare run directory (the /flow and /dispatch mint shape) — no decisions.md/staged', () => {
  const main = gitRepo();
  const out = resolve({
    cwd: main, env: {}, specSlug: 'spec-88', create: true,
    now: new Date('2026-03-04T05:06:07Z'),
  });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.created, true);
  assert.strictEqual(path.basename(out.path), '2026-03-04T050607-spec-88');
  assert.ok(fs.statSync(out.path).isDirectory());
  assert.ok(!fs.existsSync(path.join(out.path, 'decisions.md')), 'the mkdir-only mint shape must not pre-populate decisions.md');
});

test('--create with neither --standalone nor --spec-slug fails loud (nothing to name the new directory)', () => {
  const main = gitRepo();
  const out = resolve({ cwd: main, env: {}, create: true });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.created, false);
});

test('--create with --standalone and --mode confirm (not auto) refuses to create', () => {
  const main = gitRepo();
  const out = resolve({ cwd: main, env: {}, standalone: 'tidy', mode: 'confirm', create: true });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.created, false);
  const pipelinesDir = path.join(main, '.claude-tweaks', 'pipelines');
  assert.ok(!fs.existsSync(pipelinesDir));
});

test('--create with --standalone and no --mode at all proceeds unconditionally (wrap-up\'s own exception — every mode, not just auto)', () => {
  const main = gitRepo();
  const out = resolve({ cwd: main, env: {}, standalone: 'record-42', create: true });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.created, true);
});

test('--root-only prints the anchored main checkout root, ignoring every other flag', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const out = resolve({ cwd: wt, env: {}, rootOnly: true });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.path, main);
  assert.strictEqual(out.created, false);
});

test('not a git repo at all: fails loud rather than silently resolving to something', () => {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rdr-norepo-'));
  const out = resolve({ cwd: dir, env: {} });
  assert.strictEqual(out.ok, false);
  assert.match(out.message, /git repo|not a git/i);
});
