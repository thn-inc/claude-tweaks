# CI that skips draft PRs

Under `pr-first`, every phase exit pushes to the run's draft PR (`_shared/git-discipline.md`'s Phase exit section). A project whose `pull_request` CI runs on drafts pays Actions minutes for each of those pushes. This file is the supported way to skip drafts and still have the merge gate (`_shared/pr-first-merge.md` Step 2.5) verify the head it merges.

## Workflow shape

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

jobs:
  test:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
```

The job-level condition skips every draft-time run; `ready_for_review` starts the run the gate waits for. How the gate reads this shape:

- **The ready event.** After `gh pr ready`, the gate reads the PR timeline's last `ReadyForReviewEvent`.
- **The ready run.** Each PR-triggered workflow that declares `ready_for_review` must then have a `pull_request`/`pull_request_target` run on the head created at or after that event. Until that run exists the verdict is pending.
- **Matching by path.** Runs are matched to workflows by file path, so a missing or duplicated `name:` does not matter.
- **Where the condition lives.** Keep it on the job in the PR-triggered workflow itself (`if: ${{ !github.event.pull_request.draft }}` reads the same), not inside a reusable workflow (`uses:`) the gate never opens.
- **Unparsed files.** A workflow file the gate cannot parse counts as requiring a ready run, never as no requirement. With no ready run it parks with `checks-pending-timeout`, naming it `{file} unparsed`; the fix is a plain `on:` block: no `*alias`, `<<:` merge key or `${{ }}` expression, each flow list or mapping closed on its own line.

Rules for the shape:

- **Declare `ready_for_review` only alongside a draft skip.** A workflow that declares it without skipping drafts pays one extra wait per merge, for a second run on the same sha.
- **Keep `synchronize`.** `ready_for_review` belongs in `types` alongside `synchronize`, which the default types include. A workflow whose `types` lack `synchronize` never runs on a push made after undraft, so the gate keeps that workflow awaiting and parks with `checks-pending-timeout` until the types include it.
- **A draft skip needs `ready_for_review`.** A draft skip whose `types` lack `ready_for_review`, default types included, never runs after undraft, so the gate parks it as `draft-skip-without-ready-trigger`. It parks only while that workflow has no post-ready run: a later push that really runs CI (a `synchronize` run on the undrafted PR) clears it. The fix is adding `ready_for_review` to `types`.

The gate's 15-minute bounded watch is unchanged: a ready run that outlasts it parks with `checks-pending-timeout`.

## Pending-status pattern

Optionally, a small job that runs on drafts sets a commit status to `pending`, and the ready-time run flips it to `success` as its first step, so the rollup reads pending in the gap before the ready run registers. This gate does not need it, since it waits on the ready event itself. It is defence in depth for readers other than this gate, such as `_shared/github-pr-scan.md`'s `NON_BLOCKING` set, which reads draft-time `SKIPPED` results as green, and for adopters on older plugin versions.

## Path filters

A workflow-level `paths:` filter leaves a docs-only PR with no checks reported when no other workflow reports on that head. The bounded watch reads that as pending and parks after 15 minutes. When another workflow does report (for example the generated tracking workflow's `label-fix-branch`), the rollup is non-empty and the filtered-out CI simply never appears, unless that workflow declares `ready_for_review`: it then never creates the ready run the gate waits for, and the gate parks the PR with `checks-pending-timeout`. Use job-level conditions behind a small always-run job instead, so the CI workflow always reports.

## Coexistence with the `ci` verification source

A project picks one of two shapes (`test/ci-source.md`):

- **CI on drafts plus a `ci` declaration:** full-suite verdicts come from draft-PR CI, there are no local full-suite runs, and every phase push costs Actions minutes.
- **CI skips drafts and no `ci` declaration:** verification runs locally during the pipeline, and CI runs once at ready, which the gate waits for.

Declaring both is a misconfiguration. With a job-level skip it degrades harmlessly: every verify falls back on `ci-job-skipped` after one poll. With a workflow-level gate it costs a `waitSeconds` stall per verify. Detecting the conflict is #5162's, at init's CI-workflow review.

## Why projects skip drafts

The Actions-minute cost of per-phase pushes. One private project measured 176 of 312 pull-request CI runs in 30 days on commits a later push superseded; those runs billed 3,120 minutes, 35% of its Actions usage.
