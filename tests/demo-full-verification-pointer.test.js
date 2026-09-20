const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OBSERVATION_PLAN_PATH = 'plugin/skills/_shared/observation-plan.md';
const ENTRY_PATHS_PATH = 'plugin/skills/demo/entry-paths.md';
const DEMO_SKILL_PATH = 'plugin/skills/demo/SKILL.md';
const VERIFICATION_BRIEF_PATH = 'plugin/skills/wrap-up/verification-brief.md';
const PARENT_GATE_PATH = 'plugin/skills/wrap-up/verification-brief-parent-gate.md';

const observationPlan = fs.readFileSync(path.join(ROOT, OBSERVATION_PLAN_PATH), 'utf8');
const entryPaths = fs.readFileSync(path.join(ROOT, ENTRY_PATHS_PATH), 'utf8');
const demoSkill = fs.readFileSync(path.join(ROOT, DEMO_SKILL_PATH), 'utf8');

// Merge-base with origin/main this record's changes were built on top of — already part of
// main's own history, so it stays reachable after this branch merges (squash or not). None
// of the literals pinned below existed in these files at this commit, which is how each
// assertion below is proved capable of going red — per skill-prose-conformance-tests'
// "Proving discrimination without editing the tree" (no working-tree mutation needed).
const PRE_CHANGE_SHA = '01ec5033ad10b5d1cc89b9d5c7777e70fef02bc8';

function countAtPreChange(relPath, literal) {
  let out;
  try {
    out = execFileSync('git', ['show', `${PRE_CHANGE_SHA}:${relPath}`], {
      cwd: ROOT,
      encoding: 'utf8',
    });
  } catch (err) {
    // #2532: a shallow/partial clone doesn't have PRE_CHANGE_SHA's tree reachable — tag the
    // error so callers can distinguish it from a real assertion failure and skip instead.
    const wrapped = new Error(
      `commit ${PRE_CHANGE_SHA} is not reachable in this checkout's git history — this go-red ` +
        `check needs full history: ${String(err.message).split('\n')[0]}`,
    );
    wrapped.gitUnreachable = true;
    throw wrapped;
  }
  return out.split(literal).length - 1;
}

// #2532: run one countAtPreChange call under the shallow-clone guard — an unreachable
// PRE_CHANGE_SHA skips the calling test (with the real git error stated) instead of failing on
// a misleading assertion message. Returns { ok: false } (and has already called t.skip) when the
// caller should stop.
function countAtPreChangeOrSkip(t, relPath, literal) {
  try {
    return { ok: true, count: countAtPreChange(relPath, literal) };
  } catch (err) {
    if (!err.gitUnreachable) throw err;
    t.skip(err.message);
    return { ok: false };
  }
}

test('observation-plan.md declares Full verification with Parent/Pending/Then, inside the Schema fence', (t) => {
  const schemaFence = observationPlan.match(/## Schema\n\n```markdown([\s\S]*?)```/);
  assert.ok(schemaFence, 'Schema fenced block not found');
  assert.match(schemaFence[1], /- Full verification:/);
  assert.match(schemaFence[1], /- Parent: #P/);
  assert.match(schemaFence[1], /- Pending: #X/);
  assert.match(schemaFence[1], /- Then:/);
  const preChange = countAtPreChangeOrSkip(t, OBSERVATION_PLAN_PATH, 'Full verification:');
  if (!preChange.ok) return;
  assert.strictEqual(
    preChange.count, 0,
    'Full verification: must not have existed pre-change (proves this assertion can go red)',
  );

  const parentIdx = schemaFence[1].indexOf('- Parent: #P');
  const pendingIdx = schemaFence[1].indexOf('- Pending: #X');
  const thenIdx = schemaFence[1].indexOf('- Then:');
  assert.ok(
    parentIdx > -1 && pendingIdx > parentIdx && thenIdx > pendingIdx,
    `sub-bullets must appear in order Parent:, Pending:, Then: (got indices ${parentIdx}, ${pendingIdx}, ${thenIdx})`,
  );
});

test('observation-plan.md has a Producer section stating demo composes the block, wrap-up never does', (t) => {
  assert.match(
    observationPlan,
    /Composed only by `\/claude-tweaks:demo`'s `#N`-branch composers/,
  );
  const preChange = countAtPreChangeOrSkip(t, OBSERVATION_PLAN_PATH, 'Composed only by');
  if (!preChange.ok) return;
  assert.strictEqual(
    preChange.count, 0,
    'Producer section must not have existed pre-change',
  );
});

test('observation-plan.md Grammar rules name Parent:/Pending:/Then: and the closed-siblings literal', (t) => {
  assert.match(observationPlan, /`Parent:`/);
  assert.match(observationPlan, /`Pending:`/);
  assert.match(observationPlan, /`Then:`/);
  assert.match(observationPlan, /none — every sibling closed; parent gate/);
  const preChange = countAtPreChangeOrSkip(t, OBSERVATION_PLAN_PATH, 'none — every sibling closed; parent gate');
  if (!preChange.ok) return;
  assert.strictEqual(
    preChange.count, 0,
    'closed-siblings literal must not have existed pre-change',
  );
});

test('entry-paths.md cites buildNativeParentQuery, cross-spec-promise-check.md, and the fail-open line', (t) => {
  assert.match(entryPaths, /buildNativeParentQuery/);
  assert.match(entryPaths, /cross-spec-promise-check\.md/);
  assert.match(entryPaths, /one plain line above the verdict/);
  const preChange = countAtPreChangeOrSkip(t, ENTRY_PATHS_PATH, 'buildNativeParentQuery');
  if (!preChange.ok) return;
  assert.strictEqual(
    preChange.count, 0,
    'buildNativeParentQuery must not have existed pre-change',
  );
});

test('demo/SKILL.md renders Full verification between Show and Verdict, and has the Anti-Patterns row', (t) => {
  const showIdx = demoSkill.indexOf('**Show** — by Surface kind:');
  const verdictIdx = demoSkill.indexOf('### Verdict');
  assert.ok(showIdx > -1, 'Show subsection not found');
  assert.ok(verdictIdx > showIdx, '### Verdict must come after Show');
  const between = demoSkill.slice(showIdx, verdictIdx);
  assert.match(between, /Full verification/);
  assert.match(demoSkill, /as if the slice were the feature/);
  const preChange = countAtPreChangeOrSkip(t, DEMO_SKILL_PATH, 'as if the slice were the feature');
  if (!preChange.ok) return;
  assert.strictEqual(
    preChange.count, 0,
    'Anti-Patterns row must not have existed pre-change',
  );
});

test('wrap-up verification-brief files never compose the Full verification block (AC 8)', () => {
  const brief = fs.readFileSync(path.join(ROOT, VERIFICATION_BRIEF_PATH), 'utf8');
  const parentGate = fs.readFileSync(path.join(ROOT, PARENT_GATE_PATH), 'utf8');
  assert.doesNotMatch(brief, /Full verification/);
  assert.doesNotMatch(parentGate, /Full verification/);
});
