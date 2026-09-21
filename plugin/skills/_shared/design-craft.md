# Design Craft — assembling design context for UI-writing dispatches

Canonical procedure for how a dispatch that will write or modify UI code assembles its design context. Consumed at dispatch-composition time by the skills recorded in `docs/skill-graph.md`; this file has no callable surface of its own — every step below is executed by the calling skill, and the assembled result is what reaches the executing agent.

**Boundary:** this contract does not decide which dispatches count as UI-writing. Each consumer's own existing gate does — `pre-build`'s detection layers, polish's frontend check, `explore`'s own scope rules. The contract defines what to assemble once a consumer's gate says the dispatch is UI-writing.

## Gating

- Same Layer-1 kill-switch as every design-wrapper mode: the `design-integration` field in the project CLAUDE.md's `## Design integration` section (see `skills/design-wrapper/SKILL.md`, Layer 1). Missing → disabled — assembly does not run at all.
- Emil content is **web-track only**: when the consumer's resolved `surface_track` (`skills/design-wrapper/SKILL.md`'s track-resolution table) is `ios`, `android`, or `adaptive`, load no Emil skills — his content is CSS/web craft, and Impeccable's native references remain those tracks' principles source. The decisions layer is track-independent.

## The two source classes

| Class | Members | Character |
|---|---|---|
| **Decisions** | `DESIGN.md`, resolved via `_shared/visual-html-output.md`'s three-path lookup, plus the sidecar `.impeccable/design.json` (project root — upstream fixes its location, so no fallback glob) | Project-specific and durable: records of choices this project already made. Authoritative where they speak. Never written by anything in this plugin — upstream Impeccable owns both files. |
| **Principles** | Emil Kowalski's skills (when installed — resolution procedure below) plus Impeccable reference files | Generic craft, live-loaded at dispatch time. Reference-file *selection* is delegated to `skills/design-wrapper/modes/pre-build.md` Step 3 — this contract states the source classes and rules, not a duplicate file list. |

## The authority rule

**Conflict → decisions win; silence → principles govern.**

Two refinements, both part of the rule:

- **(a) Scope is per-sub-topic.** "Speaks" means the decisions address the specific property or behavior at hand, not the general area. Worked example: a `DESIGN.md` that defines colors and typography but no motion tokens has spoken on color and is silent on motion — for a button whose color `DESIGN.md` sets, the color comes from `DESIGN.md`, and the motion of that same button's hover transition is governed by principles.
- **(b) Decisions-internal tie-break.** The sidecar extends `DESIGN.md`; it never overrides it — upstream defines `.impeccable/design.json` as carrying what the frontmatter schema can't hold. On a direct disagreement between the two, `DESIGN.md` wins.

Content overlap between decisions and principles is accepted as a cost: there is no dedup rule. The consumer's existing `context_size` summarize-vs-inline mechanism (`modes/pre-build.md`'s Output-to-caller block) is the only volume control.

## Assembly is unconditional

The principles layer is assembled for every UI-writing dispatch — never "only if `DESIGN.md` is silent," and never conditioned on `DESIGN.md`'s coverage of a topic. There is no judgment call by which an implementer reads `DESIGN.md`, sees no motion content, and skips motion craft: the principles ride along regardless, and the authority rule — not presence-sniffing at assembly time — settles precedence per sub-topic.

## Emil skill resolution

Upstream: `github.com/emilkowalski/skills` (MIT), installed via `npx skills@latest add emilkowalski/skills`. The repo has no version tags — the pin lives in the upstream-drift manifest (`tools/upstream-drift/manifest.yml`; the entry is recorded by the governance record #387, and this reference names the pin's intended location whether or not that entry has landed yet).

Lookup order, per skill name from the relevance map below:

1. `{project}/.claude/skills/{name}/SKILL.md`
2. `~/.claude/skills/{name}/SKILL.md`

Load the `SKILL.md` at the first path that resolves; a name resolving at neither path is absent (see Degradation posture).

> **Install-layout verification note (2026-08-14, real install).** A throwaway `skills` CLI install (v1.5.18 — the then-latest v1.5.22 required Node ≥ 22.20) placed the actual skill directories at `{project}/.agents/skills/{name}/SKILL.md` (each directory containing `SKILL.md`) and created per-skill **symlinks** for Claude Code at `{project}/.claude/skills/{name}` → `../../.agents/skills/{name}`. Path 1 above therefore resolves through a symlink — read it normally, and do not skip symlinked directories. A user-level install location was not observed in that run; path 2 is retained as the conventional user-level Claude Code skills directory, secondary and unverified.

## Relevance map

Wired — loaded when the trigger holds:

| Skill | Trigger |
|---|---|
| `emil-design-eng` | Always, for any web-track UI-writing dispatch. |
| `animate`, `animation-vocabulary` | Only on an explicit motion signal. The signal is **consumer judgment reading the spec/description** — does it name motion work (animation, transition, gesture, micro-interaction)? — or `Design-intent: delightful`. This is an LLM judgment call by design, not a deterministic keyword gate. |
| `apple-design` | Only on an explicit signal: the spec or `Design-intent:` names Apple-style/HIG-like treatment. Never inferred. |

Wired — review-time critics (a skill may be wired for both roles; the writing-time table above governs context assembly, this one governs review-time critique — see `skills/design-wrapper/critics.md`):

| Skill | Trigger |
|---|---|
| `emil-design-eng` | see `skills/design-wrapper/critics.md` |
| `review-animations` | see `skills/design-wrapper/critics.md` |

Deliberately not wired — a future consumer wires these by deliberate choice, not accident:

| Skill | Why not |
|---|---|
| `prototype` | Superseded by design-wrapper `explore` mode's own renderer flow. |
| `pick-ui-library` | Reserved for the stack-decision record #357. |
| `improve-animations` | An editing pass over existing motion, not context for writing new UI. |
| `find-animation-opportunities` | Survey-shaped; overlaps design-wrapper `survey`'s recommendation role. |
| `ask-sonner` | Component-specific Q&A for one library — too narrow for ambient assembly. |

The map accounts for the whole upstream skill set as pinned in the drift manifest. Every upstream skill appears in at least one wired table (a skill may be wired for both the writing-time and review-time roles) or in the not-wired table — never silently absent. A new upstream skill appearing there is triaged into one of them.

## Degradation posture

Never a gate, never a stop:

| State | Behavior |
|---|---|
| Emil skills absent (no path resolves) | Skip them, with a note in the consumer's `missed` output — the field defined by `modes/pre-build.md`'s Output-to-caller block. |
| Impeccable absent | Emil-only principles layer. |
| Both absent | Plain build — the decisions layer (when present) still loads. |

## Subagent Contract compliance

Assembled craft content is **inlined into dispatch prompts** by default — dispatched agents can't
follow an unnamed, uninstructed path (`skills/_shared/subagent-output-contract.md`: agents only see
what's in their prompt; a bare path string reaches nothing). A **named** path paired with an
explicit "read this file first" instruction is not that case — it works whenever the dispatched
agent carries the `Read` tool (`modes/review.md` Step 3.8 (e) item 3's instructed read of the
decisions layer is the one consumer that takes this exception; #1863) — but this contract's own
writing-time assembly names no such exception: `pre-build`/`explore` inline every source class
unconditionally, regardless of agent tooling. Volume is governed by the consumer's existing
`context_size` summarize-vs-inline mechanism; this contract adds no size handling of its own.
