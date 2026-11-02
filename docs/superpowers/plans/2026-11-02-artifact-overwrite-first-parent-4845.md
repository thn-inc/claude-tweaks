# Artifact-overwrite first-parent attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the multi-spec artifact-overwrite check from counting upstream commits a catch-up merge brought in as the run's own A/M events, and clear a deleted line blamed outside the run's own first-parent chain as pre-run content.

**Architecture:** `checkArtifactOverwrite`'s A/M `git log` gains `--first-parent --no-merges`. The blame test gains a membership check against a lazily computed `git rev-list --first-parent {base}..{head}` set (merges included), ahead of the same-spec attribution comparison. The raw fallback walk in the skill prose gains the same flags.

**Tech Stack:** Node 18+, `node --test`, git.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T074837-record-4845/work/4845-spec.md`

**Scope keywords:** checkArtifactOverwrite, artifact-overwrite

## Global Constraints

- "`bin/check-artifact-overwrite.js` needs no change. Its `--base`/`--head`/`--path` flags and exit codes stay the same."
- "Conflict-resolution edits inside a catch-up merge are no longer walked. ... Don't add `-m` or `--cc` to bring it back."
- "Blame still runs on `{commit}~1` over full history, not first-parent."
- A deleted line with no blame attribution still fails closed.
- Governing skill `gh-api-module-pattern` (the module's `git` runner seam): every new git call goes through the injected `git` runner, and `--end-of-options` precedes the interpolated range (`_shared/git-path-read.md`). `node-test-output-evidence`, `parse-signal-discipline`: no rule applies, this plan parses no new output shape beyond a newline-split sha list.

Waived bin/check-artifact-overwrite.js: Gotchas names it as no-change; Task 1 Step 4 reads it only through the existing CLI test suite.
Waived AC4.1: a revert-red probe, Task 1 Step 5, quoted in the PR rather than committed as a test.
Waived AC4.2: a revert-red probe, Task 1 Step 5, quoted in the PR rather than committed as a test.
Waived AC4.3: a PR-body requirement, met at Task 1 Step 5.
Waived AC5.1: the existing fixtures and replays already pin it; Task 1 Step 4 runs them.
Waived AC7.1: Common Step 5's verification runs the full suite.

## Open premise — not decided by the spec

The spec's walk and membership test treat every second-parent commit as not the run's own. Catch-up merges are not the only second parents on a shared branch: `multispec-parallel-waves.md` step 3 lands every several-member wave with `git -C {shared-worktree} merge --no-ff {worktreeBranch}`, so all of those members' own spec commits sit behind a second parent. `build/adopted-branch-collision-check.md`'s `git merge --no-edit {remoteSha}` adopts a prior attempt's commits the same way.

Probed on 2026-11-02 against the unchanged module with the record's flags injected through the `git` seam (scratch repo, real `git merge --no-ff`):

| History | Today | Record's walk |
|---|---|---|
| Upstream add, catch-up merge, spec edit (record's probe) | `clean: false` | `clean: true` — the intended fix |
| Wave member 2 overwrites wave member 1's content, both merged back | `clean: false` | `clean: true` — a real overwrite goes unreported |
| Wave member adds a journey, a later first-parent spec overwrites it | `clean: false` | `clean: true` — a real overwrite goes unreported |
| First-parent spec deletes a line a merged-back member wrote | `clean: false` | the walk keeps the pair, but the member's sha is not in the `rev-list --first-parent` set, so Deliverable 2 clears the line |

As written, the record therefore turns the check into a no-op for cross-spec overwrites involving a `parallel` wave's members, which is the failure this HARD-GATE exists to catch (#786). The tasks below implement the spec as written. Whether the spec should also carve parallel runs out, and how, is not settled by any spec sentence.

## Review Focus

- A catch-up merge whose own conflict resolution rewrote a run spec's line, then a later spec deletes that line: blame names the merge, which stays in the set and fails closed (Task 1, merge-commit fixture).
- A range with no catch-up merge: verdicts unchanged (existing fixtures and live replays, Task 1 Step 4).
- `head` given as a non-HEAD ref: the set is computed from the same `{base}..{head}` as the walk (Task 1, `fakeGit` assertion on the rev-list argv).
- An empty walk: no `rev-list` call at all, since the existing guard test pins `calls.length === 1` (Task 1, lazy computation).
- A deleted line with no blame: still fails closed, ahead of the membership check (Task 1, existing no-blame reason path; add a `fakeGit` case).

---

### Task 1: First-parent walk and run-commit membership

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/flow/artifact-overwrite-check.js:462-465` (walk argv), `:525-545` (blame loop), and the header comment's fail-closed paragraph and test 1 description (`:17`, `:77-80`)
- Test: `tests/bin-lib/flow/artifact-overwrite-check.test.js`

**Interfaces:**
- Consumes: the module's injectable `git(argv, cwd)` runner.
- Produces: no new export. A local `getRunCommits()` inside `checkArtifactOverwrite`, returning a `Set<string>` of full shas from `git(['rev-list', '--first-parent', '--end-of-options', `${base}..${head}`], cwd)` split on newlines, computed on first use and cached.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/flow/artifact-overwrite-check.test.js`, add these, building real merges with the existing `repo()`, `write()`, `commit()` helpers (add a `merge(fx, branch)` helper running `git merge -q --no-ff --no-edit`; `repo()` must pin its initial branch with `git branch -M main` so the fixture can name it):

- `test('AC1.1: a run edit of a journey a catch-up merge brought in from upstream is clean', ...)` — base; `run` branch: spec A adds `docs/journeys/a.md` (`refs #1`); `main`: adds `docs/journeys/up.md` (`refs #999`); `run` merges main; spec B (`refs #2`) edits a line of `up.md`. Assert `clean === true`, `overwrites` deep-equals `[]`.
- `test('AC2.1: a deleted line blamed to a SHA outside the first-parent chain is clean', ...)` — a `fakeGit` whose name-status output is `A` then `M` for one path, numstat `0\t1\tpath`, a one-hunk `-U0` diff deleting line 2, blame porcelain naming `OUTSIDE_SHA` on line 2, `rev-list` returning the two run shas. Assert `clean === true`, and that the rev-list argv carries `--first-parent` and `base..head` and no `--no-merges`.
- `test('AC2.2: the same deletion blamed to a first-parent merge commit is an overwrite', ...)` — same `fakeGit`, blame naming `MERGE_SHA`, which `rev-list` lists; `git log -1` for it returns a body with no `refs`. Assert `clean === false`.
- `test('AC3.1: a genuine cross-spec overwrite after a catch-up merge is reported, naming the overwriting commit', ...)` — real repo: spec A adds `docs/journeys/a.md` (`refs #1`); upstream adds an unrelated file; `run` merges main; spec B (`refs #2`) replaces a body line of `a.md`. Assert `clean === false`, `overwrites[0].commit === specB`.
- `test('a deleted line with no blame attribution still fails closed ahead of the membership test', ...)` — `fakeGit` whose blame output has no entry for the deleted line. Assert `clean === false`, reason matches `/no blame attribution/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js`
Expected: FAIL for AC1.1 and AC2.1 (`clean: false` today). AC3.1 passes before and after: it is a regression pin, not a red-first test.

- [ ] **Step 3: Implement**

Insert `'--first-parent', '--no-merges'` after `'log'` in the walk argv. Add `getRunCommits()`. In the blame loop, after the `!blamedSha` branch and before `getAttribution(blamedSha)`: `if (!getRunCommits().has(blamedSha)) continue;`. Update the header comment: test 1's paragraph names the first-parent event scope and that a line blamed outside the run's own first-parent chain is pre-run content.

- [ ] **Step 4: Run the module's suites and the live replays**

Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js tests/bin-lib/flow/check-artifact-overwrite-cli.test.js`
Expected: PASS, including the #1988–#1997 and `729a5ae5e..4706f21db` replays (AC5.1).

- [ ] **Step 5: Revert-red probes**

Remove `--first-parent` and run the AC1.1 test; expected FAIL. Restore it, remove `--no-merges`, and run AC1.1 again; expected FAIL, since the merge commit re-attributes the upstream add. Restore. Quote both red runs in the PR body (AC4.1, AC4.2).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/flow/artifact-overwrite-check.js tests/bin-lib/flow/artifact-overwrite-check.test.js
git commit -m "Attribute only the run's first-parent commits in the overwrite check — refs #4845"
```

### Task 2: Raw fallback walk prose

**Role:** transcription

**Files:**
- Modify: `plugin/skills/flow/multispec-artifact-namespacing.md:13` and the paragraph at `:16-18`
- Modify: `tests/skill-fence-guard-shapes.test.js:137` (its literal pins `--diff-filter=AM "{EXPECTED_BASE}..HEAD"`)
- Test: `tests/multispec-artifact-namespacing-conformance.test.js`

`plugin/skills/flow/multi-spec.md:159` cites "a `git log --name-status`" walk without flags and stays accurate, so it takes no edit.

**Interfaces:**
- Consumes: nothing from Task 1 at runtime.
- Produces: the walk command text below, verbatim.

- [ ] **Step 1: Write the failing test**

In `tests/multispec-artifact-namespacing-conformance.test.js`: `test('AC6.1: the raw walk carries --first-parent --no-merges', ...)` asserting `text` matches `/log --name-status --diff-filter=AM --first-parent --no-merges "\{EXPECTED_BASE\}\.\.HEAD"/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multispec-artifact-namespacing-conformance.test.js`
Expected: FAIL on AC6.1.

- [ ] **Step 3: Edit the prose**

Line 13 becomes:

```
git -C "$WORKTREE" log --name-status --diff-filter=AM --first-parent --no-merges "{EXPECTED_BASE}..HEAD" -- docs/journeys/ stories/
```

Add one sentence after "the run's own commit range, never the whole repo history": "`--first-parent --no-merges` keeps the walk to the commits the run made itself: a commit a catch-up merge brought in, and the merge commit, are not the run's events, so a manual ruling sees the same event set as the tool." Update `tests/skill-fence-guard-shapes.test.js:137`'s literal to the new command's prefix.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/multispec-artifact-namespacing-conformance.test.js tests/skill-fence-guard-shapes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/multispec-artifact-namespacing.md tests/multispec-artifact-namespacing-conformance.test.js tests/skill-fence-guard-shapes.test.js
git commit -m "Scope the raw artifact-overwrite walk to first-parent commits — refs #4845"
```
