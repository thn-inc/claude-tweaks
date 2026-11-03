'use strict';
// tests/flow-context-handoff-conformance.test.js — #4027 Task 8: /flow's
// phase-boundary context cap check. Step 4 runs bin/context-gauge.js with
// --next-steps at a boundary that has a step left; past the cap, the next phase
// starts in a fresh agent from {run}/handoff.json. Pins the Step 4 call site,
// context-handoff.md's two branches (a dispatched call reports
// `OUTCOME: handoff` + `NEXT_STEPS:` — the contract Task 9's dispatcher reads;
// a top-level run hands off to one fresh Agent), the fail-open rule, the
// template's verbatim copy of dispatch/task-prompt.md's async-wait item, and its
// worktree shell-constraint item (#4728). #4358 adds the sequential multi-spec
// form: multi-spec.md's Context cap, steps-and-gates.md's Per-record resume.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const FLOW = 'plugin/skills/flow/SKILL.md';
const HANDOFF = 'plugin/skills/flow/context-handoff.md';
const STEPS_AND_GATES = 'plugin/skills/flow/steps-and-gates.md';
const TASK_PROMPT = 'plugin/skills/dispatch/task-prompt.md';
const MULTI_SPEC = 'plugin/skills/flow/multi-spec.md';
const CODE_MODE_STEPS = 'plugin/skills/review/code-mode-steps.md';
const RECORD_STEPS_CLI = path.join(ROOT, 'plugin', 'bin', 'record-steps.js');

// The text from `start` up to (not including) `end`; fails loudly when either
// anchor is gone, so a moved heading cannot turn an assertion vacuous.
function region(text, start, end, label) {
  const s = text.indexOf(start);
  assert.notEqual(s, -1, `${label}: start anchor ${JSON.stringify(start)} not found`);
  const e = text.indexOf(end, s + start.length);
  assert.notEqual(e, -1, `${label}: end anchor ${JSON.stringify(end)} not found`);
  return text.slice(s, e);
}

function fencedBlocks(text) {
  const blocks = [];
  const re = /^```[^\n]*\n([\s\S]*?)^```$/gm;
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  return blocks;
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();

// dispatch/task-prompt.md's Context pack item 7, from its first sentence to
// the item's end — the rule the handoff template copies in the same words.
function item7Body(text) {
  const head = '7. **Async-wait discipline** — ';
  const start = text.indexOf(head);
  assert.notEqual(start, -1, 'task-prompt.md lost its item 7 "Async-wait discipline" heading');
  const rest = text.slice(start + head.length);
  const end = rest.search(/\n(?:8\. |## )/);
  assert.notEqual(end, -1, 'task-prompt.md: no "8. " item or "## " heading follows item 7');
  return squash(rest.slice(0, end));
}

const stepFourItem = () => region(read(FLOW), '3. **Check the gate**', '**Pass context forward**', 'flow Step 4 cap-check item');

// #4358: a region that must state many facts. `missingFacts` is the gaps function; the
// go-red control strips one fact's own match and requires exactly that fact back, so
// each pattern must match once in its slice and overlap no other.
const missingFacts = (facts, text) => facts.filter(([re]) => !re.test(text)).map(([, fact]) => fact);

function assertEachFactGoesRed(facts, text) {
  assert.deepEqual(missingFacts(facts, text), [], 'the live region must state every fact before its controls mean anything');
  for (const [re, fact] of facts) {
    const doctored = text.replace(re, '');
    assert.notEqual(doctored, text, `anchor text for "${fact}" not found`);
    assert.deepEqual(missingFacts(facts, doctored), [fact], `removing only "${fact}" must turn exactly that fact red`);
  }
}

const contextCap = (t = read(MULTI_SPEC)) => squash(region(t, '## Context cap (sequential runs)', '\n## PR phase-checklist', 'Context cap'));
const perRecordResume = (t = read(STEPS_AND_GATES)) => squash(region(t, '### Per-record resume (record-steps=)', '### Adopting an inherited run directory', 'Per-record resume'));
const gaugeBullet = (t) => squash(region(t, '- **A single-spec or sequential run.**', '\n- **Not under `interactive`', 'gauge bullet'));

const CONTEXT_CAP_FACTS = [
  [/after each passing gate of each record/, 'the boundary: each passing gate of each record'],
  [/with a step left in the run/, 'the boundary: a step left in the run'],
  [/under `auto`\/`confirm`\/`hybrid`/, 'the modes it runs under'],
  [/never under the `parallel` token or as a `MULTISPEC_PARALLEL_WAVE=1` wave member/, 'the parallel and wave-member exclusion'],
  [/`\{parent\}` the literal parent run dir, never `spec-\{N\}\/`/, 'the literal parent run dir, never spec-{N}/'],
  [/exits 2 on a `spec-` basename/, 'why: the gauge refuses a spec- basename'],
  [/bin\/context-gauge\.js" --run "\{parent\}" --record-steps "\{value\}" \[--keep-going\] \[--no-stories\]/, 'the gauge call with --record-steps, --keep-going and --no-stories'],
  [/`--keep-going` only under the `keep-going` token/, '--keep-going only under the keep-going token'],
  [/`--no-stories` only under the `no-stories` token/, '--no-stories only under the no-stories token'],
  [/a later record's list can still hold `build`/, 'why: a later record can still run build'],
  [/the `dispatched` read targets `\$MULTISPEC_PARENT_DIR`/, 'the dispatched read targets the parent'],
  [/`\{run\}` and `handoff\.json` are the parent's/, '{run} and handoff.json are the parent\'s'],
  [/A read against `spec-\{N\}\/` prints nothing/, 'why: a per-spec read prints nothing'],
  [/a record past its list, failed under `keep-going`, or `not-run` is `none`/, 'none for a finished, failed or not-run record'],
  [/the current record takes its remaining steps/, 'the current record takes its remaining steps'],
  [/a later record takes its full list with `test` written out before `review`/, 'a later record writes test out before review'],
  [/leaves `wrap-up` off every list/, 'a run not bound dispatched leaves wrap-up off every list'],
  [/skips the gauge when only `wrap-up` steps remain/, 'it skips the gauge when only wrap-up steps remain'],
  [/Result handling is `context-handoff\.md`'s/, 'result handling is context-handoff.md\'s'],
];

const RESUME_FACTS = [
  [/bin\/record-steps\.js" --value "\{value\}" --targets "\{targets\}"/, 'the record-steps.js validation call'],
  [/a non-zero exit stops before Step 2, as a Step 1 validation failure/, 'a refused value stops before Step 2'],
  [/A step list beside the token is the same stop/, 'a step list beside the token is the same stop'],
  [/runs exactly its steps/, 'each list runs exactly its steps'],
  [/no resume-onward/, 'no resume-onward'],
  [/no `test` auto-insert before `review`/, 'no test auto-insert'],
  [/`build`'s automatic `stories` and `polish`'s bundled re-verify still apply/, 'stories and re-verify still apply'],
  [/`none` runs nothing and the record stays a target/, 'none stays a target'],
  [/A resumed run carrying `keep-going` keeps it/, 'keep-going survives the resume'],
  [/one carrying `no-stories` keeps that/, 'no-stories survives the resume'],
  [/Step 2\.4, Step 2\.7b, Step 2\.8/, 'the steps the union feeds, Step 2.4 included'],
  [/is the CLI's `steps` union/, 'the union for {steps}'],
  [/enters `review` with `TEST_PASSED=true`, because the handing-off agent's test gate passed/, 'a list past test enters review with TEST_PASSED=true'],
  [/the stamp read is then the real check/, 'the stamp read is the real check'],
  [/`review\/code-mode-steps\.md`'s Step 1\.5 Test Gate/, 'the code-mode-steps.md citation'],
  [/re-triggers `\/claude-tweaks:test` when the stamp does not verify HEAD/, 'the gate re-triggers test on a stale stamp'],
  [/Pre-flight Verify Sweep does not re-run/, 'the sweep does not re-run'],
  [/an existing `spec-\{N\}\/config\.yml` is not re-scaffolded/, 'the no-re-scaffold rule'],
  [/`manifest-init` keeps each spec's status/, 'manifest-init keeps each status'],
  [/Boundary freshness check runs only before a record that has not started/, 'freshness only before an unstarted record'],
  [/consolidated pass runs when any record's list carries `wrap-up`/, 'the consolidated pass condition'],
  [/otherwise Step 5's partial note applies/, 'the partial note otherwise'],
  [/leaves the pass to its parent, which runs it even after the child's failure card/, 'a handed-off child leaves the pass to its parent, failure card included'],
];

// The precondition Per-record resume's TEST_PASSED sentence answers: the gate reads the stamp
// only when TEST_PASSED is present, and a fresh continuation agent never ran `test`.
const TEST_GATE_FACTS = [
  [/Check for `TEST_PASSED=true` in pipeline context\. If present,/, 'the stamp read is conditional on TEST_PASSED in pipeline context'],
];

const EXECUTION_FACTS = [
  [/`record-steps=` resume follows `steps-and-gates\.md`'s Per-record resume over this section/, 'the pointer to Per-record resume'],
  [/no Pre-flight Verify Sweep/, 'no sweep on a resume'],
  [/no re-scaffold of a record that has a `spec-\{N\}\/config\.yml`/, 'no re-scaffold on a resume'],
  [/each record runs its own list, not the full pipeline/, 'each record runs its own list'],
];

const GAUGE_BULLET_FACTS = [
  [/single-spec run uses `--next-steps`/, 'a single-spec run uses --next-steps'],
  [/sequential multi-spec run uses `--record-steps` per `multi-spec\.md`'s Context cap/, 'a sequential multi-spec run uses --record-steps'],
  [/`parallel` run or a `MULTISPEC_PARALLEL_WAVE=1` wave member does not gauge/, 'parallel and wave members are excluded'],
];

const STEP_FOUR_FACTS = [
  [/runs outside `interactive`, never a `MULTISPEC_PARALLEL_WAVE=1` wave member/, 'the opening exclusions'],
  [/A multi-spec run takes `multi-spec\.md`'s Context cap section instead of this item's `--next-steps` form/, 'the route to the Context cap'],
];

const PARENT_RUN_FACTS = [
  [/the `dispatched` read targets `\$MULTISPEC_PARENT_DIR`/, 'the dispatched read targets the parent'],
  [/`\{run\}` and `handoff\.json` are the parent's/, '{run} and handoff.json are the parent\'s'],
];

const STEPS_COMPLETE_FACTS = [
  [/multi-spec run's note names `\{MULTISPEC_PARENT_DIR\}\/handoff\.json`/, 'the multi-spec note names the parent handoff.json'],
  [/`Run directory: \{MULTISPEC_PARENT_DIR\}`/, 'the multi-spec note names the parent run dir'],
  [/`Handed off: \{next-steps\} continue in a fresh agent from \{PIPELINE_RUN_DIR\}\/handoff\.json\.`/, 'the single-spec line stays'],
  [/then, when `wrap-up` is in its step list, runs `wrap-up` and Step 5 itself/, 'a top-level run owes wrap-up only when its step list holds it'],
];

const REPORT_ITEM_FACTS = [
  [/`NEXT_STEPS: \{comma-joined remaining steps\}`/, 'the flat NEXT_STEPS literal stays'],
  [/A multi-spec run's line is `NEXT_STEPS: \{the --record-steps value\}`/, 'the multi-spec NEXT_STEPS form'],
];

const TOP_LEVEL_FACTS = [
  [/per-record `wrap-up` exports each record's own `\{parent\}\/spec-\{N\}\/`/, 'a per-record wrap-up exports its own spec dir'],
  [/A multi-spec child's lists carry no `wrap-up`/, 'a multi-spec child carries no wrap-up'],
  [/when this agent's own step list carries `wrap-up`/, 'only when this agent\'s own step list carries wrap-up'],
  [/A `record-steps=` child's own lists never carry `wrap-up`, so its relayed note is its close/, 'a record-steps= child\'s relayed note is its close'],
  [/runs `wrap-up` in run order for each record whose `manifest\.yml` status is none of `complete`, `failed`, `not-run`, then the consolidated pass/, 'wrap-up per unfinished record, then the consolidated pass'],
  [/A child that did not report, or that reported `BLOCKED`, stops this agent, because it may still be writing/, 'only a silent or BLOCKED child stops a multi-spec parent'],
  [/multi-spec failure card under a step list holding `wrap-up`/, 'a multi-spec failure card under a wrap-up list is the exception'],
  [/requires the console after a HARD-GATE abort/, 'why: the console is owed after a HARD-GATE abort'],
  [/still takes the status-filtered loop at the end of this item/, 'the failure card still takes the status-filtered loop'],
];

// Every position in `markers` must exist and increase. Both messages are matched by the controls.
function requireOrder(text, markers) {
  let last = -1;
  for (const marker of markers) {
    const at = text.indexOf(marker);
    assert.notEqual(at, -1, `marker missing: ${marker}`);
    assert.ok(at > last, `${marker} must come after the marker before it`);
    last = at;
  }
}

const EXAMPLE_TOKEN = /`record-steps=(#\d+:[^`\s]+)`/;

// The example the prose prints, through the real parser. Returns the refusal, or null when it parses.
function exampleTokenRefusal(section) {
  const m = section.match(EXAMPLE_TOKEN);
  assert.ok(m, 'Per-record resume must print one concrete record-steps= example');
  const value = m[1];
  const targets = value.split(';').map((entry) => entry.split(':')[0]).join(',');
  const r = spawnSync(process.execPath, [RECORD_STEPS_CLI, '--value', value, '--targets', targets], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return `exit ${r.status}: ${r.stderr.trim()}`;
  return JSON.parse(r.stdout).canonical === value ? null : `not canonical: ${r.stdout.trim()}`;
}

test('AC1.3: multi-spec.md\'s Context cap states the --record-steps call, the literal parent run dir, and how {value} composes (each fact goes red)', () => {
  assertEachFactGoesRed(CONTEXT_CAP_FACTS, contextCap());
});

test('steps-and-gates.md\'s Per-record resume states the exact-steps rule, validation, the union, the no-re-scaffold rule (each fact goes red)', () => {
  assertEachFactGoesRed(RESUME_FACTS, perRecordResume());
});

test('the cited gate is real: code-mode-steps.md\'s Step 1.5 is the Test Gate, and it re-triggers /test on a stamp that does not verify HEAD', () => {
  const gate = region(read(CODE_MODE_STEPS), '## Step 1.5: Test Gate', '## Step 1.6', 'Test Gate');
  assert.match(gate, /`verifiedHead: false`[^\n]*re-trigger `\/claude-tweaks:test`/);
  assert.match(gate, /\*\*`verifiedHead: false`\*\* → no recent pass[^\n]*auto-trigger `\/claude-tweaks:test/);
  assertEachFactGoesRed(TEST_GATE_FACTS, gate);
});

test('multi-spec.md\'s Execution opens by pointing a record-steps= resume at Per-record resume (each fact goes red)', () => {
  const [, opening] = read(MULTI_SPEC).split('\n## Execution\n');
  assert.ok(opening, 'multi-spec.md lost its ## Execution heading');
  const firstParagraph = opening.trim().split('\n\n')[0];
  assertEachFactGoesRed(EXECUTION_FACTS, firstParagraph);
});

test('the example token the prose prints parses through the real record-steps.js, and a mangled one is refused', () => {
  const section = perRecordResume();
  assert.equal(exampleTokenRefusal(section), null);
  const mangled = section.replace(EXAMPLE_TOKEN, '`record-steps=#12:tset`');
  assert.notEqual(mangled, section);
  assert.match(exampleTokenRefusal(mangled), /^exit 2: /);
});

test('the Context cap section sits after ## Execution and before the PR checklist section', () => {
  const t = read(MULTI_SPEC);
  const [EXECUTION, CAP, PR] = ['\n## Execution\n', '\n## Context cap (sequential runs)\n', '\n## PR phase-checklist'];
  const chain = [EXECUTION, CAP, PR];
  requireOrder(t, chain);
  const capBlock = t.slice(t.indexOf(CAP), t.indexOf(PR));
  const withoutCap = t.replace(capBlock, '');
  assert.notEqual(withoutCap, t);
  const capFirst = withoutCap.replace(EXECUTION, `${capBlock}${EXECUTION}`);
  assert.notEqual(capFirst, withoutCap);
  assert.throws(() => requireOrder(capFirst, chain), /must come after/);
  const prFirst = t.replace(PR, '').replace(CAP, `${PR}${CAP}`);
  assert.notEqual(prFirst, t);
  assert.throws(() => requireOrder(prFirst, chain), /must come after/);
  assert.throws(() => requireOrder(withoutCap, chain), /marker missing/);
});

test('context-handoff.md\'s gauge bullet routes each run shape (each fact goes red)', () => {
  assertEachFactGoesRed(GAUGE_BULLET_FACTS, gaugeBullet(read(HANDOFF)));
});

test('flow Step 4 item 4 routes a multi-spec run to the Context cap (each fact goes red)', () => {
  assertEachFactGoesRed(STEP_FOUR_FACTS, squash(stepFourItem()));
});

test('context-handoff.md\'s Reading the result states the parent-run rule (each fact goes red)', () => {
  assertEachFactGoesRed(PARENT_RUN_FACTS, squash(region(read(HANDOFF), '## Reading the result', '\n## Dispatched call', 'reading the result')));
});

test('a multi-spec Steps Complete note names the parent, while the single-spec form stays (each fact goes red)', () => {
  assertEachFactGoesRed(STEPS_COMPLETE_FACTS, squash(region(read(STEPS_AND_GATES), '**A handed-off run produces this same branch too', '**Auto-insert `test`:**', 'handed-off paragraph')));
});

test('Dispatched call item 4 keeps the flat NEXT_STEPS literal and adds the --record-steps form (each fact goes red)', () => {
  const d = region(read(HANDOFF), '\n## Dispatched call', '\n## Top-level run', 'dispatched branch');
  const item = d.split('\n').find((l) => l.startsWith('4. **Report**'));
  assert.ok(item, 'Dispatched call lost its item 4');
  assertEachFactGoesRed(REPORT_ITEM_FACTS, item);
});

test('Top-level run: a multi-spec agent runs wrap-up per unfinished record, then the consolidated pass (each fact and each status literal goes red)', () => {
  const n = squash(region(read(HANDOFF), '## Top-level run', '\n```', 'top-level branch'));
  assertEachFactGoesRed(TOP_LEVEL_FACTS, n);
  for (const literal of ['`complete`, ', '`failed`, ', ', `not-run`']) {
    const doctored = n.replace(`none of \`complete\`, \`failed\`, \`not-run\``, (s) => s.replace(literal, ''));
    assert.notEqual(doctored, n, `status literal ${literal} not found`);
    assert.deepEqual(missingFacts(TOP_LEVEL_FACTS, doctored), ['wrap-up per unfinished record, then the consolidated pass']);
  }
});

function recordStepsTokenGaps(t) {
  const gaps = [];
  const bullet = region(t, '\n## Input\n', '\n## Syntax\n', 'Input').split('\n').find((l) => l.startsWith('- `record-steps=#A:{steps};#B:{steps}`')) || '';
  if (!/^- `[^`]*` \(producer-only\)/.test(bullet)) gaps.push('the producer-only marker right after the code span');
  if (!bullet.includes("`steps-and-gates.md`'s Per-record resume")) gaps.push('the Per-record resume pointer');
  if (t.split('\n').find((l) => l.startsWith('argument-hint:')).includes('record-steps')) gaps.push('out of argument-hint');
  if (region(t, '\n## Syntax\n', '\n### Arguments', 'Syntax').includes('record-steps')) gaps.push('out of Syntax');
  const item = t.split('\n').find((l) => l.startsWith('4. Validate step list is in lifecycle order')) || '';
  if (!item.includes('A `record-steps=` token replaces the step list.')) gaps.push('Step 1 item 4 replaces the step list');
  return gaps;
}

test('flow SKILL.md: record-steps= is a producer-only ## Input bullet, stays out of the hint and Syntax, and replaces the step list in Step 1', () => {
  assert.deepEqual(recordStepsTokenGaps(read(FLOW)), []);
});

test('each record-steps= token check goes red on its own', () => {
  const t = read(FLOW);
  const cases = [
    ['{steps}` (producer-only) —', '{steps}` — (producer-only)', 'the producer-only marker right after the code span'],
    ["see `steps-and-gates.md`'s Per-record resume", 'see the Step Arguments', 'the Per-record resume pointer'],
    ['argument-hint: "#N[,#M...]', 'argument-hint: "#N[,#M...] [record-steps=]', 'out of argument-hint'],
    ['/claude-tweaks:flow #N[,#M...]', '/claude-tweaks:flow #N[,#M...] [record-steps=]', 'out of Syntax'],
    [' A `record-steps=` token replaces the step list.', '', 'Step 1 item 4 replaces the step list'],
  ];
  for (const [anchor, swap, gap] of cases) {
    const doctored = t.replace(anchor, swap);
    assert.notEqual(doctored, t, `the anchor ${JSON.stringify(anchor)} is gone`);
    assert.deepEqual(recordStepsTokenGaps(doctored), [gap]);
  }
});

test('flow Step 4 runs context-gauge.js with --next-steps and a literal run dir, only with a step left, and points at context-handoff.md', () => {
  const r = stepFourItem();
  assert.match(r, /bin\/context-gauge\.js" --run "\/[^"$]*" --next-steps /, 'the gauge call must pass --run as a literal absolute path and --next-steps');
  assert.doesNotMatch(r, /context-gauge\.js" --run "\$/, 'the gauge call must never pass --run "$PIPELINE_RUN_DIR"');
  assert.match(r, /never `\$PIPELINE_RUN_DIR`/, 'the item must say why the run dir is spelled out');
  assert.match(r, /at least one step (?:still )?(?:left|to run|remains)/);
  assert.match(r, /`MULTISPEC_PARALLEL_WAVE=1`/);
  assert.match(r, /`context-handoff\.md`/);
  assert.match(r, /exit 2[^\n]*continue in this agent/i);
});

test('context-handoff.md states the fail-open rule: over: false, exit 2, or non-JSON output continues in this agent', () => {
  const t = read(HANDOFF);
  assert.match(t, /`over: false` means continue in this agent/);
  assert.match(t, /exit 2[^\n]*continue in this agent/i);
  assert.match(t, /non-JSON output: continue in this agent/);
  assert.match(t, /`handoff: null`/);
  assert.match(t, /never stops the run/);
});

test('context-handoff.md: a dispatched call reports OUTCOME: handoff and NEXT_STEPS: with STATUS: DONE, after the phase-exit push', () => {
  const t = read(HANDOFF);
  const d = region(t, '\n## Dispatched call', '\n## ', 'dispatched branch');
  assert.match(d, /`dispatched: true`/);
  assert.match(d, /`OUTCOME: handoff`/);
  assert.match(d, /`NEXT_STEPS: \{comma-joined remaining steps\}`/);
  assert.match(d, /`STATUS: DONE`/);
  assert.match(d, /Phase-exit push/);
  assert.match(d, /stops before the next step/);
});

test('context-handoff.md: a top-level run hands off to one fresh Agent whose template reads handoff.json first, then waits and relays', () => {
  const t = read(HANDOFF);
  const n = region(t, '## Top-level run', '\n```', 'top-level branch');
  assert.match(n, /\bone fresh `Agent`/);
  assert.match(n, /never `fork`/);
  assert.match(n, /relay/i);
  const blocks = fencedBlocks(t);
  assert.equal(blocks.length, 1, `context-handoff.md must hold exactly one fenced template, found ${blocks.length}`);
  const [tpl] = blocks;
  const readAt = tpl.indexOf('Read `{run}/handoff.json`');
  const resumeAt = tpl.indexOf('`resume`');
  assert.notEqual(readAt, -1, 'the template must tell the child to Read {run}/handoff.json');
  assert.notEqual(resumeAt, -1, "the template must tell the child to run handoff.json's resume command");
  assert.ok(readAt < resumeAt, 'the child reads handoff.json before it runs the resume command');
  assert.match(tpl, /STATUS: \{WORD\}/);
});

test("the handoff template inlines task-prompt.md's async-wait item 7 in the same words, INTERIM_STATUS rule included", () => {
  const [tpl] = fencedBlocks(read(HANDOFF));
  const body = item7Body(read(TASK_PROMPT));
  assert.match(body, /INTERIM_STATUS/, 'the source item lost its INTERIM_STATUS rule');
  assert.ok(squash(tpl).includes(body), "the template's async-wait rule drifted from dispatch/task-prompt.md's Context pack item 7");
});

test('the verbatim-copy check can go red: one changed word in the copy fails it', () => {
  const [tpl] = fencedBlocks(read(HANDOFF));
  const body = item7Body(read(TASK_PROMPT));
  const doctored = squash(tpl).replace('at most 60 (20 minutes)', 'at most 90 (30 minutes)');
  assert.notEqual(doctored, squash(tpl), 'the doctoring anchor is gone from the template');
  assert.ok(!doctored.includes(body));
});

// #4557: the at-bound progress check rides in the template's copy of item 7. The probe targets
// {child-worktree}, never {worktree}: the handoff substitutes {worktree} with the handing-off
// agent's own checkout, which is not where the template's dispatched children work.
const HANDOFF_PROGRESS = [
  [/`git -C "\{child-worktree\}" rev-parse HEAD`/, 'the template probes the child worktree HEAD'],
  [/`git -C "\{child-worktree\}" --no-optional-locks status --porcelain`/, 'the template probes porcelain status'],
  [/`git -C "\{child-worktree\}" --no-optional-locks diff HEAD` piped to `git hash-object --stdin` \(a `fatal:` line fails the probe\)/, 'the template hashes the diff against HEAD'],
  [/A failed wait call counts as no wait but ends its window, and the probe runs as at any bound/, 'the template states a failed wait call expires the window'],
  [/against the previous probe \(taken right after launching the wave, then at each bound/, 'the template compares with the previous probe'],
  [/a child whose prompt names no worktree counts as unchanged/, 'the template states the no-named-worktree rule'],
  [/Per wave, while any child shows a change, log one wait line and grant one more 60-wait window/, 'the template states the per-wave grant'],
  [/a failed probe command counts as no change, never retried in another form/, 'the template states a failed probe command counts as no change'],
  [/stop when a whole window passes with no change/, 'the template states the one-window stall condition'],
  [/ceiling of 3 windows \(60 minutes\) per wave/, 'the template states the 3-window ceiling'],
  [/Children sharing a worktree progress together/, 'the template states the shared-worktree rule'],
];
const handoffProgressMissing = (tpl) => {
  const squashed = squash(tpl);
  return HANDOFF_PROGRESS.filter(([re]) => !re.test(squashed)).map(([, f]) => f);
};

test('AC4.1: the handoff template carries the progress-check extension, with a child-worktree placeholder the handoff never substitutes (#4557)', () => {
  const [tpl] = fencedBlocks(read(HANDOFF));
  assert.deepEqual(handoffProgressMissing(tpl), []);
  assert.doesNotMatch(squash(tpl), /git -C "?\{worktree\}/);
});

test('AC5.1: each handoff progress-check assertion can go red (discrimination proof)', () => {
  const [tpl] = fencedBlocks(read(HANDOFF));
  const squashed = squash(tpl);
  for (const [re, fact] of HANDOFF_PROGRESS) {
    const doctored = squashed.replace(re, '');
    assert.notEqual(doctored, squashed, `anchor text for "${fact}" not found — proof cannot discriminate`);
    assert.deepEqual(handoffProgressMissing(doctored), [fact], `removing only "${fact}" must turn exactly that assertion red`);
  }
  const swapped = squashed.replace('git -C "{child-worktree}" rev-parse HEAD', 'git -C "{worktree}" rev-parse HEAD');
  assert.match(swapped, /git -C "?\{worktree\}/, 'the placeholder control must match the wrong placeholder');
});

// #4728: the continuation child inherits the worktree, so the harness's Bash-shape
// refusals reach it too. The item cites scratch-worktree.md §7 and
// subagent-dispatch-core.md's "One plain command per Bash call" rather than
// restating the refusal table, and forwards the constraint to any dispatched agent.
function shellItemGaps(tpl) {
  const s = squash(tpl);
  const gaps = [];
  if (!/scratch-worktree\.md`?\s*§7/.test(s)) gaps.push('the scratch-worktree.md §7 citation');
  if (!s.includes('One plain command per Bash call')) gaps.push('the "One plain command per Bash call" citation');
  if (!/[Ff]orward this constraint to any agent you dispatch/.test(s)) gaps.push('the forward-to-dispatched-agents instruction');
  return gaps;
}

test('the continuation template carries the worktree shell-constraint item: cites scratch-worktree.md §7 and "One plain command per Bash call", and forwards it to dispatched agents', () => {
  const [tpl] = fencedBlocks(read(HANDOFF));
  assert.deepEqual(shellItemGaps(tpl), []);
});

test('the shell-constraint check can go red: the item removed from the template fails it', () => {
  const [tpl] = fencedBlocks(read(HANDOFF));
  const item = region(tpl, 'Worktree shell constraint:', 'Plugin root:', 'shell-constraint item');
  const without = tpl.replace(item, '');
  assert.notEqual(without, tpl, 'the item anchor is gone from the template');
  assert.ok(shellItemGaps(without).length > 0, 'the check must report the removed item as missing');
});

test('each sub-check can go red on its own: removing one citation or the forward sentence reports exactly that gap', () => {
  const [tpl] = fencedBlocks(read(HANDOFF));
  const s = squash(tpl);
  const cases = [
    ['scratch-worktree.md` §7', 'scratch-worktree.md` (refusal table)', 'the scratch-worktree.md §7 citation'],
    ['One plain command per Bash call', 'One shell rule', 'the "One plain command per Bash call" citation'],
    ['Forward this constraint to any agent you dispatch', 'Note this constraint', 'the forward-to-dispatched-agents instruction'],
  ];
  for (const [anchor, swap, gap] of cases) {
    const doctored = s.replace(anchor, swap);
    assert.notEqual(doctored, s, `the anchor ${JSON.stringify(anchor)} is gone from the template`);
    assert.deepEqual(shellItemGaps(doctored), [gap]);
  }
});

test("steps-and-gates.md's Partial step lists: a handed-off run renders the partial note naming handoff.json", () => {
  const r = region(read(STEPS_AND_GATES), '### Partial step lists', '**Auto-insert `test`:**', 'Partial step lists');
  assert.match(r, /handed[- ]off/i);
  assert.match(r, /\{PIPELINE_RUN_DIR\}\/handoff\.json/);
  assert.match(r, /`context-handoff\.md`/);
});

// Fix round 1: the exclusions, the top-level wrap-up rule, the wait bound.
test('flow Step 4 gauges only non-interactive, non-wave runs, after build\'s automatic stories, and keeps wrap-up off a top-level --next-steps', () => {
  const r = stepFourItem();
  assert.match(r, /runs outside `interactive`, never a `MULTISPEC_PARALLEL_WAVE=1` wave member/);
  assert.doesNotMatch(r, /no multi-spec handoff/);
  assert.match(r, /after `build`'s automatic `stories`/);
  assert.match(r, /leaves `wrap-up` out of `--next-steps`/);
  assert.match(r, /`wrap-up` is the only step left/);
});

test('context-handoff.md states which runs gauge in which form, and the interactive exclusion explicitly', () => {
  const c = region(read(HANDOFF), '## The check', '## Reading the result', 'the check');
  assert.deepEqual(missingFacts(GAUGE_BULLET_FACTS, gaugeBullet(read(HANDOFF))), []);
  assert.doesNotMatch(c, /Multi-spec handoff is not supported/);
  assert.match(c, /\*\*Not under `interactive`\.\*\*/);
});

test('context-handoff.md: an empty dispatched read lands on the top-level branch', () => {
  const r = region(read(HANDOFF), '## Reading the result', '\n## Dispatched call', 'reading the result');
  assert.match(r, /prints nothing[^\n]*Top-level run branch/);
});

test('context-handoff.md: a top-level run never hands off wrap-up, and runs wrap-up and Step 5 itself after relaying', () => {
  const n = region(read(HANDOFF), '## Top-level run', '\n```', 'top-level branch');
  assert.ok(n.includes('A top-level run never hands off `wrap-up`: its `--next-steps` stops before `wrap-up`, and with `wrap-up` the only step left it does not gauge.'));
  assert.ok(n.includes("After relaying the child's Steps Complete note, this agent runs `wrap-up` and Step 5 itself."));
  assert.ok(n.includes("A child's own handoff never carries `wrap-up` either."));
  assert.doesNotMatch(n, /as this run's result, and stop\. The child's own Step 5/);
});

test('context-handoff.md: the 20-minute wait bound binds only a subagent parent; a top-level session waits unbounded', () => {
  const n = region(read(HANDOFF), '## Top-level run', '\n```', 'top-level branch');
  assert.match(n, /only when this agent is itself a subagent/);
  assert.match(n, /A top-level session waits for the child's task-notification with no bound/);
  assert.match(n, /`_shared\/dispatch-waiting\.md`/);
  assert.match(n, /confirm the child has stopped before anyone runs `resume`/);
  assert.doesNotMatch(n, /Every hop finishes at least one step/);
  assert.match(n, /auto-inserts `test`/);
  assert.match(n, /starts well under the cap/);
});

test("steps-and-gates.md's Steps Complete note has a handed-off variant of its wrap-up-absent sentence", () => {
  const r = region(read(STEPS_AND_GATES), '**A handed-off run produces this same branch too', '**Auto-insert `test`:**', 'handed-off paragraph');
  assert.match(r, /This run is not finished — its remaining steps \{next-steps\} were handed to a fresh agent/);
});

// Fix round 2: a single step argument resumes onward (steps-and-gates.md's
// Step Arguments), so a one-entry top-level --next-steps would run wrap-up in
// the child. A top-level run gauges only with two or more steps before wrap-up.
test('a top-level run gauges only with two or more steps before wrap-up: the one-step case is excluded, the two-step case allowed', () => {
  const premise = read(STEPS_AND_GATES);
  assert.match(premise, /\| Single step \| Resume from that step onward \|/, 'the premise moved: a single step argument no longer resumes onward');
  assert.match(premise, /\| Multiple steps \(comma-separated\) \| Run exactly those steps \|/, 'the premise moved: a comma list no longer runs exactly those steps');
  const item = stepFourItem();
  assert.match(item, /gauges only when two or more steps remain before `wrap-up`/);
  assert.match(item, /a single step resumes from that step onward/);
  // Final review fix: the two-step rule is the top-level one; a dispatched call gauges with
  // one step left, because its template's stop sentence holds a one-entry `test` to `test`.
  assert.match(item, /A top-level single-spec run gauges only when two or more steps remain before `wrap-up`/);
  assert.match(item, /A dispatched call gauges with any step left, even one: its continuation template's "Stop after the test gate" sentence holds a one-entry `test` list to exactly `test`/);
  const bullet = region(read(HANDOFF), '- **Never `wrap-up` from a top-level run.**', '\n', 'top-level wrap-up bullet');
  assert.match(bullet, /A top-level single-spec run gauges only when two or more steps remain before `wrap-up`/);
  assert.match(bullet, /A multi-spec run has no such floor, because a one-entry per-record list runs exactly its step/);
  assert.match(bullet, /one step left before `wrap-up`[^.]*does not gauge/);
  assert.match(bullet, /two or more[^.]*always a comma list/);
  assert.match(bullet, /a single step resumes from that step onward/);
});

test('flow/SKILL.md stays under RAIL_BYTES with the cap-check item', () => {
  const bytes = Buffer.byteLength(read(FLOW), 'utf8');
  assert.ok(bytes < RAIL_BYTES, `${FLOW} is ${bytes} B, rail ${RAIL_BYTES} B`);
});
