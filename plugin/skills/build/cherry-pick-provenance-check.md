# Cherry-Pick Source-Branch PR Check (#1957)

Referenced by `build/worktree-setup.md`'s "Cherry-pick source-branch PR check" heading — read
only in Common Step 2's per-commit loop, after a commit lands carrying a `(cherry picked from
commit {sha})` trailer; extracted to stay under the composed-bytes ceiling at that call site
(`context-cost.test.js`'s `worktree-setup @ build/SKILL.md` composed bundle, #2768).

Runs later than Steps 1.5/1.6 — in Common Step 2's per-commit loop, **after each commit lands**,
since it needs a commit to inspect. Extends Step 1.6 (guards this record's own branch name) to a
second shape: a build reusing *another* record's code via `git cherry-pick` without checking
whether that record's branch backs an open PR. #1821: a build cherry-picked a commit believing
its source branch abandoned, but that branch backed a still-open, review-passed PR — two open PRs
with byte-identical implementation, caught only by an off-lens manual review.

**Trigger — narrow by design.** `git cherry-pick -x <sha>` appends a
`(cherry picked from commit <sha>)` trailer; `cherry-pick` without `-x` does not. Only that
trailer is scanned for — a git-native, zero-false-positive signal. A manual port of code (hand
copy-pasted, or cherry-picked without `-x`) leaves no such trailer and is not caught by this
check — the same accepted-gap class Step 1.6 carries for its own remote-lookup failure; don't
imply broader coverage than this mechanism gives.

**Procedure**, via `plugin/bin/lib/worktree/cherry-pick-provenance.js`'s
`checkCherryPickProvenance({ message, ownBranch, repo })` (unit-tested,
`tests/bin-lib/worktree/cherry-pick-provenance.test.js`):

1. No trailer — nothing to do (an ordinary commit is never scanned further; no overhead on the
   common case).
2. Trailer found — resolve remote branches containing `{sha}` (`git branch -r --contains {sha}`),
   excluding this record's own branch. Multiple branches can come back — check every one.
3. Lookup fails (no network/`origin`) — **fail open**, Step 1.6's own posture: log the degrade
   distinctly and proceed, never treat "unreachable" as "no other branch."
4. No other branch contains `{sha}` — nothing to do.
5. Per candidate branch, check for an open PR: `gh pr list --repo {owner}/{repo} --head "{branch}"
   --state open --json number,url,isDraft`. A per-branch failure degrades that branch distinctly
   from "confirmed no open PR."
6. No open PR anywhere — nothing to do.
7. An open PR is found — render the stop card (`formatStopCard`), naming the commit, source
   branch(es), and PR number/URL:

   ```markdown
   ## Build: Cherry-picked commit reused from another record's open-PR branch

   Commit `{sha}` carries a `(cherry picked from commit {sha})` trailer. Its source commit is
   also reachable from: `{branch}` (open PR #{number} — {url}).

   Options: (1) stop and route to the existing PR (reuse/resume that prior work instead of
   duplicating it), (2) proceed anyway, explicitly choosing to duplicate the implementation
   (record this choice in `decisions.md`).
   ```

   **Interactive mode:** `AskUserQuestion` with these two options, recommending (1).
   **Auto mode:** same posture as Step 1.6 — this is **not** a lever
   `_shared/auto-mode-contract.md` lists as silenceable (no safe default: the build can't know
   whether the other PR's author abandoned it or is still working it). Render the card and
   **stop the build** before this commit's next step — the same HARD-GATE posture
   `flow/claim-targets.md` uses for a claim contest.

**Out of scope:** a review-time Cherry-Pick Provenance Check (none exists in
`plugin/skills/review/` — this is the earliest of at most two catch points) and #1944's
specify-time near-duplicate *record* detection (duplicate issue content, not duplicate code).
