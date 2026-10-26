---
files:
  - plugin/skills/wrap-up/verification-brief.md
  - plugin/skills/wrap-up/summary-template.md
  - plugin/bin/pr-merge-state.js
  - plugin/bin/evidence-route.js
  - plugin/bin/lib/wrap-up/evidence-route.js
  - plugin/bin/lib/reconcile/pr-state.js
  - plugin/skills/_shared/scratch-worktree.md
  - tests/verification-brief-evidence-routing.test.js
---

# Land Demo Evidence After the Run's PR Already Merged

**Persona:** a maintainer whose `pr-first` run reached acceptance labeling after its PR was already merged. The PR may have merged at the console's "Approve all + merge" step, during a human merge of a parked run, before a re-run after a `BLOCKED` verify verdict, or through `dispatch close-out`. They want the record's screenshots on `main`, and don't want to find them stranded on a dead branch weeks later.

**Goal:** the brief's screenshot evidence reaches the integration branch through an open PR every time, never through a commit on a merged branch and never by a push straight to `main`.

**Entry point:** `/claude-tweaks:wrap-up` Phase 4's Acceptance labeling step reaching `verification-brief.md` Step 4 for an `app-route`/`rendered-page` record whose browser walk produced screenshots.

**Success state:** either the screenshots ride the run's own still-open PR, or a separate evidence-only PR (`Refs #{record}`) holds them. In both cases the brief's images resolve from a pushed commit and the wrap-up summary names where they went.

## Steps

### 1. Step 4 asks `bin/evidence-route.js` which route the commit takes
- **URL:** `verification-brief.md` Step 4 — `node "${CLAUDE_PLUGIN_ROOT}/bin/evidence-route.js" --run "{run-dir}"`
- **Action:** wrap-up runs the CLI as its own Bash call, with `{run-dir}` the live run directory or its archive path once cleanup item 8 archived it. The CLI reads the PR recorded in `run-state.json` through `bin/pr-merge-state.js`, and prints one JSON line `{route, branch, state, reason}`.
- **Should feel:** like it knows which PR is its own even after cleanup tore the worktree down.
- **Should understand:**
  - The route is `current-branch` or `evidence-pr`, and Step 4 routes on `route` alone.
  - The rules live in `decideEvidenceRoute` in `plugin/bin/lib/wrap-up/evidence-route.js` (the CLI's `--help` lists the vocabularies), not in Step 4's prose. A non-zero exit, or output that does not parse as that line, takes the evidence-PR route.
  - The branch's PR is only the fallback, for when no run directory resolves or none was recorded.
- **Red flags:**
  - The check reads `main`'s state because the session is back in the main checkout.
  - The log call targets a `$PIPELINE_RUN_DIR` that item 8 has already archived (exit 3).

### 2. The integration-branch guard picks the route
- **URL:** `bin/evidence-route.js`'s integration-branch guard (rules in `plugin/bin/lib/wrap-up/evidence-route.js`)
- **Action:** the session is on `{integration-branch}`, in a detached HEAD, or outside the worktree that `run-state.json` records. So the CLI prints `evidence-pr`, whatever the PR read said.
- **Should feel:** safe by construction, with no push to `main` whatever the read said.
- **Should understand:** an open run PR only takes the commit-and-push route when the session is actually on the run's own branch. If that push fails, the brief goes out without embedded screenshots and says why. A branch name carrying `$`, quotes or a backtick also takes the evidence-PR route, so the name never reaches a command. With no `worktree` recorded (a standalone wrap-up), the run's own branch is the current branch itself, still under the guard.
- **Red flags:** a `no-pr` result on `main` treated as "commit and push"; an in-place `git switch` in the shared main checkout; a branch name carrying `$` or a backtick pasted into a git command.

### 3. The evidence lands through its own PR
- **URL:** Step 4's `evidence-pr` bullet → `_shared/scratch-worktree.md` §2–§3, residue-sweep's `pr-first` landing shape
- **Action:**
  - A scratch worktree on `demo-evidence/{record}` is cut from the freshly fetched `origin/{integration-branch}`, taking the first free `-2`/`-3` suffix if the name is taken.
  - The screenshots are staged with `git add docs/demo-evidence/{record}/` and committed with a pathspec.
  - The commit is pushed, and an evidence-only PR is opened with `gh pr create`, or `mcp__github__create_pull_request` when `gh` is absent.
- **Should feel:** like a small, obviously harmless PR waiting for a human click.
- **Should understand:**
  - The PR body says `Refs #{record}` and never `Fixes`, `Closes` or `Resolves`, because the record's closure belongs to its original PR.
  - It is left open for a human and never auto-merged.
  - The embed uses this evidence commit's SHA.
  - The scratch worktree is torn down with `discard_changes: true` only after `git ls-remote` shows the SHA on `origin`.
  - If provisioning, the commit or the push fails, nothing reached `origin`: the brief goes out without embedded screenshots and says why, and the worktree is torn down. When the teardown's ancestry check refuses an unpushed commit, the worktree is kept and its path named in the brief and the summary.
  - If the push succeeded but the PR create failed, the embeds stay. The brief and the summary name the pushed branch and the failure in place of the PR link, for a human to open the PR.
  - If `git ls-remote` does not return the recorded SHA, the worktree is never discarded: it is kept and its path named in the brief and the summary.
- **Red flags:**
  - Unrelated Phase 4 edits in the evidence PR.
  - A closing keyword that closes the record a second time.
  - Screenshots silently missing from the brief without a sentence saying why.
  - A scratch worktree discarded without the ls-remote proof, or a pushed `demo-evidence/` branch with no PR that the summary never mentions.

### 4. A gh-absent sandbox doesn't open a second PR for nothing
- **URL:** `bin/evidence-route.js`'s unreadable-state rule
- **Action:** with `gh` absent, the PR read reports `gh-absent`.
- **Should feel:** no surprise PR on an ordinary in-run wrap-up.
- **Should understand:** the CLI treats the PR as open only when it was called with `--in-run`, the console left the PR open (`--leave-open`, or `merge.resolution: leave-open`), and the session is on the run's branch. Any other unreadable case takes the evidence-PR route.
- **Red flags:** every UI record in a cloud sandbox getting a second PR; an unreadable state that commits blind.

### 5. The summary says where the evidence went
- **URL:** the brief (one line under the screenshots) and `summary-template.md`'s Actions Performed row
- **Action:** the maintainer reads the wrap-up summary.
- **Should feel:** informed, with nothing to go hunting for.
- **Should understand:** an `Operational` row reads "Opened evidence PR #{m} ({url}) for #{n}'s demo screenshots — the run's own branch was not a safe home ({merged | closed | unavailable})". The routing is also logged to `decisions.md`.
- **Red flags:** an evidence PR that only shows up in `gh pr list`.

## Origin
- Created during build of #4039 (verification-brief evidence routing). Filed from a consumer project where a late acceptance-labeling re-run committed screenshots onto an already-merged branch, and the evidence needed a hand-made follow-up PR. #4039's whole-branch review also found that cleanup item 4 runs before Acceptance labeling, so Step 4 can run from the main checkout.
- Updated during build of #4125. Step 4's route decision moved from prose into `bin/evidence-route.js`, a pure, unit-tested rule module behind a CLI. Every defect #4039's review found had been in that prose decision, which the phrase-pinning conformance test could not catch.
