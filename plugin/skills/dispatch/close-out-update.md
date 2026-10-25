# Dispatch — Close-out Update

Canonical procedure for `close-out.md`'s step 2 when a candidate PR is `DIRTY` (or `mergeable: CONFLICTING`) or `BEHIND`,
or a prior run's `{wt}` or pending update marker exists for it — read only then, except its **Update marker** section, which `close-out.md` step 2 reads for every candidate.
`_shared/github-pr-scan.md` item 11 flags a conflicting PR and never touches it because nobody is present to review a resolution;
close-out is human-present by construction (step 4's gate has no carve-out), so it can offer the update instead of only stopping.
The branch is already public behind its PR, so the update is a **merge** of `origin/{base}` — never a rebase, never a force-push
(`_shared/git-discipline.md`'s Rules and its "Catch-up (`auto`)" paragraph) — and the new HEAD is re-verified before anything is merged on it.

Values come from `gh pr view {number} --json headRefName,headRefOid,baseRefName` (`{head}`, `{base}`, the pre-update head).
`{main-checkout}` is the repository's main checkout root, where close-out runs; `{wt}` is the absolute `{main-checkout}/.worktrees/close-out-{number}` —
the git-fallback domain (`_shared/scratch-worktree.md` §2), never under `.claude/worktrees/`. Resolve both once and paste them as literals (§7), and double-quote every pasted path and ref (`{wt}`, `{main-checkout}`, `{head}`, `{base}`) in the commands below —
a checkout path may contain a space and a branch name may contain shell metacharacters.
One plain command per Bash call. Stops after step 2 tear down first (step 7). A command that fails outside the cases named below
stops the candidate (`stopped: update failed — command failed`) the same way.

**`gh` only.** `gh pr update-branch`, `gh run list` and `gh pr checks --watch` have no MCP mapping (`_shared/github-write-transport.md`'s "Pull requests are not covered by this mapping"),
and the update marker below is edited in place, which the MCP transport cannot do (`_shared/pr-run-comments.md`'s **MCP transport**).
When `command -v gh` exits non-zero, stop before step 1 offers anything (`stopped: update failed — gh absent`) — the PR is never touched.

**Update marker.** An update on GitHub is unverified until step 4's stamp and step 6's CI read pass on its head, and `{wt}` lives in one checkout,
so the pending state is kept on the PR: a `close-out-update` run comment (`_shared/pr-run-comments.md`'s Comment kinds), found, written and rewritten
by that file's Post-or-update procedure with `{kind}` = `close-out-update` and `{pr-number}` = `{number}`. Its body, marker first:

```text
<!-- run-comment: close-out-update -->
close-out-update: pending
update-method: {merge | gh pr update-branch}[, …]
conflicted-files: {comma-joined paths | none | unknown}
pre-update-head: {the values line's headRefOid}
resolution-commit: {full sha | pending}[, …]

While this reads `pending`, close-out has pushed an update to this PR whose head had not passed a full-suite verify and CI when it was written; a close-out run from any checkout re-verifies the head before the merge question.
```

Write it pending before each call that lands an update — `gh pr update-branch` in step 2, the push in step 5 — never after.
A marker covers every update since its last clear: an update on a PR whose marker is already pending appends its `update-method` and `resolution-commit` entries (oldest first), adds its paths to `conflicted-files`, and replaces `pre-update-head`, so an earlier agent-made resolution stays named until a verified merge or a decline clears it.
After each pending write, run Find again: a written marker it does not return (the writing account is not a trusted author) counts as a failed write.
**Read** it with that procedure's Find, then the `body` of the comment in the same payload whose `id` it returned: a second line `close-out-update: pending` is a pending marker, and `close-out-update: cleared (…)` or no trusted comment is none
(compare with trailing whitespace trimmed — an edit in the GitHub web UI can turn a line ending into CRLF);
any other second line is unreadable (`stopped: update failed — marker unreadable`), never none. A pending marker missing a field still routes to the resume, with that value `unknown`.
**Clear** it — a no-op when Find returns none (a `{wt}` from before the marker existed); else the second line rewritten to `close-out-update: cleared ({reason})`, the rest kept — only after `close-out.md` step 5's `merged`, a decline at its step 4 gate,
or a landing call that landed nothing (below); every other stop leaves it pending, so the next run, from any checkout, re-verifies first.
A failed Find or read stops the candidate (`stopped: update failed — marker unreadable`), and a failed pending write stops it before the landing call
(`stopped: update failed — marker not written`), nothing pushed — never that procedure's issue fallback, since only the PR is ever read.
A failed clear is reported and blocks nothing: a marker left pending costs one re-verify.
When a landing call fails, a call GitHub accepted can still land after it errors, so re-read `gh pr view {number} --json headRefOid` — up to 3 reads, a few seconds apart, each its own plain command:
the pre-update head on every read means nothing landed, so rewrite the marker to the body it had
before this run's write — or, when step 2 found no pending marker, clear it (`cleared (nothing landed)`); any other head on any read keeps it pending, entries included.

1. **Offer.** Skipped on a resume (step 2) unless step 2 sends it here. `AskUserQuestion`, `header`: `"Update PR"`, `multiSelect`: `false`.
   `DIRTY`: options `"Update from {base} (Recommended)"` / `"Stop"`. `BEHIND`: options `"Update from {base} (Recommended)"` / `"Skip update"`.
   On a resume step 2 sends here, `BEHIND` offers the same two options as `DIRTY`, and its `"Stop"` stops the candidate (`stopped: mergeStateStatus BEHIND — update declined`): the head is unverified and step 6 stops on `BEHIND`, so a skip could never reach the merge question.
   The question states what an update does: merges `origin/{base}` in, runs the full suite, pushes, and re-reads CI before the merge question —
   and that the new head may dismiss existing approvals on a repo that dismisses stale reviews, so the merge may end `armed`, not `merged`.
   Each option's `description` states its consequence in one clause: the update option merges the base into the PR branch, re-verifies, and pushes;
   `"Stop"` and `"Skip update"` leave the PR untouched, `"Stop"` ending this candidate and `"Skip update"` continuing to the merge question.
   Declining touches nothing — the PR stays exactly as it was.
   `DIRTY` then stops the candidate (`stopped: mergeStateStatus DIRTY — update declined`);
   `BEHIND` was never a stop, so a declined update continues to `close-out.md` step 3 unchanged.
   On a resume that decline is the `"Stop"` above, never this continue.
2. **Worktree.** To pin, `git fetch origin {head}` and require `git rev-parse origin/{head}` to equal the expected head — the values line's current `headRefOid`
   on a resume and before any update, the post-update sha after `BEHIND`'s update below; after an exit-0 fetch, a ref missing or stale locally is fetched once more,
   and a mismatch after that stops (`stopped: update failed — head moved`).
   A `git worktree add`, `checkout` or `fetch` in steps 2-3 that exits non-zero stops the candidate (`stopped: update failed — command failed`) before any later command of steps 2-6 runs (step 7's teardown still runs) —
   never carry on elsewhere, since step 4 stamps whichever checkout it runs in.
   **Resume.** An existing `{wt}` or a pending marker (`close-out.md` step 2 routes both here) is a prior run's update: add nothing yet, pin, then compare.
   A `{wt}` mid-merge (`git -C {wt} rev-parse --verify --quiet MERGE_HEAD` exits 0) or holding tracked changes
   (`git -C {wt} status --porcelain --untracked-files=no` prints anything) is not resumable as it is: stop (`stopped: update failed — conflict not resolved`),
   keep `{wt}`, and tell the human to finish the merge in it or remove it.
   `git -C {wt} merge-base --is-ancestor origin/{head} HEAD` exits 0 (the PR head plus any unpushed resolution or fix): resume at step 4.
   Else `git -C {wt} merge-base --is-ancestor HEAD origin/{head}` exits 0 (the PR moved ahead, e.g. a late-landing update): `git -C {wt} checkout --detach origin/{head}`, then step 4.
   Neither (diverged): stop (`stopped: update failed — head moved`), keep `{wt}`, and tell the human to merge `origin/{head}` into it or remove it.
   No `{wt}` (a pending marker left by another checkout, or a `{wt}` since removed): add it as Fresh below does, detached at `origin/{head}`, then step 4 — that head is the unverified update.
   **Base moved again.** A resume whose `{wt}` holds nothing the PR lacks — the one just added for a pending marker included — goes to step 1's offer instead of step 4 when `close-out.md` step 2's read is `DIRTY`, `mergeable: CONFLICTING` or `BEHIND`:
   a resume that skipped the update would re-verify, then stop on that same status at step 6, run after run. Accepting runs Fresh on the existing `{wt}`
   (`git -C {wt} checkout --detach origin/{head}` in place of the add) and is still a resume for step 8, which hands off the marker as Fresh's write leaves it.
   Declining stops the candidate on either status, as step 1 says — a resume offers no `"Skip update"`, since that head is unverified.
   **Resume values**, before step 4. A pending marker supplies `{update-method}`, `{conflicted-files}` and `{resolution-commit}`: a pushed update is no longer in `origin/{head}..HEAD`, so `{wt}` cannot recover them.
   A last `resolution-commit` entry `pending` (a `BEHIND` run that stopped before its re-read) is the first line of `git -C {wt} rev-list --merges --ancestry-path --reverse {pre-update-head}..origin/{head}`, GitHub's update merge, `{pre-update-head}` being the marker's own field — none printed, a `{pre-update-head}` that is not a full 40-hex sha (`unknown` included, since a comment body is never pasted into a command unchecked), or a `rev-list` that exits non-zero: `unknown`, never a stop.
   With no pending marker nothing was pushed, since the marker precedes every landing call, so recover `{conflicted-files}`: `git -C {wt} log --merges -1 --format=%H origin/{head}..HEAD` names the resolution `{merge}` —
   `git -C {wt} merge-tree --write-tree --name-only --no-messages {merge}^1 {merge}^2` lists its conflicted paths after the tree line (exit 1: it conflicted; exit 0: `none`; any other exit — git older than 2.38, an unresolvable ref — `unknown`);
   no merge commit is a `BEHIND` update: `none`.
   **Fresh.** Otherwise pin, then `git worktree add --detach {wt} origin/{head}` before anything touches the PR — detached because the run's own worktree
   may still hold `{head}` checked out, and never the main checkout. `BEHIND` then writes the pending marker (`update-method: gh pr update-branch`, `conflicted-files: none`, `resolution-commit: pending`)
   and runs `gh pr update-branch {number}` (a merge — never the rebase variant); a failure stops the candidate (`stopped: update failed — update-branch rejected`).
   The call can return before GitHub's merge has landed, so re-read `gh pr view {number} --json headRefOid` — up to 3 reads, a few seconds apart, each its own plain command — for a sha that differs from the pre-update one
   (none appearing: `stopped: update failed — head moved`); pin again to that post-update sha, then `git -C {wt} checkout --detach origin/{head}`.
   Then rewrite the marker's `pending` `resolution-commit` entry to that sha.
3. **Merge (`DIRTY` only).** `git -C {wt} fetch origin {base}`, then require `git -C {wt} rev-parse origin/{base}` to equal the first field of `git -C {wt} ls-remote origin refs/heads/{base}` —
   a fetch can exit 0 and still leave the ref behind under a concurrent session; on a mismatch fetch and compare once more, and stop on one after that (`stopped: update failed — base not fetched`), nothing merged.
   Then `git -C {wt} merge --no-edit origin/{base}`.
   On a conflict, record `{conflicted-files}` with `git -C {wt} diff --name-only --diff-filter=U` and resolve per
   `_shared/git-discipline.md`'s Merge conflict resolution — both sides read, both intents kept. The human is present, so that section's
   ask-the-user fallback applies here (unlike the `auto` catch-up). Then `git -C {wt} add {paths}` and `git -C {wt} commit --no-edit`.
   An unresolvable conflict: `git -C {wt} merge --abort`, stop the candidate (`stopped: update failed — conflict not resolved`), nothing pushed.
   A merge that brings in nothing (HEAD still `origin/{head}`) means the forge's state was stale: re-run step 6's mergeability read —
   a stop-set status stops the candidate (`stopped: mergeStateStatus {status} after update`); otherwise hand off nothing and continue at `close-out.md` step 3 —
   or at step 4 when step 2 found a pending marker, since the head it marks is still unverified.
4. **Verify.** `verify.js` checks only the checkout it runs from (`test/verification.md`'s cwd note), so a standalone `cd {wt}` (never chained) comes first.
   When the project has a lockfile, run its install command there (the mapping is `_shared/worktree-adopt-freshness.md` step 4) — after the merge, which may change it.
   Then `node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js"` with the project's full command set per `/claude-tweaks:test`'s `verification.md`, then `node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --stamp-status`,
   then a standalone `cd {main-checkout}` whatever the result, before any later step.
   Continue only when `verifiedHead` is true, `scope` is `full`, and the stamp's `sha` equals `git -C {wt} rev-parse HEAD` — that sha is `{verified-sha}`.
   Otherwise stop (`stopped: update failed — verification`), push nothing, keep `{wt}`, and report it with the paste-ready re-run
   `/claude-tweaks:dispatch close-out #{record}` (`{record}` = a `Fixes` record of the PR), which resumes here (step 2). On `BEHIND` the update is
   already on GitHub, so that resume — never a later merge on CI alone — is what clears it.
5. **Push.** Only when `{wt}` holds commits the PR lacks (`git -C {wt} merge-base --is-ancestor HEAD origin/{head}` exits non-zero — a `DIRTY` resolution or a resumed fix).
   First write the pending marker with this update's `update-method`, `conflicted-files` and resolution commit (in full), appended to a pending one per the Update marker above;
   a resume that went straight to step 4 and found one pending keeps it as it is, since a fix commit is not the update. Then
   `git -C {wt} push origin HEAD:{head}` — plain. A rejection is reported and stops the candidate
   (`stopped: update failed — push rejected`); it is never retried as a force-push.
6. **Re-read CI on the new HEAD.** Confirm `gh pr view {number} --json headRefOid` equals `{verified-sha}` — one re-read if it lags; a sha that still differs stops the candidate
   (`stopped: update failed — head moved`), since one sha is never verified and another merged.
   A watch started straight after a push can find no checks and exit at once, so first repeat `_shared/pr-first-merge.md` Step 2.5's head-run read
   (`gh run list --commit {verified-sha}`) until it lists a run — up to 3 reads; still empty adds nothing (Step 2.5's empty-runs rule, e.g. no or path-filtered workflows),
   so continue to the watch and step 1's read, which decide.
   Then wait with `gh pr checks {number} --watch` as its own Bash call with an explicit long timeout (the tool's maximum) — the one place close-out waits,
   since the update itself created the pending state; a timeout is `stopped: CI pending after update`.
   Then re-run `close-out.md` step 1's read: only `passing` continues (otherwise `stopped: CI {status} after update`),
   and re-check `headRefOid` against `{verified-sha}` as above, since a push may have landed during the wait.
   Last, re-run step 2's mergeability read. The post-update stop set is `DIRTY`, `mergeable: CONFLICTING`, `BEHIND` (the base moved during the wait), a string result, or `null` —
   each stops the candidate (`stopped: mergeStateStatus {status} after update`). `UNKNOWN` is GitHub's lazily computed mergeability:
   re-read it — up to 3 reads, a few seconds apart, each its own plain command — and stop only if still `UNKNOWN` (`stopped: mergeStateStatus UNKNOWN after update`).
   Any other status continues. There is no second offer in the same run; the human re-runs close-out.
7. **Tear down.** Runs after step 6, after step 3's brings-in-nothing read when step 2 found no pending marker, and first on every stop after step 2, except a failed step 4 and a stop on a `{wt}` step 2 found mid-merge or holding tracked changes —
   each keeps `{wt}` for the fix or the merge the human finishes in it. `{wt}` is never the resume marker: the pending marker on the PR is, so every other stop tears down,
   an update already on GitHub included, and the next run's step 2 adds `{wt}` again.
   From `{main-checkout}` (a standalone `cd {main-checkout}` first if the shell is elsewhere), `git fetch origin {head}`, then `git -C {wt} merge-base --is-ancestor HEAD origin/{head}`;
   on exit 0, `git worktree remove {wt}` (`ExitWorktree` does not operate on `.worktrees/`, `_shared/scratch-worktree.md` §6).
   Non-zero: list `git -C {wt} log origin/{head}..HEAD --oneline` and remove nothing — the next run's step 2 resumes `{wt}`, or stops on it once the PR head has diverged.
8. **Hand off.** Pass the confirmation gate (`close-out-confirmation.md`) `{update-method}` (`merge` on `DIRTY`, `gh pr update-branch` on `BEHIND`; on a resume, the pending marker's, else `merge` when step 2 found a `{merge}`, else `gh pr update-branch`),
   `{conflicted-files}` (comma-joined paths or `none`; on a resume, the pending marker's as last written, else as step 2 recovered them), `{resolution-commit}` (short `{verified-sha}`, the PR's new HEAD —
   the conflict-resolution merge on `DIRTY`, GitHub's update merge on `BEHIND`; on a resume, every entry of the pending marker's, shortened, else short `{merge}` when step 2 found one, since a later fix commit is not the resolution), `{verified-sha}` itself (`close-out.md` step 5 merges only that head),
   and step 6's latest CI and mergeability reads. The marker stays pending until `close-out.md` clears it after the merge or a decline. Continue at `close-out.md` step 3.
