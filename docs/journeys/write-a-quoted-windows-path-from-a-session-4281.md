---
files:
  - plugin/bin/lib/hooks/git-command.js
  - plugin/bin/lib/hooks/bash-prefilter.js
  - plugin/bin/lib/hooks/pre-tool-use.js
  - docs/hooks.md
---

# Write a Quoted Windows Path From a Session

**Persona:** An agent session on Windows in a `worktree-always` project. Claude Code runs its Bash calls through Git Bash, and the session names files by their native paths, quoted the way bash needs them (`tee "D:\repo\a.js"`). Nobody reviews each Bash call.
**Goal:** The worktree guards judge a quoted native path exactly as they judge the same path on macOS or Linux. A write, commit, `mkdir` or worktree teardown that lands in the main checkout is caught, and a path bash would read differently is never turned into a target it does not name.
**Entry point:** A Bash tool call. The bash prefilter (`bash-prefilter.js`) runs first, then `git-command.js`'s `fileWriteTargets`, `mkdirTargets` and `gitTargets`, and `pre-tool-use.js`'s `teardownTargets`, each resolving through `path.win32` on Windows.
**Success state:** `tee "D:\repo\a.js"`, `mkdir -p "D:\repo\new"`, `git -C "D:\repo" commit …` and `cd "D:\repo" && git worktree remove wt`, with `D:\repo` the main checkout, get the same denial or teardown check they get with `/repo` on macOS. The unquoted `tee D:\repo\a.js`, which bash runs as `tee D:repoa.js`, gets no `D:\repo\a.js` target.

## Steps

### 1. Write through a quoted native path: main checkout
- **URL:** A Bash call such as `tee "D:\repo\a.js"`, `echo x > 'D:\repo\a.js'`, `mkdir -p "D:\repo\new"`, `git -C "D:\repo" commit -m msg` or `cd "D:\repo" && git worktree remove wt`, where `D:\repo` is the main checkout
- **Action:** The session runs it.
- **Should feel:** Refused the same way as on macOS, with the usual "use a worktree" remediation. No platform-specific wording, and no gap a Windows session can walk through.
- **Should understand:** `tokenize` now yields each word's bash value. Single-quoted text is kept as typed, double-quoted text loses `\` only before `$`, backtick, `"`, `\` or a newline, and an unquoted `\x` becomes `x`. A backslash left in that value is a path character, so `isUnresolvable` no longer rejects it. Every resolver takes a `pathImpl`, which is `path.win32` on Windows, so `D:\repo\a.js` resolves to itself. That includes `teardownTargets`, which resolves the removed worktree's path through the same resolver. Before #4281, any backslash made the word unresolvable, so a quoted native path failed open.
- **Red flags:**
  - A quoted `D:\…` write into the main checkout runs on Windows while the same `/…` write is denied on macOS.
  - The prefilter skips the call (no hook output at all), so the parsers never run.

### 2. Use a path bash reads differently: same session
- **URL:** Bash calls such as `tee D:\repo\a.js` (unquoted), `tee D:a.js` (drive-relative), and `cd wt\` (a stray trailing backslash)
- **Action:** The session runs each.
- **Should feel:** Judged by what bash actually writes, not by what the text looks like. No denial names a path bash never touches.
- **Should understand:**
  - Unquoted, bash turns `D:\repo\a.js` into `D:repoa.js`, so the guard resolves that word and never reports `D:\repo\a.js`.
  - A drive-relative `D:a.js` resolves against the session cwd when that cwd is on drive `D:`, as Windows resolves it. From a cwd on another drive it gets no target: the per-drive cwd Windows would use is not visible to the hook.
  - Bash 3.2 drops an unquoted trailing `\`, and bash 5 keeps it. Under `path.win32` both readings name the same path, so the guard resolves it. On POSIX it stays unresolvable, as before.
  - A NUL byte is dropped from the command before the scan, as bash drops it when it reads a command from stdin.
- **Red flags:**
  - A denial naming `D:\repo\a.js` for the unquoted form.
  - A same-drive `D:a.js` write into the main checkout that runs without a denial.

### 3. Know the documented gaps: same session
- **URL:** `docs/hooks.md`'s "Bash prefilter (#3074)" bullet, the #4281 parenthetical
- **Action:** Read it before relying on the gate for an unusual path shape.
- **Should feel:** Clear about where the line is. The one deliberate fail-open is named, with its reason.
- **Should understand:** A drive-relative path on a drive other than the session cwd's (`D:repo` from `C:\…`) gets no target, so the guard fails open rather than invent one. The prefilter still anchors such a redirect at its own drive root, so it never skips a call the parsers could judge. Other shapes still give no target, as they did before this change: a literal `$`, backtick or `"` inside a quoted value, and, on POSIX, an escaped trailing space at the end of a command piece (`echo x > a\ ; ls`). They are tracked as one follow-up, not supported bypasses. Under `path.win32` that trailing-space shape now names the path without its space, which errs toward a deny. An escaped redirect operator is no redirect: `cp a 2\>x` copies to the file `2>x`, and the guard reports that file.
- **Red flags:** A skill or procedure that tells agents to write `D:repo`-style paths, or any of the shapes above, because the gate misses them.

## Origin
- Created during the build of #4281, one of the class records split out of #2767's Windows regression baseline. On the Windows runner, the hook suites' Bash fixtures interpolated native temp paths unquoted, and the guards rejected any backslash. So a correctly quoted native path was unprovable and failed open. The final whole-branch review added the NUL strip and the cross-drive tradeoff note.
- Related journeys: `write-a-glued-redirect-from-the-main-checkout-4015.md` (the same tokenizer and redirect scan), and `run-shell-loops-without-a-hook-storm-3074.md` (the prefilter that fronts it).
