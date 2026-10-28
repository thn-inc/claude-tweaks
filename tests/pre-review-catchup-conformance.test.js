'use strict';
// tests/pre-review-catchup-conformance.test.js — #4304: pins the prose that wires
// bin/pre-review-catchup.js into /build's SDD dispatch, the _shared procedure file,
// and the registries naming the CLI. The CLI's own behavior is tests/bin-lib/pre-review-catchup's.
//
// Live prose is read here legitimately: updating these sentences is the intended
// response to a change in the dispatch contract they restate (skill-prose-conformance-tests).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { OUTCOMES } = require('../plugin/bin/lib/worktree/pre-review-catchup');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

const DISPATCH = read('plugin/skills/build/dispatch.md');
// Read inside the tests that use it: a missing file then fails that test alone, not the whole suite.
const readShared = () => read('plugin/skills/_shared/pre-review-catchup.md');
const BUILD_WORKTREE_SETUP = read('plugin/skills/build/worktree-setup.md');
const PLUGIN_STRUCTURE = read('docs/plugin-structure.md');

const CLI_MARKER = 'bin/pre-review-catchup.js';
const SKIP_PATH_MARKER = 'Single-task fast-lane skip (#1926';
const REVIEW_RETURN_MARKER = 'After the final code review completes — or, on the skip path';

// Every marker must exist before positions are compared: indexOf's -1 is below every
// real position, so a reworded marker would otherwise leave the pin green.
function requireOrder(text, markers) {
  let last = -1;
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    assert.notStrictEqual(idx, -1, `marker missing: ${marker}`);
    assert.ok(idx > last, `${marker} must come after the previous marker`);
    last = idx;
  }
}

// The catch-up instruction itself: from its bold label to the return marker. Both anchors
// are asserted before slicing, so a missing end cannot widen the span to the rest of the file.
const SPAN_START = '**Pre-review catch-up (#4304';
function catchupSpan(text) {
  const start = text.indexOf(SPAN_START);
  assert.notStrictEqual(start, -1, `marker missing: ${SPAN_START}`);
  const end = text.indexOf(REVIEW_RETURN_MARKER, start);
  assert.notStrictEqual(end, -1, `marker missing after the catch-up instruction: ${REVIEW_RETURN_MARKER}`);
  return text.slice(start, end);
}

// The routing facts the catch-up instruction must state: the scope, the call-site rule, every
// OUTCOMES token and the per-outcome postures. `anchors` names the outcome tokens a fact's own
// match depends on, so a control that removes that token expects the fact to go with it.
// missingRoutingFacts returns the names of the facts that are absent.
const OUTCOME_FACTS = OUTCOMES.map((o) => ({ name: `outcome ${o}`, token: `\`${o}\``, has: (s) => s.includes(`\`${o}\``) }));
const SKIP_LINE = '— Pre-review catch-up: condition:';
const ROUTING_FACTS = [
  // R7: current-branch is the one SKIP; parallel-wave members run the catch-up.
  { name: 'current-branch is the only skip', has: (s) => s.includes('current-branch strategy → fallback: no pre-review catch-up') && s.split(SKIP_LINE).length === 2 },
  { name: 'wave members run it', has: (s) => s.includes('Every worktree-strategy build runs it, including a `MULTISPEC_PARALLEL_WAVE=1` wave member') },
  { name: 'call-site rule', has: (s) => s.includes('never carried from Common Step 1') },
  { name: 'skip path has no review package', anchors: ['`merged`'], has: (s) => s.includes('`merged` there means re-running the suite (with its one fix dispatch on a failure) and nothing more') },
  { name: 'merged route names reviewBase', anchors: ['`merged`'], has: (s) => /`merged` →[^.]*`reviewBase`/.test(s) },
  { name: 'no-overlap route names reviewBase', anchors: ['`no-overlap`'], has: (s) => /`no-overlap` →[^.]*`reviewBase`/.test(s) },
  { name: 'resolved-but-uncommitted resume is committed by the dispatch', has: (s) => s.includes('an empty `conflictFiles` means resolved but not yet committed, and that same dispatch commits the merge') },
  { name: 'conflict-resolved line uses --text-file', has: (s) => /resolved in \{sha\}\. Reversibility: n\/a\.` with `log-decision\.js --text-file`/.test(s) },
  { name: 'windows-longpath is not the fail-open path', anchors: ['`windows-longpath`'], has: (s) => /`windows-longpath` → not the fail-open path/.test(s) },
  { name: 'windows-longpath leftovers are cleared, safe after the dirty-tree pre-check', has: (s) => s.includes('`git clean -f -d -- {leftover paths}`') && s.includes("because the CLI's dirty-tree pre-check guaranteed no uncommitted tracked changes") },
  { name: 'dirty-tree is never committed blindly', anchors: ['`dirty-tree`'], has: (s) => /`dirty-tree` → the controller never commits blindly:[^.]*build's own work[^.]*HARD-GATE stop/.test(s) },
  { name: 'non-zero exit rule', has: (s) => s.includes('On any non-zero exit (not an outcome), read stderr, fix the environment cause and re-run the CLI once — never skip the check, and never move or delete untracked files to get past it') },
  { name: 'second non-zero exit stops', has: (s) => s.includes('a second non-zero exit is a HARD-GATE stop') },
  ...OUTCOME_FACTS,
];
// The facts a removal of `fact`'s own text takes with it: itself, plus every fact anchored on its token.
const lostWith = (fact) => ROUTING_FACTS.filter((x) => x === fact || (fact.token && (x.anchors || []).includes(fact.token))).map((x) => x.name);
const missingRoutingFacts = (text) => {
  const span = catchupSpan(text);
  return ROUTING_FACTS.filter((f) => !f.has(span)).map((f) => f.name);
};

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.notStrictEqual(start, -1, `heading missing: ${heading}`);
  const next = text.indexOf('\n## ', start + heading.length);
  return next === -1 ? text.slice(start) : text.slice(start, next);
}

test('AC1.1: dispatch.md runs the catch-up before the whole-branch review', () => {
  requireOrder(DISPATCH, [SKIP_PATH_MARKER, CLI_MARKER, REVIEW_RETURN_MARKER]);
});

test('AC1.1 control: the order helper goes red when the catch-up sentence moves below the return marker', () => {
  const at = DISPATCH.indexOf(CLI_MARKER);
  assert.notStrictEqual(at, -1, 'CLI marker missing from the live text');
  const swapped = DISPATCH.replace(CLI_MARKER, 'bin/other.js') + `\n${CLI_MARKER}`;
  assert.notEqual(swapped, DISPATCH);
  assert.throws(() => requireOrder(swapped, [SKIP_PATH_MARKER, CLI_MARKER, REVIEW_RETURN_MARKER]), /must come after/);
  const absent = DISPATCH.replace(CLI_MARKER, 'bin/other.js');
  assert.notEqual(absent, DISPATCH);
  assert.throws(() => requireOrder(absent, [SKIP_PATH_MARKER, CLI_MARKER, REVIEW_RETURN_MARKER]), /marker missing/);
});

test('AC1.2: the review package base comes from reviewBase', () => {
  assert.ok(DISPATCH.includes('reviewBase'), 'dispatch.md must route the review base through the CLI JSON reviewBase');
});

test('scope: worktree only; current-branch is the one SKIP, wave members run it', () => {
  // The span-scoped facts ('current-branch is the only skip', 'wave members run it') carry the
  // dispatch.md side; this pins the shared file's Scope and the integration-branch ladder.
  assert.ok(DISPATCH.includes('_shared/integration-branch.md'), 'dispatch.md must route {integration-branch} through the canonical ladder');
  const scope = section(readShared(), '## Scope');
  assert.ok(scope.includes('Every worktree-strategy build runs it, including a `MULTISPEC_PARALLEL_WAVE=1` wave member'), 'the shared Scope must state that wave members run the catch-up');
  assert.ok(scope.includes('that is the only skip'), 'the shared Scope must name current-branch as the only skip');
});

test('routing: the catch-up instruction states the call-site rule, every outcome and the windows-longpath posture', () => {
  assert.deepEqual(missingRoutingFacts(DISPATCH), []);
});

test('routing control: each fact goes red alone when only it is removed from the text', () => {
  const swapAll = (text, from, to) => {
    const out = text.split(from).join(to);
    assert.notEqual(out, text, `control matched nothing: ${from}`);
    return out;
  };
  const textControls = [
    ['current-branch strategy → fallback', 'current-branch strategy → fallback-x', 'current-branch is the only skip'],
    ['including a `MULTISPEC_PARALLEL_WAVE=1` wave member', 'except a `MULTISPEC_PARALLEL_WAVE=1` wave member', 'wave members run it'],
    ['never carried from Common Step 1', 'carried from Common Step 1', 'call-site rule'],
    ['there means re-running the suite (with its one fix dispatch on a failure) and nothing more', 'there means building the package', 'skip path has no review package'],
    ["the JSON's `reviewBase` as its base commit, so", "the JSON's base as its base commit, so", 'merged route names reviewBase'],
    ["the JSON's `reviewBase` as its base commit too", "the JSON's base as its base commit too", 'no-overlap route names reviewBase'],
    ['and that same dispatch commits the merge', 'and the controller commits the merge', 'resolved-but-uncommitted resume is committed by the dispatch'],
    ['with `log-decision.js --text-file`', 'with `log-decision.js --text`', 'conflict-resolved line uses --text-file'],
    ['`windows-longpath` → not the fail-open path', '`windows-longpath` → handled', 'windows-longpath is not the fail-open path'],
    ["because the CLI's dirty-tree pre-check guaranteed", 'because it is fine and guaranteed', 'windows-longpath leftovers are cleared, safe after the dirty-tree pre-check'],
    ['anything else is a HARD-GATE stop surfaced to the human with the paths', 'anything else is committed too', 'dirty-tree is never committed blindly'],
    ['and never move or delete untracked files to get past it', 'and move untracked files out of the way', 'non-zero exit rule'],
    ['a second non-zero exit is a HARD-GATE stop', 'a second non-zero exit is retried', 'second non-zero exit stops'],
  ];
  for (const [from, to, name] of textControls) assert.deepEqual(missingRoutingFacts(swapAll(DISPATCH, from, to)), [name], from);
  // A second catch-up SKIP line (the retired wave-member skip) breaks the only-skip fact alone.
  const secondSkip = DISPATCH.replace(SPAN_START, `${SPAN_START} \`SKIP {time} ${SKIP_LINE} parallel-wave member\``);
  assert.deepEqual(missingRoutingFacts(secondSkip), ['current-branch is the only skip']);
  for (const f of OUTCOME_FACTS) {
    assert.deepEqual(missingRoutingFacts(swapAll(DISPATCH, f.token, 'OUTCOME')), lostWith(f), f.token);
  }
  assert.deepEqual(lostWith(OUTCOME_FACTS.find((f) => f.token === '`no-overlap`')), ['no-overlap route names reviewBase', 'outcome no-overlap']);
  // Deleting the whole windows-longpath clause loses all three of its facts.
  const clause = /`windows-longpath` → not the fail-open path: [^]*?then re-run the CLI\. /;
  assert.ok(clause.test(DISPATCH), 'the windows-longpath clause shape changed — update this control');
  assert.deepEqual(
    missingRoutingFacts(DISPATCH.replace(clause, '')),
    ['windows-longpath is not the fail-open path', 'windows-longpath leftovers are cleared, safe after the dirty-tree pre-check', 'outcome windows-longpath'],
  );
  // A token that only appears outside the catch-up span (before its label) must not satisfy the pin.
  const outside = DISPATCH.replace(SPAN_START, '`windows-longpath` not-a-clause\n' + SPAN_START);
  assert.notEqual(outside, DISPATCH);
  const cut = outside.split('`windows-longpath`');
  assert.ok(cut.length > 2);
  const keptOnlyOutside = cut[0] + '`windows-longpath`' + cut.slice(1).join('WLP');
  assert.ok(missingRoutingFacts(keptOnlyOutside).includes('outcome windows-longpath'));
  // The end anchor is asserted, not assumed.
  assert.throws(() => catchupSpan(DISPATCH.replace(REVIEW_RETURN_MARKER, 'x')), /marker missing after/);
});

test('AC3.1: a conflict stops before review', () => {
  assert.ok(DISPATCH.includes('`conflict` → stop'), 'conflict outcome must stop');
  assert.ok(DISPATCH.includes('Never review the pre-merge tree'));
});

test("the shared Outcomes table carries the routes dispatch.md states", () => {
  const SHARED = readShared();
  const outcomes = section(SHARED, '## Outcomes');
  const row = (o) => {
    const line = outcomes.split('\n').find((l) => l.startsWith(`| \`${o}\` |`));
    assert.ok(line, `## Outcomes row missing: ${o}`);
    return line;
  };
  assert.ok(row('no-overlap').includes('`reviewBase`'), 'the no-overlap row must build the package on reviewBase');
  assert.ok(row('merged').includes('`reviewBase`'), 'the merged row must build the package on reviewBase');
  assert.ok(row('dirty-tree').includes('never committed blindly') && row('dirty-tree').includes('HARD-GATE stop'), 'the dirty-tree row must not commit blindly');
  assert.ok(row('conflict').includes('`merge-in-progress`') && row('conflict').includes('resolved but not yet committed'), 'the conflict row must cover the resumed merge');
  assert.ok(row('windows-longpath').includes('`git clean -f -d -- {leftover paths}`') && row('windows-longpath').includes('dirty-tree pre-check'), 'the windows-longpath row must carry the leftover recovery');
  assert.ok(outcomes.includes('a second non-zero exit is a HARD-GATE stop'), 'the shared file must bound the non-zero exit re-run');
  assert.ok(outcomes.includes('Never move or delete untracked files to get past one'), 'the shared file must forbid discarding untracked files');
});

test('shared file and naming', () => {
  const SHARED = readShared();
  assert.ok(/^# Pre-review Catch-up$/m.test(SHARED), 'shared file title');
  assert.ok(/^## Outcomes$/m.test(SHARED), 'shared file needs an ## Outcomes heading');
  const stepFour = BUILD_WORKTREE_SETUP.split('\n').find((l) => l.startsWith('4. **Catch up with the integration branch**'));
  assert.ok(stepFour, 'build/worktree-setup.md step 4 paragraph not found');
  assert.ok(stepFour.includes('_shared/pre-review-catchup.md'), 'step 4 must name the shared file');
});

test('every outcome is documented', () => {
  assert.equal(OUTCOMES.length, 7, 'OUTCOMES roster size changed — document the new outcome and bump this literal');
  const outcomes = section(readShared(), '## Outcomes');
  const cliLine = PLUGIN_STRUCTURE.split('\n').find((l) => l.includes('pre-review-catchup.js'));
  assert.ok(cliLine, 'docs/plugin-structure.md needs a pre-review-catchup.js line');
  for (const outcome of OUTCOMES) {
    assert.ok(outcomes.includes(`\`${outcome}\``), `_shared/pre-review-catchup.md ## Outcomes must name \`${outcome}\``);
    assert.ok(cliLine.includes(outcome), `docs/plugin-structure.md CLI line must name ${outcome}`);
  }
});
