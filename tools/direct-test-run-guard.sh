# tools/direct-test-run-guard.sh — the prefilter in front of tools/direct-test-run-guard.js (#5794).
#
# .claude/settings.json sources this file into the hook's own shell on every Bash call:
#   d="$CLAUDE_PROJECT_DIR/tools/direct-test-run-guard"; [ -r "$d.sh" ] && command . "$d.sh"; node "$d.js"; exit 0
# It reads the hook payload and starts node only when the command could be one the guard denies.
# Every other call ends here, in the shell that was already running: no fork, no exec.
#
# When node can be skipped. The guard denies a typed direct test run, or a script that starts one,
# and both need a program word at a program position: node, npx, a shell, eval, source or `.`, a
# program named by path, or a word that moves the program further along (a keyword, a prefix
# command, xargs, parallel, find). So a call is skipped only when every fragment of the command,
# cut at every ; & | ( ) { } backtick and newline whether quoted or not, starts with a word made of
# A-Za-z0-9_.+- alone that is none of those words. A quote, $, =, /, backslash, redirection
# character or non-ASCII byte in a first word sends the call to node, and so does anything this
# file cannot read plainly: another JSON escape, a payload of another shape, or one over the caps.
# Cutting inside quotes only adds fragments, so it can add node runs and never remove one.
#
# Faults. Everything below this comment is one brace group, so the shell reads the whole group
# before it runs any command in it: a syntax fault inside it (conflict markers, a cut-off file) is
# found before anything reads stdin. With CRLF line endings the brace is not read as a brace: the
# shell reports unknown commands on stderr and then stops at a syntax error in the first function,
# again before anything reads stdin. `command .` then returns, and the hook command's own
# `node "$d.js"` runs the guard on the untouched stdin, as the registration did before #5794. Under
# Git Bash, which reads CRLF line endings as LF, a CRLF copy is simply read and works. The
# hook command ends in `exit 0`, and nothing here prints to stdout.
#
# POSIX sh only: dash, bash 3.2 (macOS /bin/sh) and Git Bash run it. No [[, local, arrays, $'...'
# or ${v//...}. Claude Code passes a hook command to `sh -c` on macOS and Linux and to Git Bash on
# Windows. Each scan is one field split and a loop over at most 256 pieces, so the work is linear
# in the payload and bounded by the caps.
#
# Test seam: with DIRECT_TEST_RUN_GUARD_LIB set, sourcing this file only defines the functions.

{
# dtrg_scan <payload>: status 0 when node must judge the call, 1 when no rule of the guard can
# deny it. It changes IFS and turns globbing off; direct_test_run_guard_needs_node restores both.
dtrg_scan() {
  dtrg_payload=$1
  [ "${#dtrg_payload}" -le 8192 ] || return 0
  set -f

  # 1. The JSON text of the one "command" string, read between the payload's quotes. A piece that
  # ends in a backslash ended at an escaped quote, so the string goes on. A second `command` piece
  # anywhere is a shape this does not read. In a shell that does not split an unquoted expansion
  # the loop sees one piece and the state never reaches 3.
  IFS='"'
  dtrg_state=0
  dtrg_json=
  dtrg_n=0
  for dtrg_f in $dtrg_payload; do
    dtrg_n=$((dtrg_n + 1))
    [ "$dtrg_n" -le 256 ] || return 0
    case $dtrg_state in
      0) case $dtrg_f in command) dtrg_state=1 ;; esac ;;
      1) case $dtrg_f in :) dtrg_state=2 ;; command) ;; *) dtrg_state=0 ;; esac ;;
      2) case $dtrg_f in
           *\\) dtrg_json=$dtrg_json$dtrg_f\" ;;
           *) dtrg_json=$dtrg_json$dtrg_f; dtrg_state=3 ;;
         esac ;;
      3) case $dtrg_f in command) return 0 ;; esac ;;
    esac
  done
  [ "$dtrg_state" -eq 3 ] || return 0

  # 2. Its JSON escapes, read between backslashes: a quote, a newline and a tab are read (a tab
  # as a blank) and any other escape goes to node. An escaped backslash leaves an empty piece
  # between its two backslashes, so a backslash in the command goes to node too.
  IFS='\'
  dtrg_nl='
'
  dtrg_cmd=
  dtrg_first=1
  dtrg_n=0
  for dtrg_f in $dtrg_json; do
    dtrg_n=$((dtrg_n + 1))
    [ "$dtrg_n" -le 256 ] || return 0
    if [ -n "$dtrg_first" ]; then
      dtrg_cmd=$dtrg_f
      dtrg_first=
    else
      case $dtrg_f in
        n*) dtrg_cmd=$dtrg_cmd$dtrg_nl${dtrg_f#n} ;;
        t*) dtrg_cmd="$dtrg_cmd ${dtrg_f#t}" ;;
        \"*) dtrg_cmd=$dtrg_cmd$dtrg_f ;;
        *) return 0 ;;
      esac
    fi
  done

  # 3. The first word of every fragment.
  dtrg_seps=";&|(){}\`$dtrg_nl"
  IFS=$dtrg_seps
  dtrg_n=0
  for dtrg_f in $dtrg_cmd; do
    dtrg_n=$((dtrg_n + 1))
    [ "$dtrg_n" -le 256 ] || return 0
    IFS=' '
    set -- $dtrg_f
    IFS=$dtrg_seps
    case ${1-} in
      '') ;;
      *[!A-Za-z0-9_.+-]*) return 0 ;;
      # program-words: PROGRAM_WORDS in direct-test-run-guard.js, pinned by tests/direct-test-run-guard.test.js
      node|node.exe|npx|sh|bash|zsh|eval|source|.|do|then|else|if|elif|while|until|env|time|nice|nohup|command|exec|timeout|gtimeout|sudo|xargs|parallel|find) return 0 ;;
    esac
  done
  return 1
}

# direct_test_run_guard_needs_node <payload>: dtrg_scan under byte-wise matching, with IFS,
# globbing and LC_ALL put back, so node starts in the environment the hook was given.
direct_test_run_guard_needs_node() {
  dtrg_ifs=$IFS
  dtrg_lc_set=${LC_ALL+x}
  dtrg_lc=${LC_ALL-}
  LC_ALL=C
  dtrg_scan "$1"
  dtrg_rc=$?
  IFS=$dtrg_ifs
  set +f
  if [ -n "$dtrg_lc_set" ]; then LC_ALL=$dtrg_lc; else unset LC_ALL; fi
  return "$dtrg_rc"
}

# The hook entry. Claude Code writes one JSON line and a newline: that shape is judged, and node,
# when needed, gets the line back through a pipe. Any other stdin (no final newline, more than one
# line, nothing) goes to node byte for byte. Every path ends in `exit 0`, whatever node returned.
direct_test_run_guard_main() {
  dtrg_js=$CLAUDE_PROJECT_DIR/tools/direct-test-run-guard.js
  dtrg_stdin=
  if IFS= read -r dtrg_stdin; then
    dtrg_tail=
    if IFS= read -r dtrg_tail; then
      { printf '%s\n%s\n' "$dtrg_stdin" "$dtrg_tail"; cat; } | node "$dtrg_js"
    elif [ -n "$dtrg_tail" ]; then
      printf '%s\n%s' "$dtrg_stdin" "$dtrg_tail" | node "$dtrg_js"
    elif direct_test_run_guard_needs_node "$dtrg_stdin" && command -v node >/dev/null 2>&1; then
      printf '%s\n' "$dtrg_stdin" | node "$dtrg_js"
    fi
  else
    printf '%s' "$dtrg_stdin" | node "$dtrg_js"
  fi
  exit 0
}

[ -n "${DIRECT_TEST_RUN_GUARD_LIB-}" ] || direct_test_run_guard_main
}
