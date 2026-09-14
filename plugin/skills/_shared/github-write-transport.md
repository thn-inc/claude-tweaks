# GitHub Write Transport — gh CLI locally, GitHub MCP tools in cloud Routines

Single source of truth for choosing between `gh` CLI and GitHub MCP tools for a plain
CRUD GitHub write (list-by-label, create, edit/label, comment, close). Flow's claim lock
(the one remaining hard compare-and-set case using this mapping) doesn't use it directly —
see `_shared/issue-claims.md`, built on the conditional-write pattern documented at the
bottom of this file. Health-state's cursor writes (`_shared/health-state.md`) no longer use
this file at all — they're plain Git Data API primitives (blob/tree/commit/ref) with no
GitHub-specific semantics, so they use `git` directly (fetch/hash-object/mktree/commit-tree/
push) rather than choosing between `gh` and MCP.

## Detection

`gh` present (`command -v gh` exits 0) → use it exactly as documented at each call site,
unchanged. `gh` absent → use the MCP tool from the mapping below. This is a capability
probe, not an environment classification — it holds regardless of *why* `gh` is missing.

## CRUD mapping

| Operation | gh CLI | GitHub MCP tool |
|---|---|---|
| List open issues by label | `gh issue list --label {label} --state open --json ...` | `list_issues` (filtered by label, state) — never `search_issues` for a find-by-marker/dedup lookup (see below) |
| Create an issue | `gh issue create --title ... --body ...` | `issue_write` (create mode) |
| Edit labels / body | `gh issue edit {n} --add-label/--remove-label/--body-file` | `issue_write` (update mode) |
| Comment | `gh issue comment {n} --body-file` | `add_issue_comment` |
| Close | `gh issue close {n} --reason ...` | `issue_write` (update mode, state change) |
| Get a single issue by number | `gh issue view {n} --json state,...` | `issue_read` (get mode) |
| List an issue's comments | `gh api repos/{owner}/{repo}/issues/{n}/comments?per_page=100` | `issue_read` (get_comments mode) |

**Pull requests are not covered by this mapping.** Every row above is an issue operation — there
is no `list_pull_requests`/`pr_read`/`pr_write` row, and none is planned: PR review-thread reads
(`gh api graphql`), CI-check reads (`gh pr checks`), and PR list/view reads (`gh pr list`/
`gh pr view`) have no MCP equivalent today. A `gh`-absent consumer that needs a PR read degrades
that read individually rather than treating the missing mapping as a reason to skip everything
it does — `_shared/github-pr-scan.md`'s Transport section is the canonical example: issue-backed
items in a scope route through this file's `list_issues` row, PR-backed items in the same scope
degrade per-item with a narrower message instead. This resolves the gap deliberately (a
documented per-item degrade) rather than leaving it implicit.

**Exception: PR create/update (#929).** Create and update *are* covered, just not by a table
row — `gh pr create --body-file`/`gh pr edit --body-file` locally,
`mcp__github__create_pull_request`/`mcp__github__update_pull_request` when `gh` is absent.
Unlike every read-side gap named above, this is a write, and the MCP server's PR-body
sanitization (`_shared/pr-early-run-lifecycle.md`'s "Root cause" section) only ever touches
what a *read* returns to the LLM — `create_pull_request`/`update_pull_request` write the
`body` parameter straight through, unsanitized. A caller composing a PR body with
`_shared/pr-early-run-lifecycle.md`'s dual-marker scheme (HTML comment + plain-text
companion) can use either transport interchangeably for creation/update; only a *later read*
of that body needs to pick its marker form per-transport (`_shared/pr-checklist-refresh.md`'s
Phase-checklist update section).

**Never use `search_issues` (or `gh issue list --search`) for a find-by-marker/dedup lookup.**
Both ride an eventually-consistent search index — this caused three real duplicate-digest
production incidents when `tidy`'s Rolling digest briefly used `gh issue list --search`
(#1016, #1079, #1089). Always use the plain list-then-filter approach (`list_issues`/
`gh issue list`, no `--search`, then `findByMarker` in-process), on both transports.

**Sanctioned alternative for a marker *count* over a label-scoped set** (not a lookup by number —
a tally, like "how many issues carry today's marker in a comment"): list-then-read-comments,
never search. List the label-scoped issue set (the row above), then read each one's comments (the
"List an issue's comments" row below) and filter/count client-side. `/claude-tweaks:backlog
grant`'s Cap tracking section (`backlog/mcp-transport.md`) is the reference consumer — see that
file for the full bounded procedure and its accepted small undercount caveat.

**Sizing the list-then-filter window.** With `--search` gone, `--limit` (or `list_issues`' page
size) is the only thing narrowing the read — so an under-sized window silently reintroduces by
truncation the same dedup-miss the rule above prevents by dropping the index. Size it from the
scope of *this* list, never by copying another call site's number: a label-scoped lookup
(`_shared/headless-self-report.md`'s `--label by:{caller} --state open --limit 500`) is bounded by
that label's cardinality; an unscoped `--state all` lookup is bounded by the repo's whole issue
history. Measure before choosing —
`gh issue list --state all --limit 100000 --json number | jq length` — and read a result equal to
the cap as truncated, not complete. #1094 is the case: `findDuplicate`
(`bin/lib/feedback/file-feedback.js`) copied that 500 without the label, and truncated roughly
half of this repo's then-998 issues.

**Snapshot invalidation.** Every write in the Create / Edit labels / Close rows above changes
what a `gh issue list --state all` pull would return, so it stales the session-scoped record
snapshot (`_shared/record-queue-fetch.md`) if one exists for this session. Immediately after any
such write succeeds, on either transport, call
`require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').invalidateSnapshot(process.env.CLAUDE_CODE_SESSION_ID)`
so the next consumer re-fetches instead of reading stale state. A no-op when no snapshot exists
for this session (nothing to invalidate) or when `$CLAUDE_CODE_SESSION_ID` is unset (a
snapshot-less caller was never caching in the first place).

## The conditional-write pattern (flow's claim lock)

Flow's claim lock (Step 2.8, `flow/claim-targets.md` — reached whether `/claude-tweaks:dispatch`
handed off the run or a human invoked `/flow` directly) needs "write this, but only if nothing
else wrote first." `gh`'s
ref-level compare-and-set (atomic create, fast-forward-only update) has no MCP equivalent —
but `create_or_update_file` carries the identical guarantee one level down, at the file-blob
level: omit its `sha` parameter and the write fails if the file already exists; supply a
stale `sha` and it fails on mismatch. The claim lock uses this primitive against a dedicated
branch, gated on the same detection check above — see `_shared/issue-claims.md` for the full
procedure. Health-state's cursor CAS is *not* this pattern (it is a plain non-force `git
push`) — see the note at the top of this file before adding it back here.

## Pacing scripted mutation sequences

Any scripted sequence of mutative calls through either transport follows
`_shared/github-rate-limit.md`'s burst-shape authoring rules. That file also owns recognizing
and classifying a rate-limit failure encountered on either transport — this file's CRUD
mapping and conditional-write pattern above are unaffected.
