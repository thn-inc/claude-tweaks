# macOS Release Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The full suite passes on a standard GitHub `macos-latest` runner, and `.github/workflows/macos-release-check.yml` runs it on any dispatched sha and records the verdict on that sha.

**Architecture:** One new workflow carries two triggers:
- `pull_request`, limited to its own path, proves changes before merge. It runs Node 20 and 22, so the Node-20-only failure is covered. It **posts no status**.
- `workflow_dispatch`, with a `sha` input, is what the release gate will call. It runs Node 22 only.

`workflow_dispatch` check runs attach to the dispatched ref's head, not the input sha. So a dispatch run writes the verdict explicitly as a commit status, context `macos-release-check`, on the input sha: `pending` at start, then a final `if: always()` step writes one of:
- `success`: the suite passed;
- `failure`: the test-suite step itself failed;
- `error`: any earlier step failed (such as checkout of an unknown sha, or setup), or the run was cancelled or timed out — meaning "could not test this sha".

This mapping was decided by the user at plan review. The three macOS-only test failures are reproduced on the runner first, with diagnostics, and fixed at their cause. A non-`PATH` cause is re-scoped inside the plan (also decided at plan review), and the cause is recorded per test file in the PR description.

**Tech Stack:** GitHub Actions YAML, Node 20/22, `node:test`, bash.

**Spec:** `.claude-tweaks/pipelines/2026-11-17T204803-spec-5881-5882-5883/spec-5881/work/5881-spec.md` (record #5881; parent #5838).

**Proof(none):** no risk flags are kept on this record.

## Global Constraints

- Runner: `macos-latest` only. It is a standard label; a larger runner is never used.
- `workflow_dispatch` runs Node 22. The `pull_request` run uses matrix Node `[20, 22]`.
- No `push` trigger. The `pull_request` trigger is limited to `paths: [.github/workflows/macos-release-check.yml]`.
- Job env mirrors `test-impact-map.yml`: `GIT_AUTHOR_NAME/EMAIL` and `GIT_COMMITTER_NAME/EMAIL` set to `ci` / `ci@invalid.example`, and `GH_TOKEN: ${{ github.token }}`. Checkout uses `actions/checkout@v7` with `fetch-depth: 0`; Node comes from `actions/setup-node@v7`.
- The suite command is `npm test --silent -- --full`.
- Never weaken or skip an assertion on darwin. Fix causes.
- Never start `node --test` directly in a local scratch check; a repo guard refuses it. Use `npm test -- <file>` (which goes through `tools/run-tests.js`).
- Commit messages follow `{Verb} {what} — {detail}` and end with `Claude-Session: https://claude.ai/code/session_01X7gPFAHS3KpiA3TWZX5QJV`.

## Review Focus

1. **A `sha` input of the wrong shape** (short sha, surrounding whitespace, a branch name) is rejected before checkout, naming the input. Uppercase hex is accepted and lower-cased. Owned by Task 4: a `Validate sha` step. The input reaches it only through `env: SHA_INPUT`, and is never interpolated into a `run:` script (spec).
2. **A cancelled or timed-out job** must never leave the status `pending`: the `if: always()` final step writes `error` for it. Owned by Task 4.
3. **A sha that is on no fetched ref** fails at checkout, and the status ends `error` (could not test), not `failure` and not `pending`. Owned by Task 4: the suite-step outcome check in `Record verdict`.
4. **The status is written to the input sha, never `GITHUB_SHA`**, which on dispatch is the head of `main`. A `pull_request` run posts none. Owned by Task 4; proven post-merge in Task 5.
5. **Two dispatches on the same sha** queue rather than cancel each other, so neither leaves a stray `pending`. A **workflow-level** concurrency group is keyed on the event and input sha, with `cancel-in-progress` only for `pull_request`. A job-level group would make the Node 20 and 22 matrix jobs serialize or cancel each other. Owned by Task 4.

## Probes (plan-review amendment)

- `gh api repos/thn-inc/claude-tweaks/commits/96c2c25952a5bfffdd2c084262cd170a8144397e/statuses --jq '[.[] | select(.context=="macos-release-check")][0].state'`, the spec's exact read call, exits 0 with **empty output** on a sha with no status. Empty means missing, never success. This supersedes the `/status` form probed below: the header and every task use the spec's `/statuses ... [0].state` call.

## Probes (plan-authoring checks, run 2026-11-17)

- **Read call (verbatim-command run-once check).**
  - `gh api repos/thn-inc/claude-tweaks/commits/96c2c25952a5bfffdd2c084262cd170a8144397e/status -q '.statuses[] | select(.context == "macos-release-check") | .state'` exits 0 with empty output on a sha with no status. That confirms "nothing" means never dispatched.
  - **Trap:** the same call's combined `{state, total_count}` printed `{"state":"pending","total_count":0}` with no statuses at all. Readers must select the `macos-release-check` context and never use the combined `state`. Task 4's header comment says so.
- **Status write.** `gh api -X POST repos/{repo}/statuses/{sha} -f state=… -f context=macos-release-check` has no read-only form. It is unverified until Task 4's PR run, whose read-back after the run proves it.
- **Empty-value check.** An empty `SHA` would POST to `repos/{repo}/statuses/`. Task 4 guards both status steps on `SHA` being set, and the validation step fails before either runs.

---

### Task 1: Workflow skeleton plus temporary diagnostics, to reproduce on the runner

**Files:**
- Create: `.github/workflows/macos-release-check.yml`

**Interfaces:**
- Produces:
  - workflow name `macos-release-check`; job id `suite`; job name `full suite (macos-latest, node ${{ matrix.node }})`;
  - matrix `node: ${{ github.event_name == 'pull_request' && fromJSON('[20,22]') || fromJSON('[22]') }}`;
  - a step `Diagnostics (temporary)` that later tasks remove.

- [ ] **Step 1: Write the workflow.** Triggers: `pull_request` limited to its own path, and `workflow_dispatch` with input `sha` (required, string). `permissions: contents: read` for now. `timeout-minutes: 60`. Steps:
  1. checkout at `${{ inputs.sha || github.sha }}`;
  2. setup-node at the matrix version;
  3. `Diagnostics (temporary)`, printing: `node -v`; `command -v -a node`; `echo "$PATH"`; `env | grep -i -e node -e bash_env -e test_context || true`; `sw_vers`; `/bin/bash --version | head -1`; `command -v bash`; `ls -ld "$TMPDIR"`; `mount | grep -e ' /private' -e ' /var' || true`; then a one-off reproduction (`d=$(mktemp -d); printf '#!/bin/sh\necho STUB\n' > "$d/node"; chmod 755 "$d/node"; ls -l "$d/node"; env -i PATH="$d:$PATH" HOME="$HOME" bash -c 'command -v node; node x'; env -i PATH="$d:$PATH" HOME="$HOME" zsh -f -c 'command -v node; node x'`);
  4. the suite run, through `tee`, with `PIPESTATUS` (as in spike PR #5860);
  5. an upload of `suite.tap` with `if: always()`.

- [ ] **Step 2: Commit and push** to the shared branch: `git add .github/workflows/macos-release-check.yml`, then commit `Add a sha-dispatchable macOS release-check workflow — skeleton with temporary runner diagnostics (#5881)`, then `git push`.

- [ ] **Step 3: Wait for the PR run and record the evidence.** Run `gh run list --workflow macos-release-check.yml --branch $(git branch --show-current) --limit 1 --json databaseId`, then `gh run watch <id> --exit-status`.
  - Expected: both matrix jobs FAIL with the spike's failures: Node 20 with 3, in `guard-rewrite.test.js` (2) and `risk-flags-cli.test.js`; Node 22 with 2, in `guard-rewrite.test.js`.
  - Save the diagnostics step's output and each failing test's YAML block to the run's ledger as one `build` row naming the run id.
  - If the run does not reproduce the failures, stop and report NEEDS_CONTEXT with the run URL. Never proceed on an unreproduced failure.

### Task 2: Fix the guard-rewrite `node` stub being skipped on macOS

**Files:**
- Modify: `tests/bin-lib/hooks/guard-rewrite.test.js` (the stub setup at about lines 771–810, `runIn` at about line 855)

**Interfaces:**
- Consumes: the Task 1 diagnostics (run id in the ledger).

- [ ] **Step 1: Write the failing precondition test.** Add `test('the node stub shadows the real node in every tested shell', …)`, skipped on win32 and when `SHELLS` is empty. For each shell in `SHELLS`, run `runIn(shell, 'command -v node', {})` and assert `status === 0` and `stdout.trim() === path.join(STUB, 'node')`, with the message `${shell} resolved node to ${stdout.trim()}, not the stub`. This turns the silent fall-through into a named failure.

- [ ] **Step 2: Push and confirm it fails on the macOS PR run** (Node 22 job). Expected: FAIL, naming the real node path. Run it locally first with `npm test -- tests/bin-lib/hooks/guard-rewrite.test.js`; expected PASS on this Mac. A local pass on macOS is itself evidence that the cause is specific to the runner image.

- [ ] **Step 3: Fix at the cause the Task 1 diagnostics showed**, and record which one in the commit body:
  - **The stub is not executable on the runner's `TMPDIR`** (a noexec mount, or a mode lost to umask): set the mode explicitly with `fs.chmodSync(path.join(STUB, name), 0o755)` after each write. If the mount is noexec, create `SANDBOX` under a directory that allows exec (for example the repo checkout's own `.git` or `os.homedir()`), and say why in a comment.
  - **The shell rebuilds `PATH`** (a profile read despite `-c`, or a `BASH_ENV` or `ENV` reaching it): pass an explicit minimal env with `BASH_ENV` and `ENV` unset and `--norc`/`--noprofile` for bash, or prepend the stub after any such rebuild.
  - **Any other cause:** fix at that cause. Never change the expected argv or skip on darwin.

  Whatever the cause, it is re-scoped here, not escalated (decided at plan review):
  - record the diagnosed cause for `guard-rewrite.test.js` as one line in the PR description, under a `### macOS root causes` heading (`gh pr edit` on the shared PR, keeping the session link line last);
  - when the cause is not `PATH` resolution, add a regression assertion for that specific cause beside Step 1's precondition test.

- [ ] **Step 4: Run locally and push.** Run `npm test -- tests/bin-lib/hooks/guard-rewrite.test.js` (expected PASS), then push. On the PR run, the new precondition test and both formerly failing tests PASS under Node 20 and 22.

- [ ] **Step 5: Commit.** Message: `Fix the guard-rewrite node stub being skipped on the macOS runner — {cause in five words} (#5881)`.

### Task 3: Fix risk-flags-cli's child running a different Node major on macOS Node 20

**Files:**
- Modify: whichever file the Task 1 evidence names. Candidates: `tests/risk-flags-cli.test.js`, `tests/helpers/run-cli.js`, `tools/run-tests.js`.

**Interfaces:**
- Consumes: the Task 1 diagnostics. `spawnCli(cliPath, argv, { env, cwd, stdin })` already spawns `process.execPath` (`tests/helpers/run-cli.js:261`), and `tools/run-tests.js:960` spawns `process.execPath`.

- [ ] **Step 1: Locate the foreign-Node child.** From the failing test's YAML block (`failureType: uncaughtException`, `#proccessRawBuffer`), find which process wrote v8-serialized test frames. Candidates:
  - a `node` resolved from `PATH` anywhere in the file's call graph (`grep -n "'node'" tests/risk-flags-cli.test.js plugin/bin/risk-flags.js plugin/bin/lib/risk-flags*`);
  - a child inheriting `NODE_TEST_CONTEXT` (compare `tests/helpers/suite-slot-env.js`, which strips it for nested runs).

- [ ] **Step 2: Write the failing test** that pins the cause in the owning file. If it is a `PATH`-resolved `node`, assert the spawn uses `process.execPath`. If it is `NODE_TEST_CONTEXT`, assert the child env passed by the helper does not carry `NODE_TEST_CONTEXT`. Run `npm test -- <that test file>`: it should FAIL locally, or else fail on the PR's Node 20 job.

- [ ] **Step 3: Fix it** with `process.execPath` in place of `'node'`, or by stripping `NODE_TEST_CONTEXT` from the child env, following `tests/helpers/suite-slot-env.js`'s pattern.
  - Re-scope a non-`PATH` cause here, without stopping (decided at plan review).
  - Record the diagnosed cause for `risk-flags-cli.test.js` as a line under the PR description's `### macOS root causes` heading.
  - Keep the "child process runs the parent's Node" regression assertion wherever it applies; when the cause is something else, the Step 2 test is the cause-specific assertion.

- [ ] **Step 4: Verify.** Run `npm test -- tests/risk-flags-cli.test.js` locally (PASS), then push. The PR's Node 20 job reports `risk-flags-cli.test.js` as passing.

- [ ] **Step 5: Commit.** Message: `Fix risk-flags-cli spawning a foreign Node major under the macOS runner — {cause} (#5881)`.

### Task 4: Validate the sha, record the verdict on it, document the read, remove diagnostics

**Review risk:** high. It touches concurrency (a workflow-level group, queued dispatches on one sha) and decision logic (the `if: always()` verdict mapping, and gating the status steps on the event).

**Files:**
- Modify: `.github/workflows/macos-release-check.yml`

**Interfaces:**
- Produces (dispatch runs only; a `pull_request` run posts none): commit status `context=macos-release-check` on the input sha.
  - States: `pending` while running; `success` when the suite passed; `failure` when the suite step failed; `error` when the run could not test the sha (an earlier step failed, or it was cancelled or timed out). A sha never dispatched has no status.
  - The header comment documents the spec's exact read call: `gh api repos/{owner}/{repo}/commits/{sha}/statuses --jq '[.[] | select(.context=="macos-release-check")][0].state'`. Empty output means missing, never success.

- [ ] **Step 1: Add the `Validate sha` step** (dispatch only: `if: github.event_name == 'workflow_dispatch'`), first in the job, before checkout.
  - It has `env: SHA_INPUT: ${{ inputs.sha }}`, and its script references only `"$SHA_INPUT"`; the input is never interpolated into `run:`.
  - It lower-cases the value and fails unless it matches `^[0-9a-f]{40}$`, printing `::error::sha input is not a 40-hex commit sha` followed by the value on its own plain `echo` line. The value never goes inside the `::error::` command text.
  - It exports `SHA` to `$GITHUB_ENV`.
  - On `pull_request`, a separate step sets `SHA` from `env: PR_HEAD: ${{ github.event.pull_request.head.sha }}`.

- [ ] **Step 2: Add the head check and the status writes.**
  - Set `permissions: contents: read` and `statuses: write`.
  - Add `RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}` to the job `env`.
  - After checkout (`ref: ${{ env.SHA }}`), a `Confirm checked-out sha` step prints `git rev-parse HEAD` and fails when it differs from `$SHA`. This gives AC2.1 its log line.
  - Give the suite step `id: suite`.
  - `Mark pending` (after validation) and `Record verdict` (`if: always()`, last) both carry `if: github.event_name == 'workflow_dispatch' && env.SHA != ''`. A `pull_request` run never writes a status.
  - `Mark pending` runs `gh api -X POST repos/${{ github.repository }}/statuses/$SHA -f state=pending -f context=macos-release-check -f target_url="$RUN_URL" -f description="macOS full suite running"`.
  - `Record verdict` maps `steps.suite.outcome` (passed in through `env:`): `success` → `success`; `failure` → `failure`; anything else (`skipped`, because an earlier step failed; `cancelled`; empty) → `error`. This is the plan-review decision.
  - **Concurrency, at workflow level:** group `macos-release-check-${{ github.event_name }}-${{ inputs.sha || github.ref }}`, with `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. The key uses the raw input: two case variants of one sha can still land in different groups, which only queues an extra run and is accepted.

- [ ] **Step 3: Write the header comment.** Cover:
  - purpose (#5881, the release gate of #5838);
  - the triggers, and that only dispatch posts a status;
  - why the verdict is a commit status (dispatch check runs attach to the ref head, not the input sha);
  - the state meanings, including `error` versus `failure`;
  - the spec's exact read call, and that empty output means missing — never read the combined `/status` state, which shows `pending` with zero statuses;
  - cost (free on this public repo; about $0.062/min if private; standard runner only).

- [ ] **Step 4: Remove the `Diagnostics (temporary)` step.**

- [ ] **Step 5: Push and verify on the PR run.**
  - Both matrix jobs PASS.
  - The PR head carries **no** `macos-release-check` status: the header's read call on `git rev-parse HEAD` (its own plain call) prints empty.
  - `gh workflow view macos-release-check.yml --yaml | grep -c "push:"` prints `0`.

  The status write itself is proven in Task 5.

- [ ] **Step 6: Commit.** Message: `Record the macOS release-check verdict as a commit status on the checked sha (#5881)`.

### Task 5 (post-merge, not before): Prove dispatch on the main tip

**Files:** none.

- [ ] **Step 1: Dispatch on the main tip once the PR has merged.** Run `gh workflow run macos-release-check.yml -f sha=<origin/main sha, from its own plain rev-parse call>`, then watch the run. Expected: the `Confirm checked-out sha` step prints HEAD equal to the input, and the run concludes `success`.
- [ ] **Step 2: Read the verdict** with the header's call: `gh api repos/thn-inc/claude-tweaks/commits/<sha>/statuses --jq '[.[] | select(.context=="macos-release-check")][0].state'`. Expected: `success`. This proves the status write that the PR run cannot.
- [ ] **Step 3: Check bad input** with `gh workflow run macos-release-check.yml -f sha=abc123`. Expected: the run fails at `Validate sha` with the `::error::` message naming `abc123`, and writes no status.
- [ ] **Step 4: Record both run URLs** on #5881 in one comment. This task is carried on the ledger as a `build` row (`open`, `Defer-reason: blocked-dependency` — requires the merged workflow on the default branch) until done.
