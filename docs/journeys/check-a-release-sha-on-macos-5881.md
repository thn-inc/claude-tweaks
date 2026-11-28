---
files:
  - .github/workflows/macos-release-check.yml
---

# Check a Release Sha on macOS Without Running the Suite Locally

**Persona:** The claude-tweaks maintainer, or the release gate acting for them (#5887), about to ship a specific commit. Their developer machine is already busy with several pipeline sessions, so it should not also run a 15-minute whole suite.
**Goal:** Get a trustworthy macOS verdict for exactly the sha that will be released. GitHub's standard `macos-latest` runner runs it, and the verdict is readable with one call.
**Entry point:** `gh workflow run macos-release-check.yml -f sha=<40-hex sha>`.
**Success state:** `gh api repos/thn-inc/claude-tweaks/commits/<sha>/statuses --jq '[.[] | select(.context=="macos-release-check")][0].state'` prints `success`, and the run's log shows `git rev-parse HEAD` equal to the dispatched sha.

## Steps

### 1. Dispatch the check on the exact sha — terminal
- **Action:** Run `gh workflow run macos-release-check.yml -f sha=<sha>` with the full 40-character commit sha. Upper case is accepted.
- **Expect:**
  - The `pending` job validates the input as a whole 40-hex string before anything is checked out.
  - A short sha, a branch name, surrounding whitespace or a multi-line value fails at once with `::error::sha input is not a 40-hex commit sha` and a `sha input: …` line showing the value. In that case no status is written.
- **Should feel:** One command with a fail-fast answer for a typo. There is nothing to wait on before you know the input was accepted.
- **Red flags:** A bad input that reaches checkout, or one that posts any status.

### 2. Read "in progress" — terminal
- **Action:** Run the read call above while the run is going.
- **Expect:**
  - It prints `pending` within seconds of the ubuntu `pending` job starting, even while the macOS runner is still queued (1.5–8 minutes in the spike).
  - Before the `pending` job starts, the read prints empty or the sha's previous verdict.
  - To tie the read to your own dispatch, compare the status's `target_url` (the run URL) or `created_at`.
- **Should feel:** A status that means what it says. `pending` is this run in progress, not a leftover.
- **Red flags:**
  - Using the combined `/commits/<sha>/status` state. It reads `pending` even when there are zero statuses.
  - Treating empty output as success.

### 3. Read the verdict — terminal
- **Action:** Run the read call again after the run finishes.
- **Expect:** One of these states:
  - `success`: the suite passed on Node 22.
  - `failure`: the suite step itself was red.
  - `error`: the sha could not be tested. Checkout failed (for example, a sha on no fetched ref), setup failed, the run was cancelled or timed out, or the macOS runner was lost.

  The verdict is written by a separate ubuntu `verdict` job. The macOS `suite` job that runs the code under test holds only `contents: read`, so it cannot write its own verdict.
- **Should feel:** Like a gate you can trust: `failure` and `error` are distinct, and neither looks like `success`.
- **Red flags:**
  - A failed checkout reported as `failure`.
  - A green run reported on `GITHUB_SHA` (the head of `main`) instead of the dispatched sha.

### 4. If the status stays `pending` — bounded wait
- **Action:** Bound your wait. Size the bound for the runner queue plus about 15 minutes of suite time, inside the job's 60-minute timeout.
- **Expect:**
  - A force-cancel, a lost runner, or a failed verdict POST can leave `pending` behind for good. An expired `pending` is treated as `error`.
  - A sha that is not a commit in this repository never gets a status, because the POST is rejected with 422. Treat that as missing, never as success.
- **Should feel:** Predictable. A stuck check never blocks a release forever, and it never passes silently.
- **Red flags:** A reader that waits without a limit, or that treats a stale `pending` as acceptable.

### 5. Change the workflow — pull request
- **Action:** Open a PR that edits `.github/workflows/macos-release-check.yml`.
- **Expect:** The workflow's own `pull_request` trigger runs the full suite on the PR head under Node 20 and Node 22, and posts no status. Run 44263389698 shows both jobs green, with `pending` and `verdict` skipped.
- **Should feel:** A change to the gate is proven before it merges, and costs nothing on the free standard runner of this public repo.
- **Red flags:** A `push` trigger, a `pull_request` trigger on any other path, or a larger (billed) runner label.

## Origin
- Created during the build of #5881 (release-as-promotion, parent #5838). The release gate will dispatch this check on the sha it ships, replacing the local macOS whole-suite run (#5370).
- The macOS-only test failures it surfaced were fixed or recorded in PR #5889. Bash sourced `~/.bashrc` over socket stdin; the fix is `--norc --noprofile`, pinned by a fixture-HOME assertion in `tests/bin-lib/hooks/guard-rewrite.test.js`. Intermittent Node 20 runner symptoms are tracked in #5900.
