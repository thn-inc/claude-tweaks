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

`bin/resolve-linked-prs.js` is the `gh`-transport only, same as `bin/resolve-blockers.js` (Step 2's queue pull and per-dependency open-state check, above). **Investigated and confirmed infeasible for now (#2402):** unlike the confirmed rows above (`list_issues` for the label-scoped queue pull, `issue_read` for the per-dependency open-state check), there is no MCP tool that answers the direction this check needs — issue number → its open closing PR. `_shared/github-write-transport.md`'s CRUD mapping deliberately carries no PR-listing tool ("Pull requests are not covered by this mapping"), and its one documented PR-read exception (`pull_request_read`, `get` method — used by `_shared/issue-claims.md`'s in-flight check and `_shared/pr-checklist-refresh.md`) takes a PR *number* as input, which is exactly the value this check doesn't have yet: it can confirm an already-known PR is still open, not discover an unknown one from an issue number. No batched or per-candidate MCP path closes this gap without a tool the GitHub MCP server doesn't expose today. On the MCP transport, `queue-pull-script.md`'s linked-PR query is skipped and `dispatch-linked-prs.json` stays `{}`, so every candidate reads as having no open linked PR — the same fail-open posture the cross-PR overlap report above already accepts, but with a real cost this time: unlike that report (informational only), this check is the actual re-dispatch exclusion #1224 exists to add, so a `gh`-absent firing degrades to the pre-#1224 behavior (the bug this record fixes) rather than losing only a warning. Mitigated, not closed: a contested-claim headless self-report now enriches its diagnostic body with this same lookup on the `gh` transport when it succeeds (`settle-and-merge.md`'s Claim-contest special case, #2402) — the fail-open window still exists on the MCP transport, but no longer costs a human a manual PR lookup to discover it after the fact once a self-report has already been filed. Re-open if the GitHub MCP server ever adds an issue-linked-PRs or a PR-listing tool.
