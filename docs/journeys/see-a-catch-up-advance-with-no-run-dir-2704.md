---
files:
  - plugin/skills/_shared/worktree-catchup-no-run-dir.md
  - plugin/skills/_shared/worktree-setup.md
  - plugin/skills/specify/SKILL.md
---

# See a Catch-up Advance With No Run Directory

**Persona:** A maintainer working in a `worktree-always` project who opens an interactive session to shape or decompose a record with `/claude-tweaks:specify`. The SessionStart instruction moves them into a fresh worktree whose post-creation catch-up merge pulls in commits from `origin/main`. No `/flow` or `/dispatch` pipeline is running, so no run directory exists yet.
**Goal:** Learn that the catch-up actually moved their branch, and by how much, without a `decisions.md` to read and without the advance being silently dropped.
**Entry point:** A session started in the main checkout, where the SessionStart hook prints `claude-tweaks: worktree-always: ON (...)` and the instruction to invoke `/superpowers:using-git-worktrees`, then `/claude-tweaks:specify` asked to shape or decompose a record.
**Success state:** A branch-advancing catch-up shows its `Post-creation catch-up: worktree branch advanced from …` line in the next reply and again in `/claude-tweaks:specify`'s Next Actions (or its `--chained` returned output); a no-op merge reports nothing; no run directory or log file was created to hold the line.

## Steps

1. **Enter the isolated session** — Start a session in the main checkout and ask for work that edits files.
   - **Action:** The SessionStart `worktree-always` notice (`bin/lib/hooks/session-start.js`) sends the session through `/superpowers:using-git-worktrees`, then `_shared/worktree-setup.md`'s Post-creation catch-up (`git fetch origin {integration-branch}`, then `git merge origin/{integration-branch}`).
   - **Should feel:** Routine. The worktree appears and the session carries on with the task.
   - **Should understand:** When the merge changes nothing (tip unchanged), nothing is reported. Silence here means "checked, clean".
   - **Red flags:** The session says the catch-up "belongs to a run directory that will be created later", and then never mentions it again.

2. **Read the advance line in the reply** — The catch-up merge actually advanced the branch.
   - **Action:** No run directory resolves (`_shared/run-dir-resolution.md` steps 1-4 miss), so the session follows `_shared/worktree-catchup-no-run-dir.md`. It reports `Post-creation catch-up: worktree branch advanced from {before} to {after} ({N} commit(s) from {ref})` in its next reply.
   - **Should feel:** Informed without being interrupted. One line, not a prompt.
   - **Should understand:** The new worktree was not where `HEAD` pointed. It now includes `{N}` upstream commits, which may matter for the work about to be shaped.
   - **Red flags:** No line appears after a merge that visibly changed files. Or the session invents a `.claude-tweaks/` log file or mints a run directory just to hold the line.

3. **See it again at the end** — `/claude-tweaks:specify` finishes shaping or decomposing and renders its Next Actions.
   - **Action:** `specify/SKILL.md`'s `## Next Actions` carries the same advance line. Under `--chained`, where Next Actions isn't rendered, the line goes in the call's returned output instead.
   - **Should feel:** Complete. The summary the maintainer reads last still records what moved underneath them.
   - **Should understand:** If a run directory had resolved later in the same session, the same entry would also have landed in that run's `decisions.md`.
   - **Red flags:** The Next Actions block omits the advance even though step 2 reported one.

## Outcome

A branch-advancing catch-up is never invisible. With no run directory, the maintainer sees it in the session's own reply and in `/specify`'s closing summary. Once a run directory exists, the same entry reaches `decisions.md` as well.

_Origin: record #2704 (catch-up log obligation with no run directory), built 2026-09-30._
