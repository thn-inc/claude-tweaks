---
files:
  - plugin/skills/review/code-mode-steps.md
  - plugin/skills/review/merge-provenance-check.md
---

# Keep Every Merged Change in the Release Review

**Persona:** a maintainer cutting a release whose range holds PRs that reached `main` through `--no-ff` merge commits, relying on `/claude-tweaks:release`'s whole-branch review as the gate before the bump.
**Goal:** every path that ships in the release is reviewed, and a branch review names an exclusion only for content that really arrived from the integration branch.
**Entry point:** `/claude-tweaks:review base:{ref}`, which `/claude-tweaks:release` Step 3 invokes; or `/claude-tweaks:review #{n}` on a branch that merged the integration branch mid-history.
**Success state:** a `base:{ref}` review's scope is the whole `git diff {base}...{branch}` file list with no exclusion section, and a branch review's "arrived via merge" count lists only files whose content matches the integration branch at the fork point.

## Steps

### 1. Run the release gate — merges in the range stay in scope
- **URL:** Step 2, `code-mode-steps.md`'s Merge-Provenance Check, its `base:{ref}` bullet
- **Action:** the maintainer runs `/claude-tweaks:review base:v1.2.0`. The range holds merge commits, and the check counts it as no merge commits detected, in every later step that asks.
- **Should feel:** uneventful. Nothing to reason about, and no exclusion count to audit in the summary.
- **Should understand:** `{ref}` is a fixed point on the integration branch, so a merge in the range is how a PR shipped. `merge-provenance-check.md` is never read on this scope.
- **Red flags:** a Step 7 line reading "arrived via merge from v1.2.0"; a lens scope smaller than `git diff {base}...{branch} --name-only`; a PR merged with `--no-ff` missing from the review.

### 2. Review a caught-up branch — only integration content is set aside
- **URL:** Step 2, `merge-provenance-check.md`'s Excluded files bullet
- **Action:** the maintainer reviews a branch with a fixed base that merged the integration branch mid-history. The check compares each full-diff file at `{fork}` and at `{branch}`, and reports the ones with no difference.
- **Should feel:** trustworthy. The excluded count is short, and each file listed really came from the integration branch.
- **Should understand:** a file the branch also changed stays in scope, and so does a merge commit's own edit, even on a file the integration branch touched. Another branch merged in ships with this one, so it stays in scope as well.
- **Red flags:** a file the branch edited listed under "arrived via merge"; a merged-in feature branch's files missing from the review; an "arrived via merge" section on a review of the integration branch itself.

### 3. Review the integration branch itself — nothing is excluded
- **URL:** Step 2, `merge-provenance-check.md`'s opening resolve sentence and its Nothing is excluded bullet
- **Action:** the maintainer runs a no-argument `/claude-tweaks:review` on `main` after pulling, so `{branch}` is `HEAD` with `main` checked out and the range holds merges. The check skips before running a command. On a branch that only extends the integration line, with no merge of it, the `git rev-list` line prints `{fork}` and nothing is excluded there either.
- **Should feel:** the same as step 1: no exclusion section, and every path reviewed.
- **Should understand:** an exclusion needs positive evidence. With no fork point, no `origin` ref, or an error on the `git rev-list` line, the raw `git diff` scope stands. Over-including is the safe direction, since a wrong exclusion silently drops shipping work from review.
- **Red flags:** a teammate's merged file reported as "arrived via merge" on `main`; review scope shrinking on a project with no `origin` remote.

## Origin
- Created during build of #4639. The v6.157.0 release-gate review found that the first-parent rule read "absent from the first-parent walk" as "arrived from {base}", though a tag base never merges in. On `v6.156.3...3470ac15c` it dropped 80 of 294 paths, 77 of them outside run directories. Two scoped reviews during this build found the same symptom on branch scopes, which is why the rule now rests on content at the fork point.
- Related journeys: `release-a-version.md` (its review step is this journey's entry point), `review-a-large-change-at-its-diff-tier-4221.md` (the tier that review then runs at).
