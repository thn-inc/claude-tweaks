---
files:
  - plugin/skills/tidy/step-7-5-worktree-always.md
  - plugin/skills/_shared/pr-first-merge.md
  - plugin/bin/closing-links.js
  - plugin/bin/lib/flow/closing-links.js
---

# Tidy's Housekeeping PR Waits for Its Own Checks

**Persona:** Maintainer of a `pr-first` claude-tweaks repo with `worktree-always: true` and `housekeeping-auto-merge` effectively on (set, or derived from `autonomy: trusted`/`unattended`), whose integration branch has no required status checks — the weekly `/claude-tweaks:tidy` routine runs unattended and opens a housekeeping PR for its tidy-up commit. This is the PR #4458 shape: it merged in the same second it was "armed", before its `test` workflow ran.
**Goal:** The housekeeping PR merges only after its own checks finish green, and nothing in its body closes an issue by accident.
**Entry point:** `/claude-tweaks:tidy`'s Step 7.5 `pr-first` branch, after Step 7's tidy-up commit landed in the scratch worktree.
**Success state:** The run's `decisions.md` logs the arm outcome `merged` with the report line `PR #{n} opened and merged after its checks passed` — the PR's `statusCheckRollup` shows every check concluded before `mergedAt`. Or, when checks fail or are still pending at the 15-minute bound, `PR #{n} opened, NOT armed — {reason}` with `check-failed:{names}` or `checks-pending-timeout`. No issue named in the tidy summary ("closed #12 (stale)") was closed by the PR. The maintainer should feel that an unattended tidy merge is as safe as a gated build merge.

## Steps

### 1. Screen the composed body — `closing-links.js --mode screen`
- **URL:** none (local; the body file under the session tmp root)
- **Action:** Before `gh pr create`, tidy runs `node "${CLAUDE_PLUGIN_ROOT}/bin/closing-links.js" --mode screen --body-file "{body-path}"`. A summary phrase such as `closed #12 (stale)` becomes `closed issue #12 (stale)`, which GitHub does not link. The CLI prints `{"action":"neutralized",...}` (or `clean`, leaving the file byte-identical).
- **Should feel:** Invisible. The summary still reads naturally.
- **Should understand:** GitHub links every closing-keyword phrase anywhere in a PR body. A housekeeping PR closes no record, so every phrase is neutralized.
- **Red flags:** The screen exits non-zero but a PR opens anyway, or the commit merges locally via the `local-merge` fall-through. A failed screen must report `PR NOT opened — closing-keyword screen failed ({reason}); branch {branch} pushed` and merge nothing.

### 2. Open the PR ready — `gh pr create`
- **URL:** `https://github.com/{owner}/{repo}/pull/{n}`
- **Action:** Tidy opens the PR, not as a draft, stamped `<!-- tidy-housekeeping-pr -->`.
- **Should feel:** Routine.
- **Should understand:** Tidy's own judgment layer (Step 6 approval, Step 7.5 verification) already ran, so there is nothing to undraft.
- **Red flags:** A draft PR — `/tidy`'s sweep backstop skips drafts, so it would never be found again.

### 3. Run the merge-verification gate before arming — `pr-first-merge.md` Step 2.5
- **URL:** `https://github.com/{owner}/{repo}/pull/{n}/checks`
- **Action:** Tidy resolves `merge-verification` and reads the PR's state and head runs. With checks pending and `mergeStateStatus` not `BLOCKED` (no required checks), arming would merge immediately, so the gate runs its bounded watch instead (up to 15 minutes, polling `gh pr checks`). Green → Step 3's merge fence merges the PR. Red, or still pending at the bound → the PR stays open and unarmed, with the reason logged. With required checks configured (`BLOCKED`), it arms `--auto` and the forge holds the merge.
- **Should feel:** Like a build run's merge — the same gate, the same outcomes.
- **Should understand:** Under an explicit `merge-verification: off`, tidy merges as every other merge site does under `off`. That is the maintainer's opt-out, not a tidy special case.
- **Red flags:** `mergedAt` earlier than a check's completion on a repo without required checks while `merge-verification` is not `off`; or a `bot:parked` label appearing anywhere (a housekeeping PR has no record to park).

## Origin

Record #4467 (tidy step-7-5: the housekeeping PR merges immediately when the repo has no required checks, and its body is not screened for closing keywords).
