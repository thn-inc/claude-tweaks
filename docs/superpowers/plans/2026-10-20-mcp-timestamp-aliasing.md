# MCP snake_case Timestamp Aliasing (#3691) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alias the GitHub MCP transport's snake_case `created_at`/`updated_at` issue fields to camelCase `createdAt`/`updatedAt` once, at dispatch's MCP-fetch boundary, so `next`-ranking's oldest-first tie-break works on a `gh`-absent firing.

**Architecture:** A pure helper `aliasMcpTimestamps` in a new `plugin/bin/lib/issues/mcp-issue-shape.js` normalizes an MCP-fetched issue array. `plugin/skills/dispatch/mcp-transport.md` gains a #3137-style gap section whose one `node-eval-file.js` heredoc rewrites `$DISPATCH_QUEUE_RAW` in place through that helper, right after the agent writes it and before any queue-pull node block reads it. One test file pins the helper, runs the doc heredoc, and runs `next-ranking.md`'s ranking heredoc over the aliased output.

**Tech Stack:** Node 18+, `node --test`, bash heredocs via `plugin/bin/node-eval-file.js`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T124217-record-3691/work/3691-spec.md`

Scope keywords: created_at, updated_at

## Global Constraints

- Gap section heading style matches the existing `## Step 2 — … (#3137)` / `(#2523)` / `(#1579)` sections in `mcp-transport.md`.
- Field names aliased are exactly `created_at` → `createdAt` and `updated_at` → `updatedAt`.
- The helper is non-destructive: an issue that already carries `createdAt`/`updatedAt` keeps its value; snake_case keys are left in place.
- `mcp-transport.md` is 18,616 B today against `RAIL_BYTES` 52,500 B — the new section (~1.5 KB) leaves ample headroom.
- `npm test` passes.

## Review Focus

- An issue that carries both forms (a `gh` reshaped record) must keep its camelCase value, not be overwritten by snake_case — pinned in Task 1.
- A non-string or absent `created_at` must not produce a `createdAt: undefined` key that downstream code reads as present — pinned in Task 1.
- Non-array / null input (an empty or failed MCP write) must not throw — return `[]` — pinned in Task 1.
- The doc heredoc must work when `$DISPATCH_QUEUE_RAW` holds `[]` — pinned in Task 2.
- CRLF checkout: heredoc extraction must match on CRLF text — pinned in Task 2.

---

### Task 1: `aliasMcpTimestamps` helper

**Files:**
- Create: `plugin/bin/lib/issues/mcp-issue-shape.js`
- Test: `tests/dispatch-mcp-timestamp-alias.test.js`

**Interfaces:**
- Produces: `aliasMcpTimestamps(issues: object[]) -> object[]` (module export `{ aliasMcpTimestamps, TIMESTAMP_ALIASES }`, where `TIMESTAMP_ALIASES = { created_at: 'createdAt', updated_at: 'updatedAt' }`). Returns a new array of shallow copies; a non-array input returns `[]`; a non-object element passes through unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/dispatch-mcp-timestamp-alias.test.js`:
  - `aliases created_at/updated_at to camelCase` — input `[{number:1, created_at:'2026-01-01T00:00:00Z', updated_at:'2026-01-02T00:00:00Z'}]` → output element has `createdAt === '2026-01-01T00:00:00Z'`, `updatedAt === '2026-01-02T00:00:00Z'`, and still has `created_at`.
  - `keeps an existing camelCase value` — `{createdAt:'A', created_at:'B'}` → `createdAt === 'A'`.
  - `adds no key for an absent or non-string snake_case value` — `{number:2}` and `{created_at:null}` → `!('createdAt' in out)`.
  - `non-array input returns []` — `null`, `undefined`, `{}` → `[]`.
  - `does not mutate its input` — input object unchanged after call.
- [ ] **Step 2: Run** `node --test tests/dispatch-mcp-timestamp-alias.test.js` — Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement** `aliasMcpTimestamps` per the Interfaces block, with a header comment naming #3691 and the consumers (`grouping.js` `bundleFastLaneSingletons`, `next-ranking.md`, `queue-order.js` `buildFreshnessSignal`).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** both files: `Add aliasMcpTimestamps — MCP snake_case issue timestamps to camelCase (refs #3691)`.

### Task 2: `mcp-transport.md` gap section + boundary heredoc

**Files:**
- Modify: `plugin/skills/dispatch/mcp-transport.md` (insert a new section directly after the `## Step 2 — \`list_issues\` \`fields\` parameter silently truncates labels (#3137)` section, before `## Step 2 — cross-PR overlap report (#1579)`)
- Test: `tests/dispatch-mcp-timestamp-alias.test.js`

**Interfaces:**
- Consumes: `aliasMcpTimestamps` from Task 1.
- Produces: section heading `## Step 2 — \`list_issues\`/\`issue_read\` return snake_case timestamps (#3691)` containing exactly one `node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_QUEUE_RAW" <<NODE_EVAL_EOF … NODE_EVAL_EOF` heredoc that reads the file, applies `aliasMcpTimestamps`, and writes it back.

- [ ] **Step 1: Write the failing tests** (same file):
  - `section names the gap, the fields, the consumers and the helper` — section text includes `created_at`, `updated_at`, `createdAt`, `updatedAt`, `mcp__github__list_issues`, `mcp__github__issue_read`, `next-ranking.md`, `aliasMcpTimestamps`, `bin/lib/issues/mcp-issue-shape.js`, `2026-10-20T022848-record-3630`.
  - `doc heredoc aliases $DISPATCH_QUEUE_RAW in place` — write a newest-first MCP-shaped fixture (`#20` created `2026-10-10`, `#10` created `2026-09-01`, both `labels:[{name:'priority:low'}]`), run the extracted heredoc via `bash -c` with `CLAUDE_PLUGIN_ROOT` (forward slashes) and `DISPATCH_QUEUE_RAW` env, assert every element now has `createdAt`.
  - `doc heredoc on [] leaves []`.
  - `next-ranking's oldest-first tie-break picks the older record after aliasing` — build groups `[[a],[b]]` from the aliased file with `facets: parseRecordFacets(labels)`, write `DISPATCH_GROUPS`, empty `DISPATCH_EXCLUSIONS`, empty `PRIORITY_FILTER`, run `next-ranking.md`'s second heredoc (the one starting `node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$PRIORITY_FILTER"`) with stdout → `DISPATCH_NEXT_PICK`; assert picked group's number is `10`.
  - `control: without aliasing the tie-break falls back to array order` — same, groups built from the raw snake_case fixture; picked number is `20`.
  - `CRLF extraction matches LF`.
- [ ] **Step 2: Run** `node --test tests/dispatch-mcp-timestamp-alias.test.js` — Expected: FAIL (section heading not found).
- [ ] **Step 3: Write the section** — Confirmed-live paragraph (the record's observation, run id, date), the consequence (oldest-first tie-break in `next-ranking.md` and `grouping.js`'s fast-lane bundling silently degrade to array order; `queue-order.js`'s `buildFreshnessSignal` sees `updatedAt: undefined`), the **Required workaround** with the heredoc, applied once right after writing `$DISPATCH_QUEUE_RAW` (and any other MCP-fetched issue array a queue-pull node block reads), before the first node block of `queue-pull-script.md`.
- [ ] **Step 4: Run** the test file, then `node --test tests/node-eval-file-heredoc-syntax.test.js tests/dispatch-neighbour-in-flight-mcp.test.js` — Expected: PASS.
- [ ] **Step 5: Commit**: `Document MCP snake_case timestamp gap in mcp-transport.md — alias at the queue-pull boundary (refs #3691)`.
