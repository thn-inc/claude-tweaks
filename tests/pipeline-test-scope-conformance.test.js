// tests/pipeline-test-scope-conformance.test.js — pins #5117: a pipeline ran the full local suite
// K+3 times (every per-task implementer, the fix wave, then Common Step 5); the affected-set rule
// scopes every earlier run, so Common Step 5's verification run is the branch's one suite run.
// This file pins the /build side (dispatch.md's rule, the batched pointer); later blocks pin the rest.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith } = require('./helpers/conformance-asserts');

const PLUGIN = path.join(__dirname, '..', 'plugin');
const BUILD_DISPATCH = path.join(PLUGIN, 'skills', 'build', 'dispatch.md');
const BUILD_SKILL = path.join(PLUGIN, 'skills', 'build', 'SKILL.md');

const AFFECTED_SET_FACTS = [
  [/\*\*Affected-set testing \(#5117\)\.\*\*/, 'the rule is labeled'],
  [/per-task implementer, fix-wave and whole-branch-fix dispatch run the affected test set/, 'covers implementers and the fix wave'],
  [/run the full suite once before committing/, "names the SDD line it replaces"],
  [/declares `impact`, what `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/verify\.js" --scope/, 'impact-map selection when declared'],
  [/scoped to the touched packages or paths, plus any test that reads or imports a touched file/, 'the judgment fallback'],
  [/Under `batched` the same rule covers the controller's own per-task runs/, 'the batched strategy'],
  [/Common Step 5's verification run \(full, or impact-selected when declared\) is the branch's one suite run/, 'one suite run'],
];
const affectedSetMissing = missingFactsOf(AFFECTED_SET_FACTS);

test("build/dispatch.md carries the affected-set rule (#5117)", () => {
  assert.deepEqual(affectedSetMissing(readText(BUILD_DISPATCH)), []);
});

test('the affected-set facts can go red', () => {
  assertEachPatternGoesRed(readText(BUILD_DISPATCH), AFFECTED_SET_FACTS, affectedSetMissing);
});

const FOREGROUND_FACTS = [
  [/run the project's test command \(test\/verification\.md Step 1\) and every other long-running command in the foreground of that turn/, "the foreground instruction names the project's test command"],
];
const foregroundMissing = missingFactsOf(FOREGROUND_FACTS);

test("build/dispatch.md's foreground instruction names the project's test command (#5117)", () => {
  assert.deepEqual(foregroundMissing(readText(BUILD_DISPATCH)), []);
});

test('the foreground fact can go red', () => {
  assertEachPatternGoesRed(readText(BUILD_DISPATCH), FOREGROUND_FACTS, foregroundMissing);
});

const BATCHED_FACTS = [
  [/affected-set rule \(#5117\)/, 'the batched line folds in the affected-set rule'],
];
const batchedMissing = missingFactsOf(BATCHED_FACTS);

test("build/SKILL.md's batched line folds in the affected-set rule (#5117)", () => {
  const line = lineStartingWith(readText(BUILD_SKILL), '**batched**: Invoke');
  assert.notEqual(line, '', 'the "**batched**: Invoke" line was not found in build/SKILL.md');
  assert.deepEqual(batchedMissing(line), []);
});

test('the batched fact can go red', () => {
  assertEachPatternGoesRed(lineStartingWith(readText(BUILD_SKILL), '**batched**: Invoke'), BATCHED_FACTS, batchedMissing);
});
