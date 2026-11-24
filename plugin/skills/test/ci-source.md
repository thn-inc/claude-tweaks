CI-sourced full-suite verification — the `ci` block of `.claude-tweaks/verify-scope.json`, when `verify.js --scope` takes a suite's verdict from the PR's CI job instead of running it here, and what it reports (#4347). Read when the declaration declares `ci`, or a report carries `ci`.

# CI-sourced full-suite verification

A declared suite's full run can come from the CI job that already runs it on every PR push. On a busy machine a local full run of this repo's suite took 55 minutes and more, while the same suite took 3.5 minutes in CI, and the merge gate (`_shared/pr-first-merge.md`'s merge-verification gate) requires that CI check green anyway.

## Declaration

```json
"ci": { "tests": { "workflow": "test.yml", "job": "test" } }
```

| Field | Meaning |
|-------|---------|
| key | A declared suite name. A tool-scoped `checks.tests` (`{base}`) cannot take one. |
| `workflow` | The workflow file name under `.github/workflows/` (required). |
| `job` | The job's name as GitHub shows it (the job key when the job has no `name:`) (required). |
| `waitSeconds` | Positive integer, default 900: how long to wait for that job to finish on HEAD. |
| `pollSeconds` | Positive integer, default 20: the interval between reads while waiting. |

With no `ci` block nothing changes: no `gh` call, and `report.json`, the pass stamp, `--stamp-status` and stdout are what they were. A plugin build older than the key ignores it.

## When CI answers

Only a `--scope` run (not `--stamp-suite`, and not a `none` run) consults it, for every CI-declared suite the run selected. The CI job ran the whole suite, so it also stands in for an impact subset (`impact-selection.md`), and the stamp then covers the full suite. `report.json`'s `scope.impact` still records what selection chose. The runner then requires:

1. A clean tree at the start: CI never saw uncommitted edits.
2. HEAD is the head commit of an open PR on GitHub (`repos/{owner}/{repo}/commits/{sha}/pulls`). So the caller pushes before running verify.js.
3. The declared job of the newest `workflow` run for exactly that sha has completed. While it has not, the runner polls in the foreground, up to `waitSeconds`.

The job's log is downloaded into the suite's own `{log-dir}/{suite}.log`. Every line's timestamp prefix is stripped, and the runner's checkout root (`/home/runner/work/{repo}/{repo}`) is rewritten to the local one, so the failing region, counts, flaky retry and `--baseline` adjudication read it exactly as they read a local run:

- **Green job:** the suite passes without running here. The pass stamp carries `source: "ci"` and `ci: {suite: {runId, runUrl}}`. `--stamp-status` reads it like a local stamp (`verifiedHead`, `match`) and adds `source`/`ci`. `deriveTestVerdict({ stampPath })` accepts it too.
- **Red job:** the suite fails with the CI log as its evidence. Under `--baseline`, adjudication re-runs only the failing files locally, at the fork point and in isolation at HEAD, and classifies them as it would a local failure. Without it, the failing region names the failing tests.

`types`, `lint` and every suite without a `ci` source run locally as usual.

## Local runs on request

A project that wants CI's verdict or none, never a quiet local full run, adds one top-level key to the declaration. It is valid only together with a `ci` block; any other value, or the key with no `ci` block, fails validation with an error starting `localRuns:`.

```json
"localRuns": "on-request"
```

Under it, a `--scope` run takes each selected CI-declared suite from CI. The first suite CI cannot answer exits 3 before any check, retry or slot hold: no `report.json` is written (a stale one is removed) and no pass stamp. stderr names the suite and the reason, then the two ways on: push and re-run, or pass `--local`. Each later selected CI-declared suite is recorded `not-consulted`. Exit 3 is never a test failure; it means no verdict yet. A red job whose log cannot be downloaded fails the suite and names the run URL, so nothing falls back to a local run. The log download passes `--allow-escape-sequences` so the job log arrives intact, retried once without it for a `gh` that rejects the flag. A suite CI answered that then fails still gets its local flaky retry, after the no-verdict decision.

`--local` never consults CI and runs each selected suite here, the impact subset or, when selection falls back, the full command; the run records `local-requested`. It means the same with or without the key. With neither `--scope` nor `--local`, a run naming a CI-declared suite exits 2, because it would run that suite here unasked. A `--stamp-suite` chunk never consults CI either (`stamp-composition.md`): under the key a chunk naming a CI-declared suite is refused (exit 2) without `--local` and runs here with it. `types`, `lint` and every suite with no `ci` source need no flag.

## Fallback reasons

Without `localRuns`, every other outcome runs the suite locally, exactly as selected (its impact subset included), and `report.json`'s `ci` entry for that suite names why in `fallback`; under it, the run exits 3 (`## Local runs on request`):

| Reason | Cause |
|--------|-------|
| `dirty-tree` / `tree-state-unreadable` | The tree was dirty at the start, or its state could not be read. |
| `head-not-pushed` | GitHub does not know HEAD's commit. |
| `no-open-pr-at-head` | No open PR has HEAD as its head. |
| `pr-conflicted` | The PR has conflicts (`mergeable_state: dirty`), so it gets no `pull_request` runs. |
| `no-ci-run-within-wait` | No run of `workflow` for HEAD appeared within `waitSeconds`. Typical causes: the workflow did not trigger, or Actions is down. |
| `ci-run-incomplete-within-wait` | The run did not finish within `waitSeconds`. |
| `ci-job-not-found` | The completed run has no job named `job`. |
| `ci-run-cancelled` | The job was cancelled, for example by a newer push. |
| `ci-job-{conclusion}` | The job ended `skipped`, `timed_out`, or anything else that is neither success nor failure. |
| `ci-log-unavailable` | A red job's log could not be downloaded, so nothing names its failures (without `localRuns`). |
| `gh-unavailable` / `gh-error: …` | `gh` is not installed, or a read failed. |
| `local-requested` | `--local` was passed, so CI was not consulted. |
| `not-consulted` | Under `localRuns`, an earlier suite already left the run with no verdict, so CI was not asked about this one. |

stdout prints one line per CI-declared suite before the table: `CI: {suite} — taken from {workflow} / {job} run {id} on HEAD ({conclusion}, {url})`, or `CI: {suite} — ran locally ({reason})`. Under `localRuns`, a red job with no downloadable log prints `CI: {suite} — taken from {workflow} / {job} run {id} on HEAD ({conclusion}, {url}; its log could not be downloaded — pass --local to reproduce the failure here)`.

## CI that skips draft PRs

The runner reads draft-PR CI, so a project picks one shape (`_shared/ci-skips-drafts.md`): CI that runs on draft PRs plus a `ci` declaration, where full-suite verdicts come from that CI and every phase push costs Actions minutes, or CI that skips drafts and no `ci` declaration, where verification runs locally and CI runs once at ready, which the merge gate waits for. Declaring both is a misconfiguration: with a job-level draft skip every verify falls back on `ci-job-skipped` after one poll, and with a workflow-level gate every verify stalls for `waitSeconds` before `no-ci-run-within-wait`.

## What the CI pass does not cover

The CI job runs on ubuntu with Node 20. A CI-sourced pass therefore does not cover this machine's platform: macOS, and Node 22. Windows is not covered either; `windows-regression.yml` still checks it after merge. A change whose risk is platform-specific still runs locally: the caller passes `--local`, and CI is not consulted (under `localRuns`, a run without `--scope` that names a CI-declared suite needs `--local` too).
