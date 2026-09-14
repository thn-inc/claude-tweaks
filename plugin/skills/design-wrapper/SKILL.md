---
name: design-wrapper
description: Use when a lifecycle skill (/test, /review, /build, /flow, /visual-review, /specify, /tidy) needs to invoke Impeccable design-quality commands. Wrapper that encapsulates "when, how, and whether to invoke Impeccable" so caller skills don't have to know.
argument-hint: "<shape|pre-build|test|review|polish|survey|doctor|reset-recommendations|live|explore> [target] [<surface-topic>] [--screenshots <paths>] [--source <parent-skill>] [--description <text>] [--dry-run] [--limit <n>] [--scope <identity|layout>]"
---

# Design — Impeccable Integration Wrapper

Wrapper skill that encapsulates the Impeccable design-quality plugin behind a stable interface. Caller skills (`/test`, `/review`, `/build`, `/flow`, `/visual-review`, `/specify`, `/tidy`) invoke a mode here; this wrapper handles detection, availability checks, dispatch, and graceful skips.

Lifecycle: utility — called by lifecycle skills anywhere between `/claude-tweaks:capture` and `/claude-tweaks:wrap-up`, plus the `/claude-tweaks:tidy` maintenance loop.

Every mode in the Input table below is active, plus the `reset-recommendations` cache utility — that table is the roster; do not restate its size here. The wrapper skips cleanly on non-frontend specs and missing dependencies. `polish` dispatches three categories — the refinement set, suggestion-driven, and intent-driven (the latter reads the record's `Design-intent:` body-metadata line — lifted into the materialized header per spec 20 — and dispatches creative commands per `command-map.md`). `survey` analyzes rendered UI or the full diff and produces ranked Creative Opportunities recommendations consumed by `/visual-review` and `/flow`'s pipeline summary.

**Three independent surfacing anchors** ensure creative commands cannot get buried:

1. **Polish-mode intent dispatch** — explicit `design-intent:` declarations auto-run the matching creative commands.
2. **`/visual-review` Creative Opportunities block** — `survey` recommendations rendered after the findings table from analyzed screenshots. Read-only.
3. **`/flow` pipeline summary Creative Opportunities block** — `survey` recommendations rendered before Next Actions from the full diff. Read-only. Decline tracking suppresses recommendations the user repeatedly ignored (2-decline threshold; reset via `/claude-tweaks:design-wrapper reset-recommendations <spec>`).

## When to Use

- `/claude-tweaks:test` invokes `test` mode after the standard verification suite
- `/claude-tweaks:review` invokes `review` mode during code review
- `/claude-tweaks:build` invokes `pre-build` mode before implementation
- `/claude-tweaks:specify` invokes `shape` mode before decomposition
- `/claude-tweaks:flow` invokes `polish` mode after review passes
- `/claude-tweaks:visual-review` invokes `survey` mode after browser review
- `/claude-tweaks:flow` invokes `survey` mode in the pipeline summary
- `/claude-tweaks:specify` invokes `live` mode against a throwaway shape-time scaffold before decomposition
- `/claude-tweaks:specify` invokes `explore` from Step 2.5b-ii's scope-resolved pre-check — identity tournament at genesis (no `DESIGN.md` yet), layout tournament once one is locked
- `/claude-tweaks:init` recommends `explore` at its design-integration step (Step 11) — text only, never an invocation
- `/claude-tweaks:visual-review` invokes `live` mode (standalone Boost gate only) against the already-running app
- `/claude-tweaks:tidy` invokes `doctor` mode as one scan step, to surface drift in the project's own Impeccable artifacts
- A user runs `/claude-tweaks:design-wrapper <mode> <target>` directly to invoke a single mode without going through the lifecycle skill
- A user runs `/claude-tweaks:design-wrapper reset-recommendations <spec>` to clear declined-recommendation tracking for a spec
- A user runs `/claude-tweaks:design-wrapper explore` directly at a project's genesis moment (`PRODUCT.md` exists, no `DESIGN.md` locked) to compare competing visual identities in the browser before locking one, or later for layout-variant comparison

Full per-mode behavior and argument shape: see the Input table below.

## Input

`$ARGUMENTS` is parsed as `<mode> <target> [flags]`:

| Mode | Target | Behavior |
|------|--------|----------|
| `shape <topic>` | Topic name | Invokes `/impeccable:impeccable shape <topic>`, forwarding `--description` verbatim when the caller supplied it so upstream's `new-work.md` classifies the work rather than the wrapper pre-classifying it; returns the output for the caller to append to the design doc |
| `pre-build <spec>` | Spec number or path | Lazy-loads relevant Impeccable reference files (including `new-work.md`, which owns job classification) plus project's root `PRODUCT.md` + `DESIGN.md` (when present); returns the loaded file paths, an approximate context size, and the record's description verbatim |
| `test <files>` | Space-separated file list | Runs the deterministic CLI per `impeccable-cli.md`; returns pass/fail |
| `review <spec>` | Spec number or path | Invokes `/impeccable:impeccable critique` + `/impeccable:impeccable audit` on changed UI files, plus upstream's `impeccable-finish-reviewer` agent when the artifact carries a direction contract, plus project-local craft critics per `critics.md`, governed by `design-critique`; returns advisory findings; writes findings cache for `polish` mode to read |
| `polish <spec>` | Spec number or path | Dispatches the refinement set (`polish`/`clarify`/`harden`, each carrying the job-statement suffix) + suggestion-driven (whatever command each audit finding's own `suggestion` field names) + intent-driven (per the record's `Design-intent:` body-metadata line, lifted into the materialized header — spec 20) commands per `command-map.md`; modifies code. With `--dry-run`, computes the same category/trigger dispatch list but issues no Impeccable commands and modifies nothing — see `modes/polish.md` Step 8. |
| `survey <files>` | Space-separated file list, or `--screenshots <paths>` when invoked from `/visual-review` | Analyzes the diff (and screenshots when provided) and returns ranked Creative Opportunities recommendations; suppresses recommendations the user previously declined for the same spec; read-only. `--limit <n>` overrides the default cap of 5 recommendations. |
| `doctor` | **None** — takes no target | Runs the pinned plugin's `doctor.mjs --json` (never `--fix`) and returns its findings about the project's own Impeccable artifacts (`PRODUCT.md`, `DESIGN.md` + sidecar, `.impeccable/config.json`, surface briefs, the design hook), normalized once and read-only. Audits project artifacts, not a diff, so there is nothing to scope it to. |
| `reset-recommendations <spec>` | Spec number or path | Deletes the declined-recommendations cache for the spec; the next `survey` call surfaces all matching recommendations again |
| `live <target>` | URL — an ephemeral scaffold server or an already-running app | Invokes `/impeccable:impeccable live` against the target. Interactive-only, no auto-mode branch — a human must be present in a browser |
| `explore [<surface-topic>]` | Optional free text naming a new surface — consumed only by the layout scope; the identity scope ignores it | Genesis worlds tournament / established-world composition tournament — deals competing directions via upstream's `concept-seed.mjs`, renders them for browser comparison, locks the pick through upstream `document --seed` (identity scope; upstream writes DESIGN.md, never this wrapper); `--scope identity|layout` selects the scope explicitly, otherwise auto-resolved from Layer 0's `hasDesign`; interactive-only |

**Flags** (apply across modes where noted; unrecognized flags for a given mode are ignored):

| Flag | Modes | Meaning |
|------|-------|---------|
| `--screenshots <paths>` | `survey` | Passed by `/visual-review` — screenshot paths for per-screenshot LLM-graded observations instead of heuristic diff analysis |
| `--source <parent-skill>` | any | Explicit caller-invoked signal when the caller has no `$PIPELINE_RUN_DIR` of its own to forward (e.g. standalone `/visual-review`) — see Component-Skill Contract below |
| `--description <text>` | `shape` | The design doc's own overview or problem statement, forwarded verbatim to upstream so `new-work.md` can classify the work. Optional — omitting it degrades the call, never fails it. |
| `--dry-run` | `polish` | Compute the dispatch list without invoking any Impeccable command or modifying files |
| `--limit <n>` | `survey` | Override the default 5-recommendation cap (see `modes/survey.md` Step 5) |

When `<target>` is omitted for `test` mode, the wrapper resolves changed files via `git diff --name-only`. When omitted for `review` mode or `polish` mode, the wrapper falls back to the same git-diff resolution. `survey` defaults to the same git-diff resolution when called without files. If that `git diff --name-only` resolution itself fails (non-git directory, git error, corrupted index, mid-rebase state), the wrapper treats it the same as any other unresolvable-target case: return `{skipped: "unable to resolve target files (git diff failed)"}` immediately, without attempting detection or dispatch. `<spec>` is required (not resolvable via git diff) for `reset-recommendations` — when omitted, return `{skipped: "reset-recommendations requires <spec> — no default target resolution"}` rather than guessing a most-recently-modified cache across all specs.

**Layer 0 substitution in the fallback path.** When Layer 0 resolved and Layer 3 has ruled the change frontend, use its `scan.targets` in place of the raw `git diff --name-only` output as the source of candidate paths. One rule for every mode with a fallback path (`test`, `review`, `polish`, `survey`) — no per-mode variant. Its three load-bearing constraints — fallback only (never overriding an explicit caller-supplied `<target>` list), after Layer 3 and with the per-file trigger-extension/path filter still applied to the substituted list, and empty-`scan.targets`-takes-the-git-diff-fallback — are stated canonically in `impeccable-plugin.md`'s per-signal trust rules (`scan.targets` row); read that row before implementing this substitution.

## Universal preconditions

Run these before dispatching to any active mode. Which layers each mode actually runs varies — see the mode-specific notes immediately below, which are the authority when they differ from the general chain.

**Mode-specific notes:**

- `shape` runs preconditions but skips Layer 2 — there is no spec yet (the caller is `/specify` working on a design doc, not a numbered spec). Layer 1 + availability still apply.
- `live` runs preconditions but skips Layer 2, same as `shape` — a live session isn't necessarily tied to one spec. Layer 1 + Layer 3 (file-extension sniff against `<target>`, when resolvable — a bare URL with no visible extension is treated as frontend by default, since `live` is never invoked on a non-frontend target by either of its two callers) + availability still apply.
- `pre-build` runs all three detection layers and the LLM availability check — it touches Impeccable references but does not modify code.
- `polish` runs all three detection layers and the LLM availability check; on a successful precondition pass, it consumes audit findings written by `review` mode (see `modes/polish.md`).
- `survey` runs Layer 1 (kill-switch) and Layer 3 (file-extension sniff). Layer 2 applies only when a `<spec>` is resolvable from the file list (caller may pass it explicitly). Survey does not require Impeccable's LLM commands or CLI — it is a heuristic analysis local to the wrapper that *recommends* Impeccable commands. The availability check is informational only (an unavailable Impeccable surfaces in the recommendations as "install Impeccable to apply").
- `doctor` runs **Layer 1 only**, plus its own availability and project-context checks. Layers 2 and 3 are structurally inapplicable, not merely skipped: `doctor` receives no spec (so there is no `Surface:` line to read) and no file list (so there is nothing to sniff). Layer 3 in particular would be actively wrong here — `/tidy` typically runs on a clean tree, so a diff-based frontend sniff would skip `doctor` on exactly the runs it exists to serve. Its four own skip conditions are in `modes/doctor.md`. Track resolution still resolves a track for it, but **no `doctor` outcome depends on which one** — `doctor.mjs` audits `PRODUCT.md`, `DESIGN.md`, and the project's other Impeccable artifacts, none of which are web-only. Do not add a native skip here.
- `explore` runs Layer 1 only, plus track resolution and exact-pin availability. Layers 2 and 3 are structurally inapplicable, `doctor`-style: no spec input means no `Surface:` line to read, and no file list means nothing to sniff — genesis runs on a clean tree. Scope auto-resolution reads Layer 0's `hasDesign` signal (fallback: a direct `DESIGN.md` existence check when Layer 0 degraded). The native track skips (web-only). See `modes/explore.md` for the full scope-resolution table.
- `reset-recommendations` runs no preconditions — it is a cache-management utility, not a mode that invokes Impeccable.

Track resolution (below) runs for **every** mode, whichever of Layers 1-3 that mode runs — it is not a layer and gates nothing. A mode that skips Layer 2 resolves its track with no `Surface:` value.

### Step 1: Detection (Layer 0 enrichment, then 3 decision layers in order)

**Layer 0 — Context signals (enrichment, never a gate):**

Resolve the pinned Impeccable **plugin** and execute its `gatherSignals()`, per `impeccable-plugin.md` in this skill's directory. Fold the result into the decisions named in that file's per-signal trust rules table.

Layer 0 **gates nothing** — it has no veto and no skip power of its own, and adds no branch to the detection chain below. Layers 1-3 remain the only things that can stop a dispatch. All three of its failure conditions (absent, version mismatch, execution failure) degrade to "no signals," and every mode then runs with Layers 1-3 exactly as it does today. Degradation is never a failure, so Layer 0 never returns a skip object of its own.

Read `impeccable-plugin.md` for the resolution procedure, the output shape, and the trust rules. Do not restate any of them here.

**Layers 1-3 + track resolution — computed by `plugin/bin/design-detect.js` (deterministic, #885):**

What used to be three model-executed decision tables (the CLAUDE.md kill-switch, the `Surface:` body-metadata check, and the web/native/terminal track table) plus the file-extension sniff fallback is now one deterministic CLI call. Invoke it and trust its output — do not re-derive any of these tables by reading CLAUDE.md or the record body yourself:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/design-detect.js" --mode <mode> \
  [--surface <value>] [--files <f1,f2,...>] [--signals <path-to-gatherSignals()-json|->]
```

- `--mode` — the wrapper mode dispatching (`test`, `review`, `shape`, `pre-build`, `polish`, `survey`, `live`, `doctor`, `explore`, `reset-recommendations`). Each mode's Layer 2/Layer 3 applicability (incl. `doctor`/`explore`'s structural inapplicability) is baked into the CLI — see the mode-specific notes above for *why*, not *how to recompute it*.
- `--surface` — the record's `Surface:` body-metadata value (already lifted into the materialized header — spec 20), when the mode received a spec. Omit when no spec input exists.
- `--files` — the mode's target list, or the resolved `git diff` set, comma-joined.
- `--signals` — path to Layer 0's `gatherSignals()` JSON (or `-` for stdin); omit when Layer 0 degraded (absent, off-pin, execution failure) — the CLI treats a missing/malformed `setup.platform` as `null`, same as today's fall-through.

Output is one JSON object: `{decision: "proceed" | "skip", track?, reason?, platform?, inferred?, surface_track_override?}`. `reason` strings are the exact wire vocabulary every caller already matches on (`"design integration disabled"`, `"design integration not configured (run /claude-tweaks:init to enable)"`, `"non-frontend spec (surface declared)"`, `"non-frontend (sniff)"`, `"native surface — CLI detector is web-only"`, `"native surface — live mode is web-only"`) — unchanged from before this extraction, byte-for-byte.

**`surface_track_override` is emitted by the CLI, never judged in prose.** When present, it names both `platform` and `surface` and which won (`setup.platform` wins except on the `terminal` row, where `Surface:` wins). Logging the disagreement to the run's `decisions.md` (`_shared/auto-decision-log.md`) stays the caller's job — the CLI has no run-dir concept and never writes to one.

When the track resolves `terminal`, read `terminal-routing.md` — every terminal-track outcome (honest Impeccable skips, `pre-build`'s principles-only load) lives there. When the track resolves `native`, read `native-routing.md` in this skill's directory for the reference mapping and dispatch rule — a web-track run never needs either file. `test` and `live` never dispatch on the native track (upstream's own constraint — `reference/routing.md`: *"`live` and the bundled `detect.mjs` are web-only"*); every other mode dispatches on the native track with `platform` named.

The trigger extensions and path patterns Layer 3 sniffs against, and the full decision-table reference (every row, worked examples, edge cases) for anyone auditing the CLI's behavior rather than just calling it, live in `frontend-detection.md` in this skill's directory — the CLI's `plugin/bin/lib/design-detect/index.js` is the executable twin of that file, the same pairing `bin/lib/merge-verification.js` has with `_shared/policy-schema-coverage.md`'s coverage block.

### Step 2: Availability check

For the dispatched mode, verify its dependency is available before dispatch. Impeccable's artifacts are checked independently and must not be conflated — three kinds: **LLM commands**, by skill resolution, unpinned (`review`, `shape`, `pre-build`, `polish`, `live` — an off-pin plugin still answers `/impeccable:impeccable critique`); **bundled scripts at an exact pin** via `resolveImpeccablePlugin` per `impeccable-plugin.md` (`doctor`, `explore`, and Layer 0 — Layer 0 degrades to no-signals, the modes skip); and **the CLI** (`test`), a third artifact on its own version line.

Unavailable → a `{skipped, install_hint}` object, never a failure. A version mismatch is a **distinct condition** from "not installed" and its skip reason names both versions. Layer 0 never produces an availability skip of its own — its failures are enrichment outcomes (see `impeccable-plugin.md`'s degradation table).

Read `availability.md` in this skill's directory for the per-mode verification table, the exact skip shapes, install hints, and the session de-dupe rule — load it whenever an availability check actually needs running.

## Mode behaviors

Each mode's full procedure (steps, decision tables, output format) lives in its own sub-file — see the Input table above for behavior and argument shape. Read only the sub-file you need.

### Mode: `test <files>` — Active

Read `modes/test.md` in this skill's directory for the full procedure.

### Mode: `review <spec>` — Active

Read `modes/review.md` in this skill's directory for the full procedure.

### Mode: `shape <topic>` — Active

Read-only with respect to source code. Read `modes/shape.md` in this skill's directory for the full procedure.

### Mode: `pre-build <spec>` — Active

Does not modify code — read-only enrichment. Read `modes/pre-build.md` in this skill's directory for the full procedure.

### Mode: `polish <spec>` — Active

**The only wrapper mode that modifies code** — callers must follow up with re-verification. See `command-map.md` in this skill's directory for the dispatch rules (refinement set + job-statement suffix, suggestion-driven resolution, intent-driven mapping). Read `modes/polish.md` in this skill's directory for the full procedure.

### Mode: `survey <files>` — Active

Read-only — never invokes Impeccable commands, only suggests them. See `command-map.md` in this skill's directory for the "would help" criteria → command mapping. Read `modes/survey.md` in this skill's directory for the full procedure.

### Mode: `live <target>` — Active

Interactive-only, no auto-mode branch — callers must only reach this mode when a human is present. Read `modes/live.md` in this skill's directory for the full procedure.

### Mode: `doctor` — Active

Read-only in every sense — it modifies no source file and no Impeccable artifact, in any project, under any condition. It invokes `doctor.mjs --json` and **never** `--fix`, because `--fix` writes to `PRODUCT.md` and that is the user's call, not this wrapper's. Read `modes/doctor.md` in this skill's directory for the full procedure and the finding schema it owns.

### Mode: `reset-recommendations <spec>` — Active utility

Cache-management utility, not a mode that invokes Impeccable. Read `modes/reset-recommendations.md` in this skill's directory for the full procedure.

## Output contract

Every wrapper invocation returns one of two shapes:

| Shape | Trigger |
|-------|---------|
| `{mode, result, ...}` | Active mode dispatched and completed |
| `{mode, skipped, ...}` | Detection or availability check returned skip |

Callers must handle both — see the canonical caller-side contract below for what each shape means.

**Both shapes additionally carry a top-level `platform` field**, surfaced from Layer 0's `setup.platform`:

| `platform` | Meaning |
|-----------|---------|
| `web` \| `ios` \| `android` \| `adaptive` | Impeccable resolved a `Platform` section in the project's `PRODUCT.md`. Authoritative. |
| `null` | Unknown — fall back to the record's `Surface:` body-metadata line. |

`null` is the **expected common case, not an error**: the value requires a literal `Platform` section in `PRODUCT.md` naming exactly one of those four words, which most projects do not have — this repository included. It is also what a caller sees whenever Layer 0 degraded at all (absent plugin, version mismatch, execution failure), since those produce no signals to surface. Callers must not distinguish "Impeccable said unknown" from "Impeccable wasn't asked"; both mean *fall back to `Surface:`*.

`platform` is the only Layer 0 signal in the return today. The rest stay contract-only in `impeccable-plugin.md` until the record that consumes each one adds its field — surfacing a signal no caller reads is how a field's shape drifts before it has a single user to keep it honest.

**Both shapes also carry `surface_track`** — the *resolved* track from the track-resolution table above, which is a different value from `platform` rather than a restatement of it:

| Field | Values | Read by |
|---|---|---|
| `surface_track` | `web` \| `ios` \| `android` \| `adaptive` \| `terminal` | This skill — it derives `test`'s and `live`'s native skip reasons and names the platform on native dispatch. `platform: null` + `Surface: mobile` resolves to `adaptive` here while `platform` stays `null`; the two never collapse into one field. |
| `surface_track_override` | string, **only when `setup.platform` and `Surface:` implied different tracks** | The human, via whatever report the caller renders. Names both values and which won. Absent means they agreed or only one was present — never "the check didn't run." |

See `_shared/design-wrapper-handling.md` for the canonical caller-side contract — the full return-shape categories (`ok` / `pass` / `advisory` / `fail` / `skipped` / `deferred`) and the "why skips don't fail" rationale shared by every caller of this wrapper.

## Reference sub-files

Lazy-load these only when needed for the active mode:

- `modes/{name}.md` — One file per mode named in the Input table (`test`, `review`, `shape`, `pre-build`, `polish`, `survey`, `live`, `doctor`, `explore`), plus a procedure file for the `reset-recommendations` cache utility. Per-mode full procedure (steps, decision rules, output format). `modes/doctor.md` additionally owns `doctor`'s finding schema — `skills/tidy/scan-procedures.md` references it rather than restating it.
- `availability.md` — The Step 2 availability check in full: per-mode verification table, the three artifact kinds, skip shapes, install hints, session de-dupe. Loaded whenever an availability check actually needs running.
- `command-map.md` — Single source of truth for dispatch: the per-command categorization (phase-fixed / refinement set / suggestion-driven / intent-driven / manual-only / never) covering every Impeccable command the wrapper knows about, plus the survey "would help" criteria → command mapping. Its Full command map table is the count — do not restate one here.
- `frontend-detection.md` — Trigger extensions and path patterns for Layer 3 sniff; pointer to the canonical `Surface:`/`Design-intent:` body-metadata line values (which live in `skills/specify/spec-template.md`'s metadata-block description).
- `native-routing.md` — Everything downstream of a **native** track result: the platform → upstream-reference mapping, the dispatch rule, the reasoning behind the track table's two inferred rows (`null` + `mobile` → `adaptive`; `desktop` → web), and the four-row routing walkthrough. Loaded only when track resolution returns `ios` / `android` / `adaptive` — a web-track run never needs it.
- `terminal-routing.md` — Everything downstream of a **terminal** track result: the outcomes table (Impeccable skips with reasons, `pre-build`'s principles-only load), the `Surface:`-wins reasoning, the revisit condition. Loaded only when track resolution returns `terminal`.
- `critics.md` — track-keyed roster of project-local craft critics; read only by `review` mode Step 3.8.
- `impeccable-cli.md` — Exact CLI invocation, JSON output schema, parsing rules. Pins the **CLI**.
- `impeccable-plugin.md` — the shared `resolveImpeccablePlugin` plugin-cache resolver (one resolver for every consumer in its script-path table), plus Layer 0 itself: the flagless `context-signals.mjs` invocation contract, `gatherSignals()`'s output shape, degradation conditions, and the per-signal trust rules. Pins the **plugin** — a separate artifact on a separate version line from the CLI.

## Next Actions

When invoked directly by a user (not from a lifecycle skill), look up the return shape in the table below, then render the matching line as plain markdown (docs/skill-authoring.md's Skill handoffs convention). When invoked from a caller skill, omit this block — callers consume the return value themselves.

| Return | Recommended follow-up |
|--------|----------------------|
| `test` pass / `review` advisory | `/claude-tweaks:review {spec}` (after test mode) or `/claude-tweaks:wrap-up {spec}` (after review) |
| `test` fail | Fix the flagged anti-patterns, re-run `/claude-tweaks:test` |
| `shape` ok | Append `output` to the design doc, continue `/claude-tweaks:specify` |
| `pre-build` ok | `/claude-tweaks:build {spec}` — references loaded |
| `polish` ok + `commands_invoked` non-empty | `/claude-tweaks:test skip-qa` — re-verify after polish |
| `polish` ok + `commands_invoked: []` | `/claude-tweaks:wrap-up {spec}` — no changes, proceed |
| `survey` ok + recommendations | Run any resonating command manually |
| `survey` ok + `recommendations: []` | No follow-up — caller omits the Creative Opportunities block |
| `reset-recommendations` ok | Re-run `/claude-tweaks:flow {spec}` or `/claude-tweaks:visual-review` — survey will re-surface |
| `live` ok (`session: "completed"`) | If a variant was accepted, `/claude-tweaks:test` — re-verify the change |
| `explore` ok (scope `identity`, `design_md: "seeded"`) | `/claude-tweaks:specify` — direction locked; brainstorm/specify against it |
| `explore` ok (scope `layout`, `visual_reference` set) | `/claude-tweaks:specify` — winner carried forward as a `Visual-reference:` line |
| `doctor` advisory + `findings` non-empty | Run the Impeccable command each `route` finding's `fix` names (typically `/impeccable:impeccable init` or `document`); `auto` findings are applied by the user's own `doctor.mjs --fix`, never by this wrapper |
| `doctor` advisory + `findings: []` | No follow-up — the project's Impeccable artifacts are current |
| `{skipped: "Impeccable not installed"}` | `/claude-tweaks:init` to set up integration (Step 11) |
| `{skipped: "design integration disabled"}` | Re-run `/claude-tweaks:init` to re-enable |
| `{skipped: "non-frontend"}` | No action — the wrapper correctly skipped |

The table above stays as-is — it's the assistant's own resolution logic for picking which line applies to the current return shape, never itself shown to the user or rendered directly. Once resolved (matched by return shape from the table above), render the matching line:

**`/claude-tweaks:test {spec}`** — re-verify (recommended after `polish ok + commands_invoked` or `test fail`)
**`/claude-tweaks:review {spec}`** — code review quality gate (recommended after `test pass` or `review advisory`)
`/claude-tweaks:wrap-up {spec}` — close out the spec — after `review advisory` with nothing to fix, or `polish` no-op
`/claude-tweaks:init` — configure or re-enable design integration — only when `{skipped: "Impeccable not installed"}` or `{skipped: "design integration disabled"}`
**`/claude-tweaks:specify`** — brainstorm or decompose against the locked direction or winning layout (recommended after `explore` ok, either scope)

## Component-Skill Contract

This skill is a **component skill** (utility wrapper) — invoked by `/claude-tweaks:test`, `/claude-tweaks:review`, `/claude-tweaks:build`, `/claude-tweaks:flow`, `/claude-tweaks:specify`, `/claude-tweaks:visual-review`, and `/claude-tweaks:tidy`. Parent invocation is signaled by `$PIPELINE_RUN_DIR` being set (the parent is running inside an active pipeline run) — or, when the caller is itself running standalone with no `$PIPELINE_RUN_DIR` of its own to forward, by an explicit `--source <parent-skill>` flag the caller passes instead. Standalone `/claude-tweaks:visual-review` is exactly this case: its Step 4 `survey` call and Step 5 Boost-gate `review`/`live` calls all pass `--source visual-review` so this wrapper still recognizes them as caller-invoked even with no run directory in play. `/claude-tweaks:tidy` is the same case in practice — it has one sanctioned parent (`/claude-tweaks:sweep`), but even under that parent tidy never receives a caller-side run dir to forward (sweep sets `$PIPELINE_RUN_DIR` directly, not through tidy), so its Step 4.9 `doctor` call passes `--source tidy` unconditionally rather than conditioning on `$PIPELINE_RUN_DIR`, exactly as it does standalone. When invoked from a caller skill (via either signal), omit the `## Next Actions` block (callers consume the return shape themselves). When invoked directly by a user (neither signal present), render the Next Actions table above.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Running CLI gate on backend specs | Wastes scans on irrelevant files — the detection layer must skip before invocation |
| Treating `/impeccable:impeccable critique` as authoritative | Advisory only — surfaced for user judgment, never auto-applied |
| Hard-failing the test gate when the CLI is missing | Blocks users without Impeccable — the availability check returns skip, not fail |
| Running `polish` when the audit cache is absent | Suggestion-driven dispatch needs audit findings — run the refinement set and intent dispatch, and skip it, rather than guessing commands |
| Deriving a polish command from a finding's `category`, `rule`, or `description` | The finding's own `suggestion` field is the only dispatch key. Keyword-mapping was retired precisely because it re-derived, badly, what `audit` already states. |
| Dropping an audit finding that has no `suggestion` | Stage it as an unclassified observation so it reaches the Review Console — silently discarding it loses a real finding. |
| Polish modifying logic that breaks tests | `/flow`'s re-verify gate and one-cycle cap only contain it — keep polish scoped to design-system alignment, not behavior. |
| Auto-running intent-driven commands without explicit intent | Dispatch ONLY when `design-intent:` declares a matching value — inferring it from file content or LLM judgment removes user agency. |
| Auto-running survey recommendations | `survey` is read-only — it suggests, never invokes. Auto-running its output bypasses user agency. |
| Treating survey recommendations as authoritative or complete | Survey is heuristic — it misses opportunities and recommends ill-fitting commands. The block says "could enhance further" — never "design is complete" or "design is brilliant." |
| Surfacing recommendations the user already declined twice | Noise — the declined-recommendations cache suppresses after 2 declines. Reset via `/claude-tweaks:design-wrapper reset-recommendations <spec>`. |
| Passing `--fix` to `doctor.mjs` | It edits `PRODUCT.md` on disk. `auto` findings are surfaced as staged proposals carrying their own `fix` text; the user runs `--fix` themselves. "Upstream says these need no judgment" answers a different question than "may this wrapper apply them unattended." |
| Passing any flag but `--json` to `doctor.mjs` | Its argument parser is strict — an unrecognized argument exits 1 with a usage error, turning a supported invocation into a spurious execution-failure skip. |
| Collapsing `route`/`mention`/`auto` into claude-tweaks' severity words in the wrapper's return | Upstream's `--fix` boundary is defined in terms of those exact strings. `/tidy` maps them for display only, and keeps the original verbatim in the row it renders. |
| Running Layer 3's file sniff before `doctor` | `doctor` audits project artifacts, not a diff. `/tidy` usually runs on a clean tree, so the sniff would skip it on exactly the runs it exists to serve. |
| Running the Impeccable CLI or `live` on a native surface | Both are web-only, upstream's own constraint in `reference/routing.md`. An HTML rule engine over SwiftUI or Compose finds nothing it knows how to look for. |
| Returning `pass` from `test` mode on a native surface | `skipped` is the only honest outcome. A detector that never applied reporting a pass is a gate that cannot fail — the same defect the CLI gate was rewritten to remove, on a different axis. |
| Dispatching native work without naming `ios`, `android`, or `adaptive` | Upstream has no unnamed-native track — `adapt.native.md` and `audit.native.md` each require one of the three. A sentinel or empty value has nothing to route to. |
| Letting `setup.platform` silently overrule an explicit `Surface:` | A stale `PRODUCT.md` would redirect a record's declared surface with no trace. The override wins, and is named in `surface_track_override` and in the run's `decisions.md`. |
| Running Layer 3's web-only sniff against a declared native surface | Its trigger table holds no native extension, so it returns `non-frontend (sniff)` on exactly the records native routing exists to serve. |
| Caching availability results across sessions on disk | In-memory per session — never write the marker to `~/.claude-tweaks/` (harness-owned runtime state) |
| Writing audit / recommendations / declined caches to `~/.claude-tweaks/` | Harness-owned. All three live beside the ledger at `docs/plans/YYYY-MM-DD-{feature}-{audit\|recommendations\|declined}.json`. |
| Calling `/impeccable:impeccable` without first checking availability | The Skill tool errors if the plugin isn't installed — check first and skip cleanly |
| Treating the `surface:` field as required | `/specify` writes it on new records; Layer 3 sniff handles records predating that behavior. Demanding it breaks them all. |
| Reading `pre-build` context as a hard gate | Lazy-loaded references are *enrichment* — skipping (no Impeccable, non-frontend) must not block the build. |
| Invoking `live` mode from an auto-mode or `$PIPELINE_RUN_DIR`-set context | `live` needs a human in a browser — no non-interactive path exists. Callers must restrict it to interactive, standalone invocation. |
| Invoking `explore` mode from an auto-mode or `$PIPELINE_RUN_DIR`-set context | Same reasoning as `live` — a human must be present in a browser to compare and pick; no non-interactive path exists. |
| The wrapper writing `DESIGN.md` itself after an `explore` pick | Upstream `document --seed` is the only writer — the wrapper writes nothing outside `docs/plans/` (same discipline as `doctor`'s never-`--fix` rule). |
| Treating a craft critic as a third-party agent | It is a contract subagent — status line, Template A + `Target`, Standard profile all apply; Step 3.7's exemption covers `impeccable-finish-reviewer` only. |
| Dispatching a craft critic on the native track | Emil is web-only (`design-craft.md` Gating) and `critics.md` has no native row — nothing to dispatch. |
| Inferring the motion signal from file content | It comes from the spec/`Design-intent:` (consumer judgment) — inference from code removes user agency, same rule as intent-driven dispatch. |
| Writing a `decisions` finding into the polish cache, or letting polish act on one | `DESIGN.md` is upstream-owned — a `decisions` finding stages for a human at the Console (`review.md` Step 5.5); polish consumes `code` findings only, as context. |
