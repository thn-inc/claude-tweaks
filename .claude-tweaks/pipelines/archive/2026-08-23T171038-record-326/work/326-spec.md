---
record: 326
origin: capture
risk: low
size: medium
ceremony: fast-lane
grants: [build]
surface: infra
---
# 326: Harden track-issue-fixes.yml edge cases (revert-awareness, PR-vs-issue, label-removal atomicity, pagination)

Surface: infra

## Current State

- `.github/workflows/track-issue-fixes.yml` runs on every push to any non-default branch (`label-fix-branch` job) and on every push to the default branch (`cleanup-fix-labels` job).
- Both jobs extract closing-keyword issue references from `github.event.commits[].message` with the same regex: `\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#([0-9]+)`.
- `label-fix-branch` adds a `fix-on-{branch}` label to each referenced issue and, if the commit SHA is not already present in any existing comment body (`gh issue view ... --json comments -q '.comments[].body' | grep -F "$SHA"`), posts a tracking comment naming the SHA and branch.
- `cleanup-fix-labels` collects every `fix-on-*` label on each referenced issue into a `REMOVE_ARGS` bash array and removes them all in a single `gh issue edit "$ISSUE" "${REMOVE_ARGS[@]}"` call.
- Individual `gh issue edit`/`gh issue comment` calls are suffixed `|| true` throughout, so any single failure (bad ref, API error, wrong number) is silently swallowed and the loop continues.
- Neither job checks whether a commit is a `git revert` of an earlier fix commit, nor whether an extracted number resolves to an issue versus a pull request.
- Pre-release whole-branch review (`9f4c49b1..HEAD`) found these 5 unverified edge-case gaps; none has been empirically confirmed or fixed yet.

## Deliverables

- [ ] Revert-commit awareness: exclude any commit whose message begins with `Revert "` (git's default revert subject, which verbatim re-contains the original closing keyword, e.g. `Revert "fixes #42"`) from closing-keyword extraction in both `label-fix-branch` and `cleanup-fix-labels`, so a revert of a fix commit does not re-label or re-comment the issue as fixed.
- [ ] PR-vs-issue safety: before `gh issue edit "$ISSUE" --add-label ...` in `label-fix-branch`, verify the extracted number resolves to an issue and not a pull request (e.g. `gh api "repos/$REPO/issues/$ISSUE" --jq 'has("pull_request")'` — GitHub's REST Issues API returns PRs too, distinguished by the presence of a `pull_request` key). On a PR number, skip it with a visible log line (a `::warning::` annotation or explicit echo) instead of the current fully-silent `|| true` swallow.
- [ ] Amend/force-push-safe dedup: replace the SHA-only dedup check with a marker that survives amend+force-push of the same logical fix — a branch-scoped hidden marker (e.g. `<!-- track-issue-fixes:{branch} -->`) written into the comment body and checked for presence, rather than matching the exact commit SHA text.
- [ ] Atomic label-removal fix: change `cleanup-fix-labels`'s single batched `gh issue edit "$ISSUE" "${REMOVE_ARGS[@]}"` call into one `gh issue edit "$ISSUE" --remove-label "$LABEL" --repo "$REPO" || true` call per label, so one rejected/already-removed label no longer blocks removal of the others in the same batch.
- [ ] Explicit comment-list pagination: empirically confirm whether `gh issue view --json comments` truncates output for an issue with many comments; if it does not paginate internally, switch the dedup comment fetch to an explicitly paginated call (e.g. `gh api "repos/$REPO/issues/$ISSUE/comments" --paginate --jq '.[].body'`) so dedup checks the full comment history.

## Acceptance Criteria

1. Given a push whose only new commit's message is `Revert "fixes #42"` (git's default revert subject for an original commit that said `fixes #42`), `label-fix-branch` does not add a `fix-on-{branch}` label or post a comment on issue #42.
2. Given a push whose commit message contains a closing keyword followed by a real pull request number (not an issue) in the repo, the workflow does not call `gh issue edit`/`gh issue comment` against that number, and instead logs a visible skip rather than swallowing the failure via `|| true`.
3. Given the same logical fix committed, amended, and force-pushed twice under two different SHAs on the same branch, `label-fix-branch` posts at most one tracking comment on the referenced issue for that branch — not one per force-push.
4. Given a `cleanup-fix-labels` run where one of an issue's `fix-on-*` labels has already been removed (simulating a concurrent run), the remaining `fix-on-*` labels on that issue are still successfully removed.
5. `gh issue view --json comments`' pagination behavior for an issue with more than 100 comments is verified empirically (documented in a code comment or commit message with the actual finding), and the dedup logic is confirmed — or fixed — to check the full comment history rather than a possibly-truncated first page.
6. `actionlint` (or, if not available in this repo, a YAML syntax check via `python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" .github/workflows/track-issue-fixes.yml`) passes on the modified workflow file.

## Technical Approach

All five gaps live in `.github/workflows/track-issue-fixes.yml`'s two jobs, `label-fix-branch` and `cleanup-fix-labels`, which currently duplicate the same "Extract referenced issues" step verbatim — a revert-awareness fix applied to only one job reintroduces the bug asymmetrically in the other, so both extraction steps need the same fix.

- **Revert detection**: filter `github.event.commits` to drop any commit whose `message` starts with `Revert "` before running the closing-keyword regex against the remaining messages — a full exclusion rather than a partial mask, since the revert subject verbatim re-contains the original closing-keyword text.
- **PR-vs-issue check**: `gh api "repos/$REPO/issues/$ISSUE" --jq 'has("pull_request")'` returns `true` for a PR — cheaper than a second `gh issue view` round trip, since GitHub's REST Issues API already returns PRs as a superset and marks them with a `pull_request` key.
- **Dedup marker**: the SHA-based check was solving "avoid a comment storm on every push to the same branch," not "avoid mentioning this exact SHA twice" — a branch-scoped HTML marker in the comment body serves that actual intent and survives amend+force-push, where SHA matching does not.
- **Batched-removal fix**: loop the per-label `gh issue edit --remove-label` call instead of building `REMOVE_ARGS` and passing every label to one `gh issue edit` invocation.
- **Pagination**: don't assume `gh issue view --json comments` truncates or doesn't — check it empirically against a real issue with >100 comments (or read `gh`'s source/docs for the `--json comments` field's page size) before deciding whether the `gh api --paginate` swap is needed.

### Key Files

- `.github/workflows/track-issue-fixes.yml` — both jobs' "Extract referenced issues" and label/comment steps.

## Gotchas

- The `|| true` pattern throughout this workflow is deliberate — it keeps one issue's failure from aborting the whole job for every other referenced issue in the same push. The PR-vs-issue and label-removal fixes must preserve that resilience (log-and-continue) while making the swallowed failure visible instead of fully silent.
- This workflow only triggers on `push` events to a real repo — there is no local way to trigger it end-to-end. Prefer testing the extraction/regex/pagination logic in isolation (pull the relevant `run:` block into a standalone script, or a fixture-driven unit test) over relying solely on live pushes to verify behavior.
- `label-fix-branch` and `cleanup-fix-labels` duplicate the same extraction step — apply the revert-detection fix to both, not just the one being actively tested.
- Assume `gh issue view --json comments` pagination behavior is unknown until checked (deliverable 5) — do not skip the empirical check on the assumption that it either does or doesn't paginate.

## Original request

Harden track-issue-fixes.yml edge cases (revert-awareness, PR-vs-issue, label-removal atomicity, pagination)

**Related:** none

Context: pre-release whole-branch review (9f4c49b1..HEAD) found 5 unverified edge-case gaps in the closing-keyword GitHub Action added by 33e542b7/e4735b23.

Scope: verify then fix — (1) no revert-commit awareness (re-triggers on `git revert`'s default subject); (2) closing-keyword number could resolve to a PR not an issue, `gh issue edit` failure silently swallowed by `|| true`; (3) SHA-based comment dedup misses amend+force-push of the same logical fix; (4) batched `--remove-label` call fails atomically on one rejected label; (5) comment-list fetch has no explicit pagination handling.

