'use strict';
// Pins #3047: /review Step 6.7 re-runs the QA stories an applied fix wave
// touched (via /claude-tweaks:test qa affected), and the summary/verdict
// comment qualify QA as stale when that re-run cannot happen.
const { test } = require('node:test');
const assert = require('node:assert');
const { readText } = require('./helpers/read-skill');
const path = require('node:path');
const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');

const REVIEW = path.join(__dirname, '..', 'plugin', 'skills', 'review');
const steps = readText(path.join(REVIEW, 'code-mode-steps.md'));
for (const heading of ['### Step 3 Routing — Code Review Findings', '## Step 4:', '## Step 5:', '## Step 6.7:', '## Step 7:', '## Important Notes']) {
  assert.ok(steps.includes(heading), `anchor heading missing: ${heading}`);
}
const step3 = steps.slice(steps.indexOf('### Step 3 Routing — Code Review Findings'), steps.indexOf('## Step 4:'));
const step4 = steps.slice(steps.indexOf('## Step 4:'), steps.indexOf('## Step 5:'));
const step67 = steps.slice(steps.indexOf('## Step 6.7:'), steps.indexOf('## Step 7:'));
const step7 = steps.slice(steps.indexOf('## Step 7:'), steps.indexOf('## Important Notes'));

const template = readText(path.join(REVIEW, 'review-summary-template.md'));
for (const heading of ['### QA Validation (from /test)', '### Code Review Findings']) {
  assert.ok(template.includes(heading), `anchor heading missing: ${heading}`);
}
const qa = template.slice(template.indexOf('### QA Validation (from /test)'), template.indexOf('### Code Review Findings'));

test('AC1.1: Step 6.7 re-runs affected stories via test qa affected, gated on a fix touching story source_files', () => {
  assert.ok(step67.includes('`/claude-tweaks:test qa affected --source review`'));
  assert.ok(step67.includes('`git stash create`'));
  assert.ok(step67.includes('`git rev-parse HEAD`'));
  assert.ok(step67.includes("`git diff --name-only {WAVE_BASE}`"));
  assert.ok(step67.includes("every QA story's `source_files`"));
  assert.ok(step67.indexOf('`git stash create`') < step67.indexOf('\n1. '), 'WAVE_BASE is captured before item 1');
});

test('#3771: Step 4 re-runs /test with the --source review parent signal', () => {
  assert.ok(step4.includes('re-run `/claude-tweaks:test --source review` before proceeding'));
});

test('AC1.1 (#3598): a Step 3 Routing fix wave gets the same affected-story re-run, one base per review', () => {
  assert.ok(step3.includes('**QA after a Step 3 fix wave (#3598).**'));
  assert.ok(step3.includes('once per review, not once per wave'));
  assert.ok(step3.includes('Before Step 3 Routing applies its first fix'));
  assert.ok(step3.includes('When Step 6.7 does not run, run its item 4 on its own, right before Step 7'));
  assert.ok(step67.includes('unless Step 3 Routing already captured it this review'));
  assert.ok(step67.includes('if any fix was applied in either wave (Step 3 Routing or this step)'));
});

test('AC2.1: the template says what the QA line reads when the pre-wave status was Skipped or Not run', () => {
  assert.ok(qa.includes('**Never-run pre-wave status (#3598):**'));
  assert.ok(qa.includes(' — post-wave re-run only ({ids}); no pre-wave QA results'));
  assert.ok(qa.includes('there is no earlier pass to call stale'));
  assert.ok(step67.includes("there is nothing to merge into, and the QA line renders per `review-summary-template.md`'s never-run rule"));
});

test('AC3.1 gap 2: untracked new files from an uncommitted Fix-now edit count toward the intersection', () => {
  assert.ok(step67.includes('`git ls-files --others --exclude-standard`'));
});

test('AC3.1 gap 3: a tree dirty before the wave is captured by git stash create, falling back to HEAD on a clean tree', () => {
  assert.ok(step67.includes('it writes no stash entry and leaves the tree alone'));
  assert.ok(step67.includes('when it prints nothing (a clean tree), run `git rev-parse HEAD` instead'));
});

test('AC3.1 gap 5: the wider-than-wave qa affected selection is stated as accepted', () => {
  assert.ok(step67.includes('accepted (#3598): that set is wider than the wave'));
  assert.ok(step67.includes('never misses a touched story'));
});

test('AC1.1 (#3598): the template qualifier covers both waves from one base', () => {
  assert.ok(qa.includes("Step 3 Routing's, Step 6.7's, or both, all measured from one `{WAVE_BASE}`"));
});

test('Deliverable 3: the rule covers interactive Fix now as well as auto-applied fixes', () => {
  assert.ok(step67.includes('auto-applied (AUTO) or interactive Fix now alike'));
});

test('AC2.1: no intersection (or no stories, or no applied fix) means no QA re-run', () => {
  assert.ok(step67.includes('No intersection — or no stories, or no applied fix — means no QA re-run'));
  assert.ok(step67.includes('no added cost for a non-UI wave'));
});

test('WAVE_BASE is carried as a literal SHA, never as shell state that a later Bash call has lost', () => {
  assert.ok(step67.includes('paste that literal SHA wherever `{WAVE_BASE}` appears'));
  assert.ok(step67.includes('Shell state does not persist between Bash calls'));
});

test('a touched story left unexecuted (skipped, stopped, unresolved base) renders the qualifier, not a green line', () => {
  assert.ok(step67.includes('did not actually re-execute'));
  assert.ok(step67.includes('reports that story SKIPPED'));
  assert.ok(step67.includes('No QA stories affected by current changes.'));
  assert.ok(qa.includes('left such a story unexecuted'));
});

test('Gotcha: a self-skipped or errored re-run renders the stale-QA qualifier, never the pre-wave status', () => {
  assert.ok(step67.includes('self-skips with no dev server or browser, or errors'));
  assert.ok(step67.includes('stale-QA qualifier'));
  assert.ok(step67.includes('never the pre-wave status unqualified'));
});

test('AC4.1: the verdict comment carries the same qualified QA status, no separate wording', () => {
  assert.ok(step7.includes("the QA status exactly as the summary's QA Validation line renders it (stale-QA qualifier included — no separate wording)"));
  assert.match(step7, /top findings by severity \(max 5\)/);
});

test('AC5.1: code-mode-steps.md stays under the Read-limit byte rail', () => {
  assert.ok(Buffer.byteLength(steps) <= RAIL_BYTES, `${Buffer.byteLength(steps)} > ${RAIL_BYTES}`);
});

test('AC3.1: the template documents the stale-QA qualifier and when it renders', () => {
  assert.ok(qa.includes('**Stale-QA qualifier (#3047):**'));
  assert.ok(qa.includes(" — ran before the review's fix wave ({N} commits since); stories touching changed files: {ids}"));
  assert.ok(qa.includes('`git rev-list --count {WAVE_BASE}..HEAD`'));
  assert.ok(qa.includes('re-run did not happen'));
  assert.ok(qa.includes('the qualifier never renders'));
});

test('AC4.1: the template states the verdict comment copies the qualified line verbatim', () => {
  assert.ok(qa.includes('The verdict comment (`code-mode-steps.md` Step 7) copies this line verbatim.'));
});

test('I-1: a failing post-wave re-run blocks the verdict', () => {
  assert.ok(step67.includes('A re-run that reports PARTIAL FAILURE or ALL FAILED makes the verdict BLOCKED'));
});

test('I-2: the subset re-run merges into pre-wave results and the status is recomputed over all stories', () => {
  assert.ok(step67.includes("merge its results into `/test`'s pre-wave per-story results (re-run stories take their new result, the rest keep theirs)"));
  assert.ok(step67.includes('recompute'));
  assert.ok(step67.includes('over all stories'));
  assert.ok(qa.includes('recomputed over all stories'));
  assert.ok(!qa.includes('report its own status'));
});

test('I-3: the test skill contract and the skill graph record the Step 6.7 qa affected edge', () => {
  const testSkill = readText(path.join(__dirname, '..', 'plugin', 'skills', 'test', 'SKILL.md'));
  const graph = readText(path.join(__dirname, '..', 'docs', 'skill-graph.md'));
  assert.ok(testSkill.includes("except `/claude-tweaks:review` Step 6.7's post-fix-wave `qa affected` re-run (#3047)"));
  assert.ok(graph.includes('Step 6.7 also invokes `/test qa affected`'));
});

test('M-1: the qualifier distinguishes uncommitted Fix-now edits from the commit count', () => {
  assert.ok(qa.includes('plus uncommitted edits'));
});

test('fix round 1 (#3598): the recompute applies to the merge path; the never-run rule replaces it', () => {
  assert.ok(step67.includes('instead of this recompute'));
  assert.ok(step67.includes('then recompute Step 7') && step67.includes('With no pre-wave per-story results'), 'both ordering markers exist');
  assert.ok(step67.indexOf('then recompute Step 7') < step67.indexOf('With no pre-wave per-story results'), 'recompute sentence precedes the never-run branch');
});

test('fix round 1 (#3598): the unexecuted-story qualifier rule carves out the never-run case', () => {
  assert.ok(step67.includes('unless the never-run rule applies, since a status from stories that never ran has no earlier pass to call stale'));
  assert.ok(qa.includes('unqualified (except under the never-run rule below)'));
  assert.ok(qa.includes('{stale-QA qualifier or never-run suffix, when one applies}'));
});

test('fix round 1 (#3598): Step 3 capture precedes parallel fix dispatch and Step 5 edits count', () => {
  assert.ok(step3.includes('and before any parallel fix dispatch'));
  assert.ok(step3.includes('A Step 5 simplification edit made after that capture falls inside the same diff'));
  assert.ok(!step67.includes('WAVE_BASE=$(git rev-parse HEAD)'), 'the old HEAD-only capture form is gone');
});

test('fix round 1 (#3598): the dirty-tree uncommitted-edits overstatement is stated as accepted', () => {
  assert.ok(qa.includes('accepted (#3598): on a tree dirty before the wave, that check also counts the pre-wave edits'));
});

test('wrap-up (#3598): the uncommitted-edits check also counts an untracked-only Fix-now wave', () => {
  assert.ok(qa.includes('`git diff --quiet HEAD` exits non-zero, or `git ls-files --others --exclude-standard` lists a file'));
  assert.ok(qa.includes('that check also counts the pre-wave edits and untracked files'));
});

test('fix round 1 (#3598): the test skill contract notes the Step 3 Routing wave', () => {
  const testSkill = readText(path.join(__dirname, '..', 'plugin', 'skills', 'test', 'SKILL.md'));
  assert.ok(testSkill.includes('which also covers a Step 3 Routing fix wave (#3598)'));
});

test('#3771: the test skill contract and Step 3 Routing name every standalone --source review call', () => {
  const testSkill = readText(path.join(__dirname, '..', 'plugin', 'skills', 'test', 'SKILL.md'));
  assert.ok(testSkill.includes('standalone calls (Step 1.5\'s "No recent pass" auto-trigger, Step 3 Routing\'s re-verify, Step 4\'s re-run, and Step 6.7\'s `qa affected` re-run'));
  const routing = readText(path.join(REVIEW, 'step3-routing.md'));
  assert.ok(routing.includes('Re-verification rule (`/claude-tweaks:test --source review`)'));
  assert.ok(routing.includes('then re-run `/claude-tweaks:test --source review`'));
});
