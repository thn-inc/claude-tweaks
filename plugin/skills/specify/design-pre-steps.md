# Specify — Design Pre-Steps (Step 2.5)

Loaded by `/claude-tweaks:specify` Step 2.5 when the design doc (decomposition mode) or the record's own content (shaping mode) covers a frontend surface. Skip this file entirely when the input is backend / infra-only — the frontend-detection sniff below determines whether to load this file at all. Step 2.5a, Step 2.5c, and Step 2.5c2 run in both modes (Shaping mode calls them directly against the record's own body — see `shaping-mode-stamping.md` in this skill's directory, #1346's split of `shaping-mode.md`); Step 2.5b is decomposition-mode only, since there's no design doc to plan UX/UI for ahead of a shaping-mode record that already exists.

These pre-steps capture design context (`shape`), an optional accepted visual direction (`Visual-reference:`), creative direction (`Design-intent:`), and a UI-stack preference (`Ui-stack:`) so the resulting records carry all four forward to `/build` and `/flow`'s polish phase as body-metadata lines.

## Step 2.5a: Frontend detection

**`--surface` override.** When `--surface <value>` was passed on the command line (SKILL.md's Input section), skip the sniff below entirely — use the given value directly as `Surface:` for every record this run produces. Still continue to Step 2.5b/2.5c/2.5c2 when the given value is a frontend surface (`web`/`mobile`/`desktop`); skip them, as the no-signal case below does, when it's `backend`/`infra`/`terminal` (terminal still writes `Surface: terminal` — the skip is of the web-only pre-steps, not of the declaration).

Sniff the input for frontend signals using the same rules as `/claude-tweaks:design-wrapper`'s Layer 3 — the design doc's contents in decomposition mode, the record's own title/body in shaping mode:

- File-extension references (e.g., `.tsx`, `.jsx`, `.vue`, `.svelte`, `.html`, `.css`)
- Path references containing `/components/`, `/pages/`, `/app/`, `/routes/`, `/views/`, `/ui/`
- Explicit "UI", "frontend", "component", "page", "screen" terminology

For the canonical sniff rules, read `frontend-detection.md` in the `/claude-tweaks:design-wrapper` skill's directory.

If no frontend signals are detected, stop reading this file — return to SKILL.md and skip Steps 2.5b, 2.5c, and 2.5c2 entirely. Write `Surface: backend` (or `infra` when the input clearly targets infra) as a body-metadata line on the affected record(s); omit `Design-intent:` and `Ui-stack:` entirely for non-frontend records — there is no "none" sentinel for the non-frontend case, absence is the signal.

## Step 2.5b: Shape pre-step (frontend only)

**Auto mode:** auto-run the shape pre-step for a frontend design doc (detection is deterministic from Step 2.5a). Log entry:
```
AUTO {time} — Step 2.5b: auto-ran /claude-tweaks:design-wrapper shape for the frontend design doc. Output appended to design doc. Reversibility: high.
```
On `{skipped}` (Impeccable not installed, design integration disabled): note the skip in the log and proceed to Step 2.5c.

**Interactive mode:** offer the shape pre-step:

**Call `AskUserQuestion`:** this block must render verbatim — do not reorder, drop, or relabel the options, and keep `(Recommended)` on Option 1 exactly as written, the same verbatim requirement `red-team.md`'s Template A block states for Step 5's dispatch prompt.

- `question`: `"Frontend design detected. Run /impeccable:impeccable shape to plan UX/UI before decomposition?"`, `header`: `"Shape pre-step"`, `multiSelect`: `false`
- Option 1 — `label`: `"Yes — run shape (Recommended)"`, `description`: `"Run /impeccable:impeccable shape and append output to the design doc."`
- Option 2 — `label`: `"Skip"`, `description`: `"Proceed directly to decomposition."`

On option 1: invoke `/claude-tweaks:design-wrapper shape <topic>` via the Skill tool. The wrapper runs `/impeccable:impeccable shape <topic>` and returns `{result: "ok", output: "..."}`. Append the returned output verbatim to the design doc under a `## Shape (Impeccable)` section. This enriches the design doc with UX/UI planning that the decomposed sub-issue records and downstream `/build` can reference.

On `{skipped}` (Impeccable not installed, design integration disabled): note the skip and proceed to Step 2.5c.

## Step 2.5b-ii: Variant exploration (interactive only, shape confirmed)

Runs only when Step 2.5b's shape pre-step actually produced a confirmed brief (option 1 was taken and Impeccable's own brief-confirmation exchange completed) — skip entirely if Step 2.5b was skipped, auto-ran, or returned `{skipped}`. **No auto-mode branch** — this step requires a human in a browser by construction (same reason `/impeccable:impeccable live` itself has no non-interactive mode); auto-mode design docs proceed straight from the text brief.

**Policy gate.** Resolve `design-variant-exploration` before anything else in this step: `DESIGN_VARIANT_EXPLORATION=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values design-variant-exploration)`. At the default `off`, skip this step entirely — no tournament offer, no single-scaffold offer, proceed to Step 2.5c with no `Visual-reference:` line, exactly as if the user had answered "Skip" to every offer below. Only `offer` continues into the rest of this step. This does not reflect a project's fixed capability — it is a project-level default a human sets in `policy.yml`, independent of whether Impeccable happens to be at the pin this session; the availability pre-check below is the per-session capability question, orthogonal to this per-project preference one.

**Skip entirely for a native surface** — `Surface: mobile`, or any surface where the project's `PRODUCT.md` declares a `Platform` of `ios` / `android` / `adaptive`. Both halves of this step are web-only: the scaffold it writes is a static HTML file, and `live` refuses the native track outright (`design-wrapper/modes/live.md` Step 1.5). Proceed to Step 2.5c with no `Visual-reference:` line, exactly as option 2 does. This step is where the check belongs, because it is the only point in the chain that knows the surface before the scaffold gets written — `live` mode itself never receives a `Surface:` line to read.

**Scope-resolved pre-check.** Before offering anything below, resolve the tournament scope once, on this side: read Layer 0's `hasDesign` signal per `skills/design-wrapper/impeccable-plugin.md`; when Layer 0 is degraded, fall back to a direct existence check for `DESIGN.md` at the project root. Every `/claude-tweaks:design-wrapper explore` invocation below passes `--scope` explicitly, so the mode's own auto-resolution never runs on this path — the two sides read the same fact and cannot disagree.

**Exact-pin availability pre-check.** Also before offering anything below — and before either branch's own `AskUserQuestion` call — resolve whether `explore` can actually run this session, per `skills/design-wrapper/impeccable-plugin.md`'s Resolution procedure: glob `~/.claude/plugins/cache/*/impeccable/*/.claude-plugin/plugin.json`, read each candidate's own `version` field, and check whether any equals the pin recorded in that file's `<!-- upstream-pin: impeccable-plugin@X.Y.Z -->` comment. This is the same exact-pin check `explore` mode's own Preconditions section names (`design-wrapper/modes/explore.md`'s "Availability" paragraph) and `availability.md`'s per-mode verification table already requires for `explore` — run here, once, ahead of rendering any option, rather than discovered only after the user has already said yes and `explore` returns `{skipped}`. Record the result as `EXPLORE_AVAILABLE` (`true`/`false`) plus, when `false`, the found version list and the pinned version — both branches below read this same result, so neither the identity nor the layout branch re-globs the cache.

- `EXPLORE_AVAILABLE: true` → offer the tournament option normally, exactly as each branch's `AskUserQuestion` block below already states.
- `EXPLORE_AVAILABLE: false` (absent, or every candidate off-pin) → the tournament option is never presented as "Recommended." Replace Option 1's label/description in both branches' `AskUserQuestion` calls below with: `label`: `"Explore identities/layouts — unavailable"`, `description`: `"Impeccable plugin {found, or \"not installed\"} does not match the pinned {pinned} — explore cannot run this session."`, and drop the `(Recommended)` suffix. Option 2 ("Skip") becomes the de facto default; nothing here auto-selects it — the question still renders and waits for an answer, it simply never recommends an option that cannot run.

This closes the gap the record's Current State describes: naming the installed-vs-pinned mismatch *before* the offer, not after a "Recommended" pick silently returns `{skipped}` deep inside `explore` mode.

### No `DESIGN.md` — identity branch

Replaces the single-scaffold offer below entirely.

**Call `AskUserQuestion`** — Option 1 below renders per the Exact-pin availability pre-check above: shown as written when `EXPLORE_AVAILABLE: true`; substituted with the unavailable label/description (no `(Recommended)` suffix) when `EXPLORE_AVAILABLE: false`.

- `question`: `"No design identity is locked yet (no DESIGN.md). Want to explore competing visual identities for {primary surface} in the browser before decomposition?"`, `header`: `"Design identity"`, `multiSelect`: `false`
- Option 1 — `label`: `"Yes — run the worlds tournament (Recommended)"`, `description`: `"/claude-tweaks:design-wrapper explore --scope identity --source specify — compare rendered identities, lock the pick into DESIGN.md"`
- Option 2 — `label`: `"Skip"`, `description`: `"Proceed to decomposition; the current single-scaffold exploration is also skipped this run"`

On option 1: invoke `/claude-tweaks:design-wrapper explore --scope identity --source specify` via the Skill tool.

- On `{result: "ok", design_md: "seeded", visual_reference}`: note the returned `visual_reference` path for Step 3's `Visual-reference:` line via item 5's mechanism below, then proceed to Step 2.5c. `live` is intentionally **not** re-offered after the identity tournament: the pick seeds `DESIGN.md`, and element-level tuning of a specific surface belongs to a later run's layout branch (below), which offers `live` on its own tournament winner. A future editor must read this absence as a decision, not an omission.
- On `{skipped: ...}` (Impeccable absent, off-pin, kill-switch, native, no-PRODUCT): fall through to the single-scaffold offer below — today's behavior.

On option 2, or no affirmative response: proceed to Step 2.5c with no further action — the single-scaffold offer below is also skipped this run.

### `DESIGN.md` present — layout branch

Offers the layout tournament ahead of the single-scaffold offer below.

**Call `AskUserQuestion`** — Option 1 below renders per the Exact-pin availability pre-check above: shown as written when `EXPLORE_AVAILABLE: true`; substituted with the unavailable label/description (no `(Recommended)` suffix) when `EXPLORE_AVAILABLE: false`.

- `question`: `"Want to compare rendered layout variants of {primary surface} (identity held fixed) before I build it for real?"`, `header`: `"Layout variants"`, `multiSelect`: `false`
- Option 1 — `label`: `"Yes — run the layout tournament (Recommended)"`, `description`: `"/claude-tweaks:design-wrapper explore {surface-topic} --scope layout --source specify — pick a composition, then optionally tune it with live"`
- Option 2 — `label`: `"Skip to single-scaffold live"`, `description`: `"Today's behavior: one scaffold + /claude-tweaks:design-wrapper live"`

On option 1: invoke `/claude-tweaks:design-wrapper explore {surface-topic} --scope layout --source specify` via the Skill tool, with `{surface-topic}` composed from the brief (surface name + content requirements).

- On `{result: "ok", visual_reference}`: offer `live` on the winner by reusing the single-scaffold offer's steps 2-4 below, with `SCAFFOLD_URL` pointed at the returned `visual_reference` path — step 1's scaffold generation is skipped, since the winning markup already exists. Then step 5 records that same path for Step 3.
- On `{skipped: ...}` (Impeccable absent, off-pin, kill-switch, native, no-PRODUCT): fall through to the single-scaffold offer below — today's behavior.

On option 2: proceed directly to the single-scaffold offer below — today's behavior.

### Single-scaffold offer (fallback)

Reached when either branch above returns `{skipped}`, or when the layout branch's option 2 routes here directly. Offer once, as its own message:

**Call `AskUserQuestion`:**

- `question`: `"Want to compare a few real variants of {primary surface, from the brief's \"Primary User Action\"} before I build it for real? I'll put together a quick throwaway version and let you pick a direction in the browser."`, `header`: `"Variant exploration"`, `multiSelect`: `false`
- Option 1 — `label`: `"Yes — build a scaffold (Recommended)"`, `description`: `"Build a disposable scaffold and open live mode to pick a direction."`
- Option 2 — `label`: `"Skip"`, `description`: `"Proceed to decomposition from the text brief only."`

On option 2, or if the user doesn't respond affirmatively: proceed to Step 2.5c with no further action.

On option 1:

1. **Generate the scaffold.** Write a minimal, disposable static HTML file implementing the brief's primary surface — realistic placeholder content per the brief's "Key States" and "Content Requirements" sections, no real data wiring, no routing, no framework integration, no test coverage. Save it to `docs/plans/YYYY-MM-DD-{feature}-shape-scaffold.html` (same co-location convention as the audit/recommendations/declined caches).
2. **Serve it.** Follow `_shared/dev-url-detection.md`'s "Ephemeral server start" procedure to serve the scaffold's containing directory on a free port. Set `SCAFFOLD_URL = http://localhost:{free-port}/{scaffold-filename}`.
3. **Hand off to live mode.** Invoke `/claude-tweaks:design-wrapper live <SCAFFOLD_URL>` via the Skill tool. The human explores variants, tunes parameters, and accepts a direction — or exits without accepting, which is treated as a skip: proceed to Step 2.5c with no `Visual-reference:` line.
4. **Stop the ephemeral server** per `_shared/dev-url-detection.md`'s "Cleanup" — Standalone rule (no pipeline run dir exists yet at this point in `/specify`'s flow).
5. **Record the reference.** If a variant was accepted, note the scaffold's path for Step 3 (decomposition mode's own compose-then-write-once step) to write as a new `Visual-reference: docs/plans/YYYY-MM-DD-{feature}-shape-scaffold.html` body-metadata line, alongside `Surface:` and `Design-intent:`, on every generated sub-issue record covering this surface. Step 2.5b-ii never runs in Shaping mode — Step 2.5b itself is decomposition-mode only, per this file's opening note — so there is no Shaping-mode counterpart to wire up here.

## Step 2.5c: Design-intent question (frontend only)

Sets the `Design-intent:` body-metadata line that Phase 3's `polish` mode will read for intent-driven dispatch.

**`--chained` (shaping mode's headless component invocation — see `SKILL.md`'s Input bullet and Component-Skill Contract):** never ask. Write `Design-intent: none` and skip both branches below entirely — the auto-mode policy resolve and the interactive fallback alike; the flag outranks both, run dir or no run dir. Log per `_shared/auto-decision-log.md` when a run directory resolves (`AUTO {time} — Step 2.5c: design-intent=none (--chained headless default). Reversibility: high.`), otherwise note it in the returned output only.

**The `next` form (`specify/next-mode.md`) never reaches this step at all.** `next-mode.md`'s own Flag rejection step pre-resolves `Design-intent: none` before `shaping-mode.md` is ever entered — the same value this `--chained` branch produces, just resolved one file earlier. This step's branches never execute for a `next`-mode record; nothing here needs to special-case `next` beyond this note.

**Auto mode:** resolve `design-intent` — `DESIGN_INTENT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values --run "$PIPELINE_RUN_DIR" design-intent)`. Apply per the resolved value:

- Value is one of `bold` / `quiet` / `minimal` / `delightful` / `onboarding` → write the `Design-intent:` body-metadata line directly. Log:
  ```
  AUTO {time} — Step 2.5c: applied design-intent={value} from pipeline config. Reversibility: high.
  ```
- Value is `none` → write `Design-intent: none` and skip the question. Log:
  ```
  AUTO {time} — Step 2.5c: design-intent=none per pipeline config (no creative direction). Reversibility: high.
  ```
- Value is unset (no pipeline run dir or no `design-intent` key) → fall back to KEPT-PROMPT (ask the user inline). This is in the "not silenced" list when explicitly left open. Log:
  ```
  KEPT-PROMPT {time} — Step 2.5c: design-intent not set in policy; surfaced inline.
  ```

**Interactive mode (or KEPT-PROMPT fallback):** ask the user:

**Call `AskUserQuestion`:** this block must render verbatim — all six options, in this order, exactly as labeled below; do not drop, reorder, or relabel any of them, the same verbatim requirement `red-team.md`'s Template A block states for Step 5's dispatch prompt.

- `question`: `"Design vibe for this record? (sets the Design-intent body-metadata line — select one or more)"`, `header`: `"Design intent"`, `multiSelect`: `true`
- Option 1 — `label`: `"Bold"`, `description`: `"Eye-catching, confident."`
- Option 2 — `label`: `"Quiet"`, `description`: `"Restrained, refined."`
- Option 3 — `label`: `"Minimal"`, `description`: `"Strip to essence."`
- Option 4 — `label`: `"Delightful"`, `description`: `"Personality, micro-interactions."`
- Option 5 — `label`: `"Onboarding"`, `description`: `"First-run flows, empty states."`
- Option 6 — `label`: `"None"`, `description`: `"No specific creative direction."`

The user can select multiple options (e.g., Bold + Delightful). Map the answers:

| User answer | `Design-intent:` value |
|-------------|------------------------|
| `1` | `bold` |
| `2` | `quiet` |
| `3` | `minimal` |
| `4` | `delightful` |
| `5` | `onboarding` |
| `6` (or no answer) | `none` |
| `1,4` (multiple) | `bold, delightful` (comma-separated) |

Record the chosen value(s) — the calling mode's compose-then-write-once step (decomposition mode's Step 3 in `decomposition-mode.md`; Shaping mode's own Metadata block / Compose-then-write-once subsections in `shaping-mode-stamping.md`, #1346's split of `shaping-mode.md`) writes them into the record's body-metadata block.

**For multi-record decompositions:** ask the question once per design doc and apply the same intent across all generated sub-issue records. If the user wants different intents per sub-issue, they can edit individual records after Step 3 (`gh issue edit` / `writeRecord`).

For the canonical enumeration of `Design-intent:` values, read the body-metadata block description near the top of `spec-template.md` in this skill's directory.

## Step 2.5c2: UI-stack question (frontend only)

Sets the `Ui-stack:` body-metadata line that `/claude-tweaks:build`'s Design Pre-Build step (Common Step 1.7) forwards into the implementer subagent's prompt as an explicit component-library/styling-approach mandate — see `design-prebuild.md` in the `/claude-tweaks:build` skill's directory.

**`--chained` (shaping mode's headless component invocation):** never ask — but still resolve the policy value first. This deliberately does **not** mirror Step 2.5c's own `--chained` branch, which writes `Design-intent: none` unconditionally: `none` *is* the `design-intent` schema default, so that unconditional write already matches policy in the common case. `ui-stack` carries no schema default, so an unconditional sentinel would silently discard a real, explicitly-set project policy value with no equivalent fallback. Resolve it with the same invocation the Auto mode branch below uses — `UI_STACK=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values --run "$PIPELINE_RUN_DIR" ui-stack)` — then apply per the resolved value:

- Value is non-empty → write the `Ui-stack:` body-metadata line using the policy value verbatim. Log per `_shared/auto-decision-log.md` when a run directory resolves:
  ```
  AUTO {time} — Step 2.5c2: applied ui-stack="{value}" from project policy (--chained headless). Reversibility: high.
  ```
- Value is empty (no pipeline run dir, or `ui-stack` unset in `policy.yml`) → write `Ui-stack: none — no preference, defer to reference codebase`. Log:
  ```
  AUTO {time} — Step 2.5c2: ui-stack=none (--chained headless default, no policy value). Reversibility: high.
  ```

When no run directory resolves, note the outcome in the returned output only, as Step 2.5c's `--chained` branch does. Either way, **never** call `AskUserQuestion` on this path: the Auto mode branch's KEPT-PROMPT fallback for an empty value does not apply under `--chained` — the flag outranks it, and the sentinel is the headless answer. Only the *value* resolution differs from Step 2.5c's branch; the never-ask invariant is identical.

**The `next` form never reaches this step**, for the same reason Step 2.5c's own note states: `next-mode.md`'s Flag rejection step pre-resolves both lines before `shaping-mode.md` is ever entered, and this step never runs on that path either. It pre-resolves `Ui-stack:` on the same policy-first, sentinel-fallback rule this `--chained` branch applies — not an unconditional sentinel — for the same no-schema-default reason.

**Auto mode:** resolve `ui-stack` — `UI_STACK=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values --run "$PIPELINE_RUN_DIR" ui-stack)`. Apply per the resolved value:

- Value is non-empty → write the `Ui-stack:` body-metadata line directly, using the policy value verbatim. Log:
  ```
  AUTO {time} — Step 2.5c2: applied ui-stack="{value}" from pipeline config. Reversibility: high.
  ```
- Value is empty (no pipeline run dir, or `ui-stack` unset in `policy.yml` — the key carries no schema default) → fall back to KEPT-PROMPT (ask the user inline). This is in `_shared/auto-mode-contract.md`'s "not silenced" list: unset is the only open state for `ui-stack`, since the key has no schema default to distinguish "explicitly left open" from "never set" the way `design-intent`'s `none` does. Log:
  ```
  KEPT-PROMPT {time} — Step 2.5c2: ui-stack not set in policy; surfaced inline.
  ```

**Interactive mode (or KEPT-PROMPT fallback):** ask the user:

**Call `AskUserQuestion`:**

- `question`: `"UI stack for this build? (sets the Ui-stack body-metadata line — pick a preset, or use Other to name something specific)"`, `header`: `"UI stack"`, `multiSelect`: `false`
- Option 1 — `label`: `"shadcn/ui + Tailwind (Recommended)"`, `description`: `"Composable primitives, Tailwind utility classes."`
- Option 2 — `label`: `"Plain CSS / no library"`, `description`: `"Hand-written styles, no component library."`
- Option 3 — `label`: `"No preference — defer to reference codebase"`, `description`: `"Let the build match whatever the reference codebase already uses."`

The tool's built-in `Other` field covers any UI stack not listed above (e.g. `Material UI`, `Chakra UI`, a project-specific design system) — the same escape hatch `step-09-establish-github-remote.md` documents for its own org-selection question. Map the answer to the `Ui-stack:` value verbatim: a preset option writes that option's label text (`shadcn/ui + Tailwind`, `Plain CSS / no library`); Option 3 writes `none — no preference, defer to reference codebase`; an `Other` answer writes the user's typed text verbatim.

Record the chosen value — the calling mode's compose-then-write-once step (decomposition mode's Step 3 in `decomposition-mode.md`; Shaping mode's own Metadata block / Compose-then-write-once subsections in `shaping-mode-stamping.md`, #1346's split of `shaping-mode.md`) writes it into the record's body-metadata block, immediately after `Design-intent:`.

**For multi-record decompositions:** ask the question once per design doc and apply the same UI stack across all generated sub-issue records covering a frontend surface — the same batching rule Step 2.5c already applies to `Design-intent:`.
