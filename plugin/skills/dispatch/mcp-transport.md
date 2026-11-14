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

A Node subprocess cannot call MCP tools, so on this transport the agent fetches every input below with MCP tools and writes each one with the Write tool, and only then runs `bin/queue-pull.js` with `--transport files`, which reads those files and does the whole computation (SKILL.md Step 2 routes its exit codes). The CLI never falls back from `gh` to `files` on its own: Preflight's result above (`gh` absent or GraphQL-blocked) is what selects `files`. The queue pull uses the confirmed "List open issues by label" mapping and each dependency read the confirmed "Get a single issue by number" mapping (`_shared/github-write-transport.md`); a failed read degrades as that file and the sections below say. Resolve each `{name}` below to its literal path once, with `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value {name}` (`_shared/session-tmp-root.md`), and write every file on every pull, so an earlier pull's file is never read. Write the raw MCP JSON: `list_issues`/`issue_read` return snake_case timestamps, and the CLI aliases them itself on `--transport files` (`#3691`, section below). The inputs, each by its flag:

- `--queue-raw "{dispatch-queue-raw.json}"`: the open `auto:build` records from `list_issues` (label `auto:build`, state open, body included; up to 500 records, paging 100 at a time; the CLI prints the 500-cap Warning itself). Shape `[{number, title, body, labels, created_at, updated_at, state}]`. The CLI reads every eligibility facet from these `labels`, so before this Write replace each record's `labels` with the ones `issue_read` returns for it (the `#3137` section below).
- `--open-numbers "{dispatch-open-numbers.json}"`: the open issues from `list_issues` (state open, up to 200 records). Shape `[{number}]`.
- `--dep-freshness "{dispatch-dep-freshness.json}"`: one `issue_read` result, open or closed, per dependency: each `Blocked by #N` number in the body of a queue record that carries none of `bot:in-progress`, `bot:blocked` or `bot:parked`. Shape `[{number, updated_at, state}]`; a number `issue_read` cannot read is left out, and the file is `[]` when no such record declares a dependency.
- `--verified-open-deps "{dispatch-verified-open-deps.txt}"`: each of those dependencies that is missing from the open-numbers file and whose `issue_read` state is open (any case); this replaces the `gh issue view "$DEP" --json state` loop. Plain text, one number per line; empty when there is none.
- `--in-flight-raw "{dispatch-in-flight-raw.json}"`: the neighbour-in-flight pool (section below). Shape `[{number, title, body, labels}]`.
- `--in-flight-claims "{dispatch-in-flight-claims.json}"`: the claim of every record in that pool (section below). Shape `{"<n>": <claim>}`, keyed by issue number.
- `--foreign-states "{dispatch-foreign-states.json}"`: the state of each `Blocked by owner/name#N` ref in the body of a queue record that carries none of `bot:in-progress`, `bot:blocked` or `bot:parked` (the #2523 section below). Shape `{"owner/name#N": "<state>"}`; `{}` when no such record declares one.

When every file is written, run this, each `{name}` replaced by its resolved path:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/queue-pull.js" --transport files \
  --queue-raw "{dispatch-queue-raw.json}" --dep-freshness "{dispatch-dep-freshness.json}" \
  --open-numbers "{dispatch-open-numbers.json}" --verified-open-deps "{dispatch-verified-open-deps.txt}" \
  --in-flight-raw "{dispatch-in-flight-raw.json}" --in-flight-claims "{dispatch-in-flight-claims.json}" \
  --foreign-states "{dispatch-foreign-states.json}"
```

It writes the same session-scoped outputs as `--transport gh` (`dispatch-groups.json`, `dispatch-exclusions.json` and the report files) and makes no `gh` call of its own. The passes whose spawned CLIs still need `gh` (open-linked-PR, shipped, native blocked-by, unlanded-blocker) fail open, as the sections below document.

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
promoted in this file: `bin/queue-pull.js` parses every eligibility and exclusion facet from the
`--queue-raw` file's `labels`, so the check has to happen before that file is written, because a
label the CLI never sees cannot be corrected after the pull. Before the `--queue-raw` Write, replace
each queue record's `labels` with the array `mcp__github__issue_read` returns for that record (`get`
method's `labels` field, or the `get_labels` method) — never trust the bulk `list_issues` labels
array alone when `fields` was passed. A record whose bulk `list_issues` labels already show
`bot:in-progress`, `bot:blocked` or `bot:parked` needs no `issue_read`: truncation only ever drops
labels, so the label is really there, and the CLI's `bot:*` filter drops the record whichever
labels the file carries (the output is identical, one call saved).

Omitting `fields` entirely (the unprojected response may return full labels) is plausible but
**unverified** against a live sandbox, so the per-record cross-check stays the required
mitigation. Re-open this section once a live run confirms whether omission avoids the truncation —
at that point, promote fields-omission to the default and update the `--queue-raw` input in this
file's Step 2 queue-pull section accordingly.

## Step 2 — `list_issues`/`issue_read` return snake_case timestamps (#3691)

**Confirmed live** (`gh`-absent firing, run `2026-10-20T022848-record-3630`, 2026-10-20): `mcp__github__list_issues` and `mcp__github__issue_read` return issue timestamps as `created_at` / `updated_at`. The dispatch consumers read camelCase `createdAt` / `updatedAt`. That firing's queue pull had to patch `dispatch-groups.json` with camelCase aliases before ranking.

**Consequence.** Without the alias, nothing errors and the picks go wrong quietly. `rankNext`'s oldest-first tie-break (`bin/queue-pull.js --rank`) compares `new Date(undefined)` values, so every comparison is a tie and the pick falls back to array order. `bin/lib/issues/grouping.js`'s fast-lane bundling degrades the same way. The worst effect is a false queue-order cache hit: `queue-order.js`'s `buildFreshnessSignal` records `updatedAt: undefined`, `JSON.stringify` drops that key when the cache is persisted, and `signalsMatch` then compares `undefined !== undefined`, which is false. A record whose body or labels changed between two MCP firings therefore still matches the persisted signal, and the stale persisted groups are reused.

**Required workaround.** Alias the timestamps once, at the queue-pull boundary, and `bin/queue-pull.js` already does it on both transports. With `--transport files` it copies the `--queue-raw` file into its session queue file and aliases that copy (the agent's own file is left as written), and it aliases the `--dep-freshness` data each time the pull reads it, before any pass reads either. It is a no-op on gh-shaped input, so an MCP-path agent need only write the raw MCP JSON to those two files. `bin/lib/issues/mcp-issue-shape.js`'s `aliasMcpTimestamps` returns shallow copies with `createdAt` / `updatedAt` added from the string snake_case values. The snake_case originals stay, a camelCase value that is not `undefined` is kept, and a non-array input yields `[]`. Any other MCP-fetched issue array that a node block outside that CLI reads needs the same call.

## Step 2 — cross-PR overlap report (#1579)

There is no confirmed MCP mapping for `gh pr list --json number,files,closingIssuesReferences` (a repo-wide open-PR listing with per-PR changed-file lists) yet. On `--transport files`, `bin/queue-pull.js` skips the cross-PR overlap fetch entirely and writes `dispatch-crosspr-overlap.json` as `[]` — the same fail-open posture as a `gh pr list` failure on the `gh` transport (SKILL.md Step 3's report renders nothing when its input is empty). This is a documented gap, not a silent one: the report is informational only (never a gate, per that section's AC2 fallback), so its absence on this transport costs a missed warning, not a missed exclusion.

## Step 2 — neighbour-in-flight pool (#3278, #3392)

The CLI's neighbour-in-flight pass needs `gh` for its pool list, its `gh repo view` slug and its claim-blob reads, so on this transport the agent fetches the pool and the claims in the two steps below and writes them to the `--in-flight-raw` and `--in-flight-claims` files that Step 2's call above names. The CLI then works out which pool records neighbour a candidate and writes the exclusions, reading the claims through `claimReaderFromMap` (`bin/lib/dispatch/in-flight-neighbours.js`). A Node subprocess cannot call MCP tools, so the agent fetches and Node computes. Fail open exactly as the `gh` branch does: a failed list or read prints one AUTO line and excludes nothing. That fail-open runs through what the agent writes (`[]`, `{}`, a `{"failure": …}` entry): a missing or malformed pool or claims file stops the pull (exit 4), so write both on every pull.

**1. Pool.** List the open `bot:in-progress` records through `list_issues` (`_shared/github-write-transport.md`'s "List open issues by label" row: label `bot:in-progress`, state open, body included, up to 200 records; `list_issues` returns at most 100 per page, so page until exhausted or 200 records are collected, and at exactly 200 print `Warning: the bot:in-progress pull for the neighbour-in-flight pass (#3278) returned exactly the --limit cap (200) — in-flight records beyond the cap are not checked as neighbours. Informational only; never blocks dispatch.`). Omit `fields`. The #3137 label truncation above reaches this pass only through `bin/lib/issues/grouping.js`'s `extractKeyFiles`: the `bot:in-progress` label filter runs server-side and liveness comes from the claim blob, but a record's origin label (`by:code-health`, `by:harness-health`, …) selects which extraction branch reads its Key Files, so a truncated `labels` array can drop a real neighbour edge. That fails open as a missed neighbour, settled at merge through `_shared/pr-first-merge.md`'s Conflict path; omitting `fields` is the mitigation (unverified live per #3137). Write `[{number, title, body, labels}]` to the `--in-flight-raw` file with the Write tool. If the call fails, write `[]` there and print `AUTO — dispatch: neighbour-in-flight pool fetch failed; no neighbour-in-flight exclusions this pull`.

**2. Claim reads.** Read the claim of every record in the pool file, never a subset of it. The CLI prints no claim-targets list, and the claims are read before it has built the groups such a list would come from, so a number left out of the map counts as a failed claim read: one AUTO line, that record counts as not in flight, and its neighbour is missed. For each number, read `claims/issue-{n}.json` on `claims-registry` through `_shared/issue-claims.md`'s file-blob path ("The lock" step 1's MCP bullet). Record the blob's decoded content as a string (or the parsed claim object — `claimReaderFromMap` accepts either), never the tool's `{content, sha}` response wrapper; a not-found response as `null`; and any other error as `{"failure": "{error}"}`. An entry that is neither a claim (`claimedAt`) nor a tombstone (`released`) counts as a failed read. Write the object, keyed by number, to the `--in-flight-claims` file with the Write tool on every pull, `{}` when the pool is empty, so an earlier pull's map is never read. If the reads or this Write cannot complete, write `[]` to the pool file and `{}` to the claims file and print step 1's pool-fetch AUTO line: the agent-side steps fail open like a failed pool fetch on the `gh` transport.

## Step 2 — unlanded-blocker exclusion (#4792)

The CLI's unlanded-blocker pass needs `gh` for its landing judgment: `bin/dispatch-unlanded-blockers.js` calls `preflight-records.js --blocker-landing`, whose landing check is a batched GraphQL query plus REST compare calls, and the GitHub MCP server has no generic GraphQL bridge (the #2523 section below). `bin/queue-pull.js` still runs the pass on `--transport files`: its `malformed-blocker` screen reads only the bodies already in `dispatch-groups.json`, so it still excludes, and the landing call fails open the same way the cross-PR overlap fetch above does — `preflight-records.js` exits non-zero at its first `gh` call, if it makes one, and the CLI prints one `Warning:` line and excludes no `unlanded-blocker` record. No MCP substitute exists for that judgment: `preflight-records.js`'s gh-free `--blocker-states-json` path reads every closed blocker `undetermined`, so it can never return the `unlanded` verdict this pass excludes on, and `/claude-tweaks:flow` Step 2.7b has the same blind spot on this transport (`flow/multispec-preflight-failure.md`'s Blocker landing paragraph) — the lost exclusion is one `/flow` would not enforce either.

## Step 2 — open-linked-PR exclusion (#1224)

`bin/resolve-linked-prs.js` is the `gh`-transport only, same as `bin/resolve-blockers.js` (Step 2's queue pull and per-dependency open-state check, above). **Correction (#2523):** the claim below that "there is no MCP tool that answers the direction this check needs" was wrong for the *single-issue* case — `mcp__github__issue_read`'s `get` method returns a `closed_by_pull_requests` field (`{total_count, references: [{number, state, ...}]}`) that directly answers "does this issue have an open closing PR" for one already-known issue number, live-confirmed against a real issue (#2523 itself, `total_count: 0` when no closing PR exists). `_shared/github-write-transport.md`'s CRUD mapping still carries no dedicated PR-listing row, and neither of its two documented PR-read exceptions answers this direction — `pull_request_read` (`get` method) still needs a PR *number* as input, and `list_pull_requests` (#4423) lists open PRs by state, never by the issue they close — but `issue_read`'s hierarchy field sidesteps both entirely by answering the issue-number-in direction directly, which the original investigation missed. **What's still an open gap:** batching. `bin/resolve-linked-prs.js` makes ONE batched, aliased GraphQL call across every queue-pull candidate (`record.js`'s `buildLinkedPRQuery` + `linked-prs.js`'s `fetchLinkedPRs`); the GitHub MCP server exposes no generic GraphQL passthrough tool, so the same N-candidate check via `issue_read` costs N individual tool calls instead of one — real at queue-pull scale (a `dispatch --budget` drain routinely screens dozens of candidates per firing), the same cost concern the Blocked-exclusion check documents for `resolve-blockers.js`'s native GraphQL query. On `--transport files`, `bin/queue-pull.js` still spawns `bin/resolve-linked-prs.js`, which fails without `gh`: the pull prints its `Warning: linked-PR query failed` line and `dispatch-linked-prs.json` stays `{}` for a full drain — the fail-open posture is unchanged for that path. What changes is the narrower, already-adopted mitigation: `settle-and-merge.md`'s Claim-contest special case (#2402) already calls `issue_read` per-candidate at contest time, where the cost is one call for one already-known issue, not N — that mitigation's own doc no longer needs the "not covered by any MCP tool" framing, since it was always just calling a tool that answers the question, not working around a true gap. Re-open the batching gap specifically if the GitHub MCP server ever adds a batched issue-linked-PRs query or a generic GraphQL passthrough tool. **Required workaround already documented:** the next section below ("native blocked-by / linked-PR batching: no generic GraphQL bridge (#2523)") carries the standing, required per-candidate `issue_read` verification step this gap needs on a `gh`-absent firing — see it directly rather than re-deriving the mitigation (#2051).

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

On a `gh`-absent transport, `bin/queue-pull.js --transport files` still spawns both CLIs
(`resolve-blockers.js` under `work-links: native` only), and each fails without `gh` (the pull's
"Warning: native dependency query failed" / "Warning: linked-PR query failed" lines) and dispatch degrades to "no native filtering" / "no open-PR exclusion" for the
whole firing — every queue-pull candidate is treated as unblocked and PR-free regardless of its
real state. **Documented, required workaround** — promoting #2051's own recommendation from a
one-off firing improvisation to a standing step: before finalizing group selection on a `gh`-absent
firing, manually verify each surviving top-ranked candidate (not the whole queue — just the
candidate(s) about to be dispatched) via a per-candidate `mcp__github__issue_read` (`get` method)
call, reading `closed_by_pull_requests.references[].state` for the open-PR check (per the #1224
correction above) and — for `work-links: native` blocked-by — reading the candidate's own body text
for any `blocked-by:`/dependency mentions as a best-effort substitute (native GraphQL `blockedBy`
has no MCP equivalent at all, so this is a degrade, not a full replacement: a native-only dependency
relationship with no matching body-text mention is invisible on this path). A mention naming
another repository (`owner/name#N`) is that repository's issue, never this repository's `#N`: read
its state with `issue_read` on that owner and repository — open or unreadable, it blocks, and the
exclusion names it `owner/name#N`, suffixed ` (state unreadable)` when `issue_read` cannot read its
state, the way the `gh` path's `openBlockerRefs` does (#4793). This is exactly what this record's
own filing session did live (2026-09-16T14:19Z firing): the automated top-ranked pick (#2259)
already had an open PR (#2450), and #2051, #2329, #1135, plus the #2267/#2268/#2269 family
(natively blocked by open #2265) were all falsely eligible until this manual check caught them.

Supply those foreign states to the queue pull instead of leaving the body-text pass blind (#4793):
before Step 2's `queue-pull.js --transport files` call above, collect the body-declared foreign
refs (`Blocked by owner/name#N` lines) of every queue record that carries none of `bot:in-progress`,
`bot:blocked` or `bot:parked` (the records the CLI's `blocked` pass reads, known before the pull),
read each with `issue_read` (`get` method; its `owner`, `repo` and `issue_number`), and write the
states as one JSON object keyed by `owner/name#N`, each value copied from `issue_read`'s `state` (any case) or `null` for a ref
`issue_read` cannot read, with the Write tool to the session-scoped `{dispatch-foreign-states.json}`
file (`_shared/session-tmp-root.md`), `{}` when no such record declares one. Pass its path as
`--foreign-states {path}` on that call: the flag names the file for that one CLI run, so no shell
variable has to survive between Bash calls. A closed ref no longer blocks, and an open one excludes
the record as `owner/name#N`. A ref left out of the file, or `null`, still excludes the record as
`owner/name#N (state unreadable)` (fail closed): the CLI asks `bin/resolve-foreign-blockers.js` for
a ref left out of the file, a lookup that needs `gh` and fails on this transport with one `Warning:`
line. An omitted `--foreign-states` or an unreadable file changes nothing.

Re-open this section if the GitHub MCP server ever adds a generic GraphQL passthrough tool or
batched equivalents of `buildNativeDependencyQuery`/`buildLinkedPRQuery`.
