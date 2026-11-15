# Queue pull silently reads a non-array MCP queue or dep-freshness file as empty (#5307) Implementation Plan

**Goal:** A queue file or dependency-freshness file that parses as JSON but is not an array (a wrapper object such as `{"issues": [...]}`) prints a Warning naming the file and takes the same fail-closed posture that file already has for unparseable content — never a silent `[]` — in both the queue-pull module and the retained fence script.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5307/work/5307-spec.md` (materialized from GitHub issue #5307)

**The posture each file already has** (the Deliverable's "the transport's fail-closed or fail-open posture for that file", read from `FILES_EXPECT` in `tests/bin-lib/dispatch/queue-pull.test.js` ~3274-3279): an unparseable queue file stops the pull at the grouping block (`files-queueRaw-malformed`: status 1, `STOP_LINE.grouping`); an unparseable dependency-freshness file stops a warm-cache pull at the cache check (`files-depFreshness-malformed`: status 1, `STOP_LINE.cacheHit`). A wrapper-object file takes exactly that posture, plus one Warning line before the stop.

**Warning text**, identical in module and fence, `{file}` being the session file the alias step reads (`dispatch-queue-raw.json` or `dispatch-dep-freshness.json` under the session tmp dir):

`Warning: {file} is not a JSON array — treated as a failed read`

---

### Task 1: Warn on and fail a non-array queue or dependency-freshness file instead of rewriting it as []

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` — `aliasFile` (~244-248), whose header comment documents D3 ("a non-array file is silently rewritten as []").
- Modify: `plugin/skills/dispatch/queue-pull-script.md` — the retained fence (#5231 has not removed it), its `alias_mcp_timestamps()` function (~57-67); the record's Current State requires fixing both and keeping the parity row. Size headroom: the file is 52,240 bytes against `RAIL_BYTES` 52,500 (`plugin/bin/lib/skill-audit/budgets.js`); keep it at or under 52,500 by trimming fence comment prose (never behavior, and never the `_shared/integration-branch.md` citation near the `remote show origin` line, which `tests/integration-branch-conformance.test.js` requires) to offset any bytes the fix adds.
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` — add the dependency-freshness wrapper fault beside `files-queueRaw-wrapper` (~727).
- Test: `tests/bin-lib/dispatch/queue-pull.test.js`
- Waived `plugin/bin/lib/issues/mcp-issue-shape.js`: unchanged — `aliasMcpTimestamps` keeps returning `[]` for a non-array (its other callers rely on it); the check lives in the dispatch layer's alias step, before that call.

**Behavior, both sides:** the alias step reads the file; when the parsed value is an array it aliases and rewrites it as today. When it is not an array, it prints the Warning above, leaves the file unchanged, and fails (the module's `aliasFile` step returns not-ok; the fence's `alias_mcp_timestamps` node process exits non-zero). The file left in place then fails the same downstream read an unparseable file fails, so the pull reaches the same stop as the matching `malformed` row. An unparseable file is unchanged (no new Warning; its existing failure path stands). Both transports run the same alias step, so `gh` behaves the same (a `gh issue list` never returns a non-array, so this is unreachable there in practice).

- [ ] **Step 1: Failing test** — (a) in `queue-pull-fixtures.js`, push `{ id: 'files-depFreshness-wrapper', input: 'depFreshness', mode: 'wrapper', pass: 'fetch', warm: true, scenario: P1, agent: (files) => ({ ...files, 'dispatch-dep-freshness.json': JSON.stringify({ issues: JSON.parse(files['dispatch-dep-freshness.json']) }) }) }` beside `files-queueRaw-wrapper`. (b) In `FILES_EXPECT`, set `'files-queueRaw-wrapper': { status: 1, stderr: ['Warning: <SCR>/…/dispatch-queue-raw.json is not a JSON array — treated as a failed read', STOP_LINE.grouping], entries: [] }` and add `'files-depFreshness-wrapper': { status: 1, stderr: ['Warning: <SCR>/…/dispatch-dep-freshness.json is not a JSON array — treated as a failed read', STOP_LINE.cacheHit], entries: [] }`, writing each Warning's path in whatever placeholder form the row's sibling Warnings already use for session-tmp paths (see `FILES_FOREIGN`'s `<SCR>/agent/…` and how `reported()` normalizes the session dir). (c) Replace the D3 test (~3583, "a wrapper-object queue file yields an empty pool, exit 0, no Warning") with one asserting, on both sides, for each of the two wrapper rows: status 1, exactly one `Warning:` line naming that file, the matching stop line last, and (queue) no `dispatch-groups.json` holding `[]` / (dep-freshness) `r.files['dispatch-groups.json'] === null` because the stop precedes the cache hit. (d) Update the carved session-files assertion (~3562) to include the two wrapper rows with the same leftover sets as their `malformed` siblings (`inFlight` for the queue row, `cacheStop` for the dep-freshness row). (e) Update the `aliasFile` D3 description wherever the test file's header comments state it. Run `node --test tests/bin-lib/dispatch/queue-pull.test.js` before Step 2: the new and flipped assertions must go red on the current code.
- [ ] **Step 2: Implement** — the behavior above, in `aliasFile` and the fence's `alias_mcp_timestamps`, byte-identical so the parity suite stays green; update `aliasFile`'s D3 header comment.
- [ ] **Step 3: Run** `node --test tests/bin-lib/dispatch/queue-pull.test.js tests/integration-branch-conformance.test.js` — PASS; `wc -c plugin/skills/dispatch/queue-pull-script.md` ≤ 52500.
- [ ] **Step 4: Commit** — one commit, `Warn on and fail a non-array queue-pull queue or dep-freshness file instead of reading it as empty`, body `refs #5307`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (non-array file is a failed read with a Warning, following the file's posture) → Step 2 and the posture paragraph; Deliverable 2 (a test per input) → Step 1 (a)-(c); AC 1 (queue wrapper: Warning naming the file, no clean "no candidates") → `files-queueRaw-wrapper` row; AC 2 (dep-freshness wrapper: Warning, no cache hit) → `files-depFreshness-wrapper` row, warm cache, stop before the cache hit.
- **Placeholders:** none.
