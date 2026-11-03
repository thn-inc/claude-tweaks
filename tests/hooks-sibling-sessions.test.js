'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  findConflictingSession, findSessionOnWorktree, findLiveClaim, matchesRecordRef, normalizeRecordRef, tokenize,
} = require('../plugin/bin/lib/hooks/sibling-sessions');

// Frozen `git worktree list --porcelain` fixtures — never live command output,
// per [IL-80]: the lock-reason format is git's own unversioned implementation
// detail, and worktree-reap.js's own tests (tests/hooks-worktree-reap.test.js)
// establish exactly this convention. Pids are deterministic, not mocked via an
// injected liveness function: `process.pid` is guaranteed alive for the life
// of this process, and 4194304 is above pid_max on both macOS and Linux, so no
// process can ever hold it — the same "definitely dead" pid
// hooks-worktree-reap.test.js already relies on.
const DEAD_PID = 4194304;

function porcelainWith({ path: wtPath, branch, lockReason }) {
  const lines = [
    'worktree /repo',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    `worktree ${wtPath}`,
    'HEAD 2222222222222222222222222222222222222222',
    `branch refs/heads/${branch}`,
  ];
  if (lockReason !== undefined) lines.push(lockReason === null ? 'locked' : `locked ${lockReason}`);
  lines.push('');
  return lines.join('\n');
}

function stubRun(porcelain) {
  return () => porcelain;
}

test('findConflictingSession: a live, token-matching lock returns a match naming path/branch/pid', () => {
  const porcelain = porcelainWith({
    path: '/repo/.claude/worktrees/wt-308',
    branch: 'worktree-spec-308',
    lockReason: `claude session x (pid ${process.pid} start Fri Aug  7 14:40:15 2026)`,
  });
  const match = findConflictingSession('308', { run: stubRun(porcelain), sessionId: null });
  assert.deepStrictEqual(match, {
    path: '/repo/.claude/worktrees/wt-308',
    branch: 'worktree-spec-308',
    pid: process.pid,
  });
});

test('findConflictingSession: a dead-pid lock returns no match', () => {
  const porcelain = porcelainWith({
    path: '/repo/.claude/worktrees/wt-308',
    branch: 'worktree-spec-308',
    lockReason: `claude session x (pid ${DEAD_PID} start Fri Aug  7 09:00:00 2026)`,
  });
  const match = findConflictingSession('308', { run: stubRun(porcelain), sessionId: null });
  assert.strictEqual(match, null);
});

test('findConflictingSession: an unparseable lock reason returns no match and does not throw', () => {
  const porcelain = porcelainWith({
    path: '/repo/.claude/worktrees/wt-308',
    branch: 'worktree-spec-308',
    lockReason: 'being edited by hand',
  });
  assert.doesNotThrow(() => {
    const match = findConflictingSession('308', { run: stubRun(porcelain), sessionId: null });
    assert.strictEqual(match, null);
  });
});

test('findConflictingSession: a match owned by the calling session (per run-state) is excluded, not reported as a conflict', () => {
  const porcelain = porcelainWith({
    path: '/repo/.claude/worktrees/wt-308',
    branch: 'worktree-spec-308',
    lockReason: `claude session x (pid ${process.pid} start Fri Aug  7 14:40:15 2026)`,
  });
  const listRunDirsWithState = () => [
    { dir: '/repo/.claude-tweaks/pipelines/run-1', state: { sessionId: 'me', worktree: '/repo/.claude/worktrees/wt-308' } },
  ];
  const match = findConflictingSession('308', {
    run: stubRun(porcelain),
    sessionId: 'me',
    listRunDirsWithState,
  });
  assert.strictEqual(match, null);
});

test('findConflictingSession: the same fixture WITHOUT a matching owner still reports a conflict (control for the exclusion test above)', () => {
  const porcelain = porcelainWith({
    path: '/repo/.claude/worktrees/wt-308',
    branch: 'worktree-spec-308',
    lockReason: `claude session x (pid ${process.pid} start Fri Aug  7 14:40:15 2026)`,
  });
  const listRunDirsWithState = () => [
    { dir: '/repo/.claude-tweaks/pipelines/run-1', state: { sessionId: 'somebody-else', worktree: '/repo/.claude/worktrees/wt-308' } },
  ];
  const match = findConflictingSession('308', {
    run: stubRun(porcelain),
    sessionId: 'me',
    listRunDirsWithState,
  });
  assert.ok(match, 'a live match owned by a DIFFERENT session must still be reported');
  assert.strictEqual(match.path, '/repo/.claude/worktrees/wt-308');
});

test('findConflictingSession: a worktree recorded only by an ad-hoc friction dir under the calling session id is still reported (#2783 — an ad-hoc dir is not a record-worktree claim)', () => {
  // Since #2783 every EnterWorktree — a dispatched subagent's included, which
  // shares the parent's session id — mints an -adhoc-standalone dir recording
  // that session id and worktree. That dir holds friction events only; it must
  // not make a sibling subagent's live worktree read as the caller's own claim.
  const porcelain = porcelainWith({
    path: '/repo/.claude/worktrees/wt-308',
    branch: 'worktree-spec-308',
    lockReason: `claude session x (pid ${process.pid} start Fri Aug  7 14:40:15 2026)`,
  });
  const listRunDirsWithState = () => [
    { dir: '/repo/.claude-tweaks/pipelines/2026-10-16T120000-adhoc-standalone', state: { sessionId: 'me', worktree: '/repo/.claude/worktrees/wt-308' } },
  ];
  const match = findConflictingSession('308', {
    run: stubRun(porcelain),
    sessionId: 'me',
    listRunDirsWithState,
  });
  assert.ok(match, 'an ad-hoc dir sharing the caller session id must not exclude the worktree as the caller\'s own');
  assert.strictEqual(match.path, '/repo/.claude/worktrees/wt-308');
});

test('findConflictingSession: record ref "19" does not match branch "flow-spec-192-193" (token boundary, not substring)', () => {
  const porcelain = porcelainWith({
    path: '/repo/.claude/worktrees/wt-flow',
    branch: 'flow-spec-192-193',
    lockReason: `claude session x (pid ${process.pid} start Fri Aug  7 14:40:15 2026)`,
  });
  const match = findConflictingSession('19', { run: stubRun(porcelain), sessionId: null });
  assert.strictEqual(match, null);
});

test('findConflictingSession: record ref "192" DOES match branch "flow-spec-192-193" (control for the token-boundary test above)', () => {
  const porcelain = porcelainWith({
    path: '/repo/.claude/worktrees/wt-flow',
    branch: 'flow-spec-192-193',
    lockReason: `claude session x (pid ${process.pid} start Fri Aug  7 14:40:15 2026)`,
  });
  const match = findConflictingSession('192', { run: stubRun(porcelain), sessionId: null });
  assert.ok(match, 'a genuine delimited-segment match must still be found');
});

test('findConflictingSession: no worktrees at all is a no-op', () => {
  const match = findConflictingSession('308', { run: stubRun(''), sessionId: null });
  assert.strictEqual(match, null);
});

test('findConflictingSession: an unresolvable git call (run returns null) is a no-op, not a throw', () => {
  assert.doesNotThrow(() => {
    const match = findConflictingSession('308', { run: () => null, sessionId: null });
    assert.strictEqual(match, null);
  });
});

test('findConflictingSession: a missing recordRef resolves to no match, even against a fixture that DOES hold a live worktree (guards against an empty ref vacuously matching everything)', () => {
  const porcelain = porcelainWith({
    path: '/repo/.claude/worktrees/wt-308',
    branch: 'worktree-spec-308',
    lockReason: `claude session x (pid ${process.pid} start Fri Aug  7 14:40:15 2026)`,
  });
  assert.strictEqual(findConflictingSession(undefined, { run: stubRun(porcelain), sessionId: null }), null);
  assert.strictEqual(findConflictingSession(null, { run: stubRun(porcelain), sessionId: null }), null);
  assert.strictEqual(findConflictingSession('', { run: stubRun(porcelain), sessionId: null }), null);
});

test('findConflictingSession: self-exclusion survives a symlink in the worktree path (git canonicalizes it, path.resolve does not)', () => {
  // Real filesystem, not a frozen string fixture — the bug this guards
  // against is a REPRESENTATION mismatch (symlink-resolved vs not) between
  // git's own porcelain output and record-worktree's path.resolve-only
  // stamp, which a fake-path fixture (identical strings by construction)
  // cannot exercise. real/target is where the worktree "actually" lives;
  // link/wt is a symlinked path to it, mirroring how a session might reach
  // the same worktree via a symlinked ancestor directory (e.g. macOS's own
  // /tmp -> /private/tmp).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sib-'));
  const real = path.join(root, 'real');
  fs.mkdirSync(real);
  const target = path.join(real, 'wt');
  fs.mkdirSync(target);
  const linkDir = path.join(root, 'link');
  fs.symlinkSync(real, linkDir);
  const viaSymlink = path.join(linkDir, 'wt');
  assert.notStrictEqual(fs.realpathSync(viaSymlink), viaSymlink, 'the symlinked path must actually differ from its resolved form for this test to mean anything');

  // git's porcelain reports the resolved form; record-worktree stamped the
  // symlinked form (as `path.resolve` would leave it) — exactly the
  // divergence found in review.
  const porcelain = porcelainWith({
    path: fs.realpathSync(viaSymlink),
    branch: 'worktree-spec-308',
    lockReason: `claude session x (pid ${process.pid} start Fri Aug  7 14:40:15 2026)`,
  });
  const listRunDirsWithState = () => [
    { dir: '/repo/.claude-tweaks/pipelines/run-1', state: { sessionId: 'me', worktree: viaSymlink } },
  ];
  const match = findConflictingSession('308', { run: stubRun(porcelain), sessionId: 'me', listRunDirsWithState });
  assert.strictEqual(match, null, 'the session\'s own worktree must not be reported as a sibling conflict merely because of symlink representation');
});

// ─── unit coverage for the token-matching helpers themselves ───────────────

// ---- findSessionOnWorktree: exact branch or path, never tokens ----

const LIVE_LOCK = `locked claude session x (pid ${process.pid} start Fri Aug  7 14:40:15 2026)`;
const WT_FIX = '/repo/.claude/worktrees/fix';
const WT_LOGIN = '/repo/.claude/worktrees/fix-login';
// `branch: null` is a detached worktree. Real porcelain shape, more than one worktree entry.
function porcelainOf(...entries) {
  return [
    'worktree /repo', 'HEAD 1111111111111111111111111111111111111111', 'branch refs/heads/main', '',
    ...entries.flatMap(({ path: p, branch, lock = LIVE_LOCK }) => [
      `worktree ${p}`,
      'HEAD 2222222222222222222222222222222222222222',
      branch === null ? 'detached' : `branch refs/heads/${branch}`,
      ...(lock ? [lock] : []),
      '',
    ]),
  ].join('\n');
}
const onWorktree = (target, porcelain, opts = {}) => findSessionOnWorktree(target, { run: stubRun(porcelain), sessionId: null, ...opts });
const LOGIN = { path: WT_LOGIN, branch: 'worktree-fix-login' };

test('findSessionOnWorktree: head worktree-fix versus an in-use worktree-fix-login is null, though the tokens match', () => {
  const porcelain = porcelainOf(LOGIN);
  assert.strictEqual(onWorktree({ branch: 'worktree-fix', worktreePath: WT_FIX }, porcelain), null);
  assert.ok(findConflictingSession('worktree-fix', { run: stubRun(porcelain), sessionId: null }), 'control: the token read does hit');
});

test('findSessionOnWorktree: the same head on its own in-use worktree is a hit, past an earlier token match', () => {
  const porcelain = porcelainOf(LOGIN, { path: WT_FIX, branch: 'worktree-fix' });
  assert.deepStrictEqual(onWorktree({ branch: 'worktree-fix', worktreePath: WT_FIX }, porcelain), {
    path: WT_FIX, branch: 'worktree-fix', pid: process.pid,
  });
});

test('findSessionOnWorktree: a branch checked out at another path is a hit', () => {
  const porcelain = porcelainOf({ path: '/elsewhere/wt', branch: 'worktree-fix' });
  assert.strictEqual(onWorktree({ branch: 'worktree-fix', worktreePath: WT_FIX }, porcelain).path, '/elsewhere/wt');
});

test('findSessionOnWorktree: a path-only match is a hit, with no branch, and on a detached worktree', () => {
  for (const branch of ['some-other-branch', null]) {
    const porcelain = porcelainOf({ path: WT_FIX, branch });
    assert.strictEqual(onWorktree({ branch: null, worktreePath: WT_FIX }, porcelain).path, WT_FIX, String(branch));
    assert.strictEqual(onWorktree({ branch: 'worktree-fix', worktreePath: WT_FIX }, porcelain).path, WT_FIX, String(branch));
  }
});

test('findSessionOnWorktree: a null branch never matches a detached worktree elsewhere', () => {
  assert.strictEqual(onWorktree({ branch: null, worktreePath: WT_FIX }, porcelainOf({ path: '/elsewhere/wt', branch: null })), null);
});

test('findSessionOnWorktree: a path match survives a symlink on either side (git canonicalizes, path.resolve does not)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sib-'));
  try {
    const real = path.join(root, 'real');
    fs.mkdirSync(path.join(real, 'wt'), { recursive: true });
    const linkDir = path.join(root, 'link');
    fs.symlinkSync(real, linkDir);
    const viaSymlink = path.join(linkDir, 'wt');
    const canonical = fs.realpathSync(viaSymlink);
    assert.notStrictEqual(canonical, viaSymlink, 'the two forms must actually differ for this test to mean anything');
    // The real shape: a symlinked stamp against git's canonical porcelain. The reverse is what pins the entry side.
    assert.strictEqual(onWorktree({ branch: null, worktreePath: viaSymlink }, porcelainOf({ path: canonical, branch: 'other' })).path, canonical);
    assert.strictEqual(onWorktree({ branch: null, worktreePath: canonical }, porcelainOf({ path: viaSymlink, branch: 'other' })).path, viaSymlink);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findSessionOnWorktree: a stale lock, an unparseable lock and no lock are null', () => {
  for (const lock of [`locked claude session x (pid ${DEAD_PID} start Fri Aug  7 09:00:00 2026)`, 'locked being edited by hand', null]) {
    const porcelain = porcelainOf({ path: WT_FIX, branch: 'worktree-fix', lock });
    assert.strictEqual(onWorktree({ branch: 'worktree-fix', worktreePath: WT_FIX }, porcelain), null, String(lock));
  }
});

test('findSessionOnWorktree: this session\'s own run-state worktree is excluded, an ad-hoc dir\'s is not', () => {
  const porcelain = porcelainOf({ path: WT_FIX, branch: 'worktree-fix' });
  const target = { branch: 'worktree-fix', worktreePath: WT_FIX };
  const listed = (dir, sessionId) => () => [{ dir, state: { sessionId, worktree: WT_FIX } }];
  const opts = (listRunDirsWithState) => ({ sessionId: 'me', listRunDirsWithState });
  assert.strictEqual(onWorktree(target, porcelain, opts(listed('/r/2026-10-31T120000-record-1', 'me'))), null);
  assert.ok(onWorktree(target, porcelain, opts(listed('/r/2026-10-31T120000-record-1', 'other'))), 'another session\'s run');
  assert.ok(onWorktree(target, porcelain, opts(listed('/r/2026-10-31T120000-adhoc-standalone', 'me'))), 'an ad-hoc dir is no claim');
});

test('findSessionOnWorktree: fails open on a failed git read, and on an empty target', () => {
  assert.strictEqual(onWorktree({ branch: 'worktree-fix', worktreePath: WT_FIX }, null), null);
  assert.strictEqual(onWorktree({ branch: null, worktreePath: null }, porcelainOf({ path: WT_FIX, branch: null })), null);
});

test('tokenize splits on both "/" and "-" and drops empty segments', () => {
  assert.deepStrictEqual(tokenize('flow-spec-192-193'), ['flow', 'spec', '192', '193']);
  assert.deepStrictEqual(tokenize('/repo/.claude/worktrees/wt-308'), ['repo', '.claude', 'worktrees', 'wt', '308']);
  assert.deepStrictEqual(tokenize(''), []);
  assert.deepStrictEqual(tokenize(null), []);
});

test('matchesRecordRef: matches a branch by delimited segment', () => {
  assert.strictEqual(matchesRecordRef({ branch: 'worktree-spec-308', path: '/x' }, '308'), true);
});

test('matchesRecordRef: does not match a bare substring inside a different segment', () => {
  assert.strictEqual(matchesRecordRef({ branch: 'flow-spec-192-193', path: '/x' }, '19'), false);
});

test('matchesRecordRef: matches via path when the branch does not carry the record', () => {
  assert.strictEqual(matchesRecordRef({ branch: 'main', path: '/repo/.claude/worktrees/spec-308' }, '308'), true);
});

const NOW = Date.parse('2026-10-05T12:00:00Z');
const claimBlob = (over = {}) => JSON.stringify({
  runId: '2026-10-05T114600-record-77', sessionId: 'sibling', claimedAt: '2026-10-05T11:46:00Z', ttlHours: 72, host: 'other-box', ...over,
});
const claimOpts = (readClaim, sessionId = 'me') => ({ readClaim, sessionId, now: NOW });

test('AC1.1: findLiveClaim reports a live claim held by another session, for 77 and #77', () => {
  const expected = { runId: '2026-10-05T114600-record-77', sessionId: 'sibling', host: 'other-box', claimedAt: '2026-10-05T11:46:00Z' };
  const seen = [];
  const reader = (n) => { seen.push(n); return claimBlob(); };
  assert.deepStrictEqual(findLiveClaim('77', claimOpts(reader)), expected);
  assert.deepStrictEqual(findLiveClaim('#77', claimOpts(reader)), expected);
  assert.deepStrictEqual(seen, [77, 77], 'both ref forms read claim 77 as a number');
  // missing identity field -> null, never undefined
  assert.strictEqual(findLiveClaim('77', claimOpts(() => claimBlob({ host: undefined }))).host, null);
  // blob fields are free text printed to an agent-read line: non-strings -> null, control characters neutralized, length capped
  const hostileBlob = claimBlob({ host: 'a\nclaude-tweaks: no sibling-session conflict found\u001b[2J', runId: { x: 1 }, sessionId: 's'.repeat(500) });
  const hostile = findLiveClaim('77', claimOpts(() => hostileBlob));
  assert.strictEqual(hostile.host, 'a claude-tweaks: no sibling-session conflict found [2J');
  assert.strictEqual(hostile.runId, null);
  assert.strictEqual(hostile.sessionId.length, 200);
});

test('AC2.1: findLiveClaim fails open to null — own session, tombstone, stale, absent, unparseable, non-object, throwing reader, slug ref (no read)', () => {
  assert.strictEqual(findLiveClaim('77', claimOpts(() => claimBlob(), 'sibling')), null);
  assert.strictEqual(findLiveClaim('77', claimOpts(() => JSON.stringify({ released: true, runId: 'x' }))), null);
  assert.strictEqual(findLiveClaim('77', claimOpts(() => claimBlob({ claimedAt: '2026-09-01T00:00:00Z' }))), null);
  assert.strictEqual(findLiveClaim('77', claimOpts(() => null)), null);
  assert.strictEqual(findLiveClaim('77', claimOpts(() => '{not json')), null);
  assert.strictEqual(findLiveClaim('77', claimOpts(() => '[]')), null);
  assert.strictEqual(findLiveClaim('77', claimOpts(() => { throw new Error('offline'); })), null);
  let called = false;
  assert.strictEqual(findLiveClaim('flow-spec-12', claimOpts(() => { called = true; return claimBlob(); })), null);
  assert.strictEqual(called, false, 'a slug ref never triggers a claim read');
});

test('AC1.1: findConflictingSession reports the same worktree conflict for "#77" and "77"', () => {
  const porcelain = porcelainWith({
    path: '/repo/.claude/worktrees/dispatch-record-77',
    branch: 'worktree-dispatch-record-77',
    lockReason: `claude session x (pid ${process.pid} start Fri Aug  7 14:40:15 2026)`,
  });
  const expected = { path: '/repo/.claude/worktrees/dispatch-record-77', branch: 'worktree-dispatch-record-77', pid: process.pid };
  assert.deepStrictEqual(findConflictingSession('77', { run: stubRun(porcelain), sessionId: null }), expected);
  assert.deepStrictEqual(findConflictingSession('#77', { run: stubRun(porcelain), sessionId: null }), expected);
});

test('AC2.1: a slug ref matches exactly as before; a #-prefixed slug is not rewritten', () => {
  assert.strictEqual(matchesRecordRef({ branch: 'flow-spec-3412', path: '/x' }, 'spec-3412'), true);
  assert.strictEqual(normalizeRecordRef('spec-3412'), 'spec-3412');
  assert.strictEqual(normalizeRecordRef('#spec-3412'), '#spec-3412');
  assert.strictEqual(matchesRecordRef({ branch: 'flow-spec-3412', path: '/x' }, '#spec-3412'), false);
});

test('normalizeRecordRef strips one leading # from a numeric ref only, and the token boundary still holds', () => {
  assert.strictEqual(normalizeRecordRef('#77'), '77');
  assert.strictEqual(normalizeRecordRef('77'), '77');
  assert.strictEqual(normalizeRecordRef(77), '77');
  assert.strictEqual(matchesRecordRef({ branch: 'flow-spec-192-193', path: '/x' }, '#19'), false);
});
