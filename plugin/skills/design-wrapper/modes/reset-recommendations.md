# Design Mode — reset-recommendations

Invoked via `/claude-tweaks:design-wrapper reset-recommendations <spec>`. Returns `{mode, result: "ok", deleted}` to caller. Cache-management utility, not a mode that invokes Impeccable.

## When this runs

Called directly by the user as an escape hatch when `survey` mode has suppressed a recommendation they want to see again. Clears the declined-recommendations counter for a spec so the next `survey` call surfaces all matching recommendations again.

## Preconditions

None — `reset-recommendations` runs no preconditions. It is a cache-management utility, not a dispatching mode.

## Procedure

### Step 1: Resolve the cache path

`<spec>` is required — unlike `test`/`review`/`polish`/`survey`, this mode has no `git diff`-based default target to fall back to (there is no changed-file set that maps unambiguously to one spec's cache). If `<spec>` is omitted, return `{skipped: "reset-recommendations requires <spec> — no default target resolution"}` immediately; do not guess at the most-recently-modified cache across all specs.

Otherwise, resolve `docs/plans/YYYY-MM-DD-{feature}-declined.json` from the spec input (same resolution rules as the audit cache — see Step 3 of polish mode).

### Step 2: Delete or noop

- If the file does not exist, return `{result: "ok", note: "No declined recommendations to reset"}`.
- Otherwise, delete the file.

## Output to caller

```json
{ "mode": "reset-recommendations", "result": "ok", "deleted": "docs/plans/YYYY-MM-DD-{feature}-declined.json" }
```

The recommendations cache (`-recommendations.json`) is left in place — only the declined counter is cleared.

**Return to caller:** this output is consumed by the calling skill — control returns to the caller, whose next step runs in this same turn; never end the turn on this render.
