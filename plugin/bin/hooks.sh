#!/bin/sh
# bin/hooks.sh — node-resolving launcher for bin/hooks.js (#5392). Every hook
# registration runs `sh "${CLAUDE_PLUGIN_ROOT}/bin/hooks.sh" <event>`; this
# script finds a node and execs hooks.js with the same arguments, so stdout,
# stderr and exit status are exactly hooks.js's.
#
# Never-break-a-session invariant (docs/hooks.md): every path with no node
# found drains stdin and exits 0. Nothing before the exec reads stdin or
# writes to stderr.
#
# POSIX sh only: this must run under dash (ubuntu /bin/sh) and bash 3.2
# (macOS /bin/sh). No [[, local, function, arrays, $'...', source, echo -e,
# <(...), ${v//...}, or == inside [ ]. No set -e and no set -u.
#
# Test seam: CLAUDE_TWEAKS_NODE_CANDIDATES, when set (empty included), holds
# one absolute path per line and replaces the whole well-known list. It never
# replaces `command -v node` or the saved-path rung.
#
# Windows: Claude Code runs a hook command through Git Bash on Windows (or
# PowerShell when Git Bash is not installed) — "The `command` string is passed
# to a shell: `sh -c` on macOS and Linux, Git Bash on Windows, or PowerShell
# when Git Bash isn't installed" (code.claude.com/docs/en/hooks.md, "Exec form
# and shell form"). Git Bash is a stated Windows requirement of this launcher.

case $0 in
  */*) dir=${0%/*} ;;
  *) dir=. ;;
esac
hooks_js=$dir/hooks.js

# 1. node on PATH.
if command -v node >/dev/null 2>&1; then exec node "$hooks_js" "$@"; fi

# 2. The node path saved at session start. A missing trailing newline still
# counts; a missing file prints nothing.
p=
{ IFS= read -r p < "$HOME/.claude-tweaks/node-path"; } 2>/dev/null
if [ -n "$p" ] && [ -f "$p" ] && [ -x "$p" ]; then exec "$p" "$hooks_js" "$@"; fi

# 3. Well-known installs, one path per line.
default_candidates() {
  nvm=${NVM_DIR:-$HOME/.nvm}
  a=
  { IFS= read -r a < "$nvm/alias/default"; } 2>/dev/null
  # Only a literal version is used. An alias with a `/` (`lts/*`) names no
  # directory; `node` or `22` names one that does not exist, so its candidate
  # just misses. An alias can hold `22.1.0` without the `v` its
  # versions/node/v22.1.0 directory carries, so a bare version also tries
  # the `v` spelling: the same version, not a guess.
  if [ -n "$a" ]; then
    case $a in
      */*) ;;
      *)
        printf '%s\n' "$nvm/versions/node/$a/bin/node"
        case $a in
          v*) ;;
          *) printf '%s\n' "$nvm/versions/node/v$a/bin/node" ;;
        esac
        ;;
    esac
  fi
  printf '%s\n' "$HOME/.volta/bin/node"
  printf '%s\n' /opt/homebrew/bin/node
  printf '%s\n' /usr/local/bin/node
  if [ -n "${FNM_DIR:-}" ]; then
    printf '%s\n' "$FNM_DIR/aliases/default/bin/node"
  else
    printf '%s\n' "$HOME/.local/share/fnm/aliases/default/bin/node"
    printf '%s\n' "$HOME/Library/Application Support/fnm/aliases/default/bin/node"
    printf '%s\n' "$HOME/.fnm/aliases/default/bin/node"
  fi
}

if [ "${CLAUDE_TWEAKS_NODE_CANDIDATES+set}" = set ]; then cands=$CLAUDE_TWEAKS_NODE_CANDIDATES
else cands=$(default_candidates)
fi
# Split on newlines only, with globbing off: a candidate path can hold spaces
# (`Library/Application Support/fnm`) or glob characters. Both are restored
# before the exec and after the loop.
nl='
'
saved_ifs=$IFS; IFS=$nl; set -f
for c in $cands; do
  if [ -f "$c" ] && [ -x "$c" ]; then IFS=$saved_ifs; set +f; exec "$c" "$hooks_js" "$@"; fi
done
IFS=$saved_ifs; set +f

# 4. No node. pre-tool-use under a worktree-always main checkout denies the
# four write tools; session-start and user-prompt-submit print a warning;
# every other event prints nothing. Stdin is drained so the writer never sees
# EPIPE, and the exit is 0 on every path. Output is fixed literals only: no
# input is ever interpolated.

# policy_verdict <root>: `on` or `off` for <root>/.claude-tweaks/policy.yml,
# mirroring resolveWorktreeAlways (lib/policy.js) over parseFlatLines
# (lib/policy-schema.js). ws is JS `\s`: the ASCII members plus the UTF-8
# bytes of its non-ASCII ones; LC_ALL=C makes awk match bytes.
policy_verdict() {
  [ -n "$1" ] && [ -f "$1/.claude-tweaks/policy.yml" ] || { printf '%s\n' off; return 0; }
  LC_ALL=C awk '
BEGIN {
  ws = "([ \t\r\f\v]|\302\240|\341\232\200|\342\200[\200-\212]|\342\200[\250\251\257]|\342\201\237|\343\200\200|\357\273\277)"
  hc = 0; ha = 0
}
{
  line = $0
  if (line ~ ("^" ws)) next
  sub(ws "+$", "", line)
  if (substr(line, 1, 16) == "worktree-always:") { v = substr(line, 17); k = "c" }
  else if (substr(line, 1, 16) == "worktree.always:") { v = substr(line, 17); k = "a" }
  else next
  sub(/#.*/, "", v)
  sub("^" ws "+", "", v)
  sub(ws "+$", "", v)
  if (v == "") next
  if (k == "c") { canon = v; hc = 1 } else { alias = v; ha = 1 }
}
END {
  r = "off"
  if (hc) { if (canon == "true") r = "on" }
  else if (ha) { if (alias == "true") r = "on" }
  print r
}' "$1/.claude-tweaks/policy.yml" 2>/dev/null || printf '%s\n' off
}

# main_root: the main checkout root of the process cwd, mirroring
# mainCheckoutRoot (lib/hooks/worktree-detect.js). Returns 1 when unresolved,
# including a directory it cannot search or a .git file it cannot read, so it
# never hands back an ancestor's root. The stdin `cwd` is never parsed.
main_root() {
  d=$(pwd -P 2>/dev/null) || return 1
  while [ -n "$d" ]; do
    [ -x "$d" ] || return 1
    if [ -d "$d/.git" ]; then printf '%s\n' "$d"; return 0; fi
    if [ -f "$d/.git" ]; then
      [ -r "$d/.git" ] || return 1
      g=$(LC_ALL=C awk '{ if (sub(/^gitdir:[ \t\r\f\v]*/, "")) { sub(/[ \t\r\f\v]+$/, ""); if ($0 != "") { print; exit } } }' "$d/.git" 2>/dev/null) || return 1
      [ -n "$g" ] || return 1
      # Absolute (POSIX, or a Windows drive path in Git Bash) or relative to
      # the .git file. Only a linked worktree's gitdir, under .git/worktrees/,
      # names a main checkout: the text before it is that checkout, the same
      # split mainCheckoutRoot makes on WORKTREE_ADMIN_MARKER. A submodule's
      # .git/modules/ gitdir or any other shape is unresolved (cwd fallback).
      case $g in /*|[A-Za-z]:*) ;; *) g=$d/$g ;; esac
      case $g in
        */.git/worktrees/*) (cd "${g%%/.git/worktrees/*}" 2>/dev/null && pwd -P); return ;;
      esac
      return 1
    fi
    [ "$d" = / ] && return 1
    d=${d%/*}
    [ -n "$d" ] || d=/
  done
  return 1
}

# tool_class: reads stdin to EOF; `write` for a Bash, Edit, Write or
# NotebookEdit tool_name, else `other`. A line match, not a JSON parse: it
# needs the unescaped `"tool_name"` key and its value on one line, as Claude
# Code's compact payload has them, so a `\"tool_name\"` inside a string value
# never matches. Widening the pattern widens the deny.
tool_class() {
  LC_ALL=C awk '
!w && /"tool_name"[ \t\r]*:[ \t\r]*"(Bash|Edit|Write|NotebookEdit)"/ { w = 1 }
END { print (w ? "write" : "other") }' 2>/dev/null || printf '%s\n' other
}

# The deny is decided before the drain: tool_class reads stdin only when the
# policy is on (the && short-circuit), and the cat below drains whatever is
# left on every path. Any new stdin reader goes before that cat.
deny=
if [ "$1" = pre-tool-use ]; then
  root=$(main_root) || root=
  [ -n "$root" ] || root=$(pwd -P 2>/dev/null)
  if [ "$(policy_verdict "$root")" = on ] && [ "$(tool_class)" = write ]; then deny=1; fi
fi
cat >/dev/null 2>&1
case $1 in
  session-start) printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"claude-tweaks: hooks cannot run in this session because no `node` was found: not on the PATH Claude Code started with, not at the path saved by an earlier session, not at a well-known install location. Every claude-tweaks guard is off for this session (the node-run checks: the write gate, the commit and push checks, run event logging; in a worktree-always project the launcher instead denies Bash, Edit, Write and NotebookEdit). Tell the user this in your next reply and stop making repository edits. The fix is to quit and restart Claude Code from a shell where `node` resolves (`command -v node` prints a path)."}}' ;;
  user-prompt-submit) printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"claude-tweaks: hooks cannot run in this session because no `node` was found: not on the PATH Claude Code started with, not at the path saved by an earlier session, not at a well-known install location. Every claude-tweaks guard is off for this session (the node-run checks: the write gate, the commit and push checks, run event logging; in a worktree-always project the launcher instead denies Bash, Edit, Write and NotebookEdit). Tell the user this in your next reply and stop making repository edits. The fix is to quit and restart Claude Code from a shell where `node` resolves (`command -v node` prints a path)."}}' ;;
  pre-tool-use) [ -z "$deny" ] || printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"claude-tweaks: no `node` was found for this session, so its hooks cannot check this call, and this project requires an isolated worktree (worktree-always in .claude-tweaks/policy.yml). Every Bash, Edit, Write and NotebookEdit call is denied until restart; asking the user and leaving the worktree still work. Tell the user, then quit and restart Claude Code from a shell where `node` resolves (`command -v node` prints a path)."}}' ;;
esac
exit 0
