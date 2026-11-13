'use strict';
// tests/build-pr-body-claim.test.js — pins #5340: a build decision line that claims the PR body carries
// something is made true in the same step (body edited before the line is logged), or the line is not written.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, sectionOf } = require('./helpers/conformance-asserts');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills', 'build');
const TEXT = readText(path.join(SKILLS, 'architecture-alignment.md'));
const REGION = sectionOf(TEXT, '## Claims about the PR body');
const SKILL = readText(path.join(SKILLS, 'SKILL.md'));

const FACTS = [
  [/applies to every build decision line, not only this step's rows/, 'scope'],
  [/would say the PR body \(or PR description\) carries something/, 'trigger covers PR description'],
  [/edit it into the body before logging the line/, 'edit before log'],
  [/\(`review\/pr-body-deliverables\.md`'s Find the PR\)/, 'shared lookup'],
  [/`pr\.number` in `run-state\.json` \(a bundle's parent run dir\), else the current branch's PR/, 'PR source matches review Step 1'],
  [/`gh pr view \{pr\} --json body -q \.body`/, 'read command'],
  [/append the content below the `<!-- fixes-end -->` marker without touching its run markers/, 'placement outside rewritten spans'],
  [/\(`fixes #N` closes it at merge; write `issue #N`\)/, 'no closing phrase'],
  [/a session temp file named `pr-body-claim-\{run-id\}-\{n\}\.md` \(`bin\/session-tmp-resolve\.js`\) with the Write tool/, 'body file'],
  [/`gh pr edit \{pr\} --body-file \{file\}`/, 'write command'],
  [/re-read it to confirm your content is there/, 'read back'],
  [/do the read and the write through `_shared\/pr-checklist-refresh\.md`'s \*\*`gh` absent \(MCP\)\.\*\* paragraph, taking only its repair and run-id check \(the append replaces its row flip\)/, 'gh-absent procedure'],
  [/the closing-phrase rule and the read-back apply either way/, 'rules hold on both transports'],
  [/anchor on `\[claude-tweaks-fixes-end\]`/, 'MCP anchor'],
  [/Bundle members share one PR, so if a concurrent edit dropped it, edit once more/, 'concurrent bundle writers'],
  [/\(no PR, the write fails, or the second read-back still lacks it\)/, 'cannot-land triggers'],
  [/log that the PR body does not carry it — never the claim/, 'failed edit logs the absence'],
  [/#5297's build logged "PR body names them"/, 'incident cite'],
];

const POINTER_FACTS = [
  [/\*\*PR-body claims, any step\.\*\*/, 'pointer heading'],
  [/follows `architecture-alignment\.md`'s `## Claims about the PR body` first, whether or not Common Step 4\.5 runs/, 'pointer applies even when 4.5 is skipped'],
];

test('the PR-body claim section states every fact', () => {
  assert.deepEqual(missingFactsOf(FACTS)(REGION), []);
});

test('each fact can go red', () => {
  assertEachPatternGoesRed(REGION, FACTS, missingFactsOf(FACTS));
});

test('build/SKILL.md points every step at the PR-body claim rule', () => {
  assert.deepEqual(missingFactsOf(POINTER_FACTS)(SKILL), []);
});

test('each pointer fact can go red', () => {
  assertEachPatternGoesRed(SKILL, POINTER_FACTS, missingFactsOf(POINTER_FACTS));
});
