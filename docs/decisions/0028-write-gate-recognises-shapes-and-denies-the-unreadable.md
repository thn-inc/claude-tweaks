# 0028. The write gate recognises a fixed set of shapes and denies the unreadable

- **Status:** accepted
- **Date:** 2026-10-30
- **Context:** #4475 (reflect finding from #4303); supersedes in part ADR 0027
- **Design:** decomposed from #4475 into its sub-issues, which carry the shape lists, the
  per-consumer posture and the phases (the working design doc is removed at decomposition, per the
  pipeline's spec close-out)

## Context

The worktree-always write gate, the teardown gate, the pipeline shadow guard and post-tool-use all
read Bash commands through `plugin/bin/lib/hooks/git-command.js`. That module is a hand-written
model of bash: heredoc stripping, quoting and nesting spans, and a segment and cwd walk. It grew
from 1,093 lines before #4149 to 3,310 today.

Each change is checked against real bash 3.2 and 5, and each round still finds a new divergence
class:

- #4149 took six review rounds.
- #4303 took eight fix rounds, plus a regression found in review (a case-pattern `|` read as a
  pipe).
- #4281 had three escaped-spelling leaks.

Eleven gap records were open when this was decided: #4244, #4247, #4446–#4455 and #4460. They
cover substitution bodies, prefixes, unknown cwds, zsh syntax and variable-built targets.

ADR 0027 kept a fixed-shape recogniser as the fallback "if the scanner's size or review cost
becomes the problem". It has become the problem on both counts.

The module's original safety rule was "ambiguity resolves to allow". Two exceptions have already
moved away from it, and both deny in a worktree-always session when the gate cannot read the
command:

- the PowerShell `-Command` gate;
- #4303's lost-cwd deny.

## Decision

**The gate reads a fixed set of command shapes, and treats everything else as unreadable.**

- **Recognised:** top-level lists, quoting, heredocs under ADR 0027's reader rule, literal
  redirects, literal `cd`, brace groups and subshells, compound keywords used as list structure,
  stripped prefixes (`NAME=value`, `env`, `sudo`, `command`, …), the write shapes, `mkdir` and
  git.
- **Unreadable:**
  - substitution and process-substitution bodies;
  - `eval` and `sh -c`;
  - targets built from variables;
  - any cd the gate cannot resolve to one directory;
  - zsh-only syntax;
  - a scan that exhausts its budget.

An unreadable part **could write** when its raw text holds any of:

- a write-shape word or `mkdir`;
- `git` with a guarded git subcommand;
- a `>` that is neither an fd duplication nor a `/dev/null`-like sink;
- a variable in the program position.

Such a part is denied in a worktree-always session in two cases:

- always, from the main checkout;
- from a linked worktree, only when the command names the main checkout's path, or the part's cwd
  could have left the worktree (`cd -`, `..`, `pushd`, a cd to an unknown variable). The
deny message names what was unreadable and a rewrite that passes. Everywhere else, the part is
allowed.

A scanner exception or an indeterminate repo status still allows, so a hook bug never breaks a
session (`docs/hooks.md`). #4475's sub-issues hold the full shape lists, the per-consumer posture,
the phases and the re-triage of the open gap records. Once built,
`_shared/policy-schema-coverage.md` holds the rule itself. This record holds the reason for the
direction.

## Alternatives considered

- **Keep extending the hand-written model.** Rejected. Every round found a new divergence class.
  Bash's grammar plus its runtime behaviour is larger than any model the review loop can keep
  correct, and the open gap list was growing, not shrinking.
- **Parse with a real shell grammar.** Rejected, on three grounds:
  - Bash has no way to output its parse. The only option is vendoring a JS bash grammar, which ADR
    0019 permits but which would be a large owned artifact with its own correctness tail.
  - The Bash tool runs the user's own shell, which is often zsh (the macOS default, and this
    repo's dev box). A bash grammar misreads exactly the syntax #4455 reports.
  - The hardest gaps are not syntax at all: where `cd -` lands, what `$T` holds, what
    `env`/`sudo` run (#4448, #4450, #4455). A perfect parser still has to fall back on "can't
    tell" for them, which is this decision anyway.
- **Recognise shapes, but allow the unreadable.** Rejected. It turns the coverage gaps into
  silent allows. That is the failure ADR 0027 already ruled out for heredocs: a spurious deny
  costs one retry, while a missed write can corrupt the shared main checkout.
- **Deny every unreadable part, whether or not it could write.** Rejected. `echo $(date)` and
  `$(git rev-parse HEAD)` from the main checkout would deny. The could-write test keeps the deny set
  to parts that could plausibly reach a covered write.

## Consequences

- **Easy:**
  - A new gap report is triaged with one question: is it a recognised shape misread (fix it) or
    something unreadable (already handled)?
  - Most of the substitution, cwd-set and variable-substitution code can be deleted.
  - The real-bash differential check shrinks to the recognised set.
- **Hard:** more spurious denies from the main checkout. `cp a "$(pwd)/f"` and
  `cd "$DIR" && cp a b` (DIR not assigned in the command) now deny there, and the plugin's own
  skill fences have to be swept so none of them newly denies. Each deny names a rewrite: an absolute path,
  `git -C <abs>`, the Write tool, a scratchpad script, or a worktree. The house pattern for this
  repo already works that way.
- **Coverage is unchanged in kind.** The gate still covers only the write shapes, redirects,
  `mkdir` and git. `node -e`/`python -c` writes stay the documented opaque-program gap.
- **Contract change:** `gate-denial` gains `gate: 'unreadable'` with a `kind` sub-field. The old
  `gate: 'lost-cwd'` value has no reader, so it is renamed to `kind: 'cwd'` outright.
- **Revisit if:**
  - unreadable denies become a measurable share of a session's Bash calls (counted from
    `gate-denial` events);
  - agents re-issue a denied command more than twice in a session;
  - the plugin's shell changes so that a single real grammar would cover every user (that would
    reopen the parser option).
