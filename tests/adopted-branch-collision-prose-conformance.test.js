'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
const { formatStopCard } = require('../plugin/bin/lib/worktree/remote-branch-collision');
// #2844: build/worktree-setup.md Step 1.6's remote-only stale-branch check
// sits inside Steps 1-3, which the skip-creation guard skips for a run that
// is already inside a worktree — so a dispatched run never reached it and an
// unrelated same-name origin branch surfaced only as a rejected push. The
// classifier has unit coverage in
// tests/bin-lib/worktree/remote-branch-collision.test.js; this file pins the
// prose that wires it onto the skip path and states its posture. Read live:
// just-shipped prose expected to evolve with Step 1.6, which it mirrors.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const norm = (text) => text.replace(/\s+/g, ' ');

const WORKTREE_SETUP = read('plugin', 'skills', 'build', 'worktree-setup.md');
const CHECK = read('plugin', 'skills', 'build', 'adopted-branch-collision-check.md');
const PR_EARLY = read('plugin', 'skills', '_shared', 'pr-early-run-lifecycle.md');

test('the skip-creation guard routes an adopted branch to the collision check', () => {
  const start = WORKTREE_SETUP.indexOf('Skip creation when already inside an externally-created worktree');
  const end = WORKTREE_SETUP.indexOf('## Base ref', start);
  assert.ok(start !== -1 && end !== -1, 'skip-creation guard anchors missing');
  const region = norm(WORKTREE_SETUP.slice(start, end));
  assert.match(region, /build\/adopted-branch-collision-check\.md/);
  assert.match(region, /#2844/);
  assert.match(region, /before Spec Step 1's materialize commit and Step 6's push/);
});

test('the check never stops on this run\'s own earlier push (the resume case)', () => {
  const text = norm(CHECK);
  assert.match(text, /`mine` — `origin`'s tip is an ancestor of `HEAD`/);
  assert.match(text, /never stop on this/i);
});

test('an unrelated branch hard-stops in auto mode; an unreachable remote fails open', () => {
  const text = norm(CHECK);
  assert.match(
    text,
    /\*\*Auto mode:\*\*[\s\S]*?not\*\* a lever `_shared\/auto-mode-contract\.md` lists as silenceable/,
  );
  assert.match(text, /stop the build/i);
  assert.match(text, /fail open/i);
  assert.match(text, /never treat "could not look" as `absent`/);
});

test('the documented stop card heading and options match what formatStopCard renders', () => {
  const card = formatStopCard({ branch: '{branch}', remoteSha: 'abc', prLookup: { ok: true, prs: [] } });
  const heading = card.split('\n')[0];
  assert.ok(CHECK.includes(heading), 'card heading drifted between prose and code');
  const text = norm(CHECK);
  for (const fragment of ['git branch -m {branch}-{suffix}', 'git push origin --delete {branch}']) {
    assert.ok(card.includes(fragment), `code card lost: ${fragment}`);
    assert.ok(text.includes(fragment), `prose card lost: ${fragment}`);
  }
});

test('pr-early-run-lifecycle.md no longer claims the pushed branch is always freshly created', () => {
  const text = norm(PR_EARLY);
  assert.match(text, /That holds on the creation path only/);
  assert.match(text, /build\/adopted-branch-collision-check\.md/);
});

test('the adopted-branch collision stop is registered in auto-mode-contract.md\'s HARD-GATE row, and the build sub-file cites the registration (#3094)', () => {
  const contract = read('plugin', 'skills', '_shared', 'auto-mode-contract.md');
  const row = contract.split('\n').find((l) => l.includes('HARD-GATE / BLOCKED / STOP conditions'));
  assert.ok(row, 'HARD-GATE / BLOCKED / STOP row not found');
  assert.match(row, /`\/build`'s adopted-branch collision stop \(`build\/adopted-branch-collision-check\.md`/);
  assert.match(norm(CHECK), /a registered HARD-GATE \(`_shared\/auto-mode-contract\.md`'s HARD-GATE \/ BLOCKED \/ STOP row\)/);
});
