# Design Mode — explore

Invoked via `/claude-tweaks:design-wrapper explore [<surface-topic>] [--scope identity|layout] [--source <parent-skill>]`. Returns `{mode: "explore", result: "ok", scope: "identity", ...}` or `{mode: "explore", skipped: "...", ...}` to caller.

**Interactive-only — has no auto-mode branch**, like `live`. Every step below assumes a human is present in a browser to answer the Verdict question; no caller may invoke this mode from `auto` or a `$PIPELINE_RUN_DIR`-set context.

**Mode contract:**

| Argument | Meaning |
|---|---|
| `<surface-topic>` | Optional free text. Consumed by the `layout` scope's own procedure below; the `identity` scope ignores it entirely. |
| `--scope identity\|layout` | Explicit scope. Wins over auto-resolution when present. |
| `--source <parent-skill>` | Same signal every other mode uses — see `../SKILL.md`'s Component-Skill Contract. |

This file covers both scopes. The `identity` scope (`## Procedure — identity scope` below) runs the genesis worlds tournament when a project has a `PRODUCT.md` but no coherent `DESIGN.md` yet. The `layout` scope (`## Procedure — layout scope` below) runs the established-world composition tournament once an identity is locked in `DESIGN.md` — comparing rendered composition and interaction-framing variants of a new surface inside it.

## When this runs

Invoked directly via `/claude-tweaks:design-wrapper explore`, or by a caller that resolved the scope on its own side and passes `--scope` explicitly (an explicit `--scope` wins over this mode's auto-resolution, so the two sides cannot disagree). This mode does not assume any particular caller and must work correctly when invoked standalone — caller relationships live in `docs/skill-graph.md`, not here.

Division of labor, load-bearing: **upstream deals, this mode derives and renders.** `concept-seed.mjs` assigns and deals; its output is a single prose instruction block that tells the calling agent how to derive grounded directions, fuse dealt challengers, and weigh them — it emits no per-world card payloads. This mode is that calling agent. The dealing catalog, exclusion rules, and canon semantics stay upstream's; this mode never maintains a parallel catalog and never filters a deal on its own judgment.

## Preconditions

**Not the universal three-layer chain** — `doctor`-style, for the same structural reasons:

- **Layer 2** reads a record's `Surface:` line. `explore` receives no spec.
- **Layer 3** sniffs a changed-file list for frontend extensions. `explore` has no file list — it runs at genesis, typically against a clean or nearly-clean tree, where the diff is empty or irrelevant to the question this mode answers.

**Layer 1** (the `design-integration` kill-switch from `../SKILL.md`) applies in full. **Track resolution** runs — every mode resolves a track — and the **native track skips**:

```json
{ "mode": "explore", "skipped": "native surface — explore is web-only", "surface_track": "<ios|android|adaptive>" }
```

The genesis worlds tournament renders CSS skins over an HTML scaffold in a browser; a native app has no page for that scaffold to become. This mirrors `live.md`'s Step 1.5 exactly, on the same upstream constraint (`reference/routing.md`: web-only).

**Availability** is exact-pin `resolveImpeccablePlugin`, `doctor`-class — not the looser skill-resolution check `review`/`shape`/`polish`/`live` use. `concept-seed.mjs` is a bundled script that does not exist at every plugin version satisfying skill resolution (`../impeccable-plugin.md`'s "The pin is not pedantry"), so never glob the plugin cache directly, and never treat a resolved `/impeccable:impeccable*` skill as proof the script is present.

## Scope resolution

A short table, run before any procedure step below. Layer 0's `hasDesign` signal is read per `../impeccable-plugin.md`; when Layer 0 degraded, fall back to a direct existence check for `DESIGN.md` at the project root.

| Input | Resolution |
|---|---|
| No explicit `--scope`, `hasDesign` false | → `identity` — continue below |
| No explicit `--scope`, `hasDesign` true | → `layout` — continue in `## Procedure — layout scope` below |
| `--scope identity`, `hasDesign` true, `DESIGN.md` **coherent** | `{ "mode": "explore", "skipped": "design identity already locked — route identity replacement through upstream new-work explicitly" }` |
| `--scope identity`, `hasDesign` false, or `DESIGN.md` not coherent | → `identity` — continue below |
| `--scope layout` | → `layout` — continue in `## Procedure — layout scope` below |

**Coherent** means the file declares an actual identity — at minimum a palette and a typography direction, the identity-bearing sections upstream's `document.md` writes. An empty or stub `DESIGN.md` is not coherent. **Ambiguity resolves toward coherent** — toward the locked-identity skip, never toward casually re-dealing an identity that might already be someone's real answer. This is the conservative mirror of the wrapper's own "ambiguity resolves to allow" posture, pointed the other way because re-dealing is the destructive-feeling action here.

**`PRODUCT.md` missing** is checked before the above (there is no genesis tournament with no product to build a scaffold from). Offer once:

**Call `AskUserQuestion`:** `question`: `"No PRODUCT.md found — run /impeccable:impeccable init to establish one before exploring identities?"`, `header`: `"Missing PRODUCT.md"`, `multiSelect`: `false`. Option 1 — `label`: `"Yes — run init (Recommended)"`, `description`: `"Invoke /impeccable:impeccable init."`. Option 2 — `label`: `"Skip"`, `description`: `"Do not explore — return without running."`

On decline (or any answer but option 1): `{ "mode": "explore", "skipped": "no PRODUCT.md — run /impeccable:impeccable init first" }`. Never fabricate project context to route around this.

---

## Procedure — identity scope

Each step below carries a **stable heading name** — a later record reuses these headings verbatim for the `layout` scope, never by step number.

### Deal and derive

Resolve `concept-seed.mjs` via `resolveImpeccablePlugin` (reuse Layer 0's `root` when already resolved this invocation), then run:

```bash
node "<root>/skills/impeccable/scripts/concept-seed.mjs" --scope direction --mode <mode>
```

`<mode>` is a real, optional parameter of the script — one of `persuade`, `operate`, `read`, `experience`. Map the primary surface's job: **persuade** for marketing/conversion surfaces, **operate** for tools/dashboards, **read** for content/reading surfaces, **experience** for immersive ones. When the job is unclear, **omit `--mode` entirely** — staging then rolls from the full approved pool rather than this mode guessing. Leave `--candidate-count` at the script's own default; sizing the deal is upstream's call, not this mode's. **This is the identity scope's own policy** — the layout scope makes a different, deliberate choice for its own deal; see "Dealing" below, which does not change this sentence's meaning here.

Follow the returned instruction block exactly as upstream directs: derive grounded directions, fuse each dealt challenger, weigh them. **The render set is the *presented* directions only** — the assigned direction plus the one or two surviving fused challengers upstream's own presentation rule names — **never the full candidate list** `--candidate-count` sized. Record the deal's id ↔ display-name mapping (`--chosen` below takes the id, never the name). Carry the printed seed `key` and a reroll counter for the whole session — both cross every reroll and the final pick. **This one-to-three render-set size is the identity scope's own count and is unchanged by this record; it does not extend to the layout scope**, whose own, larger render-set size and its own diversity check are defined separately below in "Dealing" and "Machinery reuse".

### Synthesize clean-room cards

`concept-seed.mjs`'s output is **one shared instruction block**, not per-world payloads — handing it raw to the builders in the next step would leak every sibling direction into every card and destroy the fan-out's independence. This step is what makes the clean room real: for each presented direction, compose one self-contained card carrying its display name, the complete graphic-system description (palette, type voice, material/component character, motion stance), and only the product facts that direction's builder needs. No sibling direction's content crosses into another card.

### One markup, N skins

Build one disposable semantic HTML scaffold of the primary surface, sourced from `PRODUCT.md` (plus a design doc or brief, when one exists), following `skills/specify/design-pre-steps.md` Step 2.5b-ii's conventions: realistic placeholder content, no real data wiring, no framework integration. Save it under `docs/plans/YYYY-MM-DD-{feature}-explore/`, with every token referenced through CSS custom properties only — never a literal color or font baked into the markup or a skin.

**This is load-bearing, not incidental:** one markup file, one CSS file per presented direction. Skins may **restyle**, never **restructure** — no builder adds, removes, or reorders elements. The constraint keeps the comparison strictly about identities (a variant that also changed structure would confound "which world" with "which layout"), and it is what makes a reroll cheap: a reroll re-deals and re-skins, and the markup is never touched.

**Scaffold content at genesis is partly invented.** `PRODUCT.md` describes the product, not this specific page's copy — the offer text presented before building the scaffold must say so, so the user compares identities against placeholder content knowingly rather than mistaking it for real copy.

### Parallel skin builders

One Task agent per presented direction, per `skills/_shared/subagent-output-contract.md`: **Standard** profile (fan-out — never Frontier), a status line as the first line of the reply, and clean-room input limited to the synthesized direction card plus the shared markup path (read-only). Builders never restructure markup to compensate for a direction that doesn't fit — see the previous step.

Each dispatch prompt also carries the **principles layer**, assembled at composition time per `_shared/design-craft.md` and inlined verbatim — a reference inside the prompt reaches nothing — naming its sources per the contract: Emil Kowalski's skills as its relevance map selects them (when installed), plus Impeccable reference files, alongside the dealt world's card. This scope assembles principles only: no `DESIGN.md` and no sidecar read — at genesis there are no decisions to load, by definition. Selection and gating live in the contract; an absent Emil install is noted once in the offer text presented before building (this interactive-only mode has no `missed` output field) and never gates the round.

Templates A/B/C don't fit a file-producing builder, so the output format is defined explicitly here, inlined literally in every dispatch prompt:

```
OUTPUT FORMAT (required):
SKIN: {path to the CSS file you wrote, relative to the explore directory}
DIRECTION: {display name of the direction you skinned}
CONCERNS: (up to 3 bullet lines; omit this line entirely if none)
- {concern}

Restyle the shared markup only — do not add, remove, or reorder elements. If this direction cannot be
faithfully expressed as a pure restyle of the shared markup, report DONE_WITH_CONCERNS and name what
could not be expressed rather than restructuring around it.

Status line (required): after everything above, on its own trailing line — the last non-empty
line of your reply — write exactly one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
```

**Degraded variant slot:** a `BLOCKED`/failed builder, or one that reports `DONE_WITH_CONCERNS` because its direction cannot be faithfully expressed as a pure restyle, still gets a slot in the switcher — counted in the "1 / N" indicator, visibly naming the direction and the failure or concern — but that slot is **not pickable** as a winner in the Verdict step below.

### Compare

Compose a manifest (`plugin/skills/design-wrapper/compare-shell/seed-compare.mjs`'s schema) from
the render set: `scope` from Scope resolution above, `seedKey`/`rerollCount`/`steerHistory`
carried from Deal and derive, `sharedMarkup` (identity scope only — the disposable scaffold from
One markup, N skins) plus one `variants[]` entry per presented direction (its dealt display name,
the winning skin CSS path for identity scope or the whole markup file for layout scope, and
`degraded`/`reason` for any slot from the previous step — still counted, never pickable). Seed it
live (`seed-compare.mjs --manifest <manifest.json> --mode live --out <explore-dir>/index.html`),
then start the server (`visual-decide.js start --dir <explore-dir> --state <explore-dir>/.vd-state`).
Present the returned keyed URL to the user; `_shared/visual-decision.md` owns the turn loop this
hands off to.

**Once the server has started, any error that aborts the round before reaching Lock-in's own stop
call — Deal and derive failing on a reroll, an interrupted terminal session, an unhandled error in
Verdict — must still stop it (`visual-decide.js stop --state <explore-dir>/.vd-state`) before
propagating or returning. The idle timeout is a backstop only, per `_shared/visual-decision.md`'s
Lifecycle ownership — never the primary teardown path.**

**Degraded mode (server fails to start):** seed the same shell to the same static file and open it
by hand — no second switcher implementation exists. Verdict runs the terminal `AskUserQuestion`
loop below instead of the browser turn loop; a reroll re-seeds the static file in place, with the
user refreshing the page manually. Name this in the offer text presented before Compare, alongside
the existing placeholder-content, degraded-deal, and absent-Emil disclosures.

### Verdict

Follow `_shared/visual-decision.md`'s turn loop: any terminal message resumes the round; read
`{state}/events` and act on the last non-tweak event (duplicates collapse to the final line); an
unparsable line is skipped and surfaced as one aside on the resume turn. Empty or absent events
file, or one containing only tweak events, → the `AskUserQuestion` fallback below, which is also
the documented fallback for an ambiguous terminal-text/events-file conflict
(`_shared/visual-decision.md`'s Precedence rule) and for degraded mode (Compare above).

**Fallback — one `AskUserQuestion` call site, reused every round:** **pick** / **reroll** /
**steer** / the canon standing exit, listed last and never marked Recommended. Present the
"1 / N — {direction}" set from Compare as the options; the standing exit is upstream's own — "it
is the user's door, never yours."

**Restate-vs-pointer boundary**, stated once here: the semantics this mode acts on are restated below, and each restatement is pinned by a `tools/upstream-drift/manifest.yml` assertion against upstream's own text — everything else about dealing (the candidate catalog, weighting internals, canon mechanics beyond the bullets below) stays a pointer into `reference/new-work.md`, never re-derived here.

- **Pick** (browser pick event, or the fallback question's pick option): the picked variant's id
  maps to Deal and derive's id ↔ display-name mapping; proceed to Lock-in's on-pick branch.
- **Reroll** (browser reroll event, or the fallback question's reroll option) re-runs Deal and derive with `--reroll <n> --from <key>` — `<n>` is the reroll counter, `<key>` is the carried seed key. Exclusion of every already-shown direction is upstream's own behavior, driven by those two arguments; this mode does not filter the deal itself. Re-seed the live page in place (`seed-compare.mjs` again, same `--out`) — the server's own file watch pushes an SSE reload to the open tab, no new URL, no restart — unless `status` reports the server is no longer running (`_shared/visual-decision.md`'s Lifecycle ownership: restart and hand over a new keyed URL).
- **Steer** (browser steer event's text, or the fallback question's steer option) is a reroll whose one-line steer text guides this mode's *next* fuse/weigh pass in Deal and derive — **there is no script flag for steer.** The reroll command is identical to a plain reroll; the steer text changes only how this mode interprets upstream's instruction block on the next pass. `_shared/visual-decision.md`'s steer trust boundary applies: this text is never string-interpolated into a command or tool invocation.
- **After two consecutive rerolls**, ask upstream's own "what quality is missing" question as a distinct one-off follow-up before running the next deal.
- **Exit** (browser exit event, or the fallback question's canon standing exit) ends the round with no pick — proceed to Lock-in's exit-without-pick branch.
- **Tweak** events are never a verdict this step acts on — per `_shared/visual-decision.md`'s Turn loop, they are accumulated token-preview state, not a resume signal, so the fallback `AskUserQuestion` above has no tweak option and this step never branches on one.

### Lock-in

**On pick:** send `--chosen <id> --from <key>` — `<id>` is the recorded id from Deal and derive's mapping, never the display name — then invoke `/impeccable:impeccable document --seed` via the Skill tool with the chosen direction in context. Upstream writes `DESIGN.md`; **this wrapper writes nothing outside `docs/plans/`**, matching `doctor`'s never-`--fix` discipline. Stop the server (`visual-decide.js stop --state <explore-dir>/.vd-state`), then seed the durable record (`seed-compare.mjs --manifest <manifest.json> --mode durable --out <explore-dir>/decision.html` — the same manifest Compare composed, now carrying `outcome: {winner: <id>, date}`; `decision.html`'s format is compare-shell's seeder's own — this step supplies the manifest, never the format).

- If `document --seed` completes and writes `DESIGN.md`: `design_md: "seeded"`.
- If the user backs out of that upstream step after already committing to a pick here: `design_md: "declined"` — the picked scaffold and winning skin are still kept as `visual_reference` either way, since the identity choice itself stands independent of whether upstream's own write completed.

Keep the scaffold plus the winning skin — the survivor becomes `visual_reference`, the path a caller may persist as a `Visual-reference:` body-metadata line. Delete every losing skin. `visual_reference` is `null` only when the pick itself succeeded but writing the kept artifact to disk failed — name that outcome rather than silently returning a path that doesn't exist.

**On exit-without-pick:** stop the server (`visual-decide.js stop --state <explore-dir>/.vd-state`), delete the whole explore directory, and return a skip — no partial artifact survives an abandoned round.

---

## Procedure — layout scope

Run once scope resolution above routes here: an established-world composition tournament — one identity, N markups. Each variant composes the same new surface differently — what is on the page, how it is arranged, where the primary action sits — all dressed in `DESIGN.md`'s already-locked tokens. This inverts the identity scope's constant: the identity scope fixes the markup and varies the skin; this scope treats `DESIGN.md`'s tokens as fixed and varies the markup.

### Input contract

`<surface-topic>` names the new surface: free text plus one to three sentences of content requirements — what the page must contain, who uses it, and the primary action. On standalone invocation with no `<surface-topic>` given, ask for it once before dealing, then continue with the answer as `<surface-topic>`.

**Call `AskUserQuestion`:** `question`: `"What surface should this compose — name it and describe what it must contain, who uses it, and its primary action?"`, `header`: `"Surface to explore"`.

### Dealing

Resolve `concept-seed.mjs` the same way the identity scope's Deal and derive step does, then run:

```bash
node "<root>/skills/impeccable/scripts/concept-seed.mjs" --scope surface --mode <mode> --from <key> --candidate-count 6
```

`<mode>` selection follows the identity scope's Deal and derive rule — the same persuade/operate/read/experience mapping, the same omit-when-unclear fallback — mapped from `<surface-topic>`'s job rather than the project's.

**Unlike the identity scope's Deal and derive** (which leaves `--candidate-count` at the script's own default — unchanged above), this scope explicitly overrides it to `--candidate-count 6`. This is a deliberate policy choice scoped to the layout scope only, not a claim that the identity scope's default was wrong: "Machinery reuse" below applies a diversity check that rejects near-duplicate fused challengers before they reach the render set, and a small dealt pool risks starving that check down to too few survivors. The target is **at least four structurally distinct presented directions** by default — up from the one-to-three the unmodified deal otherwise yields — with no manual reroll or steer text required to reach it. A genuinely exhausted dealt pool (fewer than four directions survive the diversity check) degrades to presenting fewer than four rather than presenting near-duplicates; that degraded case is named in the offer text presented before Compare.

`<key>` is the committed direction's seed key. It is **not recorded in `DESIGN.md`** — upstream's `document --seed` does not write it there. Its only durable homes, in resolution order:

1. the caller's record `Design-seed:` body-metadata line — this repo's established carrier, written by this wrapper's own `review` mode per `skills/_shared/design-contract.md`;
2. absent that, the direction contract's `FORM` block inside a built artifact's opening comment, parsed per `skills/_shared/design-contract.md`'s procedure over the candidate list the caller already resolved — this mode never discovers candidate files on its own.

Zero candidates, no seed label found, or multiple candidates whose keys disagree → **deal without `--from`**, and say so in the offer text presented before dealing: challengers are dealt without the committed direction's seed. Degraded, never fatal.

### Variant builders

Same synthesis responsibility as the identity scope's Synthesize clean-room cards step: the deal's output is one shared instruction block, and this step turns it into one self-contained staging card per presented direction before any builder sees it.

Each builder receives the synthesized staging card, `DESIGN.md` read-only, and `<surface-topic>`'s content requirements, and writes one markup file composing the surface differently.

Each variant dispatch prompt additionally carries craft context assembled at composition time per `_shared/design-craft.md` and inlined verbatim: the **decisions** layer — that same `DESIGN.md` plus the `.impeccable/design.json` sidecar — and the **principles** layer. Selection and gating live in the contract; absent-Emil surfacing follows the identity scope's rule (a one-line note in the offer text before dealing, never a gate).

**Markups may not restyle** — no new palette, no new type voice, no new motif. Upstream `reference/visualize.md`'s frozen-identity list is the reference: "Keep DESIGN.md's palette, typography direction, material language, component character, imagery stance, and motion grammar fixed." Stated side by side with the identity scope's inverse constraint (One markup, N skins: skins may restyle, never restructure) so drift in one is visible against the other.

### Machinery reuse

Run Synthesize clean-room cards through Lock-in — every intervening identity-scope heading (One markup, N skins; Parallel skin builders; Compare; Verdict) reused by name — with these substitutions:

- **Builder input:** staging card + `DESIGN.md` (read-only) + `<surface-topic>`'s content requirements + the assembled craft context from Variant builders above, in place of the skin builder's card-plus-shared-markup input.
- **Builder output:** one markup file, in place of one skin stylesheet.
- **Scaffolding:** no single shared markup — each builder writes its own document. What carries over from One markup, N skins is the `docs/plans/YYYY-MM-DD-{feature}-explore/` directory convention and the invented-placeholder-content disclosure, not the shared-scaffold constraint (this scope inverts it — see Variant builders above).
- **Switcher unit:** seeded by the same `seed-compare.mjs` template as the identity scope, in both scopes — the manifest's `variants[].files` supplies each variant's own whole markup file here rather than a shared skin, so no separate switcher implementation is needed for this scope.
- **Diversity check (layout-scope addition — not part of the shared "Deal and derive" heading, and does not apply to the identity scope):** when fusing each dealt challenger, reject and replace a fused challenger whose composed markup is only superficially different from a direction already accepted for presentation — same overall page structure, same primary-action placement, same interaction framing, differing only in wording or a single component's arrangement. A rejected challenger is not counted toward the render set; continue fusing the next dealt challenger from the `--candidate-count 6` pool ("Dealing" above) until at least four structurally distinct directions are accepted or the pool is exhausted.
- **Lock-in:** return `visual_reference`; no `/impeccable:impeccable document --seed` invocation.

**Scope of this fix, stated explicitly:** the render-set-size and diversity-check change lives here and in "Dealing" above, as a layout-scope-specific addendum — never as an edit to the shared "Deal and derive" heading itself. The identity scope's own render-set size (Deal and derive, "the assigned direction plus the one or two surviving fused challengers") and its own `--candidate-count` policy (left at the script's default) are unchanged and unaffected by this addendum.

Reroll and steer semantics are unchanged from the identity scope's Verdict step. The seed `key` is carried across rounds exactly as there.

### Lock-in

`DESIGN.md` stays untouched by this scope, which never invokes `/impeccable:impeccable document --seed`. Stop the server (`visual-decide.js stop --state <explore-dir>/.vd-state`), then seed the durable record (`seed-compare.mjs --manifest <manifest.json> --mode durable --out <explore-dir>/decision.html` — the same manifest Compare composed, now carrying `outcome: {winner: <id>, date}`). Keep the winning markup, delete every losing markup, and return the winner's path as `visual_reference` for the **caller** to persist as a `Visual-reference:` body-metadata line per `skills/specify/spec-template.md` — this mode only returns the path, it never writes the record.

**On exit-without-pick:** stop the server (`visual-decide.js stop --state <explore-dir>/.vd-state`) and delete the whole explore directory — identical to the identity scope's decline path.

### Functionality limit

This scope varies composition and interaction framing only, never backend behavior. Allowed: the same save action framed as a modal in one variant and an inline form in another — same behavior, different framing. Forbidden: one variant that autosaves while another requires an explicit save — different behavior. Behavior variation is spec territory, not scaffold territory.

## Output to caller

**ok (identity scope):**

```json
{
  "mode": "explore",
  "result": "ok",
  "scope": "identity",
  "chosen_world": "<display name>",
  "visual_reference": "<path>",
  "design_md": "seeded"
}
```

`visual_reference` may be `null` (pick succeeded, artifact write failed — see Lock-in). `design_md` is `"seeded"` or `"declined"`, per Lock-in.

**ok (layout scope):**

```json
{
  "mode": "explore",
  "result": "ok",
  "scope": "layout",
  "chosen_world": "<staging/challenger display name>",
  "visual_reference": "<path>"
}
```

`chosen_world` is deliberately scope-invariant naming — the same field name carries the identity scope's winning-world display name and the layout scope's winning-variant display name, so callers branch on `scope`, never on which fields are present.

A layout `ok` exists only on a pick, so `visual_reference` always carries the winning markup's path — declining is not an `ok` variant: exit-without-pick returns a **skip** (identical to the identity scope's decline path, per Lock-in above), never an `ok` with a sentinel value.

**skip shapes:**

- `{ "mode": "explore", "skipped": "design identity already locked — route identity replacement through upstream new-work explicitly" }`
- `{ "mode": "explore", "skipped": "native surface — explore is web-only", "surface_track": "<ios|android|adaptive>" }`
- `{ "mode": "explore", "skipped": "no PRODUCT.md — run /impeccable:impeccable init first" }`
- Plus the standard availability/kill-switch skips defined in `../SKILL.md` (`design integration disabled`, `Impeccable plugin not installed`, version-mismatch, etc.) — this mode does not redefine those, it dispatches into them exactly as every other mode does.

Both shapes carry the wrapper's standard top-level `platform` and `surface_track` fields — see `../SKILL.md`'s Output contract. This mode adds no field beyond what's shown above.
