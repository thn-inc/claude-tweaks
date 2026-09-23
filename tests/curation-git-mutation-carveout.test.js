// tests/curation-git-mutation-carveout.test.js — pins record #1676's resolution of the
// curation-engine.md dispatch-contract vs. project-skill git-mutation conflict: section 4's
// "no judge-side git mutations" prohibition carries an explicit, narrow carve-out for a
// project skill's own sanctioned bookkeeping write to a dedicated tracking branch (the four
// health skills' `health-state` branch, `_shared/health-state.md`), since that write never
// touches the worktree the prohibition actually protects (the #1140 shared-git-index hazard).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const ENGINE = fs.readFileSync(path.join(SKILLS, 'wrap-up', 'curation-engine.md'), 'utf8');
const CURATION = fs.readFileSync(path.join(SKILLS, 'wrap-up', 'skill-curation.md'), 'utf8');

// Frozen pre-change excerpt of the "No judge-side git mutations" paragraph's opening two
// sentences, as they read before #1676's carve-out was inserted — a string literal, not a
// live read, so it stays stable across future edits to the live file [IL-80]. Proves the
// carve-out assertions below can actually go red [IL-105]: they must NOT match this text.
const PRE_CHANGE_NO_CARVEOUT = '**No judge-side git mutations — the controller\'s serial-commit pass.** '
  + 'Every dispatch prompt — the fan-out and the singleton alike — inlines this instruction '
  + 'verbatim: *never run `git add`, `git commit`, or any other git mutation; an '
  + 'auto-apply-eligible finding is made as a working-tree edit only, its payload names the '
  + 'edited file as `targetPath`, and its `commit` field is left absent — the controller '
  + 'commits.* The fan-out shares one worktree, so concurrent judge commits raced on the '
  + 'shared git index (#1140 — observed in run 2026-08-20T153031-spec-1065: a judge reported '
  + 'its edit "swept into a sibling\'s commit" with a fabricated hash while the edit sat '
  + 'uncommitted in the tree).';

function section4(text) {
  return text.slice(text.indexOf('## 4. Parallel dispatch'));
}

test('curation-engine.md section 4 carries the git-mutation carve-out heading', () => {
  const s4 = section4(ENGINE);
  assert.match(
    s4,
    /Carve-out: a project skill's own sanctioned bookkeeping write to a dedicated tracking branch is not a git mutation/,
    'carve-out heading present in section 4',
  );
  assert.doesNotMatch(
    PRE_CHANGE_NO_CARVEOUT,
    /Carve-out: a project skill's own sanctioned bookkeeping write/,
    'pattern must NOT match the pre-change text (proves it can go red)',
  );
});

test('carve-out names the hazard boundary: worktree branch vs. a distinct tracking branch', () => {
  const s4 = section4(ENGINE);
  assert.match(s4, /distinct from both the worktree's feature branch and the integration branch/);
  assert.doesNotMatch(
    PRE_CHANGE_NO_CARVEOUT,
    /distinct from both the worktree's feature branch and the integration branch/,
  );
});

test('carve-out names the write mechanism that qualifies (git plumbing, never git add/commit on the worktree)', () => {
  const s4 = section4(ENGINE);
  assert.match(s4, /git hash-object.*mktree.*commit-tree.*push/);
  assert.match(s4, /never `git add`\/`git commit` against the worktree's own checkout/);
});

test('carve-out cites the health-state branch and skill-curation.md\'s Record-the-audit step as the standing example', () => {
  const s4 = section4(ENGINE);
  assert.match(s4, /_shared\/health-state\.md/);
  assert.match(s4, /health-state.*branch/);
  assert.match(s4, /wrap-up\/skill-curation\.md.*Record the audit/);
  assert.match(s4, /validate-findings/);
});

test('carve-out is narrow — still forbids git add/commit/push against the worktree\'s own feature branch', () => {
  const s4 = section4(ENGINE);
  assert.match(
    s4,
    /still never runs `git add`, `git commit`, or `git push` against the worktree's own feature branch/,
  );
});

test('skill-curation.md\'s Record-the-audit step (the concrete instance the carve-out covers) is unchanged', () => {
  assert.match(CURATION, /\*\*Record the audit\.\*\*/);
  assert.match(CURATION, /harness-health\.js"\s+validate-findings/);
});
