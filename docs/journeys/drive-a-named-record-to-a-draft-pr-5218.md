---
files:
  - plugin/bin/drive.js
  - plugin/bin/lib/driver/run.js
  - plugin/bin/lib/driver/steps.js
  - plugin/bin/lib/driver/admission.js
  - plugin/bin/lib/express/eligibility.js
  - plugin/bin/lib/driver/events.js
  - plugin/bin/lib/driver/settle.js
  - plugin/bin/lib/driver/merge.js
  - plugin/bin/lib/driver/judgments.js
  - plugin/bin/lib/driver/acceptance.js
  - plugin/bin/lib/driver/review.js
  - plugin/bin/lib/driver/launch.js
  - plugin/bin/lib/driver/adopt.js
---

# Drive a Named Record to a Draft PR

**Persona:** a maintainer who has an eligible, express-sized record. They want it built and opened as a draft PR with CI read, with no model session in charge of the steps, and they will judge the cost and wall clock from the report afterwards.
**Goal:** name one or more records on the command line and get back, for each, a draft PR (or a clear reason there is none) and a one-line outcome. Nothing merges unless the record carries `auto:merge` and the judgment workers clear it, and no step runs twice.
**Entry point:** `node plugin/bin/drive.js #N [#M…]` in the main checkout of a repository whose `.claude-tweaks/policy.yml` enables `express-driver`.
**Success state:** each record's final event line reads `pending-review` with a PR number and a `ci` word, and `{run-dir}/driver-events.jsonl` holds the same lines that stdout showed. For a record without `auto:merge`, or one the judgment workers do not clear, the draft PR waits for a human and the driver has merged and marked ready nothing; step 7 covers a run that merges.

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
  - `--check #N` prints only the admission verdict as one JSON line (`{"record":N,"admitted":bool,"reasons":[…]}`) and writes nothing; exit 0 means a verdict was printed.
  - `--run <dir> --no-settle` adopts a caller's run directory and the linked worktree it is run from, and exit 3 refuses a bad one with nothing written. An adopted worktree on the integration branch exits 1 instead: the policy step refuses it before the claim. `--in-flight-prs` and `--near-dup-pairs` hold the merge on an overlapping in-flight PR. Dispatch's driver route uses all three (journey `route-a-dispatch-singleton-through-the-driver-5232`).
- **Red flags:**
  - A non-zero exit for a record that was merely refused or escalated.
  - Any record started before the previous one's final line.

### 2. Get refused cheaply — admission
- **URL:** the `policy`, `fetch`, `eligibility` and `admission` event lines, then a final line with outcome `refused`
- **Action:** read the refusal's `detail`. It names every reason: the policy is `off`, the record is ineligible or not admitted, or the fetch failed. The policy step also refuses, naming the key or the role, an invalid `express-driver-models`, `model-profiles`, `model-ceiling` or `model-effort`, or a worker role it cannot resolve a model for, which includes a `model-profiles` row naming an effort outside `low`, `medium`, `high`, `xhigh`, `max` (#5917, #5942, `docs/driver.md`'s Worker models).
- **Should feel:** free. A refusal costs one record fetch and writes nothing: no claim, no run directory, no worktree.
- **Should understand:**
  - These events carry `run: null` and reach stdout only, because no run directory exists yet. The record is fetched once, and that same JSON feeds every later gate.
  - Eligibility applies the driver's lane bounds (`express-driver-max-size`, `express-driver-max-key-files`, and `express-driver-max-risk`; `docs/driver.md`'s Lane bounds). They default to the express lane's values, so a project that sets neither sees the express refusals unchanged.
  - A record beyond the express bounds (a size label other than `low`, or more than 3 Key Files) gets through only when the reviewer step is on for it. With the reviewer off, admission refuses it with `record is beyond the express bounds and the reviewer step is off for it`. If such a record is inside the lane bounds but fails another eligibility rule, the eligibility stop's detail names eligibility's reasons first and then that reviewer reason, so one refusal shows both fixes.
- **Red flags:**
  - A run directory, claim or worktree left behind for a refused record.
  - A second `gh issue view` for the same record.
  - A record beyond the express bounds admitted with the reviewer step off.
  - A `size:high` record admitted under any `express-driver-max-size`.

### 3. Watch the build — claim through push
- **URL:** the event lines `claim`, `run-dir`, `worktree`, `worker`, `commit`, `test`, `check`, `review` (when policy runs it) and `push` on stdout, and `{run-dir}/driver-events.jsonl`
- **Action:** watch the lines scroll by.
  - The driver claims the record, mints the run directory, and adds a locked worktree on `drive-record-{n}`.
  - A headless implementer writes the change. The driver commits it by explicit path, with message `{title} — refs #{n}`, and runs the scoped tests.
  - `express-lane.js check` gives its verdict. When `express-driver-review` applies, one read-only reviewer follows, and a finding counts only when the driver's own `node --test` run of its evidence file fails (one fix round at most; see `docs/driver.md`). The driver pushes only when HEAD equals the `head` that `check` returned and the branch ref `refs/heads/drive-record-{n}` points at that same commit.
- **Should feel:** watched-over. Every gate is a program decision with a named step, and the worker's text never appears raw in a command, a commit subject or an event line.
- **Should understand:**
  - The worker event carries `usage`, `turns` and `denials`, plus `spendOverrun` when the spend ceiling was crossed. A denial is information, never a reason to relaunch.
  - The worker event also carries `model`, the alias the launch requested (by default the `standard` profile's model for the implementer, `capable`'s for the reviewer), not an observation of what ran. The `review`, `merge-check` and `merge-acceptance` lines carry it too. Beside it each of those lines carries `effort` (#5942): the level passed as `--effort` when the project sets `model-effort: profile` and the role's profile resolves one (by default `high` for both the implementer and the reviewer), or `null` when no flag was passed, whether the key is unset or the role resolved to `fast` — the two are deliberately indistinguishable. When the review step runs its fix round, the implementer's relaunch writes its own `worker` line, marked `fix: true`, just before the `review` line, with that relaunch's own `effort`; the `review` line names only the reviewer's. A launch refused for want of a model writes no `worker` line; the final line's `stop` names the step and the role.
  - The worker runs only the test files covering its change, never the whole suite (#5915). Its prompt names the project's declared targeted runner, read from `origin`'s committed `verify-scope.json`, never the worker's copy, with a list file at `.claude-tweaks/pipelines/worker-test-files.txt` that the driver removes after the launch. With no usable declaration, or on a platform where the worker has no Bash, the prompt says not to run tests. The worker event's `tests` field names which path was taken: `declared`, `none`, `unreadable` or `unsupported-platform`. The `test` step after the commit stays the gate.
  - A stop here ends the record `express-escalated`. Such stops include a worker `fail`, `timeout` or `cannot-complete`, a worker launch after which HEAD moved to another commit or could not be read (its detail names only the shas, never worker text; the driver never resets HEAD to recover), a skip-worktree or assume-unchanged index flag newly set by worker code (checked after each launch, each test run and each evidence run; a flag already set when the worktree was created is not caught), a green or verdict-less test run after which a tracked file differs from HEAD or a new file is in the worktree (read with `git status` after the flag check; a red run keeps its red-tests stop; a verdict-less run's stop also names why it gave no verdict; a file the commit's own git hooks write counts; paths under `.claude-tweaks/pipelines/`, which the commit step also skips, and ignored files do not count), a worktree whose `core.ignoreStat` is true (refused before the baseline), no changed files, red tests, a refused scope file (one that is not a regular file, or whose bytes differ from `origin/{integration branch}`'s copy, line endings aside), an `escalate` verdict, a HEAD mismatch, a branch ref that is not the checked `head` or cannot be read (a branch switch or detached HEAD at the same commit before the driver commits, so its commit lands off the branch; its detail names the branch and both shas, or a fixed unreadable message), a push that failed without reaching origin, or leftover state from an earlier run (a worktree, branch, remote branch or run directory named in the detail).
  - The scoped tests run with the worker's allow-listed environment, not the driver's, and an empty `gh` config directory, so the driver's credentials do not reach worker-authored test code. A project test command that needs a variable outside that list (`JAVA_HOME`, `NODE_OPTIONS`, `CI`, a proxy variable) fails red at this step and the record escalates. This is best-effort containment, not a sandbox.
  - `check` applies `express-driver-max-lines` (as `--max-lines`) only when that key is set and the reviewer step is on for the record; a malformed value counts as unset, because it resolves to the default. Otherwise the driver passes no flag, and `check` applies `auto-merge-max-lines`. It passes `check --protected-paths reviewer` only when `express-driver-protected-paths` is `reviewer` and the reviewer step is on for the record, so a protected path `check` reports widens the record instead of escalating it (#6019), and under `refuse` it never passes the flag. The worker's prompt states whichever bound `check` will apply.
  - The `review` step runs only when `express-driver-review` says so. Under its default, `beyond-express`, it runs only for a record beyond the express bounds or admitted widened (above `risk:low`, #6018), so with the lane bounds at their defaults it practically never runs, because eligibility refuses every record beyond the express bounds. Widen `express-driver-max-size`, `express-driver-max-key-files` or `express-driver-max-risk`, or set `express-driver-review` to `on`, to see it. When it does not run, it writes no line at all, so the event stream reads exactly as it did before the step existed. When it runs, its one line carries `returned`, `reproduced` and `discarded` counts, the reviewer's `usage`, `denials`, `costUsd` and `turns`. The final line's cost covers the two implementer launches only.
  - A reviewer finding is kept only when its evidence test file fails a real `node --test` run. Every other outcome discards it: a passing run, a load failure, no test case, a timeout, output the rule cannot place, or a path the path rules refuse, such as one holding a glob character or naming an existing file. Confirmed findings get one fix round: a second implementer launch, the evidence rewritten from the reviewer's bytes, a commit, the scoped tests, a direct run of each kept test, then a second `check`. The push compares HEAD with that second `check`'s `head`. A fix worker that moved HEAD stops at its launch, and a fix commit that finds nothing to commit stops the round. Any failure in the round stops the record with the finding named, `express-escalated` except a failed `check` call, which ends it `blocked` as above. No third implementer ever starts.
  - A failed claim, or a run directory that cannot be minted, ends the record `blocked`. So does a failed `express-lane.js check` call (a non-zero exit, or no check envelope), even though nothing is pushed yet: no escalation line landed, so the full pipeline would not know the record left the lane.
  - The commit subject keeps the worker title's leading verb: `Fix the loop` stays `Fix the loop`. A closing keyword (`close`, `fix`, `resolve` and their forms, with an optional colon) is dropped only when the word after it carries an issue reference marker (`#N`, `owner/repo#N`, or an `/issues/N` or `/pull/N` path). Every `#N`, `owner/repo#N`, `GH-N` and `http(s)` issue or PR URL is dropped either way, so `Add the loop. Resolves #9.` becomes `Add the loop`. A `www.` issue or PR URL, a bare `github.com/` one, and an `owner/repo/issues/N` or `/pull/N` path that GitHub links go too. Worker text in an event line, and every settle step's detail, passes the same filter, so the summary line's changed-file list is filtered like a commit subject: a path with an `owner/repo/issues/N`-shaped segment (`lib/api/pull/3.js`) is shortened (`.js`).
- **Red flags:**
  - A commit message carrying `Fixes #N`, or a push after a HEAD or branch-ref mismatch.
  - A commit subject that lost its leading `Fix` or `Resolve` although no issue reference followed it.
  - A commit subject, PR body or event line that still carries a `www.` issue URL or an `owner/repo/issues/N` path, which would backlink the issue.
  - A worker transcript with a `gh`, `git commit` or `git push` call.
  - A worker transcript running the whole suite (a `# tests` total in the thousands), or a worker event with `tests: unreadable` when the declaration is on `origin`.
  - A `worker` line with no `model` field from a launch that started, or a worker that ran on the account's default model after a model refusal.
  - A `worker`, `review`, `merge-check` or `merge-acceptance` line that has `model` but no `effort` key, or a fix-round worker line whose `effort` copies the reviewer's instead of its own launch's. A stop before the launch (HEAD unreadable before it) writes a `worker` line with no `model`, because no model was resolved yet.
  - A commit the worker made itself reaching the branch or the PR, or a fix round that carried on after its commit found nothing to commit.
  - A leftover branch silently reused.
  - A `review` line under the default policy and default lane bounds, or a pushed record whose reviewer finding never had a red evidence run.
  - A `check` call carrying `--max-lines` for a record the reviewer step is off for, or when `express-driver-max-lines` is unset or malformed.
  - A `check` call carrying `--protected-paths` for a record the reviewer step is off for, or under `refuse`.
  - A third implementer launch, or an evidence file left in the worktree after its finding was discarded.

### 4. Get the draft PR — after the push
- **URL:** the `pr`, `record-pr`, `set-config` and `summary` event lines; the draft PR on GitHub
- **Action:** open the PR the final line names. It is a draft, its body was composed by `compose-pr-body.js --express`, and it targets the integration branch.
- **Should feel:** finished, but not shipped. The work is reviewable, and the merge decision is still the human's.
- **Should understand:**
  - Once the branch is pushed, a failure of `gh pr create` (after its one retry, which first looks for an open PR on the branch), `record-pr` or `set-config` ends the record `blocked`, because a pushed branch cannot escalate. So does a `git push` that reported a failure while `origin/drive-record-{n}` already holds the checked HEAD.
  - A failed summary entry still ends the record `pending-review`.
- **Red flags:** two PRs for one record after a transient `gh` failure; a PR that is not a draft at this step; a ready-for-review flip or a merge call before step 7, or at all for a record without `auto:merge`.

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

### 7. Merge it — when the judgment workers clear the record
- **URL:** the `merge-entry` … `merge-*` sub-step event lines, the `merge` event line, and the final line's `merge: { outcome, reason, mergeCommit, postMerge }` field
- **Action:** read the `merge` field. After a green CI wait, a record without `auto:merge` reads `pending-review` / `not-authorized`, and a deps object with no supplier reads `pending-review` / `no-supplier` with no call made at all. The step runs only after the CI wait ended `green`. The driver then:
  - re-reads the record's live labels for `auto:merge`;
  - stops a widened record at `pending-review` / `widened-admission` (#6018) before any judgment worker launches: one admitted above `risk:low`, with a non-fast-lane ceremony or with a protected Key File (#6019), one whose live labels now widen it, one in which `check` reported a protected path (#6019), or one whose run carries no readable widening list;
  - with `--in-flight-prs`, holds at `pending-review` (`drain-overlap` or `near-duplicate`) on an overlapping in-flight PR, in the `merge-overlap` line, before any judgment worker launches;
  - takes the judgment supplier's verdict (a read-only merge-check worker, then a read-only acceptance worker whose Try it, packet or parent brief the driver's own code posts) and confirms the verdict line in `decisions.md`;
  - checks closing links and composes the subject;
  - marks the PR ready;
  - reads the merge state and checks, then merges, arms or stops.
- **Should feel:** guarded. Every refusal that can be decided before the costly mark-ready is decided before it, and a merge goes out only against the head the driver's own checks covered.
- **Should understand:**
  - A widened record never merges on its own, even with `auto:merge`. The `merge-entry` detail names the source: `admitted widened by risk` (or by `protected-path`, from a protected Key File or a path `check` reported) for the run's own list, `live labels widen by ceremony (not at admission)` for a label added since. The labels are checked again right before the merge call, and a widening label added during the judgment workers or the CI watch stops at `merge-call` with `widened by … at the pre-merge read`. The `--check` verdict line (step 2) shows the same list as `widenedBy`.
  - A CI wait that ended in any word other than `green` skips the step, with or without a supplier. The `merge` event line then reads `not entered: ci {word}`, the final line carries no `merge` field, and nothing is called.
  - The outcome is `merged`, `armed` or `pending-review`.
    - `armed` means the forge holds the merge, and the reconciler finishes cleanup on merged evidence.
    - `pending-review` carries one closed-set reason: `not-authorized`, `check-failed:{names}`, `checks-pending-timeout`, `conflict`, `moving-target`, `merge-refused` and so on, or `unclassified` naming the failing sub-step.
  - What each stop leaves behind:
    - A red check, a draft-skip workflow, or checks still pending after the 15-minute watch park the record: `bot:parked` on the record and one fixed-template comment.
    - A conflict leaves one PR comment.
    - A refused merge leaves one PR comment and parks nothing.
  - On `merged`, post-merge runs in this order. A failure at any point is listed in `merge.postMerge.failures` and never changes `merged`.
    1. `post-merge-run.js`.
    2. The release-status comment.
    3. `hooks.js reconcile`, which archives the run directory. Later events follow it to `archive/{run-id}/`, or go to stdout only and say `eventsFile: stdout-only`.
    4. Worktree and local branch removal. Under `--run` both are kept for the caller.
    5. The remote branch delete.
  - Watch time counts as CI wait, so `msWithoutCi` still excludes it. A signal during the supplier call or the watch makes no further call.
  - The judgment workers fail closed. Any of these returns `needs-human`, which ends `pending-review` / `verdict-not-confirmed`, with no ready or merge call:
    - a worker that timed out, failed, was killed at a ceiling or returned anything but an exact `auto-merge` / `needs-human`;
    - a verdict line `decisions.md` does not confirm;
    - a sensitive path, a failed blast radius or a diff over the prompt cap (`diff-truncated`), decided by code before any launch.
  - An acceptance that did not complete ends `pending-review` / `acceptance-not-completed`.
  - The pending label the driver applies is `accept:pending`, on the parent for a `due` gate above the oversight floor and on the record for an above-floor record with no parent.
- **Red flags:**
  - A merge or ready call for a record without `auto:merge`, or after a judgment worker's verdict that was not a confirmed `auto-merge`.
  - A judgment worker launched, or a ready or merge call made, for a widened record (#6018): one carrying `risk:medium`/`risk:high`, a non-fast-lane ceremony label or a protected Key File, one in which `check` reported a protected path, or whose run has no readable widening list.
  - A merge after a red or pending read.
  - A `--match-head-commit` other than the checked head.
  - `--admin` or `--delete-branch` anywhere.
  - A remote delete of the integration branch.
  - `merged` reported from a merge call's exit code without the confirmation read.
  - A Try it comment, parent brief or acceptance packet posted, or `accept:pending` applied, after a worker-written field carried a credential-shaped value or the packet's render dropped or screened a claim. Each of these stops the acceptance before any label or post, so the record ends `pending-review` / `acceptance-not-completed`.

## Origin
- Created during the build of #5218 (run `2026-11-12T104316-spec-5218`), the pipeline driver's second unit. It drives the express lane's steps 1–8 and 10 as code over the #5217 worker launcher; step 9 (merge) is deliberately absent.
- Settling a stopped record belongs to the settle unit (#5219), documented in journey `find-a-stopped-driver-run-already-settled-5219`. It removes the locked worktree with `git worktree remove --force --force`, and it closes no PR.
- Updated at wrap-up of #5218, after the review fixes. Step 1 says the origin-host gate runs before the policy read. Steps 3 and 4 now place a failed `check` call (`blocked` before any push) and a push that failed after reaching origin (`blocked`) where the code ends them.
- Updated during the build of #5219: Steps 5 and 6 hand off to the driver's own settle and its `settle: interrupted` final line.
- Updated during the build of #5277 (run `2026-11-13T000412-spec-5277`). Step 5 now covers the CI step's settle window, the GitHub Actions run requirement and the `no-ci` rule with its exemptions. Step 6 now covers what an interrupt inside the window reports.
- Updated during the build of #5269 (run `2026-11-13T000404-record-5269`): step 3 now says the commit subject keeps its leading verb, and that a closing keyword goes only when an issue reference follows it.
- Updated during the build of #5226 (run `2026-11-13T071151-spec-5226`): step 7 documents the merge step a configured judgment supplier enables. The goal, success state and step 4 red flags now say nothing merges only when no supplier is configured.
- Updated during the build of #5352 (run `2026-11-13T093429-spec-5352`). Step 3 now says that `www.` and bare `github.com/` issue URLs and host-free `owner/repo/issues/N` paths are dropped too, and that the summary's changed-file list is filtered the same way. A matching red flag was added.
- Updated during the build of #5222 (run `2026-11-13T093607-spec-5222`). Step 3 now covers the `review` step: when the policy runs it, what its line carries, the red-test rule and the one fix round, with matching red flags.
- Updated during the build of #5414 (run `2026-11-14T153732-spec-5414-5415`). Step 3 now lists the moved-HEAD or unreadable-HEAD stop after a worker launch, says the fix round stops when its commit finds nothing to commit, and adds a red flag for a worker's own commit reaching the branch.
- Updated during the build of #5415 (run `2026-11-14T153732-spec-5414-5415`). Step 3 now lists the newly-set index-flag stop and the `core.ignoreStat` worktree refusal.
- Updated during the build of #5224 (run `2026-11-14T212211-spec-5224`). Step 2 now covers the driver's lane bounds and the refusal of a record beyond the express bounds when the reviewer step is off for it, including the eligibility stop that names both reasons. Step 3 now covers when `check` gets `--max-lines`, and no longer says the review step never runs under its default. Matching red flags were added.
- Updated during the build of #5228 (run `2026-11-14T212212-spec-5228`). The production deps now carry the judgment supplier, so the goal, the success state and step 7 describe a driven record that can merge. Step 7 names the read-only merge-check and acceptance workers, their fail-closed outcomes and the `accept:pending` label. Measuring the judge after a prompt change is journey `re-measure-the-merge-check-judge-after-a-prompt-change-5228`.
- Updated at wrap-up of #5228, after the review fixes: step 7 gains a red flag for an acceptance post or label made after a credential-shaped worker field or a partial packet, both of which now stop the acceptance before any label or post.
- Updated during the build of #5454 (run `2026-11-14T213352-spec-5454`). Step 3 now lists the test-step tree stop. After a green or verdict-less test run, a tracked file that differs from HEAD, or a new file in the worktree, stops the record. A red run keeps its red-tests stop, and a verdict-less stop also names why the run gave no verdict.
- Updated during the build of #5458 (run `2026-11-15T122114-spec-5458`). Step 3 now says the push also needs the branch ref at the checked `head`, and lists the branch-ref stop, which catches a branch switch or detached HEAD at the same commit made before the driver commits. The matching red flag was widened.
- Updated during the build of #5232 (run `2026-11-15T173500-spec-5232`): step 1 names `--check`, `--run` and the `--in-flight-prs`/`--near-dup-pairs` hold, which dispatch's driver route uses.
- Updated during the build of #5915 (run `2026-11-19T062113-spec-5915-5917`): step 3 says the worker runs targeted tests only, names the worker event's `tests` field, and adds a red flag for a whole-suite worker run.
- Updated during the build of #5917 (run `2026-11-19T062113-spec-5915-5917`): step 2 lists the policy step's model refusals, and step 3 says the worker, review and judgment lines carry the requested `model`, with a matching red flag.
- Updated at wrap-up of #5917: step 3's `model` red flag is narrowed to a launch that started, since a stop before the launch writes a `worker` line that resolved no model.
- Updated during the build of #5942 (run `2026-11-21T171056-spec-5941-5942`): step 2 adds the `model-effort` and unknown-effort refusals, and step 3 says the launch lines carry `effort` and that the review fix round writes its own `worker` line (`fix: true`), with a matching red flag.
- Updated during the build of #6018 (run `2026-11-22T105528-record-6018`): step 2 names `express-driver-max-risk` among the lane bounds, step 3 says the review step also runs for a record admitted widened, and step 7 adds the `widened-admission` stop at merge entry and at the pre-merge read.
- Updated during the build of #6019 (run `2026-11-22T163434-record-6019`): step 3 says when `check` gets `--protected-paths reviewer`, and step 7 adds a protected Key File and the check-time protected path as widening sources at the `widened-admission` stop. Matching red flags were added.
