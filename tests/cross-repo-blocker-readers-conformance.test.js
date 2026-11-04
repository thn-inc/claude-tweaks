// tests/cross-repo-blocker-readers-conformance.test.js — #4793.
//
// Backlog's native blocked-by attachment (overview's pre-attach and Step 3, refine's detection)
// attaches `openNativeBlockerRefs(node)`: this repository's open blocker numbers plus each
// still-blocking foreign blocker as its qualified `owner/name#N` string, which funnelBuckets
// counts as wired (Decisions Q6). Each region's facts are a fact list, proven to go red on its own
// with the shared helpers; the retired open-filter literal gets its own absence assertion and control.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith } = require('./helpers/conformance-asserts');

const BACKLOG_DIR = path.join(__dirname, '..', 'plugin', 'skills', 'backlog');
const OVERVIEW = readText(path.join(BACKLOG_DIR, 'overview-mode.md'));
const REFINE = readText(path.join(BACKLOG_DIR, 'refine-mode.md'));

// The prose hard-wraps in places and capitalises some mandated sentences, so regions are
// whitespace-collapsed and the patterns that match a sentence start are case-insensitive.
const collapse = (text) => text.replace(/\s+/g, ' ');

const PRE_ATTACH_FACTS = [
  [/r\.blockedBy = openNativeBlockerRefs\(node\)/, 'the pre-attach sets r.blockedBy from openNativeBlockerRefs(node)'],
  [/qualified `owner\/name#N` string \(#4793\)/i, 'the pre-attach names a foreign blocker as its qualified owner/name#N string'],
  [/`owner\/name#N \(state unreadable\)` when its state is unreadable/, 'the pre-attach names an unreadable foreign state with the suffix'],
];
const FUNNEL_NOTE_FACTS = [
  [/A qualified `owner\/name#N` entry counts too \(#4793, Decisions Q6\)/i, 'the funnel note says a qualified entry counts as a blocker'],
  [/as `owner\/name#N \(state unreadable\)` in the latter case/, 'the funnel note names an unreadable foreign state with the suffix'],
  [/body-declared foreign blockers/, 'the funnel note says the script attaches body-declared foreign blockers'],
  [/to any ready\+granted record/, 'the funnel note covers every ready+granted record, not only those with nothing attached'],
  [/merges each one that is open or unreadable/, 'the funnel note says attachBodyForeignBlockers merges rather than skips'],
];
const FUNNEL_SNIPPET_FACTS = [
  [/bl\.attachBodyForeignBlockers\(/, 'the funnel snippet attaches the body-declared foreign blockers'],
  [/bodyForeignBlockers\(bl\.readyGrantedSubset\(/, 'the funnel snippet looks up the ready+granted subset in one bodyForeignBlockers call'],
];
const BODY_TEXT_FACTS = [
  [/attachBodyForeignBlockers/, 'Step 3 body-text bullet attaches attachBodyForeignBlockers'],
  [/same `bodyForeignBlockers` call as Step 2's funnel script/, 'Step 3 body-text bullet reuses Step 2\'s bodyForeignBlockers call'],
];
const STEP3_FACTS = [
  [/attach `blockedBy: openNativeBlockerRefs\(node\)`/, 'Step 3 attaches blockedBy from openNativeBlockerRefs(node)'],
  [/`owner\/name#N \(state unreadable\)` when its state is unreadable/, 'Step 3 names an unreadable foreign state with the suffix'],
];
const REFINE_FACTS = [
  [/attaching `openNativeBlockerRefs\(node\)` per candidate/, 'refine attaches openNativeBlockerRefs(node) per candidate'],
  [/`owner\/name#N \(state unreadable\)` when its state is unreadable/, 'refine names an unreadable foreign state with the suffix'],
];

const region = (text, prefix) => {
  const line = lineStartingWith(text, prefix);
  assert.notEqual(line, '', `no line starts with ${JSON.stringify(prefix)} -- the region anchor is out of sync with the live file`);
  return collapse(line);
};

const REGIONS = [
  ['overview pre-attach', region(OVERVIEW, 'On `work-links: native`: check field availability'), PRE_ATTACH_FACTS],
  ['overview funnel note', region(OVERVIEW, 'The funnel-computation script below then reads'), FUNNEL_NOTE_FACTS],
  ['overview funnel snippet', region(OVERVIEW, '  const all = bl.attachBodyForeignBlockers('), FUNNEL_SNIPPET_FACTS],
  ['overview Step 3', region(OVERVIEW, '  - **`work-links: native`**'), STEP3_FACTS],
  ['overview Step 3 body-text', region(OVERVIEW, '  - **`work-links: body-text`**'), BODY_TEXT_FACTS],
  ['refine detection', region(REFINE, '- Refine runs the detection itself'), REFINE_FACTS],
];

for (const [name, text, facts] of REGIONS) {
  test(`${name} attaches a foreign native blocker as owner/name#N (#4793)`, () => {
    const missing = missingFactsOf(facts);
    assert.deepEqual(missing(text), [], `${name} states every fact`);
    assertEachPatternGoesRed(text, facts, missing);
  });
}

const LEGACY_FILTER = 'nodes.filter(open).map(number)';
const NO_LEGACY_MESSAGE = 'overview-mode.md still attaches nodes.filter(open).map(number), which drops a foreign blocker';
const assertNoLegacyFilter = (text) => assert.ok(!text.includes(LEGACY_FILTER), NO_LEGACY_MESSAGE);

test('overview no longer attaches the open-filter that drops a foreign blocker (#4793)', () => {
  assertNoLegacyFilter(OVERVIEW);
  const mutated = `${OVERVIEW}\nr.blockedBy = ${LEGACY_FILTER}\n`;
  assert.notEqual(mutated, OVERVIEW);
  assert.throws(() => assertNoLegacyFilter(mutated), { message: NO_LEGACY_MESSAGE });
});

const LEGACY_BODY_TEXT = "attach nothing — `blockersOf`'s `parseDependencies` fallback stands.";
const NO_LEGACY_BODY_TEXT_MESSAGE = 'overview-mode.md Step 3 still says a body-text record attaches nothing, which drops a body-declared foreign blocker';
const assertNoLegacyBodyText = (text) => assert.ok(!text.includes(LEGACY_BODY_TEXT), NO_LEGACY_BODY_TEXT_MESSAGE);

test('overview Step 3 no longer says a body-text record attaches nothing (#4793)', () => {
  assertNoLegacyBodyText(OVERVIEW);
  const mutated = `${OVERVIEW}\n  - **\`work-links: body-text\`**: ${LEGACY_BODY_TEXT}\n`;
  assert.notEqual(mutated, OVERVIEW);
  assert.throws(() => assertNoLegacyBodyText(mutated), { message: NO_LEGACY_BODY_TEXT_MESSAGE });
});
