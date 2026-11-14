---
files:
  - plugin/bin/claude-tweaks-statusline.js
  - tests/statusline.test.js
  - tests/statusline-no-shell-conformance.test.js
---

# Keep Many Sessions Open Without a Git Process Storm

**Persona:** A developer who runs claude-tweaks with the statusline wired in (`~/.claude-tweaks/bin/statusline.js`), with dozens of Claude Code sessions open on one Mac: a main checkout, many worktree-isolated sessions, and sibling sessions in other repos. Every session re-renders its statusline around each tool call.
**Goal:** The statusline costs as little as possible per render, so dozens of sessions don't add up to a constant stream of process spawns, and it still shows exactly what it showed before.
**Entry point:** Any session where the statusline renders its project and git segments: the project name with its `file://` link, the GitHub glyph linked to the repo page, and the branch with its dirty dot.
**Success state:**
- In a main checkout or a linked worktree with a plain GitHub `origin`, one render starts exactly one child process, `git --no-optional-locks status --porcelain -b`, and no `/bin/sh`. That is two processes counting node, down from 5 in a main checkout and 7 in a linked worktree.
- The project name, the link and the glyph are byte-for-byte what git's own answers would produce, in every repo shape. That includes repos git refuses to open.

## Steps

### 1. Work in a main checkout
- **URL:** the Claude Code statusline, project and git segments.
- **Action:** Open a session in the main checkout of a repo with a GitHub `origin` and let the agent run a few tool calls.
- **Should feel:** Unremarkable. The same name, link, glyph and `{branch}●` as before, with nothing to notice.
- **Should understand:** The project dir and origin URL come from reading `.git/config` directly. Only the branch and dirty state, which change from one render to the next and have no cheap invalidation signal, still ask git, once per render and without a shell.
- **Red flags:**
  - The glyph is missing or links to a different repo than `git config --get remote.origin.url` names.
  - A process listing (`ps`) during a render shows `sh -c git …` or more than one git process per render.

### 2. Work in a linked worktree
- **URL:** the statusline in a worktree-isolated session (`.claude/worktrees/{name}`).
- **Action:** Open or enter a linked worktree of the same repo and keep working.
- **Should feel:** Identical to the main checkout. The project segment names the real project, not the worktree folder.
- **Should understand:**
  - The main checkout is found the way git finds it: the worktree's `.git` file and the admin dir's `commondir`, resolved through the physical directory and realpathed, as `git rev-parse --git-common-dir` prints it. No `rev-parse` spawn is needed.
  - The fast path is skipped in two cases:
    - The main repo's config carries any `[extensions]` section. `git worktree add --relative-paths` writes one, so linked worktrees of those repos spawn `git rev-parse` once per render.
    - The config uses quote or escape syntax anywhere.
  - Skipping the fast path is deliberate: an older git on `PATH` refuses such repos, and the statusline must show what git shows.
- **Red flags:**
  - The project segment shows the worktree folder's name in a normal `git worktree add` worktree.
  - A worktree of a repo git refuses to open (a repository format version above 1, an unknown extension) still shows the main project's name. Git dies there, so the segment should fall back to the worktree dir.

### 3. Hit an unusual repo
- **URL:** the statusline in a repo whose config or environment git treats specially.
- **Action:** Work in a repo whose config uses `[include]`, or that has a quoted value, a `GIT_DIR` / `GIT_CONFIG_*` / `GIT_COMMON_DIR` / `GIT_OBJECT_DIRECTORY` env var, or a repository format git refuses. Or work in a repo owned by another user, where git's `safe.directory` check refuses it.
- **Should feel:** Unchanged. The segment matches what it showed before this change, even if that is no glyph.
- **Should understand:** The filesystem readers hand every case they don't model back to git, and the git call is the answer. That costs one spawn in that repo only.
  - Known exception: on Windows, ownership is checked with SIDs, which the readers don't model. In a repo another account owns, the readers can show a glyph that git would refuse to show.
- **Red flags:**
  - A glyph or project name appears that `git config --get remote.origin.url` or `git rev-parse --git-common-dir` would not give.
  - The statusline hangs. The one exception is a FIFO in place of `.git/config` or `commondir`, where git itself blocks too.

## Origin
- Created during build of #5266 in flow run `2026-11-13T004054-spec-5266-5294`. The statusline's common dir and origin URL come from the filesystem, with a git fallback whenever git's answer could differ, and `git status` runs without a shell.
- Measured on this Mac, 5 renders each: a main checkout went from 5 to 2 processes and a linked worktree from 7 to 2, with the rendered line byte-identical.
- #5294, the pre-tool-use and post-tool-use hooks' repeated `git rev-parse` calls, is the other half of the same goal and extends this journey.
