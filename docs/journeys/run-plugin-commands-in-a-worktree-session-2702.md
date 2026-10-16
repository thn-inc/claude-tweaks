---
files:
  - plugin/skills/_shared/worktree-setup.md
---

# Run Plugin Commands in a Worktree Session

**Persona:** An agent session (or the maintainer driving it) working inside a `worktree-always` project's linked worktree, for example `/claude-tweaks:flow` mid-build. It is following skill prose whose snippets read `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` and `--session "$CLAUDE_CODE_SESSION_ID"`.
**Goal:** Run those plugin CLIs without the Claude Code harness's worktree Bash guard refusing them as "a value computed at runtime", and without rediscovering the workaround one refusal at a time.
**Entry point:** `_shared/worktree-setup.md`'s Post-creation catch-up, read right after the worktree is created (or adopted), followed by the first skill snippet that names `${CLAUDE_PLUGIN_ROOT}` or `$CLAUDE_CODE_SESSION_ID`.
**Success state:** Every later plugin command in the session runs with the plugin root and session id already written out as literal text. No runtime-variable refusal fires for either value, and subagent prompts carry the same literals.

## Steps

1. **Read the literal-resolution rule** — The worktree is created and the catch-up section is read.
   - **Action:** `_shared/worktree-setup.md`'s **Resolve plugin-supplied values to literals once.** paragraph, which sits just after the guard note and before the unconditional `git fetch`/`git merge`.
   - **Should feel:** Forewarned. The session knows up front that `CLAUDE_PLUGIN_ROOT` is unset in Bash and that the guard refuses both variables as runtime values.
   - **Should understand:** This is the harness's guard (`_shared/scratch-worktree.md` §7), not a plugin hook. The only fix is to stop passing variables.
   - **Red flags:** The session treats the rule as a step to run before the catch-up's fetch/merge, or goes looking for a plugin hook to "fix".

2. **Resolve both values once** — The first later command needs the plugin root or the session id.
   - **Action:** The plugin root comes from the invoking claude-tweaks skill's `Base directory for this skill:` line minus its trailing `skills/{name}`. With no Skill invocation, it is the read file's own path cut before its `skills/` segment. The session id comes from one plain `printenv CLAUDE_CODE_SESSION_ID` call.
   - **Should feel:** One small, deliberate step, not a search.
   - **Should understand:** There is no lookup ladder and no glob over the plugin cache. The value comes from what the session already has.
   - **Red flags:** A `find ~/.claude/plugins …` probe. A `superpowers:*` skill's base directory used as the plugin root. A `Cannot find module '…/skills/bin/…'` error, which means the path was cut at the wrong level.

3. **Run commands with literals** — Every subsequent snippet is executed.
   - **Action:** The session writes `node "/abs/plugin/root/bin/hooks.js" …` and the literal session id into each command, and into any subagent dispatch prompt it composes.
   - **Should feel:** Uneventful. Commands run on the first try.
   - **Should understand:** Skill prose keeps the `${CLAUDE_PLUGIN_ROOT}` spelling on purpose. Substitution is the reader's job, every time.
   - **Red flags:** A refusal reading "runs node with a value computed at runtime (the variable CLAUDE_PLUGIN_ROOT)". A subagent that fails because its prompt still carried the bare placeholder.

## Outcome

Plugin-templated commands in a worktree session stop tripping the harness guard. The session resolves two values once and reuses them as literals for the rest of the run, including in delegated subagent prompts.

_Origin: record #2702 (reshaped to doc-only: the refusals come from the harness guard, not `pre-tool-use.js`), built 2026-10-16._
