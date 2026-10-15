'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #295 (closing #155) removed the "every group is a parallel Task agent that creates
// its own worktree" model from /claude-tweaks:dispatch Step 5: a Task-tool subagent is
// always launched cwd-pinned to the DISPATCHING session's worktree, so it can never get
// an independent one. The dispatching session now enters group N's worktree, dispatches
// group N's agent into that inherited cwd, waits for a terminal outcome, tears the
// worktree down, and only then enters group N+1's.
//
// The prose that actually executes is the literal Task() prompt inlined into every
// dispatched agent. A whole-branch review caught that prompt still saying "create your
// own worktree" — the exact instruction the fix exists to retire — while the surrounding
// narrative had already been rewritten. No test read skill prose, so nothing failed.
// This is that test: the forbidden phrasings below are the pre-fix wording, so an edit
// that reintroduces the retired model fails the suite instead of shipping a prompt that
// contradicts its own step.
//
// #296 later split the single Task() prompt into two sequential calls (build,test then
// review,polish,wrap-up) and extracted both templates out of SKILL.md into a sub-file,
// task-prompt.md, that SKILL.md's Step 5 now only stubs and points to ("read it and
// inline each call's content verbatim"). The anchoring assertions below moved with the
// content they check — reading only SKILL.md after that extraction would silently stop
// checking anything real, the same class of gap this file exists to prevent elsewhere.
//
// See CLAUDE.md's Don't: "Don't pass isolation: 'worktree' to the Agent tool when
// dispatching from inside a worktree already set up for the task ... Anchor to the
// existing path via the prompt."

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const SKILL = read('plugin', 'skills', 'dispatch', 'SKILL.md');
const SEQUENTIAL = read('plugin', 'skills', 'dispatch', 'sequential-execution.md');
const TASK_PROMPT = read('plugin', 'skills', 'dispatch', 'task-prompt.md');
const SETTLE = read('plugin', 'skills', 'dispatch', 'settle-and-merge.md');

// Scope the sweep to Step 5 rather than the whole SKILL.md: the retired model is a
// Step 5 claim, and a whole-file sweep would be at the mercy of unrelated prose
// elsewhere reusing the same vocabulary.
function step5Region(text) {
  const start = text.indexOf('### Step 5:');
  assert.notStrictEqual(start, -1, 'skills/dispatch/SKILL.md no longer has a "### Step 5:" heading — this guard has lost its anchor');
  const end = text.indexOf('\n### Step 6', start);
  return text.slice(start, end === -1 ? text.length : end);
}

// The two literal prompts handed to each group's two Task calls (#296) — the part of
// Step 5 that actually executes, and where the pre-fix instruction survived the rewrite
// once already. Each is checked independently: a whole-file (both-calls-concatenated)
// check would false-pass if only one call regressed while the other still had the
// correct wording.
function firstCallRegion(text) {
  const start = text.indexOf('## First call');
  assert.notStrictEqual(start, -1, 'skills/dispatch/task-prompt.md no longer has a "## First call" heading — this guard has lost its anchor');
  const end = text.indexOf('## Second call', start);
  assert.notStrictEqual(end, -1, 'skills/dispatch/task-prompt.md no longer has a "## Second call" heading — this guard has lost its anchor');
  return text.slice(start, end);
}

function secondCallRegion(text) {
  const start = text.indexOf('## Second call');
  assert.notStrictEqual(start, -1, 'skills/dispatch/task-prompt.md no longer has a "## Second call" heading — this guard has lost its anchor');
  const end = text.indexOf('None of Templates A/B/C', start);
  assert.notStrictEqual(end, -1, 'the second call is no longer followed by its template note — this guard has lost its anchor');
  return text.slice(start, end);
}

const CALL_REGIONS = [
  ['skills/dispatch/task-prompt.md (first call)', firstCallRegion(TASK_PROMPT)],
  ['skills/dispatch/task-prompt.md (second call)', secondCallRegion(TASK_PROMPT)],
];

const REGIONS = [
  ['skills/dispatch/SKILL.md (Step 5)', step5Region(SKILL)],
  ['skills/dispatch/sequential-execution.md', SEQUENTIAL],
  // Fourth recurrence, and the reason this file is scanned at all: settle-and-merge.md
  // narrates where Settle runs, and still said "each group's own Task agent" after the
  // #296 split — the exact singular the pattern below was added to catch, in a file the
  // sweep did not read. A guard that skips the file it is meant to guard is no guard.
  ['skills/dispatch/settle-and-merge.md', SETTLE],
  ...CALL_REGIONS,
];

// Each entry is one pre-fix phrasing. One test per pattern per region — a single test
// stacking every assertion short-circuits at the first failure and hides the rest.
const FORBIDDEN = [
  [
    /creat\w*\s+(?:your|its|their)\s+own\s+(?:fresh\s+)?worktree/i,
    'the dispatched agent inherits the dispatching session\'s worktree; it must never be told to create one of its own',
  ],
  [
    /with\s+its\s+own\s+worktree/i,
    'no group "becomes one Task agent with its own worktree" — a subagent cannot be given an independent worktree (#155)',
  ],
  [
    /do\s+not\s+pre-create/i,
    'pre-creation by the dispatching session IS the new mechanism — forbidding it is the literal negation of the fix',
  ],
  [
    /parallel\s+Task\s+agents?\b/i,
    'Step 5 dispatches Task agents sequentially, never in parallel; a "parallel Task agent" claim is the retired model',
  ],
  // Third recurrence of the same defect: #296 split each group into TWO Task calls,
  // but sequential-execution.md — reachable from Step 5's own banner, and never
  // touched by #296 — still narrated a single "group N's Task agent" with one
  // teardown point. The two prior recurrences were caught by review, not by a test.
  // Scoped to the possessive/deictic shapes that assert exactly one agent per group
  // ("group N's Task agent", "each group's own Task agent", "its Task agent"), so
  // kind-generic phrasing like "a Task-tool subagent" or "Task agents" stays legal.
  [
    /\b(?:group\s+N|each\s+group|the\s+group|that\s+group|this\s+group|its)\s*(?:'s|’s)?\s+(?:own\s+)?Task\s+agent\b/i,
    'a group is dispatched as TWO sequential Task calls (#296) — a singular "group\'s Task agent" with one terminal point is the retired one-call-per-group model',
  ],
];

for (const [name, region] of REGIONS) {
  for (const [pattern, why] of FORBIDDEN) {
    test(`${name}: does not reinstate ${pattern}`, () => {
      const hit = region.match(pattern);
      assert.ok(
        hit === null,
        `${name} matches ${pattern}${hit ? ` at "${hit[0]}"` : ''} — ${why}`,
      );
    });
  }
}

// Negative guards alone would also pass if the Working-directory instruction were simply
// deleted. These pin that the replacement is actually present and says the anchoring
// thing, so a deletion fails too. Checked per call region (#296): each of the two Task()
// calls carries its own Working-directory instruction, and a regression could drop it
// from either one independently.

for (const [name, region] of CALL_REGIONS) {
  test(`${name}: anchors the agent to the inherited worktree`, () => {
    assert.match(
      region,
      /Working directory:/,
      `${name} must still carry a Working directory instruction — agents only see what is in their prompt`,
    );
    // Anchored to the literal instruction, not the bare token: "inherited"/"inherits"
    // survive elsewhere in both regions, so /inherit/i would still pass with the
    // actual "you inherit it" instruction deleted.
    assert.match(
      region,
      /you\s+inherit\s+it/i,
      `${name} must tell the agent it INHERITS the dispatching session's worktree`,
    );
  });

  test(`${name}: still requires a pwd / rev-parse check before committing`, () => {
    assert.match(region, /git rev-parse --show-toplevel/, `${name}: the executable cwd check must survive any rewrite`);
    assert.match(
      region,
      /BLOCKED/,
      `${name}: a resolved-to-the-main-checkout cwd must stop the agent, not merely be noticed`,
    );
  });
}

test('Step 5 states that the dispatching session enters the worktree before dispatching', () => {
  const step5 = step5Region(SKILL);
  assert.match(
    step5,
    /dispatching session/i,
    'Step 5 must name the dispatching session as the thing that switches worktrees between groups',
  );
});
