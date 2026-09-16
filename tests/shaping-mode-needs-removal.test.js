'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readFlat = (rel) => read(rel).replace(/\s+/g, ' ');

// #1346 split shaping-mode.md at the ### Metadata block boundary; the needs:*
// stamp/compose/read-back content pinned here all landed in shaping-mode-stamping.md.
const SHAPING_MODE_FLAT = readFlat('plugin/skills/specify/shaping-mode-stamping.md');

test('shaping-mode.md states the needs:* removal-on-promotion bullet, generalizing #825', () => {
  assert.ok(SHAPING_MODE_FLAT.includes('generalizes #825'), 'shaping-mode.md must cite #825 in its needs:* removal bullet');
  assert.ok(SHAPING_MODE_FLAT.includes('remove every `needs:*`-prefixed label'), 'needs:* removal bullet missing its core statement');
});

test('shaping-mode.md resolves every unresolved needs-decision comment before removing needs:decision', () => {
  assert.ok(SHAPING_MODE_FLAT.includes('**Resolved:** promoted via /specify'), 'promotion-time resolution line text missing');
  assert.ok(SHAPING_MODE_FLAT.includes('updateIssueComment'), 'shaping-mode.md must use the GraphQL updateIssueComment mutation to edit the live comment in place');
  assert.ok(SHAPING_MODE_FLAT.includes('needs:definition` carries no such comment and needs no equivalent write'), 'shaping-mode.md must distinguish needs:definition (no comment) from needs:decision (has a comment)');
});

test('shaping-mode.md compose-then-write-once call removes both needs:definition and needs:decision', () => {
  assert.ok(SHAPING_MODE_FLAT.includes('--remove-label "needs:definition"'), 'compose call must remove needs:definition');
  assert.ok(SHAPING_MODE_FLAT.includes('--remove-label "needs:decision"'), 'compose call must remove needs:decision');
});

test('shaping-mode.md read-back verification asserts no needs:* label survived the write', () => {
  assert.ok(SHAPING_MODE_FLAT.includes('needs:') && /needs:\*/.test(SHAPING_MODE_FLAT), 'read-back verification must assert against the needs:* family, not just parked/solution:unjustified');
});

// #763 is a real, currently-closed record that hit exactly this bug: it entered shaping carrying
// needs:definition, had its open question resolved via an in-shaping AskUserQuestion, and was
// stamped ready + full scoring while needs:definition remained on the final label set (verified
// live via `gh issue view 763 --json labels` — both `ready` and `needs:definition` are present on
// the closed issue today). This is AC4's own named historical scenario.
//
// The pre-change stamp bullets below are read live from the last commit that touched
// shaping-mode.md before this task's own edit landed — not typed by hand — so this control can
// actually go red if the historical claim it grounds turns out to be wrong. The original pin
// (140ff9d7b, a commit on the feature branch that later became PR #1488/#1499) was never
// reachable from origin/main once that branch squash-merged — a fresh clone (CI's
// fetch-depth: 0 included; it only fetches what origin's refs reach) can't resolve it, so
// `git show {sha}:{path}` fails with "exists on disk, but not in {sha}" even though the path is
// real. Repinned to d111b1474 — the immediate parent, on origin/main's own history, of e2f499095
// (the squash-merged commit that added the needs:* removal bullet to shaping-mode.md) — which is
// reachable and carries the file's `parked`/`ready` bullets with no needs:* removal step between
// them, same as the original pin intended (verified: its `parked`/`ready` bullet pair matches the
// regex below with nothing in between).
const PRE_CHANGE_COMMIT = 'd111b14742e935487e64a7afa7949cd24e71b8d8';
// #2436: a shallow/partial clone (a common sandbox-provisioning shape) does not have this
// historical commit's tree reachable, even though it is on origin/main's real history — the same
// "exists on disk, but not in {sha}" failure the comment above already documents for the ORIGINAL
// pin. That failure previously happened at module-load time with no try/catch, crashing the whole
// file (a whole-file `node --test` failure) instead of just this one go-red control. Guard the
// read so every other test in this file is unaffected by an unreachable historical commit; only
// the one test that actually needs it degrades, with a stated reason.
let PRE_CHANGE_SHAPING_MODE = null;
let goRedControlSkip = false;
try {
  PRE_CHANGE_SHAPING_MODE = execFileSync(
    'git',
    ['show', `${PRE_CHANGE_COMMIT}:plugin/skills/specify/shaping-mode.md`],
    { cwd: ROOT, encoding: 'utf8' },
  );
} catch (err) {
  goRedControlSkip = `commit ${PRE_CHANGE_COMMIT} is not reachable in this checkout's git history ` +
    `(shallow/partial clone?) — the go-red control needs full history: ${String(err.message).split('\n')[0]}`;
}

test('go-red control (#763\'s bug): pre-change stamp bullets have no needs:* removal step at all', { skip: goRedControlSkip }, () => {
  // Scope to exactly the two-bullet region Task 10's brief edited between (the `parked` bullet
  // through the `ready` bullet) rather than the whole file — the full pre-change file legitimately
  // mentions `needs:definition` elsewhere (e.g. the Per-record invocation paragraph's unrelated
  // `next`-mode framing-guard note), so a whole-file substring check would false-negative here.
  const bulletMatch = PRE_CHANGE_SHAPING_MODE.match(
    /- \*\*`parked` present\*\*[^\n]*\n- \*\*`ready`\*\*[^\n]*/,
  );
  assert.ok(bulletMatch, `could not locate the parked/ready stamp bullets in commit ${PRE_CHANGE_COMMIT}'s shaping-mode.md`);
  const stampBullets = bulletMatch[0];
  assert.ok(!stampBullets.includes('needs:'), 'control must not already remove any needs:* label — this is the exact absence #763 hit and #825 reported');
});
