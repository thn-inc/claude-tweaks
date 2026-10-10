'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #1782: `_shared/worktree-setup.md`'s Post-creation catch-up unconditionally
// merges into every freshly created worktree, and its "Fail open on
// fetch/merge command failure" paragraph used to route EVERY non-conflict
// git failure — including a Windows `Filename too long` failure caused by
// this repo's deeply nested `.claude-tweaks/pipelines/**/spec-*/work/*.md`
// paths — into the same "log it and proceed" bucket, even though
// `core.longpaths` is a fixable local misconfiguration, not a connectivity
// problem. This suite pins the Windows-specific paragraph that carves that
// failure mode out of the fail-open path, plus its documented recovery
// sequence, and the related `git -C <main-checkout>` diagnostic note.
//
// #2722: the recovery sequence itself (not needed by an ordinary,
// non-failing catch-up) moved to its own sub-file,
// `_shared/worktree-setup-windows-longpath.md` — worktree-setup.md keeps
// only a short pointer paragraph naming the failure and citing that file.
// This suite now pins the pointer's position/content in worktree-setup.md
// separately from the recovery detail, which it pins against the sub-file.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const SHARED_WORKTREE_SETUP = read('plugin', 'skills', '_shared', 'worktree-setup.md');
const LONGPATH_RECOVERY = read('plugin', 'skills', '_shared', 'worktree-setup-windows-longpath.md');
const DONTS = read('docs', 'donts.md');

function longpathsPointerRegion() {
  const start = SHARED_WORKTREE_SETUP.indexOf('## Post-creation catch-up');
  assert.notStrictEqual(start, -1, '## Post-creation catch-up heading missing — this test has lost its anchor');
  const failOpenIdx = SHARED_WORKTREE_SETUP.indexOf('**Fail open on fetch/merge command failure**', start);
  assert.notStrictEqual(failOpenIdx, -1, 'Fail open paragraph missing — this test has lost its anchor');
  const windowsIdx = SHARED_WORKTREE_SETUP.indexOf('Windows: `Filename too long`', start);
  assert.notStrictEqual(windowsIdx, -1, 'Windows: `Filename too long` paragraph missing');
  assert.ok(windowsIdx < failOpenIdx, 'the Windows long-path paragraph must precede the Fail-open paragraph');
  return SHARED_WORKTREE_SETUP.slice(windowsIdx, failOpenIdx);
}

test('Post-creation catch-up: names Filename too long and core.longpaths, before Fail open, and cites the recovery sub-file', () => {
  const region = longpathsPointerRegion();
  assert.match(region, /Filename too long/);
  assert.match(region, /core\.longpaths/);
  assert.match(region, /_shared\/worktree-setup-windows-longpath\.md/, 'must cite the extracted recovery sub-file (#2722)');
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

test('worktree-setup-windows-longpath.md: states the repo-local core.longpaths scope rationale', () => {
  assert.match(LONGPATH_RECOVERY, /repo-local/, 'must state the repo-local scope rationale (linked worktrees share .git/config)');
});

test('worktree-setup-windows-longpath.md: documents the no-MERGE_HEAD symptom, the freshness check, and the reset-then-clean recovery', () => {
  assert.match(LONGPATH_RECOVERY, /MERGE_HEAD/);
  assert.match(LONGPATH_RECOVERY, /git status --porcelain/);
  assert.match(LONGPATH_RECOVERY, /git reset --hard HEAD/);
  assert.match(LONGPATH_RECOVERY, /git clean -f -d/);
  assert.match(LONGPATH_RECOVERY, /freshly created worktree with no commits or edits/, 'must state the fresh-worktree-only condition explicitly');
  assert.match(LONGPATH_RECOVERY, /git-discipline\.md/, 'must cite _shared/git-discipline.md\'s "never reset or discard" rule as the default this carves out');
});

test('Post-creation catch-up: the git -C main-checkout diagnostic rough edge is named once, with a cross-reference', () => {
  const gitCIdx = SHARED_WORKTREE_SETUP.indexOf('git -C <main-checkout>');
  assert.notStrictEqual(gitCIdx, -1, 'the opening paragraph must name the git -C <main-checkout> refusal');
  const nearby = SHARED_WORKTREE_SETUP.slice(gitCIdx, gitCIdx + 400);
  assert.match(nearby, /docs\/donts\.md/, 'must cross-reference docs/donts.md near the git -C <main-checkout> mention');
  assert.match(DONTS, /git -C <main-checkout>/, 'docs/donts.md must carry the corresponding rule');
});
