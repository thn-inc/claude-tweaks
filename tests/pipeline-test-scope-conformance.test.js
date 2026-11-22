// tests/pipeline-test-scope-conformance.test.js — pins #5117: a pipeline ran the full local suite
// K+3 times (every per-task implementer, the fix wave, then Common Step 5); the affected-set rule
// scopes every earlier run, so Common Step 5's verification run is the branch's one suite run.
// This file pins the /build side (dispatch.md's rule, the batched pointer); later blocks pin the rest.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith, sectionOf } = require('./helpers/conformance-asserts');

const PLUGIN = path.join(__dirname, '..', 'plugin');
const BUILD_DISPATCH = path.join(PLUGIN, 'skills', 'build', 'dispatch.md');
const BUILD_SKILL = path.join(PLUGIN, 'skills', 'build', 'SKILL.md');
const WORKTREE_SETUP = path.join(PLUGIN, 'skills', 'build', 'worktree-setup.md');
const BUILD_OPTIONS = path.join(PLUGIN, 'skills', 'build', 'build-options.md');
const ADOPT_FRESHNESS = path.join(PLUGIN, 'skills', '_shared', 'worktree-adopt-freshness.md');

const AFFECTED_SET_FACTS = [
  [/\*\*Affected-set testing \(#5117\)\.\*\*/, 'the rule is labeled'],
  [/per-task implementer, fix-wave and whole-branch-fix dispatch run the affected test set/, 'covers implementers and the fix wave'],
  [/run the full suite once before committing/, "names the SDD line it replaces"],
  [/declares \`impact\`, what \`node "\{plugin-root\}\/bin\/verify\.js" --scope/, 'impact-map selection when declared, via the plugin-root placeholder'],
  [/--integration-branch \{integration-branch\} --no-stamp\` selects/, 'the call is a targeted run that never stamps'],
  [/\`\/build\` fills \`\{plugin-root\}\`, \`\{slots\}\` and \`\{integration-branch\}\`/, 'the placeholders are filled by /build'],
  [/the project's \`--cmd\` flags \(\`test\/verification\.md\` Step 2/, 'the call passes the project --cmd flags'],
  [/and \`--default-suite-slots \{slots\}\` \(\`test\/verification\.md\`'s Suite slots paragraph\)/, 'the call passes the resolved suite-slot count (#5119)'],
  [/prints \`Scope: full\` or \`Impact: full …\`.{0,200}?or exits 2/, 'the full-mode trigger clause'],
  [/runs the fallback set for itself/, 'the triggering task runs the fallback itself'],
  [/scoped to the touched packages or paths, plus any test that reads or imports a touched file/, 'the judgment fallback'],
  [/directs every later task's dispatch to the fallback/, 'a full-mode run carries the switch to later tasks'],
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
  [/Read `dispatch\.md`'s \*\*Affected-set testing \(#5117\)\*\* rule and fold it in/, 'the batched line directs reading dispatch.md and folding in the rule'],
  [/covers this strategy's per-task and final whole-suite runs/, 'the pointer says what the rule covers'],
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

// Step 2 is the invocation: the imperative that directs the skill. Step 3 describes what the skill then handles.
const STEP2_FACTS = [
  [/Verify Clean Baseline/, 'names the upstream step'],
  [/`\$PIPELINE_RUN_DIR` is set/, 'pipeline-scoped'],
  [/tell it to skip/, 'the directive verb'],
  [/\(#5117\)/, 'tagged'],
];
const STEP3_FACTS = [
  [/predates Step 4's catch-up/, 'the stale-tree reason'],
  [/baseline adjudication and CI own base health/, 'who owns base health'],
  [/Standalone `\/build` keeps it\./, 'standalone carve-out'],
];
const step2Missing = missingFactsOf(STEP2_FACTS);
const step3Missing = missingFactsOf(STEP3_FACTS);
const procedureOf = () => sectionOf(readText(WORKTREE_SETUP), '## Procedure');
const step2Of = () => {
  const proc = procedureOf();
  const from = proc.indexOf('\n2. ');
  const to = proc.indexOf('\n3. ');
  assert.notEqual(from, -1, 'Procedure step 2 ("\\n2. ") was not found');
  assert.notEqual(to, -1, 'Procedure step 3 ("\\n3. ") was not found');
  assert.ok(to > from, 'Procedure step 3 must come after step 2');
  return proc.slice(from, to);
};

test("worktree-setup.md step 2 directs the skill to skip its baseline run inside a pipeline (#5117)", () => {
  assert.deepEqual(step2Missing(step2Of()), []);
});

test('the step-2 directive facts can go red', () => {
  assertEachPatternGoesRed(step2Of(), STEP2_FACTS, step2Missing);
});

test('build/worktree-setup.md step 3 states why the baseline run is skipped (#5117)', () => {
  const line = lineStartingWith(procedureOf(), '3. ');
  assert.notEqual(line, '', 'Procedure step 3 was not found');
  assert.deepEqual(step3Missing(line), []);
});

test('the step-3 baseline-skip facts can go red', () => {
  assertEachPatternGoesRed(lineStartingWith(procedureOf(), '3. '), STEP3_FACTS, step3Missing);
});

const BUILD_OPTIONS_FACTS = [
  [/baseline test run \(skipped inside a pipeline\)/, 'the Git row names the baseline run as skipped inside a pipeline'],
];
const buildOptionsMissing = missingFactsOf(BUILD_OPTIONS_FACTS);

test("build-options.md's Git row says the baseline run is skipped inside a pipeline (#5117)", () => {
  assert.deepEqual(buildOptionsMissing(readText(BUILD_OPTIONS)), []);
});

test("the build-options Git-row fact can go red", () => {
  assertEachPatternGoesRed(readText(BUILD_OPTIONS), BUILD_OPTIONS_FACTS, buildOptionsMissing);
});

const BASELINE_VERIFICATION_ABSENT = /baseline\s+test\s+verification/;
// Frozen pre-change bytes (origin/main's adopt-freshness text, which spans a newline) — the absence check's go-red control.
const PRE_CHANGE_FRESHNESS = 'branch creation, dependency install, baseline\ntest verification';

test('worktree-adopt-freshness.md no longer quotes the retired baseline verification (#5117)', () => {
  assert.doesNotMatch(readText(ADOPT_FRESHNESS), BASELINE_VERIFICATION_ABSENT);
});

test('the baseline-verification absence check can go red (#5117)', () => {
  assert.match(PRE_CHANGE_FRESHNESS, BASELINE_VERIFICATION_ABSENT);
});

const TASK_PROMPT = path.join(PLUGIN, 'skills', 'dispatch', 'task-prompt.md');
const EXPRESS_PROMPT = path.join(PLUGIN, 'skills', 'dispatch', 'express-prompt.md');
const NPM_TEST_SPAN = /\bnpm test\b/;
const PROJECT_TEST_CMD = /run the project's test command and every other long-running command/;
// Context pack item 7 of task-prompt.md, whitespace-squashed: it carries the project-test-command sentence (#5601).
function item7Squashed() {
  const text = readText(TASK_PROMPT);
  const start = text.indexOf('7. **Async-wait discipline**');
  assert.notEqual(start, -1, 'task-prompt.md lost its item 7 "Async-wait discipline" heading');
  const end = text.indexOf('\n8. ', start);
  assert.notEqual(end, -1, 'task-prompt.md: no "8. " item follows item 7');
  return text.slice(start, end).replace(/\s+/g, ' ');
}
const projectTestCmdCount = (s) => s.split(PROJECT_TEST_CMD).length - 1;

test("AC3.3: task-prompt.md item 7 names the project's test command exactly once (#5601)", () => {
  assert.equal(projectTestCmdCount(item7Squashed()), 1);
});

test("AC3.3: stripping item 7's project-test-command sentence drops the count to zero (#5601)", () => {
  const item7 = item7Squashed();
  const stripped = item7.replace(PROJECT_TEST_CMD, '');
  assert.notEqual(stripped, item7);
  assert.equal(projectTestCmdCount(stripped), 0);
});

// Frozen pre-change bytes (the replaced Foreground paragraph head) — the checks' go-red control.
const PRE_CHANGE_FOREGROUND = 'Foreground execution (required): run `npm test` and every other long-running command in the\nforeground of this turn';

test('no shipped dispatch prompt instructs a literal npm test (#5117)', () => {
  for (const file of [BUILD_DISPATCH, TASK_PROMPT, EXPRESS_PROMPT]) {
    assert.doesNotMatch(readText(file), NPM_TEST_SPAN, `${path.basename(file)} still holds a literal npm test instruction`);
  }
});

test('the npm test absence check can go red (#5117)', () => {
  assert.match(PRE_CHANGE_FOREGROUND, NPM_TEST_SPAN);
});

const foregroundParagraphs = (text) => text.split(/\n\s*\n/)
  .filter((p) => p.startsWith('Foreground execution (required):'))
  .map((p) => p.replace(/\s+/g, ' '));
const PRE_5601_PARAGRAPH_FILE = path.join(__dirname, 'fixtures', 'dispatch-prompt', 'foreground-paragraph-pre-5601.txt');

test('AC2.1: neither dispatch prompt file holds a Foreground paragraph (#5601)', () => {
  for (const file of [TASK_PROMPT, EXPRESS_PROMPT]) {
    assert.equal(foregroundParagraphs(readText(file)).length, 0, `${path.basename(file)} Foreground paragraph count`);
  }
});

test('AC2.1: the Foreground-paragraph count goes red with the pre-#5601 paragraph restored (#5601)', () => {
  const paragraph = readText(PRE_5601_PARAGRAPH_FILE).trimEnd();
  for (const file of [TASK_PROMPT, EXPRESS_PROMPT]) {
    const text = readText(file);
    const restored = `${text}\n\n${paragraph}\n`;
    assert.notEqual(restored, text);
    const found = foregroundParagraphs(restored);
    assert.equal(found.length, 1, `${path.basename(file)}: the restored paragraph must be found`);
    assert.match(found[0], PROJECT_TEST_CMD, `${path.basename(file)}: the found paragraph is the restored one`);
  }
});

test("AC1.4: both rendered prompts carry item 7's project-test-command sentence (#5601)", () => {
  const { renderTaskPrompt } = require('../plugin/bin/lib/dispatch/task-prompt');
  const text = readText(TASK_PROMPT);
  for (const call of ['first', 'second']) {
    const prompt = renderTaskPrompt(text, {
      call,
      issues: [5601],
      runDir: '/tmp/x y/.claude-tweaks/pipelines/2026-11-16T000000-record-5601',
      pluginRoot: '/p/root',
      policyValues: 'autonomy=unattended, integration-model=pr-first',
      selectedAt: '2026-11-16T00:00:00.000Z',
      effortLine: '[Effort: high — apply high-level reasoning depth to this task.]',
    });
    assert.match(prompt.replace(/\s+/g, ' '), PROJECT_TEST_CMD, `${call} call`);
  }
});

test("the Foreground project-test-command fact can go red (#5117)", () => {
  assert.doesNotMatch(PRE_CHANGE_FOREGROUND.replace(/\s+/g, ' '), PROJECT_TEST_CMD);
});

test("task-prompt.md's stamp-versus-raw-log sentence names a test-command log (#5117)", () => {
  assert.match(readText(TASK_PROMPT).replace(/\s+/g, ' '), /A raw test-command log is not that artifact/);
});

const MANIFEST = path.join(__dirname, '..', 'tools', 'upstream-drift', 'manifest.yml');
const SUPERPOWERS_PINS = [
  ['skills/subagent-driven-development/implementer-prompt.md', 'full suite once before committing, not after every edit.', 'plugin/skills/build/dispatch.md'],
  ['skills/test-driven-development/SKILL.md', "means the project's suite, not just your file.", 'plugin/skills/build/dispatch.md'],
  ['skills/using-git-worktrees/SKILL.md', '## Step 3: Verify Clean Baseline', 'plugin/skills/build/worktree-setup.md'],
  ['skills/executing-plans/SKILL.md', 'make it pass, then run the whole suite.', 'plugin/skills/build/dispatch.md'],
];

// The superpowers entry's `contract-paths:` block: from its key to the entry's next `assertions:`.
const contractPathsBlock = (lines) => {
  const sp = lines.findIndex((l) => l === '  - name: superpowers');
  assert.notEqual(sp, -1, 'the superpowers manifest entry was not found');
  const from = lines.findIndex((l, i) => i > sp && l === '    contract-paths:');
  const to = lines.findIndex((l, i) => i > from && l === '    assertions:');
  assert.ok(from !== -1 && to !== -1, "the superpowers entry's contract-paths block was not found");
  return lines.slice(from, to).join('\n');
};

// The `- file:` value of the assertion a `must-match` line at index i belongs to.
const assertionFile = (lines, i) => {
  for (let j = i; j >= 0; j--) {
    const m = /^\s*- file: "(.*)"$/.exec(lines[j]);
    if (m) return m[1];
  }
  return null;
};

test('manifest.yml pins every superpowers line #5117 overrides', () => {
  const lines = readText(MANIFEST).split('\n').map((l) => l.trimEnd());
  for (const [upstream, mustMatch, file] of SUPERPOWERS_PINS) {
    const hits = lines.map((l, i) => (l.includes(`must-match: "${mustMatch}"`) ? i : -1)).filter((i) => i !== -1);
    assert.equal(hits.length, 1, `must-match "${mustMatch}" should appear exactly once`);
    assert.equal(lines[hits[0] - 1].trim(), `upstream-path: "${upstream}"`, `"${mustMatch}" must follow upstream-path ${upstream}`);
    assert.equal(assertionFile(lines, hits[0]), file, `"${mustMatch}" must be pinned against ${file}`);
  }
  const block = contractPathsBlock(lines);
  for (const p of ['skills/test-driven-development/SKILL.md', 'skills/executing-plans/SKILL.md']) {
    assert.ok(block.includes(`      - "${p}"`), `contract-paths lists ${p}`);
  }
});
