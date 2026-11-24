---
files:
  - plugin/skills/_shared/github-pr-scan.md
---

# See Each Closed PR's Leftover Branch Once

**Persona:** a maintainer of a GitHub-backed project who runs `/claude-tweaks:tidy` to clear out local branches whose PRs have already merged or been closed, and reads its findings list to decide what to delete.
**Goal:** get exactly one finding per merged or closed PR that still has a local branch, so the count of cleanup rows matches the number of leftover branches.
**Entry point:** `/claude-tweaks:tidy` Step 4.8, `_shared/github-pr-scan.md` `repo-wide` item 4 (Merged/closed PRs with local remnants).
**Success state:** a merged PR whose local branch survives appears once among the remnant findings, from the merged query; the de-duplication by `number` would still hold it to one finding if both queries returned it. A PR closed without merging still appears once, from the closed query, whose window holds only PRs closed without merging.

## Steps

### 1. /tidy lists merged and closed PRs
- **URL:** `plugin/skills/_shared/github-pr-scan.md` `repo-wide` item 4
- **Action:** Run `/claude-tweaks:tidy`. Item 4 runs `gh pr list --state merged --limit {resolved-limit} --json number,headRefName` and `gh pr list --state closed --search is:unmerged --limit {resolved-limit} --json number,headRefName`.
- **Should feel:** Complete without being noisy. Both windows are covered, and neither one is counted twice.
- **Should understand:** `--state closed` alone returns merged PRs as well as PRs closed without merging, and merged PRs filled most of its window, so the closed query adds `--search is:unmerged`. The merged query covers merged PRs.
- **Red flags:** Item 4's text claims the two states never overlap; only one of the two queries runs; the closed query drops `--search is:unmerged`, so merged PRs crowd PRs closed without merging out of its window.

### 2. /tidy cross-checks each PR's branch against local branches
- **URL:** `plugin/skills/_shared/github-pr-scan.md` `repo-wide` item 4, and the Severity mapping's `Merged/closed PR with local branch/worktree remnants` row
- **Action:** The join block de-duplicates the union of both results by `number`, then checks each `headRefName` against `git -C "{REPO_ROOT}" branch --list` output.
- **Should feel:** One row per leftover branch. A maintainer can count the findings and know how many branches to delete.
- **Should understand:** The de-duplication runs before the cross-check, so a PR in both results is one candidate and yields at most one `medium`-severity finding.
- **Red flags:** The same PR number appears twice among the remnant findings. The remnant count is larger than the number of matching local branches.

## Origin
- Created during `/claude-tweaks:build` of record #4819 (2026-11-02): item 4 used to claim GitHub's PR states were mutually exclusive, so a merged PR returned by both queries (PR #1218 in the sweep that filed the record) was counted twice. The item now de-duplicates by PR number.
- Updated during `/claude-tweaks:review` of record #3905 (2026-11-24): the closed query now excludes merged PRs, after a probe showed only 3 of its 50 rows were PRs closed without merging.
- Related: `docs/journeys/see-a-partly-reported-ci-run-as-pending-3658.md` (the same scan's `repo-wide` item 1).
