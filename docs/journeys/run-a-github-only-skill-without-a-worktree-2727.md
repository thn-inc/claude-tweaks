---
files:
  - plugin/skills/_shared/worktree-setup.md
  - plugin/bin/lib/hooks/session-start.js
  - plugin/skills/backlog/refine-mode.md
  - plugin/skills/backlog/refine-headless.md
  - plugin/skills/capture/SKILL.md
  - plugin/skills/tidy/scan-execution.md
  - plugin/skills/tidy/step-7-5-worktree-always.md
  - plugin/skills/specify/shaping-mode.md
---

# Run a GitHub-Only Skill Without a Worktree

**Persona:** An agent session (or the maintainer driving it) in a `worktree-always` project's main checkout, about to run a skill whose writes all go to GitHub — `/claude-tweaks:backlog refine` under `work-backend: github-issues`, a `keep`/`absorb:N` `/claude-tweaks:capture`, `/claude-tweaks:specify` shaping a `#N` record under `github-issues`, or `/claude-tweaks:tidy`'s scan batch and a Step 7 whose approved actions are all `gh` writes.
**Goal:** Finish the skill without creating a worktree it never needed — no create, no catch-up merge pulling unrelated upstream commits, no hand-run `git merge-base --is-ancestor` proof before teardown.
**Entry point:** The SessionStart banner in a `worktree-always` main checkout, then the invoked skill's own **Worktree** note.
**Success state:** Every label, comment, and issue edit lands through `gh`; no worktree was created; the main checkout's `git status` is unchanged.

## Steps

### 1. Read the scoped banner — A session starts in the main checkout with `worktree-always: ON`.
- **Action:** The banner reads "requires an isolated worktree for repository edits … Before editing repository files, invoke /superpowers:using-git-worktrees … An invocation whose every write is a forge-API call (gh issue/pr/api) needs no worktree — see that file's Adopt-or-create."
- **Should feel:** Told the actual rule, not a blanket one.
- **Should understand:** The worktree requirement protects repository files; a `gh`-only invocation is outside it.
- **Red flags:** The session creates a worktree before it knows what the skill will write.

### 2. Check the skill's own note — The skill is invoked.
- **Action:** The skill's **Worktree** / **No worktree** note (for specify shaping, `shaping-mode.md`'s **Parallel-safety** callout) cites `_shared/worktree-setup.md`'s "Forge-API-only invocations need no worktree" and names its own exceptions — refine: a `facets.unsynced === true` record or the `local-files` driver; capture: the `local-files` driver, the gh-failure fallback, the `brainstorm` route; specify shaping: the `local-files` driver's `writeRecord`; tidy: a Step 7 approved set holding a working-tree write (a record-file edit, a design doc's `Status: specified` stamp, a `docs/REGISTRY.md` Fix-now edit), or any `local-files` run (`step-7-5-worktree-always.md`'s first paragraph).
- **Should feel:** A quick yes/no on this invocation's shape, answered by the skill itself.
- **Should understand:** The carve-out covers whole invocations; one local-write branch in the run means it does not apply to that branch.
- **Red flags:** Treating "backlog refine needs no worktree" as unconditional while the worklist holds an unsynced local record.

### 3. Run with no worktree — The invocation's writes happen.
- **Action:** Labels, comments, and body edits go through `gh`; audit lines go to the run directory; breaker state goes to the `health-state` ref — none of it touches the working tree.
- **Should feel:** Uneventful; nothing to tear down afterwards.
- **Should understand:** The `worktree-always` gate never intercepted `gh` — only the prose did.
- **Red flags:** A post-creation catch-up merge commit appearing in a worktree for a skill that wrote nothing local.

### 4. Enter a worktree only at the first local write — The run reaches a write the carve-out does not cover (an unsynced record's `writeRecord`, a design doc, a commit).
- **Action:** Adopt-or-create runs at that point, the way `/claude-tweaks:tidy` provisions Step 7.5's scratch worktree only when Step 7's approved set holds a working-tree write — an all-`gh` set (stale-issue closes, label edits, a Release Note fill) runs from the main checkout with no worktree and no commit.
- **Should feel:** Deliberate — isolation arrives exactly when a repository file is about to change.
- **Should understand:** The carve-out ends at the first working-tree write; it defers isolation, it does not waive it.
- **Red flags:** A `writeRecord` against `specs/` from the main checkout followed by a gate-denied `git commit`, leaving an uncommitted edit stranded there.

## Outcome

GitHub-only invocations under `worktree-always` skip the worktree lifecycle entirely, and any local write that does occur still gets its worktree first.

_Origin: record #2727 (the `ExitWorktree` discard-guard option is harness code, out of scope), built 2026-10-16; tidy Step 7.5's all-`gh` skip added by record #3339, built 2026-10-20._
