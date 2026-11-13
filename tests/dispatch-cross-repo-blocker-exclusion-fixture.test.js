// tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js — #4793.
//
// A blocker linked natively or declared in the body from another repository blocks its dependent exactly when its state is
// not CLOSED (open or unreadable), and the Blocked-exclusion report names it `owner/name#N`, never
// as this repository's `#N`. The report, the MCP section and the queue notes are pinned with the
// shared fact-list helpers, each fact proven to go red on its own.
//
// #5230: the queue pull's behavior is pinned against the queue-pull module
// (plugin/bin/lib/dispatch/queue-pull.js) in tests/bin-lib/dispatch/queue-pull.test.js: the native
// crossRepoBlockers states (`#5230 blocked, native`), the body-declared foreign blocker held, released
// and failed closed (`#5227 foreign blocker` tests), and a supplied states file keyed in another case
// with a ref left out of it (`#5230 foreign blocker`).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, sectionOf } = require('./helpers/conformance-asserts');

const ROOT = path.join(__dirname, '..');
const DISPATCH_DIR = path.join(ROOT, 'plugin', 'skills', 'dispatch');

// The report and the MCP section hard-wrap at about 100 columns, so whitespace is collapsed first.
const collapse = (text) => text.replace(/\s+/g, ' ');

const REPORT_FACTS = [
  [/A `blockedBy` entry that is a string — `owner\/name#N`/, 'a string blockedBy entry is an owner/name#N foreign blocker'],
  [/a blocker linked natively or declared by a `Blocked by owner\/name#N` line, optionally suffixed ` \(state unreadable\)` when its state could not be read/, 'a string entry covers a native link and a body-declared Blocked by owner/name#N line'],
  [/renders verbatim, never with a `#` prefix/, 'a string entry renders verbatim, never with a # prefix'],
];
const MCP_FACTS = [
  [/a mention naming another repository \(`owner\/name#N`\)/i, 'a mention naming another repository is owner/name#N'],
  [/open or unreadable, it blocks/, 'a foreign blocker that is open or unreadable blocks'],
  [/suffixed ` \(state unreadable\)` when `issue_read` cannot read its state/, 'an unreadable foreign state is suffixed (state unreadable)'],
  [/read each with `issue_read` \(`get` method; its `owner`, `repo` and `issue_number`\)/, 'the MCP agent reads each body-declared foreign ref with issue_read'],
  [/write the states as one JSON object keyed by `owner\/name#N`, each value copied from `issue_read`'s `state` \(any case\) or `null`/, 'the MCP agent writes the states as a JSON object keyed by owner/name#N, copying issue_read\'s state in any case'],
  // #5230: the path rides on the queue-pull.js call as --foreign-states, so no shell variable has to survive between Bash calls.
  [/Pass its path as `--foreign-states \{path\}` on that call: the flag names the file for that one CLI run, so no shell variable has to survive between Bash calls/i, 'the MCP agent passes the states file as --foreign-states {path} on the queue-pull.js call, so no shell variable has to survive between calls'],
  [/A ref left out of the file, or `null`, still excludes the record as `owner\/name#N \(state unreadable\)` \(fail closed\)/i, 'a ref left out or null still excludes the record (state unreadable)'],
  // #5230 final review M2: the set is the `blocked` pass's, computable before the pull, and a ref outside it is still safe.
  [/collect the body-declared foreign refs \(`Blocked by owner\/name#N` lines\) of every queue record that carries none of `bot:in-progress`, `bot:blocked` or `bot:parked`/, 'the MCP agent collects the foreign refs of every queue record with no bot:* label'],
  [/the CLI asks `bin\/resolve-foreign-blockers\.js` for a ref left out of the file, a lookup that needs `gh` and fails on this transport with one `Warning:` line/, 'a ref left out of the file is asked of resolve-foreign-blockers.js, which fails on this transport'],
];
const NOTES_FACTS = [
  [/suffixed ` \(state unreadable\)` when its state could not be read/, 'the queue notes name an unreadable foreign state with the suffix'],
  [/`bodyForeignBlockers` \(`bin\/lib\/issues\/cross-repo-states\.js`\) looks up every such ref in one batched call/, 'the body-text pass looks up every Blocked by owner/name#N ref in one batched call'],
  [/`partitionByOpenBodyBlockers` drops the candidate while that blocker is open or its state is unreadable/, 'the body-text pass drops a candidate whose body-declared foreign blocker is open or unreadable'],
  [/a failed lookup reads unreadable \(fail closed, one `Warning:` line\)/, 'a failed body-text lookup fails closed with one Warning line'],
  [/naming it `owner\/name#N` or `owner\/name#N \(state unreadable\)`/, 'the body-text pass names a blocker owner/name#N or owner/name#N (state unreadable)'],
  [/a CLOSED one does not block/, 'a CLOSED body-declared foreign blocker does not block'],
  [/The queue-order cache \(#1571\) is never a hit while any `auto:build` body declares such a line \(`queue-order\.js`'s `cacheUsable`\), because a foreign issue closing changes nothing in its freshness signal/i, 'the queue-order cache is never a hit while an auto:build body declares a qualified foreign Blocked by line'],
];

test('the report and the MCP workaround name a foreign blocker owner/name#N (#4793)', () => {
  const report = collapse(readText(path.join(DISPATCH_DIR, 'blocked-exclusion-report.md')));
  const mcpSection = collapse(sectionOf(
    readText(path.join(DISPATCH_DIR, 'mcp-transport.md')),
    '## Step 2 — native blocked-by / linked-PR batching: no generic GraphQL bridge (#2523)',
  ));

  const notes = collapse(readText(path.join(DISPATCH_DIR, 'queue-pull-notes.md')));

  const missingFromReport = missingFactsOf(REPORT_FACTS);
  const missingFromMcp = missingFactsOf(MCP_FACTS);
  const missingFromNotes = missingFactsOf(NOTES_FACTS);
  assert.deepEqual(missingFromReport(report), [], 'blocked-exclusion-report.md states every fact');
  assert.deepEqual(missingFromMcp(mcpSection), [], 'mcp-transport.md states every fact');
  assert.deepEqual(missingFromNotes(notes), [], 'queue-pull-notes.md states every fact');
  assertEachPatternGoesRed(report, REPORT_FACTS, missingFromReport);
  assertEachPatternGoesRed(mcpSection, MCP_FACTS, missingFromMcp);
  assertEachPatternGoesRed(notes, NOTES_FACTS, missingFromNotes);
});
