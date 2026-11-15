---
files:
  - plugin/hooks/hooks.json
  - plugin/bin/hooks.sh
  - plugin/.gitattributes
  - plugin/bin/lib/hooks/session-start.js
  - docs/hooks.md
---

# Keep claude-tweaks Hooks Running When `node` Is Not on the Session's PATH

**Persona:** a developer on macOS whose `node` comes from nvm (or fnm, asdf, Volta) loaded lazily in `~/.zshrc`. Some days they start Claude Code from an app launcher or an IDE terminal whose PATH has no `node`. Their project sets `worktree-always: true` in `.claude-tweaks/policy.yml`. Step 5 follows a teammate on the same project who runs Claude Code on Windows with Git for Windows installed.
**Goal:** every claude-tweaks hook either runs under a real `node` or says loudly that it cannot. A session never runs on with every guard silently off.
**Entry point:** any Claude Code session start with the claude-tweaks plugin enabled.
**Success state:** in the common case the hooks run exactly as before, through the node that `sh "${CLAUDE_PLUGIN_ROOT}/bin/hooks.sh"` found. When no node is findable anywhere, the session's first context tells the model (and so the user) that the guards are off and to restart from a shell where `command -v node` prints a path. In a `worktree-always` project, Bash, Edit, Write and NotebookEdit are denied until that restart. AskUserQuestion and ExitWorktree still work.

## Steps

### 1. Start a session from a normal shell — node on PATH
- **URL:** `claude` started from a terminal where `command -v node` prints a path
- **Action:** start the session and work as usual.
- **Should feel:** nothing changed. No new message, no extra latency anyone would notice: the launcher adds one `sh` startup, about 2ms on a 2026 MacBook, before it `exec`s `node hooks.js <event>`.
- **Should understand:** `session-start` now saves that node's path to `~/.claude-tweaks/node-path`. It writes only when the stored path differs, and a failed write never changes the hook's output. This is what makes step 2 work on a day PATH loses `node`.
- **Red flags:** any hook output or exit status that differs from what `node plugin/bin/hooks.js <event>` prints for the same input. A `~/.claude-tweaks/node-path` rewritten on every session start (its mtime should move only when the node changes).

### 2. Start a session where PATH has no `node` — saved path or a well-known install exists
- **URL:** `claude` started from an app launcher, or a shell where nvm has not loaded
- **Action:** start the session and run a covered write, for example `git commit` from the main checkout.
- **Should feel:** exactly like step 1. The worktree-always deny, the write gate and the commit checks all fire as they would with `node` on PATH.
- **Should understand:** the launcher tries, in order: `command -v node`, then the saved `~/.claude-tweaks/node-path` when it names an executable file, then the nvm default alias when it names a literal version directory (`lts/*`, `node` and partial versions like `22` are skipped, never guessed), then `~/.volta/bin/node`, `/opt/homebrew/bin/node`, `/usr/local/bin/node`, and fnm's default alias. The first hit is `exec`ed with no probe, so a hit that cannot run `hooks.js` (an asdf shim with no version set) fails as before.
- **Red flags:** a hook exiting 127 (`/bin/sh: node: command not found`) while a saved path or a well-known install exists. Any stderr from the launcher itself before it hands off to node.

### 3. Start a session where no node can be found at all
- **URL:** `claude` started with PATH lacking `node`, no `~/.claude-tweaks/node-path`, and no install at a well-known location
- **Action:** start the session and send the first prompt.
- **Should feel:** loud and unambiguous, not broken. The model's first reply says claude-tweaks hooks cannot run because no `node` was found, that the guards are off, and that the fix is to quit and restart Claude Code from a shell where `node` resolves. Nothing else about the session errors out.
- **Should understand:** with no node, `hooks.sh` reads stdin to EOF, always exits 0, and prints only fixed JSON literals. `session-start` and `user-prompt-submit` print one `additionalContext` warning. `session-end`, `pre-compact`, `post-tool-use`, `post-tool-use-failure` and `subagent-stop` print nothing. Outside a `worktree-always` project the session is warned, never blocked, because the plugin is often enabled user-wide. The full per-event contract, the resolution order and the Windows requirement are `docs/hooks.md`'s "Node launcher (#5392)" bullet.
- **Red flags:** a session that runs on with no warning at all, which is the 2026-11-13 ungated build this record exists to prevent. A non-zero hook exit. Any text from the stdin payload echoed into hook output.

### 4. Try to edit in a `worktree-always` project with no node — main checkout or a linked worktree
- **URL:** a Bash, Edit, Write or NotebookEdit tool call in the step-3 session, in a repo whose main checkout's `.claude-tweaks/policy.yml` sets `worktree-always: true`
- **Action:** let the agent attempt the edit, then have it ask the user a question or leave the worktree.
- **Should feel:** deliberately stopped, with the way out named. The edit is denied with a reason that says to restart Claude Code from a shell where `node` resolves. Asking the user (AskUserQuestion) and leaving the worktree (ExitWorktree) still go through, so the model can explain the situation instead of being stuck.
- **Should understand:** the launcher reads the policy from the main checkout, resolved from its own process cwd and never from the stdin JSON. It denies inside a linked worktree too. It matches the payload's `tool_name` against fixed patterns, so only those four tools are denied; Agent and Task are not denied, but the subagents they spawn hit the same no-node hook. The shell policy check mirrors `parseFlatLines` and `resolveWorktreeAlways`, and `tests/hooks-launcher.test.js`'s `hooks.sh AC9` differential pins the two to the same verdict.
- **Red flags:** an AskUserQuestion or ExitWorktree call denied. An edit allowed in a project whose main checkout has `worktree-always: true` (including a `worktree.always: true` alias line, CRLF line endings, or a trailing `# comment`). A deny in a project without that policy.

### 5. Run the plugin on Windows
- **URL:** Claude Code on Windows with Git for Windows installed
- **Action:** start a session.
- **Should feel:** the same as step 1. Claude Code runs hook commands through Git Bash, which ships `sh`.
- **Should understand:** `plugin/.gitattributes` keeps `hooks.sh` LF even on a `core.autocrlf` checkout, since `sh` cannot run a CRLF script. Without Git Bash, Claude Code falls back to PowerShell and there is no `sh`, so every claude-tweaks hook fails. Git Bash is therefore a stated Windows requirement in README's Dependencies table.
- **Red flags:** `hooks.sh` checked out with CRLF line endings. Hooks failing on a Windows machine that has Git Bash.

## Origin
- Created during build of #5392. On 2026-11-13 a whole session ran with every claude-tweaks gate failed open because the session's PATH had no `node`: each hook exited 127, which Claude Code reports only as a non-blocking error. Every `hooks.json` registration now runs through the POSIX `sh` launcher `plugin/bin/hooks.sh`, and `session-start` saves the node path for the launcher's second rung. Plan review settled the deny scope (only the four write tools, matched on `tool_name`), the cwd source (the process cwd, never the stdin `cwd`; a live probe found the two equal after a Bash `cd`), and Git Bash as the Windows requirement.
- Related journeys: `run-shell-loops-without-a-hook-storm-3074.md` (same registrations; `exec` keeps one process per hook), `recover-from-a-bookkeeping-stamp-deny.md` (another deny the pre-tool-use hook issues).
