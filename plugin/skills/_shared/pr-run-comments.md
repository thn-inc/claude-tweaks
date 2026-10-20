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
| `verdict` | `/claude-tweaks:review`, on review-gate completion | `<!-- run-comment: verdict -->` single-spec; `<!-- run-comment: verdict:{spec} -->` per spec in a multi-spec run — see "Multi-spec verdict comments" below |
| `brief` | `/claude-tweaks:wrap-up`, the Verification Brief | `<!-- run-comment: brief -->` single-spec; `<!-- run-comment: brief:{spec} -->` per spec in a multi-spec run — see "Multi-spec brief and timing comments" below |
| `timing` | `/claude-tweaks:wrap-up`, right after the Verification Brief | `<!-- run-comment: timing -->` single-spec; `<!-- run-comment: timing:{spec} -->` per spec in a multi-spec run — see "Multi-spec brief and timing comments" below |
| `try-it` | `/claude-tweaks:wrap-up`, a record's Try it block when no brief on the PR carries it | `<!-- run-comment: try-it -->` single-spec; `<!-- run-comment: try-it:{spec} -->` per spec in a multi-spec run, the same qualification as `verdict` |
| `failure` | `/claude-tweaks:dispatch`'s Settle step, on HARD-GATE failure | `<!-- run-comment: failure -->` |
| `release-status` | `_shared/pr-first-merge-post-merge.md` Step 4.1, on outcome `merged` when a CHANGELOG backfill is needed | `<!-- run-comment: release-status -->` |

Each kind's marker is the **first line** of its comment body, unconditionally — the same
first-line-marker convention `_shared/pr-early-run-lifecycle.md`'s PR body uses for its own
`claude-tweaks-run` marker, for the same reason: a reader (or a scan) must be able to identify
the kind without parsing prose.

## Multi-spec verdict comments (#2592)

A multi-spec `/claude-tweaks:flow` run shares one PR across every spec (`flow/multi-spec.md`),
the same way it shares one draft PR and one cumulative phase-checklist
(`flow/multispec-pr-checklist.md`). Unlike the phase-checklist, the `verdict` kind is **not**
cumulative into a single shared comment — each spec's review verdict is substantively different
content (its own findings, its own PASS/BLOCKED call), so folding spec B's verdict into spec A's
comment would still lose spec A's content the moment spec B's review posts. Instead: **one
`verdict` comment per spec**, each keyed by its own spec-qualified marker,
`<!-- run-comment: verdict:{spec} -->` — `{spec}` is the record id (`2589`, `2592`, …), the same
identifier `manifest.yml`'s `specs[].id` and the `spec-{N}/` subdirectory convention already use.
`/claude-tweaks:review`'s Step 7 (`review/code-mode-steps.md`) composes this marker instead of
the plain `verdict` marker whenever it is running inside a multi-spec context (`$MULTISPEC_PARENT_DIR`
set); a single-spec run keeps the plain `<!-- run-comment: verdict -->` marker unchanged.

This reuses the Post-or-update procedure below completely unchanged — `{kind}` is simply
`verdict:{spec}` instead of `verdict` for that spec's own find/update/create calls, so each spec
finds and updates only its own comment and never touches a sibling spec's. No new logic: the
existing find-by-marker `startswith` check already disambiguates `verdict:2589` from `verdict:2592`
(and from the bare `verdict` marker, which no multi-spec comment ever uses) since none is a
prefix of another once `-->` closes the tag.

## Multi-spec brief and timing comments (#2970)

The same overwrite hazard #2592 fixed for `verdict` was still open for `brief` and `timing`:
`wrap-up/verification-brief.md`'s Routing section sends every record with no resolvable GitHub
parent through its Steps 1-4 independently, per record — and a multi-spec `/claude-tweaks:flow`
run (direct `/flow #A,#B`, or a dispatch fast-lane bundle, which is the identical multi-spec
`/flow` invocation under the hood, not a separate implementation) reaches that Acceptance-labeling
bullet once per spec, against the one shared PR. `wrap-up/execution-and-verification.md`'s
`MULTISPEC_REVIEW_DEFER` skip list (items 3/4/6/7/8) does not cover acceptance labeling, so this
path is live on every multi-spec run, not a rare edge case. Before this fix, Step 4 composed the
bare `<!-- run-comment: brief -->` / `<!-- run-comment: timing -->` markers unconditionally, so
spec B's post-or-update silently overwrote spec A's Verification Brief and timing comment — the
same shape observed live for `verdict` on PR #2586.

(A record that *does* have a resolvable parent — a `/specify` decomposition — never hits this
hazard: it routes to the Parent-Gate Procedure instead, which already composes one brief for the
whole parent by construction, sequenced so a later sub-issue's re-read no-ops rather than
re-posting — see `verification-brief-parent-gate.md`. That is a different mechanism from the
multi-spec-PR-sharing case this section rules.)

Fixed the same way as `verdict`: **one `brief` comment per spec** and **one `timing` comment per
spec**, each keyed by its own spec-qualified marker — `<!-- run-comment: brief:{spec} -->` and
`<!-- run-comment: timing:{spec} -->` — where `{spec}` is the record id, the same identifier the
verdict marker uses. `wrap-up/verification-brief.md`'s Step 4 composes these markers instead of
the plain `brief`/`timing` markers whenever it is running inside a multi-spec context
(`$MULTISPEC_PARENT_DIR` set); a single-spec run keeps the plain `<!-- run-comment: brief -->` /
`<!-- run-comment: timing -->` markers unchanged. This reuses the Post-or-update procedure below
completely unchanged — `{kind}` is simply `brief:{spec}` / `timing:{spec}` instead of the bare
form for that spec's own find/update/create calls, exactly as `verdict:{spec}` already does.

**Read side (#3333).** Both readers of a posted brief follow the write side's split: the
acceptance-labeling check in `bin/lib/wrap-up/engine-verify.js` and `/claude-tweaks:demo`'s PR
run-comment lookup in `demo/entry-paths.md` read `<!-- run-comment: brief:{n} -->` for the record
`n` being read first, then fall back to the plain `<!-- run-comment: brief -->`. The fallback keeps
single-spec runs, which still post the plain marker, and briefs posted before the qualified marker
existed resolving as before. A sibling spec's `brief:{m}` never satisfies record `n`; only the plain
fallback, which a multi-spec run never writes, can be shared.

## Trusted authors

A comment is writable by anyone who can comment on the PR or issue, so a marker in its body proves
nothing about who wrote it. A marker or heading comment counts only when its author association is
`OWNER`, `MEMBER`, or `COLLABORATOR`. `gh` returns it as `authorAssociation`; the REST and MCP
transports return it as `author_association`. A missing field is untrusted — a comment with neither field is skipped. An untrusted
marker comment takes the same path as no such comment — create fresh, fall back, or fail the check —
never the trusted path.

There is no viewer lookup. Anyone with write access can already push to the PR branch, so a narrower
rule adds no protection, while matching the viewer rejects a comment read by a different maintainer or
account.

**Excluded on purpose.** Bots and one-time contributors carry `CONTRIBUTOR`, which is not trusted.

Add the select after the marker match, and run the note filter alongside it so each skipped comment is
named in one line in the reader's output:

```
select(.authorAssociation == "OWNER" or .authorAssociation == "MEMBER" or .authorAssociation == "COLLABORATOR")
select((.authorAssociation == "OWNER" or .authorAssociation == "MEMBER" or .authorAssociation == "COLLABORATOR") | not) | "skipped marker comment \(.url) by \(.author.login // "unknown") (\(.authorAssociation // "no association")) — not an owner, member, or collaborator"
```

Code readers use `bin/lib/issues/comment-trust.js`, which builds both filters above.

## Post-or-update procedure (per kind, per run — per kind per spec per run under multi-spec)

**One comment per kind per run** (one per kind **per spec** per run, under multi-spec — see
above). A re-run (a re-triggered review, a resumed wrap-up) edits the
existing marker comment in place — it never appends a duplicate on the `gh` transport (the MCP
transport has no comment edit and appends; see **MCP transport** below). A stale `verdict`/`brief` sitting
above a fresh one would misinform a reader skimming the PR, so this is the one place in the
plugin's PR-comment surface that edits rather than always-appends.

1. **Find.** Resolve `{host}`/`{owner}`/`{repo}` once (`gh repo view --json nameWithOwner,url` —
   `{owner}/{repo}` from `nameWithOwner`, `{host}` from the returned `url`'s authority; a bare
   `OWNER/REPO` handed to `--repo` is resolved by `gh` against its default host, `github.com`,
   unless the value carries the host as `HOST/OWNER/REPO` — so every `--repo` below is the
   host-qualified form), then:

   ```bash
   gh pr view {pr-number} --repo {host}/{owner}/{repo} --json comments \
     --jq '.comments[] | select(.body | startswith("<!-- run-comment: {kind} -->")) | select(.authorAssociation == "OWNER" or .authorAssociation == "MEMBER" or .authorAssociation == "COLLABORATOR") | .id'
   ```

   Only a trusted author's comment is found (**Trusted authors** above); an untrusted marker comment
   reads as not found. Run the skip-notice filter over the same comments and keep its lines in the
   output:

   ```bash
   gh pr view {pr-number} --repo {host}/{owner}/{repo} --json comments \
     --jq '.comments[] | select(.body | startswith("<!-- run-comment: {kind} -->")) | select((.authorAssociation == "OWNER" or .authorAssociation == "MEMBER" or .authorAssociation == "COLLABORATOR") | not) | "skipped marker comment \(.url) by \(.author.login // "unknown") (\(.authorAssociation // "no association")) — not an owner, member, or collaborator"'
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

**MCP transport (no `gh`, #3131).** The find and update steps above are `gh`-only, and there is no
MCP comment-edit mapping — post a new comment with `add_issue_comment` on the PR's number instead
of updating. Before posting, list the PR's comments (`issue_read`, `get_comments`) and look for a
prior comment of this kind by its marker, counting only a comment whose `author_association` is
trusted (**Trusted authors** above; an untrusted marker comment is skipped with that section's note,
not superseded); when one is found, make the new body's second line
`Supersedes {prior comment URL} — this transport cannot edit comments.` so a reader knows which one
is current, and log an `AUTO` line naming both comment ids. When the read cannot identify one (the
read fails, or returns no marker), post without that line — never skip the post to avoid a duplicate. Compose
the body per `_shared/github-write-transport.md`'s **Marker comments on the MCP path**, then
read back the posted comment: when the read-back body begins `&lt;!--`, re-post once and trace a
still-escaped result with that section's `SKIP` line, so an escaped verdict is visible in the run log.

**On failure of either the find or the write** (network, auth, or a rate limit classified per `_shared/github-rate-limit.md`): log to `decisions.md`
as a retryable failure per the gate section above and fall back to the issue-only post for that
call — never silently drop the content.

## Consumer table

| Consumer | Kind | Notes |
|---|---|---|
| `/claude-tweaks:review` (verdict-rendering step) | `verdict` (`verdict:{spec}` under multi-spec — see above) | Top findings by severity, max 5, reusing review's own findings-table shape |
| `/claude-tweaks:wrap-up` (`verification-brief.md` Step 4) | `brief` (`brief:{spec}` under multi-spec — see "Multi-spec brief and timing comments" above) | Full brief posts to the PR; the issue gets a one-line pointer comment instead (unmarkered — it is not itself a `run-comment` kind, since nothing ever needs to find-and-update it by marker) |
| `/claude-tweaks:wrap-up` (`verification-brief.md` Step 4, after the brief) | `timing` (`timing:{spec}` under multi-spec — see "Multi-spec brief and timing comments" above) | The run's Timing table, `bin/phase-timing.js --run "$PIPELINE_RUN_DIR" --markdown --auto-transcript` verbatim under the same `pr`-object gate as the brief; find-or-update by marker, so a re-run replaces it (#1928) |
| `/claude-tweaks:wrap-up` (`verification-brief.md`'s Try it block) | `try-it` | The human walkthrough (`_shared/try-it.md`) for a below-floor record or a parent-linked sub-issue — the cases with no brief on the PR to embed it (#2821); find-or-update by marker. The one exception to the issue-only fallback above: a failed `try-it` post is logged as a retryable failure and never re-routed to the issue — a below-floor record gets no issue comment. Nothing later in the run re-posts it: the Pipeline Summary still carries the block, and a re-run of wrap-up posts it by marker |
| `/claude-tweaks:dispatch` (`settle-and-merge.md` Step 6, step 5) | `failure` | The full comment (`bin/lib/issues/retry.js`'s `attemptFailedCommentBody`, marker included) always posts to the **issue**, regardless of pr-first (`#1963`) — this is what `bin/lib/issues/trust.js`, which reads only the issue's comments and is not modified, already sees. Under pr-first, the PR gets a short pointer comment instead of the full narrative, and is closed. Retry-ceiling **counting** (`countFailedAttempts`) merges the issue's comments with every PR ever linked to the record, open or closed, so an attempt is found regardless of which source it originally posted to |
| `_shared/pr-first-merge-post-merge.md` (Step 4.1) | `release-status` | Body: the human line, then the `--backfill` section, then one line pointing at `docs/releasing.md` "After the merge"; posted only on the backfill outcome, never on `not yet in a release` or `every record named` |

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Always appending a new PR comment instead of finding-and-updating by marker | A stale `verdict`/`brief` sitting above a fresh one misinforms a reader skimming the PR — the opposite of what "PR as run surface" is for. On the MCP transport, which cannot edit, the new post names the one it supersedes instead (**MCP transport** above) |
| Re-deriving `integration-model` at a comment-posting call site instead of checking `run-state.json`'s `pr` field | Recreates the exact per-site drift `_shared/integration-model.md`'s run-scoped pin exists to prevent — a mid-run `gh` blip must not flip where comments post |
| Treating a `gh` call failure the same as "no PR" | The first is a retryable transient failure; the second is a permanent routing decision for the rest of the run. Conflating them silently and permanently downgrades a `pr-first` run to issue-only comments after one network blip |
| Counting retry attempts from only one source (the issue alone, or only the currently-linked PR) | A record whose attempts alternate between runs that opened a PR and runs that did not — or whose PR later closed — splits its "Attempt N failed" comments across sources; undercounting from a single source means the ceiling never trips (`#1963`) |
