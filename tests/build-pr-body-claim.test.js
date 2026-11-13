'use strict';
// tests/build-pr-body-claim.test.js — pins #5340: a build decision line that claims the PR body carries
// something is made true in the same step (body edited before the line is logged), or the line is not written.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, sectionOf } = require('./helpers/conformance-asserts');

const TEXT = readText(path.join(__dirname, '..', 'plugin', 'skills', 'build', 'architecture-alignment.md'));
const REGION = sectionOf(TEXT, '## Claims about the PR body');

const FACTS = [
  [/applies to every build decision line, not only this step's rows/, 'scope: every build decision line'],
  [/edit it into the body before logging the line/, 'edit before log'],
  [/`pr\.number` in `run-state\.json` \(a bundle's parent run dir\), else the current branch's PR/, 'PR source matches review Step 1'],
  [/`gh pr view \{pr\} --json body -q \.body`, or `mcp__github__pull_request_read` without `gh`/, 'read command, both transports'],
  [/append the content below the `<!-- fixes-end -->` marker without touching its run markers/, 'placement outside rewritten spans'],
  [/`gh pr edit \{pr\} --body-file \{file\}`, or `mcp__github__update_pull_request`/, 'write command, both transports'],
  [/re-read it to confirm your content is there/, 'read back'],
  [/Bundle members share one PR, so if a concurrent edit dropped it, edit once more/, 'concurrent bundle writers'],
  [/log that the PR body does not carry it — never the claim/, 'failed edit logs the absence'],
];

test('the PR-body claim section states every fact', () => {
  assert.deepEqual(missingFactsOf(FACTS)(REGION), []);
});

test('each fact can go red', () => {
  assertEachPatternGoesRed(REGION, FACTS, missingFactsOf(FACTS));
});
