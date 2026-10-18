---
files:
  - plugin/bin/lib/issues/grouping.js
  - plugin/bin/lib/dispatch/in-flight-neighbours.js
  - plugin/bin/lib/dispatch/queue-order.js
  - plugin/bin/lib/issues/claim-store.js
  - plugin/skills/dispatch/queue-pull-script.md
  - plugin/skills/dispatch/mcp-transport.md
  - plugin/skills/dispatch/next-ranking.md
  - plugin/skills/dispatch/neighbour-in-flight-report.md
  - plugin/skills/dispatch/SKILL.md
---

# Drain the Queue Past a Chain of Overlapping Records

**Persona:** a scheduled Routine firing bare `/claude-tweaks:dispatch --budget 3` unattended against a queue of about 60 `auto:build` records, where many pairs edit the same hot files (`hooks.js`, `code-mode-steps.md`). Also the maintainer who reads that firing's report the next morning.
**Goal:** keep building records from a queue whose Key Files chain together, instead of finding that most of the queue has fused into one group too large to dispatch.
**Entry point:** bare `/claude-tweaks:dispatch` (or a `--budget` drain), headless.
**Success state:** every eligible record is its own group, apart from disjoint fast-lane bundles. The firing builds up to `{budget}` records. A record whose direct file-sharing neighbour is mid-build waits for a later firing and is named in the report. Nothing is starved by a chain of records it shares no file with.

## Steps

### 1. Pull the queue into per-record groups
- **URL:** `plugin/skills/dispatch/queue-pull-script.md` (cache-miss grouping block); `plugin/bin/lib/issues/grouping.js` `buildDispatchGroups`
- **Action:** The queue pull groups the eligible records with `buildDispatchGroups`. Each record becomes its own group. Fast-lane singletons are bundled only with records they share no linking file with. A cached `order.json` written before this change carries no `grouping: 'per-record'` stamp, so `cacheUsable` rejects it and the groups are recomputed.
- **Should feel:** Unremarkable. The queue simply has as many candidate groups as it has eligible records.
- **Should understand:** Sharing a file with a record that shares a file with a third record no longer joins all three. Only a direct, live conflict holds a record back (step 2).
- **Red flags:** A group of more than one record that is not a fast-lane bundle. An `oversized` exclusion on a non-bundle group. A stale cached order reused after upgrade (groups of the old transitive shape).

### 2. Hold back records whose neighbour is mid-build
- **URL:** `plugin/skills/dispatch/queue-pull-script.md` (neighbour-in-flight pass); `plugin/skills/dispatch/mcp-transport.md` (its MCP branch); `plugin/bin/lib/dispatch/in-flight-neighbours.js`
- **Action:** The pass fetches the open `bot:in-progress` records. For each one that shares a linking file with a candidate, it reads the claim blob once and counts the record as in flight only when the blob reads `live`. Each candidate with a live neighbour gets a `neighbour-in-flight` exclusion naming the neighbour and the shared files. The candidate stays in `dispatch-groups.json`. On the MCP transport the agent does the fetching instead: it lists the pool through `list_issues` and reads only the neighbours' claim blobs from `claims-registry`. Node then computes the same exclusions over the claim map the agent wrote (`claimReaderFromMap`).
- **Should feel:** Conservative only where it matters. A leftover `bot:in-progress` label or an expired claim never blocks anything.
- **Should understand:** The guard fails open. An unreadable claim prints `AUTO — dispatch: neighbour-in-flight claim read failed …`, and a failed pool fetch prints `AUTO — dispatch: neighbour-in-flight pool fetch failed; no neighbour-in-flight exclusions this pull`. Either way the records build, and any real conflict resolves at merge. On a `gh`-absent firing the same guard runs over the MCP transport (`dispatch/mcp-transport.md`, #3392).
- **Red flags:** A record held back by a neighbour whose claim is expired or absent. A neighbour whose claim could not be read (an unresolved repo slug with a failed git read included) treated as having no claim, with no `claim read failed` AUTO line. A silent pool-fetch failure with no AUTO line. A bare-directory or hub path reported as the shared file. A `gh`-absent firing that builds a candidate alongside a live-claimed neighbour with no `neighbour-in-flight` exclusion and no AUTO line.

### 3. Rank, dispatch, and re-pull
- **URL:** `plugin/skills/dispatch/next-ranking.md`; `plugin/skills/dispatch/SKILL.md` Step 3 Loop
- **Action:** Bare drain's ranking skips groups with an `oversized`, `neighbour-in-flight` or this-firing exclusion, picks the best remaining group, and dispatches it. The queue pull then re-runs. A record that was waiting becomes eligible again on the pull after its neighbour's claim ends.
- **Should feel:** Steady. The firing spends its budget on records it can build now, rather than stopping on a group it may not touch.
- **Should understand:** Records that share a file but were both idle at the pull can still build one after the other in the same firing. The later one meets the earlier one's changes at merge, through `_shared/pr-first-merge.md`'s Conflict path. That is the accepted trade for not starving records.
- **Red flags:** Bare drain selecting a group with a `neighbour-in-flight` member. A firing ending with budget left while eligible, non-waiting groups remain.

### 4. Read the report
- **URL:** `plugin/skills/dispatch/neighbour-in-flight-report.md`
- **Action:** **The maintainer** reads the firing's report. Each waiting record has one line: `#{n} waits — direct neighbour(s) in flight: #{m} ({files}); bare drain skips it this firing`.
- **Should feel:** Explained. Each idle record names exactly which build it is waiting on, and why.
- **Should understand:** Nothing needs doing. The record is picked up automatically once the neighbour finishes. `/claude-tweaks:dispatch #n` builds it now regardless, if the maintainer accepts the merge-time conflict risk.
- **Red flags:** A waiting record with no report line. A report line naming a neighbour that is not in flight.

## Origin
- Created during `/claude-tweaks:build` of record #3278 (2026-10-17). Dispatch builds each record as its own group instead of the transitive file-overlap closure. On 2026-10-17 that closure fused 18 of 61 eligible records into one oversized, never-dispatched group.
- Step 2 updated for #3393: the pass reads claims through `claim-store.js`'s `createClaimReader`, which reports an unresolved repo slug as a read failure.
- Updated during `/claude-tweaks:build` of record #3392 (2026-10-17): the step 2 guard now also runs on the gh-absent MCP transport.
- Related specs: #1365 (hub-path exclusion), #1420 (bare-directory exclusion), #2066 (fast-lane bundles), #1228 (oversized guard in bare drain)
