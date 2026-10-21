'use strict';

// Run-dir attribution under concurrent sessions (#62).
//
// resolveRunDir's fallback — "the newest non-terminal run under cwd" — is only
// correct when exactly one pipeline run is in flight system-wide. The moment two
// sessions each have one, any hook invocation without PIPELINE_RUN_DIR attributes
// its event to whichever run sorts newest. Two consequences were observed in
// production: a run's events.jsonl accumulating commits from three unrelated
// worktrees, and a run whose issue had been closed hours earlier stamped
// `interrupted` forever by a bystander session's session-end.
//
// The second is self-perpetuating, which is why it never cleared: the
// `interrupted` stamp is itself what keeps the run non-terminal, so it keeps
// winning the same fallback for every session that follows.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ctxLib = require('../plugin/bin/lib/hooks/context.js');
const sessionEnd = require('../plugin/bin/lib/hooks/session-end.js');
const preCompact = require('../plugin/bin/lib/hooks/pre-compact.js');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');

function project() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-attr-')));
}

// `id` doubles as the run-dir name's sort key — runs are selected newest-first
// by lexical name, so a later id is the one the old fallback would pick.
function mkRun(cwd, id, state) {
  const dir = path.join(cwd, '.claude-tweaks', 'pipelines', id);
  fs.mkdirSync(dir, { recursive: true });
  if (state) fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify(state));
  return dir;
}

const readEvents = (dir) => {
  const f = path.join(dir, 'events.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
};
const readState = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'run-state.json'), 'utf8'));

// ─── resolveRun ────────────────────────────────────────────────────────────

test('a run owned by this session wins over a newer run owned by another', () => {
  const cwd = project();
  const mine = mkRun(cwd, '2026-07-01T090000-mine', { status: 'active', sessionId: 'me' });
  mkRun(cwd, '2026-07-02T090000-theirs', { status: 'active', sessionId: 'them' });

  // Newest-first ordering would pick "theirs" — ownership overrides recency.
  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, 'me'), { dir: mine, attribution: 'session' });
});

test('a run owned by another session is never resolved for this one', () => {
  const cwd = project();
  mkRun(cwd, '2026-07-01T090000-theirs', { status: 'active', sessionId: 'them' });

  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, 'me'), { dir: null, attribution: null });
});

test('an unowned run is still resolved, tagged as a guess', () => {
  const cwd = project();
  // Ownership is only stamped by `record-worktree`, so a run that never
  // provisioned a worktree has none — it may well be ours.
  const run = mkRun(cwd, '2026-07-01T090000-unowned', { status: 'active' });

  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, 'me'), { dir: run, attribution: 'fallback' });
});

test('an unowned run is preferred over a foreign-owned newer one', () => {
  const cwd = project();
  const unowned = mkRun(cwd, '2026-07-01T090000-unowned', { status: 'active' });
  mkRun(cwd, '2026-07-02T090000-theirs', { status: 'active', sessionId: 'them' });

  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, 'me'), { dir: unowned, attribution: 'fallback' });
});

test('an unknown caller keeps the pre-#62 behavior exactly', () => {
  const cwd = project();
  mkRun(cwd, '2026-07-01T090000-a', { status: 'active', sessionId: 'them' });
  const newest = mkRun(cwd, '2026-07-02T090000-b', { status: 'active', sessionId: 'also-them' });

  // record-worktree and close-run deliberately resolve runs they do NOT own so
  // they can report that fact — filtering by an owner we cannot compare against
  // would break them.
  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, null), { dir: newest, attribution: 'fallback' });
  assert.strictEqual(ctxLib.resolveRunDir(cwd, {}), newest);
});

test('PIPELINE_RUN_DIR still wins over everything and is never a guess', () => {
  const cwd = project();
  const pinned = mkRun(cwd, '2026-07-01T090000-pinned', { status: 'active', sessionId: 'them' });
  mkRun(cwd, '2026-07-02T090000-mine', { status: 'active', sessionId: 'me' });

  assert.deepStrictEqual(
    ctxLib.resolveRun(cwd, { PIPELINE_RUN_DIR: pinned }, 'me'),
    { dir: pinned, attribution: 'env' },
  );
});

test('a clean run is terminal and never resolved, even for its owner', () => {
  const cwd = project();
  mkRun(cwd, '2026-07-01T090000-done', { status: 'clean', sessionId: 'me' });

  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, 'me'), { dir: null, attribution: null });
});

// ─── the two reported symptoms ─────────────────────────────────────────────

test("a bystander session's session-end cannot stamp interrupted on another session's run", () => {
  const cwd = project();
  const theirs = mkRun(cwd, '2026-07-01T090000-theirs', { status: 'active', sessionId: 'them' });

  const owned = ctxLib.resolveRun(cwd, {}, 'bystander');
  sessionEnd.run({ input: { reason: 'exit', session_id: 'bystander' }, ownedRun: owned, cwd });

  assert.strictEqual(readState(theirs).status, 'active', 'a finished run must not be flagged by a passer-by');
  assert.deepStrictEqual(readEvents(theirs), [], "and must not receive the bystander's events");
});

test('session-end does not stamp interrupted on a guessed run, but still records the event', () => {
  const cwd = project();
  const unowned = mkRun(cwd, '2026-07-01T090000-unowned', { status: 'active' });

  const owned = ctxLib.resolveRun(cwd, {}, 'someone');
  sessionEnd.run({ input: { reason: 'exit', session_id: 'someone' }, ownedRun: owned, cwd });

  // The stamp is the self-perpetuating part — withheld. The breadcrumb is not.
  assert.strictEqual(readState(unowned).status, 'active');
  const ev = readEvents(unowned);
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].type, 'session-end');
  assert.strictEqual(ev[0].attribution, 'fallback', 'a guessed event must be filterable');
});

test('session-end DOES stamp interrupted on a run this session owns', () => {
  const cwd = project();
  const mine = mkRun(cwd, '2026-07-01T090000-mine', { status: 'active', sessionId: 'me' });

  const owned = ctxLib.resolveRun(cwd, {}, 'me');
  sessionEnd.run({ input: { reason: 'exit', session_id: 'me' }, ownedRun: owned, cwd });

  assert.strictEqual(readState(mine).status, 'interrupted', 'the warning must still fire for a real interruption');
  assert.strictEqual(readEvents(mine)[0].attribution, undefined, 'a known-owner event carries no guess tag');
});

test('pre-compact does not overwrite lastEvent on a guessed run', () => {
  const cwd = project();
  const unowned = mkRun(cwd, '2026-07-01T090000-unowned', { status: 'active', lastEvent: 'build-start' });

  const owned = ctxLib.resolveRun(cwd, {}, 'someone');
  preCompact.run({ input: { trigger: 'auto' }, ownedRun: owned, cwd });

  assert.strictEqual(readState(unowned).lastEvent, 'build-start');
  assert.strictEqual(readEvents(unowned)[0].attribution, 'fallback');
});

test('a run that already went interrupted is not re-stamped by its owner', () => {
  const cwd = project();
  const mine = mkRun(cwd, '2026-07-01T090000-mine', { status: 'interrupted', sessionId: 'me' });

  const owned = ctxLib.resolveRun(cwd, {}, 'me');
  sessionEnd.run({ input: { reason: 'exit', session_id: 'me' }, ownedRun: owned, cwd });

  assert.strictEqual(readState(mine).status, 'interrupted');
});

test('the attribution tag never displaces an event\'s own type or timestamp', () => {
  const cwd = project();
  const run = mkRun(cwd, '2026-07-01T090000-unowned', { status: 'active' });

  // Same invariant CLAUDE.md's spread rule protects: derived fields win.
  ctxLib.appendEvent(run, 'commit', { type: 'forged', ts: 'forged', attribution: 'forged' }, 'fallback');
  const ev = readEvents(run)[0];
  assert.strictEqual(ev.type, 'commit');
  assert.notStrictEqual(ev.ts, 'forged');
  assert.strictEqual(ev.attribution, 'fallback');
});

// ─── unadopted mints (#721) ────────────────────────────────────────────────

test('fallback never selects an unadopted mint (no run-state.json, no decisions.md)', () => {
  const cwd = project();
  const real = mkRun(cwd, '2026-07-01T090000-real', { status: 'active' });
  mkRun(cwd, '2026-07-02T090000-mint', null); // bare mkdir — sorts newest

  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, 'me'), { dir: real, attribution: 'fallback' });
  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, null), { dir: real, attribution: 'fallback' });
});

test('a standalone run dir (decisions.md, no run-state.json) still wins fallback', () => {
  const cwd = project();
  const dir = mkRun(cwd, '2026-07-01T090000-tidy-standalone', null);
  fs.writeFileSync(path.join(dir, 'decisions.md'), '');

  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, 'me'), { dir, attribution: 'fallback' });
});

test('only unadopted mints exist — resolves null rather than guessing into one', () => {
  const cwd = project();
  mkRun(cwd, '2026-07-02T090000-mint', null);

  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, 'me'), { dir: null, attribution: null });
  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, null), { dir: null, attribution: null });
});

test('a run with a corrupt run-state.json and no decisions.md is still not a mint — presence, not parseability', () => {
  const cwd = project();
  const dir = mkRun(cwd, '2026-07-01T090000-corrupt', null);
  fs.writeFileSync(path.join(dir, 'run-state.json'), '{"status":"active", "worktree": "/trunc');

  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, 'me'), { dir, attribution: 'fallback' });
});

// #3363: flow Step 2.8 writes the claim line before anything else, so a
// freshly minted run dir holds ONLY that line in decisions.md (no run-state.json)
// and is still unadopted — a sibling session's events must not land in it.
const CLAIM_ONLY = '## /flow\n- AUTO 18:42:06 — Step 2.8: claimed #7 (bin/claim-targets.js, transport: git). Reversibility: high.\n';

function mkClaimedMint(cwd, state = null) {
  const mint = mkRun(cwd, '2026-07-02T090000-mint', state);
  fs.writeFileSync(path.join(mint, 'decisions.md'), CLAIM_ONLY);
  return mint;
}

test('fallback never selects a claim-log-only mint (decisions.md holds only the Step 2.8 claim line, no run-state.json) (#3363)', () => {
  const cwd = project();
  const real = mkRun(cwd, '2026-07-01T090000-real', { status: 'active' });
  mkClaimedMint(cwd);

  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, 'me'), { dir: real, attribution: 'fallback' });
  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, null), { dir: real, attribution: 'fallback' });
});

test('a claim-log-only mint is the only run — resolves null (#3363)', () => {
  const cwd = project();
  mkClaimedMint(cwd);

  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, 'me'), { dir: null, attribution: null });
  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, null), { dir: null, attribution: null });
});

test('AC1.1: a foreign session\'s hook event never lands in a claim-log-only mint\'s events.jsonl (#3363)', () => {
  const cwd = project();
  const mint = mkClaimedMint(cwd);

  const owned = ctxLib.resolveRun(cwd, {}, 'other-session');
  sessionEnd.run({ input: { reason: 'exit', session_id: 'other-session' }, ownedRun: owned, cwd });

  assert.deepStrictEqual(readEvents(mint), []);
});

test('a claim line plus any other decisions.md content is adopted (#3363)', () => {
  const cwd = project();
  const mint = mkClaimedMint(cwd);
  fs.appendFileSync(path.join(mint, 'decisions.md'), '- AUTO 18:43:00 — Manifesto: levers written. Reversibility: n/a.\n');

  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, 'me'), { dir: mint, attribution: 'fallback' });
});

test('a claim-log-only dir with run-state.json is adopted (#3363)', () => {
  const cwd = project();
  const mint = mkClaimedMint(cwd, { status: 'active' });

  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, 'me'), { dir: mint, attribution: 'fallback' });
});

test('an unreadable decisions.md (non-ENOENT read error) is adopted, not an unadopted mint (#3363)', () => {
  const cwd = project();
  const dir = mkRun(cwd, '2026-07-02T090000-mint', null);
  fs.mkdirSync(path.join(dir, 'decisions.md')); // readFileSync -> EISDIR

  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, 'me'), { dir, attribution: 'fallback' });
});

// #3665: Step 2.8's degraded-path bookkeeping (file-overlap / bot:in-progress
// projection skip lines, a paraphrased claim line) is still a fresh mint. The
// reader inherits the widened claim-log-only class from classifyDecisions.
const OVERLAP_SKIP_LINE = '- SKIP 18:42:05 — Step 2.8 file-overlap warning (skipped): condition: preflight-records.js exited non-zero or gh unavailable → fallback: overlap warning not computed; claim proceeds on the named targets only. Reversibility: n/a.\n';
const DEGRADED_SKIP_LINE = "- SKIP 18:42:07 — Step 2.8 bot:in-progress projection (degraded): condition: label still absent on #7 after one mergeLabelNames retry → fallback: claim kept; dispatch's label pre-filter will not see this hold. Reversibility: n/a.\n";
const PARAPHRASED_ONLY = '## /flow\n- AUTO 07:42:07 — spec #7 — flow/claim-targets: Claimed issue #7 for this run (claims-registry blob write, state: absent -> live). Reversibility: high.\n';
const DEGRADED_MINTS = [
  ['overlap-skip', `${CLAIM_ONLY}${OVERLAP_SKIP_LINE}`],
  ['degraded-projection-skip', `${CLAIM_ONLY}${DEGRADED_SKIP_LINE}`],
  ['paraphrased-claim', PARAPHRASED_ONLY],
];

for (const [kind, text] of DEGRADED_MINTS) {
  test(`fallback never selects a degraded Step 2.8 mint: ${kind} (no run-state.json) (#3665)`, () => {
    const cwd = project();
    const real = mkRun(cwd, '2026-07-01T090000-real', { status: 'active' });
    const mint = mkRun(cwd, '2026-07-02T090000-mint', null);
    fs.writeFileSync(path.join(mint, 'decisions.md'), text);

    assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, 'me'), { dir: real, attribution: 'fallback' });
    assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, null), { dir: real, attribution: 'fallback' });
  });
}

test('a degraded Step 2.8 mint plus a Manifesto line is adopted (#3665)', () => {
  const cwd = project();
  const mint = mkRun(cwd, '2026-07-02T090000-mint', null);
  fs.writeFileSync(path.join(mint, 'decisions.md'), `${CLAIM_ONLY}${OVERLAP_SKIP_LINE}- AUTO 18:43:00 — Manifesto: levers written. Reversibility: n/a.\n`);

  assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, 'me'), { dir: mint, attribution: 'fallback' });
});

// ─── worktree-bound foreign candidates (#1402) ─────────────────────────────
//
// #1033's own events.jsonl accumulated six events belonging to unrelated,
// concurrently-live sibling worktrees — every one carried attribution
// "fallback". Neither fallback branch checked the guessed run's worktree
// binding against the caller's own cwd; these pin that it now does, via
// classifyOwnership (#1098), without touching the 'session'/'env' arms.
// Needs a REAL git repo + linked worktrees — classifyOwnership only ever
// returns 'foreign' when it can prove the caller's cwd resolves to a
// different, still-live worktree than the recorded binding; a bare tmpdir
// (as `project()` above builds) has no git repo, so it can only ever read
// 'indeterminate' and would never exercise this branch.

test('an unknown-session fallback skips a candidate bound to a different live worktree, in favor of an older compatible one', () => {
  const main = gitRepo();
  const callerWt = linkedWorktreeOf(main);
  const otherWt = linkedWorktreeOf(main);
  const compatible = mkRun(main, '2026-07-01T090000-mine', { status: 'active', worktree: callerWt });
  mkRun(main, '2026-07-02T090000-foreign', { status: 'active', worktree: otherWt });

  // Newest-first would pick "foreign" under the pre-#1402 guess — the
  // worktree-binding check must skip it and fall through to the older,
  // worktree-compatible candidate instead.
  assert.deepStrictEqual(ctxLib.resolveRun(callerWt, {}, null), { dir: compatible, attribution: 'fallback' });
});

test('an unknown-session fallback resolves null when every non-mint candidate is bound to a different live worktree', () => {
  const main = gitRepo();
  const callerWt = linkedWorktreeOf(main);
  const otherWt = linkedWorktreeOf(main);
  mkRun(main, '2026-07-01T090000-foreign', { status: 'active', worktree: otherWt });

  assert.deepStrictEqual(ctxLib.resolveRun(callerWt, {}, null), { dir: null, attribution: null });
});

test('a known-session fallback skips an unowned candidate bound to a different live worktree', () => {
  const main = gitRepo();
  const callerWt = linkedWorktreeOf(main);
  const otherWt = linkedWorktreeOf(main);
  const compatible = mkRun(main, '2026-07-01T090000-mine', { status: 'active', worktree: callerWt });
  mkRun(main, '2026-07-02T090000-foreign', { status: 'active', worktree: otherWt });

  assert.deepStrictEqual(ctxLib.resolveRun(callerWt, {}, 'me'), { dir: compatible, attribution: 'fallback' });
});

test('a known-session fallback still resolves an unowned run with no worktree binding at all — the asymmetry is preserved', () => {
  const main = gitRepo();
  const callerWt = linkedWorktreeOf(main);
  const unbound = mkRun(main, '2026-07-01T090000-unbound', { status: 'active' });

  assert.deepStrictEqual(ctxLib.resolveRun(callerWt, {}, 'me'), { dir: unbound, attribution: 'fallback' });
});

test('a foreign-owned run is still never resolved for another session, worktree binding notwithstanding', () => {
  const main = gitRepo();
  const callerWt = linkedWorktreeOf(main);
  mkRun(main, '2026-07-01T090000-theirs', { status: 'active', sessionId: 'them', worktree: callerWt });

  assert.deepStrictEqual(ctxLib.resolveRun(callerWt, {}, 'me'), { dir: null, attribution: null });
});

// ─── same-session sibling worktrees (#1099) ────────────────────────────────
//
// #965: CLAUDE_CODE_SESSION_ID is shared across every subagent of a session,
// so `owner === me` alone (the pre-#1099 session-scoped arm) cannot tell this
// caller apart from a sibling agent of the SAME session bound to a different,
// still-live worktree. These pin that resolveRun's session-scoped arm now
// also runs the candidate through classifyOwnership, exactly as the
// unknown-session fallback arm has since #1410 — a 'foreign' verdict skips
// the candidate instead of returning it as `attribution: 'session'`.

test('a known-session candidate bound to a DIFFERENT live worktree is skipped, not returned as attribution:session', () => {
  const main = gitRepo();
  const callerWt = linkedWorktreeOf(main);
  const siblingWt = linkedWorktreeOf(main);
  mkRun(main, '2026-07-01T090000-sibling', { status: 'active', sessionId: 'me', worktree: siblingWt });

  // Pre-#1099, `owner === me` would have returned this run immediately as
  // `attribution: 'session'` — the exact #965 sibling-stomp shape. It must
  // now be skipped, falling through to resolveRun's unowned/null result
  // (no unowned candidate exists here).
  assert.deepStrictEqual(ctxLib.resolveRun(callerWt, {}, 'me'), { dir: null, attribution: null });
});

test('a known-session candidate bound to a different live worktree is skipped in favor of an older UNOWNED, worktree-compatible candidate', () => {
  const main = gitRepo();
  const callerWt = linkedWorktreeOf(main);
  const siblingWt = linkedWorktreeOf(main);
  const compatible = mkRun(main, '2026-07-01T090000-unbound', { status: 'active' }); // no sessionId, no worktree
  mkRun(main, '2026-07-02T090000-sibling', { status: 'active', sessionId: 'me', worktree: siblingWt });

  // Newest-first would hit the sibling first; it must be skipped (foreign,
  // per classifyOwnership's worktree-binding proof) and the scan falls
  // through to the older, worktree-compatible unowned run instead.
  assert.deepStrictEqual(ctxLib.resolveRun(callerWt, {}, 'me'), { dir: compatible, attribution: 'fallback' });
});

test('a known-session candidate bound to THIS caller\'s own worktree still classifies mine and returns attribution:session (dual case)', () => {
  const main = gitRepo();
  const callerWt = linkedWorktreeOf(main);
  const mine = mkRun(main, '2026-07-01T090000-mine', { status: 'active', sessionId: 'me', worktree: callerWt });
  const siblingWt = linkedWorktreeOf(main);
  mkRun(main, '2026-07-02T090000-sibling', { status: 'active', sessionId: 'me', worktree: siblingWt });

  // The caller's own binding (mine, older) must still win via ownership,
  // even though the newer sibling run shares the same session id — proving
  // the skip above is scoped to a genuine worktree mismatch, not blanket
  // distrust of same-session candidates.
  assert.deepStrictEqual(ctxLib.resolveRun(callerWt, {}, 'me'), { dir: mine, attribution: 'session' });
});

test('a known-session candidate with NO worktree binding at all still returns attribution:session (indeterminate, not foreign)', () => {
  const main = gitRepo();
  const callerWt = linkedWorktreeOf(main);
  const unbound = mkRun(main, '2026-07-01T090000-mine', { status: 'active', sessionId: 'me' }); // owned, no binding

  // classifyOwnership degrades an unbound run to 'indeterminate' from inside
  // a linked worktree (never 'foreign' on unprovable evidence) — this must
  // still resolve as the caller's own session, byte-identical to pre-#1099.
  assert.deepStrictEqual(ctxLib.resolveRun(callerWt, {}, 'me'), { dir: unbound, attribution: 'session' });
});

// close-run's own regression (whole-branch review finding, pre-v6.110.0): its
// implicit (no --run) fallback shares resolveRun's unknown-session arm with
// post-tool-use.js's event attribution, but needs the OPPOSITE answer for a
// worktree-foreign candidate — it must still find that run so closeRunState's
// own sessionId check can report "belongs to another session," rather than
// silently reporting "no run found" the way the bare #1410 filter above does.
// includeWorktreeForeign is the opt-out close-run's resolveRunArg call passes;
// every other caller (including the tests above) omits it and keeps the
// worktree-safe fallback.
test('includeWorktreeForeign lets an unknown-session fallback still find a candidate bound to a different live worktree (close-run\'s need)', () => {
  const main = gitRepo();
  const callerWt = linkedWorktreeOf(main);
  const otherWt = linkedWorktreeOf(main);
  const foreign = mkRun(main, '2026-07-01T090000-foreign', { status: 'active', worktree: otherWt });

  assert.deepStrictEqual(ctxLib.resolveRun(callerWt, {}, null), { dir: null, attribution: null }, 'sanity: the default (no opt-out) still filters it, per the test above');
  assert.deepStrictEqual(
    ctxLib.resolveRun(callerWt, {}, null, { includeWorktreeForeign: true }),
    { dir: foreign, attribution: 'fallback' },
  );
  assert.strictEqual(ctxLib.resolveRunDir(callerWt, {}, null, { includeWorktreeForeign: true }), foreign);
});

// ─── ad-hoc dirs are never a fallback guess (#2783) ───────────────────────────
//
// An `-adhoc-standalone` dir holds only one session's friction events and is
// always session-stamped, so it is that session's via the 'session' arm or not
// at all. As a fallback guess it became ctx.runDir (E1, the stamps gate) and the
// implicit target of every no-`--run` verb for every OTHER caller.

test('#2783: an unknown-session fallback skips a newer ad-hoc dir in favor of an older formal run', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const formal = mkRun(main, '2026-10-01T000000-spec-5', { status: 'active' });
  mkRun(main, '2026-10-02T000000-adhoc-standalone', { status: 'active', sessionId: 'someone', worktree: wt });
  assert.deepStrictEqual(ctxLib.resolveRun(main, {}, null), { dir: formal, attribution: 'fallback' });
});

test('#2783: an unknown-session fallback resolves null when the only non-terminal dirs are ad-hoc', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  mkRun(main, '2026-10-02T000000-adhoc-standalone', { status: 'active', sessionId: 'someone', worktree: wt });
  assert.deepStrictEqual(ctxLib.resolveRun(main, {}, null), { dir: null, attribution: null });
});

test('#2783: a known-session caller never guesses into an unowned ad-hoc dir', () => {
  const main = gitRepo();
  mkRun(main, '2026-10-02T000000-adhoc-standalone', { status: 'active', worktree: '/gone/w' });
  assert.deepStrictEqual(ctxLib.resolveRun(main, {}, 'me'), { dir: null, attribution: null });
});

test('#2783 e2e: a commit from the main checkout is not E1-denied because some session holds an ad-hoc dir bound to a live worktree', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  mkRun(main, '2026-10-02T000000-adhoc-standalone', { status: 'active', sessionId: 'sess-e1', worktree: wt });
  const hooks = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: main, session_id: 'sess-e1' });
  const out = require('node:child_process').execFileSync('node', [hooks, 'pre-tool-use'], { input, cwd: main, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '' } });
  assert.doesNotMatch(out, /"permissionDecision":"deny"/, out);
  assert.doesNotMatch(out, /adhoc-standalone/, out);
});

// ─── strict attribution for event writes (#3515) ──────────────────────────────
//
// The #3401 incident: a fresh /flow mint whose decisions.md held only Step 2.8
// claim-log lines (no run-state.json yet) defeated #721's isUnadoptedMint, so a
// sibling session's hook events were guessed into it. Every resolution now skips
// a claim-log-only mint. `strictAttribution` is the opt-in hooks.js passes for
// ownedRun: it also skips any candidate bound to a worktree other than the
// caller's. E1's owner-unfiltered runDir stays non-strict.

function writeDecisions(dir, text) {
  fs.writeFileSync(path.join(dir, 'decisions.md'), text);
}

test('#3515: a claim-log-only mint (no run-state.json) is never guessed into, strict or not; an older standalone run wins', () => {
  const cwd = project();
  const standalone = mkRun(cwd, '2026-07-01T090000-standalone');
  writeDecisions(standalone, '## /tidy\n- AUTO 10:00:00 — x. Reversibility: high.\n');
  const mint = mkRun(cwd, '2026-07-02T090000-record-7');
  writeDecisions(mint, CLAIM_ONLY);

  assert.deepStrictEqual(
    ctxLib.resolveRun(cwd, {}, 'me', { strictAttribution: true }),
    { dir: standalone, attribution: 'fallback' },
  );
  assert.deepStrictEqual(
    ctxLib.resolveRun(cwd, {}, 'me'),
    { dir: standalone, attribution: 'fallback' },
    'non-strict callers skip the claim-log-only mint too',
  );
  assert.strictEqual(ctxLib.resolveRunDir(cwd, {}), standalone, 'E1 resolution skips the mint');
});

test('#3515 non-strict: only a claim-log-only mint exists → null with no dropped key', () => {
  const cwd = project();
  writeDecisions(mkRun(cwd, '2026-07-02T090000-record-7'), CLAIM_ONLY);
  for (const sid of ['me', null]) {
    assert.deepStrictEqual(ctxLib.resolveRun(cwd, {}, sid), { dir: null, attribution: null }, `session id ${sid}`);
  }
});

test('#3515 close-run\'s no---run fallback (unknown session, includeWorktreeForeign) skips a never-adopted claim-log-only mint, finds an adopted run bound to another worktree', () => {
  const main = gitRepo();
  const otherWt = linkedWorktreeOf(main);
  writeDecisions(mkRun(main, '2026-07-02T090000-record-7'), CLAIM_ONLY);
  assert.deepStrictEqual(
    ctxLib.resolveRun(main, {}, null, { includeWorktreeForeign: true }),
    { dir: null, attribution: null },
    'only a never-adopted mint exists: "no run found", matching #721\'s adopted-runs-only posture',
  );
  const adopted = mkRun(main, '2026-07-01T090000-record-3', { status: 'active', worktree: otherWt });
  assert.deepStrictEqual(
    ctxLib.resolveRun(main, {}, null, { includeWorktreeForeign: true }),
    { dir: adopted, attribution: 'fallback' },
  );
});

test('#3515 strict: only a claim-log-only mint exists → dropped, never guessed', () => {
  const cwd = project();
  const mint = mkRun(cwd, '2026-07-02T090000-record-7');
  writeDecisions(mint, CLAIM_ONLY);
  for (const sid of ['me', null]) {
    assert.deepStrictEqual(
      ctxLib.resolveRun(cwd, {}, sid, { strictAttribution: true }),
      { dir: null, attribution: null, dropped: ['2026-07-02T090000-record-7 (claim-log-only mint)'] },
      `session id ${sid}`,
    );
  }
});

test('AC2.1: strict: a caller in the main checkout skips an unowned run bound to a linked worktree', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const bound = mkRun(main, '2026-07-01T090000-bound', { status: 'active', worktree: wt });

  assert.deepStrictEqual(
    ctxLib.resolveRun(main, {}, 'me', { strictAttribution: true }),
    { dir: null, attribution: null, dropped: [`2026-07-01T090000-bound (bound to ${wt})`] },
  );
  assert.deepStrictEqual(ctxLib.resolveRun(main, {}, 'me'), { dir: bound, attribution: 'fallback' }, 'non-strict still guesses');
  assert.strictEqual(ctxLib.resolveRunDir(main, {}), bound, 'E1 unchanged');
});

test('strict: a caller inside the bound worktree still resolves it', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const bound = mkRun(main, '2026-07-01T090000-bound', { status: 'active', worktree: wt });
  assert.deepStrictEqual(
    ctxLib.resolveRun(wt, {}, 'me', { strictAttribution: true }),
    { dir: bound, attribution: 'fallback' },
  );
});

test('strict: a candidate whose bound worktree was removed from disk is skipped', () => {
  const main = gitRepo();
  const gone = path.join(main, 'gone-wt');
  mkRun(main, '2026-07-01T090000-bound', { status: 'active', worktree: gone });
  assert.deepStrictEqual(
    ctxLib.resolveRun(main, {}, 'me', { strictAttribution: true }),
    { dir: null, attribution: null, dropped: [`2026-07-01T090000-bound (bound to ${gone})`] },
  );
});

test('strict + includeWorktreeForeign: guard (b) is disabled', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const bound = mkRun(main, '2026-07-01T090000-bound', { status: 'active', worktree: wt });
  assert.deepStrictEqual(
    ctxLib.resolveRun(main, {}, 'me', { strictAttribution: true, includeWorktreeForeign: true }),
    { dir: bound, attribution: 'fallback' },
  );
});

test('AC2.1 e2e: hooks.js pre-compact from the main checkout leaves a claim-log-only mint untouched and reports the drop on stderr', () => {
  const main = gitRepo();
  const mint = mkRun(main, '2026-07-02T090000-record-7');
  writeDecisions(mint, CLAIM_ONLY);
  const hooks = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');
  const res = require('node:child_process').spawnSync('node', [hooks, 'pre-compact'], {
    input: JSON.stringify({ session_id: 's1', trigger: 'auto' }),
    cwd: main,
    encoding: 'utf8',
    env: { ...process.env, PIPELINE_RUN_DIR: '' },
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stderr, /^attribution: no run dir attributed — /m);
  assert.ok(res.stderr.includes(path.basename(mint)), res.stderr);
  assert.ok(!fs.existsSync(path.join(mint, 'events.jsonl')), 'no event was written into the mint');
});

// The #3401 incident's own write path: pre-tool-use's gitignored-target
// exemption logs `gate-exempt-gitignored` against ctx.runDir (E1's non-strict
// resolution), not ownedRun — so the claim-log-only mint skip must hold there too.
test('#3515 incident e2e: a sibling worktree Write to a gitignored path writes nothing into a newer claim-log-only mint', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  fs.writeFileSync(path.join(wt, '.gitignore'), '.superpowers/\n');
  const owned = mkRun(main, '2026-07-01T090000-record-6', { status: 'active', worktree: wt, sessionId: 'sib' });
  const mint = mkRun(main, '2026-07-02T090000-record-7');
  writeDecisions(mint, CLAIM_ONLY);

  const hooks = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');
  const target = path.join(wt, '.superpowers', 'x.md');
  const res = require('node:child_process').spawnSync('node', [hooks, 'pre-tool-use'], {
    input: JSON.stringify({ session_id: 'sib', tool_name: 'Write', tool_input: { file_path: target }, cwd: wt }),
    cwd: wt,
    encoding: 'utf8',
    env: { ...process.env, PIPELINE_RUN_DIR: '' },
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(!fs.existsSync(path.join(mint, 'events.jsonl')), `no event was written into the mint: ${fs.existsSync(path.join(mint, 'events.jsonl')) ? fs.readFileSync(path.join(mint, 'events.jsonl'), 'utf8') : ''}`);
  assert.strictEqual(ctxLib.resolveRunDir(wt, {}), owned, 'E1 resolution skips the mint');
});
