// tests/ci-skips-drafts-conformance.test.js — pins #5153's "CI that skips draft PRs" convention
// (Deliverable 6, AC9, AC10): `_shared/ci-skips-drafts.md` states each point per `##` section,
// `_shared/git-discipline.md`'s per-phase push paragraph counts Actions minutes and cites it,
// `test/ci-source.md` states the coexistence ruling, and `docs/skill-graph.md` carries the edges.
// `_shared/pr-first-merge.md`'s citation (the `draft-skip-without-ready-trigger` park reason) is
// pinned by Task 7 of the #5153 plan, not here. Every pinned clause was added in the same change,
// so each go-red proof mutates the live text in memory (skill-prose-conformance-tests).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith, sectionOf } = require('./helpers/conformance-asserts');

const ROOT = path.join(__dirname, '..');
const SHARED = path.join(ROOT, 'plugin', 'skills', '_shared');
const CONVENTION = path.join(SHARED, 'ci-skips-drafts.md');
const GIT_DISCIPLINE = path.join(SHARED, 'git-discipline.md');
const CI_SOURCE = path.join(ROOT, 'plugin', 'skills', 'test', 'ci-source.md');
const SKILL_GRAPH = path.join(ROOT, 'docs', 'skill-graph.md');
const CITATION = '`_shared/ci-skips-drafts.md`';

test('AC9.1: plugin/skills/_shared/ci-skips-drafts.md exists', () => {
  assert.ok(fs.existsSync(CONVENTION), 'the CI-skips-drafts convention file is missing (#5153)');
});

// One fact list per `##` section, each scoped to its own section so a fact stated under the wrong
// heading does not count.
const SECTIONS = [
  ['## Workflow shape', [
    [/types: \[opened, synchronize, reopened, ready_for_review\]/, 'workflow shape: the four trigger types'],
    [/if: github\.event\.pull_request\.draft == false/, 'workflow shape: the job-level draft skip'],
    [/Declare `ready_for_review` only alongside a draft skip/, 'rule: declare ready_for_review only alongside a draft skip'],
    [/pays one extra wait per merge, for a second run on the same sha/, 'rule: ready_for_review without a draft skip costs one extra wait'],
    [/`ready_for_review` belongs in `types` alongside `synchronize`, which the default types include/, 'rule: ready_for_review sits alongside synchronize'],
    [/never runs on a push made after undraft, so the gate keeps that workflow awaiting and parks with `checks-pending-timeout` until the types include it/, 'rule: a types list without synchronize parks a post-undraft push'],
    [/the gate parks it as `draft-skip-without-ready-trigger`/, 'rule: a draft skip without ready_for_review parks'],
    [/only while that workflow has no post-ready run/, 'rule: a later real CI run clears the draft-skip park'],
    [/The fix is adding `ready_for_review` to `types`/, 'rule: the one-line fix'],
    [/naming it `\{file\} unparsed`; the fix is a plain `on:` block/, 'unparsed: the park names the file and the fix is a plain on: block'],
  ]],
  ['## Pending-status pattern', [
    [/commit status to `pending`[\s\S]*?flips it to `success` as its first step/, 'pending status: pending at draft time, success first at ready'],
    [/NON_BLOCKING/, 'pending status: defence in depth for github-pr-scan.md\'s NON_BLOCKING set'],
    [/adopters on older plugin versions/, 'pending status: defence in depth for older plugin versions'],
  ]],
  ['## Path filters', [
    [/workflow-level `paths:` filter/, 'path filters: names the workflow-level filter'],
    [/parks after 15 minutes/, 'path filters: an empty rollup parks after 15 minutes'],
    [/never creates the ready run the gate waits for/, 'path filters: a filtered ready_for_review workflow never gets its ready run'],
    [/always-run job/, 'path filters: job-level conditions behind an always-run job'],
  ]],
  ['## Coexistence with the `ci` verification source', [
    [/\*\*CI on drafts plus a `ci` declaration:\*\*/, 'coexistence: shape one'],
    [/\*\*CI skips drafts and no `ci` declaration:\*\*/, 'coexistence: shape two'],
    [/Declaring both is a misconfiguration/, 'coexistence: both is a misconfiguration'],
    [/ci-job-skipped/, 'coexistence: a job-level skip falls back on ci-job-skipped'],
    [/waitSeconds/, 'coexistence: a workflow-level gate stalls for waitSeconds'],
    [/#5162/, 'coexistence: conflict detection is #5162\'s'],
    [/step-22-ci-workflow-review\.md/, 'coexistence: names the init step that detects the conflict'],
  ]],
  ['## Concurrency', [
    [/cancel-in-progress: true\n```/, 'concurrency: the workflow-level block with cancel-in-progress true'],
    [/cancels the superseded run/, 'concurrency: what it buys'],
    [/The merge gate reads only runs on the head it merges/, 'concurrency: the merge gate ignores superseded heads'],
    [/A scalar group \(`concurrency: ci-\$\{\{ github\.ref \}\}`\), a block without `cancel-in-progress` or `cancel-in-progress: false` never cancels a running superseded run/, 'concurrency: the shapes that let a running superseded run finish'],
    [/so the newest head's run waits behind it\. That delays the merge gate/, 'concurrency: the newest head waits, delaying the merge gate'],
    [/With the default `queue: single`, a superseded run still queued is cancelled; with `queue: max`, none is/, 'concurrency: queued-run cancellation depends on the queue mode'],
    [/Job-level `concurrency` cancels only the jobs that declare it, and init's CI-workflow review reads only the workflow-level block, so job-level `concurrency` alone is still reported/, 'concurrency: job-level concurrency alone is still reported'],
    [/an unconditional `cancel-in-progress: true` also cancels a running default-branch run/, 'concurrency: the push-to-default-branch tradeoff'],
    [/`cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}`/, 'concurrency: the usual guard expression'],
    [/A `cancel-in-progress` expression is read as unparsed/, 'concurrency: an expression is unparsed'],
    [/`unparsed` \(`cancel-in-progress expression not evaluated`\), not as a finding/, 'concurrency: the unparsed reason, not a finding'],
    [/an unparsed workflow gets none of this review's per-workflow checks/, 'concurrency: an unparsed workflow loses every per-workflow check'],
  ]],
  ['## Why projects skip drafts', [
    [/Actions-minute cost of per-phase pushes/, 'why: the Actions-minute cost of per-phase pushes'],
    [/176 of 312 pull-request CI runs in 30 days/, 'why: the measured superseded-run share'],
    [/3,120 minutes, 35% of its Actions usage/, 'why: the measured minute cost'],
  ]],
];

for (const [heading, facts] of SECTIONS) {
  const missing = missingFactsOf(facts);
  const section = () => sectionOf(readText(CONVENTION), heading);

  test(`AC9.2: the convention states each of Deliverable 6's four points — ${heading}`, () => {
    assert.deepEqual(missing(section()), [], `ci-skips-drafts.md's "${heading}" section must state every fact (#5153)`);
  });

  test(`AC9.2: each fact under ${heading} can go red`, () => {
    assertEachPatternGoesRed(section(), facts, missing);
  });
}

const citesConvention = (text) => text.includes(CITATION);

test('AC9.2: git-discipline.md and test/ci-source.md cite _shared/ci-skips-drafts.md', () => {
  for (const file of [GIT_DISCIPLINE, CI_SOURCE]) {
    const text = readText(file);
    assert.ok(citesConvention(text), `${path.basename(file)} must cite ${CITATION} (#5153)`);

    // Control: a copy with every citation removed must fail the same check.
    const stripped = text.split(CITATION).join('the convention');
    assert.notEqual(stripped, text, `citation anchor in ${path.basename(file)} not found — control cannot discriminate`);
    assert.ok(!citesConvention(stripped), `removing the citation from ${path.basename(file)} must turn the check red`);
  }
});

// git-discipline.md's per-phase push paragraph: from its first line through the blank line.
const SHIP_PREFIX = 'Ship at every phase exit';

function shipParagraph(text) {
  const first = lineStartingWith(text, SHIP_PREFIX);
  assert.ok(first, `git-discipline.md has no line starting "${SHIP_PREFIX}"`);
  const start = text.indexOf(`\n${first}\n`) + 1;
  assert.ok(start > 0, 'the per-phase push paragraph must start on its own line');
  const end = text.indexOf('\n\n', start);
  assert.notEqual(end, -1, 'the per-phase push paragraph must end at a blank line');
  return text.slice(start, end);
}

const SHIP_FACTS = [
  [/Actions minutes/, 'AC10.1: names Actions minutes'],
  [/`_shared\/ci-skips-drafts\.md`/, 'AC10.1: cites the convention'],
  [/the cadence stays\s+per-phase for durability and visibility/, 'D7: the cadence stays per-phase'],
];
const shipMissing = missingFactsOf(SHIP_FACTS);

test('AC10.1: git-discipline.md\'s per-phase push paragraph names Actions minutes and cites the convention', () => {
  assert.deepEqual(shipMissing(shipParagraph(readText(GIT_DISCIPLINE))), [], 'the per-phase push paragraph must count Actions minutes and cite the convention (#5153)');
});

test('AC10.1: each per-phase push paragraph fact can go red', () => {
  assertEachPatternGoesRed(shipParagraph(readText(GIT_DISCIPLINE)), SHIP_FACTS, shipMissing);
});

const HEADROOM_MESSAGE = 'the per-phase push paragraph lost its ≥50× headroom phrase (pinned by tests/pr-early-run-lifecycle.test.js too)';
const assertHeadroom = (text) => assert.match(shipParagraph(text), /≥50× headroom/, HEADROOM_MESSAGE);

test('AC10.2: the ≥50× headroom phrase survives', () => {
  const text = readText(GIT_DISCIPLINE);
  assertHeadroom(text);

  // Control: only the phrase mutated — the helper must throw with its own message, not the
  // paragraph-not-found one.
  const mutated = text.replace('≥50× headroom', '≥50x headroom');
  assert.notEqual(mutated, text, 'headroom anchor not found — control cannot discriminate');
  assert.throws(() => assertHeadroom(mutated), { message: HEADROOM_MESSAGE });
});

const CI_SOURCE_HEADING = '## CI that skips draft PRs';
const CI_SOURCE_FACTS = [
  [/CI that runs on draft PRs plus a `ci` declaration/, 'ci-source: shape one'],
  [/CI that skips drafts and no `ci` declaration/, 'ci-source: shape two'],
  [/Declaring both is a misconfiguration/, 'ci-source: both is a misconfiguration'],
  [/`ci-job-skipped`/, 'ci-source: a job-level skip falls back on ci-job-skipped'],
  [/`waitSeconds`/, 'ci-source: a workflow-level gate stalls for waitSeconds'],
  [/`_shared\/ci-skips-drafts\.md`/, 'ci-source: links the convention'],
];
const ciSourceMissing = missingFactsOf(CI_SOURCE_FACTS);
const ciSourceSection = () => sectionOf(readText(CI_SOURCE), CI_SOURCE_HEADING);

test('ci-source.md states the coexistence ruling', () => {
  assert.deepEqual(ciSourceMissing(ciSourceSection()), [], `ci-source.md's "${CI_SOURCE_HEADING}" section must state the coexistence ruling (#5153)`);
});

test('ci-source.md: each coexistence fact can go red', () => {
  assertEachPatternGoesRed(ciSourceSection(), CI_SOURCE_FACTS, ciSourceMissing);
});

// #5154 was closed and superseded by #5162, which owns detecting a draft skip beside a declared
// `ci` source. Neither shipped file may name the closed record as the owner.
test('the convention and ci-source.md never cite the closed #5154', () => {
  const citesClosed = (text) => text.includes('#5154');
  for (const file of [CONVENTION, CI_SOURCE]) {
    const text = readText(file);
    assert.ok(!citesClosed(text), `${path.basename(file)} cites #5154, which #5162 superseded`);

    // Control: a copy naming the closed record must fail the same check.
    assert.ok(citesClosed(`${text}\nDetecting the conflict is #5154's.`), 'the absence check must catch a #5154 citation');
  }
});

const ROW_PREFIX = `| ${CITATION} |`;

test('docs/skill-graph.md carries the ci-skips-drafts edge under dispatch and under test', () => {
  const graph = readText(SKILL_GRAPH);
  const hasRow = (section) => section.split('\n').some((line) => line.startsWith(ROW_PREFIX));
  for (const heading of ['## dispatch', '## test']) {
    const section = sectionOf(graph, heading);
    assert.ok(hasRow(section), `docs/skill-graph.md's "${heading}" section has no ${ROW_PREFIX} row (#5153)`);

    // Control: the section with that row removed must fail the same check.
    const without = section.split('\n').filter((line) => !line.startsWith(ROW_PREFIX)).join('\n');
    assert.notEqual(without, section, `row anchor under "${heading}" not found — control cannot discriminate`);
    assert.ok(!hasRow(without), `removing the row under "${heading}" must turn the check red`);
  }
});
