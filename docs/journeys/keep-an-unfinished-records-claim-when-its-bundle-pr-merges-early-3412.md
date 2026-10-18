---
files:
  - plugin/bin/lib/reconcile/release-merged.js
  - plugin/bin/lib/reconcile/pr-state.js
---

# Keep an Unfinished Record's Claim When Its Bundle PR Merges Early

**Persona:** Maintainer of a `pr-first` claude-tweaks repo who, mid-way through a multi-record `/claude-tweaks:flow` run, decides the finished records should ship now and merges the run's PR while the last record is still building in its worktree (the 2026-10-17 PR #3348 / #3311 shape).
**Goal:** The shipped records close and release normally; the unfinished record keeps its claim and its `bot:in-progress`/`auto:build` labels so the owning session can finish it, and the claim later exits through the ordinary issue-closed or TTL path rather than being dropped the second the PR merges.
**Entry point:** `gh pr merge --squash` on the run's PR (or `/claude-tweaks:wrap-up`'s merge step), with the PR body's `Fixes #{unfinished}` already edited to `Refs #{unfinished}` and the squash body carrying `Fixes` lines only for the finished records.
**Success state:** The next reconcile pass (session start's background sweep, or `/claude-tweaks:tidy`) reports the unfinished record as skipped with reason `pr-merged-not-closing`, its labels untouched; the finished records release with `merged: reconciled from PR #{n}`; nothing about the unfinished record changes until its issue is actually closed. The maintainer should feel that an early merge is safe to order.

## Steps

### 1. Merge the bundle PR early — `gh pr merge --squash {pr}`
- **URL:** `https://github.com/{owner}/{repo}/pull/{pr}`
- **Action:** The maintainer edits the PR body so the unfinished record's line reads `Refs #{n}` rather than `Fixes #{n}`, confirms the squash body carries `Fixes` lines only for the finished records, and merges. GitHub closes the finished records' issues from those lines and leaves `#{n}` open.
- **Should feel:** Deliberate but low-ceremony — one body edit, one merge, no need to warn the still-running session first.
- **Should understand:** GitHub's own closing signals (the PR's `closingIssuesReferences`, the merge commit's closing keywords) are exactly what the reconciler reads next; the `Refs` edit is what keeps `#{n}` out of both.
- **Red flags:** Having to pause or kill the owning session before merging; a `Fixes #{n}` line left in the squash body for a record that is not finished (GitHub would close it, and the reconciler would then rightly release it).

### 2. The reconciler's release check runs — `node plugin/bin/hooks.js reconcile-background` (session start) or a `/claude-tweaks:tidy` sweep
- **URL:** —
- **Action:** `releaseMerged` joins each live claim to its run's PR. For a MERGED PR it reads `closingIssuesReferences`; when those do not name the claim's issue it fetches the merge commit message once (`gh api repos/{slug}/commits/{oid} -q .commit.message`) and scans it for a line-anchored closing keyword followed by `#{n}`. Only a `true` verdict releases on merged evidence; `false` keeps the claim; a PR state with no references list at all is treated as unknown and also keeps it.
- **Should feel:** Invisible — the sweep costs one extra API call per merged-but-undecided record and nothing on the common path where the references already name the issue.
- **Should understand:** "Merged" and "closes this record" are different facts; the reconciler now acts on the second, and a failed or malformed read resolves to keep, never to release.
- **Red flags:** A release logged for `#{n}` with reason `merged: reconciled from PR #{pr}` while the PR's closing references and merge commit name only its siblings; a sweep that stalls on a huge merge-commit message.

### 3. Read the reconcile report — next session start's "background reconcile" summary, or the tidy report's converge section
- **URL:** —
- **Action:** The maintainer reads the per-record outcome: finished records released `merged: reconciled from PR #{pr}` with grants stripped; `#{n}` listed under skipped with `pr-merged-not-closing` (or `pr-merged-closing-unknown` when `gh` returned no `closingIssuesReferences` field), its `bot:in-progress` and `auto:build` labels still present on the issue.
- **Should feel:** Reassuring — the skip reason says why the record was kept, and the owning session's work is untouched.
- **Should understand:** The kept claim is not stuck: it will release on the normal `issue-closed` path once `#{n}` closes (a later PR's `Fixes #{n}`, or a manual close), or on the claim TTL path if nothing ever closes it.
- **Red flags:** `#{n}` missing from both released and skipped (silently dropped); a skip reason that misnames the cause; grant labels gone from an issue whose claim was reported kept.

### 4. The unfinished record finishes and closes — a later `Fixes #{n}` merge or `gh issue close {n}`
- **URL:** `https://github.com/{owner}/{repo}/issues/{n}`
- **Action:** The owning session finishes the record and its own PR merges with `Fixes #{n}` (or the maintainer closes the issue by hand). On the next sweep the claim's PR is still the old MERGED-not-closing one, so `releaseMerged` fetches the issue state, finds it CLOSED, and releases with reason `issue-closed: reconciled from #{n}` — removing `bot:in-progress` only, since grant stripping stays reserved for the `merged:` reason.
- **Should feel:** Like nothing special happened — the record's lifecycle ended the same way any record's does when its issue closes.
- **Should understand:** The issue-state fetch is what makes this exit possible for the merged-not-closing shape; it runs for every merged PR whose verdict was not `true`.
- **Red flags:** A claim that stays live after its issue has been closed for more than one sweep; `auto:build` stripped on the issue-closed path.

## Origin
- Created during build of #3412 (Reconciler releases a run's unfinished record when the run's PR merges without closing it)
- Steps 1-4 built in this session
- Related specs: #3348 / #3311 (the incident), #3249 (fast-lane merged runs still release when their PR closes the record — unchanged), #3416 (archive-merged's own timing, out of scope here)
