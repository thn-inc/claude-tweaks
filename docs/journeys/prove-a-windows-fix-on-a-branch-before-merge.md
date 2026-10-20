---
files:
  - .github/workflows/windows-regression.yml
  - plugin/bin/verify.js
  - tools/windows-regression/file-issue.js
---

# Prove a Windows Fix on a Branch Before Merge

**Persona:** A claude-tweaks maintainer, or a `/claude-tweaks:flow` build agent, who is fixing a test that only fails on a Windows checkout. They work on macOS. The record's acceptance criteria require a real `windows-latest` run on the feature branch before merge, and a `path.win32` or CRLF simulation does not count.
**Goal:** Run the Windows guard against the feature branch and get a verdict that says whether the branch's tests pass on Windows. The verdict must not be skewed by the branch's own earlier commits.
**Entry point:** `gh workflow run windows-regression.yml --ref {branch}`.
**Success state:** The run's "Resolve the comparison base" step names the merge-base with `origin/main` as its base, so a test the branch fixed still fails at base and passes at HEAD. A green verdict then means the branch fixed it. A non-`main` ref never files an issue. On a failing run the filer prints `fail on {ref} — not filing (main only)` and exits 1.

## Steps

### 1. Dispatch the workflow on the branch — `gh workflow run windows-regression.yml --ref {branch}`
- **Action:** Push the branch, then dispatch the workflow against it. Find the run with `gh run list --workflow windows-regression.yml --branch {branch}`.
- **Should feel:** Like an ordinary CI trigger: one command, and a run you can watch.
- **Should understand:** The run takes about as long as a post-merge run, roughly 17 minutes, and it never opens or comments on an issue for a non-`main` ref.
- **Red flags:** The dispatch is rejected because the branch was never pushed, or the run starts against `main` instead of `{branch}`.

### 2. Read which commit the run compared against — the `windows` job's "Resolve the comparison base" step
- **Action:** Open the step log and read the `Comparison base: {sha} ({source})` line.
- **Should feel:** Unambiguous. The source in parentheses says which base was chosen and why.
- **Should understand:** A dispatch on a feature branch reads `merge-base with origin/main`, so the base is the tip of `main` that the branch forked from, before any of the branch's own commits. The only time a dispatch reads `HEAD^1 fallback` is when it runs on `main` itself (the merge-base would be HEAD) or when `origin/main` cannot be resolved.
- **Red flags:** A feature-branch dispatch that reads `HEAD^1 fallback`. That base is the branch's previous commit, so if the fix sits in an earlier commit of the same branch, the verdict compares the fix against itself and proves nothing (#3568).

### 3. Read the verdict and the per-file evidence — the `verify-report` artifact
- **Action:** Download it with `gh run download {id} -n verify-report`. Check the fixed test file in `verify-report.json` and in its log under `verify-logs/`.
- **Should feel:** Like evidence you can quote into the PR, not a green badge you have to take on trust.
- **Should understand:** A test that fails at base and passes at HEAD is the fix working. A failure that also fails at base is pre-existing and is adjudicated, not attributed to the branch.
- **Red flags:** The fixed file shows up as baseline-adjudicated "pass" while its log still shows failures. That means the base already contained the fix, and step 2's source line will say why.

## Origin
- Created during the build of record #3568, which changed `workflow_dispatch` runs to baseline against the merge-base with the integration branch instead of `HEAD^1`.
- Related records: #3316 (the guard itself), #3517, #3518, #3523 (Windows fixes whose acceptance criteria require this dispatch).
