'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #778: a dispatched /flow run's first commit was denied by the working-directory
// hook (E1) because build/worktree-setup.md's "already in a linked worktree" skip
// guard skipped its ENTIRE procedure — including Step 4.5's record-worktree stamp
// — whenever GIT_DIR != GIT_COMMON. That detection was framed as multi-spec-only,
// but dispatch/sequential-execution.md creates and enters a group's worktree
// directly (singleton or bundle) via EnterWorktree, which never itself calls
// record-worktree. /flow's own multi-spec up-front creation happens to run this
// file's full procedure (so it stamps fine), but a dispatch-created worktree
// arrives at Common Step 1 with no stamp at all, and the skip guard used to skip
// the one step that would have fixed it. This test pins the fix: Step 4.5 must
// still run — unconditionally, since it's documented as an idempotent restamp —
// even on the skip-creation path, and the guard must be worded to say so.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const WORKTREE_SETUP = read('plugin', 'skills', 'build', 'worktree-setup.md');

test('worktree-setup.md: the skip-creation guard is not framed as multi-spec-exclusive', () => {
  const start = WORKTREE_SETUP.indexOf('Skip creation when already inside an externally-created worktree');
  assert.notStrictEqual(
    start,
    -1,
    'the skip-creation guard heading must acknowledge non-multi-spec callers (e.g. dispatch) — a guard titled "(multi-spec)" only invites a reader to assume dispatch is unaffected',
  );

  const region = WORKTREE_SETUP.slice(start, start + 1600);
  assert.match(
    region,
    /dispatch\/sequential-execution\.md/,
    'the guard must name dispatch/sequential-execution.md as a second caller that hits GIT_DIR != GIT_COMMON, not just multi-spec',
  );
  assert.match(
    region,
    /singleton group exactly as for a bundle/,
    'the guard must state explicitly that a singleton dispatch group hits this same path, not only a multi-record bundle',
  );
});

test('worktree-setup.md: Step 4.5 still runs on the skip-creation path (the actual #778 fix)', () => {
  const start = WORKTREE_SETUP.indexOf('Skip creation when already inside an externally-created worktree');
  assert.notStrictEqual(start, -1, 'skip-creation guard heading missing — this test has lost its anchor');
  const end = WORKTREE_SETUP.indexOf('## Base ref', start);
  assert.notStrictEqual(end, -1, '## Base ref heading missing — this test has lost its anchor');
  const region = WORKTREE_SETUP.slice(start, end);

  assert.match(
    region,
    /Still run Step 4\.5/,
    'the guard must explicitly say Step 4.5 (record the assignment) still runs even when the rest of the procedure is skipped',
  );
  assert.match(
    region,
    /idempotent restamp/,
    'the guard must justify running Step 4.5 unconditionally by citing that it is documented elsewhere as an idempotent restamp — never destructive to a prior stamp',
  );
  assert.match(
    region,
    /EnterWorktree.*call stamps nothing|stamps nothing/,
    'the guard must name the actual gap: dispatch\'s own EnterWorktree call never calls record-worktree itself',
  );
  assert.match(
    region,
    /#778/,
    'the guard should cite #778 so a future reader can find the incident this fix traces to',
  );
});

test('worktree-setup.md: the Step 4.5 paragraph names the Adopted branch by name (#1751)', () => {
  const start = WORKTREE_SETUP.indexOf('Skip creation when already inside an externally-created worktree');
  assert.notStrictEqual(start, -1, 'skip-creation guard heading missing — this test has lost its anchor');
  const end = WORKTREE_SETUP.indexOf('## Base ref', start);
  assert.notStrictEqual(end, -1, '## Base ref heading missing — this test has lost its anchor');
  const region = WORKTREE_SETUP.slice(start, end);

  assert.match(
    region,
    /\*\*Adopted\*\*/,
    'the guard must name the Adopted branch by name — a stale two-creator contrast (/flow multi-spec vs. dispatch) omits that /flow\'s own Adopted branch also stamps nothing, which is the common case under worktree-always',
  );
  assert.match(
    region,
    /\*\*Created\*\*/,
    'the guard must also name the Created branch by name, distinguishing it from Adopted',
  );
});

test('worktree-setup.md: Step 6 (draft PR) is explicitly unaffected by the skip-creation path', () => {
  const start = WORKTREE_SETUP.indexOf('Skip creation when already inside an externally-created worktree');
  const end = WORKTREE_SETUP.indexOf('## Base ref', start);
  const region = WORKTREE_SETUP.slice(start, end);

  assert.match(
    region,
    /Step 6 \(open the draft PR\) is unaffected/,
    'the guard must state that Step 6 is unaffected by this skip, since a reader who sees "skip this procedure" could otherwise assume Step 6 (listed as item 6 in the same numbered Procedure list) is skipped too',
  );
});

test('worktree-setup.md: the numbered Procedure Step 4.5 command is unchanged (still idempotent, still --run-explicit)', () => {
  const stepStart = WORKTREE_SETUP.indexOf('4.5. **Record the assignment**');
  assert.notStrictEqual(stepStart, -1, 'Step 4.5 heading missing — this test has lost its anchor');
  const stepEnd = WORKTREE_SETUP.indexOf('\n5. All subsequent work happens in the worktree', stepStart);
  assert.notStrictEqual(stepEnd, -1, 'Step 5 heading missing — this test has lost its anchor');
  const region = WORKTREE_SETUP.slice(stepStart, stepEnd);

  assert.match(
    region,
    /record-worktree --run "\$RUN_DIR" "\$WORKTREE"/,
    'Step 4.5 must still invoke record-worktree with an explicit --run — the fix relies on this exact command remaining callable standalone, independent of steps 1-4 having run',
  );
  assert.match(
    region,
    /idempotent restamp/,
    'Step 4.5 must still document itself as an idempotent restamp — this is what makes calling it unconditionally on the skip path safe',
  );
});
