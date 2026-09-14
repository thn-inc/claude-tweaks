# PR Run Comments — the gate, the kinds, and the post-or-update procedure

Canonical for every site that posts a run-lifecycle comment (review verdict, verification
brief, failure tombstone) to a `pr-first` (`_shared/integration-model.md`) run's draft PR
instead of — or in addition to — the record issue. Generalizes
`_shared/pr-early-run-lifecycle.md`'s PR body composition to the comments posted *during* the
run, after the PR already exists.

## The gate — one condition, everywhere

**`run-state.json` carries a `pr` object** (`{ number, url }`, written by `hooks.js record-pr`
per `_shared/pr-early-run-lifecycle.md`). That is the entire routing condition — every site in
this file's Consumer table below checks this one thing, never re-derives `integration-model`
independently and never infers "has a PR" from anything else (branch name, worktree presence,
etc.).

- **Present** → route this section's procedures.
- **Absent** — `local-merge` run, or a `pr-first` run whose run-start push/create degraded
  (`_shared/pr-early-run-lifecycle.md`'s skip/degrade table) — → today's issue-only behavior,
  unchanged.
- **Present, but the `gh` call itself fails** (network, auth, the PR was deleted out from under
  the run) — a **separate, logged, retryable failure**, never conflated with "no PR". Log to
  `decisions.md` and fall back to the issue-only behavior for *that one post* — the next site
  that checks the gate still finds `pr` present and tries again.

## Comment kinds

| Kind | Posted by | Marker |
|---|---|---|
| `verdict` | `/claude-tweaks:review`, on review-gate completion | `<!-- run-comment: verdict -->` |
| `brief` | `/claude-tweaks:wrap-up`, the Verification Brief | `<!-- run-comment: brief -->` |
| `timing` | `/claude-tweaks:wrap-up`, right after the Verification Brief | `<!-- run-comment: timing -->` |
| `failure` | `/claude-tweaks:dispatch`'s Settle step, on HARD-GATE failure | `<!-- run-comment: failure -->` |
| `release-status` | `_shared/pr-first-merge-post-merge.md` Step 4.1, on outcome `merged` when a CHANGELOG backfill is needed | `<!-- run-comment: release-status -->` |

Each kind's marker is the **first line** of its comment body, unconditionally — the same
first-line-marker convention `_shared/pr-early-run-lifecycle.md`'s PR body uses for its own
`claude-tweaks-run` marker, for the same reason: a reader (or a scan) must be able to identify
the kind without parsing prose.

## Post-or-update procedure (per kind, per run)

**One comment per kind per run.** A re-run (a re-triggered review, a resumed wrap-up) edits the
existing marker comment in place — it never appends a duplicate. A stale `verdict`/`brief` sitting
above a fresh one would misinform a reader skimming the PR, so this is the one place in the
plugin's PR-comment surface that edits rather than always-appends.

1. **Find.** Resolve `{host}`/`{owner}`/`{repo}` once (`gh repo view --json nameWithOwner,url` —
   `{owner}/{repo}` from `nameWithOwner`, `{host}` from the returned `url`'s authority; a bare
   `OWNER/REPO` handed to `--repo` is resolved by `gh` against its default host, `github.com`,
   unless the value carries the host as `HOST/OWNER/REPO` — so every `--repo` below is the
   host-qualified form), then:

   ```bash
   gh pr view {pr-number} --repo {host}/{owner}/{repo} --json comments \
     --jq '.comments[] | select(.body | startswith("<!-- run-comment: {kind} -->")) | .id'
   ```

   `.id` here is the GraphQL node ID (e.g. `IC_kwDO...`), not a REST numeric ID — `gh pr view
   --json comments` exposes only the former. This is exactly why the update step below is a
   GraphQL mutation rather than a REST PATCH to `issues/comments/{id}`, which would need the
   numeric ID this command doesn't return.

   Zero or one result is the expected case. More than one (a race between two concurrent
   posts of the same kind) is a hedge, not the normal path — take the **first** and log the
   anomaly; do not attempt to reconcile or delete the extra here.

2. **Found → update in place**, preserving the comment's identity (same GraphQL id, no new
   comment created, no reordering in the thread). `--hostname {host}` is required here even
   though `--repo` is host-qualified elsewhere — the two flags are independent in `gh`, and
   `gh api graphql` targets `github.com` unless `--hostname` is given:

   ```bash
   gh api graphql --hostname {host} -f query='mutation($id:ID!,$body:String!){updateIssueComment(input:{id:$id,body:$body}){issueComment{id}}}' \
     -f id="{found-id}" -F body=@/tmp/{kind}-comment-{n}.md
   ```

3. **Not found → create**, body file already carries the kind's marker as its first line:

   ```bash
   gh pr comment {pr-number} --repo {host}/{owner}/{repo} --body-file /tmp/{kind}-comment-{n}.md
   ```

**On failure of either the find or the write** (network, auth, or a rate limit classified per `_shared/github-rate-limit.md`): log to `decisions.md`
as a retryable failure per the gate section above and fall back to the issue-only post for that
call — never silently drop the content.

## Consumer table

| Consumer | Kind | Notes |
|---|---|---|
| `/claude-tweaks:review` (verdict-rendering step) | `verdict` | Top findings by severity, max 5, reusing review's own findings-table shape |
| `/claude-tweaks:wrap-up` (`verification-brief.md` Step 4) | `brief` | Full brief posts to the PR; the issue gets a one-line pointer comment instead (unmarkered — it is not itself a `run-comment` kind, since nothing ever needs to find-and-update it by marker) |
| `/claude-tweaks:wrap-up` (`verification-brief.md` Step 4, after the brief) | `timing` | The run's Timing table, `bin/phase-timing.js --run "$PIPELINE_RUN_DIR" --markdown --auto-transcript` verbatim under the same `pr`-object gate as the brief; find-or-update by marker, so a re-run replaces it (#1928) |
| `/claude-tweaks:dispatch` (`settle-and-merge.md` Step 6, step 5) | `failure` | The full comment (`bin/lib/issues/retry.js`'s `attemptFailedCommentBody`, marker included) always posts to the **issue**, regardless of pr-first (`#1963`) — this is what `bin/lib/issues/trust.js`, which reads only the issue's comments and is not modified, already sees. Under pr-first, the PR gets a short pointer comment instead of the full narrative, and is closed. Retry-ceiling **counting** (`countFailedAttempts`) merges the issue's comments with every PR ever linked to the record, open or closed, so an attempt is found regardless of which source it originally posted to |
| `_shared/pr-first-merge-post-merge.md` (Step 4.1) | `release-status` | Body: the human line, then the `--backfill` section, then one line pointing at `docs/releasing.md` "After the merge"; posted only on the backfill outcome, never on `not yet in a release` or `every record named` |

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Always appending a new PR comment instead of finding-and-updating by marker | A stale `verdict`/`brief` sitting above a fresh one misinforms a reader skimming the PR — the opposite of what "PR as run surface" is for |
| Re-deriving `integration-model` at a comment-posting call site instead of checking `run-state.json`'s `pr` field | Recreates the exact per-site drift `_shared/integration-model.md`'s run-scoped pin exists to prevent — a mid-run `gh` blip must not flip where comments post |
| Treating a `gh` call failure the same as "no PR" | The first is a retryable transient failure; the second is a permanent routing decision for the rest of the run. Conflating them silently and permanently downgrades a `pr-first` run to issue-only comments after one network blip |
| Counting retry attempts from only one source (the issue alone, or only the currently-linked PR) | A record whose attempts alternate between runs that opened a PR and runs that did not — or whose PR later closed — splits its "Attempt N failed" comments across sources; undercounting from a single source means the ceiling never trips (`#1963`) |
