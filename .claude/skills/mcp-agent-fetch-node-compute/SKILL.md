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

## Rules

1. **Inject the reader, do not branch the computation.** The gh branch and the MCP branch call the same function; only the data source differs (`readClaimContent` here). A second copy of the logic for MCP drifts.
2. **Fetch only what the computation will read.** Export a target-listing function (`neighbourClaimTargets`) and pin that it names exactly the numbers the compute step reads (`tests/bin-lib/dispatch/in-flight-neighbours-map-reader.test.js`), so a mismatch cannot surface as a spurious failed-read line on every firing.
3. **Validate the shape of every agent-written entry.** The agent can record an error object, a not-found message or a `{content, sha}` wrapper as if it were data. `classifyClaimBlob` fails closed, so any JSON object that is neither a tombstone nor carries `claimedAt` classifies `live` — an unguarded reader turns an MCP read error into a false exclusion. Map such an entry to `{failure}`, never to content.
4. **Distinguish the entry states explicitly.** `null` is an absent blob, a string is content, `{failure}` is a failed read, and a missing key is a read that never happened (fail open: reported as unreadable, not as live or absent). A missing map reads as an empty one.
5. **Fail open on the agent side too.** If the fetch step or the Write cannot complete, write the empty input (`[]`, `{}`), print the same one-line `AUTO — dispatch: …` message the gh branch prints, and skip the compute step. Write the handoff file on every pull so an earlier pull's file is never read.
6. **Shell variables do not survive between tool calls.** Each Bash call re-runs the script's opening `eval "$(node … node-eval-file.js …)"` block and echoes the literal paths the Write tool needs.

## Tests

- Unit-test the reader over every entry state and the shape guard; prove the guard test is red with the guard disabled.
- Extract-and-run the prose's heredoc snippets over fixture files (`tests/dispatch-neighbour-in-flight-mcp.test.js`), per the `skill-prose-conformance-tests` skill: the MCP-side fetch is fixtured as the file the agent would write, and the snippet is the one the agent actually runs. Register fixture temp dirs for cleanup with `t.after`.

## Anti-patterns

| Pattern | Why it fails |
|---|---|
| Re-serialising any object the agent wrote as a claim | A read error becomes a live claim and a false exclusion (#3392 review) |
| A test that pins a shapeless object (`{ runId: 'r' }`) as accepted | It encodes the bug; the suite stays green |
| Letting a missing or malformed handoff file crash the compute step | `require` throws, the node exit stops the queue pull, and the fail-open promise breaks |
