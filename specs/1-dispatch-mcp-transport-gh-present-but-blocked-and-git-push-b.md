## Current State

In this cloud Routine sandbox, `gh` CLI is installed but its token is proxy-restricted to a narrow pinned set of PR-review GraphQL operations only — general `gh issue`/`gh pr`/`gh api` calls fail with "GitHub access is not enabled for this session" (REST) or "This GraphQL query is not enabled for this session" (GraphQL). `git push` also fails with HTTP 403 (same credential scoping). This differs from the documented "gh absent" case (`skills/dispatch/mcp-transport.md`, CLAUDE.md's Cloud parity section already anticipate `gh` being *absent* and route via MCP) — here `gh` is *present but authenticated-and-blocked*, and `git push` itself (not just `gh`) is also blocked, which no existing doc covers.

Concretely, during a `/claude-tweaks:dispatch next` firing on 2026-09-08 (run `2026-09-08T161523-dispatch-standalone`, dispatched group #1890+#1301, run dir `2026-09-08T161952-record-1301`):

- `resolve-blockers.js` (native `work-links: native` blockedBy check) and `resolve-linked-prs.js`/`gh pr list` (cross-PR overlap report #1579) both degraded to their documented fail-open empty-result posture, since neither has an MCP mapping.
- `mcp__github__issue_read`'s `get` method returns a `closed_by_pull_requests` field that DOES cover the open-linked-PR exclusion (#1224) case `mcp-transport.md` currently marks as "no confirmed MCP mapping yet" — used manually this run (6 `issue_read` calls) and it correctly caught #1594 already having an open linked PR (#1908), which the fail-open default would have missed and re-dispatched.
- The pr-first draft-PR-at-run-start `git push` failed (HTTP 403); the dispatched build,test and review,polish,wrap-up Task agents recovered by using the MCP contents-API fallback (`push_files`/`create_pull_request`) instead, successfully opening PR #2088.

Evidence lives in `.claude-tweaks/pipelines/2026-09-08T161523-dispatch-standalone/decisions.md`.

## Deliverables

- [ ] Document the git-push-blocked-with-MCP-fallback failure mode (distinct from the already-documented gh-absent case) alongside the existing gh-absent MCP transport docs (`skills/dispatch/mcp-transport.md`, `skills/_shared/github-write-transport.md`), including the `push_files`/`create_pull_request` recovery path.
- [ ] Bridge the open-linked-PR exclusion check (#1224) in `mcp-transport.md`/`queue-pull-script.md` to use `issue_read`'s `closed_by_pull_requests` field instead of leaving it as an accepted gap, since a working substitute exists.
- [ ] Investigate whether `resolve-blockers.js`'s native blockedBy check and the cross-PR overlap report (#1579) have any similar available MCP substitute, or explicitly confirm and document that they do not.

## Acceptance Criteria

- The MCP-transport docs distinguish "gh absent" from "gh present but proxy-blocked, git push also blocked" and name the MCP fallback for each affected call site.
- The open-linked-PR exclusion check (#1224) uses the `issue_read`/`closed_by_pull_requests` MCP mapping when `gh` is unavailable, rather than failing open.
- The native-blockedby and cross-PR-overlap gaps are either closed with a working MCP substitute, or explicitly confirmed as having none, with that confirmation recorded in the docs.

Defer-reason: tangential
