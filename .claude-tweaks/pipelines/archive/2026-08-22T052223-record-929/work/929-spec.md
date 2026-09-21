---
record: 929
origin: human
risk: medium
size: medium
ceremony: standard
grants: [build]
surface: backend
---
# 929: PR body HTML comments stripped via gh-CLI-absent MCP transport — breaks pr-early-run-lifecycle.md's marker contract

Surface: backend

Defer-reason: tangential

## Current State

`_shared/pr-early-run-lifecycle.md` requires the `<!-- claude-tweaks-run: {run-id} -->` marker as the PR body's first line (unconditionally — "the GitHub-side signal the sweep ... and the reconciler ... key on to recognize a plugin-created PR without a local run-dir join") and requires `<!-- phases-start -->`/`<!-- phases-end -->` HTML comments to delimit the phase checklist so the phase-checklist-update procedure can find-and-replace reliably.

Discovered live during #670's wrap-up (run `2026-08-19T161910-record-670`, PR #928): this repo has no `gh` CLI in the current sandbox, so PR creation and updates route through `mcp__github__create_pull_request`/`update_pull_request` (`_shared/github-write-transport.md`'s MCP path) instead of `gh pr create`/`gh pr edit`. Composed a body with all three HTML comments present (verified byte-for-byte in the request), created the PR, then re-fetched it via `pull_request_read get` — every one of the three comments (`claude-tweaks-run` marker, `phases-start`, `phases-end`) was gone from the returned body. Re-composed and re-submitted via `update_pull_request` with the same markers present; re-fetched again — still gone. The checklist text itself (the `- [ ] build` lines etc.) survives; only the HTML comment lines are stripped. Confirmed twice, on both `create_pull_request` and `update_pull_request`.

This means: on any `gh`-absent sandbox (the CLAUDE.md-documented case this repo already anticipates — "a `gh`-absent env, typically cloud Routine sandbox"), a `pr-first` run's PR is invisible to the reconciler's marker-based recognition, and the phase-checklist-update procedure's find-the-markers-and-replace approach has nothing to find on the second and later writes.

## Deliverables

1. Confirm root cause: is the stripping done by the GitHub MCP server itself (sanitizing `body` before the API call), or by GitHub's API/GraphQL mutation path the MCP server uses (as opposed to the REST path `gh` uses)? A quick way to narrow it: create a plain GitHub issue (not a PR) via `mcp__github__issue_write` with an HTML comment in the body and check whether it survives — issues and PRs share the same underlying body field type, so a clean isolation test.
2. If MCP-server-side: file upstream against the MCP server (or find a body-encoding workaround — e.g., does escaping `<!--`/`-->` as HTML entities on write, then reading it back literally, survive round-trip?).
3. If GitHub-API-side (the mutation path the MCP tool uses truly does not preserve HTML comments): `_shared/pr-early-run-lifecycle.md` and `_shared/github-write-transport.md` need a documented fallback marker scheme that survives this transport — e.g., a zero-width-safe plain-text sentinel line (`claude-tweaks-run: {run-id}` with no comment syntax) that renders visibly but degrades gracefully, plus whatever the reconciler and phase-checklist-update procedure need to recognize it as well as the comment form.
4. Update `_shared/pr-early-run-lifecycle.md` and `_shared/github-write-transport.md` to state the finding and the chosen fallback, so a future `gh`-absent run doesn't silently produce an unrecognizable PR the way #670's did until this issue was filed.

## Acceptance Criteria

- Root cause identified and stated in the relevant `_shared/*.md` file(s).
- A marker scheme is documented that provably survives the `gh`-absent MCP write path (verified by the same create-then-refetch test that surfaced this issue).
- `_shared/pr-early-run-lifecycle.md`'s Step 3 and Phase-checklist-update section reflect the working scheme (with an explicit `gh`-present vs `gh`-absent branch if the two paths now need different marker syntax).

## Gotchas

- The checklist body text (`- [ ] build`, etc.) is NOT affected — only literal `<!-- -->` HTML comment lines are stripped. A fix that changes marker syntax must not also change how the checklist rows themselves are composed/parsed.
- Test on both `create_pull_request` and `update_pull_request` — this issue confirmed the strip on both, but a fix should not assume they share one code path without checking.

## Original request

Discovered as a side-finding while executing #670's wrap-up phase (not itself part of #670's scope — that record's PR-open was itself a retroactive catch-up, since #670's own run-start push/PR-open never executed in the first dispatch call).

**Category:** tangential
**Severity:** med — breaks reconciliation/audit-trail machinery for every `gh`-absent `pr-first` run, but degrades silently (no run fails outright) until someone needs the marker
**Reversibility:** high
**Source:** `/claude-tweaks:flow #670 review,polish,wrap-up`, run `2026-08-19T161910-record-670`
**Files:** `plugin/skills/_shared/pr-early-run-lifecycle.md`, `plugin/skills/_shared/github-write-transport.md`

## Finding

`mcp__github__create_pull_request` and `mcp__github__update_pull_request` both silently strip `<!-- ... -->` HTML comments from the PR body, even when explicitly composed and verified present in the outgoing request. `pr-early-run-lifecycle.md`'s entire marker mechanism (`claude-tweaks-run` run-id marker, `phases-start`/`phases-end` delimiters) assumes these comments survive — true for `gh pr create --body-file`, not verified true (and now verified false) for the MCP path this repo's own `gh`-absent sandboxes are documented to use.

## Suggested resolution

See Deliverables above — narrow root cause, then either work around the stripping or adopt a plain-text marker scheme documented as the `gh`-absent fallback.

