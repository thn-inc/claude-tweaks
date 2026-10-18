---
files:
  - plugin/bin/claude-tweaks-statusline.js
  - tests/statusline.test.js
---

# Commit While the Statusline Refreshes

**Persona:** A developer using Claude Code with the claude-tweaks statusline wired in (`~/.claude-tweaks/bin/statusline.js`). They work in a worktree-isolated session, where the agent runs `git add`, `git commit` and `git merge` many times as it works.
**Goal:** Have their own git writes succeed the first time, while the statusline keeps showing the branch and the dirty dot.
**Entry point:** Any session where the statusline renders a git segment. It re-renders around every tool call, so it runs `git --no-optional-locks status --porcelain -b` in the session's own directory over and over.
**Success state:** `git add`/`git commit`/`git merge` never fail with `Unable to create '.../index.lock': File exists` because of the statusline. The segment still reads `{branch}` when clean and `{branch}●` when dirty.

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

## Origin
- Created during build of #3352 (statusline `renderGit` passes `--no-optional-locks`; real-git test pins that a stale-stat repo's index is left byte- and mtime-identical), in flow run `2026-10-18T193619-spec-3352-3464`.
- Related: #3464 (the same flag for every other read-only `git status` probe under `plugin/bin`).
