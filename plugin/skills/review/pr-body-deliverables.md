# Step 1 item 6 — PR-body deliverables

Read by `code-mode-steps.md` Step 1 item 6, only when the spec has a deliverable or criterion whose content must appear in the PR body (or PR description). Items 1 and 2 skip such an item; this file judges it.

## Which items

An item qualifies when what it requires is text in the PR body itself: "the PR body reports the before/after counts", "the PR description names the shortfall". An item that changes the code or skill prose which writes PR bodies does not qualify, however often it says "PR body": items 1 and 2 judge it in the codebase as usual.

## Find the PR

`{pr}` is `pr.number` in `run-state.json` (a bundle's parent run dir). Otherwise it is the current branch's open PR: `gh pr view --json number` with no number, or, without `gh`, `mcp__github__list_pull_requests` (open PRs) filtered to the one whose head is the current branch.

## Read the body

`gh pr view {pr} --json body -q .body`, or, without `gh`, `mcp__github__pull_request_read` (`get`). An MCP read strips the body's HTML-comment markers, which does not matter here: only the content is judged.

## Verdict

- `done` — the body carries everything the item requires.
- `partial` — it carries part of it.
- `missing` — the body was read and lacks it.
- `unverifiable` — no PR was found, or the read failed. It is never counted as present and never blocks: the Gate treats it as a minor gap whatever the count, and Step 7's summary names each one so a human can check the body.

A build decision line claiming the body carries the item is not evidence; only the body is.
