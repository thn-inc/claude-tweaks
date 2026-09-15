'use strict';
// Conformance suite for record #2299: dispatch's own drain-PR overlap hold
// (`dispatch/drain-pr-overlap.md`'s Step 6, #1985) must resolve the merge half to
// leave-open, self-healing once the overlapping PR merges or closes — the same
// as the #1179 needs-human and #1802 ungranted-member carve-outs. This suite
// pins the third carve-out's mirrored presence in both console files.
//
// Live-corpus reads are correct here (skill-prose-conformance-tests decision table: "a
// documented convention this project wants enforced" / the carve-out prose IS the
// declared contract). Go-red proof [IL-105]: each pattern is also run against a frozen
// pre-change excerpt that carries the anchor but lacks the new carve-out, so a green
// result proves the pattern can fail for the attributable reason. Whitespace is
// collapsed on both haystack and needle [IL-66].

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const collapse = (s) => s.replace(/\s+/g, ' ');

const read = (rel) => collapse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const WRAPUP_FLAT = read('plugin/skills/wrap-up/review-console.md');
const MULTISPEC_FLAT = read('plugin/skills/flow/multispec-review-console.md');

// Frozen pre-change excerpts — the bytes #2299's fix appended after. Each carries the
// #1802 carve-out's own closing sentence WITHOUT the new #2299 carve-out, so a
// doesNotMatch result is attributable to the new carve-out's absence, not the old one's.
const PRE_CHANGE_WRAPUP = collapse(
  'a withheld grant is itself a human decision and must never silently resolve to merge for want '
  + 'of a verdict that was never computed. Every `Q#`/`M#` item resolves to `Apply`',
);
const PRE_CHANGE_MULTISPEC = collapse(
  'a withheld grant is itself a human decision and must never silently resolve to merge for want '
  + 'of a verdict that was never computed; mirrors the single-spec carve-out in '
  + '`wrap-up/review-console.md`. Every non-merge item still auto-resolves exactly as this '
  + 'section states.',
);

const CARVEOUT_HEADING = /Drain-overlap-hold carve-out \(#2299\):/;
const CARVEOUT_SELF_HEALS = /re-verifies that PR's \*live\* state[\s\S]{0,200}resolves `leave-open` only while it is still genuinely open/;
const MULTISPEC_MIRRORS = /Drain-overlap-hold carve-out \(#2299\)[\s\S]{0,700}?mirrors the single-spec carve-out in `wrap-up\/review-console\.md`\./;

function assertPinned(liveCollapsed, pattern, control, label) {
  assert.match(liveCollapsed, pattern, `${label}: carve-out claim missing from live prose`);
  assert.doesNotMatch(control, pattern, `${label}: pattern matches the pre-change text — cannot go red`);
}

test('single-spec console: drain-overlap-hold carve-out present and go-red-proven', () => {
  assertPinned(WRAPUP_FLAT, CARVEOUT_HEADING, PRE_CHANGE_WRAPUP, 'wrap-up/review-console.md');
});

test('single-spec console: carve-out states the hold self-heals on live PR state, not a persisted hold', () => {
  assertPinned(WRAPUP_FLAT, CARVEOUT_SELF_HEALS, PRE_CHANGE_WRAPUP, 'wrap-up/review-console.md');
});

test('multi-spec console: matching drain-overlap-hold carve-out present and go-red-proven', () => {
  assertPinned(MULTISPEC_FLAT, CARVEOUT_HEADING, PRE_CHANGE_MULTISPEC, 'flow/multispec-review-console.md');
});

test('multi-spec console: drain-overlap-hold carve-out sentence ends with the mirror phrase', () => {
  assertPinned(MULTISPEC_FLAT, MULTISPEC_MIRRORS, PRE_CHANGE_MULTISPEC, 'flow/multispec-review-console.md');
});
