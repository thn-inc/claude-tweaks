---
files:
  - plugin/bin/stash-guard.js
  - plugin/bin/lib/hooks/pre-tool-use.js
  - plugin/skills/build/dispatch.md
  - plugin/skills/build/handoff-template.md
  - plugin/skills/dispatch/task-prompt.md
  - plugin/skills/dispatch/express-prompt.md
---

# Keep the Shared Stash Through a Dispatched Build

**Persona:** Maintainer of a claude-tweaks repo who parked work on the stash in the main checkout (say, a rebase `--autostash` entry) and then let `/claude-tweaks:flow` or `/claude-tweaks:dispatch` build a record in a linked worktree. The stash stack is shared by every worktree of the checkout. In #4559's incident, a Fast implementer ran `git stash drop` in a compound command and silently dropped the only entry, which belonged to another checkout.
**Goal:** Never lose a stash entry to a dispatched agent. If an agent touches the stack anyway, the entry comes back without the maintainer having to ask, and the maintainer can see what happened.
**Entry point:** Any `/claude-tweaks:build` subagent run: `/claude-tweaks:flow #N`, a dispatched `build,test` call, or a standalone `/claude-tweaks:build #N`.
**Success state:** Every entry the maintainer had before the build is on `git stash list` afterwards, with its original subject. Any restore, failed restore or added entry is named by sha in `decisions.md` or in the build handoff's Stash guard section. The maintainer should feel the stash is out of the agents' reach, not one careless command away from loss.

## Steps

### 1. Every dispatched agent is told not to touch the stash — `build/dispatch.md`, `dispatch/task-prompt.md`, `dispatch/express-prompt.md`
- **URL:** —
- **Action:** `/build` forwards one rule to every dispatch that can run git: implementers and their fix rounds, re-dispatches, fix-wave and whole-branch-fix implementers, and every reviewer. The rule is: never run `git stash` in any form — bare `git stash`/`push`, `save`, `pop`, `drop`, `clear` or `store`; only `git stash list` and `git stash show` are allowed. Use `git show <rev>:<path>` for a baseline and a WIP commit to set work aside. `/dispatch`'s two Task calls and the express call carry the same wording.
- **Should feel:** Unambiguous: no subcommand is left for an agent to read as permitted.
- **Should understand:** The rule covers every model tier. No profile floor was added: `low` still maps to Fast, because the guard below catches a violation on any tier.
- **Red flags:** A dispatch prompt that still names only `git stash` and `git stash pop`; a reviewer dispatch with no no-stash rule.

### 2. The hook warns an agent that reaches for a destructive subcommand — `plugin/bin/lib/hooks/pre-tool-use.js`
- **URL:** —
- **Action:** **The agent** issues `git stash drop`, `git stash drop stash@{0}`, `git stash clear`, `git stash branch …`, `git stash store …`, `git stash import …`, or a compound command like `git status && git stash drop`, from inside a linked worktree. The PreToolUse hook adds a `git stash is repository-wide` warning saying it can push onto, pop or drop a SIBLING worktree's entry.
- **Should feel:** Like a tap on the shoulder, not a wall: the command still runs (warn, never deny).
- **Should understand:** `list`, `show`, `apply`, `create` and `export` stay silent: they don't change the stack, and `apply` is the documented WIP-recovery flow. The same commands issued from the main checkout are silent.
- **Red flags:** No warning on `drop`/`clear` from a worktree; a warning on `git stash list`; a deny where the gate should only warn.

### 3. The controller brackets each dispatch with a stash snapshot — `plugin/bin/stash-guard.js snapshot` / `compare --restore`
- **URL:** —
- **Action:** Right before each git-capable dispatch, SDD's controller runs `stash-guard.js snapshot --repo {worktree} --out {snapshot}`. As soon as the agent returns, it runs `stash-guard.js compare --repo {worktree} --baseline {snapshot} --restore --run "$PIPELINE_RUN_DIR" --task {k} [--label {role}]`. Exit 0 means the stack is unchanged. Exit 3 means it changed: every removed entry the CLI could restore is back via `git stash store`, keyed by commit sha (never `stash@{n}`), with its subject byte-for-byte. The CLI also self-logs `AUTO … — Stash guard: implementer for task {k} removed stash entry {sha subject}; restored via git stash store.` under `/build`.
- **Should feel:** Like a quiet safety net: the dropped entry is back before the next dispatch, with no prompt and no stop.
- **Should understand:** An entry an agent *added* is logged and left on the stack, never popped. An implementer result of `DONE` becomes `DONE_WITH_CONCERNS`, and the stash change is named to that task's reviewer. A `NEEDS_CONTEXT` or `BLOCKED` result keeps its status. A restored entry lands at `stash@{0}`, so positions shift, but nothing is lost. A sibling session's own legitimate drop during the window is also restored: an accepted false positive, undone by the sha the AUTO line names.
- **Red flags:** An entry restored with a different subject; an index-keyed restore; a no-op `git stash store` reported as `restored`; a new mid-flow stop.

### 4. A reviewer that touched the stash is reviewed again — `build/dispatch.md`
- **URL:** —
- **Action:** When the compare after a reviewer dispatch reports a change, the controller voids that verdict. The CLI has already restored the stash. The controller runs `git status --porcelain` and dispatches the same review again under a fresh snapshot/compare pair. If the tree is dirty, the retry names the dirty paths. If the retry changes the stash again, it is restored and logged, and the retry's verdict stands.
- **Should feel:** Trustworthy: a verdict reached while the stash was disturbed is never acted on.
- **Should understand:** There is at most one retry per review, never a third dispatch and never a stop. The controller never discards worktree changes.
- **Red flags:** Acting on a voided verdict; a third review dispatch; the build blocking on a dirty tree.

### 5. Read what happened in the handoff — `build/handoff-template.md`
- **URL:** —
- **Action:** The build handoff's `### Stash guard` section lists each failed restore with its paste-ready, shell-escaped `git stash store -m "…" <sha>` command on its own line. It also lists each entry left on the stack, and each reviewer whose verdict was voided. Successful restores get a line too, for a standalone `/build` (no run dir) or when the decision-log append did not land.
- **Should feel:** Complete: if anything happened to the stash, the maintainer can find it and undo it from this one place.
- **Should understand:** Under `/flow` the AUTO/FAILED lines are in `decisions.md` and reach the Review Console. A subject containing `!` must be pasted with history expansion off (`set +H` / `setopt nobanghist`).
- **Red flags:** A recovery command rebuilt from the raw subject (backticks would run); a reviewer's voided-verdict line missing from the handoff.

## Origin
- Created during build of #4559 (build dispatch: size:low → Fast puts a cheapest-tier implementer on git-running tasks, and it ignored the no-stash rule)
- Steps 1-5 built in this session
- Related: `run-shell-loops-without-a-hook-storm-3074.md` (the Bash prefilter that routes compound `git` commands to the stash gate)
