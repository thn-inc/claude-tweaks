# 0023. Dispatch builds one record per group and resolves file overlap at merge

- **Status:** accepted
- **Date:** 2026-10-17
- **Context:** #3278 (PR #3384); related #1228, #1365, #1420; shipped answer in `plugin/skills/dispatch/design-notes.md`, "Why per-record groups, not transitive file-overlap groups"

## Context

Dispatch's queue pull used to partition the authorized queue with `groupByFileOverlap` (`plugin/bin/lib/issues/grouping.js`). That function takes the union-find closure of shared `### Key Files` entries. Dispatch then claimed and built each resulting group as a whole, and `_shared/issue-claims.md`'s Group claiming rule forbade claiming one member alone.

The rule this served, "two records touching the same file must not be in flight together", is a relation between pairs. The transitive closure spread it along chains, so if A shared a file with B and B shared one with C, A and C were bundled even though they shared nothing. On 2026-10-17 the live queue (61 eligible records, hub threshold 7) had one 18-record group held together by 25 real, direct overlaps. No path in that group reached the hub threshold, so the hub exclusion shipped in #1365 never fired. Bare drain skipped the whole group as oversized (#1228), and naming any member pulled all 18. Every member starved, including records that had no live neighbour.

## Decision

A dispatch group is now one record, or one `ceremony:fast-lane` bundle whose members share no linking file. The only guard against concurrent overlap is a non-removing `neighbour-in-flight` exclusion. A record counts as having a neighbour in flight when a record it directly shares a linking file with holds a live claim, confirmed by reading the claim blob (the `bot:in-progress` label alone never counts). Under that exclusion, bare drain defers the record to a later firing, and `#N` reports the neighbour and dispatches anyway. Everything the guard misses is resolved after the build by `_shared/pr-first-merge.md`'s Conflict path. `groupByFileOverlap` keeps its full-chain semantics for its other consumers: flow multi-spec conflict detection, parallel waves, `preflight-records`, ranking's overlap set, and `/help`.

## Alternatives considered

- **Lower the hub threshold** — rejected. Hub exclusion already ships and was inert on this queue. Lowering the threshold far enough to break the chain would also split the four `hooks.js` editors, the one set that really collides. That trades starvation for merge conflicts on exactly the files where conflicts happen.
- **Split oversized groups at their weakest edges** — rejected. Racing firings would need a deterministic cut rule they all agree on without talking to each other. The cut also keeps the bundle model that caused the starvation, so it would produce smaller bundles instead of removing bundles.
- **Apply direct-neighbourhood selection to `#N` only** — rejected. `#N` has a human present to weigh the overlap. Bare drain is the unattended path, so leaving it on transitive groups would keep starving the same records.

## Consequences

- Records no longer starve because of who their neighbours' neighbours are. Throughput under bare drain is limited by live claims, not by the size of a group.
- The decision accepts conflicts at merge in exchange for less waiting at selection. Two firings that pick neighbours at the same moment both build, and a same-hunk conflict parks the later PR as `pending-review` for a human. Byte-pinned tests spread across several files can still turn two green branches red at merge. File-overlap grouping never caught that, before or after this change.
- The guard fails open. A failed claim read or pool fetch counts as "not in flight" and logs an `AUTO` line. The neighbour pass runs on both transports: `plugin/skills/dispatch/mcp-transport.md` maps the pool list and the claim reads for a `gh`-absent firing (#3392), with the same fail-open behaviour.
- What would make us revisit: `pending-review` conflict parks from neighbouring dispatched PRs becoming a recurring cost rather than a rare one, or the simultaneous-pick window producing repeated wasted builds. Either would argue for a stronger selection-time guard, but a pairwise one, never a return to transitive bundles.
