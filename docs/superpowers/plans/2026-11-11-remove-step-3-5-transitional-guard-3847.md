# Remove wrap-up Step 3.5's Transitional Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete wrap-up's Section C step 3.5 (the pre-anchoring copy-out guard) at its recorded sunset and re-point every live citation of it.

**Architecture:** Prose deletion plus citation re-points across skills, docs, three code comments and two tests. No behavior change: `checkPipelineShadowGuard` and the teardown gate are untouched. `[IL-116]`'s rule stays; its stated rationale moves from the copy-out to the surviving teardown sequence (step 3.6's close-run and step 4's ordered removal).

**Tech Stack:** Markdown skill files, Node 18+ comments, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-11T213038-spec-3847/work/3847-spec.md`

Scope keywords: transitional guard, copy-out guard, 2026-11-07

## Global Constraints

- Do not renumber Section C's steps 3.6 onward — other files cite them by number.
- Leave `docs/incident-log.md` unchanged (history) and `plugin/bin/lib/hooks/pre-tool-use.js:84-93` unchanged (it already describes the older copy-out as removed history).
- Keep the literal `` `[IL-116]` cleanup floor `` in `_shared/ceremony-profile.md` — `tests/ceremony-profile-roster.test.js:54` pins it.
- Every edited `plugin/skills/**/*.md` file only shrinks or stays near its size; no file approaches `RAIL_BYTES` (52,500 B).
- Touch only the sites named below; other "Step 3.5" headings (review, backlog, journeys, docs-health, routine, attention) are unrelated.

## Deliverable 1: Removal-condition check (run at authoring time, 2026-11-11)

Ran from the main checkout: `find "/Users/thomasholknielsen/Code Workspaces/claude-tweaks" -maxdepth 6 -path "*/.claude/worktrees/*/.claude-tweaks/pipelines/*" -type d`. Result: 15,008 lines, 14,976 run-dir hits across 32 worktrees. Every hit's run id also exists under the main checkout's `.claude-tweaks/pipelines/` (live or `archive/`): 0 missing, 0 holding gitignored state outside `work/`. The hits are post-anchoring tracked `work/` spec dirs, not trapped pre-anchoring state. The condition holds; the removal is also unconditional past the 2026-11-07 sunset. Per the spec's Plan Review Clarifications (decided by the user at plan review: command plus a hit/missing summary, not the raw 15,008 lines), Task 5 Step 6 writes this summary into PR #5220's body.

## Review Focus

1. A re-pointed `[IL-116]` rationale that names a step that does not exist, or misstates what step 3.6/4 do — check each replacement against `cleanup-procedures-execution.md` lines for 3.6 and 4 after the edit.
2. A step-range citation left at "3.5-5.5" somewhere the sweep missed — Task 5's sweep greps three phrasings.
3. `engine-cli.test.js`'s exclusion test passing vacuously — Task 1 Step 3's control proves the new sentinel exists in the appendix and not in the head.
4. The roster test going red because the `[IL-116]` row's literal moved — Task 2 runs `tests/ceremony-profile-roster.test.js`.
5. A comment rewrite changing the documented shadow-guard behavior — Task 4 runs `tests/hooks-pipeline-shadow-guard.test.js` unchanged (AC5.1).

---

### Task 1: Delete the step and its pointer

**Role:** transcription

**Files:**
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution-appendix.md:23-79`
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md` (lines 111, 139, 154, 160-168)
- Test: `tests/bin-lib/wrap-up/engine-cli.test.js:707`
- Test: `tests/wrap-up-record-resolution-conformance.test.js:72` (pins line 111's step list)
- Test: `tests/local-merge-auto-finish.test.js:74` (slices the local-merge branch up to `'3.5.'`)

**Interfaces:**
- Consumes: nothing.
- Produces: Section C with no step 3.5; steps 3.6 onward keep their numbers.

- [ ] **Step 1: Delete the appendix section.** Remove from the line `## Step 3.5: Transitional guard — a run directory whose only copy is inside this worktree` through the end of the `**Removal condition**` paragraph (ending `…abandoned state, not live state.`), and the blank line after it, so `## Step 4: Unverified caveat on the \`reconcile\` remedy` follows the Step 2 section directly.

- [ ] **Step 2: Delete step 3.5 from the head.** In `cleanup-procedures-execution.md`, remove the whole list item starting `3.5. **Transitional guard — a run directory whose only copy is inside this worktree.**` through `condition); until then, check it on every run.`. On lines 139 and 154 replace `Skip steps 3.5, 3.6, 4, and 5 below` with `Skip steps 3.6, 4, and 5 below`. On line 111 replace `skip steps 3, 3.5, 3.6, 4, and 5 below and Section E` with `skip steps 3, 3.6, 4, and 5 below and Section E`.

- [ ] **Step 2b: Re-point the two tests that read the head's step list.** In `tests/wrap-up-record-resolution-conformance.test.js:72` change the regex to `/Stop here with no carrier commit: skip steps 3, 3\.6, 4, and 5 below and Section E/`. In `tests/local-merge-auto-finish.test.js:74` change `EXEC.indexOf('3.5.', localMergeStart)` to `EXEC.indexOf('3.6.', localMergeStart)` — step 3.6 is the list item that now follows the local-merge branch, so the slice keeps its old end boundary instead of running to end-of-file.

- [ ] **Step 3: Replace the engine-cli sentinel (AC4.1).** In `tests/bin-lib/wrap-up/engine-cli.test.js:707` replace `assert.doesNotMatch(r.stdout, /Delete unconditionally after \*\*2026-11-07\*\*/);` with `assert.doesNotMatch(r.stdout, /producing \*\*no merge commit at all\*\*/);`. Control (run after Step 1):

Run: `grep -c -F 'producing **no merge commit at all**' plugin/skills/wrap-up/cleanup-procedures-execution-appendix.md plugin/skills/wrap-up/cleanup-procedures-execution.md`
Expected: `…appendix.md:1` and `…execution.md:0` (recorded at authoring: 1 and 0).

- [ ] **Step 5: Verify.**

Run: `node --test tests/bin-lib/wrap-up/engine-cli.test.js tests/wrap-up-record-resolution-conformance.test.js tests/local-merge-auto-finish.test.js`
Expected: PASS, including `render --section procedure:cleanup-procedures-execution emits the head file and excludes its appendix content`.

Run: `grep -n -i 'transitional guard\|2026-11-07\|3\.5' plugin/skills/wrap-up/cleanup-procedures-execution-appendix.md plugin/skills/wrap-up/cleanup-procedures-execution.md`
Expected: no output (at base: hits on appendix 23/76 and head 111/139/154/160/165/167).

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/wrap-up/cleanup-procedures-execution-appendix.md plugin/skills/wrap-up/cleanup-procedures-execution.md tests/bin-lib/wrap-up/engine-cli.test.js tests/wrap-up-record-resolution-conformance.test.js tests/local-merge-auto-finish.test.js
git commit -m "Remove wrap-up Section C step 3.5's transitional guard at its sunset (#3847)"
```

### Task 2: Re-ground `[IL-116]`'s rationale

**Role:** transcription

**Files:**
- Modify: `plugin/skills/_shared/ceremony-profile.md:37`
- Modify: `plugin/skills/dispatch/two-call-gate.md` (lines 27, 37, 88)
- Modify: `docs/donts.md:150`
- Modify: `plugin/skills/wrap-up/flags.md:6`

**Interfaces:**
- Consumes: Task 1's Section C (3.6 close-run, 4 ordered removal).
- Produces: no `[IL-116]` citation names step 3.5.

- [ ] **Step 1: ceremony-profile row.** Replace `` | `[IL-116]` cleanup floor | `wrap-up/cleanup-procedures.md` Section C, step 3.5 | `` with `` | `[IL-116]` cleanup floor | `wrap-up/cleanup-procedures.md` Section C, steps 3.6-4 | ``. The third cell is unchanged.

- [ ] **Step 2: two-call-gate.md.**
  - Line 27: replace `it skips \`wrap-up/cleanup-procedures-execution.md\` Section C step 3.5's transitional guard and can permanently destroy a pre-anchoring run's \`config.yml\`/\`decisions.md\`/\`staged/\` with no git history to recover from.` with `it skips \`wrap-up/cleanup-procedures-execution.md\` Section C's teardown sequence — step 3.6's close-run, the sanctioned exit the teardown gate checks for, and step 4's ordered removal — leaving the run non-terminal with its worktree assignment still recorded.`
  - Line 37: replace `` `[IL-116]`'s constraint (Section C step 3.5's transitional guard) is unaffected `` with `` `[IL-116]`'s constraint (Section C's teardown sequence) is unaffected ``.
  - Line 88: replace `` `cleanup-only`'s `cleanup-procedures.md` Section C step 3.5 is `` with `` `cleanup-only`'s `cleanup-procedures.md` Section C teardown sequence is ``.

- [ ] **Step 3: donts.md:150.** Replace `it skips \`cleanup-procedures-execution.md\` Section C step 3.5's Transitional guard, permanently destroying the run's gitignored \`config.yml\`/\`decisions.md\`/\`staged/\` with no git history to recover.` with `it skips \`cleanup-procedures-execution.md\` Section C's teardown sequence (step 3.6's close-run, step 4's port-lease release and ordered removal), leaving the run non-terminal and its worktree assignment recorded.`

- [ ] **Step 4: flags.md:6.** Replace `Section C's teardown-ordering invariant and step 3.5's transitional guard still run **unconditionally**` with `Section C's teardown-ordering invariant and step 3.6's close-run still run **unconditionally**`.

- [ ] **Step 5: Verify.**

Run: `node --test tests/ceremony-profile-roster.test.js tests/flow-cleanup-only-conformance.test.js tests/claude-md-budget.test.js`
Expected: PASS.

Run: `grep -n -i 'step 3\.5\|transitional guard' plugin/skills/_shared/ceremony-profile.md plugin/skills/dispatch/two-call-gate.md docs/donts.md plugin/skills/wrap-up/flags.md`
Expected: no output (at base: ceremony-profile:37, two-call-gate:27/37/88, donts:150, flags:6).

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/ceremony-profile.md plugin/skills/dispatch/two-call-gate.md docs/donts.md plugin/skills/wrap-up/flags.md
git commit -m "Re-ground [IL-116]'s rationale on the surviving teardown sequence (#3847)"
```

### Task 3: Step-range citations and the anchoring contract

**Role:** transcription

**Files:**
- Modify: `plugin/skills/wrap-up/merge-mode.md:27`
- Modify: `docs/skill-graph.md:249`
- Modify: `plugin/skills/_shared/pipeline-run-dir.md` (lines 48-51, 76-79, 131-134)
- Modify: `docs/plugin-structure.md:119`
- Test: `tests/wrap-up-merge-mode-conformance.test.js:36` (pins merge-mode.md's `Section C steps 3.5-5.5`)

**Interfaces:**
- Consumes: Task 1's Section C numbering.
- Produces: no "3.5-5.5" range; the anchoring contract no longer names a pre-anchoring exception.

- [ ] **Step 1: merge-mode.md:27 and its pin.** Replace `Section C steps 3.5-5.5 (step 3.5 is the pre-anchoring copy-out guard; step 4 carries the squash containment proof)` with `Section C steps 3.6-5.5 (step 4 carries the squash containment proof)`. In `tests/wrap-up-merge-mode-conformance.test.js:36` change `'section-c': /Section C steps 3\.5-5\.5/,` to `'section-c': /Section C steps 3\.6-5\.5/,`.

- [ ] **Step 1b: Update the appendix description.** In `docs/plugin-structure.md:119` replace `— the Prose fallback, the pre-anchoring Transitional guard, and the Multi-spec defer protocol, respectively —` with `— the Prose fallback, the dedicated-commit rationale and \`reconcile\` caveat, and the Multi-spec defer protocol, respectively —`.

- [ ] **Step 2: skill-graph.md:249.** Replace `cites Section C steps 3.5-5.5 and Section E` with `cites Section C steps 3.6-5.5 and Section E`.

- [ ] **Step 3: pipeline-run-dir.md.**
  - `--root-only` bullet: replace `(a \`find\` backstop scoped to the whole\n  \`pipelines/\` tree, the transitional copy-out guard's destination computation), never a specific` with `(a \`find\` backstop scoped to the whole\n  \`pipelines/\` tree), never a specific`.
  - "A worktree never holds the only copy" bullet: delete the sentence `Run directories that predate anchoring are the one exception, and \`skills/wrap-up/cleanup-procedures-execution.md\` Section C step 3.5 carries the transitional guard that copies them out before a worktree is removed.` so the bullet ends at `` `session-start.js`) safe. ``.
  - Shadow-guard paragraph: replace `It flags only a genuinely new creation; a pre-anchoring run directory already\nsitting in a worktree (\`wrap-up/cleanup-procedures-execution.md\` Section C step 3.5's transitional guard,\nsunset 2026-11-07) is left alone.` with `It flags only a genuinely new creation; a run directory that already exists in a worktree is left\nalone.`

- [ ] **Step 4: Verify.**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js tests/skill-graph-table-structure.test.js tests/pipeline-run-dir-cli-boundary-pin.test.js tests/flow-run-dir-anchoring.test.js tests/pipeline-run-dir-adoption-anchoring.test.js`
Expected: PASS.

Run: `grep -n -i 'step 3\.5\|steps 3\.5\|transitional\|2026-11-07' plugin/skills/wrap-up/merge-mode.md plugin/skills/_shared/pipeline-run-dir.md docs/skill-graph.md docs/plugin-structure.md`
Expected: no output (at base: merge-mode:27, pipeline-run-dir:50/78/133/134, skill-graph:249, plugin-structure:119).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/merge-mode.md docs/skill-graph.md plugin/skills/_shared/pipeline-run-dir.md docs/plugin-structure.md tests/wrap-up-merge-mode-conformance.test.js
git commit -m "Re-point Section C step ranges and drop the pre-anchoring exception from the anchoring contract (#3847)"
```

### Task 4: Code and test comments

**Role:** transcription

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js:708-716` (comment only)
- Modify: `plugin/bin/lib/hooks/context.js:248-249` (comment only)
- Modify: `plugin/bin/lib/hooks/run-dir-resolve.js:217-220` (comment only)
- Modify: `tests/hooks-pipeline-shadow-guard.test.js:11-14` (header comment only)

**Interfaces:**
- Consumes: nothing.
- Produces: no code comment cites the retired step; no executable line changes.

- [ ] **Step 1: pre-tool-use.js.** Replace the comment lines from `// pre-anchoring run directory already sitting in a worktree is left alone` through `// must not be newly denied by a guard shipped after that pipeline started.` (keeping the preceding `// Flags only a NEW creation — … does not already exist on disk. A` lines) with:

```js
// run directory already sitting in a worktree is left alone: further writes
// into it (e.g. a still-running pre-anchoring pipeline appending events.jsonl)
// must not be newly denied by a guard shipped after that pipeline started.
```

so the sentence reads "…does not already exist on disk. A run directory already sitting in a worktree is left alone: …".

- [ ] **Step 2: context.js.** Delete the two comment lines `// matters for is wrap-up's transitional copy-out guard, which does its own` / `` // `pwd -P` resolution rather than trusting this one. `` and the words `The scenario it` that end the preceding line, so that comment ends at `…the state it can reach is the one a worktree with a broken \`.git\` file actually has.`

- [ ] **Step 3: run-dir-resolve.js.** Replace `// all. For call sites that only ever needed $RUN_ROOT itself (a \`find\`\n  // backstop scoped to the whole pipelines/ tree, the wrap-up transitional\n  // copy-out guard's DEST computation), not a specific run's directory.` with `// all. For call sites that only ever needed $RUN_ROOT itself (a \`find\`\n  // backstop scoped to the whole pipelines/ tree), not a specific run's\n  // directory.`

- [ ] **Step 4: shadow-guard test header.** Replace lines 11-14 with:

```js
// Deliberately NOT flagged: a write into a run directory that ALREADY EXISTS
// in the worktree (the pre-anchoring shape). Only a brand-new creation is
// denied.
```

- [ ] **Step 5: Verify (AC5.1).**

Run: `node --test tests/hooks-pipeline-shadow-guard.test.js tests/hooks-context.test.js tests/hooks-run-dir-resolve.test.js tests/path-guard-conformance.test.js`
Expected: PASS, every allow/deny case in `hooks-pipeline-shadow-guard.test.js` unchanged.

Run: `git diff --stat -- plugin/bin` then `git diff -U0 -- plugin/bin | grep '^[+-][^+-]' | grep -v '^[+-]\s*//'`
Expected: the second command prints nothing (only comment lines changed).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/pre-tool-use.js plugin/bin/lib/hooks/context.js plugin/bin/lib/hooks/run-dir-resolve.js tests/hooks-pipeline-shadow-guard.test.js
git commit -m "Drop the retired copy-out guard from hook comments and the shadow-guard test header (#3847)"
```

### Task 5: Acceptance sweep (folded verification)

**Role:** transcription

**Files:** none modified in the repo (verification plus one PR-body write; a grep hit here is fixed in the task that owns the file).

- [ ] **Step 1: AC1.1** — Run: `git grep -n '2026-11-07' -- plugin/ tests/` — Expected: no output. Control at base `87e79b904`: 6 hits (pre-tool-use.js:712, pipeline-run-dir.md:134, appendix:76, cleanup-procedures-execution.md:167, engine-cli.test.js:707, hooks-pipeline-shadow-guard.test.js:14).
- [ ] **Step 2: AC2.1** — Run: `git grep -n -i 'transitional guard' -- plugin/ tests/ docs/donts.md` — Expected: no output. Control at base: hits in appendix, cleanup-procedures-execution.md, pipeline-run-dir.md, two-call-gate.md, flags.md, donts.md, hooks-pipeline-shadow-guard.test.js.
- [ ] **Step 3: AC3.1** — Run: `git grep -n -i 'step 3\.5' -- plugin/skills/wrap-up/cleanup-procedures-execution.md plugin/skills/wrap-up/cleanup-procedures-execution-appendix.md plugin/skills/_shared/pipeline-run-dir.md plugin/skills/_shared/ceremony-profile.md plugin/skills/dispatch/two-call-gate.md docs/donts.md` — Expected: no output. Control at base: hits in all six files.
- [ ] **Step 4: Retirement sweep (three phrasings)** — Run: `git grep -n -i -e 'copy-out guard' -e 'steps 3\.5' -e 'step 3\.5.s' -e '3, 3\.5' -e '3\\\.5-5\\\.5' -e "'3\.5\.'" -- plugin docs tests ':!docs/incident-log.md' ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md'` — Expected: no hit naming wrap-up's cleanup step (hits about review/backlog/journeys/docs-health/routine/attention Step 3.5 are unrelated and stay). Exclusions added per #4579; control on the excluded form at base returns the context.js, run-dir-resolve.js, pipeline-run-dir.md, merge-mode.md, skill-graph.md and cleanup-procedures-execution.md sites.
- [ ] **Step 5: AC6.1** — the full `npm test` runs at build Common Step 5 (`verify.js`), not here.
- [ ] **Step 6: Deliverable 1 into the PR body.** Read PR #5220's current body (`gh pr view 5220 --json body -q .body` to a session-tmp file), append a `### Removal-condition check (Deliverable 1)` section holding the exact `find` command from the Deliverable 1 section above and its summary line (15,008 lines; 14,976 run-dir hits across 32 worktrees; 0 runs missing from the main checkout's `pipelines/`; 0 holding gitignored state outside `work/`), write it with the Write tool, and apply it with `gh pr edit 5220 --body-file {file}`. Verify with `gh pr view 5220 --json body -q .body` showing the section. Re-run the `find` first if the worktree set changed since 2026-11-11, and use the fresh counts.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (find check, summary in PR per Plan Review Clarifications) | Authoring-time result above; Task 5 Step 6 |
| Deliverable 2 (delete appendix section + Section C step) | Task 1 |
| Deliverable 3 (pipeline-run-dir.md) | Task 3 |
| Deliverable 4 (`[IL-116]` re-point) | Task 2 |
| Deliverable 5 (pre-tool-use.js + shadow-guard test comments) | Task 4 |
| Deliverable 6 (engine-cli sentinel) | Task 1 Step 3 |
| AC1.1, AC2.1, AC3.1 | Task 5 Steps 1-3 |
| AC4.1 | Task 1 Step 3 |
| AC5.1 | Task 4 Step 5 |
| AC6.1 | Task 5 Step 5 (Common Step 5) |
