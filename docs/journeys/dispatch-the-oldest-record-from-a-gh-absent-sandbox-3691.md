---
files:
  - plugin/bin/lib/issues/mcp-issue-shape.js
  - plugin/skills/dispatch/queue-pull-script.md
  - plugin/skills/dispatch/mcp-transport.md
  - plugin/skills/dispatch/next-ranking.md
  - plugin/bin/lib/dispatch/queue-order.js
  - plugin/bin/lib/issues/grouping.js
---

# Dispatch the Oldest Record from a gh-Absent Sandbox

**Persona:** a scheduled Routine firing `/claude-tweaks:dispatch next` (or a bare `--budget` drain) in a cloud sandbox with no `gh` CLI. It reaches GitHub only through the MCP tools `mcp__github__list_issues` / `mcp__github__issue_read`. Also the maintainer who checks the next morning which record that firing built.
**Goal:** have the firing pick the same record a `gh`-present firing would: the oldest record in the highest priority band. The firing should also see a record that changed since the last pull as changed.
**Entry point:** `/claude-tweaks:dispatch next`, headless, `gh`-absent transport (`plugin/skills/dispatch/mcp-transport.md`).
**Success state:** within one priority band, the picked group is the one whose representative has the earliest `createdAt`, regardless of the order `list_issues` returned. A record edited between two firings misses the queue-order cache, so the groups are recomputed. Nothing in the run reports an error, because nothing needed patching by hand.

## Steps

### 1. Write the MCP-fetched queue to the raw file
- **URL:** `plugin/skills/dispatch/queue-pull-script.md` (the `$DISPATCH_QUEUE_RAW` fetch); `plugin/skills/dispatch/mcp-transport.md` (`## Step 2 — queue pull …`)
- **Action:** The agent replaces the `gh issue list --label auto:build …` line with a `list_issues` call. It writes the returned JSON, snake_case `created_at` / `updated_at` included, to `$DISPATCH_QUEUE_RAW`, and then runs the rest of the script as written.
- **Should feel:** Like the `gh` path. The agent hand-edits no field names and patches nothing into `dispatch-groups.json`.
- **Should understand:** The raw MCP shape is fine to write as-is. The next line of the script normalizes it.
- **Red flags:** An agent renaming fields by hand or editing `dispatch-groups.json` before ranking, which is the 2026-10-20 run `2026-10-20T022848-record-3630` workaround this record retires. An agent that skips the `alias_mcp_timestamps` line because it reads as `gh`-only.

### 2. The script aliases the timestamps
- **URL:** `plugin/skills/dispatch/queue-pull-script.md` (`alias_mcp_timestamps`, called after the `$DISPATCH_QUEUE_RAW` write and after each `$DISPATCH_DEP_FRESHNESS` write); `plugin/bin/lib/issues/mcp-issue-shape.js` (`aliasMcpTimestamps`)
- **Action:** `alias_mcp_timestamps "$DISPATCH_QUEUE_RAW"` rewrites the file in place. Each issue gains `createdAt` / `updatedAt` copied from its string `created_at` / `updated_at`, and the dependency-freshness file gets the same treatment after it is written. Any camelCase value that is already present (the `gh` path) is kept, so the line is a no-op there.
- **Should feel:** Invisible. One line that runs on both transports, with no output when it works.
- **Should understand:** It must run before any node block reads the file, and the script places it there. A shell function lives only in the Bash call that defines it. If the agent splits the script across Bash calls around its Write steps, each call that runs `alias_mcp_timestamps` must define the function first.
- **Red flags:** `alias_mcp_timestamps: command not found` on stderr, which means the function was defined in an earlier Bash call. The script carries on unaliased, and the step 3 and step 4 degradations return without any other error. A `null` `createdAt` replaced by the snake_case value (it must be kept).

### 3. Rank oldest-first within the band
- **URL:** `plugin/skills/dispatch/next-ranking.md`; `plugin/bin/lib/issues/grouping.js` (`bundleFastLaneSingletons`)
- **Action:** The ranking heredoc sorts groups by priority band, then by `new Date(rep.createdAt)`. It picks the older record even when `list_issues` returned the newer one first. Fast-lane bundling also chunks oldest-first.
- **Should feel:** Predictable. The maintainer finds the longest-waiting record built, the same as on a `gh` firing.
- **Should understand:** Without the alias every same-band comparison is `NaN`, which the sort treats as a tie, so the pick silently follows array order. `list_issues` returns newest-first, so that order is the opposite of what the ranking intends.
- **Red flags:** A firing that builds the newest of several same-priority records. A `dispatch-next-pick.json` whose representative has no `createdAt`.

### 4. The next firing sees changed records as changed
- **URL:** `plugin/bin/lib/dispatch/queue-order.js` (`buildFreshnessSignal`, `signalsMatch`); `plugin/skills/dispatch/queue-pull-script.md` (the `CACHE_HIT` block)
- **Action:** The cache check builds a freshness signal from each record's `updatedAt` and `state` and compares it with the persisted `order.json`. A record edited since the last firing has a different `updatedAt`, so the cache misses and the groups are recomputed from the fresh pull.
- **Should feel:** Trustworthy. An edited body, label, or blocker takes effect on the very next firing.
- **Should understand:** Without the alias, `updatedAt` is `undefined` and `JSON.stringify` drops it when the signal is persisted. The comparison then reads `undefined !== undefined`, which is false, so every edit is a false cache hit and stale groups are reused.
- **Red flags:** `Queue-order cache hit` on a `gh`-absent firing right after a record's labels or body changed. A persisted `order.json` whose `freshnessSignal.issues` entries carry no `updatedAt`.

## Origin
- Created during `/claude-tweaks:build` of record #3691 (2026-10-20). The queue pull now aliases the MCP transport's snake_case issue timestamps unconditionally, so `next`-ranking's oldest-first tie-break and the queue-order cache work on a `gh`-absent firing.
- Related specs: #3137 (`list_issues` label truncation), #3392 (neighbour-in-flight on the MCP transport), #1571 (queue-order cache)
