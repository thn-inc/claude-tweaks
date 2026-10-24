# Release Review-Tree Check (#4012) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:release` Step 3 accepts a main checkout whose only unpushed commits are run-dir archive commits, and when it does stop on a diverged checkout, it prints the ahead/behind counts and the commands that fix it.

**Architecture:** One prose change to `plugin/skills/release/SKILL.md` Step 3. The "standing at the fetched tip" paragraph swaps its exact `rev-parse HEAD == origin/{branch}` equality for one `bash` fence: on `{branch}`, 0 commits behind, and no tree difference outside `.claude-tweaks/pipelines/`. Exact equality is the special case where the diff is empty. The stop line gains counts and recovery commands, and the Step 3 marker log line names both shas when they differ. A new conformance suite extracts the fence and runs it against real fixture repos.

**Tech Stack:** Markdown skill prose, bash, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T103516-spec-3898-4012-4041/spec-4012/work/4012-spec.md`

## Global Constraints

- Edit only Step 3 of `plugin/skills/release/SKILL.md`. Sibling #3898 owns Step 0 and Step 8 on this branch. Sibling #4041 builds next and owns Step 5 and `execute.md`, so leave `execute.md` alone, even though its `--as` anchor (`execute.md:96-111`) also requires exact equality.
- The pathspec is exactly `':!.claude-tweaks/pipelines'` (Deliverable 1). The recovery commands are exactly `git -C "$RUN_ROOT" pull --rebase origin {branch}`, then a bare `git push origin {branch}` (Deliverable 2).
- The stop reason keeps its literal text `review tree is not origin/{branch}`, and Step 8's summary still reads `failed` with it.
- Every skill reference in actionable text uses `/claude-tweaks:{skill}` (`tests/release-skill-reference-form.test.js`).

## Review Focus

1. A checkout on the wrong branch must not be told to `pull --rebase origin {branch}`, because that would rebase the wrong branch. Its stop line names the current branch and the `switch` recovery instead. Pinned in Task 1.
2. A checkout both ahead (run-dir only) and behind still stops, because 0 behind is required. Fixture row "diverged run-dir-only" in Task 1.
3. A commit outside run dirs that a later commit reverts leaves the tree identical. The tree-diff check passes it, which is correct, since the review gates the tree it stands in. This is the one intended gap between Deliverable 1's tree diff and AC2's "any commit" wording, and it is stated in the paragraph.
4. Uncommitted working-tree changes are outside this check, as they are today (`git diff` compares two commits). This is not a regression.
5. The marker line keeps `## /review marker: {k} existing lines` verbatim, ahead of the new optional clause, because `disposition.md` and Step 3's own read key on `{k}`.

## Spec Coverage and Authoring Checks

- Waived AC4.1: `npm test` is the build's full-suite gate (Common Step 5, `plugin/bin/verify.js`), not a task test step.
- **Behavioral claim:** reconcile archival commits locally and never pushes. The commit is at `plugin/bin/lib/reconcile/archive-merged.js:1347` (`commitGit(['commit', '-m', \`[reconcile] archive run ${runId}\`, …])`), and `grep -n "push" archive-merged.js` finds no git push.
- **Verbatim-command run-once:** run in this worktree (19 ahead, 0 behind, run commits touch `plugin/`):
  - `git rev-list --left-right --count HEAD...origin/main` → `19	0`.
  - `git diff --quiet origin/main HEAD -- ':!.claude-tweaks/pipelines'` → exit 1.
  - The same diff with `':!plugin' ':!tests' ':!docs'` added → exit 0, which shows the exclusion magic works with git 2.56.
- **Moved-prose pins:**
  - `git grep -n -F "standing at the fetched tip" -- tests plugin` → only `release/SKILL.md:154`.
  - `git grep -n -F "existing lines" -- tests plugin` → only `release/SKILL.md:158,161`.
  - No test pins either.
- **Byte-pin:** `release/SKILL.md` is 45679 B. This task adds about 900 B, leaving about 5.9 KB under `RAIL_BYTES` 52500.

---

### Task 1: Step 3 review-tree check tolerates run-dir-only commits ahead

**Files:**
- Modify: `plugin/skills/release/SKILL.md:154` (the "Invoke it from `$RUN_ROOT`, standing at the fetched tip." paragraph) and `:161` (the marker line)
- Create: `tests/release-review-tree-check-conformance.test.js`

**Interfaces:**
- Produces:
  - A `bash` fence inside Step 3 that contains `rev-list --count HEAD..origin/{branch}`. It exits 0 exactly when the review tree is acceptable, and reads `$RUN_ROOT` from the environment.
  - The stop line `stopped before the console: review tree is not origin/{branch} ({ahead} ahead, {behind} behind)`.
  - The optional marker clause `; review tree HEAD {head-sha} is origin/{branch} {tip-sha} plus run-dir-only commits`.

- [ ] **Step 1: Write the failing tests** in `tests/release-review-tree-check-conformance.test.js`. Use `readText` (`tests/helpers/read-skill`) and `originWithTwoClones`/`FIXTURE_TIMEOUT_MS` (`tests/helpers/git-fixtures`).
  - **Extraction:** slice `## Step 3` up to the next `## ` heading. Take the one fenced `bash` block (`/```bash\r?\n([\s\S]*?)```/g`) that contains `rev-list --count HEAD..origin/{branch}`, and throw `extraction pattern is out of sync` when there is none. Replace `{branch}` with `main`.
  - **Runner:** `spawnSync('bash', ['-c', fence], { env: { ...fx.env, RUN_ROOT: fx.work }, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS })`, returning the exit status.
  - **Fixture rows:** one `originWithTwoClones` per row, removed in `finally`. Make "behind" by committing in `other` and pushing. Make "ahead" by committing in `work` without pushing. A run-dir commit writes `.claude-tweaks/pipelines/archive/r1/x.md`. Every row asserts its exit:

    | test | state of `work` | exit |
    |---|---|---|
    | `AC1.1: equal to origin passes` | as cloned | 0 |
    | `AC1.1: run-dir-only commits ahead, 0 behind, passes` | 2 run-dir commits ahead | 0 |
    | `AC2.1: behind origin stops` | other pushed 1 commit | non-zero |
    | `AC2.1: diverged run-dir-only stops` | 1 run-dir commit ahead and 1 behind | non-zero |
    | `AC2.2: a commit outside run dirs stops` | 1 run-dir commit and 1 commit to `src.txt` ahead | non-zero |
    | `AC2.1: wrong branch stops` | `switch -c feature` at origin's tip | non-zero |
  - **`test('AC3.1: go-red: dropping the pathspec exclusion stops the run-dir-only row')`:** remove `-- ':!.claude-tweaks/pipelines'` from the fence and assert the string changed. Then assert the "run-dir-only commits ahead" row now exits non-zero.
  - **`test('AC2.3/AC3.1: stop line names counts and recovery commands')`:** a `missingFactsOf(stepThree)` over these patterns returns `[]`, and stripping each pattern's match returns exactly `[fact]`:
    - `/review tree is not origin\/\{branch\} \(\{ahead\} ahead, \{behind\} behind\)/`
    - `/git -C "\$RUN_ROOT" pull --rebase origin \{branch\}/`
    - `/bare .git push origin \{branch\}./` (each `.` matches one backtick)
    - `/rev-list --left-right --count HEAD\.\.\.origin\/\{branch\}/`
    - `/switch \{branch\}/`
  - **`test('marker line keeps {k} and adds the two-sha clause')`:** Step 3 still contains `## /review marker: {k} existing lines` and contains `review tree HEAD {head-sha} is origin/{branch} {tip-sha} plus run-dir-only commits`.
- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/release-review-tree-check-conformance.test.js`
Expected: FAIL with `extraction pattern is out of sync` (Step 3 has no `bash` fence carrying `rev-list --count HEAD..origin/{branch}` yet).
- [ ] **Step 3: Rewrite the Step 3 paragraph and marker line** in `plugin/skills/release/SKILL.md`.
  - **Paragraph:** keep the bold lead `**Invoke it from \`$RUN_ROOT\`, standing at the fetched tip.**` and the existing sentence about `/claude-tweaks:review`'s test gate. Replace the three-assertion sentence with "Fetch, then run this check; it exits 0 exactly when the review may run:" and this fence:
    ```bash
    git -C "$RUN_ROOT" fetch origin {branch}
    [ "$(git -C "$RUN_ROOT" rev-parse --abbrev-ref HEAD)" = "{branch}" ] \
      && [ "$(git -C "$RUN_ROOT" rev-list --count HEAD..origin/{branch})" = 0 ] \
      && git -C "$RUN_ROOT" diff --quiet origin/{branch} HEAD -- ':!.claude-tweaks/pipelines'
    ```
  - **After the fence**, one sentence on why commits ahead are tolerated: reconcile's `[reconcile] archive run …` commits (`plugin/bin/lib/reconcile/archive-merged.js`) land on local `{branch}` unpushed and move only files under `.claude-tweaks/pipelines/`, which never ships. It is a tree comparison, so a change made and then reverted outside run dirs passes, because the review gates the tree it stands in.
  - **Then the stop.** Any non-zero exit stops the run before Step 4. Read the counts with `git -C "$RUN_ROOT" rev-list --left-right --count HEAD...origin/{branch}` (`{ahead}\t{behind}`), report `stopped before the console: review tree is not origin/{branch} ({ahead} ahead, {behind} behind)`, and name the recovery: `git -C "$RUN_ROOT" pull --rebase origin {branch}`, then a bare `git push origin {branch}` from the main checkout. When HEAD is not on `{branch}`, the stop line names the current branch instead of counts, and the recovery is `git -C "$RUN_ROOT" switch {branch}`. Step 8's summary reads `failed` with the same reason, as today.
  - **Marker line (`:161`):** after `## /review marker: {k} existing lines`, add `{; review tree HEAD {head-sha} is origin/{branch} {tip-sha} plus run-dir-only commits}`, keeping `. Reversibility: n/a (marker).`. Follow it with one sentence saying the clause is written only when `rev-parse HEAD` and `origin/{branch}` differ, so the review's test-gate evidence traces to the tagged tip.
- [ ] **Step 4: Run the tests to verify they pass**
  Run: `node --test tests/release-review-tree-check-conformance.test.js tests/release-skill-reference-form.test.js tests/release-run-dir-lifecycle-conformance.test.js`
  Expected: PASS, 0 failures.
- [ ] **Step 5: Commit**
  ```bash
  git add plugin/skills/release/SKILL.md tests/release-review-tree-check-conformance.test.js
  git commit -m "Accept run-dir-only commits ahead at release Step 3 — print counts and recovery on a diverged tree (refs #4012)"
  ```
