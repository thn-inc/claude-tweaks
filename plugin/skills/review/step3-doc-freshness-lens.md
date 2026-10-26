# Lens 3i: Documentation Freshness — /claude-tweaks:review Step 3

Read from `code-mode-steps.md`'s Step 3 only when `docs/REGISTRY.md` exists and the diff is not
docs-only. Everything this lens and its `3i-diagram` sub-lens emit is informational — it
never blocks the review. The registry scan below is the lens itself; `3i-diagram` is its sub-lens
and is gated separately.

1. Read `docs/REGISTRY.md`
2. Match changed files against Auto-detect patterns
3. For each matched registry entry, check if the doc was updated in this work's commits (look for doc update commits in `git log`)
4. **Skip a doc `/claude-tweaks:build` already checked (#4137).** When `$PIPELINE_RUN_DIR` is set and its `decisions.md` carries, under `## /build`, a line with `Common Step 6.5: docs sync: {doc} assessed at {sha}, no stale text` for this entry's doc, where {sha} is 7-40 hex characters, `git merge-base --is-ancestor {sha} HEAD` exits 0, and neither `git diff --name-only {sha}` (the working tree) nor `git ls-files --others --exclude-standard` lists a file matching this entry's Auto-detect patterns, with both commands exiting 0, emit no finding for it — build read it against the same source. A doc whose matched sources changed since that {sha}, or whose check failed, is still flagged. Log one line per review, listing the dropped docs: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/review" --status SKIP --step "Lens 3i doc freshness (skipped)" --text "condition: build Common Step 6.5 assessed {docs and shas} with no stale text, matched sources unchanged since → fallback: no 3i finding for them" --reversibility n/a`.
5. Flag the remaining unupdated docs as informational findings:

   ```
   | {N} | Doc `{file}` covers changed areas (`{pattern}`) but wasn't updated | Low | Docs | {file} | Review in wrap-up |
   ```

These findings are informational — they don't block the review. They ensure wrap-up doesn't miss doc updates that build skipped.

#### 3i-diagram: Visual documentation gap (informational)

Read the `diagram-suggestions` flag from CLAUDE.md (written by `/init` Step 12). **Skip silently when** `diagram-suggestions` is `disabled` or missing.

When `enabled`, scan the diff for **structural complexity** signals:

| Diff added | Signal |
|------------|--------|
| New / changed enum or `status:` field with 3+ states + a transition function (e.g., `switch (status)`, `transitionTo`, state-pattern files) | `state-machine` |
| New migration or ORM model with `references` / `foreignKey` / `belongsTo` between 2+ entities | `data-model` |
| New API routes / message handlers in 3+ service directories, OR a workflow file orchestrating 3+ services | `multi-actor` |
| 3+ new top-level directories under `src/` or new module boundaries | `architecture` |

If a signal matches **and** the co-located diagram location for this change (`docs/journeys/`, `docs/plans/`, or `docs/diagrams/` — see `/claude-tweaks:visualize`'s placement table) is missing OR contains no file whose name matches the changed area, emit ONE informational finding per matched signal (max 2 total to avoid noise). **Tie-break when more than 2 signals match:** take the first 2 in the table's own row order above (`state-machine` > `data-model` > `multi-actor` > `architecture`) — deterministic and reproducible across runs.

```
| {N} | Visual documentation gap: change added a {signal-description}; no matching diagram found. Consider `/claude-tweaks:visualize {type} {topic}`. | Low | Docs | {representative-file} | Suggest to user in wrap-up |
```

Like other Lens 3i findings, these are informational and don't block review — they're a documentation gap, not a code defect. The user (or Claude) can act on the recommendation in wrap-up by invoking `/claude-tweaks:visualize`.

**Skip conditions:**
- `diagram-suggestions` is `disabled` or missing → emit nothing
- Signal detection produced no matches → emit nothing (most reviews trigger zero diagram findings; this is correct)
- A matching diagram already exists → emit nothing (we're not gating on freshness for diagrams since they're hand-drawn)
