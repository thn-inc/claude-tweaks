'use strict';

// Pins skills/specify/record-creation.md Step 4's native-linking procedure to the
// one helper command (bin/link-records.js, #610), which owns the two facts #608
// first pinned: the sub_issues endpoint takes the sub-issue's database ID (never
// its number) and the blocked_by dependency endpoint must be named. The prose
// must cite the helper and must not carry a raw `sub_issue_id=` snippet any more —
// the module test (tests/bin-lib/issues/link.test.js) is where the identifier
// discrimination now lives.
//
// Also pins Step 4's body-text branch (#316): the mechanical-vs-prose rule that
// governs how a `Blocked by #N: {assumption}` line's trailing text is authored.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

// #1346 split record-creation.md at the Step 3/Step 4 boundary; Step 4's Linking
// section (this file's whole subject) landed in record-creation-linking.md.
const FILE = path.join(__dirname, '..', 'plugin', 'skills', 'specify', 'record-creation-linking.md');
const text = readText(FILE);

test('native linking cites bin/link-records.js with its argument shape', () => {
  assert.match(text, /bin\/link-records\.js/, 'record-creation.md must cite the helper');
  assert.match(text, /--parent \$PARENT_NUM --subs/, 'the invocation must show --parent/--subs');
  assert.match(text, /--blocked-by/, 'the invocation must show --blocked-by for dependency edges');
});

test('no raw sub_issues or blocked_by write snippet remains in the native branch', () => {
  assert.doesNotMatch(text, /sub_issue_id=/, 'the raw sub_issues write moved into bin/lib/issues/link.js');
  assert.doesNotMatch(text, /-F issue_id=/, 'the raw blocked_by write moved into bin/lib/issues/link.js');
});

test('the gh-absent posture names the body-text fallback, not an MCP path', () => {
  assert.match(text, /requires `gh`/, 'must say the helper requires gh');
  assert.match(text, /work-links: body-text/, 'must name the body-text fallback');
  assert.doesNotMatch(text, /github-write-transport\.md[^.\n]*MCP path (?:covers|handles|supports) (?:them|these)/, 'never claim the MCP path covers these endpoints');
  assert.match(text, /MCP path does not cover them/, 'must state plainly that the MCP path does not cover them');
});

test('the caller is told to read `failed`', () => {
  assert.match(text, /`failed`/, 'the prose must tell the caller to read the envelope\'s failed list');
});

test('the helper invocation prints its envelope to stdout (no /tmp redirect)', () => {
  assert.doesNotMatch(text, /link-records\.js[^\n]*\n[^\n]*> \/tmp\//, 'do not redirect the envelope away from the tool result');
});

test('the Blocked-by assumption bullet distinguishes mechanical from prose-shape assumptions', () => {
  assert.match(text, /mechanical, not prose-shape/, 'record-creation.md must carry the mechanical-vs-prose authoring rule');
  assert.match(text, /never a specific prose string, documentation wording/, 'the rule must rule out prose/documentation-shape assumptions specifically');
  assert.match(text, /exposes getStatus\(\) on the queue module/, 'the rule must include a mechanical (safe) example');
  assert.match(text, /documents the retry-window default as "5 minutes"/, 'the rule must include a prose-shape (fragile) example');
});
