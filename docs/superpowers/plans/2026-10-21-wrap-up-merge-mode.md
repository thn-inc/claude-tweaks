# Wrap-Up Merge Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/claude-tweaks:wrap-up #{n} merge` entry that merges an unattended run's parked PR in the same session on a human's go-ahead, with an attended Conflict-path branch, and point `/flow`'s summary row at it under `consoleAutoResolve`.

**Architecture:** Merge mode is a thin entry over `_shared/pr-first-merge.md`, not a new merge implementation. A new lazy-loaded sub-file `plugin/skills/wrap-up/merge-mode.md` owns the procedure. `wrap-up/SKILL.md` routes the new token there. `pr-first-merge.md`'s Conflict path gains one attended branch gated on merge mode. `flow/summary-template.md` renders the new row when the ceiling grants `consoleAutoResolve`. Every change is skill prose, pinned by one new conformance suite.

**Tech Stack:** Markdown skill prose; `node --test` conformance tests reading prose through `tests/helpers/read-skill.js`'s `readText()`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T042119-spec-3784/work/3784-spec.md` (record #3784)

## Global Constraints

- Commit style: `{Verb} {what} — {detail}`, body `Refs #3784`, trailer `Claude-Session: https://claude.ai/code/session_01Hc6XBLDvX8cJJ5KdVT1goS`. Never `Fixes`/`Closes` in a commit.
- A skill reference inside actionable instruction text uses the fully-qualified `/claude-tweaks:{skill}` form.
- Read-limit rail: `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). Measured headroom at plan time: `_shared/pr-first-merge.md` 37,783 B (+14,717 left), `wrap-up/SKILL.md` 38,189 B (+14,311), `flow/summary-template.md` 11,274 B, `wrap-up/flags.md` 3,102 B. The new `merge-mode.md` must stay well under the rail (target under 8,000 B).
- Headless callers of `_shared/pr-first-merge.md` keep today's stop-at-markers Conflict behavior unchanged. The sentence `- **Conflict markers remain**: this is what "unresolvable headlessly" means — stop, do not` stays byte-identical.
- The existing resume row `` `PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow "{target}" wrap-up` — resume to re-offer the merge decision, PR #{n} {is ready | is blocked} — mergeability: {outcome} `` stays, in both places it appears. `tests/wrap-up-leave-open-mergeability-conformance.test.js`'s `assertResumeRow` requires two occurrences.
- Prose reads in tests go through `tests/helpers/read-skill.js`'s `readText()`.

## Review Focus

1. **`merge` combined with `cleanup-only`.** The two must be rejected together, never silently run one. Pinned in Task 1's fact list (`rejects-cleanup-only`).
2. **`merge` given with no record reference** (bare `/claude-tweaks:wrap-up merge`). Merge mode needs a record to resolve the run. Expected behavior: a stop naming the missing `#{n}`, never falling through to conversation-based work. Pinned in Task 1 (`needs-record`).
3. **A PR that is not `OPEN`** (already merged by a sibling, or closed). Expected: stop before any merge step, report the PR state, take no cleanup action. Pinned in Task 1's preconditions fact (`precondition-open`).
4. **`gh pr merge --auto` failing with "Protected branch rules not configured"** on a PR that just went DIRTY. Expected: re-read `mergeStateStatus` before accepting branch 5's `pending-review`. Pinned in Task 1 (`reread-merge-state`).
5. **Archival racing late `decisions.md` writes.** Expected: Step 4.2's reconcile runs last, after Section C/E, so no later write recreates the archived dir. Pinned in Task 1 (`reconcile-last`).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `plugin/skills/wrap-up/merge-mode.md` | Create | The merge-mode procedure |
| `plugin/skills/wrap-up/SKILL.md` | Modify (frontmatter line 4, Input line 22, branch list near line 51, Flags line 55/63) | Route the `merge` token |
| `plugin/skills/wrap-up/flags.md` | Modify | Document the `merge` token |
| `plugin/skills/help/reference-card.md` | Modify line 18 (`Takes` cell) | Argument-hint mirror |
| `plugin/skills/_shared/pr-first-merge.md` | Modify `## Conflict path` (lines 431-453) | Attended branch |
| `plugin/skills/flow/summary-template.md` | Modify Next Actions list (line 100) and Resume-to-merge paragraph (106-110) | Merge-mode row under `consoleAutoResolve` |
| `docs/skill-graph.md` | Modify the `_shared/pr-first-merge.md` row (line 236) | New citing site |
| `docs/plugin-structure.md` | Modify the `wrap-up` sub-file row (line 106) | List `merge-mode.md` |
| `tests/wrap-up-merge-mode-conformance.test.js` | Create | Pins AC1-AC4 |

**Plan-time decision (deviates from the spec's AC4 literal):** the summary row reads `/claude-tweaks:wrap-up "{target}" merge`, not `#{n} merge`. In `summary-template.md`, `#{n}` already names the PR (`PR #{n}`) in the same row, and `{target}` is the record reference the existing row already uses (`/claude-tweaks:flow "{target}" wrap-up`). `merge-mode.md` and `SKILL.md` keep the spec's `#{n}` form, since there it names the record. Log this at Common Step 4.5 as a Beneficial deviation.

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 Step 1: `readText` of `merge-mode.md` (ENOENT red) |
| AC1.2 | Task 1 Step 1 facts `steps-1-3`, `step-4-1`, `reconcile-last`, `tag`, `section-c`, `section-e` |
| AC1.3 | Task 1 Step 1 facts `no-console-resolve`, `no-console-question` |
| AC1.4 | Task 1 Step 1 `assertEachFactGoesRed(MERGE_MODE region, MERGE_MODE_FACTS)` |
| AC2.1 | Task 1 Step 1 grammar test (hint, parse line, `flags.md` bullet) |
| AC2.2 | Task 1 Step 1 grammar test |
| AC3.1 | Task 2 Step 1 `POINTER_FACTS.scope` (the procedure lives in `merge-mode.md`; see Task 2's premise reversal) |
| AC3.2 | Task 2 Step 1 `ATTENDED_FACTS['both-intents']` |
| AC3.3 | Task 2 Step 1 `ATTENDED_FACTS.renumber` |
| AC3.4 | Task 2 Step 1 `ATTENDED_FACTS.suite` |
| AC3.5 | Task 2 Step 1 `ATTENDED_FACTS.abort` |
| AC3.6 | Task 2 Step 1 `POINTER_FACTS['headless-unchanged']` |
| AC3.7 | Task 2 Step 1 `assertEachFactGoesRed` over both regions |
| AC4.1 | Task 3 Step 1 `SUMMARY_FACTS` (`condition`, `merge-row`, `other-ceilings`) and the twice-occurring old row |
| AC4.2 | Task 3 Step 1 `SUMMARY_FACTS` + `assertEachFactGoesRed` |
| AC5.1 | Each task's Step 2 run (red before the edit), plus the Verification section's `git show origin/main:` replay |
| AC6.1 | Verification: full suite through `verify.js` |

## Test-file shape (shared by Tasks 1-3)

`tests/wrap-up-merge-mode-conformance.test.js` holds one helper and one fact table per task:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const flat = (s) => s.replace(/\s+/g, ' ');

// Returns the names of facts whose pattern does not match `text`.
function missingFactsOf(text, facts) {
  return Object.entries(facts).filter(([, re]) => !re.test(text)).map(([name]) => name);
}

// Per fact: strip only that fact's first match and assert exactly [name] goes missing.
function assertEachFactGoesRed(text, facts) {
  for (const [name, re] of Object.entries(facts)) {
    const doctored = text.replace(re, '');
    assert.notEqual(doctored, text, `${name}: pattern matched nothing to strip`);
    assert.deepStrictEqual(missingFactsOf(doctored, facts), [name], `${name}: stripping it must report exactly itself`);
  }
}
```

Fact regexes are non-global and run against `flat(text)` (whitespace collapsed, [IL-66]). Each must match exactly once in its region, or the per-fact proof reports `[]`. Each task adds two tests: `missingFactsOf(...) === []` on the live region, and `assertEachFactGoesRed` on the same region.

---

### Task 1: `merge-mode.md` procedure + the `merge` token's grammar surfaces

**Files:**
- Create: `plugin/skills/wrap-up/merge-mode.md`
- Modify: `plugin/skills/wrap-up/SKILL.md`, `plugin/skills/wrap-up/flags.md`, `plugin/skills/help/reference-card.md`, `docs/plugin-structure.md`, `docs/skill-graph.md`
- Test: `tests/wrap-up-merge-mode-conformance.test.js` (create, with the shared helper above)

**Interfaces:**
- Produces: the token `merge` in wrap-up's grammar; the file `wrap-up/merge-mode.md`; the heading `## Conflict` inside it, which names `_shared/pr-first-merge.md`'s attended branch (Task 2 writes that branch and cites `wrap-up/merge-mode.md` back).

- [ ] **Step 1: Write the failing tests**

`MERGE_MODE_FACTS` over `flat(read('plugin','skills','wrap-up','merge-mode.md'))`:

```js
const MERGE_MODE_FACTS = {
  invocation: /`\/claude-tweaks:wrap-up #\{n\} merge`/,
  'human-confirmation': /typed invocation is the human merge confirmation/,
  tag: /`\{tag\}` = `human-approved`/,
  'no-console-resolve': /never runs `console-resolve\.js`/,
  'no-console-question': /never asks a `"Review Console"`-headed question/,
  'run-dir': /`_shared\/run-dir-resolution\.md`'s resolution order/,
  'not-resume': /not the `resume` form/,
  'precondition-open': /PR is not `OPEN`/,
  'precondition-pr': /`run-state\.json` carries no `pr` object/,
  'precondition-model': /`integration-model: pr-first`/,
  'steps-1-3': /`_shared\/pr-first-merge\.md` Steps 1 through 3/,
  'step-4-1': /Step 4\.1/,
  'section-c': /Section C steps 3\.6-5\.5/,
  'section-e': /Section E/,
  'reconcile-last': /Step 4\.2's reconcile runs last/,
  'reread-merge-state': /re-read `mergeStateStatus`/,
  'rejects-cleanup-only': /`merge` with `cleanup-only` is rejected/,
  'needs-record': /`merge` with no record reference stops/,
  outcomes: /`merged`, `armed`, or `pending-review`/,
  bundle: /--step merge/,
};
```

Grammar test: `SKILL.md`'s frontmatter `argument-hint:` value and its `## Input` parse-line code span both equal `[#N|<spec>|<context>|resume] [--dry-run] [--skill-budget <n>] [--doc-budget <n>] [cleanup-only] [merge]`. `flags.md` matches ``/^- \*\*`merge`\*\*/m``. `reference-card.md`'s wrap-up row `Takes` cell, after un-escaping `\|`, equals the same hint. `SKILL.md` names `merge-mode.md` (`/`merge-mode\.md`/`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js`
Expected: FAIL. `merge-mode.md` does not exist (ENOENT from `readText`), and the hint lacks `[merge]`.

- [ ] **Step 3: Write `plugin/skills/wrap-up/merge-mode.md`**

Write `# Merge Mode`, then a header line in the house style, e.g. "Referenced by `skills/wrap-up/SKILL.md`'s Phase 1 …". Then sections in this order. Every fact literal above appears exactly once, verbatim.

1. **What it is.** The `` `/claude-tweaks:wrap-up #{n} merge` `` invocation, and that the typed invocation is the human merge confirmation: compose-subject's `` `{tag}` = `human-approved` `` (the same tag `dispatch/close-out.md` uses). Merge mode never runs `console-resolve.js` and never asks a `"Review Console"`-headed question. Under `consoleAutoResolve` the `pre-tool-use.js` ask gate (#3712) would deny one anyway.
2. **Resolve the run.** Adopt the run dir the way the explicit `/claude-tweaks:wrap-up #{n}` re-entry does (`resume-halted-run.md`'s second paragraph): `_shared/run-dir-resolution.md`'s resolution order, an inherited `PIPELINE_RUN_DIR` first. State that this is not the `resume` form: a parked `pending-review` run stays `status: active`.
3. **Token rules.** `merge` with no record reference stops, naming the missing `#{n}`. `merge` with `cleanup-only` is rejected: report both tokens and run neither.
4. **Preconditions.** Each one stops before any merge step, with no cleanup, and reports which failed: not `integration-model: pr-first`; `run-state.json` carries no `pr` object; PR is not `OPEN` (`gh pr view {pr} --json state`).
5. **Procedure.**
   - Read the composed merge bundle exactly as `review-console.md` step 13 does: `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step merge "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-first-merge.md" "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-checklist-refresh.md"`. If compose is unavailable, read the two source files.
   - Run `_shared/pr-first-merge.md` Steps 1 through 3 (acceptance labeling unconditionally, Step 1.5's curation guard, mark ready, Step 2.5's merge-verification gate, the merge).
   - On `merged`: run Step 4.1. Then run `wrap-up/cleanup-procedures-execution.md` Section C steps 3.6-5.5 (its step 4 carries the squash containment proof) and Section E's claim release. Finish every `decisions.md` write. Step 4.2's reconcile runs last, because its `archive` check moves the run dir.
6. **Step 3's branch 5 under merge mode.** Before accepting branch 5's `pending-review` (e.g. `--auto` rejected with "Protected branch rules not configured"), re-read `mergeStateStatus` (`gh pr view {pr} --json mergeStateStatus,statusCheckRollup`):
   - `DIRTY`: take the Conflict path, resolving per `## Conflict` below.
   - `CLEAN` with a green rollup: take Step 2.5's `wait`-row immediate `--squash`.
   - Anything else: accept `pending-review`.
7. **`## Conflict`.** Heading only in this task; Task 2 writes its body.
8. **Outcomes.** Report `merged`, `armed`, or `pending-review` in `pr-first-merge.md`'s Outcome vocabulary.

- [ ] **Step 4: Wire the grammar surfaces**
- `SKILL.md` line 4 `argument-hint` and line 22's code span become the hint above.
- Under "If `$ARGUMENTS` is provided:", add before the `resume` bullet: "If it is a record reference followed by the literal `merge` token, read `merge-mode.md` in this skill's directory and follow it in place of Phases 1-4."
- Add `merge` to line 55's strip list and line 63's flags.md pointer.
- `flags.md`: add a `- **`merge`**` bullet (one or two sentences, pointing at `merge-mode.md`).
- `reference-card.md` line 18 `Takes` cell: append ` [merge]`.
- `docs/plugin-structure.md` line 106: add `merge-mode.md` to the wrap-up file list, and one Phase 1 clause ("merge-mode.md — the `#N merge` same-session merge entry, read only when `$ARGUMENTS` carries `merge`").
- `docs/skill-graph.md` line 236: append one sentence "Since #3784, `wrap-up/merge-mode.md` runs Steps 1-3, Step 4.1 and Step 4.2 for a human-confirmed same-session merge (`human-approved`), and is the only caller of the Conflict path's attended branch."

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js tests/argument-hint-input.test.js tests/argument-hint-mirrors.test.js tests/skill-graph-table-structure.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/wrap-up/merge-mode.md plugin/skills/wrap-up/SKILL.md plugin/skills/wrap-up/flags.md plugin/skills/help/reference-card.md docs/plugin-structure.md docs/skill-graph.md tests/wrap-up-merge-mode-conformance.test.js
git commit -m "Add wrap-up merge mode — same-session human-confirmed merge for a parked PR" -m "Refs #3784" -m "Claude-Session: https://claude.ai/code/session_01Hc6XBLDvX8cJJ5KdVT1goS"
```

### Task 2: Attended Conflict-path branch — procedure in `merge-mode.md`, pointer in `_shared/pr-first-merge.md`

**Premise reversed at plan time (rail).** The spec put the attended branch's whole procedure in `_shared/pr-first-merge.md`. `plan-audit.js`'s headroom shows the composed `merge` bundle (`pr-first-merge.md` + `pr-checklist-refresh.md`) at **51,558 of 52,500 B**, leaving 942 B, so the procedure (~1,500 B) would breach the rail. A `<!-- when: attendance=attended -->` fence cannot help: `resolve-conditions.js:68` resolves `attendance` to `headless` exactly when `autonomy` is `unattended`, which is merge mode's case, so the fence would strip the branch for its only caller. Resolution: the procedure lives in `merge-mode.md`'s `## Conflict` (read only by merge mode), and `pr-first-merge.md`'s Conflict path gains one pointer bullet of at most 400 B naming the branch, its scope and its owner. Logged as `premise reversed:` per `_shared/pr-checklist-refresh.md`.

**Files:**
- Modify: `plugin/skills/wrap-up/merge-mode.md` (`## Conflict` body)
- Modify: `plugin/skills/_shared/pr-first-merge.md` `## Conflict path` (new bullet after the `- **Conflict markers remain**` bullet, lines 449-453)
- Test: `tests/wrap-up-merge-mode-conformance.test.js` (append)

**Interfaces:**
- Consumes: `merge-mode.md`'s `## Conflict` heading (Task 1).

- [ ] **Step 1: Write the failing tests**

Region A is `flat(MERGE_MODE)` from `'## Conflict'` to the next `'## '` heading, or the end of the file (explicit branch). Region B is `flat(MERGE)` from `'## Conflict path'` to `'## Outcome vocabulary'`. Assert every anchor is not `-1` before slicing.

```js
const ATTENDED_FACTS = {          // region A — merge-mode.md
  'both-intents': /both sides' intent can be kept and stated in one line per file/,
  renumber: /renumbers the branch's own entry and every citation the branch added, never the integration branch's/,
  suite: /`verify\.js`/,
  reenter: /re-enter Step 2\.5 from the top/,
  abort: /`git merge --abort`/,
};
const POINTER_FACTS = {           // region B — pr-first-merge.md
  scope: /\*\*Attended branch \(merge mode only\)\.\*\*/,
  owner: /`wrap-up\/merge-mode\.md`'s `## Conflict`/,
  'headless-unchanged': /- \*\*Conflict markers remain\*\*: this is what "unresolvable headlessly" means — stop, do not attempt resolution\./,
  'other-callers': /Every other caller keeps the stop-at-markers bullet above/,
};
```

Add one size test: `bin/compose-context.js`'s composition of the `merge` bundle stays at or under `RAIL_BYTES`. Import `RAIL_BYTES` from `plugin/bin/lib/skill-audit/budgets.js`; never a literal (`tests/skill-size-single-source.test.js`). Measure with the same stripping `plan-audit.js`'s headroom uses. If that needs a run dir, call `compose()` from `plugin/bin/lib/compose-context/compose.js` with all-unresolved conditions over the two source files.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js`
Expected: FAIL. Every fact is missing except `headless-unchanged`, which already matches today's text and is the unchanged-sentence guard.

- [ ] **Step 3: Write the procedure and the pointer**

`merge-mode.md` `## Conflict`: runs when the Conflict path's single update-from-base merge leaves markers, inside the run's own worktree:
- Resolve a conflict only where both sides' intent can be kept and stated in one line per file.
- An incident-number collision (`docs/incident-log.md`'s `IL-{N}`) renumbers the branch's own entry and every citation the branch added, never the integration branch's.
- Stage the result. Run the full suite through `verify.js` (`test/verification.md`'s runner).
- Commit, push (`git -C "{worktree-path}" push origin {branch}`), and re-enter Step 2.5 from the top.
- On a conflict needing a judgment between the two sides' intent, or a red suite: `git merge --abort`, leave the PR ready, and report `pending-review` naming the conflicted files and the reason.

`pr-first-merge.md`: one bullet right after `- **Conflict markers remain**`, at most 400 B:

> `- **Attended branch (merge mode only).** A human-confirmed merge (`/claude-tweaks:wrap-up #{n} merge`) resolves instead of stopping — procedure in `wrap-up/merge-mode.md`'s `## Conflict`. Every other caller keeps the stop-at-markers bullet above.`

Leave the `Conflict markers remain` bullet byte-identical.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js tests/pr-first-merge.test.js`
Then: `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.145.0/bin/plan-audit.js" docs/superpowers/plans/2026-10-21-wrap-up-merge-mode.md`. Read the `headroom.composed` `max` for step `merge`.
Expected: PASS, and the composed `merge` max ≤ 52,500.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/merge-mode.md plugin/skills/_shared/pr-first-merge.md tests/wrap-up-merge-mode-conformance.test.js
git commit -m "Add the attended Conflict-path branch — merge mode resolves a both-intents-kept conflict, else aborts" -m "Refs #3784" -m "Claude-Session: https://claude.ai/code/session_01Hc6XBLDvX8cJJ5KdVT1goS"
```

### Task 3: `/flow` summary row under `consoleAutoResolve`

**Files:**
- Modify: `plugin/skills/flow/summary-template.md` (Next Actions list line 100; Resume-to-merge paragraph lines 106-110)
- Test: `tests/wrap-up-merge-mode-conformance.test.js` (append)

- [ ] **Step 1: Write the failing tests**

Region: `flat(FLOW_SUMMARY)` from `'**Resume-to-merge row.**'` to the end of the file. The paragraph is the last section; write the `next === -1 ? rest : …` branch explicitly.

```js
const SUMMARY_FACTS = {
  condition: /grants `consoleAutoResolve`/,
  predicate: /`bookkeepingPermissions\(ceiling\)\.consoleAutoResolve`/,
  'merge-row': /`\/claude-tweaks:wrap-up "\{target\}" merge` — merge the parked PR in this session, PR #\{n\} \{is ready \| is blocked\} — mergeability: \{outcome\}/,
  'other-ceilings': /Every other ceiling keeps the row above/,
};
```

Also assert the old row still occurs twice in `flat(FLOW_SUMMARY)` (the existing `assertResumeRow` contract). And assert the Next Actions list (from `'### Next Actions'` to `'**Release row.**'`) carries the merge-row literal once.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js`
Expected: FAIL on `condition`, `predicate`, `merge-row`, `other-ceilings`.

- [ ] **Step 3: Edit `summary-template.md`**

- Add to the Next Actions list, after line 100: `` `/claude-tweaks:wrap-up "{target}" merge` — merge the parked PR in this session, PR #{n} {is ready | is blocked} — mergeability: {outcome} — in place of the row above when this run's ceiling grants consoleAutoResolve ``.
- In the Resume-to-merge paragraph, after the existing row block (line 108), add a paragraph. When this run's resolved `autonomy` ceiling (`resolve-policy.js --run "$PIPELINE_RUN_DIR" --values autonomy`) grants `consoleAutoResolve` (`bookkeepingPermissions(ceiling).consoleAutoResolve`, `bin/lib/issues/autonomy.js`, true at `unattended` only), render that merge row instead, written out on its own line after the paragraph (the `merge-row` literal, exactly once in this region). Its suffix rules are the same as the row above's. Give the reason: a resume there re-resolves the console with no question and re-parks the PR. Close with: "Every other ceiling keeps the row above."
- The recommended-slot rule (line 110) applies to whichever of the two rows renders.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js tests/wrap-up-leave-open-mergeability-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/summary-template.md tests/wrap-up-merge-mode-conformance.test.js
git commit -m "Point flow's resume-to-merge row at wrap-up merge mode under consoleAutoResolve" -m "Refs #3784" -m "Claude-Session: https://claude.ai/code/session_01Hc6XBLDvX8cJJ5KdVT1goS"
```

## Verification (Common Step 5)

- AC5 (each pin red against `origin/main`): Step 2 of every task runs against a tree equal to `origin/main` plus earlier tasks. Then, after Task 3, run the suite once more with each changed file replaced in memory by `git show origin/main:{file}`. A throwaway scratch script in the session scratchpad reads `git show` output and calls the same fact tables; nothing in the tree is mutated. Expected: every fact table reports its full list missing (`headless-unchanged` excepted).
- AC6: full suite through `verify.js` (Common Step 5), never a bare `npm test`.
- Size: `wc -c` on the four edited skill files and `merge-mode.md`; each must be under 52,500.

## Build deviations (Common Step 4.5, Beneficial — applied)

- **Token-rule hardening.** The router routes on `merge` only when `$ARGUMENTS` is nothing but `merge`, at most one record reference, and the skill's own tokens. Merge mode rejects `merge` with `cleanup-only`, `--dry-run` or `resume`, and never mints a run dir (`resolve-run-dir` without `--create`).
  - Why: per-task and whole-branch review found that a bare `merge` bypassed its stop rule, that free text containing "merge" was captured, and that `--dry-run` would run a real merge.
  - Commits: `f21443642`, `ceb8e15f0`, `52f3bc520`.
- **Conflict re-entry bound.** The attended push is the Conflict path's one attempt. A second `DIRTY` reports `pending-review`, reason `moving-target` (`52f3bc520`).
- **Three spec-literal deviations are staged** as `staged/build-deviation-{1,2,3}.md` (Update the spec): AC3's procedure placement, AC4's `"{target}"` token, and Gotcha 1's stale signature claim.
