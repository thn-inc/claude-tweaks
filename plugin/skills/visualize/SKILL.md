---
name: visualize
description: Use for a themed diagram (architecture, flowchart, sequence, state, ER — see argument-hint) or a live diagram of this project's open queue. Standalone, or a soft-hook suggestion from /journeys, /specify, /review.
argument-hint: "<architecture|flowchart|sequence|state|er|timeline|swimlane|quadrant|nested|tree|org-chart|layers|venn|pyramid|record-graph> [topic] [--source <caller>] [--ephemeral]"
---

# Visualize — Themed Diagram Generation

Generates a self-contained HTML+SVG diagram, themed from the project's own design tokens, embeddable in project docs.

```
                       [ /claude-tweaks:visualize ] ← utility (no fixed lifecycle position)
                                    ↑
   Used by: /claude-tweaks:journeys (Step 3.6), /claude-tweaks:specify (Step 2.5d),
            /claude-tweaks:review (Lens 3i-diagram), ad-hoc direct invocation
```

## When to Use

- A journey, spec, or review finding describes something a diagram would clarify — a state machine, a data model, a multi-actor flow, a decision tree, or a layered architecture.
- You want a quick diagram of an idea mid-conversation, whether or not it ends up as a committed project doc.
- You want to replace a hand-drawn or stale diagram with one that matches the project's actual current palette.

## Input

`$ARGUMENTS` is parsed as `<type> <topic>`:

| Type | Diagram |
|------|---------|
| `architecture` | 3+ components/services in a system layout |
| `flowchart` | Branching logic with named conditions |
| `sequence` | 2+ actors exchanging messages over time |
| `state` | An entity has named states + transitions |
| `er` | Schema/entities with relations |
| `timeline` | Ordered events along a fixed axis |
| `swimlane` | A process crosses 2+ roles/departments |
| `quadrant` | Two-axis ranking |
| `nested` | Contained/grouped relationships |
| `tree` | Parent-child hierarchy, taxonomy |
| `org-chart` | Reporting structure |
| `layers` | Abstraction levels (transport → app → ui) |
| `venn` | Set overlap |
| `pyramid` | Stacked priority/maturity levels |
| `record-graph` | This project's own live open work-record queue — stage columns, dependency edges, six-axis badges. No topic. |

`<topic>` is free text describing what to diagram. If `$ARGUMENTS` is empty, ask the user for both — except `record-graph`, which takes no topic at all: `/claude-tweaks:visualize record-graph` alone is a complete invocation, and `$ARGUMENTS` being exactly `record-graph` should never trigger the "ask for both" fallback.

Flags:
- `--source <caller>` — set by soft-hook callers (`journeys`, `specify`, `review`) to select default placement (Step 3) without prompting.
- `--ephemeral` — for direct/ad-hoc invocation only (no `--source`): skip Step 3's persist-vs-ephemeral `AskUserQuestion` and go straight to the scratch-path-only "Just show me now" behavior. For a quick mid-conversation sketch where the user already knows they don't want it saved as a project doc.

## Workflow

Routing shape: Steps 2-3 run for both the enhanced and baseline paths (resolved in Step 1) before branching — enhanced continues to `d2-enhanced-path.md` then Step 5; baseline continues to Step 4 then Step 5.

### Step 1: Resolve type, topic, and generation path

Resolve `<type>` from Input. Assess content richness alongside it: judge how much source material actually backs this topic — a one-line description or a couple of sentences vs. several dense documents (specs, design docs, strategy/risk writeups) or a conversation that has already surfaced multiple workstreams and tradeoffs. Map the judgment to one of two density tiers, carried forward to Step 4 (baseline) or `d2-enhanced-path.md` (enhanced):

| Tier | Source material | Output density |
|---|---|---|
| **Minimal** (default) | A short description, one topic, few components | Today's plain node-and-arrow construct: short labels, a handful of small callout cards |
| **Rich** | Multiple dense documents, or several workstreams/strategy/risk topics already surfaced | A documentation-style page: more detail per node, explanatory callout panels drawn into the canvas, a legend/context section, longer descriptive labels — see Step 4's and `d2-enhanced-path.md`'s own richness-scaling instructions |

This is a judgment call, not a mechanical line-count threshold — weigh breadth (how many distinct components/workstreams the source material covers) over raw length. Default to Minimal when in doubt; scaling up an under-specified topic invents detail the source material never supported. Never scale by adding visual noise at the same information density (more boxes of the same size, more filler) — richness means more genuine explanatory content, not clutter.

Look up the generation path — **enhanced** when the `d2` binary is installed (`d2 --version` exits 0) and the type has a D2-native mapping; **baseline** otherwise (always available):

| Type | Path | D2 construct |
|---|---|---|
| `sequence` | Enhanced | `shape: sequence_diagram` |
| `er` | Enhanced | `shape: sql_table` |
| `architecture`, `flowchart`, `tree`, `layers`, `state`, `org-chart`, `nested` | Enhanced | Container-based directed graph |
| `quadrant` | Enhanced (tentative — confirm against current D2 docs; fall back to baseline if unsupported) | Grid layout |
| `timeline`, `swimlane`, `venn`, `pyramid` | Baseline only | No native fit |
| `record-graph` | Enhanced when `d2` is installed, baseline otherwise (same rule as every other type) | Container-based directed graph (stage-column containers, record nodes, dependency edges) |

For `record-graph`, skip topic resolution entirely and read `record-graph.md` in this skill's directory — it owns the fetch (Step A), render (Step B), and placement (Step C, which overrides Step 3 below for this type only), and its own "Execution order" note is the one authoritative sequencing of those steps against Steps 2/5/6 below, not restated here. **Step 4 is the only step it supersedes**: `bin/record-graph.js`'s `svg` output *is* the core fragment Step 4 would otherwise hand-author, so skip Step 4's own instructions for this type. Steps 2, 5, and 6 all still run normally — `record-graph.md` hands control back here for each of them, at the point its own Execution order note specifies.

### Step 2: Token extraction and theming (both paths)

Read `skills/_shared/visual-html-output.md` Steps 1-2. Extract tokens from `DESIGN.md` when present; otherwise run the fallback `AskUserQuestion` (once per session — see the dedupe rule in that file). Continue to Step 3.

### Step 3: Resolve placement

| Caller (`--source`) | Placement |
|---|---|
| `journeys` | `docs/journeys/{journey-name}-{type}.html` |
| `specify` | `docs/plans/{spec-slug}-{type}.html` |
| `review` | Ephemeral by default; ask before persisting near `docs/architecture.md` |
| *(none — direct invocation)*, `--ephemeral` not passed | Run `visual-html-output.md` Step 6's `AskUserQuestion`; "Save as a project doc" resolves to `docs/diagrams/{slug}.html` |
| *(none — direct invocation)*, `--ephemeral` passed | Skip the `AskUserQuestion` — go straight to `visual-html-output.md` Step 6's "Just show me now" behavior (scratch-path-only, no `docs/` placement, no Step 6 registry update, no MDX-embed snippet) |
| `record-graph` (any invocation) | Overridden entirely by `record-graph.md` Step C — always `docs/diagrams/record-graph.html` (+ `.d2` source), no `AskUserQuestion`, always persisted and overwritten. |

Branch per the routing shape above: enhanced → read `d2-enhanced-path.md` in this skill's directory (it now has a resolved destination path to write to) → Step 5. Baseline → Step 4 → Step 5.

### Step 4: Generate the core fragment (baseline path)

Author the `<svg>` content directly for the diagram type and topic, binding every color to `var(--token-name)` from Step 2's extracted (or neutral fallback) palette. Follow `visual-html-output.md` Step 3's scoping rule — every custom class prefixed with a unique per-diagram slug.

Scale the authored content to Step 1's density tier. **Minimal** — the construct as already described in Step 1's table: short labels, small callout cards. **Rich** — expand the same canvas rather than replacing the construct: richer per-node detail (a short description line under each label, not just the label), explanatory callout panels for the diagram's key decisions/tradeoffs drawn as their own SVG groups alongside the main graph, and a legend/context panel when the diagram introduces notation a reader wouldn't already know. Every added element still binds through the same token palette and scoped-class rule above — richness is more genuine content at the same visual polish, never a second unstyled layer bolted onto a themed diagram.

### Step 5: Write wrapper outputs

Apply `visual-html-output.md` Step 4's adapters. Always write the standalone-file wrapper to the path from Step 3. Write the markdown-embed wrapper's content inline in this skill's own response (for the user to copy into a doc) rather than as a separate file — it's a snippet, not a standalone artifact.

Run `visual-html-output.md` Step 5's MDX/Nextra detection at the same time; when it finds an MDX-based docs app, include that file's reference snippet with the embed wrapper. Skip it on an ephemeral run — nothing stays in the project to embed.

Once the standalone file is written, run `visual-html-output.md` Step 7 to deliver it — a clickable `file://` link plus a `SendUserFile` handoff when that tool is available — rather than leaving the diagram's preview path to be improvised later.

Alongside the embed snippet, also surface a suggested `files:` frontmatter line naming the diagram's depicted source dependencies (the files under discussion when the diagram's topic was resolved in Step 1) — e.g.:

```yaml
files:
  - packages/food-graph/src/resolvers/ingredient-resolver.ts
```

This skill doesn't own the doc that embeds the diagram, so it doesn't write this itself — the caller (typically the user, copy-pasting the embed snippet in by hand) applies it to that doc's frontmatter alongside the snippet, giving `/claude-tweaks:docs-health`'s freshness-dependency check (`_shared/criteria-docs-diataxis.md` Dimension 2) something to track. Skip this output when the diagram has no clear source-file dependency (e.g. a purely conceptual diagram with no 1:1 code mapping).

### Step 6: Registry update (persisted diagrams only)

Skip this step entirely if the project has no `docs/REGISTRY.md` at all — the registry is itself an opt-in convention (see `build/docs-sync.md`), not something this skill creates from scratch.

If `docs/REGISTRY.md` exists, Step 3 resolved to `docs/diagrams/{slug}.html` (the context-free fallback path), and no `REGISTRY.md` row for `docs/diagrams/` exists yet, add one: `| docs/diagrams/ | Generated visual diagrams | — |` (no Auto-detect — matches `architecture.md`/`decisions/*.md` treatment). Diagrams placed under `docs/journeys/` or `docs/plans/` need no new row — they ride along with that doc's existing registry entry.

## Next Actions

After generating, render as plain markdown (docs/skill-authoring.md's Skill handoffs convention). This block only renders standalone (see the Component-Skill Contract below), so there is no calling flow to return to — the lines are the diagram itself and the next diagram:

**`/claude-tweaks:visualize <type> <topic>`** — generate another diagram, when more signals matched (recommended)
`open {path}` — view the generated diagram (when persisted)

## Component-Skill Contract

When `$PIPELINE_RUN_DIR` is set, `/claude-tweaks:visualize` is running inside a pipeline (invoked by `/claude-tweaks:journeys`, `/claude-tweaks:specify`, `/claude-tweaks:review`, or another pipeline orchestrator). In that case omit the `## Next Actions` block — the parent owns the handoff.

Direct invocation may pass `--source <parent-skill>` as an explicit fallback when ambiguity exists (rare; `$PIPELINE_RUN_DIR` is the primary signal).

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Regenerating the core fragment separately per wrapper | The standalone file and markdown embed drift apart. Generate once (Step 4), wrap two ways (Step 5). |
| Re-asking the DESIGN.md fallback question every invocation | Annoys a user who already declined Impeccable. Dedupe per session (`visual-html-output.md` Step 2). |
| Forcing a baseline-only type through the D2 enhanced path | Timeline/swimlane/venn/pyramid have no graph-shaped representation — it fights the tool like theming fights Mermaid/D2's engines. |
| Writing every diagram to central `docs/diagrams/` regardless of caller | Co-locate with what the diagram illustrates (Step 3); `docs/diagrams/` is the fallback for context-free invocations only. `record-graph` is the sole by-rule exception (Step 3's table row) — it always writes there. |
| Model hand-authoring `record-graph`'s D2/SVG source from the fetched JSON | Defeats the type's purpose: avoiding LLM transcription of structured queue data (wrong issue numbers, dropped labels). Always route through `bin/record-graph.js render`. |
