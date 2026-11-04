// tests/flow-cross-repo-header-conformance.test.js — #4793.
//
// materialize.md's `blocked-by` header bullet and its `--check` paragraph name a body-declared
// foreign blocker in its qualified `owner/name#N` form (Decisions Q3, Q7), listed after this
// repository's numbers, and say the foreign entry keeps `/flow` 2.7b's call running. Each region's
// facts are a fact list, proven to go red on its own with the shared helpers.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith } = require('./helpers/conformance-asserts');

const MATERIALIZE = readText(path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'materialize.md'));

// The prose hard-wraps in places and capitalises some mandated sentences, so regions are
// whitespace-collapsed and the patterns that match a sentence start are case-insensitive.
const collapse = (text) => text.replace(/\s+/g, ' ');

const region = (text, prefix) => {
  const line = lineStartingWith(text, prefix);
  assert.notEqual(line, '', `no line starts with ${JSON.stringify(prefix)} -- the region anchor is out of sync with the live file`);
  return collapse(line);
};

const HEADER_FACTS = [
  [/`parseCrossRepoDependencies\(body\)`/, 'the header bullet reads the body through parseCrossRepoDependencies(body)'],
  [/a `Blocked by owner\/name#N` line lists as its qualified `owner\/name#N`/i, 'the header bullet lists a foreign body blocker as its qualified owner/name#N'],
  [/its verdict is `--blocker-landing`'s cross-repository entry/i, 'the header bullet says a foreign blocker\'s verdict is the cross-repository landing entry'],
  [/Emit as `blocked-by: \[n1, n2, \.\.\., owner\/name#N, \.\.\.\]`/i, 'the header bullet emits the qualified entries after the numbers'],
];
const CHECK_FACTS = [
  [/and `Blocked by owner\/name#N` refs/i, 'the --check paragraph lists foreign body blockers in bodyBlockedBy'],
];

const REGIONS = [
  ['blocked-by header bullet', region(MATERIALIZE, '- `blocked-by`'), HEADER_FACTS],
  ['--check paragraph', region(MATERIALIZE, '**`bin/materialize.js <n> --check'), CHECK_FACTS],
];

for (const [name, text, facts] of REGIONS) {
  test(`materialize.md ${name} names a foreign blocker as owner/name#N (#4793)`, () => {
    const missing = missingFactsOf(facts);
    assert.deepEqual(missing(text), [], `${name} states every fact`);
    assertEachPatternGoesRed(text, facts, missing);
  });
}
