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
const { gitRepo, linkedWorktreeOf, harnessWorktreeOf, fixtureGit } = require('./helpers/git-fixtures');
const { resolve, formatTimestamp, adoptionRefusal } = require('../plugin/bin/lib/hooks/run-dir-resolve');
const { ownerBlock } = require('../plugin/bin/lib/hooks/context');
const { runLiveness } = require('../plugin/bin/lib/run-liveness');

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

// #3865: the slug matches a whole `-`-delimited name segment, never a substring —
// `spec-378` must not adopt a `spec-3784` run dir (or a `spec-3784-3790` multi-spec one).
test('#3865: spec-378 resolves its own run dir, not a newer spec-3784 / spec-3784-3790 run dir that contains it as a prefix', () => {
  const main = gitRepo();
  const own = mkRunDir(main, '2026-01-01T000000-spec-378');
  mkRunDir(main, '2026-06-01T000000-spec-3784');
  mkRunDir(main, '2026-07-01T000000-spec-3784-3790');
  const out378 = resolve({ cwd: main, env: {}, specSlug: 'spec-378' });
  assert.strictEqual(out378.ok, true);
  assert.strictEqual(out378.path, own);
  const out3784 = resolve({ cwd: main, env: {}, specSlug: 'spec-3784' });
  assert.strictEqual(out3784.path, path.join(main, '.claude-tweaks', 'pipelines', '2026-07-01T000000-spec-3784-3790'));
});

test('#3865: spec-378 with no run dir of its own does not adopt a spec-3784 run dir — resolves ok:false', () => {
  const main = gitRepo();
  mkRunDir(main, '2026-06-01T000000-spec-3784');
  mkRunDir(main, '2026-07-01T000000-spec-3784-3790');
  const out = resolve({ cwd: main, env: {}, specSlug: 'spec-378' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'unresolved');
});

test('#3865: a multi-spec run dir that leads with spec-378 (spec-378-379) is still matched by spec-378', () => {
  const main = gitRepo();
  const multi = mkRunDir(main, '2026-03-01T000000-spec-378-379');
  mkRunDir(main, '2026-06-01T000000-spec-3784');
  const out = resolve({ cwd: main, env: {}, specSlug: 'spec-378' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.path, multi);
});

test('#3865: the slug must start at a name segment — subspec-378 is not a spec-378 run dir; a lone spec-3784 dir resolves for spec-3784', () => {
  const main = gitRepo();
  mkRunDir(main, '2026-06-01T000000-subspec-378');
  const lone = mkRunDir(main, '2026-06-02T000000-spec-3784');
  assert.strictEqual(resolve({ cwd: main, env: {}, specSlug: 'spec-378' }).ok, false);
  assert.strictEqual(resolve({ cwd: main, env: {}, specSlug: 'spec-3784' }).path, lone);
});

test('#3865: a -standalone suffixed run dir still matches its slug, and a slug with regex metacharacters matches literally', () => {
  const main = gitRepo();
  const standalone = mkRunDir(main, '2026-06-01T000000-dispatch-standalone');
  assert.strictEqual(resolve({ cwd: main, env: {}, specSlug: 'dispatch-standalone' }).path, standalone);
  const dotted = mkRunDir(main, '2026-06-02T000000-release.1');
  mkRunDir(main, '2026-06-03T000000-releaseX1');
  assert.strictEqual(resolve({ cwd: main, env: {}, specSlug: 'release.1' }).path, dotted);
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

// #2838: a mint-only `--create` call (no --standalone) must never adopt an
// existing same-slug directory, dead OR alive — including one a live sibling
// session minted seconds earlier. Before this fix, Step 2 ran unconditionally
// whenever --spec-slug was given, so this exact scenario silently returned
// the sibling's directory instead of minting a fresh one, handing both
// sessions the same run dir and worktree (this record's own Current State).
test('#2838: --create with --spec-slug never adopts an existing LIVE same-slug directory — always mints fresh', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const sibling = mkRunDir(main, '2026-01-01T000000-record-2785');
  writeRunState(sibling, { status: 'active', worktree: wt }); // a genuinely live sibling run
  const out = resolve({
    cwd: main, env: {}, specSlug: 'record-2785', create: true,
    now: new Date('2026-06-01T12:00:00Z'),
  });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.created, true);
  assert.notStrictEqual(out.path, sibling);
  assert.strictEqual(path.basename(out.path), '2026-06-01T120000-record-2785');
});

// Without --create, the read-only resolution caller must keep today's
// adopt-newest-matching behavior exactly (AC "Read-only resolve-run-dir
// callers ... keep their current adopt-newest-matching behavior") — the
// #2838 guard above is scoped to --create only.
test('#2838: without --create, a matching directory is still adopted as before (read-only callers unaffected)', () => {
  const main = gitRepo();
  const run = mkRunDir(main, '2026-01-01T000000-record-2786');
  const out = resolve({ cwd: main, env: {}, specSlug: 'record-2786' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.created, false);
  assert.strictEqual(out.path, run);
});

// A `--create --standalone --spec-slug` call (release/wrap-up's own shape)
// is unaffected by the #2838 guard — it is scoped to --standalone-absent
// mint calls only.
test('#2838: --create with --standalone AND --spec-slug is unaffected by the mint-only guard', () => {
  const main = gitRepo();
  const out = resolve({
    cwd: main, env: {}, specSlug: 'release', standalone: 'release', create: true,
    now: new Date('2026-03-04T05:06:07Z'),
  });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.created, true);
  assert.strictEqual(path.basename(out.path), '2026-03-04T050607-release-standalone');
});

// #2870: a legacy non-canonical name (no `YYYY-MM-DDT` run-id prefix, no
// run-state.json) string-sorts AFTER every canonical run-id, so Step 2 adopted
// it as "newest" forever. Step 2 now only considers canonical run-id names.
const STALE_NON_CANONICAL = '20260911T131119-backlog-standalone';

function mkStaleNonCanonical(main) {
  const dir = mkRunDir(main, STALE_NON_CANONICAL);
  fs.writeFileSync(path.join(dir, 'decisions.md'), '## /backlog\n- AUTO 15:11:19 — refine #1894: stale\n');
  return dir;
}

test('#2870: --create with --spec-slug never hands back a non-canonical dir lacking run-state.json — mints fresh', () => {
  const main = gitRepo();
  const stale = mkStaleNonCanonical(main);
  const out = resolve({
    cwd: main, env: {}, specSlug: 'backlog-standalone', create: true,
    now: new Date('2026-10-01T12:00:00Z'),
  });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.created, true);
  assert.notStrictEqual(out.path, stale);
  assert.strictEqual(path.basename(out.path), '2026-10-01T120000-backlog-standalone');
});

test('#2870: read-only resolution prefers an older canonical match over a non-canonical name that string-sorts last', () => {
  const main = gitRepo();
  mkStaleNonCanonical(main);
  const canonical = mkRunDir(main, '2026-09-20T080000-backlog-standalone');
  const out = resolve({ cwd: main, env: {}, specSlug: 'backlog-standalone' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.created, false);
  assert.strictEqual(out.path, canonical);
});

test('#2870: read-only resolution never adopts a non-canonical dir even when it is the only match', () => {
  const main = gitRepo();
  mkStaleNonCanonical(main);
  const out = resolve({ cwd: main, env: {}, specSlug: 'backlog-standalone' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'unresolved');
  assert.strictEqual(out.created, false);
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

test('AC4.1 AC4.2: adoptionRefusal on a bare mkdir-only mint (no run-state.json) is adoptable and never throws', () => {
  const main = gitRepo();
  const bare = mkRunDir(main, '2026-01-01T000000-record-1');
  let reason;
  assert.doesNotThrow(() => { reason = adoptionRefusal(bare); });
  assert.strictEqual(reason, null);
});

test('AC4.1 AC4.2: adoptionRefusal on a malformed run-state.json is refused as unreadable rather than throwing', () => {
  const main = gitRepo();
  const dir = mkRunDir(main, '2026-01-01T000000-record-2');
  fs.writeFileSync(path.join(dir, 'run-state.json'), '{not json');
  let reason;
  assert.doesNotThrow(() => { reason = adoptionRefusal(dir); });
  assert.strictEqual(reason, 'unreadable-run-state');
});

// #4419: adoption is not a liveness verdict. An `active` run whose worktree survives but
// whose owner process is gone is exactly a crash a resuming session must adopt.
test('AC3.1 AC3.2 #4419: step 2 adopts an active run whose worktree survives but whose owner pid is gone (crash-resume)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  // Backdate the worktree's last commit so no liveness probe reads the run as live.
  const old = '2026-01-01T00:00:00Z';
  fixtureGit(['-C', wt, 'commit', '-q', '--allow-empty', '-m', 'old'], {
    env: { ...process.env, GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old },
  });
  const crashed = mkRunDir(main, '2026-01-01T000000-record-4419');
  fs.writeFileSync(path.join(crashed, 'events.jsonl'), '');
  const owner = ownerBlock({
    sessionId: 'crashed-session',
    now: Date.parse(old),
    deps: {
      resolveOwnerPid: () => ({ pid: 2147483646, pidSource: 'env' }),
      pidStartTime: () => 'T1',
    },
  });
  writeRunState(crashed, { status: 'active', worktree: wt, sessionId: 'crashed-session', owner });
  // Precondition: liveness itself reads this run as dead (owner pid gone), so the adoption
  // assertions below pin the ruling rather than a fixture that liveness would call live.
  assert.strictEqual(runLiveness(crashed).verdict, 'dead');
  const out = resolve({ cwd: main, env: {}, specSlug: 'record-4419' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.created, false);
  assert.strictEqual(out.path, crashed);
});

// #4151: step 2 refuses what `/claude-tweaks:release`'s inline adoption guard used to refuse
// (terminal status, `createdBy: release-standalone`), plus an unreadable run-state.json — via
// `adoptionRefusal`, which `newestMatch` consults for its refusal reasons, the #1962
// unresumable check among them.
test('#4151 AC1.1: adoptionRefusal names each refusal reason', () => {
  const main = gitRepo();
  let count = 0;
  const fresh = () => {
    count += 1;
    return mkRunDir(main, `2026-01-01T0000${String(count).padStart(2, '0')}-record-refusal`);
  };
  const withState = (state) => { const d = fresh(); writeRunState(d, state); return d; };
  const withRaw = (raw) => { const d = fresh(); fs.writeFileSync(path.join(d, 'run-state.json'), raw); return d; };
  const withDirAsFile = () => { const d = fresh(); fs.mkdirSync(path.join(d, 'run-state.json')); return d; };

  assert.strictEqual(adoptionRefusal(withState({ status: 'clean' })), 'terminal');
  assert.strictEqual(adoptionRefusal(withState({ status: 'closed' })), 'terminal');
  assert.strictEqual(adoptionRefusal(withState({ status: 'active', createdBy: 'release-standalone' })), 'release-standalone');
  assert.strictEqual(adoptionRefusal(withState({ createdBy: 'release-standalone' })), 'release-standalone');
  assert.strictEqual(adoptionRefusal(withRaw('{not json')), 'unreadable-run-state');
  assert.strictEqual(adoptionRefusal(withRaw('null')), 'unreadable-run-state');
  assert.strictEqual(adoptionRefusal(withRaw('[]')), 'unreadable-run-state');
  assert.strictEqual(adoptionRefusal(withDirAsFile()), 'unreadable-run-state');
  assert.strictEqual(adoptionRefusal(withState({ status: 'interrupted' })), 'dead');
  assert.strictEqual(adoptionRefusal(withState({ status: 'active' })), null);
  assert.strictEqual(adoptionRefusal(withState({})), null);
  assert.strictEqual(adoptionRefusal(withState({ status: 5 })), null);
  assert.strictEqual(adoptionRefusal(withState({ status: 'active', createdBy: 'flow' })), null);
  assert.strictEqual(adoptionRefusal(fresh()), null);
});

function assertReleaseSlugUnresolved(main) {
  const out = resolve({ cwd: main, env: {}, specSlug: 'release' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'unresolved');
}

test('#4151 AC1.1: --spec-slug release never returns a terminal release dir', () => {
  const main = gitRepo();
  const dir = mkRunDir(main, '2026-10-01T100000-release-standalone');
  writeRunState(dir, { status: 'clean', createdBy: 'release-standalone' });
  assertReleaseSlugUnresolved(main);
});

test('#4151 AC1.1: --spec-slug release never returns an active release-standalone dir', () => {
  const main = gitRepo();
  const dir = mkRunDir(main, '2026-10-01T100000-release-standalone');
  writeRunState(dir, { status: 'active', createdBy: 'release-standalone' });
  assertReleaseSlugUnresolved(main);
});

test('#4151 AC1.1: --spec-slug release never returns a dir whose run-state.json cannot be parsed', () => {
  const main = gitRepo();
  const dir = mkRunDir(main, '2026-10-01T100000-release');
  fs.writeFileSync(path.join(dir, 'run-state.json'), '{not json');
  assertReleaseSlugUnresolved(main);
});

test('#4151: a refused newest match falls through to an older adoptable one', () => {
  const main = gitRepo();
  const older = mkRunDir(main, '2026-01-01T000000-record-77');
  const newer = mkRunDir(main, '2026-06-01T000000-record-77');
  writeRunState(newer, { status: 'clean' });
  const out = resolve({ cwd: main, env: {}, specSlug: 'record-77' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.path, older);
});

test('#4151: step 1 PIPELINE_RUN_DIR is never refused, even when terminal and release-standalone', () => {
  const main = gitRepo();
  const dir = mkRunDir(main, '2026-10-02T100000-supplied');
  writeRunState(dir, { status: 'clean', createdBy: 'release-standalone' });
  const out = resolve({ cwd: main, env: { PIPELINE_RUN_DIR: dir }, specSlug: 'release' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(fs.realpathSync(out.path), fs.realpathSync(dir));
});

test('#4151: --create --standalone with --spec-slug mints fresh past a refused match', () => {
  const main = gitRepo();
  const dir = mkRunDir(main, '2026-01-01T000000-record-88');
  writeRunState(dir, { status: 'clean' });
  const out = resolve({
    cwd: main, env: {}, specSlug: 'record-88', standalone: 'record-88', create: true,
    now: new Date('2026-06-01T12:00:00Z'),
  });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.created, true);
  assert.strictEqual(path.basename(out.path), '2026-06-01T120000-record-88-standalone');
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
