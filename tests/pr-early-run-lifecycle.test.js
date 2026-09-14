'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #409: a pr-first run is born public — draft PR at run start, one push +
// checklist flip per phase exit, thereafter. The procedure is prose, not
// code, so prose is what has to be pinned — these tests catch the doc
// drifting out from under the deliverables/ACs it was written to satisfy.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const LIFECYCLE = read('plugin', 'skills', '_shared', 'pr-early-run-lifecycle.md');
const GIT_DISCIPLINE = read('plugin', 'skills', '_shared', 'git-discipline.md');
const WORKTREE_SETUP = read('plugin', 'skills', 'build', 'worktree-setup.md');
const BUILD_SKILL = read('plugin', 'skills', 'build', 'SKILL.md');
const TEST_SKILL = read('plugin', 'skills', 'test', 'SKILL.md');
// /review's Step 7 (phase exit) lives in the code-mode-steps.md sub-file since the #887
// dispatcher split — concatenate so this asserts against the text wherever it lives.
const REVIEW_SKILL =
  read('plugin', 'skills', 'review', 'SKILL.md') +
  '\n' +
  read('plugin', 'skills', 'review', 'code-mode-steps.md');
const STEPS_AND_GATES = read('plugin', 'skills', 'flow', 'steps-and-gates.md');
const WRAP_EXEC = read('plugin', 'skills', 'wrap-up', 'execution-and-verification.md');
const HOOKS_JS = read('plugin', 'bin', 'hooks.js');
// #2002 split the Phase-checklist update / Pre-merge title-description refresh procedures
// (and the merge-time gh-absent degrade row) out of LIFECYCLE into their own file — every
// phase-exit citer names both files now: the phase-exit push rule stays in LIFECYCLE's sibling
// `git-discipline.md`, but the checklist-update procedure itself lives here.
const CHECKLIST_REFRESH = read('plugin', 'skills', '_shared', 'pr-checklist-refresh.md');

test('the run marker is the unconditional first line of the PR body, with its plain-text companion immediately after', () => {
  assert.match(
    LIFECYCLE,
    /<!-- claude-tweaks-run: \{run-id\} -->\nclaude-tweaks-run: \{run-id\}\n\n### Spec summary/,
    'the sweep and reconciler key on the HTML-comment marker for a gh-present recognition; the plain-text companion (#929) is what a gh-absent MCP read sees instead, since the HTML-comment form is invisibly stripped from that read path',
  );
});

test('the phase checklist carries a plain-text delimiter pair alongside the HTML-comment pair (#929)', () => {
  assert.match(LIFECYCLE, /\[claude-tweaks-phases-start\]/);
  assert.match(LIFECYCLE, /\[claude-tweaks-phases-end\]/);
});

test('the push at run start is its own Bash call, never chained', () => {
  assert.match(
    LIFECYCLE,
    /git -C "\{worktree-path\}" push origin \{branch\}/,
    'the worktree-always gate denies a chained push entirely (IL-33)',
  );
});

test('run start checks for an existing PR by state before creating one, and distinguishes open from closed/merged', () => {
  assert.match(
    LIFECYCLE,
    /gh pr list --repo \{host\}\/\{owner\}\/\{repo\} --head \{branch\} --state all --json number,url,state,isDraft/,
    'a resumed or retried run must not duplicate a PR — state:all is required to see the closed/merged case and fall through to creation rather than misreading it as a live match',
  );
  assert.match(LIFECYCLE, /Never flip an already-non-draft open PR back to draft/);
});

test('identity resolution is host-qualified, so every --repo in this file works on GitHub Enterprise (#2021)', () => {
  assert.match(LIFECYCLE, /Resolve `\{host\}\/\{owner\}\/\{repo\}` once: `gh repo view --json nameWithOwner,url`/);
  assert.match(LIFECYCLE, /gh pr create --repo \{host\}\/\{owner\}\/\{repo\} --draft --base \{integration-branch\}/);
  assert.doesNotMatch(
    LIFECYCLE,
    /--repo \{owner\}\/\{repo\}/,
    'no --repo in this file should still be the bare (non-host-qualified) form',
  );
});

test('the phase checklist is delimited by HTML-comment markers for reliable re-composition', () => {
  assert.match(LIFECYCLE, /<!-- phases-start -->/);
  assert.match(LIFECYCLE, /<!-- phases-end -->/);
});

test('Fixes lines are safe because the PR stays draft until gates pass, not because of a scope guard', () => {
  assert.match(
    LIFECYCLE,
    /GitHub blocks merging a draft by default/,
    'unlike the retired dispatch-only durability procedure this file replaced (IL-128), whose PR opened only after review already passed and used Refs, this one opens before any gate has run',
  );
  assert.match(LIFECYCLE, /Fixes #\{n\}/);
});

test('the resume path re-verifies a recorded PR against GitHub before trusting it', () => {
  assert.match(
    LIFECYCLE,
    /gh pr view \{recorded-number\} --repo \{host\}\/\{owner\}\/\{repo\} --json state,isDraft,url/,
    'the branch could have been force-pushed or the PR closed since an earlier phase recorded it — trusting run-state.json blindly would silently skip the checklist update',
  );
});

test('phase-checklist updates degrade the same way phase-exit pushes do: log and continue, never block', () => {
  assert.match(CHECKLIST_REFRESH, /Best-effort, like the phase-exit push it follows/);
});

test('the skip/degrade table names local-merge, push failure, gh-create failure, gh-absent, and offline as distinct rows', () => {
  for (const needle of [
    'integration-model: local-merge',
    'Push at run start fails',
    '`gh pr create` fails twice',
    '`gh` absent',
    'Offline / no `origin` remote',
  ]) {
    assert.ok(LIFECYCLE.includes(needle), `skip/degrade table missing a row for: ${needle}`);
  }
});

test('gh-absent now has a documented MCP fallback for PR create/update, using the dual-marker scheme (#929)', () => {
  assert.match(
    LIFECYCLE,
    /mcp__github__create_pull_request.*update_pull_request.*documented fallback|documented fallback.*mcp__github__create_pull_request/s,
    '_shared/github-write-transport.md now documents a PR create/update exception — #929 replaced the stale "no MCP fallback" claim once the dual-marker scheme made a gh-absent PR recognizable',
  );
});

test('record-pr is cited as the sanctioned run-state write path, not a direct write', () => {
  assert.match(LIFECYCLE, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/hooks\.js" record-pr \{number\} \{url\}/);
  assert.match(LIFECYCLE, /run-state is written\s*\n?\s*only through `hooks\.js` verbs/);
});

test('git-discipline.md states the phase-exit push rule once, cites the spike headroom, and never persists a degrade flag', () => {
  assert.match(GIT_DISCIPLINE, /## Phase-exit push \(`integration-model: pr-first` only\)/);
  assert.match(GIT_DISCIPLINE, /≥50× headroom/);
  assert.match(
    GIT_DISCIPLINE,
    /never a flag written to `run-state\.json` that would suppress the \*next\*\s+phase's own push attempt/,
    'degradation must be per-attempt — a persisted flag would permanently disable pushes for the rest of the run after one transient failure',
  );
  assert.match(GIT_DISCIPLINE, /`local-merge` runs keep today's behavior: no phase-exit push, one push at finish/);
});

test('build/worktree-setup.md Step 6 cites the lifecycle file rather than restating its procedure', () => {
  assert.match(WORKTREE_SETUP, /Open the draft PR \(`integration-model: pr-first` only\)/);
  assert.match(WORKTREE_SETUP, /_shared\/pr-early-run-lifecycle\.md/);
});

test('build/SKILL.md invokes worktree-setup.md Step 6 immediately after the materialize commit', () => {
  assert.match(
    BUILD_SKILL,
    /Immediately after the materialize commit, in `worktree` mode only:\*\* run `build\/worktree-setup\.md` Step 6/,
  );
});

test('every phase-exit citation (build, test, review, polish via steps-and-gates, wrap-up) names both canonical files', () => {
  for (const [label, text] of [
    ['build/SKILL.md', BUILD_SKILL],
    ['test/SKILL.md', TEST_SKILL],
    ['review/SKILL.md + code-mode-steps.md', REVIEW_SKILL],
    ['flow/steps-and-gates.md (polish)', STEPS_AND_GATES],
  ]) {
    assert.match(text, /_shared\/git-discipline\.md/, `${label} must cite the phase-exit push rule`);
    assert.match(text, /_shared\/pr-checklist-refresh\.md/, `${label} must cite the checklist-update procedure`);
  }
});

test('wrap-up\'s phase exit explicitly defers merge-readiness to the merge-path sub-issue, not this one', () => {
  assert.match(WRAP_EXEC, /_shared\/git-discipline\.md/);
  assert.match(WRAP_EXEC, /_shared\/pr-checklist-refresh\.md/);
  assert.match(
    WRAP_EXEC,
    /does not mark the PR ready for merge or touch its draft state — that\s*\ntransition belongs to the merge-path sub-issue/,
  );
});

test('wrap-up does not duplicate the Fixes lines already carried by the draft PR body under pr-first', () => {
  assert.match(
    WRAP_EXEC,
    /no `Fixes` line here/,
    'the draft PR already carries one Fixes line per record from run start — a second, differently-scoped set here would risk disagreeing with it',
  );
});

test('#2002: pr-checklist-refresh.md carries the Phase-checklist update, Pre-merge refresh, and merge-time gh-absent degrade sections split out of LIFECYCLE', () => {
  assert.match(CHECKLIST_REFRESH, /## Phase-checklist update \(every phase exit\)/);
  assert.match(CHECKLIST_REFRESH, /## Pre-merge title\/description refresh/);
  assert.match(CHECKLIST_REFRESH, /## Merge-time gh-absent degrade/);
  // LIFECYCLE itself no longer carries these sections — moved, not duplicated.
  assert.doesNotMatch(LIFECYCLE, /## Phase-checklist update \(every phase exit\)/);
  assert.doesNotMatch(LIFECYCLE, /## Pre-merge title\/description refresh/);
});

test('bin/hooks.js record-pr verb writes run-state.json.pr through writeRunState, mirroring record-worktree', () => {
  assert.match(HOOKS_JS, /if \(cmd === 'record-pr'\)/);
  // Anchored on the property this test is named for — run-state reaches disk
  // only through the sanctioned `writeRunState` writer (CLAUDE.md's
  // write-ownership rule), and the field it writes is `pr` — rather than on the
  // byte-literal object that used to follow it. #1672 added an optional
  // `branch` member to that object, and the old literal pin failed only at
  // full-suite time on a branch whose own targeted suites were green, which is
  // the byte-pin hazard `docs/incident-log.md` already records. The two
  // original members are asserted separately below, so dropping either still
  // goes red.
  assert.match(HOOKS_JS, /ctxLib\.writeRunState\(runDir, \{ pr: /);
  assert.match(HOOKS_JS, /\{ number, url: urlArg \}/);
});
