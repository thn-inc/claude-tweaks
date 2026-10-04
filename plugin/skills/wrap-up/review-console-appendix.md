# Wrap-Up Review Console — reference appendix (#2546)

Rare-branch content split out of `review-console.md`'s operative head, read only when the head's
own citation points here. Nothing in this file runs on the common-case single-spec path.

## Multi-spec defer protocol — full procedure

Applies only when `MULTISPEC_REVIEW_DEFER=1` is set (by `/flow` multi-spec orchestration):

1. Do NOT present the console
2. Do NOT apply or revert any staged items — leave `staged/` and `decisions.md` untouched in the per-spec subdirectory
3. Append a final entry to this spec's `decisions.md`:
   ```
   AUTO {time} — Review Console deferred to multi-spec consolidated console. Per-spec staged items: {count}. Auto-decisions: {count}. Parent run dir: {MULTISPEC_PARENT_DIR}.
   ```
4. Write `verify-expectations.json` in this spec's own run directory (`$PIPELINE_RUN_DIR`, the per-spec `spec-{N}/` subdirectory) through the sanctioned writer — a direct Write there is refused from a worktree-isolated session (#2764): `node "${CLAUDE_PLUGIN_ROOT}/bin/set-verify-expectations.js" --run "$PIPELINE_RUN_DIR" --deferred design-caches,worktree,ephemeral-server,claim-release,run-dir-archival`, which leaves `{"version": 1, "memory": [], "upstream": [], "deferred": ["design-caches", "worktree", "ephemeral-server", "claim-release", "run-dir-archival"]}`. The five deferred cleanup items map 1:1 to `deferred`'s vocabulary (`cleanup-procedures.md`'s items 3/4/6/7/8). `memory`/`upstream` stay empty here — this spec's own M#/U# resolution never ran (deferred to the parent console); the parent's own consolidated run directory carries the real resolution once it completes, so a per-spec `verify` run against a `MULTISPEC_REVIEW_DEFER=1` spec will correctly render its `memory-updates`/`upstream-feedback` rows as `skip (nothing recorded)` rather than the more alarming `unknown (expectations file missing)` (a known, accepted limitation of per-spec verification under multi-spec defer, not a full resolution). The writer read-modify-writes, so an `oversightExempt` array `verification-brief.md`'s Oversight-floor gate already recorded in this same file is preserved. Exit 3 from that writer means the run dir is wrong — re-resolve `$RUN_ROOT` per `_shared/pipeline-run-dir.md` and retry; exit 2 is a malformed call to fix, never a reason to fall back to a direct Write.
5. Proceed to the phase-trace report — the per-spec summary still renders, but its "Review Console" row reads `deferred — see multi-spec consolidated console`
6. Skip the run-directory archival in Phase 4's cleanup planning — the parent `/flow` orchestration owns archival of the multi-spec parent dir after its consolidated console completes

This is the *only* condition under which `/wrap-up` skips the Review Console when a run directory exists. Every single-spec run — in any mode — always runs the per-spec console.
