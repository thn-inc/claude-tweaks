# Settle 3 reflect digest findings (#4817) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `closing-links.js --mode post-merge` prove the PR is this run's before it reopens or closes anything on a base positively known to be non-default, and record the three learnings in their project skills.

**Architecture:** One `refuseForeignPr(text)` helper inside `run()` in `plugin/bin/closing-links.js` replaces the inline pre-merge run-marker check (step 7a). Post-merge calls the same helper only when `nonDefaultBase` is true (base read, default branch read, and they differ), before its reopen loop (8b) and close loop (9b). A default base and an unreadable base (`baseUnchecked`) both skip the proof, unchanged. The exit-4 contract statements are swept in the same change, and the Step 4.0 caller reports exit 4 as a run-marker mismatch naming the PR, with no hand close. The three skill edits are prose only.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T085046-record-4817/work/4817-spec.md`

## Global Constraints

- Commit subjects use `{Verb} {what} — {detail}` and end with `refs #4817`. Never write "closes", "fixes" or "resolves" next to `#4817`.
- Spec Decision (Reading A): "the marker check runs when the PR merged into a base other than the default branch, ahead of both that path's reopens and its 9b closes. Default-base post-merge reopens (step 8b, #4199) deliberately stay unproven".
- Spec Decision (round 2, Q1, Reading A): "When `closing-links.js --mode post-merge` cannot read the PR's base (no `baseRefName`, or `gh repo view` fails — the `baseUnchecked` case), treat it like the default base: no run-marker proof, behaviour unchanged, and a test pins it."
- Spec Decision (round 2, Q2, Reading B): "On exit 4 (run-marker mismatch), `_shared/pr-first-merge-post-merge.md` Step 4.0's closing summary names only the mismatch and the PR number, and asks for no hand close of the PR's `Fixes` records (they may belong to another run)."
- Governing rule, quoted verbatim from `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (Task 1 adds exit 4 to post-merge): "**Changing an existing CLI's exit code is a contract change — sweep every statement of the old code before calling it done.** The code lives in more places than the branch you edit: the file's header comment, a sibling module's comment that justifies its own code by analogy, `docs/`, `_shared/` prose, and this sub-file's own summaries."
- Governing rule, quoted verbatim from the same file: "**A module that calls a CLI's `run(argv, deps)` in-process and branches on one of its exit codes imports that code from the CLI, and so does any bound it re-applies.**" `plugin/bin/lib/reconcile/post-merge.js` branches only on `EXIT_GH_FAILURE`; exit 4 already falls into its "every other exit is deterministic" arm, so only its comment changes.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Already satisfied (verified on base `242eca7b4`)

- **Deliverable 2, workflow half.** `.github/workflows/test.yml` line 39 already runs `sudo apt-get update && sudo apt-get install -y zsh` (added in `10d0ae628`, #4823). Task 2 records the learning in the skill; the workflow needs no edit.
- **AC2 ("Each promoted entry line in #1426 carries this record's ref").** Each of the three promoted #1426 entry lines already ends with `→ #4817` (live digest comment https://github.com/thn-inc/claude-tweaks/issues/1426#issuecomment-6547466846). No code produces this, so there is no test to write.

Waived AC2: already satisfied on the live digest comment (each of the three promoted lines ends with `→ #4817`); no code path to test.
Waived .github/workflows/test.yml: already installs zsh on base (`10d0ae628`, #4823); no edit owed.
- **AC1** ("Each deliverable is fixed, or closed out with its reason recorded on this record") is covered by Task 1 (deliverable 1, code half), Task 2 (deliverables 1-3, skill half) and the note above (deliverable 2, workflow half). The record comment is written at wrap-up.

## Review Focus

1. A merged PR on a **non-default base** whose body's first line names **another run**: exit 4, no `issue reopen`, no `issue close`, no issue reads, one `/wrap-up` SKIP. (Task 1 test `#4817 AC1.1`.)
2. The same with **no marker line**: exit 4 with `body names run none`. (Task 1 test `#4817 AC1.1 (no marker)`.)
3. A **default-base** merged PR with a foreign marker: unchanged, still reopens a deferred record. Only the `nonDefaultBase` half of the guard decides it. (Task 1 test `#4817 guard`.)
4. An **unreadable default branch** with a foreign marker (`baseUnchecked`): unchanged, exit 0, still reopens, `baseUnchecked: true`. A guard written `nonDefaultBase || baseUnchecked` turns it red. (Task 1 test `#4817 guard (base unchecked)`.)
5. A stale statement elsewhere that exit 4 is pre-merge only — including `docs/plugin-structure.md`'s closing-links row, whose line does contain `closing-links`, and two that do not (`post-merge.js`, `reconcile-checks.md`). Task 1 Step 6 sweeps all of them.

---

### Task 1: Run-marker proof before post-merge's non-default-base writes

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/closing-links.js`: header lines 50-62 (the #4549 paragraph) and 68-69, `USAGE` line 104, step 7a (lines 291-301), and a new step after line 378 (`const nonDefaultBase = …`)
- Modify: `plugin/bin/lib/reconcile/post-merge.js:31-33` (header comment only)
- Modify: `docs/reconcile-checks.md:666` (`exit 4 is pre-merge only`)
- Modify: `docs/plugin-structure.md:192` (the closing-links row's `4 run-marker mismatch (pre-merge, …)` clause)
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md` Step 4.0 (lines 32-33, the `Exit\n5 or \`gh-absent\`` sentence)
- Test: `tests/bin-lib/flow/closing-links-cli.test.js`
- No change (behavior-change prose sweep, `grep -rln -i "non-default base\|nonDefaultBase" docs/journeys plugin/skills`): `docs/journeys/keep-a-deferred-record-open-when-its-bundle-pr-merges-4199.md:61`, `docs/journeys/keep-a-run-dir-until-every-record-its-merged-pr-left-open-ships-3503.md:62`, `docs/journeys/close-a-below-floor-decomposition-parent-4466.md:59,66,83`, `plugin/skills/init/bootstrap/step-16-non-default-branch-issue-tracking.md:44` describe a run's own PR closing its `Fixes` records on a non-default base, which still holds; none states that post-merge never exits 4.
- Headroom: `plugin/skills/_shared/pr-first-merge-post-merge.md` is 21,768 B on base against the 52,500 B rail; Step 6 adds about 220 B.

**Interfaces:**
- Produces: `refuseForeignPr(text: string) → null | 4`, local to `run()` in `plugin/bin/closing-links.js`. Returns `null` when `firstLineRunId(text) === runId`. Otherwise writes the existing stderr line `closing-links.js: run marker mismatch on PR #${n}: body names run ${found || 'none'}, expected ${runId} — nothing written\n`, calls `unchecked('exit 4 run marker mismatch')`, and returns `4`.

- [ ] **Step 1: Write the failing tests**

Add an `EXIT_SITES` row right after the existing pre-merge exit-4 row (line ~1275; `FIXES_ONLY` / `NON_DEFAULT` / `OPEN_ISSUE` are defined above `EXIT_SITES`). The characterization, `/wrap-up` SKIP and failed-append tests then cover it unchanged:

```js
  {
    name: 'exit 4 run marker mismatch (post-merge, non-default base)', code: 4, mode: 'post-merge',
    opts: { prReads: [mergedView(body({ runId: FOREIGN_RUN_ID, span: FIXES_ONLY }), [], NON_DEFAULT)], issues: { 3997: [OPEN_ISSUE] } },
    stderr: `closing-links.js: run marker mismatch on PR #7: body names run ${FOREIGN_RUN_ID}, expected ${RUN_ID} — nothing written\n`,
    condition: 'exit 4 run marker mismatch',
  },
```

Add four tests after the test `post-merge non-default: an issue view with no string state is closeFailed with stage read, never closed or counted`:

```js
// ---- #4817: post-merge proves the PR is this run's before any non-default-base write ----

test('#4817 AC1.1: post-merge on a non-default base refuses another run\'s PR — exit 4, no reopen, no close, no issue read', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ runId: FOREIGN_RUN_ID }), [2724, 3997], NON_DEFAULT)],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }], 3997: [OPEN_ISSUE] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 4);
  assert.equal(h.out.join(''), '');
  assert.match(h.err.join(''), /run marker mismatch on PR #7: body names run 2026-01-01T000000-record-9/);
  assert.equal(h.reopens().length, 0);
  assert.equal(h.closes().length, 0);
  assert.equal(h.issueReads().length, 0);
});

test('#4817 AC1.1 (no marker): a non-default-base body with no run-marker line is exit 4, body names run none', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const noMarker = body({ span: FIXES_ONLY }).split('\n').slice(1).join('\n');
  const h = makeDeps(main, { prReads: [mergedView(noMarker, [], NON_DEFAULT)], issues: { 3997: [OPEN_ISSUE] } });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 4);
  assert.match(h.err.join(''), /body names run none, expected 2026-10-25T000001-record-4199/);
  assert.equal(h.closes().length, 0);
});

test('#4817 guard: a default-base post-merge does not check the marker — a foreign body still reopens a deferred record', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ runId: FOREIGN_RUN_ID }), [2724, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  assert.equal(h.json().action, 'reopened');
  assert.equal(h.reopens().length, 1);
});

test('#4817 guard (base unchecked): an unreadable default branch is treated like the default base — a foreign body still reopens, no exit 4', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ runId: FOREIGN_RUN_ID }), [2724, 3997], NON_DEFAULT)],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }] },
    defaultBranchThrows: true,
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.baseUnchecked, true);
  assert.equal(h.reopens().length, 1);
  assert.equal(h.closes().length, 0);
  assert.doesNotMatch(h.err.join(''), /run marker mismatch/);
});
```

Both `guard` tests pass before the change and must keep passing. `#4817 guard` pins the `nonDefaultBase` half: dropping that condition turns it red with exit 4. `#4817 guard (base unchecked)` pins Reading A for the unreadable base: widening the condition to `nonDefaultBase || baseUnchecked` turns it red with exit 4. The two `AC1.1` tests pin the marker half: deleting the post-merge `refuseForeignPr` call turns them red, because the run reopens #2724 and closes #3997.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="4817|exit 4 run marker mismatch|characterization|AC3.1|failed SKIP append" tests/bin-lib/flow/closing-links-cli.test.js`
Expected: FAIL after Step 1. Both `#4817 AC1.1` tests exit 0 instead of 4, and the characterization, `AC3.1` and failed-SKIP-append tests fail on the new `EXIT_SITES` row. Both `guard` tests pass.

- [ ] **Step 3: Implement `refuseForeignPr` and the post-merge call in `plugin/bin/closing-links.js`**

Define `refuseForeignPr` once, right after `unchecked`/`ghFailed` are defined (both modes need it; it uses `n`, `runId`, `deps.stderr`, `unchecked`). In step 7a, replace the inline `firstLineRunId(newBody)` comparison and its three-line refusal with `const refused = refuseForeignPr(newBody); if (refused !== null) return refused;`, keeping the 7a comment. After `const nonDefaultBase = …` (line 378), add a step `7c` with a comment ("GitHub closes nothing on a non-default base, so this pass writes there: its reopens and the 9b closes. Prove the PR is this run's first, as 7a does (#4817). A default or unreadable base skips the proof (Reading A).") and `if (nonDefaultBase) { const refused = refuseForeignPr(pr.body); if (refused !== null) return refused; }`. Guard on `nonDefaultBase` alone, never on `baseUnchecked`. Post-merge does not rewrite the body, so it checks `pr.body` as read.

- [ ] **Step 4: Run the whole file to verify it passes**

Run: `node --test tests/bin-lib/flow/closing-links-cli.test.js`
Expected: PASS, all tests. The existing non-default reopen, close, closeFailed and baseUnchecked tests use `body()`'s default `RUN_ID` marker, so they still reach their checks. The `--help` test's `/4 run marker mismatch/` still matches the reworded `USAGE` line.

- [ ] **Step 5: Reword the exit-4 contract in the CLI's own text**

In `plugin/bin/closing-links.js`:
- Header lines 68-69 become: `// 4 run-marker mismatch (pre-merge; post-merge on a base known to differ from the default branch, before any reopen or close): the PR body's first line names a different run (or none) -- refused, nothing written.`
- At the end of the header's #4549 paragraph (after "…and omits closingSet."), add: `Before any reopen or close on a base known to be non-default it proves the PR is this run's, as pre-merge does (exit 4, #4817); a default or unreadable base skips that proof.`
- `USAGE` line 104 becomes: `'       4 run marker mismatch (pre-merge; post-merge on a non-default base) -- refused, nothing written\n'`.

- [ ] **Step 6: Sweep every other statement of exit 4 and update the Step 4.0 caller**

Run: `grep -rn -i -E "pre-merge only|4 pre-merge|run-marker mismatch \(pre-merge" plugin docs .claude/skills`
Fix each hit outside `docs/superpowers/plans/`. On base the hits are these three (two of them carry no `closing-links` token on the matched line, so a grep filtered on `closing-links` misses them):
- `plugin/bin/lib/reconcile/post-merge.js:32-33`: `4 pre-merge\n// only)` becomes `4 run marker mismatch)`, re-wrapped to the comment's width.
- `docs/reconcile-checks.md:666`: `exit 4 is pre-merge only.` becomes `exit 4 (run marker mismatch: pre-merge, or post-merge on a base known to be non-default) is deterministic too.`, re-wrapped to the paragraph's width.
- `docs/plugin-structure.md:192`, the closing-links row: `4 run-marker mismatch (pre-merge, checked before any PR write, re-read or outcome line)` becomes `4 run-marker mismatch (pre-merge, checked before any PR write, re-read or outcome line; post-merge on a base known to be non-default, checked before any reopen or close — a default or unreadable base skips it)`.

In `plugin/skills/_shared/pr-first-merge-post-merge.md` Step 4.0 (lines 32-33), replace `Exit\n5 or \`gh-absent\`: the CLI logged its own \`SKIP\` line;` with `Exit 4\n(run-marker mismatch: the PR body names another run, so nothing was reopened or closed): name the mismatch and PR #{n} in the closing summary, and ask for no hand close of its \`Fixes\` records, which may belong to that run. Exit 4, exit 5 or \`gh-absent\`: the CLI logged its own \`SKIP\` line;`. Keep the paragraph's other line breaks.

Re-run the grep. Expected: outside `docs/superpowers/plans/`, no `pre-merge only` or `4 pre-merge` hit remains, and the only `run-marker mismatch (pre-merge` hits are `plugin/bin/closing-links.js:68` and `docs/plugin-structure.md:192`, each now naming the post-merge non-default-base case (`grep -c "post-merge on a base known to be non-default" docs/plugin-structure.md` prints `1`).

- [ ] **Step 7: Run the suites that read these files**

Run: `node --test tests/bin-lib/flow/closing-links-cli.test.js tests/closing-links-prose-conformance.test.js tests/bin-lib/reconcile/post-merge.test.js tests/post-merge-run-cli.test.js tests/pr-first-merge.test.js tests/below-floor-parent-close-conformance.test.js tests/reconcile.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/closing-links.js plugin/bin/lib/reconcile/post-merge.js docs/reconcile-checks.md docs/plugin-structure.md plugin/skills/_shared/pr-first-merge-post-merge.md tests/bin-lib/flow/closing-links-cli.test.js
git commit -m "Prove run ownership before post-merge closes — closing-links.js refuses a foreign PR on a non-default base, refs #4817"
```

### Task 2: Record the three learnings in their project skills

**Role:** transcription

**Files:**
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md`: a new bullet directly after line 28's bullet (`- **Text a module writes into a PR body names no record it does not mean to close.**`)
- Modify: `.claude/skills/windows-checkout-test-parity/SKILL.md`: a new `## Project Conventions` bullet directly after line 150 (`- A platform branch with no Linux-runnable pin …`)
- Modify: `.claude/skills/skill-prose-conformance-tests/executable-snippet-pins.md`: line 11's `(ubuntu CI)` clause, and a new paragraph directly after line 37's paragraph (`**A fence that captures a \`node -e\` result in a variable owes its could-not-read arm a run of its own.**`)

**Interfaces:**
- Consumes: Task 1's `refuseForeignPr` name and its `#4817` test names, cited by the gh-api bullet.

- [ ] **Step 1: Confirm none of the three texts exists yet**

Run: `grep -c "carries the same proof" .claude/skills/gh-api-module-pattern/SKILL.md`
Expected: FAIL. It prints `0` and exits 1.

- [ ] **Step 2: Insert the gh-api-module-pattern bullet, verbatim**

```markdown
- **A write path added to a CLI that already proves run ownership before its first write carries the same proof.** `plugin/bin/closing-links.js --mode pre-merge` reads the PR body's first-line run marker (`firstLineRunId`) and refuses a foreign or marker-less PR with exit 4 before it edits anything (#4199). #4549 then gave `--mode post-merge` writes of its own on a non-default base, closing the `Fixes` records with `gh issue close` after its reopens, and shipped them without that check, so a run whose `run-state.json` pointed at another run's PR would have reopened and closed records that run never claimed. #4817 put the same proof ahead of both, through one `refuseForeignPr` helper the two modes share. Scope the proof to the new write's path, not the whole verb: post-merge proves ownership only on a base known to be non-default, and a default-base or unreadable-base run (step 8b's reopens, #4199) skips it, so the reconciler's late runs gain no new exit 4 and a transient base-read failure is never misread as a deterministic mismatch. When you add a write to a CLI, find the proof its existing writes already pass (a run-marker read, a claim check, an anchored `--run`), put the new write behind it, and pin both a foreign-owner fixture that shows the new write refused and one that shows the unguarded path unchanged (`tests/bin-lib/flow/closing-links-cli.test.js`'s `#4817` cases).
```

- [ ] **Step 3: Insert the windows-checkout-test-parity bullet, verbatim**

```markdown
- A test that pins one shell's behaviour skips where that shell is missing, and a skip on the merge gate is the same blind spot as a platform branch with no pin: the workflow has to install the shell. `ubuntu-latest` ships no zsh, so the zsh cases in `tests/wrap-up-closing-records-array-fill.test.js` (the zsh-only word-split defect, #4107) skipped on CI until #4823 added `sudo apt-get install -y zsh` to `.github/workflows/test.yml`. When you add a test that skips on a missing shell or tool, add its install step to `test.yml` in the same change, and check the PR's CI log to confirm the case ran rather than skipped.
```

- [ ] **Step 4: Update executable-snippet-pins line 11 and insert the go-red paragraph, verbatim**

On line 11, replace `Skip the zsh case with a visible reason when zsh is not on PATH (ubuntu CI), never silently,` with `Skip the zsh case with a visible reason when zsh is not on PATH, never silently (CI installs zsh, \`.github/workflows/test.yml\`, #4823, so the skip fires only on a host without it),`.

Insert this paragraph after line 37's paragraph, separated by blank lines:

```markdown
**A go-red control for a fence that branches on a `node -e` exit status has to flip that exit outcome.** When the live fence's correct behaviour is a non-zero exit (`RECORDS=$(node -e '…') || exit 1` on an unreadable directory, or an `if node -e '…'; then` guard taking its else arm), a control that breaks the node script instead also exits non-zero: a syntax error, a misspelled `require` or a thrown `TypeError` all do. That control passes for a reason unrelated to the clause it claims to test. Mutate the branch itself: drop the `|| exit 1`, invert the condition, or make the script exit 0 where the live one exits 1. Then assert that the observable outcome changed, both the exit status and a line only one arm prints (such as the `count=` line the could-not-read case above checks). A status-only assertion cannot tell the guarded failure from a crash.
```

- [ ] **Step 5: Verify all three texts landed**

Run: `grep -c "carries the same proof" .claude/skills/gh-api-module-pattern/SKILL.md && grep -c "the workflow has to install the shell" .claude/skills/windows-checkout-test-parity/SKILL.md && grep -c "has to flip that exit outcome" .claude/skills/skill-prose-conformance-tests/executable-snippet-pins.md && grep -c "(ubuntu CI)" .claude/skills/skill-prose-conformance-tests/executable-snippet-pins.md`
Expected: `1`, `1`, `1`, then `0`. The last grep exits 1, which is the expected result: the stale clause is gone.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/gh-api-module-pattern/SKILL.md .claude/skills/windows-checkout-test-parity/SKILL.md .claude/skills/skill-prose-conformance-tests/executable-snippet-pins.md
git commit -m "Record three reflect learnings — run-ownership proof, CI shell install, exit-flipping go-red, refs #4817"
```
