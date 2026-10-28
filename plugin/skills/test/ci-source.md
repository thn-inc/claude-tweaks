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

## Fallback reasons

Every other outcome runs the suite locally, exactly as selected (its impact subset included), and `report.json`'s `ci` entry for that suite names why in `fallback`:

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
| `ci-log-unavailable` | A red job's log could not be downloaded, so nothing names its failures. |
| `gh-unavailable` / `gh-error: …` | `gh` is not installed, or a read failed. |

stdout prints one line per CI-declared suite before the table: `CI: {suite} — taken from {workflow} / {job} run {id} on HEAD ({conclusion}, {url})`, or `CI: {suite} — ran locally ({reason})`.

## What the CI pass does not cover

The CI job runs on ubuntu with Node 20. A CI-sourced pass therefore does not cover this machine's platform: macOS, and Node 22. Windows is not covered either; `windows-regression.yml` still checks it after merge. A change whose risk is platform-specific still runs locally: the caller runs verify.js without `--scope`, which never consults `ci`.
