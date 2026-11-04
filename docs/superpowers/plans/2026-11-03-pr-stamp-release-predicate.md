# PR-Stamp Release Predicate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One predicate answers "may a pr-first push go ahead with no recorded PR", called by both `checkBookkeepingStampsGate` and `phase-exit.js`'s `prPushReleased`, pinned by a table-driven parity test; plus the absorbed `phase-exit` parser and comment fixes.

**Architecture:** `prStampReleased({runState, runDir, branch, model, hasNoUpstream})` lives in `plugin/bin/lib/hooks/pre-tool-use.js` beside `hasLoggedPrDegrade`. It only reads `decisions.md`; the gate keeps its stamp outcomes and `prExempt` memo around the call. `prPushReleased` keeps its `bookkeepingResult` short-circuit and its throw-safe `hasNoUpstreamYet` read, then delegates.

**Tech Stack:** Node 18+, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T143504-record-4344/work/4344-spec.md` (materialized 2026-11-03 with both `## Plan-review answers (2026-11-03)` and `## Plan-review answers, round 2 (2026-11-03)`; round 2 amends round-1 answer 2. This revision applies both as rules. The spec's `## Contract changes` list and `## Release Note` already carry round 2's edits, on the record body too.)

## Global Constraints

- Quoted from `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md`: "Every new exemption needs a regression test proven to go red on revert." and "Widening what a gate accepts as logged evidence is a loosening of the gate, so it gets the same discipline as a new exemption."
- Quoted from the same skill: "A change to that branch's release conditions changes `prPushReleased` in the same commit, and a new CLI that makes a gated call itself copies this shape." This plan replaces the pair of copies with one call and rewords that paragraph.
- Quoted from the same skill: "it keeps the gate's posture: a throw from `hasNoUpstreamYet` counts as not released, so the push is skipped."
- `tests/hooks-bookkeeping-stamps-gate.test.js` passes unchanged: no edit to that file (AC2.1). Its `prExempt` cases are all Edits, so round 2's narrowed short-circuit does not reach them.
- Never run `git stash` in any form. Run `tests/path-guard-conformance.test.js` and `tests/windows-hide-spawn-conformance.test.js` alongside the focused tests. No `fs.existsSync`/`fs.realpathSync` in `plugin/bin/` code this plan adds.
- Commit subject style: `{Verb} {what} — {detail}`, with `refs #4344` in the message, never `closes`/`fixes`.

## The rule, and the places the two copies disagree today

The predicate, in this order (round-2 answer 1):

1. `runState.status === 'clean'` -> true.
2. `Boolean(runState.pr)` -> true. Any truthy stamp releases (round-2 answer 2); `phase-exit.js`'s `hasPr` stays, for `bookkeeping()`'s backfill only.
3. `model !== 'pr-first'` -> true.
4. First-publish rule: `hasNoUpstream` true -> return `Boolean(branch)` and a Step 1 line for `branch` in any evidence dir (`hasLoggedPrEarlyStep1`). Nothing else releases a first publish: not `prExempt`, not a FAILED line.
5. `runState.prExempt` truthy -> true.
6. Otherwise a FAILED line in any evidence dir (`hasLoggedPrDegrade`).

The evidence dirs come from one helper, `prEvidenceDirs(runDir)`, that both reads call (round-1 answer 1): `[runDir]`, plus `path.dirname(path.resolve(runDir))` when `runDir`'s basename matches `/^spec-/` and the parent's basename matches `ctxLib.RUN_ID_RE` (the `readRunStateWithParent(..., {requireRunIdParent: true})` rule `precondition.js` uses). `pr-early-open.js` refuses a `spec-` `--run`, so in a multi-spec run both lines only ever land on the parent.

`runState` may be null (treated as `{}`).

Run state (round-1 answer 3): the parity test passes both sides the same state object, so parity covers the predicate only. The gate reads `readRunState(ctx.runDir)` and phase exit reads `readRunStateWithParent`; the two never differ in practice, because hooks only resolve top-level run-id dirs. The gate does not gain `readRunStateWithParent`.

The gate's early short-circuit (round-2 answer 1): today `runState.worktree && (runState.pr || runState.prExempt) && runState.claimExempt` returns `{}` before any PR check. It becomes `runState.worktree && (runState.pr || (runState.prExempt && !allPush)) && runState.claimExempt`, where `allPush` is `isGitWrite && commandGitTargets.every((t) => t.action === 'push')`. So a memoized `prExempt` no longer skips an all-push call, and that call reaches the PR branch, where rule 4 decides a first publish. The `prExempt` memo write itself is unchanged.

Each disagreement is settled here, so both sides change on purpose (the spec's `## Contract changes` list is the same set):

| Case | Gate today | `prPushReleased` today | Predicate | Why |
|---|---|---|---|---|
| `prExempt` set, tracked branch, pr-first, claim not yet exempt | deny | release | release | `prExempt` is written only once no tracked-branch denial is possible; `precondition.js` also honors it |
| `prExempt` set, first publish, FAILED line, no Step 1 line | allow (short-circuit) or deny (`record-pr-step1`) | release | **deny** | Round-2 answer 1: the gate's `record-pr` deny text tells agents to hand-log a FAILED line, so a memoized `prExempt` can precede a first publish that never ran Step 1 (#903) |
| per-spec dir, FAILED line on parent, tracked branch | deny | release | release | `precondition.js` reads the parent for this line; the degrade is the run's |
| first publish, FAILED line, no Step 1 line | deny (`record-pr-step1`) | release | **deny** | Keeps #1800. `pr-early-open.js` logs a Step 1 outcome before its push and create, so a real degrade carries both lines |
| per-spec dir, first publish, Step 1 line on the parent only | deny (`record-pr-step1`) | deny | **release** | Round-1 answer 1: Step 1 evidence follows the parent by the FAILED line's rule |
| malformed (truthy, non-integer) `pr` stamp | release | deny | release | Round-2 answer 2: the gate's existing rule; both writers reject a malformed stamp |

Also: `prPushReleased` now requires a run-id-shaped parent, which it did not before.

Accepted consequence (round-2 answer 1): a run that already memoized `prExempt` from a hand-logged FAILED line has its first-publish push denied until a Step 1 line is logged.

The phase-exit SKIP line (round-1 answer 4, round-2 answer 3) names the missing release condition, chosen by whether the branch was proven to be a first publish:
- first publish: `condition: no PR-early run lifecycle Step 1 line for ${pushBranch} → fallback: no phase-exit push this phase; open the PR first (_shared/pr-early-run-lifecycle.md)`
- otherwise, including when the `hasNoUpstreamYet` read throws: `condition: no recorded PR, prExempt or PR-early run lifecycle FAILED line for ${pushBranch} → fallback: no phase-exit push this phase; open the PR first (_shared/pr-early-run-lifecycle.md)`

`env.push.reason` stays `'no recorded PR — open it first (pr-early-run-lifecycle)'` in both cases.

Unchanged on purpose (round-2 answer 5): `plugin/bin/lib/pr-bookkeeping/precondition.js` and `phase-exit.js`'s `bookkeeping()` route at the old line 419 keep reading plain `prExempt`; both answer "is the bookkeeping complete?", not "may this push go ahead?". Leave `_shared/pr-early-run-lifecycle.md` lines 232 and 500 unchanged (round-1 answer 1).

## Review Focus

- First publish carrying only a FAILED line: deny on both sides, with and without `prExempt` (parity rows).
- `prExempt` + `claimExempt` + first-publish push with only a FAILED line: the gate's short-circuit must not allow it; the deny is `record-pr-step1` (gate test in Task 1).
- A Step 1 line on an already-tracked branch: deny on both sides; a Step 1 line must not release a tracked push (parity row).
- Unreadable run state: `prStampReleased({runState: null, ...})` must not throw (unit test in Task 1).
- `hasNoUpstreamYet` throwing in `prPushReleased`: reads as tracked, so only `prExempt` or the degrade line can release, and the SKIP line uses the tracked wording (Task 1 `phase-exit.test.js` case).
- Per-spec first publish whose Step 1 and FAILED lines sit on the parent: release on both sides; a non-run-id parent is never read (parity row plus unit case).
- Phase-exit SKIP text on a first publish names the missing Step 1 line, never the FAILED line (Task 1 `phase-exit.test.js` case).
- Worktree-side rename ` R` in the dirty check: exactly one dirty entry per rename (Task 2).

---

### Task 1: One release predicate, called by the gate and by phase-exit

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (new functions after `hasLoggedPrEarlyStep1`; the early short-circuit in `checkBookkeepingStampsGate` and its comment; the header comment's check-4 paragraph; the `if (!runState.pr)` branch; `module.exports`)
- Modify: `plugin/bin/lib/phase-exit/phase-exit.js` (`prPushReleased`, its require, its comment, the SKIP line at its call site, header step 5, exports)
- Modify: `docs/hooks.md` (the Bookkeeping-stamps gate bullet, line 40)
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/phase-exit/` row, line 48)
- Modify: `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md` ("A CLI that makes a gated call itself" paragraph)
- Test: `tests/bin-lib/phase-exit/pr-stamp-release-parity.test.js` (create)
- Test: `tests/bin-lib/phase-exit/phase-exit.test.js` (SKIP constants and four cases)

Waived `plugin/bin/lib/pr-bookkeeping/precondition.js`: read only, as the source of the parent-dir rule. Its fail-open posture and its plain `prExempt` read are deliberate and not changed (round-2 answer 5).

**Interfaces:**
- Produces: `prStampReleased({ runState, runDir, branch, model, hasNoUpstream }) -> boolean`, exported from `pre-tool-use.js`.
- Produces: `prPushReleased(deps, runDir, wt, branch, state, bookkeepingResult) -> boolean`, now exported from `phase-exit.js`, signature unchanged.

- [ ] **Step 1: Write the failing tests**

Create `tests/bin-lib/phase-exit/pr-stamp-release-parity.test.js`. Fixture per scenario, fresh each time: a real repo with a linked worktree, a materialize commit at `.claude-tweaks/pipelines/{RUN_ID}/work/991-spec.md` (or `.../spec-991/work/991-spec.md` for `perSpec`), and a run dir under a separate temp project at `.claude-tweaks/pipelines/{RUN_ID}` (shape: `gitRepo`, `linkedWorktreeOf`, `commitMaterializedSpec`, `mkRunDir` in `tests/hooks-bookkeeping-stamps-gate.test.js`; copy them, that file stays unedited). `tracked: true` adds a bare remote as `origin` and runs `git push -u origin {branch}` from the fixture.

```js
const FAILED = (b) => `- AUTO 09:00:00 — PR-early run lifecycle: push of ${b} to origin FAILED (network); run proceeds local-only, no PR opened. Reversibility: n/a.\n`;
const STEP1 = (b) => `- AUTO 09:00:00 — PR-early run lifecycle: no existing PR for ${b}; creating. Reversibility: n/a.\n`;
const SCENARIOS = [
  { name: 'recorded PR', state: { pr: { number: 42, url: 'u' } }, tracked: true, released: true },
  { name: 'malformed pr stamp', state: { pr: { number: 'x' } }, tracked: true, released: true },
  { name: 'prExempt', state: { prExempt: true }, tracked: true, released: true },
  { name: 'prExempt, first publish with only a FAILED line', state: { prExempt: true }, decisions: FAILED, tracked: false, released: false },
  { name: 'prExempt, first publish with FAILED and Step 1 lines', state: { prExempt: true }, decisions: (b) => FAILED(b) + STEP1(b), tracked: false, released: true },
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

Gate test, same file (round-2 answer 1): `test('gate: a memoized prExempt does not short-circuit a first-publish push that has only a FAILED line', ...)`. State `{ status: 'active', worktree: wt, prExempt: true, claimExempt: true }`, untracked branch, `decisions.md` holding only `FAILED(branch)`, `resolveIntegrationModel: () => 'pr-first'`, command `git push origin {branch}` -> denied, and the run dir's `events.jsonl` gains a `bookkeeping-stamp-deny` event whose `stamp` is `'record-pr-step1'`.

Unit cases, same file:

```js
test('prStampReleased: null runState does not throw and reads as nothing recorded', () => { /* runDir with no decisions.md, model pr-first, hasNoUpstream false -> false */ });
test('prStampReleased: a non-pr-first model releases', () => { /* model 'local-merge', hasNoUpstream true, no Step 1 line -> true */ });
test('prStampReleased: first publish with a null branch does not release', () => { /* Step 1 line present, branch null, hasNoUpstream true -> false */ });
test('prStampReleased: a spec-* dir whose parent is not run-id-shaped does not read that parent', () => { /* parent named "other" holds a FAILED line -> false; same parent holding a Step 1 line, hasNoUpstream true -> false */ });
```

In `tests/bin-lib/phase-exit/phase-exit.test.js`:
- Update `NO_PR_SKIP` to the tracked wording, `- SKIP — Phase-exit push: condition: no recorded PR, prExempt or PR-early run lifecycle FAILED line for ${BRANCH} → fallback: no phase-exit push this phase; open the PR first (_shared/pr-early-run-lifecycle.md). Reversibility: n/a.`, and its comment to say it is the line for a branch not proven to be a first publish. Add `NO_PR_FIRST_PUBLISH_SKIP` beside it: `- SKIP — Phase-exit push: condition: no PR-early run lifecycle Step 1 line for ${BRANCH} → fallback: no phase-exit push this phase; open the PR first (_shared/pr-early-run-lifecycle.md). Reversibility: n/a.`
- Throw case: state `{ worktree: '/wt' }`, `prList: []`, `hasNoUpstreamYet: () => { throw new Error('boom'); }`, no decisions -> `env.push.state === 'skipped'` and `entriesOf(runDir).map(stripTime)` equals `[NO_PR_SKIP]`; with the Step 1 line written -> still `'skipped'`; with a FAILED line -> `'pushed'`.
- The per-spec first-publish row (round-1 answer 1): `runPhaseExit` on `{runDir}/spec-4` with `hasNoUpstreamYet: () => true`, `prList: []`, the parent run dir's `decisions.md` holding the FAILED line and the Step 1 line for `BRANCH` -> `'pushed'`.
- First-publish SKIP text: `hasNoUpstreamYet: () => true`, `prList: []`, only a FAILED line logged -> skipped, and `entriesOf(runDir).map(stripTime)` equals `[stripTime(failedLine.trim()), NO_PR_FIRST_PUBLISH_SKIP]` (`entriesOf` returns every `- ` line of `decisions.md`, so the seeded FAILED line comes back first; match the existing `failedLine` shape at the old line 335 and strip it the same way).
- `prExempt` first publish: state `{ worktree: '/wt', prExempt: true }`, `hasNoUpstreamYet: () => true`, `prList: []`, no decisions -> `'skipped'` with `[NO_PR_FIRST_PUBLISH_SKIP]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/phase-exit/pr-stamp-release-parity.test.js`
Expected: FAIL (`prPushReleased` and `prStampReleased` not exported)

- [ ] **Step 3: Implement**

`prEvidenceDirs(runDir)` and `prStampReleased` as "The rule" above, placed right after `hasLoggedPrEarlyStep1`; both reads in `prStampReleased` go through `prEvidenceDirs` (`dirs.some((d) => hasLoggedPrEarlyStep1(d, branch))`, `dirs.some((d) => hasLoggedPrDegrade(d))`). `prEvidenceDirs` returns `[runDir]` for a non-string or empty `runDir` too, so the reads keep their missing-file -> false posture. Add `prStampReleased` to `module.exports` under a comment naming both callers. Remove the `hasLoggedPrEarlyStep1` export (its only outside consumer was phase-exit); keep `hasLoggedPrDegrade` (`precondition.js`) and `hasNoUpstreamYet` (`phase-exit.js`'s seam).

Gate, early short-circuit: compute `allPush` right before it and narrow the condition as "The rule" above states. Reword its comment's closing sentences (the "Purely an optimization; it changes no deny/allow outcome." pair, old lines 2003-2004): `prExempt` short-circuits every call except an all-push one, because a first publish still needs its Step 1 line (round-2 answer 1). Reword the header comment's check-4 sentences (old lines 1943-1946) the same way: `prExempt` records that no tracked-branch PR-stamp denial is possible; an all-push call still reaches the PR branch for the first-publish rule. Behavior-change prose sweep (`grep -n "short-circuit" plugin/bin/lib/hooks/pre-tool-use.js`): the memo-write comment's "every later covered call for this run hits the check-1 short-circuit above" (old line 2269) gets the same all-push exception; no other hit describes the `prExempt` short-circuit.

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
// A throw reads as tracked (not a first publish): only prExempt or the degrade line can then release.
function firstPublishPush(deps, wt) {
  try { return deps.hasNoUpstreamYet(wt) === true; } catch { return false; }
}

function prPushReleased(deps, runDir, wt, branch, state, bookkeepingResult) {
  if (bookkeepingResult.pr === 'present' || bookkeepingResult.pr === 'backfilled') return true;
  return prStampReleased({ runState: state, runDir, branch, model: 'pr-first', hasNoUpstream: firstPublishPush(deps, wt) });
}
```

Its call site is already `pr-first`-only (`model === 'local-merge'` returns earlier). Update the require, export `prPushReleased`, and reword its comment and header step 5 (lines 26-32) to name `prStampReleased` and state that a first publish releases only on its Step 1 line. Keep the `hasPr` helper: `bookkeeping` still uses it. The SKIP line at the call site picks its wording from `firstPublishPush(deps, wt)` (a second call, on the skip path only), as "The rule" above lists.

Docs:
- `docs/hooks.md` line 40: reword its closing sentences on `prPushReleased` and the skill's "A CLI that makes a gated call itself" paragraph: phase-exit's `prPushReleased` and the gate both call the exported `prStampReleased`, `tests/bin-lib/phase-exit/pr-stamp-release-parity.test.js` pins them together, and a new release condition goes in that one function. Keep the throw-means-not-released clause. Add to line 40: the gate reads `readRunState(ctx.runDir)` and phase exit reads `readRunStateWithParent`, which never differ in practice because hooks only resolve top-level run-id dirs (round-1 answer 3); the Step 1 and FAILED reads both follow a run-id-shaped parent of a `spec-` run dir; and one sentence for round-2 answer 1: a memoized `prExempt` does not short-circuit an all-push call, so a first publish under it still needs its Step 1 line. Grep line 40 for its other claims about the degrade and #989 exemptions and confirm they still hold. Behavior-change prose sweep (`grep -n "prExempt" docs/hooks.md`) finds two more lines the narrowed short-circuit makes false, and both change in this task: line 46 ("so does `runState.worktree` alone once `runState.prExempt` is set … so every later covered call … skips repoInfo, `hasMaterializeCommit`, and this resolution entirely") gains the all-push exception, and line 47's quoted condition `runState.worktree && (runState.pr || runState.prExempt) && runState.claimExempt` becomes the new one.
- `docs/plugin-structure.md` line 48 (round-2 answer 4): replace "(its exported hasLoggedPrDegrade / hasLoggedPrEarlyStep1 / hasNoUpstreamYet, [IL-131])" with wording that says phase exit calls the exported `prStampReleased` and uses `hasNoUpstreamYet` as its seam ([IL-131] kept).
- Do not edit `pre-tool-use.js`'s comment above `perSpecPathspec` (old line 1320) or `docs/hooks.md` line 41 (#2571's per-spec claims): round-1 answer 5 makes that contradiction a follow-up record, filed at wrap-up.

Old plans and ledgers under `docs/superpowers/plans/` and `docs/plans/` that mention `prPushReleased` are history: no change.

- [ ] **Step 4: Run the tests to verify they pass, then prove the new rows discriminate**

Run: `node --test tests/bin-lib/phase-exit/pr-stamp-release-parity.test.js tests/bin-lib/phase-exit/phase-exit.test.js tests/hooks-bookkeeping-stamps-gate.test.js tests/bin-lib/pr-bookkeeping/precondition.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS. AC2.1 is this run with `git diff --stat` showing no change to `tests/hooks-bookkeeping-stamps-gate.test.js`.

Then revert each rule below in the working tree, run the named test file, quote the failing assertion in the task report, and restore (`git diff` empty for that hunk afterwards):
- the parent read in `prEvidenceDirs` -> the `phase-exit.test.js` per-spec first-publish case and the parity per-spec first-publish row go red;
- rule order (move the `prExempt` check above the first-publish rule) -> the parity row "prExempt, first publish with only a FAILED line" and the `phase-exit.test.js` `prExempt` first-publish case go red;
- the first-publish rule's Step 1 release (return `false` for a first publish) -> the parity row "prExempt, first publish with FAILED and Step 1 lines" goes red;
- the short-circuit narrowing (back to `runState.pr || runState.prExempt`) -> the gate test goes red.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/pre-tool-use.js plugin/bin/lib/phase-exit/phase-exit.js docs/hooks.md docs/plugin-structure.md .claude/skills/pre-tool-use-gate-exemptions/SKILL.md tests/bin-lib/phase-exit/pr-stamp-release-parity.test.js tests/bin-lib/phase-exit/phase-exit.test.js
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
