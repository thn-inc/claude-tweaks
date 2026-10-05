# Design Wrapper — Availability Check (Step 2)

Canonical availability-check reference for `SKILL.md`'s universal preconditions (its "### Step 2: Availability check" summary points here). Owns the per-mode dependency table, the artifact kinds, the skip shapes, install hints, and the session de-dupe rule. Lazy-loaded when an availability check actually needs running.

## Per-mode verification table

For the dispatched mode, verify the dependency is available:

| Mode | Required | Verify by |
|------|----------|-----------|
| `test` | Impeccable CLI **at the pinned version** | Run `npx impeccable --version` via Bash. Non-zero or no output → unavailable. Exit 0 → compare the version string against the pin recorded in `impeccable-cli.md`'s `<!-- upstream-pin: impeccable-cli@X.Y.Z -->` comment. Equal → available. Different → **unavailable**, with the skip reason naming both versions (see below). Do not discard the version string: every rule in `impeccable-cli.md` describes the pinned version's behaviour, so running the gate against a different one produces a verdict about a contract that was never verified. |
| `review` | Impeccable plugin (LLM commands) | Check whether `/impeccable:impeccable` skill resolves. Look for `/impeccable:impeccable*` in the available skills list provided by the harness. If none resolve, treat as unavailable. |
| `shape` | Impeccable plugin (LLM commands) | Same as `review` — checks for `/impeccable:impeccable*` skill resolution. |
| `pre-build` | Impeccable plugin (reference files) | Same as `review`. The reference files ship with the plugin; if the plugin resolves, the references are available. |
| `polish` | Impeccable plugin (LLM commands) | Same as `review` — the refinement set and every suggestion-driven command all live in the plugin. |
| `live` | Impeccable plugin (LLM commands + bundled live-mode scripts) | Same as `review` — checks for `/impeccable:impeccable*` skill resolution. The live-mode scripts ship with the plugin itself, so no separate check is needed. |
| `doctor` | Impeccable plugin **at the pinned version** (bundled `doctor.mjs`) | Same resolution as Layer 0 below — `resolveImpeccablePlugin` per `impeccable-plugin.md`. **Unlike Layer 0, an unavailable result here *is* a mode-level skip**: `doctor` has no result to report without the script. Absent and off-pin are two distinct skip reasons; see `modes/doctor.md`'s skip table. |
| `explore` | Impeccable plugin (4.2.2+), resolved via the `impeccable-engine` module | `node "${CLAUDE_PLUGIN_ROOT}/bin/impeccable-engine.js" resolve` (`bin/lib/impeccable-engine`, #2979) — see `modes/explore.md`'s own Availability section. An unavailable result **is** a mode-level skip — the mode has nothing to deal without the engine. |
| **Layer 0** (all modes) | Impeccable plugin **at the pinned version**, resolved from the plugin cache | Follow `impeccable-plugin.md`'s resolution procedure: glob the cache, read each candidate's own `version`, select the one equal to the pin in its `<!-- upstream-pin: impeccable-plugin@X.Y.Z -->` comment. **Unlike every row above, an unavailable result here is not a mode-level skip** — see the note below the skip shapes. |

## The artifact kinds

Impeccable's artifacts are checked independently and must not be conflated. The rows above fall into four kinds:

- **LLM commands, by skill resolution, unpinned** (`review`, `shape`, `pre-build`, `polish`, `live`) — an off-pin plugin still answers `/impeccable:impeccable critique`.
- **Bundled scripts, at an exact pin** (`doctor` and Layer 0) — `resolveImpeccablePlugin` per `impeccable-plugin.md`, because neither `context-signals.mjs` nor `doctor.mjs` exists at every version that satisfies the skill-resolution check. Layer 0 degrades to no-signals; `doctor` skips the mode.
- **The `impeccable-engine` module** (`explore`) — `impeccable-engine.js resolve`/`run` (`bin/lib/impeccable-engine`, #2979) finds the active install (4.2.2+) directly, replacing the retired per-mode bundled-script resolution this mode used before #2982. `explore` skips the mode on an unavailable result, same consequence as `doctor` above, via a different resolver.
- **The CLI** (`test`) — a separate artifact entirely, on its own version line.

## Skip shapes

On unavailable:

```
{
  "skipped": "Impeccable {CLI|plugin} not installed",
  "install_hint": "{install command + verify command}"
}
```

On a CLI version mismatch, use this shape instead — it is a distinct condition from "not installed" and must not be reported as one:

```
{
  "skipped": "Impeccable CLI {found} does not match the pinned {pinned}",
  "install_hint": "npm install -g impeccable@{pinned}"
}
```

Naming both versions is the point. A bare "unavailable" on a machine that plainly has the CLI installed reads as a bug in this wrapper; naming the mismatch tells the user what to do in one line. This skip is also the only pin enforcement a consumer of the published plugin ever gets — `tests/impeccable-cli-contract.test.js` runs for this repo's contributors only.

**Layer 0 never produces either shape.** Its three failure conditions (absent, version mismatch, execution failure) are enrichment outcomes, not availability outcomes: the wrapper records the reason — which must distinguish all three, and must name *every* version found on a mismatch, per `impeccable-plugin.md`'s degradation table — then proceeds with Layers 1-3 and dispatches the mode normally. A mode is never skipped, and no invocation ever fails, because context signals were unavailable.

## Install hints

Use the appropriate one for the mode:

- **CLI:** `npm install -g impeccable@{pinned}` (verify with `npx impeccable --version`)
- **Plugin:** `/plugin install impeccable@<marketplace>` (verify by checking `/impeccable:impeccable` skill resolves)

## De-dupe

Track availability-skip warnings via an in-memory marker for the session. If the same mode skips twice for the same reason in a session, surface only the first skip in the response and keep the rest silent. The marker is per-process (in-memory) — there is no on-disk state.
