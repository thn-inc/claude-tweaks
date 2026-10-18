# Design Mode — pre-build

Invoked via `/claude-tweaks:design-wrapper pre-build <spec>`. Returns `{mode, result: "ok", loaded, context_size, missed}` or `{mode, skipped, ...}` to caller.

## When this runs

Called by `/claude-tweaks:build` before implementation. Lazy-loads Impeccable reference files, project design context (`PRODUCT.md` + `DESIGN.md` + the `.impeccable/design.json` sidecar), and craft principles per `_shared/design-craft.md` into the build subagent's context. Does not modify code — read-only enrichment.

## Preconditions

Run the universal preconditions from `../SKILL.md` (all three detection layers + availability for the Impeccable plugin).

## Procedure

### Step 1: Run preconditions

On any skip, return the skip object — `/build` proceeds without lazy-loaded references (skip is informational, not a gate failure).

### Step 2: Read the spec file

When `<spec>` is a record reference, resolve via the run's materialized file (`{run-dir}/work/{n}-spec.md` when present — a `current-branch` run — else the worktree mirror `{worktree}/.claude-tweaks/pipelines/{run-id}/work/{n}-spec.md`, resolved as `_shared/design-wrapper-handling.md`'s `--surface` bullet describes; format per `skills/flow/materialize.md`); when a path, read directly. Inspect the spec's contents to choose which Impeccable reference files to load.

### Step 3: Decide which Impeccable references to load

> **Parallel execution:** Use parallel tool calls aggressively — Steps 3-5 together read a set of independent files (every Impeccable reference doc the selection rules below resolve to, plus `PRODUCT.md`/`DESIGN.md` or their fallback globs, the `.impeccable/design.json` sidecar, and the Emil skill files Step 5 resolves); none depends on another's content, so batch every Read once the file list is decided.

**Terminal track (`surface_track === "terminal"` — see `../terminal-routing.md`):** the always-load
set is `_shared/terminal-ux.md` plus `_shared/design-craft.md` only — no Impeccable references, no
Emil skills, no `PRODUCT.md`/`DESIGN.md`/sidecar read; `missed` stays empty (nothing on this track
has an install to miss). Skip the keyword rules and Steps 4–5 below for this track.

Reference selection rules (inspect the spec body) — Impeccable 4.5's own load order (its `SKILL.md` Modes section and Setup steps: load the request's playbook, then read `craft-floor.md` immediately before any UI edit):

- **Always load** when frontend: `new-work.md`, `craft-floor.md`
- **Add `operate.md`** when the spec mentions dashboard, settings, admin, docs, tools, or an authenticated/task surface — Impeccable's own mode split (its `SKILL.md` describes loading new-work.md for new surfaces and operate.md for deeper Operate/Read guidance)
- **Add `adapt.md`** when the spec mentions breakpoints, mobile, tablet, responsive, or viewport
- **Add `clarify.md`** when the spec mentions copy, microcopy, error messages, empty states, or labels

The keyword rules above select *which reference files to load*. They are not a job-type classifier and must not grow into one: nothing here decides whether the record is a redesign, a new page, or an addition. `new-work.md` is in the always-load set precisely because its first step ("Decide what is already true") is where that determination belongs, and it is made downstream — during the build, against the real code and the record's own description — not guessed here from keywords. Carry the record's description into `description` (see Output to caller) so the implementer has the text that determination needs; do not summarize or label it.

Reference files live inside the Impeccable plugin's skill directory. The wrapper does not bundle them — it lazy-loads them via the Skill tool's read of `/impeccable:impeccable` (consult the Impeccable plugin's own SKILL.md for the canonical paths). When a reference cannot be located, note the miss and continue with what was loaded.

### Step 4: Load project design context (when present)

- **Canonical paths:** `PRODUCT.md` and `DESIGN.md` at the project root. These are written by `/impeccable:impeccable init` (PRODUCT) and `/impeccable:impeccable document` (DESIGN). Confirmed against Impeccable's official documentation (https://impeccable.style/).
- **Fallback discovery:** If neither file is present at root, glob `docs/design/*.md` and `docs/PRODUCT.md`, `docs/DESIGN.md` as a defensive secondary location.

Missing files are not errors — they mean `/impeccable:impeccable init` and `document` have not been run yet. Read each discovered file and include it in the loaded set.

- **Sidecar:** additionally load `.impeccable/design.json` at the project root — Impeccable 4.x's sidecar (motion tokens, shadow/elevation tokens, breakpoints, component snippets). Root only, **no fallback glob** — upstream fixes its location. A missing sidecar is not an error. Exactly one permutation writes a `missed` note: `DESIGN.md` found but the sidecar absent — the only state where a sidecar is expected to exist, since upstream's `document` flow creates it alongside `DESIGN.md`. Every other found/absent combination stays silent, by design. The sidecar is forwarded exactly like any other loaded file and counted by `context_size`.

### Step 5: Load craft principles (Emil skills + the contract itself)

Resolve and load Emil Kowalski's skills per `_shared/design-craft.md` — that contract owns the lookup order, the relevance map (which skills load on which signal), the web-track gating, and the degradation posture; none of it is restated here. Pre-build-specific mechanics only:

- Each resolved skill's `SKILL.md` path joins `loaded`.
- Each relevance-map-selected skill that resolves at no lookup path joins `missed`. An absent Emil install is a `missed` note and a normal `result: "ok"` — never a skip object.
- Append the contract file itself to `loaded` — `${CLAUDE_PLUGIN_ROOT}/skills/_shared/design-craft.md`, resolved to the absolute installed plugin root before appending (the placeholder is model-resolved, never passed through unsubstituted — see docs/skill-authoring.md's Plugin-root references rule) — so the implementer receives the authority rule verbatim as part of the loaded set. It is a path string appended like every other entry (no schema change, no excerpting); the contract file is written to be safely includable whole.

## Output to caller

```json
{
  "mode": "pre-build",
  "result": "ok",
  "loaded": [ "<path1>", "<path2>", ... ],
  "context_size": <approx tokens, sum of file sizes / 4>,
  "missed": [ "<path that was expected but not found>" ],
  "description": "<the record's own description of the work, verbatim>"
}
```

The `context_size` is a rough estimate (`bytes / 4`) — used by `/build` to decide whether to summarize the references before injecting into the subagent prompt versus passing them whole.

`description` is the record's own text, passed through unaltered from Step 2's spec read; omit the field entirely when the spec yielded no usable description. It pairs with `new-work.md` in `loaded`: the reference supplies the classification procedure, this field supplies the input it classifies. `/build` forwards both into the implementer's context rather than acting on either — a wrapper-side or caller-side summary of the description would substitute this layer's reading of the work for upstream's, which is what this mode stopped doing.

`pre-build` does not modify code. The loaded references are read-only context for the implementer subagent.
