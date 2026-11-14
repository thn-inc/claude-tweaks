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
nl='
'
saved_ifs=$IFS; IFS=$nl; set -f
for c in $cands; do
  if [ -f "$c" ] && [ -x "$c" ]; then IFS=$saved_ifs; set +f; exec "$c" "$hooks_js" "$@"; fi
done
IFS=$saved_ifs; set +f

# 4. No node: drain stdin so the writer never sees EPIPE, then exit 0.
cat >/dev/null 2>&1
exit 0
