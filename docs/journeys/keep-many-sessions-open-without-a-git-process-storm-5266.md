---
files:
  - plugin/bin/claude-tweaks-statusline.js
  - tests/statusline.test.js
  - tests/statusline-no-shell-conformance.test.js
  - plugin/bin/lib/hooks/repo-info-cache.js
  - plugin/bin/lib/hooks/worktree-detect.js
  - tests/hooks-repo-info-cache.test.js
  - tests/hooks-repo-info-store.test.js
---

# Keep Many Sessions Open Without a Git Process Storm

**Persona:** A developer who runs claude-tweaks with the statusline wired in (`~/.claude-tweaks/bin/statusline.js`), with dozens of Claude Code sessions open on one Mac: a main checkout, many worktree-isolated sessions, and sibling sessions in other repos. Every session re-renders its statusline around each tool call.
**Goal:** The statusline costs as little as possible per render, and the claude-tweaks hooks as little as possible per tool call, so dozens of sessions don't add up to a constant stream of process spawns, and it still shows exactly what it showed before.
**Entry point:** Any session where the statusline renders its project and git segments: the project name with its `file://` link, the GitHub glyph linked to the repo page, and the branch with its dirty dot.
**Success state:**
- In a main checkout or a linked worktree with a plain GitHub `origin`, one render starts exactly one child process, `git --no-optional-locks status --porcelain -b`, and no `/bin/sh`. That is two processes counting node, down from 5 in a main checkout and 7 in a linked worktree.
- The project name, the link and the glyph are byte-for-byte what git's own answers would produce, in every repo shape. That includes repos git refuses to open.
- Around each tool call, a hook in a directory it has already asked about starts no git process: a warm pre-tool-use call in a linked worktree is node alone. Every allow or deny is the one git's fresh answer would give.

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

### 4. Let the hooks run on every tool call
- **URL:** the claude-tweaks `PreToolUse` and `PostToolUse` hooks (`bin/hooks.js pre-tool-use` / `post-tool-use`), which fire around every tool call in every session.
- **Action:** Keep working in a linked worktree: edit files, run `npm test > out.txt`, commit; then ask a question or dispatch an agent from the main checkout.
- **Should feel:** Tool calls start promptly even with many sessions busy. Every allow or deny is exactly what it was before.
- **Should understand:**
  - The hooks ask git `rev-parse --show-toplevel --git-dir --git-common-dir --show-superproject-working-tree` once per directory, then reuse the answer within the hook process and, through `~/.claude-tweaks/repo-info-cache.json`, in every later hook process.
  - Each reuse is checked first against a filesystem signature (the nearest `.git` entry, a worktree's admin dir and `commondir`, the repo and global config files). Removing or re-adding a worktree, `git init`, pruning an admin dir or editing git config makes the next call ask git again.
  - A timeout, a killed git, or any failure other than git's own "not a git repository" is never remembered, and a set `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_CEILING_DIRECTORIES` or `GIT_DISCOVERY_ACROSS_FILESYSTEM` keeps the answer out of the shared file.
- **Red flags:**
  - A hook allows a write the worktree gate denied before the change, or denies one it allowed, for the same repo state.
  - After `git worktree remove`, `git init`, or a `safe.directory` edit in `~/.gitconfig`, a hook still acts on the old answer.
  - A corrupt, unreadable or unwritable `~/.claude-tweaks/repo-info-cache.json` makes a hook error or change its verdict; it should only cost the cache.

## Origin
- Created during build of #5266 in flow run `2026-11-13T004054-spec-5266-5294`. The statusline's common dir and origin URL come from the filesystem, with a git fallback whenever git's answer could differ, and `git status` runs without a shell.
- Measured on this Mac, 5 renders each: a main checkout went from 5 to 2 processes and a linked worktree from 7 to 2, with the rendered line byte-identical.
- Extended during build of #5294 in the same flow run (step 4): the hooks' `repoInfo` answer is cached per process and per user behind a filesystem signature. Measured back to back on 2026-11-15, 5 runs each, base vs this branch: pre-tool-use for an Edit in a linked worktree went from 15 processes to 1 (node only, warm), `npm test > out.txt` in the worktree from 15 to 2 cold and 1 warm, and post-tool-use for `git commit` in the worktree from 15 to 2. Every verdict was unchanged.
