### Strengths
- The new sentence in `plugin/skills/_shared/github-pr-scan.md:91` is accurate. It names the cost the record describes: merged PRs fill the closed query's window, so an abandoned PR's stale branch can fall outside it. It also points to the existing cap row, which does fire when the window is full. The join block's cap check (`prs.length >= {resolved-limit}`, applied per state) backs that claim.
- The change is small and surgical: one sentence on one line. The second commit trims the wording to fit the composed-bundle Read rail rather than letting the prose grow.
- Deliverables 1 and 2 were already met at base by #4819 (`3999088908`). That commit removed the "mutually exclusive" claim, said `--state closed` also returns merged PRs, and added the de-duplicate-by-`number` sentence plus the `seen` set in the join block. This branch does not redo or contradict that work.

### Issues

#### Critical (Must Fix)
None

#### Important (Should Fix)
1. **The record's real problem is documented but not fixed, and the Release Note overclaims.** (`plugin/skills/_shared/github-pr-scan.md:91`, and the queries just below it)
   - **What's wrong:** The record names a second cost: closed-without-merge PRs get about 3 of 50 window slots, so abandoned branches drop out of view. Its Technical Approach recommends a single `--json number,headRefName,mergedAt` query split locally, which "widens the closed-unmerged window instead of shrinking it". The branch keeps both queries unchanged and only adds a sentence admitting the limitation. The record's Release Note says Tidy "finds stale branches from abandoned PRs more reliably". After this diff, detection is no more reliable than before.
   - **Why it matters:** A user reading the changelog would expect better abandoned-branch detection and won't get it. The cap row will also keep firing on every run in any repo with more merged PRs than `{resolved-limit}` (this repo has thousands), so the "full window" signal carries almost no information.
   - **How to fix:** Pick one:
     - (a) Preferred: make the closed query select unmerged PRs directly, for example `gh pr list --state closed --search "is:unmerged" --limit {resolved-limit} --json number,headRefName`. That gives abandoned PRs the full window and keeps coverage at least as wide as today (Deliverable 3). Per AC 3, run it against this repo and quote its count in the PR. Then reword line 91: the overlap is excluded by the query's shape, so the dedupe stays only as a guard.
     - (b) Keep the current shape, but change the Release Note so it no longer promises better detection.

   Either way, Deliverable 2 requires the plan to record which option was chosen and why the other lost. Neither the diff nor the commit messages do this.
2. **The closed query's stated purpose was dropped.** (`plugin/skills/_shared/github-pr-scan.md:91`)
   - **What's wrong:** The first commit removed the clause "and the closed query covers PRs closed without merging". The sentence "both queries are still needed — …" now justifies only the merged query. Why the closed query exists is left for the reader to infer from the next sentence.
   - **Why it matters:** This is executable `_shared` prose, and an agent following it gets a weaker reason to keep the second query. That matters because a later "simplify" pass could drop it.
   - **How to fix:** Restore a short purpose clause, for example "…window; the closed query is what reaches PRs closed without merging." If the rail budget is tight, fold it into the new sentence instead.

#### Minor (Nice to Have)
1. **Garbled commit subject.** `220b134102`'s subject ends in "— refs — refs #3905", which duplicates the "refs" marker. Fix it when the PR is squash-merged.

### Recommendations
- Option (a) above is the record's own recommended shape, and it makes the window note unnecessary. The change stays confined to the two `gh pr list` lines and one prose sentence. The join block's `seen` dedupe and per-state cap row work unchanged.
- The MCP-transport degrade note (record's Gotchas) is unaffected by the current diff. If the query changes to use `--search`, re-check that the degrade wording still describes what the MCP path can and can't do.

Declined to judge:
- The join block labels a PR found in both lists as "merged" because the merged list is processed first. This was not changed by this diff, and it is outside the record's deliverables.
- Whether the trimmed line fits the composed-bundle Read rail. I was told not to run the test suite, so the AC 4 (`npm test`) pass is unverified here.
- AC 3's live command run and quoted count. It only applies if the query shape changes, which it did not.

### Assessment

**Ready to merge?** With fixes

**Reasoning:** The edit is accurate and harmless. Deliverables 1–2 were already met at base by #4819, and this branch only documents the window cost. But it leaves that cost in place while the record's Release Note promises better abandoned-branch detection, and it never records why the single-query option was rejected. Either change the closed query to select unmerged PRs, or align the Release Note and record the decision.

DONE_WITH_CONCERNS
