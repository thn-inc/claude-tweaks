# Worktree Teardown After a Squash Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the worktree-teardown merged-content proof match the merge shape that actually ships under `integration-model: pr-first` (squash), and give the own-worktree teardown path a remote-branch delete that survives `ExitWorktree(remove)`.

**Architecture:** Two independent, surgical fixes in the same cleanup procedure. (1) `plugin/skills/wrap-up/cleanup-procedures-execution.md` Section C's ancestry-check paragraph gets split into two proofs — the existing ancestry check for `local-merge` (`--no-ff`/fast-forward), and a new content-diff-against-the-PR's-merge-commit proof for `pr-first` (squash/rebase) — with the false "holds for squash/rebase merges alike" claim removed. A one-line cross-reference is added to `plugin/skills/_shared/scratch-worktree.md` §6 explaining why that section's own ancestry check doesn't need the same correction (its callers never reach it via a squash merge). (2) `plugin/bin/lib/hooks/teardown-run.js`'s branch resolution gets one additional fallback — reading `run-state.json`'s `pr.branch` directly (already written by `record-pr` since #1672) when no worktree was ever recorded and the local branch is already gone — so the remote-ref-delete step can still find the branch name. Section C gets a new step 5.5 that calls the existing `teardown-run --merged` command for the own-worktree path too, now that nothing live remains for it to conflict with.

**Tech Stack:** Markdown skill-prose files (read, not executed, by Claude Code sessions) + a Node.js CLI module (`plugin/bin/lib/hooks/teardown-run.js`) tested via `node --test`.

**Spec:** `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-3088/.claude-tweaks/pipelines/2026-10-15T184008-record-3088/work/3088-spec.md` (materialized from GitHub issue #3088)

## Global Constraints

- Commit message style: `{Verb} {what} — {detail}` (imperative, no conventional-commit prefixes).
- `_shared/*.md` files are cross-skill contracts — a changed claim must be corrected once, at its canonical source, and other files that cite it (never restate it) need no change.
- Tests run via `node --test <file>` (no external test framework); the existing suites use plain `node:test`/`node:assert`.
- Do not touch `git/refs/heads` literal text outside `plugin/skills/_shared/pr-first-merge-post-merge.md` — an existing conformance test (`tests/scratch-worktree-remote-branch-delete.test.js`) pins that string to exactly one file.
- Working directory is already an isolated worktree (`/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-3088`) — do not create another worktree.
- Never run `git stash`/`git stash pop` — compare against a baseline via `git show <rev>:<path>`, or set work aside with a temporary WIP commit instead.
- Run `npm test` and every other long-running command in the foreground, output redirected to a file if long — never `run_in_background`, and never end a turn waiting on a background run or a child agent's completion notification.

## Review Focus

- **A real `teardown-run` invocation against a repo whose `origin` remote is SSH-form (`git@github.com:owner/repo.git`)** must still resolve `owner`/`repo`/`host` correctly for the remote-ref delete — the existing `repoSpecOf()` already handles this; a reasonable person would expect the new fallback path to use the same resolution, not a parallel one. Task 3's test reuses the existing `fixtureRepo()` helper's SSH-form remote, so this is exercised by construction.
- **A run whose `run-state.json` carries a `pr` field but no `branch` sub-field** (an older run created before #1672, or `record-pr`'s `deriveBranch` returning `null`) must not crash — it should behave exactly as it did before this change (branch stays unresolved, "no branch recorded"). Task 3's new fallback line is itself null-safe (`typeof ... === 'string'` guard), but the task's test step should confirm the existing AC8b/AC9 tests (which cover this exact absent-`pr`-field shape) still pass unmodified.
- **The integration branch itself recorded as `pr.branch`** (a degenerate/corrupted state) must still refuse the delete — the existing `isIntegrationBranch` guard in `teardown-run.js` runs after branch resolution regardless of which fallback produced the name, so this is already covered structurally; Task 3's test should not assume otherwise without checking.
- **A reader of the new Section C prose who has `integration-model: local-merge`** should not be told to run a `gh pr view` call that makes no sense for their setup — the corrected paragraph must lead with the `integration-model` that governs which proof applies, not assume `pr-first` as a silent default.
- **A `gh pr view --json mergeCommit` call for a PR that was merged via `--rebase` rather than `--squash`** — the spec and deliverables only mention squash explicitly, but `pr-first-merge.md` Step 3 only ever uses `--squash` (confirmed: `grep -n '\-\-rebase' plugin/skills/_shared/pr-first-merge.md` finds nothing) — so the corrected prose should name squash specifically rather than overclaiming rebase coverage it was never asked to prove; this is a wording precision point, not a missing test.

---

### Task 1: Correct the false squash/rebase ancestry claim in Section C

**Files:**
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md:180-197`
- Test: `tests/scratch-worktree-remote-branch-delete.test.js`

**Interfaces:**
- Consumes: nothing from other tasks (prose-only; independent of Task 2 and Task 3).
- Produces: the corrected two-proof paragraph in Section C, cited (never restated) by anything that references it later.

- [ ] **Step 1: Write the failing test**

Add this test to the end of `tests/scratch-worktree-remote-branch-delete.test.js` (the file already imports `CLEANUP_PROCEDURES_EXECUTION`, `path`, `assert`, `test` at the top — no new imports needed):

```javascript
test('cleanup-procedures-execution.md Section C no longer claims the ancestry check holds for squash/rebase merges, and gives pr-first its own proof', () => {
  const sectionC = CLEANUP_PROCEDURES_EXECUTION.indexOf('## C. Git Worktree');
  const sectionD = CLEANUP_PROCEDURES_EXECUTION.indexOf('## D. Ephemeral dev server');
  assert.ok(sectionC > 0 && sectionD > sectionC, 'Section C must exist and precede Section D');
  const section = CLEANUP_PROCEDURES_EXECUTION.slice(sectionC, sectionD);
  assert.doesNotMatch(section, /holds for `--no-ff`, fast-forward, and squash\/rebase merges alike/);
  assert.doesNotMatch(section, /strictly stronger/);
  assert.match(section, /integration-model: local-merge/);
  assert.match(section, /integration-model: pr-first/);
  assert.match(section, /gh pr view \{number\} --repo \{owner\}\/\{repo\} --json mergeCommit/);
  assert.match(section, /git diff HEAD \{merge-commit\}/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scratch-worktree-remote-branch-delete.test.js`
Expected: FAIL — the new test's `doesNotMatch`/`match` assertions fail against the current (uncorrected) paragraph, which still contains "holds for `--no-ff`, fast-forward, and squash/rebase merges alike" and "strictly stronger", and contains neither `integration-model: local-merge` nor the `gh pr view`/`git diff HEAD {merge-commit}` text.

- [ ] **Step 3: Replace the paragraph**

In `plugin/skills/wrap-up/cleanup-procedures-execution.md`, replace lines 180-197 (the paragraph starting `**Prove it before passing \`discard_changes: true\`` and ending `equality test alone would reject.`) with:

```markdown
   **Prove it before passing `discard_changes: true` — a proof matching the merge shape, not a
   bare SHA match.** Under `integration-model: local-merge` (`_shared/integration-model.md`),
   merges land via `git merge --no-ff` (`_shared/local-merge-auto-finish.md`,
   `dispatch/settle-and-merge.md`, `_shared/issue-claims.md`'s "Close-via-merge") or a plain
   fast-forward — for both, run `_shared/scratch-worktree.md`'s "Tearing down" (§6) ancestry
   check, `git merge-base --is-ancestor HEAD origin/{integration-branch}`, against the branch
   this worktree's branch actually merged into, rather than a `git rev-parse HEAD` equality test
   (`[IL-45]`'s original mitigation): equality only holds after a fast-forward, while `--no-ff`
   produces a new merge commit whose SHA never equals the worktree branch's — an ancestry check
   is what proves the `--no-ff` case safe, not just the fast-forward one. **Exit 0** authorizes
   `discard_changes: true` directly, with the same one-line stated reason that file's §6 uses —
   no separate confirmation once the check has actually run and passed. **Non-zero** — stop and
   surface via `git log origin/{integration-branch}..HEAD --oneline`, same as that file's own
   non-zero branch; never override on a non-zero result.

   Under `integration-model: pr-first` (the GitHub default), every merge goes through
   `_shared/pr-first-merge.md` Step 3's `gh pr merge --squash`, so the ancestry check above can
   never pass here: a squash commit's parents never include this worktree branch's `HEAD`, by
   construction, regardless of how clean the merge was. The primary proof for this shape is
   instead a clean worktree plus an empty diff against the squash commit itself: read the PR's
   merge commit — `gh pr view {number} --repo {owner}/{repo} --json mergeCommit -q
   .mergeCommit.oid`, `{number}` from this run's `run-state.json` `pr.number` field — then run
   `git diff HEAD {merge-commit}`. **Empty** authorizes `discard_changes: true` the same way
   **Exit 0** does above (stated reason: "git diff HEAD {merge-commit} is empty — nothing to
   lose"). **Non-empty** — stop and surface the diff, same as the ancestry check's non-zero
   branch; never override. `[IL-45]`'s content-diff fallback (`git diff <branch>
   <default-branch>` empty) still applies for a branch discarded without ever merging (no
   `run-state.json` `pr` field at all) — that remains the path for "never merged," never the
   normal `pr-first` case. Neither proof subsumes the other: the ancestry check only holds for
   `--no-ff`/fast-forward, and the content-diff check is what `pr-first`'s squash shape actually
   needs.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scratch-worktree-remote-branch-delete.test.js`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/cleanup-procedures-execution.md tests/scratch-worktree-remote-branch-delete.test.js
git commit -m "Fix the false squash/rebase ancestry claim in worktree-teardown Section C — refs #3088"
```

---

### Task 2: Scope scratch-worktree.md §6's ancestry check to the callers that actually reach it

**Files:**
- Modify: `plugin/skills/_shared/scratch-worktree.md` (§6 "Tearing down" section, after the existing closing paragraph that currently ends `...stays canonically stated in \`pr-first-merge.md\`.`)
- Test: `tests/scratch-worktree-remote-branch-delete.test.js`

**Interfaces:**
- Consumes: nothing from Task 1 or Task 3 — independent prose addition.
- Produces: an explicit cross-reference other readers of §6 can follow instead of re-deriving the same reasoning.

- [ ] **Step 1: Write the failing test**

Add this test to the end of `tests/scratch-worktree-remote-branch-delete.test.js`:

```javascript
test('scratch-worktree.md §6 states why its ancestry check does not need Section C\'s squash-merge correction', () => {
  const step6 = SCRATCH.slice(SCRATCH.indexOf('## 6. Tearing down'), SCRATCH.indexOf('## 7. Shell constraint'));
  assert.match(step6, /Cross-caller `pr-first` check/);
  assert.match(step6, /cleanup-procedures-execution\.md`'s Section C/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scratch-worktree-remote-branch-delete.test.js`
Expected: FAIL — §6 currently contains neither phrase.

- [ ] **Step 3: Add the clarifying note**

In `plugin/skills/_shared/scratch-worktree.md`, find the paragraph in §6 ("## 6. Tearing down") that currently ends:

```
Once
`ExitWorktree` succeeds and the branch was actually merged (not just abandoned), the next
action is `pr-first-merge-post-merge.md`'s `## Step 5: Delete the remote branch (after worktree teardown)` — cited here rather than restated, per the state-once rule; this
section is about whether it's safe to discard the worktree, not about remote branch cleanup,
which stays canonically stated in `pr-first-merge.md`.
```

Immediately after that paragraph (still within `## 6. Tearing down`, before the "The two domains are asymmetric here too." paragraph that follows it), insert a new paragraph:

```markdown
**Why this check doesn't need `cleanup-procedures-execution.md`'s squash-merge correction.**
This section's ancestry check is reached only by this file's own native callers — `tidy`'s and
`residue-sweep.md`'s scratch-worktree teardown, and `flow/worktree-merge.md`'s
conflict-resolution path — and, per "Cross-caller `pr-first` check" above, every one of them
reaches this point only via their own `local-merge` path (`--no-ff` or fast-forward): under
`pr-first`, they push a branch and open a marker-stamped PR instead of merging back locally, so
this ancestry check is never asked to prove a squash merge safe. `cleanup-procedures-execution.md`'s
Section C is a distinct caller: it tears down the actual feature/spec worktree, which does go
through `pr-first-merge.md`'s `--squash` merge under the default integration model — that's why
its own paragraph carries the squash-merge content-diff correction instead of relying on this
section's ancestry check alone.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scratch-worktree-remote-branch-delete.test.js`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/scratch-worktree.md tests/scratch-worktree-remote-branch-delete.test.js
git commit -m "Clarify why scratch-worktree.md teardown does not need the squash-merge correction — refs #3088"
```

---

### Task 3: Let the own-worktree teardown path delete the remote branch after ExitWorktree

**Files:**
- Modify: `plugin/bin/lib/hooks/teardown-run.js` (the `branch` const in `teardownRun()`)
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md` (Section C — new step 5.5, and a one-line update to the existing "Own-worktree carve-out" sentence)
- Test: `tests/hooks-teardown-run.test.js`, `tests/scratch-worktree-remote-branch-delete.test.js`

**Interfaces:**
- Consumes: the existing `teardownRun(runDir, opts)` function signature and its `prevState`/`worktreePath`/`fallbackBranch` locals (unchanged) from `plugin/bin/lib/hooks/teardown-run.js`.
- Produces: `teardownRun()`'s `branch` resolution now also accepts `prevState.pr.branch` directly (bypassing `fallbackBranch()`'s local-existence gate) when no worktree was ever recorded — nothing downstream of this function's own `lines` array changes shape.

- [ ] **Step 1: Write the failing test**

Add this test to `tests/hooks-teardown-run.test.js`, after the existing `AC15` test (end of file):

```javascript
test('AC16 (#3088): own-worktree teardown — no worktree recorded, local branch already deleted (ExitWorktree), but run-state.json pr.branch is set -> remote ref delete is still attempted', () => {
  const { root, wt, runDir } = fixtureRepo();
  // Simulate Section C's own-worktree path having already run: close-run cleared
  // run-state.json's worktree field to null (hence writeRunState below passes
  // worktree: null, not wt), and ExitWorktree(remove) already deleted both the
  // worktree directory and its local branch.
  execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: root });
  execFileSync('git', ['branch', '-D', 'feat-branch'], { cwd: root });
  writeRunState(runDir, {
    status: 'active',
    worktree: null,
    sessionId: 'me',
    pr: { number: 42, url: 'https://github.com/acme/widgets/pull/42', branch: 'feat-branch' },
  });
  const calls = [];
  const result = teardownRun(runDir, {
    mode: 'merged', sessionId: 'me', deps: { ghApiDelete: fakeGhApiDelete(calls, { ok: true }) },
  });

  assert.match(result.lines.join('\n'), /worktree: skipped — no worktree recorded/);
  assert.match(result.lines.join('\n'), /branch: skipped — delete failed for feat-branch/);
  assert.match(result.lines.join('\n'), /remote ref: deleted refs\/heads\/feat-branch/);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], ['repos/acme/widgets/git/refs/heads/feat-branch']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/hooks-teardown-run.test.js`
Expected: FAIL — `fallbackBranch()`'s `branchExists` gate rejects `feat-branch` (already deleted), so `branch` resolves to `null`, and the actual output contains `branch: skipped — no branch recorded` / `remote ref: skipped — no branch recorded` instead of the expected lines; `calls.length` is `0`, not `1`.

- [ ] **Step 3: Implement the branch-resolution fallback**

In `plugin/bin/lib/hooks/teardown-run.js`, find this block inside `teardownRun()`:

```javascript
  const branch = (root ? branchOfWorktree(root, worktreePath) : null)
    || (prevState && prevState.branch)
    || (!worktreePath && root ? fallbackBranch(root, runDir, prevState) : null)
    || null;
```

Replace it with:

```javascript
  // #3088: when no worktree was ever recorded (the own-worktree path, after
  // close-run already cleared run-state.json's worktree field — see Section
  // C step 5.5), fallbackBranch()'s own branchExists gate correctly protects
  // run-integrity.js's shipped-unclosed detection (which needs a real local
  // ref to run merge-base against) but wrongly also suppresses the branch
  // NAME for this function's own remote-ref-delete purpose, which needs no
  // local existence at all. record-pr already writes run-state.json's
  // pr.branch via deriveBranch() at PR-creation time (#1672) specifically so
  // it survives the worktree's own later removal — read it directly here as
  // a final, narrower fallback, still gated the same `!worktreePath` way
  // fallbackBranch() itself is gated (never fires when a worktree WAS
  // recorded but is merely gone from disk — that case keeps its existing
  // "no branch recorded" behavior unchanged, per AC9 below).
  const branch = (root ? branchOfWorktree(root, worktreePath) : null)
    || (prevState && prevState.branch)
    || (!worktreePath && root
      ? (fallbackBranch(root, runDir, prevState)
        || (prevState && prevState.pr && typeof prevState.pr.branch === 'string' ? prevState.pr.branch : null))
      : null)
    || null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/hooks-teardown-run.test.js`
Expected: PASS (all tests in the file, including AC16 — and AC8, AC8b, AC9 unchanged, since none of them set a `worktree` field alongside an absent-or-gone local branch the way AC16 does)

- [ ] **Step 5: Write the failing prose test for Section C's new step**

Add this test to `tests/scratch-worktree-remote-branch-delete.test.js`:

```javascript
test('cleanup-procedures-execution.md Section C has an own-worktree remote-branch-delete step after ExitWorktree (#3088)', () => {
  const sectionC = CLEANUP_PROCEDURES_EXECUTION.indexOf('## C. Git Worktree');
  const sectionD = CLEANUP_PROCEDURES_EXECUTION.indexOf('## D. Ephemeral dev server');
  const section = CLEANUP_PROCEDURES_EXECUTION.slice(sectionC, sectionD);
  assert.match(section, /Own-worktree remote-branch delete \(#3088\)/);
  assert.match(section, /pr\.branch/);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --test tests/scratch-worktree-remote-branch-delete.test.js`
Expected: FAIL — Section C does not yet contain either phrase.

- [ ] **Step 7: Add Section C's new step 5.5 and update the carve-out sentence**

In `plugin/skills/wrap-up/cleanup-procedures-execution.md`, find the existing text (originally lines 202-219, after Task 1's edit may have shifted line numbers slightly — locate by the literal strings below rather than by line number):

```markdown
5. **Steps 5-6, subsumed into one call.** For a worktree this session does not occupy, run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" teardown-run --run "$RUN_DIR" \
     --merged  # or --abandoned when the branch was discarded, not merged
   ```

   One command performs archival (idempotent if Section B already archived this run — a second
   pass is a harmless no-op), worktree removal (skip-and-report if locked, never forced), the
   local branch delete (only under `--merged`, and only when the branch isn't the integration
   branch itself), and the remote branch delete (`pr-first-merge-post-merge.md`'s `## Step 5:
   Delete the remote branch` mechanism, verbatim) — replacing what used to be 4-5 hand-assembled
   commands per run. **Own-worktree carve-out:** never call `teardown-run` against the worktree
   the session is standing in — that removal path is `ExitWorktree` only, per step 4 above and
   `[IL-58]`; `teardown-run`'s own worktree-removal step is for a worktree this session does not
   occupy.

If no worktree exists for this spec, skip this section silently.
```

Replace it with:

```markdown
5. **Steps 5-6, subsumed into one call.** For a worktree this session does not occupy, run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" teardown-run --run "$RUN_DIR" \
     --merged  # or --abandoned when the branch was discarded, not merged
   ```

   One command performs archival (idempotent if Section B already archived this run — a second
   pass is a harmless no-op), worktree removal (skip-and-report if locked, never forced), the
   local branch delete (only under `--merged`, and only when the branch isn't the integration
   branch itself), and the remote branch delete (`pr-first-merge-post-merge.md`'s `## Step 5:
   Delete the remote branch` mechanism, verbatim) — replacing what used to be 4-5 hand-assembled
   commands per run. **Own-worktree carve-out:** never call `teardown-run` against the worktree
   the session is standing in **while it is still live** — that removal path is `ExitWorktree`
   only, per step 4 above and `[IL-58]`; `teardown-run`'s own worktree-removal step is for a
   worktree this session does not occupy. Once step 4 has already removed it, step 5.5 below
   calls `teardown-run` anyway, for a different reason.
5.5. **Own-worktree remote-branch delete (#3088).** `ExitWorktree(remove)` in step 4 above
   deletes the local branch along with the worktree — nothing in steps 1-4 deletes the remote
   ref. Run the same command step 5 uses, now that nothing live remains for it to conflict with:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" teardown-run --run "$RUN_DIR" --merged
   ```

   Its archival and state-close steps are idempotent no-ops here (step 3.6 and Section B's own
   archival already ran), its worktree-removal step reports "no worktree recorded" (already
   gone), and its local-branch-delete step reports a harmless failure (already gone) — the step
   that actually matters is its remote-ref delete, which resolves the branch name from
   `run-state.json`'s `pr.branch` field even though the local branch no longer exists
   (`teardown-run.js`'s branch resolution, #3088). This narrows, not contradicts, step 5's own
   carve-out above: that carve-out is about never routing *worktree removal* through
   `teardown-run` while the worktree is still live — calling it afterward, purely for this
   leftover remote-ref cleanup, is the documented path.

If no worktree exists for this spec, skip this section silently.
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node --test tests/scratch-worktree-remote-branch-delete.test.js`
Expected: PASS (all tests in the file)

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS — no new attributable failures (a run-to-run flaky count under concurrent sibling sessions is a known, separate condition per project CLAUDE.md; re-run only `node --test tests/hooks-teardown-run.test.js tests/scratch-worktree-remote-branch-delete.test.js` in isolation if anything there looks suspicious)

- [ ] **Step 10: Commit**

```bash
git add plugin/bin/lib/hooks/teardown-run.js plugin/skills/wrap-up/cleanup-procedures-execution.md tests/hooks-teardown-run.test.js tests/scratch-worktree-remote-branch-delete.test.js
git commit -m "Let own-worktree teardown delete the remote branch after ExitWorktree — refs #3088"
```
