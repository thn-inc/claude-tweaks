---
name: mcp-agent-fetch-node-compute
description: Use when a plugin/bin/lib computation needs GitHub data on a gh-absent (MCP-transport) firing — the agent fetches through MCP tools, writes a JSON file, and Node computes over it through an injected reader. Keywords - MCP transport, gh-absent, record-json, records-json, claimReaderFromMap, agent-fetched map, fail open, entry-shape guard.
---

# MCP agent-fetch, Node-compute

A Node subprocess cannot call MCP tools. On a `gh`-absent firing (typically the cloud Routine sandbox) the agent therefore fetches the data with the MCP tool, writes it to a JSON file with the Write tool, and a `node-eval-file.js` heredoc (or a bin CLI flag) reads that file and computes. The computation itself stays in `bin/lib/` and is unit-tested; only the fetch is prose.

## Instances to copy from

| Instance | Fetch (agent) | Compute (Node) |
|---|---|---|
| `bin/materialize.js --record-json <path>` (#1459) | `issue_read` of the record | materialize over the supplied record |
| `bin/preflight-records.js --records-json <path>` (#3351) | records for the targets | pre-flight over the array |
| `claimReaderFromMap` in `bin/lib/dispatch/in-flight-neighbours.js` (#3392), driven by `skills/dispatch/mcp-transport.md`'s neighbour-in-flight section | `list_issues` for the pool, then `claims/issue-{n}.json` per neighbour | `neighbourInFlightExclusions` through an injected `readClaimContent` |
| `aliasMcpTimestamps` in `bin/lib/issues/mcp-issue-shape.js` (#3691), called by `queue-pull-script.md`'s `alias_mcp_timestamps` function | `list_issues` / `issue_read` (snake_case `created_at`/`updated_at`) | the same camelCase readers the `gh` branch feeds, after one unconditional alias step |

## Rules

1. **Inject the reader, do not branch the computation.** The gh branch and the MCP branch call the same function; only the data source differs (`readClaimContent` here). A second copy of the logic for MCP drifts.
2. **Fetch only what the computation will read.** Export a target-listing function (`neighbourClaimTargets`) and pin that it names exactly the numbers the compute step reads (`tests/bin-lib/dispatch/in-flight-neighbours-map-reader.test.js`), so a mismatch cannot surface as a spurious failed-read line on every firing.
3. **Validate the shape of every agent-written entry.** The agent can record an error object, a not-found message or a `{content, sha}` wrapper as if it were data. `classifyClaimBlob` fails closed, so any JSON object that is neither a tombstone nor carries `claimedAt` classifies `live` — an unguarded reader turns an MCP read error into a false exclusion. Map such an entry to `{failure}`, never to content.
4. **Distinguish the entry states explicitly.** `null` is an absent blob, a string is content, `{failure}` is a failed read, and a missing key is a read that never happened (fail open: reported as unreadable, not as live or absent). A missing map reads as an empty one.
5. **Fail open on the agent side too.** If the fetch step or the Write cannot complete, write the empty input (`[]`, `{}`), print the same one-line `AUTO — dispatch: …` message the gh branch prints, and skip the compute step. Write the handoff file on every pull so an earlier pull's file is never read.
6. **Shell variables do not survive between tool calls.** Each Bash call re-runs the script's opening `eval "$(node … node-eval-file.js …)"` block and echoes the literal paths the Write tool needs. A shell function the script defines further down (`alias_mcp_timestamps`, #3691) is lost the same way, so any Bash call that calls it re-runs its definition first; without that the call fails as command-not-found and, with no `set -e`, the script carries on unaliased.
7. **Route the compute and the target list through one collector.** When the computation gains a rule that widens what it reads, the target-listing function must widen with it, or rule 2's equality breaks on the MCP path only. #3520 made strong near-duplicates neighbours; `neighbourInFlightExclusions` and `neighbourClaimTargets` both call the module-private `collectNeighbours`, so the claim targets are the union of file and near-duplicate neighbours by construction, not by a second edit.
8. **Widen the handoff shape with every field the compute reads.** A field the agent leaves out of the file it writes is not an error: the compute reads `undefined` and the signal that field feeds never fires, a silent miss with no fail-open line. #3520's title-similarity signal needed `title`, so it went into `queue-pull-script.md`'s `gh issue list --json` list and `mcp-transport.md`'s `[{number, title, body, labels}]` shape in the same change, and `tests/dispatch-neighbour-in-flight-mcp.test.js` pins the shape string.
9. **Normalise a differing field spelling once, at the pull boundary, and make the step a no-op on the other transport's shape.** The MCP tools return `created_at`/`updated_at` where `gh --json` returns `createdAt`/`updatedAt`; a camelCase reader sees `undefined`, sorts by array order and records no freshness, and nothing errors (#3691). Alias the keys in place right after each fetch write, before any reader runs, with a pure helper that adds the camelCase key beside the original and keeps any value already present. The `gh` branch runs the same line, so rule 1's single code path holds.

## Tests

- Unit-test the reader over every entry state and the shape guard; prove the guard test is red with the guard disabled.
- Extract-and-run the prose's heredoc snippets over fixture files (`tests/dispatch-neighbour-in-flight-mcp.test.js`), per the `skill-prose-conformance-tests` skill: the MCP-side fetch is fixtured as the file the agent would write, and the snippet is the one the agent actually runs. Register fixture temp dirs for cleanup with `t.after`.
- Run the `gh` branch's fail-open fallback too: extract the fetch block and run it under `/bin/sh -c` with `PATH` set to an empty directory, so `gh` is absent, then assert the handoff file reads `[]` and the AUTO line printed (the pool-fetch test in `tests/dispatch-per-record-groups-prose.test.js`).

## Anti-patterns

| Pattern | Why it fails |
|---|---|
| Re-serialising any object the agent wrote as a claim | A read error becomes a live claim and a false exclusion (#3392 review) |
| A test that pins a shapeless object (`{ runId: 'r' }`) as accepted | It encodes the bug; the suite stays green |
| Letting a missing or malformed handoff file crash the compute step | `require` throws, the node exit stops the queue pull, and the fail-open promise breaks |
