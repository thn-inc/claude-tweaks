---
files:
  - plugin/bin/lib/hooks/git-command.js
  - plugin/bin/lib/hooks/bash-prefilter.js
  - plugin/skills/dispatch/queue-pull-script.md
  - plugin/skills/_shared/policy-schema-coverage.md
---

# Run a Heredoc Node Script From the Main Checkout

**Persona:** An unattended `/claude-tweaks:dispatch` Routine firing in a fresh cloud sandbox. It works in the main checkout of a `worktree-always` project (there is no linked worktree yet). It runs `queue-pull-script.md`'s documented `node .../bin/node-eval-file.js … <<NODE_EVAL_EOF` snippets verbatim. Nobody is present to retry a refused call by hand.
**Goal:** Run a skill-prescribed heredoc script whose JavaScript holds a `>`-shaped comparison (`if (openIds.length > 0) …`) without a `worktree-always` denial. Any real shell redirect into a repo file must still be denied.
**Entry point:** A Bash tool call carrying a `<<WORD` heredoc fed to a non-shell program (`node`, `cat`, `python3`), issued from the main checkout.
**Success state:** The documented snippet runs on the first try. Its only real write target is outside the repo (a session temp file), and the gate stays silent. Add a top-level `echo x > tracked-file.js` to the same command and the same gate denies it, with the usual remediation.

## Steps

### 1. Run the documented grouping snippet — main checkout, no worktree
- **URL:** `plugin/skills/dispatch/queue-pull-script.md`'s grouping block, the `node "{plugin-root}/bin/node-eval-file.js" … > "$DISPATCH_GROUPS" <<NODE_EVAL_EOF … NODE_EVAL_EOF` call
- **Action:** The firing runs the block exactly as written, with its `$DISPATCH_*` paths pointing at session temp files.
- **Should feel:** Uneventful. The call runs. No `claude-tweaks: this project requires an isolated worktree` denial appears, and nobody has to rewrite `openIds.length > 0` as `openIds.length` to get past the gate.
- **Should understand:** The gate's redirect scan (`git-command.js`'s `fileWriteTargets`, and `bash-prefilter.js`'s `hasFileRedirection` in front of it) now drops a heredoc body before scanning, via `stripHeredocBodies`. Text that a non-shell program reads on stdin is data, not shell. So a `>` inside it is not a redirect, and its newlines are not command boundaries. The opener line's own redirect (`> "$DISPATCH_GROUPS"`) is still scanned.
- **Red flags:** A denial naming a target like `0)` or `b)`. That is a fragment of the script's JavaScript, read as a file path. A skill that starts telling agents to avoid `>` in heredoc code.

### 2. Slip a real write in next to the heredoc — same session
- **URL:** The same command with `echo x > tracked-file.js` added after the closing `NODE_EVAL_EOF` line, or on the opener line itself
- **Action:** Run it.
- **Should feel:** Consistently refused. The deny reads exactly as it would for a bare `echo x > tracked-file.js`.
- **Should understand:** Only the body is dropped. Whatever comes after the closing delimiter is scanned as usual, and so is the opener line. The scan also fails closed, keeping the body visible, whenever it cannot prove the body is only data:
  - the body goes to a shell (`bash <<EOF`, `cat <<EOF | sh`, `sudo -s`, `(bash)`, a glued `sh<<EOF`), or the program word is unresolvable (`$SHELL <<EOF`)
  - the delimiter is unquoted and the body contains `$(` or a backtick
  - the delimiter never closes, or uses `$'…'`/`$"…"` quoting
  - the opener line ends in `|`, `&&`, or `||`
- **Red flags:**
  - A real top-level or post-delimiter redirect into a repo file that is allowed.
  - A shell-fed body whose `echo x > f.js` goes unseen.
  - Writing a body to a file and executing it later (`cat > s.sh <<EOF … EOF; bash s.sh`) treated as covered. It is the documented opaque-program gap in `_shared/policy-schema-coverage.md`.

## Origin
- Created during build of #3989. A 2026-10-23 `/claude-tweaks:dispatch next` Routine firing was refused while running `queue-pull-script.md`'s own grouping snippet. The redirect scan had read `openIds.length > 0` inside the heredoc as a write to `0)`. The task review closed the fail-closed cases: shell-fed and expanding bodies, unterminated or `$`-quoted delimiters, glued and grouped shell readers, and continuation lines.
- Related journeys: `run-shell-loops-without-a-hook-storm-3074.md` (the prefilter that fronts the same scan), `work-around-a-refused-worktree-bash-command-2776.md` (refusals from the harness guard, as opposed to this plugin hook).
