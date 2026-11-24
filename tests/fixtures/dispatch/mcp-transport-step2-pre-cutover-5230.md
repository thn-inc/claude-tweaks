<!-- #5230: byte-frozen copy of mcp-transport.md's "Step 2 — neighbour-in-flight pool" section at 61ec59285c112cbd8c5953855af108d63a03883b (the pre-cutover tip). The queue-pull parity oracle (tests/bin-lib/dispatch/queue-pull-oracle.js) splices the two fences below to simulate the pre-cutover MCP path; #5230 rewrites the live section, so the oracle reads these bytes instead. Do not edit. -->

## Step 2 — neighbour-in-flight pool (#3278, #3392)

`queue-pull-script.md`'s neighbour-in-flight pass needs `gh` for its pool list, its `gh repo view` slug and its claim-blob reads, so on this transport skip the pass's whole `if ! gh issue list … fi` block, its 200-cap warning block, its `node-eval-file.js` block and the `NEIGHBOUR_RC` check, and run these four steps in their place (step 4 carries its own stop on a non-zero exit). A Node subprocess cannot call MCP tools, so the agent fetches and Node computes. Fail open exactly as the `gh` branch does: a failed list or read prints one AUTO line and excludes nothing. Shell variables do not survive across tool calls, so begin each Bash call by re-running `queue-pull-script.md`'s opening block of `DISPATCH_*="$(node … session-tmp-resolve.js --value …)"` lines (the session-tmp paths are deterministic), and `echo "$DISPATCH_IN_FLIGHT_RAW" "$DISPATCH_IN_FLIGHT_CLAIMS"` once to get the literal paths the Write tool needs.

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

