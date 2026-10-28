# Pre-review Catch-up

An overlap-gated catch-up with the integration branch, run by `/claude-tweaks:build` immediately before `/superpowers:subagent-driven-development` builds its whole-branch review package (#4304). The call site is `build/dispatch.md`'s **Pre-review catch-up** instruction, which names `bin/pre-review-catchup.js`; this file is the procedure and the posture behind it, cited rather than restated there.

It is overlap-gated, not unconditional: a merge commit and a full-suite re-run happen only when upstream commits touch files this branch changed. A branch whose files upstream never touched pays one fetch and a file-list comparison (the #4149 evidence: #4015 landed mid-run on the same functions, surfaced only at review Step 2, and cost a semantic-merge dispatch, a win32 follow-up and a second full suite; at merge, PR #4166 went `DIRTY` twice in one merge-mode invocation, the second time needing a hand semantic merge plus a three-way bash differential). Merging every time would add a commit and a suite run to builds that gain nothing from either.

## Scope

Worktree strategy only. A `current-branch` build runs no CLI and logs a `SKIP` (the wording is `build/dispatch.md`'s); that is the only skip. Every worktree-strategy build runs it, including a `MULTISPEC_PARALLEL_WAVE=1` wave member in its own worktree: concurrent members' fetches that contend on the same ref land in the logged `fetch-failed` fail-open path. A sequential multi-spec run in the shared worktree runs it per spec.

`{integration-branch}` is resolved at the call site through `_shared/integration-branch.md`'s canonical ladder, the same full ladder `_shared/worktree-setup.md`'s Post-creation catch-up uses. It is never carried from Common Step 1: a resumed build or a context-handoff continuation never ran that step in this session.

## Outcomes

`node "${CLAUDE_PLUGIN_ROOT}/bin/pre-review-catchup.js" --integration-branch {integration-branch} [--run "$PIPELINE_RUN_DIR"]` prints one JSON line and exits 0 on every outcome. Exit 2 is a malformed invocation and exit 1 an undecided crash; neither is an outcome, and neither is skipped past. Fix the environment cause from stderr and re-run once; a second non-zero exit is a HARD-GATE stop surfaced to the human with its stderr. Never move or delete untracked files to get past one: a realistic exit 1 is upstream adding a path that exists untracked in the worktree ("untracked working tree files would be overwritten"), and those files are not the catch-up's to discard. The CLI appends its own `decisions.md` line (section `/build`, step `Pre-review catch-up`) when `--run` is passed. `logged: false` under a run dir means the append failed: hand-log the JSON's `entry` (`line`'s parts), never `line` itself, which is a finished entry that `--text` would re-prefix. Write `[entry]` as JSON with the Write tool to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PRC_ENTRY=pre-review-catchup-entry.json` prints, then run `log-decision.js --run "$PIPELINE_RUN_DIR" --entries "{that path}"`. With no run dir, `line` is what the build reports.

Whatever the outcome, a non-null `reviewBase` is the review package's base commit. SDD's own base, a `git merge-base` against the possibly stale local integration branch, is used only when `reviewBase` is null.

| `outcome` | Meaning | Posture |
|-----------|---------|---------|
| `not-applicable` | The build branch is the integration branch | Proceed unchanged |
| `fetch-failed` | `git fetch` failed or timed out, not for a long path | Fail open, with its own `SKIP` line, distinct from `no-overlap`'s `SCANNED` line; the overlap check did not run. Build the review package on `reviewBase` when it is non-null: the merge base with the last-fetched `origin/{integration-branch}`, null only when that ref never resolved |
| `windows-longpath` | Fetch or merge failed with `Filename too long` | A fixable misconfiguration, never the fail-open path: apply `_shared/worktree-setup-windows-longpath.md`'s `core.longpaths` fix, then re-run the CLI. A `merge` failure self-aborts with no `MERGE_HEAD` and can leave untracked leftovers; that file's reset-then-clean recovery (`git reset --hard HEAD`, then `git clean -f -d -- {leftover paths}`, only paths the failed merge created) is safe here too, not only on a freshly created worktree, because the CLI's dirty-tree pre-check guaranteed no uncommitted tracked changes and the branch's commits are kept |
| `dirty-tree` | Uncommitted tracked changes (`reason` names the first path) | Nothing merged, and never committed blindly: the build's own uncommitted work is committed through the implementer dispatch below and the CLI re-run; anything else is a HARD-GATE stop surfaced to the human |
| `no-overlap` | Upstream moved but touches none of this branch's files | No merge, no suite re-run; build the review package on the JSON's `reviewBase` (the merge base with `origin/{integration-branch}`, not with the possibly stale local branch) |
| `merged` | The overlapping upstream commits were merged in | Re-run the full suite on the merged tree, and build the review package on the JSON's `reviewBase` |
| `conflict` | The merge conflicted and is left in progress; or (`reason` `merge-in-progress`) a merge was already in progress when the CLI started, so nothing was fetched or merged | Stop for resolution per `_shared/git-discipline.md`'s Merge conflict resolution; never reset, discard, or `git merge --abort` past it. On a resumed run an empty `conflictFiles` means resolved but not yet committed: the same implementer dispatch commits the merge. The resolution log line's `{files}` is the `conflictFiles` of the run that first returned `conflict` with a non-empty list, or `resolved before resume` when that output is gone (a resumed session) |

A repair (a suite failure after `merged`, or the conflicted files after `conflict`) is one implementer dispatch at the plan's implementer tier, never a controller-side fix: the controller does not edit code itself. That dispatch gets the failing output or the conflicted files and the merge's two sides. A repair that does not leave a committed green tree is a HARD-GATE stop with the merge state intact, surfaced to the human with its files.

## Anti-patterns

| Pattern | Why it fails |
|---------|--------------|
| Running the pre-review catch-up only when the PR shows DIRTY | DIRTY surfaces at merge, after the review judged a stale tree — the #4149 cost this check exists to avoid |
| Building the review package on any base but the JSON's `reviewBase` when it is non-null (the pre-merge base, or `git merge-base` against the local integration branch) | The reviewer then reads upstream's commits as branch work |
| Committing a `dirty-tree` path without knowing it is the build's own work | A change the build did not make (or a leftover conflict marker) is then recorded as branch work and reviewed as such |
