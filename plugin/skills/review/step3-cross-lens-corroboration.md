# Review — Cross-Lens Corroboration (`medium` tier only)

Read from `code-mode-steps.md`'s Cross-Lens Corroboration subsection only when the resolved `review-effort` tier (Step 2.5) is `medium`. Loaded by `/claude-tweaks:review` after Step 3's per-lens reproduction completes and before Step 3 Routing. A finding two *different* lenses report independently is evidence a reproduction pair of one lens cannot give; at `medium` there is no Step 3.5 debate, so this deterministic pass is the only place that evidence is used. No agent is dispatched — `_shared/multi-agent-coordination.md` Mode 1's "Cross-lens corroboration" subsection states the match rule.

This pass never runs at `low` or `high` (or above): at `low` the single-read rule in `step3-lens-dispatch.md` applies unchanged, and at `high` and above Step 3.5's Cross-Lens Debate (`step3-debate-and-refutation.md`) applies unchanged.

## Procedure

1. **Collect the input.** Gather every lens's `unconfirmed` findings after each pair's `categorise-reproduction` and the lens 3f vacuity bullet (`step3-lens-dispatch.md`) have run. Direct-verification overrides run before the pass (`step3-lens-dispatch.md`'s Direct-verification override paragraph): a finding an override confirmed is `confirmed`, and a `confirmed` finding is never an input. Every lens 3f vacuity finding is **excluded**, however it became `unconfirmed` (one agent only, a session-limit single read, or the execution-evidence downgrade) — per that same Direct-verification override paragraph, only an executed run re-confirms one, and two lenses reading the same misleading comment are not independent evidence of a vacuity claim. An excluded vacuity finding keeps its own STAGED line as usual. Write the rest as one `{lens: [findings]}` object: resolve its path with one plain call — `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" U=review-{ctx-id}-unconfirmed-by-lens.json` (`_shared/session-tmp-root.md`; `{ctx-id}` as defined in `step3-lens-dispatch.md`) — and `Write` the object to the printed `U` path (`{path-U}` below) with the `Write` tool.
2. **Run the match.** One plain call:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" corroborate-cross-lens {path-U}
   ```
   It prints `{ corroborated, unconfirmed }`. Each `corroborated` entry is a representative finding plus `lenses` (the lens names that reported it), `path`, `line`, `severity`, `severityContested` (only when the members' severity buckets differ — critical/high versus medium/low/info, the same buckets the reproduction rule uses), and `members`. The representative is the entry's most severe member, so `severity` is the highest member severity — this mirrors `step3-routing.md`'s cross-lens de-dup rule (keep the higher severity). A chain of matches never merges two distinct findings: each entry holds only the members that directly match its representative, so one cluster can yield several entries.
3. **Promote.** Emit each `corroborated` entry as `confirmed`. It enters Step 3 Routing as an ordinary confirmed row — Category is the representative finding's lens (`members[0].lens` — the representative is always the first member), and `severityContested` is carried into the routing entry when set. Write to `decisions.md`, with `{lens list}` the comma-joined `lenses`:
   `AUTO {HH:MM:SS} — Cross-lens corroboration (medium tier): finding {path}:{line} reported independently by lenses {lens list}. Confirmed. Reversibility: high.`
   When `severityContested` is set, write this line instead:
   `AUTO {HH:MM:SS} — Cross-lens corroboration (medium tier): finding {path}:{line} reported independently by lenses {lens list}, severity contested (took the highest). Confirmed. Reversibility: high.`
4. **Stage the rest.** Each finding left in `unconfirmed` gets the STAGED line `step3-lens-dispatch.md`'s "only one agent's output" bullet deferred at `medium`: `not reproduced`, routing to the Wrap-Up Console's Low-confidence subsection as usual. A finding carrying `nearLocation` (the share-a-location coincidence) gets the share-a-location line only when neither side of the coincidence was promoted; when one side was promoted, the remaining side gets the plain `not reproduced` line instead.
5. **Order.** Corroboration, then the deferred STAGED lines, then the post-fan-out untracked-file sweep (`step3-lens-dispatch.md`), then Step 3 Routing.

## Failure

A failed call promotes nothing. Retry first, before writing any deferred STAGED line:

- **Non-zero exit.** Exit 2 means malformed input — fix the `{path-U}` object and re-run step 2, never retrying unchanged.
- **Unparseable output.** An exit 0 whose stdout is not one `{ corroborated, unconfirmed }` JSON object is a separate failure from a non-zero exit — re-run step 2 once.

If the call still fails, every finding stays `unconfirmed`: write the deferred STAGED lines as usual (step 4), then log one line — after a non-zero exit:
`SKIP {HH:MM:SS} — Cross-lens corroboration (skipped): review-coordination.js exited {code} → findings stay unconfirmed. Reversibility: n/a.`
after unparseable output:
`SKIP {HH:MM:SS} — Cross-lens corroboration (skipped): review-coordination.js output unparseable → findings stay unconfirmed. Reversibility: n/a.`
