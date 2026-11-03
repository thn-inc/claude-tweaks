# GitHub PR Scan — Triage-Queue Scope

Split from `_shared/github-pr-scan.md` (#4820) when that file reached the Read-limit rail (`RAIL_BYTES`) — a headroom-forced split, not a designed boundary. That file's Detection Ladder and Transport rule still govern the scope below. Consumed by `/claude-tweaks:help` Stage 4.6 (`help/status-scan.md`) only — subagents cannot read this file, so the dispatcher inlines the scope section below whole, its Fetch limit rule and render line included, into the scan agent's prompt.

## Scope: `triage-queue` (consumed by /help Stage 4.6)

Three cheap counts for the dashboard's Triage Queue section. This scope exists so `/help` never hand-writes its own query for these numbers — see the fix this closes: Stage 4.6 previously computed "pending authorization" without excluding `bot:blocked` records, so a blocked record counted as both pending AND blocked on the same dashboard.

**Fetch limit.** `{resolved-limit}` is the number `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values backlog-fetch-limit` prints, substituted literally into each command and block below, every occurrence; shell state does not survive between Bash calls. A fetch returning that many rows, or 1000 for a `--label` fetch (GitHub's cap), may be truncated: a block that checks prints a `WARNING:` line, and any other count at the cap is a floor, never a final count. Report every `WARNING:` line verbatim beside this scope's rows, never suppressed, and render a floor count as `{N}+`.

**Transport split (see `_shared/github-pr-scan.md`'s Transport section):** items 1 and 2 are issue-backed and run unchanged on either transport. Item 3's commits-endpoint query has no MCP equivalent — on `gh`-absent it degrades individually (omit the "Auto-merged this week" line rather than the whole scope).

1. **Pending authorization** — `ready` ∧ no `auto:*` ∧ no `bot:*` (`bot:in-progress`, `bot:blocked`, or `bot:parked`). Origin-agnostic: matches `/claude-tweaks:backlog refine`'s own `ready`-queue pull (`skills/backlog/refine-mode.md`), which tiers no health-skill origin specially — every `ready` record, with or without a `by:*` label, is in scope.

   Resolve this item's session-scoped temp path first, per `_shared/session-tmp-root.md`:

   ```bash
   TRIAGE_QUEUE_READY="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value triage-queue-ready.json)"
   gh issue list --label ready --state open --json number,labels --limit {resolved-limit} > "$TRIAGE_QUEUE_READY"
   node -e "
     const { parseRecordFacets } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
     const { isPendingAuthorization } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/pending-authorization.js');
     const issues = require('$TRIAGE_QUEUE_READY');
     if (issues.length >= Math.min({resolved-limit}, 1000)) console.error('WARNING: [triage] the ready fetch reached its cap — the pending count is a floor');
     const pending = issues.filter((i) => isPendingAuthorization(parseRecordFacets(i.labels))).length;
     console.log(pending);
   "
   ```

2. **Blocked** — `gh issue list --label bot:blocked --state open --json number --limit {resolved-limit} -q 'length'`

<!-- when: transport=gh -->
3. **Auto-merged this week** — `[fast-lane]`-tagged, `[auto-merge]`-tagged, or
   `[manifesto-authorized]`-tagged commits on the *default* branch (never the current worktree's
   own branch — see the note on `worktree-always` below), last 7 days. All three skip the
   interactive finish-branch prompt because `merge-check` already cleared it — that is what this
   metric counts, not headlessness: `[auto-merge]` is always dispatch-originated (singleton or
   bundle, both via `dispatch/settle-and-merge.md`'s Dispatching-session merge execution —
   genuinely headless); `[fast-lane]` (`wrap-up/review-console.md`'s Auto-merge short-circuit) is
   reachable only by an interactive, human-run single-record `/flow` — its own dispatch-call
   branch redirects a dispatch-originated singleton to `[auto-merge]` instead, so a `[fast-lane]`
   commit is never headless; `[manifesto-authorized]` (`wrap-up/manifesto-authorized-merge.md`,
   the `merge-authorization` lever) is likewise human-originated, never dispatch-originated — it
   requires a human answer (a Manifesto `confirm`/`hybrid` override, or the human-typed `/flow`
   `pre-authorize-merge` token, which a dispatch-bound run ignores). A human-authored Routine
   prompt or alias can bake the token in, so a `[manifesto-authorized]` commit can come from a
   headless firing — a standing human choice, not a live per-run one; the tag counts the
   authorization route, not headlessness.
   `[human-approved]` (close-out's confirmed merge) is excluded — a human decided it.

   ```bash
   SINCE=$(node -e "console.log(new Date(Date.now() - 7*24*60*60*1000).toISOString())")
   gh api "repos/{owner}/{repo}/commits?since=${SINCE}&per_page=100" -q '[.[] | select(.commit.message | contains("[fast-lane]") or contains("[auto-merge]") or contains("[manifesto-authorized]"))] | length'
   ```

   The commits endpoint defaults to the default branch when no `sha=` param is given — correct regardless of which branch/worktree `/help` itself runs from under `worktree-always`. `SINCE` is computed via `node`, not shell `date` arithmetic, which differs between BSD/macOS and GNU date.
<!-- /when -->

Render as three lines: `Pending authorization: **{N}** records awaiting your decision` / `Blocked: **{N}** records blocked (retry ceiling, or a plan-review question awaiting an answer)` / `Auto-merged this week: **{N}** auto-merges` — omit any line whose count is 0.
