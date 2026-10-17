---
files:
  - .github/workflows/windows-regression.yml
  - tools/windows-regression/file-issue.js
  - tools/run-tests.js
---

# Learn of a Windows Regression After Merge

**Persona:** claude-tweaks maintainer who develops on macOS, merges PRs gated only by the ubuntu `test` check, and has users installing the plugin on Windows.
**Goal:** Find out — without running anything on Windows and without slowing any PR — when a merge breaks a test only on a Windows checkout (a hard-coded `/` path, CRLF line endings, a `.cmd` launcher), and which PR did it.
**Entry point:** Merging a PR to `main` (or any direct push to `main`); nothing to invoke.
**Success state:** Either the `windows-regression` run on that commit goes green, or exactly one `type:bug` issue titled `Windows regression: {N} test file(s) newly failing after {sha}` names the newly failing files, the merged PR, and the run.

## Steps

### 1. Merge as usual — GitHub UI or `gh pr merge`
- **Action:** Merge the PR. The PR's own checks are unchanged — `windows-regression` never runs on `pull_request`, so the merge gate does not wait on a Windows job.
- **Should feel:** Invisible — no new check to wait for, no extra click.
- **Red flags:** A `windows-regression` check appearing on the PR, or the merge waiting on it.

### 2. The Windows run starts on the merge commit — Actions tab, `gh run list --workflow windows-regression.yml`
- **Action:** Nothing. The push to `main` starts one run per commit (concurrency keyed on the sha, never cancelled), comparing against the push's previous `main` tip.
- **Should feel:** Like background monitoring — a run you can look at, not one you have to.
- **Should understand:** The run's "Resolve the comparison base" step prints which commit it compares against and why (push event before, or the `HEAD^1` fallback).
- **Red flags:** A skipped commit (no run for a merged sha); `npm test` dying before any test runs (`ENAMETOOLONG` — the runner must pass root globs on Windows).

### 3a. Green — nothing new broke on Windows
- **Action:** None. A raw pass, or failures that also fail on the base commit or pass in isolation (baseline-adjudicated), end green and file nothing.
- **Should feel:** Quiet. Pre-existing Windows failures do not page you on every merge.
- **Red flags:** An issue filed for a failure that also fails on the base commit.

### 3b. Red — one issue names what broke
- **Action:** Open the `type:bug` issue the `file` job created (or the comment it added to the open issue for the same sha).
- **Should feel:** Actionable at a glance — which test files, which PR, where the log is — without opening the run.
- **Should understand:** Each attributable file is listed with an excerpt starting at its `not ok` line (the failing test's name and assertion); the PR is the one merged with that commit, or "unknown"; a "(not adjudicated)" title means the baseline comparison could not run and the run failed closed.
- **Red flags:** Two issues for one sha; an excerpt that omits the failing test's name; an issue filed from a non-`main` ref.

### 4. Route it like any defect — `/claude-tweaks:specify #{issue}`
- **Action:** The issue carries `type:bug`, not `ready`, so it is shaped through `/claude-tweaks:specify` and built with `/claude-tweaks:flow`.
- **Should feel:** Like any other bug in the queue — no special Windows process.
- **Red flags:** The issue arriving labelled `ready` (it would skip shaping).

## Origin

Record #3316 — post-merge Windows regression guard (PR #3390).
