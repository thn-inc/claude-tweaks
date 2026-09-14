'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #1782: `_shared/worktree-setup.md`'s Post-creation catch-up unconditionally
// merges into every freshly created worktree, and its "Fail open on
// fetch/merge command failure" paragraph used to route EVERY non-conflict
// git failure — including a Windows `Filename too long` failure caused by
// this repo's deeply nested `.claude-tweaks/pipelines/**/spec-*/work/*.md`
// paths — into the same "log it and proceed" bucket, even though
// `core.longpaths` is a fixable local misconfiguration, not a connectivity
// problem. This suite pins the new Windows-specific paragraph that carves
// that failure mode out of the fail-open path, plus its documented recovery
// sequence, and the related `git -C <main-checkout>` diagnostic note.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const SHARED_WORKTREE_SETUP = read('plugin', 'skills', '_shared', 'worktree-setup.md');
const DONTS = read('docs', 'donts.md');

function longpathsRegion() {
  const start = SHARED_WORKTREE_SETUP.indexOf('## Post-creation catch-up');
  assert.notStrictEqual(start, -1, '## Post-creation catch-up heading missing — this test has lost its anchor');
  const failOpenIdx = SHARED_WORKTREE_SETUP.indexOf('**Fail open on fetch/merge command failure**', start);
  assert.notStrictEqual(failOpenIdx, -1, 'Fail open paragraph missing — this test has lost its anchor');
  const windowsIdx = SHARED_WORKTREE_SETUP.indexOf('Windows: `Filename too long`', start);
  assert.notStrictEqual(windowsIdx, -1, 'Windows: `Filename too long` paragraph missing');
  assert.ok(windowsIdx < failOpenIdx, 'the Windows long-path paragraph must precede the Fail-open paragraph');
  return SHARED_WORKTREE_SETUP.slice(windowsIdx, failOpenIdx);
}

test('Post-creation catch-up: names Filename too long, core.longpaths, and repo-local scope, before Fail open', () => {
  const region = longpathsRegion();
  assert.match(region, /Filename too long/);
  assert.match(region, /core\.longpaths/);
  assert.match(region, /repo-local/, 'must state the repo-local scope rationale (linked worktrees share .git/config)');
});

test('Post-creation catch-up: the Fail-open paragraph explicitly excludes the Windows long-path failure', () => {
  const failOpenIdx = SHARED_WORKTREE_SETUP.indexOf('**Fail open on fetch/merge command failure**');
  const region = SHARED_WORKTREE_SETUP.slice(failOpenIdx, failOpenIdx + 400);
  assert.match(
    region,
    /Windows long-path failure/,
    'the fail-open paragraph must state that the Windows long-path failure is excluded from it, not silently routed through it',
  );
});

test('Post-creation catch-up: documents the no-MERGE_HEAD symptom, the freshness check, and the reset-then-clean recovery', () => {
  const region = longpathsRegion();
  assert.match(region, /MERGE_HEAD/);
  assert.match(region, /git status --porcelain/);
  assert.match(region, /git reset --hard HEAD/);
  assert.match(region, /git clean -f -d/);
  assert.match(region, /freshly created worktree with no commits or edits/, 'must state the fresh-worktree-only condition explicitly');
  assert.match(region, /git-discipline\.md/, 'must cite _shared/git-discipline.md\'s "never reset or discard" rule as the default this carves out');
});

test('Post-creation catch-up: the git -C main-checkout diagnostic rough edge is named once, with a cross-reference', () => {
  const gitCIdx = SHARED_WORKTREE_SETUP.indexOf('git -C <main-checkout>');
  assert.notStrictEqual(gitCIdx, -1, 'the opening paragraph must name the git -C <main-checkout> refusal');
  const nearby = SHARED_WORKTREE_SETUP.slice(gitCIdx, gitCIdx + 400);
  assert.match(nearby, /docs\/donts\.md/, 'must cross-reference docs/donts.md near the git -C <main-checkout> mention');
  assert.match(DONTS, /git -C <main-checkout>/, 'docs/donts.md must carry the corresponding rule');
});
