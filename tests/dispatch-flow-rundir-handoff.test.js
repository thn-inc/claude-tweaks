'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #296's second Task() call must resume the FIRST call's run directory rather than
// starting a disconnected fresh one — otherwise build/test's decisions.md and staged
// proposals are orphaned from the eventual Review Console. This was reviewed as fixed
// twice and found inert both times: the sending half (dispatch derives {run-dir} and
// substitutes it into the second call's literal command line) and the receiving half
// (/flow Step 3 actually adopts a pre-set PIPELINE_RUN_DIR instead of always creating a
// fresh one) were each individually plausible but never verified as connected. This test
// pins both halves of that chain directly in the operative prose, so a future edit to
// either side that breaks the link fails the suite instead of shipping silently a third
// time.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const TASK_PROMPT = read('plugin', 'skills', 'dispatch', 'task-prompt.md');
const FLOW_SKILL = read('plugin', 'skills', 'flow', 'SKILL.md');
const STEPS_AND_GATES = read('plugin', 'skills', 'flow', 'steps-and-gates.md');
const DISPATCH_SKILL = read('plugin', 'skills', 'dispatch', 'SKILL.md');
const CLEANUP_PROCEDURES_EXECUTION = read('plugin', 'skills', 'wrap-up', 'cleanup-procedures-execution.md');

test('task-prompt.md: the second call\'s literal command line carries PIPELINE_RUN_DIR', () => {
  const start = TASK_PROMPT.indexOf('## Second call');
  assert.notStrictEqual(start, -1, 'task-prompt.md no longer has a "## Second call" heading — this guard has lost its anchor');
  const end = TASK_PROMPT.indexOf('None of Templates A/B/C', start);
  assert.notStrictEqual(end, -1, 'the second call is no longer followed by its template note — this guard has lost its anchor');
  const region = TASK_PROMPT.slice(start, end);

  assert.match(
    region,
    /PIPELINE_RUN_DIR="\{minted-run-dir\}"/,
    'the second call\'s fenced command line must inline PIPELINE_RUN_DIR="{minted-run-dir}" — a dispatched Task agent inherits no environment, so this cannot be an "exported before this call" claim; it must be substituted into the literal command like every other placeholder',
  );
  assert.doesNotMatch(
    region,
    /CLAIM_RUN_ID/,
    'CLAIM_RUN_ID retired with the identity unification — both Task calls now carry only PIPELINE_RUN_DIR, minted once by dispatch Step 4 before either call runs',
  );
});

test('task-prompt.md: the FIRST call\'s literal command line also carries PIPELINE_RUN_DIR (not just the second)', () => {
  const start = TASK_PROMPT.indexOf('## First call');
  assert.notStrictEqual(start, -1, 'task-prompt.md no longer has a "## First call" heading — this guard has lost its anchor');
  const end = TASK_PROMPT.indexOf('## Second call', start);
  assert.notStrictEqual(end, -1, 'the first call is no longer followed by the second call heading — this guard has lost its anchor');
  const region = TASK_PROMPT.slice(start, end);

  assert.match(
    region,
    /PIPELINE_RUN_DIR="\{minted-run-dir\}"/,
    'the first call must also carry PIPELINE_RUN_DIR="{minted-run-dir}" — dispatch Step 4 mints the group\'s run directory before either call, so there is no longer a "first call gets nothing, second call gets a derived value" asymmetry',
  );
  assert.doesNotMatch(
    region,
    /CLAIM_RUN_ID/,
    'CLAIM_RUN_ID retired — the first call no longer carries it either',
  );
});

test('flow/SKILL.md Step 3: an inherited PIPELINE_RUN_DIR is adopted, not overwritten', () => {
  const start = FLOW_SKILL.indexOf('### Step 3:');
  assert.notStrictEqual(start, -1, 'flow/SKILL.md no longer has a "### Step 3:" heading — this guard has lost its anchor');
  const end = FLOW_SKILL.indexOf('\n### Step 4', start);
  const region = FLOW_SKILL.slice(start, end === -1 ? FLOW_SKILL.length : end);

  assert.match(
    region,
    /Adopt-if-set/i,
    'Step 3 must state an adopt-if-set branch for a PIPELINE_RUN_DIR already present on entry — without it, dispatch\'s second call always starts a fresh, disconnected run regardless of what it was handed',
  );
});

test('steps-and-gates.md: the adopt branch actually reads the existing run rather than re-initializing it', () => {
  const start = STEPS_AND_GATES.indexOf('### Adopting an inherited run directory');
  assert.notStrictEqual(start, -1, 'steps-and-gates.md no longer has an "### Adopting an inherited run directory" heading — this guard has lost its anchor');
  const end = STEPS_AND_GATES.indexOf('\n### Partial step lists', start);
  const region = STEPS_AND_GATES.slice(start, end === -1 ? STEPS_AND_GATES.length : end);

  assert.match(
    region,
    /adopt it/i,
    'the adopt branch must actually adopt the existing directory on a match',
  );
  assert.match(
    region,
    /do\s+\W*not\W*\s+re-initialize/i,
    'adopting an existing run directory must not overwrite config.yml/decisions.md — that would destroy the first call\'s auto-decision trail, the exact thing this handoff exists to preserve',
  );
});

test('steps-and-gates.md: a minted-but-empty PIPELINE_RUN_DIR is adopted and initialized in place, not left to fall through to create-fresh', () => {
  const start = STEPS_AND_GATES.indexOf('### Adopting an inherited run directory');
  assert.notStrictEqual(start, -1, 'steps-and-gates.md no longer has an "### Adopting an inherited run directory" heading — this guard has lost its anchor');
  const end = STEPS_AND_GATES.indexOf('\n### Partial step lists', start);
  const region = STEPS_AND_GATES.slice(start, end === -1 ? STEPS_AND_GATES.length : end);

  assert.match(
    region,
    /EMPTY/,
    'the resolution table must name the empty-directory case explicitly — this is what dispatch Step 4\'s minted-but-not-yet-adopted directory hits',
  );
  assert.match(
    region,
    /adopt the directory's identity, then initialize it/i,
    'an empty, anchored, minted directory must be adopted by identity and initialized in place (config.yml + decisions.md written into it), not silently re-created elsewhere',
  );
});

test('steps-and-gates.md: an inherited run dir with content but no config.yml (case 3) is recovered explicitly, not treated as case 2 or silently re-created', () => {
  const start = STEPS_AND_GATES.indexOf('### Adopting an inherited run directory');
  assert.notStrictEqual(start, -1, 'steps-and-gates.md no longer has an "### Adopting an inherited run directory" heading — this guard has lost its anchor');
  const end = STEPS_AND_GATES.indexOf('\n### Partial step lists', start);
  const region = STEPS_AND_GATES.slice(start, end === -1 ? STEPS_AND_GATES.length : end);

  assert.match(
    region,
    /already carries other run content/i,
    'case 3 must name the distinguishing signal — content already exists despite config.yml being absent — the counterexample to case 2\'s "otherwise EMPTY" bar',
  );
  assert.match(
    region,
    /do not treat this like case 2/i,
    'case 3 must explicitly say it is NOT case 2 — config.yml\'s absence alone is not evidence nothing has happened yet',
  );
  assert.match(
    region,
    /never re-initialize `decisions\.md`\/`events\.jsonl`/i,
    'case 3\'s recovery must preserve the existing audit trail — computing config.yml fresh must not overwrite decisions.md/events.jsonl the way case 2\'s from-scratch init does',
  );
  assert.match(
    region,
    /record-worktree/,
    'case 3 must backfill run-state.json\'s worktree registration when missing',
  );
  assert.match(
    region,
    /pr-early-run-lifecycle\.md/i,
    'case 3 must backfill the PR-early push+draft-PR lifecycle when missing',
  );
  assert.match(
    region,
    /materialize\.md/i,
    'case 3 must backfill the work/{n}-spec.md materialize commit when missing',
  );
});

test('dispatch/SKILL.md Step 4: mints the group run directory only, with no claim write present', () => {
  // #464 moved claim acquisition out of dispatch Step 4 into flow's Step 2.8
  // (skills/flow/claim-targets.md), so there is no claim write left here to order the mint
  // against. This guard pins what replaced that ordering: the mint still runs, is logged to
  // decisions.md, exposes $GROUP_RUN_ID — and no claim write has crept back in.
  const start = DISPATCH_SKILL.indexOf('### Step 4:');
  assert.notStrictEqual(start, -1, 'dispatch/SKILL.md no longer has a "### Step 4:" heading — this guard has lost its anchor');
  const end = DISPATCH_SKILL.indexOf('\n### Concurrency note', start);
  assert.notStrictEqual(end, -1, 'Step 4 is no longer followed by the Concurrency note — this guard has lost its anchor');
  const region = DISPATCH_SKILL.slice(start, end);

  assert.match(
    region,
    /\*\*Mint this group's run directory\.\*\*/,
    'Step 4 must still mint the group\'s run directory — AC1',
  );

  assert.doesNotMatch(
    region,
    /--add-label bot:in-progress/,
    'Step 4 must contain no bot:in-progress claim write — that bootstrap moved to flow/claim-targets.md\'s Step 2.8 (mentioning that it moved away is fine; actually invoking it is not)',
  );
  assert.doesNotMatch(
    region,
    /gh issue edit "\$ISSUE"/,
    'Step 4 must contain no gh issue edit claim write of any kind',
  );
  assert.doesNotMatch(
    region,
    /gh issue comment/,
    'Step 4 must not post a claim comment — that also moved to flow/claim-targets.md',
  );
  assert.match(
    region,
    /no claim written here either/,
    'Step 4 must explicitly say no claim is written here — this is the mint-only invariant\'s own self-documentation',
  );

  assert.match(
    region,
    /Log\s+one\s+line\s+to\s+this\s+firing's\s+own\s*`decisions\.md`/i,
    'minting must still be logged to decisions.md — AC1\'s verification reads this log line',
  );
  assert.match(
    region,
    /\$GROUP_RUN_ID/,
    'the minted directory\'s identity must still be exposed as $GROUP_RUN_ID for the Task calls to claim under',
  );
});

test('wrap-up/cleanup-procedures.md Section E: ownership check resolves basename($PIPELINE_RUN_DIR) directly, no CLAIM_RUN_ID fallback', () => {
  const start = CLEANUP_PROCEDURES_EXECUTION.indexOf('## E. Issue claim release');
  assert.notStrictEqual(start, -1, 'cleanup-procedures-execution.md no longer has an "## E. Issue claim release" heading — this guard has lost its anchor');
  const region = CLEANUP_PROCEDURES_EXECUTION.slice(start);

  assert.match(
    region,
    /Resolve `\$RUN_ID`\s*\n?\s*as `basename\(\$PIPELINE_RUN_DIR\)`/,
    'Section E must resolve $RUN_ID as basename($PIPELINE_RUN_DIR) directly — AC5',
  );
  assert.doesNotMatch(
    region,
    /\$\{CLAIM_RUN_ID/,
    'the old ${CLAIM_RUN_ID:-...} fallback expression must be gone — CLAIM_RUN_ID retired',
  );
  assert.match(
    region,
    /Multi-spec bundle callout/,
    'the multi-spec exception (basename($MULTISPEC_PARENT_DIR), not the per-spec $PIPELINE_RUN_DIR) must be documented so a bundle release is never silently checked against the wrong directory',
  );
});
