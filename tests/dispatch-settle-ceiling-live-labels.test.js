'use strict';
// tests/dispatch-settle-ceiling-live-labels.test.js — #5584 AC16.
//
// A typed `/claude-tweaks:dispatch #N` run builds a record that may carry no `auto:*`
// label. Settle step 6 (the retry ceiling) used to say "remove `auto:build`" unconditionally,
// and `gh issue edit --remove-label` of an absent label fails the whole edit, so `bot:blocked`
// never landed. This pins that step 6 reads the live labels first and passes only the grant
// labels present, one `--remove-label` each, in one `gh issue edit` with `--add-label bot:blocked`.
// The go-red control is the base commit's step 6 (91f92c620), frozen inline below, run through
// the same extraction as the live file. AC16's "no larger than base" is a one-time measurement in
// the PR notes, not a test: a fixed-commit size pin would go red on any later legitimate growth.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed } = require('./helpers/conformance-asserts');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'plugin/skills/dispatch/settle-and-merge.md');

const STEP6_START = '6. **If `ceilingHit` was `true`:**';
const STEP7_START = '7. **If `false`:**';

function step6Of(text) {
  const start = text.indexOf(STEP6_START);
  assert.notEqual(start, -1, 'step 6 start anchor missing');
  const end = text.indexOf(STEP7_START, start);
  assert.notEqual(end, -1, 'step 7 start anchor missing — step 6 slice would run to end of file');
  return text.slice(start, end).replace(/\s+/g, ' ');
}

// Step 6 as it shipped on the base commit (91f92c620), verbatim.
const BASE_STEP6 = `6. **If \`ceilingHit\` was \`true\`:** bootstrap \`bot:blocked\` if it doesn't already exist:

   \`\`\`bash
   # Bootstrap per _shared/label-bootstrap.md — LABELS_JSON is the single ['bot:blocked', <description>]
   # pair, with <description> read from that file's canonical LABELS_JSON fence (the one source
   # tests/bin-lib/issues/labels.test.js pins); never restate the description text here.
   \`\`\`

   Then remove \`auto:build\` and, if still present (a \`transient\`-classified attempt preserves it per step 3 above, so it can still be there at the ceiling), \`auto:merge\` or \`auto:merge-pending\` too — per \`_shared/issue-claims.md\`'s canonical rule, the retry ceiling removes **all** \`auto:*\` labels, not just whichever one step 3 didn't already strip. Add \`bot:blocked\`, and send a \`PushNotification\` ("Record #{n} hit its retry ceiling — needs a look: {title}").
7. **If \`false\`:** leave \`auto:build\` in place.
`;

const READS_LIVE = /read the live labels \(`gh issue view "\$ISSUE" --json labels -q '\.labels\[\]\.name'`\)/;
const ONE_EDIT = /Pass those flags and `--add-label bot:blocked` in one `gh issue edit "\$ISSUE"` call/;
const FACTS = [
  [READS_LIVE, 'reads the live labels'],
  [/remove only the grant labels present:/, 'removes only the grant labels present'],
  [/each of `auto:build`, `auto:merge` and `auto:merge-pending` found there gets its own `--remove-label`/, 'one --remove-label per present grant'],
  [/an absent one gets none, since a typed run may carry no grant and removing an absent label fails the whole edit\./, 'an absent grant gets no --remove-label, and why'],
  [ONE_EDIT, 'grant removals and bot:blocked go in one gh issue edit'],
];
const missing = missingFactsOf(FACTS);
const UNCONDITIONAL_REMOVE = /Then remove `auto:build` and/;
const ADD_BLOCKED = '`--add-label bot:blocked`';

const live = () => step6Of(readText(FILE));

test('AC16: step 6 reads the live labels and removes only the grant labels present', () => {
  assert.deepEqual(missing(live()), []);
});

test('AC16: step 6 no longer removes auto:build unconditionally', () => {
  assert.doesNotMatch(live(), UNCONDITIONAL_REMOVE);
});

test('AC16: the live-label read comes before bot:blocked is added', () => {
  const s = live();
  const read = s.search(READS_LIVE);
  const add = s.indexOf(ADD_BLOCKED);
  assert.notEqual(read, -1, 'live-label read missing');
  assert.notEqual(add, -1, 'bot:blocked add missing');
  assert.ok(read < add, 'step 6 must read the live labels before adding bot:blocked');
  const swapped = s.replace(ADD_BLOCKED, '').replace(READS_LIVE, (m) => `${ADD_BLOCKED} ${m}`);
  assert.notEqual(swapped, s);
  assert.ok(swapped.search(READS_LIVE) > swapped.indexOf(ADD_BLOCKED), 'permuted control must put the add first');
});

test('AC16 go-red: the base commit step 6 fails every fact and carries the unconditional removal', () => {
  const base = step6Of(BASE_STEP6);
  assert.deepEqual(missing(base), FACTS.map(([, fact]) => fact));
  assert.match(base, UNCONDITIONAL_REMOVE);
});

test('AC16 go-red: stripping each fact from the live step 6 turns exactly that fact red', () => {
  assertEachPatternGoesRed(live(), FACTS, missing);
});

// Step 7 as it shipped on the base commit (91f92c620), verbatim.
const BASE_STEP7 = '7. **If `false`:** leave `auto:build` in place — the next `dispatch next` firing pulls it again naturally (the claim was already released). There is nothing further to downgrade in the common case: step 3 revoked `auto:merge` unless the failure was classified transient, and that conditional revocation *is* the failure-downgrade rule in this model. Unlike the pre-grants design there is no separate two-tier label to step down between — a record either still has `auto:build` (and can retry) or, at the ceiling, has neither.';
const ANY_GRANT_KEPT = /leave any grant label in place/;
const AUTO_BUILD_KEPT = /leave `auto:build` in place/;

function step7Of(text) {
  const line = text.split('\n').find((l) => l.startsWith(STEP7_START));
  assert.ok(line, 'step 7 line missing');
  return line;
}

test('AC16: step 7 keeps whatever grant is present, true for a record with none', () => {
  const s = step7Of(readText(FILE));
  assert.match(s, ANY_GRANT_KEPT);
  assert.doesNotMatch(s, AUTO_BUILD_KEPT);
});

test('AC16 go-red: the base commit step 7 says to leave auto:build in place', () => {
  const s = step7Of(BASE_STEP7);
  assert.doesNotMatch(s, ANY_GRANT_KEPT);
  assert.match(s, AUTO_BUILD_KEPT);
});
