---
files:
  - plugin/skills/design-wrapper/modes/explore.md
  - plugin/skills/design-wrapper/SKILL.md
  - plugin/skills/design-wrapper/impeccable-plugin.md
  - plugin/skills/design-wrapper/availability.md
  - plugin/bin/lib/impeccable-engine/index.js
  - plugin/skills/design-wrapper/compare-shell/template.html
  - plugin/skills/design-wrapper/compare-shell/seed-compare.mjs
  - plugin/skills/_shared/visual-decision.md
---

# Explore Competing Design Identities at a Project's Genesis

**Persona:** Developer starting a web project that has a `PRODUCT.md` but no locked `DESIGN.md` — they want to *see* competing visual identities rendered over their actual primary surface before committing one, instead of picking from prose descriptions.
**Goal:** Compare dealt identity directions as real rendered skins in the browser, pick one (or reroll/steer), and have upstream Impeccable write the `DESIGN.md` seed from that pick.
**Entry point:** A terminal in the project checkout: `/claude-tweaks:design-wrapper explore` standalone, or `/claude-tweaks:specify`'s Step 2.5b-ii pre-check offering the tournament at a genesis design doc.
**Success state:** `DESIGN.md` seeded by upstream `document --seed`; the winning scaffold + skin kept on disk as a `visual_reference` path; losing skins deleted.

## Steps

### 1. Invoke the mode — terminal
- **URL:** `/claude-tweaks:design-wrapper explore`
- **Action:** Run at genesis (no `DESIGN.md`, or an empty stub). Scope auto-resolves to `identity` via Layer 0's `hasDesign` signal.
- **Should feel:** Guarded but frictionless — the mode checks the kill-switch, the pinned plugin, and the track before any dealing happens; a native-surface project or a locked identity gets a clean one-line skip, never a broken tournament.
- **Should understand:** If `DESIGN.md` already declares a real identity (palette + typography direction), the mode refuses to re-deal — identity replacement routes through upstream new-work explicitly. Missing `PRODUCT.md` gets exactly one offer to run `/impeccable:impeccable init` first.
- **Red flags:** The mode running from a pipeline (`auto` / `$PIPELINE_RUN_DIR`) context — it is interactive-only; the wrapper globbing the plugin cache directly instead of resolving through the `impeccable-engine` module.

### 2. Deal and compare — browser
- **URL:** The ephemeral server URL the mode prints (serving `docs/plans/YYYY-MM-DD-{feature}-explore/index.html`)
- **Action:** Upstream's `concept-seed` engine verb deals (`impeccable-engine.js run concept-seed`, contacting Impeccable's catalog service); the mode derives and weighs per upstream's instruction block, then builds one shared HTML scaffold and one CSS skin per *presented* direction (assigned + surviving challengers — never the full candidate list). Cycle skins with arrow keys; the "1 / N — {direction}" indicator names each world.
- **Should feel:** A real comparison of identities, not layouts — the markup never changes between slots, only the skin stylesheet swaps, so what differs is exactly the visual world.
- **Should understand:** Scaffold copy is partly invented placeholder content (the offer text says so); a builder that couldn't express its direction as a pure restyle appears as a degraded slot — visible, named, not pickable. The focus view also carries the shared shell's hue / spacing / radius tweak levers — the same panel the layout scope uses, since one `seed-compare.mjs` template serves both scopes. In this scope they are especially not a way to adjust the dealt world: they preview the shell's own panel only, never the skin under judgment, and a nudge records a `tweak` event that is never a verdict.
- **Red flags:** A skin that restructures markup; external fonts/CDN assets in the switcher; all candidates rendered instead of the presented set; a tweak lever appearing to restyle the dealt world's own skin, or a tweak event resolving the round.

### 3. Verdict and lock-in — browser + terminal
- **URL:** The same `AskUserQuestion` verdict, reused each round: pick / reroll / steer / the canon standing exit (listed last, never recommended).
- **Action:** Pick a world — the mode sends `--chosen <id> --from <key>` and invokes `/impeccable:impeccable document --seed`; or reroll (`--reroll <n> --from <key>`, upstream excludes everything already shown), or steer (a reroll whose one-line steer guides the next fuse/weigh pass).
- **Should feel:** Cheap iteration — a reroll re-deals and re-skins without touching the markup; after two consecutive rerolls the mode asks upstream's "what quality is missing" question instead of dealing blind.
- **Should understand:** Upstream writes `DESIGN.md`, never the wrapper — the wrapper's only durable artifacts live under `docs/plans/`. Exiting without a pick deletes the explore directory entirely.
- **Red flags:** `DESIGN.md` edited by the wrapper itself; losing skins left on disk after a pick; the winning skin deleted (it is the `visual_reference` target downstream steps read).
