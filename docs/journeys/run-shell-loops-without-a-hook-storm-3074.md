---
files:
  - plugin/hooks/hooks.json
  - plugin/bin/hooks.js
  - plugin/bin/lib/hooks/bash-prefilter.js
  - plugin/bin/lib/hooks/git-command.js
  - plugin/bin/lib/hooks/pre-tool-use.js
---

# Run Shell Loops Without a Hook Process Storm

**Persona:** a developer on Windows running a dozen parallel Claude Code sessions against a `worktree-always` project. Their agents routinely issue Bash idioms like `for n in 1 2 3; do gh issue view $n; done` and `P=...; "$P/..."`, and their endpoint antivirus scans every process spawn.
**Goal:** a Bash tool call costs at most one claude-tweaks hook launch per hook event, whatever its shape. The worktree gate still catches every write it caught before, including writes hidden behind a same-command variable.
**Entry point:** any Bash tool call in a session with the claude-tweaks plugin enabled.
**Success state:** the call starts promptly. Exactly one `bin/hooks.js pre-tool-use` and one `post-tool-use` process were launched for it. An uninteresting command (`echo`, `ls`, `node script.js`) exits the hook before any heavy module loads. A covered write (`git commit`, `sed -i`, `cp`, `mkdir`), however it is spelled, still meets the same gate.

## Steps

### 1. Issue a loop or `$VAR` Bash command — any session
- **URL:** a Bash tool call such as `for i in 1; do echo probe-loop-$i; done` or `mkdir -p "$TEMP/probe-dir"`
- **Action:** let the agent run it as usual.
- **Should feel:** instant. There is no multi-second pause before the command runs. On a loaded machine the call no longer contributes 250–400 OS processes; the new figure is 2 hook launches, one per event.
- **Should understand:** Claude Code cannot evaluate per-pattern `if` predicates against a `$VAR` or loop command, and it never deduplicated identical handlers. That is why `hooks.json` now registers exactly one unconditional handler per event. A `--debug-file` log shows one hook line per call even for the old layout, so only a process-level launch count (or `Win32_Process` polling) shows the difference.
- **Red flags:** more than one `hooks.js pre-tool-use` process per Bash call. A `PreToolUse`/`PostToolUse` `Bash` group in `hooks.json` with more than one entry, or with an `if` key.

### 2. Issue a plain, uninteresting command — any session
- **URL:** a Bash tool call such as `echo hi`, `ls -la`, `gh issue view 3074`
- **Action:** run it.
- **Should feel:** the same as bare `node` startup. The hook's skip path costs a few milliseconds above a `node -e ""` launch and prints nothing.
- **Should understand:** `bin/lib/hooks/bash-prefilter.js` runs at the top of `bin/hooks.js`, before its heavy requires. It decides from the raw payload whether the command contains a covered word (git, env, mkdir, or a write shape) anywhere, as a shell word or path basename. If not, the hook exits 0 silently. `perf/hooks-prefilter.test.js` pins this: skip cost under half of full cost.
- **Red flags:** stdout or a systemMessage from the hook on a plain command. `context.js` or `pre-tool-use.js` loaded on that path. Any non-zero hook exit.

### 3. Attempt a covered write from the main checkout, however spelled — main checkout of a `worktree-always` repo
- **URL:** a Bash tool call such as `git commit -m x`, `cd x && git commit -m y`, `/usr/bin/git commit -m x`, `env -i git commit -m x`, or `G=git; $G commit -m x`
- **Action:** run it from the main checkout, with no linked worktree.
- **Should feel:** consistently refused. Every spelling meets the same `worktree-always` deny with the same remediation, and none slips through because of how it was written.
- **Should understand:** the prefilter is a superset of what the full handler can act on. It treats `=` as a separator, so a same-command assignment's value (`G=git`) is seen as the word `git`. It strips quotes, so `"g"it` is seen too. That covers what `git-command.js`'s `substituteVars` resolves. Path-qualified git and `env`-wrapped git are covered end to end. Known limits that remain: concatenated expansion (`G=gi; ${G}t`) and command substitution producing the program name (`$(echo git) push`); the handler cannot resolve the latter either.
- **Red flags:** a shape the parser resolves a target for (`gitTargets`, `fileWriteTargets`, `mkdirTargets`) that is allowed with empty hook stdout. That is a prefilter false skip, a silent gate bypass.

### 4. Stash from inside a linked worktree — worktree session
- **URL:** `git stash` or `git stash pop` issued from a linked worktree
- **Action:** run it.
- **Should feel:** warned, not blocked. A systemMessage explains that the stash stack is shared by every worktree of the checkout, and points at `git show <rev>:<path>` or a WIP commit instead.
- **Should understand:** this warning (`checkGitStashWarn`, #1967) existed before but had no `Bash(git stash *)` predicate, so a plain `git stash` never reached it. With the single handler and the prefilter's `git` word, it now fires as designed.
- **Red flags:** no warning for a bare `git stash` in a linked worktree. A deny instead of a warning.

## Origin
- Created during build of #3074. The per-pattern `if` layout fanned out to 28 + 18 hook launches per `$VAR`/loop Bash call on Windows. It was replaced by one unconditional handler per event and a fail-open command-word prefilter in `bin/hooks.js`. The live launch count was measured with a process-level counter: base 28/18 on loop and `$TEMP` probes, branch 1/1 on every probe. The final whole-branch review caught and closed a `G=git; $G commit` worktree-always bypass in the first prefilter cut.
- Related journeys: `recover-from-a-bookkeeping-stamp-deny.md` (another deny the same pre-tool-use hook issues).
