'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #1780: a `/claude-tweaks:dispatch`-originated firing runs `/flow` headless (nobody present to
// judge whether a worktree's local-ahead-of-origin content belongs in a dispatched record's PR).
// `worktree.baseRef: head` deliberately starts every worktree from local HEAD, which may
// legitimately carry unpushed commits (an in-progress [reconcile] merge, an un-pushed /init
// refresh) — normal, expected state for a human-present /flow, who can see it directly. This
// spec adds a headless-only detection + hard-stop at worktree-creation time, mirroring the
// existing "Claim contested"/"Claim in-flight" stop shapes flow/claim-targets.md already uses for
// an analogous headless pre-flight condition.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const SHARED_WORKTREE_SETUP = read('plugin', 'skills', '_shared', 'worktree-setup.md');
const CLAIM_TARGETS = read('plugin', 'skills', 'flow', 'claim-targets.md');
const SETTLE_AND_MERGE = read('plugin', 'skills', 'dispatch', 'settle-and-merge.md');
const VALIDATION = read('plugin', 'skills', 'flow', 'validation.md');

// ---------------------------------------------------------------------------
// (a) Post-creation catch-up: the new headless check exists, is gated on
// DISPATCH_HEADLESS=1, and runs after the {EXPECTED_BASE} merge block.
// ---------------------------------------------------------------------------

test('_shared/worktree-setup.md: Headless ride-along check exists, after the {EXPECTED_BASE} merge, gated on DISPATCH_HEADLESS=1', () => {
  const expectedBaseIdx = SHARED_WORKTREE_SETUP.indexOf('git merge {EXPECTED_BASE}');
  assert.notStrictEqual(expectedBaseIdx, -1, '{EXPECTED_BASE} merge block missing — this test has lost its anchor');

  const checkIdx = SHARED_WORKTREE_SETUP.indexOf('Headless ride-along check');
  assert.notStrictEqual(checkIdx, -1, 'Headless ride-along check section missing');
  assert.ok(checkIdx > expectedBaseIdx, 'Headless ride-along check must appear after the {EXPECTED_BASE} merge block');

  const preFlightIdx = SHARED_WORKTREE_SETUP.indexOf('## Pre-flight divergence check');
  assert.notStrictEqual(preFlightIdx, -1, '## Pre-flight divergence check heading missing — this test has lost its anchor');
  const region = SHARED_WORKTREE_SETUP.slice(checkIdx, preFlightIdx);

  assert.match(region, /DISPATCH_HEADLESS=1/, 'the check must be gated on DISPATCH_HEADLESS=1');
  assert.match(region, /origin\/\{integration-branch\}\.\.HEAD/, 'must compute the ahead-of-origin count via git rev-list --count against origin/{integration-branch}..HEAD');
  assert.match(region, /git log --oneline/, 'must capture the specific ride-along commit(s) via git log --oneline');
  assert.match(region, /never reset|never discard|never resets, discards/, 'must state that this check never resets/discards the ride-along content');
});

test('_shared/worktree-setup.md: the Pre-flight divergence check section carries no DISPATCH_HEADLESS conditional (human-present path untouched)', () => {
  const start = SHARED_WORKTREE_SETUP.indexOf('## Pre-flight divergence check');
  assert.notStrictEqual(start, -1, '## Pre-flight divergence check heading missing — this test has lost its anchor');
  const end = SHARED_WORKTREE_SETUP.indexOf('## Anti-patterns', start);
  assert.notStrictEqual(end, -1, '## Anti-patterns heading missing — this test has lost its anchor');
  const region = SHARED_WORKTREE_SETUP.slice(start, end);
  assert.doesNotMatch(region, /DISPATCH_HEADLESS/, 'Pre-flight divergence check must stay untouched by this spec — the new check lives only in Post-creation catch-up');
});

// Go-red control: the literal pre-#1780 text of this paragraph pair (frozen before this spec's
// edit) — proves the assertions above actually discriminate rather than passing vacuously.
const PRE_CHANGE_EXPECTED_BASE_REGION =
  'This is safe unconditionally: on a freshly created branch with no commits of its own, ' +
  '`{EXPECTED_BASE}` and `origin/{integration-branch}` are either already ancestor-related (the ' +
  'merge is a no-op) or have genuinely diverged, in which case this merge surfaces exactly the same ' +
  'way any other conflict does (see below) — there is no case where running it loses information a ' +
  'caller that captured `EXPECTED_BASE` would want kept. A caller with no `EXPECTED_BASE` to ' +
  'capture (there was no "branch the worktree starts from" — e.g. a from-scratch scratch worktree) ' +
  'skips this merge; the fetch+merge above still runs on its own.\n\n' +
  'On a merge conflict from either merge, resolve it per `_shared/git-discipline.md`\'s Merge conflict ' +
  'resolution — never reset or discard.';

test('go-red control: pre-change {EXPECTED_BASE} region has no Headless ride-along check or DISPATCH_HEADLESS mention', () => {
  assert.ok(!PRE_CHANGE_EXPECTED_BASE_REGION.includes('Headless ride-along check'), 'control must not already contain the new section');
  assert.ok(!PRE_CHANGE_EXPECTED_BASE_REGION.includes('DISPATCH_HEADLESS'), 'control must not already gate on DISPATCH_HEADLESS');
});

// ---------------------------------------------------------------------------
// (b) flow/claim-targets.md: new stop shape registered, using the same
// _shared/headless-self-report.md invocation shape as the existing two.
// ---------------------------------------------------------------------------

test('flow/claim-targets.md: registers the Local-ahead-of-origin ride-along stop, mirroring the existing headless self-report wiring', () => {
  const start = CLAIM_TARGETS.indexOf('## Local-ahead-of-origin ride-along stop');
  assert.notStrictEqual(start, -1, 'new stop section missing from flow/claim-targets.md');
  const region = CLAIM_TARGETS.slice(start);

  assert.match(region, /headless-self-report\.md/, 'must wire through _shared/headless-self-report.md, same as Claim contested/Claim in-flight');
  assert.match(region, /flow-step-2\.5-headless-local-ahead/, 'must use the distinct failing-check-name flow-step-2.5-headless-local-ahead');
  assert.match(region, /push or stash the local commit\(s\) first/, 'the card must state the resume hint verbatim');
  assert.match(region, /No `AskUserQuestion`/, 'must be a static card, no AskUserQuestion, same shape as the existing two stops');
});

test('dispatch/settle-and-merge.md: wires the ride-along stop\'s headless self-report with the matching failing-check-name and release-claim.js reason', () => {
  assert.match(SETTLE_AND_MERGE, /flow-step-2\.5-headless-local-ahead/, 'settle-and-merge.md must name the same failing-check-name');
  assert.match(SETTLE_AND_MERGE, /failed: local-ahead-of-origin/, 'must release with reason "failed: local-ahead-of-origin"');
  assert.match(SETTLE_AND_MERGE, /Headless ride-along special case/, 'must add a distinct special-case paragraph for this stop, alongside the existing Claim-contest special case');
});

// Go-red control: the literal pre-#1780 tail of claim-targets.md (frozen before this spec's edit).
const PRE_CHANGE_CLAIM_TARGETS_TAIL =
  'This supersedes, for this file specifically, `_shared/issue-claims.md`\'s general Failure-posture ' +
  'line "Any other `gh`/MCP failure during claim: drop that issue, log, continue" — that line was ' +
  'written for independent-batch contexts (dispatch\'s old multi-group loop, `/tidy`\'s sweep) where ' +
  'dropping one issue and continuing is safe because each issue in that context is independent. This ' +
  'section\'s group-claim **all-or-abort** invariant is exactly the case that general line doesn\'t ' +
  'fit: silently proceeding to Step 3 with one named target unclaimed reopens the double-build race ' +
  'this step exists to prevent.';

test('go-red control: pre-change claim-targets.md tail has no ride-along stop section', () => {
  assert.ok(!PRE_CHANGE_CLAIM_TARGETS_TAIL.includes('Local-ahead-of-origin ride-along'), 'control must not already contain the new stop');
  assert.ok(!PRE_CHANGE_CLAIM_TARGETS_TAIL.includes('flow-step-2.5-headless-local-ahead'), 'control must not already name the new failing-check-name');
});

// ---------------------------------------------------------------------------
// (c) flow/validation.md: the cross-reference sentence is present.
// ---------------------------------------------------------------------------

test('flow/validation.md: Step 2.5 cross-references the separate headless-only reverse-direction check', () => {
  const start = VALIDATION.indexOf('## 2.5 — Branch-divergence check');
  assert.notStrictEqual(start, -1, '## 2.5 heading missing — this test has lost its anchor');
  const end = VALIDATION.indexOf('## 2.6', start);
  assert.notStrictEqual(end, -1, '## 2.6 heading missing — this test has lost its anchor');
  const region = VALIDATION.slice(start, end);

  assert.match(region, /reverse direction/i, 'must name the reverse direction (local ahead of origin) explicitly');
  assert.match(region, /headless-only|DISPATCH_HEADLESS/, 'must state the reverse direction is handled headless-only');
  assert.match(region, /Headless ride-along check/, 'must cross-reference the Post-creation catch-up\'s Headless ride-along check by name, not restate its mechanics');
});

// Go-red control: the literal pre-#1780 Step 2.5 section (frozen before this spec's edit) —
// ends at the Base-ref blockquote with no reverse-direction cross-reference at all.
const PRE_CHANGE_STEP_2_5 =
  '## 2.5 — Branch-divergence check\n\n' +
  'Resolve the `branch-divergence-check` setting — `BRANCH_DIVERGENCE_CHECK=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values branch-divergence-check)`. ' +
  'When enabled and worktree strategy resolves to `worktree`, run `_shared/worktree-setup.md`\'s `## Pre-flight divergence check` — the canonical resolution + fetch + `ahead`-count procedure, ' +
  'consolidated out of what were two byte-identical copies here and in `skills/build/worktree-setup.md` (`[IL-32]`). That section\'s `AskUserQuestion` and auto-mode handling apply as written there; this step\'s own log line reads:\n\n' +
  '```\nAUTO {time} — Step 2.5: pre-flight branch-divergence-check — {UPSTREAM} is {N} ahead. Continued and added ops ledger entry. Reversibility: low (divergence persists).\n```\n\n' +
  '> **Base ref:** `/flow` worktrees branch from the current local HEAD via `worktree.baseRef: "head"` (settings.json), and `/build` Common Step 1 unconditionally catches the resulting worktree up with the integration branch after creation regardless of the actual base. ' +
  'See `skills/build/worktree-setup.md` ("Base ref" + Step 4) and `_shared/worktree-setup.md`\'s `## Post-creation catch-up` — the harness default `fresh` branches from a possibly-stale `origin/<default-branch>` and the plugin cannot override it through `EnterWorktree`.\n\n' +
  '## 2.6 — Shape check (structural coupling)';

test('go-red control: pre-change Step 2.5 has no reverse-direction cross-reference', () => {
  assert.ok(!PRE_CHANGE_STEP_2_5.includes('reverse direction'), 'control must not already mention the reverse direction');
  assert.ok(!PRE_CHANGE_STEP_2_5.includes('Headless ride-along check'), 'control must not already cross-reference the Headless ride-along check');
});
