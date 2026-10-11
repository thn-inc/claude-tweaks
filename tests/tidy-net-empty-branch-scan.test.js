'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #613: tidy's worktree/branch scan flags a branch that is net-empty vs. its
// merge-base as reclaimable, even when unmerged — the canonical /specify
// residue shape (a design doc committed then deleted, netting zero across
// two commits) was previously invisible to the merged-only rule. Pins the
// net-empty check's command, its priority over the "unmerged" catch-all, and
// what it never overrides (PR-state OPEN, dirty-worktree, locked worktree).
// Prose-as-implementation: this scan is LLM-executed markdown, not code, so
// the test is a conformance grep over the literal skill text.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const SCAN_PROCEDURES = read('plugin', 'skills', 'tidy', 'scan-procedures.md');
const STEP6 = read('plugin', 'skills', 'tidy', 'step-6-auto.md');
const NET_EMPTY_SECTION = STEP6.slice(
  STEP6.indexOf('**Net-empty branches (#613).**'),
  STEP6.indexOf('**Log entries:**')
);

test('scan-procedures.md: the -d/-D outcome table gains a net-empty row, checked before the "unmerged" catch-all', () => {
  assert.match(SCAN_PROCEDURES, /net-empty vs\. fork point \(#613\)/);
  assert.match(SCAN_PROCEDURES, /\*\*`net-empty — delete via -D`\*\*/);
  // The net-empty row's own table position must precede the plain "not
  // net-empty" unmerged row, since it's a refinement of that same
  // no-configured-base case (the branch is unmerged, but has nothing to lose).
  const netEmptyIdx = SCAN_PROCEDURES.indexOf('net-empty vs. fork point (#613)');
  const unmergedIdx = SCAN_PROCEDURES.indexOf('no configured base, not net-empty');
  assert.ok(netEmptyIdx >= 0 && unmergedIdx >= 0, 'both outcome rows must be present');
  assert.ok(netEmptyIdx < unmergedIdx, 'net-empty row must precede the not-net-empty row');
});

test('scan-procedures.md: the outcome-table heading reflects five outcomes, not the stale "four" count', () => {
  assert.doesNotMatch(SCAN_PROCEDURES, /Four outcomes, never three/);
  assert.match(SCAN_PROCEDURES, /Five outcomes \(#613\)/);
});

test('step-6-auto.md: the net-empty check is fully specified — command, applicability, and what it never overrides', () => {
  assert.ok(NET_EMPTY_SECTION.length > 0, 'Net-empty branches (#613) section must exist before Log entries');
  // Applies to both the Build-branches table and shared-probe candidates.
  assert.match(NET_EMPTY_SECTION, /Build-branches table and every shared-probe worktree\/branch candidate alike/);
  // The actual check command — merge-base against the branch's own fork
  // point, never against {base}'s current tip.
  assert.match(NET_EMPTY_SECTION, /git -C "\{REPO_ROOT\}" diff --quiet "\$\(git -C "\{REPO_ROOT\}" merge-base \{base\} \{branch\}\)" \{branch\}/);
  assert.match(NET_EMPTY_SECTION, /_shared\/integration-branch\.md/);
  // Names the canonical /specify residue shape this exists to catch.
  assert.match(NET_EMPTY_SECTION, /design doc committed, then deleted after decomposition, netting zero/);
  // Collection shape feeding into the Delete row's routing — matches
  // scan-procedures.md's own Recommendation-column string for this outcome,
  // so the scan-phase and auto-execution reports never diverge (#613 review).
  assert.match(NET_EMPTY_SECTION, /\[git\] \{branch\} — net-empty — delete via -D/);
  // The merge-base/diff-error failure mode falls through to manual review,
  // never to auto-delete (#613 review).
  assert.match(NET_EMPTY_SECTION, /falls through to the existing "unmerged"\/manual-review path/);
  // -D, not -d, and why it's safe.
  assert.match(NET_EMPTY_SECTION, /use `-D`/);
  // Precedence: PR-state OPEN, dirty-worktree, and locked-worktree all still win.
  assert.match(NET_EMPTY_SECTION, /PR-state `OPEN` row/);
  assert.match(NET_EMPTY_SECTION, /dirty-worktree override/);
  assert.match(NET_EMPTY_SECTION, /locked worktree/);
});

test('step-6-auto.md: the Delete row now covers net-empty worktrees/branches alongside merged ones', () => {
  const deleteRowMatch = STEP6.match(/\| \*\*Delete\*\* \(marked-as-specified design docs, ([^)]*)\)/);
  assert.ok(deleteRowMatch, 'Delete row (marked-as-specified design docs...) not found');
  assert.match(deleteRowMatch[1], /merged or net-empty worktrees\/branches/);
  assert.match(deleteRowMatch[1], /#613/);
});

test('the net-empty override never claims to override a PR-state OPEN, dirty, or locked-worktree finding', () => {
  assert.match(NET_EMPTY_SECTION, /never applies over a PR-state `OPEN` row, a dirty-worktree override.*or a locked worktree/);
});
