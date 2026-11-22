'use strict';
// #6056: pins plugin/skills/specify/planning.md (the planning step shaping mode runs behind
// `plan-at-specify: on`), the shaping-mode pointer blocks and the brief shared with
// build/plan-review.md. Read live: these files are the declared contract.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, sectionOf } = require('./helpers/conformance-asserts');
const { classStatementSites } = require('./helpers/planning-decisions-clauses');

const ROOT = path.join(__dirname, '..');
const PLANNING_REL = 'plugin/skills/specify/planning.md';
const planning = () => readText(path.join(ROOT, PLANNING_REL));

// A literal as a regex that tolerates a hard wrap at any space.
const lit = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));

// Every fact must be present in the region, and each must go red when stripped alone.
function pinned(region, patterns, label) {
  const missing = missingFactsOf(patterns)(region);
  assert.deepEqual(missing, [], `${label}: missing ${missing.join(' | ')}`);
  assertEachPatternGoesRed(region, patterns, missingFactsOf(patterns));
}

// The body of the first fenced block after the heading line.
function fenceAfter(text, heading) {
  const lines = text.split('\n');
  const at = lines.indexOf(heading);
  assert.notEqual(at, -1, `heading not found: ${heading}`);
  let open = -1;
  for (let i = at + 1; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) {
      if (open === -1) open = i;
      else return lines.slice(open + 1, i).join('\n');
    }
  }
  assert.fail(`no fenced block after ${heading}`);
  return '';
}

const beforeFirstSection = (text) => text.slice(0, text.indexOf('\n## Which records are planned\n'));
const f = (s, fact) => [lit(s), fact || s];

test('AC1.1: planning.md opens with the gate and the ask-all refusal', () => {
  const head = beforeFirstSection(planning());
  assert.ok(head.length > 0, 'region before ## Which records are planned is empty');
  pinned(head, [
    f('under `off`, the default, nothing in this file runs and shaping is exactly as written'),
    f('Resolution refuses `on` while `planning-decisions` resolves `ask-all`'),
    f('prints `off` and one stderr warning naming the conflict, never an error'),
  ], 'gate');
});

test('AC6.1: plan text never enters this session', () => {
  const head = beforeFirstSection(planning());
  pinned(head, [
    f('**Plan text never enters this session.**'),
    f('Planners and the reviewer return paths and tables only'),
    f('never Read the plan file'),
  ], 'plan text');
});

test('Deliverable 7: the predicate calls needsNoPlan through express-lane.js plan-lane on the post-write labels', () => {
  pinned(sectionOf(planning(), '## Which records are planned'), [
    f('express-lane.js" plan-lane --record-json'),
    f('`needsNoPlan` (`bin/lib/driver/plan-lane.js`)'),
    f('the fetched labels plus this pass\'s stamps'),
    f('A non-zero exit, no JSON line, or `lane: null` plans the record.'),
  ], 'predicate');
});

test('AC5.1: a record a plan-less lane takes gets no plan and no Plan: line, logged', () => {
  pinned(sectionOf(planning(), '## Which records are planned'), [
    f('A non-null `lane` means the record is not planned: no plan, no `Plan:` line'),
    f('`not planned: {lane} lane ({reason})`'),
  ], 'plan-less lane');
});

test('Deliverable 8: a stored plan is reused only when plan-store.js check says valid', () => {
  pinned(sectionOf(planning(), '## Which records are planned'), [
    f('plan-store.js" check --line'),
    f('`{"valid": true}` (exit 0) keeps that line'),
    f('Any other verdict or exit re-plans'),
  ], 'reuse');
});

test('Plan Review Clarification: a held record re-reviews its reused plan before ready', () => {
  pinned(sectionOf(planning(), '## Which records are planned'), [
    f('**A held record re-reviews its reused plan.**'),
    f('carries `Held-by: specify-planning`, a valid check still keeps the plan, but skips only steps 3-4'),
    f('plan-store.js" read --record {n} --commit {commit} --out "{checkout}"'),
    f('then run steps 5-9 on it, so its questions are asked again, or held again when headless, before `ready` is stamped'),
    f('A failed read re-plans.'),
  ], 'held re-review');
});

const ORDER = ['1. **Body.**', '2. **Base and checkout.**', '3. **Planner.**', '4. **Audit.**', '5. **Reviewer.**',
  '6. **Route.**', '7. **Amend.**', '8. **Store.**', '9. **Write.**',
  'git fetch origin {integration-branch}', 'git worktree add --detach', 'plan-audit.js" "{plan}" --spec "{body}"',
  'plan-store.js" write --record {n}'];

function orderProblems(section) {
  const idx = ORDER.map((a) => section.indexOf(a));
  const problems = ORDER.filter((a, i) => idx[i] === -1).map((a) => `missing: ${a}`);
  if (problems.length) return problems;
  const ascending = (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]);
  return ascending(idx.slice(0, 9)) && ascending(idx.slice(9)) ? [] : ['order'];
}

test('Deliverable 2: the per-record step runs compose, planner, audit, reviewer, route, amend, store, write in order', () => {
  const section = sectionOf(planning(), '## Per-record step');
  assert.deepEqual(orderProblems(section), []);
  const swapped = section.replace('3. **Planner.**', '@@').replace('5. **Reviewer.**', '3. **Planner.**').replace('@@', '5. **Reviewer.**');
  assert.notEqual(swapped, section);
  assert.deepEqual(orderProblems(swapped), ['order']);
});

test('Deliverable 2: the base is fetched first, the checkout is read-only, open Prerequisites do not skip planning', () => {
  pinned(sectionOf(planning(), '## Per-record step'), [
    f('whose sha is `{base}`, the plan\'s base'),
    f('The checkout\'s tracked files are read-only: the plan is the one file written there.'),
    f('Open Prerequisites do not skip planning.'),
    f('git worktree remove --force "{checkout}"'),
  ], 'base and checkout');
});

test('Review Focus 1: a body with no ## Overview gets one, because the spec hash refuses it', () => {
  pinned(sectionOf(planning(), '## Per-record step'), [
    f('insert one directly above `## Current State`'),
    f('refuses a spec with no Overview'),
  ], 'overview');
});

test('Deliverable 5: the no-ref outcome keeps the decisions and writes no Plan: line', () => {
  pinned(sectionOf(planning(), '## Per-record step'), [
    f('Exit 3 is the no-ref outcome: keep every decision line, write no `Plan:` line, and record why'),
    f('`bin/plan-store.js` is the line\'s one writer, so never type or edit it'),
  ], 'no-ref');
});

test('the planner is a Standard, clean-room dispatch that stops writing-plans before its Execution Handoff', () => {
  pinned(fenceAfter(planning(), '## Planner prompt'), [
    f('[Use: Standard]'),
    f('Invoke the Skill tool with skill `superpowers:writing-plans`'),
    f('skip its Execution Handoff step entirely'),
    f('ASSUMPTION — verify at build:'),
    f('{plugin-root}/skills/build/plan-authoring-checks.md'),
    f('PLAN: {absolute path to the saved plan file}'),
    f('Never quote the plan\'s text.'),
    f('STATUS: {DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED}'),
  ], 'planner fence');
  pinned(sectionOf(planning(), '## Planner prompt'), [
    f('resolve-profile.js" standard'),
    f('never `fork`'),
  ], 'planner section');
});

test('the planner prompt is self-contained and every fence in planning.md is balanced', () => {
  const body = fenceAfter(planning(), '## Planner prompt');
  const offenders = (s) => ['_shared/', 'SKILL.md', ' above', ' below'].filter((t) => s.includes(t));
  assert.deepEqual(offenders(body), []);
  assert.deepEqual(offenders(`${body} see _shared/x.md`), ['_shared/']);
  const fences = planning().split('\n').filter((l) => /^\s*```/.test(l)).length;
  assert.equal(fences % 2, 0, 'unbalanced fences');
});

test('the Execution Handoff override is pinned in the upstream-drift manifest', () => {
  const lines = readText(path.join(ROOT, 'tools/upstream-drift/manifest.yml')).split('\n');
  const at = lines.indexOf('      - file: "plugin/skills/specify/planning.md"');
  assert.notEqual(at, -1, 'manifest has no planning.md assertion');
  const next = lines.slice(at + 1, at + 4).join('\n');
  assert.match(next, /will rely on \(record #6056\)/);
  assert.match(next, /upstream-path: "skills\/writing-plans\/SKILL\.md"/);
  assert.match(next, /must-match: "## Execution Handoff"/);
});

test('planning.md never restates the asked classes', () => {
  assert.deepEqual(classStatementSites(new Map([[PLANNING_REL, planning()]])), []);
});
