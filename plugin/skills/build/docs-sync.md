# Common Step 6.5: Documentation Sync — Full Procedure

Loaded by `/claude-tweaks:build` Common Step 6.5 only when `docs/REGISTRY.md` exists.

After journey capture, check if the build's code changes affect documented areas.

1. **Read registry** — Read `docs/REGISTRY.md`.
2. **Get changed files** — `git diff --name-only` since build start (same file list used by Step 6).
3. **Match patterns** — For each registry entry, check if any changed file matches its Auto-detect glob patterns.
4. **For each matched doc:**

> **Parallel execution:** Use parallel tool calls — all Read operations on matched docs and their source files are independent.

   a. Read the doc file
   b. Read the relevant changed source files. A registry match says the doc may be affected, not which line. When the change adds a member to an enumerated set, such as a CLI verb, an input or output filename, or a flag, grep the matched doc for an existing sibling member (`grep -n -F '{sibling}' {doc}`). Every hit that lists the siblings needs the new member too. Judging the doc as a whole missed both of #3604's stale lists: the `review-coordination.js` verb line in `docs/plugin-structure.md` and the `_shared/session-tmp-root.md` filename row in `docs/skill-graph.md`.
   c. Determine the update and the inline-vs-defer decision using `docs-structure.md`'s own "Doc Update Patterns (for /build Step 6.5)" section, in the `/claude-tweaks:init` skill's directory — the canonical doc-type/trigger/action table and the inline-vs-defer threshold live there; this step doesn't restate them.
   d. **Update inline** (per that threshold). Commit separately:
      `git commit -m "Update {doc} — {what changed}"`
   e. **Defer to wrap-up** (per that threshold). Append to ledger with phase `build/docs` and status `open`:
      "{doc} may need updates — {what changed in code}. Review in wrap-up."
   f. **No stale text** — when the read finds nothing the change makes stale and `$PIPELINE_RUN_DIR` is set, log one line per such doc: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status SCANNED --step "Common Step 6.5" --text "docs sync: {doc} assessed at {sha}, no stale text" --reversibility n/a`, `{doc}` being the doc path as `docs/REGISTRY.md` writes it and `{sha}` `git rev-parse HEAD` at the assessment. A {doc} containing a double quote, `$`, a backtick or a backslash is passed with `--text-file` instead (`_shared/auto-decision-log.md`'s Text from git or a user rule).
5. **No matches** — skip silently. No output.
