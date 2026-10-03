'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #1711: /flow's multi-spec shared-worktree Step 1 ("Create once, up front") had no
// "already isolated" detection before calling EnterWorktree(name=...) — under this
// project's own worktree-always policy, an interactive session is always already
// worktree-isolated by the time it reaches /flow, so that call refused every time.
// The workaround one session took (delegating the shared worktree to a Task subagent)
// traded that refusal for a second, unrecoverable one at teardown: a subagent holding
// the worktree cannot call ExitWorktree on it either. This spec extracts the detection
// already proven correct twice in this plugin (build/worktree-setup.md's Common Step 1,
// routine/create-and-update.md's Step 0) into one shared "Adopt-or-create" section in
// _shared/worktree-setup.md, wires flow/multi-spec.md's Step 1 to it (the actual fix),
// and migrates the two existing hand-rolled consumers to cite it instead of restating
// the detection logic inline.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const SHARED_WORKTREE_SETUP = read('plugin', 'skills', '_shared', 'worktree-setup.md');
const BUILD_WORKTREE_SETUP = read('plugin', 'skills', 'build', 'worktree-setup.md');
const ROUTINE_CREATE_AND_UPDATE = read('plugin', 'skills', 'routine', 'create-and-update.md');
const MULTI_SPEC = read('plugin', 'skills', 'flow', 'multi-spec.md');
const DISPATCH_SEQUENTIAL = read('plugin', 'skills', 'dispatch', 'sequential-execution.md');

// The literal detection phrasing this consolidation retires from every consumer but the
// shared file itself — a migrated file restating this inline is the regression this test
// exists to catch (the duplication the shared-contract-extraction pattern removes).
const DETECTION_PHRASE = /GIT_DIR\s*!=\s*GIT_COMMON|git rev-parse --git-dir/;

test('_shared/worktree-setup.md: has an Adopt-or-create section, positioned before Pre-creation reconcile', () => {
  const adoptIdx = SHARED_WORKTREE_SETUP.indexOf('## Adopt-or-create');
  assert.notStrictEqual(adoptIdx, -1, '## Adopt-or-create heading missing from _shared/worktree-setup.md');

  const reconcileIdx = SHARED_WORKTREE_SETUP.indexOf('## Pre-creation reconcile');
  assert.notStrictEqual(reconcileIdx, -1, '## Pre-creation reconcile heading missing — this test has lost its anchor');

  assert.ok(
    adoptIdx < reconcileIdx,
    'Adopt-or-create must be positioned before Pre-creation reconcile — it is the decision that gates whether reconcile/creation happens at all',
  );
});

test('_shared/worktree-setup.md: Adopt-or-create states both branches and the detection command', () => {
  const start = SHARED_WORKTREE_SETUP.indexOf('## Adopt-or-create');
  const end = SHARED_WORKTREE_SETUP.indexOf('## Pre-creation reconcile', start);
  const region = SHARED_WORKTREE_SETUP.slice(start, end);

  assert.match(region, DETECTION_PHRASE, 'must state the superpowers Step 0 detection command shape');
  assert.match(region, /Already isolated/, 'must name the already-isolated branch');
  assert.match(region, /Not isolated/, 'must name the not-isolated branch');
  assert.match(region, /adopt/i, 'the already-isolated branch must describe adopting the current worktree');
});

test('_shared/worktree-setup.md: Adopt-or-create gates adoption on a clean-tree precondition check', () => {
  const start = SHARED_WORKTREE_SETUP.indexOf('## Adopt-or-create');
  const end = SHARED_WORKTREE_SETUP.indexOf('## Pre-creation reconcile', start);
  const region = SHARED_WORKTREE_SETUP.slice(start, end);

  assert.match(
    region,
    /git status --porcelain/,
    'the adopt branch must be gated on a git status --porcelain clean-tree check — an unconditional adopt silently folds unrelated pre-existing worktree content into the run\'s branch/PR (red-team finding, #1711)',
  );
  assert.match(
    region,
    /ExitWorktree\(action: "keep"\)/,
    'a dirty worktree must fall through via ExitWorktree(action: "keep") — never abandon it silently, never adopt it anyway',
  );
});

test('_shared/worktree-setup.md: Adopt-or-create cross-references dispatch #447 without merging the two', () => {
  const start = SHARED_WORKTREE_SETUP.indexOf('## Adopt-or-create');
  const end = SHARED_WORKTREE_SETUP.indexOf('## Pre-creation reconcile', start);
  const region = SHARED_WORKTREE_SETUP.slice(start, end);

  assert.match(
    region,
    /#447/,
    'must cross-reference dispatch/sequential-execution.md\'s #447 handling so a future reader does not try to merge the two structurally different problems',
  );
});

test('build/worktree-setup.md: cites Adopt-or-create instead of restating the detection logic inline', () => {
  assert.match(
    BUILD_WORKTREE_SETUP,
    /Adopt-or-create/,
    'Common Step 1\'s skip-creation guard must cite _shared/worktree-setup.md\'s Adopt-or-create section',
  );
  assert.doesNotMatch(
    BUILD_WORKTREE_SETUP,
    DETECTION_PHRASE,
    'build/worktree-setup.md must not restate the GIT_DIR != GIT_COMMON / git rev-parse --git-dir detection inline — that duplication is exactly what this consolidation removes',
  );
});

test('build/worktree-setup.md: the MULTISPEC_SHARED_WORKTREE check and skip-steps instructions survive the migration', () => {
  assert.match(
    BUILD_WORKTREE_SETUP,
    /MULTISPEC_SHARED_WORKTREE=1/,
    'the MULTISPEC_SHARED_WORKTREE=1 env-var check is call-site-specific and must remain, unlike the detection logic that moved to the shared section',
  );
  assert.match(
    BUILD_WORKTREE_SETUP,
    /Skip steps 1-3 and 5/,
    'the "skip steps 1-3 and 5" instruction is call-site-specific and must remain',
  );
  assert.match(
    BUILD_WORKTREE_SETUP,
    /Still run Step 4\.5/,
    'the "still run Step 4.5" instruction is call-site-specific and must remain (#778)',
  );
});

test('routine/create-and-update.md: Step 0 cites Adopt-or-create instead of restating the detection logic inline', () => {
  assert.match(
    ROUTINE_CREATE_AND_UPDATE,
    /Adopt-or-create/,
    'Step 0 must cite _shared/worktree-setup.md\'s Adopt-or-create section',
  );
  assert.doesNotMatch(
    ROUTINE_CREATE_AND_UPDATE,
    DETECTION_PHRASE,
    'routine/create-and-update.md must not restate the GIT_DIR != GIT_COMMON / git rev-parse --git-dir detection inline',
  );
});

test('routine/create-and-update.md: Step 0 still explains why the check exists and the commit-then-merge-back sequencing', () => {
  assert.match(
    ROUTINE_CREATE_AND_UPDATE,
    /PreToolUse hook denies any `Write`/,
    'the rationale for why this skill needs the check at all must survive the migration',
  );
  assert.match(
    ROUTINE_CREATE_AND_UPDATE,
    /merge the branch back into the main checkout/,
    'the commit-then-merge-back sequencing must survive the migration',
  );
});

test('flow/multi-spec.md: Step 1 wires the Adopt-or-create gate before EnterWorktree(name=...)', () => {
  const start = MULTI_SPEC.indexOf('### Shared worktree');
  assert.notStrictEqual(start, -1, '### Shared worktree heading missing — this test has lost its anchor');
  const end = MULTI_SPEC.indexOf('Why shared, not per-record', start);
  assert.notStrictEqual(end, -1, 'end anchor missing — this test has lost its anchor');
  const region = MULTI_SPEC.slice(start, end);

  assert.match(
    region,
    /Adopt-or-create/,
    'Step 1 (Create once, up front) must direct the reader to run the Adopt-or-create gate before EnterWorktree(name=...) — this is the actual fix for #1711',
  );
  assert.match(
    region,
    /worktree-always/,
    'Step 1 must explain why the gate is needed: an interactive session under worktree-always is always already isolated by the time /flow runs',
  );
  assert.match(
    region,
    /Adopted/,
    'Step 1 must describe the adopted-branch outcome (whichever branch the session was already on, not renamed)',
  );
});

test('dispatch/sequential-execution.md: #447 section cross-references Adopt-or-create without merging the two', () => {
  const start = DISPATCH_SEQUENTIAL.indexOf('## When the dispatching session itself is cwd-pinned (#447)');
  assert.notStrictEqual(start, -1, '#447 heading missing — this test has lost its anchor');
  const region = DISPATCH_SEQUENTIAL.slice(start, start + 800);

  assert.match(
    region,
    /Adopt-or-create/,
    '#447 section must cross-reference _shared/worktree-setup.md\'s Adopt-or-create section',
  );
  assert.match(
    region,
    /Do not merge the two/,
    '#447 section must explicitly state the two scenarios stay separate procedures',
  );
});
