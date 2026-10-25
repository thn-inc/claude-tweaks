---
files:
  - plugin/bin/lib/hooks/pre-tool-use.js
  - plugin/skills/_shared/policy-schema-coverage.md
  - tests/hooks-policy-exemption.test.js
---

# Delete a Remote Branch with `git -C`

**Persona:** A worktree-isolated Claude Code session in a `worktree-always: true` project. Its PR just merged, and it wants to remove the run's remote branch. It addresses every git command with `git -C "<path>"`, because the harness guard refuses `cd … &&` chains.
**Goal:** Delete the remote branch with one `git -C "<path>" push origin --delete <branch>` call, without the worktree-always gate denying it.
**Entry point:** A cleanup step after merge, where the session runs a branch-delete push against a non-isolated checkout path (for example the main checkout, after the worktree is gone).
**Success state:** The PreToolUse gate lets the push through, git deletes the remote ref, and the session never needs the `gh api -X DELETE` fallback.

## Steps

### 1. Issue the branch-delete push — `git -C "<path>" push origin --delete <branch>`
- **URL:** one Bash call, e.g. `git -C "/Users/x/Code Workspaces/repo" push origin --delete feature-x` (or the `:feature-x` refspec form)
- **Action:** The session runs the push as one plain command. The `-C` path is single- or double-quoted when it holds a space; a bare path needs no quotes.
- **Should feel:** Like the bare `git push origin --delete <branch>` form. The same command shape the session uses everywhere else just works.
- **Should understand:** The exemption admits one optional `-C <path>` before `push`, then exactly one remote and one branch. The path follows the same quoting rules as the other allowlisted commands: a double-quoted path may not contain `$`, a backtick or a backslash.
- **Red flags:** The gate denies the call and its message points to `gh api -X DELETE` — the pre-#3900 behavior for every `git -C` form.

### 2. Keep anything else denied — the gate's whole-command match
- **URL:** the same gate, on a command that only resembles a branch delete
- **Action:** The session (or a careless edit) adds something to the push: a content push (`git -C "<path>" push origin feature-x`), a chained command (`… --delete a && rm -rf x`), an extra flag (`--force`), a second `-C`, or `-C` placed after `push`.
- **Should feel:** Predictable. Anything beyond the exact delete shape is denied the same way as before, with the `gh api -X DELETE` / `gh pr merge --delete-branch` fallbacks named.
- **Should understand:** The whole command string must match the grammar. The exemption is a ref-only delete, so it never lets content reach the branch or rides along with another command.
- **Red flags:** A compound command, a content push, or a `"$WT"`-style path slips through because the `-C` form was admitted.

## Origin
- Created during build of #3900 (delete-only push exemption admits `git -C`)
- Extends #658's delete-only push exemption; the regex is `DELETE_ONLY_PUSH_ALLOWLIST` in `plugin/bin/lib/hooks/pre-tool-use.js`
