// tests/flow-cross-repo-header-conformance.test.js — #4793.
//
// materialize.md's `blocked-by` header bullet and its `--check` paragraph name a body-declared
// foreign blocker in its qualified `owner/name#N` form (Decisions Q3, Q7), listed after this
// repository's numbers, and say the foreign entry keeps `/flow` 2.7b's call running. Each region's
// facts are a fact list, proven to go red on its own with the shared helpers. Task 13 adds
// multi-spec's Prerequisites step, the preflight-failure Blocker landing paragraph and
// plugin-structure.md's preflight-records row, which say the same under either work-links value.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith } = require('./helpers/conformance-asserts');

const MATERIALIZE = readText(path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'materialize.md'));

const MULTI_SPEC = readText(path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'multi-spec.md'));
const PREFLIGHT_FAILURE = readText(path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'multispec-preflight-failure.md'));
const PLUGIN_STRUCTURE = readText(path.join(__dirname, '..', 'docs', 'plugin-structure.md'));

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

// Task 13: multi-spec's Prerequisites reader and the preflight-failure paragraph judge a
// body-declared foreign blocker under either work-links value, and fail it closed without gh.
const PREREQUISITES_FACTS = [
  [/A qualified `owner\/name#N` entry is another repository's issue — never an in-run edge and never this repository's `#N`/i, 'Prerequisites: a qualified entry is never an in-run edge and never this repository\'s #N'],
  [/under either `work-links` value/, 'Prerequisites: the cross-repository verdict holds under either work-links value'],
];
const LANDING_FACTS = [
  [/a body-declared foreign blocker reads state unreadable/, 'Blocker landing: under --records-json a body-declared foreign blocker reads state unreadable'],
];
// preflight-records.js's header comment says the same; it is a source file, so it is not read here.
const STRUCTURE_FACTS = [
  [/plus `repository` \(`owner\/name`\) on a cross-repository entry/, 'plugin-structure.md: a cross-repository landing entry carries a repository key'],
  [/a failed or `--records-json` lookup exits 0 with a stderr line, every such ref reading `open`\/`cross-repository-state-unreadable`, never exit 1/, 'plugin-structure.md: a failed body-declared state lookup exits 0 with a stderr line, never exit 1'],
];

const REGIONS = [
  ['materialize.md', 'blocked-by header bullet', region(MATERIALIZE, '- `blocked-by`'), HEADER_FACTS],
  ['materialize.md', '--check paragraph', region(MATERIALIZE, '**`bin/materialize.js <n> --check'), CHECK_FACTS],
  ['multi-spec.md', 'Prerequisites step', region(MULTI_SPEC, '2. **Prerequisites**'), PREREQUISITES_FACTS],
  ['multispec-preflight-failure.md', 'Blocker landing paragraph', region(PREFLIGHT_FAILURE, '**Blocker landing.**'), LANDING_FACTS],
  ['plugin-structure.md', 'preflight-records.js row', region(PLUGIN_STRUCTURE, 'node plugin/bin/preflight-records.js '), STRUCTURE_FACTS],
];

for (const [file, name, text, facts] of REGIONS) {
  test(`${file} ${name} states its cross-repository blocker facts (#4793)`, () => {
    const missing = missingFactsOf(facts);
    assert.deepEqual(missing(text), [], `${name} states every fact`);
    assertEachPatternGoesRed(text, facts, missing);
  });
}
