'use strict';
// Conformance suite for record #1179: a merge-check verdict of `needs-human` is
// authoritative — consoleAutoResolve's default-merge never overrides it.
//
// Live-corpus reads are correct here (skill-prose-conformance-tests decision table:
// "a documented convention this project wants enforced" / the carve-out prose IS the
// declared contract). Go-red proof [IL-105]: each pattern is also run against a frozen
// pre-change excerpt that carries the anchor ("defaults to merge" / the Layer 2 verdict
// sentence) and lacks only the carve-out, so a green result proves the pattern can fail
// for the attributable reason. Whitespace is collapsed on both haystack and needle [IL-66].

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const collapse = (s) => s.replace(/\s+/g, ' ');

// Collapsed at read time — every assertion in this suite runs on collapsed text, as do
// the frozen controls below, so no call site can forget it [IL-66].
const read = (rel) => collapse(readText(path.join(ROOT, rel)));
const WRAPUP_FLAT = read('plugin/skills/wrap-up/review-console.md');
const MULTISPEC_FLAT = read('plugin/skills/flow/multispec-review-console.md');
const SETTLE_FLAT = read('plugin/skills/dispatch/settle-and-merge.md');

// Frozen pre-change excerpts (string literals, never read from history) — the bytes the
// change replaced. Each carries the "defaults to merge" anchor (or, for settle, the
// Layer 2 needs-human sentence) WITHOUT the carve-out, so doesNotMatch/failed-window
// results are attributable to the carve-out's absence, not the anchor's.
const PRE_CHANGE_WRAPUP_BULLET = collapse(
  '- Every batch-section item (Auto-applied through Cleanup actions) resolves as if "Approve all" had been chosen. **The merge half of that decision defaults to merge** (`integration-model: pr-first`\'s "Approve all + merge" variant, never "leave PR open") — `unattended` authorizes full completion, not a park; `local-merge` proceeds to branch-finish the same way.'
);
const PRE_CHANGE_MULTISPEC_SENTENCE = collapse(
  '**The merge half of the terminal decision defaults to merge** (`integration-model: pr-first`\'s "Approve all + merge" variant) — `unattended` authorizes full completion, not a park; `local-merge` proceeds to branch-finish the same way. Execute via "On approval" below;'
);
const PRE_CHANGE_SETTLE_LAYER2 = collapse(
  '**Every member\'s verdict must be `auto-merge`** for the group to proceed — a single `needs-human` verdict anywhere in the group falls the whole group back to the normal pending-review path.'
);

// The carve-out's load-bearing tokens, one pattern per claim.
const CARVEOUT_HEADING = /Needs-human carve-out \(merge-check precedence\):/;
const CARVEOUT_RESOLUTION = /needs-human[\s\S]{0,320}?leave the PR open[^.]{0,80}never merge/;
const CARVEOUT_PRECEDENCE = /consoleAutoResolve[^.]{0,160}default-merge never overrides/;

// One claim per call: pattern must match the live (collapsed) file AND fail against the
// frozen pre-change excerpt.
function assertPinned(liveCollapsed, pattern, control, label) {
  assert.match(liveCollapsed, pattern, `${label}: carve-out claim missing from live prose`);
  assert.doesNotMatch(control, pattern, `${label}: pattern matches the pre-change text — cannot go red`);
}

// Adjacency helper: every "defaults to merge" occurrence must be followed by the
// carve-out heading within `window` collapsed chars. Returns the count of occurrences
// missing it (0 = compliant). Proved below against the pre-change controls, which carry
// the anchor and lack only the carve-out — the blind-spot rule for adjacency claims.
function occurrencesMissingCarveout(collapsed, window) {
  const anchor = /defaults to merge/g;
  let miss = 0;
  let m;
  while ((m = anchor.exec(collapsed)) !== null) {
    const follow = collapsed.slice(m.index, m.index + window);
    if (!CARVEOUT_HEADING.test(follow)) miss += 1;
  }
  return miss;
}

const WINDOW = 700;

test('single-spec console: carve-out present and go-red-proven', () => {
  assertPinned(WRAPUP_FLAT, CARVEOUT_HEADING, PRE_CHANGE_WRAPUP_BULLET, 'wrap-up/review-console.md');
});

test('single-spec console: needs-human resolves the merge half to leave-PR-open, never merge', () => {
  assertPinned(WRAPUP_FLAT, CARVEOUT_RESOLUTION, PRE_CHANGE_WRAPUP_BULLET, 'wrap-up/review-console.md');
});

test('single-spec console: consoleAutoResolve default-merge never overrides the verdict', () => {
  assertPinned(WRAPUP_FLAT, CARVEOUT_PRECEDENCE, PRE_CHANGE_WRAPUP_BULLET, 'wrap-up/review-console.md');
});

test('single-spec console: no "defaults to merge" without the exception adjacent', () => {
  assert.ok(/defaults to merge/.test(WRAPUP_FLAT), 'anchor vanished — adjacency claim is vacuous');
  assert.strictEqual(occurrencesMissingCarveout(WRAPUP_FLAT, WINDOW), 0,
    'wrap-up/review-console.md: a "defaults to merge" statement lacks the needs-human carve-out within its window');
});

test('multi-spec console: carve-out present and go-red-proven', () => {
  assertPinned(MULTISPEC_FLAT, CARVEOUT_HEADING, PRE_CHANGE_MULTISPEC_SENTENCE, 'flow/multispec-review-console.md');
});

test('multi-spec console: needs-human resolves the merge half to leave-PR-open, never merge', () => {
  assertPinned(MULTISPEC_FLAT, CARVEOUT_RESOLUTION, PRE_CHANGE_MULTISPEC_SENTENCE, 'flow/multispec-review-console.md');
});

test('multi-spec console: consoleAutoResolve default-merge never overrides the verdict', () => {
  assertPinned(MULTISPEC_FLAT, CARVEOUT_PRECEDENCE, PRE_CHANGE_MULTISPEC_SENTENCE, 'flow/multispec-review-console.md');
});

test('multi-spec console: no "defaults to merge" without the exception adjacent', () => {
  assert.ok(/defaults to merge/.test(MULTISPEC_FLAT), 'anchor vanished — adjacency claim is vacuous');
  assert.strictEqual(occurrencesMissingCarveout(MULTISPEC_FLAT, WINDOW), 0,
    'flow/multispec-review-console.md: a "defaults to merge" statement lacks the needs-human carve-out within its window');
});

test('multi-spec carve-out names the single-spec file it mirrors', () => {
  assert.match(MULTISPEC_FLAT, /Needs-human carve-out[\s\S]{0,600}?wrap-up\/review-console\.md/,
    'multispec carve-out must cite wrap-up/review-console.md (mirror consistency)');
});

test('settle-and-merge: needs-human verdict survives into the console short-circuit', () => {
  assertPinned(SETTLE_FLAT, CARVEOUT_PRECEDENCE, PRE_CHANGE_SETTLE_LAYER2, 'dispatch/settle-and-merge.md');
});

test('adjacency helper is itself discriminating (counting-helper proof)', () => {
  // Control carries the anchor and lacks the carve-out → exactly 1 missing occurrence.
  assert.strictEqual(occurrencesMissingCarveout(PRE_CHANGE_WRAPUP_BULLET, WINDOW), 1,
    'helper failed to flag the pre-change excerpt');
  // Anchor-less input → 0 (no free passes from an empty scan being conflated with compliance
  // is why the live tests assert the anchor separately).
  assert.strictEqual(occurrencesMissingCarveout('no anchor here at all', WINDOW), 0);
  // Synthetic compliant pair: anchor followed by the carve-out heading inside the window → 0.
  const compliant = 'The merge half defaults to merge. **Needs-human carve-out (merge-check precedence):** …';
  assert.strictEqual(occurrencesMissingCarveout(collapse(compliant), WINDOW), 0,
    'helper flags a compliant synthetic pair');
});
