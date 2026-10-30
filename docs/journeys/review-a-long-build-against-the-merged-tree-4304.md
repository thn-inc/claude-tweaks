---
files:
  - plugin/bin/pre-review-catchup.js
  - plugin/bin/lib/worktree/pre-review-catchup.js
  - plugin/skills/_shared/pre-review-catchup.md
  - plugin/skills/build/dispatch.md
---

# Review a Long Build Against the Merged Tree

**Persona:** A maintainer who started `/claude-tweaks:flow #N` (or `/claude-tweaks:build #N`) in a worktree on a multi-task record, and let it run for an hour or more while sibling sessions kept merging PRs into `main`, some of them touching the same files.
**Goal:** Have the whole-branch review judge the branch on top of today's `main`, not the `main` the worktree was cut from, so an overlapping upstream change surfaces during the build instead of as a `DIRTY` PR at merge.
**Entry point:** SDD has finished its last task review, and `/build`'s `dispatch.md` **Pre-review catch-up** instruction runs `bin/pre-review-catchup.js --integration-branch {integration-branch} --run "$PIPELINE_RUN_DIR"` from the worktree root, before the final review package is built. That instruction carries only the call; what each outcome means and what the build does next is `_shared/pre-review-catchup.md`'s `## Outcomes`.
**Success state:** `decisions.md` holds one `Pre-review catch-up` line per CLI run, the last naming the outcome the review went ahead on; the review package's base is the JSON's `reviewBase`; and when upstream overlapped, the review and the full suite both ran on the merged tree.

## Steps

1. **Upstream moved, but elsewhere** — `main` gained commits since the merge base, none touching a file this branch changed.
   - **Action:** The CLI fetches `origin/{integration-branch}`, compares the upstream commits' files with the branch's own, finds no overlap, and merges nothing. It appends `SCANNED … — Pre-review catch-up: origin/main has {N} commit(s) since merge base {sha}, none touching the {M} file(s) this branch changed — no merge`.
   - **Should feel:** Cheap. One fetch and a file-list comparison: no merge commit, no second suite run.
   - **Should understand:** The review package is still built on the JSON's `reviewBase` (the merge base with `origin/main`), so upstream's unrelated commits never show up in the reviewer's diff, even when the shared local `main` is stale.
   - **Red flags:** A merge commit appears anyway, or the reviewer's package lists upstream commits as branch work.

2. **Upstream touched the same files** — a sibling PR changed a function this branch also edited.
   - **Action:** The CLI merges `origin/{integration-branch}` and logs `AUTO … — Pre-review catch-up: worktree branch advanced from {before} to {after} ({N} commit(s) from origin/main; {K} touching {F} file(s) this branch changed: …) — re-run the suite before the whole-branch review`, the same shape as the post-creation catch-up's line. `/build` re-runs the full suite on the merged tree, sends any failure through one implementer fix dispatch, then builds the review package on `reviewBase`.
   - **Should feel:** Like the build absorbed the upstream change on its own. The maintainer reads about it afterwards in the log, not as a prompt.
   - **Should understand:** The reviewer judged the branch's own diff against the combined tree, so a semantic clash with the upstream change is a review finding now, not a merge-time surprise.
   - **Red flags:** The review runs before the suite re-run, or the merged tree is never tested.

3. **The merge conflicts** — upstream and the branch edited the same lines.
   - **Action:** The CLI leaves the merge in progress and returns `conflict` with `conflictFiles`. `/build` hands those files and the merge's two sides to one implementer dispatch that resolves and commits. It logs `Pre-review catch-up: conflict on {files} resolved in {sha}`, re-runs the full suite, and only then builds the package.
   - **Should feel:** Stopped, not stuck. The build pauses on a real problem rather than reviewing a tree it knows is stale.
   - **Should understand:** If the dispatch cannot leave a committed, green tree, the build stops at a HARD-GATE with the merge state intact and names the files; nothing runs `git merge --abort` to get past it.
   - **Red flags:** The whole-branch review runs on the pre-merge tree, the merge is aborted, or the controller edits conflicted files itself.

4. **The fetch fails** — the network is down, or the fetch passes its 60-second timeout.
   - **Action:** The CLI logs `SKIP … — Pre-review catch-up: condition: git fetch origin main failed (…) → fallback: no pre-review catch-up; the whole-branch review runs on the unchecked tree` and the build continues, using the last-fetched `reviewBase` when one exists.
   - **Should feel:** Honest. The build does not block on a network blip, and the log says plainly that the check did not run.
   - **Should understand:** A `fetch-failed` line differs from a `no-overlap` line: `SKIP` means "not checked", `SCANNED` means "checked, clean".
   - **Red flags:** A failed fetch is logged as `SCANNED`, or the build hangs on an ssh prompt with no timeout.

5. **The CLI itself fails** — it exits 2 (a malformed invocation, such as an `--integration-branch` value that starts with `-`) or 1 (an undecided crash, typically upstream adding a path that sits untracked in the worktree).
   - **Action:** There is no JSON outcome and the CLI wrote no `decisions.md` line, so `/build` logs one itself: `SKIP … — Pre-review catch-up: condition: the CLI exited {n} ({stderr line}) → fallback: environment cause fixed, CLI re-run once`, written with `log-decision.js --text-file` because the stderr line is tool-supplied. It fixes the cause named on stderr and re-runs the CLI once. A second non-zero exit logs the same line with `fallback: none; HARD-GATE stop`, and the build stops with that stderr in front of the maintainer.
   - **Should feel:** Like a tool that broke, said so, and got one retry, never a check that quietly passed.
   - **Should understand:** Exit 0 covers every outcome, `fetch-failed` included; a non-zero exit is not an outcome and is never skipped past to the review. The untracked files a crash names are not the catch-up's to move or delete.
   - **Red flags:** A non-zero exit with no `SKIP` line, a third CLI run, untracked files moved or deleted to get the merge through, or the whole-branch review running after a second non-zero exit.

6. **Read it back** — the maintainer opens the run's `decisions.md`, or the Review Console at wrap-up.
   - **Action:** Under `/build` there is one `Pre-review catch-up` entry per CLI run (one, unless a fixable outcome below or step 5's non-zero exit made the build re-run it), plus the conflict-resolution line when step 3 happened. A `current-branch` build shows only a `SKIP` naming the worktree-only scope.
   - **Should feel:** Traceable. One line says what the catch-up found and what it did.
   - **Should understand:** A `windows-longpath` or `dirty-tree` outcome is a fixable state, not a pass: the log names the fix taken (the `core.longpaths` repair, or committing the build's own uncommitted work) before the CLI re-ran.
   - **Red flags:** Two entries for one CLI run (the CLI's line plus a hand-logged duplicate), or no entry at all.

## Outcome

A long build no longer reviews a tree that `main` has already moved past on the same files. Overlapping upstream work is merged, tested and reviewed inside the build, a conflict stops the build rather than the merge, and a branch that upstream never touched pays one fetch.

_Origin: record #4304 (pre-review integration catch-up), built 2026-10-28. Updated at the same record's wrap-up: the review fix wave (b4ad51a81) moved the procedure into `_shared/pre-review-catchup.md` and added the caller-owed `SKIP` on a non-zero exit (step 5)._
