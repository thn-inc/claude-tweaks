# 0027. Heredoc stripping in the write gate is an allowlist of data readers

- **Status:** accepted
- **Date:** 2026-10-25
- **Context:** #4149 (regression in #3989's fix, found by the v6.153.0 release review); PR #4166

## Context

The `worktree-always` write gate (`plugin/bin/lib/hooks/pre-tool-use.js`'s
`checkWorktreeRequired`) denies a Bash call from the main checkout when it finds a write shape,
including a bare shell redirect. Before #3989 it scanned heredoc bodies as shell, so a `>` inside a
`node <<EOF` script (`x.length > 0`) was read as a redirect and the call was denied.

#3989 fixed that by dropping heredoc bodies before the scan (`git-command.js`'s
`stripHeredocBodies`), unless the body went to a known shell. That made the gate trust every
program it did not list. The v6.153.0 release review found writes it then let through: a body fed
to `make -f -`, `at now` or `/bin/ba[s]h`, a group piped to `sh` on a later line, a
backslash-joined delimiter, and `$[1<<3]`. Any program that can run its stdin is a shell for this
purpose, and that set cannot be listed.

The gate guards against writes into the shared main checkout. A spurious deny costs one retry
from a worktree. A missed write can corrupt the main checkout for every session using it.

## Decision

A heredoc body is dropped from the scan only when every command on its opener line is a known
data reader: `cat`, `tee`, `gh`, `read`, `node`, `python`, `python3`, `jq`, `wc`, or `git` with a
data subcommand. A short list of inert neighbours may share the line (`cd`, `mkdir`, `true`, `:`,
`echo`, `printf`, `git add`). Anything else keeps the body visible: a non-reader, a program word
that cannot be resolved, a substitution that would run with the body on stdin, a configured
`git`, or a structure left open on an earlier line. A kept body is scanned as its own chunk, with
its own quote state and cwd. Where the scanner cannot tell, it keeps the body. A spurious deny is
the accepted price of ruling out a leak.

The full keep and strip rules live in `plugin/skills/_shared/policy-schema-coverage.md`'s bare shell
redirection paragraph, and tests pin them to `git-command.js`'s own sets. This record holds only
the reason for the direction.

## Alternatives considered

- **A denylist of shells (#3989 as shipped).** Rejected: the release review showed it fails open
  for every runner it does not name, and runners cannot be listed.
- **Recognise a fixed set of whole heredoc shapes and keep every other body.** Proposed in
  hindsight (ledger row 64) as a simpler v2. Not taken in #4149 because the allowlist already
  covered the common shapes (`node`/`cat`/`gh … --body-file -`/`git commit -F -`). It stays the
  fallback if the scanner's size or review cost becomes the problem (see Consequences).
- **Never strip bodies.** Rejected: that is the false-positive #3989 fixed, and it denies the
  everyday heredoc node script.

## Consequences

- Easy: a new data reader can be added to the list once it is shown to only read stdin. The list
  grows by evidence, not by guessing which programs are safe to trust.
- Hard: modelling the opener line correctly. `git-command.js` roughly doubled (1093 to 2136
  lines) and now holds a general bash lexer. Each of six review rounds found a new divergence from
  real bash, so changes need checking against real `/bin/bash` 3.2 and bash 5, plus mutants.
- Accepted spurious denies: a body fed to any unlisted program (`while read … done <<EOF`,
  `make -f -`, `at`), and shapes past the 16-entry cwd cap.
- Known gaps that are not covered: a body written to a file and run later (the opaque-program
  gap), and commands inside `$( … )` or backtick bodies, which are deferred.
- One place where the fail-closed rule is not fully followed: a scan pass that uses up its step
  budget (or nests past 32 levels) is re-read the old, flat way instead of returning a
  could-not-parse verdict (ledger row 54).
- Revisit if the spurious-deny rate becomes a real cost, or if the scanner is split out of
  `git-command.js`. A fixed-shape recogniser could then replace the general opener-line model.
