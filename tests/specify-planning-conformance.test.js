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

const beforeFirstSection = (text) => {
  const at = text.indexOf('\n## Which records are planned\n');
  assert.notEqual(at, -1, 'heading not found: ## Which records are planned');
  return text.slice(0, at);
};
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
    f('`{"valid": true}` (exit 0) keeps that line: skip steps 3-8, remove the checkout, and carry the line into the write'),
    f('Any other verdict or exit re-plans'),
  ], 'reuse');
});

test('Plan Review Clarification: a held record re-reviews its reused plan before ready', () => {
  pinned(sectionOf(planning(), '## Which records are planned'), [
    f('**A held record re-reviews its reused plan.**'),
    f('a valid check still keeps the plan, but skips only steps 3-4'),
    f('plan-store.js" read --record {n} --commit {commit} --out "{checkout}"'),
    f('then run steps 5-9 on it, so its questions are asked again, or held again when headless, before `ready` is stamped'),
    f('A failed read re-plans.'),
    f('says it carries `needs:decision`, or says its newest unresolved decision comment from a trusted author carries `Held-by: specify-planning`'),
    f('Either signal alone marks the record held'),
    f('a hold cleared by removing the label by hand leaves the comment, and its held questions must still be folded in before `ready`'),
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
    f('Exit 3 is the no-ref outcome: keep every decision line, write no `Plan:` line (removing any `Plan:` line already in `{body}`), and record why'),
    f('above its first `##` heading, replacing any `Plan:` line already in `{body}`'),
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

test('review fixes: fetched labels, the stored Plan: line and the PLAN: path never reach a command line', () => {
  pinned(sectionOf(planning(), '## Which records are planned'), [
    f('Label names are fetched text, so they never go on the command line'),
    f('-- "{lane-file}" {n} "{body}" "{labels-file}"'),
    f('The line is record-body text, so it never goes on the command line'),
    f('plan-store.js" check --line-file "{plan-line-file}"'),
  ], 'untrusted text through files');
  assert.ok(!planning().includes('"{labels}"'), 'labels interpolated into a command');
  assert.ok(!planning().includes('--line "{plan-line}"'), 'Plan: line interpolated into a command');
  pinned(sectionOf(planning(), '## Planner prompt'), [
    f('The containment check compares real paths (symlinks followed, `..` normalized) and fails closed.'),
    f('anything but `inside` — a path that does not resolve included — is outside'),
  ], 'PLAN: containment');
});

test('review fix: a held record whose planning fails stays held, never ready', () => {
  pinned(sectionOf(planning(), '## Per-record step'), [
    f('**A held record\'s planning failure keeps it held.**'),
    f('it takes `## Hold` instead of the `off` write'),
    f('the captured hold comment\'s block copied verbatim'),
    f('`held — planning failed: {reason}`'),
  ], 'held planning failure');
});

test('review fix: the auto-mode contract registers the planning stop', () => {
  const contract = readText(path.join(ROOT, 'plugin/skills/_shared/auto-mode-contract.md'));
  assert.ok(contract.includes('`/specify` shaping mode\'s planning questions under `plan-at-specify: on` (`specify/planning.md`\'s Asking, #6056)'),
    'auto-mode-contract.md does not register specify planning as an exempt stop');
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
    f('fill the Audit residue line\'s placeholder from step 4\'s last audit JSON'),
    f('and fill it with `none` on a held re-review, which skips step 4 and has no audit JSON'),
    f('a row whose Class is none of the five is logged only, like a `low` row'),
  ], 'reviewer dispatch');
});

test('fix round 1: routing never drops a low needs-human row, answers like build, and auto alone is not headless', () => {
  pinned(sectionOf(planning(), '## Routing'), [
    f('**`low` and `info` rows** of the four amendment classes amend nothing'),
    f('a needs-human row is routed below at any severity, `low` and `info` included'),
    f('`auto` alone does not make a run headless'),
    f('a run in `auto` with a reachable human still asks, because these questions are build\'s plan-review needs-human gate moved to specify time'),
    f('handled as `build/plan-review-asked-classes.md`\'s Routing step 2 handles it'),
    f('definition of a recorded decision, under which `Decided by the user at plan review:` lines'),
    f('(this file\'s, never `/build`\'s). That handling includes the `risk-flags.js add` and `Proof({slug}):` amendment when the answered row is class (b) and its category is not yet flagged'),
  ], 'routing fixes');
  pinned(sectionOf(planning(), '## Per-record step'), [
    f('settled lines, decided lines, intent-resolvable clarification lines or flag additions'),
  ], 'step 7 trigger');
});

test('go-red: a change made only in plan-review.md is reported', () => {
  const rb = reviewBlock();
  const edited = rb.replace('Find five classes of problem, and only these:', 'Find six classes of problem, and only these:');
  assert.notEqual(edited, rb);
  assert.ok(briefProblems(edited, planningBrief()).includes('shared list incomplete'));
  const fromLine = BRIEF_DIFFERENCES[0].from;
  const gone = rb.replace(fromLine, '- Spec: elsewhere');
  assert.notEqual(gone, rb);
  assert.ok(briefProblems(gone, planningBrief()).includes(`difference not applied: ${fromLine}`));
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

// The held-questions contract #6059 reads: the hold comment's writer (planning.md) and this reader share these strings.
const HELD_QUESTIONS = {
  heldBy: 'Held-by: specify-planning',
  start: '<!-- held-questions:start -->',
  end: '<!-- held-questions:end -->',
  question: '- Question: ',
  option: '  Option: ',
  recommended: '  Recommended: ',
};

function parseHeldQuestions(comment) {
  const lines = comment.split('\n');
  const s = lines.indexOf(HELD_QUESTIONS.start);
  const e = lines.indexOf(HELD_QUESTIONS.end);
  const bad = () => new Error('held-questions block malformed');
  if (s === -1 || e === -1 || e < s) throw bad();
  const heldBy = s > 0 && lines[s - 1] === HELD_QUESTIONS.heldBy;
  const questions = [];
  let cur = null;
  const close = () => {
    if (!cur) return;
    if (cur.options.length !== 2 || cur.recommended === null || cur.recommended !== cur.options[0]) throw bad();
    questions.push(cur);
  };
  for (const line of lines.slice(s + 1, e)) {
    if (line.startsWith(HELD_QUESTIONS.question)) {
      close();
      cur = { text: line.slice(HELD_QUESTIONS.question.length), options: [], recommended: null };
    } else if (cur && line.startsWith(HELD_QUESTIONS.option)) cur.options.push(line.slice(HELD_QUESTIONS.option.length));
    else if (cur && line.startsWith(HELD_QUESTIONS.recommended)) {
      if (cur.recommended !== null) throw bad();
      cur.recommended = line.slice(HELD_QUESTIONS.recommended.length);
    } else throw bad();
  }
  close();
  if (questions.length === 0) throw bad();
  return { heldBy, questions };
}

const filledHold = () => fenceAfter(planning(), '## Hold')
  .replace('{question text}', 'Which file carries the pointer')
  .replace(/\{recommended reading\}/g, 'docs/hooks.md')
  .replace('{other reading}', 'plugin/skills/dispatch/task-prompt.md')
  .replace(/\{n\}/g, '42').replace(/\{k\}/g, '1');

test('Deliverable 8: the hold template and the schema carry the same contract strings (writer and reader)', () => {
  const template = fenceAfter(planning(), '## Hold');
  const text = planning();
  const from = text.indexOf('\n### Held-questions schema\n');
  assert.notEqual(from, -1, 'schema heading not found');
  const next = text.indexOf('\n## ', from + 1);
  const schema = text.slice(from, next === -1 ? undefined : next);
  for (const value of Object.values(HELD_QUESTIONS)) {
    assert.ok(template.includes(value), `template lacks ${JSON.stringify(value)}`);
    assert.ok(schema.includes('`' + value + '`'), `schema lacks \`${value}\``);
  }
  assert.deepEqual(parseHeldQuestions(filledHold()), {
    heldBy: true,
    questions: [{
      text: 'Which file carries the pointer',
      options: ['docs/hooks.md', 'plugin/skills/dispatch/task-prompt.md'],
      recommended: 'docs/hooks.md',
    }],
  });
});

test('Deliverable 8: the hold comment is the canonical decision comment, unit specify, Command re-shapes the record', () => {
  pinned(fenceAfter(planning(), '## Hold'), [
    f('<!-- needs-decision: specify -->'),
    f('## Decision needed'),
    f('**Proposed:**'),
    f('**Why:**'),
    f('**Command:** `/claude-tweaks:specify #{n}`'),
  ], 'hold template');
});

test('go-red: a template without the Held-by line is read as no hold', () => {
  const filled = filledHold();
  const noHeld = filled.replace('Held-by: specify-planning\n', '');
  assert.notEqual(noHeld, filled);
  assert.equal(parseHeldQuestions(noHeld).heldBy, false);
  const noOption = filled.replace('  Option: plugin/skills/dispatch/task-prompt.md\n', '');
  assert.notEqual(noOption, filled);
  assert.throws(() => parseHeldQuestions(noOption), /held-questions block malformed/);
  assert.throws(() => parseHeldQuestions(filled.replace(HELD_QUESTIONS.end, '')), /held-questions block malformed/);
  const wrongRec = filled.replace('  Recommended: docs/hooks.md', '  Recommended: plugin/skills/dispatch/task-prompt.md');
  assert.notEqual(wrongRec, filled);
  assert.throws(() => parseHeldQuestions(wrongRec), /held-questions block malformed/);
  const emptyBlock = filled.replace(/- Question:[\s\S]*?(?=<!-- held-questions:end)/, '');
  assert.notEqual(emptyBlock, filled);
  assert.throws(() => parseHeldQuestions(emptyBlock), /held-questions block malformed/);
});

test('AC3.2 + AC4.1 + Deliverable 4: a hold writes the body and plan, drops ready and adds needs:decision without removing it in the same call', () => {
  // sectionOf would stop at the template's own "## Decision needed" line, so slice to the next real section.
  const text = planning();
  const hold = text.slice(text.indexOf('\n## Hold\n'), text.indexOf('\n## Batches\n'));
  pinned(hold, [
    f('is left without `ready`'),
    f('omit `--add-label ready`, add `--remove-label ready` when the record carries it, add `--add-label "needs:decision"`'),
    f('omit `--remove-label "needs:decision"`'),
    f('with its settled lines, its decided lines and its plan stored'),
    f('Every value is one line: a newline inside reviewer text becomes a space.'),
    f('`failed — hold comment not posted ({reason}); re-run /claude-tweaks:specify #{n}`, because `shaping-mode-stamping.md`\'s `needs:*` bullet clears the label a failed post leaves behind'),
    f('A hold entered via bare drain keeps the `shaped:headless` stamp: add `--add-label "shaped:headless"` to the same call'),
  ], 'hold');
});

test('Deliverable 3 + 10: a batch defers writes, fans planners and reviewers out, asks once, and holds per record', () => {
  pinned(sectionOf(planning(), '## Batches'), [
    f('defers every record\'s write'),
    f('with the planners dispatched in one message'),
    f('with the reviewers dispatched in one message'),
    f('one batch table and the chunked questions covering every record\'s asked rows together'),
    f('A hold is per record; the rest of the batch proceeds.'),
    f('run the lane predicate per record, then the reuse check per record (`## Which records are planned`)'),
    f('a record with a valid stored plan skips the planner fan-out, and a held one has its stored plan fetched (`## Which records are planned`) and joins the reviewer fan-out'),
    f('`SKILL.md`\'s "a loop never a fan-out" still governs the record writes'),
  ], 'batches');
});

test('AC2.1 + AC5.1: read-back asserts the Plan: line or the hold, and the outcome words', () => {
  pinned(sectionOf(planning(), '## Read-back and outcome'), [
    f('exactly one `Plan:` line, equal to the `line` `plan-store.js write` printed, or to the kept line when a valid stored plan was reused without a write; a record planned with the no-ref outcome (exit 3 or any other non-zero exit, per step 8) carries no `Plan:` line'),
    f('The re-fetched body carries `## Overview` and `## Planning Decisions`, and exactly one `Plan:` line equal to the `line` `plan-store.js write` printed, except that it carries no `Plan:` line when `plan-store.js` took the no-ref outcome (exit 3 or any other non-zero exit, per step 8)'),
    f('in place of that file\'s `ready`-present and no-`needs:*` assertions (its scoring-label assertions still apply)'),
    f('`held — needs:decision ({k} planning question(s))`'),
    f('the hold comment is posted before this read-back runs'),
    f('`gh issue view {n} --json labels,body,comments`'),
    f('A held record is never in a `/claude-tweaks:flow` command'),
    f('bare drain\'s Release reason stays `shaped: #{n}`'),
    f('**Not planned:** no `Plan:` line was written this pass.'),
  ], 'read-back');
});

test('Deliverable 8: work-record.md names specify as a decision-comment writer and unit', () => {
  const wr = readText(path.join(ROOT, 'plugin/skills/_shared/work-record.md'));
  const from = wr.indexOf('\n### Decision-comment template\n');
  assert.notEqual(from, -1, 'template heading not found');
  pinned(wr.slice(from, wr.indexOf('\n**Resolution rule.**', from)), [
    f('`tidy/decision-markers.md`, `specify/planning.md`\'s `## Hold`) rather'),
    f('(`backlog-refine`, `backlog-grant`, `tidy`, `specify`)'),
  ], 'work-record decision template');
});

test('planning.md headings appear in order', () => {
  const text = planning();
  const heads = ['## Which records are planned', '## Per-record step', '## Planner prompt', '## Reviewer dispatch',
    '## Routing', '## Hold', '## Batches', '## Decomposition', '## Read-back and outcome'];
  const at = heads.map((h) => text.indexOf(`\n${h}\n`));
  assert.ok(at.every((i) => i !== -1), `missing heading: ${heads.filter((h, i) => at[i] === -1)}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test('Ruling A + B: Routing keeps the plan-review answered forms, limits the substitution, and scopes the failed add to unanswered rows', () => {
  pinned(sectionOf(planning(), '## Routing'), [
    f('`Decided by the user at plan review:` lines, `Decided by the user at planning:` lines, `**Decision**` paragraphs and Closed rules all count as recorded decisions'),
    f('the substitution applies only to the line this step writes (`Decided by the user at planning:`) and to its log entries (this file\'s, never `/build`\'s)'),
    f('An unanswered class (b) row whose category `{body}` does not flag first gets'),
    f('a failed `add` on an answered row asks nothing'),
  ], 'routing rulings');
});

// AC1: under plan-at-specify: off, shaping mode is unchanged. Every planning sentence in the three
// shaping files sits inside one marker block whose instruction is the gate; nothing outside the
// blocks, and nothing in any other specify file but planning.md, names the planning step.
const SHAPING_FILES = {
  'plugin/skills/specify/shaping-mode.md': ['Under `work-backend: github-issues` only, resolve `plan-at-specify`', 'Any other backend, any other output, or a failed call skips every `plan-at-specify` block and shaping runs as written.'],
  'plugin/skills/specify/shaping-mode-stamping.md': ['When `shaping-mode.md`\'s Planning at specify paragraph read `planning.md`', 'Otherwise skip this paragraph.'],
  'plugin/skills/specify/shaping-mode-readback.md': ['When `shaping-mode.md`\'s Planning at specify paragraph read `planning.md`', 'Otherwise skip this paragraph.'],
};
const DECOMPOSITION_FILES = {
  'plugin/skills/specify/decomposition-mode-closeout.md': ['Under `work-backend: github-issues` only, resolve `plan-at-specify` once', 'Any other backend, any other output, or a failed call skips this paragraph and decomposition runs as written.'],
};
const GATE_START = '<!-- plan-at-specify:start -->';
const GATE_END = '<!-- plan-at-specify:end -->';
const PLANNING_TOKENS = ['plan-at-specify', 'planning.md', 'plan-store', 'Planning Decisions', 'Plan: '];
const collapse = (s) => s.replace(/\s+/g, ' ');

function gateProblems(text, gatePhrases) {
  const s = text.indexOf(GATE_START);
  const e = text.indexOf(GATE_END);
  if (s === -1 || e === -1 || e < s || text.indexOf(GATE_START, s + 1) !== -1 || text.indexOf(GATE_END, e + 1) !== -1) return ['block count'];
  const block = text.slice(s, e + GATE_END.length);
  const outside = text.slice(0, s) + text.slice(e + GATE_END.length);
  const problems = [];
  for (const t of PLANNING_TOKENS) if (outside.includes(t)) problems.push(`leak: ${t}`);
  const flat = collapse(block);
  for (const p of gatePhrases) if (!flat.includes(collapse(p))) problems.push(`gate: ${p}`);
  return problems;
}
const shapingText = (rel) => readText(path.join(ROOT, rel));
const blockOf = (rel) => {
  const t = shapingText(rel);
  return t.slice(t.indexOf(GATE_START), t.indexOf(GATE_END) + GATE_END.length);
};

test('AC1.1: each shaping file holds one gated plan-at-specify block and no planning text outside it', () => {
  for (const [rel, phrases] of Object.entries(SHAPING_FILES)) {
    assert.deepEqual(gateProblems(shapingText(rel), phrases), [], rel);
  }
});

test('AC1.1: each decomposition file holds one gated plan-at-specify block and no planning text outside it', () => {
  for (const [rel, phrases] of Object.entries(DECOMPOSITION_FILES)) {
    assert.deepEqual(gateProblems(shapingText(rel), phrases), [], rel);
  }
});

test('AC1.1: no other specify file except planning.md names the planning step', () => {
  const fs = require('node:fs');
  const dir = path.join(ROOT, 'plugin/skills/specify');
  const files = [];
  (function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.md')) files.push(p);
    }
  })(dir);
  assert.ok(files.length > 20, `directory walk found ${files.length} files`);
  const skip = new Set([...Object.keys(SHAPING_FILES), ...Object.keys(DECOMPOSITION_FILES), PLANNING_REL].map((r) => path.join(ROOT, r)));
  for (const p of files) {
    if (skip.has(p)) continue;
    const text = readText(p);
    for (const t of PLANNING_TOKENS) assert.ok(!text.includes(t), `${path.relative(ROOT, p)} names ${t}`);
  }
});

test('go-red: the gate checks report a leak, a missing marker and a missing gate phrase', () => {
  const stamp = 'plugin/skills/specify/shaping-mode-stamping.md';
  const text = shapingText(stamp);
  const leaked = text + '\nread planning.md now\n';
  assert.notEqual(leaked, text);
  assert.ok(gateProblems(leaked, SHAPING_FILES[stamp]).includes('leak: planning.md'));
  const noEnd = text.replace(GATE_END, '');
  assert.notEqual(noEnd, text);
  assert.ok(gateProblems(noEnd, SHAPING_FILES[stamp]).includes('block count'));
  const noGate = text.replace('Otherwise skip this paragraph.', '');
  assert.notEqual(noGate, text);
  assert.ok(gateProblems(noGate, SHAPING_FILES[stamp]).includes('gate: Otherwise skip this paragraph.'));
});

test('the pointer blocks sit where they run', () => {
  const at = (t, s, from = 0) => { const i = t.indexOf(s, from); assert.notEqual(i, -1, `not found: ${s}`); return i; };
  const stamping = shapingText('plugin/skills/specify/shaping-mode-stamping.md');
  const sb = at(stamping, GATE_START);
  const gh = at(stamping, '**`work-backend: github-issues`:**');
  assert.ok(sb > gh && sb < at(stamping, '```bash', gh), 'stamping block position');
  const readback = shapingText('plugin/skills/specify/shaping-mode-readback.md');
  const rb = at(readback, GATE_START);
  assert.ok(rb > at(readback, '### Read-back verification') && rb < at(readback, 'Assert, against the re-fetched result:'), 'readback block position');
  const shaping = shapingText('plugin/skills/specify/shaping-mode.md');
  const mb = at(shaping, GATE_START);
  const par = at(shaping, '> **Parallel execution:**');
  assert.ok(mb > par && mb < at(shaping, '\n---\n', par), 'shaping-mode block position');
});

test('Deliverable 3: a planned record\'s check and write read its own body file, not the shared one', () => {
  pinned(blockOf('plugin/skills/specify/shaping-mode-stamping.md'), [
    f('the `--check` and the write\'s `--body-file` below read its `{body}` in place of `$SPECIFY_SHAPED_BODY`'),
    f('(in a batch, that record\'s own copy)'),
  ], 'stamping block');
});

test('Deliverable 9: the shaping-mode block resolves the key once, read-only of --run, and relays the conflict warning', () => {
  pinned(blockOf('plugin/skills/specify/shaping-mode.md'), [
    f('Under `work-backend: github-issues` only, resolve `plan-at-specify` once per invocation, before the first record'),
    f('Only when it prints `on`, read `planning.md`'),
    f('plus a per-record hold-state capture before `shaping-mode-stamping.md`\'s `needs:*` bullet'),
    f('resolve-policy.js" --values plan-at-specify'),
    f('Relay a stderr warning the call prints'),
  ], 'shaping-mode block');
});

test('Carry A: planning captures the hold state with its own call before the needs:* resolve', () => {
  pinned(sectionOf(planning(), '## Which records are planned'), [
    f('**Capture the hold state per record, before the `needs:*` bullet runs.**'),
    f('for each record, before that bullet runs, make one call: `gh issue view {n} --json labels,comments`'),
    f('whether the record carries `needs:decision`, and whether the newest unresolved decision comment from a trusted author (selected by the same trusted-author and unresolved rule as that bullet\'s queries) has a body carrying `Held-by: specify-planning`'),
    f('The held re-review above uses these captured facts, never a re-fetch after the resolve.'),
    f('A failed capture call counts as held for the reuse decision: a valid stored plan is still fetched and re-reviewed (steps 5-9) as the held re-review above says'),
    f('a record that was not actually held gets one extra review, and a failed `plan-store.js read` still re-plans.'),
    f('Keep two facts from it, either of which alone marks the record held'),
    f('or, when `gh` is absent, `issue_read` (`get` mode for the labels, `get_comments` mode for the comments, `perPage: 100`, per `_shared/github-write-transport.md`\'s mapping)'),
    f('When the record\'s captured hold state (below) says it carries `needs:decision`'),
  ], 'held read order');
});

test('Carry B: a bare-drain hold also asserts shaped:headless at read-back', () => {
  pinned(sectionOf(planning(), '## Read-back and outcome'), [
    f('hold entered via bare drain also carries `shaped:headless`, which `## Hold` stamps and that file\'s first bullet still asserts'),
  ], 'held headless');
});

test('Fix 2: the readback block replaces only the ready-present and no-needs:* assertions for a held record', () => {
  pinned(blockOf('plugin/skills/specify/shaping-mode-readback.md'), [
    f('for a held record its assertions replace only the `ready`-present assertion in the first bullet below and the no-`needs:*` bullet (the first bullet\'s scoring-label and `shaped:headless` assertions still apply)'),
  ], 'readback block');
});

const decomposition = () => sectionOf(planning(), '## Decomposition');

test('Deliverable 6: the decomposition entry takes N sub-issues, never a parent, and returns one outcome each', () => {
  pinned(decomposition(), [
    f('Called by `decomposition-mode-closeout.md`\'s `plan-at-specify` paragraph, in specify\'s own session'),
    f('never inside `mechanical-handoff.md`\'s subagent'),
    f('every non-parent sub-issue Step 3 created this run'),
    f('A sub-issue Step 3 resumed rather than created is not planned this pass'),
    f('A sub-issue Step 5 left with a staged finding is planned too'),
    f('a record carrying the `parent-issue` label is never planned and gets no outcome row'),
    f('`planned`'), f('`held`'), f('`no-ref`'),
    f('A sub-issue a plan-less lane took is `skipped`, Detail `{lane} lane ({reason})`'),
  ], 'decomposition entry');
});

test('Task 1 fix 2: a failed body write is skipped, and a failed label call or comment post takes ## Hold\'s failed row', () => {
  pinned(decomposition(), [
    f('A failed body write is `skipped`, Detail `write failed: {reason}`'),
    f('a held sub-issue whose comment post fails takes `## Hold`\'s `failed — hold comment not posted ({reason}); re-run /claude-tweaks:specify #{n}` row'),
    f('A failed label call takes the same row'),
  ], 'decomposition write failures');
});

test('Task 1 fix 3: a skipped sub-issue is written only to remove a Plan: line', () => {
  pinned(decomposition(), [
    f('A `skipped` sub-issue is written only to remove a `Plan:` line, otherwise not at all'),
  ], 'decomposition skipped write');
});

test('Task 1 fix 4: decomposition read-back drops the Held bullet\'s shaped:headless assertion', () => {
  pinned(decomposition(), [
    f('without the Held bullet\'s `shaped:headless` assertion, since decomposition never stamps it'),
  ], 'decomposition read-back');
});

test('AC3.1 + Deliverable 7: each body is re-fetched from the forge after Step 6, so red-team edits are what the reviewer reads', () => {
  pinned(decomposition(), [
    f('re-fetch each sub-issue\'s body and labels from the forge'),
    f('after Step 6, or after the handoff returns'),
    f('so Step 5\'s red-team edits are in the body the planner and reviewer read'),
  ], 'decomposition body');
});

test('Deliverable 1: planners and reviewers fan out per ## Batches, with one question batch for every sub-issue', () => {
  pinned(decomposition(), [
    f('as `## Batches` runs them'),
    f('one batch table and one set of chunked questions covering every sub-issue'),
  ], 'decomposition fan-out');
});

test('Deliverable 2: one more body write, then the hold label edit as a separate call; a held sibling holds no dependent; ready is never added', () => {
  pinned(decomposition(), [
    f('one more body write per sub-issue'),
    f('`gh issue edit {n} --body-file "{body}"`'),
    f('then, as a separate call after it lands'),
    f('`--remove-label ready --add-label "needs:decision"`'),
    f('A held sibling does not hold the sub-issues that depend on it'),
    f('Planning never adds `ready`'),
  ], 'decomposition write');
});

test('Deliverable 9: headless decomposition asks nothing and holds', () => {
  pinned(decomposition(), [
    f('With no human reachable (`/sweep`\'s specify drain, a Routine)'),
    f('the question batch is not asked'),
  ], 'decomposition headless');
});

test('AC2.1 + Deliverable 4: the outcomes map to Step 9\'s ### Planning table', () => {
  pinned(decomposition(), [
    f('`### Planning`'),
    f('| Record | Outcome | Detail |'),
    f('A planning failure is `skipped`'),
  ], 'decomposition outcomes');
});

test('AC4.1: the closeout block runs after Step 6, before Step 7, and a delegated subagent skips it', () => {
  const rel = 'plugin/skills/specify/decomposition-mode-closeout.md';
  const text = shapingText(rel);
  const b = text.indexOf(GATE_START);
  assert.ok(b > text.indexOf('## Step 6: Record Self-Review') && b < text.indexOf('## Step 7:'), 'closeout block position');
  pinned(blockOf(rel), [
    f('Only when it prints `on`, and only in specify\'s own session'),
    f('run its `## Decomposition` entry now, before Step 7'),
    f('A subagent whose dispatch prompt says its caller plans skips this paragraph'),
    f('Step 9\'s summary then carries the `### Planning` section'),
    f('resolve-policy.js" --values plan-at-specify'),
  ], 'closeout block');
});
