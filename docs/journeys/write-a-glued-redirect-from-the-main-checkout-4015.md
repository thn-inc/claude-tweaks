---
files:
  - plugin/bin/lib/hooks/git-command.js
  - plugin/bin/lib/hooks/bash-prefilter.js
  - plugin/skills/_shared/policy-schema-coverage.md
---

# Write a Glued Redirect From the Main Checkout

**Persona:** An agent session working in the main checkout of a `worktree-always` project. It writes compact shell (`echo foo>x`, `cat a.txt>b.txt`) with no space before the `>`. Nobody reviews each Bash call.
**Goal:** Every real redirect into a repo file is denied, however it is spaced. A `>` that bash never treats as a redirect still runs: one in a quoted argument, an escaped `\>`, a `$VAR` expansion, `((i>0))` arithmetic, an fd close `>&-`, or a heredoc body fed to an allowlisted data reader (`node`, `cat`, …).
**Entry point:** A Bash tool call from the main checkout. The bash prefilter (`bash-prefilter.js`'s `hasFileRedirection`) runs first, then `git-command.js`'s `fileWriteTargets` in the PreToolUse handler.
**Success state:** `echo foo>tracked.js` gets the same `claude-tweaks: this project requires an isolated worktree` denial as `echo foo > tracked.js`. The same session's `git commit -m "a>b"`, `node -e "x>y"`, `if ((n>0)); then …; fi`, `[[ a>b ]]` and `exec 3>&-` run without a denial.

## Steps

### 1. Glue a redirect to a word: main checkout, no worktree
- **URL:** A Bash call such as `echo foo>tracked.js` or `cat a.txt>b.txt`, run in the main checkout
- **Action:** The session runs it.
- **Should feel:** Consistently refused. The denial reads exactly as it would for the spaced form, with the usual "use a worktree" remediation.
- **Should understand:** Bash ends a word at an unquoted `>`, so `foo>x` is the word `foo` plus a redirect to `x`. The scan now tries a redirect glued to a preceding word (`gluedRedirectOpEnd`, reading `tokenize`'s per-character `spanKinds` mask) once the start-anchored check misses. The word may hold a quoted span (`echo "hi">x`) or be a one-word group (`(ls)>out`), since only the `>` itself has to be unquoted (#4210). It covers `>>`, `>|`, `&>`, a target on the next token (`foo> x`), and a target named by `$VAR` (`foo>$WT/x`). The prefilter forwards the same quoting flags, so the call never takes the skip path.
- **Red flags:**
  - `echo foo>tracked.js` runs while `echo foo > tracked.js` is denied.
  - The prefilter skips the call (no hook output at all), so the parser never runs.

### 2. Use `>` that bash never redirects: same session
- **URL:** Bash calls such as `git commit -m "a>b"`, `echo 'foo>x'`, `echo foo">"x`, `echo ">x"`, `gh issue comment 1 --body "> quoted reply"`, `echo foo\>x`, `V="a>b"; echo $V`, `((i>0))`, `exec 3>&-`, `echo foo>/dev/null`, and `node x.js <<EOF … if (a>0) … EOF`
- **Action:** The session runs each.
- **Should feel:** Uneventful. None of them is denied, and nobody has to rewrite a commit message or a comparison to get past the gate.
- **Should understand:** The scan reads a `>` as a redirect only when the `>` itself is outside every quote and not escaped, in any position: at the start of a word (`echo ">x"` is a word) or glued to one. A `$( … )`, `${ … }`, or backtick nested inside double quotes counts as quoted, so the `>` in `echo "$(jq ".a>1" f)"` is literal even though its own inner quotes flip the outer ones. For a glued `>`, the bare part of the word before it must also hold no `$`, backtick, or `(`; an escaped character there is fine (`echo foo\ bar>x`). The one exception is a single balanced group such as `(ls)` or `$(date)`. It decides this on the token as typed, before `$VAR` substitution. In bash, any of those can make the `>` literal, put it in an expansion, or make it arithmetic. A `>` inside a `[[ … ]]` or `(( … ))` body (`[[ a>b ]]`, `(( x>y ))`) is a comparison, so the scan skips to the token after the closer. An fd duplication or close (`>&2`, `>&-`, `>&3-`) and a `/dev/null`-style sink are never file targets. A heredoc body fed to an allowlisted data reader is dropped before the scan (#3989, #4149); any other body stays visible and is scanned as its own chunk.
- **Red flags:**
  - A denial naming a target like `0))`, `y"`, or `&-`: a fragment of a comparison or an fd close read as a path.
  - A quoted commit message containing `>` that is refused.

### 3. Know the documented gaps: same session
- **URL:** `plugin/skills/_shared/policy-schema-coverage.md`'s "Bare shell redirection is covered (#3080)" paragraph
- **Action:** Read it before relying on the gate for an unusual shape.
- **Should feel:** Clear about where the line is. The prose names the glued-word form and the characters that switch it off.
- **Should understand:** Some shapes are deliberately left out and resolve no target, on the gate's "ambiguity allows" side. They are a `>` after a nested or arithmetic group (`$((1))>x`, `((i>0))>x`), and a redirect later in a command whose quoted `"$( … )"` the nesting walk cannot see closing. That happens with an apostrophe or backtick in the body of a `"$(cat <<EOF … EOF\n)"` heredoc whose body stays visible to the scan (an unquoted delimiter with a `$(` in the body). A quoted-delimiter body (`<<'EOF'`) is dropped first, and a `(`, `)` or `'` inside `"${ … }"` is literal word text, so neither hides a later redirect. Chained glued redirects (`a>b>c`) resolve one joined name. An unmatched closer inside `"$( … )"` (`case a)`, a bare `}`) can still end the nesting early and name a junk target: a false deny. These are tracked follow-ups, not supported bypasses.
- **Red flags:** A skill or procedure that tells agents to write `"…">file` precisely because the gate misses it.

## Origin
- Created during the build of #4015. The #3989 build found that `REDIRECT_OP_RE` only matched an operator at the start of a token, so `echo foo>x` reached the main checkout unseen (its ledger item 9). `tokenize` now carries a `doubleQuoted` flag beside `singleQuoted`. The final whole-branch review added the `(` exclusion (bash arithmetic) and the fd-close exclusion. #4210 made `tokenize` record a per-character span mask, so a redirect glued after a quoted span or a one-word group is seen. Its final whole-branch review added the bare-operator rule for a leading `>`, and the cross-segment `"$( … )"` nesting walk that keeps the new tokenizer from naming junk targets. The review of that branch made the heredoc stripper read a heredoc opened inside `"$( … )"` and the nesting walk treat `${ … }` as literal word text, which closed two fail-open regressions against main.
- Updated during build of #4149. The one-word subshell `(ls)>out` left step 3's list of shapes that resolve no target: the shell walk now cuts the segment at the group's `)`, so `>out` reaches the redirect scan as its own token.
- Updated when #4149 merged #4210. The shell walk carries #4210's nesting state from piece to piece, and a heredoc opened inside a quoted `"$( … )"` is judged by that substitution's own command, so `"$(cat <<'EOF' … EOF)"` strips its body and `"$(bash <<'EOF' … EOF)"` keeps it. `(a(b))>x`, a syntax error in bash, keeps its group redirect: a spurious deny, never a leak.
- Related journeys: `run-a-heredoc-node-script-from-the-main-checkout-3989.md` (the heredoc-body carve-out on the same scan), and `run-shell-loops-without-a-hook-storm-3074.md` (the prefilter that fronts it).
