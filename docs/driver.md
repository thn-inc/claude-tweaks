# The pipeline driver (`drive.js`)

`plugin/bin/drive.js` takes each named record, one at a time and in order, from admission to a draft PR with CI read. A program owns every step; a headless worker only writes the change. Nothing merges. This page is documentation, not a contract: no test reads it, so update it by hand when the code below changes. The code is the source of truth.

## Running it

```
node plugin/bin/drive.js #N [#M…]
node plugin/bin/drive.js --no-settle #N [#M…]
node plugin/bin/drive.js --help
```

- `#N` (or a bare `N`) is a positive record number; duplicates are dropped, order is kept.
- `--no-settle` turns the driver's own settle off, for a caller that settles stops itself. A stop then makes none of the settle calls; the final line carries the structured `stop` object and `settle: left-to-caller` when the stop's row has calls (`none` otherwise). Default is on.
- `--help` (or `-h`) prints the usage and exits 0 before any probe of `gh`, `git` or policy.

Exit codes:

| Code | Meaning |
|---|---|
| 0 | Every named record reached its final event, whatever its outcome. Outcomes are data. |
| 1 | The policy, or the run's repository or integration branch, cannot be resolved; no further record is attempted. |
| 2 | Malformed invocation (no record reference, a non-numeric one), `gh` or `git` absent, or an internal error. |

## Outcome words

| Outcome | Stop class that gives it |
|---|---|
| `pending-review` | `none`: green CI, a CI state other than green, or a failed summary entry. The draft PR stays for a human. |
| `express-escalated` | `pre-push`: any stop before the push, with no PR recorded and nothing pushed. |
| `blocked` | `claim` (any claim failure), `blocked` (any stop after the push, or a non-zero exit of `check` or `escalate`), and a stop class outside the known set (also flagged `unclassified`). |
| `refused` | `refused`: not eligible, not admitted, routing off, an unreadable record. Nothing is written. |

## Event lines

One JSON object per line on stdout and, once the run directory exists, in `{run-dir}/driver-events.jsonl`.

A step line: `ts`, `run` (the run id, `null` before the run directory exists), `record`, `step`, `status` (`ok`, `fail`, `stop`), `ms`, any extra fields the step adds (the worker step adds `usage`, `turns`, `denials` and, when the last turn crossed the spend ceiling, `spendOverrun`), and `detail` when there is one. `step` is one of: `policy`, `fetch`, `eligibility`, `admission`, `claim`, `run-dir`, `worktree`, `worker`, `commit`, `test`, `check`, `push`, `pr`, `record-pr`, `set-config`, `summary`, `ci`; a settle call uses one of the `settle-*` names below.

The final line (`step: "final"`) adds:

| Field | Meaning |
|---|---|
| `outcome` | The outcome word. When settle ran, the class it settled to (a failed escalate reads `blocked`). |
| `msTotal`, `msWithoutCi` | Elapsed time with and without the CI wait. |
| `pr`, `ci` | The PR number and the CI word; `ci` is `pending` when a PR exists and CI was never read. |
| `costUsd`, `turns`, `denialCount` | The worker's cost, turns and permission-denial count (`null` with no worker). |
| `stop` | The structured stop (below). |
| `settle` | `done` (the row had calls and they ran), `left-to-caller` (`--no-settle`, and the row has calls), `none` (the stop's row has no calls, with or without `--no-settle`), or `interrupted` (see below). `left-to-caller` always means there is something to settle. |
| `settleFailed` | Step names of settle calls that failed. |
| `settleRow` | The row of the settle table used (`refused`, `claim-contested`, `claim`, `pre-push`, `blocked`, `none`), or `null` when nothing stopped or an interrupt landed before settle started (an interrupt during settle keeps the row it was running). |
| `unclassified` | `true` when the stop class is outside the table; it was settled by the `blocked` row. |
| `settleNote` | A note from settle: the TTL note for a claim that may have been written, or the unreadable `run-state.json` note. |
| `spendOverrun` | `true` when a worker returned normally but its cost crossed the spend ceiling. Reported, never settled; the run continues. |
| `eventsFileError` | Present when appending to the jsonl failed. |

The `stop` object: `step`, `class` (`refused`, `claim`, `pre-push`, `blocked`, `none`), `pushed`, `created` (`{ worktree, branch }`, what this run created), `reason`, `detail`, `checkLogged` (`check`'s `logged` value: whether `check` wrote its own decision line, proceed or escalate; `null` when `check` did not run). A pre-push `reason` is always one of `failing-test`, `out-of-bounds`, `gate-denial` or `express-error`, so a `--no-settle` caller need not re-derive it. A claim stop's reason is `claim-exit-{code}`, `claim-exit-none` when `claim-targets.js` was killed or timed out, or `fail` when it exited 0 without claiming the record, when the run directory could not be minted, or for an interrupt after the claim.

Settle calls are step lines named `settle-escalate`, `settle-comment-pr`, `settle-comment-record`, `settle-label`, `settle-release`, `settle-remove-worktree`, `settle-delete-branch` and `settle-close`, emitted before the final line. A failed call has status `fail`, is never retried, and does not stop the calls after it (one exception, below).

## When a run stops

The source of truth is `SETTLE_ROWS` in `plugin/bin/lib/driver/settle.js`; this table is copied by hand.

| Stop | Settle calls, in order |
|---|---|
| `refused` | None. Nothing is written; the event names every reason. |
| `claim`, `claim-targets.js` exit 3 (held by another run or in flight) | None. The driver never held the claim, and a label would hide the other run's live claim. Outcome `blocked`; the event names the exit code. |
| `claim`, any other claim failure: a non-zero exit other than 3 (1, 2, 4, 5, 6, 7), an exit 0 that did not claim the record, a killed or timed-out run (`claim-exit-none`), or a failed run-directory mint | 1. one comment on the record naming the step and exit code; 2. `bot:blocked` added. No release call: no run directory exists, and `release-claim.js` needs `--run`. A claim that may have been written (exit 5, `claim-exit-none`, or a claim held when the mint failed) lapses by its TTL, and `settleNote` says so. A comment for a stop with no exit code (`claim-exit-none`, an exit 0 that did not claim, a failed mint) names none. |
| `pre-push` (`express-escalated`) | 1. `express-lane.js escalate` with the reason and a detail file, unless the stop is `check`'s own escalate verdict and `check` already wrote the line (`step: check` and `checkLogged: true`); 2. one comment on the record, ending with `<!-- express-driver: escalated -->`; 3. `release-claim.js`; 4. `git worktree remove --force --force` of the record's worktree, only when `stop.created.worktree` is true; 5. `git branch -D` of its local branch, only when `stop.created.branch` is true; 6. `hooks.js close-run --run {run-dir}`, so the run is no longer left active naming a removed worktree. The run directory stays: it holds the escalation line. If call 1 fails, calls 4, 5 and 6 do not run and the remaining calls are the `blocked` row's, so no work is discarded without an escalation on record. |
| `blocked`: a stop after the push, or a non-zero exit of `check` or `escalate` | 1. one comment on the PR, only when a PR exists; 2. one comment on the record, both naming the failed step; 3. `bot:blocked` added; 4. `release-claim.js` (no `--remove-grants`). The draft PR, branch and worktree stay. |
| `none` (`pending-review`) | None. The PR stays in draft for a human; the claim is left alone and lapses by its TTL. |

Notes:

- As a safety net, a `pre-push` stop is settled by the `blocked` row instead when `pushed` is true or `run-state.json` records a PR. No pre-push step stops after the push today (a failed `gh pr create` or `record-pr` is already class `blocked`), so this guards a misclassified or future step. An unreadable `run-state.json` on a pre-push stop is settled by the `blocked` row too, keeping the work, and sets `settleNote`.
- A stop class outside the table is settled by the `blocked` row and flagged `unclassified`.
- `git worktree remove` runs with `--force --force` because the driver creates the worktree locked. A worktree that is no longer registered is "already gone", not a failure; so is a branch that no longer exists.
- A `release-claim.js` exit 3 (already released) or 4 (held by another run) is not a failure.
- Comments and the escalate detail file are built from fixed templates. The worker, test and `check` detail is reduced first: allow-listed characters only, at most 200 characters, `@` neutralized, paths replaced by `<path>`, token-shaped strings by `<redacted>`, and `GH-N` and `www.` shapes split (`GH N`, `www `) so GitHub neither backlinks nor autolinks them. A bare host such as `evil.com` is left as is; GitHub links only `www.` and scheme forms.
- No settle call uses a model.

## After an interrupt

A run stopped by SIGINT or SIGTERM settles nothing, so the process exits promptly and never removes a worktree a worker may still be writing to. If the signal lands while settle is running, settle stops before its next call. The final line says `settle: interrupted`, and `settleFailed` names any settle calls that had already failed. The `outcome` word names the stop's class, not what landed: an interrupted pre-push stop wrote no escalation line. A record interrupted before its run directory existed has nothing to pass to `--run`; its claim lapses by its TTL.

Manual cleanup for an interrupted record:

- Release the claim: `node plugin/bin/release-claim.js {n} --run {run-dir} --reason interrupted`. The claim also lapses by its TTL.
- Remove the worktree and branch the run created: `git worktree remove --force --force {wt}`, then `git branch -D {branch}`. Or leave them for the standard path.
- If you removed the worktree, close the run: `node plugin/bin/hooks.js close-run --run {run-dir}`. Otherwise the run stays active, naming a worktree that is gone. This is the same call settle makes last on a pre-push stop.

## Taking an escalated record again

The pre-push escalation comment ends with the marker `<!-- express-driver: escalated -->`. Admission refuses a record that carries it in a comment from a trusted author (`already escalated by the driver`), so an escalated record goes to the standard path and is not driven again. To let the driver take it again, delete the comment carrying the marker. If the record's comments cannot be read, admission refuses (`record comments unreadable`). No label is added, and neither the prose express lane nor the standard path reads the marker.

## Worker rights

Per role (`plugin/bin/lib/driver/roles.js`); the launcher is `worker.js`.

- Tools: the implementer gets `Read`, `Write`, `Edit` and, on `darwin` only, `Bash`; the reviewer and explorer get `Read`, `Grep` and `Glob`.
- Every worker launches with `-p --safe-mode --restricted`, a short `--tools` list, `--disable-slash-commands`, `--strict-mcp-config` and `--permission-prompts none`. `--restricted` ignores user, project and local settings files and confines the file tools to the working directory. No role launches with a bypass flag, and rights are never widened after a denial; denials are data in the event line.
- The implementer's generated settings use `defaultMode: dontAsk` and an exact allow list: `Read`, `Edit` and `Write`, plus, on `darwin` only (the sandbox-probed platform), the test command and read-only `git status`, `git diff`, `git log`, `git show` and `git ls-files`. The deny list names `gh`, `git push`, `git commit`, `git add`, `curl` and `wget`. The test command comes from project configuration, never from a record or a worker.
- Sandbox: on a probed platform (`darwin` today) the implementer runs inside the Bash sandbox with the network denied and writes confined to the working directory and the CLI's own scratch root. Reads are not confined. On any other platform the implementer has no Bash at all.
- Ceilings: the launcher enforces the wall-clock ceiling by killing the worker (reason `wall-clock-ceiling`) and passes the spend ceiling as `--max-budget-usd` (reason `spend-ceiling`). Either is settled as a pre-push `express-error`. A spend overrun reported after a normal return is only named in the final line (`spendOverrun`).
- The worker's own text is untrusted input; the driver takes the changed files from git, not from the worker.
