# PR-Body Deliverable Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review Step 1 checks PR-body deliverables against the live PR body, and build never logs a PR-body claim the body does not carry.

**Architecture:** Two prose changes to shipped skill files, each pinned by a new `node --test` conformance suite. `plugin/skills/review/code-mode-steps.md` gains Step 1 item 6. That file sits 71 bytes under the Read-limit rail, so two unpinned narrative sentences in its Step 2 are tightened in the same task to make room. `plugin/skills/build/architecture-alignment.md` gains a `## Claims about the PR body` section.

**Tech Stack:** Markdown skill prose; `node --test` (built-in) with `tests/helpers/read-skill.js` and `tests/helpers/conformance-asserts.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T060844-spec-5340/work/5340-spec.md`

Scope keywords: PR-body deliverables, Spec Compliance Check, Claims about the PR body

## Global Constraints

- Read-limit rail: `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). `code-mode-steps.md` is 52,429 B at base; after Task 1's exact edits it measures 52,325 B (175 B headroom, measured by a scratch script over the planned strings). Never add a per-file byte pin (`tests/skill-size-single-source.test.js`).
- Commit messages: `{Verb} {what} — {detail}` (imperative, no conventional-commit prefix), ending with the line `Claude-Session: https://claude.ai/code/session_016yg3zrGQB1yk3fGi1qfrJ2`.
- CI runs Node 20; local is Node 22. Use only `node:test` / `node:assert/strict` APIs present in Node 20.
- Quoted from `.claude/skills/skill-prose-conformance-tests/SKILL.md` (governs both new suites, since both pin `plugin/skills/**/*.md` prose):
  - "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message**"
  - "**When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself.** Write the assertion as a predicate that returns the facts whose pattern no longer matches (`missingFactsOf(patterns)`), and assert it returns `[]` on the live region. Then, per pattern, strip only that pattern's match from the live text and assert the same predicate returns exactly `[fact]`."
  - "Keep the patterns non-global: a `/g` regex makes `replace` strip every occurrence, which hides the twice-matched phrase, and its `.test()` carries `lastIndex` from one call to the next."
  - "**A clause pinned to its row or paragraph owes a move-out control, not only a deletion.** Deleting the clause also turns a file-wide `includes` red, so it cannot show the check reads only its slice."
- Surgical changes: the three Step 2 trims in Task 1 exist only to stay under the rail; touch no other line of `code-mode-steps.md`.
- Plan review ruling (the user, Reading B): no PR, or a failed PR-body read, is `unverifiable` — never present, flagged as a partial gap, never a block. A body that was read and lacks the content is `missing`.
- PR source, shared by both tasks: `pr.number` in `run-state.json` (a bundle's parent run dir), else the current branch's PR. With `gh` absent, read via `mcp__github__pull_request_read` and write via `mcp__github__update_pull_request` (`_shared/github-write-transport.md`).

## Review Focus

1. Standalone `/claude-tweaks:review` with no run dir has no `run-state.json`: item 6 must still name a PR source (the current branch's PR). Task 1's fact list pins "or the current branch's PR".
2. A PR-body read that fails, or no PR at all, must never count as the deliverable being present, and must not block (plan-review ruling). Task 1 pins "no PR or a failed read is `unverifiable`, a partial gap, never present".
3. A build edit to the PR body must not destroy the run markers (`[claude-tweaks-phases-start]` and so on) that later phases read. Task 2 pins "without touching its run markers".
4. A spec that says "PR description" rather than "PR body" must trigger the check too. Task 1 pins "(or PR description)".
5. The new item must sit inside Step 1, not anywhere in the file (AC2). Task 1's move-out control moves the item below Step 1's `### Gate:` and expects the fact list to go red.

---

### Task 1: Review Step 1 checks PR-body deliverables against the live body

**Role:** integration

**Files:**
- Modify: `plugin/skills/review/code-mode-steps.md` (Step 1 list; Step 2 lines 151 and 175)
- Test: `tests/review-pr-body-deliverables.test.js` (create)
- No change (swept — names Step 1 but not how it finds evidence): `plugin/skills/review/SKILL.md`, `plugin/skills/_shared/fast-lane-digest.md`, `docs/incident-log.md`
- No change (swept — pins other Step 1 items; Step 4 re-runs the first): `tests/review-current-state-outcome-reach.test.js`, `tests/review-risk-marker-verification.test.js`, `tests/fast-lane-digest.test.js`

**Interfaces:**
- Consumes: `readText` from `tests/helpers/read-skill.js`; `missingFactsOf`, `assertEachPatternGoesRed` from `tests/helpers/conformance-asserts.js`.
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing test** `tests/review-pr-body-deliverables.test.js` (covers AC1.1, AC2.1)

Slice Step 1 exactly as `tests/review-current-state-outcome-reach.test.js`'s `step1()` does: from `## Step 1: Spec Compliance Check` to the first `### Gate:` after it. Fact list (non-global regexes), each matching exactly once in the slice:

```js
const FACTS = [
  [/\*\*PR-body deliverables\*\*/, 'item heading'],
  [/names the PR body \(or PR description\)/, 'PR body or PR description triggers the check'],
  [/against the live body of the run's PR, never the codebase/, 'evidence is the live PR body, not the codebase'],
  [/\(item 1 skips it\)/, 'item 6 replaces item 1 for these'],
  [/`gh pr view \{pr\} --json body`/, 'read command'],
  [/`mcp__github__pull_request_read` without `gh`/, 'gh-absent read'],
  [/`\{pr\}` is `pr\.number` in `run-state\.json` \(a bundle's parent run dir\), else the current branch's PR/, 'PR source, run, bundle and standalone'],
  [/Mark it `missing` when the body lacks it, `partial` when it carries part/, 'missing / partial verdicts'],
  [/no PR or a failed read is `unverifiable`, a partial gap, never present/, 'unreadable is unverifiable, not present, not a block'],
];
```

Tests:
- `Step 1 states every PR-body fact`: `assert.deepEqual(missingFactsOf(FACTS)(step1(STEPS)), [])`.
- `each PR-body fact can go red`: `assertEachPatternGoesRed(step1(STEPS), FACTS, missingFactsOf(FACTS))`.
- `the PR-body item is read from Step 1, not file-wide` (move-out control): build `moved` by cutting the whole item-6 line out of `STEPS` and inserting it right after Step 1's `### Gate:` heading line; `assert.notEqual(moved, STEPS)`; `assert.ok(moved.includes('**PR-body deliverables**'))` (still in the file); `assert.deepEqual(missingFactsOf(FACTS)(step1(moved)), FACTS.map(([, f]) => f))`.
- `grep for "PR body" names the check in Step 1` (AC2.1): the lines of `STEPS` matching `/PR body/i` include at least one whose text is inside `step1(STEPS)` and contains `PR-body deliverables`.

`step1(text)` takes the text as a parameter so the controls can pass doctored copies.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-pr-body-deliverables.test.js`
Expected: FAIL — `Step 1 states every PR-body fact` reports all nine facts missing.

- [ ] **Step 3: Edit `plugin/skills/review/code-mode-steps.md`**

Insert this exact line as Step 1's new item 6, directly after item 5's last line (the line that reads ``   still read bare `--stamp-status`.``) and before the blank line that precedes `### Gate:`:

```
6. **PR-body deliverables** — check a deliverable or criterion that names the PR body (or PR description) against the live body of the run's PR, never the codebase (item 1 skips it): `gh pr view {pr} --json body`, or `mcp__github__pull_request_read` without `gh`; `{pr}` is `pr.number` in `run-state.json` (a bundle's parent run dir), else the current branch's PR. Mark it `missing` when the body lacks it, `partial` when it carries part; no PR or a failed read is `unverifiable`, a partial gap, never present.
```

Replace line 147 (the paragraph opening `Not to be confused with "Reusing a Prior Whole-Branch Review" below`) with exactly:

```
Not to be confused with "Reusing a Prior Whole-Branch Review" below, which governs citing an earlier spec's completed review: this check governs what is in the diff at all.
```

Replace line 151 (the paragraph opening `The Merge-Provenance Check above fires only on`) with exactly:

```
A cherry-pick or manual port of *another record's* branch leaves no merge commit, so the Merge-Provenance Check above misses it and the reused content is reviewed as this branch's own work (#1821: two open PRs, one implementation, and no Step 3 lens asks whether the work is already in flight).
```

Replace line 175 (the paragraph opening `**Do not read the full diff in the main thread.**`) with exactly:

```
**Do not read the full diff in the main thread.** The full diff runs about 100x the size of `--stat`. Everything this step classifies, and everything Step 2.5's diff heuristic consumes, comes from the two commands above.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/review-pr-body-deliverables.test.js tests/review-current-state-outcome-reach.test.js tests/review-merge-provenance-check.test.js tests/cherry-pick-provenance-prose-conformance.test.js`
Expected: PASS, 0 failures.

Run: `wc -c plugin/skills/review/code-mode-steps.md`
Expected: `52325` (at or under 52500).

Run: `grep -n -i "PR body" plugin/skills/review/code-mode-steps.md`
Expected: one line, the Step 1 item 6 line.

- [ ] **Step 5: Commit**

```bash
git add tests/review-pr-body-deliverables.test.js plugin/skills/review/code-mode-steps.md
git commit -m "Check PR-body deliverables against the live PR body at review Step 1 — #5340"
```

### Task 2: Build makes a PR-body claim true before logging it

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/build/architecture-alignment.md` (new section before `## Skip this step if`)
- Test: `tests/build-pr-body-claim.test.js` (create)

**Interfaces:**
- Consumes: `readText` from `tests/helpers/read-skill.js`; `missingFactsOf`, `assertEachPatternGoesRed`, `sectionOf` from `tests/helpers/conformance-asserts.js`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test** `tests/build-pr-body-claim.test.js`

Region: `sectionOf(TEXT, '## Claims about the PR body')`. Fact list (non-global), each matching once in the region:

```js
const FACTS = [
  [/applies to every build decision line, not only this step's rows/, 'scope: every build decision line'],
  [/edit it into the body before logging the line/, 'edit before log'],
  [/`pr\.number` in `run-state\.json` \(a bundle's parent run dir\), else the current branch's PR/, 'PR source matches review Step 1'],
  [/`gh pr view \{pr\} --json body -q \.body`, or `mcp__github__pull_request_read` without `gh`/, 'read command, both transports'],
  [/append the content below the `<!-- fixes-end -->` marker without touching its run markers/, 'placement outside rewritten spans'],
  [/`gh pr edit \{pr\} --body-file \{file\}`, or `mcp__github__update_pull_request`/, 'write command, both transports'],
  [/re-read it to confirm your content is there/, 'read back'],
  [/Bundle members share one PR, so if a concurrent edit dropped it, edit once more/, 'concurrent bundle writers'],
  [/log that the PR body does not carry it — never the claim/, 'failed edit logs the absence'],
];
```

Tests:
- `the PR-body claim section states every fact`: `deepEqual(missingFactsOf(FACTS)(region), [])`.
- `each fact can go red`: `assertEachPatternGoesRed(region, FACTS, missingFactsOf(FACTS))`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/build-pr-body-claim.test.js`
Expected: FAIL — `sectionOf` throws because the `## Claims about the PR body` heading is absent.

- [ ] **Step 3: Edit `plugin/skills/build/architecture-alignment.md`**

Insert this exact section directly before the `## Skip this step if` heading, with one blank line on each side:

```
## Claims about the PR body

This applies to every build decision line, not only this step's rows. When a resolution or decision line would say the PR body carries something (a measured number, a named shortfall, a list left as-is), edit it into the body before logging the line. `{pr}` is found as review Step 1 finds it: `pr.number` in `run-state.json` (a bundle's parent run dir), else the current branch's PR. Read the body (`gh pr view {pr} --json body -q .body`, or `mcp__github__pull_request_read` without `gh`), append the content below the `<!-- fixes-end -->` marker without touching its run markers, write it back (`gh pr edit {pr} --body-file {file}`, or `mcp__github__update_pull_request`), and re-read it to confirm your content is there. Bundle members share one PR, so if a concurrent edit dropped it, edit once more. If the edit cannot land (no PR, or the write fails), log that the PR body does not carry it — never the claim. #5297's build logged "PR body names them" while PR #5299's body never did.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/build-pr-body-claim.test.js tests/build-skip-degrade-trace-adoption.test.js tests/build-contract-beats-spec-literal.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add tests/build-pr-body-claim.test.js plugin/skills/build/architecture-alignment.md
git commit -m "Make build's PR-body claims true before logging them — #5340"
```
