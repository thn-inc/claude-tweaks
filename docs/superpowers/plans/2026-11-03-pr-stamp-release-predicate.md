# PR-Stamp Release Predicate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One predicate answers "may a pr-first push go ahead with no recorded PR", called by both `checkBookkeepingStampsGate` and `phase-exit.js`'s `prPushReleased`, pinned by a table-driven parity test; plus the absorbed `phase-exit` parser and comment fixes.

**Architecture:** `prStampReleased({runState, runDir, branch, model, hasNoUpstream})` lives in `plugin/bin/lib/hooks/pre-tool-use.js` beside `hasLoggedPrDegrade`. It only reads `decisions.md`; the gate keeps its stamp outcomes and `prExempt` memo around the call. `prPushReleased` keeps its `bookkeepingResult` short-circuit and its throw-safe `hasNoUpstreamYet` read, then delegates.

**Tech Stack:** Node 18+, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T133658-record-4344/work/4344-spec.md` (re-materialized 2026-11-03 with the record's `## Plan-review answers (2026-11-03)` section; this revision applies those answers as rules)

## Global Constraints

- Quoted from `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md`: "Every new exemption needs a regression test proven to go red on revert." and "Widening what a gate accepts as logged evidence is a loosening of the gate, so it gets the same discipline as a new exemption."
- Quoted from the same skill: "A change to that branch's release conditions changes `prPushReleased` in the same commit, and a new CLI that makes a gated call itself copies this shape." This plan replaces the pair of copies with one call and rewords that paragraph.
- Quoted from the same skill: "it keeps the gate's posture: a throw from `hasNoUpstreamYet` counts as not released, so the push is skipped."
- `tests/hooks-bookkeeping-stamps-gate.test.js` passes unchanged: no edit to that file (AC2.1).
- Never run `git stash` in any form. Run `tests/path-guard-conformance.test.js` and `tests/windows-hide-spawn-conformance.test.js` alongside the focused tests. No `fs.existsSync`/`fs.realpathSync` in `plugin/bin/` code this plan adds.
- Commit subject style: `{Verb} {what} — {detail}`, with `refs #4344` in the message, never `closes`/`fixes`.

## The rule, and the three places the two copies disagree today

Read from the current code. The predicate, in order:

1. `runState.status === 'clean'` -> true.
2. `runState.pr` truthy, or `runState.prExempt` truthy -> true.
3. `model !== 'pr-first'` -> true.
4. `hasNoUpstream` true -> `Boolean(branch)` and a Step 1 line for `branch` in any evidence dir (`hasLoggedPrEarlyStep1`). A FAILED line does not release a first publish.
5. Otherwise a FAILED line in any evidence dir (`hasLoggedPrDegrade`).

The evidence dirs come from one helper, `prEvidenceDirs(runDir)`, that both reads call (record answer 1): `[runDir]`, plus `path.dirname(runDir)` when `runDir`'s basename matches `/^spec-/` and the parent's basename matches `ctxLib.RUN_ID_RE` (the `readRunStateWithParent(..., {requireRunIdParent: true})` rule `precondition.js` uses). `pr-early-open.js` refuses a `spec-` `--run`, so in a multi-spec run both lines only ever land on the parent.

`runState` may be null (treated as `{}`).

Run state (record answer 3): the parity test passes both sides the same state object, so parity covers the predicate only. The gate reads `readRunState(ctx.runDir)` and phase exit reads `readRunStateWithParent`; the two never differ in practice, because hooks only resolve top-level run-id dirs. The gate does not gain `readRunStateWithParent`.

Each disagreement is settled here, so both sides change on purpose:

| Case | Gate today | `prPushReleased` today | Predicate | Why |
|---|---|---|---|---|
| `prExempt` set, pr-first, claim not yet exempt | deny | release | release | `prExempt` is written only once no denial is possible; `precondition.js` also honors it |
| per-spec dir, FAILED line on parent, tracked branch | deny | release | release | `precondition.js` reads the parent for this line; the degrade is the run's |
| first publish, FAILED line, no Step 1 line | deny (`record-pr-step1`) | release | **deny** | Keeps #1800. `pr-early-open.js` logs a Step 1 outcome before its push and create, so a real degrade carries both lines |
| per-spec dir, first publish, Step 1 line on the parent only | deny (`record-pr-step1`) | deny | **release** | Record answer 1: Step 1 evidence follows the parent by the FAILED line's rule |

Also: a truthy non-numeric `pr` stamp now releases `prPushReleased` as it already does the gate (`if (!runState.pr)`); `precondition.js` reads it the same way. And `prPushReleased` now requires a run-id-shaped parent, which it did not before.

The phase-exit SKIP line (record answer 4): today's text "no recorded PR for {branch} and no PR-early run lifecycle FAILED line" is false for a first publish that has a FAILED line but no Step 1 line. It now names the release condition that is missing: on a tracked branch, the FAILED line; on a first publish, the Step 1 line.

Leave `_shared/pr-early-run-lifecycle.md` lines 232 and 500 unchanged (record answer 1).

## Review Focus

- First publish carrying only a FAILED line: expect skipped push / deny on both sides (row in the parity table).
- A Step 1 line on an already-tracked branch: expect deny on both sides; a Step 1 line must not release a tracked push (row in the parity table).
- Unreadable run state: `prStampReleased({runState: null, ...})` must not throw (unit test in Task 1).
- `hasNoUpstreamYet` throwing in `prPushReleased`: reads as tracked, so only the degrade line can release (existing `phase-exit.test.js` seam; add one assertion in Task 1).
- Per-spec first publish whose Step 1 and FAILED lines sit on the parent: release on both sides; a non-run-id parent is never read (parity row plus unit case).
- Phase-exit SKIP text on a first publish names the missing Step 1 line, never "no FAILED line" (Task 1 Step 1's phase-exit case).
- Worktree-side rename ` R` in the dirty check: exactly one dirty entry per rename (Task 2).

---

### Task 1: One release predicate, called by the gate and by phase-exit

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (new function after `hasLoggedPrEarlyStep1`; the `if (!runState.pr)` branch of `checkBookkeepingStampsGate`; `module.exports`)
- Modify: `plugin/bin/lib/phase-exit/phase-exit.js` (`prPushReleased`, its require, its comment, header step 5, exports)
- Modify: `docs/hooks.md` (line 40's closing sentences on `prPushReleased`)
- Modify: `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md` ("A CLI that makes a gated call itself" paragraph)
- Test: `tests/bin-lib/phase-exit/pr-stamp-release-parity.test.js` (create)
- Test: `tests/bin-lib/phase-exit/phase-exit.test.js` (one `hasNoUpstreamYet` throw case)

Waived `plugin/bin/lib/pr-bookkeeping/precondition.js`: read only, as the source of the parent-dir rule. Its fail-open posture is deliberate and it is not changed.

**Interfaces:**
- Produces: `prStampReleased({ runState, runDir, branch, model, hasNoUpstream }) -> boolean`, exported from `pre-tool-use.js`.
- Produces: `prPushReleased(deps, runDir, wt, branch, state, bookkeepingResult) -> boolean`, now exported from `phase-exit.js`, signature unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/bin-lib/phase-exit/pr-stamp-release-parity.test.js`. Fixture per scenario, fresh each time: a real repo with a linked worktree, a materialize commit at `.claude-tweaks/pipelines/{RUN_ID}/work/991-spec.md` (or `.../spec-991/work/991-spec.md` for `perSpec`), and a run dir under a separate temp project at `.claude-tweaks/pipelines/{RUN_ID}` (shape: `gitRepo`, `linkedWorktreeOf`, `commitMaterializedSpec`, `mkRunDir` in `tests/hooks-bookkeeping-stamps-gate.test.js`; copy them, that file stays unedited). `tracked: true` adds a bare remote as `origin` and runs `git push -u origin {branch}` from the fixture.

```js
const FAILED = (b) => `- AUTO 09:00:00 — PR-early run lifecycle: push of ${b} to origin FAILED (network); run proceeds local-only, no PR opened. Reversibility: n/a.\n`;
const STEP1 = (b) => `- AUTO 09:00:00 — PR-early run lifecycle: no existing PR for ${b}; creating. Reversibility: n/a.\n`;
const SCENARIOS = [
  { name: 'recorded PR', state: { pr: { number: 42, url: 'u' } }, tracked: true, released: true },
  { name: 'malformed pr stamp', state: { pr: { number: 'x' } }, tracked: true, released: true },
  { name: 'prExempt', state: { prExempt: true }, tracked: true, released: true },
  { name: 'closed run', state: { status: 'clean' }, tracked: true, released: true },
  { name: 'FAILED degrade line', state: {}, decisions: FAILED, tracked: true, released: true },
  { name: 'nothing logged, tracked', state: {}, tracked: true, released: false },
  { name: 'Step 1 line on a tracked branch', state: {}, decisions: STEP1, tracked: true, released: false },
  { name: 'first publish with its Step 1 line', state: {}, decisions: STEP1, tracked: false, released: true },
  { name: 'first publish without its Step 1 line', state: {}, tracked: false, released: false },
  { name: 'first publish with only a FAILED line', state: {}, decisions: FAILED, tracked: false, released: false },
  { name: 'per-spec, FAILED line on the parent', state: {}, parentDecisions: FAILED, perSpec: true, tracked: true, released: true },
  { name: 'per-spec, no FAILED line anywhere', state: {}, perSpec: true, tracked: true, released: false },
  { name: 'per-spec first publish, FAILED and Step 1 lines on the parent', state: {}, parentDecisions: (b) => FAILED(b) + STEP1(b), perSpec: true, tracked: false, released: true },
];
```

Each scenario's `state` is merged over `{ status: 'active', worktree: wt }`, and is the same object for both sides. One `test('AC1.1: gate and prPushReleased agree — {name}', ...)` per row, asserting both sides against `released`:

```js
const push = prPushReleased({ hasNoUpstreamYet: pre.hasNoUpstreamYet }, runDir, wt, branch, state, { pr: state.pr && Number.isInteger(state.pr.number) ? 'present' : 'missing' });
const out = pre.run({ input: { tool_name: 'Bash', tool_input: { command: `git push origin ${branch}` }, cwd: wt }, runDir, runState: state, cwd: wt }, { resolveIntegrationModel: () => 'pr-first' });
const denied = Boolean(out.json && out.json.hookSpecificOutput && out.json.hookSpecificOutput.permissionDecision === 'deny');
assert.equal(push, s.released, `prPushReleased: ${s.name}`);
assert.equal(!denied, s.released, `gate: ${s.name}`);
```

Call `prPushReleased` first: the gate may write `prExempt` to the fixture's run dir.

Unit cases, same file:

```js
test('prStampReleased: null runState does not throw and reads as nothing recorded', () => { /* runDir with no decisions.md, model pr-first, hasNoUpstream false -> false */ });
test('prStampReleased: a non-pr-first model releases', () => { /* model 'local-merge', hasNoUpstream true, no Step 1 line -> true */ });
test('prStampReleased: first publish with a null branch does not release', () => { /* Step 1 line present, branch null, hasNoUpstream true -> false */ });
test('prStampReleased: a spec-* dir whose parent is not run-id-shaped does not read that parent', () => { /* parent named "other" holds a FAILED line -> false; same parent holding a Step 1 line, hasNoUpstream true -> false */ });
```

In `tests/bin-lib/phase-exit/phase-exit.test.js` add:
- state `{ worktree: '/wt' }`, `prList: []`, `hasNoUpstreamYet: () => { throw new Error('boom'); }`, no decisions -> `env.push.state === 'skipped'`; and with `step1Line` written -> still `'skipped'`; with a FAILED line -> `'pushed'`.
- The per-spec first-publish row (record answer 1): `runPhaseExit` on `{runDir}/spec-4` with `hasNoUpstreamYet: () => true`, `prList: []`, the parent run dir's `decisions.md` holding the FAILED line and the Step 1 line for `BRANCH` -> `'pushed'`. Prove it discriminates: with the parent read removed from `prEvidenceDirs` the case goes red (revert, run, restore; quote the failing assertion in the task report).
- The first-publish SKIP text (record answer 4): a `NO_PR_FIRST_PUBLISH_SKIP` constant beside `NO_PR_SKIP`, asserted by a case with `hasNoUpstreamYet: () => true`, `prList: []` and only a FAILED line logged -> skipped, and `entriesOf(runDir)` equals `[NO_PR_FIRST_PUBLISH_SKIP]`. Update `NO_PR_SKIP` to the new tracked-branch text and its comment to say it is the tracked-branch line.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bin-lib/phase-exit/pr-stamp-release-parity.test.js`
Expected: FAIL (`prPushReleased` and `prStampReleased` not exported)

- [ ] **Step 3: Implement**

`prEvidenceDirs(runDir)` and `prStampReleased` as "The rule" above, placed right after `hasLoggedPrEarlyStep1`; both reads in `prStampReleased` go through `prEvidenceDirs` (`dirs.some((d) => hasLoggedPrEarlyStep1(d, branch))`, `dirs.some((d) => hasLoggedPrDegrade(d))`). `prEvidenceDirs` returns `[runDir]` for a non-string or empty `runDir` too, so the reads keep their missing-file -> false posture. Add `prStampReleased` to `module.exports` under a comment naming both callers. Remove the `hasLoggedPrEarlyStep1` export (its only outside consumer was phase-exit); keep `hasLoggedPrDegrade` (`precondition.js`) and `hasNoUpstreamYet` (`phase-exit.js`'s seam).

Gate, inside `if (!runState.pr)` after the model resolution, replacing the #989 block's condition and the `model === 'pr-first' && !hasLoggedPrDegrade` condition. Keep both `stampCheckOutcome` calls byte-identical, and keep the block's comments that still apply:

```js
const firstPublish = Array.isArray(commandGitTargets) && commandGitTargets.length > 0
  && commandGitTargets.every((t) => t.action === 'push' && hasNoUpstreamYet(t.dir));
let branch = null;
if (firstPublish && model === 'pr-first') {
  const branches = commandGitTargets.map((t) => currentBranchName(t.dir));
  if (branches[0] && branches.every((b) => b === branches[0])) [branch] = branches;
}
const released = prStampReleased({ runState, runDir: ctx.runDir, branch, model, hasNoUpstream: firstPublish });
if (firstPublish) {
  if (released) return {};          // one-shot: never persisted as prExempt
  return stampCheckOutcome(ctx, 'record-pr-step1', ...);
}
if (!released) return stampCheckOutcome(ctx, 'record-pr', ...);
```

The `if (modelResolved) ctxLib.writeRunState(ctx.runDir, { prExempt: true })` memo stays after this, unchanged. `currentBranchName` still spawns only under `pr-first`. Replace the "applies this branch's release rules" comment at the top of the branch with one naming `prStampReleased` as the shared rule.

`prPushReleased`:

```js
// A throw reads as tracked (not a first publish): only the degrade line can then release.
function firstPublishPush(deps, wt) {
  try { return deps.hasNoUpstreamYet(wt) === true; } catch { return false; }
}

function prPushReleased(deps, runDir, wt, branch, state, bookkeepingResult) {
  if (bookkeepingResult.pr === 'present' || bookkeepingResult.pr === 'backfilled') return true;
  return prStampReleased({ runState: state, runDir, branch, model: 'pr-first', hasNoUpstream: firstPublishPush(deps, wt) });
}
```

Its call site is already `pr-first`-only (`model === 'local-merge'` returns earlier). Update the require, export `prPushReleased`, and reword its comment and header step 5 (lines 26-32) to name `prStampReleased` and state that a first publish releases only on its Step 1 line. Keep the `hasPr` helper: `bookkeeping` still uses it.

The SKIP line at the call site (record answer 4) names the missing condition, chosen by `firstPublishPush(deps, wt)` (a second call, on the skip path only):
- tracked branch: `condition: no recorded PR for ${pushBranch}, an already-published branch, and no PR-early run lifecycle FAILED line → fallback: no phase-exit push this phase; open the PR first (_shared/pr-early-run-lifecycle.md)`
- first publish: `condition: first publish of ${pushBranch} with no recorded PR and no PR-early run lifecycle Step 1 line for it → fallback: no phase-exit push this phase; run Step 1 and open the PR first (_shared/pr-early-run-lifecycle.md)`

`env.push.reason` stays `'no recorded PR — open it first (pr-early-run-lifecycle)'` in both cases.

Reword `docs/hooks.md` line 40's last two sentences and the skill's "A CLI that makes a gated call itself" paragraph: phase-exit's `prPushReleased` and the gate both call the exported `prStampReleased`, `tests/bin-lib/phase-exit/pr-stamp-release-parity.test.js` pins them together, and a new release condition goes in that one function. Keep the throw-means-not-released clause. Add to `docs/hooks.md` line 40, with the same words as "The rule" above (record answer 3): the gate reads `readRunState(ctx.runDir)` and phase exit reads `readRunStateWithParent`, which never differ in practice because hooks only resolve top-level run-id dirs. State there that the Step 1 and FAILED reads both follow a run-id-shaped parent of a `spec-` run dir. Grep `docs/hooks.md` line 40 for its other claims about the degrade and #989 exemptions and confirm they still hold. Do not edit `pre-tool-use.js`'s comment at the old line 1320 or `docs/hooks.md` line 41 (#2571's per-spec claims): record answer 5 makes that contradiction a follow-up record, filed at wrap-up.

Old plans and ledgers under `docs/superpowers/plans/` and `docs/plans/` that mention `prPushReleased` are history: no change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/phase-exit/pr-stamp-release-parity.test.js tests/bin-lib/phase-exit/phase-exit.test.js tests/hooks-bookkeeping-stamps-gate.test.js tests/bin-lib/pr-bookkeeping/precondition.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS. AC2.1 is this run with `git diff --stat` showing no change to `tests/hooks-bookkeeping-stamps-gate.test.js`.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/pre-tool-use.js plugin/bin/lib/phase-exit/phase-exit.js docs/hooks.md .claude/skills/pre-tool-use-gate-exemptions/SKILL.md tests/bin-lib/phase-exit/pr-stamp-release-parity.test.js tests/bin-lib/phase-exit/phase-exit.test.js
git commit -m "Extract the PR-stamp release rule into one predicate — the push gate and phase-exit now call it; refs #4344"
```

### Task 2: One porcelain parser, and comments that state what the code does

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/phase-exit/phase-exit.js` (`parsePorcelainZ`, its call in `runPhaseExit`, exports, header lines 15-17, the comment above the worktree check)
- Modify: `plugin/bin/phase-exit.js` (comment at line 98)
- Test: `tests/bin-lib/phase-exit/phase-exit.test.js`

Waived `plugin/bin/lib/git-z.js`: read only, `parseStatusPorcelainZ` is reused unchanged.

**Interfaces:**
- Consumes: `parseStatusPorcelainZ(raw) -> [{ xy, path, origPath? }]` from `plugin/bin/lib/git-z.js`.

- [ ] **Step 1: Write the failing test**

Add to `phase-exit.test.js`, beside the existing dirty-tree test:

```js
test('commit check — a worktree-side rename ( R) counts once, its source path is not a separate dirty entry', () => {
  const { main, runDir, wt } = fixture();
  const h = makeDeps(main, wt, { porcelain: ' R new.js\0old.js\0 M a.js\0' });
  const env = runPhaseExit(opts(runDir, wt, 'review'), h.deps);
  assert.deepEqual(env.commit, { clean: false, dirty: ['new.js', 'a.js'] });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bin-lib/phase-exit/phase-exit.test.js`
Expected: FAIL after Step 1, `dirty` also holds `old.js`

- [ ] **Step 3: Implement**

Delete `parsePorcelainZ` and its export. At the call: `parseStatusPorcelainZ(deps.git([...])).map((r) => r.path)`. No test or doc outside the history files reads the old name.

Comments:
- Header lines 15-17 and the comment above the `hasWorktree(state)` check: both sides compare the assigned worktree with the push target, but phase-exit refuses the push and appends `wd-push-mismatch`, while E1 logs `wd-push-mismatch` and allows it. Keep the "fails open on an unprovable path" clause.
- `plugin/bin/phase-exit.js:98`: the record's "in-process" reading is half right, verified from `phase-exit.js`: `realDeps.hooks` and `realDeps.resolvePolicy` spawn with cwd `--worktree`, while `prChecklistRun` and `prMergeStateRun` run in-process at this process's cwd. Reword to say so: a relative path would name different directories in those two kinds of sub-step.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/phase-exit/phase-exit.test.js tests/bin-lib/phase-exit/pr-stamp-release-parity.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/phase-exit/phase-exit.js plugin/bin/phase-exit.js tests/bin-lib/phase-exit/phase-exit.test.js
git commit -m "Reuse git-z's porcelain parser in phase-exit — a worktree-side rename no longer reads as two dirty paths; correct the E1 parity and sub-step comments; refs #4344"
```
