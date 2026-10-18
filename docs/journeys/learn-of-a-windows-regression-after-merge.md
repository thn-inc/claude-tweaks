---
files:
  - .github/workflows/windows-regression.yml
  - tools/windows-regression/file-issue.js
  - plugin/bin/lib/verify/extract.js
  - tools/run-tests.js
  - plugin/bin/verify.js
---

# Learn of a Windows Regression After Merge

**Persona:** claude-tweaks maintainer who develops on macOS, merges PRs gated only by the ubuntu `test` check, and has users installing the plugin on Windows.
**Goal:** Find out — without running anything on Windows and without slowing any PR — when a merge breaks a test only on a Windows checkout (a hard-coded `/` path, CRLF line endings, a `.cmd` launcher), and which PR did it.
**Entry point:** Merging a PR to `main` (or any direct push to `main`); nothing to invoke.
**Success state:** Either the `windows-regression` run on that commit goes green, or exactly one `type:bug` issue titled `Windows regression: {N} test file(s) newly failing after {sha}` names the newly failing files, the merged PR, and the run (or a comment on the open issue already covering it). When the report itself is missing or unreadable, the issue is instead titled `Windows regression: no verify report for {sha} (not adjudicated)`: that commit was never evaluated, and the next push compares against it. A red run with nothing filed means `gh` failed — the `file` job's log says so.

## Steps

### 1. Merge as usual — GitHub UI or `gh pr merge`
- **Action:** Merge the PR. The PR's own checks are unchanged — `windows-regression` never runs on `pull_request`, so the merge gate does not wait on a Windows job.
- **Should feel:** Invisible — no new check to wait for, no extra click.
- **Red flags:** A `windows-regression` check appearing on the PR, or the merge waiting on it.

### 2. The Windows run starts on the merge commit — Actions tab, `gh run list --workflow windows-regression.yml`
- **Action:** Nothing. The push to `main` starts one run per commit (concurrency keyed on the sha, never cancelled), comparing against the push's previous `main` tip.
- **Should feel:** Like background monitoring — a run you can look at, not one you have to.
- **Should understand:** The run's "Resolve the comparison base" step prints which commit it compares against and why (push event before, or the `HEAD^1` fallback). A clean run takes about 17 minutes. The `windows` job is capped at 90 minutes and every per-file baseline run at 20 (`--cmd-timeout`), so a hung test file ends as a named timeout, not a run that never finishes.
- **Red flags:** A skipped commit (no run for a merged sha); `npm test` dying before any test runs (`ENAMETOOLONG` — the runner must pass root globs on Windows); the `windows` job cancelled at its 90-minute limit, which uploads no report and files a "no verify report" issue instead of a verdict.

### 3a. Green — nothing new broke on Windows
- **Action:** None. A raw pass, or failures that also fail on the base commit or pass in isolation (baseline-adjudicated), end green and file nothing.
- **Should feel:** Quiet. Pre-existing Windows failures do not page you on every merge.
- **Should understand:** Green or red is `verify.js`'s own verdict, recorded as `effectivePass` in `report.json`; the filer never re-derives it, and a report without that field counts only a raw pass.
- **Red flags:** An issue filed for a failure that also fails on the base commit.

### 3b. Red — one issue names what broke
- **Action:** Open the `type:bug` issue the `file` job created, or the comment it added to the open issue already naming this commit (a "(not adjudicated)" run comments on any open "(not adjudicated)" issue).
- **Should feel:** Actionable at a glance — which test files, which PR, where the log is — without opening the run.
- **Should understand:** Every attributable file is listed first, marked `(timed out — no evidence)` when its per-file run hit the timeout. Then each gets an excerpt of at most 12 lines. It starts at the file's `not ok` line (the failing test's name and assertion), or, for a file that crashed before its tests ran, at the stderr printed above that `not ok`. The body is capped at 60,000 characters, so a long one loses excerpts, never file names. The PR is the one merged with that commit, or "unknown". A "(not adjudicated)" title means the baseline comparison could not run, refused, or named no file, so the run failed closed with the raw failing output.
- **Red flags:** Two issues for one sha; an excerpt that omits the failing test's name; an excerpt that opens on another file's failing test instead of this file's own failure or stderr; an issue filed from a non-`main` ref; a red run with no issue and no comment.

### 4. Route it like any defect — `/claude-tweaks:specify #{issue}`
- **Action:** The issue carries `type:bug`, not `ready`, so it is shaped through `/claude-tweaks:specify` and built with `/claude-tweaks:flow`.
- **Should feel:** Like any other bug in the queue — no special Windows process.
- **Red flags:** The issue arriving labelled `ready` (it would skip shaping).

## Origin

Record #3316 — post-merge Windows regression guard (PR #3390). Record #3404 — excerpts now read TAP structure from verify's shared `tapLines` classifier (`plugin/bin/lib/verify/extract.js`) instead of the filer's own boundary rules.
