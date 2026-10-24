---
files:
  - plugin/bin/lib/hooks/git-command.js
  - plugin/bin/lib/hooks/bash-prefilter.js
  - plugin/skills/_shared/policy-schema-coverage.md
---

# Write a Glued Redirect From the Main Checkout

**Persona:** An agent session working in the main checkout of a `worktree-always` project. It writes compact shell (`echo foo>x`, `cat a.txt>b.txt`) with no space before the `>`. Nobody reviews each Bash call.
**Goal:** Every real redirect into a repo file is denied, however it is spaced. A `>` that bash never treats as a redirect still runs: one in a quoted argument, an escaped `\>`, a `$VAR` expansion, `((i>0))` arithmetic, an fd close `>&-`, or a heredoc body.
**Entry point:** A Bash tool call from the main checkout. The bash prefilter (`bash-prefilter.js`'s `hasFileRedirection`) runs first, then `git-command.js`'s `fileWriteTargets` in the PreToolUse handler.
**Success state:** `echo foo>tracked.js` gets the same `claude-tweaks: this project requires an isolated worktree` denial as `echo foo > tracked.js`. The same session's `git commit -m "a>b"`, `node -e "x>y"`, `if ((n>0)); then …; fi`, `[[ a>b ]]` and `exec 3>&-` run without a denial.

## Steps

### 1. Glue a redirect to a word: main checkout, no worktree
- **URL:** A Bash call such as `echo foo>tracked.js` or `cat a.txt>b.txt`, run in the main checkout
- **Action:** The session runs it.
- **Should feel:** Consistently refused. The denial reads exactly as it would for the spaced form, with the usual "use a worktree" remediation.
- **Should understand:** Bash ends a word at an unquoted `>`, so `foo>x` is the word `foo` plus a redirect to `x`. The scan now tries a redirect glued to a preceding bare word (`GLUED_REDIRECT_RE`) once the start-anchored check misses. It covers `>>`, `>|`, `&>`, a target on the next token (`foo> x`), and a target named by `$VAR` (`foo>$WT/x`). The prefilter forwards the same quoting flags, so the call never takes the skip path.
- **Red flags:**
  - `echo foo>tracked.js` runs while `echo foo > tracked.js` is denied.
  - The prefilter skips the call (no hook output at all), so the parser never runs.

### 2. Use `>` that bash never redirects: same session
- **URL:** Bash calls such as `git commit -m "a>b"`, `echo 'foo>x'`, `echo foo\>x`, `V="a>b"; echo $V`, `((i>0))`, `exec 3>&-`, `echo foo>/dev/null`, and `node x.js <<EOF … if (a>0) … EOF`
- **Action:** The session runs each.
- **Should feel:** Uneventful. None of them is denied, and nobody has to rewrite a commit message or a comparison to get past the gate.
- **Should understand:** The scan reads a `>` as a redirect only when the word before it holds no quote, backslash, `$`, backtick, or `(`. It decides this on the token as typed, before `$VAR` substitution. In bash, any of those can make the `>` literal, put it in an expansion, or make it arithmetic. A `>` inside a `[[ … ]]` or `(( … ))` body (`[[ a>b ]]`, `(( x>y ))`) is a comparison, so the scan skips to the token after the closer. An fd duplication or close (`>&2`, `>&-`, `>&3-`) and a `/dev/null`-style sink are never file targets. A heredoc body is dropped before the scan (#3989).
- **Red flags:**
  - A denial naming a target like `0))`, `y"`, or `&-`: a fragment of a comparison or an fd close read as a path.
  - A quoted commit message containing `>` that is refused.

### 3. Know the documented gaps: same session
- **URL:** `plugin/skills/_shared/policy-schema-coverage.md`'s "Bare shell redirection is covered (#3080)" paragraph
- **Action:** Read it before relying on the gate for an unusual shape.
- **Should feel:** Clear about where the line is. The prose names the glued-word form and the characters that switch it off.
- **Should understand:** Some shapes are deliberately left out and resolve no target, on the gate's "ambiguity allows" side. They are a glued redirect after a quoted word (`echo "hi">x`) and a one-word subshell (`(ls)>out`). Chained glued redirects (`a>b>c`) resolve one joined name. These are tracked follow-ups, not supported bypasses.
- **Red flags:** A skill or procedure that tells agents to write `"…">file` precisely because the gate misses it.

## Origin
- Created during the build of #4015. The #3989 build found that `REDIRECT_OP_RE` only matched an operator at the start of a token, so `echo foo>x` reached the main checkout unseen (its ledger item 9). `tokenize` now carries a `doubleQuoted` flag beside `singleQuoted`. The final whole-branch review added the `(` exclusion (bash arithmetic) and the fd-close exclusion.
- Related journeys: `run-a-heredoc-node-script-from-the-main-checkout-3989.md` (the heredoc-body carve-out on the same scan), and `run-shell-loops-without-a-hook-storm-3074.md` (the prefilter that fronts it).
