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
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith, sectionOf } = require('./helpers/conformance-asserts');

const BACKLOG_DIR = path.join(__dirname, '..', 'plugin', 'skills', 'backlog');
const OVERVIEW = readText(path.join(BACKLOG_DIR, 'overview-mode.md'));
const REFINE = readText(path.join(BACKLOG_DIR, 'refine-mode.md'));
const REFINE_LANES = readText(path.join(BACKLOG_DIR, 'refine-lanes.md'));

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
  [/`foreignLookupSet` leaves `unsynced` local records out/, 'the funnel note says unsynced local records stay out of the lookup'],
  [/merges each one that is open or unreadable/, 'the funnel note says attachBodyForeignBlockers merges rather than skips'],
];
const FUNNEL_SNIPPET_FACTS = [
  // The region anchor already pins `bl.attachBodyForeignBlockers(`; these facts carry what it does not.
  [/bodyForeignBlockers\(bl\.foreignLookupSet\(bl\.readyGrantedSubset\(raw\)\)\)\)/, 'the funnel snippet looks up the ready+granted subset, minus unsynced records, in one bodyForeignBlockers call'],
];
const BODY_TEXT_FACTS = [
  [/attachBodyForeignBlockers/, 'Step 3 body-text bullet attaches attachBodyForeignBlockers'],
  [/`bodyForeignBlockers\(bl\.foreignLookupSet\(candidates\)\)` called again over it \(not Step 2's result map/, 'Step 3 body-text bullet calls bodyForeignBlockers again over its own candidate set, unsynced records excluded'],
];
const STEP3_FACTS = [
  [/attach `blockedBy: openNativeBlockerRefs\(node\)`/, 'Step 3 attaches blockedBy from openNativeBlockerRefs(node)'],
  [/`owner\/name#N \(state unreadable\)` when its state is unreadable/, 'Step 3 names an unreadable foreign state with the suffix'],
  [/After the attachment \(and on a degraded run too\), apply `bl\.attachBodyForeignBlockers` over this candidate set/, 'Step 3 re-applies attachBodyForeignBlockers after the native attachment'],
  [/`bodyForeignBlockers\(bl\.foreignLookupSet\(candidates\)\)` called again over it \(not Step 2's result map/, "Step 3's native bullet calls bodyForeignBlockers again over its own candidate set, unsynced records excluded"],
  [/merged \(once per `owner\/name#N`\) into the `blockedBy` just attached/, 'Step 3 says the body-declared blocker merges into the native blockedBy once per key'],
];
const REFINE_FACTS = [
  [/attaching `openNativeBlockerRefs\(node\)` per candidate/, 'refine attaches openNativeBlockerRefs(node) per candidate'],
  [/`owner\/name#N \(state unreadable\)` when its state is unreadable/, 'refine names an unreadable foreign state with the suffix'],
];
// The unresolved-dependency check and refine's repair read a qualified line as wired (#4793, Plan
// Review Clarifications): the detection line and the repair lane's population paragraph both say so.
const WIRED_FOREIGN_FACTS = [
  [/a qualified `owner\/name#N` line is a wired foreign blocker/i, 'a qualified owner/name#N line is a wired foreign blocker'],
  [/never takes a bare `#N` from a qualified `owner\/name#N` mention/i, 'a repair never takes a bare #N from a qualified owner/name#N mention'],
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

const WIRED_FOREIGN_REGIONS = [
  ['refine detection', region(REFINE, '- Refine runs the detection itself')],
  ['refine-lanes Dependency repair', collapse(sectionOf(REFINE_LANES, '## Dependency repair'))],
];

for (const [name, text] of WIRED_FOREIGN_REGIONS) {
  test(`${name}: a qualified owner/name#N line is wired, and a repair never takes a bare #N from a qualified mention (#4793)`, () => {
    const missing = missingFactsOf(WIRED_FOREIGN_FACTS);
    assert.deepEqual(missing(text), [], `${name} states every fact`);
    assertEachPatternGoesRed(text, WIRED_FOREIGN_FACTS, missing);
  });
}

// The gh-absent headless grant pre-pass (backlog/mcp-transport.md) has no CLI to look the foreign states up,
// so its prose reads them with issue_read and hands them over; filterCandidates' third argument is required.
const MCP_TRANSPORT = collapse(sectionOf(readText(path.join(BACKLOG_DIR, 'mcp-transport.md')), '## Step 1 + Step 2 Phase A — ready-queue fetch and gates 1-3'));
const MCP_FOREIGN_FACTS = [
  [/`filterCandidates`' third argument is required/, 'the MCP path says filterCandidates takes a required third argument'],
  [/Run `filterCandidates\(issues, openNumbers, new Map\(\)\)` for the cheap survivors/, 'the MCP path runs the cheap filter with an explicit empty Map'],
  [/read each survivor's body-declared foreign refs \(`Blocked by owner\/name#N` lines\) with `issue_read` \(`get` method\)/i, 'the MCP path reads each survivor\'s body-declared foreign refs with issue_read'],
  [/one states object keyed `owner\/name#N`, each value copied from `issue_read`'s `state` \(any case\) or `null` for a ref it cannot read/, 'the MCP path builds a states object keyed owner/name#N from issue_read\'s state, null when unreadable'],
  [/`bodyForeignBlockers\(cheapSurvivors, \{ states \}\)`/, 'the MCP path computes bodyForeignBlockers(cheapSurvivors, { states })'],
  [/pass it as the third argument of the second `filterCandidates` call/, 'the MCP path passes the Map as the second filterCandidates call\'s third argument'],
  [/A ref left out, or `null`, still blocks \(fail closed\)/, 'a ref left out or null still blocks'],
  [/`backlog overview` hard-gates on `gh`, so it has no `gh`-absent funnel to supply states to/, 'backlog overview hard-gates on gh, so it has no gh-absent funnel to supply states to'],
];

test('backlog mcp-transport.md reads body-declared foreign blockers with issue_read and passes them to the pre-pass (#4793)', () => {
  const missing = missingFactsOf(MCP_FOREIGN_FACTS);
  assert.deepEqual(missing(MCP_TRANSPORT), [], 'mcp-transport.md states every fact');
  assertEachPatternGoesRed(MCP_TRANSPORT, MCP_FOREIGN_FACTS, missing);
});

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
