# Pre-review Catch-up

An overlap-gated catch-up with the integration branch, run by `/claude-tweaks:build` immediately before `/superpowers:subagent-driven-development` builds its whole-branch review package (#4304). The call site is `build/dispatch.md`'s **Pre-review catch-up** instruction, which names `bin/pre-review-catchup.js`; this file is the procedure and the posture behind it, cited rather than restated there.

It is overlap-gated, not unconditional: a merge commit and a full-suite re-run happen only when upstream commits touch files this branch changed. A branch whose files upstream never touched pays one fetch and a file-list comparison (the #4149 evidence: #4015 landed mid-run on the same functions, surfaced only at review Step 2, and cost a semantic-merge dispatch, a win32 follow-up and a second full suite; at merge, PR #4166 went `DIRTY` twice in one merge-mode invocation, the second time needing a hand semantic merge plus a three-way bash differential). Merging every time would add a commit and a suite run to builds that gain nothing from either.

## Scope

Worktree strategy only. A `current-branch` build and a `MULTISPEC_PARALLEL_WAVE=1` wave member run no CLI and log a `SKIP` (the wording is `build/dispatch.md`'s); a wave member's work reaches the shared branch through the wave orchestrator, whose own whole-branch review runs the catch-up.

`{integration-branch}` is resolved at the call site through `_shared/integration-branch.md`'s canonical ladder, the same full ladder `_shared/worktree-setup.md`'s Post-creation catch-up uses. It is never carried from Common Step 1: a resumed build or a context-handoff continuation never ran that step in this session.

## Outcomes

`node "${CLAUDE_PLUGIN_ROOT}/bin/pre-review-catchup.js" --integration-branch {integration-branch} [--run "$PIPELINE_RUN_DIR"]` prints one JSON line and exits 0 on every outcome. Exit 2 is a malformed invocation and exit 1 an undecided crash; neither is an outcome, and neither is skipped past. The CLI appends its own `decisions.md` line (section `/build`, step `Pre-review catch-up`) when `--run` is passed; `logged: false` means the append failed and `line` is what to hand-log.

| `outcome` | Meaning | Posture |
|-----------|---------|---------|
| `not-applicable` | The build branch is the integration branch | Proceed unchanged |
| `fetch-failed` | `git fetch` failed or timed out, not for a long path | Fail open, with its own `SKIP` line, distinct from `no-overlap`'s `SCANNED` line; the overlap check did not run |
| `windows-longpath` | Fetch or merge failed with `Filename too long` | A fixable misconfiguration, never the fail-open path: follow `_shared/worktree-setup-windows-longpath.md`, then re-run the CLI |
| `dirty-tree` | Uncommitted tracked changes | Nothing merged; commit the named changes and re-run |
| `no-overlap` | Upstream moved but touches none of this branch's files | Proceed unchanged; no merge, no suite re-run |
| `merged` | The overlapping upstream commits were merged in | Re-run the full suite on the merged tree, and build the review package on the JSON's `reviewBase` |
| `conflict` | The merge conflicted and is left in progress | Stop for resolution per `_shared/git-discipline.md`'s Merge conflict resolution; never reset, discard, or `git merge --abort` past it |

A repair (a suite failure after `merged`, or the conflicted files after `conflict`) is one implementer dispatch at the plan's implementer tier, never a controller-side fix: the controller does not edit code itself. That dispatch gets the failing output or the conflicted files and the merge's two sides. A repair that does not leave a committed green tree is a HARD-GATE stop with the merge state intact, surfaced to the human with its files.

## Anti-patterns

| Pattern | Why it fails |
|---------|--------------|
| Running the pre-review catch-up only when the PR shows DIRTY | DIRTY surfaces at merge, after the review judged a stale tree — the #4149 cost this check exists to avoid |
| Building the review package on the pre-merge base after a merge | The reviewer then reads upstream's commits as branch work |
