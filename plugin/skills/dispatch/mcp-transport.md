# Dispatch — GitHub MCP Transport (`gh` absent)

Loaded by `/claude-tweaks:dispatch` only when Preflight's Detection Ladder check 2 resolves `gh` as
absent. Every call site in `SKILL.md` runs its `gh` CLI form unchanged when `gh` is present, so a
normal run never reads this file.

Live as of Task 10 of **the bridge plan** — `docs/superpowers/plans/2026-08-02-dispatch-mcp-bridge.md`,
deleted `d83f0720`, and referred to by that short name for the rest of this file — which verified the
whole chain against a live cloud run and flipped Preflight's check 2 from a hard gate to a branch.
CRUD mappings throughout are per `_shared/github-write-transport.md`. Settle and the Auto-merge gate
have their own MCP notes in `settle-and-merge.md`; the self-report block's MCP mapping lives with
that block, in `_shared/headless-self-report.md`.

---

## Preflight — check 3 on the MCP transport

When `gh` is absent, check 3 (authenticated + repo reachable) is
satisfied via a bounded `list_issues` call (e.g. `list_issues {owner, repo, state: "open", perPage:
1}`) — a lightweight, confirmed-working read (per the bridge plan's Task 2 live verification)
that fails identically to `gh repo view --json owner,name` when auth or
repo access is broken. This is dispatch-specific documentation: only dispatch treats check 3 as a
hard gate that needs an MCP equivalent — `_shared/github-pr-scan.md` itself defines check 3 purely
as `gh repo view`, unchanged, since its other consumers (`/help`, `/tidy`) fail-open on this ladder
and don't need one.

## Preflight — why check 2 no longer gates on its own

Check 2 no longer gates on its own as of the bridge plan's Task 10 — every call site that used to be
`gh`-only end to end (Step 2's queue pull and dependency checks, the contested-claim comment
fetch, all of `settle-and-merge.md`) now has a confirmed, live-verified MCP path (its Tasks 1-2
diagnostic Routine). A prior attempt at this same bridge (`274e30e`, reverted the next day as `d4bdfb9`) shipped this
exact gate change without finishing the read-path bridge first, producing an unstructured
`gh: command not found` crash instead of a clean stop — this version does not repeat that
mistake, since every call site was bridged and verified before this line changed.

## Step 2 — queue pull and per-dependency open-state check

The queue pull uses the confirmed "list issues by label" mapping; the per-dependency open-state check (the `gh issue view "$DEP" --json state` loop) uses the confirmed "get single issue by number" mapping, checking the returned state field for `OPEN`. Both replace their `gh`-CLI equivalent one-for-one — no change to the surrounding `node -e` eligibility/dependency logic, which only consumes the fetched JSON shape, not how it was fetched.

## Step 2 — cross-PR overlap report (#1579)

There is no confirmed MCP mapping for `gh pr list --json number,files,closingIssuesReferences` (a repo-wide open-PR listing with per-PR changed-file lists) yet. On the MCP transport, `queue-pull-script.md`'s cross-PR overlap fetch is skipped entirely and `dispatch-crosspr-overlap.json` is written as `[]` — the same fail-open posture as a `gh pr list` failure on the `gh` transport (SKILL.md Step 3's report renders nothing when its input is empty). This is a documented gap, not a silent one: the report is informational only (never a gate, per that section's AC2 fallback), so its absence on this transport costs a missed warning, not a missed exclusion.

## Step 2 — open-linked-PR exclusion (#1224)

`bin/resolve-linked-prs.js` is the `gh`-transport only, same as `bin/resolve-blockers.js` (Step 2's queue pull and per-dependency open-state check, above). **Correction (#2523):** the claim below that "there is no MCP tool that answers the direction this check needs" was wrong for the *single-issue* case — `mcp__github__issue_read`'s `get` method returns a `closed_by_pull_requests` field (`{total_count, references: [{number, state, ...}]}`) that directly answers "does this issue have an open closing PR" for one already-known issue number, live-confirmed against a real issue (#2523 itself, `total_count: 0` when no closing PR exists). `_shared/github-write-transport.md`'s CRUD mapping still carries no dedicated PR-listing tool, and its one documented PR-read exception (`pull_request_read`, `get` method) still needs a PR *number* as input — but `issue_read`'s hierarchy field sidesteps that entirely by answering the issue-number-in direction directly, which the original investigation missed. **What's still an open gap:** batching. `bin/resolve-linked-prs.js` makes ONE batched, aliased GraphQL call across every queue-pull candidate (`record.js`'s `buildLinkedPRQuery` + `linked-prs.js`'s `fetchLinkedPRs`); the GitHub MCP server exposes no generic GraphQL passthrough tool, so the same N-candidate check via `issue_read` costs N individual tool calls instead of one — real at queue-pull scale (a `dispatch --budget` drain routinely screens dozens of candidates per firing), the same cost concern the Blocked-exclusion check documents for `resolve-blockers.js`'s native GraphQL query. On the MCP transport, `queue-pull-script.md`'s linked-PR query is still skipped and `dispatch-linked-prs.json` stays `{}` for a full drain — the fail-open posture is unchanged for that path. What changes is the narrower, already-adopted mitigation: `settle-and-merge.md`'s Claim-contest special case (#2402) already calls `issue_read` per-candidate at contest time, where the cost is one call for one already-known issue, not N — that mitigation's own doc no longer needs the "not covered by any MCP tool" framing, since it was always just calling a tool that answers the question, not working around a true gap. Re-open the batching gap specifically if the GitHub MCP server ever adds a batched issue-linked-PRs query or a generic GraphQL passthrough tool.

## Step 2 — native blocked-by / linked-PR batching: no generic GraphQL bridge (#2523)

`bin/resolve-blockers.js` (`work-links: native`'s blocked-by check) and `bin/resolve-linked-prs.js`
(the #1224 open-PR exclusion, corrected above) both hard-require `gh` — `bin/lib/issues/
native-dependencies.js`'s `fetchNativeDependencies`/`fetchNativeSubIssues` and `linked-prs.js`'s
`fetchLinkedPRs` each issue one hand-built, batched, aliased `gh api graphql` query across every
candidate in a single call. **Investigated (#2523): no MCP bridge exists for either.** The GitHub
MCP server's tool surface (`_shared/github-write-transport.md`'s CRUD mapping) exposes no generic
GraphQL passthrough tool, so there is no way to submit these hand-built aliased queries through MCP
at all — this is a structural gap in the MCP server's tool surface, not a missing mapping this
codebase could add on its own side.

On a `gh`-absent transport, `queue-pull-script.md`'s calls to both scripts fail (the "Warning:
native dependency query failed" / "Warning: linked-PR query failed" lines that file's Step 2
already emits) and dispatch degrades to "no native filtering" / "no open-PR exclusion" for the
whole firing — every queue-pull candidate is treated as unblocked and PR-free regardless of its
real state. **Documented, required workaround** — promoting #2051's own recommendation from a
one-off firing improvisation to a standing step: before finalizing group selection on a `gh`-absent
firing, manually verify each surviving top-ranked candidate (not the whole queue — just the
candidate(s) about to be dispatched) via a per-candidate `mcp__github__issue_read` (`get` method)
call, reading `closed_by_pull_requests.references[].state` for the open-PR check (per the #1224
correction above) and — for `work-links: native` blocked-by — reading the candidate's own body text
for any `blocked-by:`/dependency mentions as a best-effort substitute (native GraphQL `blockedBy`
has no MCP equivalent at all, so this is a degrade, not a full replacement: a native-only dependency
relationship with no matching body-text mention is invisible on this path). This is exactly what
this record's own filing session did live (2026-09-16T14:19Z firing): the automated top-ranked pick
(#2259) already had an open PR (#2450), and #2051, #2329, #1135, plus the #2267/#2268/#2269 family
(natively blocked by open #2265) were all falsely eligible until this manual check caught them.

Re-open this section if the GitHub MCP server ever adds a generic GraphQL passthrough tool or
batched equivalents of `buildNativeDependencyQuery`/`buildLinkedPRQuery`.
