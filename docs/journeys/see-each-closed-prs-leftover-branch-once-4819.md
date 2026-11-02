---
files:
  - plugin/skills/_shared/github-pr-scan.md
---

# See Each Closed PR's Leftover Branch Once

**Persona:** a maintainer of a GitHub-backed project who runs `/claude-tweaks:tidy` to clear out local branches whose PRs have already merged or been closed, and reads its findings list to decide what to delete.
**Goal:** get exactly one finding per merged or closed PR that still has a local branch, so the count of cleanup rows matches the number of leftover branches.
**Entry point:** `/claude-tweaks:tidy` Step 4.8, `_shared/github-pr-scan.md` `repo-wide` item 4 (Merged/closed PRs with local remnants).
**Success state:** a merged PR whose local branch survives appears once among the remnant findings, even though both the merged query and the closed query returned it. A PR closed without merging still appears once, from the closed query.

## Steps

### 1. /tidy lists merged and closed PRs
- **URL:** `plugin/skills/_shared/github-pr-scan.md` `repo-wide` item 4
- **Action:** Run `/claude-tweaks:tidy`. Item 4 runs `gh pr list --state merged --limit 50 --json number,headRefName` and `gh pr list --state closed --limit 50 --json number,headRefName`.
- **Should feel:** Complete without being noisy. Both windows are covered, and neither one is counted twice.
- **Should understand:** `--state closed` returns merged PRs as well as PRs closed without merging, so the two results overlap. The merged query is kept because it reaches merged PRs beyond the closed query's 50-PR window.
- **Red flags:** Item 4's text claims the two states never overlap; only one of the two queries runs, so either merged PRs past the closed window or closed-unmerged PRs are missed.

### 2. /tidy cross-checks each PR's branch against local branches
- **URL:** `plugin/skills/_shared/github-pr-scan.md` `repo-wide` item 4, and the Severity mapping's `Merged/closed PR with local branch/worktree remnants` row
- **Action:** The scan de-duplicates the union of both results by `number`, then checks each `headRefName` against `git -C "{REPO_ROOT}" branch --list` output.
- **Should feel:** One row per leftover branch. A maintainer can count the findings and know how many branches to delete.
- **Should understand:** The de-duplication runs before the cross-check, so a PR in both results is one candidate and yields at most one `medium`-severity finding.
- **Red flags:** The same PR number appears twice among the remnant findings. The remnant count is larger than the number of matching local branches.

## Origin
- Created during `/claude-tweaks:build` of record #4819 (2026-11-02): item 4 used to claim GitHub's PR states were mutually exclusive, so a merged PR returned by both queries (PR #1218 in the sweep that filed the record) was counted twice. The item now de-duplicates by PR number.
- Related: `docs/journeys/see-a-partly-reported-ci-run-as-pending-3658.md` (the same scan's `repo-wide` item 1).
