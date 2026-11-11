# 0031. Baseline reruns run serially, and an adjudication reuses one scratch path per suite slot

- **Status:** accepted
- **Date:** 2026-11-11
- **Context:** #5150 (serial reruns and the per-slot scratch path, decided at its plan review); builds on #3043 (`--baseline` adjudication), #3064 (scratch cleanup on a catchable exit) and #5119 (the machine-wide suite slot)

## Context

`--baseline` adjudication re-runs every failing test file at the base commit and once in isolation at
HEAD, up to four at a time. On a project with many parallel pipeline sessions on one machine and a
shared test resource, whose identity derives from the checkout path, that fan-out did two kinds of
damage. Four reruns sharing one checkout also shared one resource, so two simultaneous resets of it
collided, one blocked behind the other, and the blocked run timed out; the timeout is itself evidence
adjudication reads, so it fed more adjudication. And every adjudication minted a new resource from
its fresh `ct-verify-base-*` path and never reclaimed it: on that machine, 175 of 191 such resources
matched no live worktree.

## Decision

1. **Reruns run serially unless `concurrency.reruns` declares more.** Whether two runs of a test
   command can share a checkout is a property of the command, and the declaration
   (`.claude-tweaks/verify-scope.json`) is where the command lives, so the number lives there too
   (a positive integer; `concurrency.timeoutPatterns`, an array of non-empty literal substrings,
   names a project's own timeout wording). Timeout evidence forces serial whatever is declared: a
   timed-out failing run, a `timeoutPatterns` match in a log, or a base rerun that times out (which
   serializes the later phases, reason `phase-timeout: baseline`) all pin the phase to one call at
   a time, and the result names the reason. A forced-serial run says so on stdout.

2. **A stable per-slot scratch path, not a project-declared teardown command.** A run holding a
   suite slot checks the base out at one path that slot owns, and clears whatever a killed earlier
   run left there. #3064's removal runs only on catchable exits, so a teardown command would be
   skipped by exactly the uncatchable kills (`SIGKILL`, `TerminateProcess`) that leak, and it would
   run project code inside a signal handler that races `process.exit`. The stable path instead bounds
   leftovers to slots × repositories (× lock dirs) even after a `SIGKILL`, and a project can reclaim
   them by name. On a catchable signal the order is kill the running checks, remove the per-slot
   scratch, then release the slot: `holdSlot`'s handler releases in-handler only when it is the last
   signal listener, otherwise the process `exit` hook releases after adjudication's handler has
   removed the scratch, so the next holder never meets a half-removed checkout. A run with no slot
   (a nested run, or one that took none) keeps a fresh `ct-verify-base-*` path.

3. **The path key folds in the slot lock dir, and a base-side run counts only at the base sha**
   (decided by the user at plan review). Two holders of slot 0 under different lock dirs never
   share a path. A base-side run counts as evidence only when the scratch HEAD is the base sha both
   before and after it runs (`realGit().headOf`); a run that fails the check is no evidence, its
   files fall to `attributable`, and the result records `scratch.moved`. When a guard refuses the
   per-slot path (`no-slot-lock-dir`, `no-common-dir`, `root-unusable: {message}`,
   `slot-dir-unusable: {message}`, `parent-outside-root`, `leftover-not-a-directory`), the run warns
   once on stderr, uses a fresh path, and records `scratch.fallback` with the reason.

## Alternatives considered

- **A policy key for the rerun count.** Rejected: it drifts from the command it describes. The
  declaration beside `suiteSlots` is where a command's concurrency already lives.
- **Keep 4 and add an opt-down.** Rejected: the default would stay unsafe for any command that
  shares a resource, and the project that needs the opt-down is the one that least knows to set it.
- **A path per base sha.** Rejected: unbounded across shas, which is the leak this removes.
- **A project-declared teardown command.** Rejected (Decision 2): skipped by the kills that leak,
  and project code inside a signal handler.
- **Fail adjudication outright when a guard refuses the slot path.** Rejected by the user at plan
  review in favour of a visible `scratch.fallback`: the run still adjudicates, and the cost shows.

## Consequences

- This repo's own adjudications go serial. Its declaration does not adopt `reruns`, which is pinned
  by the test that parses the committed `verify-scope.json` with the previous release's reader, so
  an installed older build keeps reading it.
- The reuse contract: a slot-holding run owns its slot's path; a run that holds no slot never uses
  one.
- Residual risk. The slot module's once-only race (two reclaimers of one dead lock) can still put
  two adjudications on one path once, and the second's leftover cleanup then removes the first's
  live checkout and re-adds it at its own base sha. The first adjudication's base-side runs fail the
  HEAD check (or find no checkout) when the second's base sha differs, and are no evidence, so a
  collision at another base commit costs that run its evidence (`attributable`, `scratch.moved`),
  never a false pass. The HEAD check cannot detect a same-sha replacement: a stale break of a live
  holder's lock in the same lock dir that re-adds the checkout at the same base sha is not caught,
  and is accepted as part of the once-only race.
- A guard failure leaks one fresh path per run again, visible as `scratch.fallback`.
- The slot path is about 13 characters longer than the `mkdtemp` one, a cost on Windows path length.
- Version floor: the release carrying #5150. A project on an older build still gets four concurrent
  reruns and a fresh path per run.
- Revisit if a project needs per-checkout resources reset between base commits.
