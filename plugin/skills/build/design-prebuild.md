# Design Pre-Build — lazy-loading Impeccable references and project design context

Common Step 1.7 of `/claude-tweaks:build`. Loaded only when SKILL.md's skill-load gate (`_shared/skill-load-gate.md`, `--mode pre-build`) proceeds, the build is in record mode, and the plan is non-trivial.

## Purpose

Before dispatching implementation, invoke the design wrapper to lazy-load Impeccable's reference files plus any project-specific design context (root `PRODUCT.md` from `/impeccable:impeccable init`, root `DESIGN.md` from `/impeccable:impeccable document`). The wrapper handles its own detection (non-frontend specs skip cleanly) and availability checks (no Impeccable installed → skip cleanly).

**Surface source:** `surface` (the `--surface` SKILL.md's Common Step 1.7 passes to the skill-load gate before invoking this file's procedure) comes from the materialized header's `surface:` field — lifted from the record body's `Surface:` metadata line per `skills/flow/materialize.md`'s Surface / Design-intent / Ui-stack / Design-seed lift rule. `design-intent` lifts from the same header/body source but is consumed downstream by `/claude-tweaks:design-wrapper polish`, not by this pre-build gate.

## Skip this step entirely when

- The build is in design mode with no spec or materialized record to inspect (the wrapper needs that context for surface detection — pure design-mode builds proceed without pre-load)
- The plan is trivial (< 3 file references, no UI files in the plan)

## On skip (write the trace)

When this step is skipped for any reason above — design mode with no record, or a trivial plan — write one `SKIP` entry per `_shared/auto-decision-log.md`'s degrade-trace rule (the skill-load gate's own `skip`, decided before this file is even loaded, is logged by the gate itself):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP \
  --section "/build" --step "Common Step 1.7 (skipped)" \
  --text "condition: {design mode, no record | trivial plan} → fallback: no design pre-load" --reversibility n/a
```

Standalone `/build` (no run dir): list the skip in the Step 7 handoff instead (`handoff-template.md`'s inline-skip listing).

## Invocation

Invoke `/claude-tweaks:design-wrapper pre-build <spec>`. Pass the record reference — the wrapper resolves it to the materialized header the same way Common Step 1.7's own surface check does — or the design doc path as a fallback.

## Terminal track

For `surface: terminal`, `/claude-tweaks:design-wrapper pre-build`'s own track resolution (`design-wrapper/SKILL.md`'s Layer 2 surface check) resolves `track: "terminal"` and loads a different, smaller always-load set than the three visual surfaces: `_shared/terminal-ux.md` plus `_shared/design-craft.md` only — no Impeccable references, no Emil skills, no `PRODUCT.md`/`DESIGN.md`/sidecar read (`design-wrapper/terminal-routing.md`'s `pre-build` row; the terminal branch itself lives in `design-wrapper/modes/pre-build.md` Step 3). The Result handling table applies unchanged. The "Where the loaded references go" section applies with a terminal-specific forwarding rule: the subagent-strategy bullet has a terminal-track clause that forwards the loaded set to every implementer task rather than filtering by UI-file path patterns (since terminal records have no UI file concept).

## Visual-reference scaffold (when present)

When the resolved record/spec carries a `Visual-reference:` body-metadata line (written by `/specify` Step 2.5b-ii — see `specify/design-pre-steps.md`), read that scaffold file directly (it is a small, already-committed static HTML file) and include its full contents in the implementer subagent's prompt as the concrete, already-selected visual direction — in addition to, not instead of, the loaded Impeccable references and the text brief. Frame it explicitly: "This is the accepted visual direction from shape-time exploration — port its structure, hierarchy, and visual treatment into the real component architecture; it is a north star, not a screenshot to trace verbatim (real data wiring, routing, accessibility semantics, and framework conventions still need to be built properly)." Absence of `Visual-reference:` is normal (most records won't have one) — proceed exactly as today.

## Ui-stack mandate (when present)

When the resolved record/spec's materialized header carries a `ui-stack:` field (lifted from the record body's `Ui-stack:` metadata line per `skills/flow/materialize.md`'s Surface / Design-intent / Ui-stack / Design-seed lift rule), include it verbatim in the implementer subagent's prompt as an explicit, non-negotiable constraint — not a suggestion the implementer may override with whatever a copied reference codebase happens to use. Frame it explicitly: "UI stack for this build: {ui-stack value}. Use this component library / styling approach for all new frontend code in this task — do not default to plain inline styles or a different library, even if a reference codebase nearby uses one." An `ui-stack` value of `none — no preference, defer to reference codebase` (or any of its variant phrasings) is itself a signal — omit the mandate line entirely in that case and let the implementer infer from the reference codebase as it does today, since that is the explicit answer the record's author gave.

Absence of `ui-stack:` (a pre-#357 record, or a record whose specify pass predates this field) is normal — proceed exactly as today, with no UI-stack guidance in the prompt.

## Result handling

| Wrapper return | Build behavior |
|----------------|----------------|
| `{result: "ok", loaded: [...], context_size: <n>}` | Inject the loaded reference paths and contents into the implementer subagent's prompt as additional context. When `context_size` exceeds the implementer's budget (rough threshold: 8000 tokens), summarize the references rather than passing them whole. |
| `{skipped: ...}` | Note the skip in the build log and proceed without lazy-loaded design references. |
| `{deferred: ...}` (should not happen for `pre-build`) | Treat as skip and proceed. |

See `_shared/design-wrapper-handling.md` for the canonical return-shape contract and the "why skips don't fail" rationale.

The `loaded` set is enriched beyond Impeccable references: per `_shared/design-craft.md`, it also carries craft principles assembled by the wrapper's principles step — Emil Kowalski's skills, when installed, plus the contract file itself — and the `.impeccable/design.json` sidecar from the wrapper's project-design-context step (the decisions layer). Forward all of it to implementers exactly like the pre-existing references — no separate handling; the same `context_size` summarize-vs-inline rule covers the larger set.

## Where the loaded references go

- **Subagent execution strategy** — the loaded reference text is appended to the implementer subagent's system prompt for each task that touches a UI file (paths matched against the spec's Key Files entries with frontend extensions/path patterns). **Terminal track:** "UI file" has no terminal analogue — forward the terminal-track loaded set (`_shared/terminal-ux.md` + `_shared/design-craft.md`) to every implementer task instead of filtering by path pattern.
- **Batched execution strategy** — the loaded references are summarized and surfaced in the batch handoff message so the human reviewer sees what design context is in play.
