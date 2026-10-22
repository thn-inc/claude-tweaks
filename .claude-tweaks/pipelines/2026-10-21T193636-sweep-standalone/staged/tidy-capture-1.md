# Staged: Capture — github-pr-scan repo-wide item 4's "mutually exclusive" premise is wrong

Finding: [pr] `gh pr list --state closed` also returns merged PRs. The Step 4.8 scan saw this directly: 47 of the 50 entries in the closed list were merged, e.g. #3891. So the note in `plugin/skills/_shared/github-pr-scan.md` repo-wide item 4 that treats the closed and merged lists as mutually exclusive does not hold. The scan currently survives only because it dedupes by PR number.
Proposed: capture a backlog record to correct the item 4 note, and to make the dedupe-by-number explicit or switch to --state merged/closed with a state filter.

## Commands
/claude-tweaks:capture github-pr-scan repo-wide item 4: gh pr list --state closed includes merged PRs; the mutually-exclusive note is wrong (seen 2026-10-21 sweep: 47/50 closed entries were merged)
