# 0023. The Windows regression guard runs post-merge only

- **Status:** accepted
- **Date:** 2026-10-17
- **Context:** #3316

## Context

The test suite has never run on Windows in CI, and an existing set of test files already fails on `windows-latest` (CRLF-sensitive extraction, drive-letter path expectations — #3318's backlog). #3316 adds a guard so that set stops growing.

The obvious place for that guard is a PR check, and that is where the cost lands. Under the `pr-first` integration model, the merge gate waits on every check in a PR's rollup. A Windows job is slow: the suite alone measured ~8.5 minutes on `windows-latest` (run 39036270004), and the guard then re-runs each failing file against a baseline commit to separate new failures from the existing ones. Any check on that path delays every merge in the repo, including the large share of merges that touch only skill prose.

## Decision

Windows coverage runs only on pushes to `main` (`.github/workflows/windows-regression.yml`), never as a PR check. Each push is compared against the previous `main` tip (`github.event.before`, falling back to `HEAD^1`) via `verify.js --baseline`. Failures that also fail on the base are pre-existing and never filed. A new failure files one `type:bug` issue, or comments on the open one. `tests/windows-regression-file-issue.test.js` pins the absence of a `pull_request` trigger.

## Alternatives considered

- **A Windows PR check.** It would catch a regression before merge, but every merge would wait on it. Rejected for merge latency, which was the user's explicit call.
- **A path-filtered PR check** (run on Windows only when certain paths change). Rejected because path-separator and line-ending bugs can live in any file, test or source. No path filter tells you which changes are Windows-sensitive, so a filtered check would skip exactly the change that breaks.
- **A nightly scheduled run.** No merge latency, but a night's worth of merges shares one comparison base, so a regression cannot be attributed to one commit. Per-push runs give each regression its own base and its own merged PR.

## Consequences

- A Windows regression can land on `main` and is found after merge. Detection is an auto-filed `type:bug` issue naming the commit, its base and the merged PR, not a red check that blocks the merge. Fixing it is follow-up work, not a merge blocker.
- The two-job split follows from this choice. The suite runs with a read-only token, and only the Ubuntu filer job, which never executes the suite, gets `issues: write`. A PR-check design would need neither the filer nor the issue path.
- The concurrency group is keyed on the commit sha, so every push to `main` gets its own run and its own base.
- Revisit if Windows suite time drops enough that a PR check would not noticeably delay merges, or if post-merge Windows regressions start reaching users before the filed issue is fixed.
