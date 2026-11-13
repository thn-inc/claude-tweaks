---
files:
  - plugin/bin/drive.js
  - plugin/bin/lib/driver/run.js
  - plugin/bin/lib/driver/steps.js
  - plugin/bin/lib/driver/events.js
  - plugin/bin/lib/driver/settle.js
  - plugin/bin/lib/driver/review.js
---

# Drive a Named Record to a Draft PR

**Persona:** a maintainer who has an eligible, express-sized record. They want it built and opened as a draft PR with CI read, with no model session in charge of the steps, and they will judge the cost and wall clock from the report afterwards.
**Goal:** name one or more records on the command line and get back, for each, a draft PR (or a clear reason there is none) and a one-line outcome. Nothing merges, and no step runs twice.
**Entry point:** `node plugin/bin/drive.js #N [#M…]` in the main checkout of a repository whose `.claude-tweaks/policy.yml` enables `express-driver`.
**Success state:** each record's final event line reads `pending-review` with a PR number and a `ci` word, and `{run-dir}/driver-events.jsonl` holds the same lines that stdout showed. The draft PR waits for a human; the driver has merged and marked ready nothing.

## Steps

### 1. Name the records — a terminal
- **URL:** `node plugin/bin/drive.js #5300 #5301`, or `--help`
- **Action:** pass the record numbers in the order to drive them. `--help` prints the usage and the exit codes without touching `gh`, git or the policy.
- **Should feel:** like starting a batch job: one command, then lines scroll by, one per step.
- **Should understand:**
  - Records run one at a time, in the order named. A record that stops never prevents the next one from running.
  - Exit 0 means every record reached its final line, whatever its outcome; the outcome is in the data.
  - Exit 1 means the policy, repository or integration branch could not be resolved, so no record went further. The repository is checked first: an origin whose host the origin-host gate refuses exits 1 before any `gh` call, the policy read included.
  - Exit 2 is a malformed command (no reference, or a non-numeric one), an absent `gh` or `git`, or an internal error.
- **Red flags:**
  - A non-zero exit for a record that was merely refused or escalated.
  - Any record started before the previous one's final line.

### 2. Get refused cheaply — admission
- **URL:** the `policy`, `fetch`, `eligibility` and `admission` event lines, then a final line with outcome `refused`
- **Action:** read the refusal's `detail`. It names every reason: the policy is `off`, the record is ineligible or not admitted, or the fetch failed.
- **Should feel:** free. A refusal costs one record fetch and writes nothing: no claim, no run directory, no worktree.
- **Should understand:** these events carry `run: null` and reach stdout only, because no run directory exists yet. The record is fetched once, and that same JSON feeds every later gate.
- **Red flags:** a run directory, claim or worktree left behind for a refused record; a second `gh issue view` for the same record.

### 3. Watch the build — claim through push
- **URL:** the event lines `claim`, `run-dir`, `worktree`, `worker`, `commit`, `test`, `check`, `review` (when policy runs it) and `push` on stdout, and `{run-dir}/driver-events.jsonl`
- **Action:** watch the lines scroll by.
  - The driver claims the record, mints the run directory, and adds a locked worktree on `drive-record-{n}`.
  - A headless implementer writes the change. The driver commits it by explicit path, with message `{title} — refs #{n}`, and runs the scoped tests.
  - `express-lane.js check` gives its verdict. When `express-driver-review` applies, one read-only reviewer follows, and a finding counts only when the driver's own `node --test` run of its evidence file fails (one fix round at most; see `docs/driver.md`). The driver pushes only when HEAD equals the `head` that `check` returned.
- **Should feel:** watched-over. Every gate is a program decision with a named step, and the worker's text never appears raw in a command, a commit subject or an event line.
- **Should understand:**
  - The worker event carries `usage`, `turns` and `denials`, plus `spendOverrun` when the spend ceiling was crossed. A denial is information, never a reason to relaunch.
  - A stop here ends the record `express-escalated`. Such stops include a worker `fail`, `timeout` or `cannot-complete`, no changed files, red tests, a refused scope file (one that is not a regular file, or whose bytes differ from `origin/{integration branch}`'s copy, line endings aside), an `escalate` verdict, a HEAD mismatch, a push that failed without reaching origin, or leftover state from an earlier run (a worktree, branch, remote branch or run directory named in the detail).
  - The scoped tests run with the worker's allow-listed environment, not the driver's, and an empty `gh` config directory, so the driver's credentials do not reach worker-authored test code. A project test command that needs a variable outside that list (`JAVA_HOME`, `NODE_OPTIONS`, `CI`, a proxy variable) fails red at this step and the record escalates. This is best-effort containment, not a sandbox.
  - The `review` step runs only when `express-driver-review` says so. Under its default, `beyond-express`, it never runs today, because eligibility already refuses every record it would review; set it to `on` to see it. When it does not run, it writes no line at all, so the event stream reads exactly as it did before the step existed. When it runs, its one line carries `returned`, `reproduced` and `discarded` counts, the reviewer's `usage`, `denials`, `costUsd` and `turns`. The final line's cost covers the two implementer launches only.
  - A reviewer finding is kept only when its evidence test file fails a real `node --test` run. Every other outcome discards it: a passing run, a load failure, no test case, a timeout, output the rule cannot place, or a path the path rules refuse, such as one holding a glob character or naming an existing file. Confirmed findings get one fix round: a second implementer launch, the evidence rewritten from the reviewer's bytes, a commit, the scoped tests, a direct run of each kept test, then a second `check`. The push compares HEAD with that second `check`'s `head`. Any failure in the round stops the record with the finding named, `express-escalated` except a failed `check` call, which ends it `blocked` as above. No third implementer ever starts.
  - A failed claim, or a run directory that cannot be minted, ends the record `blocked`. So does a failed `express-lane.js check` call (a non-zero exit, or no check envelope), even though nothing is pushed yet: no escalation line landed, so the full pipeline would not know the record left the lane.
  - The commit subject keeps the worker title's leading verb: `Fix the loop` stays `Fix the loop`. A closing keyword (`close`, `fix`, `resolve` and their forms, with an optional colon) is dropped only when the word after it carries an issue reference marker (`#N`, `owner/repo#N`, or an `/issues/N` or `/pull/N` path). Every `#N`, `owner/repo#N`, `GH-N` and `http(s)` issue or PR URL is dropped either way, so `Add the loop. Resolves #9.` becomes `Add the loop`. A `www.` issue or PR URL, a bare `github.com/` one, and an `owner/repo/issues/N` or `/pull/N` path that GitHub links go too. Worker text in an event line, and every settle step's detail, passes the same filter, so the summary line's changed-file list is filtered like a commit subject: a path with an `owner/repo/issues/N`-shaped segment (`lib/api/pull/3.js`) is shortened (`.js`).
- **Red flags:**
  - A commit message carrying `Fixes #N`, or a push after a HEAD mismatch.
  - A commit subject that lost its leading `Fix` or `Resolve` although no issue reference followed it.
  - A commit subject, PR body or event line that still carries a `www.` issue URL or an `owner/repo/issues/N` path, which would backlink the issue.
  - A worker transcript with a `gh`, `git commit` or `git push` call.
  - A leftover branch silently reused.
  - A `review` line under the default policy, or a pushed record whose reviewer finding never had a red evidence run.
  - A third implementer launch, or an evidence file left in the worktree after its finding was discarded.

### 4. Get the draft PR — after the push
- **URL:** the `pr`, `record-pr`, `set-config` and `summary` event lines; the draft PR on GitHub
- **Action:** open the PR the final line names. It is a draft, its body was composed by `compose-pr-body.js --express`, and it targets the integration branch.
- **Should feel:** finished, but not shipped. The work is reviewable, and the merge decision is still the human's.
- **Should understand:**
  - Once the branch is pushed, a failure of `gh pr create` (after its one retry, which first looks for an open PR on the branch), `record-pr` or `set-config` ends the record `blocked`, because a pushed branch cannot escalate. So does a `git push` that reported a failure while `origin/drive-record-{n}` already holds the checked HEAD.
  - A failed summary entry still ends the record `pending-review`.
- **Red flags:** two PRs for one record after a transient `gh` failure; a PR that is not a draft; a ready-for-review flip or a merge call anywhere.

### 5. Read the outcome — the CI wait and the final line
- **URL:** the `ci` event line and the final line `{ outcome, msTotal, msWithoutCi, pr, ci, stop, … }`
- **Action:** read `outcome` and `ci`. `pending-review` covers green CI and every other CI state; `ci` says which one (`green`, `red`, `pending`, `timeout` and so on).
- **Should feel:** measurable. `msWithoutCi` is the wall clock the driver itself spent, with the CI wait taken out, so the cost comparison does not depend on how busy CI was.
- **Should understand:**
  - `ci` is `null` only when no PR exists. Whenever a PR exists, `ci` is the last final word `pr-checks` reported, or `pending` if CI was never read as final.
  - The CI wait lasts at least a 2-minute settle window, measured from the push: no read ends it sooner. This stops a fast workflow that has already finished, or been skipped, from passing for the tests (#5277). Every record's CI wait therefore takes about 2 minutes longer, all of it left out of `msWithoutCi`.
  - Once the window has passed, the driver checks whether the pushed sha has a GitHub Actions run, using the run count each `pr-checks` read already carries, and checks again after each poll until it sees one. The first read other than `pending`/`stale` after the window ends the wait. It keeps its word when the sha has a run, and reads `no-ci` when it has none, even if the rollup says `green`. A `pending`/`stale` read on a sha with no run also ends as `no-ci`.
  - A run count that cannot be read, or that belongs to a different head than the pushed sha, never makes the word `no-ci`: the read keeps its word.
  - A `red`/`inherited-red` result keeps its word whatever produced it, and so does a failed read (`read-failed`, `gh-absent`, `no-pr`), which never saw the checks outside Actions.
  - A `pending` read that names checks still running outside Actions keeps polling to the bound (`timeout`), and so does a `pending`/`stale` read on a sha that has a run.
  - `stop` carries the structured reason (`step`, `class`, `pushed`, `created`, `reason`, `checkLogged`); for a stopped record the driver then settles it itself, and the final line's `settle` and `settleRow` say how (journey `find-a-stopped-driver-run-already-settled-5219`).
- **Red flags:**
  - `ci: null` beside a PR number, or `msWithoutCi` that still includes the CI wait.
  - A `green` recorded seconds after the PR was created.
  - A failing non-Actions check reported as `no-ci`.

### 6. Interrupt it safely — Ctrl-C in the terminal
- **URL:** a `fail` event at the running step (or `interrupted by SIGINT before {step}` at a boundary), then a final line, then exit by the signal
- **Action:** press Ctrl-C. To stop a background run, signal its process group, not just the drive.js process.
- **Should feel:** prompt and honest. The driver ends its worker, writes a final line, and leaves by the signal.
- **Should understand:** the final line's class depends on what the record already holds:
  - `none` (`pending-review`) once its PR config is written, so a Ctrl-C during the CI wait leaves a complete draft PR, not a failure;
  - `blocked` once pushed;
  - `pre-push` once the run directory exists;
  - `claim` once claimed;
  - otherwise `refused`.

  A SIGTERM sent to drive.js alone waits for any running synchronous child: up to 30 minutes for the test run, 2 minutes for a CLI. An interrupted record is never settled: its final line reads `settle: interrupted`, and `docs/driver.md`'s "After an interrupt" lists the manual cleanup.
  An interrupt inside the settle window reports `ci: pending`, never the unsettled read that came just before it.
- **Red flags:** a worker process still running after the driver exited; an interrupt during the CI wait reported `blocked`, or reported with a `green` read taken before the window passed.

## Origin
- Created during the build of #5218 (run `2026-11-12T104316-spec-5218`), the pipeline driver's second unit. It drives the express lane's steps 1–8 and 10 as code over the #5217 worker launcher; step 9 (merge) is deliberately absent.
- Settling a stopped record belongs to the settle unit (#5219), documented in journey `find-a-stopped-driver-run-already-settled-5219`. It removes the locked worktree with `git worktree remove --force --force`, and it closes no PR.
- Updated at wrap-up of #5218, after the review fixes. Step 1 says the origin-host gate runs before the policy read. Steps 3 and 4 now place a failed `check` call (`blocked` before any push) and a push that failed after reaching origin (`blocked`) where the code ends them.
- Updated during the build of #5219: Steps 5 and 6 hand off to the driver's own settle and its `settle: interrupted` final line.
- Updated during the build of #5277 (run `2026-11-13T000412-spec-5277`). Step 5 now covers the CI step's settle window, the GitHub Actions run requirement and the `no-ci` rule with its exemptions. Step 6 now covers what an interrupt inside the window reports.
- Updated during the build of #5269 (run `2026-11-13T000404-record-5269`): step 3 now says the commit subject keeps its leading verb, and that a closing keyword goes only when an issue reference follows it.
- Updated during the build of #5352 (run `2026-11-13T093429-spec-5352`). Step 3 now says that `www.` and bare `github.com/` issue URLs and host-free `owner/repo/issues/N` paths are dropped too, and that the summary's changed-file list is filtered the same way. A matching red flag was added.
- Updated during the build of #5222 (run `2026-11-13T093607-spec-5222`). Step 3 now covers the `review` step: when the policy runs it, what its line carries, the red-test rule and the one fix round, with matching red flags.
