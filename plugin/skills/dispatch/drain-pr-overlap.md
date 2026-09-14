# Dispatch — Drain's Own In-Flight PR Overlap (refs #1985)

Referenced by `skills/dispatch/SKILL.md` Step 4 (the re-check, before minting) and Step 5 (the
list write, after a call returns). Extracted from `SKILL.md` to keep it under the 40 KB ceiling
(`[IL-153]`). Read both sections below together — the list Step 5 writes is exactly what Step 4's
re-check reads.

Background and the two invocation sites' relationship to Step 3's own (unchanged) pre-drain
report: `cross-pr-overlap-report.md`'s "Second and third invocation" section, this skill's
directory.

## Step 5 — record this group's own PR into the firing's drain-PR list

Once a call returns with one recorded: after each group's first Task call returns, read that
group's `run-state.json` `pr.number` (recorded there once the call opens its draft PR, per
`_shared/pr-early-run-lifecycle.md`) — or, when the first call didn't open one (a degraded
PR-early lifecycle, or `local-merge`), check again after the second call. When a PR number is
found, run exactly one `gh pr view {n} --json number,files,closingIssuesReferences` and append
`{number, files: [changed paths], closingIssueNumbers: [...]}` to this firing's session-scoped
`dispatch-drain-prs.json` (`_shared/session-tmp-root.md`) — one `gh pr view` per dispatched group
that opened a PR, never a repeated `gh pr list`. This is the list Step 4's own re-check (below)
reads for every group dispatched after this one. When no PR number is found on either call (a
group that opened no PR at all), log once — `AUTO {time} — Step 5: group [{issues}] opened no PR
this firing; drain-PR overlap re-check has a gap for it. Reversibility: n/a.` — so a silent
coverage gap is visible rather than assumed clean.

## Step 4 — re-check against the drain's own in-flight PRs, for every group after the first

Step 3's Cross-PR root-cause overlap report only ever saw the *pre-drain* snapshot
(`dispatch-open-prs.json`, fetched once at Step 2) — a PR this same drain opened for an earlier
group in this firing is invisible to it, since it didn't exist yet when that report ran. Before
minting, re-run `bin/lib/issues/grouping.js`'s `detectCrossPRFileOverlap` for this group alone
against the union of that pre-drain snapshot and this firing's own `dispatch-drain-prs.json`
(Step 5's own write, above — empty/absent on the first group dispatched this firing, so this
re-check is a no-op then). Tag every entry read from `dispatch-drain-prs.json` with
`source: 'drain'` before the union (the same field `detectCrossPRFileOverlap` now carries onto a
matching overlap additively, #1985) so a hit against this firing's own PR is distinguishable from
a hit against the pre-drain snapshot. For every hit whose `source === 'drain'`, render
`cross-pr-overlap-report.md`'s warning line with the suffix `(opened by this drain, group {k})` —
`{k}` is the 1-indexed position of the earlier group whose PR this one overlaps, read off
`dispatch-drain-prs.json`'s own append order — and log:

```
STAGED {time} — dispatch: group [{issues}] overlaps drain PR #{pr} on {files}; dispatched anyway,
serialize before merge. Reversibility: n/a.
```

Still a warning, never a gate — the group dispatches regardless. A hit against the pre-drain
snapshot (no `source`) is already covered by Step 3's report and is not re-logged here.

## Step 6 (Auto-merge gate) — hold on a still-open drain overlap, before merge-check

Referenced by `settle-and-merge.md`'s Auto-merge gate section, before its two-layer
Authorization/Content-judgment check. Re-run `bin/lib/issues/grouping.js`'s
`detectCrossPRFileOverlap` for this group's own PR against this firing's own
`dispatch-drain-prs.json` (Step 5 above) — the same union Step 4's mint-time re-check already
read, evaluated fresh here because a PR opened by an earlier group in this drain may have merged,
closed, or newly opened in the time since. Any hit whose overlapping drain PR is **still open**
holds this group back from the merge decision entirely: fall back to the normal Review Console
for this group (skip Authorization and Content judgment — there is no point evaluating a merge
this gate is about to defer anyway) and log:

```
AUTO {time} — Auto-merge gate: group [{issues}] held — overlaps drain PR #{pr} on {files}; merge
order is a human call. Reversibility: n/a.
```

This check re-reads the overlapping PR's *current* state every time it runs — it is not a
persisted hold — so once that PR has merged or closed, the next evaluation of this gate (a later
firing, or a retry) finds no live overlap and proceeds normally through Authorization and Content
judgment. No hit, or a hit only against a PR that has already merged/closed: proceed to
Authorization immediately, unaffected.
