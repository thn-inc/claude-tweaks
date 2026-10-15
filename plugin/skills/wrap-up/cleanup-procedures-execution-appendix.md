# Wrap-Up Cleanup Procedures — reference appendix (#2546)

Rare-branch and historical-rationale content split out of `cleanup-procedures-execution.md`'s
operative head, read only when the head's own citation points here. Nothing in this file runs on
the common-case path — a run that never hits the conditions named at each citation never needs
this file at all.

## Step 2: Why a dedicated commit, not the merge artifact

`/superpowers:finishing-a-development-branch`'s own git mechanics give the closing keyword no
reliable home otherwise. Its "Merge locally" option runs a bare `git merge <feature-branch>` with
no `--no-ff` — git fast-forwards silently whenever possible, producing **no merge commit at all**
to carry a message into. Its "Push and Create PR" option pushes, then creates the PR "with the
forge's tooling — its CLI if one is available" — for a GitHub remote, that's `gh pr create` — but
nothing guarantees the resulting PR body carries a closing keyword. Stamping the feature branch
itself sidesteps both: the keyword travels with the branch regardless of which of the four options
gets chosen (fast-forward merge, non-ff merge, push+PR — even one the user creates manually
afterward — or keep-as-is), because GitHub scans every commit that reaches the default branch, not
just a merge commit or PR body. See "Close-via-merge" in `_shared/issue-claims.md` for the full
contract, including the multi-terminal parallel path (`flow/worktree-merge.md`), which performs
its own merge directly with `--no-ff` and does not need this carrier commit.

## Step 3.5: Transitional guard — a run directory whose only copy is inside this worktree

Run directories created since run-dir anchoring shipped (2026-08-07, `_shared/pipeline-run-dir.md`'s
Anchoring section) live under the **main checkout**, so Section B step 4 can rely on the copy
being there and removing a worktree cannot destroy it. Runs created *before* that hold their
only copy of `config.yml`, `decisions.md`, `events.jsonl` and `staged/` inside the worktree,
where step 4 deletes them permanently — there is no git history to recover from, the
same shape as `[IL-46]`. Copy them out first, from inside the worktree:

```bash
# pwd -P on the WT/RUN_REAL sides: on macOS the same directory reaches you as
# both /var/... and /private/var/..., and an unresolved prefix test silently
# never matches — the guard then looks like a clean no-op while the state it
# exists to save is still inside the worktree. resolve-run-dir --root-only
# already returns a realpath'd MAIN, so it needs no separate pwd -P here.
WT=$(cd "$(git rev-parse --show-toplevel)" && pwd -P)
MAIN=$(node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir --root-only)
RUN_REAL=$(cd "$RUN_DIR" 2>/dev/null && pwd -P)
case "${RUN_REAL:+$RUN_REAL/}" in
  "$WT"/*)
    DEST="$MAIN/.claude-tweaks/pipelines/$(basename "$RUN_REAL")"
    mkdir -p "$DEST"
    # Everything except `work/` — never a filename allowlist. A multi-spec run
    # nests one `spec-{n}/` directory per record, each with its own
    # decisions.md and staged/, alongside files like manifest.yml that no
    # fixed list anticipates. An allowlist copies the top-level names and
    # leaves the rest for step 4 to destroy — this guard failing silently in
    # exactly the way it exists to prevent. -mindepth/-maxdepth rather than
    # BSD's `-depth 1`, which GNU find reads as a path argument.
    find "$RUN_REAL" -mindepth 1 -maxdepth 1 ! -name work -exec cp -R {} "$DEST/" \;
    RUN_DIR="$DEST"
    ;;
esac
```

Copy the gitignored half only — **not `work/`**. Materialized headers are git-tracked and
reach the main checkout by merge (`_shared/pipeline-run-dir.md`, Anchoring); copying them
would leave untracked duplicates that Section B step 4's `git mv` then fails on. Re-point
`$RUN_DIR` at the copy, as above: Sections D and E and Section B's archival all read it
after this point. A run whose `$RUN_DIR` is empty or already outside the worktree is a
no-op, so this is inert on every run created after anchoring shipped.

**Removal condition** (`[IL-85]` — a compatibility path with no stated end date is never
collected): delete this step once no live worktree still holds an un-archived pre-anchoring
run directory. Verify by running, from the main checkout,
`find . -path "*/.claude/worktrees/*/.claude-tweaks/pipelines/*" -maxdepth 6 -type d` and
confirming every hit is a run whose directory also exists under the main checkout's own
`.claude-tweaks/pipelines/`. Delete unconditionally after **2026-11-07** regardless — three
months is longer than any worktree in this repo's history has stayed live, and a
pre-anchoring run still sitting in a worktree by then is abandoned state, not live state.

## Step 4: Unverified caveat on the `reconcile` remedy

A session's own *currently-standing* worktree may still carry the same live lock named in the
head's step 4 regardless of invocation method; if `reconcile` skips it for any other reason after
a genuine merge, that lock is the likely cause, and a future session's `SessionStart` background
pass remains the fallback.
