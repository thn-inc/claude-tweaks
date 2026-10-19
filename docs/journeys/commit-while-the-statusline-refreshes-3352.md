---
files:
  - plugin/bin/claude-tweaks-statusline.js
  - plugin/bin/lib/hooks/worktree-reap.js
  - plugin/bin/lib/residue/probes/worktrees.js
  - plugin/bin/lib/reconcile/classify.js
  - tests/statusline.test.js
  - tests/git-status-optional-locks.test.js
---

# Commit While the Statusline Refreshes

**Persona:** A developer using Claude Code with the claude-tweaks statusline wired in (`~/.claude-tweaks/bin/statusline.js`). They work in a worktree-isolated session, often with sibling sessions open in other worktrees of the same checkout. The agent runs `git add`, `git commit` and `git merge` many times as it works.
**Goal:** Their own git writes succeed the first time. The statusline keeps showing the branch and the dirty dot, and the plugin's background sweeps keep doing their job.
**Entry point:** Any session where the statusline renders a git segment. It re-renders around every tool call, so it runs `git --no-optional-locks status --porcelain -b` in the session's own directory over and over. A sibling session's start-up reaper, its background reconcile and its residue sweep also run read-only `git status` probes against every registered worktree, this one included.
**Success state:**
- `git add`/`git commit`/`git merge` never fail with `Unable to create '.../index.lock': File exists` because of anything claude-tweaks runs, whether that is the statusline or a sibling session's background check.
- The segment still reads `{branch}` when clean and `{branch}●` when dirty.

## Steps

### 1. Watch the statusline while working
- **URL:** the Claude Code statusline, git segment.
- **Action:** Edit a file, then let the agent run a few tool calls.
- **Should feel:** Unremarkable. The segment flips from `{branch}` to `{branch}●` once the tree is dirty, exactly as before.
- **Should understand:** The segment is read-only. It computes branch and dirty state without writing anything into `.git/index`, even when a file's timestamp changed but its content did not.
- **Red flags:**
  - The segment disappears in a normal repo. A misplaced flag (`git status --no-optional-locks`) makes git fail, and `renderGit` silently returns nothing.
  - The dirty dot is missing on a tree with untracked or modified files.

### 2. Commit while the statusline is refreshing
- **URL:** the agent's Bash tool output for `git add` / `git commit` / `git merge`.
- **Action:** Let the agent stage and commit, or run the post-creation catch-up merge in a fresh worktree.
- **Should feel:** Boring and reliable. The command succeeds on the first attempt, with no retry loop and no workaround script.
- **Should understand:** Before #3352 a plain `git status` refreshed the index's stat cache and rewrote it under `index.lock` in bursts of roughly 400ms every ~1.8s, so a commit starting at tool-call time often collided. With `--no-optional-locks` the statusline never takes the lock. Its rendering can no longer be the process holding it.
- **Red flags:**
  - `index.lock: File exists` still appears with no other git process running in this worktree. That points at a different lock taker; #3464 covers the plugin's other read-only `git status` probes.
  - Deleting `.git/index.lock` (or `.git/worktrees/{name}/index.lock`) by hand to get past the error. Never the fix: the lock may belong to a live process.

### 3. Commit while sibling sessions sweep the worktrees
- **URL:** the agent's Bash tool output for `git add` / `git commit`, while another Claude Code session in a sibling worktree starts up, reconciles, or wraps up.
- **Action:** Keep working in this worktree while a sibling session opens. Its SessionStart worktree reaper and background reconcile run, and later its wrap-up residue sweep and verify runner check every registered worktree for dirty state.
- **Should feel:** Like nothing happened. The sibling's sweep is invisible here: no failed commit and no pause.
- **Should understand:** Every read-only `git status` under `plugin/bin` passes `--no-optional-locks` as of #3464. That covers the worktree reaper, the residue worktrees probe, reconcile's classifier, the verify runner, the wrap-up engine, release and the QA stamp. Their dirty/clean answers are the same as before, but they no longer rewrite another session's index. `tests/git-status-optional-locks.test.js` fails the suite if a new status call lands without the flag.
- **Red flags:**
  - `index.lock: File exists` still appears while only claude-tweaks sessions are active. That points at a lock taker outside `plugin/bin`, such as a different tool, the harness, or a working-tree `git diff`, which `--no-optional-locks` cannot make lock-free. It does not point back at these probes.
  - A sibling's reaper now keeps or removes worktrees differently than before. The flag changes locking, not answers, so any difference is a regression.

## Origin
- Created during build of #3352 (statusline `renderGit` passes `--no-optional-locks`; real-git test pins that a stale-stat repo's index is left byte- and mtime-identical), in flow run `2026-10-18T193619-spec-3352-3464`.
- Extended during build of #3464 in the same run. Step 3 was added because every other read-only `git status` probe under `plugin/bin` now passes the flag. A real-git test pins the residue worktrees probe, and a conformance scan pins every call site.
