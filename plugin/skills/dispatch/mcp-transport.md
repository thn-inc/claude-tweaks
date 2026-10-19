# Dispatch — GitHub MCP Transport (`gh` absent, or GraphQL-blocked)

Loaded by `/claude-tweaks:dispatch` when Preflight's Detection Ladder routes to the MCP transport —
either because check 2 resolves `gh` as absent, or because `gh` is present but check 3's
`gh repo view --json owner,name` probe fails with the GraphQL-unavailable signature (below). Every
call site in `SKILL.md` runs its `gh` CLI form unchanged when `gh` is present and check 3 passes
against it, so a normal run never reads this file.

## Preflight — the GraphQL-blocked branch (#2868)

A sandbox can have `gh` installed and authenticated via REST (`gh api user` succeeds) while its
outbound proxy blocks GitHub's GraphQL API specifically — every GraphQL-backed `gh` subcommand
(`gh repo view`, `gh issue list`, …) fails with a 403 whose message contains the literal substring
`GitHub GraphQL is not available`. Before this branch existed, that signature read as an ordinary
check 3 failure: a `gh`-present firing has no documented route to the MCP transport, so it stopped
at Preflight with no legal way forward even though the MCP tools are confirmed reachable in the
same sandbox.

**Detection:** when check 2 finds `gh` present, still run check 3's `gh repo view --json
owner,name` probe. Match its stderr/error text against the exact substring `GitHub GraphQL is not
available` — not every non-zero exit. A match routes to the MCP transport for the rest of this
firing (the same path `gh`-absent takes) and re-evaluates check 3 via this file's own `list_issues`
probe below. Any check 3 failure that does **not** match this signature (an unauthenticated token,
a real network/reachability problem, a renamed/moved repo the token can't see, etc.) stays an
ordinary hard stop on the `gh` transport — this branch only ever adds a route, never removes the
existing one, so a real auth or reachability failure is caught exactly as before.

**Log the transport choice.** The moment this branch fires, write one `decisions.md` line so a
later reader can tell this firing took the MCP path deliberately rather than by `gh` simply being
absent:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$RUN_DIR" --status AUTO \
  --section "/dispatch" --step "Preflight" \
  --text "check 3: gh present but GraphQL-blocked (GitHub GraphQL is not available) -- routing to MCP transport" \
  --reversibility n/a
```

**Code twin.** `bin/lib/policy-schema.js`'s `detectIntegrationModel` already accepts a
caller-supplied `opts.mcpReachable` override that short-circuits past its own `gh repo view` probe
straight to `pr-first` when a remote exists (`forge-detection.md`'s "Code twin" paragraph). A caller
that has just classified this same GraphQL-blocked signature can pass `mcpReachable: true` into
that function and get the identical routing — no code change needed there; this branch is prose-side
detection feeding an already-existing code-side override, not a second independent computation to
keep in sync.

Live as of Task 10 of **the bridge plan** — `docs/superpowers/plans/2026-08-02-dispatch-mcp-bridge.md`,
deleted `d83f0720`, and referred to by that short name for the rest of this file — which verified the
whole chain against a live cloud run and flipped Preflight's check 2 from a hard gate to a branch.
CRUD mappings throughout are per `_shared/github-write-transport.md`. Settle and the Auto-merge gate
have their own MCP notes in `settle-and-merge.md`; the self-report block's MCP mapping lives with
that block, in `_shared/headless-self-report.md`.

---

## Preflight — check 3 on the MCP transport

On either MCP-routed entry — `gh` absent, or `gh` present but GraphQL-blocked (above) — check 3
(authenticated + repo reachable) is satisfied via a bounded `list_issues` call (e.g. `list_issues {owner, repo, state: "open", perPage:
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

## Step 2 — `list_issues` `fields` parameter silently truncates labels (#3137)

**Confirmed live** (`gh`-absent firing, 2026-10-14): calling `list_issues` with an explicit `fields`
array that included `"labels"` returned a **silently truncated** labels array for every one of 11
candidates checked — e.g. issue #2807 actually carries `ready, risk:low, size:medium, type:task,
auto:build, bot:in-progress, priority:low` (7 labels, confirmed via `mcp__github__issue_read`'s
`get_labels` method), but the same issue came back from `list_issues` with only
`["ready","risk:low","size:medium","type:task"]` — missing `auto:build`, `bot:in-progress`, and
`priority:low` entirely, with no error or truncation flag.

Feeding a truncated labels array into `parseRecordFacets` (`bin/lib/issues/record.js`) can misjudge
`grants.build` / `bot.inProgress` / `bot.blocked` / `bot.parked` / `grants.merge` — a record whose
`bot:in-progress` label is dropped by the truncation looks falsely eligible to a headless firing,
risking a double-claim of a record another session already owns.

**Required workaround** — promoted the same way #2523's native blocked-by workaround (below) was
promoted in this file: before parsing facets from an MCP-sourced `list_issues` result for an
eligibility or exclusion decision, cross-check each surviving candidate's labels individually via
`mcp__github__issue_read` (`get` method's `labels` field, or the `get_labels` method) — never trust
the bulk `list_issues` labels array alone when `fields` was passed.

Omitting `fields` entirely (the unprojected response may return full labels) is plausible but
**unverified** against a live sandbox, so the per-candidate cross-check stays the required
mitigation. Re-open this section once a live run confirms whether omission avoids the truncation —
at that point, promote fields-omission to the default and update `queue-pull-script.md`'s MCP-path
note accordingly.

## Step 2 — cross-PR overlap report (#1579)

There is no confirmed MCP mapping for `gh pr list --json number,files,closingIssuesReferences` (a repo-wide open-PR listing with per-PR changed-file lists) yet. On the MCP transport, `queue-pull-script.md`'s cross-PR overlap fetch is skipped entirely and `dispatch-crosspr-overlap.json` is written as `[]` — the same fail-open posture as a `gh pr list` failure on the `gh` transport (SKILL.md Step 3's report renders nothing when its input is empty). This is a documented gap, not a silent one: the report is informational only (never a gate, per that section's AC2 fallback), so its absence on this transport costs a missed warning, not a missed exclusion.

## Step 2 — neighbour-in-flight pool (#3278, #3392)

`queue-pull-script.md`'s neighbour-in-flight pass needs `gh` for its pool list, its `gh repo view` slug and its claim-blob reads, so on this transport skip the pass's whole `if ! gh issue list … fi` block, its 200-cap warning block, its `node-eval-file.js` block and the `NEIGHBOUR_RC` check, and run these four steps in their place (step 4 carries its own stop on a non-zero exit). A Node subprocess cannot call MCP tools, so the agent fetches and Node computes. Fail open exactly as the `gh` branch does: a failed list or read prints one AUTO line and excludes nothing. Shell variables do not survive across tool calls, so begin each Bash call by re-running `queue-pull-script.md`'s opening `eval "$(node … node-eval-file.js …)"` block (the session-tmp paths are deterministic), and `echo "$DISPATCH_IN_FLIGHT_RAW" "$DISPATCH_IN_FLIGHT_CLAIMS"` once to get the literal paths the Write tool needs.

**1. Pool.** List the open `bot:in-progress` records through `list_issues` (`_shared/github-write-transport.md`'s "List open issues by label" row: label `bot:in-progress`, state open, body included, up to 200 records; `list_issues` returns at most 100 per page, so page until exhausted or 200 records are collected, and at exactly 200 print `Warning: the bot:in-progress pull for the neighbour-in-flight pass (#3278) returned exactly the --limit cap (200) — in-flight records beyond the cap are not checked as neighbours. Informational only; never blocks dispatch.`). Omit `fields`. The #3137 label truncation above reaches this pass only through `bin/lib/issues/grouping.js`'s `extractKeyFiles`: the `bot:in-progress` label filter runs server-side and liveness comes from the claim blob, but a record's origin label (`by:code-health`, `by:harness-health`, …) selects which extraction branch reads its Key Files, so a truncated `labels` array can drop a real neighbour edge. That fails open as a missed neighbour, settled at merge through `_shared/pr-first-merge.md`'s Conflict path; omitting `fields` is the mitigation (unverified live per #3137). Write `[{number, title, body, labels}]` to `$DISPATCH_IN_FLIGHT_RAW` with the Write tool. If the call fails, write `[]` there and print `AUTO — dispatch: neighbour-in-flight pool fetch failed; no neighbour-in-flight exclusions this pull`.

**2. Claim targets.** Print the in-flight records that neighbour some candidate, the only ones whose claim needs reading:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_IN_FLIGHT_RAW" <<NODE_EVAL_EOF
  const { neighbourClaimTargets } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/in-flight-neighbours.js');
  console.log(JSON.stringify(neighbourClaimTargets({ candidates: require(process.argv[1]).flat(), inFlight: require(process.argv[2]) })));
NODE_EVAL_EOF
```

**3. Claim reads.** For each printed number, read `claims/issue-{n}.json` on `claims-registry` through `_shared/issue-claims.md`'s file-blob path ("The lock" step 1's MCP bullet). Record the blob's decoded content as a string (or the parsed claim object — `claimReaderFromMap` accepts either), never the tool's `{content, sha}` response wrapper; a not-found response as `null`; and any other error as `{"failure": "{error}"}`. An entry that is neither a claim (`claimedAt`) nor a tombstone (`released`) counts as a failed read. Write the object, keyed by number, to `$DISPATCH_IN_FLIGHT_CLAIMS` with the Write tool on every pull, `{}` when nothing was printed, so an earlier pull's map is never read. A number left out of the map counts as a failed read. If step 2 or this Write cannot complete, write `[]` to `$DISPATCH_IN_FLIGHT_RAW`, print step 1's pool-fetch AUTO line, and skip step 4: the agent-side steps fail open like the `gh` branch's `if !` block, and only a failure of step 4's own Node call stops the pull.

**4. Exclusions.** Run the pass's computation over the map, through `claimReaderFromMap` (`bin/lib/dispatch/in-flight-neighbours.js`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_IN_FLIGHT_RAW" "$DISPATCH_EXCLUSIONS" "$DISPATCH_IN_FLIGHT_CLAIMS" <<NODE_EVAL_EOF
  const { neighbourInFlightExclusions, claimReaderFromMap } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/in-flight-neighbours.js');
  const { appendExclusion } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
  const { exclusions, unreadable } = neighbourInFlightExclusions({
    candidates: require(process.argv[1]).flat(), inFlight: require(process.argv[2]),
    readClaimContent: claimReaderFromMap(require(process.argv[4])), now: Date.now(),
  });
  for (const e of exclusions) appendExclusion(process.argv[3], e);
  if (unreadable.length) console.error('AUTO — dispatch: neighbour-in-flight claim read failed for #' + unreadable.join(', #') + '; treated as not in flight');
NODE_EVAL_EOF
```

A non-zero exit stops the queue pull, the same as the `gh` branch's `NEIGHBOUR_RC` check.

## Step 2 — open-linked-PR exclusion (#1224)

`bin/resolve-linked-prs.js` is the `gh`-transport only, same as `bin/resolve-blockers.js` (Step 2's queue pull and per-dependency open-state check, above). **Correction (#2523):** the claim below that "there is no MCP tool that answers the direction this check needs" was wrong for the *single-issue* case — `mcp__github__issue_read`'s `get` method returns a `closed_by_pull_requests` field (`{total_count, references: [{number, state, ...}]}`) that directly answers "does this issue have an open closing PR" for one already-known issue number, live-confirmed against a real issue (#2523 itself, `total_count: 0` when no closing PR exists). `_shared/github-write-transport.md`'s CRUD mapping still carries no dedicated PR-listing tool, and its one documented PR-read exception (`pull_request_read`, `get` method) still needs a PR *number* as input — but `issue_read`'s hierarchy field sidesteps that entirely by answering the issue-number-in direction directly, which the original investigation missed. **What's still an open gap:** batching. `bin/resolve-linked-prs.js` makes ONE batched, aliased GraphQL call across every queue-pull candidate (`record.js`'s `buildLinkedPRQuery` + `linked-prs.js`'s `fetchLinkedPRs`); the GitHub MCP server exposes no generic GraphQL passthrough tool, so the same N-candidate check via `issue_read` costs N individual tool calls instead of one — real at queue-pull scale (a `dispatch --budget` drain routinely screens dozens of candidates per firing), the same cost concern the Blocked-exclusion check documents for `resolve-blockers.js`'s native GraphQL query. On the MCP transport, `queue-pull-script.md`'s linked-PR query is still skipped and `dispatch-linked-prs.json` stays `{}` for a full drain — the fail-open posture is unchanged for that path. What changes is the narrower, already-adopted mitigation: `settle-and-merge.md`'s Claim-contest special case (#2402) already calls `issue_read` per-candidate at contest time, where the cost is one call for one already-known issue, not N — that mitigation's own doc no longer needs the "not covered by any MCP tool" framing, since it was always just calling a tool that answers the question, not working around a true gap. Re-open the batching gap specifically if the GitHub MCP server ever adds a batched issue-linked-PRs query or a generic GraphQL passthrough tool. **Required workaround already documented:** the next section below ("native blocked-by / linked-PR batching: no generic GraphQL bridge (#2523)") carries the standing, required per-candidate `issue_read` verification step this gap needs on a `gh`-absent firing — see it directly rather than re-deriving the mitigation (#2051).

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
