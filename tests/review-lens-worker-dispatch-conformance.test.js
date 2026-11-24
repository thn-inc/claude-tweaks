'use strict';
// #6003: /claude-tweaks:review Step 3's opt-in worker lens dispatch. step3-lens-dispatch.md gains one pointer
// paragraph, immediately before the workflow pointer, that reads step3-worker-dispatch.md only when
// `review-lens-dispatch` resolves `worker` (600-byte cap); the sub-file starts review-lens-workers.js detached,
// waits on its PID, folds the Task-path replies in through merge-lens-replies, settles once, and falls back to the
// Task dispatch on four named conditions. Both texts are new in this change, so every go-red control mutates the
// live text in memory and matches the throw to its own message (skill-prose-conformance-tests: "New prose has no
// pre-change bytes"). The launcher-to-settle mechanics are proven end to end beside this file, in
// tests/bin-lib/review-coordination/lens-worker-launcher-settle.test.js; this suite pins only the prose.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, sectionOf } = require('./helpers/conformance-asserts');
const { rowWithContinuations } = require('./helpers/plugin-structure-entry');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const LENS_DISPATCH = 'plugin/skills/review/step3-lens-dispatch.md';
const SUB_FILE = 'plugin/skills/review/step3-worker-dispatch.md';
const CONTRACT = 'plugin/skills/_shared/subagent-output-contract.md';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- the pointer in step3-lens-dispatch.md ----

const POINTER_ANCHOR = '> **Worker dispatch (opt-in, #6003).**';
const WORKFLOW_ANCHOR = '> **Workflow dispatch (opt-in, #5599).**';
const POINTER_MAX_BYTES = 600;

// The paragraph opening with the anchor, up to the next blank line (a bare `>` inside a blockquote).
function pointerParagraph(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(POINTER_ANCHOR));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^>?\s*$/.test(lines[end])) end++;
  return lines.slice(start, end).join('\n');
}

// [needle, message]: each one the pointer must carry.
const POINTER_NEEDLES = [
  [/`step3-worker-dispatch\.md`/, 'pointer must name step3-worker-dispatch.md'],
  [/`review-lens-workers\.js`/, 'pointer must name review-lens-workers.js'],
  [/only when[^.]*`worker`/, 'pointer must read the sub-file only when the key resolves `worker`'],
];

function checkPointer(text) {
  const paragraph = pointerParagraph(text);
  assert.ok(paragraph !== null, 'pointer paragraph missing');
  const bytes = Buffer.byteLength(paragraph);
  assert.ok(bytes <= POINTER_MAX_BYTES, `pointer paragraph is ${bytes} bytes, over ${POINTER_MAX_BYTES}`);
  for (const [needle, message] of POINTER_NEEDLES) assert.match(paragraph, needle, message);
  assert.ok(text.includes(`${paragraph}\n>\n${WORKFLOW_ANCHOR}`), 'pointer must sit immediately before the workflow pointer');
}

// ---- the sub-file ----

// The four whole-fallback conditions, each one numbered item of the Fallback section opening with its label.
const LABELS = ['no claude binary', 'launch error', 'every worker failed', 'settle exit 2'];
const labelItem = (label) => new RegExp(`^\\d\\. \`${label}\` —`, 'm');

const START_LINE = 'nohup node "${CLAUDE_PLUGIN_ROOT}/bin/review-lens-workers.js" --run "$PIPELINE_RUN_DIR" --lenses-file "{path-L}" --cwd "{worktree}" --bundle "{contextPath}" > "{path-O}" 2> "{path-E}" < /dev/null & echo $!';
const WAIT_LINE = 'wait-for.js" pid --pid {pid} --max-seconds 150';
const MERGE_CALL = 'merge-lens-replies --into "{into}" --out "{path-M}" --lens {lens} --reviewers {n} --side-a "{file-A|-}"';
const SETTLE_CALL = 'settle-lens-replies "{settle-file}" --ctx-id "{ctx-id}" --run "$PIPELINE_RUN_DIR" --only confirmed';
const READ_ONLY_LINE = '`READ-ONLY: you have no scratch path and no Write tool; create no file.`';
const REDISPATCH_STEP = '--step "Step 3 lens dispatch (worker lens re-dispatch)"';
const REDISPATCH_TEXT = '`workers failed: {lens}/{side}[, …] → fallback: Task dispatch of those lenses`';
const SETTLE_EXIT_2 = 'An exit 2 on the first call is fallback condition `settle exit 2`';
const FAIL_CLOSED = 'never a worker-fallback condition';

// [pattern, fact, AC]: each must match exactly once in the sub-file (assertEachPatternGoesRed proves it).
const FACTS = [
  [/`command -v claude`/, 'the claude-binary availability probe', 'AC2.2'],
  [new RegExp(esc(START_LINE)), 'the detached launcher start line with all four flags', 'AC2.1'],
  [new RegExp(esc(WAIT_LINE)), 'the wait-for.js pid wait on the launcher', 'AC2.1'],
  [new RegExp(esc(READ_ONLY_LINE)), 'the READ-ONLY brief line in place of SCRATCH', 'AC2.1'],
  [/Lens 3f always runs on the Task path/, 'lens 3f stays on the Task path', 'AC2.1'],
  [new RegExp(esc(MERGE_CALL)), 'the merge-lens-replies call', 'AC2.1'],
  [new RegExp(esc(SETTLE_CALL)), 'the one settle-lens-replies first call over the settle file', 'AC2.1'],
  [/`--path worker`/, 'launcher-settled lenses recorded --path worker', 'AC2.1'],
  [/log-decision\.js" --run "\$PIPELINE_RUN_DIR" --section "\/review" --status SKIP --step "Step 3 lens dispatch \(worker fallback\)" --text-file "\{path-S\}" --reversibility n\/a/, 'the worker fallback SKIP line through log-decision.js', 'AC2.2'],
  [new RegExp(esc(REDISPATCH_STEP)), 'the partial re-dispatch logs under its own step label', 'AC3.1'],
  [new RegExp(esc(REDISPATCH_TEXT)), 'the partial re-dispatch SKIP text', 'AC3.1'],
  [/re-dispatched reviewer that itself fails[^.]*`step3-tier-variants\.md`'s partner-died/, 'the Task re-dispatch is the one retry, then partner-died', 'AC3.1'],
  [new RegExp(esc(FAIL_CLOSED)), 'the fail-closed shapes are never a fallback condition', 'AC4.1'],
  [new RegExp(esc(SETTLE_EXIT_2)), 'every first-call settle exit 2 is condition settle exit 2', 'AC4.2'],
  // Fix round 1: review-focus pins, the held-reply rule (controller ruling) and the bounded merge retry.
  [/`\{path-O\}` is empty or not JSON/, 'empty launcher stdout is launch error, never an empty reply set', 'AC2.2'],
  [/Off darwin the launcher starts, but every side fails with reason `platform`/, 'off darwin every side fails platform', 'AC2.2'],
  [/minus every lens whose Task-path replies are already held[^.]*re-dispatched\. Only the lenses with no Task replies in hand are dispatched/, 'held Task-path replies are never dispatched again on fallback', 'AC2.2'],
  [/run it once more, never a third time/, 'the merge exit-2 retry is bounded to one', 'AC2.2'],
  [new RegExp(esc('`condition: settle exit 2: merge-lens-replies {exit 2|write} failed → fallback: Task lens dispatch`')), 'a merge failure logs condition 4 with its own message', 'AC2.2'],
  // Final review finding 2: the Start and wait failure exits.
  [/Start call that prints no PID[^.]*`wait-for\.js` exit 2[^.]*is condition 2 too.*?3f or 3h not yet dispatched stays in Fallback's Task set/, 'no PID or a wait-for exit 2 is launch error, and undispatched 3f/3h stay in the Task set', 'AC2.2'],
];
const missingFacts = missingFactsOf(FACTS.map(([p, f]) => [p, f]));
const factsFor = (ac) => FACTS.filter(([, , tag]) => tag === ac).map(([p, f]) => [p, f]);

// Section-scoped clauses: [section, literal, message].
const SCOPED = [
  ['## Start', START_LINE, 'Start must carry the launcher start line'],
  ['## Start', WAIT_LINE, 'Start must wait on the launcher PID'],
  ['## Read the reply', REDISPATCH_STEP, 'Read the reply must log the partial re-dispatch under its own label'],
  ['## Settle', SETTLE_EXIT_2, 'Settle must name a first-call exit 2 as condition settle exit 2'],
  ['## Settle', FAIL_CLOSED, 'Settle must keep the fail-closed shapes off the fallback'],
];

function checkSubFile(text) {
  const fallback = sectionOf(text, '## Fallback');
  for (const label of LABELS) assert.match(fallback, labelItem(label), `fallback condition missing: ${label}`);
  for (const [section, literal, message] of SCOPED) assert.ok(sectionOf(text, section).includes(literal), message);
  assert.deepEqual(missingFacts(text), [], 'sub-file facts missing');
}

// ---- positive tests ----

test('step3-lens-dispatch.md carries the worker pointer before the workflow pointer (600-byte cap)', () => {
  checkPointer(read(LENS_DISPATCH));
});

test('step3-worker-dispatch.md passes the whole check', () => {
  checkSubFile(read(SUB_FILE));
});

for (const [ac, what] of [
  ['AC2.1', 'starts the launcher, merges the Task-path replies and settles once'],
  ['AC2.2', 'logs one worker fallback SKIP line and takes the Task path'],
  ['AC3.1', 're-dispatches a lens with a failed side on the Task path, once'],
  ['AC4.1', 'keeps the fail-closed settle shapes off the fallback'],
  ['AC4.2', 'takes every first-call settle exit 2 as condition settle exit 2'],
]) {
  test(`${ac}: step3-worker-dispatch.md ${what}`, () => {
    const facts = factsFor(ac);
    assert.ok(facts.length > 0, `no facts tagged ${ac}`);
    assert.deepEqual(missingFactsOf(facts)(read(SUB_FILE)), []);
  });
}

test('AC2.2/AC4.2: the four whole-fallback conditions are numbered items of the Fallback section', () => {
  const fallback = sectionOf(read(SUB_FILE), '## Fallback');
  for (const label of LABELS) assert.match(fallback, labelItem(label), label);
});

// ---- the contract paragraph and the docs ----

const CONTRACT_NEEDLE = 'under `worker`, `review-lens-workers.js` runs each brief as a headless worker';

function checkContract(text) {
  assert.ok(sectionOf(text, '## Workflow-dispatched agents').includes(CONTRACT_NEEDLE), 'contract must state the worker paragraph under Workflow-dispatched agents');
}

function checkStructureRow(text) {
  const row = rowWithContinuations(text, '| review |');
  assert.ok(row.includes('step3-workflow-dispatch.md, step3-worker-dispatch.md,'), 'review row file list must name step3-worker-dispatch.md');
  assert.match(row, /step3-worker-dispatch\.md holds/, 'review row must say what step3-worker-dispatch.md holds');
}

const GRAPH_NEEDLE = 'Since #6003, with policy key `review-lens-dispatch: worker`';

function checkGraph(text) {
  assert.ok(text.includes(GRAPH_NEEDLE), 'skill-graph must state the #6003 worker path');
}

test('the contract, docs/plugin-structure.md and docs/skill-graph.md name the worker path', () => {
  checkContract(read(CONTRACT));
  checkStructureRow(read('docs/plugin-structure.md'));
  checkGraph(read('docs/skill-graph.md'));
});

test('go-red: each docs pin goes red with its own message', () => {
  const contract = read(CONTRACT);
  const noContract = contract.split(CONTRACT_NEEDLE).join('under worker');
  assert.notEqual(noContract, contract);
  assert.throws(() => checkContract(noContract), { message: /contract must state the worker paragraph/ });
  const movedContract = `${noContract}\n## Elsewhere\n\n${CONTRACT_NEEDLE}\n`;
  assert.throws(() => checkContract(movedContract), { message: /contract must state the worker paragraph/ });
  const structure = read('docs/plugin-structure.md');
  const unlisted = structure.replace('step3-workflow-dispatch.md, step3-worker-dispatch.md,', 'step3-workflow-dispatch.md,');
  assert.notEqual(unlisted, structure);
  assert.throws(() => checkStructureRow(unlisted), { message: /file list must name step3-worker-dispatch\.md/ });
  const undescribed = structure.replace('step3-worker-dispatch.md holds', 'it holds');
  assert.notEqual(undescribed, structure);
  assert.throws(() => checkStructureRow(undescribed), { message: /say what step3-worker-dispatch\.md holds/ });
  const graph = read('docs/skill-graph.md');
  const noGraph = graph.split(GRAPH_NEEDLE).join('Since then');
  assert.notEqual(noGraph, graph);
  assert.throws(() => checkGraph(noGraph), { message: /skill-graph must state the #6003 worker path/ });
});

// ---- go-red controls: the pointer ----

test('go-red: step3-lens-dispatch.md without the pointer paragraph fails', () => {
  const live = read(LENS_DISPATCH);
  const paragraph = pointerParagraph(live);
  assert.ok(paragraph !== null);
  const mutated = live.replace(paragraph, '');
  assert.notEqual(mutated, live);
  assert.throws(() => checkPointer(mutated), { message: /pointer paragraph missing/ });
});

test('go-red: a pointer paragraph over 600 bytes fails', () => {
  const live = read(LENS_DISPATCH);
  const paragraph = pointerParagraph(live);
  const mutated = live.replace(paragraph, `${paragraph} ${'x'.repeat(POINTER_MAX_BYTES)}`);
  assert.notEqual(mutated, live);
  assert.throws(() => checkPointer(mutated), { message: /bytes, over 600/ });
});

test('go-red: a pointer without each needle fails with that needle\'s message', () => {
  const live = read(LENS_DISPATCH);
  const paragraph = pointerParagraph(live);
  for (const [needle, message] of POINTER_NEEDLES) {
    const global = new RegExp(needle.source, 'g');
    const mutated = live.replace(paragraph, paragraph.replace(global, ''));
    assert.notEqual(mutated, live, `needle not found in the pointer: ${message}`);
    assert.throws(() => checkPointer(mutated), { message: new RegExp(esc(message)) });
  }
});

test('go-red: the pointer moved after the workflow pointer fails', () => {
  const live = read(LENS_DISPATCH);
  const paragraph = pointerParagraph(live);
  const placed = `${paragraph}\n>\n${WORKFLOW_ANCHOR}`;
  assert.ok(live.includes(placed), 'pointer not found before the workflow pointer');
  const moved = live.replace(placed, WORKFLOW_ANCHOR).replace('> **Parallel execution (conditional):**', `${paragraph}\n>\n> **Parallel execution (conditional):**`);
  assert.notEqual(moved, live);
  assert.throws(() => checkPointer(moved), { message: /pointer must sit immediately before the workflow pointer/ });
});

// ---- go-red controls: the sub-file ----

test('go-red: the sub-file without each fallback condition item fails with that condition\'s message', () => {
  const live = read(SUB_FILE);
  for (const label of LABELS) {
    const mutated = live.replace(labelItem(label), '1. removed —');
    assert.notEqual(mutated, live, `item not found: ${label}`);
    assert.throws(() => checkSubFile(mutated), { message: new RegExp(`fallback condition missing: ${esc(label)}`) });
  }
});

test('go-red: a fallback condition item moved out of the Fallback section fails', () => {
  const live = read(SUB_FILE);
  for (const label of LABELS) {
    const item = live.split('\n').find((line) => labelItem(label).test(line));
    assert.ok(item, `item not found: ${label}`);
    const mutated = `${live.replace(item, '1. moved —')}\n## Elsewhere\n\n${item}\n`;
    assert.throws(() => checkSubFile(mutated), { message: new RegExp(`fallback condition missing: ${esc(label)}`) });
  }
});

test('go-red: each section-scoped clause moved out of its section fails with its own message', () => {
  const live = read(SUB_FILE);
  for (const [section, literal, message] of SCOPED) {
    assert.ok(sectionOf(live, section).includes(literal), `literal not found in ${section}: ${literal}`);
    const mutated = `${live.split(literal).join('moved')}\n## Elsewhere\n\n${literal}\n`;
    assert.throws(() => checkSubFile(mutated), { message: new RegExp(esc(message)) });
  }
});

test('go-red: each sub-file fact goes red alone when its text is removed', () => {
  assertEachPatternGoesRed(read(SUB_FILE), FACTS.map(([p, f]) => [p, f]), missingFacts);
});

test('go-red: the whole check fails with the fact list when one fact goes missing', () => {
  const live = read(SUB_FILE);
  const mutated = live.split('`--path worker`').join('`--path workflow`');
  assert.notEqual(mutated, live);
  assert.throws(() => checkSubFile(mutated), { message: /sub-file facts missing/ });
});

// ---- the pinned commands against the flags their CLIs accept ----

const { spawnSync } = require('node:child_process');

const flagsOf = (line) => [...new Set(line.match(/--[a-z][a-z-]*/g) || [])];
const helpOf = (rel) => spawnSync(process.execPath, [path.join(ROOT, rel), '--help'], { encoding: 'utf8', windowsHide: true }).stdout;
const mergeUsageOf = () => helpOf('plugin/bin/review-coordination.js').split('\n').find((l) => l.includes('merge-lens-replies'));

function checkFlagsAccepted(line, usage, what) {
  const flags = flagsOf(line);
  assert.ok(flags.length >= 4, `${what}: found only ${flags.length} flags in the pinned command`);
  for (const flag of flags) assert.ok(usage.split(/[\s[\]<>|]+/).includes(flag), `${what}: the CLI usage does not list ${flag}`);
}

test('the pinned start and merge commands use only flags their CLIs list in --help', () => {
  checkFlagsAccepted(START_LINE, helpOf('plugin/bin/review-lens-workers.js'), 'launcher start line');
  const mergeUsage = mergeUsageOf();
  assert.ok(mergeUsage, 'review-coordination.js --help names no merge-lens-replies usage line');
  checkFlagsAccepted(MERGE_CALL, mergeUsage, 'merge-lens-replies call');
});

test('go-red: a renamed flag in the pinned start or merge command fails with its own message', () => {
  const launcher = helpOf('plugin/bin/review-lens-workers.js');
  const merge = mergeUsageOf();
  assert.throws(() => checkFlagsAccepted(START_LINE.replace('--bundle', '--bundles'), launcher, 'launcher start line'), { message: /launcher start line: the CLI usage does not list --bundles/ });
  assert.throws(() => checkFlagsAccepted(MERGE_CALL.replace('--side-a', '--side-first'), merge, 'merge-lens-replies call'), { message: /merge-lens-replies call: the CLI usage does not list --side-first/ });
});
