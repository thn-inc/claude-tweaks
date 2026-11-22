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

test('Review finding 1: residual checkE/checkF items go to the reviewer, and an audit with no JSON line fails planning', () => {
  pinned(sectionOf(planning(), '## Per-record step'), [
    f('or an audit that prints no JSON line, means planning failed'),
    f('`checkE` and `checkF` always report `ok: true`'),
    f('pass them to the reviewer in step 5 and name them in the Actions Performed Detail'),
  ], 'audit residue');
});

test('Review finding 3: the lane path and the planning-failed path remove an existing Plan: line', () => {
  pinned(sectionOf(planning(), '## Which records are planned'), [
    f('any `Plan:` line already in `{body}` is removed before the write, whether or not the composition kept it'),
  ], 'lane path removes Plan:');
  pinned(sectionOf(planning(), '## Per-record step'), [
    f('write no `Plan:` line and remove any `Plan:` line already in `{body}`'),
  ], 'failed path removes Plan:');
});

test('Review finding 4: the fallback rules are pinned', () => {
  pinned(sectionOf(planning(), '## Per-record step'), [
    f('drop this pass\'s settled and decided lines'),
    f('and let the record be written as it would be under `off`'),
    f('A planning failure never fails the record and never stops a batch.'),
    f('Any other non-zero exit takes the same fallback.'),
  ], 'planning failed and store fallback');
  pinned(sectionOf(planning(), '## Planner prompt'), [
    f('`NEEDS_CONTEXT` re-dispatches once with the context it names.'),
    f('`BLOCKED`, no status line, no `PLAN:` line, or a `PLAN:` path outside `{checkout}`, after that one re-dispatch, means planning failed.'),
    f('followed by the decisions table (finding, class, decision) when routing produced one, and, when step 4 sent one, the audit\'s JSON line.'),
  ], 'reply rules and amend table');
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

// The reviewer brief mirrors build/plan-review.md's Dispatch prompt (#6056 Gotchas): every shared
// line is listed and pinned byte-equal, and every intentional difference is named with its reason.
const REVIEW_PATH = path.join(ROOT, 'plugin', 'skills', 'build', 'plan-review.md');
const BRIEF_DIFFERENCES = [
  { why: 'the spec is the composed record body in a session-tmp file, not a materialized work/ file',
    from: "- Spec: {absolute path to the worktree's work/{n}-spec.md}",
    to: '- Spec: {absolute path to the composed record body}' },
  { why: 'the repository the reviewer may read is the read-only checkout of origin/{integration-branch}',
    from: 'You may also read any file in the repository at {absolute worktree root}, read-only, to check what the plan integrates with. Do not create, modify, or delete any file; run no test suite, build, or server; make no git or gh call that writes.',
    to: 'You may also read any file in the repository at {absolute path to the read-only checkout}, read-only, to check what the plan integrates with. Do not create, modify, or delete any file; run no test suite, build, or server; make no git or gh call that writes.' },
  { why: 'the table carries a Recommended reading column (spec Deliverable 2.5)',
    from: '| Severity | Class | Resolution | Path:Line | Finding | Evidence | Suggested resolution |',
    to: '| Severity | Class | Resolution | Recommended reading | Path:Line | Finding | Evidence | Suggested resolution |' },
  { why: 'the separator row gains the column', from: '|---|---|---|---|---|---|---|', to: '|---|---|---|---|---|---|---|---|' },
  { why: 'example row 1 gains the column',
    from: '| high | spec gap | intent-resolvable | work/42-spec.md:31 | Retry count on a 429 is unset | Spec: "Retries follow the existing gh policy." | Add: "A 429 retries per _shared/github-rate-limit.md." |',
    to: '| high | spec gap | intent-resolvable | — | work/42-spec.md:31 | Retry count on a 429 is unset | Spec: "Retries follow the existing gh policy." | Add: "A 429 retries per _shared/github-rate-limit.md." |' },
  { why: 'example row 2 gains the column',
    from: '| medium | cross-task contract | — | docs/superpowers/plans/{plan}.md:120 | Task 2 returns `{ok, value}`; Task 5 reads `.result` | Task 2 Interfaces vs Task 5 Step 3 | Task 5 reads `.value` |',
    to: '| medium | cross-task contract | — | — | docs/superpowers/plans/{plan}.md:120 | Task 2 returns `{ok, value}`; Task 5 reads `.result` | Task 2 Interfaces vs Task 5 Step 3 | Task 5 reads `.value` |' },
];
const BRIEF_INSERTIONS = [
  { why: 'a needs-human row names the reading the reviewer recommends (spec Deliverable 2.5)',
    after: 'On a needs-human row, Suggested resolution names both defensible readings: "Reading A: … / Reading B: …" (for a criterion change, Reading A keeps the criterion as written).',
    line: 'On a needs-human row, set Recommended reading to "Reading A" or "Reading B": the one that keeps every Acceptance Criterion and recorded decision and sits closer to the spec\'s stated intent, or "Reading A" when neither keeps them all. Write "—" in Recommended reading on every other row.' },
  { why: "step 4 passes plan-audit's surviving Check E/F items to the reviewer (planning.md Per-record step)",
    after: '- Plan: {absolute path to the plan file}',
    line: '- Audit residue: {the uncovered acceptance clauses and unlisted spec paths plan-audit.js still reports, one per line, or "none"} — treat each as a candidate finding.' },
];
// Every other non-blank line of plan-review.md's block, copied verbatim, in order.
const BRIEF_SHARED_LINES = [
  "[Use: Capable]",
  "{effortLine}",
  "Task: review one implementation plan against its spec, once, before any task is built. Read-only.",
  "Read:",
  "- Plan: {absolute path to the plan file}",
  "Find five classes of problem, and only these:",
  "- spec gap — the spec does not decide something the plan must decide (a value, a rule, a precedence, what happens on failure).",
  "- undecided behaviour — an input class, failure mode, or UI state no task covers. If covering it needs a product decision the spec does not make, report it as a spec gap instead.",
  "- cross-task contract — one task produces something another consumes (a name, a shape, an order, a file, a flag) and the two disagree or the producer is missing, or a task disagrees with the spec about it.",
  "- missing-review-risk (#3378) — a task whose own text touches concurrency (locks, queues, async ordering, retries, transactions, shared mutable state), decision logic (branching on computed state such as permissions, eligibility, pricing, or ranking), or rendering-heavy UI (many states, layout, animation), but carries no `**Review risk:** high` line. Evidence names the signal: \"touches {signal} without `Review risk: high`\".",
  "- mischaracterized-role (#3378) — a task marked `**Role:** transcription` whose own plan text does not already contain the complete code to write (a signature-plus-tests task, or one left for the implementer to derive, is `integration`, not `transcription` — `build/plan-authoring-checks.md`'s Per-task role/review-risk markers paragraph). Evidence quotes the task's own Step 1/Step 3 text showing the gap.",
  "Do not repeat SDD's pre-flight conflict table. That scan runs later and already checks plan-internal contradictions — a task against the plan's Global Constraints, or a step the plan mandates that the review rubric forbids (example: Global Constraints say \"no new dependencies\" and Task 4 adds one). Your cross-task class is producer/consumer agreement between tasks, and each task against the spec (example: Task 2 returns `{ok, value}` and Task 5 reads `.result`).",
  "For every spec-gap row, set Resolution:",
  "- intent-resolvable — only when you can quote a spec sentence that settles it; put that sentence in Evidence. No quotable sentence means needs-human.",
  "- needs-human — whenever settling it would alter or loosen an existing Acceptance Criterion or an observable contract, or it has two defensible readings.",
  "Write \"—\" in Resolution on every other row.",
  "On a needs-human row, Suggested resolution names both defensible readings: \"Reading A: … / Reading B: …\" (for a criterion change, Reading A keeps the criterion as written).",
  "OUTPUT FORMAT (required):",
  "Return ONLY a markdown table, no preamble:",
  "Class: spec gap / undecided behaviour / cross-task contract / missing-review-risk / mischaracterized-role",
  "Severity scale: critical / high / medium / low / info",
  "If no findings: return literal text \"No findings.\"",
  "Return at most 7 rows, needs-human rows first, then highest severity first; if more were found, append a final row reading \"+N more\" with the count in place of N — never omit this row when findings exceed the cap.",
  "Do not add narration, headers, or summaries before or after the table.",
  "End your reply with one line, its last non-empty line: STATUS: {DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED}",
];

// The first fenced block after the heading (as build-plan-review-conformance.test.js does).
function dispatchBlock(text, heading) {
  return fenceAfter(text, heading);
}

function toSpecifyBrief(reviewBlock) {
  const swap = new Map(BRIEF_DIFFERENCES.map((d) => [d.from, d.to]));
  const after = new Map(BRIEF_INSERTIONS.map((i) => [i.after, i.line]));
  const out = [];
  for (const l of reviewBlock.split('\n')) {
    out.push(swap.has(l) ? swap.get(l) : l);
    if (after.has(l)) out.push(after.get(l));
  }
  return out.join('\n');
}

function briefProblems(reviewBlock, planningBlock) {
  const problems = [];
  const froms = new Set(BRIEF_DIFFERENCES.map((d) => d.from));
  const lines = (s) => s.split('\n');
  const count = (s, line) => lines(s).filter((l) => l === line).length;
  const shared = lines(reviewBlock).filter((l) => l.trim() && !froms.has(l));
  if (JSON.stringify(shared) !== JSON.stringify(BRIEF_SHARED_LINES)) problems.push('shared list incomplete');
  for (const l of BRIEF_SHARED_LINES) if (count(planningBlock, l) !== 1) problems.push(`shared line missing: ${l}`);
  for (const d of BRIEF_DIFFERENCES) if (count(reviewBlock, d.from) !== 1) problems.push(`difference not applied: ${d.from}`);
  if (toSpecifyBrief(reviewBlock) !== planningBlock) problems.push('brief drifted');
  return problems;
}

const reviewBlock = () => dispatchBlock(readText(REVIEW_PATH), '## Dispatch prompt');
const planningBrief = () => dispatchBlock(planning(), '## Reviewer dispatch');

test('the reviewer brief equals plan-review.md\'s Dispatch prompt with only the named differences', () => {
  assert.deepEqual(briefProblems(reviewBlock(), planningBrief()), []);
  for (const d of [...BRIEF_DIFFERENCES, ...BRIEF_INSERTIONS]) assert.ok(d.why && d.why.trim(), 'difference without a why');
});

test('go-red: a shared line edited in planning.md only is reported', () => {
  const mutated = planningBrief().replace('Find five classes of problem, and only these:', 'Find six classes of problem, and only these:');
  assert.notEqual(mutated, planningBrief());
  const problems = briefProblems(reviewBlock(), mutated);
  assert.ok(problems.includes('shared line missing: Find five classes of problem, and only these:'), problems.join(' | '));
  assert.ok(problems.includes('brief drifted'));
});

test('go-red: an unnamed difference is reported', () => {
  const mutated = planningBrief().replace(/^Severity scale:.*$/m, (m) => `${m}x`);
  assert.notEqual(mutated, planningBrief());
  assert.ok(briefProblems(reviewBlock(), mutated).includes('brief drifted'));
});

test('the reviewer is dispatched as plan-review.md dispatches it', () => {
  pinned(sectionOf(planning(), '## Reviewer dispatch'), [
    f('`isolation: "worktree"`'),
    f('never `fork`'),
    f('`resolve-profile.js capable`'),
    f('A table whose header lacks the Recommended reading column is unusable.'),
    f('`{audit residue}` is filled from step 4\'s last audit JSON'),
  ], 'reviewer dispatch');
});

test('AC2.2 + AC3.1 + AC4.1: routing settles detail rows silently, asks each asked row once, and asks nothing headless', () => {
  pinned(sectionOf(planning(), '## Routing'), [
    f('a `Settled at planning:` line, never asked, in every posture'),
    f('Each question is asked once.'),
    f('the recommended reading first, labelled `(Recommended)`, then the other reading, then `Leave for later`'),
    f('at most four questions per call, one call per message'),
    f('columns `Record`, `Finding`, `Class`, `Recommended reading`'),
    f('it is asked, or held when headless'),
    f('as `shaping-mode-stamping.md`\'s `### Risk flags` step 2 defines it'),
    f('a headless run asks nothing and takes `## Hold` for every asked row'),
    f('risk-flags.js" add --body-file "{body}" --add {slug}'),
  ], 'routing');
});

test('AC2.1: a planned record always carries ## Planning Decisions', () => {
  pinned(sectionOf(planning(), '## Routing'), [
    f('A planned record always carries the section'),
    f('`No planning questions arose.`'),
  ], 'planning decisions section');
});

test('the reviewer and planner fences are self-contained', () => {
  const body = planningBrief();
  for (const t of ['SKILL.md', ' above', ' below']) assert.ok(!body.includes(t), `reviewer fence contains ${t}`);
});

test('Review finding B: step 7 fails planning on a failing check or an audit with no JSON line, and keeps residue', () => {
  pinned(sectionOf(planning(), '## Per-record step'), [
    f('a failing check, or an audit that prints no JSON line, here means planning failed'),
    f('residual `checkE.uncovered` or `checkF.unlisted` items join the Actions Performed Detail'),
  ], 'step 7 audit rule');
});
